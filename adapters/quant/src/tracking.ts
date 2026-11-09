// Exact dependency tracking: resolve a read outside the stable cursor path.
// Proofs come cheapest first: the cursor (in `read`), the previous read, a
// source nobody reads, bounded scans of this reader's list, then the source's
// first subscribers. Only a source with more subscribers than the budget needs
// the slot index. Slot walks and edge creation remain in the kernel because
// they mutate its shared stack.
import { Flag, SCAN, UNREAD } from "./flags";
import type { Edge, Node } from "./model";
import { move } from "./graph";
import { claim, index, link } from "./kernel";
import { stats } from "./instrumentation";
import { accounting } from "./accounting";
import {
  firstSub,
  nextDep,
  nextSub,
  observe,
  observed,
  prevDep,
  same,
  source,
  target,
} from "./backend";

/**
 * A read that is not the next edge in read order. Every answer is exact. A
 * repeated read keeps the version of the pass's first observation (P5): a
 * change between the two reads stays visible to the next validation.
 */
export function miss(
  c: Node,
  s: Node,
  last: Edge | null,
  next: Edge | null,
): void {
  if (last !== null && source(last) === s) {
    if (__STATS__) stats.repeats++;

    return;
  }

  const f = c.flags;

  if ((f & Flag.Indexed) !== 0) return slot(c, s, last, next);
  /** The pair's edge through the source's subscribers; undefined: unknown. */
  let found: Edge | null | undefined;

  if ((f & Flag.Marked) === 0) {
    // A source without subscribers is absent.
    if (firstSub(s) === null) return link(c, s, last, next);
    // An edge found by a scan is the pair's only one; absence needs one side
    // scanned completely (this reader's list, or the source's subscribers).
    let e = next !== null ? nextDep(next) : null;
    let budget = SCAN;

    while (e !== null && source(e) !== s && --budget !== 0) e = nextDep(e);

    if (e !== null && source(e) === s) {
      if (__STATS__) stats.scans++;

      observe(e, s.ver);
      return move(c, e, last, next!);
    }
    let p = last !== null ? prevDep(last) : null;
    budget = SCAN;

    while (p !== null && source(p) !== s && --budget !== 0) p = prevDep(p);

    if (p !== null && source(p) === s) {
      if (__STATS__) {
        stats.dups++;
        accounting.backwardHits++;
      }

      return;
    }

    // Absent if this reader's whole list was scanned; otherwise the source's
    // first subscribers decide. Found as the first one: a lookup through the
    // subscribers costs no load beyond the read itself, so mark the unread
    // suffix and let the rest of the pass find its pairs that way, with no
    // slot to fill or clear. Found deeper: every lookup would walk other
    // readers' edges, so index; either way the found edge is taken at once.
    if (__STATS__ && last !== null) {
      if (p === null) accounting.backwardReachedHead++;
      else accounting.backwardBudgetExhausted++;
    }
    if (__STATS__ && e === null && p === null) accounting.absenceProofs++;

    found = e === null && p === null ? null : pair(s, c);

    if (found !== null && found !== undefined) begin(c, s, found, next);
  } else found = pair(s, c);

  if (found === null) return link(c, s, last, next);

  if (found !== undefined) return take(c, found, s, last, next);
  // Past the budget: index the pass, and the slot decides from here on.
  index(c, next);
  slot(c, s, last, next);
}

/** An indexed pass's lookup: the source's slot holds the pair's edge, or the pair is absent. */
function slot(c: Node, s: Node, last: Edge | null, next: Edge | null): void {
  if (__STATS__) stats.lookups++;

  const cell = s.slot;

  if (cell !== null && target(cell) === c) return take(c, cell, s, last, next);
  link(c, s, last, next);
  claim(s, c.last as Edge);
}

/**
 * The pair's edge among the source's first SCAN subscribers: null if the list
 * ends first (absent), undefined if the budget runs out (unknown).
 */
function pair(s: Node, c: Node): Edge | null | undefined {
  if (__STATS__) stats.lookups++;

  let budget = SCAN;

  for (let e = firstSub(s); e !== null; e = nextSub(e)) {
    if (target(e) === c) {
      if (__STATS__) {
        if (budget === SCAN) accounting.pairFoundFirst++;
        else accounting.pairFoundDeeper++;
      }
      return e;
    }

    if (--budget === 0) {
      if (__STATS__) accounting.pairBudgetExhausted++;

      return undefined;
    }
  }
  if (__STATS__) accounting.pairAbsent++;

  return null;
}

/**
 * The pass's lookup from here on, decided by the found edge's place: the
 * source's first subscriber marks the unread suffix, from `next` on (a walk
 * over edges, not sources); deeper, index.
 */
function begin(c: Node, s: Node, e: Edge, next: Edge | null): void {
  if (!same(e, firstSub(s))) return index(c, next);

  if (__STATS__) {
    stats.sweeps++;
    accounting.sweeps++;
  }

  c.flags |= Flag.Marked;

  for (let u = next; u !== null; u = nextDep(u)) {
    if (__STATS__) {
      stats.indexed++;
      accounting.indexedEdges++;
    }

    observe(u, UNREAD);
  }
}

/**
 * A found edge: an unread one is observed and moves to the cursor; a repeated
 * read keeps its place and its first observation's version (P5).
 */
function take(
  c: Node,
  e: Edge,
  s: Node,
  last: Edge | null,
  next: Edge | null,
): void {
  if (observed(e) !== UNREAD) {
    if (__STATS__) stats.dups++;

    return;
  }
  if (__STATS__) stats.moves++;

  observe(e, s.ver);
  move(c, e, last, next!);
}

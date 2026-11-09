// The only module that talks to the Relation Store.
//
// Everything Quant needs that L0 does not hold is kept here on purpose and in
// plain sight, so that it can be counted (research/M1-QUANT-INVENTORY.md):
//   generations   external per-relation word: Edge.gen
//   predecessors  external per-relation word: Edge.prev
//   bound         host binding: NodeId to Node (Node.id is the other direction)
//   retiredNext   literal compatibility: what Edge.next held after removal
import { RelationMachine, STRONG } from "../../../reference/machine.ts";
import { accounting } from "./accounting";
import { QuantNode } from "./model";
import type { Edge, Flags, Fn, Generation, Node } from "./model";

const store = new RelationMachine();
const bound: Node[] = [];
const generations: Generation[] = [];
const predecessors: (Edge | null)[] = [];
const retiredNext = new Map<number, Edge | null>();
let walks = 0;

export function createNode(fn: Fn | null, value: unknown, flags: Flags): Node {
  const id = store.node();
  const n = new QuantNode(fn, value, flags, id);
  bound[id.slot] = n;
  return n;
}

export function same(a: Edge | null, b: Edge | null): boolean {
  if (a === null || b === null) return a === b;
  return a.slot === b.slot && a.generation === b.generation;
}

export function source(e: Edge): Node {
  if (__STATS__ && store.status(e) === "retired") accounting.retiredFieldReads++;

  return bound[store.right(e).slot] as Node;
}

export function target(e: Edge): Node {
  if (__STATS__ && store.status(e) === "retired") accounting.retiredFieldReads++;

  return bound[store.left(e).slot] as Node;
}

export function firstDep(n: Node): Edge | null {
  return store.first("left", n.id);
}

export function firstSub(n: Node): Edge | null {
  return store.first("right", n.id);
}

/** Edge.next. On a removed edge this is what Quant's representation left there. */
export function nextDep(e: Edge): Edge | null {
  if (store.status(e) === "retired") {
    const literal = retiredNext.get(e.slot) ?? null;

    if (__STATS__) tallyRetiredNext(e, literal);

    return literal;
  }
  return store.next("left", e);
}

export function prevDep(e: Edge): Edge | null {
  return predecessors[e.slot] ?? null;
}

export function nextSub(e: Edge): Edge | null {
  return store.next("right", e);
}

export function observed(e: Edge): number {
  if (__STATS__ && store.status(e) === "retired") accounting.retiredFieldReads++;

  return store.meta(e);
}

export function observe(e: Edge, version: number): void {
  store.setMeta(e, version);
}

export function generationOf(e: Edge): Generation {
  if (__STATS__ && store.status(e) === "retired") accounting.retiredFieldReads++;

  return generations[e.slot] as Generation;
}

/** A new edge after `last` on the dependency axis, at the tail of the subscribers. */
export function linkEdge(
  c: Node,
  s: Node,
  last: Edge | null,
  next: Edge | null,
  version: number,
  generation: Generation,
): Edge {
  if (__STATS__) {
    if (next !== null) accounting.linksInsideList++;
    else accounting.linksAtTail++;
  }
  const e = store.relate(c.id, s.id, STRONG, version);
  generations[e.slot] = generation;
  predecessors[e.slot] = last;

  if (next !== null) {
    store.moveAfter("left", e, last);
    predecessors[next.slot] = e;
  }
  return e;
}

/** Move an unread edge (strictly after `next`) up to the cursor. */
export function moveEdge(e: Edge, last: Edge | null, next: Edge): void {
  if (__STATS__) accounting.moves++;

  const before = prevDep(e);
  const after = nextDep(e);

  if (after !== null) predecessors[after.slot] = before;

  store.moveAfter("left", e, last);
  predecessors[e.slot] = last;
  predecessors[next.slot] = e;
}

/** Remove a relation; `leftBehind` is what Edge.next would still hold. */
export function retire(e: Edge, leftBehind: Edge | null): void {
  if (__STATS__) accounting.unlinks++;

  if (walks !== 0) {
    retiredNext.set(e.slot, leftBehind);

    if (__STATS__) {
      accounting.continuationRecords++;
      accounting.maxSimultaneouslyRetired = Math.max(accounting.maxSimultaneouslyRetired, retiredNext.size);
    }
  }

  store.unlink(e);
}

/** Take a live edge out of the middle of its list, repairing the predecessor. */
export function removeFromList(e: Edge, after: Edge | null): void {
  if (after !== null) predecessors[after.slot] = prevDep(e);

  retire(e, null);
}

/** Opened around every walk that holds an edge across user code. */
export function enterWalk(): void {
  walks++;
  store.enter();

  if (__STATS__) {
    accounting.walkEpochs++;
    accounting.maxWalkDepth = Math.max(accounting.maxWalkDepth, walks);
  }
}

export function exitWalk(): void {
  store.exit();

  if (--walks === 0) retiredNext.clear();
}

function tallyRetiredNext(e: Edge, literal: Edge | null): void {
  accounting.retiredNextReads++;

  if (literal !== null) accounting.retiredNextReadsNonNull++;

  if (!same(literal, store.next("left", e))) accounting.retiredNextDivergent++;
}

/** A walk is about to run user code while holding `current` and stack[base..top). */
export function noteHeld(current: Edge | null, base: number, top: number): void {
  accounting.userCodeCrossings++;
  accounting.edgesHeldAcrossUserCode += top - base + (current === null ? 0 : 1);
}

export function noteReleased(current: Edge | null, stack: readonly unknown[], base: number, top: number): void {
  if (current !== null && store.status(current) === "retired") accounting.edgesRetiredWhileHeld++;

  for (let i = base; i < top; i++) {
    if (store.status(stack[i] as Edge) === "retired") accounting.edgesRetiredWhileHeld++;
  }
}

export function externalSizes(): { relationSlots: number; nodes: number } {
  return { relationSlots: generations.length, nodes: bound.length };
}

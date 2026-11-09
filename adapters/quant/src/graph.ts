// Graph operations independent of the execution context, over the store.
import type { Edge, Flags, Node } from "./model";
import { createNode, firstDep, moveEdge, nextDep, removeFromList, retire } from "./backend";
import { stats } from "./instrumentation";

export function node(fn: Node["fn"], value: unknown, flags: Flags): Node {
  return createNode(fn, value, flags);
}

/** Move an unread edge (strictly after `next`) up to the cursor. */
export function move(c: Node, e: Edge, last: Edge | null, next: Edge): void {
  moveEdge(e, last, next);
  c.last = e;
}

/** Remove every edge of `c` after `last` (all of them when null). */
export function cut(c: Node, last: Edge | null): void {
  let e = last === null ? firstDep(c) : nextDep(last);

  while (e !== null) {
    if (__STATS__) stats.unlinks++;

    const after: Edge | null = nextDep(e);
    retire(e, after);
    e = after;
  }
}

/** A failed run's tentative edge: out of both lists, its links cleared. */
export function drop(e: Edge, after: Edge | null): void {
  if (__STATS__) stats.unlinks++;

  removeFromList(e, after);
}

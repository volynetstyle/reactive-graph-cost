// M4.5 control: the Alien port with all relational state outside the store, in flat ordered
// lists per node, as WPF and Salsa hold theirs. It replaces src/backend.ts in a copy.
//
// What the client had to keep to pass is the result:
//   a record per relation, with both endpoints and a version word     identity, payload
//   two ordered lists per node                                        dual incidence
//   insertion at a position in the left list                          positioned insert
//   the successors of a removed record, and its predecessors          post-removal state
import { accounting } from "./accounting";

export interface Link {
  dep: any;
  sub: any;
  version: number;
  prevDep: Link | undefined;
  prevSub: Link | undefined;
  removed: boolean;
  frozenNextDep: Link | undefined;
  frozenNextSub: Link | undefined;
}

export interface BoundNode {
  id?: unknown;
}

const lefts = new WeakMap<object, Link[]>();
const rights = new WeakMap<object, Link[]>();

function listOf(map: WeakMap<object, Link[]>, node: object): Link[] {
  let list = map.get(node);

  if (list === undefined) {
    list = [];
    map.set(node, list);
  }
  return list;
}

export function same(a: Link, b: Link): boolean {
  return a === b;
}

export function depOf(link: Link): any {
  return link.dep;
}

export function subOf(link: Link): any {
  return link.sub;
}

export function firstDep(node: BoundNode): Link | undefined {
  return listOf(lefts, node)[0];
}

export function firstSub(node: BoundNode): Link | undefined {
  return listOf(rights, node)[0];
}

export function ownerOf(node: BoundNode): any {
  return firstSub(node)?.sub;
}

function after(list: Link[], link: Link): Link | undefined {
  return list[list.indexOf(link) + 1];
}

export function nextDepOf(link: Link): Link | undefined {
  accounting.forwardLeftSteps++;

  return link.removed ? link.frozenNextDep : after(listOf(lefts, link.sub), link);
}

export function nextSubOf(link: Link): Link | undefined {
  accounting.forwardRightSteps++;

  return link.removed ? link.frozenNextSub : after(listOf(rights, link.dep), link);
}

export function prevDepOf(link: Link): Link | undefined {
  accounting.reverseWalkSteps++;

  return link.prevDep;
}

export function snapshotPrevDep(link: Link): Link | undefined {
  return link.prevDep;
}

export function validStep(link: Link): Link | undefined {
  accounting.isValidLinkSteps++;

  return link.prevDep;
}

export function prevSubOf(link: Link): Link | undefined {
  return link.prevSub;
}

export function versionOf(link: Link): number {
  accounting.versionReads++;

  return link.version;
}

export function setVersionOf(link: Link, version: number): void {
  accounting.versionWrites++;
  link.version = version;
}

export function enterEpoch(): void {}

export function exitEpoch(): void {}

export function noteLink(_kind: "prev" | "next" | "tail"): void {}

export function crossing(run: () => boolean, _link: Link, _stack: unknown, _subs: Link | undefined): boolean {
  return run();
}

export function noteUnwatched(_dep: object): void {}

export function noteAfterUnwatched(_savedNext: Link | undefined): void {}

export function externalSizes(): { relationSlots: number; nodes: number } {
  return { relationSlots: 0, nodes: 0 };
}

export function createLink(dep: BoundNode, sub: BoundNode, version: number, prevDep: Link | undefined, nextDep: Link | undefined, prevSub: Link | undefined): Link {
  const link: Link = { dep, sub, version, prevDep, prevSub, removed: false, frozenNextDep: undefined, frozenNextSub: undefined };
  const left = listOf(lefts, sub);

  if (nextDep === undefined) left.push(link);
  else {
    left.splice(prevDep === undefined ? 0 : left.indexOf(prevDep) + 1, 0, link);
    nextDep.prevDep = link;
  }
  listOf(rights, dep).push(link);
  return link;
}

export function removeLink(link: Link, prevDep: Link | undefined, nextDep: Link | undefined, prevSub: Link | undefined, nextSub: Link | undefined): void {
  if (link.removed) return;
  link.removed = true;
  link.frozenNextDep = nextDep;
  link.frozenNextSub = nextSub;
  const left = listOf(lefts, link.sub);
  const right = listOf(rights, link.dep);
  left.splice(left.indexOf(link), 1);
  right.splice(right.indexOf(link), 1);
  if (nextDep !== undefined) nextDep.prevDep = prevDep;
  if (nextSub !== undefined) nextSub.prevSub = prevSub;
}

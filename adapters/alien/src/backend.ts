// The only module of the Alien port that talks to the Relation Store. Its
// external state, by class (research/M2-ALIEN-INVENTORY.md):
//   payload      versions: Link.version as a JS number, wider than L0's int32
//   predecessor  previousDeps, previousSubs: Link.prevDep and Link.prevSub
//   binding      bound and ReactiveNode.id: NodeId and node in both directions
//   retirement   removeLink tolerates a second unlink of a retired Link
//
// No retired snapshots or continuation emulation. An epoch is opened only where
// the corpus witnessed a read of a retired Link: around running an effect. Any
// other use of an unlinked Link fails with a ContractError.
import { RelationMachine, STRONG, type NodeId, type RelationId } from "../../../reference/machine.ts";
import { accounting } from "./accounting";

export type Link = RelationId;

export interface BoundNode {
  id?: NodeId;
}

const store = new RelationMachine();
const bound: BoundNode[] = [];
const versions: number[] = [];
const previousDeps: (Link | undefined)[] = [];
const previousSubs: (Link | undefined)[] = [];
/** Accounting only: the successors Alien's fields would still hold. */
const frozen = new Map<number, { left: Link | undefined; right: Link | undefined }>();
let epochDepth = 0;

function isRetired(link: Link): boolean {
  return store.status(link) === "retired";
}

function idOf(node: BoundNode): NodeId {
  let id = node.id;

  if (id === undefined) {
    id = node.id = store.node();
    bound[id.slot] = node;
  }
  return id;
}

function optional(link: Link | null): Link | undefined {
  return link === null ? undefined : link;
}

/** Throws on a stale handle; a retired one stays readable inside an epoch. */
function assertReadable(link: Link): void {
  store.meta(link);
}

export function same(a: Link, b: Link): boolean {
  return a.slot === b.slot && a.generation === b.generation;
}

export function depOf(link: Link): any {
  if (isRetired(link)) accounting.retiredEndpointReads++;

  return bound[store.right(link).slot];
}

export function subOf(link: Link): any {
  if (isRetired(link)) accounting.retiredEndpointReads++;

  return bound[store.left(link).slot];
}

export function firstDep(node: BoundNode): Link | undefined {
  return optional(store.first("left", idOf(node)));
}

export function firstSub(node: BoundNode): Link | undefined {
  return optional(store.first("right", idOf(node)));
}

export function ownerOf(node: BoundNode): any {
  const link = firstSub(node);

  return link === undefined ? undefined : subOf(link);
}

export function nextDepOf(link: Link): Link | undefined {
  const next = optional(store.next("left", link));

  accounting.forwardLeftSteps++;

  if (isRetired(link)) {
    accounting.retiredNextDep++;

    if (!sameOrAbsent(frozen.get(link.slot)?.left, next)) accounting.retiredNextDivergentFromFrozen++;
  }
  return next;
}

export function nextSubOf(link: Link): Link | undefined {
  const next = optional(store.next("right", link));

  accounting.forwardRightSteps++;

  if (isRetired(link)) {
    accounting.retiredNextSub++;

    if (!sameOrAbsent(frozen.get(link.slot)?.right, next)) accounting.retiredNextDivergentFromFrozen++;
  }
  return next;
}

function sameOrAbsent(a: Link | undefined, b: Link | undefined): boolean {
  return a === undefined || b === undefined ? a === b : same(a, b);
}

/** A client-visible backward step: the reverse disposal walks. */
export function prevDepOf(link: Link): Link | undefined {
  accounting.reverseWalkSteps++;

  return snapshotPrevDep(link);
}

/** The backward read inside unlink, not counted as traversal. */
export function snapshotPrevDep(link: Link): Link | undefined {
  assertReadable(link);

  if (isRetired(link)) accounting.retiredPredecessorReads++;

  return previousDeps[link.slot];
}

export function validStep(link: Link): Link | undefined {
  accounting.isValidLinkSteps++;
  assertReadable(link);

  return previousDeps[link.slot];
}

export function prevSubOf(link: Link): Link | undefined {
  assertReadable(link);

  if (isRetired(link)) accounting.retiredPredecessorReads++;

  return previousSubs[link.slot];
}

export function versionOf(link: Link): number {
  assertReadable(link);
  accounting.versionReads++;

  return versions[link.slot] as number;
}

export function setVersionOf(link: Link, version: number): void {
  assertReadable(link);
  accounting.versionWrites++;
  accounting.maxVersion = Math.max(accounting.maxVersion, version);
  versions[link.slot] = version;
}

export function enterEpoch(): void {
  store.enter();
  accounting.epochs++;
  accounting.maxEpochDepth = Math.max(accounting.maxEpochDepth, ++epochDepth);
}

export function exitEpoch(): void {
  store.exit();

  if (--epochDepth === 0) frozen.clear();
}

export function noteLink(kind: "prev" | "next" | "tail"): void {
  if (kind === "prev") accounting.linkHitPrev++;
  else if (kind === "next") accounting.linkHitNext++;
  else accounting.linkDedupedByRightTail++;
}

/** Runs user code while a walk holds Links; counts those that did not survive. */
export function crossing(run: () => boolean, link: Link, stack: { value: Link; prev: unknown } | undefined, subs: Link | undefined): boolean {
  const held: Link[] = subs === undefined ? [link] : [link, subs];

  for (let s: any = stack; s !== undefined; s = s.prev) held.push(s.value);

  accounting.updateCrossings++;
  accounting.linksHeldAcrossUpdate += held.length;
  const changed = run();

  for (const h of held) {
    if (store.status(h) !== "live") accounting.heldLinksRetiredByUpdate++;
  }
  return changed;
}

export function noteUnwatched(dep: object): void {
  accounting.unwatchedCrossings++;

  if ("getter" in dep) accounting.unwatchedComputed++;
  else if ("currentValue" in dep) accounting.unwatchedSignal++;
  else if ("fn" in dep) accounting.unwatchedEffect++;
  else accounting.unwatchedScope++;
}

export function noteAfterUnwatched(savedNext: Link | undefined): void {
  if (savedNext !== undefined && store.status(savedNext) !== "live") accounting.savedNextRetiredByUnwatched++;
}

export function externalSizes(): { relationSlots: number; nodes: number } {
  return { relationSlots: versions.length, nodes: bound.length };
}

/** A new relation after `prevDep` on the left axis, at the tail of the right axis. */
export function createLink(
  dep: BoundNode,
  sub: BoundNode,
  version: number,
  prevDep: Link | undefined,
  nextDep: Link | undefined,
  prevSub: Link | undefined,
): Link {
  if (nextDep !== undefined) accounting.linksInsideList++;
  else accounting.linksAtTail++;

  if ("getter" in dep || "currentValue" in dep) accounting.dependencyLinks++;
  else accounting.ownershipLinks++;

  accounting.maxVersion = Math.max(accounting.maxVersion, version);

  for (let e = store.first("left", idOf(sub)); e !== null; e = store.next("left", e)) {
    if (store.right(e).slot === idOf(dep).slot) {
      accounting.duplicatePairBirths++;
      break;
    }
  }

  const link = store.relate(idOf(sub), idOf(dep), STRONG);

  versions[link.slot] = version;
  previousDeps[link.slot] = prevDep;
  previousSubs[link.slot] = prevSub;

  if (nextDep !== undefined) {
    store.moveAfter("left", link, prevDep ?? null);
    previousDeps[nextDep.slot] = link;
  }
  return link;
}

/** Removes a relation; the neighbours are the caller's saved locals. */
export function removeLink(link: Link, prevDep: Link | undefined, nextDep: Link | undefined, prevSub: Link | undefined, nextSub: Link | undefined): void {
  // Witnessed by conformance #141: a self-disposing effect re-enters disposal
  // through unwatched while depsTail still names the removed Link. Alien's
  // pointer repairs make that second unlink harmless; L0 rejects it.
  if (store.status(link) === "retired") {
    accounting.secondUnlinks++;

    return;
  }
  accounting.unlinks++;

  if (epochDepth !== 0) {
    frozen.set(link.slot, { left: nextDep, right: nextSub });
    accounting.maxSimultaneouslyRetired = Math.max(accounting.maxSimultaneouslyRetired, frozen.size);
  }
  store.unlink(link);

  if (nextDep !== undefined) previousDeps[nextDep.slot] = prevDep;

  if (nextSub !== undefined) previousSubs[nextSub.slot] = prevSub;
}

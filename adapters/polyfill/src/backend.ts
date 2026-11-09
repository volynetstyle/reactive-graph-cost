// The only module of the polyfill port that talks to the Relation Store.
//
// Option A: the store holds live subscriptions only. The persistent dependency
// trace of every consumer, producerNode[] and producerLastReadVersion[], stays in
// client arrays even while no relation exists for it.
//
// External state, by class (research/M3-POLYFILL-INVENTORY.md):
//   trace     producerNode, producerLastReadVersion: the pull side, outside L0
//   binding   bound and ReactiveNode.storeId: NodeId and node in both directions
//
// No epochs. A relation used after removal fails with a ContractError.
import { RelationMachine, STRONG, type NodeId, type RelationId } from "../../../reference/machine.ts";
import { accounting } from "./accounting";

export type Relation = RelationId;

interface Bound {
  storeId?: NodeId;
  producerNode?: unknown[];
  producerIndexOfThis?: (Relation | undefined)[];
}

const store = new RelationMachine();
const bound: any[] = [];
const consumers = new Set<Bound>();
let cascade = 0;

function idOf(node: Bound): NodeId {
  let id = node.storeId;

  if (id === undefined) {
    id = node.storeId = store.node();
    bound[id.slot] = node;
  }
  return id;
}

function same(a: Relation, b: Relation): boolean {
  return a.slot === b.slot && a.generation === b.generation;
}

export function liveConsumerAt(producer: Bound, index: number): any {
  let e = store.first("right", idOf(producer));

  for (let i = 0; e !== null && i < index; i++) {
    accounting.rightWalkSteps++;
    e = store.next("right", e);
  }
  return e === null ? undefined : bound[store.left(e).slot];
}

export function liveConsumers(producer: Bound): any[] {
  const out: any[] = [];

  for (let e = store.first("right", idOf(producer)); e !== null; e = store.next("right", e)) {
    accounting.rightWalkSteps++;
    out.push(bound[store.left(e).slot]);
  }
  return out;
}

export function liveConsumerCount(producer: Bound): number {
  let count = 0;

  for (let e = store.first("right", idOf(producer)); e !== null; e = store.next("right", e)) {
    accounting.rightWalkSteps++;
    count++;
  }
  return count;
}

export function relateLive(consumer: Bound, producer: Bound): Relation {
  if (cascade > 0) accounting.birthsFromActivation++;
  else accounting.birthsFromTrace++;

  return store.relate(idOf(consumer), idOf(producer), STRONG);
}

/** Removal as the polyfill does it: the last live consumer takes the vacated place. */
export function removeLiveConsumer(producer: Bound, relation: Relation): void {
  if (cascade > 0) accounting.deathsFromDeactivation++;
  else accounting.deathsFromTrace++;

  let before: Relation | null = null;
  let tail: Relation | null = null;

  for (let e = store.first("right", idOf(producer)); e !== null; e = store.next("right", e)) {
    accounting.rightWalkSteps++;
    tail = e;
  }
  for (let e = store.first("right", idOf(producer)); e !== null && !same(e, relation); e = store.next("right", e)) {
    accounting.rightWalkSteps++;
    before = e;
  }
  if (tail !== null && !same(tail, relation)) {
    accounting.rightSwaps++;
    store.moveAfter("right", tail, before);
  } else {
    accounting.rightTailRemovals++;
  }
  store.unlink(relation);
}

export function clearLiveConsumers(producer: Bound): void {
  for (let e = store.first("right", idOf(producer)); e !== null; e = store.first("right", idOf(producer))) {
    store.unlink(e);
  }
}

export function beginActivation(): void {
  accounting.activations++;
  accounting.maxCascadeDepth = Math.max(accounting.maxCascadeDepth, ++cascade);
}

export function endActivation(): void {
  cascade--;
}

export function beginDeactivation(): void {
  accounting.deactivations++;
  accounting.maxCascadeDepth = Math.max(accounting.maxCascadeDepth, ++cascade);
}

export function endDeactivation(): void {
  cascade--;
}

export function noteConsumer(consumer: Bound): void {
  consumers.add(consumer);
}

export function traceOnly(): undefined {
  accounting.traceWritesWithoutRelation++;

  return undefined;
}

/** How many trace entries have no live relation at this moment. */
export function externalSizes(): { traceEntriesAtEnd: number; traceEntriesWithoutRelationAtEnd: number; storeNodes: number } {
  let total = 0;
  let withoutRelation = 0;

  for (const consumer of consumers) {
    const entries = consumer.producerNode?.length ?? 0;

    total += entries;

    for (let i = 0; i < entries; i++) {
      const relation = consumer.producerIndexOfThis?.[i];

      if (relation === undefined || store.status(relation) !== "live") withoutRelation++;
    }
  }
  return { traceEntriesAtEnd: total, traceEntriesWithoutRelationAtEnd: withoutRelation, storeNodes: bound.length };
}

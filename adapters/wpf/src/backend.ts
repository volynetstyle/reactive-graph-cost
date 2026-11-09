// The only module of the WPF port that talks to the Relation Store.
//
// Three things are stored, all binary and all L0:
//   subscription   relation (target, source), WEAK, metadata = index of its handler record
//   handler        a node for each delegate object; each add makes a new one
//   retention      relation (target, handler), STRONG, owned by one list version. This is
//                  one entry of that version's ConditionalWeakTable.
// No epochs, no moves, no left-axis walks.
import { RelationMachine, STRONG, WEAK, type NodeId, type RelationId } from "../../../reference/machine.ts";
import { accounting } from "./accounting.ts";

export type { NodeId, RelationId };

/** One delegate object: which method it names, and the node that models its lifetime. */
export interface HandlerRecord {
  readonly node: NodeId;
  readonly method: number;
  readonly index: number;
}

/**
 * One membership record. NodeIds do not retain, so a snapshot of these fixes who was a
 * member without extending anyone's lifetime.
 */
export interface DeliveryRecord {
  readonly target: NodeId;
  readonly handler: HandlerRecord;
}

export interface Member extends DeliveryRecord {
  readonly relation: RelationId;
}

function same(a: NodeId, b: NodeId): boolean {
  return a.slot === b.slot && a.generation === b.generation;
}

export class SubscriptionStore {
  private readonly store = new RelationMachine();
  private readonly holds = new Map<string, number>();
  private readonly handlers: HandlerRecord[] = [];

  node(): NodeId {
    return this.store.node();
  }

  /** A strong reference from the program or from a running frame. */
  hold(node: NodeId): void {
    const key = `${node.slot}:${node.generation}`;
    const count = this.holds.get(key) ?? 0;
    if (count === 0) this.store.root(node);
    this.holds.set(key, count + 1);
  }

  release(node: NodeId): void {
    const key = `${node.slot}:${node.generation}`;
    const count = this.holds.get(key) ?? 0;
    if (count === 1) this.store.unroot(node);
    this.holds.set(key, count - 1);
  }

  isLive(node: NodeId): boolean {
    return this.store.status(node) === "live";
  }

  newHandler(method: number): HandlerRecord {
    accounting.handlerNodes++;
    const record = { node: this.store.node(), method, index: this.handlers.length };
    this.handlers.push(record);
    return record;
  }

  subscribe(target: NodeId, source: NodeId, handler: HandlerRecord): RelationId {
    accounting.relates++;
    return this.store.relate(target, source, WEAK, handler.index);
  }

  /** Removes a subscription that collect may already have pruned. */
  dropSubscription(relation: RelationId): void {
    if (this.store.status(relation) === "live") this.unlink(relation);
  }

  /** The target keeps this delegate alive, for as long as the owning list version says. */
  retain(target: NodeId, handler: HandlerRecord): RelationId {
    accounting.retentionRelations++;
    return this.store.relate(target, handler.node, STRONG);
  }

  dropRetention(retention: RelationId): void {
    if (this.store.status(retention) !== "live") return;
    accounting.retentionRelationsRemoved++;
    this.store.unlink(retention);
  }

  members(source: NodeId): Member[] {
    const out: Member[] = [];

    for (let e = this.store.first("right", source); e !== null; e = this.store.next("right", e)) {
      accounting.rightWalkSteps++;
      out.push({ relation: e, target: this.store.left(e), handler: this.handlers[this.store.meta(e)]! });
    }
    return out;
  }

  unlink(relation: RelationId): void {
    accounting.unlinks++;
    this.store.unlink(relation);
  }

  /** ListenerList.RemoveHandler: scans from the end, and a dead delegate matches nothing. */
  unsubscribeLast(source: NodeId, target: NodeId, method: number): boolean {
    const last = this.members(source).findLast((m) => same(m.target, target) && m.handler.method === method && this.isLive(m.handler.node));

    if (last === undefined) return false;
    this.unlink(last.relation);
    return true;
  }

  count(source: NodeId): number {
    return this.members(source).length;
  }

  /** Membership at this moment. The baseline's O(k), paid on every delivery. */
  snapshot(source: NodeId): DeliveryRecord[] {
    const records = this.members(source).map(({ target, handler }) => ({ target, handler }));
    accounting.snapshotEntriesCopied += records.length;
    return records;
  }

  firstOf(source: NodeId): RelationId | null {
    return this.store.first("right", source);
  }

  nextOf(relation: RelationId): RelationId | null {
    accounting.rightWalkSteps++;
    return this.store.next("right", relation);
  }

  status(relation: RelationId): string {
    return this.store.status(relation);
  }

  recordOf(relation: RelationId): DeliveryRecord {
    return { target: this.store.left(relation), handler: this.handlers[this.store.meta(relation)]! };
  }

  enter(): void {
    this.store.enter();
  }

  exit(): void {
    this.store.exit();
  }

  /** Logical state held by the store now. */
  stateCounts(): { membership: number; retention: number; retired: number } {
    let membership = 0;
    let retention = 0;
    let retired = 0;

    for (const relation of this.store.snapshot().relations) {
      if (relation.state === "retired") retired++;
      else if (relation.retention.leftToRight) retention++;
      else membership++;
    }
    return { membership, retention, retired };
  }

  collect(): void {
    this.store.collect();
  }
}

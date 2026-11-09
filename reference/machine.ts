// The Abstract Relation Machine: the L0 reference model.
//
// Deliberately naive. Tables and plain arrays stand in for whatever layout a
// native implementation chooses; this model fixes observable behaviour only,
// so its O(degree) array operations say nothing about the bounds in
// CONTRACT.md. GC is explicit: `collect()` computes reachability from an
// explicit root set, so every history is deterministic.
//
// Protected methods are the seams research/ablations use to remove one
// mechanism at a time. They are not part of the contract.

export type Axis = "left" | "right";
export type Status = "live" | "retired" | "stale";
export type SlotState = "free" | "live" | "retired";
export type Direction = "leftToRight" | "rightToLeft";

export interface NodeId {
  readonly kind: "node";
  readonly slot: number;
  readonly generation: number;
}

export interface RelationId {
  readonly kind: "relation";
  readonly slot: number;
  readonly generation: number;
}

export interface Retention {
  readonly leftToRight: boolean;
  readonly rightToLeft: boolean;
}

export const STRONG: Retention = Object.freeze({ leftToRight: true, rightToLeft: false });
export const WEAK: Retention = Object.freeze({ leftToRight: false, rightToLeft: false });

export type ErrorCode =
  | "stale-node"
  | "retired-node"
  | "stale-relation"
  | "retired-relation"
  | "self-cursor"
  | "foreign-cursor"
  | "epoch-underflow"
  | "invalid-metadata";

export class ContractError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "ContractError";
    this.code = code;
  }
}

export interface NodeRecord {
  generation: number;
  state: SlotState;
  rooted: boolean;
  left: number[];
  right: number[];
}

export interface RelationRecord {
  generation: number;
  state: SlotState;
  left: NodeId;
  right: NodeId;
  retention: Retention;
  meta: number;
  /** Successor on each axis at the moment of unlink. Meaningful only while retired. */
  leftSuccessor: number | null;
  rightSuccessor: number | null;
}

export interface Stats {
  nodesBorn: number;
  nodesRetired: number;
  relationsBorn: number;
  relationsRetired: number;
}

export interface CollectReport {
  readonly collected: readonly NodeId[];
  readonly pruned: readonly RelationId[];
}

export interface SlotView {
  readonly slot: number;
  readonly generation: number;
  readonly state: SlotState;
}

export interface NodeView {
  readonly id: NodeId;
  readonly state: "live" | "retired";
  readonly rooted: boolean;
  readonly left: readonly RelationId[];
  readonly right: readonly RelationId[];
}

export interface RelationView {
  readonly id: RelationId;
  readonly state: "live" | "retired";
  readonly left: NodeId;
  readonly right: NodeId;
  readonly retention: Retention;
  readonly meta: number;
  readonly leftSuccessor: number | null;
  readonly rightSuccessor: number | null;
}

export interface Snapshot {
  readonly depth: number;
  readonly nodeSlots: readonly SlotView[];
  readonly relationSlots: readonly SlotView[];
  readonly freeNodeSlots: readonly number[];
  readonly freeRelationSlots: readonly number[];
  readonly nodes: readonly NodeView[];
  readonly relations: readonly RelationView[];
  readonly stats: Readonly<Stats>;
}

function at<T>(table: readonly T[], slot: number): T {
  const entry = table[slot];
  if (entry === undefined) throw new Error(`machine bug: no slot ${slot}`);
  return entry;
}

export class RelationMachine {
  protected readonly nodes: NodeRecord[] = [];
  protected readonly relations: RelationRecord[] = [];
  protected readonly freeNodes: number[] = [];
  protected readonly freeRelations: number[] = [];
  protected readonly retiredNodes: number[] = [];
  protected readonly retiredRelations: number[] = [];
  protected depth = 0;
  protected readonly counters: Stats = {
    nodesBorn: 0,
    nodesRetired: 0,
    relationsBorn: 0,
    relationsRetired: 0,
  };

  // ---- identity ------------------------------------------------------------

  node(): NodeId {
    const reused = this.takeSlot(this.freeNodes);
    this.counters.nodesBorn++;
    if (reused === undefined) {
      const slot = this.nodes.length;
      this.nodes.push({ generation: 0, state: "live", rooted: false, left: [], right: [] });
      return this.nodeHandle(slot);
    }
    const record = at(this.nodes, reused);
    record.generation = this.generationOnAllocate(record.generation);
    record.state = "live";
    record.rooted = false;
    record.left = [];
    record.right = [];
    return this.nodeHandle(reused);
  }

  status(id: NodeId | RelationId): Status {
    const record = id.kind === "node" ? this.nodes[id.slot] : this.relations[id.slot];
    if (record === undefined || record.generation !== id.generation || record.state === "free") {
      return "stale";
    }
    return record.state;
  }

  // ---- roots ---------------------------------------------------------------

  root(node: NodeId): void {
    this.liveNode(node).rooted = true;
  }

  unroot(node: NodeId): void {
    this.liveNode(node).rooted = false;
  }

  // ---- topology ------------------------------------------------------------

  /** Mints a new relation at the tail of both axes. Parallel relations are allowed. */
  relate(left: NodeId, right: NodeId, retention: Retention, meta = 0): RelationId {
    const leftRecord = this.liveNode(left);
    const rightRecord = this.liveNode(right);
    this.assertMeta(meta);
    const slot = this.allocateRelation(left, right, retention, meta);
    this.place("left", leftRecord.left, slot, leftRecord.left.length);
    this.place("right", rightRecord.right, slot, rightRecord.right.length);
    this.counters.relationsBorn++;
    return this.relationHandle(slot);
  }

  unlink(relation: RelationId): void {
    this.liveRelation(relation);
    this.prune(relation.slot);
    this.settle();
  }

  /** Moves a relation on one axis to just after `cursor`, or to the head when null. */
  moveAfter(axis: Axis, relation: RelationId, cursor: RelationId | null): void {
    this.validateMove(axis, relation, cursor);
    const record = at(this.relations, relation.slot);
    const list = at(this.nodes, this.endpoint(record, axis).slot)[axis];
    this.displace(axis, list, relation.slot);
    const index = cursor === null ? 0 : list.indexOf(cursor.slot) + 1;
    this.place(axis, list, relation.slot, index);
  }

  // ---- traversal -----------------------------------------------------------

  first(axis: Axis, node: NodeId): RelationId | null {
    const head = this.readableNode(node)[axis][0];
    return head === undefined ? null : this.relationHandle(head);
  }

  /**
   * Successor of a relation on one axis. A retired relation still answers until
   * quiescence: an in-flight walk resumes at the nearest live relation that
   * followed it.
   */
  next(axis: Axis, relation: RelationId): RelationId | null {
    const record = this.readableRelation(relation);
    if (record.state === "retired") return this.resolveContinuation(axis, record);
    const list = at(this.nodes, this.endpoint(record, axis).slot)[axis];
    return this.optionalHandle(this.successorIn(list, relation.slot));
  }

  left(relation: RelationId): NodeId {
    return this.readableRelation(relation).left;
  }

  right(relation: RelationId): NodeId {
    return this.readableRelation(relation).right;
  }

  retention(relation: RelationId): Retention {
    return this.readableRelation(relation).retention;
  }

  meta(relation: RelationId): number {
    return this.readableRelation(relation).meta;
  }

  setMeta(relation: RelationId, value: number): void {
    const record = this.liveRelation(relation);
    this.assertMeta(value);
    record.meta = value;
  }

  // ---- reclamation ---------------------------------------------------------

  enter(): void {
    this.depth++;
  }

  exit(): void {
    if (this.depth === 0) throw new ContractError("epoch-underflow", "exit without enter");
    this.depth--;
    this.settle();
  }

  // ---- reachability --------------------------------------------------------

  /** Retires unreachable nodes and prunes every relation that lost an endpoint. */
  collect(): CollectReport {
    const reachable = this.reachableSlots();
    const collected: NodeId[] = [];
    const dead = new Set<number>();
    this.nodes.forEach((record, slot) => {
      if (record.state === "live" && !reachable.has(slot)) {
        dead.add(slot);
        collected.push(this.nodeHandle(slot));
      }
    });

    const pruned: RelationId[] = [];
    this.relations.forEach((record, slot) => {
      if (record.state === "live" && (dead.has(record.left.slot) || dead.has(record.right.slot))) {
        pruned.push(this.relationHandle(slot));
        this.prune(slot);
      }
    });

    for (const slot of dead) {
      const record = at(this.nodes, slot);
      record.state = "retired";
      record.rooted = false;
      this.retiredNodes.push(slot);
      this.counters.nodesRetired++;
    }
    this.settle();
    return { collected, pruned };
  }

  // ---- inspection ----------------------------------------------------------

  snapshot(): Snapshot {
    const slotView = (record: NodeRecord | RelationRecord, slot: number): SlotView => ({
      slot,
      generation: record.generation,
      state: record.state,
    });
    const nodes: NodeView[] = [];
    this.nodes.forEach((record, slot) => {
      if (record.state === "free") return;
      nodes.push({
        id: this.nodeHandle(slot),
        state: record.state,
        rooted: record.rooted,
        left: record.left.map((s) => this.relationHandle(s)),
        right: record.right.map((s) => this.relationHandle(s)),
      });
    });
    const relations: RelationView[] = [];
    this.relations.forEach((record, slot) => {
      if (record.state === "free") return;
      relations.push({
        id: this.relationHandle(slot),
        state: record.state,
        left: record.left,
        right: record.right,
        retention: record.retention,
        meta: record.meta,
        leftSuccessor: record.leftSuccessor,
        rightSuccessor: record.rightSuccessor,
      });
    });
    return {
      depth: this.depth,
      nodeSlots: this.nodes.map(slotView),
      relationSlots: this.relations.map(slotView),
      freeNodeSlots: [...this.freeNodes],
      freeRelationSlots: [...this.freeRelations],
      nodes,
      relations,
      stats: { ...this.counters },
    };
  }

  // ---- ablation seams ------------------------------------------------------

  protected takeSlot(free: number[]): number | undefined {
    return free.pop();
  }

  protected generationOnAllocate(generation: number): number {
    return generation;
  }

  protected generationOnReclaim(generation: number): number {
    return generation + 1;
  }

  protected place(_axis: Axis, list: number[], slot: number, index: number): void {
    list.splice(index, 0, slot);
  }

  protected displace(_axis: Axis, list: number[], slot: number): void {
    const index = list.indexOf(slot);
    if (index >= 0) list.splice(index, 1);
  }

  /** Logically removes a live relation; its slot stays retired until reclaim. */
  protected prune(slot: number): void {
    const record = at(this.relations, slot);
    const leftList = at(this.nodes, record.left.slot).left;
    const rightList = at(this.nodes, record.right.slot).right;
    record.leftSuccessor = this.successorIn(leftList, slot);
    record.rightSuccessor = this.successorIn(rightList, slot);
    this.displace("left", leftList, slot);
    this.displace("right", rightList, slot);
    record.state = "retired";
    this.retiredRelations.push(slot);
    this.counters.relationsRetired++;
  }

  protected quiescent(): boolean {
    return this.depth === 0;
  }

  protected retains(record: RelationRecord, direction: Direction): boolean {
    return record.retention[direction];
  }

  protected resolveContinuation(axis: Axis, retired: RelationRecord): RelationId | null {
    let slot = this.frozenSuccessor(axis, retired);
    while (slot !== null) {
      const record = at(this.relations, slot);
      if (record.state === "live") return this.relationHandle(slot);
      slot = this.frozenSuccessor(axis, record);
    }
    return null;
  }

  protected reclaim(): void {
    for (const slot of this.retiredRelations) {
      const record = at(this.relations, slot);
      record.state = "free";
      record.generation = this.generationOnReclaim(record.generation);
      record.leftSuccessor = null;
      record.rightSuccessor = null;
      this.freeRelations.push(slot);
    }
    this.retiredRelations.length = 0;
    for (const slot of this.retiredNodes) {
      const record = at(this.nodes, slot);
      record.state = "free";
      record.generation = this.generationOnReclaim(record.generation);
      record.left = [];
      record.right = [];
      this.freeNodes.push(slot);
    }
    this.retiredNodes.length = 0;
  }

  protected validateMove(axis: Axis, relation: RelationId, cursor: RelationId | null): void {
    const record = this.liveRelation(relation);
    if (cursor === null) return;
    const cursorRecord = this.liveRelation(cursor);
    if (cursor.slot === relation.slot) {
      throw new ContractError("self-cursor", "a relation cannot move after itself");
    }
    if (this.endpoint(cursorRecord, axis).slot !== this.endpoint(record, axis).slot) {
      throw new ContractError("foreign-cursor", "cursor belongs to another adjacency");
    }
  }

  // ---- internals -----------------------------------------------------------

  protected nodeHandle(slot: number): NodeId {
    return { kind: "node", slot, generation: at(this.nodes, slot).generation };
  }

  protected relationHandle(slot: number): RelationId {
    return { kind: "relation", slot, generation: at(this.relations, slot).generation };
  }

  protected successorIn(list: readonly number[], slot: number): number | null {
    const index = list.indexOf(slot);
    return index < 0 ? null : (list[index + 1] ?? null);
  }

  private optionalHandle(slot: number | null): RelationId | null {
    return slot === null ? null : this.relationHandle(slot);
  }

  private endpoint(record: RelationRecord, axis: Axis): NodeId {
    return axis === "left" ? record.left : record.right;
  }

  private frozenSuccessor(axis: Axis, record: RelationRecord): number | null {
    return axis === "left" ? record.leftSuccessor : record.rightSuccessor;
  }

  private settle(): void {
    if (this.quiescent()) this.reclaim();
  }

  private allocateRelation(left: NodeId, right: NodeId, retention: Retention, meta: number): number {
    const fresh = {
      state: "live",
      left,
      right,
      retention,
      meta,
      leftSuccessor: null,
      rightSuccessor: null,
    } as const;
    const reused = this.takeSlot(this.freeRelations);
    if (reused === undefined) {
      this.relations.push({ generation: 0, ...fresh });
      return this.relations.length - 1;
    }
    const generation = this.generationOnAllocate(at(this.relations, reused).generation);
    this.relations[reused] = { generation, ...fresh };
    return reused;
  }

  private reachableSlots(): Set<number> {
    const reachable = new Set<number>();
    const pending: number[] = [];
    const visit = (slot: number): void => {
      if (!reachable.has(slot)) {
        reachable.add(slot);
        pending.push(slot);
      }
    };
    this.nodes.forEach((record, slot) => {
      if (record.state === "live" && record.rooted) visit(slot);
    });
    for (let slot = pending.pop(); slot !== undefined; slot = pending.pop()) {
      const record = at(this.nodes, slot);
      for (const e of record.left) {
        const relation = at(this.relations, e);
        if (this.retains(relation, "leftToRight")) visit(relation.right.slot);
      }
      for (const e of record.right) {
        const relation = at(this.relations, e);
        if (this.retains(relation, "rightToLeft")) visit(relation.left.slot);
      }
    }
    return reachable;
  }

  private assertMeta(value: number): void {
    if ((value | 0) !== value) {
      throw new ContractError("invalid-metadata", "metadata is one int32 word");
    }
  }

  private liveNode(id: NodeId): NodeRecord {
    const record = this.readableNode(id);
    if (record.state === "retired") throw new ContractError("retired-node", "node was collected");
    return record;
  }

  private readableNode(id: NodeId): NodeRecord {
    if (this.status(id) === "stale") throw new ContractError("stale-node", "stale node handle");
    return at(this.nodes, id.slot);
  }

  private liveRelation(id: RelationId): RelationRecord {
    const record = this.readableRelation(id);
    if (record.state === "retired") {
      throw new ContractError("retired-relation", "relation was unlinked");
    }
    return record;
  }

  private readableRelation(id: RelationId): RelationRecord {
    if (this.status(id) === "stale") {
      throw new ContractError("stale-relation", "stale relation handle");
    }
    return at(this.relations, id.slot);
  }
}

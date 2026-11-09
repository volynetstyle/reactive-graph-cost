// M5.0: records the operations a port issues against the store as a representation-neutral
// tape. Behaviour is that of RelationMachine. Not part of L0.
import { appendFileSync } from "node:fs";
import { RelationMachine, type Axis, type NodeId, type RelationId, type Retention } from "../machine.ts";

const lines: string[] = [];
const target = process.env["M5_TAPE"];

function flush(): void {
  if (target === undefined || lines.length === 0) return;
  appendFileSync(`${target}.${process.pid}.tape`, `${lines.join("\n")}\n`);
  lines.length = 0;
}

process.on("exit", flush);

export class TapeMachine extends RelationMachine {
  private nodeCount = 0;
  private relationCount = 0;
  private readonly nodeIds = new Map<string, number>();
  private readonly relationIds = new Map<string, number>();

  constructor() {
    super();
    this.log("P");
  }

  private log(line: string): void {
    lines.push(line);
    if (lines.length >= Number(process.env["M5_FLUSH"] ?? 50000)) flush();
  }

  private nodeOf(id: NodeId): number {
    return this.nodeIds.get(`${id.slot}:${id.generation}`)!;
  }

  private relationOf(id: RelationId): number {
    return this.relationIds.get(`${id.slot}:${id.generation}`)!;
  }

  override node(): NodeId {
    const id = super.node();
    this.nodeIds.set(`${id.slot}:${id.generation}`, this.nodeCount++);
    this.log("N");
    return id;
  }

  override relate(left: NodeId, right: NodeId, retention: Retention, meta = 0): RelationId {
    const id = super.relate(left, right, retention, meta);
    this.relationIds.set(`${id.slot}:${id.generation}`, this.relationCount++);
    this.log(`R ${this.nodeOf(left)} ${this.nodeOf(right)}`);
    return id;
  }

  override unlink(relation: RelationId): void {
    this.log(`U ${this.relationOf(relation)}`);
    super.unlink(relation);
  }

  override moveAfter(axis: Axis, relation: RelationId, cursor: RelationId | null): void {
    this.log(`M ${axis === "left" ? 0 : 1} ${this.relationOf(relation)} ${cursor === null ? -1 : this.relationOf(cursor)}`);
    super.moveAfter(axis, relation, cursor);
  }

  override first(axis: Axis, node: NodeId): RelationId | null {
    this.log(`F ${axis === "left" ? 0 : 1} ${this.nodeOf(node)}`);
    return super.first(axis, node);
  }

  override next(axis: Axis, relation: RelationId): RelationId | null {
    this.log(`X ${axis === "left" ? 0 : 1} ${this.relationOf(relation)}`);
    return super.next(axis, relation);
  }

  override left(relation: RelationId): NodeId {
    this.log(`E 0 ${this.relationOf(relation)}`);
    return super.left(relation);
  }

  override right(relation: RelationId): NodeId {
    this.log(`E 1 ${this.relationOf(relation)}`);
    return super.right(relation);
  }

  override enter(): void {
    this.log("B");
    super.enter();
  }

  override exit(): void {
    this.log("C");
    super.exit();
  }
}

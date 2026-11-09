// A history is a list of operations over labels: `n0`, `e1` name the handles a
// run has issued, in issue order. Labels are what make runs comparable across
// machines, because physical slots are free to differ.

import {
  ContractError,
  RelationMachine,
  STRONG,
  WEAK,
  type Axis,
  type NodeId,
  type RelationId,
  type Retention,
  type Snapshot,
  type Status,
} from "./machine.ts";

export type RetentionName = "strong" | "weak" | "reverse" | "mutual";

export const RETENTIONS: Readonly<Record<RetentionName, Retention>> = {
  strong: STRONG,
  weak: WEAK,
  reverse: { leftToRight: false, rightToLeft: true },
  mutual: { leftToRight: true, rightToLeft: true },
};

export type Op =
  | { readonly op: "node" }
  | { readonly op: "root"; readonly n: number }
  | { readonly op: "unroot"; readonly n: number }
  | {
      readonly op: "relate";
      readonly left: number;
      readonly right: number;
      readonly retention: RetentionName;
    }
  | { readonly op: "unlink"; readonly e: number }
  | {
      readonly op: "move";
      readonly axis: Axis;
      readonly e: number;
      readonly after: number | null;
    }
  | { readonly op: "setMeta"; readonly e: number; readonly value: number }
  | { readonly op: "enter" }
  | { readonly op: "exit" }
  | { readonly op: "collect" };

export type Outcome =
  | { readonly ok: true; readonly created?: RelationId }
  | { readonly ok: false; readonly code: string };

export interface Continuation {
  readonly relation: RelationId;
  readonly axis: Axis;
  readonly value: RelationId | null | string;
}

/** Everything the contract checker needs to see at one instant. */
export interface Frame {
  readonly snapshot: Snapshot;
  readonly nodeStatus: readonly Status[];
  readonly relationStatus: readonly Status[];
  readonly continuations: readonly Continuation[];
}

const OK: Outcome = { ok: true };
const AXES: readonly Axis[] = ["left", "right"];

function errorCode(error: unknown): string {
  return error instanceof ContractError ? error.code : "internal";
}

export class Run {
  readonly machine: RelationMachine;
  readonly nodes: NodeId[] = [];
  readonly relations: RelationId[] = [];

  constructor(machine: RelationMachine) {
    this.machine = machine;
  }

  apply(op: Op): Outcome {
    try {
      return this.dispatch(op);
    } catch (error) {
      return { ok: false, code: errorCode(error) };
    }
  }

  applyAll(ops: readonly Op[]): this {
    for (const op of ops) this.apply(op);
    return this;
  }

  frame(): Frame {
    const continuations: Continuation[] = [];
    for (const relation of this.relations) {
      if (this.machine.status(relation) !== "retired") continue;
      for (const axis of AXES) {
        continuations.push({ relation, axis, value: this.read(() => this.machine.next(axis, relation)) });
      }
    }
    return {
      snapshot: this.machine.snapshot(),
      nodeStatus: this.nodes.map((id) => this.machine.status(id)),
      relationStatus: this.relations.map((id) => this.machine.status(id)),
      continuations,
    };
  }

  /** Abstract state in labels only: no slots, no generations. */
  observe(outcome: Outcome): string {
    const { machine } = this;
    const labels = new Map<string, string>();
    this.nodes.forEach((id, i) => labels.set(handleKey(id), `n${i}`));
    this.relations.forEach((id, i) => labels.set(handleKey(id), `e${i}`));
    const label = (value: NodeId | RelationId | null | string): string | null => {
      if (value === null || typeof value === "string") return value;
      return labels.get(handleKey(value)) ?? "unissued";
    };
    const walk = (axis: Axis, node: NodeId): (string | null)[] => {
      const seen: (string | null)[] = [];
      let e = machine.first(axis, node);
      for (let guard = 0; e !== null && guard <= this.relations.length; guard++) {
        seen.push(label(e));
        e = machine.next(axis, e);
      }
      return seen;
    };
    const stats = machine.snapshot().stats;
    return JSON.stringify({
      outcome: outcome.ok ? "ok" : outcome.code,
      stats,
      nodes: this.nodes.map((id) => {
        const status = machine.status(id);
        if (status === "stale") return status;
        const rooted = machine.snapshot().nodes.find((n) => handleKey(n.id) === handleKey(id))?.rooted;
        return { status, rooted, left: walk("left", id), right: walk("right", id) };
      }),
      relations: this.relations.map((id) => {
        const status = machine.status(id);
        if (status === "stale") return status;
        return {
          status,
          left: label(this.read(() => machine.left(id))),
          right: label(this.read(() => machine.right(id))),
          retention: machine.retention(id),
          meta: machine.meta(id),
          nextLeft: label(this.read(() => machine.next("left", id))),
          nextRight: label(this.read(() => machine.next("right", id))),
        };
      }),
    });
  }

  private read<T>(probe: () => T): T | string {
    try {
      return probe();
    } catch (error) {
      return `error:${errorCode(error)}`;
    }
  }

  private dispatch(op: Op): Outcome {
    const { machine } = this;
    switch (op.op) {
      case "node":
        this.nodes.push(machine.node());
        return OK;
      case "root":
        machine.root(this.node(op.n));
        return OK;
      case "unroot":
        machine.unroot(this.node(op.n));
        return OK;
      case "relate": {
        const created = machine.relate(this.node(op.left), this.node(op.right), RETENTIONS[op.retention]);
        this.relations.push(created);
        return { ok: true, created };
      }
      case "unlink":
        machine.unlink(this.relation(op.e));
        return OK;
      case "move":
        machine.moveAfter(op.axis, this.relation(op.e), op.after === null ? null : this.relation(op.after));
        return OK;
      case "setMeta":
        machine.setMeta(this.relation(op.e), op.value);
        return OK;
      case "enter":
        machine.enter();
        return OK;
      case "exit":
        machine.exit();
        return OK;
      case "collect":
        machine.collect();
        return OK;
    }
  }

  private node(label: number): NodeId {
    const id = this.nodes[label];
    if (id === undefined) throw new Error(`history bug: no node n${label}`);
    return id;
  }

  private relation(label: number): RelationId {
    const id = this.relations[label];
    if (id === undefined) throw new Error(`history bug: no relation e${label}`);
    return id;
  }
}

export function handleKey(id: NodeId | RelationId): string {
  return `${id.kind[0]}${id.slot}:${id.generation}`;
}

export function formatHistory(ops: readonly Op[]): string {
  let nodes = 0;
  let relations = 0;
  const after = (label: number | null): string => (label === null ? "head" : `e${label}`);
  return ops
    .map((op) => {
      switch (op.op) {
        case "node":
          return `n${nodes++}=node`;
        case "root":
        case "unroot":
          return `${op.op}(n${op.n})`;
        case "relate":
          return `e${relations++}=relate(n${op.left},n${op.right},${op.retention})`;
        case "unlink":
          return `unlink(e${op.e})`;
        case "move":
          return `move(${op.axis},e${op.e},${after(op.after)})`;
        case "setMeta":
          return `setMeta(e${op.e},${op.value})`;
        default:
          return op.op;
      }
    })
    .join("; ");
}

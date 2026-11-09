// Breadth-first search over the product of the reference machine and a
// candidate. Because the search is breadth-first over every history within the
// bounds, a witness it returns is a shortest one, and `exhausted: true` means
// every reachable product state within the bounds was checked.

import { checkedApply, type Violation } from "./contract.ts";
import { RelationMachine, type Axis, type Snapshot } from "./machine.ts";
import { Run, type Op, type RetentionName } from "./run.ts";

export interface Bounds {
  readonly maxNodes: number;
  readonly maxRelations: number;
  readonly maxEpochDepth: number;
  readonly maxLength: number;
}

export interface Witness {
  readonly ops: readonly Op[];
  readonly violations: readonly Violation[];
  readonly diverged: boolean;
}

export interface SearchResult {
  readonly witness: Witness | null;
  readonly statesExplored: number;
  readonly exhausted: boolean;
}

/** Large enough for every ablation's shortest witness; not meant to be exhausted. */
export const WITNESS_BOUNDS: Bounds = { maxNodes: 2, maxRelations: 3, maxEpochDepth: 2, maxLength: 12 };

/** Exercises two nodes and nested epochs, but a free list never holds two slots at an allocation. */
export const WIDE_BOUNDS: Bounds = { maxNodes: 2, maxRelations: 2, maxEpochDepth: 2, maxLength: 64 };

/** Three relations on one node: the smallest space where slot-selection policy has a choice. */
export const DEEP_BOUNDS: Bounds = { maxNodes: 1, maxRelations: 3, maxEpochDepth: 1, maxLength: 64 };

const AXES: readonly Axis[] = ["left", "right"];
const RETENTION_ALPHABET: readonly RetentionName[] = ["strong", "weak"];

function* candidates(run: Run, bounds: Bounds): Generator<Op> {
  const nodes = run.nodes.length;
  const relations = run.relations.length;
  const { depth } = run.machine.snapshot();

  if (nodes < bounds.maxNodes) yield { op: "node" };
  for (let n = 0; n < nodes; n++) {
    yield { op: "root", n };
    yield { op: "unroot", n };
  }
  if (relations < bounds.maxRelations) {
    for (let left = 0; left < nodes; left++) {
      for (let right = 0; right < nodes; right++) {
        for (const retention of RETENTION_ALPHABET) yield { op: "relate", left, right, retention };
      }
    }
  }
  for (let e = 0; e < relations; e++) {
    yield { op: "unlink", e };
    yield { op: "setMeta", e, value: 1 };
    for (const axis of AXES) {
      yield { op: "move", axis, e, after: null };
      for (let after = 0; after < relations; after++) yield { op: "move", axis, e, after };
    }
  }
  if (depth < bounds.maxEpochDepth) yield { op: "enter" };
  yield { op: "exit" };
  yield { op: "collect" };
}

function physical(run: Run): unknown {
  const { stats: _stats, ...state }: Snapshot = run.machine.snapshot();
  return [state, run.nodes, run.relations];
}

export function search(make: () => RelationMachine, bounds: Bounds): SearchResult {
  const replay = (ops: readonly Op[], factory: () => RelationMachine): Run =>
    new Run(factory()).applyAll(ops);
  const reference = (): RelationMachine => new RelationMachine();
  const visited = new Set<string>();
  let frontier: (readonly Op[])[] = [[]];

  for (let length = 0; length < bounds.maxLength; length++) {
    const next: (readonly Op[])[] = [];
    for (const history of frontier) {
      for (const op of candidates(replay(history, reference), bounds)) {
        const base = replay(history, reference);
        const candidate = replay(history, make);
        const baseOutcome = base.apply(op);
        const { outcome, violations } = checkedApply(candidate, op);
        const diverged = base.observe(baseOutcome) !== candidate.observe(outcome);
        const ops = [...history, op];
        if (violations.length > 0 || diverged) {
          return { witness: { ops, violations, diverged }, statesExplored: visited.size, exhausted: false };
        }
        const signature = JSON.stringify([physical(base), physical(candidate)]);
        if (!visited.has(signature)) {
          visited.add(signature);
          next.push(ops);
        }
      }
    }
    if (next.length === 0) return { witness: null, statesExplored: visited.size, exhausted: true };
    frontier = next;
  }
  return { witness: null, statesExplored: visited.size, exhausted: false };
}

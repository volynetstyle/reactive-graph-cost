// Seeded random histories with every contract clause checked after every
// operation, and walks kept open across the mutations that retire their
// positions.

import { describe, expect, it } from "vitest";
import { ABLATIONS, CONTROLS } from "../reference/ablations.ts";
import { checkedApply, type Violation } from "../reference/contract.ts";
import { RelationMachine, type Axis, type NodeId, type RelationId } from "../reference/machine.ts";
import { Run, handleKey, type Op, type RetentionName } from "../reference/run.ts";

const SEEDS = 150;
const OPS_PER_SEED = 300;
const MAX_NODES = 10;

const RETENTIONS: readonly RetentionName[] = ["strong", "weak", "reverse", "mutual"];
const AXES: readonly Axis[] = ["left", "right"];

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Walker {
  readonly axis: Axis;
  readonly anchor: NodeId;
  readonly initial: readonly RelationId[];
  readonly visited: RelationId[];
  current: RelationId | null;
  disturbed: boolean;
}

interface Coverage {
  collectedNodes: number;
  successfulMoves: number;
  walksCompleted: number;
  undisturbedWalks: number;
  resumedFromRetired: number;
}

function emptyCoverage(): Coverage {
  return { collectedNodes: 0, successfulMoves: 0, walksCompleted: 0, undisturbedWalks: 0, resumedFromRetired: 0 };
}

function fuzz(seed: number, coverage: Coverage, make: () => RelationMachine = () => new RelationMachine()): void {
  const random = rng(seed);
  const run = new Run(make());
  const { machine } = run;
  const walkers: Walker[] = [];
  const int = (bound: number): number => Math.floor(random() * bound);

  const assertClean = (violations: readonly Violation[], op: string): void => {
    expect(violations, `seed ${seed}, ${op}`).toEqual([]);
  };
  const apply = (op: Op): boolean => {
    const { outcome, violations } = checkedApply(run, op);
    assertClean(violations, JSON.stringify(op));
    return outcome.ok;
  };
  /** Mostly a handle that still works, sometimes any handle ever issued. */
  const pickLabel = (ids: readonly (NodeId | RelationId)[]): number | null => {
    if (ids.length === 0) return null;
    if (random() < 0.1) return int(ids.length);
    const usable = ids.flatMap((id, label) => (machine.status(id) === "live" ? [label] : []));
    return usable.length === 0 ? int(ids.length) : (usable[int(usable.length)] as number);
  };

  const finish = (walker: Walker): void => {
    if (!walker.disturbed) {
      const alive = (id: RelationId): boolean => machine.status(id) === "live";
      const start = new Set(walker.initial.map(handleKey));
      const seen = walker.visited.filter((id) => start.has(handleKey(id)) && alive(id)).map(handleKey);
      const expected = walker.initial.filter(alive).map(handleKey);
      expect(seen, `seed ${seed}: walk lost or repeated a stable relation`).toEqual(expected);
      coverage.undisturbedWalks++;
    }
    coverage.walksCompleted++;
    walkers.splice(walkers.indexOf(walker), 1);
    apply({ op: "exit" });
  };

  const step = (walker: Walker): void => {
    const { current, axis, anchor } = walker;
    if (current === null) {
      finish(walker);
      return;
    }
    if (machine.status(current) === "retired") coverage.resumedFromRetired++;
    const next = machine.next(axis, current);
    if (next !== null) {
      expect(machine.status(next), `seed ${seed}: a walk reached a dead relation`).toBe("live");
      expect(handleKey(machine[axis](next)), `seed ${seed}: a walk left its adjacency`).toBe(handleKey(anchor));
      walker.visited.push(next);
    }
    walker.current = next;
  };

  const startWalk = (): void => {
    const label = pickLabel(run.nodes);
    if (label === null) return;
    const anchor = run.nodes[label] as NodeId;
    if (machine.status(anchor) !== "live") return;
    const axis = AXES[int(2)] as Axis;
    apply({ op: "enter" });
    const initial: RelationId[] = [];
    for (let e = machine.first(axis, anchor); e !== null; e = machine.next(axis, e)) initial.push(e);
    const current = machine.first(axis, anchor);
    walkers.push({ axis, anchor, initial, visited: current === null ? [] : [current], current, disturbed: false });
  };

  const move = (): void => {
    const e = pickLabel(run.relations);
    if (e === null) return;
    const axis = AXES[int(2)] as Axis;
    const after = random() < 0.25 ? null : pickLabel(run.relations);
    if (!apply({ op: "move", axis, e, after })) return;
    coverage.successfulMoves++;
    const moved = run.relations[e] as RelationId;
    const anchor = handleKey(machine[axis](moved));
    for (const walker of walkers) {
      if (walker.axis === axis && handleKey(walker.anchor) === anchor) walker.disturbed = true;
    }
  };

  for (let i = 0; i < OPS_PER_SEED; i++) {
    const roll = random();
    if (roll < 0.06 && run.nodes.length < MAX_NODES) {
      apply({ op: "node" });
    } else if (roll < 0.1 || run.nodes.length === 0) {
      if (run.nodes.length === 0) apply({ op: "node" });
      else {
        const n = pickLabel(run.nodes) as number;
        apply({ op: random() < 0.6 ? "root" : "unroot", n });
      }
    } else if (roll < 0.35) {
      const left = pickLabel(run.nodes) as number;
      const right = pickLabel(run.nodes) as number;
      apply({ op: "relate", left, right, retention: RETENTIONS[int(4)] as RetentionName });
    } else if (roll < 0.55) {
      move();
    } else if (roll < 0.68) {
      const e = pickLabel(run.relations);
      if (e !== null) apply({ op: "unlink", e });
    } else if (roll < 0.72) {
      const e = pickLabel(run.relations);
      if (e !== null) apply({ op: "setMeta", e, value: int(1000) });
    } else if (roll < 0.76) {
      coverage.collectedNodes -= machine.snapshot().stats.nodesRetired;
      apply({ op: "collect" });
      coverage.collectedNodes += machine.snapshot().stats.nodesRetired;
    } else if (roll < 0.79) {
      apply({ op: "enter" });
    } else if (roll < 0.82) {
      if (machine.snapshot().depth > walkers.length) apply({ op: "exit" });
    } else if (roll < 0.87) {
      startWalk();
    } else if (walkers.length > 0) {
      step(walkers[int(walkers.length)] as Walker);
    }
  }

  while (walkers.length > 0) step(walkers[walkers.length - 1] as Walker);
  while (machine.snapshot().depth > 0) apply({ op: "exit" });
  expect(machine.snapshot().relations.filter((r) => r.state === "retired")).toEqual([]);
}

describe("fuzz", () => {
  it(`holds every clause over ${SEEDS} seeds of ${OPS_PER_SEED} operations`, () => {
    const coverage = emptyCoverage();
    for (let seed = 1; seed <= SEEDS; seed++) fuzz(seed, coverage);

    expect(coverage.collectedNodes).toBeGreaterThan(100);
    expect(coverage.successfulMoves).toBeGreaterThan(1000);
    expect(coverage.walksCompleted).toBeGreaterThan(100);
    expect(coverage.undisturbedWalks).toBeGreaterThan(50);
    expect(coverage.resumedFromRetired).toBeGreaterThan(10);
  });

  it.each(ABLATIONS.map((a) => [a.id, a] as const))("catches %s", (_id, ablation) => {
    // Every assertion in the fuzzer names its seed, so a crash in the harness
    // itself does not count as detection.
    expect(() => {
      for (let seed = 1; seed <= SEEDS; seed++) fuzz(seed, emptyCoverage(), ablation.make);
    }).toThrow(/seed \d+/);
  });

  it.each(CONTROLS.map((c) => [c.id, c] as const))("accepts control %s", (_id, control) => {
    for (let seed = 1; seed <= 30; seed++) fuzz(seed, emptyCoverage(), control.make);
  });
});

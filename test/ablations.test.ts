import { describe, expect, it } from "vitest";
import { ABLATIONS, CONTROLS } from "../reference/ablations.ts";
import { RelationMachine } from "../reference/machine.ts";
import { Run, type Op } from "../reference/run.ts";
import { WITNESS_BOUNDS, search, type Bounds } from "../reference/search.ts";

/** Shortest witness length per ablation. Keep in step with research/WITNESSES.md. */
const EXPECTED_LENGTH: Readonly<Record<string, number>> = {
  "no-generation": 3,
  "one-bit-generation": 6,
  "no-ordering": 4,
  "unordered-right": 4,
  "no-stable-identity": 3,
  "no-reverse-incidence": 2,
  "no-deferred-reuse": 3,
  "inner-exit-reclaims": 5,
  "no-continuation": 5,
  "no-retirement-chain": 5,
  "no-weak-direction": 5,
  "no-prune": 3,
  "forced-uniqueness": 3,
  "no-metadata": 3,
};

const SMALL: Bounds = { maxNodes: 1, maxRelations: 2, maxEpochDepth: 1, maxLength: 64 };

describe("ablations", () => {
  it.each(ABLATIONS.map((a) => [a.id, a] as const))("%s has a witness", (id, ablation) => {
    const { witness } = search(ablation.make, WITNESS_BOUNDS);
    expect(witness).not.toBeNull();
    expect(witness?.ops).toHaveLength(EXPECTED_LENGTH[id] as number);
    expect(witness?.violations.map((v) => v.clause)).toContain(ablation.clause);
  });
});

describe("bounded exhaustive checks", () => {
  it("finds no contract violation in the reference machine", () => {
    const result = search(() => new RelationMachine(), SMALL);
    expect(result.witness).toBeNull();
    expect(result.exhausted).toBe(true);
  });

  it.each(CONTROLS.map((c) => [c.id, c] as const))("control %s is indistinguishable", (_id, control) => {
    const result = search(control.make, SMALL);
    expect(result.witness).toBeNull();
    expect(result.exhausted).toBe(true);
  });
});

describe("controls are not vacuous", () => {
  const reuse: readonly Op[] = [
    { op: "node" },
    { op: "relate", left: 0, right: 0, retention: "weak" },
    { op: "relate", left: 0, right: 0, retention: "weak" },
    { op: "unlink", e: 0 },
    { op: "unlink", e: 1 },
    { op: "relate", left: 0, right: 0, retention: "weak" },
  ];

  it("fifo-freelist picks a different physical slot with the same observations", () => {
    const fifo = CONTROLS.find((c) => c.id === "fifo-freelist");
    const base = new Run(new RelationMachine()).applyAll(reuse);
    const candidate = new Run((fifo as NonNullable<typeof fifo>).make()).applyAll(reuse);

    expect(candidate.relations[2]?.slot).not.toBe(base.relations[2]?.slot);
    expect(candidate.observe({ ok: true })).toBe(base.observe({ ok: true }));
  });

  it("generation-at-allocate stores different generations with the same observations", () => {
    const control = CONTROLS.find((c) => c.id === "generation-at-allocate");
    const history = reuse.slice(0, 4);
    const base = new Run(new RelationMachine()).applyAll(history);
    const candidate = new Run((control as NonNullable<typeof control>).make()).applyAll(history);

    const slot = base.relations[0]?.slot as number;
    expect(candidate.machine.snapshot().relationSlots[slot]?.generation).not.toBe(
      base.machine.snapshot().relationSlots[slot]?.generation,
    );
    expect(candidate.observe({ ok: true })).toBe(base.observe({ ok: true }));
  });
});

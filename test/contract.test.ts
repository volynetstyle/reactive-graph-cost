import { describe, expect, it } from "vitest";
import { checkedApply } from "../reference/contract.ts";
import { ContractError, RelationMachine, STRONG, WEAK, type Axis, type NodeId, type RelationId } from "../reference/machine.ts";
import { Run, type Op } from "../reference/run.ts";

function order(machine: RelationMachine, axis: Axis, node: NodeId): RelationId[] {
  const out: RelationId[] = [];
  for (let e = machine.first(axis, node); e !== null; e = machine.next(axis, e)) out.push(e);
  return out;
}

function code(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof ContractError) return error.code;
    throw error;
  }
  return "no error";
}

describe("reachability", () => {
  it("keeps exactly what the retention rules reach", () => {
    const m = new RelationMachine();
    const [a, b, c] = [m.node(), m.node(), m.node()];
    m.root(a);
    m.relate(a, b, STRONG);
    m.relate(b, c, WEAK);

    const report = m.collect();

    expect(report.collected).toEqual([c]);
    expect([m.status(a), m.status(b), m.status(c)]).toEqual(["live", "live", "stale"]);
  });

  it("lets a consumer retain its producer", () => {
    const m = new RelationMachine();
    const [consumer, producer] = [m.node(), m.node()];
    m.root(consumer);
    m.relate(consumer, producer, STRONG);
    m.collect();
    expect(m.status(producer)).toBe("live");
  });

  it("does not let a producer retain its consumer", () => {
    const m = new RelationMachine();
    const [consumer, producer] = [m.node(), m.node()];
    m.root(producer);
    const e = m.relate(consumer, producer, STRONG);

    m.collect();

    expect(m.status(consumer)).toBe("stale");
    expect(m.status(e)).toBe("stale");
    expect(m.first("right", producer)).toBeNull();
  });

  it("collects an unrooted cycle of strong relations", () => {
    const m = new RelationMachine();
    const [a, b] = [m.node(), m.node()];
    m.relate(a, b, STRONG);
    m.relate(b, a, STRONG);
    expect(m.collect().collected).toHaveLength(2);
  });

  it("honours retention in the right-to-left direction", () => {
    const m = new RelationMachine();
    const [a, b] = [m.node(), m.node()];
    m.root(b);
    m.relate(a, b, { leftToRight: false, rightToLeft: true });
    m.collect();
    expect(m.status(a)).toBe("live");
  });

  it("preserves the order of survivors when pruning", () => {
    const m = new RelationMachine();
    const hub = m.node();
    const others = [m.node(), m.node(), m.node(), m.node()];
    m.root(hub);
    const relations = others.map((node) => m.relate(hub, node, WEAK));
    m.root(others[0]!);
    m.root(others[2]!);

    m.collect();

    expect(order(m, "left", hub)).toEqual([relations[0], relations[2]]);
  });
});

describe("stable identity", () => {
  it("reorders [A,B,C,D] to [D,A,B,C] with no allocation or retirement", () => {
    const m = new RelationMachine();
    const consumer = m.node();
    const deps = [m.node(), m.node(), m.node(), m.node()].map((p) => m.relate(consumer, p, STRONG));
    const [a, b, c, d] = deps as [RelationId, RelationId, RelationId, RelationId];
    const before = m.snapshot().stats;

    m.moveAfter("left", d, null);

    expect(order(m, "left", consumer)).toEqual([d, a, b, c]);
    expect(m.snapshot().stats).toEqual(before);
    for (const e of deps) expect(m.status(e)).toBe("live");
  });

  it("charges exactly |added| births and |removed| retirements for a trace change", () => {
    const m = new RelationMachine();
    const consumer = m.node();
    const [a, b, c, d] = [m.node(), m.node(), m.node(), m.node()];
    const ea = m.relate(consumer, a, STRONG);
    m.relate(consumer, b, STRONG);
    m.relate(consumer, c, STRONG);
    const before = m.snapshot().stats;

    m.unlink(ea);
    m.relate(consumer, d, STRONG);

    const after = m.snapshot().stats;
    expect(after.relationsBorn - before.relationsBorn).toBe(1);
    expect(after.relationsRetired - before.relationsRetired).toBe(1);
  });

  it("moves on one axis without touching the other", () => {
    const m = new RelationMachine();
    const [c1, c2, p] = [m.node(), m.node(), m.node()];
    const e1 = m.relate(c1, p, STRONG);
    const e2 = m.relate(c2, p, STRONG);
    const e3 = m.relate(c1, c2, STRONG);

    m.moveAfter("right", e2, null);

    expect(order(m, "right", p)).toEqual([e2, e1]);
    expect(order(m, "left", c1)).toEqual([e1, e3]);
  });

  it("detects a handle to a reused slot", () => {
    const m = new RelationMachine();
    const [a, b] = [m.node(), m.node()];
    const old = m.relate(a, b, STRONG);
    m.unlink(old);

    const fresh = m.relate(a, b, STRONG);

    expect(fresh.slot).toBe(old.slot);
    expect(m.status(old)).toBe("stale");
    expect(m.status(fresh)).toBe("live");
    expect(code(() => m.next("left", old))).toBe("stale-relation");
  });

  it("allows parallel relations between one pair", () => {
    const m = new RelationMachine();
    const [a, b] = [m.node(), m.node()];
    expect(m.relate(a, b, STRONG)).not.toEqual(m.relate(a, b, STRONG));
    expect(order(m, "left", a)).toHaveLength(2);
  });
});

describe("deferred reclamation", () => {
  function chain(): { m: RelationMachine; node: NodeId; e: [RelationId, RelationId, RelationId] } {
    const m = new RelationMachine();
    const node = m.node();
    m.root(node);
    const e: [RelationId, RelationId, RelationId] = [
      m.relate(node, node, WEAK),
      m.relate(node, node, WEAK),
      m.relate(node, node, WEAK),
    ];
    return { m, node, e };
  }

  it("keeps an unlinked relation readable until the outermost exit", () => {
    const { m, node, e } = chain();
    m.enter();
    m.enter();
    m.unlink(e[0]);

    expect(m.status(e[0])).toBe("retired");
    expect(m.left(e[0])).toEqual(node);
    m.exit();
    expect(m.status(e[0])).toBe("retired");
    m.exit();
    expect(m.status(e[0])).toBe("stale");
  });

  it("does not reuse a retired slot inside an epoch", () => {
    const { m, node, e } = chain();
    m.enter();
    m.unlink(e[0]);
    expect(m.relate(node, node, WEAK).slot).not.toBe(e[0].slot);
  });

  it("resumes a walk from a retired relation at the next live one", () => {
    const { m, e } = chain();
    m.enter();
    m.unlink(e[0]);
    expect(m.next("left", e[0])).toEqual(e[1]);
  });

  it("resumes through a chain of retired successors", () => {
    const { m, e } = chain();
    m.enter();
    m.unlink(e[1]);
    m.unlink(e[0]);
    expect(m.next("left", e[0])).toEqual(e[2]);
    m.unlink(e[2]);
    expect(m.next("left", e[0])).toBeNull();
  });

  it("survives a collection that prunes the relation under a walk", () => {
    const m = new RelationMachine();
    const hub = m.node();
    const [dead, kept] = [m.node(), m.node()];
    m.root(hub);
    m.root(kept);
    const e0 = m.relate(hub, dead, WEAK);
    const e1 = m.relate(hub, kept, WEAK);

    m.enter();
    m.collect();

    expect(m.status(e0)).toBe("retired");
    expect(m.next("left", e0)).toEqual(e1);
    m.exit();
    expect(m.status(e0)).toBe("stale");
  });

  it("may skip a relation when a retired relation's successor moves past it", () => {
    const { m, e } = chain();
    m.enter();
    m.unlink(e[0]);
    m.moveAfter("left", e[1], e[2]);

    // e[2] stayed live and in place, yet the walk resumes past it. The contract
    // promises in-order coverage only when no move touches the adjacency.
    expect(m.next("left", e[0])).toEqual(e[1]);
    expect(m.next("left", e[1])).toBeNull();
  });

  it("reclaims immediately when no epoch is open", () => {
    const { m, e } = chain();
    m.unlink(e[0]);
    expect(m.status(e[0])).toBe("stale");
  });
});

describe("failure", () => {
  it.each<[string, Op[], Op, string]>([
    ["stale relation", [{ op: "node" }, { op: "relate", left: 0, right: 0, retention: "weak" }, { op: "unlink", e: 0 }], { op: "unlink", e: 0 }, "stale-relation"],
    ["retired relation", [{ op: "node" }, { op: "relate", left: 0, right: 0, retention: "weak" }, { op: "enter" }, { op: "unlink", e: 0 }], { op: "move", axis: "left", e: 0, after: null }, "retired-relation"],
    ["stale node", [{ op: "node" }, { op: "collect" }], { op: "root", n: 0 }, "stale-node"],
    ["retired node", [{ op: "node" }, { op: "enter" }, { op: "collect" }], { op: "root", n: 0 }, "retired-node"],
    ["self cursor", [{ op: "node" }, { op: "relate", left: 0, right: 0, retention: "weak" }], { op: "move", axis: "left", e: 0, after: 0 }, "self-cursor"],
    ["foreign cursor", [{ op: "node" }, { op: "node" }, { op: "relate", left: 0, right: 0, retention: "weak" }, { op: "relate", left: 1, right: 1, retention: "weak" }], { op: "move", axis: "left", e: 0, after: 1 }, "foreign-cursor"],
    ["epoch underflow", [], { op: "exit" }, "epoch-underflow"],
    ["non-int32 metadata", [{ op: "node" }, { op: "relate", left: 0, right: 0, retention: "weak" }], { op: "setMeta", e: 0, value: 1.5 }, "invalid-metadata"],
  ])("rejects %s and changes nothing", (_name, setup, op, expected) => {
    const run = new Run(new RelationMachine()).applyAll(setup);
    const { outcome, violations } = checkedApply(run, op);
    expect(outcome).toEqual({ ok: false, code: expected });
    expect(violations).toEqual([]);
  });
});

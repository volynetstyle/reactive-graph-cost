// The executable form of CONTRACT.md. It reads snapshots only and shares no
// logic with the machine: reachability here is the naive Kleene iteration of
// the contract's formula, not the machine's worklist.

import type { Axis, NodeId, NodeView, RelationId, RelationView, Snapshot, Status } from "./machine.ts";
import { handleKey, type Frame, type Op, type Outcome, type Run } from "./run.ts";

export type Clause =
  | "identity"
  | "dual-incidence"
  | "order"
  | "permutation"
  | "reachability"
  | "gc-transparency"
  | "deferred-reuse"
  | "continuation"
  | "metadata"
  | "multiplicity"
  | "failure-atomicity"
  | "lifecycle";

export interface Violation {
  readonly clause: Clause;
  readonly detail: string;
}

export interface Step {
  readonly op: Op;
  readonly outcome: Outcome;
  readonly before: Frame;
  readonly after: Frame;
  /** Handles the run has issued, so that labels in `op` can be resolved. */
  readonly relations: readonly RelationId[];
}

type Fail = (clause: Clause, detail: string) => void;

const AXES: readonly Axis[] = ["left", "right"];
const RANK: Readonly<Record<Status, number>> = { live: 0, retired: 1, stale: 2 };

const anchorOf = (relation: RelationView, axis: Axis): NodeId =>
  axis === "left" ? relation.left : relation.right;

const successorOf = (relation: RelationView, axis: Axis): number | null =>
  axis === "left" ? relation.leftSuccessor : relation.rightSuccessor;

function byKey<T extends { readonly id: NodeId | RelationId }>(views: readonly T[]): Map<string, T> {
  return new Map(views.map((view) => [handleKey(view.id), view]));
}

function issued(step: Step, label: number): RelationId {
  const id = step.relations[label];
  if (id === undefined) throw new Error(`history bug: no relation e${label}`);
  return id;
}

/** lfp of L = roots ∪ { v | u∈L, ρ(u→v) } ∪ { u | v∈L, ρ(v→u) }. */
export function leastFixedPoint(snapshot: Snapshot): Set<string> {
  const live = new Set(
    snapshot.nodes.filter((n) => n.state === "live" && n.rooted).map((n) => handleKey(n.id)),
  );
  const edges = snapshot.relations.filter((r) => r.state === "live");
  for (let changed = true; changed; ) {
    changed = false;
    for (const edge of edges) {
      const left = handleKey(edge.left);
      const right = handleKey(edge.right);
      if (edge.retention.leftToRight && live.has(left) && !live.has(right)) {
        live.add(right);
        changed = true;
      }
      if (edge.retention.rightToLeft && live.has(right) && !live.has(left)) {
        live.add(left);
        changed = true;
      }
    }
  }
  return live;
}

export function checkState(snapshot: Snapshot): Violation[] {
  const out: Violation[] = [];
  const fail: Fail = (clause, detail) => {
    out.push({ clause, detail });
  };

  const checkPartition = (name: string, slots: Snapshot["nodeSlots"], free: readonly number[]): void => {
    const freeSet = new Set(free);
    if (freeSet.size !== free.length) fail("lifecycle", `${name}: duplicate free slot`);
    for (const { slot, state } of slots) {
      if ((state === "free") !== freeSet.has(slot)) fail("lifecycle", `${name}: slot ${slot} is ${state}`);
    }
  };
  checkPartition("nodes", snapshot.nodeSlots, snapshot.freeNodeSlots);
  checkPartition("relations", snapshot.relationSlots, snapshot.freeRelationSlots);

  if (snapshot.depth === 0) {
    const retired = [...snapshot.nodes, ...snapshot.relations].filter((v) => v.state === "retired");
    if (retired.length > 0) fail("deferred-reuse", "retired storage survives quiescence");
  }

  const nodes = byKey(snapshot.nodes);
  const relations = byKey(snapshot.relations);
  const occurrences = (list: readonly RelationId[], id: RelationId): number =>
    list.filter((e) => handleKey(e) === handleKey(id)).length;

  for (const relation of snapshot.relations) {
    if (relation.state === "retired") {
      for (const successor of [relation.leftSuccessor, relation.rightSuccessor]) {
        if (successor !== null && snapshot.relationSlots[successor]?.state === "free") {
          fail("continuation", `${handleKey(relation.id)} points at free slot ${successor}`);
        }
      }
      continue;
    }
    const left = nodes.get(handleKey(relation.left));
    const right = nodes.get(handleKey(relation.right));
    if (left?.state !== "live" || right?.state !== "live") {
      fail("gc-transparency", `${handleKey(relation.id)} has a dead endpoint`);
      continue;
    }
    if (occurrences(left.left, relation.id) !== 1 || occurrences(right.right, relation.id) !== 1) {
      fail("dual-incidence", `${handleKey(relation.id)} is not on exactly one list per axis`);
    }
  }

  for (const node of snapshot.nodes) {
    if (node.state === "retired") {
      if (node.left.length > 0 || node.right.length > 0) {
        fail("gc-transparency", `retired ${handleKey(node.id)} keeps incidences`);
      }
      if (node.rooted) fail("lifecycle", `retired ${handleKey(node.id)} is rooted`);
    }
    for (const axis of AXES) {
      for (const id of node[axis]) {
        const relation = relations.get(handleKey(id));
        if (relation?.state !== "live" || handleKey(anchorOf(relation, axis)) !== handleKey(node.id)) {
          fail("dual-incidence", `${handleKey(node.id)}.${axis} lists foreign ${handleKey(id)}`);
        }
      }
    }
  }
  return out;
}

function checkStatuses(step: Step, fail: Fail): void {
  const { op, outcome, before, after } = step;
  const compare = (
    name: string,
    pre: readonly Status[],
    post: readonly Status[],
    mayDie: (label: number) => boolean,
  ): void => {
    pre.forEach((status, label) => {
      const next = post[label];
      if (next === undefined) return;
      if (RANK[next] < RANK[status]) fail("identity", `${name}${label}: ${status} became ${next}`);
      if (status === "live" && next !== "live" && !mayDie(label)) {
        fail("lifecycle", `${name}${label} died during ${op.op}`);
      }
      if (status !== "stale" && next === "stale" && after.snapshot.depth !== 0) {
        fail("deferred-reuse", `${name}${label} went stale inside an epoch`);
      }
    });
  };
  compare("n", before.nodeStatus, after.nodeStatus, () => outcome.ok && op.op === "collect");
  compare(
    "e",
    before.relationStatus,
    after.relationStatus,
    (label) => outcome.ok && (op.op === "collect" || (op.op === "unlink" && op.e === label)),
  );
}

function checkOrder(step: Step, fail: Fail): void {
  const { op, outcome, before, after } = step;
  const prior = byKey(before.snapshot.nodes);
  const current = byKey(after.snapshot.nodes);
  const moved = op.op === "move" && outcome.ok ? handleKey(issued(step, op.e)) : null;
  const movedAxis = op.op === "move" ? op.axis : null;

  for (const node of after.snapshot.nodes) {
    const pre = prior.get(handleKey(node.id));
    if (pre === undefined) continue;
    for (const axis of AXES) {
      const exempt = axis === movedAxis ? moved : null;
      const before_ = pre[axis].map(handleKey);
      const after_ = node[axis].map(handleKey);
      const shared = new Set(before_.filter((k) => after_.includes(k) && k !== exempt));
      const a = before_.filter((k) => shared.has(k)).join();
      const b = after_.filter((k) => shared.has(k)).join();
      if (a !== b) fail("order", `${handleKey(node.id)}.${axis}: [${a}] became [${b}]`);
    }
  }

  if (op.op === "move" && outcome.ok) {
    const view = byKey(after.snapshot.relations).get(handleKey(issued(step, op.e)));
    if (view === undefined) return;
    const list = current.get(handleKey(anchorOf(view, op.axis)))?.[op.axis].map(handleKey) ?? [];
    const index = list.indexOf(handleKey(view.id));
    const expected = op.after === null ? 0 : list.indexOf(handleKey(issued(step, op.after))) + 1;
    if (index !== expected) fail("order", `moved relation is at ${index}, expected ${expected}`);
  }

  if (op.op === "relate" && outcome.ok && outcome.created !== undefined) {
    const view = byKey(after.snapshot.relations).get(handleKey(outcome.created));
    if (view === undefined) return;
    for (const axis of AXES) {
      const list = current.get(handleKey(anchorOf(view, axis)))?.[axis] ?? [];
      const tail = list[list.length - 1];
      if (tail === undefined || handleKey(tail) !== handleKey(view.id)) {
        fail("order", `new relation is not at the ${axis} tail`);
      }
    }
  }
}

function checkPermutation(step: Step, fail: Fail): void {
  const { op, outcome, before, after } = step;
  if (op.op !== "move" || !outcome.ok) return;
  if (JSON.stringify(before.snapshot.stats) !== JSON.stringify(after.snapshot.stats)) {
    fail("permutation", "a move allocated or retired storage");
  }
  if (before.relationStatus.join() !== after.relationStatus.join()) {
    fail("permutation", "a move changed relation identity");
  }
  const other: Axis = op.axis === "left" ? "right" : "left";
  const post = byKey(after.snapshot.nodes);
  for (const node of before.snapshot.nodes) {
    const next: NodeView | undefined = post.get(handleKey(node.id));
    if (next === undefined || node[other].map(handleKey).join() !== next[other].map(handleKey).join()) {
      fail("permutation", `a move on ${op.axis} touched the ${other} axis of ${handleKey(node.id)}`);
    }
    if (next !== undefined && [...node[op.axis].map(handleKey)].sort().join() !== [...next[op.axis].map(handleKey)].sort().join()) {
      fail("permutation", `a move changed the membership of ${handleKey(node.id)}`);
    }
  }
}

function checkReachability(step: Step, fail: Fail): void {
  const { op, outcome, before, after } = step;
  if (op.op !== "collect" || !outcome.ok) return;
  const expected = leastFixedPoint(before.snapshot);
  const live = new Set(after.snapshot.nodes.filter((n) => n.state === "live").map((n) => handleKey(n.id)));
  const wrong = [...new Set([...expected, ...live])].filter((k) => expected.has(k) !== live.has(k));
  if (wrong.length > 0) fail("reachability", `live set differs from the fixed point on ${wrong}`);

  const survivors = byKey(after.snapshot.relations);
  for (const relation of before.snapshot.relations) {
    if (relation.state !== "live") continue;
    const kept = expected.has(handleKey(relation.left)) && expected.has(handleKey(relation.right));
    if (kept && survivors.get(handleKey(relation.id))?.state !== "live") {
      fail("reachability", `${handleKey(relation.id)} was pruned between live endpoints`);
    }
  }
}

function checkContinuations(step: Step, fail: Fail): void {
  const { op, before, after } = step;
  const views = byKey(after.snapshot.relations);
  const bySlot = new Map(after.snapshot.relations.map((r) => [r.id.slot, r]));

  for (const { relation, axis, value } of after.continuations) {
    const start = views.get(handleKey(relation));
    if (start === undefined) {
      fail("continuation", `retired ${handleKey(relation)} has no record`);
      continue;
    }
    let cursor = successorOf(start, axis);
    let resolved: RelationView | null = null;
    while (cursor !== null) {
      const target = bySlot.get(cursor);
      if (target === undefined) break;
      if (target.state === "live") {
        resolved = target;
        break;
      }
      cursor = successorOf(target, axis);
    }
    const expected = resolved === null ? null : handleKey(resolved.id);
    const actual = value === null || typeof value === "string" ? value : handleKey(value);
    if (expected !== actual) {
      fail("continuation", `next(${axis}, ${handleKey(relation)}) = ${actual}, expected ${expected}`);
    }
    if (resolved !== null && handleKey(anchorOf(resolved, axis)) !== handleKey(anchorOf(start, axis))) {
      fail("continuation", `continuation of ${handleKey(relation)} left its adjacency`);
    }
  }

  // A relation retired by this step, whether by unlink or by pruning, must
  // resume at the first relation after it that survived the step.
  const priorRelations = byKey(before.snapshot.relations);
  const priorNodes = byKey(before.snapshot.nodes);
  for (const { relation, axis, value } of after.continuations) {
    const key = handleKey(relation);
    const pre = priorRelations.get(key);
    if (pre?.state !== "live") continue;
    const list = (priorNodes.get(handleKey(anchorOf(pre, axis)))?.[axis] ?? []).map(handleKey);
    const survivor = list.slice(list.indexOf(key) + 1).find((k) => views.get(k)?.state === "live") ?? null;
    const actual = value === null || typeof value === "string" ? value : handleKey(value);
    if (actual !== survivor) {
      fail("continuation", `${op.op} left next(${axis}, ${key}) = ${actual}, expected ${survivor}`);
    }
  }
}

function checkPayload(step: Step, fail: Fail): void {
  const { op, outcome, before, after } = step;
  const post = byKey(after.snapshot.relations);
  const target = op.op === "setMeta" && outcome.ok ? handleKey(issued(step, op.e)) : null;
  for (const relation of before.snapshot.relations) {
    const key = handleKey(relation.id);
    const next = post.get(key);
    if (next === undefined) continue;
    if (handleKey(relation.left) !== handleKey(next.left) || handleKey(relation.right) !== handleKey(next.right)) {
      fail("identity", `${key} changed endpoints`);
    }
    if (JSON.stringify(relation.retention) !== JSON.stringify(next.retention)) {
      fail("identity", `${key} changed retention`);
    }
    if (key !== target && relation.meta !== next.meta) fail("metadata", `${key} metadata changed`);
  }
  if (op.op === "setMeta" && target !== null && post.get(target)?.meta !== op.value) {
    fail("metadata", `metadata of ${target} did not round-trip`);
  }
}

function checkMultiplicity(step: Step, fail: Fail): void {
  const { op, outcome, before, after } = step;
  if (op.op !== "relate" || !outcome.ok || outcome.created === undefined) return;
  const key = handleKey(outcome.created);
  if (before.snapshot.relations.some((r) => handleKey(r.id) === key)) {
    fail("multiplicity", `relate returned the existing relation ${key}`);
  }
  if (after.snapshot.stats.relationsBorn !== before.snapshot.stats.relationsBorn + 1) {
    fail("multiplicity", "relate did not mint exactly one relation");
  }
}

export function checkStep(step: Step): Violation[] {
  const out: Violation[] = [];
  const fail: Fail = (clause, detail) => {
    out.push({ clause, detail });
  };
  const { outcome, before, after } = step;

  if (!outcome.ok) {
    if (outcome.code === "internal") fail("failure-atomicity", "operation failed outside the contract");
    if (JSON.stringify(before.snapshot) !== JSON.stringify(after.snapshot)) {
      fail("failure-atomicity", `failed ${step.op.op} changed state`);
    }
  }
  checkStatuses(step, fail);
  checkOrder(step, fail);
  checkPermutation(step, fail);
  checkReachability(step, fail);
  checkContinuations(step, fail);
  checkPayload(step, fail);
  checkMultiplicity(step, fail);
  return out;
}

export interface CheckedOutcome {
  readonly outcome: Outcome;
  readonly violations: readonly Violation[];
}

/** Applies one operation and checks every contract clause across it. */
export function checkedApply(run: Run, op: Op): CheckedOutcome {
  const before = run.frame();
  const outcome = run.apply(op);
  const after = run.frame();
  const violations = [
    ...checkState(after.snapshot),
    ...checkStep({ op, outcome, before, after, relations: run.relations }),
  ];
  return { outcome, violations };
}

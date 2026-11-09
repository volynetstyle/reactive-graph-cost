// M4B: a hand port of Salsa's memoization and validation, for the in-scope subject.
// B1 keeps every trace in client arrays and uses no Relation Store at all.
// B4 is the counterexample: validation walks the old trace from its end.
// B2 is B1 with each trace on the store's left axis. A re-execution unlinks the old relations
// and relates new ones. No reuse, no moveAfter, no reverse walk, no metadata.
// B3-C and B3-L reuse entries across executions by one plain hash lookup per dependency, the
// same logical algorithm over client entries and over store relations.
import { RelationMachine, WEAK, type NodeId, type RelationId } from "../../../reference/machine.ts";

export interface Step {
  when?: { cell: number; eq: number };
  cell?: number;
  query?: number;
}

export interface Query {
  steps: Step[];
  modulo?: number;
}

export interface Op {
  kind: "set" | "get";
  i: number;
  v?: number;
}

export interface ProgramSpec {
  name: string;
  cells: number;
  queries: Query[];
  ops: Op[];
}

export type Variant = "b1" | "b2" | "b3c" | "b3l" | "b3d" | "b4";

/** A dependency, by value: a cell is its index, a query is ~index. */
type Edge = number;

interface Memo {
  value: number;
  trace: Edge[];
  changedAt: number;
  verifiedAt: number;
  low: boolean;
}

export const counters = {
  executions: 0,
  traceEntries: 0,
  validationSteps: 0,
  duplicateReads: 0,
  readsRecorded: 0,
  relates: 0,
  unlinks: 0,
  leftWalkSteps: 0,
  births: 0,
  deaths: 0,
  reuses: 0,
  lookups: 0,
  moveAfterCalls: 0,
  clientPositionWrites: 0,
  sumPeakReuseMapEntries: 0,
  // Per-program peaks, summed over the corpus.
  sumPeakLiveEntries: 0,
  sumPeakTraceContainers: 0,
  sumPeakStoreNodes: 0,
};

/** M5.0: receives one tape line per trace and per validation. */
export const hooks: { emit: ((line: string) => void) | null } = { emit: null };

export function resetCounters(): void {
  for (const key of Object.keys(counters) as (keyof typeof counters)[]) counters[key] = 0;
}

export function execute(program: ProgramSpec, variant: Variant): string[] {
  const log: string[] = [];
  const values = new Array<number>(program.cells).fill(0);
  const cellChanged = new Array<number>(program.cells).fill(1);
  const memos: (Memo | undefined)[] = program.queries.map(() => undefined);
  let revision = 1;
  const store = variant === "b2" || variant === "b3l" || variant === "b3d" ? new RelationMachine() : null;
  const reuse = new Map<number, Map<Edge, RelationId | true>>();
  let mapEntries = 0;
  let peakMapEntries = 0;

  /** Shared bookkeeping of reuse: which entries survive, are born, and die. */
  function classify(q: number, trace: Edge[]): { old: Map<Edge, RelationId | true>; next: Map<Edge, RelationId | true> } {
    const old = reuse.get(q) ?? new Map<Edge, RelationId | true>();
    const next = new Map<Edge, RelationId | true>();
    mapEntries += trace.length - old.size;
    reuse.set(q, next);
    peakMapEntries = Math.max(peakMapEntries, mapEntries);
    return { old, next };
  }

  function reconcileClient(q: number, trace: Edge[], previous: Edge[]): void {
    const { old, next } = classify(q, trace);
    trace.forEach((edge, i) => {
      counters.lookups++;
      if (old.has(edge)) counters.reuses++;
      else counters.births++;
      next.set(edge, true);
      if (previous[i] !== edge) counters.clientPositionWrites++;
    });
    for (const edge of old.keys()) if (!next.has(edge)) counters.deaths++;
  }

  function reconcileStore(q: number, trace: Edge[]): void {
    const owner = queryNodes[q]!;
    const { old, next } = classify(q, trace);
    // B3-D: the finished trace is known, so unread relations can go before the pass.
    if (variant === "b3d") {
      const wanted = new Set(trace);
      for (const [edge, relation] of old) {
        if (wanted.has(edge)) continue;
        counters.deaths++;
        counters.unlinks++;
        live--;
        store!.unlink(relation as RelationId);
        old.delete(edge);
      }
    }
    let cursor: RelationId | null = null;
    for (const edge of trace) {
      counters.lookups++;
      const found = old.get(edge) as RelationId | undefined;
      let relation: RelationId;
      if (found !== undefined) {
        counters.reuses++;
        relation = found;
      } else {
        counters.births++;
        counters.relates++;
        live++;
        relation = store!.relate(owner, edge >= 0 ? cellNodes[edge]! : queryNodes[~edge]!, WEAK);
      }
      const expected: RelationId | null = cursor === null ? store!.first("left", owner) : store!.next("left", cursor);
      counters.leftWalkSteps++;
      if (expected === null || expected.slot !== relation.slot || expected.generation !== relation.generation) {
        counters.moveAfterCalls++;
        store!.moveAfter("left", relation, cursor);
      }
      next.set(edge, relation);
      cursor = relation;
    }
    for (const [edge, relation] of variant === "b3d" ? [] : old) {
      if (next.has(edge)) continue;
      counters.deaths++;
      counters.unlinks++;
      live--;
      store!.unlink(relation as RelationId);
    }
  }

  const cellNodes: NodeId[] = store === null ? [] : values.map(() => store.node());
  const queryNodes: NodeId[] = store === null ? [] : program.queries.map(() => store.node());
  const edgeOfSlot = new Map<number, Edge>();
  cellNodes.forEach((n, c) => edgeOfSlot.set(n.slot, c));
  queryNodes.forEach((n, q) => edgeOfSlot.set(n.slot, ~q));
  let live = 0;
  const peak = { live: 0, containers: 0 };

  function storeTrace(q: number, trace: Edge[]): void {
    const owner = queryNodes[q]!;
    for (let e = store!.first("left", owner); e !== null; e = store!.first("left", owner)) {
      counters.unlinks++;
      live--;
      store!.unlink(e);
    }
    for (const edge of trace) {
      counters.relates++;
      live++;
      store!.relate(owner, edge >= 0 ? cellNodes[edge]! : queryNodes[~edge]!, WEAK);
    }
  }

  /** Stops at the first dependency for which the callback returns true. */
  function anyEdge(q: number, memo: Memo, test: (edge: Edge) => boolean): boolean {
    if (store === null) {
      const edges = variant === "b4" ? [...memo.trace].reverse() : memo.trace;
      return edges.some(test);
    }
    for (let e = store.first("left", queryNodes[q]!); e !== null; e = store.next("left", e)) {
      counters.leftWalkSteps++;
      if (test(edgeOfSlot.get(store.right(e).slot)!)) return true;
    }
    return false;
  }

  function run(q: number): Memo {
    log.push(`execute:q${q}`);
    counters.executions++;
    const seen = new Set<Edge>();
    const trace: Edge[] = [];
    let changedAt = 0;
    let low = false;

    const record = (edge: Edge, at: number, isLow: boolean): void => {
      changedAt = Math.max(changedAt, at);
      counters.readsRecorded++;
      low ||= isLow;
      // active_query.rs:129: a read of NEVER_CHANGE durability is not recorded.
      if (!isLow) return;
      if (seen.has(edge)) {
        counters.duplicateReads++;
        return;
      }
      seen.add(edge);
      trace.push(edge);
    };
    const readCell = (c: number): number => {
      record(c, cellChanged[c]!, true);
      return values[c]!;
    };
    const readQuery = (d: number): number => {
      const memo = refresh(d);
      record(~d, memo.changedAt, memo.low);
      return memo.value;
    };

    const spec = program.queries[q]!;
    let sum = 0;
    for (const step of spec.steps) {
      if (step.when !== undefined && readCell(step.when.cell) !== step.when.eq) continue;
      if (step.cell !== undefined) sum += readCell(step.cell);
      if (step.query !== undefined) sum += readQuery(step.query);
    }
    const value = spec.modulo === undefined ? sum : ((sum % spec.modulo) + spec.modulo) % spec.modulo;
    const old = memos[q];
    // backdate.rs: an equal result keeps its old changedAt, unless durability dropped.
    if (old !== undefined && old.value === value && !(low && !old.low)) changedAt = old.changedAt;
    counters.traceEntries += trace.length;
    hooks.emit?.(`T ${program.cells + q} ${trace.map((e) => (e >= 0 ? e : program.cells + ~e)).join(" ")}`);
    if (variant === "b3l" || variant === "b3d") reconcileStore(q, trace);
    else if (store !== null) storeTrace(q, trace);
    else {
      if (variant === "b3c") reconcileClient(q, trace, old?.trace ?? []);
      live += trace.length - (old?.trace.length ?? 0);
    }
    const memo = { value, trace: store === null ? trace : [], changedAt, verifiedAt: revision, low };
    memos[q] = memo;
    return memo;
  }

  function deepVerify(q: number, memo: Memo): boolean {
    const since = memo.verifiedAt;
    let steps = 0;
    const clean = !anyEdge(q, memo, (edge) => {
      counters.validationSteps++;
      steps++;
      return edge >= 0 ? cellChanged[edge]! > since : maybeChangedAfter(~edge, since);
    });
    hooks.emit?.(`V ${program.cells + q} ${steps}`);
    return clean;
  }

  /** A memo with only constant inputs passes the durability shortcut. */
  function validated(q: number, memo: Memo): boolean {
    if (memo.low && !deepVerify(q, memo)) return false;
    memo.verifiedAt = revision;
    log.push(`validate:q${q}`);
    return true;
  }

  function maybeChangedAfter(q: number, since: number): boolean {
    let memo = memos[q]!;
    if (memo.verifiedAt !== revision && !validated(q, memo)) memo = run(q);
    return memo.changedAt > since;
  }

  function refresh(q: number): Memo {
    const memo = memos[q];
    if (memo === undefined) return run(q);
    if (memo.verifiedAt === revision || validated(q, memo)) return memo;
    return run(q);
  }

  for (const op of program.ops) {
    if (op.kind === "set") {
      revision++;
      values[op.i] = op.v!;
      cellChanged[op.i] = revision;
      log.push(`set:c${op.i}=${op.v}`);
    } else {
      log.push(`get:q${op.i}=${refresh(op.i).value}`);
    }
    peak.live = Math.max(peak.live, live);
    peak.containers = Math.max(peak.containers, memos.filter((m) => m !== undefined).length);
  }
  counters.sumPeakLiveEntries += peak.live;
  counters.sumPeakReuseMapEntries += peakMapEntries;
  counters.sumPeakTraceContainers += store === null ? peak.containers : 0;
  counters.sumPeakStoreNodes += store === null ? 0 : cellNodes.length + queryNodes.length;
  return log;
}

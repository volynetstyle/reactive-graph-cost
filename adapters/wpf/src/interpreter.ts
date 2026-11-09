// Runs the oracle's JSON programs over the port and writes the same log as Program.cs.
import { SubscriptionStore, type DeliveryRecord, type NodeId } from "./backend.ts";
import { WeakEventCore, type EventHost, type WeakEventBackend } from "./manager.ts";
import { CopyOnWriteCore } from "./manager-s1.ts";

import { StoreAdjacencyCore } from "./manager-s2.ts";
import { accounting } from "./accounting.ts";

export type Variant = "s0" | "s1" | "s1-nosub" | "s2" | "s2-next" | "s2-log";

export interface Op {
  kind: string;
  s?: number;
  l?: number;
  h?: number;
}

export interface Rule {
  l: number;
  h?: number;
  when: number;
  ops: Op[];
}

export interface ProgramSpec {
  name: string;
  sources: number;
  listeners: number;
  rules?: Rule[];
  ops: Op[];
}

export function execute(program: ProgramSpec, variant: Variant = "s0"): string[] {
  const log: string[] = [];
  const store = new SubscriptionStore();
  const staticSource = store.node();
  store.hold(staticSource);
  const allSources = Array.from({ length: program.sources }, () => store.node());
  const allListeners = Array.from({ length: program.listeners }, () => store.node());
  const sources: (NodeId | null)[] = [...allSources];
  const listeners: (NodeId | null)[] = [...allListeners];
  for (const node of [...allSources, ...allListeners]) store.hold(node);

  const nameOf = (s: NodeId): string => {
    if (s.slot === staticSource.slot) return "static";
    return `s${allSources.findIndex((n) => n.slot === s.slot)}`;
  };
  const deliveries = new Map<string, number>();

  const host: EventHost = {
    startListening: (s) => log.push(`subscribe:${nameOf(s)}`),
    stopListening: (s) => log.push(`unsubscribe:${nameOf(s)}`),
    deliver: (record: DeliveryRecord, s: NodeId) => {
      const l = allListeners.findIndex((n) => n.slot === record.target.slot);
      const h = record.handler.method;
      log.push(`deliver:l${l}.h${h}<${nameOf(s)}`);
      const key = `${l}.${h}`;
      const count = deliveries.get(key) ?? 0;
      deliveries.set(key, count + 1);
      for (const rule of program.rules ?? []) {
        if (rule.l === l && (rule.h ?? 0) === h && rule.when === count) runAll(rule.ops);
      }
    },
  };
  const core: WeakEventBackend =
    variant === "s1" ? new CopyOnWriteCore(store, host)
    : variant === "s1-nosub" ? new CopyOnWriteCore(store, host, false)
    : variant === "s2" ? new StoreAdjacencyCore(store, host, "epoch")
    : variant === "s2-next" ? new StoreAdjacencyCore(store, host, "next")
    : variant === "s2-log" ? new StoreAdjacencyCore(store, host, "log")
    : new WeakEventCore(store, host);
  const peak = { entries: 0, versions: 0, membership: 0, retention: 0, retired: 0, total: 0 };
  const retiredReadsAtStart = accounting.retiredReads;

  function sample(): void {
    const c = core.clientState();
    const s = store.stateCounts();
    peak.entries = Math.max(peak.entries, c.entries);
    peak.versions = Math.max(peak.versions, c.versions);
    peak.membership = Math.max(peak.membership, s.membership);
    peak.retention = Math.max(peak.retention, s.retention);
    peak.retired = Math.max(peak.retired, s.retired);
    peak.total = Math.max(peak.total, c.entries + c.versions + s.membership + s.retention + s.retired);
  }

  const sourceName = (s: number): string => (s < 0 ? "static" : `s${s}`);

  function subscription(op: Op, verb: "add" | "remove"): void {
    const s = op.s ?? 0;
    const l = op.l ?? 0;
    const h = op.h ?? 0;
    log.push(`${verb}:l${l}.h${h}>${sourceName(s)}`);
    const target = listeners[l] ?? null;
    if (target === null) {
      log.push("skipped");
      return;
    }
    const source = s < 0 ? staticSource : (sources[s] ?? null);
    if (source === null) {
      log.push("skipped");
      return;
    }
    if (verb === "add") core.add(source, s < 0, target, h);
    else core.remove(source, target, h);
  }

  function raise(s: number): void {
    log.push(`raise:${sourceName(s)}`);
    const source = s < 0 ? staticSource : (sources[s] ?? null);
    if (source !== null) {
      // The sender stays live in the frames of DeliverEvent for the whole delivery.
      store.hold(source);
      try {
        core.deliver(source);
      } finally {
        store.release(source);
      }
    }
    log.push(`raised:${sourceName(s)}`);
  }

  function probe(): void {
    const part = (nodes: NodeId[], prefix: string): string => nodes.map((n, i) => `${prefix}${i}=${store.isLive(n) ? 1 : 0}`).join(",");
    log.push(`alive:${part(allSources, "s")};${part(allListeners, "l")}`);
  }

  function execOp(op: Op): void {
    switch (op.kind) {
      case "add":
      case "remove":
        subscription(op, op.kind);
        break;
      case "raise":
        raise(op.s ?? 0);
        break;
      case "dropListener": {
        const l = op.l ?? 0;
        const node = listeners[l] ?? null;
        if (node !== null) store.release(node);
        listeners[l] = null;
        log.push(`drop:l${l}`);
        break;
      }
      case "dropSource": {
        const s = op.s ?? 0;
        const node = sources[s] ?? null;
        if (node !== null) store.release(node);
        sources[s] = null;
        log.push(`drop:s${s}`);
        break;
      }
      case "collect":
        core.beforeCollect?.();
        store.collect();
        core.afterCollect();
        log.push("collect");
        break;
      case "probe":
        probe();
        break;
      case "pump":
        core.pump();
        log.push("pump");
        break;
      case "forcePurge":
        log.push(`forcePurge=${core.purge() ? "True" : "False"}`);
        break;
      default:
        throw new Error(`unknown op ${op.kind}`);
    }
  }

  function runAll(ops: Op[]): void {
    for (const op of ops) {
      execOp(op);
      sample();
    }
  }

  runAll(program.ops);
  accounting.sumPeakClientEntries += peak.entries;
  accounting.sumPeakClientVersions += peak.versions;
  accounting.sumPeakStoreMembership += peak.membership;
  accounting.sumPeakStoreRetention += peak.retention;
  accounting.sumPeakStoreRetired += peak.retired;
  accounting.sumPeakTotal += peak.total;
  if (accounting.retiredReads > retiredReadsAtStart) accounting.programsWithRetiredRead++;
  return log;
}

// M4A.6 variant S1: client-side copy-on-write membership versions, literally as
// WeakEventManager.cs does it. Only the snapshot mechanism differs from S0, and observable
// behaviour, frozen defects included, must not.
//
// A delivery reads the version current when it began, without copying. A write to a version
// in use clones it once and publishes the clone; later writes change the clone in place.
// A version also owns its retention relations, so its lifetime bounds its handlers'.
//
// Dead entries are real records here, so S1 has no stale count and no use for afterCollect.
import { accounting } from "./accounting.ts";
import type { DeliveryRecord, HandlerRecord, NodeId, RelationId, SubscriptionStore } from "./backend.ts";
import type { ClientState, EventHost, WeakEventBackend } from "./manager.ts";

interface Held {
  readonly record: HandlerRecord;
  readonly retention: RelationId;
}

type CwtValue = { readonly kind: "single"; readonly held: Held } | { readonly kind: "list"; readonly held: Held[] };

interface Listener extends DeliveryRecord {
  readonly relation: RelationId | null;
  staleCounted: boolean;
}

class ListVersion {
  listeners: Listener[] = [];
  users = 0;
  current = true;
  released = false;
  readonly cwt = new Map<string, CwtValue>();
}

interface Entry {
  readonly source: NodeId;
  list: ListVersion;
}

/** M5.0: receives one tape line per membership operation. */
export const hooks: { emit: ((line: string) => void) | null } = { emit: null };

const keyOf = (node: NodeId): string => `${node.slot}:${node.generation}`;

export class CopyOnWriteCore implements WeakEventBackend {
  private readonly store: SubscriptionStore;
  private readonly host: EventHost;
  private readonly table = new Map<number, Entry>();
  private orphan: ListVersion | null = null;
  private cleanupRequests = 0;
  private cleanupPending = false;
  private deliveryDepth = 0;
  private liveVersions = 0;
  private readonly withSubscriptions: boolean;
  private readonly versions = new Set<ListVersion>();

  constructor(store: SubscriptionStore, host: EventHost, withSubscriptions = true) {
    this.store = store;
    this.host = host;
    this.withSubscriptions = withSubscriptions;
  }

  clientState(): ClientState {
    let entries = 0;
    for (const version of this.versions) entries += version.listeners.length;
    return { entries, versions: this.versions.size };
  }

  private newVersion(): ListVersion {
    accounting.versionsCreated++;
    accounting.maxSimultaneousVersions = Math.max(accounting.maxSimultaneousVersions, ++this.liveVersions);
    const version = new ListVersion();
    this.versions.add(version);
    return version;
  }

  private holdHandler(list: ListVersion, target: NodeId, record: HandlerRecord): void {
    const key = keyOf(target);
    const value = list.cwt.get(key);
    const held = { record, retention: this.store.retain(target, record) };

    if (value === undefined) list.cwt.set(key, { kind: "single", held });
    else if (value.kind === "single") list.cwt.set(key, { kind: "list", held: [value.held, held] });
    else value.held.push(held);
  }

  private releaseHandler(list: ListVersion, target: NodeId, method: number): void {
    const key = keyOf(target);
    const value = list.cwt.get(key);

    if (value === undefined) return;
    if (value.kind === "single") {
      if (value.held.record.method !== method) accounting.handlersLostToFastPath++;
      this.store.dropRetention(value.held.retention);
      list.cwt.delete(key);
      return;
    }
    const at = value.held.findIndex((h) => h.record.method === method);
    if (at >= 0) {
      this.store.dropRetention(value.held[at]!.retention);
      value.held.splice(at, 1);
    }
    if (value.held.length === 0) list.cwt.delete(key);
  }

  private releaseVersion(list: ListVersion): void {
    if (list.released) return;
    list.released = true;
    this.versions.delete(list);
    this.liveVersions--;
    for (const value of list.cwt.values()) {
      for (const held of value.kind === "single" ? [value.held] : value.held) this.store.dropRetention(held.retention);
    }
    list.cwt.clear();
  }

  private retire(list: ListVersion): void {
    list.current = false;
    if (list.users === 0) this.releaseVersion(list);
  }

  /** CopyTo. `publish` is false only for the defect's orphan, which leaves the real list alone. */
  private copyOf(list: ListVersion, publish: boolean): ListVersion {
    const next = this.newVersion();

    for (const listener of list.listeners) {
      const targetAlive = this.store.isLive(listener.target);
      if (targetAlive && this.store.isLive(listener.handler.node)) {
        next.listeners.push(listener);
        this.holdHandler(next, listener.target, listener.handler);
      } else if (publish) {
        accounting.deadEntriesDroppedDuringClone++;
        if (targetAlive) {
          accounting.zombiesDroppedByClone++;
          if (listener.relation !== null) this.store.dropSubscription(listener.relation);
        } else {
          accounting.staleDroppedByClone++;
        }
      }
    }
    return next;
  }

  /** PrepareForWriting. */
  private prepareForWriting(entry: Entry): void {
    hooks.emit?.(`W ${entry.source.slot}`);
    if (this.deliveryDepth > 0) accounting.writesDuringDelivery++;
    if (entry.list.users === 0) return;
    accounting.writesCausingClone++;
    accounting.entriesCopied += entry.list.listeners.length;
    accounting.wpfCloneEntries += entry.list.listeners.length;
    const before = entry.list.listeners;
    const next = this.copyOf(entry.list, true);
    for (let i = before.length - 1; i >= 0; i--) if (!next.listeners.includes(before[i]!)) hooks.emit?.(`D ${entry.source.slot} ${i}`);
    this.retire(entry.list);
    entry.list = next;
  }

  add(source: NodeId, isStatic: boolean, target: NodeId, method: number): void {
    let entry = this.table.get(source.slot);

    if (entry === undefined) {
      entry = { source, list: this.newVersion() };
      this.table.set(source.slot, entry);
      this.host.startListening(source);
    }
    const record = this.store.newHandler(method);

    if (isStatic && entry.list.users > 0) {
      // WeakEventManager.cs:279: a frozen defect, kept so that only the mechanism changes.
      accounting.lostStaticAdds++;
      accounting.orphanEntriesCopied += entry.list.listeners.length;
      const orphan = this.copyOf(entry.list, false);
      this.holdHandler(orphan, target, record);
      if (this.orphan !== null) this.retire(this.orphan);
      this.orphan = orphan;
      this.scheduleCleanup();
      return;
    }
    this.prepareForWriting(entry);
    hooks.emit?.(`A ${source.slot} ${target.slot}`);
    const relation = this.withSubscriptions ? this.store.subscribe(target, source, record) : null;
    entry.list.listeners.push({ relation, target, handler: record, staleCounted: false });
    this.holdHandler(entry.list, target, record);
    this.scheduleCleanup();
  }

  remove(source: NodeId, target: NodeId, method: number): void {
    const entry = this.table.get(source.slot);

    if (entry === undefined) return;
    this.prepareForWriting(entry);
    const listeners = entry.list.listeners;
    for (let i = listeners.length - 1; i >= 0; i--) {
      const listener = listeners[i]!;
      const sameTarget = listener.target.slot === target.slot && listener.target.generation === target.generation;
      if (sameTarget && listener.handler.method === method && this.store.isLive(listener.handler.node)) {
        if (listener.relation !== null) this.store.dropSubscription(listener.relation);
        hooks.emit?.(`D ${source.slot} ${i}`);
        listeners.splice(i, 1);
        break;
      }
    }
    this.releaseHandler(entry.list, target, method);
    if (listeners.length === 0) {
      this.table.delete(source.slot);
      this.retire(entry.list);
      this.host.stopListening(source);
    }
  }

  deliver(source: NodeId): void {
    const entry = this.table.get(source.slot);

    if (entry === undefined) return;
    accounting.deliveries++;
    if (this.deliveryDepth > 0) accounting.nestedDeliveries++;
    this.deliveryDepth++;
    const list = entry.list;
    list.users++;
    hooks.emit?.(`B ${source.slot}`);
    accounting.maxUsersPerVersion = Math.max(accounting.maxUsersPerVersion, list.users);
    let foundStale = false;
    try {
      // Every write clones first while users > 0, so this array cannot change underneath.
      for (const listener of list.listeners) {
        if (!this.store.isLive(listener.target)) foundStale = true;
        else if (this.store.isLive(listener.handler.node)) this.host.deliver(listener, source);
        else accounting.zombieSkips++;
      }
    } finally {
      hooks.emit?.(`E ${source.slot}`);
      this.deliveryDepth--;
      list.users--;
      if (!list.current && list.users === 0) this.releaseVersion(list);
    }
    if (foundStale) {
      accounting.deliveriesFindingStale++;
      this.scheduleCleanup();
    }
  }

  private scheduleCleanup(): void {
    if (++this.cleanupRequests === 1) this.cleanupPending = true;
  }

  pump(): void {
    if (!this.cleanupPending) return;
    this.cleanupPending = false;
    this.cleanupRequests = 0;
    this.purge();
  }

  purge(): boolean {
    let foundDirt = false;

    for (const entry of [...this.table.values()].reverse()) {
      const sourceAlive = this.store.isLive(entry.source);
      let removeList = !sourceAlive;

      if (!removeList) {
        this.prepareForWriting(entry);
        entry.list.listeners.forEach((l, i, all) => {
          const at = all.length - 1 - i;
          if (!this.store.isLive(all[at]!.target)) hooks.emit?.(`D ${entry.source.slot} ${at}`);
        });
        const before = entry.list.listeners.length;
        entry.list.listeners = entry.list.listeners.filter((l) => this.store.isLive(l.target));
        if (entry.list.listeners.length !== before) {
          accounting.staleRemovedByPurge += before - entry.list.listeners.length;
          foundDirt = true;
        }
        removeList = entry.list.listeners.length === 0;
      }
      if (removeList && sourceAlive) {
        this.host.stopListening(entry.source);
        this.table.delete(entry.source.slot);
        this.retire(entry.list);
        foundDirt = true;
      }
      if (!sourceAlive) {
        this.table.delete(entry.source.slot);
        this.retire(entry.list);
      }
    }
    if (this.orphan !== null) this.retire(this.orphan);
    this.orphan = null;
    return foundDirt;
  }

  /** Nothing to reconcile: dead entries are still in the arrays. Counts only. */
  afterCollect(): void {
    let stale = 0;

    for (const entry of this.table.values()) {
      if (!this.store.isLive(entry.source)) continue;
      for (const listener of entry.list.listeners) {
        if (this.store.isLive(listener.target)) continue;
        stale++;
        if (!listener.staleCounted) {
          listener.staleCounted = true;
          accounting.staleAccrued++;
        }
      }
    }
    accounting.peakStale = Math.max(accounting.peakStale, stale);
  }
}

// M4A.4: a hand port of the weak-event core of WeakEventManager.cs and WeakEventTable.cs at
// dotnet/wpf 49ae5cd, over L0. Checked against the CLR oracle, not against reading.
//
// What stays outside the store, and why:
//   ListVersion.users  which version of a list deliveries are reading (WPF's _users)
//   ListVersion.stale  entries whose endpoint died but that the list still counts. L0
//                      prunes a relation at collect; WPF keeps the entry until a purge
//   ListVersion.cwt    which retention relations this version owns, in WPF's own shape
//   Entry.live         the tally that lets collect's pruning be measured as a difference
//
// Two behaviours of the frozen executable are reproduced on purpose and are candidate
// defects, not requirements of a weak-event mechanism. See research/M4A-WPF-INVENTORY.md.
import { accounting } from "./accounting.ts";
import type { DeliveryRecord, HandlerRecord, NodeId, RelationId, SubscriptionStore } from "./backend.ts";

interface Held {
  readonly record: HandlerRecord;
  readonly retention: RelationId;
}

type CwtValue = { readonly kind: "single"; readonly held: Held } | { readonly kind: "list"; readonly held: Held[] };

class ListVersion {
  users = 0;
  stale = 0;
  current = true;
  readonly cwt = new Map<string, CwtValue>();
}

interface Entry {
  readonly source: NodeId;
  readonly isStatic: boolean;
  list: ListVersion;
  live: number;
}

export interface EventHost {
  startListening(source: NodeId): void;
  stopListening(source: NodeId): void;
  deliver(record: DeliveryRecord, source: NodeId): void;
}

export interface ClientState {
  entries: number;
  versions: number;
}

export interface WeakEventBackend {
  clientState(): ClientState;
  beforeCollect?(): void;
  add(source: NodeId, isStatic: boolean, target: NodeId, method: number): void;
  remove(source: NodeId, target: NodeId, method: number): void;
  deliver(source: NodeId): void;
  pump(): void;
  purge(): boolean;
  afterCollect(): void;
}

const keyOf = (node: NodeId): string => `${node.slot}:${node.generation}`;

export class WeakEventCore implements WeakEventBackend {
  private readonly store: SubscriptionStore;
  private readonly host: EventHost;
  private readonly table = new Map<number, Entry>();
  private orphan: ListVersion | null = null;
  private cleanupRequests = 0;
  private cleanupPending = false;
  private snapshotRecords = 0;

  constructor(store: SubscriptionStore, host: EventHost) {
    this.store = store;
    this.host = host;
  }

  clientState(): ClientState {
    return { entries: this.snapshotRecords, versions: this.table.size };
  }

  /** AddHandlerToCWT. */
  private holdHandler(list: ListVersion, target: NodeId, record: HandlerRecord): void {
    const key = keyOf(target);
    const value = list.cwt.get(key);
    const held = { record, retention: this.store.retain(target, record) };

    if (value === undefined) list.cwt.set(key, { kind: "single", held });
    else if (value.kind === "single") list.cwt.set(key, { kind: "list", held: [value.held, held] });
    else value.held.push(held);
  }

  /** The table half of RemoveHandler. */
  private releaseHandler(list: ListVersion, target: NodeId, method: number): void {
    const key = keyOf(target);
    const value = list.cwt.get(key);

    if (value === undefined) return;
    if (value.kind === "single") {
      // WeakEventManager.cs:682-686 removes the entry without comparing the delegate.
      if (value.held.record.method !== method) accounting.handlersLostToFastPath++;
      this.store.dropRetention(value.held.retention);
      list.cwt.delete(key);
      return;
    }
    // List.Remove takes the first equal delegate, while the main list lost its last match,
    // so with duplicates the survivor's own delegate can be the one released.
    const at = value.held.findIndex((h) => h.record.method === method);
    if (at >= 0) {
      this.store.dropRetention(value.held[at]!.retention);
      value.held.splice(at, 1);
    }
    if (value.held.length === 0) list.cwt.delete(key);
  }

  private releaseVersion(list: ListVersion): void {
    for (const value of list.cwt.values()) {
      for (const held of value.kind === "single" ? [value.held] : value.held) this.store.dropRetention(held.retention);
    }
    list.cwt.clear();
  }

  /** A version no longer installed dies with its last delivery. */
  private retire(list: ListVersion): void {
    list.current = false;
    if (list.users === 0) this.releaseVersion(list);
  }

  /** PrepareForWriting and CopyTo: dead entries are dropped, live delegates held afresh. */
  private cloneIfInUse(entry: Entry): void {
    if (entry.list.users === 0) return;
    accounting.writesDuringDelivery++;
    accounting.wpfCloneEntries += entry.live + entry.list.stale;
    accounting.staleDroppedByClone += entry.list.stale;
    const next = new ListVersion();

    for (const member of this.store.members(entry.source)) {
      if (this.store.isLive(member.handler.node)) {
        this.holdHandler(next, member.target, member.handler);
      } else {
        accounting.zombiesDroppedByClone++;
        this.store.unlink(member.relation);
        entry.live--;
      }
    }
    this.retire(entry.list);
    entry.list = next;
  }

  private isEmpty(entry: Entry): boolean {
    return entry.live === 0 && entry.list.stale === 0;
  }

  add(source: NodeId, isStatic: boolean, target: NodeId, method: number): void {
    let entry = this.table.get(source.slot);

    if (entry === undefined) {
      entry = { source, isStatic, list: new ListVersion(), live: 0 };
      this.table.set(source.slot, entry);
      this.host.startListening(source);
    }
    const record = this.store.newHandler(method);

    if (isStatic && entry.list.users > 0) {
      // WeakEventManager.cs:279 stores the clone under `source`, null here, and not under
      // sourceKey. The add lands in a list nothing delivers from. Confirmed by the oracle.
      accounting.lostStaticAdds++;
      const orphan = new ListVersion();

      for (const member of this.store.members(source)) {
        if (this.store.isLive(member.handler.node)) this.holdHandler(orphan, member.target, member.handler);
      }
      this.holdHandler(orphan, target, record);
      if (this.orphan !== null) this.retire(this.orphan);
      this.orphan = orphan;
      this.scheduleCleanup();
      return;
    }
    this.cloneIfInUse(entry);
    this.store.subscribe(target, source, record);
    this.holdHandler(entry.list, target, record);
    entry.live++;
    this.scheduleCleanup();
  }

  remove(source: NodeId, target: NodeId, method: number): void {
    const entry = this.table.get(source.slot);

    if (entry === undefined) return;
    this.cloneIfInUse(entry);
    if (this.store.unsubscribeLast(source, target, method)) entry.live--;
    this.releaseHandler(entry.list, target, method);
    if (this.isEmpty(entry)) {
      this.table.delete(source.slot);
      this.retire(entry.list);
      this.host.stopListening(source);
    }
  }

  deliver(source: NodeId): void {
    const entry = this.table.get(source.slot);

    if (entry === undefined) return;
    accounting.deliveries++;
    const list = entry.list;
    list.users++;
    const records = this.store.snapshot(source);
    // Entries that were dead before this delivery are no longer relations.
    this.snapshotRecords += records.length;
    let foundStale = list.stale > 0;
    try {
      for (const record of records) {
        if (!this.store.isLive(record.target)) foundStale = true;
        else if (this.store.isLive(record.handler.node)) this.host.deliver(record, source);
        else accounting.zombieSkips++;
      }
    } finally {
      this.snapshotRecords -= records.length;
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

  /** The dispatcher reaching ContextIdle: CleanupOperation. */
  pump(): void {
    if (!this.cleanupPending) return;
    this.cleanupPending = false;
    this.cleanupRequests = 0;
    this.purge();
  }

  /** WeakEventTable.Purge(false). */
  purge(): boolean {
    let foundDirt = false;

    for (const entry of [...this.table.values()].reverse()) {
      const sourceAlive = this.store.isLive(entry.source);
      let removeList = !sourceAlive;

      if (!removeList) {
        this.cloneIfInUse(entry);
        if (entry.list.stale > 0) {
          accounting.staleRemovedByPurge += entry.list.stale;
          entry.list.stale = 0;
          foundDirt = true;
        }
        removeList = entry.live === 0;
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
    // The orphan's key has a null source, so the purge discards it without reporting dirt.
    if (this.orphan !== null) this.retire(this.orphan);
    this.orphan = null;
    return foundDirt;
  }

  /** After a collection: what L0 pruned becomes entries the lists still count. */
  afterCollect(): void {
    let stale = 0;

    for (const entry of this.table.values()) {
      if (this.store.isLive(entry.source)) {
        const remaining = this.store.count(entry.source);
        const died = entry.live - remaining;
        entry.live = remaining;
        entry.list.stale += died;
        accounting.staleAccrued += died;
      }
      stale += entry.list.stale;
    }
    accounting.peakStale = Math.max(accounting.peakStale, stale);
  }
}

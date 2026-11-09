// M4A.6 variant S2: the store's right axis carries the current version of each list, and
// the only client arrays are versions frozen at a clone. Observable behaviour, frozen
// defects included, must equal S0, S1 and the CLR.
//
// Two questions are kept apart. Adjacency substitution is the same in every mode. The modes
// differ only in how a walk survives collect pruning a relation it has not finished with:
//   epoch  an epoch around each delivery; the cursor is read after retirement
//   next   no epochs; the successor saved before the callback, and nothing else
//   log    no epochs; before a collect, a running walk copies what is ahead of it
import { accounting } from "./accounting.ts";
import type { DeliveryRecord, HandlerRecord, Member, NodeId, RelationId, SubscriptionStore } from "./backend.ts";
import type { ClientState, EventHost, WeakEventBackend } from "./manager.ts";

export type WalkMode = "epoch" | "next" | "log";

interface Held {
  readonly record: HandlerRecord;
  readonly retention: RelationId;
}

type CwtValue = { readonly kind: "single"; readonly held: Held } | { readonly kind: "list"; readonly held: Held[] };

interface Walk {
  cursor: RelationId | null;
  saved: RelationId | null;
  records: DeliveryRecord[] | null;
  index: number;
  foundStale: boolean;
  aheadBefore: number;
}

class ListVersion {
  users = 0;
  stale = 0;
  current = true;
  released = false;
  frozen: DeliveryRecord[] | null = null;
  readonly walks = new Set<Walk>();
  readonly cwt = new Map<string, CwtValue>();
}

interface Entry {
  readonly source: NodeId;
  list: ListVersion;
  live: number;
}

const keyOf = (node: NodeId): string => `${node.slot}:${node.generation}`;
const sameRelation = (a: RelationId, b: RelationId): boolean => a.slot === b.slot && a.generation === b.generation;

export class StoreAdjacencyCore implements WeakEventBackend {
  private readonly store: SubscriptionStore;
  private readonly host: EventHost;
  private readonly mode: WalkMode;
  private readonly table = new Map<number, Entry>();
  private readonly versions = new Set<ListVersion>();
  private orphan: ListVersion | null = null;
  private cleanupRequests = 0;
  private cleanupPending = false;

  constructor(store: SubscriptionStore, host: EventHost, mode: WalkMode) {
    this.store = store;
    this.host = host;
    this.mode = mode;
  }

  clientState(): ClientState {
    let entries = 0;

    for (const version of this.versions) {
      entries += version.frozen?.length ?? 0;
      for (const walk of version.walks) if (walk.records !== version.frozen) entries += walk.records?.length ?? 0;
    }
    return { entries, versions: this.versions.size };
  }

  private newVersion(): ListVersion {
    accounting.versionsCreated++;
    const version = new ListVersion();
    this.versions.add(version);
    accounting.maxSimultaneousVersions = Math.max(accounting.maxSimultaneousVersions, this.versions.size);
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
    for (const value of list.cwt.values()) {
      for (const held of value.kind === "single" ? [value.held] : value.held) this.store.dropRetention(held.retention);
    }
    list.cwt.clear();
  }

  private retire(list: ListVersion): void {
    list.current = false;
    if (list.users === 0) this.releaseVersion(list);
  }

  /** What follows a walk's cursor. In epoch mode this is where retired relations get read. */
  private successor(walk: Walk): RelationId | null {
    if (this.mode !== "epoch") return walk.saved;
    if (this.store.status(walk.cursor!) === "retired") accounting.retiredReads++;
    return this.store.nextOf(walk.cursor!);
  }

  /** Freeze the members for walks on this version, each at its own position. */
  private freeze(list: ListVersion, members: Member[]): void {
    const frozen = members.map(({ target, handler }) => ({ target, handler }));
    list.frozen = frozen;
    accounting.frozenRecords += frozen.length;

    for (const walk of list.walks) {
      if (walk.records !== null) continue;
      const next = this.successor(walk);
      const at = next === null ? -1 : members.findIndex((m) => sameRelation(m.relation, next));
      if (next !== null && at < 0) accounting.continuationLost++;
      walk.records = frozen;
      walk.index = at < 0 ? frozen.length : at;
    }
  }

  private cloneIfInUse(entry: Entry): void {
    if (entry.list.users === 0) return;
    accounting.writesCausingClone++;
    accounting.wpfCloneEntries += entry.live + entry.list.stale;
    accounting.staleDroppedByClone += entry.list.stale;
    const members = this.store.members(entry.source);
    this.freeze(entry.list, members);
    const next = this.newVersion();

    for (const member of members) {
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
      entry = { source, list: this.newVersion(), live: 0 };
      this.table.set(source.slot, entry);
      this.host.startListening(source);
    }
    const record = this.store.newHandler(method);

    if (isStatic && entry.list.users > 0) {
      // WeakEventManager.cs:279: a frozen defect. The orphan copies retention only.
      accounting.lostStaticAdds++;
      const orphan = this.newVersion();
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

  private visit(record: DeliveryRecord, walk: Walk, source: NodeId): void {
    if (!this.store.isLive(record.target)) walk.foundStale = true;
    else if (this.store.isLive(record.handler.node)) this.host.deliver(record, source);
    else accounting.zombieSkips++;
  }

  deliver(source: NodeId): void {
    const entry = this.table.get(source.slot);

    if (entry === undefined) return;
    accounting.deliveries++;
    const list = entry.list;
    const walk: Walk = { cursor: null, saved: null, records: null, index: 0, foundStale: list.stale > 0, aheadBefore: 0 };
    list.users++;
    list.walks.add(walk);
    if (this.mode === "epoch") this.store.enter();
    try {
      let e = this.store.firstOf(source);

      while (true) {
        if (walk.records !== null) {
          const record = walk.records[walk.index++];
          if (record === undefined) break;
          this.visit(record, walk, source);
          continue;
        }
        if (e === null) break;
        walk.cursor = e;
        walk.saved = this.store.nextOf(e);
        this.visit(this.store.recordOf(e), walk, source);
        if (walk.records !== null) continue;
        if (this.mode === "next" && walk.saved !== null && this.store.status(walk.saved) !== "live") {
          accounting.continuationLost++;
          break;
        }
        e = this.successor(walk);
      }
    } finally {
      if (this.mode === "epoch") this.store.exit();
      list.walks.delete(walk);
      list.users--;
      if (!list.current && list.users === 0) this.releaseVersion(list);
    }
    if (walk.foundStale) {
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
    if (this.orphan !== null) this.retire(this.orphan);
    this.orphan = null;
    return foundDirt;
  }

  private aheadOf(walk: Walk): number {
    let n = 0;
    for (let e = this.store.nextOf(walk.cursor!); e !== null; e = this.store.nextOf(e)) n++;
    return n;
  }

  /** A walk must notice dead entries ahead of it, as WPF does on reaching them. */
  beforeCollect(): void {
    for (const version of this.versions) {
      for (const walk of version.walks) {
        if (walk.records !== null || walk.cursor === null) continue;
        if (this.mode === "epoch") {
          walk.aheadBefore = this.aheadOf(walk);
        } else if (this.mode === "log") {
          const ahead: DeliveryRecord[] = [];
          for (let e = walk.saved; e !== null; e = this.store.nextOf(e)) ahead.push(this.store.recordOf(e));
          accounting.collectLogRecords += ahead.length;
          walk.records = ahead;
          walk.index = 0;
        }
      }
    }
  }

  afterCollect(): void {
    let stale = 0;

    if (this.mode === "epoch") {
      for (const version of this.versions) {
        for (const walk of version.walks) {
          if (walk.records !== null || walk.cursor === null) continue;
          if (this.store.status(walk.cursor) === "retired") accounting.retiredReads++;
          if (this.aheadOf(walk) < walk.aheadBefore) walk.foundStale = true;
        }
      }
    }
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

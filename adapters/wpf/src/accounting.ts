// M4A.4 structural accounting. Counts only; never decides.
export const accounting = {
  deliveries: 0,
  /** Delivery records this port copies at delivery start, every delivery. */
  snapshotEntriesCopied: 0,
  /** Writes that found the current list in use, where WPF clones. */
  writesDuringDelivery: 0,
  /** Entries WPF's copy-on-write would copy at those writes, dead ones included. */
  wpfCloneEntries: 0,
  /** Entries whose endpoint died while the list still counted them. */
  staleAccrued: 0,
  /** Stale entries a delivery found on its way. */
  deliveriesFindingStale: 0,
  /** Stale entries dropped by a clone instead of a purge. */
  staleDroppedByClone: 0,
  /** Stale entries removed by a purge. */
  staleRemovedByPurge: 0,
  peakStale: 0,
  relates: 0,
  unlinks: 0,
  rightWalkSteps: 0,
  /** Adds during delivery on a static event, lost to the defect at WeakEventManager.cs:279. */
  lostStaticAdds: 0,
  handlerNodes: 0,
  retentionRelations: 0,
  /** Removes whose table fast path released another delegate, WeakEventManager.cs:682-686. */
  handlersLostToFastPath: 0,
  /** Delivery records with a live target and a dead delegate. */
  zombieSkips: 0,
  zombiesDroppedByClone: 0,
  retentionRelationsRemoved: 0,
  // S1 only.
  versionsCreated: 0,
  entriesCopied: 0,
  orphanEntriesCopied: 0,
  writesCausingClone: 0,
  maxSimultaneousVersions: 0,
  maxUsersPerVersion: 0,
  nestedDeliveries: 0,
  deadEntriesDroppedDuringClone: 0,
  // S2.
  frozenRecords: 0,
  retiredReads: 0,
  programsWithRetiredRead: 0,
  continuationLost: 0,
  collectLogRecords: 0,
  // Total logical state: per-program peaks, summed over the corpus.
  sumPeakClientEntries: 0,
  sumPeakClientVersions: 0,
  sumPeakStoreMembership: 0,
  sumPeakStoreRetention: 0,
  sumPeakStoreRetired: 0,
  sumPeakTotal: 0,
};

export function resetAccounting(): void {
  for (const key of Object.keys(accounting) as (keyof typeof accounting)[]) accounting[key] = 0;
}

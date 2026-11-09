// M1.4 structural accounting of the port. Reads only, and only under
// __STATS__. Kept apart from instrumentation.ts, which is a verbatim copy.
export const accounting = {
  /** nextDep on a retired edge, and how often it differs from L0's next. */
  retiredNextReads: 0,
  retiredNextReadsNonNull: 0,
  retiredNextDivergent: 0,
  /** source, target, observed, generationOf on a retired edge. */
  retiredFieldReads: 0,
  /** Retirements inside a walk: each writes a compatibility record. */
  continuationRecords: 0,
  maxSimultaneouslyRetired: 0,

  walkEpochs: 0,
  maxWalkDepth: 0,
  /** User-code calls (exec, pull) made while a walk holds edges. */
  userCodeCrossings: 0,
  /** Edges held across those calls, summed. */
  edgesHeldAcrossUserCode: 0,
  /** Of those, edges that came back retired. */
  edgesRetiredWhileHeld: 0,

  backwardHits: 0,
  backwardReachedHead: 0,
  backwardBudgetExhausted: 0,
  absenceProofs: 0,

  pairFoundFirst: 0,
  pairFoundDeeper: 0,
  pairAbsent: 0,
  pairBudgetExhausted: 0,

  indexes: 0,
  indexedEdges: 0,
  sweeps: 0,
  /** Extra work a mutant adds; always 0 in the port itself. */
  ablationWork: 0,

  linksAtTail: 0,
  linksInsideList: 0,
  moves: 0,
  unlinks: 0,
};

// M2.4 structural accounting of the Alien port. Counts only; never decides.
export const accounting = {
  linkHitPrev: 0,
  linkHitNext: 0,
  linkDedupedByRightTail: 0,
  linksAtTail: 0,
  linksInsideList: 0,
  dependencyLinks: 0,
  ownershipLinks: 0,
  duplicatePairBirths: 0,
  maxVersion: 0,

  forwardLeftSteps: 0,
  forwardRightSteps: 0,
  reverseWalkSteps: 0,
  isValidLinkSteps: 0,
  versionReads: 0,
  versionWrites: 0,

  unlinks: 0,
  unwatchedComputed: 0,
  unwatchedSignal: 0,
  unwatchedEffect: 0,
  unwatchedScope: 0,

  epochs: 0,
  maxEpochDepth: 0,
  maxSimultaneouslyRetired: 0,

  updateCrossings: 0,
  linksHeldAcrossUpdate: 0,
  heldLinksRetiredByUpdate: 0,
  unwatchedCrossings: 0,
  savedNextRetiredByUnwatched: 0,

  retiredNextDep: 0,
  retiredNextSub: 0,
  retiredNextDivergentFromFrozen: 0,
  retiredEndpointReads: 0,
  retiredPredecessorReads: 0,
  secondUnlinks: 0,

  /** Extra structure visits a mutant adds; always 0 in the port itself. */
  ablationWork: 0,
};

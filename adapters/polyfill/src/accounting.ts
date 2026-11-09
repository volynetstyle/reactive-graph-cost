// M3.2 structural accounting of the polyfill port. Counts only; never decides.
export const accounting = {
  /** Trace entries written for a consumer that is not live: no relation exists. */
  traceWritesWithoutRelation: 0,
  activations: 0,
  deactivations: 0,
  maxCascadeDepth: 0,
  /** Born or removed because the trace changed. */
  birthsFromTrace: 0,
  deathsFromTrace: 0,
  /** Born or removed only because liveness changed; the dependency trace did not. */
  birthsFromActivation: 0,
  deathsFromDeactivation: 0,
  rightSwaps: 0,
  rightTailRemovals: 0,
  rightWalkSteps: 0,
  inactiveBirths: 0,
  activationFlips: 0,
  deactivationFlips: 0,
  retentionFlips: 0,
  /** Extra structure visits a mutant adds; always 0 in the port itself. */
  ablationWork: 0,
};

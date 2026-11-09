// M3.5b experiment, not part of L0. CONTRACT.md fixes retention at relate (clause 1 and
// the M0 decision "Retention fixed at relate"). This subclass lifts exactly that, to
// test whether a client can change retention without changing relation identity.
import { ContractError, RelationMachine, type RelationId, type Retention } from "../machine.ts";

/** A consumer holds its producer, and an active producer holds its consumer. */
export const LIVE_RETENTION: Retention = Object.freeze({ leftToRight: true, rightToLeft: true });

export class MutableRetentionMachine extends RelationMachine {
  setRetention(relation: RelationId, retention: Retention): void {
    const status = this.status(relation);

    if (status !== "live") {
      throw new ContractError(status === "stale" ? "stale-relation" : "retired-relation", "retention of a dead relation");
    }
    this.relations[relation.slot]!.retention = retention;
  }
}

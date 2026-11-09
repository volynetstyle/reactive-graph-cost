// Mechanism ablation: each entry removes or weakens exactly one mechanism of
// the machine. Controls change only physical choices the contract leaves open,
// so they must produce no witness; they show the search is not simply flagging
// every change.

import {
  RelationMachine,
  type Axis,
  type NodeId,
  type RelationId,
  type RelationRecord,
  type Retention,
} from "./machine.ts";
import type { Clause } from "./contract.ts";

/**
 * safety: a stale handle or walk resolves to the wrong thing or nothing.
 * semantic: an observable result the contract fixes comes out wrong.
 * structural: the result is right but the declared structural cost is not.
 * surface: removes a capability outright, so the witness shows only that the
 *   capability is observable. Whether anyone needs it is for the ports to say.
 */
export type Evidence = "safety" | "semantic" | "structural" | "surface";

export interface Ablation {
  readonly id: string;
  readonly removes: string;
  readonly evidence: Evidence;
  readonly clause: Clause;
  readonly make: () => RelationMachine;
}

export interface Control {
  readonly id: string;
  readonly changes: string;
  readonly make: () => RelationMachine;
}

function sortedInsert(list: number[], slot: number): void {
  const index = list.findIndex((s) => s > slot);
  list.splice(index < 0 ? list.length : index, 0, slot);
}

class NoGeneration extends RelationMachine {
  protected override generationOnReclaim(generation: number): number {
    return generation;
  }
}

class OneBitGeneration extends RelationMachine {
  protected override generationOnReclaim(generation: number): number {
    return (generation + 1) & 1;
  }
}

class NoOrdering extends RelationMachine {
  protected override place(_axis: Axis, list: number[], slot: number): void {
    sortedInsert(list, slot);
  }
}

class UnorderedRight extends RelationMachine {
  protected override place(axis: Axis, list: number[], slot: number, index: number): void {
    if (axis === "right") sortedInsert(list, slot);
    else super.place(axis, list, slot, index);
  }
}

class NoStableIdentity extends RelationMachine {
  override moveAfter(axis: Axis, relation: RelationId, cursor: RelationId | null): void {
    this.validateMove(axis, relation, cursor);
    const left = this.left(relation);
    const right = this.right(relation);
    const retention = this.retention(relation);
    const meta = this.meta(relation);
    this.unlink(relation);
    super.moveAfter(axis, this.relate(left, right, retention, meta), cursor);
  }
}

class NoReverseIncidence extends RelationMachine {
  protected override place(axis: Axis, list: number[], slot: number, index: number): void {
    if (axis === "left") super.place(axis, list, slot, index);
  }

  protected override displace(axis: Axis, list: number[], slot: number): void {
    if (axis === "left") super.displace(axis, list, slot);
  }
}

class NoDeferredReuse extends RelationMachine {
  protected override quiescent(): boolean {
    return true;
  }
}

class InnerExitReclaims extends RelationMachine {
  override exit(): void {
    super.exit();
    this.reclaim();
  }
}

class NoContinuation extends RelationMachine {
  override next(axis: Axis, relation: RelationId): RelationId | null {
    return this.status(relation) === "retired" ? null : super.next(axis, relation);
  }
}

class NoRetirementChain extends RelationMachine {
  protected override resolveContinuation(axis: Axis, retired: RelationRecord): RelationId | null {
    const slot = axis === "left" ? retired.leftSuccessor : retired.rightSuccessor;
    return slot === null ? null : this.relationHandle(slot);
  }
}

class NoWeakDirection extends RelationMachine {
  protected override retains(record: RelationRecord): boolean {
    return record.retention.leftToRight || record.retention.rightToLeft;
  }
}

class NoPrune extends RelationMachine {
  private collecting = false;

  override collect(): ReturnType<RelationMachine["collect"]> {
    this.collecting = true;
    try {
      return super.collect();
    } finally {
      this.collecting = false;
    }
  }

  protected override prune(slot: number): void {
    if (!this.collecting) super.prune(slot);
  }
}

class ForcedUniqueness extends RelationMachine {
  override relate(left: NodeId, right: NodeId, retention: Retention, meta = 0): RelationId {
    if (this.status(left) === "live") {
      for (let e = this.first("left", left); e !== null; e = this.next("left", e)) {
        if (this.right(e).slot === right.slot && this.right(e).generation === right.generation) return e;
      }
    }
    return super.relate(left, right, retention, meta);
  }
}

class NoMetadata extends RelationMachine {
  override setMeta(relation: RelationId, value: number): void {
    super.setMeta(relation, value);
    super.setMeta(relation, 0);
  }
}

class FifoFreelist extends RelationMachine {
  protected override takeSlot(free: number[]): number | undefined {
    return free.shift();
  }
}

class GenerationAtAllocate extends RelationMachine {
  protected override generationOnReclaim(generation: number): number {
    return generation;
  }

  protected override generationOnAllocate(generation: number): number {
    return generation + 1;
  }
}

export const ABLATIONS: readonly Ablation[] = [
  {
    id: "no-generation",
    removes: "generation guard on handles",
    evidence: "safety",
    clause: "identity",
    make: () => new NoGeneration(),
  },
  {
    id: "one-bit-generation",
    removes: "unbounded generation (wraps at 2 reuses)",
    evidence: "safety",
    clause: "identity",
    make: () => new OneBitGeneration(),
  },
  {
    id: "no-ordering",
    removes: "explicit order on both axes (slot order instead)",
    evidence: "semantic",
    clause: "order",
    make: () => new NoOrdering(),
  },
  {
    id: "unordered-right",
    removes: "explicit order on the right axis only",
    evidence: "semantic",
    clause: "order",
    make: () => new UnorderedRight(),
  },
  {
    id: "no-stable-identity",
    removes: "stable identity under move (move = death + birth)",
    evidence: "structural",
    clause: "permutation",
    make: () => new NoStableIdentity(),
  },
  {
    id: "no-reverse-incidence",
    removes: "right-axis incidence",
    evidence: "surface",
    clause: "dual-incidence",
    make: () => new NoReverseIncidence(),
  },
  {
    id: "no-deferred-reuse",
    removes: "deferred reclamation (reclaim at unlink)",
    evidence: "safety",
    clause: "deferred-reuse",
    make: () => new NoDeferredReuse(),
  },
  {
    id: "inner-exit-reclaims",
    removes: "outermost-only quiescence (any exit reclaims)",
    evidence: "safety",
    clause: "deferred-reuse",
    make: () => new InnerExitReclaims(),
  },
  {
    id: "no-continuation",
    removes: "walk continuation from a retired relation",
    evidence: "safety",
    clause: "continuation",
    make: () => new NoContinuation(),
  },
  {
    id: "no-retirement-chain",
    removes: "chasing through successors that also retired",
    evidence: "safety",
    clause: "continuation",
    make: () => new NoRetirementChain(),
  },
  {
    id: "no-weak-direction",
    removes: "directional retention (a retaining relation retains both ways)",
    evidence: "semantic",
    clause: "reachability",
    make: () => new NoWeakDirection(),
  },
  {
    id: "no-prune",
    removes: "pruning of relations with a dead endpoint",
    evidence: "safety",
    clause: "gc-transparency",
    make: () => new NoPrune(),
  },
  {
    id: "forced-uniqueness",
    removes: "parallel relations (relate returns the existing pair)",
    evidence: "surface",
    clause: "multiplicity",
    make: () => new ForcedUniqueness(),
  },
  {
    id: "no-metadata",
    removes: "relation metadata",
    evidence: "surface",
    clause: "metadata",
    make: () => new NoMetadata(),
  },
];

export const CONTROLS: readonly Control[] = [
  {
    id: "fifo-freelist",
    changes: "reuses the oldest free slot instead of the newest",
    make: () => new FifoFreelist(),
  },
  {
    id: "generation-at-allocate",
    changes: "bumps the generation on reuse instead of on reclaim",
    make: () => new GenerationAtAllocate(),
  },
];

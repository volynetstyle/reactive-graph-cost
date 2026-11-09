# Relation Store: L0 contract

**Research question.** What is the smallest VM-level relation primitive
sufficient to implement modern incremental computation efficiently, without
standardizing any particular reactive algorithm?

**Candidate.** Stable identity + dual incidence + explicit ordering +
directional reachability + a walk-safe retirement protocol.

This document fixes L0 only.

## Inclusion criterion

A mechanism enters L0 only if, without it, a clause below breaks or a port
cannot keep its observable semantics. "Other runtimes do it" and "it is
convenient" are not reasons.

## Layers

| Layer | Contents | Status |
| --- | --- | --- |
| L3 reactive semantics | computed, effect, watcher, errors, equality, scheduler | not VM |
| L2 incremental algorithm | push/pull, dirty/stale, validation, cutoff | not VM |
| L1 trace machinery | revision, cursor, cohort, reconcile | candidates, unproven |
| L0 relation substrate | this contract | under test |

## Model

A relation `e = (u, v)` has a stable identity and sits in exactly two ordered
lists: `L(u)` and `R(v)`. Nodes and relations are named by `(slot, generation)`
handles. A handle's status only moves forward: `live → retired → stale`.

Retention is declared per direction when a relation is created: `leftToRight`
and `rightToLeft`. A reactive dependency is `relate(consumer, producer, STRONG)`.
After `collect()`, the live nodes are exactly

```text
L₀ = roots
Lₙ₊₁ = Lₙ ∪ { v | u ∈ Lₙ, ρ(u→v) } ∪ { u | v ∈ Lₙ, ρ(v→u) }
Live = lfp(L)
```

## Operations

| Operation | Effect |
| --- | --- |
| `node()` | new unrooted node |
| `root(n)`, `unroot(n)` | explicit root set; stands in for real GC roots |
| `relate(u, v, retention, meta?)` | new relation at the tail of `L(u)` and `R(v)` |
| `unlink(e)` | removes `e` from both lists; `e` is retired |
| `moveAfter(axis, e, cursor)` | repositions `e` on one axis; `null` means head |
| `first(axis, n)`, `next(axis, e)` | traversal |
| `left(e)`, `right(e)`, `retention(e)` | immutable facts |
| `meta(e)`, `setMeta(e, int32)` | one opaque word |
| `enter()`, `exit()` | epoch; the outermost `exit` is the quiescent point |
| `collect()` | retires unreachable nodes, prunes their relations |
| `status(handle)` | never throws |

An operation either succeeds or throws a `ContractError` and changes nothing.

## Clauses

`Clause` is the name used by [reference/contract.ts](reference/contract.ts).

| # | Clause | Statement | Checked in M0 |
| --- | --- | --- | --- |
| 1 | `identity` | Moving never changes a handle. A status never moves backwards, so a reused slot never aliases a stale handle. Endpoints and retention are immutable. | yes |
| 2 | `dual-incidence` | For every live relation, `e ∈ L(u) ⇔ e ∈ R(v)`, once each. | yes |
| 3 | `order` | Only `moveAfter` changes relative order, only for the moved relation, only on its axis. `relate` appends. | yes |
| 4 | `permutation` | A move allocates nothing, retires nothing, and leaves the other axis untouched. A trace change costs exactly `\|added\|` births and `\|removed\|` retirements. | yes |
| 5 | `reachability` | `collect` keeps exactly `lfp(L)`. Topology does not imply retention. | yes |
| 6 | `gc-transparency` | A live relation never has a dead endpoint. Relations between survivors are untouched. | yes |
| 7 | `deferred-reuse` | Nothing goes stale inside an epoch. Nothing stays retired at quiescence. | yes |
| 8 | `continuation` | Inside an epoch, `next` on a retired relation returns the first relation after it that was live when it retired, chasing further retirements, or `null`. | yes |
| 9 | `metadata` | `setMeta` round-trips and touches only its target. | yes |
| 10 | `multiplicity` | `relate` always mints a new relation; parallel pairs are allowed. | yes |
| 11 | `failure-atomicity` | A rejected operation changes no state. | yes |
| 12 | `lifecycle` | Slots partition into live, retired, free. Nodes die only in `collect`. Relations die only in `unlink` or `collect`. | yes |
| 13 | semantic opacity | The store knows nothing of dirty, computed, equality, scheduler, exceptions, effects. | by construction |
| 14 | no callbacks | No operation runs user code; no operation accepts a function. | by construction |
| 15 | local complexity | Traversal is `O(k)` in visited incidences and allocation-free. Known-handle append, unlink and move are `O(1)` amortized. | **no**: native milestone |

The reference model is array-backed on purpose, so clause 15 cannot be tested
here. M0 checks only its structural half: births and retirements.

### Guarantee of a walk under mutation

Inside an epoch, a walk never crashes, never returns a dead relation, and never
leaves its adjacency. If no `moveAfter` touches that adjacency during the walk,
it visits every relation that stays live throughout, once each, in order.

If a move does touch it, a stable relation can be skipped: a retired relation
keeps one frozen successor, and that successor may later move past other
relations. `test/contract.test.ts` pins this behaviour. Whether a client needs
more is a question for the ports.

### Status of the continuation rule

Retirement and quiescence are the established epoch-reclamation pattern. The
frozen successor and its chase are this contract's own choice: M0 shows the
current clause 8 needs them, not that clients need clause 8.
[research/M1-QUANT-INVENTORY.md](research/M1-QUANT-INVENTORY.md) already records
Quant disagreeing with it on retired edges. Clause 8 is the first candidate for
revision, and M1.5 decides.

## Abstract surface is not a language surface

The operations above define an abstract machine for specification and testing.
They are not a proposed JavaScript API.

Exposing `first` and `next` to JavaScript over a non-retaining direction would
make GC timing observable, because the enumeration's result would depend on
whether a collection had run. That is the reason `WeakMap` is not iterable. The
reference model avoids this only because `collect()` is an explicit operation.

A VM-internal relation structure does not have this problem if programs never
receive the list of weak targets, since a dead consumer can do no observable
work. Any language surface therefore has to be narrower than this contract, and
what it may expose remains open.

## Decisions taken for M0

| Decision | Reason | Revisit when |
| --- | --- | --- |
| No leases or cohorts | L1 candidate; must be earned by independent clients | a port needs bulk revocation |
| Retention fixed at `relate` | no L0 clause needs mutation, and mutation is the case that requires a write barrier | a port must change retention without changing identity |
| Metadata is one int32 | "opaque small metadata" | the Quant port needs more than one word per relation |
| No `prev` or `findRelation` on the surface | no clause needs them; pair lookup is an adaptive detail | the Quant port needs them as client-visible operations. A native backend may still hold `prev`-like fields to pay for clause 15; that is a physical question, not a surface one |
| No "last accepted dependency" | it is a running consumer's tracking state, so L1 or above | never in L0 unless the ports show otherwise |
| Move-stable traversal not promised | not shown to be needed; strengthening it before M1 would be speculation | the Quant port cannot keep its semantics with the guarantee above |

## What M0 does and does not establish

Established, within the bounds stated in
[research/WITNESSES.md](research/WITNESSES.md):

- Each mechanism is independently load-bearing for this contract. Removing any
  one breaks a named clause on a short, explicit history.
- The reference machine satisfies every checked clause, exhaustively within
  small bounds and over seeded random histories.
- Physical choices (slot selection, when a generation is bumped) are
  unobservable.

Not established:

- **That any client needs these mechanisms.** A witness shows a clause breaks,
  not that the clause is right. Entries marked `surface` show only that a
  capability is observable. H1 and H2 need the ports (M1 to M3).
- Anything about real GC, performance, memory, or locality.
- Anything about L1: revisions, cohorts, trace reconciliation (H3).
- Correctness beyond the bounds. Exhaustive checks cover at most 3 relations;
  larger histories are only sampled.

## Three kinds of minimality

| Kind | Question | Settled by |
| --- | --- | --- |
| contract | given the clauses, which mechanisms do they need? | M0 ablations |
| client | which clauses do independent clients need? | ports, M1 to M3 |
| physical | which representation implements the surviving clauses within their bounds? | native ablations |

M0 answers only the first. `surface` entries are clauses waiting on the second.

## Consequences for a native implementation

- What was called deferred reclamation is a walk-safe retirement protocol with
  four obligations, each with its own witness: no slot reuse inside an epoch,
  quiescence only at the outermost exit, continuation from a retired position,
  and chasing a chain of retired successors.
- Generation and deferral are independent: generation guards handles held
  across quiescence, deferral guards walks inside an epoch.
- A stale handle must never alias a future object, so the identity domain must
  not observably wrap. `one-bit-generation` shows that a wrap breaks `identity`.
  At physical exhaustion an implementation needs a fallback that preserves
  no-alias: retiring the slot is one option, widening the identity or migrating
  the table are others. The contract does not choose.
- GC pruning and `unlink` already share one path in the reference model:
  `live → retired → stale`, differing only in cause. Real GC is incremental or
  concurrent, so a native implementation must define when a weak endpoint's
  death becomes a retirement relative to an active walk. `collect()` is
  synchronous and says nothing about this.
- The retirement chain may be compressible, as forwarding pointers are in a
  GC, if that matters under churn. Untested.

## Conditions for M1 (Quant port)

**Question.** Can the complete Quant contract be implemented over L0 without
strengthening L0 or changing Quant's behavioural algorithm?

The result is a per-feature table, not pass or fail: for stable identity, each
axis's ordering, parallel relations, directional retention, deferred reuse,
continuation, metadata width, mutable retention, `prev`, and relation lookup,
record whether Quant forces it, ignores it, or finds it insufficient.

**Representation discipline.** Persistent per-relation state the client needs
is either stored in the Relation Store or counted as external side storage and
reported as a substrate deficiency. A side table is allowed; it is a finding,
not a workaround.

**Expected pressure points**, stated in advance so the port cannot quietly
absorb them: `moveAfter` against continuation during tracking, and one metadata
word against Quant's separate `ver` and `gen` per edge.

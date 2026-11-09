# M1.6: what Quant says about L0

Subject: `quant-main@241a3b7`. Sources: [M1-QUANT-INVENTORY.md](M1-QUANT-INVENTORY.md),
[M1-ACCOUNTING.md](M1-ACCOUNTING.md), [M1.5-ABLATIONS.md](M1.5-ABLATIONS.md).

This records one client's evidence. It does not change [CONTRACT.md](../CONTRACT.md).
That decision waits for independent clients.

**Result.** Quant runs on L0 with unchanged observable behaviour on its whole
corpus and the probes W1 to W3. It uses the structural core of L0. It gives no
evidence for the walk-safe retirement protocol, and one mutable word per
relation is enough for it.

## Evidence used

| Term | Meaning |
| --- | --- |
| frozen | Quant's executable invariants and S1 to S7, as run by its 72 corpus tests |
| extension | W1 to W3: reachable through the public API, unspecified by the contract |
| ablated | removing the mechanism was actually run |
| read | concluded from the source only; not run |

## Capability matrix

| L0 capability | Frozen contract | Literal `241a3b7` | Current algorithm | Extension only | Status for Quant |
| --- | --- | --- | --- | --- | --- |
| left incidence | used; not ablated | yes | yes | no | used |
| right incidence | used; not ablated | yes | yes: `write`, `mark`, `pair` | no | used |
| left order | used; not ablated | yes | yes: read-order validation | no | used |
| right order | not ablated | yes | path choice in `pair`; `wake` order | no | **unresolved** |
| stable identity under move | S2 forbids a new relation when one exists (read); not ablated | yes | yes | no | used, forced by S2 on reading |
| generation, no aliasing | not ablated | Quant's edges are objects | no use of stale handles found | no | **unresolved** |
| `relate` | used | yes | 97.6% of corpus links are this alone | no | used |
| `moveAfter` | used, 44,441 moves | yes | yes | no | used |
| `unlink` by handle | used | yes | yes | no | used |
| immutable endpoints | used | yes | yes | no | used |
| one metadata word | **sufficient (ablated)** with a tentative bit | two fields | `ver` plus `gen` | no | sufficient |
| multiplicity | unused; uniqueness is enforced above L0 | one per pair | no | no | neutral |
| no slot reuse inside an epoch | **no witness (ablated)**; contract cannot express the case | needed by W1 to W3 | no | yes | extension only |
| retired fields readable | **no witness (ablated)** | needed by W1 to W3 | no | yes | extension only |
| clause 8 continuation | **no witness (ablated)** | **differs**: W1, W3 expect retired successors | no policy exists | L0's form does not match | unsupported |
| retirement chain | no witness | L0's chase is what W1, W3 reject | no | no | unsupported |
| outermost-only quiescence | no witness; not ablated | nesting exists, nothing retires while held | no | no probe | no evidence |
| directional reachability | not exercised | n/a | n/a | no | deferred |
| GC pruning | not exercised | n/a | n/a | no | deferred |
| failure atomicity | not relied on | n/a | n/a | no | neutral |
| semantic opacity, no callbacks | held throughout the port | n/a | n/a | no | consistent |
| local complexity | not measured | n/a | n/a | no | not tested |

Alternative costs measured:

| Removed | Result | Cost over the corpus |
| --- | --- | --- |
| `prev` on the surface | contract holds with a fallback | `pairAbsent` 3,433 to 11,352, indexes 251 to 954, sweeps 132 to 1,399, indexed edges 23,753 to 24,481 |
| second relation word | contract holds with a tentative bit | 249,295 extra edge visits at commit, inside Θ(d) passes |

## The two sets

**L0_Q**, the substrate Quant uses. Only payload width was ablated; the rest is
an upper bound until a client or ablation forces it:

```text
stable relation identity
left and right incidence
left order
relate, moveAfter, unlink
immutable endpoints
one mutable word per relation
```

**A_Q**, Quant-specific machinery above the substrate:

```text
running cursor (last)
source slot and displacement
pair proof ladder, including prev if kept
tentative state (one bit is required; gen is one encoding)
uniqueness of a pair
walk stack and retained validation walks
```

The `Node` and `NodeId` binding belongs to neither. It is the cost of joining two
JavaScript models with an adapter.

## Status of the M0 mechanisms

| Mechanism | M0 evidence | After Quant |
| --- | --- | --- |
| epochs, retired readability | contract witness | candidate; extension evidence only |
| continuation, retirement chain | contract witness | candidate, unsupported by Quant |
| outermost-only quiescence | contract witness | candidate, no client evidence |
| right order | `semantic` witness | candidate, unresolved |
| generation | `safety` witness | candidate, unresolved |

M0 witnesses still hold. They show what the current clauses require, not that
clients require those clauses.

## Limits

- Corpus results are limited by what the corpus expresses. Impure computeds are
  inexpressible in its differential language.
- Passing the S1 to S7 tests is not a proof of those bounds for every program.
- Four capabilities were not ablated: right order, reverse incidence, stable
  identity under move, outermost-only quiescence.
- Quant shares ancestry with this research, so it cannot show generality.
- Nothing here concerns real GC, memory, or performance of a native store. Corpus
  percentages describe an adversarial test suite, not workloads.

## Decisions

Open to independent clients, not to Quant: whether clause 8, epochs and right
order stay in the candidate.

Quant is closed as a design input for L0. Reopen it only if another client
produces a counterexample that needs it. M1.7, retention substitution, is
optional and not run.

W1 to W3 stay as an adversarial workload for later clients: a candidate contract
extension to compare, not a requirement.

Next: M2 with a frozen Alien Signals revision, by the same procedure of
inventory, capability matrix, mechanical adapter, unchanged corpus, accounting
and ablations.

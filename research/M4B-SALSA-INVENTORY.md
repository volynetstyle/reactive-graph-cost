# M4B.0 and M4B.1: Salsa inventory and capability matrix

**Question.** Does an incremental query system require ordered relation state, and does
that state benefit from living in L0?

| Item | Value |
| --- | --- |
| subject | `salsa-rs/salsa`, `6d59529e8c299f18614d59e03f6ffb54e8c8dda6` (2026-11-06), crate 0.28.5 |
| in scope | inputs, tracked functions, memoization, dynamic dependency recording, ordered trace, revision validation, re-execution, backdating |
| out of scope | cycles and fixpoint, accumulators, tracked structs, `specify` and output edges, interned GC, persistence, parallelism, LRU |
| toolchain pinned | `rust-toolchain.toml` channel 1.99, `rust-version` 1.95 |

Mapping: the query is left and its input is right.

M4B.0 and M4B.1 come from reading; M4B.2 ran the crate. L0 means
[CONTRACT.md](../CONTRACT.md), unchanged. Paths are under `.cache/salsa-6d59529/src`.

## M4B.0 State

There is no edge object.

| Field | Site | Meaning |
| --- | --- | --- |
| `ActiveQuery.input_outputs: FxIndexSet<QueryEdge>` | `active_query.rs:38` | ordered, deduplicated trace while running |
| `QueryEdge { index, generation, ingredient }` | `zalsa_local.rs:1615` | a `Copy` value, 12 bytes, naming the dependency |
| `QueryRevisions` trace | `zalsa_local.rs`, `QueryEdges` packed or wide | contiguous, owned by the memo |
| `changed_at`, `durability` | `active_query.rs:26-30`, `QueryRevisions` | per query |
| `verified_at` | memo | per query |

Inputs and outputs share one list, distinguished by a tag. Outputs are out of scope.

## M4B.0 Mutation

| Site | Effect | L0 equivalent |
| --- | --- | --- |
| `add_read`, `add_read_simple` `:108-160` | insert if absent; first position wins | a lookup above `relate` |
| `CompletedQuery::finish` `:467` | copy the set in order into the memo | none, or one `relate` per edge |
| re-execution | a whole new trace replaces the old one | unlink all, relate all |

No edge is reused, moved or edited in place. A repeat read leaves the first position.
An input with `Durability::NEVER_CHANGE` is not recorded unless cycles or persistence
require it, so the trace is not a complete record of reads.

## M4B.0 Traversal

| Direction | Site | Purpose |
| --- | --- | --- |
| query to inputs, forward | `deep_verify_edges`, `maybe_changed_after.rs:578` | validation |
| input to queries | **none found** | |

`runtime/dependency_graph.rs` has `query_dependents`, but it tracks threads blocked on
queries, and parallelism is out of scope. "Dependents" in `lib.rs:159` describes the effect
of backdating, not a structure.

The order is stated as a requirement at `maybe_changed_after.rs:591-594`: inputs are
checked in the order they executed, because if I0 is no longer valid, a later I1 "might
never have executed at all, so verifying it is still up to date is meaningless". The loop
returns at the first `Changed`.

## M4B.0 Held across a callback

`deep_verify_edges` iterates a borrowed slice of the old memo while
`maybe_changed_after` may execute user code in dependencies. That code cannot change this
memo's trace in place: a new execution makes a new memo. Whether the old slice stays valid
across that is by memo lifetime, not read further here.

## M4B.1 Capability matrix against unchanged L0

| Requirement | L0 primitive | Gap | Classification |
| --- | --- | --- | --- |
| ordered list of dependencies per query | left axis | none | available; whether the store must hold it is the experiment |
| reverse incidence | right axis | unused | **no use found** |
| relation identity | handles | unused | edges are values |
| reorder | `moveAfter` | unused | not used |
| retire on re-execution | `unlink` per edge | bulk | composition; Salsa replaces the slice |
| dedupe with first position | none | lookup | client-local; `findRelation` is not in L0 |
| parallel relations | clause 10 | unused | deduplicated by construction |
| per-edge word | `meta` | unused | no per-edge payload; revisions are per query |
| node identity with generation | `(slot, generation)` | none | in `QueryEdge`, for keys, not edges |
| retention | clause 5 | not exercised | edges are ids and hold nothing; lifetime is the database |
| walk under mutation | clause 8 | none found | no store walk to protect |
| pull validation, backdating | none | none | client policy |

## Hypotheses to test, not results

| Hypothesis | Reading |
| --- | --- |
| trace order is needed | stated at the source. **Observable only if a later dependency's validation has an effect**, such as executing or panicking in a query that the first change would have skipped. With plain inputs as later dependencies it cannot be seen |
| reverse incidence is unused | no use found in scope |
| relation identity is unused | consistent |
| multiplicity is unused | consistent, by deduplication |
| per-edge payload is unused | consistent |

The comment says "meaningless", not "incorrect". The directed witness has to decide what
reversing the order changes.

Salsa exposes `EventKind::WillExecute` and `DidValidateMemoizedValue`, so executions and
validations can be logged through the public API.

## M4B.2 result: oracle, order witnesses, B1

`adapters/salsa/oracle` interprets JSON programs over the pinned crate: cells as Salsa
inputs, one tracked function per query key. It logs `WillExecute` and
`DidValidateMemoizedValue`. Programs carry no expected results.
`bash adapters/salsa/run-oracle.sh` builds it and writes the journal to
`.cache/salsa-oracle/journal.txt`. Nothing is installed outside `.cache`.

| Item | Value |
| --- | --- |
| Salsa | `6d59529e8c299f18614d59e03f6ffb54e8c8dda6` |
| rustc, cargo | 1.99.1 (`58cf8f9c3`), 1.99.1 |
| toolchain | `1.99-x86_64-pc-windows-gnullvm` |
| `adapters/salsa/oracle/Cargo.lock` SHA-256 | `7a3a4cfd24e67578564edd80ce198c15da395f28414bc8d098ff6330e3ec1db7` |
| oracle SHA-256 | `4b2e2d14a3aa6c659bb62aae8714befe4a7ec5985b29e1fd7ae542efa328e86b` |

Deviations, none in Salsa's source: this machine has no Windows SDK, so the target is
`gnullvm` linked with `rust-lld` and `crt-static`. Salsa keeps no `Cargo.lock`, so the lock
above is the oracle's own, resolved once and then used with `--locked --offline`.

`adapters/salsa/src/engine.ts` holds two variants. B1 keeps every trace in client arrays
and imports no Relation Store. B4 is the counterexample: validation walks the trace from
its end.

| Corpus | Programs | B1 same | B4 differ | Values differ in B4 |
| --- | ---: | ---: | ---: | ---: |
| directed | 10 | 10 | 3 | 0 |
| generated, seeds 1 to 3000 | 3,000 | 3,000 | 657 | 0 |
| held out, seeds 3001 to 6000 | 3,000 | 3,000 | 667 | 0 |
| fresh, seeds 6001 to 9000 | 3,000 | 3,000 | 672 | 0 |

Oracle logs were identical in two runs on every corpus. B1 first differed on 150 and 160
programs, all from one cause the reading had flagged: a query with no inputs has the
highest durability and `add_read` does not record it. After that fix, the first two corpora
are no longer independent, so the fresh corpus, generated afterwards, is the check.

### Order is observable, in execution and not in values

| Program | Oracle | B4 |
| --- | --- | --- |
| `A` changed, later query stale | `execute:q1` only | also runs `execute:q0` first |
| `A` changed, later query fresh | `execute:q1` only | also `validate:q0` |

B4 executes 68, 62 and 50 more queries over the three corpora, and takes more validation
steps, for the same answers. **Value correctness is not at stake here; which computations
run is.** The events are a diagnostic interface, documented as "notable things" that occur.
So left-to-right validation is a work-saving rule that the executable exposes, and this
experiment does not make it a semantic contract. With queries that can panic or that are
invalid after the guard changes, it might be more; that was not run.

### What B1 establishes

Salsa's in-scope semantics reproduce with all dependency state outside L0, exactly, across
9,010 programs. The trace is ordered, first occurrence wins, repeats add nothing, execution
builds a new trace, and validation goes left to right.

| Directed behaviour | Observed |
| --- | --- |
| repeated reads | one entry; 10,835 duplicate reads in the first corpus added nothing |
| same value written | still a change; the query executes |
| backdating | a changed input, an equal result, the dependent validated and not executed |
| replaced trace | an input no longer read does not invalidate |
| no inputs | not recorded; a constant across revisions |

No reverse incidence, edge identity, edge payload or multiplicity was needed.

The trace is a **validation trace**, already filtered by client policy, not the set of
everything a query read. A store holding it would hold what the algorithm chose to keep.

The ordered trace is operationally observable and relevant to work done, under Salsa's
diagnostic event surface. That is the claim; semantic correctness requiring order is not.

## M4B.3 result: B2, the literal store trace

B2 is B1 with each trace on the store's left axis. A re-execution unlinks the old relations
and relates new ones, after client-side deduplication. It uses no reuse, no `moveAfter`, no
reverse walk and no metadata, and relations are `WEAK` since edges retain nothing.

| Corpus | Programs | B1 same | B2 same |
| --- | ---: | ---: | ---: |
| directed | 10 | 10 | 10 |
| generated | 3,000 | 3,000 | 3,000 |
| held out | 3,000 | 3,000 | 3,000 |
| fresh | 3,000 | 3,000 | 3,000 |

Work, generated / held out / fresh. Identical in B1 and B2 unless shown.

| Measure | Value |
| --- | ---: |
| executions | 14,581 / 14,909 / 14,586 |
| reads recorded | 38,361 / 39,096 / 38,441 |
| duplicate reads suppressed | 10,835 / 10,836 / 10,758 |
| trace entries built | 26,166 / 26,866 / 26,269 |
| validation steps | 9,720 / 9,827 / 9,555 |

| Measure | B1 | B2 |
| --- | ---: | ---: |
| lifecycle events: relates | 0 | 26,166 / 26,866 / 26,269 |
| lifecycle events: unlinks | 0 | 11,121 / 11,432 / 11,108 |
| per execution | one trace built | **2.56 / 2.57 / 2.56 store events** |
| left-axis steps | 0 | equal to validation steps |
| right-axis steps | 0 | **0** |

Peak representation, per-program peaks summed, generated corpus. Components are kept apart
because N entries and N relations are different objects.

| Component | B1 | B2 |
| --- | ---: | ---: |
| live dependency entries | 15,272 values | 15,272 relation slots |
| trace containers | 9,401 | 0 |
| two endpoints per entry | implicit: the owner is the container, one key per entry | 30,544 |
| incidence memberships | 0 | 30,544, half of them on the unread right axis |
| generation per entry | 0 | 15,272 |
| store nodes, duplicating Salsa's keys | 0 | 21,001 |

The endpoint, membership and generation rows are a logical model of an L0 relation derived
from CONTRACT.md, not a measured layout, and not bytes.

B2 gains nothing measured here: the same behaviour, the same validation steps, no fewer
records, and a store event for every dependency of every execution. Each relation also
pays for a right incidence that nothing reads. **On this evidence the store is a more
elaborate way to keep the same list.** It does not rule out a representation with cheap
left-only incidence, which L0 does not offer, or reuse, tested next.

## M4B.4 result: B3, reuse with a client control

All reuse variants use the same matching: one hash lookup per dependency into a map of the
query's previous entries. No bounded probes, no index ladder.

| Variant | Trace lives in | Reconciliation |
| --- | --- | --- |
| B3-C | client entries and array | reused by key; array rebuilt where positions differ |
| B3-L | store left axis | reused by key; unread relations unlinked after the pass |
| B3-D | store left axis | as B3-L, unread relations unlinked first |

B3-D exists because B3-L charges the store for an algorithmic choice. Salsa has the finished
trace when it reconciles, so unread relations can go first; left in place, one unread
relation forces every later reused relation to move.

| Corpus | Programs | B3-C | B3-L | B3-D |
| --- | ---: | ---: | ---: | ---: |
| directed | 10 | 10 | 10 | 10 |
| generated | 3,000 | 3,000 | 3,000 | 3,000 |
| held out | 3,000 | 3,000 | 3,000 | 3,000 |
| fresh | 3,000 | 3,000 | 3,000 | 3,000 |
| shapes, 9 programs of 20 toggles, oracle run twice | 9 | 9 | 9 | 9 |

Over the generated corpus, 10,743 of 26,166 new trace entries were reused: 41%. Most of the
rest are first executions, which cannot reuse.

Mutations by shape. B2 is relates plus unlinks. B3-D adds moves. B3-C counts array positions
written, a different unit from a store operation, and shown only for shape.

| Shape | B1 entries built | B2 | B3-L | B3-D | B3-C writes | Reuse ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| stable | 525 | 1,025 | 25 | 25 | 25 | 95% |
| suffix drop and add | 405 | 785 | 265 | 265 | 145 | 64% |
| branch switch | 273 | 533 | 673 | 453 | 233 | 15% |
| reorder | 525 | 1,025 | 425 | 425 | 505 | 95% |
| replace half | 399 | 779 | 379 | 259 | 139 | 65% |
| alternating short branches | 63 | 123 | 123 | 83 | 43 | 32% |
| repeated reads | 126 | 246 | 6 | 6 | 6 | 95% |
| long trace, tiny edit | 504 | 984 | 284 | 84 | 44 | 91% |
| long trace, complete replacement | 273 | 533 | 733 | 493 | 253 | 7% |

| Generated corpus | B2 | B3-L | B3-D |
| --- | ---: | ---: | ---: |
| relates | 26,166 | 15,423 | 15,423 |
| unlinks | 11,121 | 378 | 378 |
| moves | 0 | 312 | 168 |
| left-axis steps | 9,720 | 35,886 | 35,886 |
| right-axis steps | 0 | 0 | 0 |

The left-axis count grows because the reconciliation pass checks each position; those are
reads that B2 does not need.

### Reading

Reuse pays when traces are stable or edited slightly, and little when they are replaced:
B3-D is 25 against B2's 1,025 on a stable trace and 493 against 533 on a full replacement.
Ordering the deaths first made more difference than expected, 284 to 84 on the tiny edit.

Reuse is **not evidence for relation identity in the store**. B3-C has the same births,
deaths and reuses by construction, and entries in Salsa carry no per-edge state, so a reused
entry preserves nothing beyond its allocation. Only reordering favours store moves in this
table, 425 against 505, in different units. `moveAfter` was exercised on a non-reactive
client, with a real use only when a trace reorders.

Both reuse designs keep a persistent map per query: 15,274 entries at peak on the generated
corpus, which B1 and B2 do not have. L0 has no pair lookup, so the store variant needs it
too. Right-axis steps are 0 in every variant.

No byte or time measurement exists. A contiguous rebuild is likely cheap per entry, and
nothing here says how a store operation compares with an array write.

### Not covered

No LRU, cycles, tracked structs, outputs, durability above the default, or parallelism. The
driver has one tracked function, so Salsa's own 134 test files were not used as a corpus.
Queries in programs are acyclic and small, and write nothing.

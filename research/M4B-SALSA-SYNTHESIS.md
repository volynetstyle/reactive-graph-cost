# M4B.5: what Salsa says about L0

Subject: `salsa-rs/salsa@6d59529`, crate 0.28.5, inputs and tracked functions only. Every
number is from [M4B-SALSA-INVENTORY.md](M4B-SALSA-INVENTORY.md).

This records evidence. It does not change [CONTRACT.md](../CONTRACT.md).

**Result.** An ordered trace, a stable entry identity and a Relation Store are three
different things. Salsa uses the first. The second is an optimization Salsa itself does not
perform. The third was not needed for either, in any variant that ran.

## 1. Question

Does an incremental query system require ordered relation state, and does that state
benefit from living in L0?

## 2. Oracle

A public-API driver over the pinned crate, Rust 1.99.1, `Cargo.lock` fixed for the driver,
`WillExecute` and `DidValidateMemoizedValue` logged. 10 directed programs, 9 shape programs,
three corpora of 3,000. Logs were identical in two runs on every corpus.

## 3. What Salsa stores

An ordered, deduplicated **validation trace**, first read first. It is already filtered by
client policy: a read of `NEVER_CHANGE` durability is not recorded. It is not the set of
everything a query read. Edges are 12-byte values naming a node key. Revisions and
durability are per query. The generation is the key's, not an edge's.

## 4. Order

| Fact | Evidence |
| --- | --- |
| validation left to right is stated at the source | `maybe_changed_after.rs:591` |
| reversing it changes executions and validations | 657, 667, 672 of 3,000 programs |
| reversing it changes a value | 0 in all corpora |

The ordered trace is operationally observable and relevant to work done, through a
diagnostic event surface. Semantic correctness requiring order is not established. Queries
that panic or are invalid once a guard changes were not run.

## 5. Variants

| Variant | Representation | Same as Salsa | Finding |
| --- | --- | ---: | --- |
| B1 | client arrays, no store | 9,010 of 9,010 | sufficient |
| B2 | left axis, rebuilt each execution | 9,010 | same work, 2.56 store events per execution |
| B3-C | client entries, reuse by hash | 9,019 | same reuse logic, no store |
| B3-L | left axis, reuse, deaths after | 9,019 | deaths in place cause moves |
| B3-D | left axis, reuse, deaths first | 9,019 | the fair store variant |
| B4 | reversed validation | differs | counterexample, values equal |

B3's 9,019 includes the 9 shape programs.

## 6. Reuse

Mutations in B3-D against literal B2, with reuse ratio
`R = |old ∩ new| / |new|`:

| Shape | R | B2 | B3-D |
| --- | ---: | ---: | ---: |
| stable | 95% | 1,025 | 25 |
| repeated reads | 95% | 246 | 6 |
| long trace, tiny edit | 91% | 984 | 84 |
| reorder | 95% | 1,025 | 425 |
| suffix drop and add | 64% | 785 | 265 |
| replace half | 65% | 779 | 259 |
| alternating short branches | 32% | 123 | 83 |
| branch switch | 15% | 533 | 453 |
| complete replacement | 7% | 533 | 493 |

Benefit rises with overlap, and overlap is not sufficient: reorder has the same `R` as stable
and costs 17 times as much. Order of survivors matters as well as their number.

**What this does not show.** Salsa does not reuse entries. The benefit above is against B2,
which is a store-backed strawman by construction. Against B1's contiguous rebuild nothing
was measured. Reuse saves store operations and array writes, and it adds a lookup per entry
and a persistent map per query, 15,274 entries at peak. So reuse is shown to reduce mutation
counts over a rebuild in the store; that it would help Salsa is not shown.

**Client operation order can dominate.** Unlinking unread relations first took the tiny
edit from 284 to 84, because one unread relation otherwise moves every later survivor. A
statement about the cost of `moveAfter` needs to fix the client's order first.

## 7. Client reuse against store reuse

B3-C has the same births, deaths and reuses as B3-L and B3-D, by construction. It
demonstrates that the same reuse semantics can be implemented without Relation Store
machinery. Its unit is an array write, B3-D's a store operation, so the tables do not rank
them. There is no byte or time measurement.

## 8. Pressure on M0 clauses

| # | Clause | After Salsa |
| --- | --- | --- |
| 1 | `identity` | entry identity is an optional optimization. Generations relate to node keys only |
| 2 | `dual-incidence` | not supported: one ordered direction; right-axis steps 0 in every variant |
| 3 | `order` | operational evidence; not a value-correctness requirement |
| 4 | `permutation` | `moveAfter` gets a non-reactive use only when a trace reorders, and B3-C does the same without it. Salsa as written never moves |
| 5 | `reachability` | not exercised: edges hold nothing |
| 6 | `gc-transparency` | not exercised |
| 7, 8 | `deferred-reuse`, `continuation` | no pressure: nothing walks a list under its own mutation |
| 9 | `metadata` | not needed on an edge |
| 10 | `multiplicity` | not needed: reads are deduplicated |
| 11 to 14 | | not relied on, or held |
| 15 | local complexity | not measured |

## 9. After five clients

| Property | Quant | Alien | polyfill | WPF | Salsa |
| --- | --- | --- | --- | --- | --- |
| ordered per-node relational state, anywhere | yes | yes | yes | yes | yes |
| relational state outside the store, run | no | no | partly, the trace | **all of it** | **all of it** |
| both incidences read | yes | yes | right only | none needed | left only, and optional |
| reposition | used, S2 on reading | variant | design B | no | reorder only, optional |
| retirement in the store | no evidence | replaceable | unused | replaceable | no pressure |

The two clients that were run with their relational state outside the store both matched
their oracle. Quant and Alien were not run that way, and they read both axes heavily, so
what they need is still open. WPF and Salsa each hold a flat per-node list. A graph walked
in both directions is the case neither touches.

## 10. Limits and decisions

- All trace costs are in logical operations, in unlike units. No bytes, no time.
- Salsa's cycles, tracked structs, outputs, LRU, durability levels and parallelism are out.
- One tracked function, small acyclic programs, no panicking queries.
- The build used `gnullvm` and `rust-lld`, because this machine has no Windows SDK.

`CONTRACT.md` stays frozen. Salsa is closed as a design input.

Next is M4.5. Its first question is whether there is one L0, or whether a flat ordered
trace substrate and a bidirectional relation substrate have been mixed. The cheapest test
of that split is the one still missing: running Quant or Alien with relational state
outside the store.

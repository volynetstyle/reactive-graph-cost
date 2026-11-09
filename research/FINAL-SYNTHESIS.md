# From Relations to Representations

### What survived a cross-client search for a VM-level incremental-computation substrate

We asked whether modern incremental systems share an irreducible relation capability that
should live below individual reactive algorithms, potentially at VM level.

**Verdict.** Across the tested clients, semantics, layouts, GC scenarios and workloads, we
found no evidence that a general relation or graph substrate should be provided by the
JavaScript VM.

Graph-shaped workloads are real and can benefit substantially from dense indexed relation
storage. The experiments show that this is a representation specialization available to
libraries, not evidence for VM ownership.

Trace-shaped workloads prefer materially different representations, which makes a universal
relation layout actively unattractive.

Within the tested single-threaded incremental workloads, no layout advantage requiring VM
ownership was found. M6 narrows this: dense storage in plain JavaScript hides relations from the
collector, see [M6-ALIEN-DENSE-RESULTS.md](M6-ALIEN-DENSE-RESULTS.md). [CONTRACT.md](../CONTRACT.md) stays as the original
hypothesis, unchanged.

## Method

Contract, then real clients, then ablations, then independent oracles, then physical
controls. Each client was frozen at a revision, inventoried by reading, ported or modelled,
checked against its own corpus or executable, and then had one mechanism removed at a time.

| Stage | Subject | Record |
| --- | --- | --- |
| M0 | abstract machine, 14 ablations with witnesses | [WITNESSES.md](WITNESSES.md) |
| M1 | Quant | [M1-QUANT-SYNTHESIS.md](M1-QUANT-SYNTHESIS.md) |
| M2 | Alien Signals | [M2-ALIEN-SYNTHESIS.md](M2-ALIEN-SYNTHESIS.md) |
| M3 | `signal-polyfill` and the TC39 proposal text | [M3-POLYFILL-SYNTHESIS.md](M3-POLYFILL-SYNTHESIS.md) |
| M4A | WPF weak events, on the CLR | [M4A-WPF-SYNTHESIS.md](M4A-WPF-SYNTHESIS.md) |
| M4B | Salsa, on its crate | [M4B-SALSA-SYNTHESIS.md](M4B-SALSA-SYNTHESIS.md) |
| M4.5 | behavioural synthesis, Alien on flat lists | [M4.5-BEHAVIOURAL-SYNTHESIS.md](M4.5-BEHAVIOURAL-SYNTHESIS.md) |
| M5 | tapes, density, cost, crossover, GC, JS dense slots | [M5-PHYSICAL-RESULTS.md](M5-PHYSICAL-RESULTS.md) |

## 1. What is common at the level of the problem

Incremental systems constantly maintain ordered relational state. It comes in at least two
shapes.

| Family | Shape | Clients | Favours |
| --- | --- | --- | --- |
| trace-shaped | owner to ordered sequence | Salsa, WPF, the polyfill's dependency trace | contiguous storage, sequential traversal, replacement or copy, no edge identity |
| graph-shaped | node to persistent relations to node | Alien; Quant by reading; the polyfill's push side | persistent identity, bidirectional traversal, cheap structural mutation, dense indexed storage |

There is no single good physical graph for all of these.

## 2. What did not survive client-minimality

| Candidate L0 property | Outcome |
| --- | --- |
| dual incidence | not universal. Salsa reads one direction, and WPF needs neither in a store |
| stable relation identity | used by Quant and Alien. Not needed by Salsa or WPF |
| edge payload | none in Salsa or WPF, external in the polyfill, meaning differs elsewhere |
| multiplicity in the store | duplicates are observable in WPF, and fit a client array |
| retirement, epochs, continuation | no client-minimal support. Replaced by a client log in Alien and a journal in WPF |
| retention fixed with topology | separable. The polyfill's rule makes retention follow activation |
| order | needed often, in a form that is free |

A logical relation is not a relation object.

## 3. What each client contributed

| Client | Contribution |
| --- | --- |
| Quant | the strongest case for persistent bidirectional graph representation, and the least independent, since it shares ancestry with this work |
| Alien | genuine bidirectional work, without VM ownership of the structure. Flat client lists passed 198 of 198 tests and 0 of 4,000 search programs differed |
| polyfill | separated persistent dependency knowledge from live push topology |
| WPF | a push channel that retains nothing; a membership record and its handler with independent lifetimes; continuity that needed no retired store relations |
| Salsa | ordered incremental dependency state that is a filtered validation trace rather than a dependency graph |

WPF and Salsa were checked against external executables, the CLR and the Salsa crate, because
their value here depended on not being judged by our own translations.

## 4. Why behavioural evidence was not enough

Every tested behaviour could be reproduced by client-owned state, and for Quant, Alien and the
polyfill that was true of their own sources before any experiment. That alone says nothing
about a VM primitive, since almost any primitive can be emulated. Behaviour identifies
required capabilities, not their substrate. The remaining question was physical.

## 5. Physical results

Measured on one machine: ten fresh processes per language, each held on the two performance
cores, the order of representations rotating with the process. Numbers are medians across
processes. Tapes are recorded from the real corpora, plus two synthetic graphs. All values here
come from `paper/data/results.json`.

**Trace-shaped workloads prefer packed contiguous storage, mostly for density.**

| Salsa | Bytes per entry | ns per operation |
| --- | ---: | ---: |
| `TracePacked`, with its recording buffer | 28.8 | 48.0 |
| leanest store, left incidence only | 61.1 | 54.7 |
| `StoreAoS` rebuild | 85.2 | 53.0 |

The time gain over the best store is 1.11 times, and the process ranges overlap slightly. On
WPF, copy-on-write arrays took 36.6 ns per operation, against 64.7 to 122 for linked forms, with
separate ranges.

**Graph-shaped workloads benefit from dense indexed slots, and that is a layout advantage.**

| Objects or records over dense SoA | Quant | Synthetic calm | Synthetic churn |
| --- | ---: | ---: | ---: |
| Rust | 1.19 | 2.73 | 3.66 |
| plain JavaScript, typed arrays | 1.42 | 3.42 | 4.71 |

The pattern reproduces in JavaScript, and more strongly. Rust remains 2.2 to 3.3 times faster
in absolute terms on the same logical work, and nothing here ties that to a limit of the
language rather than to the implementation.

**Neither rebuild nor reuse is universally cheaper.** With reads arriving one at a time, a
packed array overwritten in place was cheapest in all 60 cells of the grid, by 1.6 to 30 times
over the best linked strategy (median 23). A packed array with a fresh allocation lost to linked
reuse in 3 of 60 cells, all short traces with an unchanged prefix, by up to 8.6 times. Elsewhere
it won, and the best linked strategy cost a median of 9 times as much. An earlier grid had
reported 4.5 to 500 times for packed rebuild: it copied a sequence already contiguous, so it
measured a block move, and it omitted the cursor strategies trackers actually use. The result
concerns a client that does not read back-edges and whose entries carry no per-edge state worth
keeping. A record with such state could change this.

## 6. Garbage collection

No missing capability was found. For the tested lifecycle, continuation and retention
scenarios, `WeakRef`, `WeakMap` and `FinalizationRegistry` were sufficient, with no hook before
a collection. A record in an ordinary array carries continuity, and a failed `deref` at the
visit reports the death. Eleven scenarios passed 20 of 20, and allocation alone cleared a target.

**Methodological note.** With `deref()` on every turn, a target was cleared in 0 of 10 trials
across about 14 major collections. With polling every 100 turns or rarer it was cleared in 10 of
10. Polling every 2 or 10 turns is intermediate and moves between executions of the experiment.
Measurement can change liveness: a GC benchmark that keeps asking an object whether it has died
can delay the death it measures. V8 was not instrumented, so no mechanism is claimed.

## 7. Scope

These are boundaries of the result, not reasons held in reserve for a substrate. Not tested
is not evidence pending.

- One machine, no hardware counters. Processes pinned to the performance cores: slowest over
  fastest process has a median of 1.14 across series and at most 1.68. Unpinned it was 1.72 and 3.41.
- Corpora are behaviour suites, not application workloads. Tiny programs weigh heavily.
- The JavaScript dense-slot control replays tapes. No client was rewritten over typed arrays,
  and a client that must reach an integer id through a `WeakMap` pays about eleven times the
  cost of a field per lookup.
- Single-threaded. Concurrent collection, multi-threaded access and graphs shared between
  libraries were not examined.
- GC results are feasibility results on one V8 build. ECMAScript promises no collection.
- Three of the five clients are signal runtimes. Quant was not run on flat lists.

M5E, integration into a runtime, was gated on a finalist with a VM-specific advantage. None
appeared, so it was not run, and the gate stands.

## 8. Side results

| Result | Status |
| --- | --- |
| `signal-polyfill` sink order differs from the proposal after a swap-remove, and reaches `notify` | shown by directed programs |
| WPF at `49ae5cd`: a static add during delivery is lost | confirmed on the CLR, frozen defect candidate |
| WPF: removing a never-added handler releases the only registered one | confirmed on the CLR, frozen defect candidate |
| WPF: with duplicates, table and list release different delegates | confirmed on the CLR, frozen defect candidate |
| Salsa: left-to-right validation changes which queries run, not their values | observable through diagnostic events |

## Open question, not answered here

If representation should remain implementation-defined, is there any common semantic boundary
worth standardizing?

The present study did not test interoperability. It tested a substrate. Any further work on
that question is a separate study, and its first hypothesis should be that no protocol is
needed.

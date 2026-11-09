# M5.0 to M5D: physical results

Question: does a VM-level substrate give anything beyond the best specialized client
representation? Plan and gates are from [M4.5](M4.5-BEHAVIOURAL-SYNTHESIS.md).
[CONTRACT.md](../CONTRACT.md) is unchanged.

Reproduce: `node adapters/m5/extract.mjs`, then build and run `adapters/m5/harness`, then
`node --expose-gc adapters/m5/gc-feasibility.mjs`. Machine output is in `.cache/m5`.

**Result.** Gate 1 and 2 give a split by workload family and no universal winner. Gate 3 found
no capability missing from existing JavaScript. M5E was not triggered.

## M5.0 Tapes

| Tape | Source | Operations |
| --- | --- | ---: |
| Quant | its corpus through the port | 17.4 million |
| Alien | its corpus | 14,361 |
| polyfill | its corpus | 898 |
| Salsa | 9,009 programs, one `T` trace or `V` validation per step | 74,290 |
| WPF | 6,000 programs, membership and delivery events | 54,270 |

Graph tapes are recorded by a subclass of the reference machine, so ports were not modified.
Plus two synthetic graphs of 20,000 consumers at degree 16, with 1% and 40% churn per round,
and the M5C grid.

Quant's tape ends where its last worker exited, and a truncated tail is dropped by the harness.

## Representations

| Name | Form |
| --- | --- |
| `TracePacked` | a boxed slice of dependency ids per query |
| `TracePersistent` | array and hash map per query, reused |
| `WpfCow` | copy-on-write arrays per source |
| `ClientIntrusive` | individually allocated records joined by pointers |
| `StoreAoS` | one 32-byte slot per relation with six links, metadata, generation |
| `StoreSoA` | the same fields in eight arrays |
| `StoreSplit` | left incidence only; right incidence absent |

Stores pay for their whole structure on every workload.

## M5A Density and M5B cost

Peak allocated bytes per peak live relation, then nanoseconds per tape operation. Each cell is
one machine, the median across ten fresh processes pinned to the performance cores, of the
median of 5 to 15 replays in each process.

### Graph-shaped

| Workload | `ClientIntrusive` | `StoreAoS` | `StoreSoA` |
| --- | ---: | ---: | ---: |
| Quant, bytes | 149.0 | 113.4 | 96.9 |
| Quant, ns | 2.68 | 2.07 | 2.22 |
| synthetic calm, bytes | 66.0 | 84.4 | 64.7 |
| synthetic calm, ns | 14.5 | 9.72 | 5.46 |
| synthetic churn, bytes | 131.6 | 94.2 | 94.2 |
| synthetic churn, ns | 28.5 | 11.2 | 8.33 |
| Alien, ns | 5.72 | 3.79 | 4.54 |
| polyfill, ns | 7.02 | 5.96 | 11.4 |

Alien and polyfill byte figures, 150 to 1,200 per relation, reflect many tiny programs whose
node tables outweigh their few relations, and are not comparable.

### Trace-shaped, Salsa

| Representation | Bytes per entry | ns per operation |
| --- | ---: | ---: |
| `TracePacked` | **28.8** | **48.0** |
| `StoreSplit` rebuild | 61.1 | 54.7 |
| `StoreSoA` rebuild | 70.2 | 182 |
| `StoreAoS` rebuild | 85.2 | 53.0 |
| `StoreAoS` cursor | 91.1 | 76.7 |
| `ClientIntrusive` rebuild | 91.6 | 74.1 |
| `ClientIntrusive` cursor | 99.8 | 81.1 |
| `TracePersistent` | 143.4 | 105 |
| `StoreAoS` hash reuse | 178.7 | 132 |
| `ClientIntrusive` hash reuse | 208.4 | 136 |

`TracePacked` records each read into a scratch buffer, which its bytes include. Its time gain
over `StoreAoS` rebuild is 1.11 times and the process ranges overlap slightly. The density gain
over the leanest store is 2.1 times.

### Copy-on-write, WPF

| Representation | ns per operation |
| --- | ---: |
| `WpfCow` | **36.6** |
| `ClientIntrusive` freeze | 64.7 |
| `StoreAoS` freeze | 65.7 |
| `StoreSoA` freeze | 122 |

WPF bytes are dominated by a fixed table of 32 sources per program and are not reported.

## M5C Rebuild against reuse

Nanoseconds per trace entry, at survival `S` and reorder none or chaotic. Reads arrive one at a
time. The full 60-cell grid is in `paper/tables/crossover-full.tex`.

| N | S | Order | Packed, fresh | Packed, in place | Best hash | Best cursor | Best tail |
| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 8 | 0 | none | 6.77 | 0.57 | 66.9 | 101 | 16.3 |
| 8 | 1 | none | 6.81 | 0.48 | 29.7 | 1.01 | 0.79 |
| 512 | 0.9 | none | 0.77 | 0.55 | 25.0 | 9.33 | 3.37 |
| 512 | 1 | none | 0.77 | 0.44 | 22.0 | 1.54 | 1.52 |
| 512 | 1 | chaotic | 0.74 | 0.56 | 24.1 | 49.3 | 12.1 |
| 65536 | 0 | chaotic | 0.89 | 0.54 | 69.6 | 92.2 | 13.2 |
| 65536 | 1 | none | 0.88 | 0.46 | 29.3 | 2.34 | 2.34 |

**A contiguous form won every cell, if it may overwrite its buffer.** In place beat the best
linked strategy in all 60 cells, by 1.6 to 30 times (median 23). A fresh allocation lost in 3 of
60, all short traces with an unchanged prefix: `N=8, S=0.9`, `N=8, S=1`, `N=64, S=1`, by up to
8.6 times. Reuse is sensitive to order as well as overlap.

An earlier version of this grid reported "packed rebuild cheapest in 60 of 60, by 4.5 to 500
times". It copied a sequence that was already contiguous, so it measured a block move against
per-entry work, and it had no cursor strategies. That claim is withdrawn.

Linked columns maintain both axes and packed ones have no back-edges, so the grid prices a
capability a trace-shaped client does not read. A record that carried per-edge state worth
keeping would change this, and Salsa's do not.

## M5D Real collector, JavaScript only

Harness-only `global.gc`, no client hook. 20 of 20 on each, unless noted.

| Property | Result |
| --- | --- |
| unreachable listener is not delivered in a later job | holds |
| a `WeakRef` created in this job holds its target to the end of the job | holds |
| a target not dereferenced in this job **can die during a callback** | holds |
| a target dereferenced earlier in the job survives a collection | holds |
| traversal continues over every entry with a collection in each callback | holds |
| a finalizer does not run during synchronous execution | holds |
| structural cleanup is later than endpoint death | holds |
| a cycle through client records does not retain itself | holds |
| a handler lives while its target does, without extending it | holds |
| retention follows activation without changing the record | holds |
| allocation alone clears a target, no forced collection | holds |

Client records in an ordinary array carry continuity across a collection, with no journal and
no "before collect" point. The explicit-collection limit on earlier "replaceable" verdicts is
therefore much weaker here: a dead target is a failed `deref` at the moment of the visit.

**A trap found on the way.** With `deref()` on every turn, 0 of 10 targets were cleared across
about 14 major collections, and with polling every 100 turns or rarer, 10 of 10 were
(`adapters/m5/gc-observer.mjs`). Polling every 2 or 10 turns is intermediate and unstable. A
client that polls weak references can delay the collection it is waiting for.

No concurrent mutation, no multiple threads, one V8 build (Node 25.2). JavaScript's guarantees
are what this exercises, and they promise no collection at all, so these are feasibility
results.

## Gates

| Gate | Answer |
| --- | --- |
| 1 density | trace-shaped: no, packed is 2.1 times denser than the leanest store. Graph-shaped: within range of records, and denser at Quant |
| 2 cost | trace-shaped: no. WPF: no. Graph-shaped: dense layouts beat individually allocated records by 1.2 to 3.7 times on the large tapes |
| 3 GC | no capability missing from `WeakRef`, `WeakMap`, `FinalizationRegistry`; no addon or V8 work justified |
| 4 end to end | **not run**, since nothing survived the earlier gates as VM-specific |

## The limit that decides the graph-shaped result

The graph-shaped win is a **layout** win: dense slots against pointer-joined records, in Rust.
Nothing about it needs a VM. A JavaScript client can store the same fields in typed arrays, and
that form was not measured. `ClientIntrusive` also counts requested bytes only, without
allocator headers, and does not represent JS object overhead, which would make real clients
heavier than shown. So this table supports "dense slots are a good layout for graph work" and
not "the VM should provide them".

The strongest remaining control is therefore Alien or Quant over typed-array slots in plain
JavaScript, against the same tapes. If it matches the Rust layouts within a small factor, no
reason remains for a VM-level graph substrate on these measures.

## Limits

One machine, Windows, no hardware counters. Every process is held on the two performance cores
(mask 0xF) and the order of representations rotates with the process. Slowest over fastest
process has a median of 1.14 across series and at most 1.68. Tiny programs dominate the Alien,
polyfill, Salsa and WPF tapes, so fixed per-program costs weigh heavily: `StoreSoA` pays for
eight small allocations per program, and its poor Salsa and polyfill times reflect that. Only
Quant and the synthetics are large. Corpora are behaviour suites, not application workloads.

## M5F: JavaScript dense-slot control

`node --expose-gc --max-old-space-size=12000 adapters/m5/js-dense.mjs .cache/m5/tapes`, Node
25.2. Same tapes as the Rust harness, the synthetics dumped from it. Three layouts with the
same capability: objects joined by references, one `Int32Array` of 8-word slots, and eight
`Int32Array`s. Each layout has its own compiled replay loop, so no megamorphic call is measured.

The criterion is the ratio inside each language, not JavaScript against Rust.

| Workload | Rust records / SoA | JS objects / SoA | JS objects / AoS |
| --- | ---: | ---: | ---: |
| Quant | 1.19 | 1.42 | 1.42 |
| synthetic calm | 2.73 | 3.42 | 1.85 |
| synthetic churn | 3.66 | 4.71 | 2.57 |

| Workload | ns/op: JS objects | JS AoS | JS SoA | Rust SoA | JS SoA / Rust SoA |
| --- | ---: | ---: | ---: | ---: | ---: |
| Quant | 10.4 | 7.22 | 7.39 | 2.22 | 3.3 |
| synthetic calm | 45.3 | 24.8 | 13.1 | 5.46 | 2.5 |
| synthetic churn | 87.1 | 33.1 | 17.8 | 8.33 | 2.2 |

**The dense-layout advantage reproduces in plain JavaScript, and is larger there.** It is a
property of dense indexed storage, available to a library.

Density: typed slots are 32 bytes of payload per slot in both languages. Peak bytes per live
relation are 111.2 on Quant and 81.9 on the synthetics in JS, against 96.9 and 64.7 to 94.2 for
Rust SoA. The JS figure counts old and new arrays during each doubling, and the Rust allocator
may grow in place, so these are the same order and not a ranking. JS objects measured 96.3
bytes per relation after a collection, excluding any slack, on the synthetics.

The residual is 2.2 to 3.3 times against Rust, on identical logical work. Nothing here ties
it to a limit of the language rather than to bounds checks, tiering or this implementation.
So the condition for M5E is not met.

The boundary is real and separate. Reaching a node's integer id costs 2.20 ns from a field on
the client object, loop included, and 23.7 ns through a `WeakMap`. The tapes assume the former.
A client that has no field to put it on pays about eleven times more for each lookup, which
could consume the dense layout's gain.

The tiny Alien tape is dominated by warm-up: across processes objects took 30 to 121 ns per
operation, so no conclusion is drawn from it.

## Verdict after M5F

Trace-shaped work wants contiguous storage, and it is the density and not the time that is
decisive on Salsa. Graph-shaped work wants dense indexed slots. Both
are available to a library, and these are different layouts. The GC capabilities tested are
available through existing weak APIs. **There is no evidence here for a VM-level graph
substrate.** That is the evidence of one machine and these tapes, and it does not cover
concurrent collection, multi-threaded access, or cross-library sharing of a graph.

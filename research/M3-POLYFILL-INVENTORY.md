# M3.0 and M3.1: signal-polyfill inventory and capability matrix

Two layers of evidence, kept apart:

| Layer | Subject | Answers |
| --- | --- | --- |
| executable client | `proposal-signals/signal-polyfill@0.2.2`, `fba09f8e225f52a9d082bc755e37098c29440bf9` | what this implementation does |
| semantic reference | `tc39/proposal-signals`, `9124ed91b24bb02ff7408b2fcf5abb6e18b095d7`, README | what the proposal says Signals should do |

`spec.emu` at that revision is 9 lines, so the README's proto-specification is the
reference. The polyfill is one implementation, not the proposal. Tests added upstream
after `fba09f8` are a post-hoc corpus only.

Mapping: consumer is left, producer is right. `producerNode` is the left axis and
`liveConsumerNode` the right axis.

Everything here comes from reading. Nothing has been ported or run. L0 means
[CONTRACT.md](../CONTRACT.md), unchanged.

## M3.0a Frozen material

| Item | Finding |
| --- | --- |
| Runtime | `src/graph.ts` (520), `computed.ts`, `signal.ts`, `wrapper.ts` (286) |
| Corpus | 16 test files, 39 `it` cases by count, public API through `src/wrapper.js` |
| Corpus access to internals | no test reads graph fields; introspection goes through `Signal.subtle` |
| Impurity | `prohibited-contexts.test.ts:5` allows writes during a computed |

## M3.0b State

There is no edge object. A relation exists only as positions in parallel arrays.

| Field | Meaning | Required capability |
| --- | --- | --- |
| `producerNode[i]` | i-th source of a consumer | left axis, reachable by position |
| `producerLastReadVersion[i]` | version seen at read | one mutable word: observation evidence, a JS number |
| `producerIndexOfThis[i]` | this edge's index in the producer's live array | none on the surface; known-handle `unlink` replaces it |
| `nextProducerIndex` | running cursor | client-local |
| `liveConsumerNode[j]` | j-th live consumer | right axis, **only for live consumers** |
| `liveConsumerIndexOfThis[j]` | index back into the consumer's arrays | none on the surface |
| `version`, `lastCleanEpoch`, `dirty`, `value` | node state | client-local |

## M3.0c Relation mutations

| Site | Effect | L0 equivalent |
| --- | --- | --- |
| `producerAccessed` same producer at index, `graph.ts:252` | stamp the version | `setMeta` |
| `producerAccessed` different producer, `:235-261` | overwrite position `idx`; remove the old live entry if live; add a new one if live | `unlink`, `relate`, `moveAfter(left)` |
| `consumerAfterComputation`, `:368-383` | remove and truncate the unread suffix | `unlink` per relation |
| `producerAddLiveConsumer`, `:446-462` | append on the right; on 0→1 live, add this node to all its producers, recursively | no equivalent: **right incidence added later** |
| `producerRemoveLiveConsumerAtIndex`, `:467-505` | swap the last entry into the hole; on 1→0 live, remove from all producers, recursively | `unlink` keeps order; swap is `moveAfter(right, tail, …)` then `unlink` |
| `Watcher.unwatch`, `wrapper.ts:232-252` | swap-remove on the **left** axis of a watcher | same, on the left |

A reorder is overwrite by position. There is no reuse by pair and no move. `[A, B]`
re-read as `B, A` removes and re-adds both live entries. A repeated read `A, B, A`
keeps a third position, so a consumer's sources may hold the same producer twice.

## M3.0d Traversal

| Direction | Sites | Purpose |
| --- | --- | --- |
| left forward by index | `consumerPollProducersForChange` `:394` | validation, re-reading the array each step |
| left forward by index | `:371`, `:456`, `:482` | suffix removal, liveness transitions |
| left reverse by index | `wrapper.ts:232` | `unwatch` |
| right forward | `producerNotifyConsumers` `:312` | notification, a `for...of` over the live array |
| full array reads | `introspectSources`, `introspectSinks`, `getPending` | observable through `Signal.subtle` |

## M3.0e Held across a callback

| Site | Held | Across | User code | Used after |
| --- | --- | --- | --- | --- |
| `consumerPollProducersForChange` | index `i` | `producerUpdateValueVersion` | yes: a computation | re-reads the current array at `i + 1` |
| `producerNotifyConsumers` | array iterator | `consumerMarkedDirty` | yes: `notify` | continues over the current array |
| `producerAddLiveConsumer` `:454` | nothing relational | `watched` | yes | adds entries afterwards |
| `producerRemoveLiveConsumerAtIndex` `:481` | index `idx` | `unwatched` | yes | removes entries afterwards |

The polyfill holds **positions**, not relations. Continuation after mutation is
"whatever is now at the next index". This is a third behaviour, different from
Quant's leftover pointer and from Alien's frozen field. No relation is ever read
after removal, because none exists to read. Each row is a potential hazard only.

`notify` is guarded against reads and writes by `inNotificationPhase`, but
`Watcher.unwatch` is not, so swap-removal during the `for...of` looks reachable.

## M3.0f Liveness

| Fact | Site |
| --- | --- |
| a consumer holds strong array references to its sources always | `producerNode` |
| a producer holds its consumer only while that consumer is live | `liveConsumerNode` |
| liveness is reference-counted and propagates transitively | `:453-459`, `:477-485` |
| a watcher is always live | `consumerIsAlwaysLive` |
| non-live computeds validate by polling, with an epoch shortcut | `:277-298` |

Not used: `consumerDestroy` and `setPostSignalSetFn` are exported and never called by
the wrapper.

## M3.1 Capability matrix against unchanged L0

| Polyfill requirement | L0 primitive | Gap | Classification |
| --- | --- | --- | --- |
| left presence without right presence | `relate` creates both | **yes** | **conflict with clause 2, dual incidence**: most important finding |
| adding right incidence when a node becomes live | none | **yes** | same conflict |
| endpoints | `left`, `right` | none | L0 used |
| left order | left order | none | L0 used; read order is normative in the proposal |
| right order | order-preserving | differs | polyfill swap-removes; proposal says ordered, see below |
| position-indexed access | `first`, `next` | cost | cursor use fits; the validation loop continues by index |
| overwrite at a position | `unlink`, `relate`, `moveAfter` | composition | L0 sufficient |
| identity-preserving reorder | `moveAfter` | not needed | unused |
| stable relation identity | handles | not used by the client | relations have no identity here |
| parallel relations | multigraph | none | used: `A, B, A` |
| one mutable word | `meta` | width | observation evidence, as in Quant; JS number domain |
| known-relation removal | `unlink` | none | replaces the cross-index arrays |
| swap-remove | `moveAfter` then `unlink` | composition | needed only to reproduce order literally |
| transitive liveness | none | none | client policy |
| `watched`, `unwatched` callbacks | none | none | client-local; clause 14 holds |
| retention changing with liveness | fixed at `relate` | **yes, for M3 lifetime work** | M0 decision "retention fixed" under pressure |

Remaining L0 capabilities:

| L0 capability | Status for this client |
| --- | --- |
| epochs, retired readability, clause 8, retirement chain | no use found by reading: positions, not relations, are held |
| outermost-only quiescence | no use found by reading |
| generation | not applicable to the client as written |
| directional reachability | this is the first client whose motivation includes it; deferred to a later step |
| failure atomicity, local complexity | not relied on; not measured |

## Polyfill against the proposal

Differences by reading. Each is a question for the port or a result in itself.

| Topic | Proposal README | Polyfill `fba09f8` |
| --- | --- | --- |
| `sources` | "An ordered set" (`:536`) | array; `A, B, A` keeps a repeat |
| `sinks` | "An ordered set" (`:537`) | swap-remove breaks insertion order |
| Watcher `signals` | ordered set (`:593`) | swap-remove in `unwatch` |
| read order | significant and observable (`:440`) | kept, by position |
| `watched`/`unwatched` during callback | `frozen` set around them (`:612-614`, `:625-627`) | no such guard |
| `unwatch` while frozen or of an unwatched signal | throws (`:619-620`) | no throw found |
| several `notify` errors | AggregateError after all run (`:495`) | `for...of` with no catch |
| unwatched computeds collectable | stated goal (`:200`, `:391`, `:442`) | no reverse entry, so yes |
| computed callback purity | "generally" pure; side effects "with care" (`:319`) | writes allowed, tested |

So the two questions M2 left open get different answers from the two layers. The
proposal text says subscribers are ordered; this implementation does not keep them
ordered after a removal.

## Questions M2 prepared

| Question | Reading so far |
| --- | --- |
| dependency: fact or subscription occurrence? | neither: a position in an array |
| is subscriber order observable? | proposal: ordered. Polyfill: not preserved. Ablation to come |
| identity-preserving relation needed? | no use found |
| multiplicity or birth semantics? | repeats exist; no pair concept |
| what survives unwatched? | left arrays survive, right entries do not |
| payload domain? | JS number, observation evidence |

## Choice made before the port

Clause 2 does not fit: a non-live consumer has left entries and no right entries.
Option A was taken: a relation exists only while the consumer is live, and non-live
sources stay in client arrays. Always-present reverse incidence, the design of TC39
issue 252, is kept as a later ablation. Changing L0 first was ruled out.

## M3.2, M3.3, M3.4 result: port by option A

The port is in `adapters/polyfill/`. `src/graph.ts` and `src/wrapper.ts` are generated
from the frozen sources by `derive.mjs`, and six other source files are verbatim, all
checked by `sync-corpus.mjs`. The store holds live subscriptions only. No epochs were
needed or added.

| Run | Result |
| --- | --- |
| original `fba09f8` | 39 of 39 |
| port | 39 of 39 |

Both sides compile `wrapper.ts` with TypeScript. Without that, two `guards` tests fail
on the original as well, because `Signal.isState` is left undefined by the default
transpiler here. That was a harness problem, not a runtime one.

The result does not mean L0 supports this client. **L0 represents the push subgraph.
The persistent dependency trace of every consumer stays outside the store.**

Right-axis order is reproduced literally: removal moves the last live consumer into
the vacated place. Notification continues by position, as the original's iterator
does. Both are computed by walking the right axis.

### Accounting

Counts are in [M3-ACCOUNTING.md](M3-ACCOUNTING.md). The corpus is 39 tests, so these
are small numbers from a behaviour suite.

| Question | Measured |
| --- | ---: |
| trace entries written with no relation to back them | 46 |
| trace entries with no relation at the end of the files | 39 of 59 |
| activations, 0→1 | 48 |
| deactivations, 1→0 | 28 |
| deepest cascade | 3 |
| relations born or removed because the trace changed | 46, 25 |
| relations born or removed only because liveness changed | 6, 7 |
| right removals needing the swap | 3 of 32 |

The 6 and 7 are new compared with Quant and Alien: the same logical dependency can gain
and lose its reverse incidence with no change in the trace. Relation history here has
a further dimension, activation state.

The store's left axis is not read by this port, since the client arrays are
authoritative. Left order in L0 therefore gets no evidence from this design.

| External structure | Class |
| --- | --- |
| `producerNode`, `producerLastReadVersion` | pull trace, outside L0 |
| `bound`, `storeId` | binding: 2 associations per node |
| `producerIndexOfThis` as handles | client state, replaces cross-index arrays |

`liveConsumerIndexOfThis` and the index fix-ups disappeared, because a known handle
replaces position bookkeeping.

## M3.5 result: right order, variant B, differential search

Generated tables and shrunk witnesses are in [M3.5-ABLATIONS.md](M3.5-ABLATIONS.md).
[CONTRACT.md](../CONTRACT.md) is unchanged.

| Variant | Change | Corpus |
| --- | --- | ---: |
| port | control | 39 of 39 |
| stable-erase | right removal keeps order, no swap | 39 of 39 |
| B-stable | every dependency is a relation, `meta` 1 means active, push filters; right order is birth order | 39 of 39 |
| B-tail | B-stable, and activation moves the relation to the right tail | 39 of 39 |

The frozen corpus distinguishes none of them. Everything below comes from the search,
3000 programs per lane, or from directed programs.

### Search validity

Three defects in the first runs were corrected before any number was used. They matter
because each produced plausible figures.

| Defect | Effect | Correction |
| --- | --- | --- |
| a `watched` hook that reads recurses to an engine stack overflow | depth depends on the JIT, so logs differed at random; 349 of 3000 "divergences" for the port | hook actions bounded to 4 per program; any overflow counts as inconclusive |
| overflow, or a throwing hook, leaves `activeConsumer` set | later programs inherited a foreign consumer | reset between programs; a leak still detected counts as inconclusive |
| a difference in sink order and a difference in behaviour were one count | right order looked like general breakage | separate classes, attributed by cause |

The final run has `self` 0 and `inconclusive` 0 in every row, where `self` is the
reference against itself. Lane P counts matched the first run exactly: 0, 9, 132, 9, 124
and 0 in total.

### Lanes

Programs per 3000, by cause. Order means only a sink list differs.

| Variant | Reference | P order | P plain | P notify threw | E order | E plain | E notify threw | E hook threw |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| port | frozen | 0 | 0 | 0 | 0 | 0 | 0 | 57 |
| stable-erase | frozen | 9 | 0 | 0 | 8 | 0 | 0 | 57 |
| B-stable | frozen | 119 | 4 | 9 | 177 | 2 | 31 | 64 |
| B-tail | frozen | 9 | 0 | 0 | 8 | 0 | 0 | 64 |
| B-stable | stable-erase | 111 | 4 | 9 | 174 | 2 | 31 | 9 |
| B-tail | stable-erase | 0 | 0 | 0 | 0 | 0 | 0 | 9 |

No lane P program had a hook throw.

The port is indistinguishable from the original in lane P. In lane E it differs only in
programs where a hook threw. The shrunk witness is a write inside `watched`, which
throws after `producerNode[idx]` is set and before its handle is. A later `unwatch` then
fails with `RangeError` in the original and `TypeError` in the port. Only the shrunk
witness was read, not all 57.

### Right order

Random search reaches a swap rarely, in 9 of 3000 programs, and there it shows only in
`introspectSinks`. Two directed programs without any throw settle the question.

| Program | frozen, port | stable-erase | B-stable | B-tail |
| --- | --- | --- | --- | --- |
| swap: sinks `w0, w1, c0`, unwatch `w0`, set | `w2, w1` | `w1, w2` | `w2, w1` | `w1, w2` |
| birth: `c0` reads before `w1` watches, activates after, set | `w1, w2` | `w1, w2` | `w2, w1` | `w1, w2` |

So right order is observable behaviour, not only introspection. It reaches `notify`
order, and README:490 makes that order normative: depth-first over `sinks`, which
README:537 calls an ordered set.

| Claim | Classification |
| --- | --- |
| right order determines notify order | required by observable behaviour |
| position follows the moment of activation, not of first read | required by observable behaviour |
| swap on removal | required to reproduce frozen behaviour only; the proposal's ordered set is the stable-erase result |

The B-stable agreement with frozen on the swap program is a coincidence of that program.

### B-semantic

Materialising every dependency works semantically, with one condition. Birth order is
wrong: B-stable differs from stable-erase in 124 programs of lane P, 4 of them with no
throw at all. B-tail differs in none. **Order on the right axis encodes activation
time, so a persistent relation must be repositioned when it starts participating in
push.** Under A this falls out of insertion and needs no operation.

This is a use of `moveAfter` that neither Quant nor Alien had: reposition caused by a
state change of the relation, not by re-reading it.

| Corpus cost | A (port) | B |
| --- | ---: | ---: |
| relations present at the end | 20 | 59 |
| of which not participating in push | 0 | 39 |
| births because a read happened on a non-live consumer | 0 | 46 |
| births and deaths caused only by liveness | 6 and 7 | 0 |
| `setMeta` flips for liveness | 0 | 6 and 7 |
| right-walk steps skipping inactive relations | 0 | 59 |

B avoids 13 structural changes and pays 46 extra births, 13 flips and 59 skip steps, on
a small behaviour corpus. Neither the repositions in B-tail nor deaths of inactive
relations are counted here. This is not a performance result.

### B-GC

Model level only: `test/polyfill-gc-model.test.ts`, 6 tests on the reference machine.
The running port has no collector.

| Topology | Result |
| --- | --- |
| reverse incidence, unwatched computed, `STRONG` | collected, despite the incidence |
| rooted watcher | keeps the computed and its sources |
| after `unwatch` | computed collected, state stays |
| watched chain, only the state reachable, `STRONG` | **chain collected** |
| same, with right-to-left retention | chain stays |

README:391 requires the opposite of the fourth row. Watched signals stay alive while
their states are reachable, and unwatched ones must not be held. So right-to-left
retention has to change with activation, and in L0 retention is fixed at `relate`.

A relation can only change retention by being replaced, which is `unlink` and `relate`.
That restores the births and deaths B removed and loses the position, so B and
retention-by-replacement cancel out. This is reasoning from the model, not a measured
variant. The pressure on the M0 decision "retention fixed" is now concrete, and it
belongs to the gate after M3 and M4, not here.

### What this adds to the three axes

Existence of a relation, retention ability and participation in push are separable, and
the polyfill's design ties them together only because a relation is present exactly
when it participates. Position on the push axis belongs with participation.

| Property | Under A | Under B |
| --- | --- | --- |
| dependency exists | client trace | relation |
| participates in push | relation exists | `meta` |
| retention by the producer | relation exists | needs mutation, not in L0 |
| position in push order | insertion | `moveAfter` at activation |

### Polyfill defects observed

These are properties of `fba09f8`, kept out of the frozen contract.

| Defect | Where | Lane |
| --- | --- | --- |
| `Watcher.watch` has no `try/finally`, so a throwing `watched` hook leaves `activeConsumer` set | `wrapper.ts:215-219` | E |
| a `watched` hook reading under a live consumer recurses without bound, because the entry is added after the hook | `graph.ts:454` | E |
| a throwing `notify` stops the push partway, where the proposal saves errors until all have run | `graph.ts`, README:492-495 | P |

### Limits

Random search covers order weakly, so the directed programs carry the claim. Hook
actions are bounded, so unbounded hook recursion itself is excluded from comparison.
Programs are small: at most 3 states, 5 computeds and 3 watchers. Lane P is generated
separately from lane E, not as a filtered subset. B-GC is a topology model.

## M3.5b result: B-tail with mutable right-to-left retention

The M0 decision in [CONTRACT.md:127](../CONTRACT.md#L127) names its own revisit condition:
"a port must change retention without changing identity". This probe tests that condition.
`CONTRACT.md` is unchanged. The extension is the subclass
`reference/experimental/mutable-retention.ts`, which adds `setRetention` only.

Variant B-retain is B-tail where a live relation has `rightToLeft: true`. Activation sets
it and deactivation clears it, in place, with no `unlink` or `relate`.

| Check | Expected | Result |
| --- | --- | --- |
| frozen corpus | 39 of 39 | 39 of 39 |
| lane P against stable-erase | 0 | 0 of 3000 |
| lane P against frozen | only the swap | 9 of 3000, sink order only |
| lanes P and E against B-tail | 0 | 0 and 0 of 3000 |
| births and deaths caused by liveness | 0 | 0 and 0 |
| retention changes in the corpus | | 13, the 6 activations and 7 deactivations |
| model probes, `test/polyfill-gc-mutable-retention.test.ts` | pass | 6 of 6, and 2 controls |

Retention is invisible without `collect()`, and the search confirms it: B-retain and
B-tail agree on every program in both lanes.

### GC on the running port

The model probes write each retention change by hand. This probe calls `collect()` on the
port itself, so activation comes from the polyfill's own cascade through the public API.
Only states are rooted. B-tail, with fixed retention, is the control.

| Scenario | B-tail, fixed | B-retain |
| --- | --- | --- |
| read only, never watched | computed collected | computed collected |
| read, then watch | **chain collected** | chain live |
| watch, then read | **chain collected** | chain live |
| chain of two computeds | **chain collected** | chain live |
| unwatch | computed and watcher collected, state live | same |
| watch, unwatch, watch | **collected** | live, same relation handle |

The behaviour of README:391 and of `:200`, `:442` is reproduced together on one permanent
topology, and fixed retention is shown to fail on the same programs.

### What this does and does not establish

| Claim | Status |
| --- | --- |
| conditional reverse incidence in the implementation does not prove conditional topology | supported, against stable-erase |
| dual incidence survives for this client | supported, **given mutable retention**, so at the price of clause 1 as written |
| dependency existence is independent of push activity | supported |
| push activity is independent of retention | **not shown** |
| B reproduces the frozen polyfill exactly | not tested: no variant combines B with the swap |

Retention and activity change at the same 13 points, and in B-retain `meta === 1` and
`rightToLeft` are equal by construction. This client gives one bit of state with two
consequences, not two dimensions. Separating them needs a client where a relation pushes
without retaining, or retains without pushing. That question goes to M3.6 and M4.

Costs left unmeasured:

| Cost | Why it matters |
| --- | --- |
| push walks visit inactive relations | 59 skip steps here; a state with many unwatched readers makes notification proportional to all readers, not active ones |
| reverse entries of unwatched computeds | they stay in the producer's list until a collection |
| a write barrier for retention changes | CONTRACT.md:127 gives this as the reason for the fixed decision; a model with an explicit collector cannot show it |

# M2.0 and M2.1: Alien Signals inventory and capability matrix

Subject: `stackblitz/alien-signals` at `8734d386d925025d0e99419bd9161c17b112c5ee`
(version 3.2.1), `src/system.ts` and `src/index.ts`. This commit is the only
source for M2. Later commits such as `9daa5c3` and `c00e639` are post-hoc evidence.

Mapping: a `Link(dep, sub)` is a relation `(left = sub, right = dep)`, so
`sub.deps` is the left axis and `dep.subs` is the right axis.

Everything here comes from reading the source. Nothing has been ported or run.
Statements about frequency or need are predictions for M2.4 and M2.5. L0 means
[CONTRACT.md](../CONTRACT.md), unchanged.

## M2.0a Frozen material

| Item | Finding |
| --- | --- |
| Runtime | `system.ts` (262 lines), `index.ts` (440 lines) |
| Corpus | `effect`, `effectScope`, `trigger`, and `conformance`, which runs the external `reactive-framework-test-suite@0.0.2` |
| `build.spec.ts` | checks the built `cjs` and `esm` files; not a behaviour test of the graph |
| Corpus access to internals | public API only, plus `getActiveSub()!.flags` in `effect.spec.ts:11`. No test reads a `Link`, so no view layer should be needed |

## M2.0b Fields

### `Link`

| Field | Written | Read | Required capability |
| --- | --- | --- | --- |
| `dep`, `sub` | birth only | throughout | endpoint access |
| `version` | birth `system.ts:70`; reuse `:58` | only `:63`, dedupe against the right tail | one mutable word: a pass stamp |
| `nextDep` | birth, `unlink` repair | `:56`, `:204`, `:228`; `purgeDeps` `index.ts:436` | left forward traversal |
| `prevDep` | birth, `unlink` repair | `isValidLink` `:258`; reverse walks `index.ts:244`, `:283`, `:428`; captured in `unlink` | left backward traversal |
| `nextSub` | birth, `unlink` repair | `:119`, `:149`, `:159`, `:167`, `:190`, `:217`, `:249` | right forward traversal |
| `prevSub` | birth, `unlink` repair | captured in `unlink` only | none on the surface beyond maintaining the right tail |

### `ReactiveNode`

| Field | Use | Required capability |
| --- | --- | --- |
| `deps` | head of walks; `index.ts:224`, `:277`, `:310`, `:340`, `system.ts:197` | `first(left)` |
| `subs` | head of walks; emptiness test; upward step to the owner `index.ts:59`, `:419` | `first(right)` |
| `depsTail` | two roles, see below | client state plus backward entry point |
| `subsTail` | append; **read for dedupe** `system.ts:62-63`; repaired by `unlink` `:108` | last relation on the right axis |
| `flags` | node state | client-local |

`depsTail` is both things at once. During a pass it is the cursor, reset to
`undefined` before the run (`index.ts:252`, `:297`). At rest, after `purgeDeps`,
it is the left tail, and the reverse walks start from it. `unlink` maintains it
when the removed link had no successor (`system.ts:98`).

## M2.0c Relation mutations

| Site | Effect | L0 equivalent |
| --- | --- | --- |
| `link` same as `prevDep` `:53` | no change | none needed |
| `link` same as `nextDep` `:57-60` | stamp, advance cursor | `setMeta` |
| `link` dedupe by right tail `:62-65` | no change | needs right tail |
| `link` new `:66-90` | insert after the cursor on the left, append on the right | `relate`, then `moveAfter(left, e, prevDep)` unless `nextDep` is absent |
| `unlink` `:93-116` | remove from both, returns the saved `nextDep`, may fire `unwatched` | `unlink`, then a degree test by the adapter |

There is no operation that repositions an existing `Link`.

A reorder therefore creates and retires. For `[A, B]` re-read as `B, A`: `B` is
new and inserted before `A`, `A` is reused, and the old `B` is purged. During the
pass two relations join the same pair.

## M2.0d Traversal directions

| Direction | Sites | Purpose |
| --- | --- | --- |
| left forward | `checkDirty`, `purgeDeps`, `trigger` | validation, removal of the unread suffix |
| left backward | `index.ts:241-250`, `:280-290`, `:425-432` | child disposal and full disposal in reverse |
| left backward | `isValidLink` `system.ts:252-261` | membership in the accepted prefix |
| right forward | `propagate`, `shallowPropagate` | push; the notification order follows it |
| right, single step | `checkDirty` `:190`, `:217` | is there a second subscriber |
| right tail | `link` `:62` | dedupe within a pass |

Membership in `isValidLink` could be answered by a forward walk from `sub.deps`.
The reverse walks fix an observable order: `effect.spec.ts:60` and
`effectScope.spec.ts:15` assert LIFO cleanup. That is the case to test for `prev`.

## M2.0e Relations and neighbours held across a callback or update

| Site | Held | Across | Can run user code | Used after |
| --- | --- | --- | --- | --- |
| `unlink` `:93-116` | saved `nextDep` | `unwatched(dep)` | yes: an effect's cleanup via `effectOper` | returned to the caller |
| `purgeDeps` `index.ts:437-439` | the returned link | next `unlink` | yes, as above | passed to `unlink` |
| reverse walks `index.ts:243-249`, `:282-288`, `:428-431` | saved `prev` | `unlink` | yes, as above | read and unlinked |
| `checkDirty` `:188-191` | `link`, `stack`, saved `subs` | `update(dep)` | yes: a getter | `subs.nextSub`, `link.nextDep` |
| `checkDirty` `:215-218` | `link`, `stack`, saved `subs` | `update(sub)` | yes: a getter | `subs.nextSub`, `link.sub` |
| `trigger` `index.ts:225-233` | returned link | `unlink`, `propagate` | yes via `unwatched` | read and unlinked |
| `propagate` | `next`, `stack` | `notify` | no: queue insertion only | yes |

`unlink` does not clear a removed `Link`'s fields, so a retired link keeps its
pointers as Quant's cut edges did. Each row is a potential hazard only. Quant
showed that a held edge is not evidence until something retires it and uses it
afterwards. M2.4 has to count that.

## M2.0f Relation roles

| Role | Created | Version | Lifetime |
| --- | --- | --- | --- |
| dependency | `index.ts:363`, `:391` | current `cycle` | purged when unread; removed on disposal |
| ownership of a child effect or scope | `index.ts:177`, `:201` | 0 | unlinking it empties the child's `subs`, and `unwatched` disposes the child |

Both kinds share the parent's `deps` list in creation order. No field on the
relation says which it is: `index.ts:246` and `:285` test the kind of the `dep`
node. `HasChildEffect` on the parent only gates the slow path. `version` is not a
tag, because `cycle` also starts at 0.

An owned node has one subscriber, its owner. `notify` walks that link upward
(`index.ts:59`).

## M2.1 Capability matrix against unchanged L0

| Alien requirement | L0 primitive | Gap | Classification |
| --- | --- | --- | --- |
| endpoints | `left`, `right` | none | L0 used |
| left and right incidence | both axes | none | L0 used |
| left order | left order | none | L0 used |
| right forward order | right order | none | L0 used; notification order follows it, so likely observable (to test) |
| new link at the cursor | `relate` + `moveAfter` | composition | L0 sufficient; frequency decides whether the decomposition is natural (M2.4) |
| identity-preserving reorder | `moveAfter` on an existing relation | not needed | **L0 capability unused** |
| stable identity under move | handles | not needed | **unused**: a reorder is death and birth |
| parallel relations for one pair | multigraph | none | **L0 used**: arises during every reorder |
| one mutable word | `meta` | width | used as a pass stamp, not a revision; see below |
| unlink by known relation | `unlink` | none | L0 used |
| `first` on both axes | `first` | none | L0 used |
| right tail read | none | yes | client-visible gap; `subsTail` can be client state only if the predecessor is available |
| right predecessor | none | yes | needed only to maintain the tail |
| left backward traversal | none | yes | API gap; LIFO order is observable (to test against a forward walk that collects) |
| cursor `depsTail` | none | none | client-local, with the tail role noted above |
| degree-zero detection | `first(right)` after `unlink` | none | client policy over L0 |
| `unwatched` callback | none | none | client-local; clause 14 holds, because the adapter calls it |
| heterogeneous relations | none | open | discriminated by endpoint kind today; whether ownership needs its own lifetime semantics is open |
| `NodeId` and node association | none | 2 associations per node | host binding |
| handle equality | comparison | none | implied by stable identity |

Remaining L0 capabilities:

| L0 capability | Status for this client |
| --- | --- |
| epochs, retired readability | **witnessed by the corpus**, see the M2.2 result |
| traversal from a retired link | **witnessed by the corpus**, see the M2.2 result. Reading had found no use; that was wrong |
| clause 8's chase to the first live relation | **not distinguished** from the raw frozen successor, see the M2.5 result |
| retirement chain | not reached by the corpus or the search |
| outermost-only quiescence | no use found by reading |
| generation, no aliasing | not applicable to `Link` objects; to be seen once handles replace them |
| directional reachability, GC pruning | deferred |
| failure atomicity | not relied on |
| local complexity | not measured |

### The `version` word

Quant's word certifies what was observed; Alien's stamps the pass that last
touched a link. The same physical slot has two algebras, which favours an opaque
payload over standardized version semantics.

One literal problem: `cycle` is an unbounded JavaScript number, and L0's `setMeta`
rejects anything outside int32. A literal port needs a wrapping policy, and after
2^31 passes a stale stamp could match. That is a width question, not a semantic
one, and the corpus will not reach it.

## What Alien does not use

| Absent | Evidence |
| --- | --- |
| identity-preserving move | no code repositions an existing `Link` |
| observation version per relation | `version` is read only for dedupe; validation uses flags |
| pair lookup or index | only `prevDep`, `nextDep` and the right tail are checked |
| uniqueness of a pair | transient duplicates during reorder |

## M2.2 and M2.3 result: literal port

The port is in `adapters/alien/`. `src/system.ts` and `src/index.ts` are generated
from the frozen sources by `derive.mjs`, whose rule list is the whole difference;
`sync-corpus.mjs` fails if they drift. All external state is in `src/backend.ts`.
No role bit was added: L0 carries dependency and ownership relations without
knowing the difference, and Alien still tells them apart by endpoint kind.

| Run | Result |
| --- | --- |
| original `8734d38` | 198 of 198 |
| port, no epochs | 194 of 198; #141, #201, #202, #203 fail with `stale-relation` |
| port, epoch around `run` | 197 of 198; #141 fails with `retired-relation` |
| port, epoch and tolerated second unlink | 198 of 198 |

`build.spec.ts` is excluded on both sides: it checks built files.

The epoch was added only after these failures, and only around `run`, the one
path that was witnessed. The `computed` read path has none, and would fail loudly
if it needed one.

### First client witnesses for walk-safe retirement

All four are in the corpus, three from the external conformance suite's
`Effect Lifecycle` section. Unlike Quant's W1 to W3, they are inside what this
client tests.

| Witness | History | What it reads |
| --- | --- | --- |
| #201, #202, #203 | a computed disposes an effect during `checkDirty`'s `update` | saved `subs` is retired; `subs.nextSub` and then `shallowPropagate` walk from it |
| #141 | an effect disposes itself mid-run, then reads again | `depsTail` still names the retired link; `link` continues from its `nextDep` |
| #141, second part | same | re-entering disposal through `unwatched` unlinks that link again |

- No epochs: retired fields are unreadable, four tests fail.
- With an epoch, L0's clause 8 is enough: `next` on a retired link gives Alien
  what its frozen pointer gave in these tests. The port uses no continuation
  emulation. Literal Alien reads the frozen field while L0 chases to the first
  live relation; the corpus does not distinguish them.
- The second unlink is a new requirement L0 rejects. It may be an artefact of
  `unlink` leaving `depsTail` on a removed link when a successor exists. M2.5
  decides. It is recorded as retirement compatibility.

All this is one client's evidence. Quant's corpus gave none, because its
differential language cannot express a computed that disposes.

## Structural deviations of the first port

Measured by construction of the port; frequencies are for M2.4.

| Deviation | Class |
| --- | --- |
| `versions`: JS number per relation | payload width |
| `previousDeps`, `previousSubs` | predecessor |
| `bound` and `ReactiveNode.id` | binding: 2 associations per node |
| tolerated second unlink | retirement compatibility |
| `depsTail`, `subsTail` as handles on the node | existing client state |

## M2.4 result: accounting

Counts are in [M2-ACCOUNTING.md](M2-ACCOUNTING.md). This corpus is a behaviour
suite, not a workload, so its ratios are not frequencies in real programs.

| Question | Measured over the corpus | Reading |
| --- | --- | --- |
| insertion at the cursor | 7 of 831 links (0.8%) | the expected main path is rare here; `relate` alone serves the rest |
| relation reuse by position | 113 hits on the previous, 426 on the next | Alien's stable path |
| dedupe by right tail | 3 | real, and rare |
| parallel relations | 33 births while the pair already existed | at least 26 land at the tail, so they are same-pass duplicates that the right-tail check missed, not reorder transients. M2.0c understated this |
| reverse walks | 758 steps | used at every disposal of children or all dependencies |
| `isValidLink` | 0 steps | never reached a link in this corpus |
| zero-subscriber transitions | 651: 214 computed, 256 signal, 178 effect, 3 scope | the liveness policy is heavily exercised |
| ownership relations | 190 of 831 (23%) | carried by L0 with no role bit |
| `version` domain | maximum 362 | int32 is far from exhausted here |

### Retired Links

| Question | Measured |
| --- | --- |
| `update` calls crossed with Links held | 333 |
| Links held across them | 795 |
| of those, retired on return | 8 |
| saved `nextDep` retired by `unwatched` | 0 of 651 crossings |
| retired `next` reads | 9 |
| retired `next` differing from the frozen field | 0 |
| second unlinks | 1 |
| tests touching a retired Link | 4 of 198: #141, #201, #202, #203 |

The condition from Quant's lesson, held and retired and used afterwards, is met
here. It is met in exactly the four tests that failed without an epoch. Retired
`next` never differed from what literal Alien's frozen field would hold, so L0's
chase and the raw field are not separated by this corpus.

## M2.5 result: ablations

Variants, witnesses and failure messages are in
[M2.5-ABLATIONS.md](M2.5-ABLATIONS.md). "Corpus" is 198 tests. "Search" is 4,000
random public-API programs with impure computeds, compared on the log of runs,
values and errors. `wide-fix`, the search reference, has epochs on every public
entry and the `depsTail` fix; it matched frozen Alien on all 4,000.

Alien declares no structural bounds, so cost is measured and never a failure.

### Retirement

| Variant | Corpus | Search against `wide-fix` | Extra work |
| --- | ---: | ---: | ---: |
| R0 no epochs | 194 | | |
| R1 no epochs, `depsTail` fix | 195 | | |
| R1 with epoch, no second-unlink tolerance | 198 | | |
| R2 no epochs, snapshot of held chains before `update` | 197 | | 1,880 |
| R3 no epochs, re-read live graph after `update` | 196 | | |
| R4a R1 + R2 | 198 | **8 differ** | 1,880 |
| R4b R1 + R3 | 197 | 5 differ | |
| R5 no store epochs, client logs each removal | **198** | **0 differ** | 795 |

- `#141` and `#201` to `#203` are separate mechanisms, as predicted: R1 fixes only
  the first, R2 only the second group.
- The `depsTail` fix removes the second unlink, and `wide-fix` matched frozen
  Alien, so idempotent unlink is an artefact of the current construction.
- A snapshot taken before `update` passes the corpus but is not equivalent over
  the public API. Re-reading the live graph changes behaviour (#202).
- What Alien needs is the state a link held **at the moment it was removed**.
  R5 shows the client can keep that itself, at one record per removal (795), with
  no epoch in the substrate. Only 4 of 198 tests use a removed link, so nearly all
  of those records are never read.

### Other mechanisms

| Mechanism | Result |
| --- | --- |
| reverse walks with no predecessor | 193 of 198: LIFO cleanup fails |
| forward collect, predecessor by walking | 198 of 198, search 0, 1,111 extra visits |
| right predecessor by walking | 198 of 198, search 0, 168 extra visits |
| duplicate pair not created | 198 of 198, but search 231 differ: a subscription is lost |
| unique pair with reuse or move | 198 of 198, but search 63 differ: re-subscribing no longer moves to the right tail, so effect order changes |
| unique pair, an unread relation moved on both axes, a repeat left in place | 198 of 198, search 7 differ |
| unique pair, always moved on both axes | 198 of 198, search 478 differ: a repeated read loses its first position, which sets validation order |
| dependencies validated in reverse | 198 of 198, search 1,589 differ |
| right axis walked in reverse | 195 of 198: #200, #216, #121 |
| 1-bit, 2-bit stamp | 198 of 198, search 76 and 32 differ |
| raw frozen successor against clause 8 | search 0 differ; 98 retired `next` reads, none differing |

### Classification

| Capability | Class | Basis |
| --- | --- | --- |
| state of a removed link, as of removal | required by observable behaviour | #141, #201 to #203 |
| epochs in the store | performance and space tradeoff | R5 replaces them at one record per removal |
| snapshot before a callback | insufficient | R4a |
| idempotent second unlink | required only by the frozen implementation | removed by the `depsTail` fix |
| chase to first live, against raw frozen next | not distinguished | 0 of 98 reads differ; chains not reached |
| reverse order of dependencies | required by observable behaviour | LIFO tests |
| left predecessor state | performance and space tradeoff | forward collect passes |
| right predecessor state | performance and space tradeoff | forward walk passes |
| right order | required by observable behaviour | #216 and two others |
| left order | required to reproduce frozen observable behaviour; corpus does not distinguish | reverse validation, search only |
| tail placement on re-subscribe | required to reproduce frozen observable behaviour; not shown to be an abstract requirement; corpus does not distinguish | multi-reuse, search only |
| parallel relations or an equivalent | mostly replaceable by moving one relation on both axes; a residue of 7 of 4,000 is unexplained; corpus does not distinguish | multi-forbid, multi-reuse-unread, search only |
| stamp domain | collisions change behaviour; corpus does not distinguish | 1-bit and 2-bit search |

The search is bounded: 4,000 programs from one generator, without nested effects
or scopes. Zero differences is not equivalence. Width beyond 2 bits was not tested.

## Predicted structural deviations, before the port (superseded above)

| Deviation | Amount |
| --- | --- |
| external per-relation words | `prevDep`, `prevSub` |
| external per-node state | `subsTail` |
| host-binding cost | 2 associations per node |
| wrapping of `version` to int32 | adapter policy |
| extra lookup structures | none |

These are predictions, to be replaced by measurements in M2.4.

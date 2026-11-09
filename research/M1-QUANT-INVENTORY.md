# M1.0 and M1.1: Quant to L0 inventory and capability matrix

Subject: `quant-main` at `241a3b7`, unmodified. Files: `src/model.ts`,
`src/graph.ts`, `src/tracking.ts`, `src/kernel.ts`, `src/host.ts`.

`241a3b7` is the only source for M1. Comparison with any later revision is
post-hoc evidence and must be labelled as such.

Mapping: an edge is a relation `(left = to, right = from)`, so `to.deps` is the
left axis and `from.subs` is the right axis. No code has been ported yet.
Everything here comes from reading the source, except the section on probes,
which was run against the unmodified runtime.

## M1.0 Operations on relations

### Edge fields

| Field | Written | Read | Required capability |
| --- | --- | --- | --- |
| `from`, `to` | birth only (`kernel.ts:438`) | everywhere on hot paths; `to` also on retired edges held by the `verify` stack (`kernel.ts:226`) | endpoint access, including while retired |
| `ver` | birth; every tracked read (`kernel.ts:156`); `tracking.ts:49,125,147`; `kernel.ts:400` (`UNREAD`) | `kernel.ts:213,228,266`; `tracking.ts:140`; on retired edges too | mutable relation-local word, lifetime of the relation |
| `gen` | **birth only** (`kernel.ts:442`) | `kernel.ts:263,279,356` | immutable relation-local word |
| `next` | internal to `move`, `cut`, `link`, `fail` | hot walks; `kernel.ts:229,268`; on retired edges | left-axis traversal, including from a retired edge |
| `prev` | internal to `move`, `cut`, `link`, `fail` | client-visible only at `tracking.ts:52-55`, a bounded backward scan; other reads are internal to `move` and `fail` | backward traversal for one optimization |
| `nextSub` | internal to `unsub`, `link` | `kernel.ts:76,123,129`; `tracking.ts:102` | right-axis traversal |
| `prevSub` | internal to `unsub`, `link` | internal to `unsub` only | none on the surface |

### Node fields that touch relations

| Field | Use | Required capability |
| --- | --- | --- |
| `deps` | head of the walk; set by `link`, `move`, `cut`, `fail` | `first(left)` |
| `subs` | head of the walk; null test `tracking.ts:38`; identity test `tracking.ts:116` | `first(right)`, handle equality |
| `lastSub` | append only (`kernel.ts:437`), `unsub` | none on the surface |
| `last` | cursor of the running pass | client-local: stores one handle |
| `slot` | source-side index during a pass, displaced values on the shared stack | client-local: stores one handle |

### Structural operations

| Quant | L0 equivalent | Note |
| --- | --- | --- |
| `move(c, e, last, next)` | `moveAfter(left, e, last)`, `null` means head | exact |
| `link(c, s, last, next)` | `relate`, then `moveAfter(left, e, last)` unless `next` is null | two calls; the right axis appends as Quant does |
| `unsub(e)` plus left-list repair (`fail`) | `unlink(e)` | exact |
| `cut(c, last)` | `unlink` per edge of the suffix | same unlink order, front to back |
| `e === next`, `e !== s.subs`, `cell.to === c`, `e.from === s` | comparison of handles | implied by stable identity |
| `e.from` yielding a Quant `Node`, and a `Node` passed to `link` | none | the adapter binds `Node` and `NodeId` in both directions |

## M1.1 Capability matrix

| Quant requirement | L0 primitive | Gap | Classification |
| --- | --- | --- | --- |
| stable reorder | `moveAfter` | none | L0 used |
| dependency order | left order | none | L0 used |
| subscriber birth order | right order, `relate` appends | none | L0 used; whether it is forced is open (M1.5) |
| reverse traversal | right incidence | none | L0 used, `surface` entry gains a real client |
| unlink by known relation | `unlink` | none | L0 used; `prevSub` is a backend detail |
| endpoints, readable after retirement | `left`, `right` while retired | none | L0 used |
| walk stack holds edges across user code | epochs | adapter must open epochs around `verify` and `check` | L0 used by the literal port. Necessity is open: in Quant's corpus no held edge is ever retired (M1.4) |
| backward scan, `tracking.ts:52-55` | none | yes | algorithm-preservation gap: the scan is part of the absence proof `e === null && p === null` (`tracking.ts:69`), so it cannot be deleted locally. Whether an alternative proof path removes the need is for M1.5 |
| `ver` | `meta` | none alone | L0 used |
| `ver` and `gen` together | `meta: int32` | yes: two 30-bit facts | payload insufficiency, see below |
| one-to-one pair | multigraph, adapter enforces | none | client-local; L0 stays neutral |
| `last` | none | none | client-local |
| `slot` and displacement | none | none | client-local |
| handle equality | comparison of `(slot, generation)` | none | implied by stable identity; the handle model should state it |
| `Node` and `NodeId` association | none | host-binding cost: 2 associations per node | not an L0 gap unless other clients need it independently of an adapter |
| retired edge `next` visits retired successors | `next` chases to first live | **yes** | L0 behaviour under client challenge, see probes |

Remaining L0 capabilities, recorded so that this table answers for all of L0:

| L0 capability | Status in this port |
| --- | --- |
| directional reachability | deferred to M1.7 |
| GC pruning, `collect` | deferred to M1.7 |
| mutable retention, `findRelation` | absent from L0; not needed in this half |
| multiplicity | tolerated; uniqueness stays client-local |
| failure atomicity | not relied on |
| metadata | used, insufficient alone |
| walk-safe retirement | epochs and readable retired records used; continuation under challenge |

### `ver` and `gen`

Literal port: two words, so one goes to a side table and is reported as a
deficiency. They differ in kind. `ver` is rewritten on every read and is needed
for the whole lifetime. `gen` is written once and only answers "born since the
last successful run?".

Candidate for M1.5, not adopted: `gen` carries one bit of information, so
`ver` (30 bits plus `UNREAD`) and a tentative bit fit one int32. The price is
clearing the bit at commit, a write per dependency per run that Quant does not
perform today. That changes the algorithm, so the first port must not do it.

## Probes against unmodified Quant

The predicted red flag was `moveAfter` against continuation during tracking. By
reading, it does not arise: tracking recomputes its position from `c.last`,
which is always live. A walker holding a live edge that moves sees the same
successor in both models, and Quant never needs a frozen successor that later
moves, because everything after a cut edge is cut with it.

The real pressure is elsewhere. `verify` and `check` hold an edge across user
code, and `cut` deliberately leaves `next` on removed edges (`graph.ts:49`).

| Probe | Scenario | Quant result | Prediction for L0 `next` |
| --- | --- | --- | --- |
| W1 | deps `[s, x]`; while `verify` walks them, `s` disposes the reader and returns an unchanged value | `x` runs once, though its relation was already cut | `next` chases to first live, finds none: `x` does not run |
| W3 | same deps; `s` writes a signal and reads the reader, whose new run drops `s` and `x` | `x` runs once, final value from the new run | same as W1 |
| W2 | one dep; `s` disposes the reader and changes value | `TypeError: n.fn is not a function` | not a port question |

So clause 8 and unmodified Quant differ: on a retired edge, Quant continues
through retired successors, and L0 skips them.

Quant has no abstract continuation policy for a retired edge. Per the removal
invariant in `kernel.ts:9-18`, `next` and `prev` on removed edges are set by
memory hygiene and by what `unsub` happens to read during a cut. W1 and W3 are
observations of that representation. They are not Quant contract requirements.
Clause 8 may have given semantic meaning to something that has none for this
client.

`fail` clears `next` on the edges it removes. This is a static observation only,
with no reachability witness: no probe has shown a walk holding such an edge. It
is evidence about where the pointer state comes from, and nothing more.

**W2 looks like a bug in Quant**: `verify` calls `exec` on a node that its own
source just disposed. SPEC.md's W3 covers disposal only inside a node's own
pass. It is recorded here, not fixed; it belongs to Quant.

Whether W1 and W3 are contract or accident is undecided. SPEC.md does not
address them. The running of `x` is observable, so literal `Obs` equality
requires reproducing it, and the first port will, through recorded external
state. M1.5 decides whether this is a missing L0 capability or a Quant artefact.

## Predicted structural deviations for the first port

| Deviation | Amount |
| --- | --- |
| external per-relation words | `gen`; `prev` on the left axis |
| external per-retired-relation state | literal retired-next compatibility |
| host-binding cost | 2 associations per node |
| extra lookup structures | none |

These are predictions, to be replaced by measurements in M1.4.

## Deferred physical questions

`relate` + `moveAfter` for `link`, and repeated `unlink` for `cut`, reach the
right final state and are safe in a synchronous port with no callback between
the calls. Their intermediate topologies differ from Quant's. Under an
incremental or concurrent collector that can observe them, these may need a
mutation scope or compound primitives. Not a blocker for M1; a physical-minimality
question.

## M1.2 and M1.3 result: literal port

The port is in `adapters/quant/`. `kernel.ts` and `tracking.ts` are the originals
with field access rewritten mechanically and only graph mutation sites edited by
hand. Six other source files are verbatim, checked by `sync-corpus.mjs`. All
external state is in `src/backend.ts`.

`views.ts` gives the unchanged corpus its `n.deps`, `e.next` and similar fields.
It is loaded only as a vitest setup file; nothing under `src/` imports it.

| Run | Result |
| --- | --- |
| original `241a3b7` | 75 of 75 |
| port | 75 of 75 |
| port with views removed | 20 fail, confirming the corpus runs through the port |
| port with L0 `next` instead of literal retired-next | 73 of 75; only W1 and W3 fail |

75 is Quant's 72 tests plus the probes W1, W2, W3, run unchanged on both sides.

The last row is a preview of M1.5, not a conclusion. It confirms that L0 `next`
differs from literal Quant on W1 and W3, and that Quant's own corpus, including
its differential programs, does not distinguish them.

The port still has the W2 `TypeError`, on purpose.

## M1.4 result: classification of external structures

Counts are in [M1-ACCOUNTING.md](M1-ACCOUNTING.md).

| External structure | Cost | Measured use in Quant's corpus | Classification |
| --- | --- | --- | --- |
| `generations` | 1 word per relation | read by `check` and `fail` | relation-payload pressure |
| `predecessors` | 1 word per relation | backward scans ran in every file but `surface`; part of the absence proof | algorithm-preservation gap |
| `bound` + `Node.id` | 2 associations per node | every endpoint read | host binding |
| `retiredNext` | a record per retirement inside a walk | 139 records written, **0 read** | literal compatibility only; no use in the corpus |
| `last`, `slot` on the node | client state | used | client-local, as expected |

### What the corpus shows about retired edges

Across Quant's 72 corpus tests, a walk held edges across user code 46,259 times
and no held edge came back retired. No code read `next` or any field of a
retired edge. Only the probes do: W1 and W3 retire 5 held edges and perform 4
retired `next` reads, 2 of which differ from L0's `next`.

Consequences, stated as far as the evidence goes:

- Walk-safe retirement has no witness from Quant's corpus. It has one only from
  W1 and W3, reachable through the public API, which SPEC.md does not address.
  The earlier entry claiming `deferred-reuse` had gained a real client was
  premature.
- Zero in this corpus is a limit of what it can express, not an observation. The
  differential language `Expr` has only constants, reads, arithmetic, `if` and
  `throw`, so a computed cannot write or dispose. W1 and W3 are inexpressible in
  it.

W1 to W3 are outside the frozen Quant contract: SPEC.md defines correctness by
its executable invariants and S1 to S7, and this area is not among them. That
does not forbid impure computeds. It leaves them unspecified, as a candidate
contract extension to compare against other clients.

## M1.5 result: two lanes

Full table and failure messages: [M1.5-ABLATIONS.md](M1.5-ABLATIONS.md). "Frozen"
is Quant's 72 corpus tests split into semantic (47), structural S1 to S7 (15) and
tests that pin one implementation's paths (10), which are not contract authority.
"Extension" is W1 to W3.

| Mechanism | Frozen contract | Extension lane | Reading |
| --- | --- | --- | --- |
| store epochs removed, logical walks kept | no failure | W1, W2, W3 fail (`stale-relation`) | needed only by unspecified histories |
| L0 clause 8 instead of literal retired-next | no failure | W1, W3 fail; W2 passes | continuation has no frozen-contract witness |
| `prev` read as null, proof unchanged | 1 semantic, 5 structural | none | duplicate relations; shortest named case is A B A |
| no `prev`, no left-side absence proof | semantic 0, structural 0, 2 pinned | none | not needed by the contract |
| `gen` removed, all committed | 2 semantic | none | information is required |
| `gen` removed, all tentative | 7 semantic, 2 structural | none | information is required |
| `ver` + tentative bit in one word | no failure | none | a second word is not needed |

What follows, within this corpus:

- W2 separates the two parts of retirement: it needs retired fields to stay
  readable and does not depend on continuation.
- Quant's corpus gives no evidence for epochs or clause 8. The extension lane
  gives evidence only for unspecified behaviour of the old representation.
- `prev` is part of the current proof ladder, not of the contract. Removing it
  costs, over the corpus: `pairAbsent` 3,433 to 11,352, indexes 251 to 954,
  sweeps 132 to 1,399, indexed edges 23,753 to 24,481. S1 to S7 tests still pass.
- One bit of tentative state is required; a second relation word is not. One
  `int32` holds `ver`, `UNREAD` and the bit. The price is 249,295 extra edge
  visits at commit over the corpus, inside passes that are already Θ(d). This
  reverses the earlier "payload pressure" reading of `generations`: the second
  word is a performance-selected representation.

Passing the S1 to S7 tests is what was checked. It is not a proof of those bounds
for every program. Not ablated here: right-axis ordering, reverse incidence,
stable identity under move, and outermost-only quiescence, for which even the
probes have depth 1.

### Other measurements

- `relate` + `moveAfter`: 2,884 of 122,142 links in the corpus land inside a list
  (2.4%). The rest are a single `relate`.
- Counts are per test file. External marks are high-water within one file's
  process. Nodes are never reclaimed here, since `collect` is not used until
  M1.7.

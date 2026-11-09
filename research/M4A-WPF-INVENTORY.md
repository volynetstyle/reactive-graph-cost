# M4A.0 and M4A.1: WPF weak-event inventory and capability matrix

**Question.** Can a Relation Store represent an active weak subscription whose delivery
membership survives mutation, while neither endpoint is retained merely by the
subscription?

Subject: the weak-event core only, not WPF. Data binding and XAML are out of scope.

| Layer | Subject | Answers |
| --- | --- | --- |
| executable client | `dotnet/wpf`, `49ae5cd6e0ba39eb9d54b93e35af6a0bfe0b7d51` (2026-11-06) | what this implementation does |
| stated requirements | the header comment of `WeakEventManager.cs:10-59` | what the implementation says it must do |
| motivational reference | `dotnet/docs-desktop`, `7cf14527a627b58f7c0e7ec01464d417495fd8b4`, `weak-event-patterns.md` | why the pattern exists; pinned, only its motivating section read |

Mapping: the listener's target is left and the source is right.

M4A.0 and M4A.1 come from reading. M4A.2 ran the original. Nothing has been ported. L0
means [CONTRACT.md](../CONTRACT.md), unchanged.

## M4A.0a Frozen material

Cached in `.cache/wpf-49ae5cd`, with paths relative to `src/Microsoft.DotNet.Wpf`.

| Item | Finding |
| --- | --- |
| Runtime | `WeakEventManager.cs` (928), `WeakEventManagerT.cs` (127), `MS/Internal/WeakEventTable.cs` (740), `IWeakEventListener.cs` (31), `Shared/MS/Utility/FrugalList.cs` |
| Corpus | `WeakEventManagerTests.cs` (6,159) and `WeakEventManagerTTests.cs` (410), about 219 test attributes |
| Weak semantics in the corpus | **none**: no `GC.Collect` and no `WeakReference` in either file |
| Delivery snapshot in the corpus | **not as behaviour**: 33 uses of `BeginUse` set the in-use state by hand; a text search finds no callback that adds or removes |
| Corpus access to internals | heavy: `ListenerList` appears 318 times, and tests pin `Clone` and list identity |
| Executable here | built from the pin with its own SDK; see M4A.2 |

So the corpus covers list bookkeeping. The two properties that made this client
interesting, no retention and delivery under mutation, are stated in comments and
not tested.

## M4A.0b State

| Field | Meaning | Required capability |
| --- | --- | --- |
| `_dataTable[(manager, weak source)]` | one `ListenerList` per manager and source | incidence on the right, keyed by source |
| `Listener._target` | `WeakReference` to the listener | relation whose endpoint is not retained |
| `Listener._handler` | `WeakReference` to the delegate, or null | a third participant in the entry |
| `_list` order | insertion; `RemoveAt` shifts, so order is stable | right order |
| `_users` | deliveries now using this list | client-local |
| `_cwt` | target to handler, `ConditionalWeakTable` | conditional retention, see M4A.0f |
| `_cleanupRequests`, `_inPurge`, `_toRemove`, `_toUpdate` | purge scheduling and deferral | client-local |

There is no edge object. `Listener` is a struct compared by value, and cloning a list
recreates every entry. There is no per-listener list: **no walk goes from a target to
its subscriptions.**

## M4A.0c Relation mutations

| Site | Effect | L0 equivalent |
| --- | --- | --- |
| `AddListener` `:258-295` | append; on first listener, `StartListening` | `relate`, and a degree test |
| `RemoveListener` `:297-332` | remove the **last** matching entry; on empty, `StopListening` | walk, then `unlink` |
| `Purge` `:804-819` | remove entries whose target is dead | no equivalent: L0 prunes at `collect` |
| `Clone` and `CopyTo` `:824-852` | new list, dead entries dropped, order kept | no equivalent |
| `Purge` `:394-433` | drop the list when empty or the source died | client policy |

Matching is by value: `ReferenceEquals(target)` and `Object.Equals(handler)`, which is
delegate equality, not identity. The same pair may appear several times, and each is
delivered.

## M4A.0d Traversal

| Direction | Site | Purpose |
| --- | --- | --- |
| right forward | `DeliverEvent` `:753`, `:893` | delivery, in insertion order |
| right reverse | `Remove` `:604`, `RemoveHandler` `:670`, `Purge` `:809` | last match, purge |
| right forward | `CopyTo` `:833` | clone |

## M4A.0e Held across a callback

| Site | Held | Across | User code | Used after |
| --- | --- | --- | --- | --- |
| `DeliverEvent` `:753` | index `k`, bound `n`, the list | a handler | yes | continues over the **same frozen list** |
| `DeliverEvent` `:343-365` | `_users` raised | whole delivery | yes | `EndUse` |

Requirement 6 (`:47-49`): each event is delivered to all listeners present when it was
received, even if a listener removes itself or another, or adds a new one.

Consequences, by reading:

| Case during delivery | Result |
| --- | --- |
| a listener removes a later listener | that listener **still receives** this event |
| a listener adds another | the new listener does not receive this event |
| a nested delivery on the same source, after a change | sees the changed list |
| a target dies mid-delivery | skipped, since `Target` is read per entry |

The first writer in a delivery clones and installs the clone, so each delivery reads the
version current when it began. Two nested deliveries can see two different memberships.

This is the fourth behaviour under mutation. Quant follows a leftover pointer, Alien a
frozen field, the polyfill a position, and WPF a version of the membership.

## M4A.0f Liveness and retention

| Fact | Site |
| --- | --- |
| the source strongly holds the manager's delegate, once per manager and source | `WeakEventManagerT.cs:82` |
| the manager holds the source weakly | `EventKey`, `WeakEventTable.cs:514` |
| an entry holds target and handler weakly | `:505`, `:511-512` |
| the manager lives as long as the table | `_managerTable` |
| the handler is kept alive by its own target, without extending it | `_cwt`, `:630-637` |
| an entry can outlive its target until a purge | `:804-819`, `:51-55` |
| `StartListening` and `StopListening` follow 0 to 1 and back, per source | `:266-274`, `:324-329` |

The subscription is `(source, target)` with `ρ = (false, false)`. **It pushes and it
retains nothing**, and that never changes during its life.

The handler entry is an ephemeron: the table holds the delegate only while the target
is alive, and the delegate usually references the target, so a strong edge would leak.

## M4A.1 Capability matrix against unchanged L0

| Requirement | L0 primitive | Gap | Classification |
| --- | --- | --- | --- |
| push with no retention | `relate(target, source, WEAK)` | none | L0 used; first witness of a push relation with `ρ = (false, false)` |
| endpoint dies without `unlink` | `collect` prunes | timing | see the stale entry row |
| right order, delivery | right axis, `first`, `next` | none | L0 used; asserted in the corpus |
| stable order under removal | clause 3 | none | L0 used |
| parallel pairs | clause 10 | none | L0 used; **delivered once each** |
| removal of the last match | `first`, `next`, `unlink` | no reverse walk | composition; forward walk keeps the last match |
| left incidence | `L(u)` | unused | **no use**: no walk from a target |
| entry with target and handler | binary relation, one word | **yes** | ternary entry; needs a side table or a node for the entry |
| match by value equality of delegates | none | none | client-local |
| **membership as of delivery start** | none | **yes** | **conflict with the walk guarantee**, see below |
| several versions at once | none | **yes** | same conflict |
| stale entry until purge | clause 6 forbids a live relation with a dead endpoint | **yes** | **tension with clause 6** |
| `StartListening` on 0 to 1 | degree test | none | client policy |
| handler kept alive by its target | `relate(target, handler, STRONG)` | conditional on the list | composition, see below |
| value identity of a relation | handles | not used | relations have no identity here |
| reposition | `moveAfter` | unused | not used |
| one mutable word | `meta` | unused | no per-entry payload |
| threads | none | out of scope | requirement 5 and `Interlocked`; L0 is single-threaded |

### The snapshot conflict

L0's guarantee of a walk under mutation says a walk "never returns a dead relation".
Requirement 6 needs delivery to a listener removed during this delivery. So the
retirement protocol is not merely unneeded here. **Its traversal rule gives the wrong
membership in both directions**: a removed relation is skipped, and an appended one is
visited.

Candidates, none yet tested:

| Candidate | Store needs | Cost |
| --- | --- | --- |
| client copies the targets at delivery start | nothing beyond `first`, `next` | O(k) per delivery, where WPF pays only when a write happens during delivery |
| client copies relation handles, reads retired ones inside an epoch | clause 7 and retired readability | O(k), and a real use for epochs |
| versioned adjacency in the store | a new capability | unknown |

The second candidate would give epochs a client use, but it copies as many entries as
the first and asks more of the store. By reading it has no advantage, so this client
does not yet support the retirement protocol either.

### The stale entry tension

`Count`, `IsEmpty` and `StopListening` all see an entry whose target has died, until a
purge. L0 removes the relation at `collect`. To reproduce the timing, the client needs
to know what `collect` pruned and keep counting it. `CollectReport.pruned` supplies this
in the model. A real collector gives no such synchronous report, and CONTRACT.md already
leaves that open.

### The ephemeron

`relate(target, handler, STRONG)` gives "handler lives while target lives", and `lfp`
does not root a cycle through the delegate's own target. The real rule is a conjunction:
the handler is held while the target and the list are both alive. L0's `lfp` is
disjunctive over relations, so the list's half must be done by `unlink` when the list
goes. It is expressible, by client policy. Hayes on ephemerons stayed unread in the
digest.

## Relative to the questions M3 left

| Question | Reading so far |
| --- | --- |
| is push activity independent of retention? | across clients, yes: polyfill live is `(push, retains)`, WPF is `(push, no retention)`. Per relation, untested: WPF's retention never changes |
| does a client need mutable retention? | not this one: `WEAK` is fixed at `relate` |
| does retirement earn support outside signals? | not as written: the traversal rule contradicts requirement 6 |
| does dual incidence earn its left half? | no use found: a second client that does not read it |
| is multiplicity required? | yes for this client: observed in M4A.2 |

Combinations of push activity and right-to-left retention seen so far: active with
retention (polyfill live), active without (WPF), inactive without (polyfill unwatched).
Inactive with retention has no client.

## Method for this client

The established procedure has a mechanical derivation and an unchanged frozen corpus.
Neither transfers:

| Step | Problem | Decision |
| --- | --- | --- |
| mechanical port | the source is C# | a hand port, checked against the oracle |
| frozen corpus | C# xUnit against protected members, omits the properties in question | secondary at most; not ported |
| reference | needs the original running with a real collector | M4A.2 |

The oracle's programs carry no expected results. The frozen WPF and the CLR decide them.

## M4A.2 result: executable oracle

`adapters/wpf/` builds `WindowsBase` from the pinned commit and runs JSON programs over
the public `WeakEventManager<,>` API. Steps: `npm run wpf:bootstrap`, `wpf:build`,
`wpf:oracle`. Everything stays under `.cache`; nothing is installed on the machine.

| Item | Value |
| --- | --- |
| WPF commit | `49ae5cd`, clone unmodified |
| SDK | `12.0.100-alpha.1.26480.102`, as pinned by `global.json` |
| runtime and reference pack | `12.0.0-alpha.1.26551.101`, as pinned by `Version.Details.props` |
| `WindowsBase.dll` SHA-256 | `E8E8927E835C07242301A50C0C50E5589F0CEC848077EAAC81EC16FC096E3AEE` |
| repeatability | six runs, identical logs |

Each program runs on its own STA thread, because `WeakEventTable` is thread-static.
Code is fully optimized from the first call, each operation has its own frame, and
objects are held only in array slots, so a local variable cannot keep a target alive.
Two harness controls confirm a held listener survives collection and a dropped one dies.

Deviations from the repository's bootstrap, none touching weak-event code:

| Deviation | Reason |
| --- | --- |
| archives from `ci.dot.net` | `builds.dotnet.microsoft.com` is unreachable here; `tools.ps1` names both. No checksum is published |
| Git's Perl 5.38.2 for Strawberry 5.38.0.1 | used only by `GenTraceStrings.pl`, for trace strings |
| two API-compatibility checks off | they compare public surfaces and do not change code |
| `PresentationNative_cor3.dll` from the SDK's bundle | closed-source shim for the dispatcher's window |

`AssemblyInformationalVersion` is `12.0.0-dev` and names no commit, so the link to the pin
is the clone's `HEAD` and the hash above.

### M4A.3 directed witnesses

18 programs in `adapters/wpf/programs/directed.json`, logs in `.cache/wpf-oracle`.

| Family | Program | Observed |
| --- | --- | --- |
| weak | listener unreachable while the source lives | collected, no longer delivered |
| weak | target dies during delivery | skipped, later listeners still run |
| source | source unreachable while subscribed | collected |
| multiplicity | one handler added twice, a second handler once | delivered twice, then once |
| multiplicity | `l0, l1, l0`, remove `l0` | `l0, l1`: the last match goes |
| snapshot | A removes B and adds C | B receives this event, C does not; the next event reaches A and C |
| snapshot | a listener removes itself | the rest still run |
| nested | A removes B, adds C, raises again | inner delivery reaches A and C; the outer one then reaches B |
| activation | first add, last remove, re-add | subscribe, unsubscribe, subscribe |
| activation | last removal during delivery | unsubscribes at once, inside the delivery |
| stale | listener collected, dispatcher pumped | **source stays subscribed** |
| stale | then a delivery finds the dead entry, then a pump | unsubscribes |
| stale | forced purge, no delivery | unsubscribes; a second purge finds nothing |

So every property read from the source holds on the real CLR, including the two the
corpus does not test.

The stale rows are the new result. A dead entry is discovered, not reported. Nothing
removes it until a delivery trips over it, or, by reading, an add schedules a cleanup.
An idle dispatcher alone does nothing. The timing of topology cleanup is observable to the
source, through its subscriber list.

### Confirmed defect at this revision

In `AddListener`, `:279` stores a cloned list under `source`, where `:270` and
`RemoveListener:310` use `sourceKey`. For a static event `source` is null.

| Program | Observed |
| --- | --- |
| static event, add during delivery | **the next event does not reach the added listener** |
| instance event, add during delivery | received from the next event on |
| static event, add outside delivery | received |
| static event, remove during delivery | removed |

The controls isolate the case to an add during delivery on a static event.

## M4A.4 and M4A.5 result: baseline S0 over L0

`adapters/wpf/src/` is a hand port. S0 copies delivery records at the start of every
delivery. A record holds `NodeId`s, which do not retain, so it fixes membership without
extending a target's lifetime. Purge is not tied to `collect`.

| Corpus | Programs | Same as the CLR | Oracle run twice |
| --- | ---: | ---: | --- |
| directed, M4A.3 | 18 | 18 | identical over six runs |
| handler lifetime, directed | 10 | 10 | one run |
| generated, seeds 1 to 3000, 2 handlers | 3,000 | 3,000 | identical |
| held out, seeds 3001 to 6000, 3 handlers | 3,000 | 3,000 | identical |

The first generated run differed on 27 of 3,000, which is how handler lifetime was
found. The port was then fixed against that corpus, so the held-out corpus is the
independent check. It was generated after the fix and passed on its first run.

Logs compare equal except that a run of consecutive `unsubscribe` lines is treated as a
set, because a purge visits sources in hash order. Neither corpus needed that allowance
between oracle runs.

### Handler lifetime

Each `add` makes a new delegate object, equal by value to others for the same method.

| Program, CLR | Observed |
| --- | --- |
| add `h0`, remove never-added `h1`, collect, raise | **`h0` not delivered**, target alive |
| control: no remove | delivered |
| control: ordinary remove | removed |
| control: two handlers, remove unknown `h2` | both delivered |
| control: witness without a collection | delivered |
| add `h0` twice, remove once, collect, raise | **the remaining entry is not delivered** |
| dead handler, then remove it | not removable; source stays subscribed; purge finds nothing |
| dead handler, target then dies, purge | unsubscribes |
| dead handler, clone during delivery | dropped by the clone |
| old list during delivery, its entry removed, collect | still delivered |

The representation stays binary. WPF's ternary entry decomposes into a subscription
`(target, source, WEAK)` whose word indexes a handler record, a node per delegate, and a
retention relation `(target, handler, STRONG)` owned by one list version, unlinked when
that version dies. So the handler lives while its target and its owning version do.

**Membership record and callable participant have independent lifetimes.** That needed
no new store capability here.

### Frozen behaviour, candidate defects

Reproduced because the oracle is this executable. **None of these is a requirement of a
weak-event mechanism**, and none should inform a primitive.

| Behaviour | Site | Evidence |
| --- | --- | --- |
| a static add during delivery is lost | `WeakEventManager.cs:279` | directed, with controls |
| removing a never-added handler releases the only registered one | `:682-686` | directed, with controls |
| with duplicates, the table releases the first delegate and the list the last, so the survivor can lose its own | `:670-690` | directed |

### What the port needs from L0, and what it keeps

| Used | Unused |
| --- | --- |
| `relate`, `unlink`, `first`, `next` on the right axis | left axis |
| right order | `moveAfter` |
| `WEAK` and `STRONG`, fixed at `relate` | mutable retention |
| explicit `collect`, statuses | epochs, retired readability |
| one word, as an index into a client table | |

Kept outside the store: list versions and their users, stale counts, the shape of each
version's table, and the handler records.

Clause 6 holds in the store, because the tension is resolved in the client: a stale
entry is a number, not a relation. That is one representation, and the stale count is
visible through when the source is unsubscribed.

### Counters

| | Generated | Held out |
| --- | ---: | ---: |
| deliveries | 2,612 | 2,455 |
| records copied by S0 | 4,490 | 4,452 |
| writes during delivery | 220 | 163 |
| entries WPF's copy-on-write would copy | 511 | 363 |
| entries gone stale | 967 | 952 |
| peak stale at once | 7 | 7 |
| handlers lost to the fast path | 347 | 437 |
| records skipped with a dead delegate | 41 | 56 |

S0 copies 8.8 and 12.3 times what WPF would. It shows semantic sufficiency, and it is
**no evidence for an efficient mechanism**. These are ratios on a random corpus, not on
workloads.

### Not covered

One generator, small programs, one thread, one CLR build. Collections happen only at
explicit points. The dispatcher was driven by explicit pumps, not a running application.
A delegate's strong reference to its target is not modelled; the corpus does not
distinguish it, since nothing reaches a delegate except through its target.

## M4A.6 result: S1, client copy-on-write versions

`adapters/wpf/src/manager-s1.ts` replaces only the snapshot mechanism. Each version has
its own array of records, its `users` and its retention relations. A delivery reads the
version current when it began. A write to a version in use clones it once and publishes
the clone. Frozen defects are kept. Run with `WPF_VARIANT=s1`.

| Corpus | S0 | S1 |
| --- | ---: | ---: |
| directed, 18 | 18 | 18 |
| handler lifetime, 10 | 10 | 10 |
| generated, 3,000 | 3,000 | 3,000 |
| held out, 3,000 | 3,000 | 3,000 |

| Structural measure | Generated, S0 | Generated, S1 | Held out, S0 | Held out, S1 |
| --- | ---: | ---: | ---: | ---: |
| records copied at delivery start | 4,490 | 0 | 4,452 | 0 |
| entries copied at clones | 511, computed | **511**, performed | 363, computed | **363**, performed |
| writes causing a clone | 220 | 220 | 163 | 163 |
| stale accrued | 967 | 967 | 952 | 952 |
| stale dropped by clones | 8 | 8 | 6 | 6 |
| stale removed by purges | 72 | 72 | 77 | 77 |
| zombies skipped | 41 | 41 | 56 | 56 |
| retention relations created | 7,722 | 7,722 | 7,626 | 7,626 |
| retention relations removed | 1,351 | 1,351 | 1,178 | 1,178 |
| right-axis walk steps | 16,879 | **0** | 16,916 | **0** |

The S0 figures in the second row are what WPF would copy, derived from list sizes. S1
performs those copies, and the totals agree exactly. Every other shared counter agrees
too, so the two differ in the snapshot mechanism and nothing else observable or counted.

| S1 only | Generated | Held out |
| --- | ---: | ---: |
| versions created | 3,842 | 3,670 |
| writes while any delivery is active | 380 | 264 |
| nested deliveries | 131 | 86 |
| most versions alive at once | 4 | 4 |
| most users of one version | 3 | 2 |
| dead entries dropped by clones | 8 | 10 |
| entries copied for the defect's orphan, not in the totals above | 3 | 2 |

A version owns retention state as well as membership: when it dies, its handlers can.

### What S1 costs the store

**S1 reads no adjacency.** Right-axis steps are 0. Delivery, removal, purge and clone all
use the client arrays. The subscription relations are still written, 7,214 and 7,269 of
them, and nothing reads them or their metadata. They are `WEAK`, so they retain nothing.
By construction they could be deleted with no observable effect, which was not run.

So in S1 the store contributes nodes, statuses, `collect`, and the `STRONG` retention
relations. Right order and membership live in the client.

| Claim | Status |
| --- | --- |
| snapshot semantics can be implemented efficiently above L0 | supported: exact match with the CLR at WPF's copy count |
| this client needs right incidence in the store | **not forced**: S0 uses it, S1 does not |
| this client needs right order in the store | **not forced**, likewise |
| delivery in insertion order is observable | supported, wherever it is stored |

S1 pays for this with a client array per version, so memory is not compared here. Whether
the store's own adjacency can carry the current version, with copies only at clones, was
not built. That is the design S2 would have to be measured against: its candidate benefit
is removing those arrays, not reducing copies, which S1 already does.

## M4A.6 result: no-subscription control, S2, and its retirement ablation

Variants, selected by `WPF_VARIANT`:

| Variant | Membership lives in | How a walk survives pruning |
| --- | --- | --- |
| `s1-nosub` | client arrays; no subscription relations at all | arrays |
| `s2` | store right axis; arrays only for versions frozen at a clone | epoch, cursor read after retirement |
| `s2-next` (ablation) | as S2, no epochs | successor saved before the callback, nothing else |
| `s2-log` (ablation) | as S2, no epochs | before a collect, a running walk copies what is ahead |

| Variant | Directed 18 | Handler 10 | Generated 3,000 | Held out 3,000 |
| --- | ---: | ---: | ---: | ---: |
| S0 | 18 | 10 | 3,000 | 3,000 |
| S1 | 18 | 10 | 3,000 | 3,000 |
| `s1-nosub` | 18 | 10 | 3,000 | 3,000 |
| `s2` | 18 | 10 | 3,000 | 3,000 |
| `s2-log` | 18 | 10 | 3,000 | 3,000 |
| `s2-next` | **17** | 10 | 3,000 | 3,000 |

**`s1-nosub` writes no subscription relation and matches the CLR everywhere.** In this
representation WPF membership needs no store adjacency. What the store still supplies is
nodes, statuses, `collect` and retention relations.

`s2-next` fails "a target dies during delivery": the saved successor was pruned and the
walk stopped. Both random corpora miss it. It lost its continuation in 6 and 2 walks, and
6 and 2 deliveries failed to notice stale entries, with no log difference. **The generated
corpora do not discriminate this mechanism; one directed program does.**

### Logical state

Per-program peaks, summed over the corpus. Counted in records, not bytes.

| Generated | Client entries | Versions | Store membership | Store retention | Retired | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| S0 | 811 | 3,518 | 6,860 | 7,033 | 0 | 17,968 |
| S1 | 7,288 | 3,719 | 6,860 | 7,033 | 0 | 24,757 |
| `s1-nosub` | 7,288 | 3,719 | 0 | 7,033 | 0 | 17,988 |
| `s2` | 486 | 3,719 | 6,860 | 7,033 | 176 | 17,990 |
| `s2-log` | 528 | 3,719 | 6,860 | 7,033 | 0 | 17,942 |

| Held out | Client entries | Versions | Store membership | Store retention | Retired | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| S0 | 564 | 3,422 | 6,979 | 6,980 | 0 | 17,717 |
| S1 | 7,291 | 3,558 | 6,979 | 6,980 | 0 | 24,700 |
| `s1-nosub` | 7,291 | 3,558 | 0 | 6,980 | 0 | 17,790 |
| `s2` | 344 | 3,558 | 6,979 | 6,980 | 106 | 17,762 |
| `s2-log` | 369 | 3,558 | 6,979 | 6,980 | 0 | 17,736 |

S2 moves membership from client to store and the totals stay within 0.3% of `s1-nosub`.
**It relocates the records; it does not remove them.** S1's excess over `s1-nosub` is the
unread subscription relations. Handler records, node slots and generations are the same
across variants and are not in these totals. Retirement metadata is counted only as
retired relations, so it is not weighted by its successor fields.

### Retirement

| | Generated | Held out |
| --- | ---: | ---: |
| programs with a retired cursor read, of 3,000 | 11 | 4 |
| retired cursor reads, bookkeeping reads included | 23 | 8 |
| records `s2-log` copied before a collect instead | 44 | 26 |
| peak retired relations held by `s2`, summed | 176 | 106 |

COW copying is preserved: WPF-equivalent 511 and 363. S2 materialises 503 and 357, since
entries already pruned are numbers.

A retired read occurs only when the cursor itself was pruned, that is, when a target dies
during its own callback. Pruning of a later entry needs no retirement, because the walk
then continues from a live cursor. **Continuity across structural death is observable
here, and a client copy made only when a collect interrupts a walk replaces the epoch** at
slightly lower total state. In this client epochs are replaceable, as they were in Alien.

These collections are explicit. A collector that can run at any allocation would make the
client's "before a collect" hook unavailable, and this experiment says nothing about that.

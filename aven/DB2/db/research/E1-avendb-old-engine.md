# E1: avenDB-old's query and sync engine, reduced to first principles

What avenDB-old's query and sync engine taught us, reduced to first principles, for the new avenDB's milestones 4
(docs: one document synced) and 7 (sync manifest and queries). Research notes, not a spec, by the avenACTORS session
(30 Oct 2026), moved here from `aven/DB2/engine/README.md` so avenDB has one engine spec,
[`../engine/README.md`](../engine/README.md), which takes these learnings up. There is no code here.
Learnings come in as rules and tests, never as code (README rule 12).

The engine's input from apps is what actors declare they need: their `loads`
([`aven/actor/ARCHITECTURE.md`](../../../actor/ARCHITECTURE.md), sections 3, 6 and 11; avenDB-old's actors as Interests:
[`aven/actor/README.md`](../../../actor/README.md), section 6). What it may serve is decided by
capabilities ([`aven/DB2/id/caps/README.md`](../../id/caps/README.md)).

1. [What the engine does](#1-what-the-engine-does)
2. [Where we looked](#2-where-we-looked)
3. [avenDB-old's engine](#3-avendb-olds-engine)
4. [What failed, and the rule that answers it](#4-what-failed-and-the-rule-that-answers-it)
5. [Strengths to keep](#5-strengths-to-keep)
6. [Weaknesses](#6-weaknesses)
7. [First principles: what each concept is for](#7-first-principles-what-each-concept-is-for)
8. [The engine for the next iteration](#8-the-engine-for-the-next-iteration)
9. [Tensions in avenDB today](#9-tensions-in-avendb-today)
10. [Open questions](#10-open-questions)
11. [Next steps](#11-next-steps)

## 1. What the engine does

Three jobs: bring to a device what is wanted, in the order it is wanted; answer reads from what the device holds,
saying how complete the answer is; carry each write to every peer that may hold it.

## 2. Where we looked

- **avenDB-old** (`aven/db`): the Lean models in `aven/db/spec/AvenDB` (Interest, Selector, Ops, QueryView,
  LiveQuery, Coverage, Freshness, BlindIndex, RangeSync, EntryState, NodeLoop, CatchUpBudget, LazyBoxes, Logs, Sync),
  the Rust engine (`crates/avendb`, `crates/avendb-net`), the page (`aven/db/page`, `session.svelte.js`) and the
  app's side (`maia/content/game/code/sources/{actors,interest,device}.js`).
- **avenDB today** (`aven/DB2/db/core`, 458 lines): `status`, `presence`, `timeline`, `wire` and `chat`, and the store
  contract of blobs and compare-and-set refs (`db/spec/Aven/DB/Store.lean`). It has no document sync or query yet.

The sync plan's own step list lives in the vault doc `doc:docs/avendb` (section 12), which is not in the repository;
the steps below are pieced together from the files that cite it. Everything comes from reading code and documents;
none of it was run for this document.

## 3. avenDB-old's engine

### 3.1 Wants: actors and Interests

An app is an actor, an entry of the Maia City vault, changed only by proposal ("Actor, v3", evolved from "Manifest,
v2"). Its `loads` is a tree of **Interests** in four **tiers**: `now` (on screen), `next` (one click away), `later`
(the rest of the screen's data), `idle` (what the device keeps offline). An Interest has:

- `want`: a selector over type, tags, entry or vault, in the grammar capabilities use ("so caps and wants stay one
  concept");
- slots such as `$room`, `$timeline` and `$asset`, bound by the route or the selection;
- `part`: headers, the record, or files (by the app's tags or a media type);
- `window`: the newest `n`, or the whole history oldest first;
- `follow`: the entries its records name, up to three levels;
- `by`: the signal that orders it inside its tier (viewport, playhead, camera, list).

An actor's `loads` may hold another actor, whose parts never come above the tier it sits in. The scheduler's laws are
proven (`Interest.lean`): every entry of a higher tier comes first, nearer first inside a tier; tiers and signals only
order and never add or withhold an entry; each entry once, at the highest tier anyone wants it; a click that moves
Interests between tiers changes only the order; a slot nobody bound wants nothing, never the whole vault; **an
Interest grants nothing** (`served_needs_authority`). Two more rules: a background asking yields between pages when a
new `now` log appears, and new `now` logs are asked at once, only of peers that hold more.

The scheduler (`avendb-net/src/interest.rs`) keys each view's scope by a revision, with tombstones so a late update
cannot revive a cleared view. There is no lease and no timer: at most 128 scopes, and the one changed longest ago gives
way. A scope holds at most 512 entries, 32 wants and 8 selectors. Inside a tier, scopes interleave so one big view
cannot starve another. The page publishes a view's selectors before any read of its own, because on an iPhone reads
waited tens of seconds behind catch-up.

### 3.2 Queries

The "one query engine" plan made a query an entry too ("Query, v1"): a `where` over labels, a window, an order and a
`follow` depth, with one method, `read`, whose parameters bind into a template. An actor's part may name a query
entry and bind its parameters to slots, and an inline want and its query entry are proven to give the same result.

Queries run in the device's Rust engine: as WebAssembly in a worker in the browser, natively in the Mac app. A read
picks candidates by labels first (proven: `cover_sound`), opens only those records, tests values, then applies
window, order and follow. Each query's answer is kept as a **query view**, stamped with its head, inputs and context,
with laws for windows (cursor pages that newer entries never shift), for `follow` (bounded fan-out) and for
compaction (every view survives it).

Views learn about changes by version, not by delta. The page long-polls for changes, asks which shown queries moved,
and re-runs those reads. "A later subscribe can push the touched rows alone" (`LiveQuery.lean`) is planned, not built.

**Writes are local first.** No write waits for a peer. A pending write is painted in the first frame and laid over
the answers until the engine confirms or refuses it, and a refused one leaves no trace. Writes go first in the
engine's queue.

### 3.3 Sync

- **Logs and frontiers** (T19). Each edit names its own log's frontier as parents. A device asks with each frontier
  plus the edits 1, 2, 4, 8 … steps back, and is sent only what lies beyond. One digest per log says whether to ask.
  Changed digests go straight to each peer that may hold the log, deliberately not over gossip, "whose topics would
  tell every member of a log".
- **Who receives what** (T12, T28). A peer sends only the logs the asker may receive. Keep shares narrow that to what
  one device wants (whole, opened, never), and grant nothing.
- **Holdings** (H1, H2, T27). Per connection, a device announces each log's frontier and the files it holds; signed
  statements fill in "Synced to". Holdings route and show; they never authorize. The blob gate hands a file only to a
  device on a live, proven connection.
- **Ranges and segments.** A range round covers only the logs a view wants. A peer's announcement merges as the later
  head, which is commutative and idempotent. A segment carries one signature, and relays can serve it.
- **Stubs.** A first sync may hold stubs (id, depth, parents) for bodies it lacks; stubs enter nothing it knows, and a
  stub that lied is caught when its body comes.
- **One entry state** (sync v2 step P6). An entry is either full, or based on its owners' newest snapshot plus the
  edits after it. "Samuel, 2026-10-26: no caches."
- **One node loop** (P7). One task owns outreach, one lane per peer, with backoff that doubles up to a minute.
- **Answers say how complete they are.** Coverage (P1): `complete`, `partial` (what is held, known, waited for) or
  `denied`, from held state and peers' announcements, with no clock. Freshness: `current`, `offline` (as of when) or
  `behind` (which logs, what is waited for).
- **A blind index** (P4): keyed-hash tokens per audience and label, so a peer that cannot read an entry, such as the
  server, can still answer `find`, learning only equality.

### 3.4 The two flows

**A view mounts, and rows appear.**

1. The route gives the view's actor. Its `now` Interests (selectors and bound entries) go to the node, coalesced per
   microtask, before any read.
2. The node replaces the view's scope, asks peers that hold more for the new `now` logs, and resolves selectors through
   the blind index.
3. Peers answer a page at a time, within what the asker may receive. The device catches up in bounded steps.
4. Meanwhile the view's reads run against what is held, answered from a current query view, with coverage and
   freshness attached. Reads whose views moved run again.

**A person writes, and every peer gets it.**

1. The write is painted at once. The engine judges it against held state, builds it on the log's frontier, seals it
   under the entry's audience key and signs it.
2. It is saved, and the announcer is told before any optional derived save.
3. Holdings go to each peer that may know the log; a live lane carries small changes ahead of bulk.
4. Peers ask for the logs that differ, check closure, signatures and rules, save, and announce again.

### 3.5 Proven, implemented, planned

- **Proven** (no `sorry`): the scheduler's laws, selectors, query planning and query views, frontier sync, who
  receives what, holdings, range rounds, the node loop's lanes, the catch-up budget (each step shrinks what is left
  and ends within its bound), stubs. One gap is named: a proof that every honest snapshot start is right for every
  history "is still to come".
- **Implemented**: the scheduler in Rust and JS, query entries as vault data, query views with an oracle check, the
  shared and blind indexes, holdings and statements, coverage and freshness, writes first, pending writes.
- **Planned or partial**: pushed deltas; windows inside one entry's log ("long logs come whole today", so a chat
  room, whose messages are rows of one entry, is one long log); the actors' `interface`, `needs` and `code`, still
  empty.

## 4. What failed, and the rule that answers it

avenDB's rebuild names the old shape as the cause: one Lab behind one lock, catch-up in budgeted steps that could loop
without progress, derived state only in the writer's memory, status numbers from different moments
(`aven/DB2/README.md`, "Why a rebuild"). The rules it set answer specific failures:

| Rule (`aven/DB2/README.md`) | What happened in avenDB-old |
| --- | --- |
| 1. One writer per device; readers read snapshots | One `Mutex<Lab>` (`avendb-net/src/lib.rs:884`) served reads, peers, catch-up and writes. A write took 1.9 s on an iPhone behind up to 32 waiting page reads (`spec/LocalWrite.md`). A catch-up ran 1.8 min in one turn and answered no peer meanwhile (`CatchUpBudget.lean`) |
| 2. Pure protocol cores | Node outreach sat behind several shared locks and an announcer that woke on a retry timer (`NodeLoop.lean`) |
| 3. No step without progress | A first sync's replay was one step of 10.5 to 24 s at 130,000 edits; one fresh browser's catch-up made 46 whole replays; an iPhone's unlock of a partial vault took 313 s (`CatchUpBudget.lean`) |
| 4. React to changes, never to states | Settle delays, backoff timers and a 4 s re-read poll; a count-based change poll could not tell a replaced revision of the same count (`LocalWrite.md`) |
| 5. Derived state is a cache keyed by inputs and code version | Many separately stamped caches: stored view, shown view, query views, shared and told indexes, warm keys. An engine version change could need a cold replay |
| 6. Catching up only reads | Unlocked devices also wrote on their own while catching up: key epochs, steward marks, owners' snapshots (inferred from `lab.rs`) |
| 7. Status names its phase | Four status vocabularies from different moments: coverage, freshness, the view status ("View completeness unknown") and the sync pill's ratio |
| 8. The UI is pushed deltas | Pages re-query by version |
| 9. One protocol, no fallbacks | A legacy reconciliation beside edit ranges; optional carriers; a WebRTC path with a 10.8 s round trip kept over a 715 ms relay (`path_choice.rs`) |
| 11. Small packages | `lab.rs` grew to 9,377 lines |

## 5. Strengths to keep

1. **One selector grammar** for capabilities, wants and queries, with fit decided.
2. **Wants order and never authorize; holdings route and never authorize.**
3. **Scopes with revisions and tombstones**, with no lease and no timer.
4. **Frontier asks** and the later-head merge.
5. **Announcements to the peers that may hold a log,** not to public gossip topics.
6. **A blind index** that reveals only equality.
7. **Completeness as a pure function of state** (coverage, freshness), never of a clock.
8. **Query views** kept by the delta rule and checked against an oracle.
9. **Local first:** writes go first, pending writes are painted at once and vanish without a trace when refused.
10. **Asking yields to `now`**, and selectors are published before any local read.
11. **The laws in Lean** first, with vectors the Rust and JS replay.

## 6. Weaknesses

- **Wants computed by reading.** The page worked out its Interests by reading the device (one read per `follow` hop),
  so it had to hold data to know which data it wanted.
- **Not one engine yet.** Several read operations remain (`query`, `room`, `posts`, `entry_views`, `world`), and the
  world summary still exists.
- **Long single-entry logs** come whole.
- **Hard caps** (512 entries, 8 selectors per scope) instead of streaming.
- **Labels sealed in bodies** need the blind index and steward marks to be found.
- **"Follow" means three things:** a vault's follow list, link hops, and following standing grants.

## 7. First principles: what each concept is for

Four essentials remain once each concept is reduced to its job:

| Essential | Its one job |
| --- | --- |
| **Log** | An entry's edits, each naming the edits it builds on. The truth |
| **Head** | What a peer holds of a log: its frontier. The only thing peers compare |
| **Want** | Demand: a selector, a window, link hops, a tier, a lifetime (while mounted, or durable) and a part. It orders and never authorizes |
| **View** | A derived answer, stamped by its inputs and code version. A cache, rebuilt from logs at will |

What may be served is a capability's question, not the engine's.

| Seen in avenDB-old as | What it really is |
| --- | --- |
| Interest, keep share, query entry, copy setting, follow list | A want. Mounted wants order; durable wants (signed, like a keep share) decide what a device keeps |
| Digests, holdings, statements, range fingerprints, edit ranges | Heads: what I hold of each log |
| Stored view, shown view, query views, shared, told and blind indexes, warm keys | Views: one stamped derivation per kind |
| Owner snapshots, backups, handed views, stubs, segments | A log's snapshot: a head over sealed segments, with bodies fetched by hash |
| Coverage, freshness, view status, the sync pill | One status record: the phase (connecting, catching up with what is left, live, offline, stalled) |
| `query`, `room`, `posts`, `entry_views`, `world` | One read: a want answered by a view |
| `follow` (vault list, link hops, standing grants) | Three names: subscriptions, hops, delegation |
| Capability selector and want selector | One grammar, two meanings kept apart: authority is not demand |

## 8. The engine for the next iteration

- **Inputs.** Wants (from actors' `loads`, mounted views and devices' durable wants), capabilities, and heads from
  peers.
- **One writer per device** applies edits; readers read snapshots stamped with the head they are correct at.
- **The scheduler** orders by tier, then by the view's signal. It never adds or withholds an entry, and background
  work yields when a new `now` want appears.
- **Sync** compares heads log by log and asks for what lies beyond, only for logs a want names and a capability
  allows. Announcements go to the peers that may hold the log.
- **A read** is a want answered by a view, with its status attached: complete, partial (what is waited for) or
  denied, and the phase.
- **Views are pushed as deltas**: the touched rows alone, never a re-query.
- **Writes are local first:** painted at once, never waiting for a peer, gone without trace when refused.
- **Long logs** are a snapshot plus the edits after it, with windows inside the log.
- **Actors**: the engine keeps each actor's `loads` current and hands the `now` tier into its turns; later tiers
  arrive as messages ([`aven/actor/ARCHITECTURE.md`](../../../actor/ARCHITECTURE.md), sections 3, 6 and 11). A want is computed from the
  actor's definition and its bound slots, never by reading data first.

## 9. Tensions in avenDB today

- **Status.** Rule 7 names "catching up" as a phase; `db/core`'s `Phase` has starting, connecting, live, offline and
  stalled, with no catching up yet.
- **Presence timers.** Presence sends `here` every 10 s with a 30 s time to live, which sits uneasily with rule 4.
- **Gossip topics.** One topic for one members' room is fine; announcing per log must not use topics, which tell
  every member of the log.

## 10. Open questions

1. **Per-document capabilities or selectors?** Per-document caps make blind matching and the marks unnecessary, but
   cost a grant per document.
2. **How much label metadata a host may see** to answer `find`.
3. **Is the want grammar exactly the capability grammar,** or a superset (windows, hops, tiers)?
4. **Windows inside a log** need snapshot-based entry states first: milestone 4 or 7?
5. **Delta granularity**: rows, fields, or Loro updates?
6. **Where reads run**: only on the device, or also on the Aven Peer for blind `find`?

## 11. Next steps

1. Lean first: log, head, want and view, with theorems that what is served is within capabilities, the scheduler's
   order laws, a view equals a full recomputation, and a delta equals the difference of two recomputations.
2. Vectors from the model for the Rust and the page.
3. Milestone 4: one document as a snapshot plus edits after it, synced by heads.
4. Milestone 7: actors' `loads` as durable and mounted wants; one read operation; pushed deltas.

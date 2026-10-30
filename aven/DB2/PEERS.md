# Peers: the Aven Peer is just a peer

Milestone 2 made the network invite-only, and every peer already checks every statement itself: nobody takes the
Aven Peer's word for who is in. But every peer still needs the Aven Peer to be online. It is the only relay, the only
way into gossip, the only source of catch-up, the only keeper, and the only place that accepts tickets. This plan
removes that dependence. Any member's Peer can do each of those jobs, and the network keeps working when the Aven Peer
is down (Samuel, 30 Oct 2026: "we should not think about server methodology any more").

The Aven Peer stays: it is Aven's device, a Peer that happens to run on a server, always on. It holds only the caps its
owners grant, as any other Peer would (ARCHITECTURE.md, rule 7: no privilege by position). Everything it does, a
member's Peer can do too.

Only what this plan names gets built. Lean first, then Rust against its vectors, then the box's checks.

## What only the Aven Peer does today

| Job | Today | Where | Becomes |
|---|---|---|---|
| Relay | One relay, inside the Aven Peer (`--relay`); one `--relay-url` for everyone | `peer/native/src/main.rs`, `relay.rs` | Several relays on the admin's relay list; browsers fail over ([1](#1-several-relays)) |
| Entry to gossip | The Aven Peer is every peer's only bootstrap (`--aven`, `--aven-key`) | `room.rs`, `main.rs` | Any member with a known address ([2](#2-entry-through-any-member)) |
| Presence and "who joined" | The hub counts connections and says who joined | `hub.rs` | Signed presence beats on gossip ([2](#2-entry-through-any-member)) |
| Catch-up | Only the Aven Peer's hub answers `heads`, `catch_up`, `lines` | `hub.rs`, `link.rs`, `chats.rs` | Every native Peer answers from its store; signed tips show what is withheld ([3](#3-catch-up-from-whoever-holds-the-posts)) |
| Keeping logs and files | Only the Aven Peer keeps every log and file (`keep::keep`) | `keep.rs`, `main.rs` | Every native Peer keeps the chat's logs; opt-in keepers keep files, two each ([4](#4-any-members-peer-as-a-keeper)) |
| Accepting the claim, tickets, sign-ins | The Aven Peer decides by compare-and-set on refs (`claim`, `signin-NNNNNN`, `joined-<invite>`) | `door.rs`, `Aven.ID.{Claim,Invite}` | The tree as a Doc of signed statements; one rule settles it the same everywhere ([5](#5-one-rule-for-the-tree)) |
| Telling members the tree | The Aven Peer tells each peer the statements, unsigned configuration included | `door.rs`, `members.rs`, `link.rs` | Any member tells it; the genesis names the configuration; signed tips catch a peer that hides statements ([6](#6-signed-records-not-a-peers-word)) |

Browsers (Peer-Lights) reach anyone only through a relay. A direct path between browsers (WebRTC) stays out of this
milestone, as it was in milestone 2.

## Decisions

The architect decided these on 30 Oct 2026, by Samuel's delegation for A10 to A13 ("do as you believe"), each on this
thread's recommendation. Samuel may overrule any.

1. **Relays are on the admin's relay list.** An admin statement adds a member's Peer, with its relay's URL, to the
   network's relay list, and another statement removes it. Reason: a relay sees the IP addresses and timing of everyone
   it carries, and the relay path is what hides a member's IP from other members, so the admin chooses who sees that.
   Later the list is a cap that the network's owners grant: a grant, not a position.
2. **A browser bootstraps from what it already holds.** The signed relay list, the members' address records and the
   tree's tips are cached in the Peer-Light's OPFS, and are carried in every invite link. `/aven.json` stays as one
   source among several. Reason: a returning browser, and a new invitee, need no single host to find the network.
3. **Addresses are signed address records,** gossiped in the room, kept by every peer and fed into iroh's
   `MemoryLookup`. No DNS, no pkarr, no n0. Reason: it stays private, and relays don't talk to each other, so a dialer
   must learn a peer's home relay from somewhere it can verify.
4. **Two claims of one ticket: the smallest statement hash wins** (A12, `ticket_once`). Only someone holding the link's
   secret can make a second claim, so this happens only with a leaked link or a double tap.
5. **A withdrawal wins over every claim not in its past, and a claim is final once an admin device has acked it** (A12).
   This is how a revocation wins over what it hadn't seen in caps. A withdrawal is the ticket's revocation. Reason: if a
   concurrent claim won instead, a withdrawal could never stop someone with a leaked link, who need only say they
   hadn't seen it.
6. **An undone claim is hidden everywhere, and kept.** The door closes on its devices at every peer at once, because
   every peer settles the same statements the same way. Its posts stay in the store, marked, and are no longer shown.
   Nothing is wiped.
7. **Catch-up comes from whoever holds the posts.** Every native Peer, the Aven Peer included, answers `heads` and
   `catch_up` from its own store. A peer links to up to 3 members and asks whichever announced the newer tip. This is
   the want queue's order of sources (engine): your own devices, then other readers, then keepers. It answers engine
   open question 1.
8. **Keepers keep by grant.** Every native Peer keeps the chat's logs, which are small. Keepers for files opt in, and
   an admin statement lists them until keep caps land (A22). Each file goes to 2 keepers, chosen by rendezvous hashing
   over that list; the Aven Peer is one candidate. Any peer may keep, and none is special.
9. **What stays special is named, signed or on its way out** ([8](#8-what-stays-special)). The claim becomes the
   signed genesis that every member pins (A11). The guardian is named in what people sign (A13). The `maia.city` origin
   stays special until Samuel takes up A14.
10. **Milestone 2b, Lean first,** after milestone 2 and the store upgrade. The tree's Lean lives in `Aven.ID`'s
    `Network` module, built with the caps thread, on `Aven.Core`. There is one model of the tree, not two.
11. **Upgrades are a clean refusal.** Every connection's first frame carries a wire version, separate from the release
    and changed rarely. A peer refuses any other wire version with "update to join", and never falls back (README rule
    9). The Service Worker and native Peers read one signed release record. Stored formats stay readable forever,
    tested against frozen vectors, because production is never wiped ([7](#7-upgrades)).

## 1. Several relays

- **The relay list** is part of the tree: admin statements `relay-add` (a member device's key and its relay's HTTPS
  URL) and `relay-remove`. The tree settles the list as it settles everything else ([5](#5-one-rule-for-the-tree)).
- **Any member's Peer can run a relay** with `--relay`, as the Aven Peer does today. The flag no longer means "this is
  the Aven Peer". A relay on the list admits exactly the door's devices (K12), built from the settled tree, plus a
  newcomer whose token is a statement the tree would take now (`newcomer`), as the Aven Peer's relay does today.
- **A browser can only use a relay with a public HTTPS name and a certificate.** In practice, a browser relay is a
  member's Peer on a server. A member's Mac behind NAT can still relay for native Peers over its address, but browsers
  can't reach it.
- **iroh does most of the work.** Every Peer and Peer-Light builds its `RelayMap` from the whole list. iroh picks the
  fastest relay as its home and dials a peer homed elsewhere through that peer's relay, which its address record names.
  When the home relay goes away, iroh picks another. A relay that was removed from the list leaves the map at the next
  settle.
- **QAD:** a relay with a certificate also serves QUIC address discovery, as production's does today
  (`deploy/server/qad.sh`).
- **`--relay-url` goes away.** A Peer's own relay, if it runs one, is known from its `relay-add` statement. Until the
  tree reaches it, a Peer starts from `--relays` (one or more URLs) or from what it has cached.

## 2. Entry through any member

- **Address records.** Each device signs a record of how to reach it: its key, its home relay URL, its direct addresses
  and a counter. A newer counter replaces an older record. Records travel on gossip, every peer keeps the newest one per
  device, and the records feed `MemoryLookup`. A record from a device the door doesn't admit is dropped.
- **Gossip bootstrap.** A peer joins the room through up to 3 members it holds an address for: the Aven Peer is one
  candidate, not the default. It tries the members it last heard from first. `--aven` and `--aven-key` become
  `--bootstrap KEY@ADDR` (repeatable), for a first start with an empty store.
- **A fresh browser** has an invite link. The link carries the relay list, a few members' address records, the
  genesis hash and the tree's tips, all signed, so it can join through any relay listed. A returning browser has all
  of that in its OPFS. `/aven.json` stays, as one more source.
- **Presence is signed.** Each device beats on gossip with a signed record: its key, a counter and the clock step. A
  peer counts a device present while its beats keep coming. "Who joined" is the first beat after a claim settles, and
  each peer says it itself. The hub's presence counting goes away.
- **The link** (`link.rs`) stops meaning "the one connection to the Aven Peer". A peer keeps up to 3 links on
  `aven/db/1` to members, chosen from its address records, and replaces one that stalls (README rule 3). Status names
  its phase from all of them together (rule 7).

## 3. Catch-up from whoever holds the posts

- **Every native Peer answers** `heads`, `catch_up` and `lines` (the posts) on `aven/db/1` from its own store, the
  same frames the Aven Peer's hub answers today. A Peer-Light answers nothing: it is rarely online, and serves no one.
- **Signed tips.** Each device signs the tip of its own log: the hash of its newest post and the post's number. Tips
  travel on gossip and in `heads`. A peer that announces an older tip than one already seen is not believed for that
  log: the gap shows, and the posts are asked of someone else (A3: envelopes name what they build on by hash).
- **Whom to ask:** the link that announced the newest tip for a log. If it fails or stalls, the next one. Never all at
  once: the want queue's order is own devices, then other readers, then keepers (engine).
- **Unchanged:** every post is still signed by its device and checked by the receiver, and a log only ever moves
  forward. A split is final (A4). Who served a post never matters, only that it verifies.
- **Seam with the engine thread:** this is the chat's version of the engine's "who serves a catch-up". The engine
  carries the same order of sources into Docs in milestone 4.

## 4. Any member's Peer as a keeper

- **The chat's logs:** every native Peer keeps every log it hears, as the Aven Peer does today. They are small, and
  that gives as many keepers as there are Peers.
- **Files:** the keeper list is admin statements `keeper-add` and `keeper-remove`, naming a member device. When keep
  caps land (A22, milestone 3), each statement becomes a keep cap that Maia City's owners grant, with the same fields.
  A device with `--keep` offers itself, and an admin's avenOS shows the offer to accept.
- **Two keepers per file,** chosen by rendezvous hashing: hash the file's index with each keeper's key and take the 2
  smallest. Every peer computes the same 2 from the same list, so nobody has to say who keeps what. The sender keeps
  its own copy as well.
- **A keeper leaves** when its `keeper-remove` settles, or when it hasn't beaten for 7 days. The next keeper in
  rendezvous order fetches its files from whoever still holds them. A keeper that comes back just catches up.
- **What a keeper stores:** the file's hash sequence, by hash, under the ref `file-<index>`, as the Aven Peer's
  `keep::keep` does today. Its rules stay: fetch it whole, check its length against the post's size, and retry only a
  sender that couldn't be reached. Blind keeping (sealed bytes, fetch proofs, quota) comes with caps and doesn't change
  this layout.
- **Serving:** a file is fetched from its sender, then its 2 keepers, then any peer that holds it, over iroh-blobs
  (`/iroh-bytes/4`). The provider still serves members only (the door), and fetch proofs come with A22.

## 5. One rule for the tree

The hard part. Today the Aven Peer orders statements by compare-and-set on ref names. Without one place doing that,
every peer must reach the same tree from the same statements, whatever order they arrive in.

### The tree is a Doc of signed statements (A12)

- **Every statement names the tips it saw:** the hashes of the tree's newest statements when it was signed. So the
  statements form a graph, and "in the past of" is decidable: B is in A's past if A names B, or names something whose
  past holds B. This is a log of envelopes, as every Doc's is (`Aven.Core.Log`).
- **The genesis** (A11) is the first statement. Samuel's passkey and MaiaCityGuardian sign it, and it names the RP ID,
  the origins, the admin coop, the agent, the Aven Peer's key and the guardian's keys. Every member pins its hash; a
  statement whose past doesn't reach the pinned genesis is not part of the tree.
- **Kinds of statement:** genesis, sign-in, ticket (an invite), withdrawal, claim (a join), ack, and the lists:
  relay-add, relay-remove, keeper-add, keeper-remove. Each is checked alone as it is today (signatures, assertions,
  names), then settled together.
- **Sign-ins** stop being numbered by arrival (`signin-000001`). A sign-in adds a device and conflicts with nothing,
  so the set of sign-ins is the order. The members sign in thread already makes sign-ins statements; this plan only
  changes how they are stored.

### The settle rule

`settle` is a pure function from a set of statements to the tree, with no order as input:

1. Drop every statement that fails its own checks, or whose past doesn't reach the genesis.
2. **Tickets and withdrawals:** a withdrawal of ticket T wins over every claim of T that isn't in the withdrawal's past.
   A withdrawal that has a claim of T in its past changes nothing: that ticket was already used (`withdraw_used`
   today).
3. **Acks:** an ack names the claim it acks, by hash, and has it in its past. An admin device acks on its own whenever
   it syncs a new claim, but only the claim that stands in its own settled view, and never a second claim of a ticket
   that already has a final claim in that view. So finality waits only for an admin's device to be online.
4. **Finality:** a claim is final once an ack from an admin device names it. A withdrawal never wins over a final
   claim, and a final claim wins over every claim of its ticket that isn't final.
5. **Claims of one ticket:** among the final claims of a ticket, if there are any, the smallest hash wins; otherwise
   among the claims still standing (`ticket_once`). The others found nothing. Two final claims of one ticket happen
   only when two admin devices ack different claims without seeing each other's ack: the smallest hash still settles it,
   and the conflict shows in the settled tree (the caps thread, 30 Oct 2026).
6. **Lists:** an admin's remove wins over every add of the same device that hadn't seen it: the adds in its past and
   those concurrent with it. An add that has the remove in its past puts the device back (the caps thread, 30 Oct
   2026).
7. The door admits exactly the devices of the settled tree's group (K12): the same devices at every peer, because every
   peer settles the same set.

### Lean first

In `Aven.ID.Network`, with the caps thread (`ticket_once` is there since #1531), on `Aven.Core` (#1532):

- **`settle_perm`:** two lists of statements with the same members settle to the same tree. Convergence is then only
  that peers hold the same set, which gossip's reconciliation gives and the box tests.
- **`settle_ticket_once`:** in a settled tree, a ticket founds at most one vault. A ticket with two final claims is
  marked `contested`.
- **`settle_withdrawn`:** a withdrawal of T leaves no non-final claim of T outside its past standing.
- **`settle_final`:** a final claim stays standing whatever statements are added later, unless what is added makes
  another claim of its ticket with a smaller hash final, which only an ack that never saw the first ack can do.
- **`settle_door`:** the door's admitted keys are a function of the settled tree only (`door_from_tree`).
- **`settle_genesis`:** nothing outside the pinned genesis's descendants changes the tree.
- **`settle_restore`** (`Aven.ID.Restore`): production's stored statements, ordered by their ref names as the Aven
  Peer stored them, become tree statements after a genesis, each naming the one before it (`migrate`). Proved: every
  one of them counts, so the change of rule loses nothing. Checked at every step of every invite trace, the examples
  and 40 generated ones: the settled door admits exactly the keys `Members.admits` does, and the member vaults are the
  same (`restore_agrees`). A proof of that agreement for every store is open.
- **Records** (`Aven.ID.Records`): the record kinds of [6](#6-signed-records-not-a-peers-word), each under its own
  label, and which is newest: `newest_set` (no order is an input), `newest_signed` (only the device it is about, or a
  release signer), `newest_agree` (two newest say the same; a split takes the smaller body), `newest_grows`, and
  `speaks_same` for the wire version ([7](#7-upgrades)).
- **Node** (`Aven.ID.Node`, the architecture's R3, R7 and R9; the architect, 30 Oct 2026): a write fits on the
  device's own log alone (`write_fits`, `write_chain`), and a split's proof reaches every reader that syncs with a peer
  holding it (`split_spreads`); with two relays every member can use, losing any one peer leaves every member reachable
  and every Doc held by two members fetchable (`no_only_relay`, `no_only_holder`, `keepers_two`), a re-homed device's
  new address record is the newest (`rehome_newest`), and one relay alone is an only source (`one_relay_only_source`);
  plain bytes go only to a reader, and relays and keepers that aren't readers see sealed bytes only
  (`no_plain_to_nonreader`, `relay_blind`, `keeper_blind`). Vectors `node.json`: networks losing each peer in turn.
- **Vectors:** `settled.json`. The same statement sets in six orders each, with their settled tree: `TreeExamples`,
  the races one by one (two claims, a claim against a withdrawal, a claim after its ack, two admin devices acking two
  claims, a list's add against its remove, a statement outside the genesis, a bad one), 40 generated sets, and
  production's store migrated from the invite traces. `records.json`: records and the newest of each. aven-id, the
  wasm and avenOS's check load them (README rule 10).

### The cost: a claim can be undone

Until an admin device acks it, a claim can still lose to a withdrawal the admin signed without seeing it, or to a
competing claim of the same ticket with a smaller hash. After the ack, it can lose only if two admin devices acked two
claims of its ticket without seeing each other. Both need a leaked link or a double tap. Meanwhile:

- **The new member works fully:** they chat, are counted present, and their device is let in everywhere their claim
  has reached.
- **avenOS says it quietly:** "Waiting for Maia City to confirm", under the member's name in their own view, until the
  ack arrives. Others see nothing different.
- **If it is undone,** that member's avenOS says "This invite was withdrawn" (or "already used"), the door closes on
  the device at every peer, and its posts are hidden (decision 6).
- **How long** is how long until an admin device is online. In production, Samuel's browsers are online most days. If
  that is too slow, a later grant can let the Aven Peer ack, as a cap Maia City's owners give it: the right to finalise
  claims. That is a grant, not a position, and it stays a decision for later.

### Production's tree

Production is never wiped (PRODUCTION.md). Its store holds the claim, two sign-ins and whatever invites and joins
milestone 2 adds, under their ref names. The peer reads them as they are and treats the old claim as the genesis's
past: Samuel signs the genesis once, with his passkey and the guardian's key, naming the old claim's hash.
`settle_restore` shows the tree doesn't move, and a frozen copy of production's store format is tested, as
`id/core/tests/before/` is today.

## 6. Signed records, not a peer's word

Every record a peer takes from another is signed by the one it is about, so who passed it on doesn't matter:

| Record | Signed by | Replaces |
|---|---|---|
| The genesis | the claimant's passkey and MaiaCityGuardian | the first signup on a host; configuration (`--rp-id`, `--origin`, `--guardian`, `--admin-coop`) taken unsigned |
| Tree statements | their signers, as today | the Aven Peer's ref order |
| Tree tips | any member device, over the tree statements it holds | the Aven Peer telling each peer the tree it likes |
| Relay and keeper lists | admin passkeys, as statements | `--relay-url` for everyone; the Aven Peer as the only keeper |
| Address records | the device they describe | `--aven HOST:PORT` |
| Presence beats | the device present | the hub's count |
| Log tips | the device whose log it is | the Aven Peer's `heads` |
| The release record | the release signers (A15) | whatever the host serves |

What nothing may depend on any more, and a check that holds it:

- **"The Aven Peer said so."** A peer that sees two different tips for the tree, or for one log, from two members asks
  both and takes the union. One that shows less is caught (caps, "Verifying who's who").
- **The Aven Peer's configuration.** Nothing is read from flags that the genesis names. A peer whose flags disagree
  with its genesis refuses to start, and says which flag.
- **Its key by position.** The Aven Peer is in the tree as Aven's device. Being reachable at `aven.maia.city` gives it
  nothing more.

## 7. Upgrades

Installing, running and upgrading a node belong to avenPEER (the architect, 30 Oct 2026).

- **The wire version** is a number in the first frame of every `aven/db/1` connection and in the gossip topic's name.
  It changes only when a frame's meaning changes, rarely, and never with an ordinary release. A peer refuses any other
  wire version with `update` and the version it speaks. It never falls back (README rule 9).
- **The release record:** one signed record per release, naming the version, the wire version, the hashes of
  avenOS's build and of the Peer's binary per platform, and the signers (A15). It is published beside each release and
  gossiped by any peer that has it.
- **Open tabs and installed apps:** the Service Worker checks for a newer release record when the app opens and every
  hour. It downloads the release in the background and checks its hashes, then switches at a safe point: the one writer
  has flushed, no post is half written, and the tab is hidden or has been idle a minute. A tab refused with `update`
  switches at once, and drafts survive in OPFS. The page shows "Updating…" for the reload and nothing else.
- **Native Peers** read the same record. A Peer says `update` on its timeline and in avenOS's Control Room. The Aven
  Peer's deploy upgrades it; a member upgrades their own Peer. A Peer never upgrades itself without its owner.
- **Order:** a new wire version reaches production's Aven Peer and the browsers first, then members' Peers. While it
  rolls out, a Peer that hasn't upgraded is cut off until it does: that is the cost of no fallbacks, and why the wire
  version changes rarely.
- **Stored formats are read forever:** every release reads what every older release stored, tested against frozen
  vectors of each format. Only the wire refuses older peers; the store never does.

## 8. What stays special

| What | Why it stays | How it goes, or why it may stay |
|---|---|---|
| The genesis | The root: every member pins it | Stays. It is signed by people, not held by a server. Re-founding a network is a new genesis, by its owners |
| MaiaCityGuardian | Co-owns every person's vault during evaluation | Named in what people sign (A13); its exit is Samuel's later decision |
| The `maia.city` origin and its DNS | Passkeys are bound to the RP ID `maia.city`, and avenOS's code comes from the origin | A14 (its own RP ID) when Samuel takes it up; A15's three origins and signed releases; the Mac app as the trusted path that needs no origin |
| A browser relay's name and certificate | Browsers reach a relay only over HTTPS | Stays, for each relay on the list. Any member with a server can run one, so none is special |
| The invite link's first contact | A new invitee knows only what the link carries | The link carries several relays and members, so no one of them is needed |
| The Aven Peer's uptime | It is the one Peer that is always on, so it is usually the first to relay, keep and answer catch-up | Not a privilege: its jobs are grants (relay list, keeper list) any member's Peer can hold too. The box checks the network without it |

## Threads

Six task threads, the Lean first, each in its own folders. Rust threads run in separate sessions (repository
`CLAUDE.md`).

### Thread A: the tree's Lean (`id/spec`, with the caps thread)

`Aven.ID.Network` (the caps thread, #1555): statements naming their tips, the genesis, `settle` and its theorems.
`Aven.ID.Restore`, `Aven.ID.Records` and `Aven.ID.Node` (this thread): `settle_restore`, the record kinds and
their checks, the node properties; `settled.json`, `records.json` and `node.json`. Comes first; threads B to E build
against its vectors.

### Thread B: the tree as a Doc (`id/core`, `peer/native/src/door.rs`, `members.rs`)

aven-id's `settle`, against `settled.json`. Statements stored by hash, not by ref name, and production's refs read as
they are (`settle_restore`, the frozen format). Any member accepts a statement: it checks it, keeps it, gossips it, and
settles. Admin devices ack. The Peer refuses flags that disagree with its genesis.

### Thread C: relays, addresses, entry and catch-up (`peer/native`, `peer/light`)

`RelayMap` from the relay list, `--relays`, `--bootstrap`; address records into `MemoryLookup`; gossip bootstrap from
up to 3 members; up to 3 links; signed presence; every native Peer answering `heads`, `catch_up` and `lines`; signed
log tips. The Peer-Light's cache in OPFS and the invite link's records.

### Thread D: keepers (`peer/native/src/keep.rs`, `main.rs`)

`--keep`, the keeper list, rendezvous over it, two keepers per file, re-keeping when a keeper leaves, fetching from
sender, then keepers, then anyone.

### Thread E: upgrades and avenOS (`os/web`, the Service Worker, `deploy`)

The wire version in the first frame and the topic; the release record, signed at release; the Service Worker's safe
switch; `update` in the page and Control Room; "Waiting for Maia City to confirm"; the admin's relay and keeper lists
in Invite's screen.

### Thread F: the box's failures (`sandbox/cast.json`, `sandbox/box`, `sandbox/check.mjs`, `sandbox/lanes.mjs`)

The cast gets a second relay: Alice Peer runs one, with the box's test CA, and is on the relay list. Bob gets a native
Peer as a keeper. Then the checks below.

## How it is checked

`bun run up --check` grows. With the Aven Peer **stopped** after the first steps:

1. Alice Peer and Bob's Peer-Light still chat, through Alice Peer's relay: posts both ways.
2. A third peer (Alice Peer-Light, reloaded) catches up from Alice Peer, and its view equals the posts every log's
   signed tip names.
3. A file Bob's Peer-Light shared loads, from Bob's Peer as its keeper, while its sender's tab is closed.
4. An invite made before the stop is claimed through Alice Peer's relay; the new member chats, shows "Waiting for Maia
   City to confirm", and stops showing it when the admin's device acks.
5. Two claims of one ticket from two profiles, at once: every peer settles the same winner, and the loser's avenOS says
   "already used".
6. A withdrawal and a claim of one ticket, each signed without seeing the other: the withdrawal wins everywhere, and
   the claimant's device is out at every peer.
7. The Aven Peer starts again, catches up from members, and settles the same tree as every other peer.
8. A peer whose wire version differs is refused with `update`, and an open tab switches to a newer release without
   losing a draft.
9. A peer that hides a tree statement or a log's newest post from one member is caught by the signed tips.

`bun run lanes` adds lanes for losing the Aven Peer's relay, losing a member's relay, and both relays up with the
home relay killed mid-chat. Each reports the path iroh took, how long until a post arrived after the loss, and which
peer served the catch-up.

## Open

- **Finality without an admin online:** a grant that lets the Aven Peer, or k members, ack claims. Later, if waiting for
  an admin is too slow.
- **A member's relay sees other members' IPs:** the relay list is the admin's choice for that reason. Mixing traffic
  over several relays is not in this plan.
- **`settle_restore` for every store:** the agreement of the settled door with `Members.admits` is checked on every
  trace, not yet proved in general: that needs `settle` related to `Members.tree`'s owners and `Tree.actsFor`. Thread B
  starts on the checks; the proof comes before production's tree is migrated for real (the architect, 30 Oct 2026).
- **Presence at scale:** a beat per device per step on one topic is fine for the chat's network, but not for millions
  (caps, "Scale").

## Not in this plan

WebRTC between browsers; blind keeping, keep caps and fetch proofs (caps, milestone 3); removing a member (milestone
3); a new RP ID (A14, Samuel's call); the Mac app; mixing traffic across relays.

## Done when

- In the box, the nine steps above pass with the Aven Peer stopped, and `bun run lanes` shows each loss.
- In production, the tree settles from production's stored statements to the same tree as before, under a genesis
  Samuel signed, and a member's Peer on the relay list carries a browser while the Aven Peer is restarted.
- Lean proves the theorems of [5](#lean-first) without `sorry`, and every test derives from them.

# Peers: the plan

avenPEERS's plan and its status: the clean-slate cutover's stages, the checks, the open work and the production
runbook of the switch. The goal: the Aven Peer is just a peer. Any member's Peer can do each of its jobs, and the
network keeps working when the Aven Peer is down (Samuel, 30 Oct 2026: "we should not think about server methodology
any more").

Its design lives in avenBRAIN:
- the Peer and the Peer-Light, relays, addresses, the door, the wire, gossip, sync, the fetch gate, keepers, presence,
  upgrades and deploy in [avenPEERS](brain/peers/README.md);
- the register (Maia City's tree: its setup, tickets, claims, confirms, sign-ins, settings and the relay list), its
  settle rule and production's migration in [avenCAPS](brain/caps/README.md#the-register).

Only what this plan names gets built. Lean first, then Rust against its vectors, then the box's checks.

## Where it starts

The first generation (`aven-gen1`) needs the Aven Peer online for each of these jobs.

| Job | First generation | Where | Becomes |
|---|---|---|---|
| Relay | One relay, inside the Aven Peer (`--relay`); one `--relay-url` for everyone | `peer/native/src/main.rs`, `relay.rs` | [Relays](brain/peers/README.md#relays) on the register's relay list; browsers fail over |
| Entry to gossip | The Aven Peer is every peer's only bootstrap (`--aven`, `--aven-key`) | `room.rs`, `main.rs` | [Entry through any member](brain/peers/README.md#addresses-and-entry) |
| Presence and "who joined" | The hub counts connections and says who joined | `hub.rs` | [Signed beats](brain/peers/README.md#presence) |
| Catch-up | Only the Aven Peer's hub answers `heads`, `catch_up`, `lines` | `hub.rs`, `link.rs`, `chats.rs` | [Sync by version](brain/peers/README.md#by-version-between-readers) between readers and [catch-up by arrival number](brain/peers/README.md#by-arrival-number-from-keepers) from keepers, on Doc logs only |
| Keeping | Only the Aven Peer keeps every file (`keep::keep`) | `keep.rs`, `main.rs` | [Keepers](brain/peers/README.md#keepers) under each vault's keep caps, within the keepers' offers |
| Accepting the claim, tickets, sign-ins | The Aven Peer decides by compare-and-set on refs (`claim`, `signin-NNNNNN`, `joined-<invite>`) | `door.rs`, `Aven.ID.{Claim,Invite}` | The register, settled the same at every peer ([avenCAPS](brain/caps/README.md#the-register)) |
| Telling members the tree | The Aven Peer tells each peer the statements, unsigned configuration included | `door.rs`, `members.rs`, `link.rs` | The register as a Doc whose signed setup every member pins, synced like any Doc |

Browsers reach anyone only through a relay. A direct path between browsers (WebRTC) stays out of this plan.

## The clean-slate cutover

The new implementation replaces the first generation in seven stages, Docs first (P22). Each stage is Lean first,
then Rust against its vectors, then the box. At the end production switches, and `aven-gen1` is deleted.

| # | Stage | Owner | Status |
|---|---|---|---|
| 1 | **The Doc foundation:** Core's envelopes and logs, avenID's keys, the minimal caps, the docs layer and the ops engine | avenCORE, avenID, avenCAPS, avenDOCS, avenOPS | Done but the ops engine. Core: #1679, #1688, #1710, #1733. Keys: #1680, #1700, #1724, #1731. Minimal caps: #1702, #1706, #1716, #1734, #1735, #1736. Docs: #1694, #1732. The ops engine: its Lean on main (#1712), the engine itself #1697, open |
| 2 | **Authority in Lean** | avenCAPS | In progress. On main: authority through quorums and the member cap by confirm (#1674, #1717). Next, after #1722 and caps' keeper PR (L24): the authority in an envelope's body (`Aven.ID.Authority`, on `claude/avenid-a45`, no PR yet) and `Authorize` judged on the envelope's counted past (P11, P19, L20) |
| 3 | **Docs in the Peers** | avenPEERS | In progress, #1727: [below](#stage-3-docs-in-the-peers-1727) |
| 4 | **The tree as the first Doc** (the register) | avenCAPS | In progress. On main: tree/1's op calls (#1705), A42's items and no keeper list (#1696), passkey records, the owner-epoch op and the migration snapshot (#1718). Next: k of n on Core's signatures, where a removal beats every act the removed key approved outside its past; the sign-in binding the device's hybrid key under its owner's signature; the claim carrying the default keep cap; the register on stage 3's Doc host |
| 5 | **Catch-up and keepers** | avenPEERS | In progress, #1722: [below](#stage-5-catch-up-and-keepers-1722). Caps' half of the gate, aven-id's `keep` module, is on main (#1734) |
| 6 | **The chat as a fresh second Doc** | avenPEERS, avenOS | Not started. The old chains stay stored and are read as they are (A34) |
| 7 | **Rehearsal and cutover,** then `aven-gen1` deleted | every package | Not started: [the switch](#stage-7-the-switch-in-production) |

Beside them, [thread E](#thread-e-the-wire) moves the wire into the Peers' own packages; wire 3 then carries stages 3
and 5.

### Stage 3: Docs in the Peers (#1727)

Done on the branch:
- `peer/spec`, the Peers' Lean package (`Aven.Peer`): `Aven.Peer.DocSync` (group topics, `Live`, sync by version) and
  `Aven.Peer.Judge` (sifting a page that crashed the judge), with `topics.json`, `live.json`, `doc-sync.json` and
  `judge.json`;
- `aven-peer`'s `docs`: the group topic and `GroupTopic` on iroh-gossip, `Live`, tips, versions, `beyond`, the shelf,
  closing and sealing segments, and sifting's state machine, held to the vectors;
- the Doc host, natively.

Next:
- `doc_tips` and `doc_have` in wire 3, after the wire's move;
- the Peer-Light: one docs worker for all open Docs, sifting, the keys and the Closer in its own worker;
- the `Authorize` adapter between avenDOCS's trait and avenCAPS's verdict (L20);
- the keyring as the first Doc a device holds: the Doc host makes it and writes its Records, with avenID (L21);
- `sandbox/docs.mjs` in `up --check`, in all three engines, on the real path ([check 10](#how-it-is-checked), L19).

### Stage 5: catch-up and keepers (#1722)

Done on the branch:
- `Aven.Peer.Keeper` (arrivals, covers, catch-up after n), `Aven.Peer.Fetch` (the fetch gate) and `Aven.Peer.Serve`
  (a keeper per connection, bills and admission), in `db/spec` until they move into `peer/spec`, with `keeper.json`,
  `fetch.json` and `serve.json`;
- the pure crate `aven-peer-keeper`, replaying every vector behind the `Gate` trait, and catching up end to end,
  natively.

Next:
- the gate's and the keepers' frames in wire 3, after the wire's move;
- the native keeper: `--keep` and the keeper's store (`keep-<doc>`, `keep-books`);
- the Peer-Light's catch-up client, each page landed in one write;
- rule 10's quota composed over `Aven.Peer.Serve`'s admission and caps' quota (L24), and the bill removed from caps'
  `Keep` once #1722 lands (P21);
- the box ([checks 11 and 12](#how-it-is-checked)).

### Thread E: the wire

Done: the wire version, refused with `update` and followed by the tab (#1649); version 2, every frame after the
greeting in Core's CBOR (#1690, #1714); the first generation renamed `aven-gen1` (#1720).

Next:
- the move: the Rust `wire` and `presence` into `peer/wire` (`aven-peer-wire`), the Lean `Wire`, `WireCbor` and
  `Presence` into `peer/spec` as `Aven.Peer.*`, their vectors byte for byte (branch `claude/peers-wire-split`, no PR
  yet); `Aven.Peer.Keeper`, `Aven.Peer.Fetch` and `Aven.Peer.Serve` move in with it;
- wire 3, one shared bump for stages 3 and 5, in either order;
- `Aven.ID.Records.speaks_same` goes, in favour of the Peers' `meet`.

### Relays, addresses and presence (no stage yet)

- `RelayMap` from the register's relay list, `--relays` and `--bootstrap`; `--relay-url`, `--aven` and `--aven-key`
  go;
- address entries into `MemoryLookup`; gossip bootstrap through up to 3 members; up to 3 links;
- presence from signed beats (A35), in place of the hub's count, the chat's `here` and `bye`, and the wire's `presence`
  and `beat`;
- the Peer-Light's cache in OPFS, and the ticket link's entries;
- the box: a second relay (Alice Peer runs one, with the box's test CA, and is on the relay list), and Bob's native
  Peer as a keeper, named by a keep cap of Bob's vault.

### Stage 7: the switch in production

Production is never wiped. The switch carries out the register's migration, whose guarantee is checked on
production's own store before anything switches ([avenCAPS](brain/caps/README.md#productions-register)). Two releases,
no dual mode:

1. **Release N, the pre-flight.** The Aven Peer runs the migration's checks read-only on production's store. It logs
   only the verdict and counts; production's data never leaves the server.
2. **Samuel signs the register's setup** in avenOS, with his passkey (its PRF gives his owner and seal keys) and
   MaiaCityGuardian.
3. **Release N+1, the switch.** The Aven Peer checks the setup and runs the checks again, then writes the migrated
   envelopes and settles. If a check fails, it refuses, the deploy fails and says why, and production stays on
   release N.
4. **`aven-gen1` is deleted,** with every first-generation path: the hub, the chat's chains and its JSON room,
   `keep.rs`'s rule that keeps every file, and the wire's first-generation frames.

No code path keeps the old door running beside the settled one.

## How it is checked

`bun run up --check` grows. Checks 1 to 7 and 9 run with the Aven Peer **stopped** after the first steps
(`failures.json` holds what each must see):

1. Alice Peer and Bob's Peer-Light still chat, through Alice Peer's relay: lines both ways.
2. A third peer (Alice Peer-Light, reloaded) syncs the register from Alice Peer, and settles the same tree as the
   others.
3. A file Bob's Peer-Light shared loads from Bob's Peer, which Bob's vault named as a keeper beside the default, while
   its sender's tab is closed.
4. A ticket made before the stop is claimed through Alice Peer's relay; the claim waits ("Waiting for Maia City to
   confirm"), Alice Peer confirms it, and the new member's vault holds its member cap and chats.
5. Two claims of one ticket from two profiles, at once: every peer settles the same winner, and the loser's avenOS says
   "already used".
6. A withdrawal and a claim of one ticket, each signed without seeing the other: the withdrawal wins everywhere, and
   the claimant's device is out at every peer.
7. The Aven Peer starts again, syncs from members, and settles the same tree as every other peer.
8. A peer whose wire version differs is refused with `update`, and an open tab switches to a newer release without
   losing a draft (`sandbox/upgrade.mjs`, with the Aven Peer up: production's stand-in a version ahead, in all three
   engines, and Alice Peer a version behind).
9. A peer that hides an envelope of the register, or the newest envelope of a Doc's log, from one member is caught.
10. With Alice Peer stopped, a commit at Alice's Peer-Light reaches Bob's Peer-Light over the relay, in all three
    engines (stage 3). It runs the real path, never keys from the cast's configuration: Alice signs up with the box's
    PRF passkey stand-in, her keyring Doc is made, and the test Doc is sealed to Alice's and Bob's vaults through their
    keyrings, on the members' group topic (L19).
11. Bob's Peer-Light goes offline, Alice commits 500 envelopes, and Bob catches up from a keeper; the time goes into
    `up --check`'s report, in all three engines (stage 5).
12. A fetch without a proof, and an upload of a Doc no keep cap names, are refused (stage 5).

`bun run lanes` adds lanes for losing the Aven Peer's relay, losing a member's relay, and both relays up with the
home relay killed mid-chat. Each reports the path iroh took, how long until a line arrived after the loss, and which
peer served.

## Open work

- **A stage for relays, addresses and presence:** none names them yet
  ([above](#relays-addresses-and-presence-no-stage-yet)).
- **Granting and revoking the confirm cap after the setup:** it comes with the register's other governance
  (avenCAPS).
- **The old side for every store, a nice-to-have:** a general proof that `Members.restore` always reads back a clean
  store, and that `Members.admits` admits exactly its `restoredKeys`. Today these are checked on every invite trace
  (`oldSideAgrees`), and on production's one store before it migrates. Not a blocker (avenCAPS).
- **The design's open questions** are on [avenPEERS's page](brain/peers/README.md#open-questions).

## Not in this plan

WebRTC between browsers; the Mac app; mixing traffic across relays.

## Done when

- In the box, the twelve checks above pass, and `bun run lanes` shows each loss.
- In production, the register settles from production's stored statements to the same tree as before, under a setup
  Samuel signed; a member's Peer on the relay list carries a browser while the Aven Peer is restarted; and `aven-gen1`
  is deleted.
- Lean proves the Peers' theorems and the register's without `sorry`, and every test derives from them.

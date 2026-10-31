# Milestone 2: the members' network

Milestone 2 makes the network invite-only and proves its iroh layer with the first example app, a live chat
(Samuel, 30 Oct 2026). Before it, production has one person, its admin ([`PRODUCTION.md`](PRODUCTION.md)). After it,
the admin invites people; only members get in, at the relay and at every peer; and members chat over iroh-gossip, live,
between browsers, Peers and the Aven Peer. This file is its plan and its status.

**Status: done.** It is live in production: the admin invites at `aven.maia.city`, people join with a passkey, and
members chat. Its design lives in avenBRAIN: who is in (tickets, claims, membership as a cap: A12, A38) in
[avenCAPS](brain/caps/README.md); the door, gossip and the one protocol in [avenPEERS](brain/peers/README.md). The chat
moves onto a Doc at the cutover's stage 6 ([`PEERS.md`](PEERS.md#the-clean-slate-cutover)).

## What a person sees

- **The admin** opens **Invite** in avenOS, gets a link, and sends it however they like.
- **The invited person** opens the link, signs up with a passkey, and is a member: their own vault, owned by their
  passkey and MaiaCityGuardian, with this browser as its device. The link works once.
- **Every member** opens **Chat**: one room for the network, the messages of everyone in it, live, with who is present.
- **Every member signs in again** on another browser, or after their browser's data was reset, with **Sign in with
  your passkey**: the browser becomes one more device of their own vault, without a new invite. **Sign out of this
  browser**, in the account menu, forgets this browser's device key.
- **Anyone else** gets nothing: the relay doesn't let them in, no peer answers them, and avenOS shows "invite only". A
  passkey that owns no vault is told "This passkey isn't a member of Maia City. Ask the admin for an invite."

## Thread A: the door and gossip (Lean and Rust), done

`id/spec`, `id/core`, `db/spec`, `db/core` (now `gen1`), `peer/native`, `peer/light`.

- **Lean (`Aven.ID`):** invites, withdrawal, joins and membership. Theorems: only the admin invites; an invite
  is used at most once, and not after it is withdrawn; a join founds a person's vault owned by its passkey (and the
  guardian, if configured) with one device; the door admits exactly the devices of member vaults, the Aven Peer and the
  devices of the admin's owners. Vectors `invites.json` and traces of invites, joins and withdrawals.
- **Lean (`Aven.DB`):** a chat message and its checks (a member's device signed it; its text has a size limit), and
  presence in the room. Vectors for both.
- **Rust:** the statements in `aven-id`; the Aven Peer storing invites and joins; the relay's allow-list and the
  `after_handshake` hook from the tree; iroh-gossip (newest stable, pinned exactly) on the shared `Router`, in the Peer
  and the Peer-Light, with the chat's messages given to avenOS.
- **Two fixes found on 30 Oct:** the Aven Peer waits for its store when it starts, rather than exiting; Alice Peer
  resolves `--aven` again each time it reconnects.

## Thread B: avenOS's Chat and Invite (Svelte), done

`os/web`, `sandbox/check.mjs`'s new steps.

- **Invite,** for the admin only: make an invite (its link and a QR code), see the open ones, withdraw one.
- **Join:** the invite link's screen, a passkey's signup, then the dashboard.
- **Chat,** a new app on the dashboard: the room, who is present, a line to write in. Pushed lines, never re-queried
  (README rule 8).

## Thread C: real-world iroh in the box, done

`sandbox/box/` (compose, a router image's setup), `sandbox/lanes.mjs`.

The lanes avenSANDBOX designed ([topologies](brain/sandbox/README.md#topologies)), now tested, the chat as their probe:

- **home NAT:** Alice Peer behind a router that masquerades and keeps ports. iroh starts on the relay, then
  hole-punches a direct path;
- **hard NAT:** the router picks random ports. It stays on the relay;
- **UDP blocked:** the router drops UDP. Relay only, over HTTPS.

`bun run lanes` runs them; `up --check` runs the flat lane. Each lane reports the path iroh took and how long until a
chat line arrived.

## How it is checked

`bun run up --check`, on the production-configured Aven Peer the check already runs:

1. the admin claims, makes an invite, and a second browser profile joins with it;
2. the link used again is refused, and so is a withdrawn invite;
3. a third profile without an invite is refused by the relay and by the Aven Peer's hook;
4. the admin and the member exchange chat lines both ways, and the Aven Peer's join line arrives;
5. a message signed by a key that is no member's is dropped by every peer;
6. a restart keeps the members, and the chat keeps its history in the store;
7. the member's passkey on another profile signs in and becomes a second device of their vault, which catches up on
   the chat; an assertion replayed for another browser, and a passkey that owns no vault, are refused; that browser
   signs out and in again.

In the cast's box, Alice, Bob and Aven are members by the cast, and their four peers chat the same way.

## Open work

- **A refused join isn't told why:** the door closes the line, and avenOS shows only that it failed.
- **Vite takes a second port** when the box restarts while the old dev server still holds the first.

## Not in milestone 2

Members inviting; roles and caps; chat history, Loro and documents (the store upgrade brought the chat's history);
leaving or removing a member; more passkeys per vault; the browser-direct lane over WebRTC.

## Done when

All met:
- In the box, the seven steps above pass, and `bun run lanes` shows the path each lane takes.
- In production, the admin invites someone at `aven.maia.city`, they join with a passkey, and the two chat live.
- Lean proves the theorems above without `sorry`, and every test derives from it.

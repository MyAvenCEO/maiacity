# Milestone 2: the members' network

Milestone 2 makes the network invite-only and proves its iroh layer with the first example app, a live chat
(Samuel, 30 Oct 2026). Before it, production has one person, its admin ([`PRODUCTION.md`](PRODUCTION.md)). After it,
the admin invites people; only members get in, at the relay and at every peer; and members chat over iroh-gossip, live,
between browsers, Peers and the Aven Peer.

Only what this plan names gets built. Three task threads, in parallel, each in its own folders.

## What a person sees

- **The admin** opens **Invite** in avenOS, gets a link, and sends it however they like.
- **The invited person** opens the link, signs up with a passkey, and is a member: their own vault, owned by their
  passkey and MaiaCityGuardian, with this browser as its device. The link works once.
- **Every member** opens **Chat**: one room for the network, the messages of everyone in it, live, with who is present.
  A reload empties it. The chat has no history in milestone 2: it is there to test the members' network.
- **Anyone else** gets nothing: the relay doesn't let them in, no peer answers them, and avenOS shows "invite only".

## Decisions

- **Only the admin invites** (Samuel, 30 Oct 2026): the admin coop, Maia City by default
  ([`PRODUCTION.md`](PRODUCTION.md#part-c-maia-city-the-admin-coop)). An invite is an owner's act on Aven, so it is
  signed as the claim is: by the passkey of a person whose vault owns the admin coop, a WebAuthn assertion over the
  invite's statement. No member invites anyone. Lean and the code define the admin as the owner of the network's
  vault, whatever its kind, so the rule holds before and after the coop lands.
- **An invite is used at most once.** It names a one-time key; its link carries that key's secret. Joining is a
  statement signed by the one-time key and by the joiner's new passkey. The Aven Peer stores it under the ref
  `joined-<invite>`, set from nothing by compare-and-set, as the claim is. An invite can be withdrawn by the admin
  until it is used.
- **Members are vaults, the door checks devices.** A member is a person's vault admitted by an invite, and belongs
  to the admin coop (Samuel, 30 Oct 2026; #1457). The door lets in
  the devices of member vaults, the Aven Peer and the devices of the people who own the admin: nothing else.
- **The door is checked twice** (README, "Invite-only, end to end"): the relay admits only members' device keys, and
  every peer's `after_handshake` refuses any other. Each peer learns who is a member from the network's tree, which the
  Aven Peer tells its members, signed statements and all, so each peer checks them itself.
- **Members-only gossip:** one iroh-gossip topic per network, derived from the network's id. Peers join it only
  through members, and drop any message whose sender is not a member's device. Each message is signed by its device.
- **The chat is in memory:** messages live in each peer's memory and nowhere else. No store, no Loro, no history
  (that is milestone 4).
- **The Aven Peer is in the room:** it joins the topic, keeps it alive for the Peer-Lights, and says once who joined.
- **No new protocol of our own:** invites, joins and the tree travel on `aven/db/1`; the chat is iroh-gossip beside it
  on the same `Router` (README rule 9).

## Thread A: the door and gossip (Lean and Rust)

`id/spec`, `id/core`, `db/spec`, `db/core`, `peer/native`, `peer/light`.

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

## Thread B: avenOS's Chat and Invite (Svelte)

`os/web`, `sandbox/check.mjs`'s new steps.

- **Invite,** for the admin only: make an invite (its link and a QR code), see the open ones, withdraw one.
- **Join:** the invite link's screen, a passkey's signup, then the dashboard.
- **Chat,** a new app on the dashboard: the room, who is present, a line to write in. Pushed lines, never re-queried
  (README rule 8).
- Built against thread A's messages as the Peer-Light gives them; until they land, against the vectors.

## Thread C: real-world iroh in the box

`sandbox/box/` (compose, a router image's setup), `sandbox/lanes.mjs`.

The lanes [`SANDBOX.md`](SANDBOX.md#real-world-iroh-inside-the-box) designed, now tested, the chat as their probe:

- **home NAT:** Alice Peer behind a router that masquerades and keeps ports. iroh starts on the relay, then
  hole-punches a direct path;
- **hard NAT:** the router picks random ports. It stays on the relay;
- **UDP blocked:** the router drops UDP. Relay only, over HTTPS.

`bun run lanes` runs them; `up --check` runs the flat lane as today. Each lane reports the path iroh took and how long
until a chat line arrived.

## How it is checked

`bun run up --check` grows, on the production-configured Aven Peer the check already runs:

1. the admin claims, makes an invite, and a second browser profile joins with it;
2. the link used again is refused, and so is a withdrawn invite;
3. a third profile without an invite is refused by the relay and by the Aven Peer's hook;
4. the admin and the member exchange chat lines both ways, and the Aven Peer's join line arrives;
5. a message signed by a key that is no member's is dropped by every peer;
6. a restart keeps the members and empties the chat.

In the cast's box, Alice, Bob and Aven are members by the cast, and their four peers chat the same way.

## Open

- **A refused join isn't told why:** the door closes the line, and avenOS shows only that it failed.
- **Vite takes a second port** when the box restarts while the old dev server still holds the first.

## Not in milestone 2

Members inviting; roles and caps; chat history, Loro and documents; leaving or removing a member; more passkeys per
vault; the browser-direct lane over WebRTC.

## Done when

- In the box, the six steps above pass, and `bun run lanes` shows the path each lane takes.
- In production, the admin invites someone at `aven.maia.city`, they join with a passkey, and the two chat live.
- Lean proves the theorems above without `sorry`, and every test derives from it.

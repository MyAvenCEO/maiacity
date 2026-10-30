# Stored before the agent

`store-2026-10-30.json` is production's store as main's code wrote it on 30 Oct 2026 (commit f4e20e4), before Aven's
kind `network` became `agent` and the members moved to the admin coop (`Aven.ID.Before`). It was made in the box with
that commit's `aven-id`: a claim in production's configuration (RP ID `maia.city`, origin `https://aven.maia.city`, the
test MaiaCityGuardian, the admin coop Maia City), two sign-ins, two invites, one withdrawn and one used by a join.
Every passkey is a test P-256 key (`sha256("avenSANDBOX test passkey: <id>")`), every browser a test Ed25519 key.

- `refs`: each ref the Aven Peer keeps (`peer/native/src/door.rs`) and the statement its blob holds, byte for byte;
- `tree`, `members`, `admitted`, `invites`: what that code built from them: the tree (Aven of kind `network`), the
  members, the keys the door let in, and each invite's state.

It is frozen: never regenerate it. `id/core/tests/before.rs` and `peer/native/tests/door.rs` read it with today's code.

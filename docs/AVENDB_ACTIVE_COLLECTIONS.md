# Active canonical entry collections — task 5 draft slice

Base: merged release `720922e0570433a0e5c6663f6f15f91e7631d176`.
This slice is not deployed or a completed task 5. Native/WASM validation and physical-device acceptance are still required.

## Problem and scope

The existing targeted `get`/`room` observer can update before a background world summary. Actual Todos still derived its rows from `world.entries`; local writes waited for that expensive summary, and remote changes also faced an unconditional `max(150ms, 2 × previous refresh duration)` delay. The existing generic-status browser fixture used a targeted `get`, so it did not cover the real collection view.

The new `entry_views` read takes a required `vault` and optional array `types`. It returns `{ok:{rows:[...]}}`, or the ordinary refusal/null result. Rows use the same landed entries, device-visible meanings, and **single canonical EntryView JSON projection** as full world. Unknown/empty vaults return no rows. Types filter only labels already known to the device. Sealed metadata stays sealed. The operation never grants authority or synthesizes a record from a mutation request.

Every entry field remains identical to world: readers, writers, sharers, levels, authors, record/lens presentation, deletion state, files and entry/file `syncedTo`. The node supplies the same holdings projection. The Rust differential regression compares selected rows to full world before/after sharing, revocation and deletion, across owner, unrelated and relay devices, with nonempty entry/file holders. Malformed vault/types and unknown fields are refused.

Todos mounts one existing `api.observe` subscription for its selected vault. It receives authoritative rows independently of full-world pacing; it clears failed/refused results and disposes with the component. Existing query/device/context scope handling suppresses stale answers. Vault/share navigation metadata still comes from world. This adds no persistent cache, optimistic success state, chat-specific path, server authority, or new write semantics.

## Lean-first boundary

`AvenDB/LocalWrite.lean` models collection rows as an exact selection from an authoritative projection: a selected row retains its canonical fields, and collection result selection is independent of full-summary readiness. The model passed before implementation; it does not extract Rust/JS or prove authorization, filesystem durability, browser paint timing or performance. Native differential tests and the actual component regression establish the separate implementation correspondence.

## Evidence so far

- RED on release source: actual Todos Open → Doing remains stale while full world is held; its 1,500ms visibility assertion fails.
- GREEN: Chromium and WebKit mount actual Todos, accept local Open → Doing, inject remote accepted Done, then revoke the row's read visibility. Both statuses appear and the revoked row disappears while full world stays held.
- Existing Chromium/WebKit local-write, refusal, targeted remote-read, serialized engine priority, single-world-reader and device-retirement fixture remains green.
- 30 focused JS tests pass with 191 assertions: local-write, reactive-read, world-reader and query-window.
- Lean LocalWrite checks pass. Rust source parser checks pass; these are not Rust compilation or execution.
- Svelte check initially found two new callback annotations, now corrected. The unrelated base-file `src/lib/media/ref.test.js` import typing error has the existing narrow fix cherry-picked from `b66372058a6434b5897a802f26babd85186ce013`; final full check is pending.

## Remaining gates and limits

1. Run native differential regression and existing core/net suite after the combined Mac build releases the Cargo slot. No Rust/WASM build was run for this slice yet.
2. Build matching WASM, run native/browser parity and exact-head CI. UI-only deployment with an older engine does not support the new read and must not ship.
3. Reconcile with the combined studio branch's changes, especially `.github/workflows/kernel.yml` and session publication hooks. This branch does not touch that checkout or build.
4. Validate on physical Mac/iPhone/iPad: generic local writes, remote visibility under backlog, offline write and reconnect; collect revision evidence and timing distributions. No <50ms or internet-bandwidth claim follows from synthetic fixtures.
5. Migrate other active world-dependent consumers through the shared mechanism as separate bounded slices; Sparks, Artifacts, Story/Note and other world-entry consumers remain. Do not mark every generic UI path complete from Todos alone.

The global world watcher retains its pacing to avoid starving background/UI work. `entry_views` bypasses its encoding mutex, but the node's holdings computation still scans logs/files, and scoped JSON construction still runs under the Lab read lock. A large selected vault can therefore remain expensive. These costs and already-running replay/engine work need measurements and further bounded optimization; this slice removes one proven dependency rather than guaranteeing instant behavior.

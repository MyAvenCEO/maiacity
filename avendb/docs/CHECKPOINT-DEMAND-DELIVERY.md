# Owner-approved checkpoints on active-view demand

This branch connects the existing bounded read-only entry projection to real peer transport.
It does not adopt a writable CRDT snapshot or replace history, authorization, or discovery.

## Publication

`Node::run({"op":"checkpoint_view","entry":"<entry id>"}, ..., authenticator)`
prepares an encrypted record and the existing `Action::Snapshot` owner approval. Without an
authenticator it returns the normal approval request and makes no signed edit or blob pin.
The caller must invoke this explicit operation with the person's existing approval ceremony.
Active-view demand never signs a checkpoint automatically. A hosted peer has no extra authority.

After the ceremony, encrypted bytes are staged under a temporary BLAKE3 pin before the signed
approval is announced. Successful approval pins them under an entry-specific durable tag;
a newer checkpoint replaces that tag rather than pinning every obsolete version forever.
A storage failure is reported, never presented as successful publication. Publication can be
retried through the same owner operation; a failed durable pin must not imply file availability. Ordinary history is
still available if a signed snapshot's bytes are temporarily unavailable.

## Delivery

An explicit active-view entry list or positive type/vault discovery hint triggers at most eight working-set checkpoint attempts
before ordinary entry history scheduling. The existing authenticated connection binds the
requester; the request contains a version, entry ID and optional already-retained snapshot ID.
That ID is only a transfer hint: current READ is checked before suppressing an unchanged offer.
Repeated announcements therefore do not redownload, verify or decrypt an unchanged checkpoint. The provider checks current held
READ/key/wants policy before selecting the newest standing owner-approved snapshot. It includes
only authorized entry setup, the selected audience-key evidence, and the signed snapshot, not intermediate content edits. A final
exact log-revision fence after encoding and blob I/O rejects intervening policy changes.

The provider holds its response-memory permit through the socket write, so slow readers cannot
accumulate prepared checkpoint buffers. The foreground page budget is acquired before receiving the bounded response. Each attempt has
a two-second deadline within the discovery pass's ten-second budget. Cancellation/replacement
is checked after transport and inside the database action before admission. Unsupported peers
fall back after the first refusal, and supported peers with no checkpoint return an empty offer.
Ciphertext is capped at 1 MiB plus its envelope; evidence at 512 KiB and 64 edits. Provider
variable-length evidence fields are bounded before cloning/encoding. The recipient uses ordinary
prepared signature verification and normal receive, then the existing checkpoint validation gate.
No trusted snapshot, owner signature, or authorization is inferred from peer identity or hints.

A retained checkpoint reaches the existing generic query/get lens/schema/filter pipeline with
`readOnly: true` and `checkpoint.partial: true`. Mutation remains refused until canonical history
covers the signed basis. Neither a useful view nor an empty discovery response claims global
completeness. Ordinary authorized history continues in parallel and supersedes the projection.

## Trust and remaining limits

Current authorization means **locally held verified policy**. Unknown revocations and global
freshness are not proved. The owner attests the record for a basis the new device may not yet hold.
The existing full-holder comparison rejects dishonest records whenever that basis is held.

This first delivery path requires identity/governance and audience keys to be available through
normal login/authority sync. Oversized setup and entries without an approved checkpoint use
ordinary sync. Publication is an explicit JSON operation, not yet a bulk owner approval UI or
periodic delegated publisher. The projection is read-only; writable CRDT frontier adoption is
not implemented. Pinned ciphertext survives restart, but automatic offline rehydration of the
projection cache is separate work. Actual iPhone/iPad first-view latency is not established by
local transport tests.

Wire and response allocations are bounded, but provider CPU is not independent of history size:
the current offer path scans standing snapshots and authorized edit indices. Authorization indices
reuse the existing requester/revision cache; a changed log revision can rebuild that cache. A
scoped snapshot/setup index remains follow-up optimization, and this path does not establish
a fixed first-view latency for arbitrarily large stores.

## Validation ledger

- Lean `AvenDB.CheckpointDemand`: gate assumptions for projection adoption after ordinary signed-evidence admission, cancellation, revoked-reader, stale-response,
  unsigned refusal and policy preservation. Standalone Lean check passed before implementation.
- Core offer coverage: unauthorized requester refusal, authorized bounded setup excluding content
  history, revocation refusal; existing five projection adversarial tests remain applicable.
- Net `checkpoint_prepared_response_is_fenced_by_pending_revocation`.
- Demand working-set cancellation, replacement, and expiry regression.
- Net `checkpoint_wire_rejects_truncation_versions_and_unbounded_lengths`.
- Net `owner_checkpoint_reaches_a_type_only_view_before_its_history`: actual owner ceremony,
  authenticated two-peer transport, type-only demand, ordinary query, all ordinary history pulls (including the live lane) held.
- 2026-10-24 focused validation: core `entry_projection` 5 passed; net demand 3 passed;
  net discovery 4 passed; standalone `CheckpointDemand.lean` passed. Net checkpoint framing,
  revocation fence, working-set expiry, and holdings invalidation passed.
- The fresh-entry regression exposed omitted audience-key evidence. Adding only that authorized
  key log to the bounded evidence fixed the failure: the real two-peer first-view regression
  passed in 5.25 seconds, with **all ordinary history pulls withheld**, exact current record
  equality, read-only projection, and unrelated entry still absent. Temporary diagnostic prints
  were removed after this run; final combined integration checks remain the release gate.
- No deployment or physical-device latency claim.

## Diagnostics dispatch repair

Commit [`ca3959da`](https://github.com/MyAvenCEO/maiacity/commit/ca3959da) registers
`measure_peer_policy` in the shared engine operation parser. Its real authenticated two-peer
regression now invokes the public `Node::op` instead of calling the receipt recorder directly;
it passed in 7.78 seconds. This fixes operation dispatch, not physical iPhone latency validation.

Final focused gate: core projection **5/5 passed** (including a fresh entry after login authority
setup); core checkpoint filter **3/3 passed**; net checkpoint filter **5/5 passed**; standalone
Lean passed. The successful transport binary included temporary test-only diagnostic prints,
removed in the committed source. Combined release CI and device acceptance remain separate.

Implementation: [`7ad019df`](https://github.com/MyAvenCEO/maiacity/commit/7ad019df).
Status: implemented and focused checks passed; integration, deployment, physical-device
measurements, cache rehydration, and writable partial bootstrap are not claimed complete.

## Follow-up: offline working-set restoration

Implemented, Rust validation pending the shared compiler slot: active-view demand first checks
local authorized discovery and explicit IDs, then reopens at most eight pinned checkpoints
before peer work. Startup does not eagerly decrypt every checkpoint. The persisted tag is only
a locator: its hash must name a currently authorized signed snapshot, the signed length bounds
the allocation, ciphertext hash/AEAD checks run normally, and current policy plus current demand
are checked again at adoption. Missing/corrupt/withdrawn pins fall through to ordinary sync.
No history, policy, or writable state is adopted from ciphertext.

Lean `PersistedGates` makes the pin-match and policy-recheck assumptions explicit; wrong-pin,
unchecked-policy, and revoked-reader refusal proofs pass. The new disposable-disk regression
reopens with history still withheld and no connected peers, issues a type-only demand, checks
the exact current read-only record, and rejects a corrupted pin and a subsequent revocation.
This follow-up does not establish physical mobile latency or complete app manifest coverage.

Offline follow-up implementation: [`5a13b4ea`](https://github.com/MyAvenCEO/maiacity/commit/5a13b4ea).
Rust gate remains pending integration: `cargo test -p avendb-net --lib persisted_checkpoint_reopens_offline_and_rejects_bad_pin_and_revocation -- --nocapture`,
then the existing `checkpoint` and core `entry_projection` filters. Loopback permission is
needed for the disposable node endpoints even though the reopen assertion has no peers.

## Writable continuation boundary

See [WRITABLE-PARTIAL-BOOTSTRAP.md](WRITABLE-PARTIAL-BOOTSTRAP.md) for the source-backed
implementation sequence. Current projections are JSON records; enabling writes requires a
versioned authenticated Loro base plus counted avenDB history metadata and a shared base/suffix
validator. Removing `ReadOnly` or constructing a new CRDT from the displayed JSON is unsafe.
That design is not an implementation or a completed convergence proof.

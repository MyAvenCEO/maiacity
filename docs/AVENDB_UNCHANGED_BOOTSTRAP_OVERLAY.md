# Unchanged bootstrap overlay reuse — pending Rust validation

An unchanged canonical refresh used to clone every sealed anchor, decrypt and
import its base, verify suffix signatures, and reconstruct the same entry again.
This candidate moves the existing derived Shown/history/item values temporarily
out of the Store and puts them back only after ordinary canonical refresh and
current projection-authority checks pass with the exact same input basis.

The basis uses process-local log allocation revision, explicit keyring insertion
revision, anchor replacement revision, and warm/forget revision. Material maps
are content-addressed and append-only between forgets; their cardinalities detect
new bodies/blobs/signed material. Follow demand, query depth and gate settings
also participate. No full-log clone/hash scan is added. No peer-supplied state or
persistent cache becomes authority. Lock drops reuse; any edit (including policy
or revocation), new key, anchor replacement or material change falls back to
reconstruction under all three suffix correctness guards.

This is intentionally conservative: unrelated log edits also invalidate reuse.
It does not yet incrementally extend only affected entries, skip canonical refresh,
or remove every canonical show operation. Retained values are moved, not cloned;
there is no additional long-lived decrypted entry/history cache. Canonical refresh
may briefly reconstruct its local partial view alongside retained values.

Validation pending: Rust regression augments the owner bootstrap write/reopen/
concurrent suffix/revocation scenario with three unchanged refreshes per device
and exact reuse counters. Additional revision regression checks same-length log
replacement, key/anchor replacement and lock invalidation. The Lean model proves
only exact-basis/current-authorization gates; implementation and cryptographic
correspondence remain premises. Focused Lean passed; Cargo intentionally deferred
to root's shared compiler queue. No physical-device or deployment claim.

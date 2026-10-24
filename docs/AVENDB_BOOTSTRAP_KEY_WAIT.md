# Retained owner-bootstrap key waits

A held suffix ciphertext without its exact entry-family key now pauses at that
edit. The core retains its validated prefix and exposes `blockedReason` as
`missing-entry-key`; it does not discard the anchor or request a duplicate signed
edit. Pending suffix count continues blocking mutation, and the materializer's
runnable predicate excludes this wait. A keyring revision change invalidates the
cursor and retries normal authorization/decryption/admission.

A present key whose ciphertext authentication or body decoding fails produces
`invalid-entry-body`, not a false missing-key diagnosis. The useful prefix is
retained read-only, but the invalid body is never counted. Ordinary policy changes
and revocation still invalidate adoption and its wait status.

`Lab::owner_base_wait_reason` gates status with current active-owner authority.
The common network layer must recover key material through ordinary authenticated
key handling; no new key privilege or unauthenticated key injection is introduced.

Lean BootstrapKeyWait and parser checks passed. Added core regression with a
validated alternate same-family key withheld until after its ciphertext, no-spin,
read-only retention, late keyring insertion and revocation while waiting. This
fixture models already validated key insertion; network key authentication is
not claimed tested. Cargo execution pending coordinator queue.

# Active owner-base provenance — implementation, Rust validation pending

Writable owner-base adoption removes the earlier read-only projection cache. The
universal query/get result must still disclose that history is checkpoint-backed.
`Lab::active_owner_base` exposes the signed snapshot and basis only for an active
anchor with an up-to-date replay, current projection authorization and owner role.
It never asserts complete history, file inventory, global discovery or file bytes.

Query and entry-detail results keep additive `checkpoint.partial: true` metadata.
Detail file inventory remains explicitly incomplete. Query observation uses the
conservative `checkpoint-basis` kind, so the existing remote-consumer diagnostic
cannot mistake adopted history for ordinary fully held main-head provenance.
Validated later writes still use normal admission; this change does not enable
runtime publication, fetching or writable adoption.

The retained checkpoint hint includes this authorized active anchor, avoiding a
repeat request for the same attested snapshot after adoption. The hint is merely
an optimization; authenticated serving and activation still recheck authority.

Focused Lean AnchorProvenance passed. Existing owner adoption/reopen/revocation
Rust regression now checks public engine query/get metadata, hint retention and
revoked provenance. Cargo is pending the coordinator's serialized compiler queue.

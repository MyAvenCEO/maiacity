# Scoped package inventory follow-up

Models (`#models/<id>`) and Code (`#code/<id>`) previously discovered pinned
file entries by filtering `world.entries`. A metadata-only warm startup therefore
blocked both pages behind the legacy whole-world gate; a partial local world could
also incorrectly suggest republishing absent package files.

Both pages now use the shared reactive `entryCollection` with the canonical
`entry_views` operation, selected vault, current acting vault and positive `file`
type. The ordinary read checks authorization; the observed demand window receives
only the vault/type hints, never acting identity as peer authority. Local reads do
not wait for demand acknowledgement or an online peer. Context replacement and
observer teardown retain the existing shared cancellation/late-reply behavior.

The audited routes now allow incomplete navigation metadata. Loading, failed
inventory and local absence have different wording. Missing local rows are not a
claim of global absence, and entry counts are not downloaded-byte counts. No
mutation, package download, owner approval or peer privilege is added.

Validation: 8 Bun tests passed across package-inventory, document-query and
startup-summary; both actual Svelte components compile. A test holds the peer
demand promise unresolved while requiring the authorized local read to finish,
then verifies demand cleanup. This is not physical Mac/iOS acceptance.

Remaining broad-world consumers include Library, Stories and its related views,
Query, Flows, Jobs and several detail/reference widgets. Each needs an explicit
scoped dependency contract before removing its fallback gate. Assets and Docs are
already separately scoped in the combined base; this change does not modify them.

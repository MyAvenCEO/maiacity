# Manifest coverage update

The shared game leaf now includes its actual root entry types (`game`, `view`, `logic`, `config`) as well as its game tag. This permits bounded authorized type discovery on a cold peer before any tagged local rows exist. Reference following still discovers assets from those roots. A Chat declaration covers the coop's shared rooms; the existing universal Chat room query separately requests all rooms the device can read across its vaults. Neither hints nor manifests grant access.

Repository declarations alone do not change owner-controlled live entries. `scripts/propose-manifests.mjs --run` now proposes changed fields on existing manifest entries, as well as creating missing manifests. Previously it skipped every existing ID, so a corrected game declaration could never reach an already-created manifest. No seed fallback, direct main-lane mutation, or owner approval bypass is introduced. Duplicate live manifest IDs fail before writes. Without `--run`, nothing is written.

Validation: 20 focused tests pass, including cold empty-row discovery hints for Chat/game, unchanged proposal idempotence, existing-entry update planning, duplicate rejection and retained route cancellation/query semantics. These tests do not prove end-to-end transfer performance. Live owner proposal/acceptance remains outstanding; no live vault mutations were performed by this change.

## Live catalog proposal and follow-layer work (2026-10-25)

Read-only live catalog inspection found 13 records: Chat was absent and nine game
manifests had tag-only selectors. Prepared and read back AIP-35, entry
`87343a6fc5d0cec2ff7603a1ce2864131608e929ce9c7869211af0e7cda1786a`.
It adds Chat and only adds typed selectors to the nine game parts. Existing
routes, priorities and follow depths (including V2 depth 3) are preserved.
All ten proposed records were checked before promotion. Owner acceptance is
pending; promotion does not make the records live and is not a runtime speed test.

Dependency traversal also repeatedly enumerated every local vault's files once
per referenced entry. It now shares a single inventory within a dependency layer
and discards it before the next transfer/layer. This is ephemeral planning state,
not a persistent cache or an authority source. Cancellation and normal authorized
file projections remain unchanged. Newly arriving files are re-enumerated in the
next layer. A regression checks two roots share one scan while a file arriving
between layers is still discovered; manifest/file-inventory suite:26 pass.

## Preserve the existing V2 dependency depth

The owner-approved catalog read-back after AIP-35 retained V2 follow depth 3.
The generic source declaration still used 2, so a future full catalog proposal
could have reduced its coverage again. The source now preserves 3 for V2 and 2
for other games; the declaration regression guards that distinction. This is a
repository correction, not another shared-record publication.

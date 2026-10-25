# Studio discovery without discarded local reads

Studio collection discovery previously mounted two ignored query subscriptions. Even with limit 1, an uncertified cold query may classify all candidates to compute its exact count, so the scheduling bridge could perform unrelated hydration on each revision.

The shared entry-demand window now accepts bounded positive discovery selectors. The session exposes an effect-owned scheduling scope that tracks device and selected-vault changes. Studio uses it for file/task/story and vault-scoped cut discovery, without executing a query, bring or world read. Existing collection readers still own actual content loading; demand does not prove availability, completeness or authorization.

Validation: 32 focused JavaScript tests passed (135 assertions), including no content calls, vault replacement, device ownership transfer, cancellation, lease renewal and existing entry windows. The session rune module compiles. Physical latency and combined application checks remain delivery acceptance, not claimed by these tests.

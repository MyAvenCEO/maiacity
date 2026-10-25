# Fresh-device recipe catalog progression

Implementation: [c295d7fc](https://github.com/MyAvenCEO/maiacity/commit/c295d7fc).

A fresh empty local recipe catalog used to return an error before registering
any refresh path. Its later full-vault `fresher` check existed only after an
already nonempty result, so a newly syncing device could remain at the gate
until a manual retry.

Mounted `VaultRecipes` gates now own a standard `session.observe` read scope for
`code` / `recipe` in the requested vault. The generic query window recognizes
this explicit typed read as a discovery demand. Local reads do not await the
lease acknowledgement, peer completion, or whole-vault history. Actual local
revisions rerun the coalesced observer; the first usable catalog updates the
existing gate automatically. Route/device replacement and unmount close the
scope and reject late answers. No polling timer or network fallback is added.

An empty local response remains loading/unverified, not a confirmed empty
catalog. Refusals clear the cached recipe index instead of retaining stale
readable assets. The normal validation/hash/freshness paths still validate each
recipe. A generation guard prevents an older one-shot catalog load from
replacing a newer reactive result. Builds reuse the observed catalog instead
of starting the old full-vault bring merely to read that same index.

Validation: 27 focused tests passed across the new catalog lifecycle, generic
query windows and reactive reads. The new test starts empty, observes typed
recipe demand, delivers a local revision, reaches a usable catalog without a
bring/world/synced call, and checks release/late-answer suppression. Svelte
component compilation passed. Existing large asset fixture's empty-response
expectation was updated to loading; the full bundled-asset suite has not been
rerun in this isolated checkout. No Cargo or deployment performed.

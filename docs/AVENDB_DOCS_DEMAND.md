# Scoped document discovery

Docs previously derived its collection solely from `world.entries`, so an incomplete navigation summary could not open the view and no empty-view discovery lease requested its missing story/post entries. The view now owns an actor/vault-scoped `entry_views` collection and a selected-document `note` observer. Both use the shared authorized local read and demand machinery; reads do not wait for a peer acknowledgement. Docs is consequently admitted by the summary-startup route gate.

The list shows local loading, failure, or locally unavailable documents explicitly. It never treats an empty local collection as proof that no document exists or that a sharing grant is missing. Navigation labels still use vault metadata; ordinary read permission checks remain unchanged.

Validation: Lean ScopedDocumentView authorization/exclusion model passed; focused JS tests cover fresh empty collection with world unavailable and peer acknowledgement withheld, exact actor-preserving original operation, safe discovery types, unmount release, and route wiring. Eight tests / 33 assertions passed across document-demand, startup-summary and read-completeness suites. Docs compiles with Svelte. Rust unchanged; no Cargo. This is a separate follow-up to frozen release 6b6361c0, not a deployment claim or proof of full transitive/file completeness.

# Mounted proposal demand

Both proposal routes now share a reference-counted `session.observe({op:'aips'})` subscription while mounted. Ordinary device revisions refresh it without waiting for the full world summary. Last-consumer cleanup releases the observer/demand scope and clears retained rows; stale completions cannot publish into a replacement scope. Device/phase changes also clear rows.

The generic query-window discovery mapping asks for `aip` and `review` candidates, preserving an explicit vault when present, including when the initial local result is empty. It neither sends private predicates nor changes the original authorized `aips` operation. Invalid vaults produce no discovery hint. The opened AIP uses its own targeted observer, and explicit line-entry IDs in its reply become demand hints; arbitrary nested record strings do not.

Validation: 21 focused Bun tests / 89 assertions passed, including a real observedWindow/reactiveRead lease with two consumers, last-close release, stale callbacks, empty-first-result discovery, invalid vault and explicit line references. Both route components, AIP detail and the Svelte state module compile with the installed Svelte compiler. No Rust changes or Cargo run.

Limits: this does not prove remote discovery completeness, resolve all transitive proposal/file dependencies, or remove remaining world-derived naming/acting metadata from the UI. No mobile latency or deployment claim.

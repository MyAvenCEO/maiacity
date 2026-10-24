# One history pass for active-view file demand

`Lab::demanded_files` previously called `entry_files` separately for every
selected entry. Each call scanned the entire held edit log. An active view
requesting K entries therefore repeated that scan K times inside Lab admission.

The demand projection now filters entries with the same current `State::wants`
predicate and calls the existing `entry_files_batch` once. Each resulting root
still goes through `Lab::file`; unreadable file keys still exclude the root.
The output remains sorted and globally deduplicated. Empty demand skips the
history scan. No new persistent cache, authorization path or worker is added.

The existing batch helper regression counts actual history visits and checks
first occurrence/order. Its signed-device regression now also compares the
new demand result against the old per-entry reference for empty, duplicate
and multi-entry requests on five peers, before/after revocation and backup
restore. Existing selective-file-sync coverage remains applicable.

Validation: `DemandedFilesBatch.lean` passed; Rust source parsed and diff checks
passed. No Cargo was run because the shared compiler is owned by release work;
the expanded Rust regression must run before marking this slice validated.
This removes repeated full-history traversal, not the remaining single pass,
file-key index construction, cryptographic work or individual document costs.

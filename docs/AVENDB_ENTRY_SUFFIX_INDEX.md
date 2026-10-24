# Entry-local suffix discovery

Bootstrap reconstruction previously scanned every held edit for each anchor, hashed each edit, cloned all selected ciphertexts, and sorted a second cloned suffix. The log now maintains an entry-local ordered write index on append/receive/restore; removal rebuilds the index, and replacement owns its own index. Bootstrap queues contain edit IDs and clone only the edit being admitted in the existing shared 32-attempt turn budget.

The index is an untrusted candidate accelerator, not an authorization result. Signature verification, current canonical accepted-write checks, owner/proposal restrictions, dependency admission and encrypted-body checks remain in the admission path. Cursor reuse still requires the exact log/key/anchor/warm revision and existing store invariants. Late parents are evaluated against the currently selected suffix, matching the prior canonical `order(filtered suffix)` depth filter; already judged or other-entry parents remain outside that selection.

## Evidence and limits

- Lean `EntrySuffixIndex.lean` states exclusion and revision invalidation; it does not prove Rust index equivalence or timing.
- `indexed_entry_suffix_matches_reference_across_log_changes` differentially checks the old reference ordering against the index, including duplicates, late malformed-depth parents, judged parents, 100 unrelated entries, clone, removal and replacement.
- Rust parser and whitespace checks passed. Rust execution is pending the coordinator's combined compiler run; do not mark runtime validation complete.
- Setup still visits this entry's write IDs and its judged history. The ordered index adds memory proportional to held writes and insertion overhead. It eliminates unrelated-log scanning, ciphertext-wide cloning and sorting here; it does not establish a fixed-time bound for a huge single entry, cryptography, document application or canonical replay.

# Public file projection: one held-history pass

`world::files_everyone_reads`, used by public-file feed reads, called
`Lab::entry_files` once for each eligible file entry. That repeatedly scanned
all held edits during one foreground Lab read.

The implementation now collects the same candidates in creation order, after
the same landed/public/type/readable-record/not-deleted checks, then uses the
existing `entry_files_batch` projection. It selects the first readable file
root in held order exactly as before. Candidate order remains unchanged, so
duplicate vault/name pairs still resolve to the first eligible entry. Each
file's length/key still passes through `Lab::file`; this creates no public
permission, cache or privileged peer path.

The Lean projection invariant passed. The differential Rust fixture preserves
the old implementation as its reference and checks multiple entries, duplicate
names, empty selection, scoped selection, multiple peers, revocation and backup
restore. Parsing and diff checks passed. Rust execution remains pending the
shared compiler; no Cargo was run in this worktree.

The existing grouped-file test counts one actual held-history traversal. This
slice does not bound the remaining single scan, record materialization or
file-key index construction, and claims no measured end-to-end latency result.

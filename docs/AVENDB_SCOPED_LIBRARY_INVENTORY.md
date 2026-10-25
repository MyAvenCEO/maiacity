# Scoped Library inventory

The Library previously waited for `world.entries` before displaying locally held
files. It now independently observes canonical `entry_views` scoped to the chosen
vault and acting vault, with semantic `kind: file`. This intentionally preserves
custom schemas readable as files, instead of narrowing the result to type=file.
The scheduling window prioritizes standard file types as a non-exhaustive hint;
custom types remain eligible for the canonical local query/background discovery.

Dependencies are explicit: a second observer reads current-vault task records;
completed readable tasks supply bounded explicit input/output IDs to a third
file-kind observer (including cross-vault references). Every dependency retains
acting-vault checks and is filtered by `reads` before feeding preview/family UI.
No task contents or authorization identities enter peer scheduling hints. Visible
file/preview demand remains separately owned by the viewport observer.

Loading, read errors, and local absence have distinct states. Empty local results
never assert that no files exist or that nothing is shared. Related-file discovery
is bounded to 512 IDs; all results remain explicitly incomplete. Changing context
closes an active viewer and clears its visible demand while the existing shared
observer rejects late former-context responses. File read/stream authentication,
mutations and current owner approvals are unchanged.

Validation: 28 Bun tests passed (Library query, query-window lifecycle, package
inventory and startup summary), including compilation of Library.svelte. No Cargo
run or physical device acceptance is claimed. This removes a whole-world gate but
semantic file-kind classification can still materialize entries within the
selected vault; indexed kind discovery is a remaining engine optimization. Tasks
in unrelated vaults are not broadly scanned; explicit related dependencies and
partial family status avoid claiming exhaustive derived-file discovery.

## Global task-scope correction (separate follow-up)

Review found no guarantee that a derived-file task lives in the source file's
vault. Library now requests task entries globally through a new explicitly typed
`entry_views` mode. Omitted scope requires 1–8 nonempty types; omitted/empty types
still fail, and combining vault and IDs still fails. Current acting-vault read
authority and already authenticated header type are checked before landed-state
checks or record materialization. Counts include only authorized type matches.
The header hint itself grants no authority. This retains globally authorized
cross-vault task discovery without rebuilding an entire world projection.

TypedGlobalInventory Lean conditions passed; 3 Library JS tests pass and Rust
source parses. Added engine actor/cross-vault/invalid-request regression and a
warm-state regression proving unrelated/unreadable entries stay unmaterialized.
Cargo execution remains pending the shared compiler queue. Related-file paging
beyond 512 is a separate parallel correction. Stories candidate159dbf7a remains
separate from this correction and frozen PR1272.

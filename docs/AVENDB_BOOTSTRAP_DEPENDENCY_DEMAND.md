# Exact historical dependency demand — core candidate

A concurrent suffix may require a dependency cut older than the owner checkpoint.
The core now identifies counted historical writes whose authenticated content body
is absent beyond the eligible scratch. It reports those exact signed EditIds via
`Lab::owner_base_missing(on) -> Vec<(EntryId, Vec<EditId>)>` and query/get checkpoint
metadata `missingDependencyBodies`. These are inline encrypted edit bodies, not
content blob roots. Current owner authorization gates the scheduling hint.

The blocked edit is put back at the front of its queue; no suffix is lost. The
validated prefix remains visible and read-only with a nonzero `pendingSuffix`.
`owner_bases_pending` reports runnable work only, excluding body-blocked queues,
so the Node materializer does not spin while waiting. Newly received authenticated
history/key material invalidates the input basis and retries ordinary admission.
Revocation invalidates the anchor and removes its demand.

The common peer scheduler must request these IDs through ordinary authorized
serving. If an ID is already held encrypted but unopened, resending the same edit
is insufficient: ordinary key recovery is required. The core hint confers no read
rights and does not treat unavailable material as complete. Network fetching is a
separate integration slice; this commit does not add unrestricted history pulls.

Lean BootstrapDependency passed; Rust parser checks passed. Added regression for
an older concurrent cut with a missing intermediate body, retained/read-only
prefix, no busy materializer, late exact-body arrival and convergence, plus
revocation while waiting. Cargo validation remains pending the shared queue.

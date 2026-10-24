# Working-set-first warm restore: staged explicit body readiness

Status: runtime candidate implemented in the isolated branch; **compilation and
regressions pending the shared Cargo slot**. No measured device speedup is claimed.

`deferred_body::DeferredBody` keeps separate types for certified body metadata
and demand-opened content. Metadata does not become a `Body` with a valid empty
update. It retains original ciphertext/context and an exact process-local log
revision, but no key. A demand must supply the current authorized entry key;
basis/key checks precede every access, including previously opened plaintext.
Ciphertext authentication, wire decoding, and metadata equality must all pass.
Failures remain explicit, not an empty update. Schema/lens/capability-definition
bodies are excluded because authorization requires those eagerly. Own-receipt
verification and authorization remain caller prerequisites, not powers conferred
by constructing this internal value.

The runtime candidate adds the following integration (not yet validated):

1. Extends the encrypted engine/exact-log own receipt with bounded metadata for
   each eligible ordinary write, including tags/proofs/answers/files. Authenticate
   before constructing `BodyMetadata`; check all current entry keys and current
   policy. Keep schema/lens/capgroup dependencies eager.
2. Restores metadata Readings without installing empty-content Body objects into
   `Store.bodies`. Add a separate deferred map. `read` distinguishes held metadata
   from opened content and invalid ciphertext.
3. Gives Shown separate metadata history and demanded full history. Current public
   `Lab::history` and internal `shown` return `&History`; both must hydrate with
   current keys before exposing any historical-content API. `Shown::items` may use
   the validated own snapshot, but its corrupt-snapshot fallback must hydrate
   canonical content first. Never treat a metadata-only Change as unreadable.
4. Before incremental successor admission, reconcile the demanded history via the
   same canonical gate. On changed basis/keys/policy, drop deferred assumptions
   and rebuild canonically. `forget` clears all deferred state. Saving untouched
   entries must preserve deferred ciphertext/metadata without demanding content.
5. Test unchanged offline first view, unrelated entries remaining undecrypted,
   historic versions, proposals, successor writes, revocation/key loss, corrupt
   receipt/content/snapshot and stale-basis fallback; then measure actual devices.

Existing eager body/map/history APIs make simply skipping `read()` unsafe. This
stage deliberately does not do that, nor reset account data or weaken authority.

Validation: DeferredBodyReadiness Lean invariants passed; Rust parsed with
rustfmt. Crypto regressions added for metadata-only access, demand content,
wrong current key after hydration, changed basis, tampered ciphertext/context,
metadata mismatch, and valid empty content. Full Cargo execution pending shared
compiler slot: `cargo test -p avendb deferred_body::tests`.


## Candidate integration and conservative limits

An optional bounded metadata section follows the existing own-receipt basis.
Old receipts without it still decode and take canonical eager body loading.
Metadata is installed only after the own encrypted receipt opens, its full log
matches, and current entry keys open. Schema/lens/capability definitions remain
eager; entries with retained owner-bootstrap anchors are excluded from this fast
path because their separate counted-history/durability gates must run unchanged.

Store retains deferred bodies separately from opened bodies. Readings, stewardship
and file metadata read the explicit metadata projection. Shown keeps counted
metadata history separately from demanded full history. Ordinary item reads use
validated snapshots without opening historical bodies. Public history reads and
successor mutation checks hydrate through current keys; missing keys cannot reuse
previously hydrated content. Bad snapshots reconstruct from canonical demanded
history. A rejected warm entry retires its metadata and retries canonical decode.
Any changed log currently drops all deferred assumptions and returns to canonical
decoding; this is deliberately conservative, so catch-up and writes may still
cause broader work. Lock discards deferred maps. Saving leaves untouched content
deferred and preserves the receipt metadata.

Existing receipt bounds remain 256 entries / 8192 writes / 32 MiB. Entries beyond
those bounds still reconstruct eagerly. Further progressive paging and per-entry
invalidation remain necessary for fully working-set-proportional startup at
arbitrary store sizes. This change cannot honestly close that entire objective.

New Rust tests (`cargo test -p avendb warm_metadata_`) cover offline first-view
snapshot use without unrelated body decoding; selective historical hydration;
saving untouched entries; successor writes; invalid encrypted receipt fallback;
missing current keys after hydration; stale-frontier fallback; corrupt snapshot
canonical reconstruction. `cargo test -p avendb deferred_body::tests` additionally
covers eager dependency exclusion and content authentication failures. These are
added, not yet run. Existing warm-reopen/capability/revocation tests are required.

# Working-set-first warm restore: staged explicit body readiness

Status: representation stage implemented, **runtime activation still open**.
This stage is not a measured startup improvement and must not be reported as
completion of working-set-first restoration.

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

The new module is compiled but not called by the runtime yet. It is an explicit
safe integration boundary: current eager behavior remains until all following
steps are implemented together:

1. Extend the encrypted engine/exact-log own receipt with bounded metadata for
   each eligible ordinary write, including tags/proofs/answers/files. Authenticate
   before constructing `BodyMetadata`; check all current entry keys and current
   policy. Keep schema/lens/capgroup dependencies eager.
2. Restore metadata Readings without installing empty-content Body objects into
   `Store.bodies`. Add a separate deferred map. `read` distinguishes held metadata
   from opened content and invalid ciphertext.
3. Give Shown separate metadata history and demanded full history. Current public
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

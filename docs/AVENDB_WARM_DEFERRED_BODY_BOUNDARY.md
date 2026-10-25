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

### Publication integration correction

Checkpoint and projection publication use Store-aware current-key item access.
Judgment serialization demands entry history so proposal labels are preserved;
policy metadata serialization uses the authenticated metadata accessor without
copying discarded content. Debug canonical comparisons also resolve the explicit
content boundary instead of treating deferred bodies as absent. The regression
`warm_reopen_publishes_judged_base_with_proposal_labels` covers warm reopening,
publication and exact judgment acceptance by a full holder. Parser checks passed;
Cargo execution remains queued, not claimed passed.

### Deferred full-holder comparison and draft visibility

Draft visibility now resolves current-key history and fails closed when that
history is unavailable, rather than treating deferred content as a relay that
has never decrypted it. Both judged and counted checkpoint full-holder CRDT
comparisons demand history before comparing causal snapshots. Regression coverage
includes a warmed receiver with proposal labels, counted snapshot equivalence,
and unlanded draft visibility before/after current-key removal. Cargo tests remain
queued; this correction is not a new measured performance claim.

### First runtime evidence and remaining correction

Full isolated core run at e1400c15: 266 passed, 2 failed. All five warm metadata
cases and warmed counted-base comparison passed. The failures exposed (1) old
fixture access without Store and (2) checkpoint serialization of ephemeral
scratch retention. Publication now constructs its scratch from the authorized
MAIN item and counted MAIN history, with stable `tip=None`, independent of warm
reopening or last-32 scratch retention. The same full causal snapshot is retained;
this does not replace history checks with JSON equality. These final corrections
are awaiting the next serialized test slot.

Normalization invariants: no publication without current entry-key authorization;
MAIN must exist and have no parked updates; every retained MAIN change must be
counted; scratch holds exactly those edit IDs and the item's authored schemas;
the optional execution-only last-write tip is cleared. No peer receives new
authority, and both receiver causal reconstruction and current owner approval
remain required. The publication regression explicitly evicts the transient
scratch before warm capture and requires byte-identical judgment serialization.

## Long single-entry regression (source ready; runtime pending)

`long_single_entry_warm_append_matches_canonical_restore` covers one generic CRDT document with 256 small row appends, eight unrelated entries, a validated warm reopen, and one further append. It separately prints warm restoration, first-view, append and canonical cold restoration durations, plus deferred-body counts before/after. It checks that the first view does not decode target history, the first append hydrates the target's history without decoding unrelated entries, and the resulting record and history match canonical cold restoration exactly. This supplements the many-short-entry fixture; it does not claim that first append is independent of entry history length or establish physical-device timing.

No Cargo build was started in this isolated checkout. The coordinator must run the named test in the canonical Rust worktree and record its output before marking runtime validation complete.


## Shared exact basis for deferred receipts (2026-10-25)

Implementation: [b609a850](https://github.com/MyAvenCEO/maiacity/commit/b609a850). Source complete; canonical Rust validation pending.

Ordinary content append previously visited every deferred body twice: to check exclusive ownership/metadata, then to rewrite each receipt's exact revision. The new private `DeferredContext` is shared only by immutable bodies reconstructed from one authenticated own receipt. The store captures the exact log revision before sealing the write. Only the existing settled-content/creation guards plus a strict canonical replay step may advance that context from the captured revision to the new revision. This performs one context transition regardless of unrelated history size. It is not a new authentication or peer admission path.

Every metadata demand still checks the exact current revision. Every content demand additionally checks the currently held entry key, including already decoded content; plaintext must match the authenticated metadata. A non-content history/policy change cannot advance the context and normal refresh drops it and its deferred map. Target-only hydration still checks exclusive ownership before moving buffers, with canonical fallback if a target receipt is shared. Sharing an unrelated immutable receipt no longer invalidates the fast path.

Validation: `DeferredContentAppend.lean` passed locally. Added a 128-receipt shared-context regression covering stale transitions, current-key rejection, replacement-context rejection and retained plaintext identity; expanded warm first-view regression to retain an external unrelated receipt and require exactly one context transition. Rust runtime execution is pending in the canonical checkout, deliberately avoiding a second dependency rebuild here.

Limits: this removes repeated work over unrelated deferred receipts. It does not remove target-history scans or target-history hydration. The parent measured the preceding 256-revision single-entry fixture at approximately 191 ms for the first warm append (debug build), with all 257 target bodies hydrated. No sub-100-ms target claim follows from this change. The next candidate is restoration of the exact saved judgment scratch state and metadata-only history, gated on a strict single-tip append; a saved visible item alone is insufficient because judgment needs touches, authored schema dependencies and causal admission state.


## Exact saved scratch for the first warm append (2026-10-25)

Implementation: [47304f54](https://github.com/MyAvenCEO/maiacity/commit/47304f54).

Source implemented; canonical Rust execution and latency measurement pending. The optional own-materialization adjunct now carries a bounded judgment scratch image, authored-schema set, exact held edits and tip. It is authenticated by the same local encrypted receipt and exact log/entry fingerprint as the other warm state. Existing adjunct formats still decode without a scratch. Invalid, missing, non-linear, uncounted or non-main scratch takes the full canonical path. Restored scratch retention uses the existing 32-entry cap.

Generic ordinary main-line editing can use the metadata history to construct a draft from the validated visible item, and to run the existing proof/admission path against a fork of the exact scratch. It still checks current keys and exact receipt basis. After strict content replay, the new update is judged with that scratch; old omitted bodies remain explicitly listed on `Shown.history_bodies`. Public history requests still decrypt and return complete content, and key loss still prevents both cached item and history access. Branching, authorization/lane changes, files and unsupported metadata remain on canonical reconstruction.

The 256-revision single-entry regression now requires no old target ciphertext to be opened during first or subsequent append, then recaptures/reopens and appends again before comparing full content/history against cold canonical restore. Optional scratch corruption/incomplete cut tests require safe fallback. The existing missing-current-key and stale-receipt regressions remain applicable. Lean models exact authenticated cut requirements and retention of omitted-history markers; this is not a proof of Loro implementation or a timing guarantee.

No latency target is marked achieved before the canonical run and physical-device measurements. Remaining linear metadata scans (heads, eligibility, fingerprint and imported-ID bookkeeping) are explicit follow-up costs.


### Deferred scratch import follow-up

Implementation: [846accc6](https://github.com/MyAvenCEO/maiacity/commit/846accc6). Lean and syntax checks passed; canonical runtime pending.

Warm restoration retains the authenticated scratch image encoded. It validates the exact linear cut and retention bounds without importing Loro. `Shown::scratch_in` checks current body authorization before the first target proof/edit imports the optional image; the validated result is memoized and moved into the ordinary judgment accumulator after append. First-view reads and re-saving untouched warm state do not import scratch snapshots. Both encoded and materialized scratch slots share the existing 32-entry eviction policy.

The dedicated regression asserts zero scratch imports after unlock, first view and re-save, target-only import after an edit, and no import for a different target after current keys are removed. Rust runtime validation remains pending canonical integration; syntax checks passed. This avoids moving target replay cost into unconditional unlock work.


### Admission availability check correction

Canonical regression execution exposed one additional eager path: `check_write` called public full-history hydration before the proof phase, even when the exact warm scratch covered the append cut. The availability guard now recognizes only a file-free, non-creation, main-line append whose single dependency equals the validated scratch tip. It uses the same current-key/exact-basis `append_history` check. Every other operation retains the original full-history availability check, and accepted writes still run normal canonical policy acceptance plus proof/schema/admission checks. The two no-decode regression assertions are unchanged. Runtime rerun pending.


### Recapture fingerprint correction

The long-entry regression exposed a second-reopen mismatch: incremental content refresh hashed only decoded bodies while canonical `show_items` hashes decoded **or authenticated deferred** bodies. A newly saved mixed receipt therefore failed its exact fingerprint check and correctly fell back to full replay. Both paths now use the same availability definition. The existing test still requires all old target bodies to remain deferred after recapture/reopen and after the next append; no retained-progress assertion was relaxed. Runtime rerun pending.

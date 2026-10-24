# Writable partial bootstrap: implementation design and remaining model work

Status: **design only; not implemented or proved**. This document follows the delivered
read-only checkpoint path (`CHECKPOINT-DEMAND-DELIVERY.md`). It records the exact remaining
engineering boundary so another agent does not mistake a removed `ReadOnly` check for a fix.

## What the current code actually does

- `crates/avendb/src/entry_projection.rs` encodes version 1 as bounded JSON records per line,
  signed `Stated.basis` IDs, and an encrypted content root. It deliberately has no Loro
  operation identities, version vectors, historical container identities, or counted-write
  dependency index. A JSON record cannot be turned into the same CRDT by importing it as new
  local operations: concurrent updates would refer to different IDs.
- `lab.rs::check_write` refuses a write while a partial projection is selected. This protects
  against signing an update based on the old canonical item behind the newer displayed record.
- `history.rs::History::{heads,version,reading_on,edit}` requires counted signed-write history.
  Heads are **avenDB EditIds**, not Loro frontiers. `History::reading_on` constructs the precise
  dependency version to check schema fit and access-capability touches.
- `policy.rs::{builds_on,on_proposal}` requires named dependencies to be writes of that entry,
  and proposal ancestry to exist. `lab.rs::proven` also checks landing, acceptance, schemas,
  touched paths, and row ownership. A Loro document alone cannot supply these facts safely.
- `doc.rs::Item::import_as` deliberately accepts only Updates, verifies the author's expected
  Loro peer, and checks that imports do not advance unrelated peers. Normal entry writes must
  retain this rule. Snapshot import must be a separate authenticated base constructor.
- `doc.rs::Item::bytes` uses full Loro snapshots. `history.rs` explicitly disallows shallow
  snapshots because proposals may start before the cut. Arbitrarily switching to shallow
  export would change supported history/merge semantics.
- `snapshot.rs::{start_states,start_view,honest}` and `spec/AvenDB/Snapshot.lean` model an
  owner-attested **Slice**, including entry-local policy/history facts, not merely a JSON
  record. The production projection does not install that Slice into canonical replay. The
  Lean file itself says the general theorem that every honest start is right for every
  history remains to be proved. Existing Boolean gate lemmas do not fill that gap.

## Safe near-term behavior without changing the mutation model

Keep read readiness independent of write readiness. Show the verified projection immediately;
prioritize the active entry's signed history and its schema/access dependencies ahead of unrelated
history; enable the existing mutation path as soon as that **entry** is canonical. This can make
editing ready before the rest of the account syncs. It is not writable partial bootstrap, and a
view must not advertise successful committed edits while it is still read-only. Any retained
user intent must be explicit pending intent, never an already-signed edit or a silently rebuilt
JSON document.

## Concrete implementation sequence for genuinely writable bases

1. **Specify a base plus suffix model before changing guards.** Extend
   `spec/AvenDB/Snapshot.lean`, with the history/line model in `Proposals.lean` and `Doc.lean`.
   Define `VerifiedEntryBase` as an owner-authorized base tied to vault, entry, snapshot ID,
   accepted avenDB basis and line identities. Define the suffix transition separately from
   whole-log replay. Prove entry confinement and unchanged authorization kernel; define the
   precise evidence needed to count a suffix write whose dependencies terminate at the base.
   Do not assert the global convergence theorem until its assumptions and proof exist.

2. **Introduce a distinct encrypted payload version and validated type.** Add a new
   `entry_base.rs` module beside `entry_projection.rs`; keep version 1 projection decoding
   unchanged. Version 2 commits to, at minimum:
   - vault/entry, key epoch, format/domain context, and avenDB basis for each line;
   - full Loro snapshot per supported line with its operation frontier/version vector;
   - mapping between accepted signed-write frontier IDs and their CRDT frontier;
   - counted dependency/line/landing/acceptance metadata needed by `History`;
   - schema/lens and capability-dependent entry metadata required to validate new writes,
     named by immutable identity, with ordinary authorized dependency retrieval;
   - row-ownership attribution needed by `History::mine`, without inventing original authors.
   The snapshot EditId binds the payload through the signed envelope; do not embed that ID
   inside the payload whose hash helps determine the same EditId. Negotiate payload versions
   explicitly; legacy peers keep ordinary history fallback and never treat version 2 as JSON.
   Payload and allocations stay bounded; an entry beyond the bound falls back to targeted
   history. A full Loro snapshot may still scale with entry history; do not promise constant
   payload size or constant import time. Do not use JSON-record equality as proof that two
   CRDT bases have identical operation identities or causal histories.

3. **Construct and validate the base with explicit trust semantics.** Publisher code should
   extend the owner ceremony in `checkpoint_delivery.rs::publish_checkpoint`, not sign as the
   hosted peer. Receiver code uses ordinary signed governance and the same content-root/AEAD
   gate. `doc.rs` needs a dedicated bounded snapshot constructor that restores the local
   signer's correct line peer after import and checks supported snapshot mode and metadata.
   A full holder compares the proposed base with canonical history, including causal metadata
   and line identity, not just rendered JSON. Specify whether historical counted metadata is
   owner-attested under the existing Snapshot trust model or independently verified; never
   present attested metadata as original author signatures. Malicious counter/frontier claims
   must not poison future authentic operations. This is a protocol/model review gate.

4. **Teach History to extend a verified base.** Introduce a base-aware history representation
   in `history.rs`, rather than fabricating old `Signed` edits in the log. `heads`, `version`,
   `reading_on`, `written_under`, `mine`, landing/acceptance, proposal merge and undo must
   distinguish dependencies covered by the authenticated base from missing dependencies.
   Implement a suffix write first against an exact certified base frontier. Keep older
   historical versions/merges that need unavailable ancestry explicitly incomplete and fetch
   their closure. General proposal support must be specified, not silently approximated.
   `policy.rs::builds_on` must receive validated base evidence through a typed context; no
   global exception saying that an unknown dependency is acceptable because a checkpoint exists.

5. **Connect local writes and incoming suffixes through one validator.** Update
   `lab.rs::{check_write,proven,make_bringing}` and receive/materialization so both use the same
   verified base and suffix rules. Export only the local author's new Updates from the imported
   base frontier; preserve `Item::import_as` peer checks. A local write names real avenDB
   dependencies and ordinary current authority. Remote suffixes must be checked against the
   same base semantics by both partial and full holders. Unknown base/version means fetch or
   refuse, never bypass. Only then replace the unconditional projection `ReadOnly` guard with
   a successful `WritableBase` gate. Keep JSON-only projections read-only indefinitely.

6. **Persist and reconcile without double application.** Extend persisted checkpoint metadata
   and `edits.rs` save/reopen so the base identity, validated policy revision and accepted
   suffix survive together. Recover from a torn write by discarding derived base selection and
   rebuilding from signed evidence, without deleting the original store. When full history
   arrives, compare the base, deduplicate by operation/EditId, and switch representation
   atomically. Preserve any already-authored suffix if a base becomes stale; quarantine it
   until ordinary validation determines its standing instead of deleting or rebasing silently.
   Unknown future revocations cannot be ruled out offline; claims remain relative to held
   verified policy on every peer equally.

## Required invariants and executable acceptance gates

- **Identity and authority:** a base cannot change vault/share/revocation/key kernel facts;
  a different entry, audience, line, signer or key epoch cannot reuse it. Revoked-reader and
  withdrawn-owner cases reject on held current policy even if old ciphertext remains pinned.
- **Causal equivalence:** from an honest base plus the same valid suffix, a partial holder and
  full-history holder reach equal canonical entry state and equal accepted-write decisions.
  Rendered-record equality alone is insufficient evidence of this invariant.
- **Author isolation:** a new signed update advances only its authorized author/line peer;
  malformed frontier, fabricated counters and extra peer operations do not gain acceptance.
- **No optimistic authority:** a proposed edit cannot count until its schemas, capability
  chain, row ownership, landing and proposal rules are established. Demand priority grants
  no access. A server/hosted node follows identical rules.
- **Convergence and replay:** exercise two fresh partial devices editing concurrently, one
  full-history device, reordered/duplicated suffix delivery, and later complete history.
  Compare records, accepted dependencies, CRDT vectors and duplicate suppression.
- **Historical operations:** a proposal predating the base, merge across the cut, undo of an
  older edit, and rejected-schema historical write either work equivalently or report a
  specific missing dependency. They cannot silently produce a different document.
- **Persistence:** restart after base acceptance, during suffix persistence, offline write,
  reconnect, stale/revoked base, corrupt payload and a false owner attestation. Original data
  survives; no reset is part of recovery.
- **Performance:** separately measure base decode/import, policy validation, first view,
  write readiness, local mutation-to-reactive result, and remote receipt-to-reactive result
  on Mac/iPhone/iPad while unrelated history is withheld. The physical-device measurements
  remain necessary; model proofs do not establish timing.

Implementation should land as a separate versioned change after the current read-only delivery.
The current safe guard must remain until this base/suffix model, validator and differential
acceptance gates are implemented. None of the tasks in this document is marked complete.

## Stage 1 implementation ledger

Implemented, Rust validation pending the coordinated integration build:

- `entry_base.rs` now defines a separate version-two envelope and private-field
  `AuthenticatedEntryBaseEnvelope`. `draft_entry_base` prepares the existing owner Snapshot
  ceremony over full per-line Loro snapshots, canonical version vectors, and signed EditId
  frontiers. `authenticate_entry_base` checks current ordinary authorization, signed root,
  AEAD context, engine/version, line/frontier limits, full-snapshot metadata and vector match.
- The API authenticates **an owner's bounded claim**. It does not import a Loro document,
  install a History, change canonical data, expose a writable Item, or claim honest-start
  equivalence. `is_writable()` is always false. No Node operation or v2 automatic publication
  is enabled. Existing JSON-only projection and mutation guards remain unchanged.
- Snapshot metadata inspection rejects Updates, shallow modes, malformed vectors, wrong
  context, excess payload/line/frontier sizes and excessive declared operations/changes.
  Owner-side full snapshot export occurs before its encoded-size check; this stage does not
  claim bounded export CPU/memory for arbitrary preexisting canonical documents.
- `EntryBaseFormat.lean` makes owner/current-policy/AEAD checks explicit input assumptions,
  proves mismatch/refusal properties, and proves this stage cannot grant write readiness.
  Standalone Lean passed. This is not a cryptographic or CRDT convergence proof.
- Negative Rust tests are under the `entry_base` filter: owner approval required; fresh
  partial reader authenticity without canonical installation; malformed/foreign ciphertext;
  wrong entry; outsider; revocation; Updates/shallow mode; vector mismatch; wrong basis;
  trailing/truncated/oversized payload; unsupported version and duplicate frontier IDs.

Next: counted-history metadata and a verified base/suffix model (design steps 1/4), then
one shared local/remote suffix validator, differential full-versus-partial history tests,
version negotiation, durable suffix recovery, and device measurements. No writable partial
bootstrap milestone is marked done by this representation stage.

Stage-one code: [`41498df3`](https://github.com/MyAvenCEO/maiacity/commit/41498df3).
Pending Rust command: `cargo test -p avendb --lib entry_base -- --nocapture`.

### V2 decoder resource boundary (review correction)

Installed Loro 1.16.2 `encoding/fast_snapshot.rs::decode_snapshot_blob_meta` creates a LoroDoc
and invokes `decode_change_store` before it returns metadata. Therefore the envelope byte
cap bounds wire input, but the subsequent change/peer/operation checks do **not** pre-bound
all decoder allocation or CPU. No stable bounded preflight is available through this public
metadata API. Keep v2 dormant and non-writable until a bounded decoder/preflight or isolated
resource budget exists. This does not affect the current v1 JSON projection receiver. The
stage-one helper does not install an Item, but it does perform internal oplog decoding.

### Revocation regression fixture correction

The v2 core CI regression originally called ordinary `Lab::sync` after removing the phone.
That sender computes outgoing logs using **current** authorization, so it need not send the
former vault's policy to the removed device. The final rejection assertion therefore had not
established that the reader held the revocation. The fixture now delivers the actual signed
removal through ordinary `Lab::receive` (as the existing v1 revocation regression does), and
asserts the removal is held and the reader no longer lists that device before asserting
`authenticate_entry_base` rejects. No authorization guard or rejection assertion is weakened;
unknown-revocation freshness remains an explicit architectural limitation. Rust rerun pending
integration; no separate Cargo build was started.

### Stage two: authenticated counted facts and structural suffix links (dormant)

`entry_base_suffix.rs` adds a separate format-three envelope around the format-two CRDT
base and a maximum of 512 owner-attested counted `Write` facts. Existing format-two bytes
and APIs remain unchanged. Each fact retains its edit/author/actor/entry, stay/epoch,
dependencies, proposal, delegation path, creation bit, audience and shares; each variable
fact list is limited to 64 elements before allocating/decoding it. The total plaintext
limit remains 1 MiB. These limits bound fact validation, not Loro's internal snapshot decode.

`draft_counted_entry_base` derives the facts from the canonical dependency closure of the
signed frontier, refuses uncounted/missing dependency closures, and requires the ordinary
owner approval. `authenticate_counted_entry_base` uses the existing current-policy,
owner-signed-root and ciphertext gates. It validates one same-entry topological DAG with
one creation, unique IDs, no missing dependencies, proposal lineage, exact per-line tips,
and no facts outside the represented line histories. If the recipient independently holds
the whole basis, the attested facts must exactly match its canonical counted history.

`AuthenticatedCountedEntryBase::links_suffix` checks only structural linkage: bounded
same-entry fresh ID, noncreation, nonempty known dependencies, and ordinary proposal
ancestry. It does **not** verify that the supplied Write was signed, authorized, schema-fit,
row-owner-valid, or CRDT-equivalent. It produces no accepted edit or mutation capability.
The object stays opaque and `is_writable()` remains false. No Node dispatcher, publish/fetch
activation, canonical Item/History substitution, or partial-write guard removal is included.
A partial reader authenticates the owner's claim; historical-author truth is not inferred.

`BaseSuffix.lean` proves structural linkage requires the same entry and held dependencies,
rejects duplicate IDs, and grants no writable state. Cryptography/current authority and
historical truth are explicit external obligations, not conclusions of that structural model.
Standalone Lean passed. Rust syntax parsing passed; Rust type/regression checks are pending
the shared compiler queue. Exact filters: `counted_base_roundtrip_links_only` and
`counted_base_rejects_cycles` (both under `cargo test -p avendb --lib`). Tests cover a partial
reader without canonical replacement, unchanged v2 refusal, ordinary owner approval,
unknown/foreign/proposal suffixes, forged owner-attested author metadata rejected by a full
holder, cycles, duplicates, missing creation/dependencies, wrong frontier/context,
truncation/trailing data, and excess fact/dependency counts.

Still required: authenticated historical provenance and honest base equivalence; one common
local/remote suffix admission path including schema/row ownership and proposal acceptance;
differential convergence against full history; bounded Loro decoding; durable base+suffix
recovery; capability negotiation and measured device acceptance. The full writable bootstrap
is not complete. This isolated stage is not part of the frozen release candidate.

Stage-two implementation: [`1ce8bd2b`](https://github.com/MyAvenCEO/maiacity/commit/1ce8bd2b).
Lean and Rust syntax checks passed; Cargo remains explicitly pending shared-queue availability.

### Stage three: shared admission and independently checked base equivalence

`History::admit` now supplies one ordinary dependency/landing/schema/proposal gate to both
local `Lab::proven` and remote `Judging::judge`. Each caller still derives authorization
using its existing current policy, proof, capability groups and row-owner-marked touches.
The gate requires counted dependencies and ordinary proposal ancestry; it never interprets
an owner-attested fact as counted evidence. The existing explicit patched-app test mode
remains separate; no new bypass is introduced.

`History::snapshot_scratch` verifies a proposed full snapshot against independently held,
counted, readable canonical history and checks exact exported snapshot bytes. Matching
JSON or matching version vectors are insufficient. It returns a scratch built from the
canonical Item, with the exact held edits and authored schemas, which feeds the existing
`History::reading_on` footprint/schema machinery. A malformed/missing/uncounted basis,
parked updates or differing snapshot refuses reuse. Byte comparison is conservative and
may reject an equivalent alternative encoding; it cannot accept differing encoded state.

`Lab::verify_counted_base_equivalence` rechecks current checkpoint authority and ciphertext,
then requires full canonical correspondence for all facts and line snapshots. It deliberately
returns false for a fresh partial reader missing those facts. This is executable equivalence
checking, not a trusted-peer shortcut or a way to skip historical evidence. It still incurs
canonical reconstruction and does not claim the new-device performance target is achieved.

`BaseAdmission.lean` proves peer gate equality, authorization/counting requirements and
revoked refusal from explicit input facts. Standalone Lean passed. Rust syntax checks passed;
Cargo remains pending the root-owned queue. Added `counted_base_scratch_and_full_history`
regression compares complete Reading results (footprint, row additions and schema verdict)
and shared admission across canonical replay and verified-base scratch, with authorization,
schema, missing-dependency and uncounted-base negatives. Existing counted-base roundtrip now
requires full-holder equivalence and partial-holder refusal.

Remaining blockers to writable activation are concrete: a partial device has no independently
verified historical body/provenance witness yet; facts omit the full judged touches/row-adds,
proof/schema lineage and acceptance state needed to recreate History/Mine/After safely;
Loro decode CPU/allocation requires a bounded gate; durable base+suffix recovery and
concurrent/revoked/pre-cut-proposal differential convergence must pass. No writable object or
Node operation is enabled by this stage, and it remains outside the frozen release candidate.

Stage-three code: [`f577ffad`](https://github.com/MyAvenCEO/maiacity/commit/f577ffad).
Pending combined Rust command: `cargo test -p avendb --lib counted_base -- --nocapture`;
existing policy/history/proposal/sharing suites must also cover the shared admission refactor.

### Provenance decision: what bounded metadata can and cannot establish

**Finding:** bounded signed historical metadata plus asserted schema/proof/acceptance facts
cannot *independently* establish counted state under the current verifier. This is distinct
from accepting an entry's state on the vault owners' word, which the existing Snapshot model
already explicitly permits. Do not describe the latter as historical proof.

The exact missing evidence is source-visible:

1. `sign.rs::Signed::verify` recomputes `edit.id()` and verifies the named signers over it.
   `encode.rs::edit_id` hashes the complete canonical Edit, including encrypted Write body.
   A copied `Write` record is derived policy metadata, not the originally signed Edit.
   The current format has no authenticated selective-disclosure/Merkle proof tying an omitted
   body to a retained metadata subset. A signature over an opaque ID authenticates that ID,
   not arbitrary metadata supplied alongside it. Sending the original ciphertext can bind
   the metadata, but does not prove what decrypting/importing that ciphertext does.
2. `history.rs::History::reading_on` derives schema fit, actual touches and added row locations
   from `Item::footprint_as` and the canonical predecessor CRDT. `doc.rs::Item::import_as`
   also enforces the historical author's Loro peer and detects parked/foreign operations.
   Neither a signature nor a matching version vector proves these derived facts.
3. `policy.rs::Mine::{note,mark}` derives ownership from counted row additions. Incorrect
   retained `adds` can grant an `Own` operation where an ordinary `Set` would be forbidden.
   Retaining only the final JSON loses the identity and origin of rows, including duplicates.
4. `policy.rs::is_accept` requires an owner proposal write with actual empty touches and no
   tag changes. The proposal enum and signer alone do not prove acceptance. `History::passes`
   and `lands` depend on counted ancestry, not merely on frontier membership.
5. `lab.rs::Judging::judge` combines those facts with body proof, tags, capability groups,
   current replay policy, schema/lens readings, and attributes before the write. Serializing
   their outputs does not provide a proof that this computation was performed correctly.

`ProvenanceBoundary.lean` formalizes this *representation* limitation: two abstract judgments
can project to the same owner-attested metadata while carrying different omitted counted
verdicts, so no exact function of that projection recovers the verdict without an additional
honesty/witness premise. This is deliberately **not** a claim of a cryptographic collision,
a proof about ciphertext indistinguishability, or a general impossibility of succinct proofs.
Standalone Lean passed. No new runtime format or unsafe mutation path was added for this audit.

#### Existing model authority, and the concrete next implementation route

`spec/AvenDB/Snapshot.lean` already says a reader may take a scoped entry slice on its vault
owners' word, with standing-authority checks, full-holder lie detection and invalidation on a
later removal. `snapshot.rs::{start_states,start_view,honest}` implements that policy model.
Its universal honest-start theorem is explicitly outstanding. Owner approval can authorize
that entry-scoped baseline; it cannot rewrite other vaults' authority, manufacture original
authors' signatures, or prove that the stated past was truthful. No special hosted-peer role
is required or allowed. The existing user approval for checkpoint publication need not be
requested again for the same owner-approved operation.

The route consistent with that *existing conditional trust assumption* is to integrate a
complete owner-attested **judgment state**, not to keep adding metadata-only envelopes:

- Restore only the entry's policy Slice, canonical full per-line CRDT snapshots, counted
  dependency closure, historical touches and row additions, proposal acceptance/landing,
  current attributes, schema/lens authored IDs, and capability-proof lineage required by
  `History`, `Mine` and `After`. Keep the global policy/kernel independently replayed.
- Reconcile the Lean/Rust boundary first: Lean's Slice includes uncounted/accepts/defs/adds;
  the current Rust `policy::Slice` contains entries/writes/audiences/marks/seals/born. Lab's
  content judgment lives separately. Calling `State::with_slice` alone does not restore the
  content admission state and cannot safely unlock mutations.
- Validate scope, bounds, dependency/line consistency and all independently available
  evidence; full holders must compare semantic state to canonical history. A partial holder
  labels this owner-attested baseline explicitly rather than claiming independent provenance.
- Seed `Judging::resume`/`History::reading_on` from that complete state; use the shared
  `History::admit` plus ordinary signed Edit/current authorization gates for every suffix.
  Prove/test prefix cuts, concurrent suffixes, pre-cut proposals and duplicate delivery.
- Tie the baseline to policy revision/epoch and atomically persist baseline+suffix frontier.
  On a known removal, immediately suspend derived writable state and rederive against the
  removal's preserved-history rules; do not continue from a stale base while catching up.

If independently verified historical provenance is required **without** trusting the owner
baseline assumption, the protocol needs either the relevant original body closure replayed
(which can still be active-view scoped), or a sound proof of the actual replay/import/
authorization computation. No such proof protocol exists here. Selectively signed metadata
alone is not that mechanism. The owner-attested route preserves entry IDs and history as an
asserted baseline; replacing old edits with newly authored writes is a different migration
and must not be silently presented as historical equivalence.

Provenance audit and checked model:
[`c6215f94`](https://github.com/MyAvenCEO/maiacity/commit/c6215f94). This resolves the
mechanism choice; it does not mark full writable bootstrap implemented or verified.

### Owner-attested judgment-state restoration implementation

`entry_judgment.rs` now implements the next coherent Snapshot-model slice rather than
requiring an independent-history proof from a fresh holder. `draft_judged_entry_base` signs
one encrypted bounded frame containing per-line full CRDT bases and the owners' attested
content judgment. `restore_owner_judgment` checks the ordinary signed root, current reader
permission, entry key, owner standing and removal-sensitive policy before restoring it.
No authorization kernel is included or overwritten.

The restored History retains every bounded Write, counted/fits verdict, actual touches and
row additions; proposal labels are retained, historical CRDT update bodies are omitted.
Mine is recomputed from those attested additions/verdicts. After restores attributes,
per-line imported edit sets, requested schema IDs, and scratch snapshot/held edits/authored
schema IDs/tip. Scratch restoration verifies the full snapshot mode and authored schema
set, restores the receiving device's own editing peer, and preserves ordinary update import
checks. Paths, lists, writes, line counts and total frame bytes are bounded. As previously
recorded, the Loro API still needs decoder resource isolation before production activation.

A full holder compares exact judgment metadata and canonical per-line snapshot bytes;
structurally valid but false owner-attested attributes are rejected. A partial holder takes
the judgment on the entry owners' word, exactly the documented Snapshot trust assumption.
Known later removals refuse restoration; a previously returned object is not a cached
capability and exposes no write operation. The independently replayed State and held log
remain unchanged. A historical cut older than the full holder's current judgment currently
falls back conservatively rather than overriding independently available evidence.

`JudgmentRestore.lean` proves kernel preservation, exact accepted judgment replacement and
known-removal refusal with explicit authority assumptions; standalone Lean passed. Rust
syntax checks passed; Cargo pending shared compiler availability. Tests under `owner_judgment`
exercise a partial phone holding only original entry setup, exact metadata roundtrip with
historical bodies absent, identical row ownership, full-holder lie rejection, malformed or
foreign ciphertext, known revocation, and identical real `Judging::resume/judge` results for
a new suffix using only that suffix's body versus full historical bodies.

This is a real restoration path but not yet Store/Node writable activation: policy replay
anchors, the Store's normal replay equality invariant, baseline invalidation during live
removals, and atomic durable baseline+suffix recovery remain to be integrated. The returned
object deliberately remains non-writable until that integration and its regressions pass.

Judgment restoration code: [`5fe1c9ff`](https://github.com/MyAvenCEO/maiacity/commit/5fe1c9ff).
Pending Rust gate: `cargo test -p avendb --lib owner_judgment -- --nocapture`.

### Narrow writable Store adoption and recoverable suffix anchors

The isolated core now adds `adopt_owner_entry_base`, an actual Store path using the approved
owner-attested trust model. It reauthenticates the frame, restores its entry Slice and
content judgment into a **separate derived overlay**, and leaves pure signed-log Replay and
the independently replayed authorization kernel unchanged. `Lab::edit` can append ordinary
owner-authored main-line edits against that base before historical content arrives. Every
suffix is an ordinary signed Edit; current authorization, key/AEAD checks, author-specific
Loro update import and the shared judgment/admission path remain in force.

The judgment frame is now version two and additionally carries the bounded entry policy
Slice plus historical non-content Body metadata (headers, tags, proofs, file descriptors
and definitions, with CRDT content omitted). This closes the missing Readings input: attrs
alone cannot safely stand in for tags/proofs. Source full-holder comparisons cover these
bytes too. Adoption excludes schema/lens/capability-group entries and requires the receiving
device to act for the entry vault. This first writable slice **does not** enable shared-actor
writes, proposals/merges, historical undo/restore, or writes during a pending deferred replay.
Those remain explicit refusals until broader anchors are implemented and validated.

Refresh reauthenticates bases against current canonical policy. A known later removal,
wrong scope, missing key or superseding full history invalidates the overlay and falls back
to ordinary history. Concurrent post-checkpoint owner suffixes can fork the attested base
scratch rather than attempt to reconstruct omitted predecessor bodies. Suffix processing is
bounded to 512 edits per anchor, 16 anchors per Store; older concurrent/pre-checkpoint suffixes
and larger tails require ordinary history or a newly owner-approved baseline. This is a
correctness-first bounded slice, not a claim of final catch-up throughput optimization.

`Backup::bootstrap_bytes` records ciphertext anchors and the acknowledged signed suffix IDs.
`with_bootstrap_bytes` rejects a torn pair whose signed-log backup lacks those suffixes.
Reopening never trusts the serialized IDs as authorization: it rechecks the signed owner
root and current policy, then replays ordinary suffixes. This core companion format must
still be wired into native/browser atomic durable storage and transport negotiation before
Node/PWA activation; an in-memory Backup or serialized fixture is not physical crash proof.

`BootstrapAnchor.lean` proves reauthentication/removal refusal, exact anchor restoration,
and duplicate-ID idempotence under explicit checks. Standalone Lean passed. Rust syntax and
diff checks passed; Cargo pending shared queue. The `owner_bootstrap_store` regression covers
two partial devices editing concurrently, duplicate delivery, equality with a full peer,
serialized-anchor reopen, another write after reopen, torn backup rejection and known
revocation refusal. Prior `owner_judgment` and `counted_base` gates remain required. New tests
avoid direct Shown construction so root's lazy `Shown.items` implementation can integrate.

Still open: compile/run these combined gates; native/PWA atomic durable activation and
provider negotiation; live publication/UI integration; shared-writer and proposal/pre-cut
suffix semantics; decoder resource isolation; actual device latency/reload measurements.
The full original bootstrap/performance goal is not marked complete.

Store-adoption stage: [`503e1aa4`](https://github.com/MyAvenCEO/maiacity/commit/503e1aa4).
Required pending Rust filter: `cargo test -p avendb --lib owner_bootstrap_store -- --nocapture`,
followed by `owner_judgment`, `counted_base`, and existing ordinary history/sharing regressions.

### Durable native/PWA anchor plumbing (follow-up, not production activation)

The common `avendb-net::edits` Shelf path now captures the owner-encrypted anchor
companion under the same Lab lock as signed save records. Explicit adopted bases
use checksummed v3 journal/head objects; ordinary stores still write v2 and both
versions are readable. Head compaction retains the companion. A lost write
acknowledgement retries without losing the anchor; a torn object is rejected.
Startup attaches the companion to the ordinary Backup before restore, where all
owner/current-policy checks still run. An invalid companion discards only derived
bootstrap state, never the signed log. Native disk and PWA OPFS use this one path.

The durable fence names **all held entry-write IDs plus the snapshot**, including
concurrent writes with equal/lower depth. Depth is not a causal frontier. The
companion is bounded to 16 entries and 1024 held entry writes per anchor (512
attested facts plus at most 512 suffix facts). The small save-dirty stamp compares
entry/signed-snapshot identities; an unchanged ordinary save does not clone the
full backup. Ciphertext serialization still scans held signed IDs when a save is
due; its cost remains a measured optimization debt. Vault export v1 explicitly
refuses adopted partial holders instead of claiming a restorable export while
omitting their bases.

Validation: `BootstrapAnchor.lean` passed including the new atomic-journal
assumption model; rustfmt parser and `git diff --check` passed. **Rust compilation
and tests remain pending the root's shared compiler queue.** Required filters:
`avendb: bootstrap_companion_fences_concurrent_writes_without_depth_assumptions`,
`avendb-net: bootstrap_journal` (codec, lost acknowledgement, torn journal, whole
head retention), and the existing owner-bootstrap Store regression plus complete
edits persistence regressions. These tests do not claim iPhone performance.

Activation remains explicit core API only. Required before runtime enablement:
per-entry incremental reconstruction with policy invalidation; dependency-closed
concurrent suffix selection (never depth filtering); refusal or canonical handling
of later entry Mark/audience changes and unsupported shared/proposal writes;
measured native/PWA persistence and UI latency. Root's warm-path owner is handling
these reconstruction gates independently. Shared/capability/proposal bootstrap,
export format support, runtime publication/adoption and physical-device validation
remain open. No privileged hosted peer or global kernel replacement was introduced.

Implementation: [a6930f38](https://github.com/MyAvenCEO/maiacity/commit/a6930f38d).
The commit is pushed to `codex/checkpoint-demand-delivery`; integration and Rust
validation remain pending. Do not interpret source completion as runtime delivery.

### Follow-up durability corrections

Anchor encoding now returns an explicit failure before constructing a save if any
companion exceeds its decoder's 1024-write/16-anchor/size limits or lacks its
snapshot. `Edits::due` propagates that failure before journal acknowledgement,
retaining the previous durable state; it does not silently retire an anchor or
claim newer writes durable. Returning to canonical-full storage or renewing a base
is still required before an over-bound partial holder can resume saving. A new
1024/1025 boundary regression checks successful round trip and refusal, respectively.

`Shared::act` now compares the small bootstrap identity stamp before/after a call
and wakes the saver for anchor-only adoption even when the signed log is unchanged.
A Node/Shelf regression drains prior notifications, adopts a real owner checkpoint,
checks unchanged log revision, requires the new wakeup and reads the saved companion.
No public adoption operation or runtime auto-activation is enabled by this fix.

Rust tests pending root compiler queue: `bootstrap_companion_1024_boundary` and
`bootstrap_anchor_only_adoption`; rustfmt parser and diff checks passed. Existing
Lean journal assumptions are unchanged.

Correction implementation: [cc9a4fd3](https://github.com/MyAvenCEO/maiacity/commit/cc9a4fd3c),
pushed; Rust gates remain pending.

### Minimal runtime connection after core validation

1. Keep `checkpoint_view` and v1 `checkpoint_delivery::KIND` (19) read-only.
   Add an explicitly named owner-approved `checkpoint_entry_base` operation that
   drafts the judged envelope using the existing passkey approval/temporary pin/
   signed Snapshot publication sequence in `checkpoint_delivery.rs`. Do not silently
   promote the current read-only JSON projection envelope to a writable base.
2. Negotiate a separate judged-base protocol capability/version before asking for
   it; old peers retain existing v1 projection and ordinary history catch-up. The
   reply still uses the authenticated ordinary peer channel and signed evidence,
   bounded ciphertext and existing single response admission permit. No peer role
   receives an authorization exception.
3. Route active-entry demand to this negotiated fetch after discovery. Feed evidence
   through normal signed receive first; recheck current identity/policy/demand epoch
   and ciphertext commitment before explicit judged-base adoption. Unsupported
   semantic cases retain read-only projection/history fallback, not partial writes.
4. The adopted base is ready for writable use only after existing durable save
   receipt covers its anchor and signed frontier. Wakeup alone is not that receipt.
   Cancellation, refusal, or failed storage must not report writable readiness.
5. Connect ordinary local mutation and incoming live suffix through the now-tested
   canonical admission gates; expose view readiness separately from historical
   coverage. Validate fresh holder with history withheld, concurrent edits before
   publication, revocation/Mark, crash recovery and older-peer fallback before
   enabling runtime adoption. Shared/capability/proposal cases remain refused until
   their exact semantic restoration is implemented and differentially tested.

### Fixed-size durable frontier (supersedes the 1024-write save ceiling)

The newly emitted companion is version 2: each encrypted anchor carries a u64
write count and a domain-separated BLAKE3 digest of **all held entry-write IDs in
persisted order**. The snapshot's signed ID must also exist. Decoder recomputation
requires an exact match before restoring the anchor; checksum, signed log and
owner/policy checks remain independent. An extra, missing, replaced or reordered
entry write fails the consistency fence. This relies explicitly on hash collision
resistance, not on depth or on the hosted peer. The format has constant frontier
wire size regardless of edit count. Version 1 remains readable with its old bounds.

`bootstrap_bytes` still returns an explicit failure for invalid anchor count,
missing snapshot or oversized ciphertext, before any journal acknowledgement.
The old arbitrary 1024-write serialization ceiling is removed. Existing atomic
journal captures ensure the encoded frontier and signed records name the same
state; no write ID list is allocated. Runtime admission's current bounded suffix
window is a separate remaining scalability issue, not resolved by this storage
format change. Digest computation still scans held entry writes on a due save.

Lean `frontier_match_is_exact` passed with the digest-binding assumption explicit.
The updated `bootstrap_companion_frontier_has_fixed_size_beyond_1024_writes` regression
covers 1024/1025 writes, unchanged wire length, v1 compatibility, stale/torn/reordered
frontier rejection and digest corruption. Rust execution remains pending root's
compiler queue; syntax and diff checks passed.

Fixed-size frontier implementation:
[a94d3f68](https://github.com/MyAvenCEO/maiacity/commit/a94d3f68c), committed and pushed;
combined Rust validation and runtime activation remain outstanding.

### Explicit runtime judged-base wiring (validation pending)

`checkpoint_entry_base` is a separate public Node operation. It uses the existing
owner passkey ceremony and pin/sign/publication ordering but drafts an owner-judged
entry base, never a JSON projection. `checkpoint_view` remains unchanged/read-only.
The common native/PWA checkpoint transport now probes request/response version 2;
the provider only answers v2 after verifying it can restore the judged envelope.
Version 1 keeps its projection interpretation. Unsupported v2/no base falls back
to v1 within the bounded deadline, then ordinary history scheduling. Nodes without
a durable shelf never adopt a writable base. No hosted-peer authority is added.

A received v2 envelope passes ordinary prepared signed receive, current scoped
demand and owner/base checks. It enters `bootstrap_pending`: mutation admission
and query/get readOnly remain blocked until the common saver verifies that current
anchor identities and the signed frontier match its acknowledged journal state.
The receipt is checked under the Lab lock; concurrent changes leave it pending.
The base's existing current-policy/semantic guards remain mandatory after receipt.
A failed save does not grant writable readiness. Normal disk reopen only takes
anchors from the persisted companion, not from a network promise.

New public Node regression `owner_judged_checkpoint_publication_fetch_and_durable_write`
uses explicit owner approval, type-only demand, holds ordinary history pulls,
waits for the durable readiness receipt and then writes locally. Existing projection
flow runs separately to exercise version fallback. Core Store regression also checks
staged mutation refusal. Lean `staged_not_writable` and `projection_not_promoted`
passed before wiring; syntax/diff checks passed. **Cargo/Node regressions have not
run; this branch must not be deployed as validated.**

Remaining deployment prerequisite: core reconstruction's 512-unseen-suffix cap must
not discard a partial view at the next suffix. The reconstruction owner is handling
that gate. Shared/proposal/capability cases are still refused, not supported by this
owner-only slice. Physical iPhone/iPad responsiveness, cancellation/revocation while
awaiting persistence and old-peer timeout behavior still need integrated execution.

Runtime source implementation:
[1bdda96d](https://github.com/MyAvenCEO/maiacity/commit/1bdda96d), pushed on
`codex/checkpoint-runtime-delivery`; combined execution and remaining semantic gates
are outstanding. This is not a deployment receipt.

Runtime compatibility correction: judged and projection ciphertext now retain
separate durable pin names. Provider selection is constrained to the requested
format's pinned root **after** ordinary current-reader/standing checks, and the
provider validates the actual envelope before choosing its response version.
Publishing a newer judged checkpoint therefore does not evict the prior usable v1
projection. The public judged flow now publishes both and makes a literal v1
request after judged publication, asserting the previous projection's snapshot ID.
Unknown request versions and malformed lengths have focused protocol regressions.
`disk::open` returns `Shelf`, matching `Options::shelf`; the Node fixture is correct.
Stored-schema rows are intrinsically read-only; their assertion does not measure
writable readiness. The test separately waits for the durable gate and performs a
permitted local mutation. Rust execution remains pending; syntax/diff checks passed.

Compatibility correction committed and pushed:
[1f139e73](https://github.com/MyAvenCEO/maiacity/commit/1f139e737).

Integration API: `owner_base_durability_pending` is the boolean journal receipt gate;
`owner_base_pending` in the bounded reconstruction work is a suffix count. They are
independent reasons for read-only status and must both be zero/false before mutation
readiness. Runtime tests use the durable-specific name to avoid conflating them.

### Exact historical-body dependency fetching

Core prerequisite `5c3d5201` (local cherry-pick `3893566b`) reports exact missing
same-entry signed IDs and retains a read-only prefix. The common Node pump now
requests those IDs via bounded protocol kind 21 instead of requesting all history.
Each reply is a subset of ordinary `Lab::answered` disclosure, additionally requiring
current READ/key entitlement and matching entry; request IDs grant no authority.
Provider revision fencing rejects a response prepared across a policy change.
Replies enter the existing prepared signature/current-state admission path. Inline
ciphertext arrives with its signed edit. Already-held IDs are filtered; missing
keys remain ordinary key-recovery work, avoiding pointless duplicate body requests.

One sweep covers at most four entries, 32 IDs per request, three rotating live peers,
and 512 KiB response memory under existing page/provider admission. Unavailable or
older peers leave explicit pending dependencies and back off (at least 250 ms),
with new work waking the pump. Entry/peer rotation prevents a permanently unavailable
first candidate from starving other bounded work. No hosted-peer exception or
unrestricted content lookup was introduced. Existing history sync remains available
for old peers and oversized individual edits.

Lean subset-authorization model passed. Added `dependency_reply_is_scoped_and_current_authorized`,
`dependency_request_is_exact_and_bounded`, and
`exact_dependency_arriving_late_is_received_without_unrelated_history` (missing body,
later availability, peer loss and another peer) regressions. **Rust tests not yet run**
while the root owns the compiler queue. Syntax and diff checks passed. Full-holder
concurrent-cut equivalence is covered by the prerequisite core regression, also
pending combined execution. Ordinary authorization-cache construction and digest
save scans remain CPU costs; bounded wire size alone is not a latency proof.

Exact-dependency network integration committed and pushed:
[1ce4fa3e](https://github.com/MyAvenCEO/maiacity/commit/1ce4fa3e), branch
`codex/bootstrap-dependency-fetch`. Requires the core missing-cut API from
[5c3d5201](https://github.com/MyAvenCEO/maiacity/commit/5c3d5201).
Combined compilation/behavioral validation remains pending.

### Transport review: wait transitions and malformed replies

Found and fixed a real wake gap: creating an exact missing-body wait makes runnable
reconstruction false, so the old `Shared::try_lab` wake predicate could leave an
idle dependency pump asleep. It now compares authorized missing-cut reports before
and after the mutation and wakes new/changed waits as well as runnable suffix work.
A wait change also emits a reactive notification even if only restored keys/bodies
changed the materialized result. The new Node regression adopts directly into a
missing-cut wait with no runnable suffix, requires an idle-pump wake, then checks
late-body resolution and reactive notification. Targeted replies now reject duplicate
signed IDs before cryptographic preparation; the network fixture checks duplicate
and wrong-entry payload rejection.

Review findings retained as open: a current suffix whose decryption key is missing
still drops its useful prefix in core admission rather than retaining a distinct
key wait. This requires a separate truthful key-wait state and key-revision retry;
resending already-held signed ciphertext is not a fix. Root and the core owner were
notified. Cancellation retains prepared-receive admission until detached work ends;
provider current-policy revision fencing and receiver ordinary signature/admission
remain in place. No new authority was added. Rust regression execution is pending;
syntax/diff checks passed.

Transport review corrections:
[94a61c5f](https://github.com/MyAvenCEO/maiacity/commit/94a61c5f), pushed on
`codex/bootstrap-retry-review`; tests pending combined Rust execution.

Targeted-network fixture correction: the first integrated run reached the test but
failed with `Locked` because `Lab::split` moves device/signing state before the
fixture authored its delayed edit. The fixture now authors all signed edits before
splitting, restores only the baseline into the initial provider, and gives a distinct
authorized replacement peer the full copy. Real empty-then-late fetch, peer-loss,
replacement fetch and unrelated-entry exclusion assertions remain intact. Source
syntax/diff checks passed; rerun remains with the root compiler queue.
Fixture correction: [02f86fc2](https://github.com/MyAvenCEO/maiacity/commit/02f86fc2e),
committed and pushed; no claim of a passing rerun yet.

Further retry review: recompute the authorized missing cut and unheld signed IDs
before **each** peer attempt, not just once per multi-peer sweep. A reply from the
first peer now removes those IDs from the next peer's request; changed/revoked or
resolved demand ends that attempt instead of reusing a stale batch. The real Node
missing-cut fixture checks the planned request before late-body receipt and no
request after it. Syntax/diff checks passed; root owns Rust execution. Remaining
architecture gap is ordinary key recovery for already-held ciphertext, which this
exact Signed-edit protocol intentionally does not misrepresent as a missing body.

### Active-view missing-key recovery priority

Implemented current-authorized `owner_base_key_waits` scheduling hints. Held encrypted
suffixes waiting for a key now wake the bootstrap pump, and active-view waits schedule
the existing coalesced peer pull path (at most three live peers per retry, rotated).
Each ordinary pull batch recomputes current key waits and puts those active entry logs
before other active entries. Governance/key-family logs still precede entries. View
replacement/release and discovery wake the pump; the hints expire with existing view
leases and disappear on key arrival or authority removal. No new wire authority or
key disclosure path was added, and held ciphertext is still excluded from exact-body
repair.

Lean scheduling lemmas passed in `AvenDB/BootstrapDependencies.lean`. Extended
`owner_bootstrap_retains_key_wait_and_resumes_on_key_arrival` to check entry hints,
late-key removal and revoked-device removal; existing assertions retain the prefix,
block writes and require no missing signed-body demand. Added
`key_wait_priority_is_limited_to_current_view_and_removes_resolved_wait`. Rust tests
remain pending the root compiler queue; parser and diff checks passed.

Limits: ordinary `Keys`/`Wraps` for an entry share its log with writes, so this is
prioritized authorized delta-log recovery, not selective envelope-only transfer.
It depends on peers announcing changed log frontiers and ordinary key admission;
it cannot invent an unpublished key or repair a corrupt body by refetching the
already-held signed edit. Lazy nodes retain their existing explicit-pull semantics.
Physical mobile latency and a full key-envelope network round trip are not proven
by these scheduling/core regressions.

### Schema/lens completeness fence (delivery safety repair)

Source inspection found that checkpoint evidence includes the selected entry and
its keys but omits external schema/lens bodies. `State::lane_of` omits unreadable
schema inputs; that local subset must not stand in for the owner's accepted lane.
Judged publication now authenticates a versioned ordered digest of the exact
`Lane::with_built_ins` inputs: shipped schemas, shipped lenses, then external raw
content hashes in canonical lane order. Missing or different inputs retain the
attested visible prefix but pause suffix admission and local writes with
`missing-schema-lane`, even when there are zero queued suffix writes. Both get and
query label this state read-only. Re-publication cannot replace the authenticated
expected lane with a waiting overlay's incomplete local lane.

Legacy judgments without this optional authenticated extension remain decodable
and durable, but read-only. New schema additions invalidate the lane equality too:
ordinary schema arrival can resolve a missing lane; a changed lane requires a fresh
owner-attested judgment or full canonical history. The digest is an owner-attested
completeness contract at the snapshot frontier, not proof that an offline device
knows future schema additions. Hash collision resistance and identical evaluator
semantics remain explicit assumptions.

Lean lane readiness/refusal lemmas passed. Added
`owner_bootstrap_missing_schema_retains_view_without_advancing_suffix` covering
legacy envelopes, zero-suffix get/query read-only, publication refusal, held suffix
not advanced while schema is withheld, authorized schema setup arrival, canonical
record equality, and later lane changes. Rust execution pending root queue.
No new schema-discovery protocol was added: these dependencies still arrive over
ordinary authorized schema/lens entry sync. Thus this closes unsafe/inconsistent
admission, not the remaining latency of missing-schema acquisition.

### Next generic bootstrap steps; guards deliberately remain

1. `entry_bootstrap_store::rebuild_owner_bases` currently refuses non-owner actor,
   nonempty shares and non-main proposals. Before extending that gate, derive an
   authenticated dependency manifest for each `Write`: grant/revocation path,
   selector body, `Body.proof`, historical cap-group definition at `State::place`,
   complete lane inputs, and counted proposal accept/landing facts.
2. Reuse `State::accepted_write`, `State::lets`, `Judging::judge` and
   `History::admit/passes/lands` unchanged. Distinguish missing inputs from a
   canonically rejected write; the former waits, the latter must remain a
   non-counted history fact rather than dropping the entire visible prefix.
3. Replace the single MAIN `base_scratch` with line/cut-keyed authenticated scratch
   selection before supporting New/Merge proposals. Fetch only absent bodies of
   the chosen causal cut; never treat an owner record alone as share proof.
4. `Readings::groups` must be complete at each historical write placement, with
   revocation and new group/lane facts invalidating admission. Until that readiness
   is independently established, cap-group/schema entries remain on canonical
   history and non-owner writable adoption stays disabled.
5. Only after full-holder differential tests for accepted/rejected shared edits,
   draft landing, proposal acceptance/merge and revocation pass should
   `Lab::check_write` owner/main/exact-head restrictions be extended. Durable
   baseline/suffix replay and peer-neutral authorization must use the same path.

### Active-view schema/lens dependency priority

The app KERNEL manifest requests capgroup/schema/lens types, but this alone does
not guarantee a private-vault or explicit-ID view's missing lane receives timely
priority. Core now exposes only currently authorized `missing-schema-lane` entry
and vault hints. The bootstrap pump derives bounded schema/lens selectors for each
live scope containing those entries (including discovered entries). These vault-
scoped dependency selectors precede normal collection queries and skip redundant
checkpoint fetches; schema IDs enter the existing signed-log live pull path.
No separate trusted schema import or hosted role exists. Missing-lane transitions,
view changes and ordinary bounded retry wake discovery; released/replaced scopes
cannot retain or add hints. Explicit-ID-only scopes can retain discovered dependencies
under the same 512-entry lease bound.

Lean scheduling lemmas passed. Added lease/revision/vault scoping regression and
extended the core missing-lane fixture to check hints clear on real lane recovery.
Rust validation pending. Bounds retain current discovery limits (four dependent
vault selectors per pass, at most four peers, 64 IDs per reply and one ten-second
round deadline). This does not prove arbitrary-size schema discovery completeness;
a lane outside that bounded result stays honestly read-only, with ordinary sync
as fallback. No wall-clock or physical-device latency success is claimed.

Schema demand scheduling: [fd88b9f9](https://github.com/MyAvenCEO/maiacity/commit/fd88b9f9), committed and pushed; Rust tests pending.

### Return from retained bootstrap to canonical local state

A lane-mismatched or legacy anchor must not keep a fully reconstructed entry
read-only forever. Retirement now independently runs ordinary `judged_anew` on the
current canonical replay, only after every owner-attested history change and every
currently accepted target write has an actual locally held signature and decrypted
body. All attested Write/count/fits/touches/adds judgments must correspond; canonical
MAIN must exist and no resulting item may contain parked Loro updates. Only then
is the retained anchor and its pending state removed and the canonical Shown used.
This is not frontier-ID-only or JSON-only equality. Owner-envelope parsing for this
comparison remains root/scope/decryption authenticated; normal public restoration
still performs its existing full-holder mismatch rejection. The full-history end
of the lane regression now requires anchor retirement and a successful normal edit.
Lean retirement gate lemmas passed; executable Rust validation remains pending.

Retirement correction: a newly held suffix can be uncounted because its schema is
missing even when every encrypted/decrypted target body is present. Retirement now
also requires every canonical post-base change to be counted. This conservative
gate intentionally retains read-only state for genuinely rejected suffixes until
complete rejection semantics are modeled separately. Regression
`canonical_retirement_waits_for_suffix_schema_even_with_all_target_bodies` authors
an ordinary signed update through the custom document-v0 schema/lens, withholds
those lane entries while delivering the target body, refuses retirement, then
supplies the authorized lane evidence and compares canonical results. Lean gate
lemma and parser/diff checks passed; Rust execution pending root queue.

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

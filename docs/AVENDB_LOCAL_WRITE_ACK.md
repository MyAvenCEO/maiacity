# Local write persistence acknowledgement

Implementation and focused validation: **done**, [commit 0d7a0082](https://github.com/MyAvenCEO/maiacity/commit/0d7a0082). Integration/deployment and physical-device latency acceptance remain with the coordinator.

## Problem and implementation

The public mutation response previously followed in-memory validation/application. It woke the asynchronous saver, but callers could receive success before the journal backend accepted the edit. The saver also retained its authoritative book mutex during optional warm snapshot preparation and writes, coupling a subsequent persistence fence to restart acceleration.

Ordinary public mutations (including approved mutations), file-entry creation and owner-approved checkpoint publication now capture a process-local log lineage and prefix **inside the same Lab closure as application**. Before returning success, a persistent Node waits for authoritative journal/key/anchor and signer-receipt persistence, then verifies that the persisted lineage and prefix cover that exact cut. A replaced lineage cannot pass by having the same length. Explicit memory-only Nodes remain memory-only; no shelf is invented. Low-level Rust `Node.act`/`try_act` remain in-memory APIs by design; this guarantee belongs to the successful public operation boundaries listed above.

The save lane is split: journal and signer receipts own the book mutex; optional warm state owns a separate warm mutex. The foreground acknowledgement never awaits warm encoding, a whole warm-save cycle, derived range summaries, or peer acknowledgement. A backend's already-running individual I/O operation can still delay another write; this change does not make physical I/O preemptible or promise a latency bound. Periodic journal pack/head maintenance every 64 journal records also remains in this lane; separating that maintenance is a distinct future optimization.

The persistence producer owns lifecycle admission independently of its async waiter. Canceling a caller cannot release the producer's ownership before the actual backend completion. If cancellation happens before an acknowledgement producer starts, no success has been returned; the existing saver/finalizer still owns persistence of the in-memory change.

## Failure semantics

A backend failure returns an error beginning `LocalWritePersistenceUnconfirmed: applied locally, but saving was not confirmed`. It explicitly warns not to repeat the mutation. This is different from an authorization refusal: the operation may already be visible locally, and retrying a non-idempotent create can duplicate it. The saver is woken for a persistence retry. Callers must inspect existing local results and retry persistence, not automatically replay the original operation. The current bridge carries this distinction as a stable error prefix/message, not a new success envelope.

## Backend guarantees

- Native disk: immutable `Put` writes and `sync_all`s a staged file, links it into place, then `sync_all`s its parent directory (`avendb-net/src/disk.rs`). Blob finish also syncs before publication.
- Browser OPFS: `store.worker.js` writes through `FileSystemSyncAccessHandle`, calls `flush()`, closes, then publishes the staged file. This is browser acknowledgement, not a guarantee against browser quota eviction or deletion of site data.
- Other Shelf implementations: the acknowledgement inherits the backend's `Put`/`Keep` completion contract. A generic Shelf is not universally equivalent to OS fsync.
- No extra authority or mandatory remote acknowledgement is assigned to a hosted peer.

## Proof and regressions

`AvenDB.LocalWriteAck` is an explicit scheduling/receipt model: successful acknowledgement covers the written prefix and dependencies; backend failure is not success; optional warm and peer completion do not control the acknowledgement. Its honest-backend assumption does not prove storage firmware, fsync implementation, or timing.

Focused Rust regressions cover actual public mutation followed by reopening the journal before shutdown, independence from a deliberately held warm lane, replaced-lineage refusal, backend error propagation, no early success before backend completion, and cancellation followed by draining the admitted producer.

The tests establish backend acknowledgement and scheduling semantics, not physical-device latency or a measured <100 ms result.

Validation status: Lean model passed; all 3 focused Rust regressions passed (including success, failure, cancellation and lineage subcases), plus 3 existing announcement/warm-save/shutdown regressions. The public-create fixture initially omitted its document schema and was corrected; the final run passes. Exact test binary: `/private/tmp/avendb-resume-target/debug/deps/avendb_net-d9fcfac7c7e14740`; final log: `/private/tmp/avendb-durable-ack-tests-final.log`. This source is not yet installed/deployed. No live store was modified.

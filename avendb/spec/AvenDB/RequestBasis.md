# Structural request preparation: specification and implementation boundary

`RequestBasis.lean` was checked before the Rust change. It models an ephemeral memo of structural history calculations, not a new persisted cache, permission source, acknowledgement, or sync protocol.

## Inputs and invalidation audit

The memo contains `logs_of(edits, ids)` and `asks_with_logs(edits, ids, logs, [])`. These functions inspect signed edit *contents* and IDs, their parents, and per-log closure. They do not inspect unlocked keys, available blobs, signature containers, time, scopes, peer identity, or the materialized application view.

`Log` keeps its edit/ID vectors private. Its production mutation paths are:

- `Log::append`: rotates `LogRevision` after adding an edit.
- `Log::receive`: rotates it when at least one new ID is added; duplicates leave both vectors unchanged.
- `Log::let_go`: rotates it when records are removed. Checkpoint withdrawal in `lab.rs::trust` uses this path.
- `Log::clone`: shares revision only with identical cloned vectors. Subsequent mutations rotate the token independently.
- `Lab::restore_warm` / `restore_from` / `restore_backup`: construct a new Store with empty derived-work containers, even for equal-length or identical restored histories.
- Device loss removes the Store; hosted sessions resolve to the host's same structural Store.

`keep_fresh` uses `Log::receive`; stripping checkpoint-covered signatures does not change these structural inputs. Blob-only receipt and follow changes must not rotate/rebuild the structural basis: those inputs are deliberately applied after lookup.

The token is process-local allocation identity held by the memo itself, not a content count, persisted hash, or assertion supplied by a peer. The Lean equivalence theorem assumes equal tokens imply identical histories; the mutation audit and Rust regression tests support that premise, without claiming extraction-level proof.

## Request construction and callers

`Lab::request` still obtains current `answered(d, peer, [])`. The existing authorization cache is unchanged. It filters structural haves by permitted logs and loose IDs by permitted edits, attaches the current canonical follow list, and computes wanted blobs from current authorized edits and current blob availability.

A request owns a clone of the structural Ask. Thus network `session::only` / `of_vaults`, cursor changes, and optional range-transfer request rewriting cannot mutate the memo or affect another peer. Ordinary page preparation and range-transfer preparation retain their existing permission gates and wire encoding.

## Runtime correspondence

`request_basis_tests.rs` compares whole request wire bytes with the original uncached algorithm, including uncached permission planning:

- Multiple peers and repeated requests: identical bytes, no private disclosure, exactly one structural basis build for an unchanged history. Mutating a returned request cannot affect the shared basis or another peer's request.
- Follow/unfollow and blob-only arrival: current follow/wants, no structural rebuild.
- Revocation and restore: fresh disclosure and replacement basis.
- Equal-length distinct restored histories: distinct correct requests, never count-based reuse.
- Missing-parent arrival and withdrawal: structural closure equals recomputation after each revision.

The direct-log missing-parent test deliberately isolates structural closure; it does not bypass production signature admission or claim an end-to-end checkpoint acceptance test. Execution evidence is recorded in the repository upgrade handoff when the tests run.

On 2026-10-23, the focused Rust command below passed all five tests (7.66 seconds of test execution) after an independent mutation/invalidation audit:

```sh
cargo test --profile app --locked --offline -p avendb --lib request_basis_tests -- --nocapture --test-threads=1
```

## Cost and remaining work

One basis per Store retains O(held history) log assignments plus the structural Ask. It is shared across peers; it is not a history-sized cache per peer. Each request still clones output and scans authorized places for redaction and blob wants. Every changed history revision rebuilds the basis. No incremental authorization across mutations, network bandwidth increase, or measured latency improvement is claimed by this slice. The deterministic build-count test demonstrates avoided repeated structural work, not a wall-clock benchmark.

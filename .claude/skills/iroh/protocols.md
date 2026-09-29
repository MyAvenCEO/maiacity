# The other iroh protocols — iroh-docs is our catalog

## iroh-docs (0.101)

Multi-writer key-value **replicas** ("documents"). An entry is `(namespace, author, key) → (BLAKE3 hash, size,
timestamp)`; values are blobs. Nodes sync with **range-based set reconciliation** (efficient: only differences
travel), gossip announces changes. Persistent in one redb file. `doc.subscribe()` yields events such as
`InsertRemote` (someone else wrote an entry) and `ContentReady` (the blob behind an entry arrived).
Built on iroh-blobs + iroh-gossip. Tauri reference: `iroh-examples/tauri-todos`.

**We use it as the catalog** (decided 2026-09-29) — see `maiacity.md` for keys, authors and flows.

Verified in the 0.101 source:
- `Docs::persistent(path).spawn(endpoint, blobs_store, gossip)` (also `Docs::memory()`); needs an iroh-blobs store
  and iroh-gossip. A protect callback keeps entry contents safe from blob GC.
- Entries are signed twice: the **namespace** key (`NamespaceSecret` = write capability; `NamespaceId` = its public
  key and the replica id; `Capability::Write | Read`) and an **author** key (`Author` / `AuthorId`).
- `DownloadPolicy::EverythingExcept(filters)` (default: everything) / `NothingExcept(filters)` — decides which entry
  contents a node fetches automatically. This is native pinning.
- Live events include `InsertRemote`, `ContentReady`, `PendingContentReady`, `NeighborUp/Down`, `SyncFinished`.
- An entry whose timestamp is more than 10 minutes in the future is rejected.

Caveats: 0.x on the pre-production iroh-blobs line; revocation is not built in (a device that holds the namespace
secret keeps it) — we enforce it at the connection layer and by ignoring revoked authors, and rotate the namespace if
a device is lost. **UNVERIFIED**: how actively it is developed; how its downloads behave against our S3-backed server
(phase 0 spike).

## iroh-gossip (0.101)

Topic-based broadcast (HyParView membership + PlumTree epidemic broadcast). Needs bootstrap peers; best-effort,
eventually consistent; "scales to a few thousand peers"; builds for WASM. We use it indirectly: iroh-docs runs on it for live
updates between replicas.

## irpc / irpc-iroh

Typed RPC over iroh streams (iroh-blobs itself uses irpc internally). Good fit if we add our own node-to-node
control protocol (e.g. "here is a new blob, please pull it", "what do you have?") behind our own ALPN
(`maiacity/vault/1`).

## Others

- `iroh-roq` (0.1) — RTP over QUIC for real-time media. Not for files.
- `iroh-automerge` — example only.
- `iroh-ping` — the quickstart example; handy to test connectivity to our relay/server.
- `sendme` — n0's CLI: send a file/dir with a ticket. Useful to benchmark and debug (it uses `TryReference` to send,
  `Copy` to receive).

## Our own protocol — not needed for sync

With the catalog on iroh-docs, sync needs no protocol of our own. A small ALPN (`maiacity/vault/1`) may still carry
pairing (handing a newly approved device the namespace capability) and status questions ("which of these do you
hold?").

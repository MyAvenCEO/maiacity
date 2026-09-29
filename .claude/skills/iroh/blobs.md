# iroh-blobs — how our files are stored, moved and served

Version **0.103.0** (depends on `iroh ^1`). Checked against the source; file paths are inside the crate.
Its README: *"this version of iroh-blobs is not yet considered production quality"* — see `gotchas.md`.

## The hash (our identity)

- `Hash(blake3::Hash)`; `Hash::new(bytes) = blake3::hash(bytes)` (`src/hash.rs`). **Plain BLAKE3 of the file bytes.**
  `b3sum file`, the `blake3` crate, noble-hashes `blake3` → the same value.
- `Display` = `to_hex()` = **64 lowercase hex chars**. `FromStr` accepts hex (64) or base32 (52).
  `fmt_short()` = first 5 bytes hex — for logs only, never as a reference.
- Internally the tree is verified in **16 KiB chunk groups** (`IROH_BLOCK_SIZE`, chunk log 4). That changes only the
  outboard, never the root hash.
- A `HashSeq` / collection hash is the hash of a *list of hashes* — not the hash of any file. We reference files by
  their raw blob hash only.

## The store

`FsStore::load(dir).await?` (or `load_with_opts(db_path, Options)`). One store per node. Layout:

```
<dir>/blobs.db                 redb: metadata, tags, inlined small data + outboards
<dir>/data/<hex>.data          file bytes (owned by the store)
<dir>/data/<hex>.obao4         outboard (the BLAKE3 tree, for verified streaming)
<dir>/data/<hex>.sizes4        only while a blob is partial
<dir>/data/<hex>.bitfield      only while a blob is partial (which ranges we have)
<dir>/temp/                    must be on the same filesystem as data/ (atomic moves)
```

- Data and outboards ≤ 16 KiB are **inlined** in redb (`InlineOptions`); a blob ≤ 16 KiB has no outboard.
- **Outboard overhead ≈ 0.39 %** (64 B per 16 KiB) — about 3.9 GB per TB of footage.
- Crash-consistent, but the last seconds of writes can be lost: always shut down cleanly
  (`router.shutdown().await` / `store.shutdown()`).
- `MemStore` exists for tests only.

## Getting files in — import modes

```rust
// default: ImportMode::Copy — reflink first (APFS clone = no extra space), else a real copy
let tag = store.blobs().add_path(abs_path).with_tag().await?;           // TagInfo { name, hash, format }

// explicit options
use iroh_blobs::api::{blobs::AddPathOptions, proto::ImportMode};
use iroh_blobs::BlobFormat;
let tt = store.blobs()
    .add_path_with_opts(AddPathOptions { path: abs_path, format: BlobFormat::Raw, mode: ImportMode::Copy })
    .temp_tag().await?;                                                  // protected only while the process lives
```

| Mode | What happens | For us |
|---|---|---|
| `ImportMode::Copy` (default) | `reflink_copy::reflink` first, falls back to a 1 MiB-buffer copy. On APFS, same volume → a clone: shared blocks, no extra space, and the store's copy is safe from later edits. | **Use this.** Ingest source and store on the same APFS volume. (**UNVERIFIED on real APFS** — test once.) |
| `ImportMode::TryReference` | File stays where it is, recorded as `External(paths, size)` (≤ 8 paths). Stores may ignore it and copy small files. | Avoid. If the file changes, network serving fails verification (good) but **local reads (`reader`, `export_ranges`) return the changed bytes unverified** (bad). |

Other ways in: `add_bytes`, `add_slice`, `add_stream`, `batch()` (many adds under temp tags), `import_bao*`
(already-verified bao streams). Every add returns progress (`.stream()`), or `.with_tag()` / `.with_named_tag(name)`
/ `.temp_tag()`.

Getting files out: `export(hash, target)` / `export_with_opts` (`ExportMode::Copy` or `TryReference` = move and then
reference), `get_bytes`, `export_ranges(hash, ranges)`, `export_bao` (verified), `reader(hash)`.

## Keeping files — tags and GC

- **Tags are pins.** `store.tags().set(name, hash_and_format)`, `create(value)` (auto name), `get`, `list`,
  `list_prefix`, `rename`, `delete(name)`, `delete_prefix`. Persistent, in redb.
- `TempTag` — protects only while the process runs. Every add returns one unless you name a tag.
- A tag on a HashSeq protects the HashSeq **and all its children**.
- **GC is off by default** (`Options::gc = None`). Turn on with `GcConfig { interval, add_protected }`.
  `add_protected` fills a `HashSet<Hash>` before each run — we fill it from Postgres. Return `ProtectOutcome::Abort`
  if Postgres can't be read, so GC never runs blind.
- **Deletion only through GC** (`Blobs::delete_with_opts` is crate-private). Whole blobs only.

Our rule: every blob a node must hold gets a named tag `vault/<hex>`; GC is either off or protected by Postgres.

## Moving files between nodes

Two nodes connected through iroh (see `connectivity.md`). The protocol is request/response over QUIC,
ALPN `iroh_blobs::ALPN` = `b"/iroh-bytes/4"`, served by `BlobsProtocol::new(&store, events)`.

**Pull, from one peer** — `store.remote()`:

```rust
let conn = ep.connect(server_id, iroh_blobs::ALPN).await?;
let stats = store.remote().fetch(conn, hash).complete().await?;   // asks only for what is missing locally
```

`remote().local(hash)` → what we already have; `.missing()` → the `GetRequest` for the rest. That is the resume
mechanism: an interrupted fetch resumes from the saved bitfield.

**Pull, from several peers** — `Downloader`:

```rust
let dl = store.downloader(&ep);                    // or Downloader::new(&store, &ep)
dl.download(hash, vec![server_id, other_mac_id]).await?;  // tries providers in turn; each asked only for what's missing
```

`SplitStrategy::Split` parallelises only across the children of a HashSeq — one blob is never split across providers
at once. `ContentDiscovery` is pluggable (`Shuffled` built in).

**Push, to a peer** — `store.remote().execute_push(conn, PushRequest)`. The receiving provider must allow pushes
(disabled by default; enable via the event mask and intercept to check the pusher). This is how the Mac uploads new
footage to the server without the server polling.

**Ranges** — `ChunkRanges::bytes(1_000_000_000..1_100_000_000)` → the provider sends only the parent hashes needed to
verify those chunks plus the data (rounded out to 1 KiB chunks; verification in 16 KiB groups). Partial blobs are
stored with a bitfield. So a client can fetch and verify 100 MB from the middle of a 50 GB file.

**Observe** — `store.blobs().observe(hash)` streams the bitfield as it fills (progress bars, "is it complete?");
`status(hash)`, `has(hash)`.

## Reading for HTTP (the gateway)

`store.blobs().reader(hash)` → `BlobReader`, implements `tokio::io::AsyncRead + AsyncSeek`. For a Range request:
seek to start, read length, answer `206` with `Content-Range`. Caveats:

- Missing ranges make the reader error → check `status`/`observe` first, or `remote().fetch` the range on demand.
- The local reader does **not** re-verify (it trusts the store). That's why nodes import with `Copy`, never
  `TryReference`.
- Reference implementations: `iroh-examples/iroh-gateway` (Range support, video seeking; README stale) and
  `iroh-content-discovery/iroh-local-gateway` (206 + exact Content-Length, verified). → `browser.md`

## Access control on the provider side

`BlobsProtocol::new(&store, Some(EventSender))` with an `EventMask`:

| Field | Modes | We use |
|---|---|---|
| `connected` | `None` / `Notify` / `Intercept` | `Intercept` — reject EndpointIds not paired |
| `get`, `get_many` | `None` / `Notify` / `Intercept` / `NotifyLog` / `InterceptLog` | `Intercept` — paired devices only |
| `push` | same; **disabled by default** | `Intercept` — only ids with `vault:sync` |
| `observe` | `ObserveMode` | as needed |
| `throttle` | `None` / `Intercept` | off unless needed |

Abort reasons include `RateLimited` and `Permission`. This is a second gate after the endpoint hook.

## Collections

`HashSeq` = a blob that is a list of 32-byte hashes; a `Collection` adds names. Useful to move a whole day or a whole
card as one request (`SplitStrategy::Split` fetches the children in parallel). We may use them as transfer bundles —
never as identities.

## Known limits

- No S3 / object-storage store for 0.103 (`iroh-experiments/iroh-s3-bao-store` pins 0.35; issue #84 open). Our
  server therefore does **not** run `FsStore`: it keeps data + outboards in Hetzner Object Storage and speaks bao
  streams itself with `bao-tree` (`encode_ranges_validated`, `decode_ranges`, `outboard`) over ranged S3 reads
  (`iroh-io`'s `AsyncSliceReader`, `HttpAdapter` with `x-http`). The Mac side uses `export_bao` / `import_bao_reader`.
  → `maiacity.md`
- Issue #266: importing blobs that already exist can grow memory without bound — check `has(hash)` before re-adding
  on bulk ingest.
- Throughput is unproven for us (see `gotchas.md`).

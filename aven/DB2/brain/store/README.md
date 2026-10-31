# avenSTORE

Where a peer's bytes rest: one small contract of blobs and refs, the backends it runs on, files cut into chunks, and
the one module that moves blobs between peers.

## Owns

- [Blobs and refs](#blobs-and-refs): a Value at rest, and a peer's own names for Values.
- [Compare-and-set](#compare-and-set): the only way a ref moves, under the store's one writer.
- [The backends](#the-backends): memory, a folder and S3 through OpenDAL, OPFS through our own driver, and the one
  suite they all pass.
- [The opfs driver](#the-opfs-driver): atomic writes, crash recovery and the store's marker in a browser.
- [Files](#files): any file as a hash sequence of chunk blobs.
- [Moving blobs](#moving-blobs): iroh-blobs on our store, through one adapter.
- [Pack files](#pack-files): the opfs driver's next layout.

## Uses

- [avenCORE](../core/README.md): the Value and its name, the BLAKE3 hash of its bytes. A blob is a Value at rest.
- [avenPEERS](../peers/README.md): the network. A Peer runs its store as configured (`--store memory|fs|s3`), a
  Peer-Light always on OPFS; the Router, the door and the fetch gate decide who may fetch.
- [avenOS](../os/README.md): the leader. The tab that holds the Web Lock runs the Peer-Light's worker, which makes it
  the one writer of a browser's store.
- [avenRUNTIME](../runtime/README.md): the file registry, which decides from a file's bytes what it is and how it is
  served. The store never does.
- [avenSANDBOX](../sandbox/README.md): the box, where the suite runs on all four backends.

## Blobs and refs

A store holds two things, as git holds objects and refs. A **blob** is bytes named by their hash: whole or absent, and
never changed. A **ref** is a peer's own name pointing at a blob, and it is the only thing in a store that moves.

The store never knows what a blob means: a chunk of a movie, a sealed envelope and a head are all just bytes. It holds
no keys, caps or members, and it decides nothing about what to fetch or keep.

- **A blob** is a Value at rest ([avenCORE](../core/README.md)). `put(bytes)` computes its BLAKE3 hash, so the same
  bytes twice keep one blob. `get` checks the bytes against their name and answers `Corrupt` otherwise. `get_range`
  reads `a..b` of it, and a range outside the blob is `Range`. `size` is one stat, a HEAD on S3. `list` is sorted.
  Deleting a missing blob is fine.
- **A ref** is named by a `RefName`: 1 to 128 of `A-Z a-z 0-9 . _ -`, not starting with `.`. Names are flat, so every
  backend lays them out alike. At rest a ref is exactly its hash's 64 lowercase hex digits and a newline, in every
  backend; anything else is refused. Refs never leave their peer.
- **The layout** is the same everywhere: blobs at `blobs/<hex>`, refs at `refs/<name>`. A hash is bare hex in a store's
  paths and `b3:<hex>` in every text format.
- **The contract** is the `Store` trait: `put`, `get`, `get_range`, `has`, `size`, `list`, `delete`, `get_ref`,
  `set_ref`, `delete_ref`, `list_refs`. There is no append, since object storage has none. No backend's types cross
  it, and its errors are `Stale`, `Range`, `InvalidName`, `Corrupt`, `Outdated` and `Backend`.
- **What keeps a blob** is a ref that reaches it. The store deletes only what its peer asks it to.
- **Refs in use:** avenDOCS keeps each Doc's head and held page under two refs, `doc-<id hex>` and `doc-<id hex>-held`
  ([avenDOCS](../docs/README.md)).

**Decided:** README rules 1 and 10; A1 ("ref" only for the store, "link" elsewhere); milestone 1's store decisions
(ref names flat; one contract, no append); L2 · **Lean:** `Aven.DB.Store` — `blob_never_changes`, `blob_kept`,
`named_step`, `named_run`, `named_empty`, `size_get`, `readRef_refText`, `readRef_bare_refused`,
`readRef_only_refText`

## Compare-and-set

A ref moves only if it still points where its writer last saw it. A store has one writer (README rule 1), so this
guards against that writer's own racing tasks and against a crash, not against a second writer.

- `set_ref(name, expected, new)` moves `name` to `new` if it holds `expected`; `expected = None` means the ref must not
  exist yet. Otherwise the writer gets `Stale`, with what the ref holds now. `delete_ref(name, expected)` follows the
  same rule.
- Of racing writers that expect the same value, exactly the first is done and every other is refused. A reader never
  sees a ref torn.
- Every backend runs compare-and-set under one async lock in the store, so the one writer's tasks take turns.
- S3 also asks the server to refuse a stale write, as its `Conditions` say:

  | Conditions | What the server is asked |
  |---|---|
  | `On` | `If-None-Match: *` to create a ref, `If-Match` to change or delete one |
  | `Create` | `If-None-Match: *` only: a write-once ref is refused by the server, a changing one leans on the lock. Hetzner's Object Storage refuses a correct `If-Match` and ignores it on DELETE, so production runs `Create` |
  | `Off` | nothing: the lock and the one writer alone, as on a folder |

- A ref that a second writer moved is refused, never retried over (L2).

**Decided:** README rule 1; L2 · **Lean:** `Aven.DB.Store` — `stale_set`, `stale_delete`, `set_done`,
`racers_refused`, `one_wins`, `ref_step`, `ref_run`, `ref_written`, `refs_apart`, `blobs_apart`

## The backends

Each place a peer stores gets a backend, and every backend passes the same suite, so all of them behave alike.

| Backend | Who stores there | A write is atomic because | Compare-and-set |
|---|---|---|---|
| memory | tests and the simulation | it is inserted whole | the lock |
| fs | a native Peer, in a folder | it is written to `<root>/.tmp`, synced, then renamed into place | the lock |
| s3 | the Aven Peer: Hetzner's Object Storage; versitygw in the box | each object is one PUT, whole or absent | the lock and the server's conditions |
| opfs | a Peer-Light, in its origin's private file system | it is written to a temporary file, then moved ([below](#the-opfs-driver)) | the lock |

- **memory, fs and s3 are Apache OpenDAL's** services, behind one `DalStore`. OpenDAL is only a driver under the store:
  nothing of it leaves `dal.rs` and `backend.rs`.
- **opfs is ours,** written on OPFS's sync access handles. OpenDAL's own OPFS service is not used.
- **The conformance suite** (`conformance.rs`, a public module) replays the Lean model's traces
  (`db/spec/vectors/store.json`), each on a fresh, empty store, and every call must give the model's result. Beside
  them stay the mechanics the model doesn't have: ranges over 1 MiB, racing writers of which exactly one wins, readers
  that never see a torn ref, and a ref at rest in its one form. The cases report rather than panic, so the same suite
  runs under `cargo test` and in a browser's dedicated worker, in Chromium, WebKit and Firefox.
- **The model runs too:** the memory store follows the running Lean model call by call on random traces.

**Decided:** README rule 10; milestone 1's store decisions (one contract, OpenDAL for memory, fs and s3; the suite a
public module; versitygw as the box's S3); Samuel, 30 Oct (our own opfs driver) · **Lean:** `Aven.DB.Store`, its
traces exported as `store.json`; the suite replays them

## The opfs driver

A browser's store is our own driver on OPFS, in the dedicated worker that runs the Peer-Light, the only place every
engine has sync access handles. It keeps each blob as one file and changes nothing in place, so a crash in any call
leaves the store as it was before the call or after it.

- **Atomic writes.** Every write goes to a temporary file named by its place, `tmp/blob-<hash>` or `tmp/ref-<name>`,
  which is closed and then moved into place. Where a folder can't move, it is copied and deleted instead. Opening the
  store rolls every whole temporary file forward (a blob that matches its hash, a ref that reads as a valid hash) and
  removes the rest.
- **The marker.** `meta/version` holds `avenDB store 1` and a newline, written when the store is made. A store with
  anything in it and not exactly that marker is from an older avenOS: opening it is `Outdated`, and the Peer-Light
  clears its origin and starts fresh as a new device, which signs in again with its passkey. A browser's store is never
  migrated. The Aven Peer's S3 store is never reset.
- **Handles.** A write opens, writes and closes its file. Reads keep at most 16 open read handles, the least recently
  used closed first, all closed when the leader gives up its lock. A `NoModificationAllowedError` is retried for up to
  2 s, then fails with its reason. Refs and temporary files are read through `getFile()`, again when a move replaced the
  file.
- **Quota.** The Peer-Light asks `navigator.storage.persist()`. A write over quota fails cleanly, and its temporary file
  is removed.
- **The gates** are the real workload in each engine (`store/opfs/run.mjs`, medians of 50):

  | | one small blob and its ref | a 1 MiB chunk | catching up 500 small blobs and refs |
  |---|---|---|---|
  | Chromium and WebKit | 60 ms | 30 ms | 10 s |
  | Firefox | 150 ms | 100 ms | 30 s |

**Decided:** Samuel, 30 Oct (our own driver; a browser's store may be reset, never migrated); the store's decisions of
30 Oct (one file per blob; the gates per engine) · **Lean:** `Aven.DB.StoreCrash` — `crash_atomic`, `crash_trace`,
`torn_ref`; `Aven.DB.Store` — `open_marked`, `open_unmarked`

## Files

A file of any size is cut into chunks of 1 MiB, each an ordinary blob, plus one blob that lists their hashes in order.
The file is named by that list's hash. Nothing in the contract changes for big files: a movie of several GB never sits
in memory, and a seek fetches only the chunks it touches.

- **Chunks.** Every chunk but the last is exactly 1 MiB (2^20 bytes); the last is 1 byte to 1 MiB.
- **The chunk list** is a blob of 32-byte hashes in order (iroh-blobs' `HashSeq`), and the file's name is its hash.
  ("Index" means only a query's index; the code still says `index` for the chunk list.)
- **Limits.** The largest blob a peer fetches is 1 MiB + 64 KiB (`MAX_BLOB`), checked before anything is allocated:
  the size a holder states is its word until the last chunk is checked. The largest file is 32 GiB (`MAX_FILE`), whose
  chunk list still fits in one chunk.
- **Checked whole.** A receiver checks the chunk list against the file's size, then each chunk, on fetch and on every
  read; each chunk is read whole against its hash. A file whose chunks aren't cut as above is `Corrupt`, never a panic.
- **Ranges.** Reading a range reads exactly the chunks it touches; `missing` names those the store lacks. What a peer
  holds of a file is which of its chunks it has.
- **What a file is** is decided from its bytes by avenRUNTIME's file registry ([avenRUNTIME](../runtime/README.md)),
  never by the store and never from what its sender claims.
- **In a Doc,** a file Record names a file's chunk list; its chunks and chunk list are Values, kept and read as that Doc
  is (A22). After the cutover a file's chunks are Doc Values behind the one fetch gate (P16).
- **Outboards are made, never kept:** iroh-blobs builds a chunk's bao tree when it serves or checks it.

**Decided:** the store's decision of 30 Oct (big files are hash sequences, the contract unchanged); A1 (chunk list);
A22; P16 · **Lean:** `Aven.DB.Files` — `split_fits`, `flatten_split`, `length_split`, `split_size`, `index_fits`,
`mem_touches`, `touches_lt`; vectors `files.json`

## Moving blobs

Between peers, blobs move by iroh-blobs' protocol, which brings verified ranges, resume, hash sequences and several
holders at once. Where the bytes rest stays ours. One module stands between the two, the adapter, and nothing above the
store names an iroh-blobs type: it is 0.x and breaks about monthly.

- **The adapter** (`store/src/blobs`) answers 6 of the 23 requests of iroh-blobs' store API: observe and status by
  `size`, the exports of bao and of plain ranges, the import of bao, and listing. Tags, temp tags and deletes answer
  "unsupported" or nothing, since refs keep blobs. A fetched blob is buffered until every byte has arrived and iroh-blobs
  has checked it, then put once, whole or absent. In a browser the store is neither `Send` nor `Sync`, so it lives in
  the adapter's own task and only channels cross.
- **A peer mounts** the adapter's provider on its Router under iroh-blobs' ALPN, `/iroh-bytes/4`, behind its door, and
  asks once per connection whom it serves (`Admit`). Push is off. It fetches with `fetch_file` and `fetch_chunks`, in
  our hashes and iroh's connections.
- **The adapter reads ahead:** it keeps the last chunk lists it read and reads a file's next chunk while its chunks go
  out in order, so serving a file from S3 costs one GET per blob.
- **The risk taken:** iroh-blobs has no public constructor for a store of someone else's, so the adapter builds one
  with `RefCast` from the `irpc::Client` the type wraps. iroh-blobs stays pinned, and `tests/blobs.rs`'s
  `iroh_blobs_runs_on_our_store` fails at once if this stops working.
- **Pinned exactly:** iroh and iroh-relay 1.4.1, iroh-gossip 0.101.0, iroh-blobs 0.104.0, bao-tree 0.17.0, irpc 0.17.0.
- **Until the cutover** iroh-blobs serves the first generation's chat files. After it, a Doc's sealed Values move
  behind avenPEERS's one fetch gate ([avenPEERS](../peers/README.md)).

**Decided:** the store's spike (iroh-blobs on our store through one adapter, over bao-tree directly); A44; P16 ·
**Lean:** not in Lean (mechanics); `tests/blobs.rs` holds it

## Pack files

Firefox pays about 23 ms for each sync access handle it opens, and a small write opens two. A pack keeps a few files
open and appends to them, so a write costs a write, not a file. The contract, the suite and the gates stay; only the
opfs driver changes underneath.

- **Blobs in packs.** A blob is appended to the open pack as one entry: a header (its hash, its length and a checksum
  of the header), then its bytes. A pack closes at a size (64 MiB, to be measured) and a new one opens. Big chunks may
  stay one file each, as measured.
- **Refs in a log.** Every `set_ref` and `delete_ref` appends an entry to the refs log: the name, old, new or none, and
  a checksum. A name's newest entry is its value, and compare-and-set still runs under the lock.
- **The pack table** maps each hash to its pack, offset and length, and each name to its hash. It is rebuilt on open
  from every pack's headers and the refs log, and kept in memory.
- **A torn tail is cut by its checksum:** opening finds the first entry whose header or checksum fails and truncates
  there. A blob's bytes are still checked against its hash on every read.
- **Deletes are tombstones,** which `list` and `has` skip. Compaction comes later: a pack that is mostly tombstones is
  rewritten to a new one, the old one removed and the table switched under the lock.
- **Lean first:** a model of the log beside `Aven.DB.Store`, with the theorem that replaying any prefix of the bytes
  written, cut at its first bad entry, gives the store before or after the last call; then Rust's crash tests, every
  byte offset a crash point; then the driver.
- **Its gates** are the same workload, every engine held to 60 ms, 30 ms and 10 s.

**Decided:** the store's decision of 30 Oct (packs next, on the upgrade's evidence) · **Lean:** not in Lean yet

## Status

| What | Lean | Rust | Where it stands |
|---|---|---|---|
| Blobs, refs, compare-and-set | `Aven.DB.Store`, `store.json` | `Store`, `Hash`, `RefName` | built; the suite passes on all four backends |
| Crash safety | `Aven.DB.StoreCrash` | the opfs driver; `tests/opfs.rs` crashes it at every step | built |
| memory, fs, s3 | traces | `DalStore` | built; production's Hetzner runs `Create` |
| opfs | traces | `OpfsStore` | built; WebKit's `move()` on a real iPhone still unmeasured |
| Files | `Aven.DB.Files`, `files.json` | `files.rs` | built |
| The iroh-blobs adapter | not in Lean | `blobs` | built; serves the first generation's chat files until the cutover (P16) |
| Withholding | not in Lean | `withhold.rs` | built for the first generation's deletes: a withheld blob reads as gone; it goes with the first generation |
| Cleanup by reachability | not yet | not yet | not built: nothing deletes a blob no ref reaches |
| Pack files | not yet | not yet | planned |
| The fs backend's folder | — | `backend::fs` | gap: the folder isn't synced after a rename, so a power loss can lose the last write, never tear it |
| Large Values over iroh-blobs after the cutover | — | — | open for stage 6, measured on video (P16) |

The store's Lean (`Aven.DB.Store`, `Aven.DB.StoreCrash`, `Aven.DB.Files`) is in `db/spec`, with the rest of `Aven.DB`.

## Open questions

1. **Does `set_ref` require its blob to exist?** Today the store doesn't check. The architect decides.
2. **How much of a Peer-Light's OPFS cached chunks may take** before the oldest go. The architect decides, with avenOS.

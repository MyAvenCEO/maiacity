# The store: what it holds, what it doesn't, and the iroh it uses

Status: a design draft (Samuel, 30 Oct 2026), for discussion. Nothing here is built yet beyond the contract
[`SANDBOX.md`](../../SANDBOX.md#storage-one-contract-pluggable-backends) describes.

**The goal it serves next:** files in the chat. A member drops an image, a PDF or a movie into the chat, and every
other member sees it at once: the image appears, the PDF opens, the movie plays from any point without being fully
downloaded first. Every kind of file takes the same path. Nothing in the store or on the wire knows what kind of file
it carries.

**Left out on purpose, until their layers exist:**
- **Types, schemas and validation** come with `aven/DB/docs` (milestones 4 and 6). A file is just bytes plus a
  name and a MIME type the sender claims.
- **Caps and per-document keys** come with avenID's caps (milestone 3). Until then the network has one shared,
  encrypted room, the **city-dome** (until now "the room" or "town hall"). Every invited member of Maia City is in it,
  and all members share one secret for it.

## One of each

Everything rests on one primitive and moves the same way:

- **One primitive:** the blob. Immutable bytes named by their BLAKE3 hash. A file is one blob. Later, a Loro
  document is a head over segment and snapshot blobs.
- **One verification tree:** bao (`bao-tree`). It checks any byte range of a blob against the blob's hash, whether the
  range came from disk or from another peer.
- **One store per peer:** ours, behind the `Store` contract. iroh-blobs ships its own disk store (redb plus files); we
  don't use it. iroh-blobs moves bytes, and the bytes rest in our store.
- **One way to move bytes:** iroh-blobs' protocol (`/iroh-bytes/4`), which sends verified ranges, resumes, and downloads
  from several holders at once.
- **One way to announce:** iroh-gossip on the city-dome's topic. A chat line that carries a file carries only its hash,
  size, name, type and key. The bytes follow on request.

## Where the store sits

```
 avenOS (Chat)          shows a file by URL: /files/<hash>  (img, pdf, video: the browser asks for ranges)
        │
 Service Worker         answers /files/<hash> with Range requests from the Peer-Light (206 Partial Content)
        │
 ── the Peer-Light (or a Peer) ─────────────────────────────────────────────────────────────────────────
 chat / seal            seals a file with its key, announces it on gossip; unseals the ranges it reads
        │                                                   ▲
 aven/DB/store  ◄── iroh-blobs' store API (our adapter) ────┤ fetches missing ranges, verified by bao
   Store contract: blobs, refs, outboards                    │
   backends: S3 · folder (OpenDAL) · OPFS (opfs-sync) · memory
        │
 aven/PEER              iroh endpoint · relay · the door · Router:
                          /iroh-bytes/4 (iroh-blobs)   iroh-gossip (city-dome)   aven/db/1 (ours)
```

## Backends: OpenDAL where it's good, our own on OPFS

Above the contract, everything is the same. Below it, each place gets the driver that suits it:

```
 iroh-blobs ─► adapter ─► Store ─► OpenDAL ─► S3 (Aven Peer) · folder (Alice Peer) · memory (tests)
 iroh-blobs ─► adapter ─► Store ─► opfs-sync ─► OPFS sync access handles (Peer-Lights)
```

- **OpenDAL is only a driver under the store.** It never sits above the contract, and nothing outside `db/store`
  sees its types.
- **opfs-sync replaces OpenDAL on OPFS.** It implements `Store` directly, so the `opendal-opfs` fork, its
  `[patch.crates-io]` and OpenDAL's `services-opfs` feature all go. This also removes OpenDAL's OPFS problems:
  slow small writes, a fresh `File` on every range, and refused reads while a commit races.
- **The outboard and writing in parts** (below) are written once, in the shared layer above the drivers. A driver
  provides only temp file, move, read range, list and delete.

## What the store holds, and what it doesn't

| The store holds | The store does not |
|---|---|
| Blobs: sealed bytes, named by the BLAKE3 hash of exactly those bytes | Plaintext. Sealing happens above it, so the Aven Peer stores, verifies and serves every file without reading it |
| Each blob's **outboard:** its bao tree (about 0.4% of the blob, 16 KiB groups), so any range can be verified | Keys, caps, members or the city-dome's secret |
| Refs: flat names pointing at a blob, changed atomically by compare-and-set (`file-<hash>`, later `doc-<id>`) | What a blob means: file or document, image or movie, its schema or its MIME type |
| A blob written in parts, which appears whole or not at all | Networking. It never dials a peer; iroh-blobs asks it for ranges, and writes it what it fetched |
| The one writer's lock (README rule 1) | Decisions about what to fetch or keep. Those belong to the chat now, and to the engine's sync rules later |

**Keeping and cleaning up.** A blob stays as long as a ref reaches it. A file that should stay gets the ref
`file-<hash>`; deleting the ref lets cleanup remove the blob and its outboard. Cleanup by reachability from refs is a
milestone 4 item. Until then nothing is deleted.

## What changes in the contract

The contract (blobs and refs, compare-and-set, no append) stays. Movies need three additions, each modelled in Lean
(`Aven.DB.Store`) first, with vectors the suite replays on every backend:

1. **Writing in parts.** `put(bytes)` holds a whole file in memory, and a movie of several GB doesn't fit. A writer
   takes the bytes in parts into a temporary file and computes the hash and outboard as it goes. `finish()` moves the
   file into place under its hash: whole or absent, never torn. Abandoning a writer leaves nothing. This isn't append:
   a blob is still written once and never changes.
2. **The outboard.** Each blob is stored together with its bao tree. `get_range` returns verified bytes (bao ranges),
   which closes the line in SANDBOX.md that says "ranges aren't hash-checked yet".
3. **Partial blobs.** A peer that has fetched only a movie's first minutes holds part of a blob. The store records
   which ranges it has, verified, so a seek fetches only what's missing. This is iroh-blobs' own model (a bitfield of
   valid chunks); the store has to keep it.

## The iroh it uses

Versions from crates.io on 30 Oct 2026, pinned exactly as rule 13 requires.

| Crate | Version | Role here |
|---|---|---|
| iroh | 1.4.1, stable | The endpoint, the `Router`, and the door (`after_handshake`). Already in use |
| iroh-relay | 1.4.1, stable | Inside the Aven Peer. Every Peer-Light's bytes come through it, so a movie's throughput is the relay's |
| iroh-gossip | 0.101.0 | The city-dome: chat lines and file announcements. Already in use |
| iroh-blobs | 0.104.0, pre-production by its own README | The protocol `/iroh-bytes/4` and its downloader, reading and writing **our** store through an adapter. Its own redb store is not used |
| bao-tree | 0.17.0 | The outboards and range verification, in the store. It is also the fallback if iroh-blobs doesn't fit: we would speak bao ranges on `aven/db/1` ourselves |
| iroh-io | 0.6.2 | Range readers over `Store::get_range`, the shape bao-tree and iroh-blobs read through |
| irpc | 0.17.0 | Under iroh-blobs' store API. Our adapter answers its requests |

Everything that connects devices is stable 1.x. Everything that moves bytes is still 0.x, and iroh-blobs breaks
about monthly (0.103.0 was yanked; 0.104 hardened bao and range streams). So all of it sits behind one module of
ours, `db/store`'s iroh-blobs adapter, and nothing above the store names an iroh-blobs type.

**The spike decides first:** iroh-blobs on our store through its store API, or bao-tree directly with our own
range requests on `aven/db/1`. It measures both against the same task, a 1 GB movie from Alice Peer to a Peer-Light
through the relay, seeking to the middle. iroh-blobs is the default if its adapter stays small.

## Sealing a file for the city-dome

- **The key.** Convergent within the city-dome (README, "Deduplication follows who may know a file"):
  `key = keyed_hash(city-dome secret, plaintext hash)`. The same file sent twice is stored once, and outsiders,
  the Aven Peer included, can't test a guess.
- **Seekable.** The file is sealed in fixed 64 KiB chunks, each with its own AEAD tag and a nonce derived from its
  index. 64 KiB is four bao groups, so a range read decrypts only the chunks it touches. The blob's hash is over the
  sealed bytes.
- **The announcement:** a gossip message, itself sealed with the city-dome's secret, carrying
  `{hash, size, name, type, key}`. The gossip messages are encrypted, so a member reads the key, and the relay and the
  Aven Peer see only ciphertext.

## How a file travels

1. **Send.** Alice drops a movie into the chat. Her Peer-Light streams it through the sealer into a store writer;
   `finish()` gives the hash. It sets the ref `file-<hash>` and announces the file on the city-dome.
2. **Keep it available.** The Aven Peer hears the announcement and fetches the blob into S3 by its hash, without
   reading it. The file stays reachable when Alice closes her laptop. This is the one storage rule until the engine's
   sync rules exist: the Aven Peer keeps every city-dome file.
3. **Show.** Bob's chat renders `<video src="/files/<hash>">`. The browser asks for ranges, and the Service Worker
   passes each to the Peer-Light. The Peer-Light serves what its store already holds, and otherwise asks iroh-blobs to
   fetch the missing chunks from the Aven Peer or from Alice, verified by bao. It unseals them and answers `206`.
   Images and PDFs take the same path. They're just smaller.
4. **Seek.** Jumping to minute 40 fetches minute 40's chunks, not minutes 1 to 39.

## What this asks of opfs-sync

The OPFS backend ([open question 7](../../SANDBOX.md#open-questions)) is where Peer-Lights keep files, so this design
sets its requirements:

- Range reads straight from a sync access handle. Seeking a movie is many small ranges.
- Blobs written in parts, to a temporary file, then moved into place.
- An outboard file beside each blob, plus the record of which ranges are valid.
- OPFS's quota: a Peer-Light asks for persistent storage (`navigator.storage.persist()`). When the quota runs out, the
  write fails cleanly and its temporary file is removed.

## Open questions

1. **Who gives a member the city-dome's secret?** The invite link already carries a one-time secret. The admin's
   invite could also seal the city-dome's secret to the joiner, which never involves the Aven Peer. Rotation and
   removal wait for caps.
2. **Thumbnails and posters:** a second, small blob the sender makes (the first frame, a reduced image), announced
   with the file, so the chat paints before any range of a movie arrives.
3. **The Service Worker's reach:** it has to answer while the Peer-Light runs in another tab's dedicated worker
   (the Web Lock leader). It asks the leader over the BroadcastChannel.
4. **Limits:** the largest file the chat accepts, and how much of a Peer-Light's OPFS cached files may take before
   the oldest are dropped. A peer's own uploads are kept until the Aven Peer holds them.

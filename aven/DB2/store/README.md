# The store upgrade: files and history in the city-dome

The one spec for avenDB's store and the bytes it moves (the architect, 30 Oct 2026). It merges the opfs-sync thread's
draft (`ARCHITECTURE.md` on `claude/opfs-sync`, scope decided with Samuel that day) with avenONTOLOGY's engine proposal
([`db/engine`](../db/engine/README.md), "What we take from iroh"), and settles where they differed. Where this file and
either draft disagree, this file holds; the engine proposal keeps sync, queries and mutations, and points here for bytes.

**The goal:** files in the chat, and a chat that keeps its history. A member drops an image, a PDF or a movie into the
chat, and every other member sees it at once: the image appears, the PDF opens, the movie plays from any point without
being fully downloaded. A reload keeps the chat. Every kind of file takes the same path, and nothing in the store or on
the wire knows what kind of file it carries.

It comes after milestone 2 ([`MILESTONE2.md`](../MILESTONE2.md)), and replaces its "the chat is in memory"
([`MILESTONE2.md`](../MILESTONE2.md#decisions)).

**Left out on purpose:**
- **Types, schemas and validation** wait for `db/docs` (milestones 4 and 6). A file is bytes plus a name and a MIME type
  its sender claims.
- **Sealing** (Samuel, 30 Oct 2026): chat lines and files are stored and sent as plain bytes. iroh encrypts every
  connection and the door admits only members; what the Aven Peer keeps on Hetzner is not encrypted until sealing
  comes with avenID's caps ([below](#later-sealing)).
- **Caps and per-document keys** wait for milestone 3. Until then the network has one shared room, the **city-dome**
  (until now "the room"). Every member of Maia City is in it.
- **Loro.** The chat's history is a chain of blobs; milestone 4 makes its segments Loro's.

## Local first, never blocking

A rule for every part of the upgrade (Samuel, 30 Oct 2026):

- **Every write lands in the local store and shows at once:** a sent line or a dropped file is in the chat before any
  peer has it.
- **Sending and fetching run in the background:** the UI never waits on the network, and shows what is still on its
  way (sending, fetching, the share fetched).
- **Offline works:** writes queue in the local store, and on reconnect the peer sends them and catches up.
- **Opening and signing in never wait** (Samuel, 30 Oct 2026, from his iPhone: "we shouldn't need to be waiting,
  right?"). A device's own store is its truth (README rule 3):
  - **A returning browser opens at once:** the Peer-Light keeps the network it was told (the ref `network`: whether
    it is claimed, and every statement) and reads it back at start, each statement checked again, so its views and
    its chat's history are on screen before any link. Offline is said in plain words; the reason stays in the
    timeline.
  - **Its lines are chained as they are written:** a store that holds its device's key (a Peer-Light's `device-key`,
    or `chain-key` once a native Peer has learned its head) holds every line that key signed, so the device writes on
    its chain at once and nothing waits in memory (`Aven.DB.Chains.own_store_never_forks`). A key given apart from its
    store (the box's cast, a native Peer's `--secret` with an empty `--store`) still learns its head from the Aven
    Peer first (`learned_never_forks`), and keeps what it writes until then in its store (`queued`).
  - **Signing in is one tap:** the passkey's ceremony is local; the statement it signs is kept (`statement`) and sent
    once the link is up, after a reload too. A brand-new browser can't know its vault before then, so it says it
    joins as soon as it reaches the network.
  - **The link dials again at once** when the page comes back online or into view (`wake`).

## The package

**The store is one package** (Samuel, 30 Oct 2026): the `Store` contract, the iroh-blobs adapter and every backend,
OpenDAL inside it. It moves out of `db/` to **`aven/DB2/store`**; the crate keeps its name, `aven-db-store`. Our OPFS
backend is called **`opfs`**: OpenDAL's OPFS service goes, so it is the only one. `aven/PEER` owns iroh-blobs'
networking (the protocol on the `Router`, the provider gate); the store answers it. The folder moved on 30 Oct
2026 (#1462).

## One of each

| | The one source of truth |
|---|---|
| A blob's name | BLAKE3 of its bytes: one `Hash` type for the store, the docs and iroh-blobs. A blob is a Value at rest ([`db/docs`](../db/docs/README.md)) |
| Where bytes rest | our `Store`, one per peer. iroh-blobs' own store (redb and files) is not used |
| Named pointers | refs, compare-and-set, proven in Lean (`Aven.DB.Store`). iroh-blobs' tags and its garbage collector are not used |
| What keeps a blob | a ref reaching it. Cleanup by reachability is milestone 4's; until then nothing is deleted |
| How bytes move | iroh-blobs' protocol, `/iroh-bytes/4`: verified ranges, resume, hash sequences, several holders at once |
| Their check | bao (`bao-tree`), made by iroh-blobs as it serves and checks a blob |
| How news travels | iroh-gossip on the city-dome's topic: chat lines, file announcements, new heads |

## The layers

```
 avenOS (Chat)        <img>, <video>, <iframe> on /files/<hash>: the browser asks for ranges
        │
 Service Worker       answers /files/<hash> with 206 Partial Content, asking the Peer-Light
        │
 ── the Peer-Light (or a Peer) ─────────────────────────────────────────────────────────────
 city-dome            the chat's lines and files, its chains and catch-up
        │
 aven/DB2/store       Store: blobs and refs  ◄── iroh-blobs' store API, through our adapter
   drivers:           OpenDAL ─► S3 (Aven Peer) · folder (Alice Peer) · memory (tests)
                      opfs ─► OPFS sync access handles (Peer-Lights)
        │
 aven/PEER            iroh endpoint · relay · the door · Router:
                        /iroh-bytes/4 (iroh-blobs)   iroh-gossip (city-dome)   aven/db/1 (ours)
```

- **OpenDAL is only a driver under the store.** Nothing outside the store sees its types.
- **Our `opfs` driver replaces OpenDAL's on OPFS** and implements the driver directly. The `opendal-opfs` fork, its
  `[patch.crates-io]` and OpenDAL's `services-opfs` feature go.
- **iroh-blobs sits behind one module of ours,** the store's adapter. Nothing above the store names an iroh-blobs type:
  it is 0.x and breaks about monthly.

## What the store holds, and what it doesn't

| The store holds | The store never holds |
|---|---|
| Blobs: bytes named by the BLAKE3 hash of exactly those bytes, whole or absent. Plain in v1; sealed above it later, never by it | Keys, caps or members |
| Refs: flat names pointing at a blob, changed by compare-and-set | |
| The one writer's lock (README rule 1) | What a blob means: file or line, image or movie, its MIME type |
| | Networking, or decisions about what to fetch or keep |

## Big files are hash sequences (decided)

The drafts differed: the store draft added writing in parts, outboards and partial blobs to the contract; the engine
proposal kept the contract and split big files. **We split** (the architect, 30 Oct 2026):

- **A file is a hash sequence of chunk blobs.** Each chunk is at most 1 MiB, stored as one ordinary blob. The file's **index** is a blob listing its chunks' hashes in order (iroh-blobs' `HashSeq`), and the
  file is named by the index's hash.
- **The contract stays as it is:** `put` is whole or absent, refs are compare-and-set, nothing appends. No outboards,
  no partial blobs, no writers in parts; `Aven.DB.Store` needs no new state. A movie of several GB never sits in memory:
  the sender puts it a chunk at a time.
- **Seeking fetches chunks:** minute 40 is the chunks minute 40 lies in, each checked whole against its hash when it
  arrives. What a peer holds of a file is which of its chunks it has, which the store already answers.
- **Outboards are made, not kept:** iroh-blobs builds a chunk's bao tree when it serves or checks it (1 MiB is 64
  groups of 16 KiB, about 4 KiB of tree). A blob the store reads from S3 is checked whole against its name, as `get`
  does today. SANDBOX.md's "ranges aren't hash-checked yet" is closed by reading a chunk whole.
- **The cost:** a 1 GB movie is about a thousand objects in S3, and a thousand GETs to fetch it all. Acceptable; the
  spike measures it.
- **Limits** (the security audit, 30 Oct 2026; `Aven.DB.Files`): the largest blob a peer fetches is **1 MiB + 64 KiB**
  (`maxBlob`, a chunk and room for framing), checked before anything is allocated, since the size a holder states
  is its word until bao has checked the last chunk (iroh-blobs 0.104.0 hands it to the store's `import_bao` at once).
  The largest file is **32 GiB** (`maxFile`), whose index, 32 KiB hashes, still fits in one chunk (`index_fits`); a
  `file` line past it is refused as `badFile`.
- **A file is cut as it must be** (`Aven.DB.Files.fits`): every chunk but the last is exactly 1 MiB, the last 1 byte to
  1 MiB. A receiver checks it on fetch (the Aven Peer fetches the index first, refuses one listing more or fewer
  chunks than the line's size needs, then checks every chunk) and on every read; a malformed file is
  `KeepError::Malformed` or `Corrupt`, never a panic, and the Aven Peer doesn't fetch it again.

## Files in the city-dome

- **The announcement** is a gossip message on the city-dome: `{file, size, name, type}`, where `file` is the index's
  hash, signed by the sender's device. It is a `file` line of the sender's chain
  (the city-dome thread's `Aven.DB.Chains`, `aven_db_core::files::Announcement`), signed and kept in history.
- **The same file sent twice is stored once,** by its hash, across the network.

## How a file travels

1. **Send.** Alice drops a movie into the chat. Her Peer-Light puts it chunk by chunk into her store, puts the index,
   sets the ref `file-<index>` and announces the file on the city-dome.
2. **Keep.** The Aven Peer hears the announcement, fetches the index and every chunk into S3, and sets `file-<index>`.
   The file stays reachable when Alice closes her laptop. Until the engine's sync rules exist, this is the one rule:
   **the Aven Peer keeps every city-dome file and line.** A peer keeps its own uploads until the Aven Peer has them.
   Built for files (`peer/native/src/keep.rs`): the Aven Peer, for each `file` line it chains, fetches the whole hash
   sequence from that device, checks its length against the line's size and writes `kept`. A native Peer shares a
   folder (`--files DIR`): each file in it is put, `file-<index>` set, and announced as a `file` line.
3. **Show.** Bob's chat renders `<video src="/files/<index>">`. The browser asks for ranges; the Service Worker passes
   each to the Peer-Light, which reads the chunks it holds and fetches the rest from the Aven Peer or Alice through
   iroh-blobs, and answers `206`. Images and PDFs take the same path. The Service Worker reaches the leader over the
   BroadcastChannel `aven-peer-light:<network>`, as the tabs do. The Peer-Light's file API is three exports, its
   stable API for files: `file_len`, `file_range` (a seek: the chunks a range touches, only those it lacks) and
   `file_fetch` (the whole file).
4. **More holders, faster:** a native Peer fetches chunks from several holders at once. A Peer-Light's bytes all cross
   the relay, so the relay's bandwidth is its limit, however many members hold the file.

## What a file may run

A file's type is what its sender claims, and avenOS's origin holds the device's secret in OPFS, so the Service Worker
([`files-sw.js`](../os/web/public/files-sw.js)) serves `/files/<hash>` as if the bytes were hostile (the security
audit, 30 Oct 2026):

- **Every answer** carries `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox; default-src
  'none'` (with `img-src`, `media-src` and `object-src` only from the origin itself): a document opened from it has an
  opaque origin of its own and runs no script, whatever its bytes.
- **Inline only for passive types:** images but SVG (PNG, JPEG, GIF, WebP, AVIF, BMP), audio, video and PDF. Every
  other type, SVG, HTML and XHTML among them, is served as `application/octet-stream` with `Content-Disposition:
  attachment`: opening it downloads it.
- **The chat shows files only as `<img>`, `<video>` or a PDF's frame,** for those same types; anything else is a
  download link.
- `bun run up --check` holds it in all three engines (`sandbox/inline.mjs`: an HTML page and an SVG, each with a
  script, opened in a tab, framed, embedded and as an image, run nothing on the origin; a control served as HTML by
  the test's own server does), and in the city-dome's chat (`sandbox/dome.mjs`).
- **A PDF previews only where the engine renders one in a sandboxed document;** opening it still works, as a download
  at worst. That is the price of the sandbox, until files move.
- **Files should later move to an origin of their own** (the security fix's recommendation, 30 Oct 2026). The headers
  are defence in depth: one mistake in the allow-list, or an engine's bug in sandboxing, would still run a sender's
  bytes beside the device's secret. A separate origin that holds no secret (as open question 3 asks, the Service
  Worker on the Peer-Light's origin or a files-only one) makes that mistake harmless; until then these headers hold.

## The chat keeps its history

The draft had one ref `chat-city-dome` for everyone's lines. With plain lines the Aven Peer could read and segment
them, but one shared chain would still have many writers racing on one ref, and a forged or replayed line would have
no owner to check it against. **Each device keeps a chain of its own lines** (the architect, 30 Oct 2026), the way
avenDB-old kept each device's changes; this stays when sealing comes:

- **A line is a blob:** the device, its sequence number, the hash of its previous line, the time and the text, signed by
  the device's key. Lines are small, under bao's 16 KiB group.
- **A line's bytes are canonical** (the security audit, 30 Oct 2026): a blob is taken only when it is exactly the
  bytes its fields render to, hex lower-case and of its length, numbers in canonical decimal; anything else is refused
  as `notCanonical`. So one signed line has one blob and one name (`Aven.DB.Chains.one_id`, `signed_one_id`), and
  nobody relaying a line can make a copy with another name that would make the device's real line look like a fork.
  Lines a peer kept before this rule are still read when it starts, and counted (the timeline's `chains` event,
  `notCanonical`): our own code has always written canonical lines.
- **The device's ref `chat-<device>`** points at its newest line. Each device writes only its own store (rule 1).
- **Live:** the line travels on gossip as today, the whole blob, so every peer can keep it and nobody waits for a
  fetch.
- **The Aven Peer keeps every chain:** it stores each line it hears and moves `chat-<device>` forward by
  compare-and-set, only to a line that device signed whose previous line is the current head. Two lines of one device
  with the same previous line are a fork: kept, not chained, and raised (the engine's rule 5: a cloned device, an old
  backup or a stolen key).
- **Catching up:** a returning peer asks the Aven Peer for its `chat-*` refs, walks each chain back from its head to
  what it holds, and fetches the missing lines as one hash sequence. Lines show ordered by time, then device; a line
  received twice is kept once, by its hash.
- **Catching up goes in pages** (the security audit, 30 Oct 2026; `Aven.DB.Wire`): `heads` and `catch_up` name one
  entry per device, and every browser reset adds a device, so in one frame each they passed the wire's 64 KiB at
  about 400 devices. Both go in pages of at most 128 entries (`pageSize`), as `lines` does: a telling of the heads is
  its pages, every one but the last with `more`, so a peer catches up and learns its own head only once it has heard
  them all (`headsPages_more`); a peer names every chain it wants in `catch_up` pages, each `only` for the chains it
  names, which the Aven Peer answers alone (`answer_pages`). No page is empty, so each moves the receiver forward
  (rule 3).
- **Later:** milestone 4 replaces the line format with Loro segments. The shape, a head over blobs, is the
  README's document, so nothing is thrown away, and the old lines stay readable (production keeps its store).

## Later: sealing

Moved to avenID's caps (Samuel, 30 Oct 2026), and kept here so it isn't lost: a room's secret, sealed to each member
device and kept by the Aven Peer under `dome-<device>`; files sealed with a convergent key (`keyed_hash(secret,
BLAKE3(plaintext))`) in 64 KiB AEAD units, so a range opens only what it touches; announcements sealed with the secret.
None of it changes the store, which keeps bytes either way. Lines and files stored plain until then stay readable: the
store is never wiped ([`PRODUCTION.md`](../PRODUCTION.md#no-wiping-in-production)), so sealing applies to what is
written after it.

## What the store asks of the opfs driver

The opfs-sync thread's five questions, answered:

1. **Atomic writes.** Blobs and refs alike: write `tmp/<random>`, flush, then `move()` it into place. Where `move()`
   fails in an engine, copy and delete instead: a blob is checked against its name on every read, so a torn copy is
   found and removed; a ref is exactly its hash's 64 hex digits and a newline in every driver (`Store.refText`), read
   whole and refused as anything else (`Store.readRef`). A browser's store says which avenDB laid it out
   (`meta/version`, `avenDB store 1`): one without exactly that marker is from an older avenOS, and the Peer-Light
   clears its origin and starts fresh as a new device, which signs in again with its passkey (Samuel, 30 Oct 2026:
   browsers may be reset; no migration). The Aven Peer's S3 store is never reset: it has always written refs so. Temporary files are named by
   their place, `tmp/blob-<hash>` and `tmp/ref-<name>`, so a copy torn mid-way loses nothing: opening the store rolls
   every whole one (a blob matching its hash, a ref reading as a valid hash) forward into place and removes the rest (`Aven.DB.StoreCrash`:
   after a crash in any call, in either mode, the store reads as before the call or after it). Measured: `move()`
   replaces an existing file in Chromium 156 and Firefox 157, from a dedicated worker too; WebKit is unknown until
   Samuel's iPhone tries it.
2. **Handles.** Writes open, write, flush and close. Reads keep an LRU of at most 16 open read handles (a movie seeks
   in one chunk many times), all closed when the leader gives up its lock. A takeover waits for the lock, so the old
   worker's handles are gone; a `NoModificationAllowedError` is retried for up to 2 s, then fails with the reason
   shown (`net.trouble`).
3. **The leader.** Sync access handles exist in a dedicated worker in every engine, in a SharedWorker only in WebKit,
   so **one path everywhere:** each tab may start a dedicated worker, and the one holding the Web Lock
   `aven-peer-light:<network>` (per origin) runs the Peer-Light. Today's port protocol (start, box, ask, send, say,
   post, line replay, views, `start?`) moves unchanged onto the BroadcastChannel of the same name, every request with
   an id; a follower resends its unanswered requests to a new leader. `ask`s go through the leader, the one wasm with
   state. Frames are tabs. The SharedWorker goes.
4. **Lean and the suite.** `Aven.DB.Store` keeps its state (blobs whole or absent, refs compare-and-set) and gains a
   crash between the temporary file and the move: what was moved is whole, the rest is swept. A change of leader is
   a change of the one writer, under the lock: modelled as one writer at a time. The suite runs in a dedicated worker
   only (the page run goes), in all three engines. The first gate, 200 writes of 4 KiB under 250 ms, came from
   in-place writes; one file per blob can't meet it (opening a sync access handle costs 1.7 to 23 ms). **Decided (the
   architect, 30 Oct 2026): this upgrade ships one file per blob**, and the gate is the real workload, per engine
   (`store/opfs/run.mjs`): a chat line (one blob and one ref) and a 1 MiB chunk put, medians of 50, and catch-up of
   500 lines. Writes run in the background (local first), and catch-up shows lines as they land.

   | | chat line | 1 MiB chunk | catch-up of 500 lines |
   |---|---|---|---|
   | gate: Chromium and WebKit | 60 ms | 30 ms | 10 s |
   | gate: Firefox | 150 ms | 100 ms | 30 s |
   | measured, Chromium 156 | 20 ms | 21 ms | 4.2 s |
   | measured, WebKit 27.2 | 13 ms | 24 ms | 2.2 s |
   | measured, Firefox 157 | 78 ms | 42 ms | 14.7 s |

   Refs and temporary files are read through `getFile()`, retried when a move replaces the file, since a reader's sync
   handle would block that move. Lines stay one blob each until Loro's segments (milestone 4): a line's hash is its
   name and is what's signed.
5. **Scope.** In: the Service Worker's bridge to the leader (the BroadcastChannel, `os/web/peer`); the fork,
   `[patch.crates-io]` and `services-opfs` removed; the device's secret moved into the store;
   the leader and its takeover in `up --check` (close the leader's tab, a follower takes over within 5 s, and a chat
   line still arrives). OPFS quota: the Peer-Light asks `navigator.storage.persist()`, and a write over quota fails
   cleanly with its temporary file removed. Out: real iOS. The box's WebKit has OPFS with a profile directory
   (`launchPersistentContext`), and the suite passes there; Safari itself, and iOS 15.2–25, are confirmed on Samuel's
   iPhone until the macOS runner's smoke test exists.

## Next: pack files

The next store step, on this upgrade's evidence (the architect, 30 Oct 2026): Firefox pays about 23 ms for every
`createSyncAccessHandle()`, twice per chat line, and the same engines write 200 × 4 KiB into one open file in 10 to
102 ms. Packs keep a few files open and append to them, so a write costs a write, not a file. Not built in this
upgrade; the contract, the suite and the gates stay, and the opfs driver changes underneath.

- **Blobs in packs.** A blob is appended to the open pack as one record: a header (its hash, its length, a checksum of
  the header) and its bytes. A pack closes at a size (64 MiB, to measure) and a new one opens. Big chunks may stay one
  file each: a 1 MiB chunk already costs one handle per MiB, which is cheap; the line is measured, not guessed.
- **Refs in a log.** Every `set_ref` and `delete_ref` appends a record (name, old, new or none, checksum) to the refs
  log; the newest record of a name is its value. Compare-and-set still runs under the one writer's lock.
- **The index is rebuilt on open,** by reading every pack's headers and the refs log, and kept in memory: hash →
  (pack, offset, length), name → hash. Reads are ranges of an open pack's handle.
- **A torn tail is cut by checksum:** a crash leaves at most the last record of a pack or of the log partly written;
  opening finds the first record whose header or checksum fails and truncates there. A blob's bytes are also checked
  against its hash on read, as now.
- **Deletes are tombstones** (a record naming the hash); `list` and `has` skip them. **Compaction comes later:** a pack
  mostly tombstoned is rewritten to a new one, then the old one removed, the index switched under the lock.
- **Lean first:** a model of the log (records appended, a torn tail) beside `Aven.DB.Store`, with the theorem that
  replaying any prefix of the bytes written, cut at its first bad record, gives the store before or after the last
  call, the same shape as `crash_atomic`; then Rust's crash tests (every byte offset a crash point), then the driver.
- **Gates:** the same workload, every engine held to 60 ms, 30 ms and 10 s, Firefox included.

## The iroh it uses

Pinned exactly (rule 13), checked on crates.io on 30 Oct 2026:

| Crate | Version | Role |
|---|---|---|
| iroh, iroh-relay | 1.4.1 | the endpoint, the `Router`, the door, the relay every Peer-Light's bytes cross. In use |
| iroh-gossip | 0.101.0 | the city-dome's topic. In use |
| iroh-blobs | 0.104.0, pre-production by its own README | `/iroh-bytes/4`, hash sequences, the downloader; on our store through the adapter. Its provider events (`connected`, `get`, `push`) are a second gate after the door: members only, push off |
| bao-tree | 0.17.0 | under iroh-blobs; the adapter makes outboards with it |
| irpc | 0.17.0 | under iroh-blobs' store API, which the adapter answers |

## iroh-blobs on the store (decided)

**The spike decided** (the architect, 30 Oct 2026): iroh-blobs on our store, through one adapter
([`src/blobs`](src/blobs)), over `bao-tree` directly with our own range requests. Both were measured in the box on one
task: a 1 GiB file of 1024 chunks moving from Alice Peer's endpoint to a relay-only endpoint with Bob's Peer-Light's
key, through the Aven Peer's relay and nothing else, then a seek to its middle. Our crates at the box's dev profile.

| | (a) iroh-blobs + adapter | (b) bao-tree directly |
|---|---|---|
| 1 GiB through the relay, Alice on a folder | **201 MB/s** | 188 MB/s, 4 requests in flight |
| 1 GiB through the relay, from the box's S3 | 139 MB/s | 152 MB/s |
| Seek to the middle, cold (index and chunk), folder / S3 | **10.6 / 11.5 ms**, one request | 14.0 / 18.4 ms, two requests |
| Seek, warm (index held), folder / S3 | 8.3 / 12.9 ms | 6.6 / 10.3 ms |
| S3 GETs: the whole file / a cold seek / a warm one | 1058 / 3 / 2 | 1025 / 2 / 1 |
| Lines, without comments | 215 | 113 |
| wasm added, release after wasm-bindgen (gzip) | +1.09 MB (+314 KB) | +0.40 MB (+134 KB) |

(b) would have had to grow what (a) has: resume and fetching only what is missing, several holders at once, the
downloader, provider events for the gate, and one request for an index and any of its chunks, which saves a round trip
on every cold seek. Since the spike, the adapter keeps the last indexes it read and reads a file's next chunk ahead
while its chunks go out in order: 1025 / 2 / 1 GETs, as (b) (`tests/blobs.rs` holds it).

**How the adapter works:** an actor answering 6 of the 23 requests of iroh-blobs' store API (observe and status by
`size`, the exports of bao and of plain ranges, the import of bao, listing); tags, temp tags' protection and deletes
answer "unsupported" or nothing, since refs and reachability keep blobs. A fetched blob is buffered until every byte has
arrived, checked by iroh-blobs, then put once: whole or absent. In a browser the store is neither `Send` nor `Sync` and
iroh's protocol handlers must be, so the store lives in the actor's own task and only channels cross.

**The risk we take:** iroh-blobs has no public constructor for a store of someone else's (`api::Store::from_sender` is
crate-private). The adapter builds one with `RefCast` from the `irpc::Client` the type wraps, which it derives publicly.
A 0.x release may take that away: iroh-blobs stays pinned at exactly 0.104.0, and `tests/blobs.rs`'s
`iroh_blobs_runs_on_our_store` fails at once if it stops working.

## Lean first

`Aven.DB` grows, with vectors every implementation replays (README, rule 10):

- **Files:** a file's index and chunks; a range read takes exactly the chunks it touches. Vectors `files.json`.
- **Chains:** a device's chain, the Aven Peer's forward-only move of `chat-<device>`, forks detected, catch-up ends
  with every line both peers can see. Traces `chats.json`.
- **The store:** the crash between the temporary file and the move.

## How it is checked

`bun run up --check` grows. Its `files` step is ready (`sandbox/files.mjs`, `shares` in `up.mjs`) and joins the check
once files are announced as chain lines: Alice Peer shares a 200 MiB file from its folder; Bob's Peer-Light, in a page
of its own after the main check, seeks to the middle from Alice (64 KiB, checked, having fetched one chunk and the
index: 1.05 MB in 0.6 s), the Aven Peer keeps the file (2.3 s), Alice Peer stops, and Bob's Peer-Light fetches the
rest from the Aven Peer (199 MiB from S3 into OPFS through the relay: 17 s). Measured in a whole `up --check` on
30 Oct 2026, with an interim announcement in place of the chain line. Then:

1. Alice sends a line, an image, a PDF and a 200 MB movie into the city-dome; Bob's Peer-Light shows the line and the
   image, opens the PDF, and plays the movie from its middle having fetched less than a quarter of it;
2. Alice's Peer-Light closes; Bob still plays the whole movie, from the Aven Peer;
3. Bob reloads and finds the whole chat, in order; a third browser that joins later finds it too;
4. the Aven Peer's S3 holds every chunk and line; Bob, offline, sends a line that shows at once and arrives on
   reconnect;
5. a forked chain is raised; a line signed by no member's device is dropped;
6. the leader's tab closes, a follower takes over, and the chat goes on.

`bun run lanes` adds the movie to its probe: the time to first frame per lane.

## Threads

1. **opfs-sync** (session_01E9zxn44sLhsYn1LTSeusWt, the store's `opfs` driver, `os/web/peer`): the folder move (landed,
   #1462), then the driver, the leader, the Service Worker's bridge and the check's takeover step, as answered above.
2. **iroh-blobs:** the spike (decided: iroh-blobs), the adapter and hash sequences in the store, `size` in the
   contract, the provider gate in `peer/native`, the Aven Peer's keep rule and `--files`, the Peer-Light's file API and
   the check's `files` step, which turns on with city-dome's `file` lines.
3. **city-dome:** Lean (files, chains), the chains and catch-up, files and history in avenOS's Chat, and the Service
   Worker answering `/files/<hash>`. Starts once the spike has decided, on the
   transport it chose; its Lean starts at once.

## Open questions

1. **Thumbnails and posters:** a second, small blob the sender makes, announced with the file, so the chat paints
   before a movie's first chunk arrives.
2. **Limits:** the largest file is 32 GiB ("Big files are hash sequences"); still open, how much of a Peer-Light's OPFS
   cached chunks may take before the oldest go.
3. **Where the Service Worker lives** with a Peer-Light on its own origin (README): on the Peer-Light's origin, with
   avenOS's media elements pointing there, or on avenOS's own, relaying through the page.
4. **Catching up moves a ref per line** (city-dome, 30 Oct 2026): a Peer-Light taking ~70 lines into an empty OPFS
   takes 2 to 3 s, each line a put and a compare-and-set of `chat-<device>`. Moving each chain's ref once per page of
   `lines` would cut it; measured again once the `opfs` driver is in.

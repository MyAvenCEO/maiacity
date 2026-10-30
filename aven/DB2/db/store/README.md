# The store upgrade: files and history in the city-dome

The one spec for avenDB's store and the bytes it moves (the architect, 30 Oct 2026). It merges the opfs-sync thread's
draft (`ARCHITECTURE.md` on `claude/opfs-sync`, scope decided with Samuel that day) with avenONTOLOGY's engine proposal
([`db/engine`](../engine/README.md), "What we take from iroh"), and settles where they differed. Where this file and
either draft disagree, this file holds; the engine proposal keeps sync, queries and mutations, and points here for bytes.

**The goal:** files in the chat, and a chat that keeps its history. A member drops an image, a PDF or a movie into the
chat, and every other member sees it at once: the image appears, the PDF opens, the movie plays from any point without
being fully downloaded. A reload keeps the chat. Every kind of file takes the same path, and nothing in the store or on
the wire knows what kind of file it carries.

It comes after milestone 2 and before milestone 3 ([README](../../README.md#milestones)), and replaces milestone 2's
"the chat is in memory" ([`MILESTONE2.md`](../../MILESTONE2.md#decisions)).

**Left out on purpose:**
- **Types, schemas and validation** wait for `db/docs` (milestones 4 and 6). A file is bytes plus a name and a MIME type
  its sender claims.
- **Caps and per-document keys** wait for milestone 3. Until then the network has one shared, encrypted room, the
  **city-dome** (until now "the room"). Every member of Maia City is in it, and all members share its secret.
- **Loro.** The chat's history is a chain of sealed blobs; milestone 4 makes its segments Loro's.

## One of each

| | The one source of truth |
|---|---|
| A blob's name | BLAKE3 of its bytes: one `Hash` type for the store, the docs and iroh-blobs |
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
 city-dome            seals and unseals lines and files; keeps the chat's chains; holds the secret
        │
 db/store             Store: blobs and refs  ◄── iroh-blobs' store API, through our adapter
   drivers:           OpenDAL ─► S3 (Aven Peer) · folder (Alice Peer) · memory (tests)
                      opfs-sync ─► OPFS sync access handles (Peer-Lights)
        │
 aven/PEER            iroh endpoint · relay · the door · Router:
                        /iroh-bytes/4 (iroh-blobs)   iroh-gossip (city-dome)   aven/db/1 (ours)
```

- **OpenDAL is only a driver under the store.** Nothing outside `db/store` sees its types.
- **opfs-sync replaces OpenDAL on OPFS** and implements the driver directly. The `opendal-opfs` fork, its
  `[patch.crates-io]` and OpenDAL's `services-opfs` feature go.
- **iroh-blobs sits behind one module of ours,** `db/store`'s adapter. Nothing above the store names an iroh-blobs type:
  it is 0.x and breaks about monthly.

## What the store holds, and what it doesn't

| The store holds | The store never holds |
|---|---|
| Blobs: sealed bytes, named by the BLAKE3 hash of exactly those bytes, whole or absent | Plaintext. Sealing happens above it, so the Aven Peer stores, checks and serves every file without reading it |
| Refs: flat names pointing at a blob, changed by compare-and-set | Keys, caps, members, or the city-dome's secret in the clear |
| The one writer's lock (README rule 1) | What a blob means: file or line, image or movie, its MIME type |
| | Networking, or decisions about what to fetch or keep |

## Big files are hash sequences (decided)

The drafts differed: the store draft added writing in parts, outboards and partial blobs to the contract; the engine
proposal kept the contract and split big files. **We split** (the architect, 30 Oct 2026):

- **A file is a hash sequence of chunk blobs.** Each chunk is at most 1 MiB of plaintext, sealed, and stored as one
  ordinary blob. The file's **index** is a blob listing its chunks' hashes in order (iroh-blobs' `HashSeq`), and the
  file is named by the index's hash.
- **The contract stays as it is:** `put` is whole or absent, refs are compare-and-set, nothing appends. No outboards,
  no partial blobs, no writers in parts; `Aven.DB.Store` needs no new state. A movie of several GB never sits in memory:
  the sender seals and puts it a chunk at a time.
- **Seeking fetches chunks:** minute 40 is the chunks minute 40 lies in, each checked whole against its hash when it
  arrives. What a peer holds of a file is which of its chunks it has, which the store already answers.
- **Outboards are made, not kept:** iroh-blobs builds a chunk's bao tree when it serves or checks it (1 MiB is 64
  groups of 16 KiB, about 4 KiB of tree). A blob the store reads from S3 is checked whole against its name, as `get`
  does today. SANDBOX.md's "ranges aren't hash-checked yet" is closed by reading a chunk whole.
- **The cost:** a 1 GB movie is about a thousand objects in S3, and a thousand GETs to fetch it all. Acceptable; the
  spike measures it.

## Sealing for the city-dome

- **The secret:** 32 random bytes, the city-dome's. Who holds it: [below](#the-city-domes-secret).
- **A file's key is convergent within the city-dome** (README, "Deduplication follows who may know a file"):
  `key = keyed_hash(secret, BLAKE3(plaintext))`. The same file sent twice is stored once; outsiders, the Aven Peer
  included, can't test a guess.
- **Seekable:** each 1 MiB chunk is sealed as 16 units of 64 KiB, each with its own AEAD tag (XChaCha20-Poly1305) and
  a nonce derived from the chunk's and the unit's index. A range read opens only the units it touches.
- **The index is not secret:** it lists hashes of sealed chunks, so the Aven Peer can fetch a whole file by it without
  reading anything.
- **The announcement** is a gossip message sealed with the secret: `{file, size, name, type, key}`, where `file` is the
  index's hash. The relay and the Aven Peer see its sender and its `file` (the plaintext header the Aven Peer needs to
  keep it, below), never the rest.

## How a file travels

1. **Send.** Alice drops a movie into the chat. Her Peer-Light seals it chunk by chunk into her store, puts the index,
   sets the ref `file-<index>` and announces the file on the city-dome.
2. **Keep.** The Aven Peer hears the announcement, fetches the index and every chunk into S3, and sets `file-<index>`.
   The file stays reachable when Alice closes her laptop. Until the engine's sync rules exist, this is the one rule:
   **the Aven Peer keeps every city-dome file and line.** A peer keeps its own uploads until the Aven Peer has them.
3. **Show.** Bob's chat renders `<video src="/files/<index>">`. The browser asks for ranges; the Service Worker passes
   each to the Peer-Light, which reads the chunks it holds and fetches the rest from the Aven Peer or Alice through
   iroh-blobs, opens the units the range touches and answers `206`. Images and PDFs take the same path.

## The chat keeps its history

The draft let each peer, the Aven Peer too, collect lines into segments under one ref `chat-city-dome`. The Aven Peer
can't read the lines, so it can't make segments, and one shared ref would have many writers. **Each device keeps a chain
of its own lines** instead, the way avenDB-old kept each device's changes:

- **A line is a blob:** a plaintext header (the device, its sequence number, the hash of its previous line, the time)
  and the sealed text, the whole signed by the device's key. Lines are small, under bao's 16 KiB group.
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
- **Later:** milestone 4 replaces the line format with Loro segments. The shape, a head over sealed blobs, is the
  README's document, so nothing is thrown away, and the old lines stay readable (production keeps its store).

## The city-dome's secret

The Aven Peer must never hold it in the clear, and every member's device must get it, including a new member's first
browser and an existing member's second one. Decided:

- **Sealed copies:** for each member device, the secret sealed to that device's key (X25519 from its Ed25519 key,
  sealed box), stored by the Aven Peer as a blob under the ref `dome-<device>`. A device reads its own copy whenever it
  starts.
- **Founded once:** the first admin device to start after the upgrade finds no ref `city-dome`, makes a secret, and
  sets `city-dome` (a commitment, `keyed_hash(secret, "city-dome")`) from nothing by compare-and-set. A second device
  racing it loses the compare-and-set and waits for its copy. Production's admin is the first: Samuel's browser founds
  it.
- **Handed on by holders:** any device that holds the secret seals a copy to each member device the tree names that
  has no `dome-<device>` yet, whenever it sees one. An invite also carries it sealed to the invite's one-time key, so a
  joiner reads the chat at once.
- **Rotation and removal** wait for caps (milestone 3): until then a removed member keeps what it could read.

## What the store asks of opfs-sync

The opfs-sync thread's five questions, answered:

1. **Atomic writes.** Blobs and refs alike: write `tmp/<random>`, flush, then `move()` it into place. Where `move()`
   fails in an engine, copy and delete instead: a blob is checked against its name on every read, so a torn copy is
   found and removed; a ref is 64 bytes, read whole and refused unless it is a valid hash. The store sweeps `tmp/` when
   it opens.
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
   only (the page run goes), in all three engines, and the bench becomes a gate: 200 writes of 4 KiB under 250 ms in
   each engine (measured 4 to 45 ms).
5. **Scope.** In: the fork, `[patch.crates-io]` and `services-opfs` removed; the device's secret moved into the store;
   the leader and its takeover in `up --check` (close the leader's tab, a follower takes over within 5 s, and a chat
   line still arrives). OPFS quota: the Peer-Light asks `navigator.storage.persist()`, and a write over quota fails
   cleanly with its temporary file removed. Out: real iOS. The box's WebKit on Linux has no OPFS at all, so Safari is
   confirmed on Samuel's iPhone until the macOS runner's smoke test exists.

## The iroh it uses

Pinned exactly (rule 13), checked on crates.io on 30 Oct 2026:

| Crate | Version | Role |
|---|---|---|
| iroh, iroh-relay | 1.4.1 | the endpoint, the `Router`, the door, the relay every Peer-Light's bytes cross. In use |
| iroh-gossip | 0.101.0 | the city-dome's topic. In use |
| iroh-blobs | 0.104.0, pre-production by its own README | `/iroh-bytes/4`, hash sequences, the downloader; on our store through the adapter. Its provider events (`connected`, `get`, `push`) are a second gate after the door: members only, push off |
| bao-tree | 0.17.0 | under iroh-blobs; the fallback below |
| irpc | 0.17.0 | under iroh-blobs' store API, which the adapter answers |

**The spike decides first:** iroh-blobs on our store (its store API is an actor of 23 requests; `readonly_mem.rs`, 424
lines, is its starting point for a custom store, and transfer needs only import, export, status and observe), or
`bao-tree` directly with our own range requests on `aven/db/1`. Both are measured on one task: a 1 GB movie from Alice
Peer to a Peer-Light through the relay, seeking to the middle, in the box. iroh-blobs wins if its adapter stays small.

## Lean first

`Aven.DB` grows, with vectors every implementation replays (README, rule 10):

- **Files:** a file's index and chunks; sealing and opening a range (opens exactly the units it touches); convergent
  keys (the same plaintext and secret give the same file). Vectors `files.json`.
- **Chains:** a device's chain, the Aven Peer's forward-only move of `chat-<device>`, forks detected, catch-up ends
  with every line both peers can see. Traces `chats.json`.
- **The secret:** founded at most once; every member device the tree names gets a copy once a holder has seen it; the
  Aven Peer's refs never hold it unsealed. Traces `domes.json`.
- **The store:** the crash between the temporary file and the move.

## How it is checked

`bun run up --check` grows:

1. Alice sends a line, an image, a PDF and a 200 MB movie into the city-dome; Bob's Peer-Light shows the line and the
   image, opens the PDF, and plays the movie from its middle having fetched less than a quarter of it;
2. Alice's Peer-Light closes; Bob still plays the whole movie, from the Aven Peer;
3. Bob reloads and finds the whole chat, in order; a third browser that joins later finds it too;
4. the Aven Peer's S3 holds every chunk and line, and none of it opens with anything the Aven Peer has;
5. a forked chain is raised; a line signed by no member's device is dropped;
6. the leader's tab closes, a follower takes over, and the chat goes on.

`bun run lanes` adds the movie to its probe: the time to first frame per lane.

## Threads

1. **opfs-sync** (session_01E9zxn44sLhsYn1LTSeusWt, `db/store/opfs*`, `os/web/peer`): the driver, the leader and the
   check's takeover step, as answered above. Starts now.
2. **iroh-blobs:** the spike, then the adapter and hash sequences in `db/store`, the provider gate in `peer/native`.
   Starts now; reports the spike's numbers before the adapter.
3. **city-dome:** Lean (files, chains, the secret), sealing, the chains and catch-up, the secret's copies and the
   invite's, files and history in avenOS's Chat and the Service Worker. Starts once the spike has decided, on the
   transport it chose; its Lean starts at once.

## Open questions

1. **Thumbnails and posters:** a second, small blob the sender makes, announced with the file, so the chat paints
   before a movie's first chunk arrives.
2. **Limits:** the largest file the chat accepts; how much of a Peer-Light's OPFS cached chunks may take before the
   oldest go.
3. **Where the Service Worker lives** with a Peer-Light on its own origin (README): on the Peer-Light's origin, with
   avenOS's media elements pointing there, or on avenOS's own, relaying through the page.

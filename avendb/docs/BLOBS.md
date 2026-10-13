# Blobs: one content-addressed backend for edits and files of any size

Samuel's ask (2026-10-13, 07:34 to 07:36): read how iroh is meant to be used, then put an object storage backend under
avenDB the iroh-native, content-addressed way, so that avenDB streams files of several terabytes and can later carry
Studio's media in place of its hand-built iroh backend; and "it should stay the unified backend for normal db data and
blobs". Writes are always local-first: the server only relays, syncs and keeps backups, so it never needs fast writes.
This file is the design as it is built, phase by phase. The research behind it is in
`/mnt/project-files/avendb/blob-backend/` (`iroh-architecture.md`, `object-storage-and-encryption.md`,
`current-code.md`). The legacy media vault in `vault/` is not part of it and is never migrated.

## In short

1. **Everything is a blob.** Each node keeps one iroh-blobs store. A signed edit is a small blob, a file is one big
   blob or a few, and a page of a log is a HashSeq of edits. Every byte that moves between devices is verified against
   its BLAKE3 hash as it arrives, by iroh-blobs, before anything else reads it.
2. **Two protocols.** `avendb/sync/1` says who may have what and what each side lacks (hellos, frontiers, caps).
   `/iroh-bytes/4` moves the bytes, ranges of them included. The first decides, the second carries.
3. **Ids stay what they are.** An edit keeps its SHA-3 id, which its signatures cover; the BLAKE3 hash of its bytes is
   only how it travels and is stored.
4. **Files are sealed before they become blobs** (below). Whoever keeps or relays them, the server and the bucket
   included, holds ciphertext it can verify but not read.
5. **An edit names the files it brings**: each file's root hash and size in the clear, its key and length inside the
   edit's encrypted body. Whoever may fetch the edit may fetch its files; nothing else may.
6. **One source of truth per place** (Samuel, 2026-10-13). In a browser it is OPFS: every blob the page holds, edits,
   keys and file pieces alike, lives there, IndexedDB goes (its data moves over once), and the store runs in a Web
   Worker, where OPFS has its fast synchronous files. Of a big file a browser keeps only the pieces it watched or
   pinned. On the server it is the S3 bucket: small blobs in packs, each piece of a big file as one object, every
   outboard, read in ranges and never copied whole. The server's disk is only a cache of recent and needed pieces: it
   can be wiped at any time and the server rebuilds from the bucket.
7. **Nothing counts as kept until the bucket holds it** (Samuel, 2026-10-13). The server announces an edit in its
   frontier, and says it keeps a file, only once the edit's pack or every piece of the file is in the bucket. Bytes it
   has taken and not yet uploaded are neither counted nor announced, so no device can think the server keeps what it
   could still lose: the device that wrote them sees the server's frontier lack them, marks them not backed up yet,
   keeps the file's pieces, and announces them again until the server's frontier covers them.
8. **Caps say who may have what; sync rules say what each device wants of it** (Samuel, 2026-10-13). A rule is a
   signed edit with the same selector a cap has, for any data; the stewards mark the entries it picks, and every peer,
   the server too, sends a device only what it may have and wants, from the marks alone (below).

## Sealed blob, version 1

The format in which every file is kept and moved. It is normative: `crates/avendb/src/sealed.rs` builds it, and the
vectors at the end of this section pin its bytes, so a file sealed today opens in every later version.

**Key.** Each file has its own key, 32 bytes from the device's cryptographic randomness, never derived from what the
file holds: two vaults that hold the same film hold two unrelated blobs, and nothing about a file can be learned by
sealing a guess of it. The segments are sealed under the file's payload key, cSHAKE256 of the file key with the
customization string `avenDB 2026-10-08 blob payload` and an empty function name, 32 bytes out (`hash::keyed`).

**Segments.** The plaintext is cut into segments of 65,520 bytes; the last one holds what is left and may be shorter,
and an empty file has one empty segment. Each segment is sealed with ChaCha20-Poly1305, with no associated data, under
the 12-byte nonce

```
00 00 00 | segment number, u64 big-endian (8 bytes) | 01 for the file's last segment, else 00
```

counted from 0 across the whole file, not within a piece. A sealed segment is its ciphertext then its 16-byte tag:
65,536 bytes, four of iroh-blobs' 16 KiB chunk groups, so a reader that seeks fetches whole segments and nothing more.

**Pieces.** 16,384 sealed segments make a piece, 1 GiB; the last piece holds the rest. A piece is a blob. A file of
one piece is named by that blob's hash; a file of several by the hash of an iroh HashSeq of its pieces' hashes, in
order. A 4 TB film is 3,727 pieces, and its sealed bytes are 0.024 % more than its own.

**No header.** The pieces carry nothing but sealed segments. The edit that brings a file carries, inside its encrypted
body, the file key, the plaintext length and the format version; in the clear it carries the root hash and the
sealed size, so a node that keeps the file without its key knows what to fetch and how much.

**Reading a range.** The segments that hold plaintext bytes `a..b` are `a / 65,520` to `(b - 1) / 65,520`; segment `i`
lies in piece `i / 16,384` at byte `(i mod 16,384) × 65,536`. The reader fetches those ranges from those pieces
(`Shape::sealed_ranges`), iroh-blobs verifies them against the root, and the reader opens them from the first segment
on (`open`), each under its own nonce.

**What it guarantees.**

- A changed byte, a swapped, reordered or dropped segment, a segment from another file or under another key: none of
  them opens. A segment opens only at its own number, and only the last segment opens as the last, so a file cut short
  at a segment's edge is refused too.
- The format is post-quantum as it stands: a 256-bit symmetric key and SHA-3 for every derivation; Grover's search
  leaves 128 bits.
- Nonces never repeat: a key seals one file, once, and a file never changes. An edit that changes a file brings a new
  file under a new key.
- ChaCha20-Poly1305 does not commit to its key, and it need not here: a file's key and its root hash travel in the
  same signed edit, so every reader opens the same bytes with the same key.

**What it does not hide.** A file's exact length can be read off its sealed size. Padding to a size class can come
later as a version 2, if Samuel wants it; version 1 keeps what it has.

**Vectors.** For file key `k` (32 bytes, each `k`) and plaintext byte `j` = `j mod 251`, the cSHAKE256 hash with the
customization string `avenDB 2026-10-08 sealed blob vector` of the whole sealed file:

| Key byte | Plaintext bytes | Hash |
|---|---|---|
| 0 | 0 | `2854affd64d8e049c943ecd944123c27c3f1a6bad10ec3225fbf3471c42fa5f2` |
| 1 | 1 | `de075b609d3968aa72fc42bb328eda13427de6a8a5d47a53141f80c430d104ce` |
| 2 | 65,520 | `c0ec11cb6234daac69669e4a602131837f557623a8436787d5f7c09a81f7a136` |
| 3 | 131,045 | `97fe5323a1b2b5e121a5503b01d423f925cf994b59da8833230339e78a820e2f` |

The ChaCha20-Poly1305 layer was checked once against Python's `cryptography`: the payload key of key byte 2 and the
nonce above seal the same first segment.

## Writes that bring files

A file enters avenDB with a write of the entry it belongs to (`Lab::bring`): a photo in a note, a film in a Files
entry. The write names each file in the clear by its root and sealed size (`sealed::FileRoot`), smallest root first,
and its encrypted body holds each file's key and plaintext length (`sealed::Brought`), so the file's key reaches
exactly the entry's readers, and moves on as the entry's key does. The file's own bytes never pass through the write.

- **Its bytes.** A write that brings files has a tag of its own (14, beside 9 for every other write), with its files
  just before its body; a body holds its files last, and only when it brings some. So every edit and every body
  written before files keeps its bytes and its id, and each still has one encoding.
- **Who may fetch a file** (T27, `Lean: T27_files_follow_their_edits`): a peer hands a device a file only if it sends
  that device a write that brings it, of an entry the device may receive by the peer's view (`sync::may_fetch`,
  `Lab::may_fetch_file`). So a read cap fetches and opens, backup fetches the ciphertext and opens nothing, relay
  fetches nothing (T26), and a file named nowhere a device may look never reaches it. The sync vectors hold the Rust
  gate to the model's answers.
- **Who opens it.** A device takes a file's key only from a write it opened that names the file in the clear, and only
  with the length its sealed size says (`Lab::file`). What a node keeps, whether it reads them or not, is every file
  the edits it holds bring (`Lab::files`).

## Stores (B2a)

Each node keeps one iroh-blobs store, beside its store of edits (`avendb-net`, `files.rs`): on disk in its store's
folder, `blobs/`, on a machine (the Mac app, the server), and in memory for a node without a folder, a page's among
them until its file pieces move into OPFS (B2d). The McEliece keys a node offers and the sealed pieces of files live
in it together.

- **Bringing a file** (`Node::store_file`): the node draws a new key, seals the file as it reads it, and streams each
  piece into the store, which hashes it as it comes, so a file of any size passes through a few segments of memory.
  The root is the one piece's hash, or the hash of the HashSeq of the pieces' hashes; the store keeps it under a tag
  of its own, and the app brings it with a write (`Lab::bring`).
- **Reading a range** (`Node::read_file`): the key and length come from the write the device opened (`Lab::file`); the
  node takes the sealed segments that hold the range from its own store, or else fetches just those, verified, from
  the first peer it is connected to that hands them over, keeps them, and opens them. A second read of them stays
  local.
- **Keeping files** (`Options::keep`, `Lab::kept_files`): a node fetches whole the files its device's sync rules say
  to keep (below), and where its device has no rule over a vault, every file of that vault if it keeps files, as the
  server does: its HashSeq first and then each piece, as soon as it learns of it. It tries a file no peer hands over
  again after `retry`, then twice as long each time, up to a minute. It drops no file it kept; that comes with the
  bucket (B3), once nothing counts until the bucket holds it.
- **The gate** (`blobs::gate`): every request names one blob, never a HashSeq with its children, and the gate weighs
  each hash a peer asks for: a McEliece key the device may fetch (`Lab::may_fetch`), or a file's root or one of its
  pieces, which the device may fetch if it may fetch the file (`Lab::may_fetch_file`, T27). A blob that merely holds
  hashes hands out none of them by itself.

`tests/files.rs` runs it over loopback iroh: Alice's Mac brings a photo into Welcome and a scan into Onboarding; the
server keeps both on disk, opens neither, and still holds them once started again; Carol, who may read Welcome alone,
reads ranges of the photo through the server with Alice's Mac gone, holding only the segments she read; nobody
fetches a file no edit they may receive brings, nor a HashSeq with its children. A test run by hand writes a file of
two pieces, a gigabyte and a megabyte: Alice's Mac sealed and stored it in 5 s, the server kept it whole 6 s later,
and Carol read across the two pieces.

## Sync rules (B2c)

Samuel, 2026-10-13: caps and sync rules are one concept, generic for any data, and peer to peer; nothing about proxies
or any other kind of data is in the protocol.

- **A cap says who may have what; a sync rule says what one device wants of it.** A rule (`policy::SyncRule`) names a
  device of the vault that sets it, the vault whose entries it is about, and a selector, the very selector a cap
  carries: types, tags, entries, authors, creation times, any AND/OR of those, or every entry (a wide rule). It says
  too whether the device keeps whole the files those entries bring (`keep`), or fetches a file's pieces as it reads
  them. It grants nothing: a device syncs what it may receive by the caps and its rules want (T28).
- **Rules are signed edits** (`Action::SyncRule`, `Action::EndSyncRule`), in the log of the vault that sets them, so
  every peer applies the same rules the same way. A vault sets rules only for its own devices, through its owners as
  for any act, and only over a vault whose entries it may hold: itself, or one it holds a cap over, backup or more. The
  server is one more peer: avenCEO sets a rule for the server's device like any vault does for its own.
- **A device with no rule over a vault wants all of it**, as before. One with rules wants an entry that a rule of its
  over that vault picks, or every entry if one is wide. Several rules make any mix: proxies kept whole and originals
  fetched as they are read, two rules; originals not synced at all, one rule that picks the proxies alone.
- **The stewards mark entries, as they place them in cells.** A rule's selector is sealed as a cap's, to the vault it
  is over and to its issuer. The vault's stewards read it, and mark each entry with the live rules that pick it, in
  canonical order (`Action::Pick`, in the entry's log), whenever that changes: a new rule, a retag, a new entry. A
  rule that ends leaves its marks, which are ignored, so ending a rule marks nothing. So a peer that reads no selector,
  the server, applies every rule from the marks alone (T29), as it applies caps from the cells.
- **Every peer filters the same way.** A peer sends a device an entry's edits only if the device may receive the
  entry and wants it (`sync::respond`), and a file only if it sends the write that brings it (T27), so the gate hands
  the iPhone no original. Frontiers cover just that: a log a device doesn't sync is a log it isn't sent.
- **What a rule shows, and to whom.** The rule edit names in the clear the device, the two vaults, whether it is wide
  and whether it keeps; whoever receives the issuer's vault log (its devices, and peers holding caps from or to it)
  learns a device has a rule, never what it picks. An entry's marks name rule ids, seen by whoever may receive the
  entry, the server included: that is what lets it apply the rule.
- **A rule drops nothing a device holds.** It narrows what comes next. A wide rule needs no steward to read it, so a
  device that can't seal to the vault it is over (the server, which holds no McEliece key of Alice's) can still set
  one; any other rule must reach the vault's stewards.

`tests/sync.rs` runs Samuel's example on the Lab: Alice's iPhone syncs the clips tagged proxy and keeps their films
whole, the server syncs and keeps everything by avenCEO's own wide rule, her Mac, with no rule, syncs everything and
fetches films as it reads them; a new proxy reaches the iPhone through the server alone while the Mac is away, an
original retagged a proxy follows, and once the rule ends the iPhone syncs the whole vault. A rule never widens what a
device may receive, and only its vault sets or ends it. `avendb-net`'s `tests/files.rs` runs it over iroh: the iPhone
keeps the proxy's film whole, never hears of the original, and may not fetch its film. The properties check T28 and
T29 on random histories with random rules, ends and marks, and T25 with them: the server still decides every edit as
an owner does.

## The page's store in OPFS (B2b)

A page keeps what its device holds in the browser's private file system, OPFS, the one place it keeps any of it
(`avendb-browser`, `js/store.js`), by a worker of its own (`js/store.worker.js`), since only a worker has OPFS's
synchronous files, which write in place. The store named `name` is the folder `avendb/<name>/`:

- `ops`, the device's signed edits in the order it took them, each a record as on disk (its length in 4 bytes
  big-endian, then its bytes on the wire), so a crash cuts at most the last one short, and reading stops before it;
  a save writes each edit at its place in the order, so saving the same edits twice keeps them once;
- `keys/`, its McEliece keys, one file each, named by its id; a key the device doesn't hold once it opened, one a crash
  cut short, is dropped;
- `meta`, what opens the device again, a record of JSON each time it changes, the last whole one counting.

While the device runs, its worker holds `ops`, which OPFS lets only one worker do, so the same device never runs in
two tabs at once: a second tab's load is refused. A store IndexedDB kept under the same name, as pages did before,
moves over the first time the store opens, its edits and keys first and its meta last, so a move cut short starts over;
then IndexedDB's database is deleted. The page asks the browser to keep what the origin stores should it run short of
space. `tests/page.rs` runs it in Chromium: Eve's first browser's store goes back into IndexedDB as pages kept it, moves
into OPFS as the browser opens again, holding every edit and key it kept, and leaves IndexedDB; a second page can't load
it while the browser runs.

## The bucket (B3a)

The server's store lives in its bucket (`avendb-net`, `bucket.rs`; the S3 client in `avendb-server`, `bucket.rs`), and
its folder on disk is only a cache of it and a short queue of what goes up next. Hetzner's endpoint agrees no
post-quantum key exchange, so, as Samuel chose, the server seals every object before it uploads it: XChaCha20-Poly1305
under a 256-bit key derived from its seal (`AVENDB_BUCKET_SEAL`, a GitHub secret with a copy kept offline), bound to the
object's name, so an object read back under another name doesn't open. Its TLS to the bucket offers X25519MLKEM768
first and X25519 after it; what crosses it is sealed either way.

- `edits/<from>-<n>`: a pack of the device's edits, those of its log from place `from` on, each a record as on disk
  after a header of its own (`avenDB edits 1`). A pack from place 0 holds the whole log and replaces every pack before
  it: the first after each start is one, and so is the next once the bucket holds 64 packs.
- `keys/<id>`: each McEliece key, under its id, checked against it when it comes back.
- `device.key`: the server's device's secret, so a server whose folder is lost is the same device again; a folder and
  a bucket that hold two secrets are two servers', and the server doesn't start.

The node saves what its device takes on disk first, then puts in the bucket what the disk holds and the bucket
doesn't, the keys before the edits that name them; an upload that fails is tried again after `retry`, then twice as
long each time, up to a minute, and once more as the node stops. Nothing counts until the bucket has it: until the
bucket holds everything the device holds, the node tells its peers nothing new (`Node::behind`), so a device that wrote
an edit keeps it as its own until the server announces it. As a node starts, it first takes back what the bucket holds
and its folder doesn't: every key its folder lacks, and the edits of every pack its folder's `packs` doesn't list. An
object that doesn't open under the seal stops the start. Nothing ever writes a name twice, and with Object Lock a pack
replaced is deleted only as a mark: its bytes go 7 days later.

`tests/bucket.rs` runs it over a bucket in a folder: Alice's Mac writes Welcome, every object in the bucket is sealed
(no pack header, no Welcome text), its folder is lost, and it starts again from the bucket alone showing Welcome, the
whole log in one pack that replaced the ones before it; a bucket sealed under another seal is refused; a server whose
folder is lost is the same device again; and while the server's bucket is down, it takes Welcome from Alice's Mac but
announces nothing, so Bob's Mac reads Welcome only once the bucket is up again. The server's files (`blobs/`) stay on
its disk until B3b.

## The Library (B4a)

Every vault has a Library (`src/lib/avendb/Library.svelte`): every file of the vault the acting vault reads, by kind
(films, images, SVGs, PDFs, audio, other), each opened on the whole screen. A file is an entry of type `file`: a
document titled with the file's name, its media type among the document's own tags (`avendb:media:video/mp4`), whose
first edit brings the file (`Device::add_file`); deleted and brought back as a note is, by the `avendb:deleted` mark.
The core needs nothing new: the document's schema holds it, and the caps on type `file` decide who may add, read and
delete one. The device's world shows each with its media type and the files it brings, each with its length where the
device opens it (`Lab::entry_files`).

- Adding: the page hands its device the file a megabyte at a time (`addFile`), which seals it into its blob store as it
  comes (`Node::store_file`), then writes the entry; in the Mac app each megabyte goes to the app's device in base64
  (`fileStart`, `fileChunk`, `fileEnd`). The server keeps every file whole, fetched from the device that wrote it.
- Reading: `readFile` hands over any range, cut to the file, from the device's store or fetched in iroh-blobs ranges
  from a peer that may hand them over, only the 64 KiB segments it needs, each opened under its own number. A page's
  blob store is in memory and forgets every 15 seconds what nothing holds (`files::forgetful`): what a read or a keep
  is using stays, as do the files the device brought or keeps, so a page playing a film holds little more than the
  window that is playing.
- Playing: a film or a song streams through a service worker (`static/app/avendb-files.sw.js`, scoped to the avenDB
  page): the browser's player asks it for `…/app/avendb/file/<root>/<size>/<len>`, in ranges, and it asks the page for
  those bytes a megabyte at a time over a MessageChannel. It serves only films' and songs' types, sandboxed; anything
  else saves as bytes. Where no service worker runs, as in the Mac app's web view, a film opens whole, up to 1 GiB.
- Pictures and PDFs open whole; an SVG as a data URL, never as a page of the site, so its scripts never run there.

`tests/device.rs` runs it: Alice's browser brings a film of three megabytes and a bit into her vault, a megabyte at a
time; her world shows it as a file with its media type and length; her Mac reads three ranges of it, across a megabyte
and past its end, fetched from the browser; and it is deleted and brought back.

## Phases

| Phase | What | State |
|---|---|---|
| B1a | `sealed`: the format above, its shape arithmetic, a sealer that seals as it reads, ranges opened alone, vectors | built |
| B1b | Edits name the files they bring (Lean model and theorem, wire, the Lab's fetch gate) | built |
| B2a | One iroh-blobs store per node, on disk natively; files sealed as they are read, read in ranges through the cap gate, kept whole by the server | built |
| B2c | Sync rules: per device, by the cap selector, for any data, marked by the stewards and applied by every peer (T28, T29); the keeper keeps what the rules say | built |
| B2b | The page's store in OPFS, in its worker: its edits, McEliece keys and what opens it again; one tab at a time; IndexedDB moved over once and gone | built |
| B2d | The page's file pieces in OPFS beside its edits: the files its rules keep whole, and the pieces it read | in B4 |
| B3a | The server's edits, McEliece keys and device secret in its bucket, sealed; nothing announced before the bucket has it; its disk a cache it rebuilds from the bucket | built |
| B3b | The server's files in its bucket: one object per piece, outboards and roots, read-ahead in ranges | |
| B4a | The Library: files as entries of a vault, added a megabyte at a time, read in ranges, films streamed through a service worker | built |
| B4 | Streaming: the Mac app's player reads ranges natively, the page's file pieces in OPFS (B2d) | |
| B5 | Studio's media on avenDB, beside the legacy vault, which stays as it is | |

The bucket is `maiacity-avendb` in hel1, beside the media vault's, made by the avenDB workflow
(`.github/workflows/avendb.yml`) with the project's S3 keys and Object Lock, as Samuel chose: every object version is
locked in compliance mode for 7 days, so no key deletes or overwrites it before then; a replaced or deleted version goes
7 days later, an unfinished upload after 2. Hetzner's endpoint agrees no post-quantum key exchange, which the workflow
checks, so the server seals every object itself (above).

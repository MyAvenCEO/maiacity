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
6. **The server is a node like the others** with two stores under one: a hot disk for edits, every file's outboard and
   a cache of pieces, and an S3 bucket for everything, small blobs in packs, each piece of a big file as one object,
   read in ranges, never copied whole.

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

## Phases

| Phase | What | State |
|---|---|---|
| B1a | `sealed`: the format above, its shape arithmetic, a sealer that seals as it reads, ranges opened alone, vectors | built |
| B1b | Edits name the files they bring (Lean model and theorem, wire, the Lab's fetch gate) | next |
| B2 | One iroh-blobs store per node: on disk natively, in OPFS in a page; range requests gated by caps; what each node holds | |
| B3 | The server's bucket: packs of small blobs, one object per piece, outboards and roots, read-ahead in ranges | |
| B4 | Streaming: the Mac reads a range as a file, a page through a service worker; a Files page | |
| B5 | Studio's media on avenDB, beside the legacy vault, which stays as it is | |

Two choices wait for Samuel at B3: whether the server reaches the bucket over post-quantum TLS only (Hetzner may not
offer it; what would travel is ciphertext either way), and a new bucket with Object Lock, which can only be chosen when
a bucket is made.

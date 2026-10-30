# Audit: the store spec (`aven/DB2/store/README.md`)

Audited 30 Oct 2026 at current main. Read only: no repository file was changed. Paths are under `aven/DB2/`.
Abbreviations: **SR** `store/README.md` (the audited spec), **RM** `README.md`, **EN** `db/engine/README.md`, **DO**
`db/docs/README.md`, **CA** `id/caps/README.md`, **PR** `PRODUCTION.md`, **SB** `SANDBOX.md`, **M2** `MILESTONE2.md`.
"Built" means found in code at main; "spec only" means not found there.

## 1. Purpose and scope

- One spec for avenDB's bytes: the `Store` contract and its backends, the iroh-blobs adapter, files as hash sequences, the chat's per-device chains, the opfs driver and its performance gates (SR:1-6, 36-42). On bytes it overrides both drafts it merges (SR:3-6).
- Goal: files in the chat that play or seek without a full download, and a chat that survives reloads. Every file kind takes one path (SR:8-11). It replaces milestone 2's in-memory chat (SR:13-14; M2:43-44).
- Left out on purpose: schemas, sealing (bytes are plain at rest), caps and per-Doc keys (one shared "city-dome") and Loro (SR:16-24). Rules it adds: local first (SR:26-34) and one package, `aven-db-store` (SR:38-42).

## 2. Primitives

| Primitive | Definition | Named / identified | Mutable | Written by | Stored | Status |
|---|---|---|---|---|---|---|
| Blob | Bytes, whole or absent. Plain in v1, sealed "above" the store later (SR:84) | BLAKE3 of its bytes, one `Hash` type (SR:48); 64 lowercase hex (store/src/hash.rs:26-58) | No (`blob_never_changes`, db/spec/Aven/DB/Store.lean:206) | Each peer's one writer (SR:86, 142) | `blobs/<hash>` in that peer's Store (store/src/dal.rs:300-302; store/src/opfs.rs:30-32) | built |
| Ref | A flat name pointing at a blob, changed by compare-and-set (SR:50, 85) | `RefName`: 1-128 chars of `A-Za-z0-9._-` (store/src/name.rs:7-25). At rest: hex plus `\n` (SR:170-171) | Yes, only by CAS (store/src/store.rs:38-60) | The peer's one writer | `refs/<name>` (store/src/dal.rs:320-322) | built |
| Store and drivers | The contract, one per peer. Drivers: S3 for the Aven Peer, a folder for Alice Peer, memory for tests, `opfs` for Peer-Lights (SR:49, 66-69, 74-76) | — | — | — | Hetzner S3, disk, OPFS, RAM | built (store/src/backend.rs:18-95) |
| Chunk | A piece of a file of at most 1 MiB, stored as an ordinary blob (SR:94). The sender's code makes every chunk but the last exactly 1 MiB (store/src/files.rs:12-28) | Its hash | No | The sender; every fetcher (store/src/blobs/actor.rs:275-303) | blobs | built |
| File index | A blob listing the chunk hashes in order, 32 B each: iroh-blobs' `HashSeq` (SR:94-95) | Its hash names the file (SR:95) | No | The sender | blobs | built |
| File | Bytes plus a name and a MIME type the sender claims (SR:17-18), stored as a hash sequence | Its index's hash; pinned by the ref `file-<index>` (SR:117-118) | No | The sender; kept by the Aven Peer (SR:118) | Every holder | built (peer/native/src/keep.rs; peer/light/src/lib.rs:215-268) |
| Announcement (`file` line) | `{file,size,name,type}` as a line of the sender's chain (SR:109-111) | The line's hash | No | The sender's device | As a line | built (db/core/src/files.rs:71-81; db/core/src/chain.rs:24-41) |
| Line | A blob holding device, seq, previous hash, time and text, signed (SR:140-141). The code also carries `network` and a typed body (db/core/src/chain.rs:95-138) | BLAKE3 of the blob (SR:150-151, 208-209) | No | Its device. Every peer that hears it stores it (peer/native/src/chats.rs:441-466) | Every peer's Store | built |
| Chain | A device's lines, each naming the one before (SR:137-142) | The device key. Its head is the ref `chat-<device>` (SR:142) | Append-only; the head only moves forward (`chain_suffix`, db/spec/Aven/DB/Chains.lean:227) | Its device. Every peer's `Keeper` moves its own copy of the head (peer/native/src/chats.rs:544-575) | refs + blobs | built |
| Fork | Two lines of one device on the same previous line: kept, not chained, raised (SR:147-148) | The later line's hash | — | Every peer detects it (db/core/src/chain.rs:329-333) | Memory only, not reloaded on restart (db/core/src/chain.rs:254-271) | built, lost on restart |
| Keep rule | "the Aven Peer keeps every city-dome file and line" (SR:119-120) | — | — | The Aven Peer | S3 | built for files (peer/native/src/keep.rs:155-198; peer/native/src/main.rs:366-417) |
| Outboard | The bao tree. Made when a blob is served or checked, never kept (SR:101-103) | — | — | The adapter | RAM | built (store/src/blobs/actor.rs:167-178) |
| Temp files, marker | `tmp/blob-<hash>`, `tmp/ref-<name>`, and `meta/version` = `avenDB store 1` (SR:168-176) | By their place | Swept or rolled forward on open | The opfs driver | OPFS | built (store/src/opfs.rs:26-120) |
| Leader | The dedicated worker that holds the Web Lock `aven-peer-light:<network>` (SR:184-189) | The lock name, per origin | — | — | — | built (os/web/peer/open.js:44-54) |
| Device secret | "moved into the store" (SR:211) | The ref `device-key` points at a blob holding the hex seed | Set once | The Peer-Light | OPFS | built (peer/light/src/lib.rs:368-387) |
| Later and next | Sealing: room secret `dome-<device>`, a convergent key, 64 KiB AEAD units (SR:157-159). Packs: pack, record, refs log, tombstone, an in-memory index (SR:225-236) | | | | | spec only |

## 3. Glossary

Marks: **≈** is a near-synonym of a term used elsewhere in avenDB. **⚠** is the same word with a different meaning elsewhere.

- **store / `Store`**: the single contract of blobs and refs; each peer has one (SR:38, 49). Same meaning as RM:114.
- **blob**: bytes named by their BLAKE3 hash, whole or absent (SR:84). **≈ Value** at rest (SR:48; RM:109; DO:36-38).
- **`Hash`**: BLAKE3, one type shared by the store, the docs and iroh-blobs (SR:48). **⚠** Written as bare hex here (store/src/hash.rs:26-30) but as `b3:…` in DO:117-118 and EN:174-176.
- **ref**: a flat name pointing at a blob, changed by CAS (SR:50, 85). **⚠** RM:113 defines a ref as "a Doc's head". EN:188-190 uses "ref" for a pointer between Records ("like a foreign key"). Here a ref is also a pin (`file-<index>`), a pointer to a secret (`device-key`) and a record (`first-start`, peer/native/src/record.rs:10).
- **reachability**: a blob is kept while some ref reaches it. Cleanup comes in milestone 4 (SR:51).
- **driver / backend**: what a Store runs on: OpenDAL (S3, folder, memory) or our own `opfs` (SR:67-69, 74-76).
- **adapter**: the one module that answers iroh-blobs' store API from our Store (SR:77-78, 276-280).
- **hash sequence / `HashSeq`**: a blob of concatenated hashes; the form a file takes (SR:89-95).
- **chunk**: a file blob of at most 1 MiB (SR:94). **⚠** In bao and iroh-blobs a "chunk" is 1 KiB, and their `ChunkRanges` sits beside our chunks in store/src/blobs/mod.rs:102-107.
- **index**: a file's hash sequence (SR:94). **⚠** The same spec also uses "index" for the packs' in-memory hash→offset map (SR:230-231), and EN uses it for query indexes (EN:491).
- **file**: bytes plus a name and MIME type the sender claims (SR:17-18). **≈** EN's `file` Record (EN:79-80, 176).
- **outboard / group**: bao's hash tree, and its 16 KiB groups (SR:101-102).
- **seek**: a range read that fetches only the chunks it touches (SR:99-100, 128).
- **city-dome**: the one shared room of every member, "until now the room" (SR:22-23). **≈** M2's room (M2:41-43), RM's "space" (RM:177-178), CA's "group" (CA:82).
- **announcement / `file` line**: `{file,size,name,type}` on the sender's chain (SR:109-111). **≈** EN's file Record.
- **keep / keep rule**: the Aven Peer stores every city-dome file and line (SR:118-120). **≈** EN's durable want (EN:88-89) and CA's keep cap (CA:298). **⚠** The code type `Keeper` is something else: every peer's in-memory chain state (db/core/src/chain.rs:254-261). CA's **keeper** is "a peer that keeps and serves sealed bytes it can't open" (CA:117).
- **holder**: a peer that holds a file's chunks (SR:52, 130-131). **≈** CA's keeper.
- **file API**: `file_len`, `file_range` and `file_fetch`, the Peer-Light's stable exports for files (SR:127-129).
- **leader / follower**: the tab worker that holds the Web Lock and runs the Peer-Light, and the other tabs (SR:184-189). **≈** "the one writer" in a browser (RM:125).
- **line**: one device's signed chat blob (SR:140-141). **⚠** In DO a "line" is a run of history: main, a proposal, a variant or a draft (DO:58-59). **≈** DO's **envelope**, a signed device change (DO:53).
- **chain**: a device's lines, linked by the previous line's hash (SR:137-138). **≈** avenDB-old's per-device log (EN:58). **⚠** CA uses "chain" for a cap's delegation chain (CA:813).
- **head / `chat-<device>`**: a device's newest line (SR:142). **⚠** DO's head is a ref to {version, snapshot, segments} for a whole Doc (DO:56). Here there is one head per device, not one per Doc. **≈** one entry of a version vector (DO:60).
- **fork**: two lines of one device on the same previous line (SR:147-148). **≈** CA's "split" (CA:175-176) and EN's rule 15 (EN:130).
- **catching up**: a returning peer walks the chains and fetches the lines it lacks (SR:149-151). Same as EN:351-355.
- **segment**: Loro's sealed batches, which replace lines in milestone 4 (SR:24, 152). Same as DO:54.
- **sealing / room secret / convergent key / AEAD unit**: the later encryption (SR:155-162). **≈** RM's "convergence secret" (RM:176-180). CA has epochs and group keys instead of a room secret (CA:111-116).
- **the one writer's lock**: listed as something the store holds (SR:86). **≈** RM rule 1 (RM:30). In code it is an in-process mutex (store/src/dal.rs:35-40).
- **temporary file, roll forward, sweep**: the opfs crash protocol (SR:168-176, 190-192).
- **gate**: the opfs workload's time limits (SR:193-206, 240). **⚠** The same spec also says "provider gate" for an access check (SR:250, 321), and the code's `Gate` is the door's set of admitted keys (peer/native/src/members.rs:33-34).
- **pack, record, refs log, tombstone, compaction, torn tail**: the next opfs layout (SR:225-240). **⚠** "record" collides with **Record** (EN:5-6; DO:48).
- **door / provider gate**: members-only admission at the relay and in `after_handshake`, then once more in iroh-blobs (SR:70, 250). **≈** RM:161-165. CA would add fetch proofs (CA:118).
- **relay**: iroh's relay inside the Aven Peer; every byte of a Peer-Light crosses it (SR:130-131, 248).
- **spike**: the measured choice between (a) iroh-blobs with an adapter and (b) bao-tree directly (SR:256-274).

## 4. Rules and invariants (as the spec states them)

1. Every write lands in the local store and shows at once. Sending and fetching happen in the background. Offline writes wait in the local store (SR:30-34).
2. One package. OpenDAL is only a driver. No iroh-blobs type appears above the adapter (SR:38, 74-78).
3. A blob is named by the BLAKE3 of exactly its bytes and is whole or absent. The store never holds keys, caps, members, meaning, networking or fetch decisions (SR:48, 82-87).
4. Only refs are mutable, and only by CAS. Nothing appends. There are no partial blobs and no outboards in the contract (SR:50, 96-98).
5. A blob is kept while a ref reaches it. Nothing is deleted until milestone 4 (SR:51).
6. A file is a hash sequence of chunks of at most 1 MiB, named by its index. A seek fetches only the chunks it touches, and each is checked whole (SR:94-100).
7. The same file is stored once across the network, by its hash (SR:112).
8. The Aven Peer keeps every city-dome file and line. A peer keeps its own uploads until the Aven Peer has them (SR:119-120).
9. A line is signed by its device. Each device writes only its own store, and `chat-<device>` points at its newest line (SR:140-142).
10. The Aven Peer moves `chat-<device>` forward by CAS, and only to a line that device signed on top of the current head. A fork is kept, not chained, and raised (SR:145-148).
11. Catching up ends with every line both peers can see. Lines show ordered by time, then by device. A line received twice is kept once (SR:149-151, 292-293).
12. Sealing never changes the store. Plain data stays readable because the store is never wiped (SR:160-162).
13. Writes are atomic: temp file, flush, move, or copy where move is missing. A crash leaves the store as it was before or after the call (SR:168-177).
14. A ref at rest is exactly 64 hex digits and a newline. Anything else is refused (SR:170-171).
15. A browser store without the exact marker is cleared, and the browser becomes a new device. The Aven Peer's store is never reset (SR:171-174).
16. One writer at a time, under the Web Lock. A takeover waits for the lock (SR:182, 184-192).
17. Gates per engine: chat line 60/150 ms, 1 MiB chunk 30/100 ms, catch-up of 500 lines 10/30 s (SR:199-202). Pack files must meet 60 ms / 30 ms / 10 s everywhere (SR:240).
18. iroh-blobs is pinned at exactly 0.104.0, and a test fails if the private-constructor workaround breaks (SR:282-285).
19. A fetched blob is buffered until every byte has arrived, checked, then put once (SR:278-279).
20. Lean comes first: Files, Chains, and the store's crash between the temp file and the move (SR:289-294).

## 5. Trust model

| Party | Sees (today, v1) | Can do |
|---|---|---|
| A member's device (its key) | Every line and file in the city-dome, in plaintext (SR:19-21) | Sign lines on its own chain, announce files with any name and MIME type (db/core/src/chain.rs:70-93), fetch any blob by hash from any peer (store/src/blobs/mod.rs:79-93), relay other devices' lines (peer/native/src/hub.rs:96-104) |
| Peer-Light (browser) | Everything it fetches. Its device seed is stored as a plain blob in OPFS (peer/light/src/lib.rs:368-387) | Serve its whole store to members (peer/light/src/lib.rs:512-519). Reach anyone only through the relay (SR:130-131) |
| Native Peer (Alice Peer) | The same | Share a folder (`--files`) (SR:122-123). Direct UDP, so peers see its IP (RM:164-165) |
| Aven Peer | Every line, file, name, MIME type, size, and who sent and fetched what, in plaintext until sealing (SR:20-21) | Keep everything (SR:119-120), act as the sole source for catch-up (SR:149-151), arbitrate forks (SR:145-148), run the relay (SR:248), choose which statements to send (peer/native/src/link.rs:173-204) |
| Relay (in the Aven Peer) | Device keys, IPs, timing and volume of every relayed connection (CA:768) | Carry or drop every Peer-Light byte; its bandwidth is their limit (SR:130-131) |
| Hetzner S3 | Every object in plaintext, including ref names (`chat-<device>`, `file-<index>`) and sizes (store/src/dal.rs:300-322) | Delete or withhold objects. Roll a ref back unseen: refs are unsigned, and Hetzner refuses `If-Match`, so changing a ref "leans on the one writer" (PR:187-189). It cannot forge a blob, because every `get` is hash-checked (store/src/dal.rs:157-169) |
| Browser host (`aven.maia.city`, served by v1's Caddy, PR:100) | Nothing directly | Serve avenOS, the wasm, the Service Worker and the leader's code. Any change to that code can read the seed in OPFS and every plaintext |
| Non-members | Nothing. The door is checked at the relay and in `after_handshake` (RM:161-165) | Derive the gossip topic from the network's name, since it is not keyed (peer/native/src/room.rs:34-38) |

**Privileges a server-like peer holds that the data's owner never granted by cap:**
- P1. **Keep by fiat.** The Aven Peer keeps every file and line under a hard-coded rule (SR:119-120), not under a keep cap (CA:172-174, 603-607). An owner can't opt out or delete: there is no line delete, and production is never wiped (PR:172-178).
- P2. **Reads plaintext.** The Aven Peer and Hetzner read everything stored before sealing, permanently (SR:19-21, 160-162). This contradicts RM:199 and EN rule 14 (EN:128-129).
- P3. **Sole catch-up authority, so it can withhold.** A returning peer asks only the Aven Peer (SR:149). Nothing cross-checks that the Aven Peer isn't serving stale heads or hiding chains. CA:780-782 has members gossip the tree's head; nothing does the same for chat heads.
- P4. **Veto on durable writes.** A non-Aven device chains its own lines only after the Aven Peer's `heads` confirm its head. Until then its lines are queued in memory (peer/native/src/chats.rs:93-97, 398-417; peer/native/src/link.rs:134-145). If the Aven Peer withholds or lies, the device can't write durably.
- P5. **Arbitrates forks.** Whichever variant reaches the Aven Peer first is chained and served to every newcomer (db/core/src/chain.rs:329-349). The spec gives no other resolution.
- P6. **Chooses what to keep.** It fetches only from the announcing device (peer/native/src/keep.rs:176-183). A `Mismatch` or `NotFound` is never retried (peer/native/src/keep.rs:139-143).
- P7. **Single relay.** Peer-Lights reach everyone through the Aven Peer's relay alone (SR:130-131, 248), so it can censor or throttle them.
- P8. **Later: holds `dome-<device>`.** It would keep every device's sealed room secret (SR:157-158), so it could deny access and would see the set of devices.
- P9. **Storage host rollbacks.** Hetzner can move heads backwards undetected (unsigned refs; PR:187-189).
- P10. **Code host.** Whoever controls `aven.maia.city`, which is v1's Caddy (PR:100), controls the code that holds every browser's key.

## 6. E2EE and privacy

- **Today:** no encryption at rest. iroh encrypts every connection, and the door admits only members (SR:19-20). The relay can't read relayed traffic (CA:768).
- **Later (SR:155-162):** a room secret sealed to each member device and kept as `dome-<device>`. Files sealed with a convergent key `keyed_hash(secret, BLAKE3(plaintext))` in 64 KiB AEAD units, so a range opens only what it touches. Announcements sealed with the secret. The spec says this "moved to avenID's caps", but CA contradicts it: CA rule 17 seals only a keyring to devices (CA:158-159), and CA:821 refuses "keys sealed per device on Docs". The spec defines no nonce derivation, key commitment, rotation on member removal, or padding. CA pads with Padmé (CA:776).
- **Keyed or blind index:** only the convergent key is keyed. Outsiders, the Aven Peer included, can't confirm a guessed file (RM:176-180). Ref names, the gossip topic and index lengths are not keyed or padded.
- **Metadata today:** the Aven Peer and Hetzner see all content. Every member's `heads` lists every device key and its line count (peer/native/src/chats.rs:286-297), so activity per device is visible. File sizes are exact: the line's `size`, plus the index length, which gives the chunk count (db/core/src/files.rs:71-81). Any member can test whether any peer holds a given hash through iroh-blobs' observe (store/src/blobs/actor.rs:148-159). On a direct path, peers see each other's IP (RM:164-165).
- **Metadata after sealing, as specified:** per-device chains, signature checks by the Aven Peer and `chat-<device>` / `dome-<device>` refs still show the keeper the device, the seq, the timing and the size. CA's sealed sender and pseudonymous peer don't fit this shape (CA:172-178).
- **History stays plain:** everything written before sealing remains plaintext at Hetzner for good, since nothing is re-encrypted or wiped (SR:160-162; CA:163-164; PR:172-178).

## 7. Sync and performance

**How data moves**
- **Live lines:** each whole line blob goes out on iroh-gossip as `{"line": …}` (SR:143-144; peer/native/src/room.rs:316-327). Each peer checks it, stores it and moves its own `chat-<device>` (peer/native/src/chats.rs:441-497).
- **Catch-up as built:** on connect, the Aven Peer sends `heads`, then `heads` again on each beat when something moved (peer/native/src/hub.rs:171-175, 210-223). The peer replies `catch_up {have}`, and the Aven Peer answers with `lines` frames in batches of at most 32 KiB (db/core/src/wire.rs:43-51; peer/native/src/chats.rs:59-77, 322-332). Lines written offline are uploaded as `lines` (peer/native/src/link.rs:108-131). A gap still open after 5 s triggers a catch-up (db/core/src/chain.rs:19-20; peer/native/src/link.rs:336-343).
  - The spec says instead "fetches the missing lines as one hash sequence" (SR:149-151).
- **Files:**
  1. Send: chunks into the local store, then the index, then `file-<index>`, then a `file` line (SR:116-118; peer/light/src/lib.rs:215-268).
  2. Keep: the whole hash sequence is fetched from the sender, with at most 4 keeps in flight (peer/native/src/main.rs:371-417).
  3. Show: the Service Worker reads at most 1 MiB per request from the leader. The leader runs `file_range` and fetches missing chunks from the Aven Peer, falling back to the sharer (os/web/public/files-sw.js:15-16, 53-92; os/web/peer/worker.js:168-187).

**Unit sizes**

| Unit | Size |
|---|---|
| Chunk | 1 MiB (SR:94) |
| Index | 32 B per chunk; the adapter caches 4 indexes of at most 256 KiB, i.e. files up to 8 GiB (store/src/blobs/actor.rs:29-31) |
| bao group | 16 KiB; about 4 KiB of tree per chunk (SR:101-102) |
| Line text | at most 2,000 B (db/core/src/chat.rs:17) |
| Gossip message | at most 4,096 B (iroh-gossip 0.101 `DEFAULT_MAX_MESSAGE_SIZE`, src/proto.rs:69) |
| Wire frame | at most 64 KiB (db/core/src/wire.rs:11) |
| Open read handles | 16 (SR:180-181) |
| AEAD unit (later) | 64 KiB (SR:159) |
| Pack (next) | 64 MiB, to be measured (SR:226) |

**Measured**

| What | Result |
|---|---|
| Line put, OPFS | 20 / 13 / 78 ms (Chromium / WebKit / Firefox) (SR:203-205) |
| 1 MiB chunk put, OPFS | 21 / 24 / 42 ms (SR:203-205) |
| Catch-up of 500 lines | 4.2 / 2.2 / 14.7 s, i.e. about 120 / 230 / 34 lines/s (SR:203-205) |
| Firefox sync handle | about 23 ms per `createSyncAccessHandle()`, two per line (SR:220-221) |
| Spike: 1 GiB through the relay | 201 MB/s from a folder, 139 MB/s from S3 (SR:263-264) |
| Spike: cold seek | 10.6 / 11.5 ms (SR:265) |
| Spike: S3 GETs (whole file / cold seek / warm seek) | 1025 / 2 / 1 (SR:273-274) |
| Wasm added by the adapter | +314 KB gzip (SR:269) |
| Check: seek to the middle | 1.05 MB in 0.6 s (SR:300-301) |
| Check: Aven Peer keeps 200 MiB | 2.3 s (SR:301) |
| Check: 199 MiB S3 → relay → OPFS | 17 s, about 12 MB/s, so the browser path is about 16× slower than the native spike (SR:301-302) |
| Lines into an empty OPFS | about 70 lines take 2-3 s (SR:335-337) |

The spike ran in-box on loopback in a dev profile (SR:256-259), so it does not predict a WAN relay.

**Scale**

- **Millions of lines.**
  - Every line costs one blob plus one ref CAS (SR:335-337).
  - Every peer holds every chain in memory (db/core/src/chain.rs:254-261).
  - The Aven Peer reads every line from S3, one GET at a time, on every start (peer/native/src/chats.rs:118-139). It reads them again for every catch-up and builds the whole answer in memory (peer/native/src/chats.rs:261-278, 322-332).
  - At the measured browser rate, 100k lines take about 14 min in Chromium and 49 min in Firefox. Loro segments (milestone 4) are the planned fix. Packs fix handle cost only.
- **Many devices.** `heads` and `catch_up` are each one unpaged frame against a 64 KiB limit. Links fail at about 400 devices with lines (W3). Every browser reset mints a new device (SR:171-174).
- **TBs of files.**
  - About a million S3 objects per TB (SR:104-105).
  - The index is flat, about 32 MB per 1 TB file, and is fetched whole on a cold seek.
  - Nothing is ever deleted (SR:51), there is no quota, and the OPFS cache budget is an open question (SR:331-332).
  - Each file is kept from one holder, at most 4 in parallel (peer/native/src/main.rs:371).
  - "Several holders at once" is not built: every fetch goes over one connection (peer/light/src/lib.rs:567-591).
- **Bottlenecks:** the relay for Peer-Lights, the Aven Peer's S3 GET rate, OPFS handle cost, the per-line ref CAS, the unpaged heads frame, and the in-memory chains.

## 8. Seams

- **Needs from avenID / avenPEER:**
  - Device keys and the members' door, checked at the relay, at `after_handshake`, and again by the provider (SR:70, 250; peer/native/src/members.rs:121-148).
  - Statements, checked by each peer (peer/native/src/link.rs:173-204).
  - The `Router`, the relay, gossip, and `aven/db/1` (SR:70-71).
- **Needs from caps (later):** sealing, keep caps and fetch proofs (SR:20-22, 155-162).
  - The provider today admits any member to any hash (store/src/blobs/mod.rs:79-93).
  - CA's keeper serves only against per-Doc fetch proofs (CA:609-612). Checking those per blob needs a blob→Doc map, which the store refuses to hold ("what a blob means", SR:86).
- **Gives to docs and engine:** Values as blobs, refs as heads, the iroh-blobs transport, files as hash sequences, and a `size` method (SR:48-54, 320; EN:346-350).
- **Actors:** nothing directly.
- **Contradictions:**
  - Per-device chains whose signer the Aven Peer checks "stay when sealing comes" (SR:137-138, 145-148). This conflicts with CA's blind keeper and signer-inside-the-seal (CA:172-178).
  - The chat as N device chains (SR:137-153) conflicts with EN/DO, where a chat room is one Doc and its lines are Records inside it (EN:174, 185-190; DO:105-108). "Nothing is thrown away" (SR:152-153) has no migration path.
  - "A file is one blob" (RM:170) vs a hash sequence (SR:94).
  - "The Aven Peer only ever sees ciphertext" (RM:199) and "data stays sealed" (RM:163-164) vs plain v1 (SR:19-21).
  - "The engine's rule 5" (SR:147-148) should be rule 15 (EN:130).
  - SR says provider events are `connected`, `get` and `push` (SR:250; EN:375). The code intercepts `connected` only (store/src/blobs/mod.rs:81-92).
  - "New heads" travel on gossip (SR:54), but the code sends them as `aven/db/1` frames (peer/native/src/hub.rs:210-223).
  - CA's "ranges of 64 KiB" at keepers (CA:815) vs whole 1 MiB chunks (SR:99-103).
  - DO still points at `db/store` (DO:121, 272).
  - RM rule 4, "no retry timers" (RM:36-37), vs the 2 s waits, read retries and 5 s gap timer (SR:182-183, 207-208; db/core/src/chain.rs:19-20).
  - RM's one writer is "the single task" (RM:125). Here many tasks share an in-process lock (store/src/dal.rs:35-40).
  - SR and EN split ownership of chat sync (SR:3-6; EN:359-363).

## 9. Strengths

- **A tiny contract.** Blobs are whole or absent and refs change only by CAS. It is proven in Lean, crash included (db/spec/Aven/DB/Store.lean:206, 309, 318; db/spec/Aven/DB/StoreCrash.lean:141, 179). Every `get` checks the hash (store/src/dal.rs:157-169).
- **Hash sequences keep the contract unchanged** (SR:91-98). A seek touches only the chunks it needs, and resume and dedup come for free.
- **iroh-blobs is quarantined behind one adapter.** It is pinned exactly and guarded by a test (SR:77-78, 282-285). The choice was made by measurement (SR:256-274).
- **The crash protocol is sound.** Temp files are named by their place and rolled forward, and refs are exact text, so a torn ref never reads as a hash (SR:168-177).
- **Per-device chains avoid many writers racing on one ref.** They give provenance and detect forks (SR:135-148).
- **Local first is a stated rule** (SR:26-34). Performance work is evidence-driven: gates per engine (SR:193-206), and the pack plan comes from measurement (SR:220-223).
- **Honest about trade-offs:** plain v1 and its permanence (SR:160-162), relay limits (SR:130-131), S3 GET cost (SR:104-105).

## 10. Weaknesses, gaps, risks, contradictions, over-complexity

### High

**W1. A line's identity is malleable.**
- What happens: the hash of whatever bytes arrived is a line's id (SR:150-151; peer/native/src/chats.rs:450, 463).
  - Parsing is lenient. `parse::<u64>` accepts `007` and `+7`, and the hex decoder takes upper case (confirmed with rustc).
  - The signature is checked over re-rendered fields (db/core/src/chain.rs:113-123, 141-173, 219; peer/native/src/chats.rs:48-57).
  - So anyone who relays a line can mint valid copies with other ids. Each copy raises a false fork, which the spec reads as a cloned device or a stolen key (SR:147-148).
  - Race a copy to the Aven Peer through `lines` (peer/native/src/hub.rs:96-104) and it gets chained. The victim's next line then never fits (db/core/src/chain.rs:246-252), and its chain is stuck for good.
- Why the model misses it: Lean names a line by an abstract id and "takes the signature as sound" (db/spec/Aven/DB/Chains.lean:36).
- Fix: require a canonical encoding (re-encode and compare), or name lines by their signed content.

**W2. The Service Worker serves sender-typed bytes on the origin that holds the key.**
- What happens: `/files/<hash>` is answered with the sender's claimed `type`. No `nosniff`, CSP sandbox or `attachment` header is set (os/web/public/files-sw.js:53-98; os/web/peer/worker.js:187).
- The attack: open a `text/html` "file" link, or an SVG image, in a new tab (os/web/apps/Chat.svelte:49-50, 98-109). The script then runs on the Peer-Light's origin. It can read the seed in OPFS (peer/light/src/lib.rs:368-387) and sign as the device.
- Gap in the spec: SR treats the MIME type as untyped data (SR:10-11, 17-18). Open question 3 treats the SW's origin as a routing question only (SR:333-334).

**W3. Catch-up has a hard device ceiling.**
- What happens: `heads` and `catch_up` are sent unpaged (peer/native/src/hub.rs:171-175; peer/native/src/chats.rs:286-319). The decoder refuses an unterminated buffer over 64 KiB (db/core/src/wire.rs:11, 88-101). The link reads 16 KiB at a time (peer/native/src/link.rs:306).
- Result: past about 400 devices with lines, about 160 B per head, every link loops on `TooLong`. Browser resets mint devices (SR:171-174).
- Related: one `catch_up` loads the whole missing history into memory, at one S3 GET per line (peer/native/src/chats.rs:261-278).

**W4. Fetches are buffered at a size the remote claims.**
- What happens: SR mandates whole-blob buffering with no maximum blob size (SR:278-279; open question 2, SR:331-332). The adapter runs `vec![0u8; size]` before any byte arrives (store/src/blobs/actor.rs:277-283).
- Result: a member who claims a huge size can abort the Aven Peer, which retries every file line on start (peer/native/src/main.rs:414-417), or the Peer-Light's wasm.
- Unconfirmed: that iroh-blobs 0.104 passes the holder's unverified size header. Its source is not on this machine.

**W5. The chain design can't survive sealing as specified.**
- What happens: "this stays when sealing comes" (SR:137-138, 145-148) needs a keeper that sees device, seq and signature. That contradicts CA rules 22-23 (CA:172-178).
- The sealing sketch, a room secret sealed to each device under `dome-<device>` (SR:157-158), contradicts CA:158-159 and CA:821.
- Keeping a superseded design "so it isn't lost" will mislead.

**W6. History before sealing stays plaintext forever.**
- What happens: it stays at Hetzner and with the Aven Peer (SR:19-21, 160-162; PR:172-178; CA:163-164). That breaks RM:199.
- It is a decision, but it is irreversible, and the spec includes no notice to members.

### Medium

- **W7. The chunk invariant is too weak and unchecked.**
  - "At most 1 MiB" (SR:94) is not enough for seek arithmetic.
  - Receivers never check that every chunk but the last is exactly 1 MiB. A short middle chunk panics `File::read` with `from > to` (store/src/files.rs:86-104). It also skews `open`'s length (store/src/files.rs:60-72).
  - `keep`'s size check doesn't catch it (peer/native/src/keep.rs:184-193). Lean proves only the honest split (db/spec/Aven/DB/Files.lean:15-18).
- **W8. Local first breaks offline after a reload.**
  - Writes are held in memory until the Aven Peer confirms the device's head (peer/native/src/chats.rs:93-97, 398-417). A second reload loses them. This contradicts SR:30-34. See P4.
- **W9. Forks are volatile and never resolved.**
  - Forks and loose lines live only in memory and no ref reaches them, so milestone 4's cleanup will drop them (db/core/src/chain.rs:254-271).
  - There is no convergence rule: peers can chain different variants for good (db/core/src/chain.rs:329-349).
- **W10. Membership is judged when a line is read, not when it was written.**
  - Lines from a removed device are refused as `NotMember` by peers that catch up later, while peers that held them keep them (db/core/src/chain.rs:204-227; peer/native/src/chats.rs:453-458). Histories diverge.
  - SR:311 doesn't say which membership applies.
- **W11. History cost is linear everywhere.** See §7 Scale. No limit is stated for the interim design.
- **W12. There are no limits or quotas.**
  - Any member can make the Aven Peer fetch and keep any number of bytes.
  - A size mismatch leaves the fetched chunks in S3 unreferenced, forever (peer/native/src/keep.rs:175-197).
  - Gap and fork lines are stored before they are judged, and the loose list is unbounded (peer/native/src/chats.rs:462-466).
- **W13. The single writer is operational only.**
  - "The store holds the one writer's lock" (SR:86), but the lock is an in-process mutex (store/src/dal.rs:35-40; store/src/opfs.rs:19-24).
  - On Hetzner a changing ref has no server-side check (store/src/dal.rs:17-20; PR:187-189). A second process, or the storage host, can move a head backwards undetected.
- **W14. The spec and the code diverge.**
  - Catch-up uses frames, not a hash sequence (SR:149-151 vs db/core/src/wire.rs:42-51).
  - "One of each: how bytes move" (SR:52) no longer holds: lines travel by gossip and by `aven/db/1`.
  - Fetching from several holders at once (SR:130) is not built.
  - Provider `get` and `push` are not intercepted (store/src/blobs/mod.rs:81-92). Push stays off only by iroh-blobs' default.
- **W15. The pack design has holes.**
  - Crash safety assumes bytes persist as a prefix. Real filesystems can tear the middle unless there is a barrier per record (SR:232-239).
  - The refs log grows with every ref change and is never compacted (SR:228-229, 235-236).
  - Every open rescans every pack (SR:230-231).
  - The point at which a write is acknowledged is unspecified.
- **W16. The device seed sits in the store.**
  - This contradicts "never holds keys" (SR:84 vs SR:211).
  - The provider serves it to any member who can name its hash (store/src/blobs/actor.rs:167-178). That is defence-in-depth broken. It is not directly exploitable while the hash stays secret.
- **W17. A browser reset on a format bump loses data.** Unsent lines, unkept files and the key all go (SR:120, 171-174; store/src/backend.rs:84-95). This is at odds with the no-wipe stance (PR:172-178).
- **W18. Senders' clocks order the chat.** Time is chosen by the sender and never checked (peer/native/src/chats.rs:428; db/core/src/chain.rs:352-369), so a member can reorder history. Lines have no causal order across devices.
- **W19. The chat may not be "one Doc" later.** See §8. A milestone-4 migration of N chains into a room Doc is unspecified.

### Low

- **W20.** Wrong cross-reference: "the engine's rule 5" should be rule 15 (SR:147-148; EN:130).
- **W21.** Term collisions: line, chain, keeper/`Keeper`, chunk, index, gate, record, ref (see §3).
- **W22.** Stale or contradictory text in other specs: RM:170, RM:199 and RM:163-164; `db/store` in DO:121 and DO:272.
- **W23.** The gossip cap is 4,096 B (iroh-gossip src/proto.rs:69), not "under bao's 16 KiB group" (SR:141). JSON escaping can push a 2,000-byte text over it. Such a line then arrives only through catch-up (peer/native/src/room.rs:316-327).
- **W24.** `get_range` is still unverified (SB:120; store/src/dal.rs:171-192; store/src/opfs.rs:166-177). "Closed" (SR:103) holds only because no production code calls it.
- **W25.** `open` guesses a file's length until the last chunk arrives (store/src/files.rs:60-72), so `Content-Range` can be wrong (os/web/public/files-sw.js:80-90). The line already carries the true `size`.
- **W26.** Retry timers go against RM rule 4 (§8).
- **W27.** Leader liveness: a frozen tab can hold the Web Lock. Without Web Locks the code runs a leader per tab (os/web/peer/open.js:53-54), which means two writers with one key. The old Safari versions in scope lack Web Locks (SR:215-216).
- **W28.** The index is flat. Files over 8 GiB lose the adapter's index cache (store/src/blobs/actor.rs:29-31).
- **W29.** The spike numbers are loopback figures (SR:256-259). The browser path measures about 12 MB/s (SR:301-302).
- **W30.** "a line's hash … is what's signed" (SR:208-209) is wrong. The signature covers `signs()`, not the blob (db/core/src/chain.rs:112-138).
- **W31.** Over-complexity:
  - Three transports for lines: gossip, `aven/db/1`, and the spec's hash sequences.
  - A learned/queued/replacing state machine (peer/native/src/chats.rs:93-105).
  - Two hash spellings.
  - Text lines wrapped in JSON.

## 11. Open questions (as listed in the spec)

1. **Thumbnails and posters:** a second small blob made by the sender and announced with the file, so the chat paints before a movie's first chunk arrives (SR:329-330).
2. **Limits:** the largest file the chat accepts, and how much of a Peer-Light's OPFS cached chunks may use before the oldest go (SR:331-332).
3. **Where the Service Worker lives** when the Peer-Light has its own origin: on that origin, or on avenOS's origin, relaying through the page (SR:333-334).
4. **Catching up moves a ref per line:** about 70 lines take 2-3 s. Moving each chain's ref once per page of `lines` would cut that, to be measured once the opfs driver is in (SR:335-337).

Implicit open items in the text:
- WebKit `move()` behaviour on a real iPhone (SR:177-178), and real iOS generally (SR:214-216).
- The pack size, "64 MiB, to measure", and where big chunks stop going into packs (SR:226-227).
- The S3 GET cost of 1 GB, "the spike measures it" (SR:104-105).
- Cleanup by reachability, deferred to milestone 4 (SR:51).

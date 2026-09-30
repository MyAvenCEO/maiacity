# Our system — the maiaCITY media vault, iroh-native

Decided 2026-09-29. Update this file whenever a decision changes, with the date and why.

## Decisions

| Decision | Why |
|---|---|
| Identity = BLAKE3 hash, 64 hex (iroh `Hash` `Display`). No CIDs. | One hash everywhere; iroh-native. |
| Migrate the whole library off IPFS CIDs, **no aliases, no backward compatibility**. | Samuel: migrate instead of carrying two identities. |
| iroh, not IPFS. | Helia/libp2p proved slow and broken on Bun (14 MB/s bitswap on localhost); iroh is Rust-native and streams whole files verified. |
| **The catalog is an iroh-docs replica on every device — the source of truth for media.** Postgres only mirrors it (2026-09-29). | Samuel: decentralised and resilient, no dependency on a central Postgres; Macs keep syncing peer to peer when the server is down. |
| **Pinning is native:** every full node runs `DownloadPolicy` "everything" on `blobs/` → it fetches every file the catalog names. | The iroh equivalent of IPFS pinning, no sync loop of our own on the Macs. |
| **The server keeps no media on a Volume: Hetzner Object Storage is its content store.** It answers the standard iroh-blobs protocol (`/iroh-bytes/4`) from the bucket with `bao-tree` + `iroh-io`. | Samuel: object storage is the backend. iroh-blobs 0.103 has no S3 store. |
| **Bunny dropped.** The server's HTTP gateway serves every image and video. | One place for the bytes. |
| No n0 services: `presets::Minimal`, our relay, `MemoryLookup`. | Private by design. |
| **No separate relay host (2026-09-29):** the relay runs inside the `vault-server` container (iroh-relay as a library, feature `server`) in the existing `docker-compose.prod.yml`, behind the existing Caddy on `api.maia.city` (`/relay`, `/generate_204`, `/healthz`). Relay URL = `https://api.maia.city`. No new DNS. | Samuel: reuse the maia.city Docker app. Cost: no QAD (it needs TLS owned by the relay) — the server has a static IP, so Mac ↔ server goes direct anyway. |
| **Storage Box deferred (2026-09-29).** Copies for now: every Mac + Object Storage (versioned) + catalog export in the bucket + the Postgres mirror. | Samuel: ignore it for now. |
| **Pilot one day first (2026-09-29):** Day 01 runs the whole workflow end to end, live, before the other 855 files migrate. | Samuel: test the day workflow before migrating everything. |
| **Bunny may be deleted** once the site runs on the gateway (OK given 2026-09-29). | — |
| Checksums end to end at every copy; no scrub or self-repair yet. | Samuel: "just e2e checksum security". |
| No DaVinci; only our studio reads media. The Mac app hosts the studio; ingest is a studio tab. | One studio, native powers on the Mac. |
| **All admin media handling and studio functions are native functions of the Mac app only**, never in the browser build; Mac is the only platform; native Apple frameworks (AVFoundation, VideoToolbox, Metal, the Tauri WebView) replace ffmpeg, OpenColorIO and headless Chrome — no Homebrew (2026-09-29). | Samuel. |
| Browsers never sync; they read over HTTP from the gateway. | iroh in a browser is relay-only through our own server anyway, keeps no data, and `<video>`/`<img>` can't read it directly. |

## The code

```
vault/                         Rust workspace (iroh pinned exactly) · PLAN.md = the task list
  crates/vault-core/           the node: private endpoint (allowlist, relay added at join), FsStore, gossip,
                               iroh-docs catalog (join, describe), three-hash ingest
  crates/vault-media/          native media: probe (AVFoundation), proxies (VideoToolbox HEVC Main10), mp4.rs
                               (comment tag + faststart — AVFoundation drops MPEG-4 metadata)
  crates/vault-server/         the server peer: catalog replica (small entries only), pull from Macs verified chunk by
                               chunk into Object Storage (s3.rs, multipart), every file it holds served back over
                               iroh (cold.rs: a get is held while the file comes up from the bucket into a bounded
                               cache, VAULT_IROH_CACHE_GB), in-process relay, allowlist from Postgres,
                               gateway /vault/files/<hash> (Range), Postgres mirror
  crates/vault-cli/            `vault ingest|ls|id|join|probe|proxy|import-library`
  app/                         maiaCITY Studio (Tauri 2): native commands, vault:// (local, Range), maiaapi:// (API +
                               gateway with the app's key), passkey device-flow sign-in (Keychain), sync.rs (pair,
                               join, keep complete from the gateway), mcp.rs (the studio for agents)
  migration/                   cid-to-blake3.json (old CID → hash, only for rewriting) and rewrite.ts
src/lib/studio/                the studio's Ingest, Library, CopiesBadge, Devices — inside the app only
api/src/vault.ts               pairing, joining, the mirror (migration 0028) — routes /api/vault/*
```

The app's vault lives in `~/Library/Application Support/city.maia.vault`, or where the studio moved it (settings in
`~/Library/Application Support/city.maia.studio/settings.json`; `MAIACITY_VAULT` overrides both).

## Agents (MCP)

The Mac app serves the whole studio as MCP on `127.0.0.1:4545/mcp`, behind a token made once
(`~/Library/Application Support/city.maia.studio/mcp-token`); the Devices & storage panel shows the
`claude mcp add …` command. Tools: vault_status, library_list, library_copies, ingest, library_describe, media_probe,
media_proxy, timelines_list, timeline_save, render_queue, renders_list, content_list, content_create, content_save,
api_call — each the same function the studio's buttons call, acting with the app's key.

## The catalog (iroh-docs namespace "maiaCITY vault")

An entry is `(namespace, author, key) → (BLAKE3 hash, size, timestamp)`, signed by the namespace write key and the
author key. Every full node holds the whole replica; replicas converge by range-based set reconciliation on connect
and live gossip while connected. Per key, the newest timestamp wins (entries > 10 min in the future are rejected →
clocks must be sane).

| Key | Entry content (a blob) | Downloaded by |
|---|---|---|
| `blobs/<hash>` | **the file itself** (content hash = `<hash>`) | every full node → native pinning |
| `meta/<hash>` | a small JSON: kind, mime, size, title, description, tags, public, relations (RAW ↔ proxy ↔ render), original name/path, camera, card, dates, ingest session | every node (tiny) |
| `ingest/<session-id>` | the ingest report JSON: files, source hashes, destination hashes, results | every node |
| `device/<endpoint-id>` | device record: name, author id, capabilities, approved-at — **valid only if authored by the admin author** | every node |
| `tombstone/<hash>` | deletion marker (admin-authored only): nodes drop the pin | every node |

- **Metadata syncs exactly like files**: it *is* a blob, named by its hash, referenced by a catalog entry. Editing
  metadata = writing a new `meta/<hash>` entry pointing to a new JSON blob. Old JSON blobs are history.
- **Files never conflict** (named by content). Only metadata edits can race; newest wins, and the loser is still a
  blob (recoverable).
- **Authors**: each device has its own author key; the server holds the **admin author**, which alone may write
  `device/*` and `tombstone/*`. Nodes ignore those keys from any other author.

## Postgres — a mirror, not the truth

- The server subscribes to the catalog and **projects** it into the Postgres media tables (hash, kind, tags, public,
  relations …) so the website and admin can query fast. Rebuildable from the catalog at any time.
- The web admin never writes media tables directly: an edit goes API → server writes a new `meta/<hash>` entry
  (admin author) → the projection updates Postgres. **One write path: the catalog.**
- Postgres stays the truth for what is not media: users, passkeys, sessions, capabilities, the games, the ledger.
- It is also one more copy of all metadata.

## The pieces

```
  catalog "maiaCITY vault" (iroh-docs): full replica on every node, synced peer to peer
  ─────────────────────────────────────────────────────────────────────────────────────
  Mac A (Tauri, hosts the studio)  ◀═══ iroh ═══▶  Mac B                  Browsers
   iroh-docs replica + iroh-blobs FsStore          same                    ────────
   DownloadPolicy: everything                                              read over HTTP
   Ingest tab: card → verified copy                                        from the gateway;
          ▲                                  ▲                             edits and uploads
          ╚═════════════ iroh ══╦════════════╝                             through the API
                                ▼
  Hetzner server — the always-on peer (Rust, Docker)
   endpoint · our iroh-relay · catalog replica (redb + a small FsStore for meta/ingest/device blobs, system disk)
   content: /iroh-bytes/4 served from and received into Object Storage (bao-tree over S3 range reads)
   policy: pull every blobs/<hash> into the bucket
   HTTP gateway (Range, auth, uploads) · projection → Postgres · nightly catalog export into the bucket
   iroh-relay in-process, behind the existing Caddy on api.maia.city (/relay)
                                │ S3
                                ▼
  Hetzner Object Storage (private, versioning)          (Storage Box mirror: deferred)
   blobs/<hash>             every blob (files AND meta/ingest JSONs)
   outboards/<hash>.obao4   BLAKE3 tree (≈0.39 %)
   catalog/<date>.json      full catalog export (all entries, authors, timestamps)
```

## Where every thing lives — backup matrix

| | Mac(s) | Server | Object Storage | Storage Box | Postgres |
|---|---|---|---|---|---|
| Files (RAW, proxies, renders, images, sounds) | ✅ all | — (streams via bucket) | ✅ | deferred | — |
| Metadata JSONs | ✅ | ✅ | ✅ | deferred | ✅ (projection) |
| Catalog (entries) | ✅ replica | ✅ replica | ✅ nightly export | deferred | ✅ (projection) |
| Ingest reports | ✅ | ✅ | ✅ | deferred | ✅ |
| Node keys, namespace key | Keychain / Docker secret — never in any backup | | | | |

**Restore paths**
- A Mac is lost → a new Mac pairs → catalog + all files sync from the server and other Macs.
- The server is lost → redeploy → the catalog syncs back from any Mac; files are still in the bucket; Postgres is
  rebuilt from the catalog.
- The bucket is lost → the Macs re-push (they hold everything); bucket versioning covers accidental deletes.
- Every catalog replica is broken → rebuild from `catalog/<date>.json`.
- The namespace write key leaks or a device is lost → create a new namespace, import the entries from the export,
  re-pair the good devices.

## Checksums end to end

| Copy | Check |
|---|---|
| Card / SSD → Mac | source hash while reading the card once; destination hash by iroh after import (read uncached); must match |
| Node ↔ node (Mac ↔ Mac, Mac ↔ server) | iroh verifies every 16 KiB group against the hash tree on arrival; bad data never stored |
| Server → bucket | bytes arrive already verified by bao; multipart upload aborted on any failure |
| Web upload → bucket | server hashes while streaming; the object is named by the result |
| Catalog entries | signed (namespace + author), verified on every sync |

## Identity, keys, pairing

- **Root of authority: the admin passkey** on maia.city (WebAuthn, existing capability system). A passkey can't be
  an iroh key (P-256, non-exportable), so it **authorises** keys.
- **Per device**: an Ed25519 endpoint key and an author key, generated on the device (Mac: macOS Keychain; server:
  Docker secret). Never leave the device.
- **Pairing** (existing device flow, `api/src/keys.ts`): the Mac shows a code with its EndpointId + author id → the
  admin approves with the passkey on maia.city → the server (admin author) writes `device/<endpoint-id>` → every node
  now accepts that device (endpoint hooks + relay `access.http` read the device entries), and the server hands the
  Mac the namespace write capability over the encrypted iroh connection.
- **Revoke**: the admin writes a revocation into `device/<id>` → every node drops the device at the connection layer and
  ignores its author's later entries.
- **Infrastructure secrets** (Hetzner API, S3 keys, Storage Box): only on the server and in GitHub secrets.

## Flows

**Ingest (the studio's Ingest tab, Mac)**
1. Detect the source (`/Volumes` watch): label, files, size, dates; skip OS junk.
2. Copy into the store's `temp/` while hashing the bytes read from the card — the source hash. The card is read once.
3. `add_path(ImportMode::Copy)` (APFS reflink) → iroh's destination hash, read uncached.
4. Match → ✅, tag; mismatch → retry once, then ❌ (card never "safe").
5. Write `blobs/<hash>`, `meta/<hash>`, and the session's `ingest/<id>` into the catalog. Duplicates: already in the
   catalog → "already in the vault".
6. The server, pulling everything, fetches it into the bucket (verified). Other Macs fetch it too.
7. **Safe to format** only when every file is ✅ on this Mac **and** in the bucket.

```
┌ Studio ─ [ Edit ]  [ Ingest ] ──────────────────────────────────────────────────────────────┐
│ SOURCES            │ SONY A7IV · 128 GB card                    │ SESSIONS                   │
│ ● A7IV card  98 GB │ 412 files · 97.8 GB · 28–29 Sep            │ Day 20 · A7IV   ✅✅◐      │
│ ○ T7 SSD    1.2 TB │ Tag: [Day 20]  Camera: [A7IV]  Note: [   ] │ Day 19 · Pocket ✅✅✅     │
│ + Choose folder…   │ [ Ingest 412 files ]                       │                            │
│ ⇣ drop files here  │ C0012.MP4  ████████░░ copy+hash  1.1 GB/s  │ ✅ this Mac                │
│                    │ C0011.MP4  ✅ verified  9f86d0…            │ ✅ server  ◐ backup        │
│                    │ 118/412 · 31.2 GB · ~1 min left            │ 1 verified copy — keep card│
└────────────────────┴────────────────────────────────────────────┴────────────────────────────┘
```

In a plain browser the same tab uploads to the gateway (resumable; the server hashes while streaming into the bucket
and writes the catalog entries).

**Sync** — native: catalogs reconcile on connect and gossip live; each Mac's `DownloadPolicy` fetches every
`blobs/*` from any peer that has it (resumable, verified); the server pulls every `blobs/*` into the bucket.
Bandwidth: ~75 % of the uplink by day, full at night (the uplink measured 54 Mbit/s; latency under load 840 ms).

**Delete** — admin-authored `tombstone/<hash>` → nodes drop the pin → GC (protected by the catalog) frees the space.
The bucket keeps versions; the Storage Box keeps its copy until a deliberate prune.

**Scrub / self-repair** — later, not now.

## Our code vs iroh

| Job | Who |
|---|---|
| Connections, encryption, hole punching, relay | iroh |
| Catalog replication (set reconciliation, gossip, signatures) | iroh-docs |
| Content transfer and pinning on the Macs (verified, resumable, ranges) | iroh-blobs + `DownloadPolicy` |
| The server's content store over S3, speaking `/iroh-bytes/4` | us, on `bao-tree` + `iroh-io` |
| Server policy "pull every blob into the bucket" | us (catalog subscription) |
| Card detection, verified copy, ingest reports, the Ingest tab | us |
| Pairing with the passkey, device entries, revocation | us (existing device flow + admin author) |
| Projection catalog → Postgres | us |
| HTTP gateway, web uploads, auth | us (axum in the server) |
| Catalog export into the bucket (Storage Box mirror later) | us |
| Proxies (ffmpeg) | us |

## Phases

| # | Phase | Done when |
|---|---|---|
| 0 | Measurements + spikes: ingest speed on the Mac; Mac → Hetzner (iroh vs `scp`); bucket range reads; iroh-docs between two local nodes; our S3 piece answering `/iroh-bytes/4` for docs downloads; the in-process relay behind Caddy at `/relay` | numbers written down, spikes pass |
| 1 | Mac app: Tauri hosting the studio; `vault-core` (endpoint, FsStore, catalog); the Ingest tab with verified copy; list and playback from the catalog | Day 01 ingests verified, hashes match `b3sum`, the film plays |
| 2 | Server peer in the existing compose: catalog replica, S3 content store, in-process relay, gateway, pairing (device entries), projection → Postgres, nightly catalog export | the Mac pairs with the passkey; Day 01 reaches the bucket by itself; Postgres shows it |
| 3 | **Day 01 pilot, live**: native pinning, bandwidth policy, safe-to-format, web upload; the Day 01 post and its media served from the gateway on the real site (the site resolves 64-hex refs to the gateway, everything else still via the old path until phase 4) | Day 01 works end to end for real visitors; a second node syncs peer to peer with the server stopped |
| 4 | Migration of the other 855 files → catalog + bucket; media bytes out of Postgres; the remaining references rewritten; the temporary two-path lookup removed; Bunny and `ipfs-unixfs-importer` deleted | the whole site runs from the gateway; Bunny deleted |
| 5 | Video: automatic proxies (ffmpeg, Apple hardware); HLS later if needed; watch folder | proxies appear by themselves |
| 6 | Studio editor reads through the catalog everywhere | studio plays from the gateway / local store |
| later | Storage Box mirror; scrub + self-repair; browser iroh | — |

## Open questions

- Hetzner Object Storage traffic and request pricing for serving the site from the bucket (check before phase 4).
- How active iroh-docs development is (0.101, pre-1.0) — the phase 0 spike decides.
- If iroh-blobs bumps its wire protocol (`/iroh-bytes/5`), our S3 piece must follow.

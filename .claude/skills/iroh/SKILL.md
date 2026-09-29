---
name: iroh
description: Everything maiaCITY knows about iroh — the Rust peer-to-peer stack (n0-computer) we use to store, sync and serve all media by BLAKE3 hash. How iroh works (endpoints, EndpointIds, relays, hole punching, address lookup, ALPNs, the Router), iroh-blobs (BLAKE3 blobs, the FsStore, import modes, tags and GC, fetch/push/download, range requests, verified streaming), iroh-docs and iroh-gossip, running it fully private without n0's services (own relay, no public DNS), browsers and the HTTP gateway, and our own architecture on top (the iroh-docs catalog, the Tauri Mac app node, the Hetzner server peer on Object Storage, passkey pairing, backups). Use it whenever work touches iroh, iroh-blobs, iroh-relay, BLAKE3 media hashes, the media vault / Mac app / server node / gateway, footage or RAW ingest, sync between devices, or backups of media — and before writing or reviewing any Rust that uses these crates.
---

# iroh

iroh is a Rust library for **direct, encrypted QUIC connections between devices, dialled by public key**. On top of
it sit protocols; the one we care most about is **iroh-blobs**: content-addressed blobs named by their **BLAKE3
hash**, moved with verified streaming. We use it as the engine of the maiaCITY media system: every image, sound, film,
proxy and RAW file is a blob, known only by its hash.

It is *not* IPFS. It started as a Rust IPFS in 2022 and left IPFS in 2023 on purpose: no global DHT, no UnixFS, no
bitswap, no CIDs. What it kept is the idea — content addressing — and what it replaced is the slow part: block-by-block
transfer. A file moves as one verified stream.

## The laws (never break them)

1. **A file's identity is its BLAKE3 hash, 64 lowercase hex chars — exactly iroh's `Hash` `Display`.** No CIDs, no
   paths, no names. `b3sum`, the `blake3` crate, noble-hashes and iroh all agree (verified: `Hash::new = blake3::hash`).
   → `blobs.md`
2. **No dependency on n0's services.** Never use `presets::N0`, `RelayMode::Default`/`Staging`, `dns.iroh.link` or n0
   relays. Build endpoints from `presets::Minimal` with our own relay and our own address lookup. → `connectivity.md`
3. **Only our own endpoints get in.** Every node filters by EndpointId (endpoint hooks + blobs event interception),
   and our relay runs with `access.allowlist`. The allowlist is approved with the admin passkey. → `connectivity.md`,
   `maiacity.md`
4. **The catalog is an iroh-docs replica on every node — the truth for media.** `blobs/<hash>` entries pin files
   natively (`DownloadPolicy`), `meta/<hash>` entries carry metadata as blobs. Postgres only mirrors the catalog for
   the website; every media write goes through the catalog. → `protocols.md`, `maiacity.md`
5. **Nothing is deleted by accident.** Deletion in iroh-blobs happens only through GC, protected by the catalog;
   only an admin-authored `tombstone/<hash>` unpins. The bucket (versioned) is never touched by GC.
   → `blobs.md`
6. **iroh-blobs is pre-1.0 and says so.** Pin exact versions, wrap it behind our own small module, and benchmark
   before trusting a number. → `gotchas.md`

## The sub-files — load the one the work needs

| File | What it covers |
|---|---|
| `concepts.md` | The mental model: Endpoint, SecretKey/EndpointId, EndpointAddr, relays, hole punching, address lookup, ALPN, Router and ProtocolHandler, connections and streams, tickets. Glossary against IPFS. |
| `connectivity.md` | Building a private endpoint (no n0), relay modes, address lookup options, persisting keys, hooks for allowlisting, paths (direct vs relayed), firewall and ports, what the relay can see. Code. |
| `blobs.md` | iroh-blobs in depth: hash, FsStore on-disk layout, inlining, outboards, import modes (Copy/reflink vs TryReference), tags and GC, get/fetch/push/Downloader, ranges and resume, BlobReader (AsyncRead+AsyncSeek), provider events for access control, HashSeq/collections. Code. |
| `protocols.md` | iroh-docs (our catalog), iroh-gossip, irpc and the rest — what each is for, maturity. |
| `self-hosting.md` | Running iroh-relay (config, TLS, ports, access control, metrics), iroh-dns-server (and why we skip it), Docker on Hetzner. |
| `browser.md` | iroh in the browser (WASM, relay-only, memory store) and why web clients use our HTTP gateway instead; gateway design with Range, auth and verification. |
| `maiacity.md` | Our system: Mac app node, server node, web clients, backups, identity and passkey pairing, what is iroh's job vs ours, phases, open decisions. |
| `gotchas.md` | Known issues, version churn, throughput numbers, the checklist before trusting anything, benchmarks to run. |

## Versions (as of 2026-09-29)

| Crate | Version | Stability |
|---|---|---|
| `iroh`, `iroh-base`, `iroh-relay`, `iroh-dns-server` | 1.3.0 | 1.x: wire-compatible within a major and with the previous one; a major gets 1 year of support, a minor 3 months |
| `iroh-tickets` | 1.0.0 | stable |
| `iroh-blobs` | 0.103.0 | **"not yet considered production quality"** (its README); breaking release about monthly |
| `iroh-docs`, `iroh-gossip` | 0.101.0 | 0.x |
| `bao-tree` | 0.16.1 | used by iroh-blobs for verified streaming |
| QUIC under iroh | `noq` 1.3 | n0's QUIC stack (a quinn derivative) |

Licence: MIT OR Apache-2.0 everywhere. Rust ≥ 1.91 for iroh-blobs.

Source of truth when docs disagree: the crate source in `~/.cargo/registry/src/*/iroh-*/`. The docs site
(docs.iroh.computer, full text at `/llms-full.txt`) still shows old names in places — *discovery* is now
**address lookup**, *NodeId/NodeAddr* are now **EndpointId/EndpointAddr**.

## How to work with this skill

- Writing iroh code: read `concepts.md` once, then the file for the task. Check every method name against the
  source of the pinned version before relying on it (the API moves).
- Designing or changing the system: `maiacity.md` first — it records decisions and why.
- Anything marked **UNVERIFIED** in these files must be tested before it carries weight.

# maiaCITY Studio + media vault — the task list

Everything Samuel asked for, in order, with where it stands. Design and reasons: `.claude/skills/iroh/maiacity.md`.
Status: ✅ done · 🔨 in progress · ⏳ next · 💤 deferred on purpose.  Last update: 2026-09-29, 17:45.

## Done

1. ✅ Footage/RAW workflow and backup design — private, IPFS weighed, iroh chosen.
2. ✅ The iroh skill (`.claude/skills/iroh/`), updated with every decision.
3. ✅ Upload measured: 54 Mbit/s up, 133 down, 840 ms latency under load.
4. ✅ Vault core (`vault/crates/vault-core`): BLAKE3 identity, private iroh node, iroh-docs catalog, three-hash
   ingest (source = disk = iroh). Day 01: 20 files, 1.08 GB, 0 mismatches, 361 MB/s.
5. ✅ maiaCITY Studio, the Tauri Mac app (`vault/app`), this Mac's SSD as the first node.
6. ✅ Ingest from card, SSD or folder (drop too), checked end to end; duplicates recognised.
7. ✅ The app talks to the production API.
8. ✅ Admin gate + passkey sign-in through the device flow; key in the macOS Keychain.
9. ✅ Database backups to `s3://maiacity/BACKUPS/pg/`: before every deploy (without media bytes) and daily,
   30 days, unencrypted; a failed backup warns instead of stopping a release.
10. ✅ Release 1 (PR #10), deploy fix (PR #11), release 2 (PR #12) — all live. Release 3 (PR #13) merged; its API
    run was refused by GitHub (a duplicated key in the workflow) — fixed in release 3b, linted with actionlint.
11. ✅ Work from a fresh worktree on the latest `main` (`aven/studio-native`).
12. ✅ One studio app: Ingest · Library · Edit · Grade · Render tabs; the Mac app opens on the studio.
13. ✅ Studio and media library only in the Mac app; native API calls with the app's key; /api/me answers keys.
14. a) ✅ Native probe (AVFoundation) and movie proxies (HEVC Main10 in hardware, 1920, GOP 15, BT.709, AAC,
   comment tag + faststart by our own MP4 step) — to spec, Day 01 decodes clean.

## In progress

16. 🔨 **Server peer** `vault-server` (written, compiles, Linux image builds):
    - ✅ S3 content store (multipart, ranges), pull from Macs verified chunk by chunk straight into `LIBRARY/`
    - ✅ in-process iroh relay (Caddy `/relay`), allowlist from Postgres (paired devices only)
    - ✅ HTTP gateway `/vault/files/<hash>` (Range; public without login, private with the app's key)
    - ✅ Postgres mirror (`vault_files`), `vault_devices`, `vault_config` (migration 0028) + API routes + tests
    - ✅ Docker (`vault/Dockerfile.server`), compose service (profile `vault`), Caddy routes, CI image job,
      firewall UDP 7400, deploy env
    - ✅ local end-to-end test of the iroh path (local Postgres, no S3): pairing, relay, joining, catalog sync, mirror
    - ✅ live: the vault container runs (release 3b); the pre-deploy backup reaches the bucket (589 KB, no media)
    - 🔨 release 3c: Caddy reloads its routes (/relay, /vault/*) — then the bucket path tested live
17. 🔨 **Automatic sync**: ✅ Mac side of joining (allowlist, relay at runtime, shared catalog, own entries carried
    over); ✅ the app pairs and joins by itself after sign-in; ✅ files only the server holds come down from the
    gateway, hash-checked, into the store; ⏳ bandwidth policy (~75 % by day); ⏳ "safe to
    format" at two copies; ⏳ watch folder; ⏳ web upload.

## Next

24. ✅ **Copies view per file** in Library and Ingest: this Mac (verified / partial / missing) and the server's Object
    Storage (stored / syncing), live; "safe to format" once every file of a batch has two verified copies.
25. ✅ **Devices & storage**: panel with the paired devices (only these sync; revoke any), this Mac's store, the
    server; the vault moves to another drive (the external SSD — same node, fills itself from the network).
    Defaults: the server (Object Storage) + this Mac's SSD.
26. 🔨 **Media bytes out of Postgres**: ✅ (a) all 541 production files (6.6 GB) exist in `library/` and re-hash to
    their CID; ✅ backups without media bytes; ⏳ (b) empty `media_chunks` — Samuel decided: **right after the vault
    serves the files** (after 19).
18. ⏳ **Day 01 pilot, live**: served from the gateway on the real site.
19. 🔨 **Migrate the library**: ✅ all 856 files in this Mac's vault (8.52 GB, 36 s, 0 mismatches); ✅ CID → hash map
    and rewrite tool; ✅ the site reads hashes (gateway) and plays vault films from it; ⏳ Day 01 references rewritten
    (ready, held back until the server holds the files); ⏳ the rest after the pilot; ⏳ `ipfs-unixfs-importer` removed.
20. ⏳ **Delete Bunny** (CDN + Stream) once the site runs from the gateway (Samuel said yes).
14. b) ⏳ colour transforms and LUTs in Rust (input transforms, ACEScct, the ACES 2.0 output transform), stills proxies
    c) ⏳ render: Metal compositing, audio mix, captions, loudness QC (`ebur128`)
    d) ⏳ world plates and hero frames in the app's own WebView
15. ⏳ **Render test run**: Day 19 world timeline, an Apple Log 2 clip, Edit → Lock → Grade → Render — natively.
21. ⏳ Automatic proxies for RAW (the render worker's proxy jobs, run by the app); HLS later if needed.
23. 🔨 **MCP control of the whole studio**: ✅ MCP server inside the Mac app (127.0.0.1:4545/mcp, token-gated, acts
    with the app's key) with tools: vault_status, library_list, library_copies, ingest, library_describe
    (enrichment), media_probe, media_proxy, timelines_list, timeline_save, render_queue, renders_list, content_list,
    content_create, content_save (draft → publish), api_call; ✅ the connect command in the Devices panel;
    ⏳ tested from Claude Code once the new app runs; ⏳ native grade/render tools with 14b–c.
22. ⏳ A `main` release after each step; the last when everything is in.

## Deferred on purpose

- 💤 Storage Box mirror.
- 💤 Scrub and self-repair (checksums at every copy are in).
- 💤 iroh in the browser.

## Open

- Bucket `maiacity` is in hel1, the server in nbg1: fine for backups; the library gets ~25 ms extra per request.
- This Mac has 28 GB free: footage needs the external SSD soon.

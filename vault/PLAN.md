# maiaCITY Studio + media vault — the task list

Everything Samuel asked for, in order, with where it stands. Design and reasons: `.claude/skills/iroh/maiacity.md`.
Status: ✅ done · 🔨 in progress · ⏳ next · 💤 deferred on purpose.  Last update: 2026-09-30, 03:05.

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
    - ✅ release 3c: Caddy reloads its routes — the gateway (`/vault/health` ok) and the relay (`/generate_204`) are live
    - ✅ this Mac paired itself ("maiaCITY Studio · MacBook Air von Samuel") and reaches the server
    - ✅ release 3d/3e: the server's catalog accepts syncs; it reaches the Macs through the relay — files flow into
      Object Storage (first ones stored, verified, 448 MB in one piece)
    - ✅ release 4: descriptions the server missed while the Mac was unreachable are fetched again — mirror 856/856
    - ✅ release 5: descriptions mirror in their own loop, as soon as they change (and replace the bucket's copy)
    - ✅ release 6/7: one connection per device, parts in flight, small files in one PUT; speed + path logged
      (direct, ~50 ms) — ~2 MB/s per stream by day; compare at night without the day limit
    - 🔨 Object Storage filling: 434/856 files (5.0 of 8.5 GB) at 18:56
17. 🔨 **Automatic sync**: ✅ the session lives in a user-only file (no more Keychain prompts); ✅ the Mac re-joins every
    30 s; ✅ Mac side of joining (allowlist, relay at runtime, shared catalog, own entries carried
    over); ✅ the app pairs and joins by itself after sign-in; ✅ files only the server holds come down from the
    gateway, hash-checked, into the store; ✅ bandwidth policy (~75 % of the uplink 08–22, all
    of it at night); ✅ "safe to format" at two copies (24); ✅ watch folder `~/Movies/maiaCITY Inbox`
    (ingest, move to `ingested/`, proxy); 💤 web upload (not needed for now — Samuel).

## Next

24. ✅ **Copies view per file** in Library and Ingest: this Mac (verified / partial / missing) and the server's Object
    Storage (stored / syncing), live; "safe to format" once every file of a batch has two verified copies.
25. ✅ **Devices & storage**: panel with the paired devices (only these sync; revoke any), this Mac's store, the
    server; the vault moves to another drive (the external SSD — same node, fills itself from the network).
    Defaults: the server (Object Storage) + this Mac's SSD.
26. 🔨 **Media bytes out of Postgres**: ✅ (a) all 541 production files (6.6 GB) exist in `library/` and re-hash to
    their CID; ✅ backups without media bytes; ✅ nothing reads them any more (19b); ⏳ (b) the old tables
    (`media`, `media_chunks`, `media_tags`, `uploads`, `upload_chunks`) dropped once 19b is verified live.
18. ✅ **Day 01 pilot**: its files by hash; the gateway serves all 11 public ones without a login, each re-hashed to
    its name; the 9×16 frame stays private; the built page loads images and the film from the gateway (release 8).
    Day 01 itself is still a draft — publishing it is Samuel's call.
19. 🔨 **Migrate the library**: ✅ all 856 files in this Mac's vault (8.52 GB, 36 s, 0 mismatches); ✅ CID → hash map
    and rewrite tool; ✅ the site reads hashes (gateway) and plays vault films from it; ✅ every page, post and film
    script rewritten (391 references to 279 files; privacy as library/ had it); ✅ released (all 856 in the bucket);
    ✅ `ipfs-unixfs-importer` and `multiformats` removed; ✅ the catalog's own meta free of CIDs.
    b) 🔨 **the database off CIDs** (release 11): migration 0029 rewrites every CID in timelines, shots, content, render
       jobs to its hash (`cid` → `hash`; rolls back on an unknown one); `/api/media*` and the Bunny uploads are gone; the
       studio reads the vault (`vault_list`, `vault://`, `vault_describe`, native proxy remake); the render worker reads
       and adds files through the app's local vault routes (127.0.0.1:4545/vault/*, the MCP token). API 96 tests green.
       Day 19 **W · World** (G with 42 live world shots, config only) is on production.
20. 🔨 **Off Bunny**: ✅ media from the vault (no Bunny uploads); ✅ the site served by the server's Caddy
    (`site/releases/<commit>`, `site/current`), deployed over SSH by CI; ⏳ **Samuel: point maia.city and www.maia.city
    at 188.245.31.46 (A records, Hetzner DNS; www's CNAME to Bunny goes)** — until then CI keeps Bunny current too;
    ⏳ then the Bunny account (CDN, storage, Stream) closed by Samuel. No published post streams from Bunny.
14. b) ✅ colour transforms in Rust, one model: ✅ every source through its journey into ACEScct (`cst.rs`, within 1e-5
    of OCIO; Rec.709 and sRGB as camera curves — Samuel's call: the new workflow wins); ✅ on the GPU in the proxies;
    ✅ the viewer's input LUTs baked by the Mac from `cst`; ✅ legacy deleted (inverse ODT, display bypass, `legacy`
    profile, worker file proxies, the worker's preview LUTs and /api/film/luts, the viewer's formula fallback); ✅ the
    ACES 2.0 output transform native (`aces2.rs`): within 0.07 of a 10-bit code of OCIO 2.5.2 (3158 points), the
    worker's baked LUT to median 0.006 — the Mac bakes every viewer LUT (`color_lut`)
    c) 🔨 render natively (`vault-render`): ✅ Metal compositing, grades, output transform, world plates, audio mix,
    EBU R128 loudness, captions, the render report; ✅ EXR sequences frame by frame from their tar; ✅ **the Mac app is
    the render worker** (`app/src/render.rs`): claims `render` and `frame` jobs with its key, shares the proxies' turn
    (one heavy GPU job, after an ingest, memory normal, uploads held: `hold: render`), world plates at each shape's size
    in its own unseen world (cached in `<vault>/plates`), deliveries into the vault (class delivery, the timeline's
    story), the same job report (checked against `reportRender` by `vault_render::api_accepts`), levelled to
    `LOUDNESS` (−14 LUFS / −1 dBTP); ✅ the bun/ffmpeg worker is gone (worker.ts, picture/plates/qc/sources.mjs,
    color/ffmpeg.mjs, bake.py, measure.mjs, `bun film`); ⏳ tested end to end on Day 19 (15)
    d) ✅ world-shot proxies in the app's own WebView (WebGL on Metal): film-mode frames, 10-bit ACEScct, over IPC into
    a native HEVC writer; tested (shot 0ad195cd v1); the worker's shot-proxy path and the API's queueing are gone;
    later: the world on three's WebGPURenderer (4 custom GLSL shaders to port)
15. ⏳ **Render test run**: Day 19 world timeline, an Apple Log 2 clip, Edit → Lock → Grade → Render — natively, the
    Mac app taking the job (Render tab or MCP `render_queue`), plates rendered in its world, deliveries in the vault.
21. ✅ **Automatic proxies**: ✅ every video original gets one, all in ACEScct: probed, its colour told (the
    sample description's `logs` atom too — Apple Log 2 from the Blackmagic app), YCbCr → journey → Lanczos on the GPU,
    HEVC Main10 in hardware, 1.7× real time for 4K on this Mac, mean error 0.0002 ACEScct against the CPU reference;
    queued one at a time, filed beside the original (same story, class proxy, synced A/B/C); a source without a
    journey waits and says so; ✅ stills (a float still or one larger than HD → 16-bit ACEScct PNG) and EXR sequences
    (tar → HEVC) natively; failed ones tried 3×; paced by macOS memory pressure; HLS later if needed.
23. 🔨 **MCP control of the whole studio**: ✅ MCP server inside the Mac app (127.0.0.1:4545/mcp, token-gated, acts
    with the app's key) with tools: vault_status, library_list, library_copies, ingest, library_describe
    (enrichment), media_probe, media_proxy (queues the same pipeline), timelines_list, timeline_save, render_queue, renders_list, content_list,
    content_create, content_save (draft → publish), api_call; ✅ the connect command in the Devices panel;
    ✅ tested over MCP (401 without the token; 15 tools; vault_status and library_list answer); ✅ grade_clip,
    grade_film; ✅ render_queue / renders_list rendered natively by the app itself, render_frame (a hero frame at t
    and shape); ⏳ tested over MCP end to end with 15.
22. ⏳ A `main` release after each step; the last when everything is in.

## Deferred on purpose

- 💤 Storage Box mirror.
- 💤 Scrub and self-repair (checksums at every copy are in).
- 💤 iroh in the browser.

## Open

- Bucket `maiacity` is in hel1, the server in nbg1: fine for backups; the library gets ~25 ms extra per request.
- This Mac has 28 GB free: footage needs the external SSD soon.

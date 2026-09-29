# maiaCITY Studio + media vault — the task list

Everything Samuel asked for (2026-09-29), in order. Design and reasons: `.claude/skills/iroh/maiacity.md`.
Status: ✅ done · 🔨 in progress · ⏳ next · 💤 deferred on purpose.

## Done

1. ✅ Footage/RAW workflow and backup design — private, IPFS weighed, iroh chosen.
2. ✅ The iroh skill (`.claude/skills/iroh/`) — how iroh works, and our design; updated with every decision.
3. ✅ Upload measured: 54 Mbit/s up, 133 down, 840 ms latency under load.
4. ✅ Vault core (`vault/crates/vault-core`): BLAKE3 identity, iroh node without n0 services, iroh-docs catalog,
   ingest that checks three hashes (source = disk = iroh). Day 01: 20 files, 1.08 GB, 0 mismatches, 361 MB/s.
5. ✅ maiaCITY Studio, the Tauri Mac app (`vault/app`), with this Mac's internal SSD as the first iroh node.
6. ✅ Ingest from a card, SSD or folder (drop too), checked end to end; duplicates recognised.
7. ✅ The app talks to the production API (`api.maia.city`).
8. ✅ Admin gate + sign-in with the passkey through the device flow; key in the macOS Keychain.
9. ✅ Database backups: `deploy/backup.sh` → `s3://maiacity/BACKUPS/pg/`, before every deploy and daily 03:15 UTC,
   30 days, unencrypted (as asked). In `main` with PR #10.
10. ✅ Release 1: PR #10 merged into `main` (4650c28).

## Next

11. ✅ Work continues from a fresh worktree on the latest `main` (branch `aven/studio-native`).
12. ✅ **One studio app**: Ingest and Library become tabs beside Edit · Grade · Render; the Mac app *is* the studio;
    the studio's API calls go through the app (native, with its key).
13. ✅ **Admin and studio functions native only**: studio/admin media pages leave the browser build.
14. 🔨 **Native render engine, Mac-only, no Homebrew** (replacing ffmpeg + zimg, OpenColorIO/Python, headless Chrome):
    - a) ✅ probe (AVFoundation) and movie proxies — byte-for-byte to spec, comment tag + faststart via our own MP4 step; stills proxies follow with b) (AVAssetReader → Core Image → VideoToolbox HEVC Main10,
      long edge 1920, GOP 15, BT.709 tags) — `vault/crates/vault-media`
    - b) ⏳ colour transforms and LUTs in Rust (input transforms, ACEScct, the ACES 2.0 output transform)
    - c) ⏳ render: Metal compositing, audio mix, captions, loudness QC (`ebur128`)
    - d) ⏳ world plates and hero frames in the app's own WebView
15. ⏳ **Render test run** (from the film-pipeline session): Day 19 world timeline, an Apple Log 2 clip,
    Edit → Lock → Grade → Render — on the native engine.
16. ⏳ **Server peer** in the existing Docker app: catalog replica, content store on Object Storage (`LIBRARY/`),
    iroh relay inside the container behind Caddy on `api.maia.city`, HTTP gateway (Range, auth), Postgres mirror.
17. ⏳ **Automatic sync**: native pinning between Mac and server, bandwidth ~75 % by day, "safe to format" at two
    copies, watch folder, web upload.
18. ⏳ **Day 01 pilot, live**: served from the gateway on the real site.
19. ⏳ **Migrate the other 855 files** to BLAKE3; media bytes out of Postgres; references rewritten;
    `ipfs-unixfs-importer` removed.
20. ⏳ **Delete Bunny** (CDN + Stream) once the site runs from the gateway (Samuel said yes).
21. ⏳ Automatic proxies for RAW; HLS later if needed.
22. ⏳ A `main` release after each step; the last when everything is in.

## Deferred on purpose

- 💤 Storage Box mirror.
- 💤 Scrub and self-repair (checksums at every copy are in).
- 💤 iroh in the browser.

## Open

- Bucket `maiacity` is in hel1, the server in nbg1: fine for backups; the library gets ~25 ms extra per request.
- The Mac has 28 GB free: footage needs an external SSD.

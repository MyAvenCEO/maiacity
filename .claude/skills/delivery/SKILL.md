---
name: delivery
description: Delivery of maiaCITY's stories to every platform — the exact rules each one enforces and what it recommends, per post type (YouTube video, Short, thumbnail; Instagram Reel, photo, carousel, Story; TikTok video and photo post; X post, images, video, thread, Article; Bluesky post, images, video, thread; LinkedIn post, images, video, document, poll), the best file to render for each, our render targets, and the exact Zernio API request that publishes it. Use it whenever a film or post is rendered for, checked against, or published to a platform, when a render setting or a delivery shape is chosen, or when anything is sent through Zernio.
---

# Delivery

A story is finished once: the long-form article, then the 4K master film. Everything a platform gets is derived from
those two, and each platform gets the best file it can take, never a file it will reject or squeeze again. This skill
holds what each platform enforces, what it recommends, the file to render for it and the Zernio request that sends it.

| File | What it holds |
|---|---|
| `platforms.md` | Every platform and post type: the hard limits, the file to send, the Zernio request |
| `zernio.md` | The Zernio API: accounts, upload, the post request, scheduling, results, webhooks, validation, limits, cost |
| `sources.md` | Where every figure comes from, how sure it is, and what to confirm before relying on it |

## The laws

1. **The binding limit is the stricter of the platform and Zernio.** We publish through Zernio; when its documented
   limit is below the platform's own (Instagram Reels 90 s against Instagram's 15 min, Bluesky video 60 s / 50 MB
   against Bluesky's 10 min / 300 MB, X video 140 s / 512 MB against X's 20 min / 8 GB), Zernio's limit is the rule
   until Zernio raises it.
2. **Nothing is re-encoded on the way.** Zernio re-compresses anything over a platform's threshold (images over 5 MB
   for X, 8 MB for Instagram, 1 MB for Bluesky; video over 512 MB for X, 100 MB for Instagram Stories) and never
   changes the shape or the codec. Every file we send is already inside every threshold and in the platform's own
   shape, so the platform's encode is the only one after ours.
3. **One encode recipe for every video:** MP4 with its index in front (faststart), H.264 High (HEVC Main10 for the
   YouTube master), progressive, closed GOP, 4:2:0, SDR BT.709 limited range, a constant 30 fps, AAC-LC 48 kHz
   stereo. No platform's API documents HDR uploads: we deliver SDR everywhere.
4. **Render each shape natively.** A 9:16 is cut and framed for 9:16 (the grade's shape switcher), never a crop or a
   letterbox of the 16:9. No baked-in bars anywhere.
5. **Text keeps out of the platform's own buttons.** On a 9:16 frame: about 14 % free at the top, 35 % at the foot,
   6 % at each side (Meta's Reels safe zone, the strictest published); a Reel cover's words inside the centre
   1080×1440 (Instagram's profile grid shows that much).
6. **Check before sending:** `POST /v1/tools/validate/post` with the exact request (a dry run), and the file's size
   against `platforms.md`. Zernio's media check (`/v1/tools/validate/media`) knows only size and type.
7. **Write down what changed.** Platforms change their limits every few months (X on 1 Sep 2026, Bluesky in Aug 2026,
   YouTube's thumbnails in Oct 2025). A figure that turns out wrong is fixed here, with its source and date, in
   `sources.md`.

## Our render targets (vault-render)

What the Mac app renders today (`vault/crates/vault-render/src/render.rs`, `files_for`; `timeline.rs`, `Shape`):

| Delivery | File | For | Within every limit? |
|---|---|---|---|
| `youtube-4k` (the studio's one-click render) | 3840×2160, HEVC Main10, 80 Mb/s, keyframe every 1 s, AAC 384 kb/s 48 kHz, −14 LUFS / −1 dBTP, faststart | YouTube video | Yes. 80 Mb/s is above YouTube's 35–45 Mb/s, so its own encode starts cleaner. At 80 Mb/s a film reaches Zernio's 5 GB upload at about 8 min 20 s: longer films go as a vault-gateway URL (Zernio fetches any public HTTPS URL), or render at 45 Mb/s (about 15 min in 5 GB). |
| 16:9 master + copy (every delivery) | 4K HEVC Main10 50 Mb/s, plus 1920×1080 H.264 ≤ 20 Mb/s, AAC 192 kb/s | YouTube; X, LinkedIn | Yes. The copy's 20 Mb/s: X allows 25, LinkedIn 30; a 140 s X video at 20 Mb/s is about 350 MB (under 512). LinkedIn's API caps a file at 500 MB: at 20 Mb/s that is about 3 min 20 s — longer LinkedIn films need about 10 Mb/s. |
| 9:16 | 1080×1920 H.264 ≤ 12 Mb/s, AAC 192 kb/s | Instagram Reel; YouTube Short when ≤ 3 min | Yes. Instagram's API takes ≤ 25 Mb/s and ≤ 300 MB: a Reel of ≤ 90 s may go at 20–25 Mb/s. TikTok takes the same file. Bluesky needs its own ≤ 60 s, ≤ 50 MB cut. Instagram's API names AAC at 128 kb/s. |
| 1:1, 4:5 | 1080 wide H.264 ≤ 20 Mb/s | Instagram "feed" video | **Not needed:** Instagram's API publishes every video as a Reel (`shareToFeed` puts it on the grid). 4:5 is for photos and carousel slides. |
| Title cards (`scripts/film/thumbnail.mjs`) | 16:9, 9:16, 1:1, 5:2 | Thumbnails, Reel cover, feeds, X Article cover | YouTube's thumbnail through Zernio must be ≤ 2 MB (JPEG/PNG). |

The YouTube master is checked against YouTube's own recommendations, and holds: MP4 with the index in front
(`vault_media::mp4::finish`), HEVC Main10 (accepted; YouTube's H.264 GOP rule of half the frame rate is for H.264),
BT.709 tags, limited range, 48 kHz AAC at 384 kb/s, −14 LUFS (YouTube's own loudness target). AVAssetWriter writes an
edit list for the audio's priming; YouTube and Instagram both say "no edit lists" — fine on YouTube so far, to watch
on Instagram's API.

## The order a story is delivered in

1. **The journal first**: the article on maia.city with the film at its head (the publish step, not Zernio).
2. **YouTube**: the 4K master, its title (≤ 100 characters), description (≤ 5,000), tags, the 16:9 thumbnail, made-for-kids
   always set.
3. **The derivatives** (`content-derivatives`): each platform's post from the article, each with its own file from
   the table above, scheduled on the story's calendar.
4. **The links**: each platform's `platformPostUrl` (Zernio's webhook or `GET /v1/posts/{id}`) on the story's
   Published step.

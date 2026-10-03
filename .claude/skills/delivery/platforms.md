# Every platform, every post type

As of 3 Oct 2026. **Hard** is what gets a post rejected (or cropped, rescaled, ignored, as said); it is the stricter of
the platform and Zernio, since we publish through Zernio. **Send** is the best file to render. **Zernio** is the
request: every row goes in `POST /v1/posts` (`zernio.md`), options in `platforms[i].platformSpecificData`. A † marks a
figure that is unofficial or not confirmed from the platform's own page (`sources.md`).

Every video below uses the one recipe (`SKILL.md`, law 3): MP4 faststart, H.264 High, progressive, closed GOP, 4:2:0,
SDR BT.709 limited range, constant 30 fps, AAC-LC 48 kHz stereo.

## YouTube — `youtube`

| Post | Hard | Send | Zernio |
|---|---|---|---|
| Video | ≤ 256 GB and ≤ 12 h (15 min until the channel is phone-verified). Through Zernio's own upload ≤ 5 GB (presign); larger only as our own public URL. Title 1–100 characters, no `<` `>`†; description ≤ 5,000 bytes†; tags ≤ 500 characters in all, each ≤ 100. Any shape: the player adapts (vertical gets padding on desktop). | 3840×2160 16:9, 30 fps, H.264 High or HEVC Main10, SDR **35–45 Mb/s** (HDR 44–56), AAC 384 kb/s. 1080p: 8 Mb/s (12 at 50/60 fps). No baked bars. | One `{type:"video", url, thumbnail}`. `title`, `visibility` (`public` · `private` · `unlisted`), **`madeForKids` always set**, `categoryId` (default `"22"`), `playlistId`, `firstComment` (≤ 10,000), `containsSyntheticMedia`. The description is `customContent` (cut at 5,000); tags are top-level `tags`. |
| Short | **Square or vertical and ≤ 3:00 is a Short, automatically**; anything landscape or longer is a video. No flag exists. Plays at ≤ 1080p. Claimed music: Audio Library tracks ≤ 90 s (some 60 or 30). | 1080×1920 9:16, 30 fps, 8–12 Mb/s | Same as a video. **No custom thumbnail through Zernio** (Shorts thumbnails: Studio on a computer, Partner Program only since Jul 2026). |
| Thumbnail | YouTube: JPEG/PNG (API: no GIF), ≥ 640 px wide, ≤ 50 MB. **Zernio rejects > 2 MB.** Needs a verified channel. | 1920×1080 JPEG < 2 MB (YouTube recommends 3840×2160, which Zernio can't carry) | `mediaItems[0].thumbnail` (URL) |
| Captions | YouTube: .srt, .sbv, .vtt, .ttml, .scc and more (API ≤ 100 MB) | .srt | Not in Zernio: upload in Studio |
| Community post (images, polls, quiz) | **Not in YouTube's API**, so not in Zernio | — | — |

HDR on YouTube: 10/12-bit, Rec. 2020, PQ or HLG, tagged (PQ with ST 2086 and MaxCLL/MaxFALL); HEVC, AV1 or VP9.2.
Daily API quota: about 6 uploads per Google project (10,000 units, 1,600 per upload)† — Zernio carries its own.
Scheduled public videos go up to 15 min early as private, with YouTube's own release time.

## Instagram — `instagram` (Business or Creator account)

| Post | Hard | Send | Zernio |
|---|---|---|---|
| Reel | MP4/MOV, index in front, **no edit lists**, H.264 or HEVC, progressive, closed GOP, 4:2:0. **≤ 1920 px wide, 23–60 fps (the app: ≥ 30), ≤ 25 Mb/s VBR, ≤ 300 MB.** AAC ≤ 48 kHz, 1–2 channels. Instagram's API: 3 s–15 min; **Zernio documents 3–90 s.** Recommended to new audiences only when ≤ 3 min. | 1080×1920 9:16, 30 fps, ≤ 25 Mb/s and inside 300 MB (90 s at 25 Mb/s ≈ 281 MB; 3 min needs ≤ 12 Mb/s), AAC 128 kb/s. Safe zone 14 % top, 35 % foot, 6 % sides. | One `{type:"video"}`. **`shareToFeed: true`** (default), `instagramThumbnail` (or `thumbOffset` in ms), `collaborators` (≤ 3), `firstComment`, `userTags`, `audioName`, `trialParams{graduationStrategy}`, `isAiGenerated`, `commentsEnabled`, `locationId` |
| Reel cover | JPEG, sRGB, ≤ 8 MB; not 9:16 is cropped to its centre 9:16 | 1080×1920 JPEG, its words inside the centre 1080×1440 (the profile grid's vertical tile, 3:4†) | `instagramThumbnail` |
| Feed video | **Gone from the API:** every video is a Reel (`media_type=VIDEO` is deprecated) | No separate render: the Reel with `shareToFeed` | — |
| Photo | **JPEG only, ≤ 8 MB, 4:5 to 1.91:1** (3:4 is rejected by the API); 320–1440 px wide, stored at ≤ 1080; other colour spaces made sRGB | 1080×1350 (4:5) sRGB JPEG | One `{type:"image", altText}` |
| Carousel | **2–10 items** through the API (20 in the app), images and/or videos, no Reels; all cropped to the **first item's** shape (1:1 by default); counts as one post | Every slide 1080×1350 (4:5); a video slide in the Reel recipe, ≤ 60 s† | 2–10 `mediaItems`; per slide `userTags[].mediaIndex` |
| Story | Image: JPEG ≤ 8 MB. Video: **3–60 s, ≤ 100 MB**, ≤ 25 Mb/s, ≤ 1920 px wide. No link, poll or location stickers through the API; no caption; gone after 24 h. | 1080×1920; video at about 10 Mb/s | `contentType: "story"` and one media item |
| Text | Caption ≤ 2,200 characters, ≤ 20 @mentions. **Only 5 hashtags count since Dec 2025**† (official pages still say 30). ≤ 100 API posts per rolling 24 h (`GET /v1/accounts/{id}/instagram/publishing-limit`). | — | `customContent` |

## TikTok — `tiktok`

Required on every TikTok post: `privacyLevel` (one of `GET /v1/accounts/{id}/tiktok/creator-info`'s options),
`allowComment`, and for video `allowDuet` and `allowStitch`, plus `contentPreviewConfirmed: true` and
`expressConsentGiven: true`. Business-app accounts post **public only** (private only as a `draft` to the Creator
Inbox). 15 videos and 15 photo posts a day.

| Post | Hard | Send | Zernio |
|---|---|---|---|
| Video | MP4, MOV or WebM; H.264, H.265, VP8 or VP9. **23–60 fps, 360–4096 px per side, ≤ 4 GB, 3 s up to the creator's own maximum** (`postingLimits.maxVideoDurationSec`, ≤ 10 min). Caption ≤ 2,200 characters. Plays at ≤ 1080p†. | 1080×1920 9:16, 30 fps, 15–20 Mb/s†, AAC 48 kHz stereo. Safe zone†: 130 px top, 484 foot, 140 right, 44 left. | One `{type:"video"}`; `videoCoverImageUrl` (JPG/PNG/WebP ≤ 20 MB) or `videoCoverTimestampMs` (default 1000), `videoMadeWithAi`, `commercialContentType` (`none` · `brand_organic` · `brand_content`), `musicSoundInfo`, `draft`, `dryRun` (checks the daily limit) |
| Photo / carousel | **≤ 35 images, JPEG or WebP, ≤ 1080p, ≤ 20 MB each.** Title ≤ 90 characters, description ≤ 4,000. | 1080×1920 JPEG† | Image `mediaItems` (photo mode detected); `photoCoverIndex`, `autoAddMusic`, `description`, and the required fields above |

## X — `twitter`

Zernio passes X's API cost through: a post $0.015, **a post with a URL $0.20**, an Article $0.02. A card on file is
needed even on Zernio's free tier.

| Post | Hard | Send | Zernio |
|---|---|---|---|
| Text / link | 280 weighted characters (emoji and CJK count 2, a URL 23); Premium 25,000† (280 with a poll) | — | `customContent` |
| Images | ≤ 4 images, or 1 GIF. JPG, PNG, WebP ≤ 5 MB; GIF ≤ 15 MB, ≤ 1280×1080, ≤ 350 frames. Alt text ≤ 1,000. | 1920×1080 or 1080×1350 JPEG < 5 MB† | ≤ 4 `{type:"image", altText}` |
| Video | **Through Zernio ≤ 512 MB and ≤ 140 s** (`longVideo: true` on Premium). X itself, since 1 Sep 2026: 20 min / 8 GB, Premium 125 min / 16 GB. H.264 High, 4:2:0, square pixels, closed GOP, **≤ 25 Mb/s**, ≤ 60 fps (the Help Center says 40: send 30), shape 1:2.39 to 2.39:1. **AAC-LC only** (HE-AAC rejected), mono or stereo, ≥ 128 kb/s. Plays at 1080p for Premium, 720p for others. | 1920×1080 or 1080×1920, 30 fps, 8–12 Mb/s, AAC 192 kb/s; 140 s at 12 Mb/s ≈ 210 MB | One `{type:"video"}`; `longVideo` |
| Thread | **Self-serve X API: a reply only when the first post mentioned or quoted the replying account** — whether one's own thread is exempt is not documented: test once | — | `threadItems: [{content, mediaItems}]`; item 0 is the first post, top-level `content` is not published |
| Article | Premium+; no media or thread beside it | Cover 5:2† (our title card) | `article: {title, content_state: {blocks, entities}, mode: "publish" \| "draft", cover: {url, altText}}` |
| Poll | 2–4 options of 1–25 characters, 5 min–7 days | — | `poll: {options, duration_minutes}` |
| Captions | X's API takes SRT ≤ 1 MB | — | Not in Zernio |

## Bluesky — `bluesky` (connects with an app password)

| Post | Hard | Send | Zernio |
|---|---|---|---|
| Text | ≤ 300 graphemes; ≤ 3 languages; posts can't be edited | — | `customContent`, `langs` |
| Images | ≤ 4. Bluesky takes ≤ 2 MB each (since Apr 2026), up to 4000 px; **Zernio documents ≤ 1 MB and re-compresses above** | JPEG < 1 MB, about 2000 px on the long side† | ≤ 4 `{type:"image", altText}` |
| Video | Bluesky itself (Aug 2026): MP4 only, ≤ 10 min, ≤ 300 MB; WebVTT captions ≤ 20 KB; no custom cover; shown up to 1:2 tall without bars (9:16 fits), taller is pillarboxed; plays at 720p†. **Zernio documents ≤ 60 s and ≤ 50 MB.** | 1080×1920 or 1920×1080, 30 fps, about 5 Mb/s, AAC 128 kb/s, ≤ 60 s | One `{type:"video"}` |
| Thread | — | — | `threadItems` |
| Link card | Bluesky: title, description, thumb ≤ 1 MB | — | Not documented in Zernio |

## LinkedIn — `linkedin` (a person, or a company page by `organizationUrn`)

| Post | Hard | Send | Zernio |
|---|---|---|---|
| Text / link | ≤ 3,000 characters; the link preview is automatic | — | `customContent`; `disableLinkPreview` |
| Images | 1–20 images, JPEG, PNG or GIF, ≤ 8 MB each, ≤ 36 million pixels†; never mixed with video or a document | 1080×1350 or 1080×1080 JPEG† | ≤ 20 `{type:"image", altText}` |
| Video | 256×144 to 4096×2304 (a 2160×3840 vertical is too tall: use 1080×1920), 1:2.4 to 2.4:1, 10–60 fps, 192 kb/s–30 Mb/s, ≥ 3 s. **LinkedIn's Videos API: ≤ 500 MB** (one field says 5 GB), ≤ 30 min. Zernio: ≤ 5 GB, ≤ 10 min for a person, ≤ 30 min for a page. | 1080×1920 (the vertical feed) or 1920×1080, 30 fps, about 10 Mb/s (inside 500 MB up to about 6 min), AAC 48 kHz stereo | One `{type:"video", thumbnail}` |
| Document (a PDF carousel) | **PDF ≤ 100 MB, ≤ 300 pages, a title required** (LinkedIn also takes PPT, PPTX, DOC, DOCX; Zernio uploads PDF only) | A PDF of 1080×1350 pages† | `{type:"document", url, title}` and `documentTitle` |
| Poll | Question ≤ 140, 2–4 options ≤ 30 characters, 1, 3, 7 or 14 days; no media | — | `poll: {question, options, duration}` |
| Article / newsletter | **No API exists** (only a link share) | — | — |
| Captions | SRT, on desktop only | — | Not in Zernio |

## What one story delivers

| From | File | Goes to |
|---|---|---|
| The article | the page on maia.city | the journal (first) |
| The 4K master | 3840×2160 HEVC | YouTube video |
| The 16:9 copy | 1920×1080 H.264 ≤ 20 Mb/s (≤ 140 s for X, about 10 Mb/s past 3 min for LinkedIn) | X, LinkedIn |
| The 9:16 cut | 1080×1920 H.264 ≤ 25 Mb/s, ≤ 300 MB, ≤ 90 s for Instagram | Instagram Reel, YouTube Short (≤ 3 min), TikTok |
| The Bluesky cut | 1080×1920 ≤ 60 s, ≤ 50 MB | Bluesky |
| The title cards | 16:9 JPEG < 2 MB; 9:16 cover; 4:5 slides; 5:2 cover | YouTube thumbnail; Reel cover; carousels; X Article |

# Zernio

Zernio (zernio.com, formerly Late / getlate.dev) is the one API we publish every platform through: one request per
moment, one entry per platform, each with its own words and its own file. Docs: https://docs.zernio.com (API
reference under `/api-reference`, one page per operation, e.g. `/media/get-media-presigned-url`). Our dry run builds
these requests from a day's derivatives: `bun api/scripts/zernio.ts blog/day-NN-<slug> [--local]` → `zernio.json`.

## The model

| | |
|---|---|
| Base URL | `https://zernio.com/api/v1` |
| Auth | `Authorization: Bearer sk_…` (dashboard → API keys, or `POST /v1/api-keys`; shown once). Keys can be scoped to profiles, read-only, or set to expire. |
| Team → profile → account | The team holds keys, billing and limits; a **profile** is one brand (`POST /v1/profiles`); an **account** is one connected platform login, named by `accountId` in every post. A profile may hold several accounts of one platform. |
| Connecting | `GET /v1/connect/{platform}?profileId=…&redirect_url=…` → `authUrl`; the owner signs in (Zernio's own platform apps — we need none of our own); the redirect brings `accountId`. **Bluesky:** `POST /v1/connect/bluesky/credentials {profileId, identifier, appPassword}`. **LinkedIn:** person or company page: `POST /v1/connect/linkedin/select-organization`, later `PUT /v1/accounts/{id}/linkedin-organization`. **Instagram:** `loginMethod=instagram_login` (default) or `facebook_login` (needed for licensed audio and paid partnership). **TikTok:** through the TikTok for Business app. |
| Platform names | `youtube`, `instagram`, `tiktok`, `twitter` (X), `bluesky`, `linkedin` — and facebook, threads, pinterest, reddit, googlebusiness, telegram, snapchat, discord, slack, whatsapp |

## Getting a file to Zernio

| Way | How | Limit |
|---|---|---|
| Presigned upload | `POST /v1/media/presign {filename, contentType, size}` → `{uploadUrl, publicUrl, key, expiresIn}`; one `PUT` of the file to `uploadUrl` (same `Content-Type`, within 3,600 s); then `publicUrl` in the post | ≤ **5 GB**, one PUT, no multipart. Types: jpeg, png, webp, gif, mp4, mpeg, quicktime, avi, webm, x-m4v, pdf, audio |
| A public URL | Our own HTTPS URL straight in `mediaItems[].url` (the vault gateway `https://api.maia.city/vault/files/<hash>` for public files); Zernio fetches it | Not documented; the way past 5 GB |
| Direct upload | `POST /v1/media/upload-direct` multipart `file` | ≤ 25 MB, deleted after 7 days (inbox attachments) |

Uploads wait 7 days in Zernio's temporary storage for a post to use them.

## The post

`POST /v1/posts`:

```json
{
  "content": "the default words",
  "mediaItems": [{ "type": "video", "url": "https://…", "thumbnail": "https://…" }],
  "scheduledFor": "2026-10-05T21:07:00", "timezone": "Europe/Berlin",
  "metadata": { "day": 0 },
  "platforms": [
    { "platform": "youtube", "accountId": "…", "customContent": "the description",
      "platformSpecificData": { "title": "…", "visibility": "public", "madeForKids": false, "categoryId": "22" } },
    { "platform": "instagram", "accountId": "…", "customContent": "…", "customMedia": [{ "type": "video", "url": "…" }],
      "platformSpecificData": { "shareToFeed": true, "instagramThumbnail": "https://…" } }
  ]
}
```

| Field | Meaning |
|---|---|
| `content` | The default words; `platforms[i].customContent` replaces them for one platform |
| `mediaItems[]` | `type` (`image` · `video` · `gif` · `document`; must match the URL's extension or 400), `url`, `altText`, `title` (a LinkedIn document's), `thumbnail` (a video's cover: YouTube, LinkedIn, Facebook; ≤ 10 MB), `instagramThumbnail` (a Reel's cover), `filename`, `size`, `mimeType` |
| `platforms[]` | `{platform, accountId, customContent?, customMedia?, scheduledFor?, platformSpecificData?}` — each platform's own words, file, time and options (`platforms.md`) |
| `title` | Stored only — it is **not** the YouTube title (that is `platformSpecificData.title`) |
| `tags` | Top level: YouTube's tags (each ≤ 100, all ≤ 500 characters) |
| `hashtags`, `mentions` | Stored only |
| `metadata` | Our own key-values, echoed in every webhook |
| `tiktokSettings`, `facebookSettings` | Top-level defaults merged into each entry |

Field names that are **wrong** (from old SDK examples): `platformSpecificContent`, `mediaUrls`, `youtubeTitle`.

## When it goes out

- One of: `scheduledFor` (ISO; with `Z` or an offset as is, else read in `timezone`, else the profile's zone, else UTC;
  in the past → now), `publishNow: true` (answers with each platform's result), `queuedFromProfile` (the next slot).
- `isDraft: true` keeps it a draft; a post with no time is a draft too. To promote one: `PUT /v1/posts/{id}` with
  `isDraft: false` **and** `scheduledFor`. Precedence: `isDraft` over `publishNow` over `scheduledFor`.
- A platform's own `scheduledFor` gives it its own minute.

## Safety

- `Idempotency-Key` header (24 h): a replay answers 200 with the first post; 409 `idempotency_conflict` while the first
  still runs.
- The same `(platform, accountId, content and media)` within 24 h is refused (409, `existingPostId`) — a Reel and a
  Story of one file on one account may collide.
- `POST /v1/tools/validate/post` takes the post's exact body and answers `errors[]` and `warnings[]` without posting;
  `POST /v1/tools/validate/media {url}` checks only size and type (`platformLimits`); `POST /v1/tools/validate/post-length`.

## What happened

- The post's `status`: `draft`, `scheduled`, `publishing`, `published`, `partial`, `failed`, `cancelled`.
- Each platform's `status` (`pending` · `processing` · `uploading` · `published` · `failed` · `cancelled`),
  **`platformPostId`**, **`platformPostUrl`**, `publishedAt`, `errorMessage`, `errorCategory` (e.g. `auth_expired`,
  `quota_exhausted`). `publishNow` answers 207 when some platforms failed. A TikTok URL may come later
  (`post.tiktok.url_resolved`).
- `GET /v1/posts/{id}`, `GET /v1/posts?status=…&platform=…&profileId=…`.
- **Webhooks:** `POST /v1/webhooks/settings {name, url, secret, events[], profileIds?, accountIds?}`; events
  `post.scheduled`, `post.published`, `post.failed`, `post.partial`, `post.cancelled`, and per platform
  `post.platform.published`, `post.platform.failed`, `post.platform.deleted`, `post.tiktok.url_resolved`. Signed
  `X-Zernio-Signature` (hex HMAC-SHA256 of the raw body); `X-Zernio-Event-Id` to drop repeats; up to 7 tries over ~51 h;
  `POST /v1/webhooks/test`, `GET /v1/webhooks/logs`, `POST /v1/webhooks/logs/redeliver`.

## Changing and removing

| Before it is published | After |
|---|---|
| `PUT /v1/posts/{id}` (draft, scheduled, failed, partial or cancelled), `DELETE /v1/posts/{id}`, `POST /v1/posts/{id}/retry` | `POST /v1/posts/{id}/edit` — words only, on X (Premium, within 1 h, 5 edits), LinkedIn, Facebook, YouTube (description), and others; **not** Instagram, TikTok, Bluesky. `POST /v1/posts/{id}/update-metadata` — YouTube's title, description, tags, category, privacy, thumbnail, made-for-kids, playlist (`_` as the id plus `videoId` and `accountId` for a video posted elsewhere). `POST /v1/posts/{id}/unpublish` — not Instagram, TikTok, Snapchat; on YouTube a deletion is final. |

## Limits and cost

| | |
|---|---|
| Requests | 60 / 600 / 1,200 per minute by connected accounts (0–2 / 3–2,000 / more); `Retry-After` on 429 |
| Posts | 25 an hour per account; a day: Instagram 100, X 50, TikTok 15 videos + 15 photo posts, the rest 50 |
| Price | Per connected account, every feature: 1–2 free, 3–10 at $6, 11–100 at $3, beyond at $1 a month. X's cost is passed through: $0.015 a post, **$0.20 with a URL**, $0.005 a read, $0.02 an Article. |

## Later

Analytics (`GET /v1/analytics`, per-platform insights for YouTube, Instagram, TikTok, LinkedIn), the inbox (comments,
DMs, mentions), `GET /v1/accounts/{id}/posts` (what is live on the platform). SDK: `@zernio/node` (`new Zernio({apiKey})`,
`zernio.posts.createPost({body})`, `zernio.media.getMediaPresignedUrl({body})`); hosted MCP at
`https://mcp.zernio.com/mcp`.

## Known traps

- TikTok Business-app accounts post public only; a private test is only possible as a `draft` (Creator Inbox).
- Instagram needs a Business or Creator account; some features need `facebook_login`.
- YouTube community posts can't be made; YouTube's daily quota shows up as `errorCategory: quota_exhausted`.
- Bluesky posts can't be edited; Instagram, TikTok and Snapchat posts can't be unpublished through the API.
- Whether one LinkedIn login can be connected twice (as the person and as the page) is not documented: test it.

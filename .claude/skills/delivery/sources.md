# Sources

Gathered on 3 Oct 2026. The cloud session's network blocked every platform's help pages and docs.zernio.com, so the
figures came from: Zernio's live OpenAPI spec (inside its official Node SDK, `zernio-dev/zernio-node`, regenerated
3 Oct 2026); X's developer docs source (`github.com/xdevplatform/docs`, with its `openapi.json`); Bluesky's lexicons
(`bluesky-social/atproto`) and app (`bluesky-social/social-app`); YouTube's machine-readable API spec
(`https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest`, revision 20261001); and search extracts of the
official pages below. **†** in `platforms.md` marks what came from a third party or memory: confirm it on the
official page before relying on it (opening the hosts in the session's network settings lets the page be read).

## Official pages

| Platform | Page |
|---|---|
| YouTube | Encoding: https://support.google.com/youtube/answer/1722171 · HDR: /answer/7126552 · Shapes: /answer/6375112 · Length: /answer/71673 · Formats: /troubleshooter/2888402 · Shorts (3 min): /answer/15424877 · Thumbnails: /answer/72431 · Captions: /answer/2734698 · Posts: /answer/7124474 · API: https://developers.google.com/youtube/v3/docs/videos |
| Instagram | API media reference: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/ · Publishing: /docs/instagram-platform/content-publishing/ · Photo sizes: https://help.instagram.com/1631821640426723 · Reels: https://help.instagram.com/1038071743007909 · Carousels: https://help.instagram.com/269314186824048 · Safe zone: https://www.facebook.com/business/help/980593475366490/ |
| TikTok | Media transfer: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide · Direct post: /doc/content-posting-api-reference-direct-post · Photo post: /docs/en/content-posting-api-reference-photo-post · Creator info: /docs/en/content-posting-api-reference-query-creator-info · Guidelines: /docs/en/content-sharing-guidelines · Studio: https://support.tiktok.com/en/using-tiktok/creating-videos/creator-tools-on-tiktok |
| X | Media best practices: https://docs.x.com/x-api/media/quickstart/best-practices · Chunked upload: /x-api/media/quickstart/media-upload-chunked · Video help: https://help.x.com/en/using-x/x-videos · Premium: https://help.x.com/en/using-x/premium-longer-videos · Media Studio: https://help.x.com/en/using-x/media-studio-faqs |
| Bluesky | Video lexicon: https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/embed/video.json · Images: …/embed/images.json · App limits: https://github.com/bluesky-social/social-app/blob/main/src/lib/constants.ts · Blog: https://bsky.social/about/blog/09-11-2024-video |
| LinkedIn | Video: https://www.linkedin.com/help/linkedin/answer/a548372 · Pages: /answer/a1311816 · Captions: /answer/a552177 · Videos API: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api |
| Zernio | https://docs.zernio.com · Media uploads: /guides/media-uploads · Rate limits: /guides/rate-limits · Pricing: /pricing · Platforms: /platforms/{youtube,instagram,tiktok,twitter,bluesky,linkedin} · Webhooks: /webhooks |

## What changed lately (re-check first)

| When | What |
|---|---|
| 1–2 Sep 2026 | X's developer docs: post video 20 min / 8 GB, Premium 125 min / 16 GB ("match the app"); the Help Center still says 140 s / 512 MB |
| Aug 2026 | Bluesky video 10 min / 300 MB (from 3 min / 100 MB) |
| Jul 2026 | YouTube Shorts custom thumbnails (Partner Program, desktop) |
| Apr 2026 | Bluesky images 2 MB (from 1 MB) |
| Dec 2025 | Instagram counts 5 hashtags a post† |
| Oct 2025 | YouTube thumbnails 50 MB and 4K |
| Jan 2025 | Instagram Reels to 3 min (recommendation) and the vertical profile grid† |
| Oct 2024 | YouTube Shorts up to 3 min, square or vertical |

## Still to confirm

- Zernio's own lags: Instagram Reels 90 s, Bluesky video 60 s / 50 MB and images 1 MB, X video 140 s / 512 MB.
- LinkedIn's non-video limits (images, documents, polls) and its Videos API's 500 MB against 5 GB.
- X: replies in a thread through the self-serve API; the Help Center's 40 fps; Premium tiers.
- Instagram's grid tile shape (3:4) and the 5-hashtag rule; TikTok's recommended size, bitrate and safe zone.
- Whether Instagram's API refuses AVAssetWriter's audio edit list (it says "no edit lists").

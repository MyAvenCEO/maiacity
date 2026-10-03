---
name: content-derivatives
description: Derive a maiaCITY day's posts from its base article — the single source of truth (blog/day-NN-…/post.md) — onto the content board, every platform's post prepared and scheduled, no forms. Use whenever Samuel asks to derive, prepare, schedule or generate the posts / social / derivatives / deliverables for a day ("derive Day 20", "prepare the posts", "what goes out today"), or when a new journal day or film is finished.
---

# Content derivatives: one base article per day, everything else derived from it

## The model

- **One story = one base article = one card on the Stories board** (`/app/stories`; the story's own page has its steps as tabs). A story goes by its name, never by a day: its project is the story's name ("233 settlers, how it starts"), the media vault's bucket of the same title holds its files, and the old day folders' names map to it through `src/lib/stories/names.js`. The article is the single source of truth: `blog/day-NN-<slug>/post.md`, written by the story machine of the `story-producer` skill and its crew (the `storyteller` writes it) (author avenSAMUEL; `draft: true` until Samuel releases it).
- **Derivatives** live next to it in `derivatives.json` and go out around the day, each at its own time. They are written *from the article* — never new facts, never invented biography.
- **The board** moves a card **idea → hook → draft → derivatives → scheduled → published**. *Hook* comes first: the day's title, written in `thumbnail.json` and rendered into its title cards in every shape (`node scripts/film/thumbnail.mjs …`, then `bun api/scripts/day.ts <dir> --hook --local`); the article is written from it. *Draft* is the base article alone — no derivatives exist yet (every push carries the hook and title cards along). Moving on to *Derivatives* **locks the base**: everything is derived from the locked article, and the API refuses a changed article until the card goes back to Draft. A render never moves a card. The modal's stages are views, clickable once reached: the idea; the hook (only the title cards: the thumbnail in 16:9, 1:1, 9:16 and 5:2); the article; the derivatives as platform previews; the week they go out in. The calendar (week view) lists the derivatives by time.
- **Push the draft:** `bun api/scripts/day.ts blog/day-NN-<slug> --article [--local]` — the article alone.
- **Derive (locks the base):** `bun api/scripts/day.ts blog/day-NN-<slug> [--local]` — checks every limit, resolves film variants to their timelines, writes the whole set of derivatives (replacing the card's), moves a story in Writing on to Derivatives; the card's date stays. Derive only when Samuel has moved the card to Derivatives or asks to — the article must be final first.

## Channels and formats (for now)

| platform | formats | limits |
|---|---|---|
| `journal` | `article` — the base article itself, first thing in the morning | — |
| `youtube` | `video` — the film (4K master or the film as it is), title + description with chapters (first 0:00, ≥ 3, each ≥ 10 s); `short` — a square or vertical film of ≤ 3 min (YouTube makes it a Short by itself) | title 100, description 5000 |
| `linkedin` | `video` (1080 H.264), `post` (a text post: one idea) | 3000 |
| `x` | `video` (1080 H.264), `post`, `thread` (`thread: [...]`, one entry per tweet, `text` = the first), `article` — an X Article, long form (the blog article) | 280 per tweet; an X Article 100 000 |
| `instagram` | `reel` (9:16, **≤ 90 s** — a film longer than that gets its own Reel cut, e.g. `api/scripts/cut.ts`), `video` with `placement: "feed"` (the full film, 1:1) | 2200 |

A derivative that posts a film names its cut: `variant` (the timeline letter: `G` full film, `H` Reel), plus `aspect` and `codec` of the delivery it uses (16:9 hevc → YouTube; 16:9 h264 → X, LinkedIn; 9:16 h264 → Reel; 1:1 h264 → Instagram feed). A film that is already in the post (not from a timeline) is listed under `files` in derivatives.json by its library name — its copies too (e.g. a 1080 H.264 copy of a 2160 HEVC film for X, LinkedIn, Instagram and the Short).

## How many derivatives — by information density

Count what the article actually carries, then derive only what it can pay for:
- **Every day:** the journal article.
- **A film:** at the launch — YouTube video, YouTube Short (≤ 3 min), LinkedIn video, X video, Instagram (feed if > 90 s; a Reel for a ≤ 90 s cut).
- **Every day with ideas worth quoting:** 2–3 teasers (X posts, a LinkedIn text post) and, after the launch, an X Article (the article itself).
- **A how-it-was-made story** (a mechanism, an obstacle, a solution): one X thread — hook tweet, one tweet per beat of the article's arc (obstacle → what we did → result), last tweet lands the transformation and points to the film or article. 4–7 tweets.
- **A single strong claim or number** (a before/after, a surprising figure): one X or LinkedIn text post.
- A thin day (one small change) gets the article and at most one post. Don't pad.

## Schedule: one day, one launch (Europe/Berlin)

Everything a day derives goes out **on that day**, and **the launch comes first — nothing goes out before it**. Publishing its blog post always schedules all its derivatives with it.
- **The launch, around 21:00 — the same minute everywhere:** the blog post and the film on YouTube (a Short when the film is square/vertical and ≤ 3 min), LinkedIn, X and Instagram.
- **Then the rest of the evening, each one idea from the article:** the X thread (~30 min later), a LinkedIn text post, the X Article (long form: the article itself), then single X posts — each with the links working, since everything is out.
- **Never on round times.** Nothing at :00, :15, :30 or :45 — move each slot a few minutes off, differently every day (Day 1: launch 21:04 · 21:37 · 22:11 · 22:43 · 23:08 · 23:36). The launch stays one minute for every platform.
- The card's date is the launch. The board's modal shows every post as one stream, top to bottom in the order they go out, each with its time; the launch is marked.

## Title cards (thumbnails, banner, poster)

Every day gets title cards in **four ratios — 16:9, 1:1, 9:16, 5:2** — set like YouTube thumbnails: few words, heavy and big enough to read at phone size, the big words in gold, a firm shade behind the title and nothing else across the picture, and **no day stamp** (a story goes by its name). `blog/day-NN-<slug>/thumbnail.json`: the frame **by CID** (a 2160 still from the library; a shape can have its own — `"frames": { "9x16": "<cid>" }` — when the main frame is too small to crop), the hook in four parts — kicker · big (gold) · line · after — **or, for a before/after hook, the split card**: `"split": { "old": <cid>, "new": <cid> }` with the title in two halves (`"old": { kicker, big }`, `"new": { kicker, big, after }`), the old world cold on the left, the new warm on the right (stacked in 1:1 and 9:16) — and per-shape `place` (`bottom` when the face is at the top) / `width` so the title never crosses a face. `node scripts/film/thumbnail.mjs <thumbnail.json> --local` renders the four cards and the three hook layers, brings each into the library (cards public), writes their CIDs back into `thumbnail.json` (`cards`, `hooks`), replaces the old card CIDs in the day's `post.md` and `derivatives.json`, and — when `marker` names the film's title-card marker — writes the CIDs into its meta for the render worker and the studio. Look at every ratio before pushing; `day.ts` then puts all four on the card. The article names them by CID: `cover:` the 16:9, `banner:` the 5:2 (the blog's wide header), `poster:` the one its film's shape wants. **Every file is referenced by its CID; tags only sort** (see the story-producer skill's media library).

## Writing them

- **Voice:** Samuel's first person (avenSAMUEL) on his accounts — the journal house style (stacked short lines, one long run-on, hyper-specific numbers from the article, the German-English cadence). Posts written *by avenMAIA* only when the article is hers (`writer` skill).
- **No hashtags** anywhere — no platform's reach favours them; put the keywords in the words (captions are searched): geodesic domes, food forest, self-sufficient city, …
- **Hook first** (subject + action + end state + contrast, per the `hook-writer` skill), not a topic. The title is the promise; the first line is the first step inside it.
- **Facts only from the article** (and the film's script): 233 settlers, 13 domes, "first in game, then in real". Never claim a real city exists yet.
- Every derivative must stand alone for someone who never heard of maiaCITY.
- Banned words and patterns: see `.claude/skills/writer` (delve, leverage, unlock, seamless, emoji walls, "thrilled to announce", …).

## Check against Zernio (the upload step, dry)

`bun api/scripts/zernio.ts blog/day-NN-<slug> [--local]` turns the day's derivatives into Zernio's own requests (`POST /v1/posts`: one request per moment, one entry per platform with its `customContent` / `customMedia`, `scheduledFor` + `timezone: Europe/Berlin`, an `Idempotency-Key`), writes them to `zernio.json` next to the article, and fails on anything Zernio or a platform refuses. What it knows (docs.zernio.com/api-reference, `zernio.com/openapi.yaml`):
- **YouTube decides Short or video by the file:** square or vertical AND ≤ 3 min → a Short (custom thumbnails ignored, no chapters); landscape → always a normal video, any length; square/vertical over 3 min → a normal video. There is no switch. A short square film gets ONE YouTube post, a `short`, with the full title and description — for a normal video as well, letterbox it into 16:9 (a different file, so no duplicate). Title ≤ 100 (`platformSpecificData.title`); the description is the post's text.
- **The same file twice on one account within 24 h is refused** (content dedup) — one post per platform per moment.
- **X:** H.264 only; tweets ≤ 280; a thread is `threadItems[]`; an X Article is `platformSpecificData.article` — title, a **cover image (5:2)**, the body as content blocks (converted from the Markdown); X Premium+ and ~$0.02 per article.
- **Instagram:** a video is a Reel, `shareToFeed: true` puts it on the profile feed as well (so one post covers both); Zernio lists Reels ≤ 90 s — validate longer films with `POST /v1/validate/validate-media`.
- **LinkedIn:** ≤ 3000; a video can carry a custom thumbnail.
- **The title card is an image; the hook in the film is text over moving picture.** Where the platform takes a cover image, the card goes up as its own file and the film starts clean: a YouTube video (`thumbnail`), LinkedIn video (`thumbnail`), an Instagram Reel (`instagramThumbnail`) — the 4K HEVC master for YouTube carries no hook. X videos and YouTube Shorts take no cover image (the Short's cover is a frame YouTube picks, X autoplays), so every H.264 social copy carries the **hook layer** (`hook-<shape>.png` from `thumbnail.mjs`: the title, transparent) over its first 2.5 s of moving picture, cut away hard — never a still card at the start (it stops the film in the second that decides whether people stay). The render worker does this from the timeline's title-card clip (its marker); a film that opens on black keeps the hook over the black and the first 2.5 s of picture. Title in 9:16 sits clear of the Shorts/Reels header and the bottom 30 % (caption, channel, buttons).
- **Files** need a public HTTPS URL: the CDN copy, or an upload through `POST /v1/media/presign` (shown as `upload:<name>` until then).
- The blog is ours: published by the publish step, never through Zernio.

## Checklist

- [ ] The article is the source: every fact in a derivative is in it.
- [ ] Every sentence (article and derivatives) happened: no invented reader behaviour ("most people never found…"), no invented failed attempts, no invented results.
- [ ] Derivative count matches the article's density; formats colocated sensibly across the day.
- [ ] Every limit passes (`day.ts` refuses otherwise); YouTube chapters valid.
- [ ] `zernio.ts` passes (no ✗): one post per platform per moment, a film under 3 min only once on YouTube (as a Short), an X Article with its 5:2 cover.
- [ ] Films referenced by `variant`, and their renders have delivered (the board shows a warning per post otherwise).
- [ ] Local first (`--local`); production only when Samuel asks.

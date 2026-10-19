---
name: content-derivatives
description: Derive a maiaCITY story's posts from its base text, the single source of truth (the story entry in the Maia City vault in avenDB), as posts of that story, every platform's post prepared and timed, proposed through avenDB for a human to accept. Use whenever Samuel asks to derive, prepare, schedule or generate the posts / social / derivatives / deliverables for a story ("derive the trailer story", "prepare the posts", "what goes out today"), or when a new story or film is finished.
---

# Content derivatives: one story, everything else derived from it

## The model

- **One story = one `story` entry in the Maia City vault** (avenDB), shown in the app's Stories with its steps as tabs (Hook, Thumbnail, Journey, Writing, Movie, Derivatives). The story's `text` is the base article and the single source of truth, written by the story machine of the `story-producer` skill and its crew (the `storyteller` writes it). A story goes by its name, never by a day. The old `blog/day-NN-…/` folders and the old content board are history: nothing reads them, and nothing is written there.
- **Derivatives are posts of the story**: entries of type `post`, each linking its story (`story`) and of one post type of Maia City, a schema of the vault's own, "Post: <channel>, v1", with its template in `x-template` (`src/lib/avendb/posttypes.js`). The story's Derivatives tab lists them by type. They are written *from the story's text*, never new facts, never invented biography.
- **Agents write only through avenDB's MCP** (the agent device Claude Code starts, `avendb-device agent claude`, its `avendb_run` op), as avenMAIA, which is a Suggester on Maia City: every post goes in as a draft on a proposal line, opened as one AIP for the story, and a human of Maia City accepts it. There is no API key, script or Postgres board for posts (Samuel 2026-10-19: every agent goes through avenDB vault caps).
- **A platform needs its post type first.** Maia City holds the journal, film, doc and inspire types. A YouTube, X, LinkedIn or Instagram post goes out as a post of a type for that platform, whose fields carry what the table below needs (platform, format, the time it goes out, a thread's entries, the cut or file it posts, its aspect and codec). Where Maia City has none yet, propose its schema first, as its own AIP, and ask Samuel to accept it. Never put fields into a post that its type does not have.
- **Derive only when Samuel asks**, from a final text: the post type's template beside the story's text, one post per platform and moment.

## Channels and formats (for now)

| platform | formats | limits |
|---|---|---|
| `journal` | `article` — the base article itself, first thing in the morning | — |
| `youtube` | `video` — the film (4K master or the film as it is), title + description with chapters (first 0:00, ≥ 3, each ≥ 10 s); `short` — a square or vertical film of ≤ 3 min (YouTube makes it a Short by itself) | title 100, description 5000 |
| `linkedin` | `video` (1080 H.264), `post` (a text post: one idea) | 3000 |
| `x` | `video` (1080 H.264), `post`, `thread` (`thread: [...]`, one entry per tweet, `text` = the first), `article` — an X Article, long form (the blog article) | 280 per tweet; an X Article 100 000 |
| `instagram` | `reel` (9:16, **≤ 90 s** — a film longer than that gets its own Reel cut: a draft `cut` entry in Studio 2, made from the film's cut), `video` with `placement: "feed"` (the full film, 1:1) | 2200 |

A derivative that posts a film names its cut (Studio 2's `cut` entry: the full film, or its Reel cut), plus `aspect` and `codec` of the delivery it uses (16:9 hevc → YouTube; 16:9 h264 → X, LinkedIn; 9:16 h264 → Reel; 1:1 h264 → Instagram feed). A film that is not from a cut names its Library file by its hash, and its copies too (e.g. a 1080 H.264 copy of a 2160 HEVC film for X, LinkedIn, Instagram and the Short).

## How many derivatives — by information density

Count what the article actually carries, then derive only what it can pay for:
- **Every story:** its journal post.
- **A film:** at the launch — YouTube video, YouTube Short (≤ 3 min), LinkedIn video, X video, Instagram (feed if > 90 s; a Reel for a ≤ 90 s cut).
- **Every day with ideas worth quoting:** 2–3 teasers (X posts, a LinkedIn text post) and, after the launch, an X Article (the article itself).
- **A how-it-was-made story** (a mechanism, an obstacle, a solution): one X thread — hook tweet, one tweet per beat of the article's arc (obstacle → what we did → result), last tweet lands the transformation and points to the film or article. 4–7 tweets.
- **A single strong claim or number** (a before/after, a surprising figure): one X or LinkedIn text post.
- A thin day (one small change) gets the article and at most one post. Don't pad.

## Schedule: one day, one launch (Europe/Berlin)

Everything a story derives goes out **on its launch day**, and **the launch comes first — nothing goes out before it**. Publishing its journal post always times all its derivatives with it.
- **The launch, around 21:00 — the same minute everywhere:** the blog post and the film on YouTube (a Short when the film is square/vertical and ≤ 3 min), LinkedIn, X and Instagram.
- **Then the rest of the evening, each one idea from the article:** the X thread (~30 min later), a LinkedIn text post, the X Article (long form: the article itself), then single X posts — each with the links working, since everything is out.
- **Never on round times.** Nothing at :00, :15, :30 or :45 — move each slot a few minutes off, differently every day (Day 1: launch 21:04 · 21:37 · 22:11 · 22:43 · 23:08 · 23:36). The launch stays one minute for every platform.
- The story's launch is the journal post's time; the Derivatives tab shows every post with its time.

## Title cards (thumbnails, banner, poster)

Every story gets title cards in **four ratios — 16:9, 1:1, 9:16, 5:2** — set like YouTube thumbnails: few words, heavy and big enough to read at phone size, the big words in gold, a firm shade behind the title and nothing else across the picture, and **no day stamp** (a story goes by its name). They are designed in the story's Thumbnail tab (its `artwork` entries, in layers; each render a Library file, `role:still`), or rendered by `node scripts/film/thumbnail.mjs <thumbnail.json>`, which brings each card and hook layer into avenDB's Library as avenMAIA's draft (`scripts/film/vault.mjs`). The hook in four parts — kicker · big (gold) · line · after — **or, for a before/after hook, the split card** (the old world cold on the left, the new warm on the right, stacked in 1:1 and 9:16), placed per shape so the title never crosses a face. Look at every ratio before a post names one. A post names its card by its Library hash: the 16:9 as the cover, the 5:2 as the wide header and an X Article's cover, the one its film's shape wants as the poster. **Every file is referenced by its hash; tags only sort** (see the story-producer skill's media library).

## Writing them

- **Voice:** Samuel's first person (avenSAMUEL) on his accounts — the journal house style (stacked short lines, one long run-on, hyper-specific numbers from the article, the German-English cadence). Posts written *by avenMAIA* only when the article is hers (`writer` skill).
- **No hashtags** anywhere — no platform's reach favours them; put the keywords in the words (captions are searched): geodesic domes, food forest, self-sufficient city, …
- **Hook first** (subject + action + end state + contrast, per the `hook-writer` skill), not a topic. The title is the promise; the first line is the first step inside it.
- **Facts only from the story's text** (and the film's script): 233 settlers, 13 domes, "first in game, then in real". Never claim a real city exists yet.
- Every derivative must stand alone for someone who never heard of maiaCITY.
- Banned words and patterns: see `.claude/skills/writer` (delve, leverage, unlock, seamless, emoji walls, "thrilled to announce", …).

## What Zernio and each platform take (the upload step is not built)

Nothing goes out to a platform yet: posts stay in Maia City. When the upload step comes, it reads the story's posts from avenDB and turns them into Zernio's own requests (`POST /v1/posts`: one request per moment, one entry per platform with its `customContent` / `customMedia`, `scheduledFor` + `timezone: Europe/Berlin`, an `Idempotency-Key`). Write every post so it already fits (docs.zernio.com/api-reference, `zernio.com/openapi.yaml`):
- **YouTube decides Short or video by the file:** square or vertical AND ≤ 3 min → a Short (custom thumbnails ignored, no chapters); landscape → always a normal video, any length; square/vertical over 3 min → a normal video. There is no switch. A short square film gets ONE YouTube post, a `short`, with the full title and description — for a normal video as well, letterbox it into 16:9 (a different file, so no duplicate). Title ≤ 100 (`platformSpecificData.title`); the description is the post's text.
- **The same file twice on one account within 24 h is refused** (content dedup) — one post per platform per moment.
- **X:** H.264 only; tweets ≤ 280; a thread is `threadItems[]`; an X Article is `platformSpecificData.article` — title, a **cover image (5:2)**, the body as content blocks (converted from the Markdown); X Premium+ and ~$0.02 per article.
- **Instagram:** a video is a Reel, `shareToFeed: true` puts it on the profile feed as well (so one post covers both); Zernio lists Reels ≤ 90 s — validate longer films with `POST /v1/validate/validate-media`.
- **LinkedIn:** ≤ 3000; a video can carry a custom thumbnail.
- **The title card is an image; the hook in the film is text over moving picture.** Where the platform takes a cover image, the card goes up as its own file and the film starts clean: a YouTube video (`thumbnail`), LinkedIn video (`thumbnail`), an Instagram Reel (`instagramThumbnail`) — the 4K HEVC master for YouTube carries no hook. X videos and YouTube Shorts take no cover image (the Short's cover is a frame YouTube picks, X autoplays), so every H.264 social copy carries the **hook layer** (`hook-<shape>.png` from `thumbnail.mjs`: the title, transparent) over its first 2.5 s of moving picture, cut away hard — never a still card at the start (it stops the film in the second that decides whether people stay). The render worker does this from the timeline's title-card clip (its marker); a film that opens on black keeps the hook over the black and the first 2.5 s of picture. Title in 9:16 sits clear of the Shorts/Reels header and the bottom 30 % (caption, channel, buttons).
- **Files** need a public HTTPS URL: the CDN copy, or an upload through `POST /v1/media/presign` (shown as `upload:<name>` until then).
- The journal is ours: a journal post goes out on the Maia Universe stream through the content flow's Published stage, never through Zernio.

## Checklist

- [ ] The story's text is the source: every fact in a derivative is in it.
- [ ] Every sentence (story and derivatives) happened: no invented reader behaviour ("most people never found…"), no invented failed attempts, no invented results.
- [ ] Derivative count matches the text's density; formats spread sensibly across the day.
- [ ] Every limit in the table passes, counted by you before proposing; YouTube chapters valid.
- [ ] One post per platform per moment, a film under 3 min only once on YouTube (as a Short), an X Article with its 5:2 cover.
- [ ] Every post is of a post type Maia City holds, links its story, and names its cut or file by id or hash.
- [ ] Proposed through avenDB's MCP as one AIP for the story; Samuel accepts it, nothing is merged by an agent.

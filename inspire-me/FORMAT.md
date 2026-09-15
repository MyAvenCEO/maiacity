# Inspire me — source format

"Inspire me" is maiaCITY's library of sources (videos, papers, posts, threads, reports) that shape the city blueprint.

Every report card tells one story, and that story lands one transformation: **from** an old belief **to** a new one.

```
inspire-me/
  <slug>/
    README.md   ← report card: frontmatter + 4 sections (AI-written, human-checked)
    source.md   ← the raw source: transcript, paper text, post, report — pasted as-is
```

The folder name becomes the URL: `inspire-me/failure-as-a-superpower/` → `/inspire-me/failure-as-a-superpower`.

## Workflow

1. Grab the source — YouTube transcript, paper/PDF text, X thread, blog post, report.
2. Paste it unchanged into `inspire-me/<slug>/source.md` (paragraph breaks are fine).
3. Give an AI the link + the source + the prompt below. Save the answer as `inspire-me/<slug>/README.md`.
4. Check the facts, reload `/inspire-me`.

## Frontmatter

| Field           | Required | Notes                                                                        |
| --------------- | -------- | ---------------------------------------------------------------------------- |
| `title`         | yes      | Short, clear working title.                                                  |
| `originalTitle` | no       | The source's own title, when `title` differs. Quote it if it has `#` or `:`.  |
| `source`        | yes      | Canonical link. YouTube links get a thumbnail automatically.                  |
| `type`          | yes      | `video` `podcast` `paper` `article` `post` `thread` `report` `book`           |
| `author`        | no       | The creator. Keep the name clean — it becomes their author page.             |
| `authorUrl`     | no       | Their channel, site or profile. Shown on the author page.                    |
| `via`           | no       | Where this copy was posted, if not by the author (a reposted clip).          |
| `published`     | no       | `YYYY-MM-DD` if known.                                                       |
| `added`         | yes      | `YYYY-MM-DD` — the day it entered the library. Newest shows first.           |
| `categories`    | yes      | 1–3 ids from the list below. The first sets the accent colour.               |
| `hook`          | yes      | 1–2 sentences that make you want to read on. Scene or tension, not summary.  |
| `shift.from`    | yes      | The old belief, in one line.                                                 |
| `shift.to`      | yes      | The new understanding, in one line. Shown on the card.                       |
| `quote`         | no       | One line from the source that carries the shift (under 20 words).            |
| `quoteBy`       | no       | Who said the quote, when it isn't the author (e.g. an interviewee).          |
| `language`      | no       | Source language code if not English, e.g. `de`. The report is always English.|

**Authors are entities.** Every `author` gets a page at `/inspire-me/by/<author-slug>` listing everything they have in the library, across platforms and formats, with their links. Spell the name identically across sources so they collect on one page.

## Sections

Four sections. Every `## Heading` becomes one card on the page.

1. `## The story` — the heart of the report card. See the storytelling pattern below.
2. `## Beliefs that shift` — **exactly 3**, the strongest ones: `*Old belief.* → New understanding.`
3. `## What we learn` — 4–7 bullets: `**Lesson.** One or two lines.`
4. `## Open questions` — 2–4 bullets: claims to verify, gaps, what to research next.

Data-heavy sources may add one table section (`## Key numbers`, `## Materials`, `## The five principles`) after the beliefs. The story, the beliefs and tables render full width.

## The storytelling pattern

Every story follows the same beats, in this order:

| Beat                      | What it does                                                        |
| ------------------------- | ------------------------------------------------------------------- |
| **Hook**                  | One striking line, image or number. No warm-up.                     |
| **Context**               | Who, where, and what counts as normal here.                         |
| **Problem**               | The old belief doing damage — `shift.from`, in action.              |
| **Intention to overcome** | What they set out to do about it.                                   |
| **Obstacle**              | What stands in the way — usually more than one, in sequence.        |
| **Solution**              | The turn that lands `shift.to`. The last line delivers it.          |

Two rules keep the beats from becoming a list:

- **Therefore / but, never "and then".** Each beat follows the previous one because of it (*therefore*) or against it (*but*). If two paragraphs could swap places, the arc is broken. Write those words on the page where they carry weight — "But waiting is what breaks them.", "Therefore the work aims downward."
- **The story answers the shift.** By the last paragraph, the reader has watched `shift.from` fail and `shift.to` arrive. Whoever reads only the story has still received the transformation.

Length: 8–12 paragraphs, 1–3 sentences each. Short lines, plenty of air, concrete numbers from the source. No filler words (delve, leverage, unlock, elevate, seamless, game-changer).

## Categories

| id             | Covers                                                               |
| -------------- | --------------------------------------------------------------------- |
| `energy`       | Generation, storage, grids, efficiency                               |
| `water`        | Sourcing, cycles, sanitation                                         |
| `food`         | Growing, nutrition, kitchens, soil                                   |
| `health`       | Body, medicine, longevity, care                                      |
| `housing`      | Homes, shelter, living space, affordability                          |
| `architecture` | Design, building materials, construction                             |
| `ecology`      | Land, regeneration, biodiversity, climate                            |
| `transport`    | Moving people: mobility, vehicles, streets                           |
| `logistics`    | Moving goods: supply chains, storage, delivery                       |
| `internet`     | Connectivity, networks, protocols                                    |
| `ai`           | Models, agents, automation, tools                                    |
| `code`         | Software, protocols, open source, tooling                            |
| `game`         | avenCITY: building the city in game first                            |
| `privacy`      | Identity, data sovereignty, security                                 |
| `money`        | Currency, value, finance                                             |
| `coop`         | How we organise together: governance, shared ownership, co-ops, DAOs |
| `civic`        | Law, rights, citizenship, residency                                  |
| `education`    | Learning, skills, schools                                            |
| `self`         | Mind, spirit, belief, passion, purpose                               |

**Add categories freely.** When a source doesn't fit, add a new one to `src/lib/inspire-me/categories.ts` (id, label, colour, blurb) and to this table. Unknown ids still render, in a neutral colour.

## AI prompt

Copy the block, fill in the link and paste the source at the end.

```text
You are writing a report card for the maiaCITY "Inspire me" library — sources that shape the blueprint for a new city, built by 1 million founders.

Every report card tells ONE story that lands ONE transformation: from an old belief to a new one.

Output ONE Markdown file and nothing else, in exactly this shape:

---
title: <short, clear working title>
originalTitle: "<the source's own title — only if different from title>"
source: <link>
type: <video | podcast | paper | article | post | thread | report | book>
author: <the creator's name, spelled consistently — it becomes their author page>
authorUrl: <their channel, site or profile, if known>
via: <where this copy was posted — only if someone other than the author posted it>
published: <YYYY-MM-DD, only if known>
added: <today, YYYY-MM-DD>
categories: [<1–3 of: energy, water, food, health, housing, architecture, ecology, transport, logistics, internet, ai, code, game, privacy, money, coop, civic, education, self>]
hook: >-
  <1–2 sentences: a scene or tension that makes you want to read on — not a summary>
shift:
  from: <the old belief, one line>
  to: <the new understanding, one line>
quote: "<one line from the source that carries the shift, under 20 words>"
quoteBy: <who said it — only if not the author>
language: <source language code — only if not English, e.g. de>
---

## The story
<8–12 short paragraphs following the beats: HOOK → CONTEXT → PROBLEM → INTENTION TO OVERCOME → OBSTACLE → SOLUTION>

## Beliefs that shift
- *<Old belief.>* → <New understanding.>
(exactly three — the three strongest)

## What we learn
- **<Lesson.>** <One or two lines.>

## Open questions
- <Claim to verify, gap, or next research step.>

Rules for the story — these matter most:
- Connect every beat with THEREFORE or BUT, never "and then". Each paragraph follows from the last one or pushes against it, and those words appear on the page where they carry weight.
- The story must answer the shift: the reader watches `from` fail and `to` arrive, and the final paragraph delivers `to`.
- Open on a hook — a striking line, image or number. No throat-clearing.
- 1–3 sentences per paragraph. Short lines, lots of air.
- Use the source's own concrete numbers, names and scenes. Never invent facts it doesn't give.

Other rules:
- Beliefs that shift: exactly 3. What we learn: 4–7. Open questions: 2–4.
- Anything doubtful or unsourced goes under Open questions.
- Always write in English, even when the source isn't; translate the quote.
- Categories: pick from the list. If none fits, use a new short lowercase id and it will be added.
- If the source is data-heavy, add ONE table section after "Beliefs that shift" (e.g. "## Key numbers").
- No filler: delve, leverage, unlock, elevate, seamless, game-changer, robust.
- Leave out optional frontmatter fields you don't know rather than guessing.

SOURCE LINK:
<link>

SOURCE CONTENT:
<paste transcript / paper / post here>
```

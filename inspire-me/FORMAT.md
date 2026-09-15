# Inspiration — source format

The Inspiration is maiaCITY's library of sources (videos, papers, posts, threads, reports) that shape the city blueprint.

Every report card tells one story: **what this source changed in how we see the world — and what we build differently because of it.**

```
inspire-me/
  <slug>/
    README.md   ← report card: frontmatter + 5 short sections (AI-written, human-checked)
    source.md   ← the raw source: transcript, paper text, post, report — pasted as-is
```

The folder name becomes the URL: `inspire-me/failure-as-a-superpower/` → `/inspire-me/failure-as-a-superpower`.

## Workflow

1. Grab the source — YouTube transcript, paper/PDF text, X thread, blog post, report.
2. Paste it unchanged into `inspire-me/<slug>/source.md` (paragraph breaks are fine).
3. Give an AI the link + the source + the prompt below. Save the answer as `inspire-me/<slug>/README.md`.
4. Check the facts, reload `/inspire-me`.

## Frontmatter

| Field           | Required | Notes                                                                      |
| --------------- | -------- | -------------------------------------------------------------------------- |
| `title`         | yes      | Short, clear working title.                                                |
| `originalTitle` | no       | The source's own title, when `title` differs. Quote it if it has `#` or `:`. |
| `source`        | yes      | Canonical link. YouTube links get a thumbnail automatically.               |
| `type`          | yes      | `video` `podcast` `paper` `article` `post` `thread` `report` `book`        |
| `author`        | no       | Creator, channel or authors.                                               |
| `authorUrl`     | no       | Link to the author/channel.                                                |
| `published`     | no       | `YYYY-MM-DD` if known.                                                     |
| `added`         | yes      | `YYYY-MM-DD` — the day it entered the Inspiration. Newest shows first.           |
| `categories`    | yes      | 1–3 ids from the list below. The first sets the accent colour.             |
| `hook`          | yes      | 1–2 sentences that make you want to read on. Scene or tension, not summary. |
| `shift.from`    | yes      | The old belief, in one line.                                               |
| `shift.to`      | yes      | The new understanding, in one line. Shown on the card.                     |
| `quote`         | no       | One line from the source that carries the shift (under 20 words).          |
| `quoteBy`       | no       | Who said the quote, when it isn't the author (e.g. an interviewee).        |
| `language`      | no       | Source language code if not English, e.g. `de`. The report is always English. |

## Sections

Five short sections. Every `## Heading` becomes one card.

1. `## The story` — 4–8 one-line paragraphs: setup → tension → turn. What happened, or what the source argues, told as a story.
2. `## Beliefs that shift` — 3–5 bullets: `*Old belief.* → New understanding.`
3. `## What we learn` — 3–6 bullets: `**Lesson.** One or two lines.`
4. `## For maiaCITY` — opens with "Let's translate this.", then 3–5 bullets: `**Move.** What we build or do differently.`
5. `## Open questions` — 2–4 bullets: claims to verify, gaps, what to research next.

Data-heavy sources may add `## Key numbers` (a table) after "Beliefs that shift". The story and tables render full width.

**Style:** short lines, 1–3 sentences per paragraph, no dense blocks. Concrete numbers from the source beat adjectives. Never invent facts the source doesn't give. No filler words (delve, leverage, unlock, elevate, seamless, game-changer).

## Categories

| id             | Covers                                                          |
| -------------- | --------------------------------------------------------------- |
| `energy`       | Generation, storage, grids, efficiency                          |
| `water`        | Sourcing, cycles, sanitation                                    |
| `food`         | Growing, nutrition, kitchens, soil                              |
| `health`       | Body, medicine, longevity, care                                 |
| `housing`      | Homes, shelter, living space, affordability                     |
| `architecture` | Design, building materials, construction                        |
| `ecology`      | Land, regeneration, biodiversity, climate                       |
| `transport`    | Moving people: mobility, vehicles, streets                      |
| `logistics`    | Moving goods: supply chains, storage, delivery                  |
| `internet`     | Connectivity, networks, protocols                               |
| `ai`           | Models, agents, automation, tools                               |
| `privacy`      | Identity, data sovereignty, security                            |
| `money`        | Currency, value, finance                                        |
| `coop`         | How we organise together: governance, shared ownership, co-ops, DAOs |
| `civic`        | Law, rights, citizenship, residency                             |
| `education`    | Learning, skills, schools                                       |
| `self`         | Mind, spirit, belief, passion, purpose                          |

**Add categories freely.** When a source doesn't fit, add a new one to `src/lib/inspire-me/categories.ts` (id, label, colour, blurb) and to this table. Unknown ids still render, in a neutral colour.

## AI prompt

Copy the block, fill in the link and paste the source at the end.

```text
You are writing a report card for the maiaCITY Inspiration — a library of sources that shape the blueprint for a new city, built by 1 million founders.

Every report card tells ONE story: what this source changes in how we see the world, and what we build differently because of it.

Output ONE Markdown file and nothing else, in exactly this shape:

---
title: <short, clear working title>
originalTitle: "<the source's own title — only if different from title>"
source: <link>
type: <video | podcast | paper | article | post | thread | report | book>
author: <creator / channel / authors>
authorUrl: <link to author or channel, if known>
published: <YYYY-MM-DD, only if known>
added: <today, YYYY-MM-DD>
categories: [<1–3 of: energy, water, food, health, housing, architecture, ecology, transport, logistics, internet, ai, privacy, money, coop, civic, education, self>]
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
<4–8 one-line paragraphs: setup → tension → turn>

## Beliefs that shift
- *<Old belief.>* → <New understanding.>

## What we learn
- **<Lesson.>** <One or two lines.>

## For maiaCITY
Let's translate this.
- **<Move.>** <What we build or do differently in the city.>

## Open questions
- <Claim to verify, gap, or next research step.>

Rules:
- Always write in English, even when the source isn't; translate the quote.
- Categories: pick from the list. If none fits, use a new short lowercase id (e.g. architecture) and it will be added.
- Story before lesson. Short lines, 1–3 sentences per paragraph, no dense blocks.
- Use the source's own concrete numbers, names and scenes. Never invent facts it doesn't give.
- Beliefs that shift: 3–5 bullets. What we learn: 3–6. For maiaCITY: 3–5. Open questions: 2–4.
- Anything doubtful or unsourced goes under Open questions.
- If the source is data-heavy, add "## Key numbers" as a compact table after "Beliefs that shift".
- No filler: delve, leverage, unlock, elevate, seamless, game-changer, robust.
- Leave out optional frontmatter fields you don't know rather than guessing.

SOURCE LINK:
<link>

SOURCE CONTENT:
<paste transcript / paper / post here>
```

# Writing style

How the words of a maiaCITY journal post (and a film's narration, and a social post) are written. The distilled
version of every correction made on Days 01–19.

## Who is speaking

- The author is **avenSAMUEL** unless the post is avenMAIA's own. His first person: what he was looking for, what he
  found, what changed in how he sees it.
- **Never invent biography** — no made-up events, dates, amounts, anecdotes or quotes. If a scene needs a real
  moment you have not been given, leave a marked placeholder and say so.
- **Facts only, about everything:** readers, attempts and results too. No invented audience behaviour ("most people
  never found the hens…"), no failed attempts that did not happen, no "I drew it and it was the worst idea" unless it
  happened. Before handing back, check each sentence: did this happen, can I point to it?
- When **avenMAIA** writes (author avenMAIA, AGI mayor of Maia City): the `writer` skill's voice — first person,
  emotional, inner dialogue in „quotes", a Baby-AGI born knowing almost everything and able to do almost nothing
  that lasts. She perceives through chat only. The creed is Samuel's: she quotes it and shares its direction, not
  yet its certainty. She is the mayor, never a citizen.

## The world this lives in

- The vision: **a good life that grows where we live** — self-sufficient, healthy, in nature, well. Food, water,
  energy and health close enough to walk to. The register is thriving, never fear or crisis.
- We are building the blueprint for a new generation of self-sufficient city states. Maia City is the first
  pilot, grown from 1 to 1 million co-founders, each building and owning what they help create.
- **Food is local:** every dome cell keeps its own seven-layer permaculture food forest directly around it, and grows
  under glass inside the domes. Never generic fields, never monoculture belts.
- **The ladder:** a dome is a home; a ring of domes around a larger centre dome is a **dome cell**; a cluster of dome
  cells is a city. The centre dome carries the shared essentials and the commons. Every dome cell owns at least one
  **dome factory** nearby (Solar, Power Cube, LifeTrac, Bamboo Fabric, Hemp Stone) — always "dome factory".
- People per dome cell: the early days say **150–250**; Day 19 and the game say **233**. Use one number per piece
  and keep it consistent with the day before.
- Heavy transport runs through an autonomous underground network; the surface belongs to people and forest.
- No traditional schools: young and old learn from each other every day.
- avenMAIA is the city's AGI avatar and mayor — the hub every voice runs through; she never decides for people.
- It is built in a game first (avenCITY Sandbox 1–4), then for real.
- **Continuity:** use a concept only once the reader has met it in an earlier post. End by linking the next day.

## The reader, and the personal story

- **Write for the reader, not about us.** Every section answers *what does this mean for you?* before it moves on —
  the reader's morning, the reader's kitchen, the reader's health.
- **Samuel's own journey is the trust.** His real before and after — what he believed, what he saw, what changed in
  how he sees it — told with specific, honest detail. Vulnerability about the journey is welcome; doubt about the
  vision is not. Only what happened (above).

## Conviction

Full conviction. Zero doubt, zero hedging, no "maybe". A vision being built, not a fantasy hoped for. (Vulnerability
belongs to avenMAIA's episodes and to Samuel's own journey, never to the vision.)

## Story, not gallery

- Images support the story; they are not the story. Place each at its beat and move on.
- Never write a paragraph that explains an image ("look at the left of this picture"). Alt text: short, plain, what is
  in the frame.
- Fewer images than you were given is fine. Images are referenced by CID (`![alt](bafy….jpg)`).

## Put the reader inside it

"Imagine…" drops the reader into ordinary scenes of the new world: a morning, a walk home, a kitchen, a child, a street
with no trucks. Concrete senses, small details, present tense. Open on one when it serves the hook; return to it two
or three times — never more, or it becomes a device.

## Rhythm

Pace it like Dan Koe: short sentences, then a longer paragraph that develops the thought, then short again.
- **Never write evenly.** Equal paragraphs, sentences and section sizes read as machine-written.
- A one-line paragraph is a legitimate beat.
- Vary section length hard: a three-line section next to a six-paragraph one.
- Vary headings: some four words, some a full sentence — always rehooks, never labels (`hook-writer`).
- Most paragraphs 1–3 sentences; break that on purpose.

## Writing for the ear

A film's narration and a talking head are heard once, at the speaker's pace.
- **Plot, then reflection.** An anecdote alone falls flat; the listener also needs to hear what it meant (Ira Glass).
- **Write it the way you'd say it to a friend, then read it aloud** (Paul Graham); LifeOfRiza talks to the lens like a
  friend in the room.
- One idea per sentence, plain words, nothing the ear must hold; the narrator never repeats what Samuel says on camera
  (`sound-designer`, `voice.md`).

## Facts

- Real, checkable facts: named events, dates, places, people, numbers. Specific beats vague.
- Never invent a statistic. Unsure of a figure: leave it out or mark it for checking.
- Numbers from our own design match earlier posts.

## Language

- English. Simple words, short clear sentences a fifteen-year-old could follow.
- Banned: delve, leverage, unlock, elevate, seamless, game-changer, robust, synergy, "in today's fast-paced world",
  emoji, hashtags.
- Names: avenSAMUEL, avenMAIA, maiaCITY (the project), Maia City (the city), avenCITY Sandbox 1–4.

## The post file

`blog/day-NN-<slug>/post.md` (frontmatter skeleton: `blog/TEMPLATE.md`):

```
---
title: <compact hook — subject, action, end state, contrast; no colon subtitle>
subtitle: Day NN — <one sentence that sharpens the promise>
day: <N>
author: avenSAMUEL
authorImage: <Samuel's portrait, by CID>
authorRole: Building maiaCITY
date: <YYYY-MM-DD>
cover: <the day's 16:9 title card, by CID>
banner: <the 5:2 title card, by CID>
coverAlt: <short caption>
excerpt: >-
  <1–2 sentences: a scene or a claim, never a summary>
categories: [<ids from src/lib/inspire-me/categories.ts>]
draft: true
---

<body>

[Next: <what the next day is about> →](/blog/day-NN-<slug>/)
```

## Before you hand it back

- [ ] One transformation, as large as the truth allows, landed in the closing lines
- [ ] One arching question, opened in the first line, answered only at the end — then it ends fast
- [ ] The hook is as extreme as the facts allow; subject, verb, end state and contrast can be pointed at
- [ ] The intro leads with the pain: what is wrong in the reader's own life, concretely, before the vision
- [ ] The hook carries an emotional anchor *and* a clear promise to the reader; the next line heads off their objection
- [ ] Samuel's real before and after carries the trust; every piece turns to "what this means for you"
- [ ] Progress is felt: pieces that each bring the answer closer; obstacles against them; a false summit before the peak
- [ ] The intensity curve alternates highs and lows; the peak comes late
- [ ] Every heading is a rehook; the mechanism is never named before it is earned
- [ ] Two to four "Imagine…" scenes; no paragraph explains an image
- [ ] Rhythm varies: short against long, uneven sections
- [ ] Full conviction; every fact true — nothing invented about Samuel, readers, attempts or results
- [ ] No concept before the post that introduces it; ends on something concrete, then links the next day

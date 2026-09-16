# Inspire me — tutorial report cards

The prompt for a source that teaches how to do something: a video, a thread, a doc that walks through a technique. Same library, same card, same transformation as `FORMAT.md` — plus the two sections that make it a tutorial: the concepts from the ground up, and the steps.

It is deliberately generic. Editing software, a soldering trick, a permaculture swale, a shell command — anything that can be explained one concept at a time, from nothing, to someone who has never opened the tool.

## AI prompt

```text
You are writing a TUTORIAL report card for the maiaCITY "Inspire me" library — sources that shape the blueprint for a new city, built by 1 million founders.

A tutorial card teaches ONE technique and lands ONE transformation: from the slow way (the old belief) to the fast way (the new understanding). Whoever reads it should be able to do the thing afterwards without watching the source.

Output ONE Markdown file and nothing else, in exactly this shape:

---
title: <short, clear working title — what the reader can do afterwards>
originalTitle: "<the source's own title — only if different from title>"
source: <link>
type: <video | podcast | paper | article | post | thread | report | book>
author: <the creator's name, spelled consistently — it becomes their author page>
authorUrl: <their channel, site or profile, if known>
published: <YYYY-MM-DD, only if known>
added: <today, YYYY-MM-DD>
categories: [<1–3 ids, e.g. filmmaking, code, food, energy — the first sets the colour>]
hook: >-
  <1–2 sentences: the pain of the slow way, as a scene — not a summary>
shift:
  from: <the slow way, as a belief, one line>
  to: <the fast way, as a belief, one line>
quote: "<one line from the source that carries the shift, under 20 words>"
---

## The story
<8–12 short paragraphs: HOOK → CONTEXT → PROBLEM → INTENTION TO OVERCOME → OBSTACLE → SOLUTION.
The problem is the slow way, shown in action. The solution is the reader doing it the fast way.>

## From the ground up
<Every concept the steps depend on, one bullet each, in the order a complete beginner meets them:
- **<Concept.>** <What it is in plain words a twelve-year-old follows, and why it matters for this technique. Two or three sentences.>
Rules: no concept is used before its bullet. Name the real thing (the tab, the panel, the parameter). 4–9 bullets.>

## The steps
<A numbered list. One action per step, in the order you do it, naming exactly what to click, type or drag. Where a step only works because of a concept above, say which. 5–12 steps.>

## Beliefs that shift
- *<Old belief.>* → <New understanding.>
(exactly three)

## What we learn
- **<Lesson.>** <One or two lines — what transfers beyond this tool.>

## Open questions
- <Anything the source shows but doesn't state (a value on screen you can't read from a transcript), a claim to verify, or what to try next.>

Rules — these matter most:
- Explain like the reader is twelve and has never opened the tool. Short words. One idea per sentence. Build each concept on the one before it, from the ground up.
- The story still follows the arc: each paragraph follows from the last or pushes against it, never "and then". Never write "therefore" or "but" as beat markers, never in bold, never label the beats.
- The story answers the shift: the reader watches the slow way fail and the fast way arrive, and the last line delivers it.
- Open on a hook. No warm-up.
- Vary the rhythm: mostly 1–3 sentence paragraphs, then break it on purpose — a one-line paragraph, a long turning sentence next to a short one.
- Use only what the source shows. If a value, expression or setting is on screen but not in the transcript, do not invent it: describe what it does and put the exact value under Open questions.
- No filler: delve, leverage, unlock, elevate, seamless, game-changer, robust.
- Always write in English, even when the source isn't.

SOURCE LINK:
<link>

SOURCE CONTENT:
<paste transcript / doc / post here>
```

---
name: storyteller
description: The writer of maiaCITY's films, journal posts and social posts — story structure and retention. The episode format (half devlog, half a life based on a true story); the transformation (from → to) and the arching question; three acts and the masters' beat structures scaled to a 1–10 minute film; scene by scene, how a story moves forward (LifeOfRiza's rules, but/therefore, intention and obstacle, value turns, setups and payoffs, people introduced through action); tension and release cycles, curiosity and payoff, the retention playbook second by second; the journal voice and writing for the ear. Use it whenever a story is planned, written, restructured, scripted or checked for why viewers leave.
---

# Storyteller

The writer's craft for every maiaCITY story, on the page and on screen: what it is about, how it is built, and why a
viewer stays to the last line. The hook itself is the `hook-writer`'s; the pictures are the `director`'s.

## The writer's laws

1. **One transformation, as large as the truth allows.** *From* what the viewer believes arriving, *to* what they
   leave with — decided before a word is written (`arc.md`).
2. **One arching question,** opened in the first line, held open by progress, conflict and doubt, answered at the end
   — then end fast (`arc.md`).
3. **Lead with the pain:** what is wrong in the viewer's own life, concretely, before the new world (`arc.md`).
4. **Three acts, always — even in sixty seconds:** a problem or a conflict, what it costs to overcome, its
   resolution (`structure.md`).
5. **Every scene is a step.** Each one gives the audience something new that moves the story forward, because of the
   scene before it or against it. A scene that only shows is a scene that stops (`scenes.md`).
6. **Tension, release, a bigger tension — as feelings.** Name what the viewer feels at every beat, each feeling set
   against the one before; close one loop and open the next in the same breath; the peak comes late (`emotion.md`,
   `retention.md`).
7. **Based on a true story.** Re-enact, compress, plan every shot — but invent nothing about Samuel's life, the
   viewers, attempts or results (`writing.md`, `scenes.md`).

## The sub-skills

| File | The skill | Use it for |
|---|---|---|
| `format.md` | the episode format | what every maiaCITY film is: half devlog (the city being built, seen working), half a life based on a true story (cinematic, voice-over and to camera); the episode's shape; the character — a leader setting out |
| `arc.md` | the transformation and the arc | from → to, the arching question, the pain, hook → story → lessons, the pieces, the obstacles, a film's acts |
| `structure.md` | three acts, scaled | the masters' structures (Field, Snyder, McKee, Harmon, Pixar) and where their beats fall in a 1-, 3-, 5- and 10-minute film |
| `scenes.md` | scene by scene | how each scene moves the story: the next-button test, but/therefore, intention and obstacle, value turns, setups and payoffs, introducing people through action, the vlog that is based on a true story |
| `emotion.md` | the emotional journey | the feelings the viewer goes through beat by beat, tension and release as pairs of feelings, marking them on the arc (`story_arc`'s `feel`), how sound, colour, pace and light follow them |
| `retention.md` | tension and release | the intensity curve, contrast in every sense, curiosity and payoff, the retention playbook second by second, pace |
| `writing.md` | the words | who speaks, the world's facts, rhythm, "Imagine…" scenes, the post file, writing for the ear, the checklist |

## The order of work

1. The format (`format.md`): which work this episode shows working, and which part of his life carries it. Then the
   transformation and the arching question (`arc.md`).
2. The structure: the acts and their beats in seconds for the film's length (`structure.md`).
3. The scenes: one line each — what the audience learns in it, what it turns, what it sets up (`scenes.md`).
4. The emotional journey and the intensity curve over those scenes: the feeling of every beat, tension against release, highs against lows, the peak late (`emotion.md`, `retention.md`); set on the timeline's Story track with `story_arc`.
5. Show Samuel the transformation, the question, the hooks (`hook-writer`) and the scene list with its curve. Only
   then draft.
6. Draft in the voice (`writing.md`); a film's script goes to the `director` for its shots.
7. Check: the retention test (`retention.md`), the scene test (`scenes.md`), the checklist (`writing.md`).

## In avenDB: a story's Journey tab

A story is an avenDB entry of the `story` schema; its Journey tab (`src/lib/avendb/StoryJourney.svelte`) shows the
transformation, the arching question and the beats along a tension curve. Through the avenDB MCP an agent writes
there as its shares allow:

- `from`, `to` and `question` are strings on the story.
- Each beat is a row of `beats`, in order: `{ id, type, title, text, link, feel, tension }`. `id` is a new integer;
  `type` one of hook, context, problem, intention, obstacle, low, turn, solution, vision; `link` how it follows the
  beat before, `"but"` or `"therefore"` (none on the first); `feel` what the viewer feels there (`emotion.md`);
  `tension` 0 calm to 100 the most (`retention.md`).
- Propose, never change the main line: `avendb_ask` `{ op: "note", entry }` gives the main line's `heads`;
  `avendb_run` `{ op: "propose", entry, from: <heads>, name: "Beats: <angle>" }` answers its `line`; then one
  `{ op: "batch", ops: [...] }` of `{ op: "set", entry, line, path: ["from"], value }` and the like, and
  `{ op: "insert", entry, line, path: ["beats"], value: <row> }` for every beat, in order. The person sees the
  proposed beats above their own on the Journey tab and merges the proposal there.

## In avenDB: a story's Writing tab

The story's article is an entry of its own, of the `article` schema, beside the story: its Writing tab
(`src/lib/avendb/StoryWriting.svelte`) shows it as the journal lays it out, with its variants. The article's record:
`{ title, text, story, language, excerpt, quote: { text, by }, tags }`. `text` is the Markdown, its subtitle the
emphasised line it opens with and its cover the picture alone after it; `story` links the story,
`{ vault, entry }`; `language` a code such as `en` or `de`.

- Find it: `avendb_run` `{ op: "query", where: { type: ["article"] } }` and take the rows whose `story.entry` is the
  story's. A variant (`variantOf` set) is a German or a shorter one.
- Propose, never change the main line: `avendb_ask` `{ op: "note", entry: <article> }` gives the `heads`;
  `avendb_run` `{ op: "propose", entry, from: <heads>, name: "Tighter: <angle>" }` answers its `line`; then
  `{ op: "set", entry, line, path: ["text"], value: <the whole text> }`. The person merges it in the article editor,
  where the Writing tab links.
- A story with no article yet: write it only where the share allows creating articles, as `{ op: "create", vault,
  type: "article", value: { kind: "article", title, text, story: { vault, entry }, language } }`; else propose its
  text in the reply and let the person start it from the Writing tab.

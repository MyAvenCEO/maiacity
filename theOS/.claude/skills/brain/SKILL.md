---
name: brain
description: theOS's memory (brain) and the one door to it. Use before acting on any decision, term, source, lesson, metric or intent in theOS, and for every write to them.
---

# brain

brain is theOS's memory: one JSON doc per thing, each named by a flat hash id (d-… a decision, aip-… an intent) and
shown as its id and title. A doc holds until a newer doc supersedes it; superseded in part, the rest still holds. What
holds is computed, never stored. Every read and every write goes through these verbs; never edit a doc's file by hand:
brain check fails a commit that changed a doc without the event a verb writes. Run them from theOS/ as
`node brain/brain.mjs <verb>`.

- `brain prime`: the decisions and terms that hold now, and what waits for Samuel.
- `brain holds <type>`: the docs of a type that hold now.
- `brain get <id>`: one doc, whether it holds, what supersedes it, its links and backlinks.
- `brain reflect <type> <draft.json>`: the docs a draft may supersede: same type, holding, a shared topic word.
- `brain add <type> <doc.json> --intent <aip id> --by <author id> [--task <id>]`: a new doc: id minted, schema checked, filed, its event written.
- `brain edit <id> <patch.json> --intent <aip id> --by <author id>`: a correction that keeps the meaning; a change of meaning is a new doc that supersedes it.
- `brain append <id> <list> <entry.json> --intent <aip id> --by <author id>`: an entry at the end of a list that only grows.
- `brain index`: the index docs and brain/ids.json written again from the folders.
- `brain install`: this clone's pre-push hook (brain check) and the merge driver for lists that only grow.
- `brain versions`: every link whose target changed after it was cited, into brain/versions.json for the apps (c5).
- `brain mcp`: the same verbs as an MCP server on stdio, for other sessions and tools (theOS/.mcp.json).
- `brain check [--range a..b]`: every commit in the range against its parent: events cover every changed doc, schemas, history only grows.

A write names the intent it serves (--intent) and its author (--by, an author doc's id) and appends that intent's event;
commit the files it wrote with your work. To replace or drop a doc, add a newer one whose supersedes names it
(`{ "doc": "<id>", "part": "all" or the part, "what": "…" }`); brain refuses a supersede of a doc that no longer
holds, and records the candidates you left for the reviewer. Add `--json` for data. A refusal prints a fixed code and
its fix; follow the fix.

This file is written by `brain index` from brain's verb list; do not edit it by hand.

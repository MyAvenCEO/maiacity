---
name: brain
description: theOS's memory (brain) and the one door to it. Use before acting on any decision, term, source, lesson, metric or intent in theOS, to read what holds now instead of raw files.
---

# brain

brain is theOS's memory: one JSON doc per thing. A doc holds until a newer doc supersedes it; superseded in part, the
rest still holds. What holds is computed, never stored. Read brain through these verbs, never by opening the raw JSON
and guessing what still holds. Run them from theOS/.

- `brain prime` (`node brain/brain.mjs prime`): the decisions and terms that hold now, and what waits for Samuel. A
  session-start hook already ran it for you; run it again after you changed brain.
- `brain holds <type>` (`node brain/brain.mjs holds decision`): the docs of a type that hold now. Types: decision,
  term, reference, intent, lesson, metric, session, author and the others in avenCEO/types.
- `brain get <id>` (`node brain/brain.mjs get d-0e44`; an old name such as D-12 still resolves): one doc, whether it holds, what supersedes it, its
  links and backlinks.

Add `--json` for data. A refusal prints a fixed code and its fix (not_found, unknown_type, missing_arg, bad_root,
unknown_verb); follow the fix.

Writes (add, edit, append, index) come with the rest of brain's checkpoint 2 (aip-836d). Until then, write docs as the intent's record says.
This file is written by hand at checkpoint 1; from checkpoint 2, brain index writes it from brain's verb list.

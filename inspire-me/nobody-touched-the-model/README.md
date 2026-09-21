---
title: 300 tries instead of 51,000, and nobody touched the model
originalTitle: "Did Google just kickstart the intelligence explosion?"
source: https://www.youtube.com/watch?v=LoLYw--s-5w
type: video
author: Fireship
authorUrl: https://www.youtube.com/@Fireship
published: 2026-09-17
added: 2026-09-21
categories: [ai, code]
hook: >-
  The agent beat a standard machine-learning library in about 300 attempts, where the previous
  record holder needed roughly 51,000. Its weights were never retrained. All that changed was
  what it chose to try next.
shift:
  from: An AI gets better by becoming a better model.
  to: This year's gains came from changing how the same model searches — and the log of everything it already failed at is the asset.
quote: "The first ultra-intelligent machine is the last invention man ever need make."
quoteBy: I. J. Good, 1965
---

## The story

In 1965, a British mathematician who had spent the war at Bletchley Park working alongside Alan Turing wrote a sentence that has haunted the field ever since: the first ultra-intelligent machine would be the last invention humans ever need to make.

The logic is a loop. Once a machine is good enough to improve itself, every improvement makes it better at improving, which makes it better at improving. Recursive self-improvement. Sixty years of anticipation, and a permanent supply of people announcing it has arrived.

Two papers landed in the same week of September 2026. Thirty-three researchers across ByteDance, Tsinghua and other Chinese labs published a five-stage roadmap toward it, ending with an AI that rewrites the process it uses to improve itself. Days later, Google DeepMind and the University of Maryland answered with something narrower and, for anyone actually building things, more useful.

To see why, you have to look at the part of AI discovery nobody talks about.

Every mathematical result this year came out of the same loop, the one AlphaEvolve made standard: give a coding agent a problem and a scoring function, then let it propose a solution, score it, read the feedback and try again — a few thousand times. That loop produced the Jacobian conjecture result this summer, and OpenAI's run at Navier–Stokes earlier this month.

Inside that loop is a decision made at every single step. What do we try next? If one attempt scored slightly better than the rest, do you build on it or abandon it for something that might be better still? If an attempt crashed before producing anything, was the idea wrong or just the implementation?

That decision is the exploration policy, and until this month it was hardcoded by whoever set up the loop. Changing it meant running everything again.

The DeepMind team noticed that it doesn't. If you save every attempt — the code it wrote, the score it got, whether it crashed — you have a record complete enough to ask a different question of. Show a brand-new policy the old runs sitting on disk, and let it say where it would have gone instead. No model touched, no compute spent on the real problem.

And because replaying a decision against cached history costs almost nothing, you don't test one new policy. You test thousands, keep whichever would have reached the best answer in the fewest attempts, run the next round for real with that one, save those results too, and go again. The paper calls this dreaming.

Pointed at eight problems in algorithm design and mathematics, it did measurably better than the same setup with a fixed policy. On one, it produced a lasso solver beating Python's standard machine-learning library in roughly 300 attempts, against 550 for the static policy and about 51,000 for the previous record holder.

The prompt driving it is almost funny in what it reveals. It pleads with the agent to read every past attempt before writing any code, to stop making tiny variations on the same idea, and not to kill running processes.

So is this the thing Good described? No. The model writing each new exploration policy is the same Gemini that wrote the last one. It cannot find a solution it was never capable of writing — it just stops wasting attempts on the way there.

That deflation is worth sitting with, because it is true of all of it. Jacobian, Navier–Stokes, the progress on Riemann: static models wrapped in a custom harness, with sub-agents, swarms and orchestration doing the heavy lifting. The weights only improve when a human takes what the swarm found and trains the next model on it.

Which makes the loop real, and the human still the part that closes it.

## Beliefs that shift

- *Progress comes from bigger and better models.* → This year's headline results came from unchanged models inside better-designed search loops.
- *Every failed attempt is waste.* → The failures are the training set for the search strategy; keeping them is what made replay possible.
- *Improving the searcher and improving the search are the same thing.* → They are separable, and only one of them currently needs a GPU.

## Key numbers

| Thing | Number |
| --- | --- |
| I. J. Good's paper on the first ultra-intelligent machine | 1965 |
| Researchers on the Chinese RSI roadmap paper | 33 |
| Stages in that roadmap | 5 |
| Problems the dreaming setup was tested on | 8 |
| Attempts to beat the standard library — dreaming | ~300 |
| Same, with a fixed exploration policy | 550 |
| Same, previous record holder | ~51,000 |

## What we learn

- **Log everything, including the crashes.** The whole method depends on a record complete enough to ask new questions of later. An attempt you did not save is an attempt you cannot learn from twice.
- **Replay is free; reality is expensive.** Testing a decision against cached history costs nothing, so you can afford thousands of tests that would be unthinkable live.
- **Separate the searcher from the search.** You can improve how something explores without improving the thing that explores, and right now that is where the cheap gains are.
- **Name the policy you are running.** Most systems have an exploration policy whether or not anyone wrote it down — and you cannot improve a decision you have not made explicit.
- **The harness is the invention.** Sub-agents, swarms and orchestration around a fixed model produced the results; the model was the same one everybody else had.
- **A human still closes the loop.** Weights improve when a person trains the next model on what the swarm found. That is the step that makes it recursive, and it is not automated.
- **Watch for the deflation.** "Self-improving" claims are worth checking against one question: did the thing doing the improving get better, or just its strategy?

## Open questions

- Both papers are days old and unreviewed at the time of this clip. Read the DeepMind and ByteDance/Tsinghua papers directly before repeating any of these numbers.
- Replay assumes the cached runs are still representative. What happens when a new policy would have explored somewhere the old logs never went — does the method quietly cap itself at the edges of its own history?
- The transcript renders several names phonetically (I. J. Good, Bletchley Park, Tsinghua, Riemann). Verify spellings and affiliations against the papers.
- For us: this is the same bet as building the city in a game first — run it forward, keep every failure, change what you try next rather than who is trying. Worth asking what our equivalent of an exploration policy is, and whether we have ever written it down.

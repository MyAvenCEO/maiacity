<!-- The words of maia.city/docs/avenbrain/ as Markdown, made by scripts/docs-markdown.mjs from the built page. -->

[← Docs](../../docs)

avenBRAIN · architecture · design of 20 October 2026

# avenBRAIN Architecture

avenMAIA’s own harness, and the loop that makes it better. The skills, memory, guardrails, scripts and subagents an aven works with are entries in avenDB. Each real task runs them, tries edits on the same task, merges the edits that earned their place, and puts the result to a person as one proposal.

Promises

## What avenBRAIN promises

A harness is everything around a model that makes it an agent. avenBRAIN never changes a model. It changes the harness, from evidence, and only through proposals a person accepts.

Your accept

**Only a human accept reaches main.**

avenBRAIN acts as a device of avenMAIA, with its Suggester and AIP author shares. It proposes, drafts, measures and promotes. Every skill, harness, deliverable and lesson it changes reaches main only when an owner of the vault accepts the AIP that holds it.

Any runtime

**One harness runs on Claude Code, Codex or our own LLM API.**

The runtime is a plug-in, a substrate. Each has its own living variant of the harness, so its caps and file shapes stay on its variant while it follows main.

Versioned

**Every piece has a version, an author and a history.**

Skills, harnesses, runs, traces and lessons are avenDB entries. Candidates are proposal lines, so a round never overwrites anything, and a bad adoption is undone with a restore.

Evidence

**An edit stays only where a run shows why.**

The composer keeps an edit only with a moment in a trajectory that explains it. A failure seen in one run of several is noise, and an edit aimed at it is overfitting.

Measured

**Better means what a Lean objective says.**

Every round lives on one AIP whose objective is a file of Lean metrics. Readings are signed writes, so who measured what, and when, is on record.

Memory

**The library holds only lessons you have seen.**

The reflector drafts at most one lesson per round inside its AIP. It joins the domain’s library when the AIP is accepted, and not before.

From harness2

## A port of Google Research’s harness2, made native

avenBRAIN takes its method from [harness2](https://github.com/google-research/harness2), Google Research’s framework for recursive agent harnessing (Apache 2.0, paper [arXiv 2610.14224](https://arxiv.org/abs/2610.14224)). harness2 improves a frozen model’s harness in two loops. On one task, a Propose–Probe–Compose step proposes edits, runs them on the same task, and composes a better harness from how the runs differ. Across tasks, a library per domain keeps the harness that was adopted and the lessons the evidence supports, for the next task of that domain.

harness2 keeps all of this as folders on disk. avenBRAIN keeps every piece as avenDB entries, lines and versions, so most of the method needs no new rule: proposals, merges, variants, AIPs, objectives and files already exist.

| In harness2 | In avenBRAIN |
| --- | --- |
| **Harness tree, eight kinds of file** | A harness entry: always-on text, links to skill entries and code entries, each pinned at a version |
| **Skill folders, SKILL.md and its files** | A skill entry: name, trigger, main text, and its other files as rows |
| **Substrates and their surface specs** | A Substrate in Rust, and a living variant of the harness per substrate |
| **A benchmark’s task** | A task entry: domain tag, prompt, pinned inputs, the entry its deliverable writes to, and its AIP |
| **A rollout in a run folder** | A run entry with its trace as a file by BLAKE3 hash; its deliverable is a proposal line, never main |
| **The run fingerprint** | The run’s key: BLAKE3 of the task pin, the harness pin, the substrate and the model |
| **The context folder** | The same context/ folder, built from entries the agent may read, with its leak checks |
| **Two editors writing files** | Two editors, each writing a proposal line on the harness and skill entries |
| **Compose: a model writes one tree** | Compose: a three-way merge of the editors’ lines into a compose line, clashes resolved by take |
| **Blind selection** | A blind pick of one final for the AIP; the vault’s owner is the last selector |
| **The judge, after selection** | The AIP’s Lean objective, evaluated per candidate |
| **The budget ledger** | A Lean theorem over the round, replayed by Rust, and a cap in USD and minutes |
| **The domain library and EXPERIENCE.md** | Lesson entries tagged by domain; the index is a query, never a file |

Status

## A design, not built yet

This page describes avenBRAIN as it is planned. No code of it exists yet, and avenDB ships none of its schemas. It builds on the AIP objective stage (idea, objective, proposed, archived), which is being built now. The roadmap says what comes in which order, and what each step waits for.

The harness

## A harness is entries

harness2 edits eight kinds of file: the system prompt, guardrails, memory, tool guidance, subagents, skills, scripts and plugins. In avenBRAIN they are fields and links of one harness entry. The always-on texts, which an agent reads on every run, are fields of it. Each skill is a skill entry of its own, and each script a code entry, and the harness links to each at a version. So a harness version names exactly which skill text and which script it ran with.

A harness is written down into a workspace before it runs, as the runtime expects it: for Claude Code its CLAUDE.md and .claude/skills, for Codex its AGENTS.md and .agents/skills. The aven’s own runtime needs no files: it reads the harness from avenDB.

One round

## Run, propose, probe, compose, propose to a person

One round improves the harness on one task. Its budget k sets how many base runs, candidates and compositions it makes. Parallel rounds explore wider: k candidates per editor from the same evidence, then k compositions. Sequential rounds refine deeper: k passes, each editing the last one’s result and reading its run.

1 Base runsthe current harness,k times on the task2 INV editorhow the agent works:tools, scripts, checks2 DOM editorwhat an expert knows:skills, rules, checks3 Probeeach edit runs once,on its own line4 Composemerge the lines thatearned their place5 One AIPits readings;you accept it6 A lesson in the domain’s libraryread by the editors of the next roundon acceptthe next task in this domain

*[Figure 1, drawn live on the page] One round on one task. Steps 1 to 5 improve the harness for this task; the dashed path is the second loop: what an accepted round learned is read by the next task of the same domain.*

Swipe the diagram sideways to see all of it.

- **Base runs.** The current harness runs k times on the task. Each run is a run entry, its deliverable a proposal line on the target entry, its trace a file.
- **Context.** For each editor, the engine writes a context/ folder: the task, every trace, the harness, earlier candidates, and the domain’s lessons.
- **Propose.** Two editors edit the harness at the same time, each on its own proposal line: INV on how the agent works, DOM on what an expert knows.
- **Check.** A proposal that leaves the harness’s shape, lacks a skill’s trigger, passes a size cap or does not compile gets one retry with the error. A second failure falls back to the harness it started from.
- **Probe.** Each candidate runs once on the same task. Its deliverable is its own proposal line, so every candidate stays to compare.
- **Compose.** The composer merges the editors’ lines into one line, keeps each edit a trajectory moment supports, or keeps the harness as it was.
- **Pick and propose.** A blind selector picks one final. One AIP holds its deliverable line, the harness and skill lines, its readings and a lesson draft, and is promoted.
- **Accept and remember.** An owner accepts, declines or revises the AIP. On accept the lines merge into main and the lesson joins the domain’s library.

Two editors, one composer

## Each editor owns one kind of change

### INV: how the agent works

Procedure, tool use and finishing. It traces the workflow, fixes the first point where it went wrong, and picks the cheapest lever: a bounded fallback for a tool error, a script for a repeated mechanical step, a skill with a trigger for a narrow procedure, a check that reopens the deliverable after it is written.

### DOM: what an expert knows

The deliverable, its audience, its required parts and the checks an expert makes, written as rules the agent can apply and check. Its default home is a skill with a trigger. It never invents a source, a standard or a fact.

### The composer

It reads the base runs, every candidate and its run, and the editors’ notes. It may merge both lines, take one whole, or keep the harness as it was: keeping it is a real answer. Every decision is one line of notes with the evidence that decided it, such as “kept, the audit script: same-size pair in 2 of 2 base runs, gone in inv1”.

Compose is avenDB’s own merge: the editors’ lines merge into a compose line three ways, as a pull request merges, and a merge into a proposal needs no accept. Where both lines changed one place, the composer picks a side.

Measured in Lean

## An objective says what better means

harness2 refuses every score while it improves, because a benchmark’s grader could leak its answers. avenBRAIN’s metrics are a vault’s own targets, so it uses them, and keeps harness2’s care about who sees what. A round starts only from an AIP whose objective holds at least one metric, written in Lean against AvenDB.Objective.

- Each candidate keeps its own readings, and the objective is evaluated for each one alone.
- The final that goes into the AIP has its readings written on the AIP, where its reviewer reads them.
- The editors see the metrics’ names and goals, never a candidate’s readings. The composer and the selector see both.
- Work metrics measure the deliverable. Process metrics, such as delivered, cost and minutes, come from every run.
- Where it can, a trusted checker reads a metric from the deliverable itself, such as a cut’s own rows.

```
import AvenDB.Objective
open AvenDB.Objective

/-- Every item of the editor's audit passes. -/
def audit : Metric := metric "Audit items passed" (atLeast (reading "audit_passed") 9)

/-- The visual hook lands within 3 seconds. -/
def hook : Metric := metric "Visual hook, s" (atMost (reading "hook_s") 3)

/-- The fine cut keeps a third to two-thirds of the assembly. -/
def kept : Metric := metric "Kept share of assembly"
  (between (reading "locked_s" / reading "assembly_s") 0.33 0.67)

def objective : List Metric := [audit, hook, kept]
```

*[Figure 2, drawn live on the page] An objective for one film-editing round: the editor’s audit, the visual hook, and how much of the assembly the fine cut keeps.*

Memory

## Four layers, from always loaded to raw evidence

Every memory is an entry, so each has a version, an author, a history and a review. The index of a domain’s library is a query of its lesson entries, newest first, each with its cue, written into the editors’ context as harness2 writes its INDEX.md.

| Layer | What it holds | Who reads it | Where it lives |
| --- | --- | --- | --- |
| **Always-on memory** | Short facts true for every task of a domain, capped by the runtime | The agent, on every run | Fields of the harness entry |
| **Skills** | Know-how with a trigger, loaded when it fires | The agent, when the trigger fires | Skill entries the harness pins |
| **Lessons** | What each edit did, and at most one lesson per round: cue, lesson, evidence, confidence | The editors and the composer | Lesson entries tagged brain:domain:<domain> |
| **Runs and traces** | Every run’s trajectory, deliverable line, cost and readings | The editors of the next round | Run entries and their trace files |

A lesson names the edit rows and runs it rests on. When a later round tries the same component, its verdicts join the lesson by proposal, so a lesson grows stronger or weaker with evidence. A lesson whose rows say only “confounded” reads as a guess, and a round may write no lesson at all.

Five schemas

## What avenDB is to hold for it

Five schemas, written in avenDB’s Lean model first and shipped like every built-in schema, so every app reads them offline. No new op and no change on the wire: avenBRAIN writes with create, propose, set, merge, variant and the AIP ops, as any agent does.

| Type | Fields |
| --- | --- |
| `skill` | name, description (its trigger), text, files as rows {id, name, text} |
| `harness` | title, domain, substrate, the always-on texts, links to skills and code entries pinned at versions |
| `task` | domain, prompt, inputs pinned at versions, the target entry, the AIP that measures it |
| `run` | task, harness pin, substrate, model, round and stage, delivered, cost, minutes, readings, trace file |
| `lesson` | domain, cue, lesson, evidence, confidence, edit rows {component, change, observed, verdict}, the harness and runs behind it |

Any runtime

## One harness, three runtimes

A substrate knows how to write a harness for its runtime, run it, and read its trajectory into one shared grammar of actions, observations and errors. The editors and the composer run on a channel of the same kind, so avenBRAIN needs no one vendor.

| Substrate | How it runs | What it reads of the harness |
| --- | --- | --- |
| **Claude Code** | Headless (claude -p), in a cloud session or on the Mac | CLAUDE.md, .claude/skills, scripts, subagents, hooks |
| **Codex** | codex exec, in a workspace of its own | AGENTS.md (8,000 characters at most), .agents/skills, hooks |
| **Aven native** | Our own loop in Rust over an LLM API, avenDB ops as its tools | The harness entry as it stands, read straight from avenDB |

On avenMAIA

## A device of the aven, with its rights and no more

avenBRAIN is its own Rust workspace beside avenDB, reusable by any COOP’s aven. For Maia City it runs as agentBrain, a device of avenMAIA that an owner adds in The OS, as for every agent. It holds what avenMAIA holds: Suggester on Maia City and an AIP author share. So it proposes lines, drafts new entries, records readings and promotes AIPs, and merges nothing into main.

Its runs are tasks on the Jobs page. Each has a lease and a key, the BLAKE3 of what it runs, so a round stopped halfway resumes without running a finished run again. A round has a cap in money and minutes, and runs where its work can: a cloud session for text, the Mac for renders.

```
avenbrain/                       its own Cargo workspace, beside avendb/
  NOTICE                         harness2's Apache 2.0 notice
  spec/AvenBrain/                Lean: Round.lean, RoundVectors.lean
  crates/avenbrain/              the engine: schedule, context, checks, ledger
  crates/avenbrain-substrate/    Claude Code, Codex, Aven native
  crates/avenbrain-store/        avenDB: a device of avenMAIA, ops through run(op)
  crates/avenbrain-cli/          the avenbrain binary: round, materialise, demo, check
```

Budget and proofs

## Every round spends exactly what its budget says

A round of budget k makes 4k runs (k base runs, 2k candidates, k finals) and 3k editor sessions (k INV, k DOM, k compositions), in both modes. Lean is to prove it of both schedules, and that a stage that fails twice falls back to the harness it started from. The Rust engine replays the Lean vectors, as it does for avenDB’s rules and for objectives, and refuses a round whose record does not add up, as a repeated label means one run took another’s place.

Examples

## A film cut and a story, one round each

### Film editing

The task: cut a day’s film from its script and footage. The deliverable is a line on the film’s cut entry. The objective is the Lean file above. Both base runs leave two same-size shots in a row and never reopen the cut. INV adds an audit script and a rule to run it before finishing; DOM adds the rule to put each named thing on screen at its word. The composer merges both, the AIP holds the chosen cut line and the skill lines, and the lesson reads: when a tool call writes the deliverable, the harness reopens and checks it.

### Story writing

The task: write a day’s journal story from its sparks. The deliverable is a line on the story’s text, so it is the cheapest domain to start with. The objective: the peak beat in the second half, an end warmer than the start, a hook of 12 words at most, and no fact without a spark. INV may add a step that plans the intensity curve first; DOM may add the false summit just before the peak.

The edits in both examples show the mechanism; a real round’s edits come from what its runs show. Assets, worlds, game rules and docs follow the same pattern, each with its own deliverable entry and its own readings.

Roadmap

## From Lean to a first round

| Step | What it ships | Where it stands |
| --- | --- | --- |
| **B0** | Decisions: where the code lives, schemas, who picks, which LLM API, budget, the skills’ source | Open |
| **B1** | Lean: Round.lean (both schedules, the 4k and 3k budget, the fallback) and the five schemas | Waits for the AIP objective stage to merge |
| **B2** | avenDB ships the five schemas; no new op, no wire change | Not started |
| **B3** | The skills become skill entries; a pinned harness is written into a workspace | Not started |
| **B4** | The engine in Rust, with harness2’s ledger demo as its test | Not started |
| **B5** | Substrates: Claude Code and Aven native; Codex later | Not started |
| **B6** | The store and the device agentBrain of avenMAIA | Not started |
| **B7** | A brain rule on the Jobs page: leases, keys, caps | Not started |
| **B8** | Pilot: one story-writing round | Not started |
| **B9** | Film editing rounds | Not started |
| **B10** | Assets and worlds rounds | Not started |
| **B11** | A Brain view in avenDB | Not started |

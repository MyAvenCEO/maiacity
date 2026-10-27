---
name: devx-speed
description: "How to work fast in this repository with many Claude threads at once: one task branch per thread, a one-command local check, a collector that lands 25-50 tasks in one PR with one CI run, and the measure-change-measure cycle for developer speed. Use when starting or finishing any code task here, when acting as a batch collector, when splitting work across threads or helpers, or when asked to make development, CI or shipping faster."
allowed-tools: Read Write Edit Grep Glob Bash
---

# Fast, safe throughput: many tasks, one CI run

The goal is throughput across all threads, with main as safe as ever. Work runs in parallel in many threads; CI runs
once per batch of 25-50 tasks (repository `CLAUDE.md`). Measured baseline and history: `docs/devx/cycles.md`.

## Where the time went (2026-10-27)

- Oct 13-21, no CI on pull requests: about 74 tasks a day reached main, median open-to-merge under 10 minutes.
- Oct 22-27, CI on every push of every PR: about 18 a day (4x fewer), median open-to-merge 17-43 minutes. Each push
  started ~20 jobs on a plan that runs 20 at a time, a quarter to a third of PR runner time was cancelled runs, a
  branch saw 5.5 pushes on average.
- Inside one cloud box (4 cores): helpers that each start cargo queue on one build folder; a cold checkout needs
  ~10 min of Rust before its first test (~4 min with the dev cache).

So the wins are (1) no CI per task, (2) parallelism across threads (each has its own box), not across helpers in a
box, (3) a collector that lands branches in seconds, and (4) checks that run only what a task touched.

## Coordinator: how to size and hand out work (Samuel 2026-10-27)

Tasks per batch (25-50) are not threads. A thread costs a fixed start before it does useful work, so it should carry
enough work to pay that back. Measured on a 4-core cloud box (2026-10-27):

| fixed cost of a new thread | JS/page work | Rust work |
|---|---|---|
| box start: bun install 9 s, dev-cache hook ~65 s | ~1 min | ~1 min |
| first check / first test build | svelte-check ~65 s | ~4-5 min (dev cache), ~10 without |
| reading in: the code, memory, the brief (estimate) | ~5-10 min | ~5-10 min |
| total before useful work | **~8-12 min** | **~10-15 min** |

Sizing rule: keep that start under ~20% of a thread's work.

- **A new thread gets at least ~45 min of work (JS), ~1 h (Rust).** Smaller tasks are grouped: several small tasks
  on the same area go to one thread, done one after another, one commit (or branch) each, so they still land as
  separate `Task:` lines in the batch.
- **Split into separate threads only when the pieces are independent and own different files.** Two pieces on the
  same files stay in one thread (they would conflict in the batch anyway).
- **Rust in parallel = separate threads.** One box has one build folder (~18 GB warm, of ~39 GB disk) and one cargo
  lock, so a second Rust helper in the same box waits or fills the disk. Helpers in a thread are for reading,
  searching, JS, docs and measuring.
- **How many at once:** as many as there are independent, big-enough chunks, typically 5-15 threads in flight, each
  doing several tasks. Fewer threads also means fewer replies for Samuel to read.
- **Name the collector up front.** Task threads report "branch ready" to the coordinator, which routes it to the
  collector; they never merge to main or mark PRs ready.
- **Cut a batch, don't wait for stragglers.** When 25-50 tasks are in, or a few hours have passed, the collector lands
  what is ready; late tasks go in the next batch.
- **Exceptions get their own PR at once:** production down, a security fix, or Samuel asks.
- Re-check the numbers in this table with the cycle below when the setup changes (dev cache, box size).

## Task thread: the loop

1. Branch from `origin/main`. Own a clear set of files; say which in your first reply so the coordinator can keep
   other threads off them.
2. Edit. Then `bun scripts/devx/check.mjs` (`--plan` to see it first). It runs only the test files next to your
   change, svelte-check when page code changed (~70 s), and per touched crate `cargo check --tests` then only the test
   programs you touched, one command at a time. About 1-2 minutes against 8-15 for a CI round.
3. Commit, push the branch. A draft PR is fine (drafts run no CI); never mark it ready, never dispatch a workflow
   for a task, never merge it yourself.
4. Tell the coordinator the branch is ready for the batch, with one line on what it does and what you checked.
5. If the collector reports a conflict with your branch: `git merge origin/main` (or the collector's branch) into
   yours, fix, check, push, say so. Otherwise don't merge main into a task branch "just in case".

## Helpers inside one thread

- Parallel helpers pay off for reading, searching, JS, docs and measuring. They don't for Rust: one cargo at a time
  per box (`avendb/CLAUDE.md`). Give the build to one helper, or have the others use `cargo check` after it finishes.
- No extra git worktrees for Rust work: each one starts a cold build folder (minutes, gigabytes).
- Work that needs several Rust builds at once belongs in several threads (ask the coordinator), not in helpers.

## Collector: one PR per batch

```
git fetch origin && git checkout <collector-branch>
bun scripts/devx/collect.mjs --plan --drafts          # or name the branches; seconds, changes nothing
bun scripts/devx/collect.mjs --check --drafts         # merges the clean ones, then the batch's local check
git push -u origin <collector-branch>
bun scripts/devx/collect.mjs --tasks                  # "Task: <branch>" lines for the PR body
```

- Every merge is made in memory first; a conflicting branch is left out and named with its files. Send it back to
  its thread; don't hand-resolve someone else's logic. The CI-built WebAssembly (`src/lib/avendb/device/avendb_browser*`)
  never blocks: the batch keeps its copy and the final PR's CI commits the right one.
- When the batch is in (25-50 tasks, or the coordinator says so): put the `Task:` lines in the PR body, mark the PR
  ready, one CI run, fix only the culprits in one round, land it with a merge commit (never a squash: main keeps
  every task's commits) and an explicit message (title + body with the `Task:` lines, never a `[skip ci]`), then close the task PRs naming the final PR, and merge main back into the
  collector branch.
- A failing task in the batch: revert its merge commit on the collector branch (`git revert -m 1 <merge>`), push,
  tell its thread; don't hold the batch for it.

## Improvement cycle: measure, change one thing, measure again

1. Measure: `bun scripts/devx/measure.mjs --since <day> --until <day> --by-day` (read-only GitHub numbers: tasks a
   day, PRs, open-to-merge, CI runner minutes per task, cancelled share, release time). Compare windows of the same
   length and kind (weekday vs weekday, same thread count).
2. Find the biggest wait: CI minutes per task, conflicts per batch, time a thread waits on a check, cold starts,
   collector time, Samuel's review queue. Time one real example end to end before changing anything.
3. Change one thing, on a task branch like any other work.
4. Measure again over a window after the change landed; write a row into `docs/devx/cycles.md` (date, change,
   before, after, verdict). Keep what moved the number, revert what didn't.
5. Save a lasting finding to project memory (`devx-speed`), with dates and numbers.

Targets (5x the Oct 22-27 baseline): 90+ tasks a day to main, under 2 CI runner minutes per task, no task waits on CI,
release still ~4 minutes after merge with every gate on main.

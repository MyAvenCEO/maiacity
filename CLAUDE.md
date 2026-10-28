# Working rules for agents in this repository

## CI runs once per goal, not once per task (Samuel 2026-10-27)

Many threads work in parallel (20 to 50 task branches at a time). CI on GitHub runs once, on the final pull request of a
goal, not on each task.

- **Draft pull requests run no CI.** Every `pull_request` workflow skips drafts (`types: [..., ready_for_review]` plus a
  job-level draft guard). Open your PR as a draft and keep it a draft. Never mark a task PR ready for review.
- **Threads sized to pay back their start.** A new cloud thread spends ~10-15 min before useful work, so it gets at
  least ~45 min of work (JS) or ~1 h (Rust); small tasks on one area go to one thread, one after another. Separate
  threads only for independent pieces with their own files; parallel Rust always in separate threads, not helpers in
  one box. Sizing table and the speed cycle: `.claude/skills/devx-speed/SKILL.md`.
- **Check locally, and only what you touched.** Before you push, run `bun aven/ops/devx/check.mjs` (`--plan` to see
  what it runs): the tests next to your change, svelte-check for page code, and per touched crate `cargo check --tests`
  and the test programs you touched. More commands in `docs/CI.md`. Do not run the full suite.
- **One collector thread per goal.** The collector merges the finished task branches into its own branch with
  `bun aven/ops/devx/collect.mjs --check <task-branches>` (or `--drafts`; `--plan` changes nothing): an ordinary
  `--no-ff` merge commit per branch, made in memory first, so a conflicting branch is left out and named instead of
  half-merged (send it back to its thread). It then runs the targeted checks for the merged files. Task threads tell
  the collector (or the coordinator) when their branch is ready. They do not push to the collector's branch.
- **One final PR to main.** The collector's draft PR goes ready for review once the goal is in, its body listing the
  `Task:` lines from `bun aven/ops/devx/collect.mjs --tasks` (`aven/ops/devx/measure.mjs` counts them). CI runs once. Fix
  what fails in one round, push, and merge with a **merge commit** (not a squash or a rebase, Samuel 2026-10-27: every
  task's own commits stay in main's history; `git log --first-parent main` reads one line per goal). Give it an
  explicit commit message: the PR title plus the `Task:` lines, never a `[skip ci]`. Then close the task PRs it landed
  with a comment that names the final PR, and bring `main` back into the collector's branch with a merge (no force
  push).
- **The goal gate.** `.github/workflows/gate.yml` waits on a ready PR for every workflow its files need and fails on a
  red or missing one (a rejected workflow file, batch 5). It is the required check on main. Once the goal PR is ready,
  `collect.mjs` takes no more branches (`--late` only for a fix the run needs). A goal ships when its metric is
  met or Samuel says so, not on a timer.
- **Exceptions** go through their own PR at once: production down, a security fix, or Samuel asks for it.

Main's checks and release gates are unchanged: every merge to main still runs the full validation before it deploys.

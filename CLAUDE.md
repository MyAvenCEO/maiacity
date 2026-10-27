# Working rules for agents in this repository

## CI runs once per batch, not once per task (Samuel 2026-10-27)

Many threads work in parallel (20 to 50 task branches at a time). CI on GitHub runs once, on the final pull request of a
batch, not on each task.

- **Draft pull requests run no CI.** Every `pull_request` workflow skips drafts (`types: [..., ready_for_review]` plus a
  job-level draft guard). Open your PR as a draft and keep it a draft. Never mark a task PR ready for review.
- **Check locally, and only what you touched.** Before you push, run the targeted checks for your files, for example
  `bun scripts/ci/test.mjs --suite <suite>`, `bun run test:changed -- --base origin/main`, or
  `cd avendb && cargo test --locked -p <crate> <test>`. See `docs/CI.md` for the commands. Do not run the full suite.
- **One collector thread per batch.** The collector merges the finished task branches into its own branch
  (`git fetch origin <task-branch> && git merge --no-ff origin/<task-branch>`), resolves conflicts, and runs the
  targeted checks again for the merged files. Task threads tell the collector (or the coordinator) when their branch is
  ready. They do not push to the collector's branch.
- **One final PR to main.** The collector's draft PR goes ready for review once the batch is in. CI runs once. Fix what
  fails in one round, push, and merge with a **merge commit** (not a squash, Samuel 2026-10-27: every task's own
  commits stay in main's history; `git log --first-parent main` reads one line per batch). Give it an explicit commit
  message: the PR title plus the `Task:` lines, never a `[skip ci]`. Then close the task PRs it landed with a comment
  that names the final PR, and bring `main` back into the collector's branch with a merge (no force push).
- **Exceptions** go through their own PR at once: production down, a security fix, or Samuel asks for it.

Main's checks and release gates are unchanged: every merge to main still runs the full validation before it deploys.

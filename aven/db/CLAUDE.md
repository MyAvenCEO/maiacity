# Working on avenDB's Rust: the fast loop

Measured on a 4-core cloud session (2026-10-27), avendb-net's tests:

| step | time |
|---|---|
| first build in a fresh checkout | 9.7 min, 7.5 GB; ~4 min in a cloud session with the dev cache |
| `cargo check --tests` after a one-line change in `avendb` | 6 s |
| rebuild after a one-line change in `avendb` | ~40 s (25 s of it the `avendb` crate itself) |
| rebuild after a change in `avendb-net` only | ~15 s |
| one test file (`--test live`) | 3-15 s |
| every avendb-net test | ~3 min |

So a change costs about a minute when one build has the machine. The 15-minute waits come from queueing: several
builds in one container share 4 cores and wait on each other's build-folder lock, and each new checkout starts cold.

## Rules

- **Check first, test second.** `cargo check -p <crate> --features test-fixtures --tests` finds type errors in
  seconds, without linking anything.
- **Run the one test file you touched**, not the crate: `cargo test --features test-fixtures -p avendb-net --test
  live` (or `-- <name>` for one test). Each file in `crates/*/tests/` is its own program; `-p avendb` alone builds 56.
- **One Rust build at a time per container.** Several cargo processes on 4 cores don't finish sooner; they queue on
  the build-folder lock and on the cores. Helpers in one container take turns, or use CI (below).
- **The full suite runs on CI, once per batch, not here** (repository `CLAUDE.md`). For a task,
  `bun aven/ops/devx/check.mjs` runs exactly the steps above for the files you touched. Dispatching the "avenDB
  checks" workflow on a branch (`.github/workflows/avendb-checks.yml`, workflow_dispatch; every suite in ~5-6 min on
  runners) is for a change no local check can cover, such as a dependency bump across all crates; it takes the same
  runners the batch's CI needs, so not per task.
- **One build folder per checkout** (project rule): no shared `CARGO_TARGET_DIR` across worktrees. Ask Samuel before
  deleting any build folder or cache.

## Settings that make this fast (already in the repo)

- `Cargo.toml`: our crates at opt-level 1, dependencies at 2, McEliece at 3; line tables only. Same as CI.
- `.cargo/config.toml`: `AVENDB_TEST_PAIRS` defaults to `target/avendb-test-pairs`, so the test programs share the
  McEliece pairs instead of each making them again (without it `live` ran past its 60 s deadline).
- `.claude/hooks/session-start.sh`: a cloud session starts with avenDB's compiled dependencies from the release
  "avendb-dev-cache" (`.github/workflows/avendb-dev-cache.yml`) in `aven/db/target`, and with the Rust version they
  were built with as its default; only our own crates are built then.
- The linker is already rust-lld (Rust's default on x86_64 Linux since 1.90); mold would gain little more.

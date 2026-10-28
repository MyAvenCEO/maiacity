# Working on avenDB's Rust: the fast loop

Measured on a 4-core cloud session (2026-10-27), avendb-net's tests:

| step | time |
|---|---|
| first build in a fresh checkout | 9.7 min, 7.5 GB; ~4 min in a cloud session with the dev cache |
| `cargo check --tests` after a one-line change in `avendb` | 6 s |
| rebuild after a one-line change in `avendb` | ~40 s (25 s of it the `avendb` crate itself) |
| rebuild after a change in `avendb-net` only | ~15 s |
| rebuild after editing one test file (its crate's one program, W4) | 5-13 s |
| one test file's tests (`--test all live::`) | 3-15 s |
| every avendb-net test | ~3 min |

So a change costs about a minute when one build has the machine. The 15-minute waits come from queueing: several
builds in one container share 4 cores and wait on each other's build-folder lock, and each new checkout starts cold.

## Rules

- **Check first, test second.** `cargo check -p <crate> --features test-fixtures --tests` finds type errors in
  seconds, without linking anything.
- **Run the tests of the one file you touched**, not the crate: `cargo test --features test-fixtures -p avendb-net
  --test all live::` (or `live::<name>` for one test). A crate's test files are the modules of one program,
  `tests/all/` (and `tests/memory/` for the tests that count the process's memory), so `-p avendb` builds 2 test
  programs, not 56.
- **A new test file needs its `mod` line** in its program's `main.rs`: the program's `every_file_is_a_module` test
  fails while a file in the folder is named by none. The shared helpers come in as `use crate::common;`. A file that
  uses the debug-only fixtures (`avendb::cast`, `avendb::scenarios`) opens with `#![cfg(debug_assertions)]`, so that
  the release benches (files with `#![cfg(not(debug_assertions))]`, `cargo test --release --test all <file>::`) build.
- **The page's device is a build output** (B1), not in git: `bun aven/ops/devx/wasm.mjs ensure` fills
  `aven/db/page/device/` with CI's build of the same sources, or builds it here (5 min, wasm-bindgen 0.2.129) for
  Rust changes not yet built; `wasm.mjs build` after a change the page needs.
- **One Rust build at a time per container.** Several cargo processes on 4 cores don't finish sooner; they queue on
  the build-folder lock and on the cores. Helpers in one container take turns, or use CI (below).
- **The full suite runs on CI, once per batch, not here** (repository `CLAUDE.md`). For a task,
  `bun aven/ops/devx/check.mjs` runs exactly the steps above for the files you touched. Dispatching CI on a branch (`.github/workflows/ci.yml`, workflow_dispatch, `full` for every job; its jobs side by
  side on runners) is for a change no local check can cover, such as a dependency bump across all crates; it takes the same
  runners the batch's CI needs, so not per task.
- **One build folder per checkout** (project rule): no shared `CARGO_TARGET_DIR` across worktrees. Ask Samuel before
  deleting any build folder or cache.

## Settings that make this fast (already in the repo)

- One Cargo workspace for avenDB and theOS (D3): the root's `Cargo.toml`, `Cargo.lock` and build folder `target/`.
  Our crates at opt-level 1, dependencies at 2, McEliece at 3; line tables only. Same as CI. A plain `cargo test`
  builds avenDB alone; theOS's crates build only on a Mac.
- `aven/db/.cargo/config.toml`: `AVENDB_TEST_PAIRS` defaults to the root's `target/avendb-test-pairs`, so the test
  programs share the McEliece pairs instead of each making them again (without it `live` ran past its 60 s deadline).
  Cargo reads it, and the page WebAssembly's flags, only when run from `aven/db/`: run cargo there.
- `.claude/hooks/session-start.sh`: a cloud session starts with avenDB's compiled dependencies from the release
  "avendb-dev-cache" (`.github/workflows/ops.yml`, task avendb-dev-cache) in `target/`, and with the Rust version they
  were built with as its default; only our own crates are built then.
- The linker is already rust-lld (Rust's default on x86_64 Linux since 1.90); mold would gain little more.

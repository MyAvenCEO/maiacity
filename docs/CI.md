# CI and local validation

`.bun-version` pins Bun for reproducibility (currently 1.4.4). Update it together with the root packageManager and API image. CI checks they agree. Our scripts and package CLIs run under Bun; GitHub runs third-party JavaScript actions under their declared Node 24 runtime. Pulumi uses its supported Bun runtime and an in-memory smoke test exercises the infrastructure program without cloud credentials.

Three workflows (stage 7 of the CI refactor):

- **`ci.yml`, every check.** On a ready pull request, a merge group, weekly (everything) and daily (the dependency audits alone). Its plan job (`aven/ops/ci/plan.mjs`) works out what the change can break (`impact.mjs`'s parts, `test.mjs`'s suites, `rust-tests.mjs`'s shards) and keys each job on the files it reads: a job whose key passed before, on this ref or on main, is left out (`passes.mjs`). A job folds the checks that share a runner, each a step the plan turns on (at most 17 jobs: plan, the page device, the kernel with the JS suites and the deploy checks, both browsers' probes, the Rust archive and its 5 shards, the proofs, real Chromium, the images, theOS on a Mac, Lean on another Mac, the site on macOS, and the verdict); the last, "CI required", needs them all and fails when a job the plan named is red, cancelled, or skipped. It is the one required check on main. Drafts run nothing (see `CLAUDE.md`).
- **`release.yml`, every push to main.** When the merged pull request's CI run passed on byte for byte main's files (`reuse.mjs`), that run is the check and what it built ships: the page's avenDB device (put on the release `avendb-page-device` by its key) and the images (promoted by digest). Otherwise it calls `ci.yml` on main's commit. Then the site, the API and the peer deploy, each only when its files changed, and the health job checks them from outside; a red site goes back to the build before. The API and the peer go back by hand (`ops.yml`, task rollback): the API migrates its database as it starts and the peer writes its store.
- **`ops.yml`, schedules and tasks by hand.** Uptime every 10 minutes, the cloud sessions' dev cache, the cloud agent, the buckets and the backups' recovery test, the infrastructure (Pulumi, DNS), rollback, and the read-only measurements.

The real transport harness uses isolated Playwright 1.64.1 because the older security-probe Chromium cannot negotiate mandatory PQ WebTransport. Native changes enable the real Chromium/WASM test; cryptographic, transport dependency and protocol-model changes enable Verifpal. Its expected attacks remain required negative controls. No benchmark runs in CI: a timing on a shared runner gates noise.

## Local commands

- `bun run test`: mandatory security suites plus CI policy tests.
- `bun run test:changed -- --base origin/main`: security plus affected component suites. Missing comparison selects everything.
- `bun aven/ops/ci/test.mjs --suite studio`: a fast component-only development loop; the mandatory gate still runs in CI.
- `bun run test:all`: every owned JS/TS suite in separate processes.
- `bun run test:inventory`: fail if a test has no owner.
- `bun --bun run check`: application types under Bun.
- `bun aven/db/scripts/test-avendb-local-write.mjs --browser chromium --all`: six scenarios, one server/browser and a fresh context per case. Repeat with `webkit`.
- `cargo test --locked --features test-fixtures -p avendb --test all -- --test-threads=2 properties::`: the same 37 properties and 40 seeds in one process, sharing immutable histories. Other native tests retain nextest isolation.
- `bun aven/ops/ci/rust-tests.mjs archive <file>`, then `bun aven/ops/ci/rust-tests.mjs run <shard> <file>`: avenDB's Rust tests as CI runs them (W4), every test program built once into one nextest archive and each shard (`shards` lists them) run from it, building nothing; needs cargo-nextest. `--plan` prints the commands. Each crate's tests are one program, `tests/all/` (and `tests/memory/` for the tests that need the process to themselves), so a test file's tests are a filter: `--test all -- live::`.
- `cd aven/db/spec && lake build && lake exe vectors`: complete proof umbrella, generated-content checks and writer coverage.

Selectors fetch only the comparison commit when needed instead of cloning all binary history. Native test/helper changes validate without publishing unchanged binaries.

The suite manifest is `aven/ops/ci/suites.json`; path changes and unknown build inputs fail conservatively. The original 95-file security selection remains mandatory. Affected application suites run in parallel jobs, with the 24 physics files divided into four disjoint shards (also available locally with `--suite physics --shard 1/4`), alongside security validation, so physics regressions do not serialize the other suites; "CI required" requires every selected job. The additional 67 application files now have owners and affected/full execution. Test setup shares only immutable asset bundles and database adapter/migration code. Every API suite keeps its own database and browser scenario its own context.

The McEliece fixture cache requires an explicit feature plus debug assertions, rejects release builds, and uses private files in a disposable directory. Never enable it for real identities. It is not stored in Actions caches. Full cryptographic negatives, model vectors, mutation tests, frozen migration/engine hashes and both browser engines remain in place.

## Evidence and limits

The audit sampled duplicate avenDB main-release validation costing about 21 runner-minutes. Eliminating that copy is a runner-cost saving, not proof of a 2× end-to-end speedup. Property process sharing, fixture reuse and fewer browser launches must be timed on comparable runners; report compile, execution, cache transfer and queue time separately. Do not compare an overloaded local cold build with a warm hosted run.

One paired local execution benchmark (2026-10-24, the same compiled binary, 37 properties / 40 seeds, two-way concurrency, compilation excluded): shared process **86.30 s / 168.26 CPU-s**, isolated processes **322.06 s / 1060.65 CPU-s**. That is **3.73× faster execution and 84.1% less CPU** for this suite. Shared ran first; the isolated run followed on the same machine. This is one measured comparison, not a distribution or an end-to-end pipeline claim.

No proof was dropped. A canonical vector manifest replaces repeated path lists, and `aven/db/spec/contracts.json` links scheduling models to concrete implementation regressions. Historical phases are archived separately so retired signing checkpoints cannot be confused with current storage checkpoints. Supported V1/V2 van, geometry, plant and intro implementations share contracts and both execute, with their different reference formats, seats and move sequences explicit in each version wrapper.

Real worker timeout tests remain integration checks; the challenge-limit test already uses no sleep. Large proof helper files have distinct hypotheses: reducing line count alone does not justify changing them. Manual old-vault recovery remains until data retention/recovery is explicitly complete. These retained checks are intentional, not deleted to meet a speed target.

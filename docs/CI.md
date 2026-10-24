# CI and local validation

`.bun-version` pins Bun for reproducibility (currently 1.4.4). Update it together with the root packageManager and API image. CI checks they agree. Our scripts and package CLIs run under Bun; GitHub runs third-party JavaScript actions under their declared Node 24 runtime. Pulumi uses its supported Bun runtime and an in-memory smoke test exercises the infrastructure program without cloud credentials.

On main, `main.yml` selects affected components, builds site/container artifacts in parallel with validation, then releases only after the same commit's required gates succeed. Kernel, avenDB and delivery validation each run once. API-only releases retain their focused API contract gate; when the site also changes, its kernel gate supplies the same API checks once. An API-only edit does not acquire unrelated browser/type-check work. If the preceding commit has no successful complete main run (including a superseded pending run or partial failure), selection falls back to every component. Manual release entry points validate again by default. Only the trusted main caller supplies `validated`; no manual bypass input is exposed. Images and artifacts are consumed from that run/SHA. Routine API changes read existing infrastructure outputs; infrastructure changes and manual API runs reconcile Pulumi and DNS.

`avendb-checks.yml` has a stable aggregate that rejects failed/cancelled jobs and missing or skipped selected jobs. Draft PRs deliberately defer expensive native checks until ready for review. Make the aggregate required in repository branch protection where required-check policy is maintained. Weekly/manual full regression runs cover all application suites, protocol models and the disposable real browser. Native changes enable the real Chromium/WASM test; cryptographic, transport dependency and protocol-model changes enable Verifpal. Its expected attacks remain required negative controls.

## Local commands

- `bun run test`: mandatory security suites plus CI policy tests.
- `bun run test:changed -- --base origin/main`: security plus affected component suites. Missing comparison selects everything.
- `bun scripts/ci/test.mjs --suite studio`: a fast component-only development loop; the mandatory gate still runs in CI.
- `bun run test:all`: every owned JS/TS suite in separate processes.
- `bun run test:inventory`: fail if a test has no owner.
- `bun --bun run check`: application types under Bun.
- `bun scripts/test-avendb-local-write.mjs --browser chromium --all`: six scenarios, one server/browser and a fresh context per case. Repeat with `webkit`.
- `cd avendb && cargo test --locked --features test-fixtures -p avendb --test properties -- --test-threads=2`: the same 37 properties and 40 seeds in one process, sharing immutable histories. Other native tests retain nextest isolation.
- `cd avendb/spec && lake build && lake exe vectors`: complete proof umbrella, generated-content checks and writer coverage.

The suite manifest is `scripts/ci/suites.json`; path changes and unknown build inputs fail conservatively. The original 95-file security selection remains mandatory. Affected application suites run in parallel jobs, alongside security validation, so physics regressions do not serialize the other suites; the kernel aggregate requires every selected job. The additional 67 application files now have owners and affected/full execution. Test setup shares only immutable asset bundles and database adapter/migration code. Every API suite keeps its own database and browser scenario its own context.

The McEliece fixture cache requires an explicit feature plus debug assertions, rejects release builds, and uses private files in a disposable directory. Never enable it for real identities. It is not stored in Actions caches. Full cryptographic negatives, model vectors, mutation tests, frozen migration/engine hashes and both browser engines remain in place.

## Evidence and limits

The audit sampled duplicate avenDB main-release validation costing about 21 runner-minutes. Eliminating that copy is a runner-cost saving, not proof of a 2× end-to-end speedup. Property process sharing, fixture reuse and fewer browser launches must be timed on comparable runners; report compile, execution, cache transfer and queue time separately. Do not compare an overloaded local cold build with a warm hosted run.

One paired local execution benchmark (2026-10-24, the same compiled binary, 37 properties / 40 seeds, two-way concurrency, compilation excluded): shared process **86.30 s / 168.26 CPU-s**, isolated processes **322.06 s / 1060.65 CPU-s**. That is **3.73× faster execution and 84.1% less CPU** for this suite. Shared ran first; the isolated run followed on the same machine. This is one measured comparison, not a distribution or an end-to-end pipeline claim.

No proof was dropped. A canonical vector manifest replaces repeated path lists, and `avendb/spec/contracts.json` links scheduling models to concrete implementation regressions. Historical phases are archived separately so retired signing checkpoints cannot be confused with current storage checkpoints. Supported V1/V2 van, geometry, plant and intro implementations share contracts and both execute, with their different reference formats, seats and move sequences explicit in each version wrapper.

Real worker timeout tests remain integration checks; the challenge-limit test already uses no sleep. Large proof helper files have distinct hypotheses: reducing line count alone does not justify changing them. Manual old-vault recovery remains until data retention/recovery is explicitly complete. These retained checks are intentional, not deleted to meet a speed target.

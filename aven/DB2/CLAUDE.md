# Working in avenDB2

- Read [`README.md`](README.md) first: its rules hold for every change here. [`SANDBOX.md`](SANDBOX.md) is the plan
  for avenSANDBOX, milestone 1.
- **Zero legacy.** Never import, copy or vendor anything from `aven/db/` or its crates (`avendb`, `avendb-net`,
  `avendb-browser`, `avendb-device`, `avendb-server`, `avendb-testkit`). Learnings come in as rules and tests, never as
  code.
- **Spell the folder `aven/DB2`** exactly. A Mac's disk ignores case; Linux and CI don't.
- **Test-first:** the Lean model and its theorems, Rust tests against them, then the code.
- **Latest versions:** a new dependency comes in at its newest stable release, pinned exactly.
- **Run everything in the box** once it exists (`bun run up`, `bun run doctor`), so a run that's green here is green in
  CI.
- Build only what the current milestone's plan names.

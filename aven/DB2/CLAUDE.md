# Working in avenDB

## Every decision lives in ARCHITECTURE.md (Samuel, 31 Oct 2026)

[`ARCHITECTURE.md`](ARCHITECTURE.md) and the Lean specs are avenDB's single source of truth. A decision that isn't
there isn't decided.
- **Record it before building on it.** Every decision, whether Samuel's, the architect's, or agreed between threads in
  messages or a PR body, goes into ARCHITECTURE.md. It is either folded into the section that owns the concept or added
  as an A-number. The architect records it, or the thread does in the same PR that first relies on it. A decision that
  lives only in a message, a PR body or a spec README is drift.
- **Specs cite, they don't decide.** A package's README and its Lean explain and prove what ARCHITECTURE.md decides,
  and cite the A-number. Where a spec and ARCHITECTURE.md disagree, ARCHITECTURE.md wins, and the spec is fixed in its
  owner's next PR. If you find a disagreement, tell the architect.
- **Replace, don't append.** A later decision rewrites the text it changes, in ARCHITECTURE.md and in the specs that
  repeat it. It is never added below the old text as "what follows". The old text's history stays in git.
- **Done means recorded, proven and built.** A decision is done when ARCHITECTURE.md states it, the Lean names it cites
  exist on main, and the code follows. Until then, its status says what is pending and in which PR.
- **Before you start,** read the A-numbers your package's README cites, and check ARCHITECTURE.md for decisions newer
  than your spec.

## The rules of the work

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

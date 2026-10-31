# Working in avenDB

## Every decision lives in avenBRAIN (Samuel, 31 Oct 2026)

avenDB's architecture lives in one place, avenBRAIN (`brain/`), with the Lean: [the index](brain/ARCHITECTURE.md),
one page per package (`brain/<package>/README.md`), [the decision log](brain/DECISIONS.md) and
[the glossary](brain/GLOSSARY.md). Brain in avenOS shows these files. A decision that isn't there isn't decided.
- **Two documents.** The log is the history: one table, the newest decision on top. It only grows: a new decision is a
  new row at the top, a row is never edited, and a change of mind is a new row that names the one it supersedes
  (`bun aven/ops/devx/decisions.mjs` checks it). The pages are the latest truth: each concept is stated once, on its
  owner's page, as it is now, with the decisions it rests on and the Lean that proves it.
- **avenMAIA writes both.** avenMAIA is avenDB's architect, the session that orchestrates the threads, and every
  decision is Samuel's or avenMAIA's. A thread never adds an A-number or architecture prose (A171). A thread's proposal,
  and every decision of Samuel's, whether in a message or a PR body, goes to avenMAIA, who logs what is decided and
  rewrites the page that owns the concept. A decision that lives only in a message, a PR body or a README is drift. A
  thread may update its page's Status table in the PR that builds what a row lists.
- **Replace, don't append.** A later decision rewrites the page text it changes. The log keeps what it replaced.
- **READMEs and Lean don't decide.** A package's README says what the package is, links its page, and gives its
  commands and file map. Its Lean proves what the page states and cites the A-number. Where code, Lean or a README
  disagrees with the page, the page wins: the owner fixes theirs in its next PR and tells avenMAIA.
- **Done means recorded, proven and built.** A decision is done when its page states it, the Lean names the page cites
  exist on main, and the code follows. Until then, the page's Status says what is pending and where.
- **Before you start,** read your package's page and the log's rows newer than your branch.

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

# Working in aven/runtimes

The runtimes are part of avenDB's architecture, so avenDB's rules hold here too: read
[`aven/DB2/CLAUDE.md`](../DB2/CLAUDE.md).

**Every decision lives in avenBRAIN** (Samuel, 31 Oct 2026): avenRUNTIME's page,
[`aven/DB2/brain/runtime/README.md`](../DB2/brain/runtime/README.md), states the runtimes' architecture as it is now,
and [the decision log](../DB2/brain/DECISIONS.md) keeps its history. Every decision about a runtime (the manifest,
freezing, loading, the hosts, a module's version or its params) goes to avenMAIA before anything builds on it.
This package's README and Lean explain and prove what the page states, citing the A-number, and where they disagree,
the page wins.

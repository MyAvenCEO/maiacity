# Working in aven/runtimes

The runtimes are part of avenDB's architecture, so avenDB's rules hold here too: read
[`aven/DB2/CLAUDE.md`](../DB2/CLAUDE.md).

**Every decision lives in [`aven/DB2/ARCHITECTURE.md`](../DB2/ARCHITECTURE.md)** (Samuel, 31 Oct 2026). It and the Lean
specs are the single source of truth. Every decision about a runtime goes there before anything builds on it: the
manifest, freezing, loading, the hosts, a module's version or its params. This README explains and proves what it
decides, citing the A-number, and where the two disagree, ARCHITECTURE.md wins.

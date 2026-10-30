# Architecture: the rules across all parts, in Lean

`Aven.Architecture` states [`ARCHITECTURE.md`](../ARCHITECTURE.md)'s fourteen rules ("The rules across all parts") as
theorems composed from the parts' own models. It is one Lean package, in [`spec`](spec), that requires every part:
`Aven.Core`, `Aven.ID`, `Aven.DB`, `Aven.Runtime` and `Aven.Actor`. So cross-part theorems live in one place, and no
part requires another sideways: avenID, below docs, never requires docs (the architect, 30 Oct 2026).

| Module | What |
|---|---|
| `Rules` | a theorem per rule, composed from the parts' theorems, and the two views that join parts: `capsView` (a Core envelope as caps' revocation model sees it) and `served` (the engine's want queue over caps' read grants) |
| `SealedIndex` | caps' part of sealed indexes (A26), moved here from `Aven.ID`: an index holds only entries every reader of its directory may read, readers rebuild equal roots, roots come only from the directory's writers |
| `Gaps` | per rule: the theorems that compose it, what they rest on, and what no model states yet; exported as `spec/vectors/rules.json` |

**Where the rules stand** (30 Oct 2026):

| Rule | Composed | Missing |
|---|---|---|
| 1. One codec | yes | — |
| 2. History by hash | yes, on Core's envelopes; Loro's op ids and the hashes name the same past | — |
| 3. One writer per log | splits final; a chain holds none | the writer's log never waiting; a split's proof reaching every reader (PEERS) |
| 4. Readers judge | order-free verdicts; operations lowered alike; fit per envelope surviving merges; caps' verdict over Core envelopes | one verdict joining signature, cap chain, footprint and fit |
| 5. Reading is the key | on caps' model | a link from Core's envelopes and docs' segments to their sealing |
| 6. Demand never grants | yes: served = wants ∩ read grants; keepers serve on fetch proofs | — |
| 7. No privilege by position | keepers blind; index roots only from writers | hosting caps (A16); no peer the only source (PEERS) |
| 8. Cache or checkpoint | snapshots, checkpoints naming their tips and runtime, runtimes' determinism, index roots | who may sign a checkpoint a reader takes (docs open question 6) |
| 9. Sealed beyond the device | keepers blind | a model of what leaves a device (PEERS) |
| 10. Every input has a limit | queries, runtimes, index nodes, wire frames | envelopes, blobs, pages, fan-out (docs rule 24); a quota per vault |
| 11. Every wait ends | a wait names what ends it, by hash | the stall alarm; waits never blocking unrelated work |
| 12. Order causal, time a claim | the past is what is named | caps' time conditions judged by acks |
| 13. Keys in the safe | — | the safe (caps D17) has no model |
| 14. One protocol | — | a node property, held by vectors and the box's check |

**Run it in the box,** from `aven/DB2`: `bun run box sh -c 'cd /aven/DB2/architecture/spec && lake build'` (the path
under `/aven`, so it reaches `aven/runtimes` and `aven/actor`); `bun run box sh sandbox/vectors.sh --check` builds it
with every other spec and checks `rules.json`.

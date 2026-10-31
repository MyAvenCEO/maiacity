# Architecture: the rules across all parts, in Lean

`Aven.Architecture` states [the architecture](../brain/ARCHITECTURE.md#the-rules)'s rules as
theorems composed from the parts' own models. It is one Lean package, in [`spec`](spec), that requires every part:
`Aven.Core`, `Aven.ID`, `Aven.DB`, `Aven.Runtime` and `Aven.Actor`. So cross-part theorems live in one place, and no
part requires another sideways: avenID, below docs, never requires docs (the architect, 30 Oct 2026).

| Module | What |
|---|---|
| `Rules` | a theorem per rule, composed from the parts' theorems, and the view that joins parts: `served` (the engine's want queue over caps' read grants). Caps' revocation verdict reads Core's envelopes itself |
| `Sealed` | the join of caps' sealed index (`Aven.ID.SealedIndex`, A26) to the docs model: `docsRoot` is the Prolly root, and `docsRoot_set` discharges caps' hypothesis, so caps' one copy of `index_within_key`, `sealed_roots_agree` and `root_by_writer` holds of the real index |
| `Gaps` | per rule: the theorems that compose it, what they rest on, and what no model states yet; exported as `spec/vectors/rules.json` |

**Where the rules stand** (30 Oct 2026):

| Rule | Composed | Missing | Owner |
|---|---|---|---|
| 1. One codec | yes | — | — |
| 2. History by hash | yes, on Core's envelopes; Loro's op ids and the hashes name the same past | — | — |
| 3. One writer per log | splits final; a chain holds none; a write fits from its own log alone; a split spreads to every reader that syncs | — | — |
| 4. Readers judge | one verdict: signed, fresh epoch, cap chain authorized, not revoked, not ended by a delete (a delete by the Doc's vault ends it for every reader: only the delete's past counts), within its footprint and fit over one change view, nothing in its past a split; readers holding the same past agree; a merge into main judged on the whole merge: every Record it changes, brings or removes handled by a step the signing device's cap allows on main, on the signer's vault's own authority or by a chain whose last cap writes on main | — | — |
| 5. Reading is the key | keys of any kind (Core's bytes); keepers blind to segments of Core envelopes; stale epochs refused | — | — |
| 6. Demand never grants | yes: served = wants ∩ read grants; keepers serve on fetch proofs | — | — |
| 7. No privilege by position | keepers blind; index roots only from writers; no peer the only relay or holder; hosting an explicit read cap | — | — |
| 8. Cache or checkpoint | snapshots, checkpoints naming their tips and runtime and taken only from writers (A5), runtimes' determinism, index roots | — | — |
| 9. Sealed beyond the device | keepers blind; plain bytes only to readers, relays see ciphertext | — | — |
| 10. Every input has a limit | queries, runtimes, index nodes, wire frames; sealed bytes read capped, envelopes admitted within depth, fan-out, Records and ops, segments, blobs (docs rule 24); want pages within entries and bytes; a quota per vault at the keeper | — | — |
| 11. Every wait ends | a wait names what ends it, by hash; waits never block unrelated work; every round moves, waits naming each key, or raises the stall alarm | — | — |
| 12. Order causal, time a claim | the past is what is named; time judged by acks: a write an expiry's ack hadn't seen, or claiming a time past it, doesn't count | — | — |
| 13. Keys in the safe | the safe shows only what may be lent, and carries out no key it keeps, not even sealed | — | — |
| 14. One protocol | — | a node property, held by every format's vectors and the box's check; no theorem planned | — |

**Run it in the box,** from `aven/DB2`: `bun run box sh -c 'cd /aven/DB2/architecture/spec && lake build'` (the path
under `/aven`, so it reaches `aven/runtimes` and `aven/actor`); `bun run box sh sandbox/vectors.sh --check` builds it
with every other spec and checks `rules.json`.

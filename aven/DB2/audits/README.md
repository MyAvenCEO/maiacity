# The audits of 30 Oct 2026

Six first-principles audits, one per part of avenDB, that Samuel asked for on 30 Oct 2026. They read the specs as they
stood at main `2c1a9890`, so every `path:line` they cite points into that commit. Their synthesis is
[`ARCHITECTURE.md`](https://github.com/MyAvenCEO/maiacity/blob/dd5bfebad2f41ef4dff535b6c446953c55769a9d/aven/DB2/ARCHITECTURE.md), which tracks what has since been fixed or decided. Many findings below are
settled now.

| Audit | Part |
|---|---|
| [`foundation.md`](foundation.md) | The README, production, milestone 2 and the sandbox: avenID's tree, the door, the Aven Peer |
| [`store.md`](store.md) | The store: blobs and refs, files, the chat's chains. Its five security bugs are fixed and live (#1493, #1509) |
| [`docs.md`](docs.md) | The docs layer: Docs, envelopes, segments, snapshots, fit, lenses |
| [`engine.md`](engine.md) | The engine: operations, wants, views, plugins |
| [`caps.md`](caps.md) | avenID caps, attack by attack, before decisions 13 to 20 |
| [`actors.md`](actors.md) | The actor engine, from its branch before #1488 |

## The audits of 31 Oct 2026

Four audits across all parts that Samuel asked for on 31 Oct 2026: whether any word means two things, whether any job
has two mechanisms, whether any key holds authority a vault should, and whether any two statements contradict each other. Each cites the main of its day. What follows
from them is in [`ARCHITECTURE.md`](https://github.com/MyAvenCEO/maiacity/blob/dd5bfebad2f41ef4dff535b6c446953c55769a9d/aven/DB2/ARCHITECTURE.md): rule 15 and A28 to A38.

| Audit | Question |
|---|---|
| [`terms.md`](terms.md) | One word, one meaning: new terms, collisions, renames not yet applied, the glossary against the specs |
| [`principles.md`](principles.md) | One job, one mechanism: fifteen places where two mechanisms do one job, and the decisions that pulled apart |
| [`vaults.md`](vaults.md) | Vaults own; signers only sign: every place a key holds authority itself, and its vault form |
| [`contradictions.md`](contradictions.md) | Global contradictions: decision against decision, spec against spec, spec against Lean, Lean against code, and the resolution of each |

## The drift audits of 31 Oct 2026

Five read-only audits of decision drift across all parts, before avenBRAIN became the one source of truth: every
decision of the day against its documentation, its Lean and its code. They cite the main and the branches of their
hour. Their findings were settled into [avenBRAIN's pages](../brain/ARCHITECTURE.md) and [the decision log](../brain/DECISIONS.md)
(A151 to A186); what is still to change in Lean or code is in each page's Status.

| Audit | Parts |
|---|---|
| [`drift-architecture.md`](drift-architecture.md) | The architecture document and the decisions of the day |
| [`drift-core.md`](drift-core.md) | avenCORE, the runtimes, the architecture spec, the glossary and Brain |
| [`drift-id.md`](drift-id.md) | avenID and caps |
| [`drift-docs.md`](drift-docs.md) | avenDOCS and avenOPS |
| [`drift-peers.md`](drift-peers.md) | avenPEERS, production and the sandbox |

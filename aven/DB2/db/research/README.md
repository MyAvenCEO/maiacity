# Research behind the data design

Notes, not specs: what the proposals in [`docs`](../docs/README.md), [`engine`](../engine/README.md) and
[`ontology`](../ontology/README.md) learned from earlier builds. They quote other repositories' code as evidence;
nothing here is code for avenDB ([README](../../README.md), rule 12).

| Note | What it covers |
|---|---|
| [`C1-avenos-x1-x5-core.md`](C1-avenos-x1-x5-core.md) | avenOS's universal predication engine (June–July 2026): the x1–x5 grammar, the gismu table, predicates compiled to schemas, bundles compiled to operations, the query and mutation grammar, and how GLM minted predicates, queries and bundles while the system ran |
| [`C2-avenos-invoice.md`](C2-avenos-invoice.md) | The invoice vertical on that engine: the flow, the facts one invoice writes, what couldn't be stored, caps in that era, and what happened after July |
| [`E1-avendb-old-engine.md`](E1-avendb-old-engine.md) | avenDB-old's query and sync engine (Interests in tiers, query views, frontier sync, holdings, coverage and freshness, the blind index), what failed and the rule that answers it, and its first-principles reduction to log, head, want and view. By avenACTORS |

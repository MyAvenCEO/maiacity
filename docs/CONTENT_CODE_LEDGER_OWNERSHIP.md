# Content, code and ledger ownership — A05, A06, A07

The audit described an older working checkout. This reconciliation is against main after PR #1257. It does not repeat historical database migrations or delete archived records.

## A07: custodial HEARTS is retired

The obsolete cryptographic ledger's API, keys/notes implementation and table startup already disappeared upstream (#1025, commit `ef6042ac`). Migration `0053-drop-sandbox-2-economy` records that historical retirement. It is not edited or rerun by this change.

The remaining BabyJubjub, Poseidon and Ethereum client dependencies had no importers. They and their unused monetary policy, mint/demurrage conversion and amount-formatting helpers are removed. The worlds still use `game/time.ts` for calendar and sky time; its epoch, speed and month boundaries are preserved by regression tests. MaiaCity V1/V2 simulation balances and ledgers are separate and unchanged.

Historical database restoration must use the backups and the code revision appropriate to those records. Removing runtime code does not authorize deleting backups or imply that a financial archive has been independently verified.

## A05: one content owner and one transition planner

Stories, posts, their metadata and publication shares belong to avenDB. `flows.js` owns stage interpretation and transition planning; the story board and derivative-post UI read that model, not a Postgres mirror. The old content API, stories route and day/posts/publish CLI writers were removed upstream (#1034, commit `1e5cf88a`); no supported callers of their old API paths remain in tracked executable sources.

Publication now uses the same planner for its stage tags, public shares, picture functions and first-publication date. The UI no longer stamps its own date or interprets a hardcoded flow tag. Existing publication dates survive republishing. A transition outside the flow's `next` edges is refused. If any function fails validation or execution while planning, the entire plan returns no operations and the UI submits nothing.

This is fail-closed planning, not a claim that executing a multi-op avenDB batch is transactional. The device still authorizes each op, and execution errors must still be surfaced. A story's private production stage is distinct from a post's public visibility; neither is a second storage owner.

Migration `0054-drop-content-board-and-timelines` already records the prior board retirement and backup location. This change leaves migration history, publication identifiers, frozen films and archives alone. No new legacy writer or automatic import is introduced.

## A06: avenDB publication, repo bootstrap

The Postgres Generated UI writer and scheduled code-landing/export pipeline already disappeared upstream (#1013, commit `d0fa42d0`). The repository's `code/` is the reviewed bootstrap/recovery seed. Live dynamic code belongs to the anchored Maia City vault; the existing proof, freshness and frozen-engine checks still apply.

`codeAt()` and `codeIn()` now return explicit provenance: source, content revision and exact pin. Repository results are marked `role: bootstrap`; vault results also identify the vault, entry and sorted heads. Pinning to heads preserves a vault revision even where its engine metadata differs from a repo-equivalent content hash.

Within a loaded session, a path claimed by avenDB never silently changes back to repo code when its entry is deleted, malformed, ambiguous or missing from a later snapshot. Invalid duplicates block the alias regardless of row order. A valid row can repair the path. An older row can retain an already loaded newer version under the existing freshness rule; a failed network/proof fetch preserves the loaded state.

A cold process starts from the explicitly marked repo bootstrap until code loads. The in-memory ownership map is not a durable publication registry. `reset()` deliberately simulates that cold bootstrap for isolated tests; normal refreshes do not call it. Existing durable freshness checks continue to reject proven rollbacks across page reloads. No silent fallback is used to resolve a rejected path in the current loaded state.

## Gates

- API retirement tests guard absent obsolete routes, scripts, dependency families and policies, plus unchanged world time.
- Flow tests cover publication metadata, valid edges, custom flow tags, function failures and retained historical dates.
- Code tests cover proof/freshness checks, deletion, missing paths, invalid duplicates, repaired paths and provenance pins.
- Existing API, kernel and Chromium/WebKit gates still run before deployment. No live database mutation or archive deletion is part of this work.

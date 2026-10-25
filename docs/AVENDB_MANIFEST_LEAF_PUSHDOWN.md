# Manifest query pushdown and local-read readiness

Implementation: [2620eadd](https://github.com/MyAvenCEO/maiacity/commit/2620eadd).

The route planner previously merged every leaf of one priority into an unlimited
query, then applied tags/newest ordering/limits in JS. Thus a Studio declaration
of eight cuts or Chat declaration of fifty rooms still imported every matching
local snapshot before choosing the demand window. Each leaf now passes its exact
type/tag predicate, newest ordering, offset and limit into the universal query.
Individual calls are capped at 128 rows; declarations without a limit retain
all-row semantics through successive local pages. Each leaf retains its own
canonical equal-timestamp order before final union/deduplication, including
reference-following roots. Navigation cancellation is checked before/after each
page and no subsequent batch is issued after cancellation. No catalog or owner
policy change is required.

Local query readiness now preserves `unresolvedCandidates` and
`pendingJudgments` in copied diagnostics. A response with unresolved candidates
is not reported as a loaded mounted view: it is pending if materialization is
in flight, unavailable otherwise. Node-wide pending judgments alone do not
block an otherwise answered active view. No response certifies remote discovery
or file completeness.

Validation: 65 tests passed across manifests, route/device lifecycle, query
windows, completeness and mounted reads. New cases verify bounded leaf pushdown,
exact tag filtering, overlapping tied rows, unlimited pagination, cancellation
between pages, and incomplete→available readiness transitions. No Cargo or
deployment performed by this slice.

## Remaining concrete consumer barriers (source audit at 1934140d)

- Studio initial `studio.svelte.js:530` awaits `allMedia`, every local cut and
  every story before phase ready. `aven.js:191` resolves all media from
  `cuts.js:141`'s full world and awaits all transcript/analysis files. Replace
  the initial barrier with independent first-page typed collections; open the
  explicitly selected cut immediately, and load media/transcript dependencies
  for its visible clips/playhead separately. Keep background collections lazy.
- `cuts.js:124` bypasses mounted read windows via direct native calls, and
  `collection-entries.js:9` drains all pages with no component abort scope.
  Reuse the generic read/demand window tied to Studio lifetime and selected cut;
  give currently visible page/clip IDs their own replaceable lease. Preserve
  native playback ownership and authorization.
- Source manifests cover kernel/dashboard/universe/studio/chat/games; there is
  no standalone asset collection declaration. Library has scoped live queries,
  but recipe catalog `assets/vault.js:143` initially lists all recipes and only
  schedules its follow-up after a successful nonempty first list. Empty fresh
  devices therefore still need a revision-driven retry rather than a manual
  synchronization retry. Route manifests remain scoped to MAIA_CITY while
  selected-vault/hash/query changes rely on component scopes.
- `query-window.js:8` reports only top-level entry IDs, not typed followed-link
  dependencies. `manifests.js:namedOn` resolves aven roots with a broad file
  inventory per dependency layer. A typed dependency response from the query
  engine would avoid inferring references or scanning unrelated file metadata.

AIP-35 is recorded as owner-applied in AVENDB_UPGRADE_PLAN.md and added Chat plus
nine corrected typed game selectors. This audit read repository evidence only;
it did not reopen the account or re-read the live catalog.

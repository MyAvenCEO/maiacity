# Explicit entry bootstrap

This task 18 slice repairs selection and read scheduling in Note and Docs. It does not establish query completeness or introduce an authorization cache.

`ExplicitEntry.lean` was checked before the UI changes. Its keys represent valid entry IDs: `Shell.parse` validates route IDs and `queryEntries` validates scheduling IDs. `target` maps to Docs' explicit ID or, only when none was supplied, its first local document. `demand` maps to the existing read window's immediate positive-entry registration. `shown` maps to Note's response bound to the requested entry; read-window generation/device checks and component cleanup still reject abandoned requests. The original of a known fork uses the same existing read path even when its metadata is not locally held.

The model proves that changing the held list cannot substitute another entry for an explicit selection, and that data received for another selection is not displayed as the current note. It does not prove Svelte compilation, remote availability, authorization, a complete dependency graph, or a complete query result. The existing device API remains responsible for policy checks. A missing local document stays selected and gets a local loading/unavailable message.

Verification:

- `lean AvenDB/ExplicitEntry.lean`: passes all six theorems; imported by `AvenDB.lean` for the aggregate gate.
- `bun test src/lib/avendb/entry-bootstrap.test.js src/lib/avendb/query-window.test.js`: 19 passing tests, 74 assertions. Eight tests mount the actual Svelte components with the existing read-window implementation and a fake device; child rendering/media hosts are isolated. The other eleven retain existing window lifecycle and compatibility coverage.
- The component regressions cover missing targets with empty/nonempty local lists, metadata arrival with scope reuse, default selection, selection changes and late replies, unmount/release, and a missing explicit fork original.
- Negative control: restoring the two original components makes six of the eight component tests fail (two existing-behavior checks still pass). Both candidate sources were then restored and the focused suite rerun.
- The full Svelte check reports 26 implicit-any errors in the unchanged canonical browser `js/store.js`, reached by the existing `store-bridge.test.js`, plus 18 unrelated CSS warnings. It reports no diagnostic in this slice's changed files. This is an outstanding repository check, not a passing release gate.

This slice neither changes the node demand protocol nor cancels admitted content writes. Real offline/online acquisition and physical-browser lifecycle acceptance remain outside the component fixture.

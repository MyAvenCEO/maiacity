# Warm unlock: reuse one round's family authorization

Warm reopening is not synonymous with policy replay. The preserved-store measurements in AVENDB_UPGRADE_PLAN.md show stored-view reuse with replay around 0.007–0.008ms, but open-keys around 0.8s, show-items around 0.9–1.0s and upkeep around 34.5–35.6ms (the separate 1.641s column is metric capture, not upkeep). These are prior measurements under load, not a new physical-device benchmark or a promise that this slice removes those delays.

`Lab::refresh` still reconstructs opened keys, readings, shown items and upkeep from canonical persisted history. Within one `upkeep` call it already computes every authorized current key family. Previously its move-wrap pass called `State::entitled` again for every entry's current audience. That repeats reader enumeration and acting-vault traversal for entries sharing a family.

The bounded change builds a temporary HashSet from the already selected families and uses membership in the move-wrap pass. `State::key_fams` includes every current entry audience. The State cloned at upkeep's beginning remains immutable throughout; earlier phases alter only keyring/blob work, not that State. The set is discarded on return and rebuilt every round. No persistent authorization cache, unlock bypass, key grant, stale revision or privileged peer role is introduced. Key creation, target selection, epoch wrapping, entry history and stewardship are unchanged.

Lean-first: UpkeepFamilies.lean proves membership in the filtered family list equals the canonical entitlement predicate for every current family and separately for a replacement state. Rust supplies the current-family coverage invariant through key_fams; the differential regression asserts that coverage on actual fixture states. Lean does not model hash-table implementation or prove latency.

Validation fixture checks every current entry for owner, other readers, hosted peer and stranger; checks a real Carol revocation changes an authorization decision; then restores the prior backup and checks parity again. Its benchmark repeats 4096 actual fixture entry-audience decisions for owner, Carol and stranger, includes family selection/set construction in the optimized time, and compares complete outputs. It isolates one removed cost; it is not an end-to-end warm-unlock or physical p95 benchmark. Native validation passed: `cargo test -p avendb --lib upkeep_family_tests -- --test-threads=1 --nocapture` (2 passed, 0 failed; compile 1m49s, tests 16.66s). Lean standalone check passed before the production edit.

| Actor | Canonical repeated checks | Reused family set, including construction |
| --- | ---: | ---: |
| Owner | 0.961375 ms | 0.176583 ms |
| Carol | 1.188792 ms | 0.170541 ms |
| Stranger | 1.301917 ms | 0.009000 ms |

These results demonstrate a micro-optimization, not the explanation or resolution of multi-second startup. No physical account, app, vault or store was accessed. Full integration CI remains pending.

Remaining: fresh same-artifact cold/warm measurements, opening keys, read/show reconstruction and stewardship costs, browser worker scheduling, snapshot capture copies and physical local/remote latency. This small optimization alone cannot close the reported 10-second unlock issue.

Implementation and validated tests: [1113cc42](https://github.com/MyAvenCEO/maiacity/commit/1113cc42). Raw archived warm timers additionally report read 70–90ms and opening the stored view 138–143ms. Dominant measured warm CPU work remains open-keys and show-items.


## Same-engine warm path anatomy

A follow-up synthetic fixture builds 32 real notes with four edits each, restores them to a second test device, captures the encrypted warm view/keys, and reopens three times with the same engine. Each reopen asserts stored-view reuse and exact record equality. It contains 166 edits and only four key boxes (1,752 payload bytes), so it is explicitly not representative of the historical thousands-key workload.

| Trial | Whole restore ms | Show items ms | Judging ms | Materialization ms | Key index ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 14.469 | 10.684 | 7.720 | 2.824 | 0.003 |
| 1 | 14.898 | 11.105 | 7.971 | 2.991 | 0.003 |
| 2 | 16.388 | 12.521 | 9.061 | 3.288 | 0.003 |

One focused native test passed in 2.32s after compilation. Test-profile debug replay assertions are enabled, so these are not release/physical latency numbers. Added numeric work timers separate key-index construction, stays, box opening, public keys, derivation, item judgment and materialization; they do not record keys or user data. The sum of nested timers is not whole elapsed time. The fixture optionally accepts AVENDB_SYNTHETIC_WARM_ENTRIES (1–256, default32) for a bounded larger synthetic study; no larger run is claimed yet.

The measured next target is ordinary item reconstruction, with judgment roughly72% of show time and materialization27%. The tiny-key fixture cannot establish whether copying key boxes dominates large-store unlock, and no KeyIndex ownership change was made. Large-key profiling and guarded projection-reuse design remain open.

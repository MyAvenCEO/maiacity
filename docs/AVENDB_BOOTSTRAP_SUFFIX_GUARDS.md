# Bootstrap suffix guards — candidate, not deployed

The bounded owner-only Store stage previously selected suffix writes by depth
relative to the snapshot. That loses concurrent branches with older or equal depth.
Selection now includes every held write absent from the authenticated base history,
ordered by the canonical policy ordering, with counted-dependency checks.

Before overlaying a historical entry slice, current entry identity, creator,
intake, stays, marks and key seals must match. Later entry moves or wants changes
therefore fall back to ordinary history instead of being overwritten. Revocation
continues through the existing current projection-authority gate.

Every unsupported or unavailable suffix (signature, dependency, key, body,
shared/proposal shape or policy admission) now abandons the entire anchor; it
cannot silently leave a partially reconciled entry writable. Opened suffix bodies
are staged until the entire suffix passes. Canonically rejected content still
uses normal judging, with only counted history shown.

Added regression candidates: delayed lower-depth concurrent branch agrees with
full-history state; unavailable signed suffix disables writable adoption; later
Mark preserves the canonical policy and rejects historical activation. Existing
revocation/reopen/concurrency regression remains. Rust tests are pending root's
shared compiler slot. Focused BaseSuffix Lean proofs passed; these establish the
modeled membership and fail-closed gates, not cryptographic/CRDT implementation
correctness. No Cargo, live data, or frozen release changes in this worktree.

Unchanged-state reuse optimization remains open behind these correctness gates.

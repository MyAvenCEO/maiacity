# Scoped Stories board candidate

The Stories board uses canonical selected-vault `entry_views` for story and flow
records, plus the existing trusted seed-city flow scope. Both are filtered through
current acting-vault visibility. Loading, errors and local absence are distinct;
flow discovery remains explicitly partial. Creation waits for both local reads
and normal capability checks rather than using unresolved workflow state.

Only board routes `#stories`/`#articles` bypass whole-world readiness. Individual
story detail routes retain the prior guard because their related widgets still
use broad-world references. This is an inventory-route improvement, not complete
Stories dependency coverage.

Validation: 26 Bun tests passed, including Stories component compilation and a
local inventory read while peer scheduling remains unanswered. Physical device
acceptance is pending. This candidate stays separate from frozen PR1272.

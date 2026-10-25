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

## Explicit Hook/Journey detail slice

Explicit `/hook` and `/journey` story routes now admit metadata-only startup. The target metadata and note remain independently scoped. Workflow reads request only the target vault and the pre-existing trusted seed-city fallback. Hook artwork retains cross-vault discovery through the bounded explicit global `artwork` type contract (requires commit 4989aaf8 or equivalent); its rendered file is then requested by exact ID. Current actor readability is checked before using each row. Cover state is cleared on replacement, failed reads remain local-unavailable, and obsolete asynchronous image completions cannot reappear under a new story/actor.

Read readiness is separate from mutation dependency readiness: direct canonical edits keep existing `may` checks. Stage transitions still require the complete legacy workflow/function dependency world and are disabled while that evidence is incomplete. They are not silently run against the reduced flow inventory. Other detail stages retain their broad-world gate because Sparks transitive links, Thumbnail file selection, Movie render tasks/cuts, Posts and ArticleView dependencies are not yet scoped end to end. Global typed artwork reads expose held authorized rows; this does not claim complete fresh-peer global artwork discovery or physical device validation.

Validation: real Svelte Story and StoryHook compile; 10 JS tests / 44 assertions pass for Stories queries, startup routing, local reads while peer acknowledgement is unresolved, cross-vault scope, exact render ID, and obsolete cover cleanup. No Rust/Cargo run in this follow-up.

## Writing detail follow-up

Explicit Writing routes now load text and canonical note/proposals without a whole-world barrier. Their ArticleView receives only the current actor’s file inventory in the story vault, the same scope used by filename resolution and the cover picker. A slow/missing/error file inventory does not block body text. Story stage children are keyed by actor and target identity, so drafts and pending child readers are discarded on context replacement. Writing permission probes and proposal lists clear old values while the new target is checked; rejected note reads do not become unhandled promises.

Validation: 12 focused JS tests / 50 assertions pass, including local reads without peer acceptance and rejecting an old vault’s delayed picture inventory. Story and StoryWriting compile. Remaining detail gates: Idea, Thumbnail, Movie and Derivatives; workflow stage transitions still need their full function/reference contract. This commit does not claim all Stories dependencies or media transfer completeness.

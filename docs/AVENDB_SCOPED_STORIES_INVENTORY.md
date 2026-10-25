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

Derivatives follow-up: local posts now use an explicitly typed, actor-authorized global post query (cross-vault links preserved), selected post pictures use that post’s vault, and workflows use the existing vault/seed-city precedence. Schema/proposal failures stay local and publishing remains separately disabled until its complete mutation dependency world exists. 13 focused tests / 53 assertions pass; full frontend check has zero errors and 27 existing warnings. Idea, Thumbnail and Movie remain gated pending bounded transitive references.

## Bounded transitive stage reads

Idea, Thumbnail and Movie now use local typed inventories plus an explicit-reference closure. Every referenced entry is read under the current actor; pages stay reactive, and a revoked/unreachable intermediate removes its descendants from the published view. The closure retains at most 4096 requested IDs in at most eight 512-ID leases, starts new root pages on successive browser turns without waiting for earlier pages, and reports truncation explicitly. Only schema-owned references (canvas items, artifact files, card layers/render, script source and task inputs/outputs/report file) are traversed. No text scanning or elevated peer access is introduced.

The ordinary Story detail route can consequently render its selected read stage before a whole-world response. Growth counts that would require global discovery are hidden for incomplete source worlds. Missing scripts/cuts are described as locally unavailable. Movie schema creation first reads the canonical schemas operation instead of interpreting a partial world as absence.

Remaining mutation boundary: `moving` still consumes workflow functions, post relationships, profiles, public shares and the negative “no other entry shows this image” condition for leaving public stages. This requires a complete, authorized dependency result; a partial positive collection cannot prove the negative condition. Stage transitions remain disabled for incomplete worlds until that contract exists. The full original transition-dependency goal is not done. Typed global discovery only covers currently held authorized rows; physical fresh-peer completeness remains unverified.

Validation: Lean ScopedReferenceRead passed for current-read/reachability, closed-generation publication and explicit budget invariants (an abstract contract, not proof of the JS program). Behavioral regressions cover transitive discovery, revoked intermediary removal, late responses after disposal, 512/4096/eight-lease limits, and a stalled first root page while a later page renders. All changed Svelte components compile. No Cargo or live-store changes.

Review correction: Thumbnail’s picker now reuses `libraryFilesQuery` (`kind: file`), preserving custom-schema files rather than narrowing to the built-in `file` type. Reference traversal enqueues only held IDs and marks them visited at enqueue time; duplicate/missing fanout cannot multiply its temporary queue beyond the held 4096-ID bound. The eight-observer bound also limits a chain to eight discovery waves even below 4096 entries: depth nine is explicitly reported as limited, and opening the linked source continues from a new root. This is a documented partial-view limit, not complete recursive discovery. Five closure regressions pass, including adversarial repeated/missing fanout and depth-nine truncation.

## Current mutation status: private transitions scoped

This supersedes the earlier blanket stage-transition restriction: private-to-private Story transitions now use exact local vault `flow/function/post` inputs and the existing trusted seed-city `flow/function` fallback. All required local query responses must be ready. Because `moving(..., withPictures=false)` has neither a public source nor destination, it cannot take its profile/public-share or negative picture-use branches. The same function checker, bounded operation planner and actor-authorized mutation API still run. A real `moving()` regression produces an identical operation plan with the scoped rows and the full fixture, including the custom function’s related-post edit.

Transitions entering or leaving public stages still require complete picture-sharing evidence and remain disabled on incomplete worlds. The scoped private path does not establish global peer completeness or authorize broader sharing. Lean PrivateStoryTransition passed; 39 workflow tests including full/scoped equivalence passed, plus two query/readiness contract tests. No Rust changes or Cargo run.

## Reference depth correction

The next combined implementation expands a partly filled page in place instead of spending a new observer for every discovered edge. A small twelve-deep graph now resolves with one live observer, while512 IDs per page,8 live observers and4096 total IDs remain bounded. Replaced observers carry a generation guard, so delayed replies cannot revive old rows; revocation/current readability and graph reachability still filter published rows. Five focused graph regressions pass, including deep graph, late prior-generation reply, fanout, bounds and revocation. Earlier eight-wave limits above describe the superseded implementation. This does not make a graph beyond4096 IDs complete. Lean scheduling/generation invariants were checked before this change.
## Guarded Story workflow transitions (continuation slice)

Story stage changes now capture exact canonical local reads rather than requiring
a complete world: target, navigation/ownership/share summary, own workflow/posts/
profile/files, trusted workflow defaults, and (when leaving public) source-vault
tag users. The same queries are checked by the core at each execution and after
any delayed owner approval. Successful steps return refreshed receipts under the
same lock; another edit invalidates the next step. Partial success is explicitly
reported, including transport uncertainty, with no automatic retry.

Negative picture evidence is source-vault scoped because file names resolve in
the article's vault. Comparisons use resolved file IDs, not global filename text.
A different vault's same-named picture no longer falsely prevents unsharing;
another same-vault user of the actual file still preserves it.

A vault inventory cannot assert local completeness without a known actor/owner
domain relationship, fully replayed local metadata and readable held entries.
Nonowners receive incomplete regardless of whether hidden entries exist. This is
conservative and remains a delivery blocker for delegated workflows: writers
without owner-domain evidence cannot yet execute these scoped workflow plans.
The old full-world fallback is not enabled because it has no equivalent
execution-time negative-evidence guard. A canonical full-domain authority proof
is required before admitting that fallback. It never asserts remote completeness. Core auth and
owner ceremony remain the final authority for every emitted mutation.

Validation: 45 Bun tests / 139 assertions passed, plus the transport-uncertainty regression, including actual planner and
picture-identity behavior. ScopedTagInventory Lean passed. Rust parses; native
runtime regressions pending shared compiler. Full Svelte check passed with zero errors and 27 pre-existing warnings. Derivatives publishing and withdrawal now use the same guarded capture contract
with picture dependencies included. Its own canonical post vault defines the
flow and filename scope; current Story/actor identity cancels obsolete plans.

Whole-vault delegated readers are admitted using canonical live wide Read (or
stronger) shares, including a public wide share. This condition depends on known
authority, not hidden row existence. The native regression grants then revokes
that share and requires the guard to stop after revocation. Selective delegated
writers remain blocked pending an equally sound dependency-domain contract.

Selective delegated workflows remain open: the positive guard primitive permits
exact known dependencies, but the current workflow planner falls back on absent
custom flows and enumerates functions/posts. Those inventories therefore remain
strict. Private transitions avoid file/profile materialization; public transitions
retain the additional strict dependency domains.

Correction after planner review: the preceding selective-private completion claim
is withdrawn. Default-flow fallback and function/post enumeration make absence
decisions even for private stages; those inventories are strict again. The
positive guard primitive remains valid for exact known dependencies, but no
closed workflow dependency contract exists yet. Selective delegated workflow
completion remains open; ordinary authorization has not been relaxed.

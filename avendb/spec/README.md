# avenDB spec

The formal specification of avenDB, the user-owned, end-to-end encrypted database behind the avenDB tile, in Lean 4
(core library only, no Mathlib). It states what must always hold: who may write, who can open which key, what each
device receives. The Rust crate `avendb/crates/avendb` is built against it test-first, and its tests carry the same
names. The plan with the scenarios and the build order is the Claude Doc "avenDB: E2E reference plan" (linked from
`avendb/README.md`).

## Build

```sh
cd avendb/spec
lake build
```

It needs [elan](https://github.com/leanprover/elan); `lean-toolchain` pins Lean 4.34.0, and a build takes seconds. It
fails when a proof breaks, when a scenario check in `Examples.lean` (`#guard`) doesn't hold, or when a file in
`vectors/` no longer holds what the model answers. Each `declaration uses 'sorry'` warning is a theorem whose proof
belongs to a later phase.

After a change to the rules, write the test vectors again and commit them with the change:

```sh
lake exe vectors
```

## Files

| File | What it holds |
|---|---|
| `Basic.lean` | Ids, principals (signers and vaults), levels relay < backup < read < write < owner (a level's rank is its byte on the wire), whom a share names (`Who`: a vault, everyone or a device), selectors and what they test (type, author, entry, creation time, tags), what an entry's first write says of it (`Header`: its type, when it was created and the content it starts with), audiences, key families and key names |
| `State.lean` | What a peer knows: the three kinds of vault (human, coop, aven) and what each may be owned by; acting for a vault through the chain of owners an edit names (`actsVia`), approving for it (its root, or its threshold of owners); shares and the chains they rest on; entries, their stays and audiences; the operational rules a relay can check (who may write, create, revoke) and the semantic layer only readers and stewards know (an entry's attributes, whether its creation was let in, its semantic audience, `desired`); keep shares, which entries each device wants (`wants`, `keeps`) and the keep shares whose selectors pick each entry (`semWants`); the one mark a steward makes of an entry, of its audience, its wants or both (`desiredMark`); which writes an entry's readers count, by the ops of the chain a write's proof names and whether it fits its entry's schemas (`lets`, `counts`, `creates`, `counted`); each vault's schema lane, read off its schema and lens entries (`laneOf`); symbolic keys (`Knows`), rotation, sealing and entry keys |
| `Step.lean` | Every edit and the rules that accept or refuse it: a vault's genesis and its settings (threshold, root); shares (a grant, a keep share, an owner, a device) and their revocations, an owner grant never of the whole vault (WideOwner); writes that create entries in audiences (a vault's schemas and lenses among them), marks (an entry's audience, the keep shares that want it, or both), keys, checkpoints, writes on a proposal (which build on its start); the one order every peer replays in; strong removal: what a removal or a mark of an audience cuts, and which removals stand when they clash (`view`); what a peer counts once it no longer trusts the curves (`checkpointed`) |
| `Sync.lean` | What a peer sends a device: sync by audiences, entry by entry (each entry's writes, marks, checkpoints and keys), of the entries it may receive and its keep shares want (`syncs`), what everyone may read only for a device with an interest in its vault or that follows it (`interested`, `follow`), with the shares and vaults needed to check them; the files a peer may hand a device, those the writes it sends bring (`mayFetch`); and what it hands a new device whose passkey proved itself on their connection, the logs of the vaults the passkey owns (`linkCard`) |
| `Logs.lean` | Every edit in one log, a vault's, a share's, an audience's or an entry's, building on that log's frontier; each log's closed part (the edits whose whole past is held) and frontier; what a device names of each log when it asks (its frontier, the edits 1, 2, 4, 8, … steps back and the oldest), the vaults it follows and its loose edits; what a peer sends beyond them (`respondSince`); forks; and holdings (phase H): what a device states it holds of each log and file (`Frontier`, `FileHold`, `Holdings`), the announcements that tell it (`Announce`), sync connections and the device each one's hello proved (`Conn`), a node's shelf and what it tells each device, what it keeps of each device (`Node.record`), Synced to (`Node.syncedTo`, `Node.syncedToFile`) and its blob gate (`Node.hands`) |
| `Doc.lean` | Documents as histories: merge and promote, against the laws we rely on from Loro |
| `Proposals.lean` | Proposals write by write: each write extends one line of its entry's history, the main line or a proposal; a line's history and heads; the order writes come in (`Ordered`); T10f to T10h, which tie `Doc.lean`'s merge and promote to the writes |
| `Lens.lean` | The markdown document and the todo in two schema versions and the lenses between them; items as stored, projected on read into each app's schema, and edits through each app's view; the lens laws (T9) |
| `Ops.lean` | One language to read and change any record ([OPS.md](../docs/OPS.md)): records flat, a value at each place and the rows of each list of records by id; changes, `apply` and `diff`; the ops apps send, each naming a place; queries whose `where` mixes a share's labels with tests of values, and the selector a device picks entries by (O1 to O3) |
| `OpsVectors.lean` | The ops cases for the Rust engine, in the very JSON the page sends: diffs, runs of ops, and queries with the selectors they pick by (`lake exe vectors` writes them to `vectors/ops.json`) |
| `Rules.lean` | Shares as named groups of ops: the ops (relay, backup, read, the ops that write with paths and `*`, the values a set may take, the lines they hold on and the tags they may ask for, share), a share's level as the class of its strongest op (`levelOf`), the built-in groups (`groups`), a write's touches (what its Loro ops did, place by place, and the tags it asks for) and what ops allow; the half of C3 about a write's changes (`changes_allowed`) |
| `RuleLemmas.lean` | The proofs of C1 to C4: chains narrow, readers agree whether a write counts, counted writes did what their chain allows, allowed writes count and what builds on an uncounted one never does |
| `Schemas.lean` | Writes that fit their schemas: what the schemas a write is judged under let a record hold, place by place, row by row and in its own fields (`Fit`); a write judged by its diff (`Fit.fits`); S1 and S2, a write judged by what it changed and records that fit staying so |
| `Props.lean` | The predicates and views the theorems are stated with, apart from their proofs |
| `Theorems.lean` | T1 to T8, T11 to T28 (with `T22_wide_shares`; T29 is merged into T23; T27 extended to holdings), C1 to C4, S1 to S4, K1 and H1; and `writes_ordered`, the order every peer's writes come in, which T10f to T10h rest on |
| `Lemmas.lean` | The helper lemmas for vaults and writes: how a step changes a vault, ownership links and chains, what a step keeps that authorization reads, causal closure, the schema lane read off the entries (T17) |
| `CapLemmas.lean` | The helper lemmas for shares, audiences, keep shares and removals: well-formed share chains, and no owner share wide, so a wide share rests on none (T22); one lemma, `mark_means`, that a list of marks means what the selectors say, from which both parts of T23 follow, an entry's audience meaning what the shares say and its wants what the keep shares say; the replay and strong removal (T16, T18), a keep share's revocation cutting nothing (K1), the epochs along a replay (T15) |
| `RelayLemmas.lean` | The proof of T25: every rule reads only the operational part of a state, so a relay that opens no selector, type or tag has every edit stand or fall as an owner does |
| `KeyLemmas.lean` | The helper lemmas for the keys: what settling seals, publishes and links, `opens` finding every key `Knows` gives, the invariants behind T5, T6 and T24, `EverReads` |
| `SyncLemmas.lean` | The helper lemmas for sync: the replay order is a total order on ids (T11), what a peer sends a device, what everyone may read only for a device with an interest in its vault or that follows it (T12), and that it follows the device's keep shares (T28), a log's closed part lying at or below its frontier, and every edit a device names of a log being one it holds with its whole past (T19); for holdings (H1, T27), what a node keeps of a device came on that device's own connection, a peer's answer is whole logs so the files of the logs a device may know of are files it may fetch, and a frontier that covers a log as a node holds it, stated of a shelf, means the shelf holds every edit of it the node holds |
| `Examples.lean` | The plan's scenarios run on the model, and the flat vaults' own: sharing every entry of a type, by a tag or one entry, a tag moving an entry out of a slice, creating through a share, shares resting on shares, wide shares and everyone, a revocation that moves no entry, an audience that comes back into use, proposals, schema v2 in schema and lens entries shared with everyone and what goes to whom of them, one todo shared with several vaults and synced peer to peer, strong removal, checkpoints once the curves fall, and holdings: kept from each device's own connection, a forged one from a third party ignored, Synced to listing exactly the devices that may hold an entry and said they do, the bucket first, a peer ahead, changes alone, and no file past T27 whatever anyone claims |
| `Vectors.lean` | Cases for the Rust core: edits applied in order (which the model accepts) and edits at the depths they claim (which stand in the view, or in the post-quantum view), with the state at the end, as its readers see it too, each line of each entry's history and its heads among it; sync cases: edits with their parents, each log's closed part and frontier, the forks, and for each device that asks a peer, following some vaults, what it names of each log, its loose edits, what it is sent and the files it may fetch; and lens cases: what each app reads from stored blocks and todos, and what its edits store |
| `VectorsCheck.lean`, `WriteVectors.lean` | Check the files in `vectors/` on every build; write them (`lake exe vectors`) |
| `vectors/vaults.json` | The cases with the model's answers, read by `crates/avendb/tests/vectors.rs` |
| `vectors/lenses.json` | The lens cases with the model's views and edits, read by `the_lens_vectors` |
| `vectors/ops.json` | The ops cases with the model's changes, records and plans, read by `crates/avendb/tests/ops.rs` |
| `protocol/*.vp` | Verifpal models of what devices say to each other: the hello on every connection, linking a new device by its passkey, and the sealed box (see [Protocol models](#protocol-models)) |
| `protocol/check.sh` | Checks each model against the result its header expects |

## Theorems

| # | What must always hold | Status | Guarded in Rust by |
|---|---|---|---|
| T1 | Only authorized writes are accepted, each by a device acting for the vault through the owners the write names, for a vault that is the entry's or holds a live share with write or more reaching the entry's audience; a new entry is created by its vault, or in the intake audience of such a share; and revocation wins over what it hadn't seen | Proven | `write_without_share_rejected_on_import`, `t1_authorized_writes`, `t1_revocation_wins`, the vectors |
| T2 | Governance (settings, and sharing or revoking an owner or a device) needs the vault's approval (its root, or its threshold of owners) plus the newcomer's consent, unless an owner or a device leaves on its own; devices, a human vault's or an aven vault's servers, can't govern | Proven | `add_owner_needs_threshold_and_consent`, `device_cannot_govern`, `an_aven_vaults_devices_act_for_it_but_never_govern_it`, `the_passkey_is_the_root`, `t2_consent`, the vectors |
| T3 | No ownership cycles in any state the edits can reach | Proven | `ownership_cycle_rejected`, `t3_no_cycles`, the vectors |
| T4 | Shares name a vault or everyone; a share names a device only as a keep share, of a device of its issuer, and a keep share names nothing else (KeepNeedsDevice, DeviceOnlyKeeps, NotDevice) | Proven | `share_to_signer_rejected`, `t4_shares_name_vaults_and_t8_everyone_only_reads`, the vectors |
| T5 | A holder (a signer, whoever holds a vault's seed, or everyone) opens a key of a family, of any epoch, only if over the history it could read the family: itself, while it was public, or through a vault whose seed it held at some point (whoever joins a vault inherits what the vault could read) | Proven | `t5_confidentiality`, `entry_reader_cannot_open_other_entries`, `every_device_opens_exactly_what_it_may` |
| T6 | Forward secrecy on removal: in every state the edits can reach, the current key of a family in use opens only for holders entitled to it now, or while it is public | Proven | `t6_forward_secrecy`, `revoked_reader_cannot_open_new_edits`, `every_device_opens_exactly_what_it_may`, the vectors |
| T7 | Blind server: a device whose vaults read nothing of another vault, such as the server acting for avenCEO with its relay shares, opens no key of a vault whose seed it never held, unless that key was public | Proven from T5 | `server_holds_only_ciphertext`, `every_device_opens_exactly_what_it_may` |
| T8 | Everyone only reads | Proven | `everyone_only_reads`, `t4_shares_name_vaults_and_t8_everyone_only_reads`, the vectors |
| T9 | Lens laws: round trips, both apps see the same item, an edit shows exactly as made, an unchanged view writes nothing, and an older app's edit keeps what it can't see | Proven | `lens_round_trip_v1`, `edits_through_a_view_keep_what_it_cant_see`, `t9_put_get`, `t9_put_get_todos`, `the_lens_vectors`, `scenario_09_schema_v2` |
| T10 | Merge is the union of histories; promote gives the proposal's content and keeps both; a write on one line leaves every other line as it was | Proven | `promote_equals_proposal`, `merge_is_the_union_of_both_lines`, `t10_proposals`, `scenario_08_proposals`, the vectors |
| T11 | Same edits in any order, same state | Proven | `same_edits_any_order_same_result`, `t11_convergence`, `t11_vault_logs_converge`, `every_order_of_delivery_ends_the_same`, `scenario_13_offline_conflicts` |
| T12 | A peer sends a device only the logs of entries, audiences and shares it may receive by the peer's view, and vault logs, whatever the device names when it asks. What everyone may read goes only to a device with an interest in its vault (it acts for the vault, or for a vault holding a live share over it) or that names the vault in its request's follow list, and following brings nothing that isn't public (`T12_interest`); a device that acts for no vault and follows none is sent nothing (`T12_stranger_gets_nothing`) | Proven | `sync_sends_only_what_shares_reach`, `t12_sync_sends_only_what_shares_reach`, `t19_frontier_sync_loses_nothing`, the sync vectors |
| T13 | Two devices that each asked the other once, whatever vaults each follows, hold the same edits of every entry each syncs by the other's view (may receive, by its interests and the vaults it follows, and wants, T28) | Proven | `entry_syncs_peer_to_peer_without_server`, `t13_sync_converges`, `scenario_17_peer_to_peer` |
| T14 | Accepted writes are causally closed: a write stands only with every write it builds on, and every write is of an entry that exists | Proven | `t14_causally_closed`, the vectors |
| T15 | Rotation follows revocation: a device writes an entry under the key of its stay at its audience's current epoch in what it knows, which opens only for holders that what it knows entitles to the audience, and under no older epoch than any along its history, so once it has seen a removal the removed can't open what it writes | Proven from T24 | `a_device_writes_under_the_newest_key_it_knows`, `revoked_reader_cannot_open_new_edits`, `scenario_10_revoke_carol` |
| T16 | Strong removal: an edit stands only if it also stands without what each later removal that hadn't seen it takes away, a mark's being the audience it took the entry out of (a mark of the wants alone takes nothing), and every removal chosen stands | Proven | `a_removed_owner_cannot_backdate_governance`, `handing_the_root_on_cuts_the_old_passkeys_backdated_edits`, `t16_strong_removal`, `t16_resolved_removals_stand`, `scenario_21_a_tag_moves_an_entry_out_of_a_slice`, the view vectors |
| T17 | A vault's schema lane is read off its own schema and lens entries: a step adds a blob to it only by creating an entry of the vault of type schema or lens that holds the blob, acting for the vault itself through the owners it names, which its readers count; one created by anyone else through a share, and any other edit, add nothing (`T17_lane_from_creations`), and a write to an existing entry leaves every lane as it was (`T17_writes_ignored`) | Proven | `only_owners_publish_into_the_lane`, `a_write_counts_once_the_lane_holds_its_schema`, the vectors |
| T18 | Once the curves fall: a peer that no longer trusts them counts a write only if a checkpoint by its own author covers it | Proven | `a_broken_curve_writes_nothing_that_counts`, `t18_checkpointed_writes`, the vectors |
| T19 | Frontier sync loses nothing: a device that asks with its frontier of each log, a few edits further back and its loose edits is sent every edit of the peer's answer it lacks; and two copies of a log with the same frontier hold the same closed part, so one digest per log tells whether to ask | Proven | `t19_frontier_sync_loses_nothing`, `t19_partial_delivery`, `t19_one_digest_per_log`, `a_second_sync_sends_nothing`, `an_edit_sends_only_what_is_new_both_ways`, the sync vectors |
| T20 | Linking hands out vault logs alone: what a peer hands a device whose passkey's pass names it on their connection is the log of each vault the passkey owns, or that owns such a vault up the chains, and nothing of a share, an audience or an entry; a passkey that owns no vault there gets nothing | Proven | `a_link_card_holds_the_logs_of_the_passkeys_vaults_and_nothing_else`, `a_node_hands_its_card_for_a_pass_for_the_device_on_that_very_connection_alone`, the link vectors |
| T21 | Vaults keep to their kind: signers own human vaults only; coop and aven vaults are owned by human and coop vaults; a coop vault has no devices; only a human vault has a root. So every act for a coop goes through a human vault its device or passkey belongs to, and so does every act for an aven vault that none of its own servers signs | Proven | `every_vault_keeps_to_its_kind`, `t21_vault_kinds`, `an_act_for_a_coop_names_the_vault_it_goes_through`, `a_removed_owners_unseen_writes_for_the_coop_are_cut`, the vectors |
| T22 | A share grants no more than the shares it rests on: a share that rests on another is over the same vault, rests on an owner share issued to its own issuer, and selects nothing its parent doesn't; a wide share rests only on a wide share. No owner share is wide, since owner of a whole vault is an owner of it, which no share makes (WideOwner): so that last clause holds only vacuously, and every wide share rests on none and, unless it is a keep share, which grants nothing, was issued by the vault it is over (`T22_wide_shares`) | Proven | `t22_shares_narrow_down_their_chain`, `scenario_24_a_share_resting_on_a_share`, the vectors |
| T23 | Marks mean what the shares say: where an entry's marks, what isn't live left aside, are what its stewards mark it with, the rules every peer checks without reading a selector, a type or a tag mean what the selectors say. Its audience: the write rule allows exactly the vaults the shares' selectors allow, and never refuses a creation inside its creator's slice. Its wants: a device wants the entry, and keeps its files whole, exactly as its keep shares over the entry's vault say (`wantsWith`, `keepsWith`), each picking it where it is wide or its selector picks it, a whole or opened one every schema and lens entry too and a never one none (`keepPicks`). Both parts follow from one lemma, `mark_means`, so a peer that reads no selector applies every share and every keep share from the marks | Proven | `t23_audiences_mean_what_shares_say`, `t25_blind_relays`, `scenario_19_share_every_entry_of_a_type`, `scenario_23_creating_through_a_share`, the vectors |
| T24 | An entry's key reaches only its audience's readers: whoever opens the key of an entry in its current stay, at its audience's current epoch, may open that audience's current key; and over the history a holder opens a key of an entry only if it could read some audience the entry was in | Proven | `t24_entry_keys_reach_only_audience_readers`, `scenario_21_a_tag_moves_an_entry_out_of_a_slice`, `scenario_26_an_audience_that_comes_back_into_use_moves_on` |
| T25 | Blind relays: a peer that reads no selector, no type and no tag, such as the server, holding the same edits as an owner, has every edit stand or fall alike and knows the same of the vaults, shares, audiences, writes and keys. It knows no schema lane, which only readers read off the entries, and nothing it checks needs one | Proven | `t25_blind_relays`, `scenario_25_wide_shares_relays_and_public` |
| T26 | Relay alone: a device acting for no vault of an audience, with nothing but relay shares over that vault, receives none of the audience's edits, whatever it follows; relay lets the server know a vault's devices and keeps nothing, backup keeps the ciphertext | Proven | `T26_relay_keeps_nothing`, `a_relay_share_keeps_nothing` |
| T27 | Files follow their edits: a peer hands a device a file only if it holds a write that brings it, of an entry the device may receive by the peer's view; only writes bring files ([BLOBS.md](../docs/BLOBS.md)). Holdings never authorize (phase H): a node's blob gate hands a file's root or one of its pieces only to the device whose hello proved a sync connection still open from the blob connection's endpoint, and only by T27 (`T27_holdings_never_authorize`), whatever anyone, the node included, says it holds (`T27_gate_reads_no_holdings`); and a node names a file it holds, in what it announces on a connection, only if the device that connection proved may fetch it by T27, naming it as no longer held only if it named it on that connection before (`T27_holdings_name_only_fetchable_files`) | Proven | `t27_files_follow_their_edits`, `a_write_and_a_body_name_their_files_one_way_only`, `holdings_never_let_a_peer_get_a_file_t27_refuses`, the sync vectors |
| T28 | Sync follows the keep shares: a peer sends a device an entry's edits only if the device may receive the entry and its keep shares want it (`T28_sync_follows_keeps`): the live keep shares naming it over the entry's vault, issued by a vault it is still a device of; all of the vault if it has none but never ones, else what a whole or opened one picks (wide, or among the entry's wants) and no never one does; it keeps the entry's files whole only where a whole one picks it (`T28_keep_modes`); a keep share grants nothing ([BLOBS.md](../docs/BLOBS.md)) | Proven | `t28_sync_follows_rules`, `t28_each_device_syncs_what_its_rules_pick`, `sync_rules_grant_nothing`, `the_iphone_keeps_the_proxies_its_rule_picks`, the vectors |
| T29 | Merged into T23, whose wants part it is: marks mean what the rules say | Merged | `t23_audiences_mean_what_shares_say`, its wants part |
| O1 | A diff explains any two records: applying the diff of `r` and `s` to `r` gives `s`, it names every change and only what changed (`apply_diff`, `diff_complete`, `diff_sound`) | Proven | `o1_a_diff_explains_any_two_records`, `each_diff_makes_the_models_changes` |
| O2 | Ops do what they say: the diff of a change within some places names only what those places cover (`diff_within`) | Proven | `o2_ops_change_only_what_they_name`, `each_run_ends_where_the_models_does` |
| O3 | Queries pick by labels: the selector a query's labels make picks every entry the query does, so a device picks by labels and tests values only in what it opens (`cover_sound`, `plan_sound`, `plan_run`) | Proven | `o3_a_plan_picks_no_less_than_its_query`, `each_query_picks_and_holds_as_the_models`, `a_query_picks_by_labels_then_tests_what_it_opens` |
| C1 | Chains narrow: a chain allows no write one of its shares forbids, and nothing through a share whose level isn't the class of its ops; a share's chain allows no more than the chain of the share it rests on (`chain_narrows`, `child_narrows`) | Proven | `c1_a_share_resting_on_an_owner_share_is_held_to_both`, `the_built_in_groups_are_the_models`, the vectors |
| C2 | Readers agree: whether a write or a creation counts reads no selector, type or tag, and no ops but those of the chain its proof names, so every reader of the entry reaches the same verdict (`counts_seen`, `creates_seen`) | Proven | `a_share_lets_whom_it_names_make_only_what_its_ops_allow`, the vectors |
| C3 | Counted writes do what they may: a counted write by anyone but the entry's vault relies on the share its proof names, every share of whose chain allows every touch of it by an op that writes, and where its touches' places cover its diff, every change is at a place an op allows (`counted_allowed`, `counted_writes`, `changes_allowed`) | Proven | `c3_touches_cover_every_change`, `touches_name_the_field_the_row_and_the_value`, `a_share_that_only_suggests_writes_on_proposals_an_owner_merges` |
| C4 | Allowed writes count: a write that builds on counted writes, whose proof names a share its actor holds reaching the entry and whose chain allows its touches, counts, and so does such a creation; no write that builds on an uncounted one counts (`allowed_counts`, `allowed_creates`, `uncounted_closed`) | Proven | `a_share_lets_whom_it_names_make_only_what_its_ops_allow`, `the_vaults_her_vault_owns_are_real_and_each_acts_by_its_own_shares`, the vectors |
| S1 | A write is judged by what it changed: it fits its schemas exactly when each change of its diff does, on the record or row around it, so a value it didn't change holds it back nowhere else (`fits_iff`) | Proven | `s1_a_write_is_judged_by_what_it_changed`, `s2_a_record_that_fits_keeps_fitting` |
| S2 | Records that fit stay so: a record that fits keeps fitting through a write that fits, and an entry's first write, if it fits, makes a record that fits of nothing (`fits_clean`, `fits_new`) | Proven | `s2_a_record_that_fits_keeps_fitting`, `s1_every_edit_an_app_makes_fits` |
| S3 | Writes that don't fit count for no reader: no write and no creation whose result doesn't fit its schemas counts, whatever its shares and ops, nor anything built on it (`S3_unfit_uncounted`, `S3_step`) | Proven | `s3_a_write_that_breaks_its_schema_counts_for_no_reader`, `a_write_counts_once_the_lane_holds_its_schema`, the vectors |
| S4 | Relays don't judge records: whether a write fits, which only its readers can tell, changes nothing but which writes they count (`S4_fit_unread`) | Proven | the vectors |
| K1 | A keep share's revocation cuts nothing: only its issuer revokes it, which only marks it revoked, and as a removal it takes nothing away from any edit (`K1_keep_revocation_cuts_nothing`, `K1_keep_revocation_hides_nothing`) | Proven | the vectors (revoking a keep share cuts nothing) |
| H1 | Holdings come only from their proving connection: a node keeps of a device a frontier of a log, or what it holds of a file, only as an announcement said it on a connection whose hello proved that device (`H1_heard_on_their_connection`), and nothing said on another device's connection changes it (`H1_third_party_ignored`); it announces its own holdings alone, the same whatever it heard (`H1_passes_nothing_on`), each frontier being what its shelf holds for good of a log the device on that connection may know (`H1_states_its_shelf`). So a device other than its own that a node lists as synced to an entry may hold the entry's log by the node's view and stated itself, on a connection that proved it, a frontier of that log covering every edit of it the node holds (`H1_synced_to`); if each of its announcements stated what a shelf of its own holds, that shelf holds every one of those edits (`H1_synced_to_held`). Likewise a device listed as synced to a file may fetch it and stated itself that it holds it whole (`H1_synced_to_file`) | Proven | `holdings_come_only_from_the_connection_that_proved_their_device`, `a_forged_holding_from_a_third_party_is_ignored`, `an_announcement_carries_changes_alone_and_an_ask_the_logs_that_differ` (avendb-net/tests/holdings.rs), `a_server_states_a_holding_only_once_its_bucket_has_it` (tests/bucket.rs), `a_devices_holdings_of_each_log_are_its_frontier_and_waiting_edits_as_sync_cuts_them` and `an_announcement_tells_all_on_a_new_connection_and_then_only_what_changed` (holdings.rs unit tests) |

The Rust scenario tests (`crates/avendb/tests/scenarios.rs`) run the same scenarios as `Examples.lean`, on real devices
and keys in the Lab. The vectors (`crates/avendb/tests/vectors.rs`) hold the Rust rules to the model's answers edit by
edit, and in the view, where each edit claims a depth: the model names vaults and shares by numbers and edits by their
place, the core by hashes, so the test maps each number to what its edit created.

T3 is stated for reachable states, the replay of some edits from the empty state: an arbitrary state could list an owner
vault that doesn't exist, which no edit can produce. Its proof carries that invariant (`OwnersExist`) along. T6 and T24
are stated for reachable states too, and their proofs carry `KeyInv` along: seals hold only keys that exist, what is
sealed to an audience's key lies within the audience, and every public family's current key is published. T5 follows the
whole history instead: every seal is justified by what was readable at some point (`SealsRead`). Devices encrypt each
write under the key of its entry's stay at its audience's current epoch (the rules refuse an epoch that doesn't exist
yet, but the one a new entry brings an empty audience to), so with T24 nothing written after a removal opens for whoever
it removed (T15). Peers don't check this of each other: a write names the frontier of its own entry's log, while the
removal that rotated its audience's key mostly sits in a share's or a vault's log, and a device that had seen the
removal could pass the text on anyway. Outside removals entitlements only grow, so by T6 no key goes stale but an
audience's that comes back into use: the Rust key schedule looks for stale keys only after a removal or a mark into such
an audience, and `t6_forward_secrecy` checks that nothing else makes any.

Concurrent changes replay in one order (causal depth, removals first, then edit hash), so they settle the same way on
every device. That alone doesn't stop a removed owner, or a thief holding a stolen passkey, from signing edits on an old
copy of the log that claim to come before the removal, so a removal cuts what it hadn't seen (T16). Every removal
(revoking an owner, a device or a grant, handing the root on, marking an entry into another audience) names the edits it
had seen and keeps; every other edit before it in the replay order stands only if it also stands with what the removal
takes away hidden, for governance as for writes. When removals clash, the senior one stands. A vault's own removals (an
owner or a device revoked, the root handed on) settle first, from the top down: a vault's before those of the coops it
owns, since a coop's removals rest on its owners' approval, and within a vault its root, then its owners in the order
they joined, then removals no owner approved (a device leaving). Revoked grants follow, the most senior revoker first:
the vault the grant is over, then whoever issued a grant higher up the revoked grant's chain. So a revoked owner can't
keep their grant by revoking, on an old copy, a grant they gave beneath it, and a peer that never held a coop's log
settles its owners' vaults as everyone else does (a finding of P6). Marks of an audience come last: such a mark takes
away only the audience writes of its own entry rested on, which no removal and no other mark rests on, so the Rust core
doesn't try each as it tries each other removal, and chooses the same. A mark of the wants alone is no removal.

A vault is an identity, like a smart account, and comes in three kinds (T21). A human vault is a person's: owned by
their passkeys, its root and any backup, the only vault a signer ever owns, with the person's devices. A coop vault is
owned by human and coop vaults, never by a signer, and has no devices: it acts through the vaults that own it. An aven
vault, an agent's such as avenCEO, the vault of avenDB's server, is owned as a coop is, and its devices, its servers,
act for it but never govern it (T2). Shares name vaults or everyone (T4): only a keep share names a device, one of its
issuer's, and it grants nothing. Every edit for a coop or an aven vault names the chain of owners it goes through
(`via`): from an owner of the vault it acts for down, each an owner of the one before, to the vault its device or
passkey belongs to. The rules check that chain alone, so the edit says how it was entitled, and a removal anywhere along
it cuts the edit the same way on every device (T1, T16, T17).

A human vault's passkey is its root, named at genesis: it approves anything for its vault on its own, wins every
clash, and only it hands the root on (a settings edit, which cuts what the old passkey signs on an old copy). Passkeys
are the only way back in: a backup passkey may join as a second owner, never the root, and a device's keys derive from
a passkey at every unlock.

A vault holds its entries directly, with no spaces or folders in between. An entry's type and tags travel inside the
encrypted bodies of its writes, and a share grants a level on a slice of a vault: what its selector picks by type,
author, entry, creation time and tags, AND-ed down the chain of shares it rests on (T22), or the whole vault for a wide
share. The shares that pick an entry alike form its audience, which carries the keys: an audience's key opens for the
vault and for each share with read or more that reaches it, and an entry's key derives from its audience's key for each
stay of the entry in an audience. No rule a peer checks reads a selector, a type or a tag: only the audience an entry is
in, which shares are live and whom they name, so a relay that opens none of them decides every edit as an owner does
(T25). The stewards, the vault's own devices, read every selector and every entry, and keep each entry in the audience
its shares pick, and its wants on the keep shares that pick it, by marking it (`desiredMark`), so the rules peers check
mean what the selectors say (T23). Anyone else creates through a share, in the share's intake audience, and asks for
tags in its writes; the stewards answer each ask with what the asker's shares let it ask for. A revocation moves no
entry: its audiences move on to a new epoch instead. A mark that takes an entry to another audience is a removal: it
cuts the writes it hadn't seen that relied on the old audience, so nobody backdates an edit into an entry after it left
their slice, and it links the entry's earlier keys under its new one, so whoever reads it now reads its whole history
and nothing of an entry it can't read now (T24). An audience no entry is in keeps its key through removals; an entry
that brings it back into use moves it to a new epoch, which whoever a removal took out meanwhile doesn't open.

A share is a named group of ops and nothing else (`{name, where, ops}`, [OPS.md](../docs/OPS.md)): what its grantee may
do on what its `where` picks, from relaying and backing up to reading, writing value by value, asking for tags and
sharing on; its level is the class of its strongest op. Its sealed slice holds the ops, and its `select` shows only a
salted hash of them in the clear, beside the level (T25). Every write through a share carries, inside its encrypted
body, a proof: the share it relies on, and the ops and salt of each share of that share's chain. Every reader of the
entry reads the write's touches off its Loro ops, imported on the version it builds on, and counts the write only where
every share of the chain allows every touch and everything it builds on counts (C2 to C4), so a chain allows no more
than any share of it (C1). A write that doesn't count stays in the log and shows on no line, nor does anything built on
it: an app patched to skip the check writes nothing anyone reads. Everyone gets the Public group alone, which only reads
(T8).

Every reader also judges each write by the schemas its entry was written under once the write is in, which must be in
the vault's lane or built in and all of one kind: each place it changed holds a value one of them takes there, each
row it added or changed reads under one of them, the record's own fields too where it changed them, and it makes no
copy of a row. A write is judged by what it changed alone (S1), so a record that fits stays so (S2); one that doesn't
fit counts for no reader, nor anything built on it (S3), so every device keeps the last record that fit, whatever a
patched app writes; and relays, which open no write, judge none (S4).

Every edit is named by a SHA-3 hash, and every signature on it but a write's has a hash-based half (SLH-DSA) beside the
classical one, so governance, shares and keys hold even once the curves fall. A write carries only the classical
half, to stay fast and small; its device vouches for it in a checkpoint, which carries both. A peer that no longer
trusts the curves counts only the writes that a checkpoint by their own author covers (T18), so whoever breaks a
device's ed25519 key writes nothing such a peer counts. The model leaves signatures abstract: an edit's signers are its
author and cosigners, and T18 is stated over which edits a peer counts.

Documents and todos are projected on read, never migrated by an edit: two devices migrating at once could each drop
the other's new containers, and a default that a migration writes races a real edit. Each field stays in the
representation of the schema it was written under, v1's or v2's, or after concurrent edits both, where v2's wins; each
app reads the item through the lens into its own schema, so defaults live in the lens. An app's edit goes back through
its view and writes only what changed (T9f, T9g), so no default is ever written, and an older app's edit keeps what it
can't see (T9h). The model covers edits in place; inserting, deleting and moving blocks are tested in Rust.

A vault's schemas and lenses are entries of the built-in types schema and lens, each holding a blob named by its hash
that holds no data. Every vault shares them with everyone, through a read share of its own whose selector picks those
two types, made just before its first schema or lens entry, so that whoever reads anything of the vault can read the
schemas it was written under. Its schema lane is what their readers read off them: the blob of each such entry of the
vault that the vault created itself, through the owners its creation names, and that its readers count, in the order
they were created. One that anyone else created through a share adds nothing, nor does a later write to such an entry or
its tags, and no peer checks the lane (T17). What everyone may read goes only to a device with an interest in its vault,
one that acts for it or for a vault holding a live share over it, or that names the vault in the follow list of its
request: following brings nothing that isn't public, and a device that acts for no vault and follows none is sent
nothing (T12).

Every write is an edit on one line of its entry's history: the main line, or a proposal, which a write starts from any
version (its `deps`) and names, encrypted. A write on a proposal builds on the write that started it or on another write
on it, so a revocation that cuts a proposal's start cuts the whole proposal, and the rules check every proposal write's
shares as they check any write's. A line's history is its own writes and everything they build on, and a device shows on
a line Loro's content of that history. A merge is a write on the target that builds on the heads of both lines, so its
history is the union of both (T10g) and it shows `Doc.lean`'s merge, for which T10a to T10c hold; a promote's write also
carries the change that brings the merged document to exactly the proposal's content (T10h, from T10d and T10e). A write
on one line changes no other line (T10f). In Rust, an older edit is undone by a three-way merge of records, and versions
open read-only on scratch items made from their writes; Loro's own revert and checkout are not used.

Every edit belongs to one log: a vault's (its governance, its devices, its seed's keys), a share's (the share, its
revocation, its keys), an audience's (its keys) or an entry's (its writes, marks and checkpoints, and its keys; a schema
or a lens is an entry too). An edit names as its parents the frontier of its own log as its device held it, so each log
is a small history of its own, and its depth stays one clock across logs, one more than the deepest edit its device
held, so a removal still sorts after everything its device had seen. A device counts in a log's frontier only its closed
part, the edits whose whole past it holds: an edit whose parent hasn't arrived waits outside it, with whatever builds on
it. When it asks a peer, a device names of each log its frontier, the edits 1, 2, 4, 8, … steps back from it and the
oldest, lists its loose edits (those outside every closed part) and names the vaults it follows; the peer sends what it
would send whole (`respond`), less those loose edits and whatever lies at or below an edit the device named
(`respondSince`). A peer that is behind holds the frontier and sends exactly what the device lacks; one that lacks the
device's newest edits still finds one it holds a few steps back, so it sends back little the device holds; and nothing
the device lacks is ever withheld (T19). Two copies of a log with the same frontier hold the same closed part, so
devices tell each other, of each log, its frontier and the edits waiting outside it, and ask only where one differs. A
device signs its edits in a log one after another, so two of its edits in one log where neither builds on the other mean
its key signed twice from the same past: a device restored from an old backup, a clone, or a stolen key. Every peer
flags such forks among the edits it holds (passkeys, which sign on several devices, aside); both edits stand, as any
concurrent edits do.

What a device tells a peer of each log is part of its holdings (phase H): what it holds for good, on its shelf (on the
server, in its bucket), of each log the peer may know by its view and each file the peer may fetch, all of it on a new
connection and then what changed. A node keeps what it hears as the holdings of the device whose hello proved the
connection it came on, so no device speaks for another, and it tells others its own holdings alone (H1). Holdings route:
a node asks a peer for the logs where the peer holds what it lacks, fetches a file first from those that hold it, and
lists as "Synced to" the devices that may hold an entry by its view and stated a frontier covering the entry's log as it
holds it. They never authorize: the blob gate hands a file out by T27 alone, to the device a sync connection still open
proves, and a node names to a device only files that device may fetch (T27).

## Protocol models

The theorems take signatures and encryption as given. What devices say to each other on the network is modeled apart,
in [Verifpal](https://verifpal.com) (`protocol/`), against an active attacker who also breaks the curves from the
start: X25519, ed25519 and the passkey's P-256 give up their private keys (`PUBKEY[weak]`, or are left out where a
curve only signs, as its signatures then prove nothing), and only ML-KEM-768, Classic McEliece and SLH-DSA hold, the
schemes chosen because they would. Each model states the result it expects in its header, one letter and digit per
query, 0 where the query holds and 1 where Verifpal finds an attack; each also holds a value that a weaker design
would give away, so that it shows the attack it rules out. `protocol/check.sh` runs them all and fails on any other
result.

| Model | What it shows | Result |
|---|---|---|
| `seal.vp` | A key sealed to X-Wing and Classic McEliece at once stays secret when either scheme falls, and leaks only when both do (`keys::seal`) | c0c0c1 |
| `hello.vp` | With the curves broken an attacker can stand in the middle of iroh's TLS: what a node served on TLS alone would leak, while what it serves once the other device's hello checks stays secret, and each hello a device takes is the other's own, said on this connection for its own end (`sign::Hello`, avendb-net's sessions) | c0c1a0a0 |
| `link.vp` | Linking a new device: the link card goes only to the passkey's own pass for the device whose hello proved it on the connection, where a card handed to any device that said its hello would leak; nobody forges the pass, but it is the device's for its minutes rather than for one connection, as at the relay, so the device may show it twice (a1, a replay with nothing forged: c0c1a0a0 at one session); the join a peer takes is the new device's own, on the connection, signed by the same unlock as its pass (`sign::RelayPass`, `sign::Classical::Pass`, `Node::link_by_pass`, `Lab::accept_join`) | c0c1a1a0 |

Verifpal's analysis is bounded, two sessions of each principal, so a query that holds means no attack within that
bound. The models are Verifpal's rather than ProVerif's: ProVerif has no package for this machine, and Verifpal 1.6.5
builds from crates.io (`cargo install verifpal --version 1.6.5`, with Rust 1.98 or later).

## Assumptions

None are axioms; each is part of the model:

- Signatures can't be forged: an edit's signers are the keys that signed it. Where the curves fall, the Rust core keeps
  this true for every edit but a write (each carries a hash-based half), and T18 for writes.
- Sealed or encrypted data reveals nothing without its key: a key is learned only through `Knows`.
- Ids don't collide: a `Nodup` hypothesis where a theorem needs it.
- Loro converges, and can revert a document to any version it contains: fields of the `Loro` structure.

What the proofs don't cover: the Rust and Loro code itself (the tests and the shared Lean ⇄ Rust test vectors do, for
the vault rules from P1, for the lenses from P4, and for sync from P6), timing and traffic analysis, and a device
compromised while it still holds its keys.

## Phases

Each phase is one PR, merged only when its Rust tests pass and its theorems are proven without `sorry`. Until then
its tests are ignored with the phase as the reason, so `cargo test -p avendb --no-fail-fast -- --ignored` lists
what is still red.

| Phase | Builds | Proves |
|---|---|---|
| P0 | This spec, the `avendb` API as stubs, every test | Statements compile, scenarios check |
| P1 | Vaults, vault logs, chains; edit ids and signatures (device keys, passkeys through the WebAuthn envelope); vectors for the vault rules | T2, T3 |
| P2 | Spaces (since replaced by flat vaults), grants, revocation with strong removal, the passkey as root, Public, write checks with causal closure, what each device may receive | T1, T4, T8, T14, T16 |
| P3 | Keys, sealing, encryption of every edit, rotation | T5, T6, T7 |
| P4 | Schemas and lenses projected on read, edits through each app's view, the schema lane | T9, T17 |
| P4b | Post-quantum: SHA-3 ids and hashes, SLH-DSA beside every classical signature but a write's, device keys derived from the passkey, X-Wing plus Classic McEliece in every sealed key box, checkpoints and the post-quantum-only replay | T18 |
| P5 | History and proposals: every write on a line of its entry's history, proposals from any version, merge, promote, restore and undo, variants | T10 for writes (T10f to T10h) |
| P6 | Logs and frontiers: every edit building on its own log's frontier, devices asking with what they hold of each log, one digest per log to gossip, forks flagged; offline devices, random delivery orders and partial delivery; Lean ⇄ Rust vectors for sync; a device writing under the newest key it knows | T11, T12, T13, T15, T19 |
| P7 | The avenDB tile | |
| P8 | Sync on its own iroh ALPN with X25519MLKEM768 on every connection and the bytes in iroh-blobs; linking a new device by its passkey, through a device's QR code or the server (P8c); the protocol models; a device in the browser, let onto the relay by its passkey's pass, and big answers a page at a time (P8d); the browser's own passkey signing in ceremonies over each edit, a new person's first browser founding their vault, and the store in IndexedDB (P8e); three kinds of vault, every act for a coop or an aven vault naming its chain, and the server a device of avenCEO, claimed by the first human vault founded through it, in the ceremony that founds it (P8f) | T20, T21 |
| F | Flat vaults: no spaces; caps on any slice of a vault (types, tags, entries, authors, creation times) resting on caps; cells, stewards that move entries to the cells their caps pick and answer tag asks, creation through a cap's intake cell; seeds, cap keys, cell keys and entry keys derived per stay, a cell coming back into use moving on; sync by cells | T22, T23, T24, T25, and T1, T4 to T8, T12, T13, T15 to T17 again |
| O | Ops: one JSON language to read and change any record, the same engine on every device, the page and the studio on it | O1, O2, O3 |
| C | Caps that name ops: rules in a write cap's sealed slice with a commitment in the clear, proof-carrying writes, every reader counting only what the rules allow; `may` for the page; rules in the share dialog | C1, C2, C3, C4, and T25 again |
| S | Writes that fit their schemas: every reader judging each write by its entry's schemas, devices refusing what doesn't fit, the page saying why a write doesn't count | S1, S2, S3, S4 |
| B | Blobs ([BLOBS.md](../docs/BLOBS.md)): sealed files of any size, writes that name the files they bring, one iroh-blobs store per node, sync rules by the cap selector for any data (since replaced by keep shares), marked by the stewards | T27, T28, T29 (since merged into T23), and T13, T25 again |
| H | Holdings (v8): each device tells each peer, on its own connection, what it holds for good of each log and file the peer may know; asks for the logs that differ alone; Synced to; one pool of blob connections, let in only while a sync connection proves the device | H1, and T27 extended |

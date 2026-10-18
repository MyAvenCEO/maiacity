# avenDB spec

The formal specification of avenDB, the user-owned, end-to-end encrypted database behind the avenDB page, in Lean 4
(core library only, no Mathlib). It states what must always hold: who may write, who can open which key, what each
device receives. The Rust crate `avendb/crates/avendb` is built against it test-first, and its tests carry the same
names. The design it models is [ARCHITECTURE.md](../docs/ARCHITECTURE.md); the plan with the scenarios and the build
order is the Claude Doc "avenDB: E2E reference plan" (linked from `avendb/README.md`).

## Build

```sh
cd avendb/spec
lake build
```

It needs [elan](https://github.com/leanprover/elan); `lean-toolchain` pins the Lean version, the one place it is named,
and elan fetches it on any machine. A build takes about a minute. It
fails when a proof breaks, when a scenario check in `Examples.lean` (`#guard`) doesn't hold, or when a file in
`vectors/` no longer holds what the model answers. No proof uses `sorry`: a phase merges only once its theorems are
proven ([Phases](#phases)).

After a change to the rules, write the test vectors again and commit them with the change:

```sh
lake exe vectors
```

## Files

| File | What it holds |
|---|---|
| `Basic.lean` | Ids, principals (signers and vaults), levels relay < backup < read < write < owner (a level's rank is its byte on the wire), the four kinds of vault (human, coop, aven, device vault) and the kind table, defined once (`Kind.rules`: who may own a vault of each kind, how many owners it has at most, whether it holds devices, how many of it one owner may own), whom a share names (`Who`: a vault, everyone or a device), selectors and what they test (type, author, entry, creation time, tags), what an entry's first write says of it (`Header`: its type, when it was created and the content it starts with), audiences, key families and key names |
| `State.lean` | What a peer knows: the vaults, each of a kind, and their owners; acting for a vault through the chain of owners an edit names (`actsVia`), approving for it (its root, or its threshold of owners); shares and the chains they rest on; entries, their stays and audiences; the operational rules a relay can check (who may write, create, revoke) and the semantic layer only readers and stewards know (an entry's attributes, whether its creation was let in, its semantic audience, `desired`); keep shares, which entries each device wants (`wants`, `keeps`) and the keep shares whose selectors pick each entry (`semWants`); the one mark a steward makes of an entry, of its audience, its wants or both (`desiredMark`); which writes an entry's readers count, by the ops of the chain a write's proof names and whether it fits its entry's schemas (`lets`, `counts`, `creates`, `counted`), and a merge into main through a share only on top of the vault's accept, a write of the vault on the proposal that changes nothing, which its readers alone read (`isAccept`, `accepted`, `accepts`; M2); a line's history (`reach`, `history`), drafts, new entries whose creation starts a line of their own, and whether one has landed, its creation in its main line's counted history (`isDraft`, `landed`), before which only the vault's own writes on main count and no share to everyone is in its semantic audience (D1 to D3); each vault's schema lane, read off its schema and lens entries created on main (`laneOf`); symbolic keys (`Knows`), rotation, sealing and entry keys |
| `Step.lean` | Every edit and the rules that accept or refuse it: a vault's genesis and its settings (threshold, root); shares (a grant, a keep share, an owner, a device) and their revocations, an owner grant never of the whole vault (WideOwner); writes that create entries in audiences (a vault's schemas and lenses among them), marks (an entry's audience, the keep shares that want it, or both), keys, writes on a proposal (which build on its start); the one order every peer replays in; strong removal: what a removal or a mark of an audience cuts, and which removals stand when they clash (`view`) |
| `Sync.lean` | What a peer sends a device: sync by audiences, entry by entry (each entry's writes, marks and keys), of the entries it may receive and its keep shares want (`syncs`), what everyone may read only for a device with an interest in its vault or that follows it (`interested`, `follow`), with the shares and vaults needed to check them; the files a peer may hand a device, those the writes it sends bring (`mayFetch`); and what it hands a new device whose passkey proved itself on their connection, the logs of the vaults the passkey owns (`linkCard`) |
| `Logs.lean` | Every edit in one log, a vault's, a share's, an audience's or an entry's, building on that log's frontier; each log's closed part (the edits whose whole past is held) and frontier; what a device names of each log when it asks (its frontier, the edits 1, 2, 4, 8, … steps back and the oldest), the vaults it follows and its loose edits; what a peer sends beyond them (`respondSince`); forks; and holdings (phase H): what a device states it holds of each log and file (`Frontier`, `FileHold`, `Holdings`), the announcements that tell it (`Announce`), sync connections and the device each one's hello proved (`Conn`), a node's shelf and what it tells each device, what it keeps of each device (`Node.record`), Synced to, one list for entries and files (`Synced`, `Node.syncedTo`) and its blob gate (`Node.hands`); and signed holdings (H2): what a device signs that it holds, with when it checked (`Statement`, `Node.states`), the newest a node keeps of each device (`Node.statement`), those it passes each peer (`Node.passes`) and Synced to with when each device checked (`Node.syncedToAt`) |
| `Doc.lean` | Documents as histories, against the laws we rely on from Loro: merge of histories, and the three-way merge of records place by place (`mergeInto`), with its conflicts |
| `Proposals.lean` | Proposals write by write: each write extends one line of its entry's history, the main line or a proposal; a line's heads (its history is in `State.lean`, where a draft's landing reads it); the order writes come in (`Ordered`); T10f to T10h, which tie `Doc.lean`'s merge to the writes; and version numbers: a write's past (`past`), a line's releases, its start and each write on it that brings in writes the line's history held nowhere in its own past, a merge (`brings`, `isRelease`, `releases`, `release`), each numbered one more than the highest of the line's releases in its past, in one pass over the writes in order as the Rust counts (`numbering`, `number`), a version by its releases, as `git describe` names a commit (`describe`), and T10i to T10k |
| `Lens.lean` | The markdown document and the todo in two schema versions and the lenses between them; items as stored, projected on read into each app's schema, and edits through each app's view; the lens laws (T9) |
| `Ops.lean` | One language to read and change any record ([ARCHITECTURE.md](../docs/ARCHITECTURE.md) §8): records inside records at any depth, flat as a value at each place and the rows of each list of records by id, a place named by the chain of rows around it (`Path`, `Loc`); changes, `apply` and `diff`; the ops apps send, each naming a place; queries whose `where` mixes a share's labels with tests of values at any depth, and the selector a device picks entries by (O1 to O3, proved by induction on the path); how deep a place, a change and a record go (`Path.depth`, `Change.depth`, `Doc.depth`) |
| `Links.lean` | Records that point at records ([ARCHITECTURE.md](../docs/ARCHITECTURE.md) §8): a link to an entry of a vault, maybe a row of it, at its newest or pinned at a version; a record read so many rows down (`Doc.cut`); what a reader opens of a link, or why it opens none (`Opens`, `Why`); a query following links a level at a time (`follow`); L1 to L3 |
| `OpsVectors.lean` | The ops cases for the Rust engine, in the very JSON the page sends: diffs, runs of ops at depths 1 to 5, queries with the selectors they pick by, and links followed through a small graph with a cycle, a hidden entry and a misfiled one (`lake exe vectors` writes them to `vectors/ops.json`) |
| `Rules.lean` | Shares as named groups of ops: the ops (relay, backup, read, create on the lines it names, main or drafts, the ops that write with paths and `*`, the values a set may take, the lines they hold on and the tags they may ask for, share), a share's level as the class of its strongest op (`levelOf`), the built-in groups (`groups`), an access request's `answering` group (read, set `answer` to granted or denied, and `part`, alone), a write's touches (what its Loro ops did, place by place, each place the line a merge brings in changed, and the tags it asks for) and what ops allow, a merge op by its line and path (`merged_within`); the half of C3 about a write's changes (`changes_allowed`) |
| `RuleLemmas.lean` | The proofs of C1 to C4, M1, M2 and D1 to D3: chains narrow, readers agree whether a write counts, counted writes did what their chain allows, allowed writes count and what builds on an uncounted one never does; a counted merge brings in only what its merge ops' paths reach, and one into main through a share builds on the vault's accept, while the vault's own count as before; only the vault lands a draft, a draft counts exactly where its chain lets a creation on a proposal through, and an unlanded draft is in no public audience |
| `Schemas.lean` | Writes that fit their schemas: what the schemas a write is judged under let a record hold, place by place, row by row and in its own fields (`Fit`), each change judged on the innermost row around it (`Path.scope`); a write judged by its diff (`Fit.fits`); S1 and S2, a write judged by what it changed and records that fit staying so; the ceiling, schemas capped at `n` rows deep (`Fit.capped`) and what they let no write do |
| `Props.lean` | The predicates and views the theorems are stated with, apart from their proofs |
| `Theorems.lean` | T1 to T8, T11 to T17, T19 to T28 (with `T21_owners_count`, `T21_aven_owner`, `T21_one_aven`, `T22_sub_cap_level` and `T22_wide_shares`; T29 is merged into T23; T27 extended to holdings), C1 to C4, M1, M2, D1 to D3, S1 to S4, K1, H1 and H2; and `writes_ordered`, the order every peer's writes come in, which T10f to T10h rest on, and `counted_ordered`, the same for the writes it counts, which T10i to T10k rest on |
| `Lemmas.lean` | The helper lemmas for vaults and writes: how a step changes a vault, ownership links and chains, owners by the kind table (how many a vault has, one aven to a person), what a step keeps that authorization reads, causal closure, the schema lane read off the entries (T17) |
| `CapLemmas.lean` | The helper lemmas for shares, audiences, keep shares and removals: well-formed share chains, each share resting on a live one held by its issuer, no higher and no wider, and no owner share wide (T22); one lemma, `mark_means`, that a list of marks means what the selectors say, from which both parts of T23 follow, an entry's audience meaning what the shares say and its wants what the keep shares say; the replay and strong removal (T16), a keep share's revocation cutting nothing (K1), the epochs along a replay (T15) |
| `RelayLemmas.lean` | The proof of T25: every rule reads only the operational part of a state, so a relay that opens no selector, type or tag has every edit stand or fall as an owner does |
| `KeyLemmas.lean` | The helper lemmas for the keys: what settling seals, publishes and links, `opens` finding every key `Knows` gives, the invariants behind T5, T6 and T24, `EverReads` |
| `SyncLemmas.lean` | The helper lemmas for sync: the replay order is a total order on ids (T11), what a peer sends a device, what everyone may read only for a device with an interest in its vault or that follows it (T12), and that it follows the device's keep shares (T28), a log's closed part lying at or below its frontier, and every edit a device names of a log being one it holds with its whole past (T19); for holdings (H1, T27), what a node keeps of a device came on that device's own connection, a peer's answer is whole logs so the files of the logs a device may know of are files it may fetch, and a frontier that covers a log as a node holds it, stated of a shelf, means the shelf holds every edit of it the node holds; for signed holdings (H2), the statement a node keeps of a device is the newest that device signed, one it didn't sign changes nothing, what it passes on a peer may know all of, and a device it lists with a time is listed by that statement |
| `Examples.lean` | The plan's scenarios run on the model, and the flat vaults' own: sharing every entry of a type, by a tag or one entry, a tag moving an entry out of a slice, creating through a share, shares resting on shares, wide shares and everyone, a revocation that moves no entry, an audience that comes back into use, proposals and their version numbers (each merge the next release, two merges made apart sharing v3 and the next merge v4, the same numbers in another order of the same writes), drafts (a new entry a Suggester proposes on a line of its own, kept out of main and of everyone's audience until the vault's merge lands it, as main's v1), schema v1 and the lens from v0 in schema and lens entries shared with everyone and what goes to whom of them, one todo shared with several vaults and synced peer to peer, strong removal, and holdings: kept from each device's own connection, a forged one from a third party ignored, Synced to listing exactly the devices that may hold an entry and said they do, the bucket first, a peer ahead, changes alone, and no file past T27 whatever anyone claims; and signed holdings: the newest statement a device signed kept whatever order they came in, one signed in its name by another ignored, passed only to who may know it, and Synced to listing a device on no live connection by its statement with when it checked, on a live one by what it announced; and scenario 28, an access request: a record its vault shares with the vault asked in the `answering` group, which that vault's devices read and answer, granted or denied, with the part of an owner add it grants, alone, and no one else reads |
| `Vectors.lean` | Cases for the Rust core: edits applied in order (which the model accepts) and edits at the depths they claim (which stand in the view, or in the post-quantum view), with the state at the end, as its readers see it too (each entry's semantic audience, and whether it has landed), each line of each entry's history and its heads among it, a draft's own line among them; sync cases: edits with their parents, each log's closed part and frontier, the forks, and for each device that asks a peer, following some vaults, what it names of each log, its loose edits, what it is sent and the files it may fetch; and lens cases: what each app reads from stored blocks and todos, and what its edits store |
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
| T2 | Governance (settings, and sharing or revoking an owner or a device) needs the vault's approval (its root, or its threshold of owners) plus the newcomer's consent, unless an owner or a device leaves on its own; devices, a human vault's or a device vault's (its servers, an agent's harness), can't govern | Proven | `add_owner_needs_threshold_and_consent`, `device_cannot_govern`, `a_device_vaults_devices_act_for_it_but_never_govern_it`, `the_passkey_is_the_root`, `t2_consent`, the vectors |
| T3 | No ownership cycles in any state the edits can reach | Proven | `ownership_cycle_rejected`, `t3_no_cycles`, the vectors |
| T4 | Shares name a vault or everyone; a share names a device only as a keep share, of a device of its issuer, and a keep share names nothing else (KeepNeedsDevice, DeviceOnlyKeeps, NotDevice) | Proven | `share_to_device_rejected`, `t4_shares_name_vaults_and_t8_everyone_only_reads`, the vectors |
| T5 | A holder (a signer, whoever holds a vault's seed, or everyone) opens a key of a family, of any epoch, only if over the history it could read the family: itself, while it was public, or through a vault whose seed it held at some point (whoever joins a vault inherits what the vault could read) | Proven | `t5_confidentiality`, `entry_reader_cannot_open_other_entries`, `every_device_opens_exactly_what_it_may` |
| T6 | Forward secrecy on removal: in every state the edits can reach, the current key of a family in use opens only for holders entitled to it now, or while it is public | Proven | `t6_forward_secrecy`, `revoked_reader_cannot_open_new_edits`, `every_device_opens_exactly_what_it_may`, the vectors |
| T7 | Blind server: a device whose vaults read nothing of another vault, such as the server acting for its device vault with the backup shares it holds, opens no key of a vault whose seed it never held, unless that key was public | Proven from T5 | `server_holds_only_ciphertext`, `every_device_opens_exactly_what_it_may` |
| T8 | Everyone only reads | Proven | `everyone_only_reads`, `t4_shares_name_vaults_and_t8_everyone_only_reads`, the vectors |
| T9 | Lens laws: round trips, both apps see the same item, an edit shows exactly as made, an unchanged view writes nothing, and an older app's edit keeps what it can't see | Proven | `lens_round_trip_v0`, `edits_through_a_view_keep_what_it_cant_see`, `t9_put_get`, `t9_put_get_todos`, `the_lens_vectors`, `scenario_09_schema_v0` |
| T10 | Merge is the union of histories and shows the three-way merge of both lines from their base: nothing the target changed is lost, all the other changed alone lands, the person picks at conflicts alone; a write on one line leaves every other line as it was. A line's version numbers are judged on the past alone: a release (the line's start, or a write on it that brings in writes, a merge) is numbered one more than the highest of its line's releases in its past (T10i, `T10_release_above`, `T10_release_number`); a write's number depends on its past alone, so the same writes in every replay order number it alike and it never changes as more writes come (T10j, `T10_number_of_past`, `T10_numbers_every_order`, `T10_number_stays`, `T10_releases_stay`); and a release reads as itself, its number with no edits after it (T10k, `T10_release_describes`) | Proven | `a_merge_keeps_main_s_edits_and_takes_the_proposal_s_only_where_asked`, `merge_is_the_union_of_both_lines`, `t10_proposals`, `scenario_08_proposals`, the `merge` unit tests, the vectors; version numbers: `each_merge_into_a_line_is_its_next_release`, `merges_made_apart_share_a_number_and_the_next_counts_past_both`, `a_draft_is_v1_once_its_vault_lands_it`, `versions_are_the_same_in_every_replay_order` |
| T11 | Same edits in any order, same state | Proven | `same_edits_any_order_same_result`, `t11_convergence`, `t11_vault_logs_converge`, `every_order_of_delivery_ends_the_same`, `scenario_13_offline_conflicts` |
| T12 | A peer sends a device only the logs of entries, audiences and shares it may receive by the peer's view, and vault logs, whatever the device names when it asks. What everyone may read goes only to a device with an interest in its vault (it acts for the vault, or for a vault holding a live share over it) or that names the vault in its request's follow list, and following brings nothing that isn't public (`T12_interest`); a device that acts for no vault and follows none is sent nothing (`T12_stranger_gets_nothing`) | Proven | `sync_sends_only_what_shares_reach`, `t12_sync_sends_only_what_shares_reach`, `t12_what_everyone_reads_goes_only_to_whoever_has_an_interest`, `t12_a_stranger_gets_nothing`, `everyone_only_reads`, `t19_frontier_sync_loses_nothing`, `scenario_07_public`, the sync vectors |
| T13 | Two devices that each asked the other once, whatever vaults each follows, hold the same edits of every entry each syncs by the other's view (may receive, by its interests and the vaults it follows, and wants, T28) | Proven | `entry_syncs_peer_to_peer_without_server`, `t13_sync_converges`, `scenario_17_peer_to_peer` |
| T14 | Accepted writes are causally closed: a write stands only with every write it builds on, and every write is of an entry that exists | Proven | `t14_causally_closed`, the vectors |
| T15 | Rotation follows revocation: a device writes an entry under the key of its stay at its audience's current epoch in what it knows, which opens only for holders that what it knows entitles to the audience, and under no older epoch than any along its history, so once it has seen a removal the removed can't open what it writes | Proven from T24 | `a_device_writes_under_the_newest_key_it_knows`, `revoked_reader_cannot_open_new_edits`, `scenario_10_revoke_carol`, `notes_shared_by_id_reach_their_readers_after_many_epochs` |
| T16 | Strong removal: an edit stands only if it also stands without what each later removal that hadn't seen it takes away, a mark's being the audience it took the entry out of (a mark of the wants alone takes nothing), and every removal chosen stands | Proven | `a_removed_owner_cannot_backdate_governance`, `handing_the_root_on_cuts_the_old_passkeys_backdated_edits`, `t16_strong_removal`, `t16_resolved_removals_stand`, `scenario_21_a_tag_moves_an_entry_out_of_a_slice`, the view vectors |
| T17 | A vault's schema lane is read off its own schema and lens entries: a step adds a blob to it only by creating an entry of the vault of type schema or lens that holds the blob, on the main line, acting for the vault itself through the owners it names, which its readers count; one created by anyone else through a share, a draft, landed or not, and any other edit, add nothing (`T17_lane_from_creations`), and a write to an existing entry leaves every lane as it was (`T17_writes_ignored`) | Proven | `the_lane_holds_only_what_the_vault_itself_creates`, `a_write_counts_once_the_lane_holds_its_schema`, `scenario_09_schema_v0`, the vectors |
| T18 | Retired with the checkpoints: every edit, a write too, now carries an SLH-DSA signature, so no edit counts on the curves alone | | `a_broken_curve_signs_nothing`, `the_slh_dsa_signature_must_verify` |
| T19 | Frontier sync loses nothing: a device that asks with its frontier of each log, a few edits further back and its loose edits is sent every edit of the peer's answer it lacks; and two copies of a log with the same frontier hold the same closed part, so one digest per log tells whether to ask | Proven | `t19_frontier_sync_loses_nothing`, `t19_partial_delivery`, `t19_one_digest_per_log`, `a_second_sync_sends_nothing`, `an_edit_sends_only_what_is_new_both_ways`, the sync vectors |
| T20 | Linking hands out vault logs alone: what a peer hands a device whose passkey's pass names it on their connection is the log of each vault the passkey owns, or that owns such a vault up the chains, and nothing of a share, an audience or an entry; a passkey that owns no vault there gets nothing | Proven | `a_link_card_holds_the_logs_of_the_passkeys_vaults_and_nothing_else`, `a_node_hands_its_card_for_a_pass_for_the_device_on_that_very_connection_alone`, the link vectors |
| T21 | Vaults keep to their kind, by one table (`Kind.rules`, `T21_vault_kinds`): signers own human vaults only; coops are owned by human and coop vaults; an aven, a person's one AI identity, by exactly one human vault (`T21_aven_owner`), and a person owns one aven at most (`T21_one_aven`); a device vault by exactly one human, coop or aven vault, so it owns nothing; no vault has more owners than its kind takes (`T21_owners_count`); only human and device vaults hold devices; only a human vault has a root. So every act for a coop or an aven goes through a human vault its device or passkey belongs to, and so does every act for a device vault that none of its own devices signs | Proven | `every_vault_keeps_to_its_kind`, `t21_vault_kinds`, `an_aven_has_one_human_owner_and_owns_its_agents_device_vaults`, `the_kind_table_is_the_models`, `an_act_for_a_coop_names_the_vault_it_goes_through`, `a_removed_owners_unseen_writes_for_the_coop_are_cut`, the vectors |
| T22 | A share grants no more than the shares it rests on: a share that rests on another, a sub cap, is over the same vault, rests on a live share held by its own issuer, other than a keep share, at a level no higher than that one's (`T22_sub_cap_level`), and selects nothing its parent doesn't; a wide share rests only on a wide share. One rule says when a share may rest on another (`shareParentOk`): that one is an owner share, whose `share` op lets its holder share on with anyone, or the new share goes to a vault its issuer owns, so a human passes a coop's share on to their aven, and an aven to its agents' device vaults. No owner share is wide, since owner of a whole vault is an owner of it, which no share makes (WideOwner), and a wide share that rests on none, unless it is a keep share, which grants nothing, was issued by the vault it is over (`T22_wide_shares`) | Proven | `t22_shares_narrow_down_their_chain`, `scenario_24_a_share_resting_on_a_share`, `scenario_27_an_agent_writes_what_its_avens_share_allows_until_the_coop_revokes_it`, `an_aven_passes_a_coops_share_on_to_its_agent_until_the_coop_revokes_it`, the vectors |
| T23 | Marks mean what the shares say: where an entry's marks, what isn't live left aside, are what its stewards mark it with, the rules every peer checks without reading a selector, a type or a tag mean what the selectors say. Its audience: the write rule allows exactly the vaults the shares' selectors allow, and never refuses a creation inside its creator's slice, on main or as a draft; a draft's semantic audience leaves out every share to everyone until it lands, and such a share holds no write. Its wants: a device wants the entry, and keeps its files whole, exactly as its keep shares over the entry's vault say (`wantsWith`, `keepsWith`), each picking it where it is wide or its selector picks it, a whole or opened one every schema and lens entry too and a never one none (`keepPicks`). Both parts follow from one lemma, `mark_means`, so a peer that reads no selector applies every share and every keep share from the marks | Proven | `t23_audiences_mean_what_shares_say`, `t25_blind_relays`, `scenario_19_share_every_entry_of_a_type`, `scenario_23_creating_through_a_share`, the vectors |
| T24 | An entry's key reaches only its audience's readers: whoever opens the key of an entry in its current stay, at its audience's current epoch, may open that audience's current key; and over the history a holder opens a key of an entry only if it could read some audience the entry was in | Proven | `t24_entry_keys_reach_only_audience_readers`, `scenario_21_a_tag_moves_an_entry_out_of_a_slice`, `scenario_26_an_audience_that_comes_back_into_use_moves_on` |
| T25 | Blind relays: a peer that reads no selector, no type and no tag, such as the server, holding the same edits as an owner, has every edit stand or fall alike and knows the same of the vaults, shares, audiences, writes and keys. It knows no schema lane, which only readers read off the entries, and nothing it checks needs one | Proven | `t25_blind_relays`, `scenario_25_wide_shares_relays_and_public` |
| T26 | Relay alone: a device acting for no vault of an audience, with nothing but relay shares over that vault, receives none of the audience's edits, whatever it follows (`T26_relay_keeps_nothing`); relay lets the server know a vault's devices and keeps nothing, backup keeps the ciphertext | Proven | `a_relay_share_keeps_nothing` |
| T27 | Files follow their edits: a peer hands a device a file only if it holds a write that brings it, of an entry the device may receive by the peer's view; only writes bring files ([ARCHITECTURE.md](../docs/ARCHITECTURE.md) §13). Holdings never authorize (phase H): a node's blob gate hands a file's root or one of its pieces only to the device whose hello proved a sync connection still open from the blob connection's endpoint, and only by T27 (`T27_holdings_never_authorize`), whatever anyone, the node included, says it holds (`T27_gate_reads_no_holdings`); and a node names a file it holds, in what it announces on a connection, only if the device that connection proved may fetch it by T27, naming it as no longer held only if it named it on that connection before (`T27_holdings_name_only_fetchable_files`) | Proven | `t27_files_follow_their_edits`, `a_write_and_a_body_name_their_files_one_way_only`, `holdings_never_let_a_peer_get_a_file_t27_refuses`, `a_follower_fetches_the_files_of_what_it_follows`, the sync vectors |
| T28 | Sync follows the keep shares: a peer sends a device an entry's edits only if the device may receive the entry and its keep shares want it (`T28_sync_follows_keeps`): the live keep shares naming it over the entry's vault, issued by a vault it is still a device of, or its copy setting (one wide keep share its vault issues over itself) where it has none over that vault (`keepsFor`); all of the vault if it has none but never ones, else what a whole or opened one picks (wide, or among the entry's wants) and no never one does; it keeps the entry's files whole only where a whole one picks it (`T28_keep_modes`); a keep share grants nothing ([ARCHITECTURE.md](../docs/ARCHITECTURE.md) §5) | Proven | `t28_sync_follows_keeps`, `t28_each_device_syncs_what_its_keep_shares_pick`, `keep_modes_choose_what_and_how_a_device_syncs`, `keep_shares_grant_nothing`, `the_iphone_keeps_the_proxies_its_keep_share_picks`, `a_devices_copy_setting_is_one_wide_keep_share_its_vault_issues_over_itself`, the vectors |
| T29 | Merged into T23, whose wants part it is: marks mean what the rules say | Merged | `t23_audiences_mean_what_shares_say`, its wants part |
| O1 | A diff explains any two records: applying the diff of `r` and `s` to `r` gives `s`, it names every change and only what changed (`apply_diff`, `diff_complete`, `diff_sound`) | Proven | `o1_a_diff_explains_any_two_records`, `each_diff_makes_the_models_changes` |
| O2 | Ops do what they say: the diff of a change within some places names only what those places cover (`diff_within`) | Proven | `o2_ops_change_only_what_they_name`, `each_run_ends_where_the_models_does` |
| O3 | Queries pick by labels: the selector a query's labels make picks every entry the query does, so a device picks by labels and tests values only in what it opens (`cover_sound`, `plan_sound`, `plan_run`) | Proven | `o3_a_plan_picks_no_less_than_its_query`, `each_query_picks_and_holds_as_the_models`, `a_query_picks_by_labels_then_tests_what_it_opens` |
| C1 | Chains narrow: a chain allows no write one of its shares forbids, and nothing through a share whose level isn't the class of its ops; a share's chain allows no more than the chain of the share it rests on (`chain_narrows`, `child_narrows`) | Proven | `c1_a_share_resting_on_an_owner_share_is_held_to_both`, `the_built_in_groups_are_the_models`, the vectors |
| C2 | Readers agree: whether a write or a creation, on main or as a draft, counts reads no selector, type or tag, and no ops but those of the chain its proof names, so every reader of the entry reaches the same verdict (`counts_seen`, `creates_seen`) | Proven | `a_share_lets_whom_it_names_make_only_what_its_ops_allow`, the vectors |
| C3 | Counted writes do what they may: a counted write by anyone but the entry's vault relies on the share its proof names, every share of whose chain allows every touch of it by an op that writes, and where its touches' places cover its diff, every change is at a place an op allows (`counted_allowed`, `counted_writes`, `changes_allowed`) | Proven | `c3_touches_cover_every_change`, `touches_name_the_field_the_row_and_the_value`, `a_share_that_only_suggests_writes_on_proposals_an_owner_merges`, `scenario_28_an_access_request_is_a_record_and_a_share`, `an_access_request_is_a_record_and_a_share_the_vault_asked_answers` |
| C4 | Allowed writes count: a write that builds on counted writes, whose proof names a share its actor holds reaching the entry and whose chain allows its touches, counts, and so does such a creation, on the line its chain lets it create on, a merge into main on top of the vault's accept (M2), and a write on main of an entry that has landed (D1); no write that builds on an uncounted one counts (`allowed_counts`, `allowed_creates`, `uncounted_closed`) | Proven | `a_share_lets_whom_it_names_make_only_what_its_ops_allow`, `the_vaults_her_vault_owns_are_real_and_each_acts_by_its_own_shares`, the vectors |
| M1 | Merges by path: each place a counted merge by anyone but the entry's vault brings a change to, every place the line it merges in changed since their base, is reached by the path of a merge op on the write's line, in every share of its chain; a merge op with no path reaches everything (`M1_merges_within`, `merged_within`) | Proven | `a_tuner_merges_new_defaults_and_nothing_else`, the vectors ("ops: a tuner merges new defaults of its params into main, and nothing else") |
| M2 | Merges by policy: a counted merge into main by anyone but the entry's vault builds on the vault's accept and on nothing but accepts and writes on main, so it brings in only what the vault accepted; the vault's own writes count by what they build on and whether they fit, as before (`M2_merges_accepted`, `M2_owner_counts`); the accepts are its readers' alone, as a relay sees no touch | Proven | `a_merge_into_main_through_a_share_counts_on_top_of_the_vaults_accept`, `each_kind_of_code_round_trips_propose_accept_merge_byte_for_byte`, `a_declined_or_revised_proposal_merges_nothing_until_the_vault_accepts`, the vectors ("merges by policy: one of the vault's owners accepts what anyone else merges into main") |
| D1 | Only the vault lands a draft: a draft is a creation that starts a line of its own (`Proposal.new`), so its entry's main line holds nothing; it has landed once its creation is in its main line's counted history (`landed`), and before then a counted write on its main line is the vault's own, so no share's merge, even on top of the vault's accept, nor its direct write on main, counts for any reader (`D1_drafts_land_by_their_vault`) | Proven | `a_merge_into_main_of_a_draft_by_anyone_but_its_vault_stays_uncounted`, `a_suggester_agent_drafts_a_new_logic_and_the_vaults_aip_review_lands_it`, `every_reader_reaches_the_same_landing_verdict_offline`, the vectors ("drafts: a suggester proposes a new entry on a line of its own, and only the vault lands it") |
| D2 | Drafts by share, C3 and C4 for them: a `create` op names the lines it creates on (none for either, kind 3; main or proposals, kind 13), and a Suggester creates drafts alone; a draft by anyone but its vault counts exactly when it fits and its proof names a share over the vault its creator holds with write or more, in whose intake audience it was made, every share of whose chain is the class of its ops and names `create` on no line or on proposals (`D2_draft_creations`); a step records a draft's creation as the start of its own line and counts it so (`D2_draft_step`); a creation on a line that already is, every peer refuses | Proven | `a_create_op_names_the_lines_it_creates_on`, `create_on_a_line_is_grant_kind_13_and_old_grants_keep_their_bytes`, `a_suggesters_create_on_main_is_refused_and_counts_for_no_reader`, `old_suggester_shares_still_name_suggester_and_draft_nothing`, the vectors |
| D3 | Drafts aren't public: in every reachable state, where an entry's audience is what its stewards mark it with, a draft that hasn't landed is in no audience a share to everyone reaches, unless a live wide share to everyone is over its vault, so everyone opens no key of it (`D3_drafts_not_public`); once the vault's merge lands it, the stewards mark it into its whole audience | Proven | `an_unlanded_draft_never_shows_on_main`, the vectors |
| S1 | A write is judged by what it changed: it fits its schemas exactly when each change of its diff does, on the record or row around it, so a value it didn't change holds it back nowhere else (`fits_iff`) | Proven | `s1_a_write_is_judged_by_what_it_changed`, `s2_a_record_that_fits_keeps_fitting` |
| S2 | Records that fit stay so: a record that fits keeps fitting through a write that fits, and an entry's first write, if it fits, makes a record that fits of nothing (`fits_clean`, `fits_new`). The ceiling (`S2_ceiling`): under schemas capped at `n` rows deep (`lens::CEILING`, 256 for every reader), a write that adds a row deeper fits nothing, whatever the schemas let a row hold (`capped_deep`), as each change of a write that fits reaches no deeper (`capped_change`, `capped_fits`), so no record that fits holds one (`capped_clean`) | Proven | `s2_a_record_that_fits_keeps_fitting`, `s1_every_edit_an_app_makes_fits`, `a_write_deeper_than_the_ceiling_counts_for_no_reader` |
| S3 | Writes that don't fit count for no reader: no write and no creation whose result doesn't fit its schemas counts, whatever its shares and ops, nor anything built on it (`S3_unfit_uncounted`, `S3_step`) | Proven | `s3_a_write_that_breaks_its_schema_counts_for_no_reader`, `a_write_counts_once_the_lane_holds_its_schema`, the vectors |
| S4 | Relays don't judge records: whether a write fits, which only its readers can tell, changes nothing but which writes they count (`S4_fit_unread`) | Proven | the vectors |
| L1 | A hop the reader opens nothing of shows nothing, and why: following a link whose entry the reader opens none of, at any depth left, shows it empty with the reason the reader gave (`follow_refused`) | Proven | `a_hop_the_reader_cant_open_comes_back_empty_with_its_reason`, `links_are_followed_a_level_at_a_time`, `each_link_followed_shows_what_the_models_does` |
| L2 | Links show only what the reader opened: every record a query shows through links is one its reader opened of that link, read some rows down, and every hop that shows nothing says why the reader opened nothing there, or that it lies too deep (`follow_opened`) | Proven | `a_hop_the_reader_cant_open_comes_back_empty_with_its_reason`, `each_link_followed_shows_what_the_models_does` |
| L3 | A query follows links no deeper than its depth: a chain of hops ends there, and a cycle of links too (`follow_height`) | Proven | `a_cycle_of_links_ends_at_the_depth_limit`, `links_are_followed_a_level_at_a_time`, `each_link_followed_shows_what_the_models_does` |
| K1 | A keep share's revocation cuts nothing: only its issuer revokes it, which only marks it revoked, and as a removal it takes nothing away from any edit (`K1_keep_revocation_cuts_nothing`, `K1_keep_revocation_hides_nothing`) | Proven | `k1_keep_revocations_cut_nothing`, `keep_shares_grant_nothing`, the vectors (revoking a keep share cuts nothing) |
| H1 | Holdings come only from their proving connection: a node keeps of a device a frontier of a log, or what it holds of a file, only as an announcement said it on a connection whose hello proved that device (`H1_heard_on_their_connection`), and nothing said on another device's connection changes it (`H1_third_party_ignored`); it announces its own holdings alone, the same whatever it heard (`H1_passes_nothing_on`), each frontier being what its shelf holds for good of a log the device on that connection may know (`H1_states_its_shelf`). So a device other than its own that a node lists in Synced to, one list for entries and files, may hold it by the node's view and stated itself, on a connection that proved it, what it holds of it: of an entry, a frontier of its log, covering every edit of it the node holds when listed with all of it; of a file, the whole file when listed so (`H1_synced_to`); if each of its announcements stated what a shelf of its own holds, a shelf listed with all of an entry holds every one of those edits (`H1_synced_to_held`), and a device listed with all of a file may fetch it (`H1_synced_to_file`) | Proven | `holdings_come_only_from_the_connection_that_proved_their_device`, `a_forged_holding_from_a_third_party_is_ignored` (a claim to a log the node holds beyond the claimant's reach steers no ask), `an_announcement_carries_changes_alone_and_an_ask_the_logs_that_differ` (avendb-net/tests/holdings.rs), `a_server_states_a_holding_only_once_its_bucket_has_it` (tests/bucket.rs), `a_devices_holdings_of_each_log_are_its_frontier_and_waiting_edits_as_sync_cuts_them` and `an_announcement_tells_all_on_a_new_connection_and_then_only_what_changed` (holdings.rs unit tests) |
| H2 | Signed holdings: a device signs what it tells each peer it holds, with when it checked; what a node keeps of a device is a statement that device signed about itself, of a device the node knows (`H2_signed_by_its_device`), the newest it heard (`H2_newest_wins`), and a statement the device didn't sign changes nothing, wherever it falls (`H2_unsigned_ignored`); the statement a node's device signs says what its shelf holds of each log and file the peer may know (`H2_states_its_shelf`); a node passes on another device's newest statement only to a peer that may know every log and fetch every file it states (`H2_passes_only_what_they_may_know`); and Synced to lists a device with a time only if no live connection proves it, by its newest statement, checked then (`H2_synced_to_checked`), with no time only as H1 says (`H2_synced_to_now`), and a device listed with all of an entry, if it states only its own shelf, holds every edit of it (`H2_synced_to_held`). The gate reads no statement (`T27_gate_reads_no_statements`) | Proven | `a_statement_outlives_its_devices_connection_and_the_nodes_restart`, `a_statement_counts_only_as_the_word_of_the_device_that_signed_it` (avendb-net/tests/statements.rs), `holdings_come_only_from_the_connection_that_proved_their_device` (holdings.rs), `a_statement_proves_its_device_and_reads_back_only_from_its_own_bytes` (wire.rs), the fuzzer |

The Rust scenario tests (`crates/avendb/tests/scenarios.rs`) run the same scenarios as `Examples.lean`, on real devices
and keys in the Lab. The vectors (`crates/avendb/tests/vectors.rs`) hold the Rust rules to the model's answers edit by
edit, and in the view, where each edit claims a depth: the model names vaults and shares by numbers and edits by their
place, the core by hashes, so the test maps each number to what its edit created.

T3 is stated for reachable states, the replay of some edits from the empty state: an arbitrary state could list an owner
vault that doesn't exist, which no edit can produce. Its proof carries that invariant (`OwnersExist`) along. T6 and T24
are stated for reachable states too, and their proofs carry `KeyInv` along: seals hold only keys that exist, what is
sealed to an audience's key lies within the audience, and every public family's current key is published. T5 follows the
whole history instead: every seal is justified by what was readable at some point (`SealsRead`). Devices encrypt each
write under the key of its entry's stay at its audience's current epoch, or for a new entry that brings an empty
audience back into use the epoch it moves to, so with T24 nothing written after a removal opens for whoever it removed
(T15). Peers don't check a write's epoch of each other, older or newer: a write names the frontier of its own entry's
log, while the removal that rotated its audience's key mostly sits in a share's or a vault's log, and the edits that
emptied the audience and brought it back into use in other entries' logs, which a device the entry is shared with later
never receives; and a device that had seen the removal could pass the text on anyway. A write under an epoch its
audience hasn't reached opens for nobody until the audience does. Outside removals entitlements only grow, so by T6 no key goes stale but an
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

A vault is an identity, like a smart account, and comes in four kinds (T21), each with one row of the kind table
(`Kind.rules`), which the Rust core and the page read too. A human vault is a person's: owned by their passkeys, its
root and any backup, the only vault a signer ever owns, with the person's devices. A coop vault is owned by human and
coop vaults, never by a signer, and has no devices: it acts through the vaults that own it. An aven is a person's one AI
identity: owned by their human vault alone, one to a person, with no devices; it acts through its owner's devices, and
owns the device vaults its agents run in. A device vault is owned by one human, coop or aven vault and owns nothing; its
devices, a server or an agent's harness, act for it but never govern it (T2): the server of avenDB runs in one, owned by
the coop that runs it, avenCEO GmbH, at the end of the seed a person's vault founds as it claims the server (Maia
Holding GmbH, then avenCEO GmbH, then avenCEO server): the Rust core reads the server so, from the seed, and the
Examples found it so. An aven's agents are device vaults it owns, and each holds sub caps: shares the aven passes on to
it, resting on shares the aven holds, by the one rule a share rests on another by (T22), so a coop that revokes its
share to the aven ends theirs. An access request is no new kind of edit: a record the asking vault writes in itself, and
a share of that one entry to the vault asked, which may read it and set its answer alone (scenario 28). Shares name
vaults or everyone (T4): only a keep share names a device, one of its issuer's, and it grants nothing. Every edit for a
vault other than a human vault names the chain of owners it goes through (`via`): from an owner of the vault it acts for
down, each an owner of the one before, to the vault its device or passkey belongs to. The rules check that chain alone,
so the edit says how it was entitled, and a removal anywhere along it cuts the edit the same way on every device (T1,
T16, T17).

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

A share is a named group of ops and nothing else (`{name, where, ops}`, [ARCHITECTURE.md](../docs/ARCHITECTURE.md) §8):
what its grantee may do on what its `where` picks, from relaying and backing up to reading, writing value by value,
asking for tags and sharing on; its level is the class of its strongest op. Its sealed slice holds the ops, and its
`select` shows only a salted hash of them in the clear, beside the level (T25). Every write through a share carries,
inside its encrypted body, a proof: the share it relies on, and the ops and salt of each share of that share's chain.
Every reader of the entry reads the write's touches off its Loro ops, imported on the version it builds on, and counts
the write only where every share of the chain allows every touch and everything it builds on counts (C2 to C4), so a
chain allows no more than any share of it (C1). A write that doesn't count stays in the log and shows on no line, nor
does anything built on it: an app patched to skip the check writes nothing anyone reads. Everyone gets the Public group
alone, which only reads (T8).

Every reader also judges each write by the schemas its entry was written under once the write is in, which must be in
the vault's lane or built in and all of one kind: each place it changed holds a value one of them takes there, each
row it added or changed reads under one of them, the record's own fields too where it changed them, and it makes no
copy of a row. A write is judged by what it changed alone (S1), so a record that fits stays so (S2); one that doesn't
fit counts for no reader, nor anything built on it (S3), so every device keeps the last record that fit, whatever a
patched app writes; and relays, which open no write, judge none (S4).

Every edit is named by a BLAKE3 hash, and every signature on it is hash-based (SLH-DSA), a write's too, so nothing
counts on the curves: whoever breaks a device's ed25519 key, or a passkey's P-256 key, signs no edit. A passkey's
signature also carries its WebAuthn assertion, the proof that its person took part, which adds nothing against a
quantum computer. The model leaves signatures abstract: an edit's signers are its author and cosigners.

Documents and todos are projected on read, never migrated by an edit: two devices migrating at once could each drop
the other's new containers, and a default that a migration writes races a real edit. The model shows it on the lens
engine's worked example, a v0 of each before the shipped v1, which ships nowhere and lives only in the tests. Each
field stays in the representation of the schema it was written under, v0's or v1's, or after concurrent edits both,
where v1's wins; each app reads the item through the lens into its own schema, so defaults live in the lens. An app's
edit goes back through its view and writes only what changed (T9f, T9g), so no default is ever written, and an older
app's edit keeps what it can't see (T9h). The model covers edits in place; inserting, deleting and moving blocks are
tested in Rust.

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
history is the union of both (T10g) and it shows `Doc.lean`'s merge, for which T10a to T10c hold; its write also
carries the change that brings the merged document to `mergeInto`, the three-way merge of the base, what both histories
hold in common, and of both lines' records (T10h): a place one side alone changed takes that change, and at a conflict
the target keeps its own unless the person takes the other's (T10d, T10e). A write on one line changes no other line
(T10f). In Rust, an older edit is undone by a three-way merge of records, and versions
open read-only on scratch items made from their writes; Loro's own revert and checkout are not used.

A line counts its releases: its start (an entry's creation for main, a draft's or a proposal's start for its own) and
each write on it that brings in writes the line's history held nowhere in that write's own past, a merge of another
line; a direct edit is none. A release's number is one more than the highest of the line's releases in its past (T10i),
counted in one pass over the writes in order, as the Rust counts. It depends on that past alone: two orders of writes
that hold the same past of a write number it alike, so the same writes replayed in any order that keeps each after what
it builds on give every line the same releases, and a number never changes as more writes come (T10j). Two merges made
apart share their number, and the next release counts past both. A version reads as the highest number among the
line's releases it holds and how many of the line's writes it holds after those, and a release reads as itself (T10k).
All of this is proven of the model, for any writes in an order their dependencies respect (`Ordered`, which the writes
every peer counts are in, `counted_ordered`). That the Rust `History::releases` and `History::describe` count as the
model does is tested, not proven: by their unit tests, which take the steps scenario 8 numbered takes in
`Examples.lean`, and by `versions_are_the_same_in_every_replay_order`, which replays random histories in another order
and checks the same numbers, each release one more than the highest of the line's releases below it, and each release
reading as itself. No vector carries version numbers yet.

A new entry is proposed as a draft: one write that creates the entry and starts a line of its own (`Proposal.new`), so
its main line holds nothing. A share's `create` op names the lines it creates on, and a Suggester creates drafts alone,
each counted where every share of its chain lets a creation on a proposal through (D2). A draft lands once a counted
write on its main line builds on its creation (`landed`); before then only the vault's own writes on main count, so
only the vault lands it, in practice by its merge on top of its accept, and no share's merge does, accepted or not
(D1). Until it lands, its stewards leave every share to everyone out of its semantic audience, so no public key opens
it (D3); a draft of a schema or a lens never joins the lane (T17).

Every edit belongs to one log: a vault's (its governance, its devices, its seed's keys), a share's (the share, its
revocation, its keys), an audience's (its keys) or an entry's (its writes and marks, and its keys; a schema
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
connection it came on, so no device speaks for another, and it tells others its own holdings alone (H1). It also signs
them, with when it checked: a node keeps each device's newest statement, whoever brought it, passes it only to a peer
that may know all of it, and lists a device on no live connection by it, with that time (H2). Holdings route: a node
asks a peer for the logs where the peer holds what it lacks, fetches a file first from those that hold it, and lists
as "Synced to", one list for entries and files, the devices that may hold it by its view and stated what they hold of
it, each with whether that is all of it as it holds it. They never authorize: the blob gate hands a file out by T27
alone, to the device a sync connection still open proves, and a node names to a device only files that device may
fetch (T27).

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
| `link.vp` | Linking a new device: the link card goes only to the passkey's own pass for the device whose hello proved it on the connection, where a card handed to any device that said its hello would leak; nobody forges the pass, but it is the device's for its minutes rather than for one connection, as at the relay, so the device may show it twice (a1, a replay with nothing forged: c0c1a0a0 at one session); the join a peer takes is the new device's own, on the connection, signed by the same unlock as its pass (`sign::RelayPass`, `sign::WebAuthn::Pass`, `Node::link_by_pass`, `Lab::accept_join`) | c0c1a1a0 |

Verifpal's analysis is bounded, two sessions of each principal, so a query that holds means no attack within that
bound. The models are Verifpal's rather than ProVerif's: ProVerif has no package for this machine, and Verifpal 1.6.5
builds from crates.io (`cargo install verifpal --version 1.6.5`, with Rust 1.98 or later).

## Assumptions

None are axioms; each is part of the model:

- Signatures can't be forged: an edit's signers, and the device a statement of holdings verifies under
  (`Statement.signer`), are the keys that signed them. Where the curves fall, the Rust core keeps this true for every
  edit and statement, as each signature is SLH-DSA.
- A hello proves its device: whatever comes on a sync connection comes from the device whose hello proved it (`Conn`);
  `hello.vp` checks the hello itself.
- Sealed or encrypted data reveals nothing without its key: a key is learned only through `Knows`.
- Ids don't collide: a `Nodup` hypothesis, or that an id two peers both hold names one edit, where a theorem needs it.
- Loro converges, and can revert a document to any version it contains: fields of the `Loro` structure.

What the proofs don't cover: the Rust and Loro code itself (the tests and the shared Lean ⇄ Rust test vectors do, for
the vault rules from P1, for the lenses from P4, for sync from P6 and for the ops from O), timing and traffic
analysis, and a device compromised while it still holds its keys.

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
| P4b | Post-quantum: SHA-3 ids and hashes (BLAKE3 since VERSION 10), SLH-DSA on every edit (since VERSION 9, with a passkey's WebAuthn assertion beside it; checkpoints and T18 retired), device keys kept masked by the passkey's PRF output, X-Wing plus Classic McEliece in every sealed key box | |
| P5 | History and proposals: every write on a line of its entry's history, proposals from any version, a lossless three-way merge, restore and undo, variants | T10 for writes (T10f to T10h) and version numbers (T10i to T10k) |
| P6 | Logs and frontiers: every edit building on its own log's frontier, devices asking with what they hold of each log, one digest per log to gossip, forks flagged; offline devices, random delivery orders and partial delivery; Lean ⇄ Rust vectors for sync; a device writing under the newest key it knows | T11, T12, T13, T15, T19 |
| P7 | The avenDB tile | |
| P8 | Sync on its own iroh ALPN with X25519MLKEM768 on every connection and the bytes in iroh-blobs; linking a new device by its passkey, through a device's QR code or the server (P8c); the protocol models; a device in the browser, let onto the relay by its passkey's pass, and big answers a page at a time (P8d); the browser's own passkey signing in ceremonies over each edit, a new person's first browser founding their vault, and the store in IndexedDB (P8e); three kinds of vault, every act for a coop or an aven vault naming its chain, and the server a device of avenCEO, claimed by the first human vault founded through it, in the ceremony that founds it (P8f) | T20, T21 |
| F | Flat vaults: no spaces; caps on any slice of a vault (types, tags, entries, authors, creation times) resting on caps; cells, stewards that move entries to the cells their caps pick and answer tag asks, creation through a cap's intake cell; seeds, cap keys, cell keys and entry keys derived per stay, a cell coming back into use moving on; sync by cells | T22, T23, T24, T25, and T1, T4 to T8, T12, T13, T15 to T17 again |
| O | Ops: one JSON language to read and change any record, the same engine on every device, the page and the studio on it | O1, O2, O3 |
| C | Caps that name ops: rules in a write cap's sealed slice with a commitment in the clear, proof-carrying writes, every reader counting only what the rules allow; `may` for the page; rules in the share dialog | C1, C2, C3, C4, and T25 again |
| S | Writes that fit their schemas: every reader judging each write by its entry's schemas, devices refusing what doesn't fit, the page saying why a write doesn't count | S1, S2, S3, S4 |
| B | Blobs ([ARCHITECTURE.md](../docs/ARCHITECTURE.md) §13): sealed files of any size, writes that name the files they bring, one iroh-blobs store per node, sync rules by the cap selector for any data (since replaced by keep shares), marked by the stewards | T27, T28, T29 (since merged into T23), and T13, T25 again |
| H | Holdings (v8): each device tells each peer, on its own connection, what it holds for good of each log and file the peer may know; asks for the logs that differ alone; Synced to; one pool of blob connections, let in only while a sync connection proves the device; signed statements of holdings, kept newest first, passed on only to who may know them and kept on the shelf | H1, H2, and T27 extended |
| N | Records inside records: rows of lists of records at any depth, each list a mergeable Loro container of its row; self-holding shapes; fit per innermost row and the 256-row ceiling; merge, undo and caps at any depth; queries read so many rows down, up to the device's most; links in schemas, followed by queries a level at a time, each hop opening only what the reader may read | O1 to O3 and S1, S2 at any depth, `S2_ceiling`, L1, L2, L3 |
| A | One aven: four primitives (vault, owns, device, share); four kinds of vault by one kind table (`Kind.rules`), the device vault among them, an aven owned by one human vault and one to a person; sub caps by one rule (`shareParentOk`), so an aven passes a coop's share on to its agents' device vaults; the server's device vault at the end of the seed; access requests as records answered through the `answering` group; scenarios 27 and 28 | T21 (`T21_owners_count`, `T21_aven_owner`, `T21_one_aven`), T22 (`T22_sub_cap_level`) |
| M | Merges by path and by policy, code entries (C4b; the Scion plan's A, B and I): a merge op names a path; a merge into main through a share counts only on top of the vault's accept, every vault's default policy being one of its owners; `review`, `bundle` and `policy` records; `recipe`, `view` and `logic` code entries and function v2 | M1, M2, and C4 again |
| D | Drafts: a creation that starts a line of its own, so a Suggester (an agent) proposes a new entry inside an AIP; `create` naming its lines (grant kind 13); only the vault's merge lands a draft; unlanded drafts on no main read and in no public audience | D1, D2, D3, and C2, C4, T17, T23 again |

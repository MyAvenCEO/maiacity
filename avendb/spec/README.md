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
| `Basic.lean` | Ids, principals (signers and vaults), roles relay < read < write < owner, grantees, selectors and what they test (type, author, entry, creation time, tags), cells, key families and key names |
| `State.lean` | What a peer knows: the three kinds of vault (human, coop, aven) and what each may be owned by; acting for a vault through the chain of owners an edit names (`actsVia`), approving for it (its root, or its threshold of owners); caps and the chains they rest on; entries, their stays and cells; the operational rules a relay can check (who may write, create, revoke) and the semantic layer only readers and stewards know (an entry's attributes, whether its creation was let in, its semantic cell, `desired`); symbolic keys (`Knows`), rotation, sealing and entry keys |
| `Step.lean` | Every edit and the rules that accept or refuse it: governance, caps and revocations, writes that create entries in cells, moves, keys, publishing into a vault's schema lane, checkpoints, writes on a proposal (which build on its start); the one order every peer replays in; strong removal: what a removal or a move cuts, and which removals stand when they clash (`view`); what a peer counts once it no longer trusts the curves (`checkpointed`) |
| `Sync.lean` | What a peer sends a device: sync by cells, entry by entry (each entry's writes, moves, checkpoints and keys), with the caps and vaults needed to check them; and what it hands a new device whose passkey proved itself on their connection, the logs of the vaults the passkey owns (`linkCard`) |
| `Logs.lean` | Every edit in one log, a vault's, a cap's, a cell's or an entry's, building on that log's frontier; each log's closed part (the edits whose whole past is held) and frontier; what a device names of each log when it asks (its frontier, the edits 1, 2, 4, 8, … steps back and the oldest) and its loose edits; what a peer sends beyond them (`respondSince`); forks |
| `Doc.lean` | Documents as histories: merge and promote, against the laws we rely on from Loro |
| `Proposals.lean` | Proposals write by write: each write extends one line of its entry's history, the main line or a proposal; a line's history and heads; the order writes come in (`Ordered`); T10f to T10h, which tie `Doc.lean`'s merge and promote to the writes |
| `Lens.lean` | The markdown document and the todo in two schema versions and the lenses between them; items as stored, projected on read into each app's schema, and edits through each app's view; the lens laws (T9) |
| `Props.lean` | The predicates and views the theorems are stated with, apart from their proofs |
| `Theorems.lean` | T1 to T8 and T11 to T25; and `writes_ordered`, the order every peer's writes come in, which T10f to T10h rest on |
| `Lemmas.lean` | The helper lemmas for vaults and writes: how a step changes a vault, ownership links and chains, what a step keeps that authorization reads, causal closure, the schema lane |
| `CapLemmas.lean` | The helper lemmas for caps, cells and removals: well-formed cap chains (T22), cells meaning what the selectors say (T23), the replay and strong removal (T16, T18), the generations along a replay (T15) |
| `RelayLemmas.lean` | The proof of T25: every rule reads only the operational part of a state, so a relay that opens no selector, type or tag has every edit stand or fall as an owner does |
| `KeyLemmas.lean` | The helper lemmas for the keys: what settling seals, publishes and links, `opens` finding every key `Knows` gives, the invariants behind T5, T6 and T24, `EverReads` |
| `SyncLemmas.lean` | The helper lemmas for sync: the replay order is a total order on ids (T11), what a peer sends a device, a log's closed part lying at or below its frontier, and every edit a device names of a log being one it holds with its whole past (T19) |
| `Examples.lean` | The plan's scenarios run on the model, and the flat vaults' own: sharing every entry of a type, by a tag or one entry, a tag moving an entry out of a slice, creating through a cap, caps resting on caps, wide caps and Public, a revocation that moves no entry, a cell that comes back into use, proposals, schema v2, one todo shared with several vaults and synced peer to peer, strong removal, and checkpoints once the curves fall |
| `Vectors.lean` | Cases for the Rust core: edits applied in order (which the model accepts) and edits at the depths they claim (which stand in the view, or in the post-quantum view), with the state at the end, as its readers see it too, each line of each entry's history and its heads among it; sync cases: edits with their parents, each log's closed part and frontier, the forks, and for each device that asks a peer what it names of each log, its loose edits, and what it is sent; and lens cases: what each app reads from stored blocks and todos, and what its edits store |
| `VectorsCheck.lean`, `WriteVectors.lean` | Check the files in `vectors/` on every build; write them (`lake exe vectors`) |
| `vectors/vaults.json` | The cases with the model's answers, read by `crates/avendb/tests/vectors.rs` |
| `vectors/lenses.json` | The lens cases with the model's views and edits, read by `the_lens_vectors` |
| `protocol/*.vp` | Verifpal models of what devices say to each other: the hello on every connection, linking a new device by its passkey, and the sealed box (see [Protocol models](#protocol-models)) |
| `protocol/check.sh` | Checks each model against the result its header expects |

## Theorems

| # | What must always hold | Status | Guarded in Rust by |
|---|---|---|---|
| T1 | Only authorized writes are accepted, each by a device acting for the vault through the owners the write names, for a vault that is the entry's or holds a live cap with write or more reaching the entry's cell; a new entry is created by its vault, or in the intake cell of such a cap; and revocation wins over what it hadn't seen | Proven | `write_without_cap_rejected_on_import`, `t1_authorized_writes`, `t1_revocation_wins`, the vectors |
| T2 | Governance needs the vault's approval (its root, or its threshold of owners) plus the newcomer's consent; devices, a human vault's or an aven vault's servers, can't govern | Proven | `add_owner_needs_threshold_and_consent`, `device_cannot_govern`, `an_aven_vaults_devices_act_for_it_but_never_govern_it`, `the_passkey_is_the_root`, `t2_consent`, the vectors |
| T3 | No ownership cycles in any state the edits can reach | Proven | `ownership_cycle_rejected`, `t3_no_cycles`, the vectors |
| T4 | Caps name vaults, never signers | Proven | `cap_to_signer_rejected`, `t4_caps_name_vaults_and_t8_public_read_only`, the vectors |
| T5 | A holder (a signer, whoever holds a vault's seed, or everyone) opens a key of a family, of any epoch, only if over the history it could read the family: itself, while it was public, or through a vault whose seed it held at some point (whoever joins a vault inherits what the vault could read) | Proven | `t5_confidentiality`, `entry_reader_cannot_open_other_entries`, `every_device_opens_exactly_what_it_may` |
| T6 | Forward secrecy on removal: in every state the edits can reach, the current key of a family in use opens only for holders entitled to it now, or while it is public | Proven | `t6_forward_secrecy`, `revoked_reader_cannot_open_new_edits`, `every_device_opens_exactly_what_it_may`, the vectors |
| T7 | Blind server: a device whose vaults read nothing of another vault, such as the server acting for avenCEO with its relay caps, opens no key of a vault whose seed it never held, unless that key was public | Proven from T5 | `server_holds_only_ciphertext`, `every_device_opens_exactly_what_it_may` |
| T8 | Public is read-only | Proven | `public_is_read_only`, `t4_caps_name_vaults_and_t8_public_read_only`, the vectors |
| T9 | Lens laws: round trips, both apps see the same item, an edit shows exactly as made, an unchanged view writes nothing, and an older app's edit keeps what it can't see | Proven | `lens_round_trip_v1`, `edits_through_a_view_keep_what_it_cant_see`, `t9_put_get`, `t9_put_get_todos`, `the_lens_vectors`, `scenario_09_schema_v2` |
| T10 | Merge is the union of histories; promote gives the proposal's content and keeps both; a write on one line leaves every other line as it was | Proven | `promote_equals_proposal`, `merge_is_the_union_of_both_lines`, `t10_proposals`, `scenario_08_proposals`, the vectors |
| T11 | Same edits in any order, same state | Proven | `same_edits_any_order_same_result`, `t11_convergence`, `t11_vault_logs_converge`, `every_order_of_delivery_ends_the_same`, `scenario_13_offline_conflicts` |
| T12 | A peer sends a device only the logs of entries, cells and caps it may receive by the peer's view, and vault logs, whatever the device names when it asks | Proven | `sync_sends_only_what_caps_reach`, `t12_sync_shares_only_caps`, `t19_frontier_sync_loses_nothing`, the sync vectors |
| T13 | Two devices that each asked the other once hold the same edits of every entry each may receive by the other's view | Proven | `entry_syncs_peer_to_peer_without_server`, `t13_sync_converges`, `scenario_17_peer_to_peer` |
| T14 | Accepted writes are causally closed: a write stands only with every write it builds on, and every write is of an entry that exists | Proven | `t14_causally_closed`, the vectors |
| T15 | Rotation follows revocation: a device writes an entry under the key of its stay at its cell's current generation in what it knows, which opens only for holders that what it knows entitles to the cell, and under no older generation than any along its history, so once it has seen a removal the removed can't open what it writes | Proven from T24 | `a_device_writes_under_the_newest_key_it_knows`, `revoked_reader_cannot_open_new_edits`, `scenario_10_revoke_carol` |
| T16 | Strong removal: an edit stands only if it also stands without what each later removal that hadn't seen it takes away, a move's being the cell it took the entry out of, and every removal chosen stands | Proven | `a_removed_owner_cannot_backdate_governance`, `handing_the_root_on_cuts_the_old_passkeys_backdated_edits`, `t16_strong_removal`, `t16_resolved_removals_stand`, `scenario_21_a_tag_moves_an_entry_out_of_a_slice`, the view vectors |
| T17 | Only a vault, or a vault holding a wide owner cap over it, publishes its schemas and lenses, through the owners the edit names | Proven | `only_owners_publish_into_the_lane`, the vectors |
| T18 | Once the curves fall: a peer that no longer trusts them counts a write only if a checkpoint by its own author covers it | Proven | `a_broken_curve_writes_nothing_that_counts`, `t18_checkpointed_writes`, the vectors |
| T19 | Frontier sync loses nothing: a device that asks with its frontier of each log, a few edits further back and its loose edits is sent every edit of the peer's answer it lacks; and two copies of a log with the same frontier hold the same closed part, so one digest per log tells whether to ask | Proven | `t19_frontier_sync_loses_nothing`, `t19_partial_delivery`, `t19_one_digest_per_log`, `a_second_sync_sends_nothing`, `an_edit_sends_only_what_is_new_both_ways`, the sync vectors |
| T20 | Linking hands out vault logs alone: what a peer hands a device whose passkey's pass names it on their connection is the log of each vault the passkey owns, or that owns such a vault up the chains, and nothing of a cap, a cell or an entry; a passkey that owns no vault there gets nothing | Proven | `a_link_card_holds_the_logs_of_the_passkeys_vaults_and_nothing_else`, `a_node_hands_its_card_for_a_pass_for_the_device_on_that_very_connection_alone`, the link vectors |
| T21 | Vaults keep to their kind: signers own human vaults only; coop and aven vaults are owned by human and coop vaults; a coop vault has no devices; only a human vault has a root. So every act for a coop goes through a human vault its device or passkey belongs to, and so does every act for an aven vault that none of its own servers signs | Proven | `every_vault_keeps_to_its_kind`, `t21_vault_kinds`, `an_act_for_a_coop_names_the_vault_it_goes_through`, `a_removed_owners_unseen_writes_for_the_coop_are_cut`, the vectors |
| T22 | A cap grants no more than the caps it rests on: a cap that rests on another is over the same vault, rests on an owner cap issued to its own issuer, and selects nothing its parent doesn't; a wide cap rests only on a wide cap | Proven | `t22_caps_narrow_down_their_chain`, `scenario_24_a_cap_resting_on_a_cap`, the vectors |
| T23 | Cells mean what the caps say: where an entry's cell, revoked caps left aside, is its semantic cell, the write rule every peer checks without reading a selector, a type or a tag allows exactly the vaults the caps' selectors allow; and that rule never refuses a creation inside its creator's slice | Proven | `t23_cells_mean_what_caps_say`, `scenario_19_share_every_entry_of_a_type`, `scenario_23_creating_through_a_cap`, the vectors |
| T24 | An entry's key reaches only its cell's readers: whoever opens the key of an entry in its current stay, at its cell's current generation, may open that cell's current key; and over the history a holder opens a key of an entry only if it could read some cell the entry was in | Proven | `t24_entry_keys_reach_only_cell_readers`, `scenario_21_a_tag_moves_an_entry_out_of_a_slice`, `scenario_26_a_cell_that_comes_back_into_use_moves_on` |
| T25 | Blind relays: a peer that reads no selector, no type and no tag, such as the server, holding the same edits as an owner, has every edit stand or fall alike and knows the same of the vaults, caps, cells, writes and keys | Proven | `t25_blind_relays`, `scenario_25_wide_caps_relays_and_public` |

The Rust scenario tests (`crates/avendb/tests/scenarios.rs`) run the same scenarios as `Examples.lean`, on real devices
and keys in the Lab. The vectors (`crates/avendb/tests/vectors.rs`) hold the Rust rules to the model's answers edit by
edit, and in the view, where each edit claims a depth: the model names vaults and caps by numbers and edits by their
place, the core by hashes, so the test maps each number to what its edit created.

T3 is stated for reachable states, the replay of some edits from the empty state: an arbitrary state could list an owner
vault that doesn't exist, which no edit can produce. Its proof carries that invariant (`OwnersExist`) along. T6 and T24
are stated for reachable states too, and their proofs carry `KeyInv` along: seals hold only keys that exist, what is
sealed to a cell's key lies within the cell, and every public family's current key is published. T5 follows the whole
history instead: every seal is justified by what was readable at some point (`SealsRead`). Devices encrypt each write
under the key of its entry's stay at its cell's current generation (the rules refuse a generation that doesn't exist
yet, but the one a new entry brings an empty cell to), so with T24 nothing written after a removal opens for whoever it
removed (T15). Peers don't check this of each other: a write names the frontier of its own entry's log, while the
removal that rotated its cell's key mostly sits in a cap's or a vault's log, and a device that had seen the removal
could pass the text on anyway. Outside removals entitlements only grow, so by T6 no key goes stale but a cell's that
comes back into use: the Rust key schedule looks for stale keys only after a removal or a move into such a cell, and
`t6_forward_secrecy` checks that nothing else makes any.

Concurrent changes replay in one order (causal depth, removals first, then edit hash), so they settle the same way on
every device. That alone doesn't stop a removed owner, or a thief holding a stolen passkey, from signing edits on an old
copy of the log that claim to come before the removal, so a removal cuts what it hadn't seen (T16). Every removal
(removing an owner or a device, revoking a cap, handing the root on, moving an entry) names the edits it had seen and
keeps; every other edit before it in the replay order stands only if it also stands with what the removal takes away
hidden, for governance as for writes. When removals clash, the senior one stands. Removals settle from the top down: a
vault's before those of the coops it owns, since a coop's removals rest on its owners' approval, and within a vault its
root, then its owners in the order they joined, then removals no owner approved (a device leaving). Revocations follow,
the most senior revoker first: the vault the cap is over, then whoever issued a cap higher up the revoked cap's chain.
So a revoked owner can't keep their cap by revoking, on an old copy, a cap they gave beneath it, and a peer that never
held a coop's log settles its owners' vaults as everyone else does (a finding of P6). Moves come last: a move takes
away only the cell writes of its own entry rested on, which no removal and no other move rests on, so the Rust core
doesn't try each move as it tries each other removal, and chooses the same.

A vault is an identity, like a smart account, and comes in three kinds (T21). A human vault is a person's: owned by
their passkeys, its root and any backup, the only vault a signer ever owns, with the person's devices. A coop vault is
owned by human and coop vaults, never by a signer, and has no devices: it acts through the vaults that own it. An aven
vault, an agent's such as avenCEO, the vault of avenDB's server, is owned as a coop is, and its devices, its servers,
act for it but never govern it (T2). Caps always name vaults (T4), never signers. Every edit for a coop or an aven vault
names the chain of owners it goes through (`via`): from an owner of the vault it acts for down, each an owner of the
one before, to the vault its device or passkey belongs to. The rules check that chain alone, so the edit says how it was
entitled, and a removal anywhere along it cuts the edit the same way on every device (T1, T16, T17).

A human vault's passkey is its root, named at genesis: it approves anything for its vault on its own, wins every
clash, and only it hands the root on (`setRoot`, which cuts what the old passkey signs on an old copy). Passkeys are
the only way back in: a backup passkey may join as a second owner, never the root, and a device's keys derive from a
passkey at every unlock.

A vault holds its entries directly, with no spaces or folders in between. An entry's type and tags travel inside the
encrypted bodies of its writes, and a cap grants a role on a slice of a vault: what its selector picks by type, author,
entry, creation time and tags, AND-ed down the chain of caps it rests on (T22), or the whole vault for a wide cap. The
caps that pick an entry alike form its cell, which carries the keys: a cell's key opens for the vault and for each cap
with read or more that reaches it, and an entry's key derives from its cell's key for each stay of the entry in a cell.
No rule a peer checks reads a selector, a type or a tag: only the cell an entry is in, which caps are live and whom they
name, so a relay that opens none of them decides every edit as an owner does (T25). The stewards, the vault's own
devices, read every selector and every entry, and keep each entry in the cell its caps pick by moving it (`desired`), so
the rule peers check means what the selectors say (T23). Anyone else creates through a cap, in the cap's intake cell,
and asks for tags in its writes; the stewards answer each ask with what the asker's caps let it ask for. A revocation
moves no entry: its cells move on to a new generation instead. A move is a removal: it cuts the writes it hadn't seen
that relied on the old cell, so nobody backdates an edit into an entry after it left their slice, and it links the
entry's earlier keys under its new one, so whoever reads it now reads its whole history and nothing of an entry it
can't read now (T24). A cell no entry is in keeps its key through removals; an entry that brings it back into use moves
it to a new generation, which whoever a removal took out meanwhile doesn't open.

Every edit is named by a SHA-3 hash, and every signature on it but a write's has a hash-based half (SLH-DSA) beside the
classical one, so governance, caps and keys hold even once the curves fall. A write carries only the classical
half, to stay fast and small; its device vouches for it in a checkpoint, which carries both. A peer that no longer
trusts the curves counts only the writes that a checkpoint by their own author covers (T18), so whoever breaks a
device's ed25519 key writes nothing such a peer counts. The model leaves signatures abstract: an edit's signers are its
author and cosigners, and T18 is stated over which edits a peer counts.

Documents and todos are projected on read, never migrated by an edit: two devices migrating at once could each drop
the other's new containers, and a default that a migration writes races a real edit. Each field stays in the
representation of the schema it was written under, v1's or v2's, or after concurrent edits both, where v2's wins; each
app reads the item through the lens into its own schema, so defaults live in the lens. An app's edit goes back through
its view and writes only what changed (T9f, T9g), so no default is ever written, and an older app's edit keeps what it
can't see (T9h). The model covers edits in place; inserting, deleting and moving blocks are tested in Rust. The
schemas and lenses are blobs named by their hash that hold no data, published into the vault's schema lane by the vault
or a vault holding a wide owner cap over it (T17).

Every write is an edit on one line of its entry's history: the main line, or a proposal, which a write starts from any
version (its `deps`) and names, encrypted. A write on a proposal builds on the write that started it or on another write
on it, so a revocation that cuts a proposal's start cuts the whole proposal, and the rules check every proposal write's
caps as they check any write's. A line's history is its own writes and everything they build on, and a device shows on a
line Loro's content of that history. A merge is a write on the target that builds on the heads of both lines, so its
history is the union of both (T10g) and it shows `Doc.lean`'s merge, for which T10a to T10c hold; a promote's write
also carries the change that brings the merged document to exactly the proposal's content (T10h, from T10d and T10e). A
write on one line changes no other line (T10f). In Rust, an older edit is undone by a three-way merge of records,
and versions open read-only on scratch items made from their writes; Loro's own revert and checkout are not used.

Every edit belongs to one log: a vault's (its governance, its devices, its seed's keys, its schema lane), a cap's (the
cap, its revocation, its keys), a cell's (its keys) or an entry's (its writes, moves and checkpoints, and its keys). An
edit names as its parents the frontier of its own log as its device held it, so each log is a small history of its own,
and its depth stays one clock across logs, one more than the deepest edit its device held, so a removal still sorts
after everything its device had seen. A device counts in a log's frontier only its closed part, the edits whose whole
past it holds: an edit whose parent hasn't arrived waits outside it, with whatever builds on it. When it asks a peer, a
device names of each log its frontier, the edits 1, 2, 4, 8, … steps back from it and the oldest, and lists its loose
edits (those outside every closed part); the peer sends what it would send whole (`respond`), less those loose edits and
whatever lies at or below an edit the device named (`respondSince`). A peer that is behind holds the frontier and sends
exactly what the device lacks; one that lacks the device's newest edits still finds one it holds a few steps back, so it
sends back little the device holds; and nothing the device lacks is ever withheld (T19). Two copies of a log with the
same frontier hold the same closed part, so devices gossip one hash per log, of its frontier and the edits waiting
outside it, and ask only where one differs. A device signs its edits in a log one after another, so two of its edits in
one log where neither builds on the other mean its key signed twice from the same past: a device restored from an old
backup, a clone, or a stolen key. Every peer flags such forks among the edits it holds (passkeys, which sign on several
devices, aside); both edits stand, as any concurrent edits do.

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
| `link.vp` | Linking a new device: the link card goes only to the passkey's own pass for the device whose hello proved it on the connection, where a card handed to any device that said its hello would leak; nobody forges the pass, but it is the device's for its minutes rather than for one connection, as at the relay, so the device may show it twice (a1, a replay with nothing forged: c0c1a0a0 at one session); the join a peer takes is the new device's own, on the connection (`sign::RelayPass`, `Node::link_with`, `Lab::accept_join`) | c0c1a1a0 |

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

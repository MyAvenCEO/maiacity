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
| `Basic.lean` | Ids, principals (signers and vaults), roles relay < read < write < owner, scopes (a space or one entry), grantees, key names |
| `State.lean` | What a peer knows; acting for a vault, approving for it (its root, or its threshold of owners), holding a cap; symbolic keys (`Knows`), rotation and sealing |
| `Step.lean` | Every op and the rules that accept or refuse it, publishing into a space's schema lane, checkpoints, and writes on a branch (which build on its start) among them; the one order every peer replays in; strong removal: what a removal cuts, and which removals stand when they clash (`view`); what a peer counts once it no longer trusts the curves (`checkpointed`) |
| `Sync.lean` | What a peer sends a device: sync by caps, item by item (each item's writes and checkpoints), and the revocations that took its caps away |
| `Logs.lean` | Every op in one log, a vault's, a space's or an entry's, building on that log's frontier; each log's closed part (the ops whose whole past is held) and frontier; what a device names of each log when it asks (its frontier, the ops 1, 2, 4, 8, … steps back and the oldest) and its loose ops; what a peer sends beyond them (`respondSince`); forks |
| `Doc.lean` | Documents as histories: merge and promote, against the laws we rely on from Loro |
| `Branches.lean` | Branches write by write: each write extends one line of its entry's history, the main line or a branch; a line's history and heads; the order writes come in (`Ordered`); T10f to T10h, which tie `Doc.lean`'s merge and promote to the writes |
| `Lens.lean` | The markdown document and the todo in two schema versions and the lenses between them; items as stored, projected on read into each app's schema, and edits through each app's view; the lens laws (T9) |
| `Theorems.lean` | T1 to T8 and T11 to T19; and `writes_ordered`, the order every peer's writes come in, which T10f to T10h rest on |
| `Lemmas.lean` | The helper lemmas the proofs use: how a step changes a vault, ownership links and chains, what a step keeps that authorization reads, causal closure, the schema lane, replays, and which op made each write |
| `KeyLemmas.lean` | The helper lemmas for the keys: what settling seals and publishes, `opens` finding every key `Knows` gives, acting for a vault through chains, the invariants behind T5 and T6, `EverReads` |
| `SyncLemmas.lean` | The helper lemmas for sync: the replay order is a total order on ids (T11), what a peer sends a device, a log's closed part lying at or below its frontier, and every op a device names of a log being one it holds with its whole past (T19) |
| `Examples.lean` | The plan's scenarios run on the model, including branches (a draft merged, a rewrite promoted, and a revocation cutting a branch), schema v2 (the schema lane, and a v2 app's edit of a document a v1 app wrote), one todo shared with several vaults and synced peer to peer, strong removal (back-dated ops cut, clashes settled from the top down, a senior revoker, a stolen passkey, the root handed on), and checkpoints once the curves fall |
| `Vectors.lean` | Cases for the Rust core: ops applied in order (which the model accepts) and ops at the depths they claim (which stand in the view, or in the post-quantum view), with the state at the end, each line of each entry's history and its heads among it; sync cases: ops with their parents, each log's closed part and frontier, the forks, and for each device that asks a peer what it names of each log, its loose ops, and what it is sent; and lens cases: what each app reads from stored blocks and todos, and what its edits store |
| `VectorsCheck.lean`, `WriteVectors.lean` | Check the files in `vectors/` on every build; write them (`lake exe vectors`) |
| `vectors/vaults.json` | The cases with the model's answers, read by `crates/avendb/tests/vectors.rs` |
| `vectors/lenses.json` | The lens cases with the model's views and edits, read by `the_lens_vectors` |

## Theorems

| # | What must always hold | Status | Guarded in Rust by |
|---|---|---|---|
| T1 | Only authorized writes are accepted, and revocation wins over what it hadn't seen | Proven | `write_without_cap_rejected_on_import`, `t1_authorized_writes`, `t1_revocation_wins`, the vectors |
| T2 | Governance needs the vault's approval (its root, or its threshold of owners) plus the newcomer's consent; devices can't govern | Proven | `add_owner_needs_threshold_and_consent`, `device_cannot_govern`, `the_passkey_is_the_root`, `t2_consent`, the vectors |
| T3 | No ownership cycles in any state the ops can reach | Proven | `ownership_cycle_rejected`, `t3_no_cycles`, the vectors |
| T4 | Grants name vaults, never signers | Proven | `grant_to_signer_rejected`, `t4_grants_name_vaults_and_t8_public_read_only`, the vectors |
| T5 | A holder (a signer, whoever holds a vault's key, or everyone) opens a key of a family, of any epoch, only if over the history it could read the family: itself, while it was public, or through a vault whose key it held at some point (whoever joins a vault inherits what the vault could read) | Proven | `t5_confidentiality`, `entry_reader_cannot_open_other_entries`, `every_device_opens_exactly_what_it_may` |
| T6 | Forward secrecy on removal: in every state the ops can reach, a family's current key opens only for holders entitled to it now, or while it is public | Proven | `t6_forward_secrecy`, `revoked_reader_cannot_open_new_edits`, `every_device_opens_exactly_what_it_may`, the vectors |
| T7 | Blind server: a device whose vaults hold no read opens only public keys | Proven from T5 | `server_holds_only_ciphertext`, `every_device_opens_exactly_what_it_may` |
| T8 | Public is read-only | Proven | `public_is_read_only`, `t4_grants_name_vaults_and_t8_public_read_only`, the vectors |
| T9 | Lens laws: round trips, both apps see the same item, an edit shows exactly as made, an unchanged view writes nothing, and an older app's edit keeps what it can't see | Proven | `lens_round_trip_v1`, `edits_through_a_view_keep_what_it_cant_see`, `t9_put_get`, `t9_put_get_todos`, `the_lens_vectors`, `scenario_09_schema_v2` |
| T10 | Merge is the union of histories; promote gives the branch's content and keeps both; a write on one line leaves every other line as it was | Proven | `promote_equals_branch`, `merge_is_the_union_of_both_lines`, `t10_branches`, `scenario_08_branches`, the vectors |
| T11 | Same ops in any order, same state | Proven | `same_ops_any_order_same_result`, `t11_convergence`, `t11_vault_logs_converge`, `every_order_of_delivery_ends_the_same`, `scenario_13_offline_conflicts` |
| T12 | A peer sends a device only items it holds a cap on, and of other scopes only the revocations that took its caps away, whatever the device names when it asks | Proven | `sync_sends_only_capped_items`, `t12_sync_shares_only_caps`, `t19_frontier_sync_loses_nothing`, the sync vectors |
| T13 | Two devices that each asked the other once hold the same writes and checkpoints for every item each may receive by the other's view | Proven | `item_syncs_peer_to_peer_without_server`, `t13_sync_converges`, `scenario_17_peer_to_peer` |
| T14 | Accepted writes are causally closed: a write stands only with every write it builds on | Proven | `a_drop_takes_what_builds_on_it_along`, `t14_causally_closed`, the vectors |
| T15 | Rotation follows revocation: a device writes an entry under the current key of what it knows, which opens only for holders that what it knows entitles to the entry, and under no older epoch than any along its history, so once it has seen a removal the removed can't open what it writes | Proven from T6 | `a_device_writes_under_the_newest_key_it_knows`, `revoked_reader_cannot_open_new_edits`, `scenario_10_revoke_carol` |
| T16 | Strong removal: an op stands only if it also stands without what each later removal that hadn't seen it takes away, and every removal chosen stands | Proven | `a_removed_owner_cannot_backdate_governance`, `handing_the_root_on_cuts_the_old_passkeys_backdated_ops`, `t16_strong_removal`, the view vectors |
| T17 | Only a space's owners publish its schemas and lenses | Proven | `only_owners_publish_into_the_lane`, the vectors |
| T18 | Once the curves fall: a peer that no longer trusts them counts a write only if a checkpoint by its own author covers it | Proven | `a_broken_curve_writes_nothing_that_counts`, `t18_checkpointed_writes`, the vectors |
| T19 | Frontier sync loses nothing: a device that asks with its frontier of each log, a few ops further back and its loose ops is sent every op of the peer's answer it lacks; and two copies of a log with the same frontier hold the same closed part, so one digest per log tells whether to ask | Proven | `t19_frontier_sync_loses_nothing`, `t19_partial_delivery`, `t19_one_digest_per_log`, `a_second_sync_sends_nothing`, `an_edit_sends_only_what_is_new_both_ways`, the sync vectors |

The Rust scenario tests (`crates/avendb/tests/scenarios.rs`) run the same scenarios as `Examples.lean`, on real devices
and keys in the Lab. The vectors (`crates/avendb/tests/vectors.rs`) hold the Rust rules to the model's answers op by op, and
in the view, where each op claims a depth: the model names vaults, spaces and grants by numbers and ops by their place,
the core by hashes, so the test maps each number to what its op created.

T3 is stated for reachable states, the replay of some ops from the empty state: an arbitrary state could list an owner
vault that doesn't exist, which no op can produce. Its proof carries that invariant (`OwnersExist`) along. T6 is
stated for reachable states too, and its proof carries `KeyInv` along: seals hold only keys that exist, what is
sealed to a space's key lies within the space, and every public family's current key is published. T5 follows the
whole history instead: every seal is justified by what was readable at some point (`SealsRead`). Devices encrypt each
edit under its entry's current key (the rules refuse an epoch that doesn't exist yet), so with T6 nothing written after
a removal opens for whoever it removed (T15). Peers don't check this of each other: a write names the frontier of
its own entry's log, while the removal that rotated its key mostly sits in a space's or a vault's log, and a device
that had seen the removal could pass the text on anyway. Outside removals entitlements only grow, so by T6 no key
goes stale: the Rust key schedule looks for stale keys only after a removal, and `t6_forward_secrecy` checks that
nothing else makes any.

Concurrent changes replay in one order (causal depth, removals first, then op hash), so they settle the same way on
every device. That alone doesn't stop a removed owner, or a thief holding a stolen passkey, from signing ops on an old
copy of the log that claim to come before the removal, so a removal cuts what it hadn't seen (T16). Every removal
(removing an owner or a device, revoking a grant, handing the root on) names the ops it had seen and keeps; every
other op before it in the replay order stands only if it also stands with what the removal takes away hidden, for
governance as for writes. When removals clash, the senior one stands. Removals settle from the top down: a vault's
before those of the coops it owns, since a coop's removals rest on its owners' approval, and within a vault its root,
then its owners in the order they joined, then removals no owner approved (a device leaving). Revocations follow, the
most senior revoker first: the space's founder, then whoever issued a grant higher up the revoked grant's chain. So a
revoked owner can't keep his grant by revoking, on an old copy, a grant he gave beneath it, and a peer that never held
a coop's log settles its owners' vaults as everyone else does (a finding of P6).

A human vault's passkey is its root, named at genesis: it approves anything for its vault on its own, wins every
clash, and only it hands the root on (`setRoot`, which cuts what the old passkey signs on an old copy). Passkeys are
the only way back in: a backup passkey may join as a second owner, never the root, and a device's keys derive from a
passkey at every unlock.

Every op is named by a SHA-3 hash, and every signature on it but a write's has a hash-based half (SLH-DSA) beside the
classical one, so governance, grants and keys hold even once the curves fall. A write carries only the classical
half, to stay fast and small; its device vouches for it in a checkpoint, which carries both. A peer that no longer
trusts the curves counts only the writes that a checkpoint by their own author covers (T18), so whoever breaks a
device's ed25519 key writes nothing such a peer counts. The model leaves signatures abstract: an op's signers are its
author and cosigners, and T18 is stated over which ops a peer counts.

Documents and todos are projected on read, never migrated by a commit: two devices migrating at once could each drop
the other's new containers, and a default that a migration writes races a real edit. Each field stays in the
representation of the schema it was written under, v1's or v2's, or after concurrent edits both, where v2's wins; each
app reads the item through the lens into its own schema, so defaults live in the lens. An app's edit goes back through
its view and writes only what changed (T9f, T9g), so no default is ever written, and an older app's edit keeps what it
can't see (T9h). The model covers edits in place; inserting, deleting and moving blocks are tested in Rust. The
schemas and lenses are blobs named by their hash that hold no data, published into the space's schema lane by an
owner of the space (T17).

Every write is a commit on one line of its entry's history: the main line, or a branch, which a write starts from any
version (its `deps`) and names, encrypted. A write on a branch builds on the write that started it or on another write
on it, so a revocation that cuts a branch's start cuts the whole branch, and the rules check every branch write's caps
as they check any write's. A line's history is its own writes and everything they build on, and a device shows on a
line Loro's content of that history. A merge is a write on the target that builds on the heads of both lines, so its
history is the union of both (T10g) and it shows `Doc.lean`'s merge, for which T10a to T10c hold; a promote's write
also carries the change that brings the merged document to exactly the branch's content (T10h, from T10d and T10e). A
write on one line changes no other line (T10f). In Rust, an older commit is undone by a three-way merge of records,
and versions open read-only on scratch items made from their writes; Loro's own revert and checkout are not used.

Every op belongs to one log: a vault's (its governance, its devices, its keys), a space's (its founding, its grants,
its schema lane, its keys) or an entry's (its writes and checkpoints, the grants on it, its keys); a revocation joins
the log of the grant it revokes. An op names as its parents the frontier of its own log as its device held it, so each
log is a small history of its own, and its depth stays one clock across logs, one more than the deepest op its device
held, so a removal still sorts after everything its device had seen. A device counts in a log's frontier only its
closed part, the ops whose whole past it holds: an op whose parent hasn't arrived waits outside it, with whatever builds
on it. When it asks a peer, a device names of each log its frontier, the ops 1, 2, 4, 8, … steps back from it and the
oldest, and lists its loose ops (those outside every closed part); the peer sends what it would send whole
(`respond`), less those loose ops and whatever lies at or below an op the device named (`respondSince`). A peer that is
behind holds the frontier and sends exactly what the device lacks; one that lacks the device's newest ops still finds
one it holds a few steps back, so it sends back little the device holds; and nothing the device lacks is ever withheld
(T19). Two copies of a log with the same frontier hold the same closed part, so devices gossip one hash per log, of its
frontier and the ops waiting outside it, and ask only where one differs. A device signs its ops in a log one after
another, so two of its ops in one log where neither builds on the other mean its key signed twice from the same past: a
device restored from an old backup, a clone, or a stolen key. Every peer flags such forks among the ops it holds
(passkeys, which sign on several devices, aside); both ops stand, as any concurrent ops do.

## Assumptions

None are axioms; each is part of the model:

- Signatures can't be forged: an op's signers are the keys that signed it. Where the curves fall, the Rust core keeps
  this true for every op but a write (each carries a hash-based half), and T18 for writes.
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
| P1 | Vaults, vault logs, chains; op ids and signatures (device keys, passkeys through the WebAuthn envelope); vectors for the vault rules | T2, T3 |
| P2 | Spaces, grants, revocation with strong removal, the passkey as root, Public, write checks with causal closure, what each device may receive | T1, T4, T8, T14, T16 |
| P3 | Keys, sealing, encryption of every edit, rotation | T5, T6, T7 |
| P4 | Schemas and lenses projected on read, edits through each app's view, the schema lane | T9, T17 |
| P4b | Post-quantum: SHA-3 ids and hashes, SLH-DSA beside every classical signature but a write's, device keys derived from the passkey, X-Wing plus Classic McEliece in every sealed key box, checkpoints and the post-quantum-only replay | T18 |
| P5 | History and branches: every write on a line of its entry's history, branches from any version, merge, promote, restore and undo, forks | T10 for writes (T10f to T10h) |
| P6 | Logs and frontiers: every op building on its own log's frontier, devices asking with what they hold of each log, one digest per log to gossip, forks flagged; offline devices, random delivery orders and partial delivery; Lean ⇄ Rust vectors for sync; a device writing under the newest key it knows | T11, T12, T13, T15, T19 |
| P7 | The avenDB tile | |
| P8 | Sync on its own iroh ALPN with X25519MLKEM768 on every connection and the bytes in iroh-blobs, passkeys from the browser's WebAuthn | |

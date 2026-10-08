# Vault spec

The formal specification of the user-owned, end-to-end encrypted database behind the Database tile, in Lean 4 (core
library only, no Mathlib). It states what must always hold: who may write, who can open which key, what each device
receives. The Rust crate `vault/crates/vault-db` is built against it test-first, and its tests carry the same names.
The plan with the scenarios and the build order is the Claude Doc "Database mini app: E2E reference plan".

## Build

```sh
cd vault/spec
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
| `Step.lean` | Every op and the rules that accept or refuse it, publishing into a space's schema lane among them; the one order every peer replays in; strong removal: what a removal cuts, and which removals stand when they clash (`view`) |
| `Sync.lean` | What a peer sends a device: sync by caps, item by item, and the revocations that took its caps away |
| `Doc.lean` | Documents as histories: merge and promote, against the laws we rely on from Loro |
| `Lens.lean` | The markdown document and the todo in two schema versions and the lenses between them; items as stored, projected on read into each app's schema, and edits through each app's view; the lens laws (T9) |
| `Theorems.lean` | T1 to T8, T11 to T14, T16 and T17 |
| `Lemmas.lean` | The helper lemmas the proofs use: how a step changes a vault, ownership links and chains, what a step keeps that authorization reads, causal closure, the schema lane, replays |
| `KeyLemmas.lean` | The helper lemmas for the keys: what settling seals and publishes, `opens` finding every key `Knows` gives, acting for a vault through chains, the invariants behind T5 and T6, `EverReads` |
| `Examples.lean` | The plan's scenarios run on the model, including schema v2 (the schema lane, and a v2 app's edit of a document a v1 app wrote), one todo shared with several vaults and synced peer to peer, and strong removal: back-dated ops cut, clashes, a stolen passkey, the root handed on |
| `Vectors.lean` | Cases for the Rust core: ops applied in order (which the model accepts) and ops at the depths they claim (which stand in the view), with the state at the end; and lens cases: what each app reads from stored blocks and todos, and what its edits store |
| `VectorsCheck.lean`, `WriteVectors.lean` | Check the files in `vectors/` on every build; write them (`lake exe vectors`) |
| `vectors/vaults.json` | The cases with the model's answers, read by `vault-db/tests/vectors.rs` |
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
| T10 | Merge is the union of histories; promote gives the branch's content and keeps both | Proven | `promote_equals_branch` |
| T11 | Same ops in any order, same state | P6 | `same_ops_any_order_same_result`, `t11_convergence` |
| T12 | A peer sends a device only items it holds a cap on, and of other scopes only the revocations that took its caps away | P6 | `sync_sends_only_capped_items`, `t12_sync_shares_only_caps` |
| T13 | Two devices that synced both ways hold the same writes for every item they share | P6 | `item_syncs_peer_to_peer_without_server` |
| T14 | Accepted writes are causally closed: a write stands only with every write it builds on | Proven | `a_drop_takes_what_builds_on_it_along`, `t14_causally_closed`, the vectors |
| T16 | Strong removal: an op stands only if it also stands without what each later removal that hadn't seen it takes away, and every removal chosen stands | Proven | `a_removed_owner_cannot_backdate_governance`, `handing_the_root_on_cuts_the_old_passkeys_backdated_ops`, `t16_strong_removal`, the view vectors |
| T17 | Only a space's owners publish its schemas and lenses | Proven | `only_owners_publish_into_the_lane`, the vectors |

The Rust scenario tests (`vault-db/tests/scenarios.rs`) run the same scenarios as `Examples.lean`, on real devices
and keys in the Lab. The vectors (`vault-db/tests/vectors.rs`) hold the Rust rules to the model's answers op by op, and
in the view, where each op claims a depth: the model names vaults, spaces and grants by numbers and ops by their place,
the core by hashes, so the test maps each number to what its op created.

T3 is stated for reachable states, the replay of some ops from the empty state: an arbitrary state could list an owner
vault that doesn't exist, which no op can produce. Its proof carries that invariant (`OwnersExist`) along. T6 is
stated for reachable states too, and its proof carries `KeyInv` along: seals hold only keys that exist, what is
sealed to a space's key lies within the space, and every public family's current key is published. T5 follows the
whole history instead: every seal is justified by what was readable at some point (`SealsRead`). Devices encrypt each
edit under its entry's current key (the rules refuse an epoch that doesn't exist yet), so with T6 nothing written after
a removal opens for whoever it removed. Outside removals entitlements only grow, so by T6 no key goes stale: the Rust
key schedule looks for stale keys only after a removal, and `t6_forward_secrecy` checks that nothing else makes any.

Concurrent changes replay in one order (causal depth, removals first, then op hash), so they settle the same way on
every device. That alone doesn't stop a removed owner, or a thief holding a stolen passkey, from signing ops on an old
copy of the log that claim to come before the removal, so a removal cuts what it hadn't seen (T16). Every removal
(removing an owner or a device, revoking a grant, handing the root on) names the ops it had seen and keeps; every
other op before it in the replay order stands only if it also stands with what the removal takes away hidden, for
governance as for writes. When removals clash, the senior one stands: the vault's root, then its owners in the order
they joined, then removals no owner approved (a device leaving), then revocations.

A human vault's passkey is its root, named at genesis: it approves anything for its vault on its own, wins every
clash, and only it hands the root on (`setRoot`, which cuts what the old passkey signs on an old copy). A recovery
code is an optional second owner, never the root.

Documents and todos are projected on read, never migrated by a commit: two devices migrating at once could each drop
the other's new containers, and a default that a migration writes races a real edit. Each field stays in the
representation of the schema it was written under, v1's or v2's, or after concurrent edits both, where v2's wins; each
app reads the item through the lens into its own schema, so defaults live in the lens. An app's edit goes back through
its view and writes only what changed (T9f, T9g), so no default is ever written, and an older app's edit keeps what it
can't see (T9h). The model covers edits in place; inserting, deleting and moving blocks are tested in Rust. The
schemas and lenses are blobs named by their hash that hold no data, published into the space's schema lane by an
owner of the space (T17).

## Assumptions

None are axioms; each is part of the model:

- Signatures can't be forged: an op's signers are the keys that signed it.
- Sealed or encrypted data reveals nothing without its key: a key is learned only through `Knows`.
- Ids don't collide: a `Nodup` hypothesis where a theorem needs it.
- Loro converges, and can revert a document to any version it contains: fields of the `Loro` structure.

What the proofs don't cover: the Rust and Loro code itself (the tests and the shared Lean ⇄ Rust test vectors do, for
the vault rules from P1, for the lenses from P4, and for the rest by P6), timing and traffic analysis, and a device
compromised while it still holds its keys.

## Phases

Each phase is one PR, merged only when its Rust tests pass and its theorems are proven without `sorry`. Until then
its tests are ignored with the phase as the reason, so `cargo test -p vault-db --no-fail-fast -- --ignored` lists
what is still red.

| Phase | Builds | Proves |
|---|---|---|
| P0 | This spec, the `vault-db` API as stubs, every test | Statements compile, scenarios check |
| P1 | Vaults, vault logs, chains; op ids and signatures (device keys, passkeys through the WebAuthn envelope, recovery codes); vectors for the vault rules | T2, T3 |
| P2 | Spaces, grants, revocation with strong removal, the passkey as root, Public, write checks with causal closure, what each device may receive | T1, T4, T8, T14, T16 |
| P3 | Keys, sealing, encryption of every edit, rotation | T5, T6, T7 |
| P4 | Schemas and lenses projected on read, edits through each app's view, the schema lane | T9, T17 |
| P5 | History, branches, merge, promote | T10 in Rust |
| P6 | Offline devices, random delivery orders, Lean ⇄ Rust vectors for the rest | T11, T12, T13 |
| P7 | The Database tile | |
| P8 | Sync on its own iroh ALPN with the bytes in iroh-blobs, passkeys from the browser's WebAuthn | |

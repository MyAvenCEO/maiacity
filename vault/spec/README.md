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
fails when a proof breaks or when a scenario check in `Examples.lean` (`#guard`) doesn't hold. Each
`declaration uses 'sorry'` warning is a theorem whose proof belongs to a later phase.

## Files

| File | What it holds |
|---|---|
| `Basic.lean` | Ids, principals (signers and vaults), roles relay < read < write < owner, scopes (a space or one entry), grantees, key names |
| `State.lean` | What a peer knows; acting for a vault, approving for it by threshold, holding a cap; symbolic keys (`Knows`), rotation and sealing |
| `Step.lean` | Every op and the rules that accept or refuse it; the one order every peer replays in |
| `Sync.lean` | What a peer sends a device: sync by caps, item by item |
| `Doc.lean` | Documents as histories: merge and promote, against the laws we rely on from Loro |
| `Lens.lean` | The markdown document and the todo in two schema versions, and the lenses between them |
| `Theorems.lean` | T1 to T8 and T11 to T13 |
| `Examples.lean` | The plan's scenarios run on the model, including one todo shared with several vaults and synced peer to peer |

## Theorems

| # | What must always hold | Status | Guarded in Rust by |
|---|---|---|---|
| T1 | Only authorized writes are accepted, and revocation wins over what it hadn't seen | P2 | `write_without_cap_rejected_on_import`, `t1_authorized_writes` |
| T2 | Governance needs the vault's threshold plus the newcomer's consent; devices can't govern | P1 | `add_owner_needs_threshold_and_consent`, `device_cannot_govern`, `t2_consent` |
| T3 | No ownership cycles | P1 | `ownership_cycle_rejected`, `t3_no_cycles` |
| T4 | Grants name vaults, never signers | P2 | `grant_to_signer_rejected`, `t4_grants_name_vaults_and_t8_public_read_only` |
| T5 | A device opens a key only if it was entitled to it at that epoch or a later one, or the key was public | P3 | `entry_reader_cannot_open_other_entries` |
| T6 | Forward secrecy on removal: the current key opens only for devices entitled now | P3 | `revoked_reader_cannot_open_new_edits` |
| T7 | Blind server: a device whose vaults hold no read opens only public keys | Proven from T5 | `server_holds_only_ciphertext` |
| T8 | Public is read-only | P2 | `public_is_read_only` |
| T9 | Lens laws: round trips and idempotent migration | Proven | `lens_round_trip_v1`, `migration_is_idempotent` |
| T10 | Merge is the union of histories; promote gives the branch's content and keeps both | Proven | `promote_equals_branch` |
| T11 | Same ops in any order, same state | P6 | `same_ops_any_order_same_result`, `t11_convergence` |
| T12 | A peer sends a device only items it holds a cap on | P6 | `sync_sends_only_capped_items`, `t12_sync_shares_only_caps` |
| T13 | Two devices that synced both ways hold the same writes for every item they share | P6 | `item_syncs_peer_to_peer_without_server` |

The Rust scenario tests (`vault-db/tests/scenarios.rs`) run the same scenarios as `Examples.lean`, on real devices
and keys in the Lab.

## Assumptions

None are axioms; each is part of the model:

- Signatures can't be forged: an op's signers are the keys that signed it.
- Sealed or encrypted data reveals nothing without its key: a key is learned only through `Knows`.
- Ids don't collide: a `Nodup` hypothesis where a theorem needs it.
- Loro converges, and can revert a document to any version it contains: fields of the `Loro` structure.

What the proofs don't cover: the Rust and Loro code itself (the tests and, from P6, shared Lean ⇄ Rust test vectors
do), timing and traffic analysis, and a device compromised while it still holds its keys.

## Phases

Each phase is one PR, merged only when its Rust tests pass and its theorems are proven without `sorry`. Until then
its tests are ignored with the phase as the reason, so `cargo test -p vault-db --no-fail-fast -- --ignored` lists
what is still red.

| Phase | Builds | Proves |
|---|---|---|
| P0 | This spec, the `vault-db` API as stubs, every test | Statements compile, scenarios check |
| P1 | Vaults, vault logs, chains | T2, T3 |
| P2 | Spaces, grants, revocation, Public, write checks, what each device may receive | T1, T4, T8 |
| P3 | Keys, sealing, encryption of every edit, rotation | T5, T6, T7 |
| P4 | The Loro document and todo, schemas, lenses | T9 in Rust |
| P5 | History, branches, merge, promote | T10 in Rust |
| P6 | Offline devices, random delivery orders, Lean ⇄ Rust vectors | T11, T12, T13 |
| P7 | The Database tile | |
| P8 | Sync on its own iroh ALPN with the bytes in iroh-blobs, passkeys through WebAuthn | |

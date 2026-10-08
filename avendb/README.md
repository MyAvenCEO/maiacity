# avenDB

The user-owned, end-to-end encrypted database of maia.city. Passkeys and devices own vaults, vaults hold caps on
spaces and single entries, every item is a Loro document whose edits are encrypted under the item's own key, and each
device syncs exactly the items its vaults hold caps on, so servers and relays only ever see ciphertext.

avenDB is its own package in the maiacity repo, apart from the media vault in `vault/`: it has its own Cargo workspace
and lockfile, so the two never build together, and nothing here changes what the media vault, its server or the Studio
app run. Everything avenDB needs lives here: its encryption and passkeys, schemas and lenses, Loro documents and their
history and branches, and, from P8, its own iroh networking (its own ALPN, its own iroh versions and TLS crypto).

## Layout

| Path | What it holds |
|---|---|
| `crates/avendb` | The core: the rules every peer applies (`policy`), keys and encryption (`keys`), signatures and passkeys (`sign`), Loro items (`doc`), schemas and lenses (`lens`), history and branches (`branch`), sync by caps (`sync`), and the Lab the scenario tests run on (`lab`) |
| `spec/` | The Lean model the core is built against, test-first: the rules, the theorems (T1 to T18) and the test vectors both sides replay (see `spec/README.md`) |
| `docs/` | The research and the first plan that led here (`VERSIONING-RESEARCH.md`, `DATABASE-PLAN.md`), kept for their reasoning |

## Build and test

```sh
cd avendb
cargo test                      # every Rust test
cargo test -- --ignored         # the tests later phases still owe
cd spec && lake build           # the Lean model: proofs, scenario checks, test vectors
```

The Lean build needs [elan](https://github.com/leanprover/elan) (`spec/lean-toolchain` pins the version). After a change
to the rules, `lake exe vectors` in `spec/` writes the vectors again; commit them with the change.

## Plan

The plan with every scenario, theorem and phase is the Claude Doc
[avenDB: E2E reference plan](https://claude.ai/code/artifact/5e95ec82-8564-4340-8767-7b915afafe59), and the
architecture behind it is [avenDB architecture](https://claude.ai/code/artifact/4bfecd2f-d33f-4497-981c-77d4ea4d623c).
Each phase is one PR, merged when its Rust tests pass and its theorems are proven:

| Phase | What it builds | State |
|---|---|---|
| P0 to P4 | The spec and the API, vaults and signatures, caps and sync by caps, keys and encrypted edits, schemas and lenses | Merged |
| P4b | Post-quantum hardening: SHA-3 ids and hashes, a hash-based signature beside every classical one but a write's, checkpoints that vouch for the writes (T18), a McEliece share beside X-Wing in every key box; the passkey as the only way back in, device keys derived from it at every unlock | Merged |
| P5 | History, branches, merge, promote | Next |
| P6 | Offline devices, random delivery orders, Lean ⇄ Rust vectors for the rest | |
| P7 | The avenDB tile | |
| P8 | Sync on avenDB's own iroh ALPN with X25519MLKEM768 on every connection, bytes in iroh-blobs, the server peer in its own container beside the media vault's | |

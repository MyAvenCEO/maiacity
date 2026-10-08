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
| `crates/avendb` | The core: the rules every peer applies (`policy`), keys and encryption (`keys`), signatures and passkeys (`sign`), Loro items (`doc`), schemas and lenses (`lens`), history and branches (`branch`), sync by caps and by each log's frontier (`sync`), every message between devices as bytes (`wire`), and the Lab the scenario tests run on (`lab`) |
| `crates/avendb-net` | avenDB on the network: each device a node on an iroh endpoint of its own ed25519 key, X25519MLKEM768 the only key exchange, a hello that proves the device on every connection, sync by caps, the McEliece keys in iroh-blobs behind a gate, and announcements of changed digests to each peer that may hold the log |
| `crates/avendb-web` | The core in a web page, as WebAssembly: the tile's world made a step at a time, read through JSON views and changed through JSON actions, on whichever device the page picks |
| `scripts/build-web.sh` | Builds `avendb-web` into the tile's package, `src/lib/avendb/pkg/` in the app (committed, so the app builds without Rust) |
| `spec/` | The Lean model the core is built against, test-first: the rules, the theorems (T1 to T19) and the test vectors both sides replay (see `spec/README.md`) |
| `docs/` | The research and the first plan that led here (`VERSIONING-RESEARCH.md`, `DATABASE-PLAN.md`), kept for their reasoning |

## Build and test

```sh
cd avendb
cargo test                      # every Rust test, the nodes on iroh among them (over loopback, no network needed)
cargo test -- --ignored         # the tests later phases still owe
cd spec && lake build           # the Lean model: proofs, scenario checks, test vectors
```

The avenDB tile (`/app/avendb/` in the app, for admins) runs the core in the page. After a change to the core, build its
package again and walk the tile's screens in a headless Chrome:

```sh
cd avendb && ./scripts/build-web.sh     # needs the wasm32-unknown-unknown target and wasm-bindgen-cli 0.2.129
cd .. && node scripts/avendb-smoke.mjs  # starts a dev server, checks every screen, screenshots in build/avendb-smoke
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
| P5 | History and branches: every write a commit on a line of its entry's history, branches from any version, merge, promote, revert and restore, undo of an older commit, forks into another space (T10) | Merged |
| P6 | Sync log by log: every op builds on the frontier of its own log (a vault's, a space's or an entry's), a device asks with its frontier of each log and a few ops further back and is sent only what it lacks (T19), devices gossip one digest per log, a device restored from an old backup is flagged when it signs again (a fork); offline devices, random delivery orders, partial delivery, Lean ⇄ Rust vectors for sync (T11, T12, T13); a device that has seen a revocation writes under the new key (T15) | Merged |
| P7 | The avenDB tile: the Lab's whole world in one page, as WebAssembly in the page's workers, every device side by side; pick one and act as it: vaults and the passkeys that sign their changes, spaces, entries read and edited as each app version sees them, history, branches, access and why, todos, schemas and lenses, sync, locked and offline devices, and the plan's scenarios played green | Merged |
| P8a | Devices on avenDB's own iroh: one encoding for every message between devices, fuzzed; each device a node on an iroh endpoint of its own ed25519 key with X25519MLKEM768 as the only key exchange, and a hello on every connection that proves the device by its SLH-DSA signature over the TLS exporter; sync by caps over avenDB's own ALPN, the McEliece keys in iroh-blobs, handed out only within reach; a node announces each changed digest straight to each peer that may hold the log, not over iroh-gossip, whose topics would tell every member of a log; scenarios 5 and 17 between nodes on one machine | Merged |
| P8b | The server peer in its own container beside the media vault's, as relay (with access control), mailbox and witness, holding only ciphertext; each node's store on disk; linking a device by QR code; keys in the device's secure boundary; a ProVerif model of the hello; scenarios 5 and 17 between this Mac, a second device and the server | Next |

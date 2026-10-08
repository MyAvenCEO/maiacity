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
| `crates/avendb-net` | avenDB on the network: each device a node on an iroh endpoint of its own ed25519 key, X25519MLKEM768 the only key exchange, a hello that proves the device on every connection, sync by caps, the McEliece keys in iroh-blobs behind a gate, announcements of changed digests to each peer that may hold the log, each node's store on disk, and the server's node (`server`) |
| `crates/avendb-server` | avenDB's server as its binary runs it: its node in a folder of its own, and its relay, which lets in only the devices the server knows (see [The server](#the-server)) |
| `Dockerfile.server`, `compose.yml` | The server's image, built from `avendb/` alone, and a compose file that runs it on this machine; neither is deployed |
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

## The server

`crates/avendb-server` is avenDB's server: a node in a folder of its own and, beside it, its relay. It holds only
ciphertext and opens nothing but what is public.

- At its first start it makes its device's secret (`device.key`, readable by its owner alone) and founds its vault with
  an owner key it then forgets, so nobody changes that vault after, not even whoever takes its disk. It logs its
  endpoint id: devices need that id, and the relay's URL, to reach it.
- A device takes the server's contact card, its vault's log, and can then grant it relay on a space. The server keeps
  that space's ops and McEliece keys and serves them to the devices that may hold them, also while the device that
  wrote them is away.
- Its relay lets in only the devices the server knows: those of the vaults acting in the spaces it relays, and itself.
  A device the server doesn't know yet makes its first contact straight, over UDP. A device taken out of its vault is
  let go, and turned away when it tries again.
- A device with no UDP of its own, behind a strict firewall say, reaches the server and every other device through the
  relay alone.

On this machine: `docker compose -f compose.yml up --build` in `avendb/` runs it with iroh on UDP 7401 and the relay's
plain HTTP on port 3350. Its environment:

| Variable | Default | What it says |
|---|---|---|
| `AVENDB_DATA` | `/data` | Its folder: its device's secret and its store |
| `AVENDB_BIND` | `0.0.0.0:7401` | The UDP socket of its iroh endpoint, where devices on UDP reach it straight |
| `AVENDB_RELAY_BIND` | `0.0.0.0:3350` | The socket its relay serves plain HTTP on, behind the proxy that ends TLS |
| `AVENDB_RELAY_URL` | the relay's own socket | Where devices reach the relay, `https://avendb.maia.city` once deployed |
| `RUST_LOG` | `info` | How much it logs |

### Deploying the server

The server isn't deployed: each of these steps changes production, so each waits on an explicit go. It runs beside the
media vault's server and changes nothing of it.

1. **DNS**: `avendb.maia.city` pointing at the server, as `api.maia.city` does. The relay needs a host name of its own,
   as iroh's relay path is `/relay`, and `api.maia.city/relay` is the media vault's relay.
2. **Caddy** (`deploy/Caddyfile`): a site `avendb.maia.city` with `reverse_proxy avendb:3350`. Caddy 2.10 and later
   (`caddy:2-alpine`) offers X25519MLKEM768, the only key exchange a device offers.
3. **Firewall** (`infra/index.ts`): UDP 7401 open, as UDP 7400 is for the media vault.
4. **Compose and image**: a service `avendb` from this image in the root compose files, with
   `AVENDB_RELAY_URL=https://avendb.maia.city`, a volume for `/data` and `7401:7401/udp`; a workflow job that builds
   the image from `avendb/` and pushes it beside the media vault's; and `deploy/backup.sh` backing up its volume.
5. **Devices**: the endpoint id it logs at its first start goes into the devices' configuration.

Its volume holds the server's device secret. Losing it makes a new server with a new vault, which every space it
relayed must grant relay again.

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
| P8b | The server: a node in a folder of its own that keeps its device's secret and its store, founds its vault at its first start with an owner key it then forgets, and hands out its contact card so that a device can grant it relay on a space; its relay, which lets in only the devices of the vaults acting in the spaces it relays and lets go of a device taken out of its vault; each node's store on disk (append-only, a torn record cut back, a forged op dropped); peers out of reach tried less and less often; scenario 5 through the relay alone; the server's image, not deployed | Merged |
| P8c | Linking a device by QR code; keys in the device's secure boundary; a ProVerif model of the hello and the seals; the server deployed, once that has its go, and scenarios 5 and 17 between this Mac, a second device and the server | Next |

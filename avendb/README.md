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
| `crates/avendb-net` | avenDB on the network: each device a node on an iroh endpoint of its own ed25519 key, X25519MLKEM768 the only key exchange, a hello that proves the device on every connection, sync by caps, the McEliece keys in iroh-blobs behind a gate, announcements of changed digests to each peer that may hold the log, linking a new device by its passkey (see [Linking a device](#linking-a-device)), each node's store on disk, and the server's node (`server`) |
| `crates/avendb-server` | avenDB's server as its binary runs it: its node in a folder of its own, and its relay, which lets in only the devices the server knows (see [The server](#the-server)) |
| `crates/avendb-browser` | A device of its person in a web page: the network crate as WebAssembly, its node reaching every peer through the server's relay (see [A device in the browser](#a-device-in-the-browser)) |
| `Dockerfile.server`, `compose.yml` | The server's image, built from `avendb/` alone, and a compose file that runs it on this machine; neither is deployed |
| `crates/avendb-web` | The core in a web page, as WebAssembly: the tile's world made a step at a time, read through JSON views and changed through JSON actions, on whichever device the page picks |
| `scripts/build-web.sh` | Builds `avendb-web` into the tile's package, `src/lib/avendb/pkg/` in the app (committed, so the app builds without Rust) |
| `scripts/test-browser.sh` | Builds `avendb-browser` for the browser and runs its test page in headless Chromium |
| `spec/` | The Lean model the core is built against, test-first: the rules, the theorems (T1 to T20) and the test vectors both sides replay; and in `spec/protocol/`, Verifpal models of the hello, the link and the sealed box (see `spec/README.md`) |
| `docs/` | The research and the first plan that led here (`VERSIONING-RESEARCH.md`, `DATABASE-PLAN.md`), kept for their reasoning |

## Build and test

```sh
cd avendb
cargo test                      # every Rust test, the nodes on iroh among them (over loopback, no network needed)
cargo test -- --ignored         # the tests later phases still owe, and the Chromium test below
./scripts/test-browser.sh       # two browsers' devices in headless Chromium, linking and syncing through the relay
cd spec && lake build           # the Lean model: proofs, scenario checks, test vectors
cd protocol && ./check.sh       # the protocol models, against Verifpal 1.6.5 (minutes)
```

The avenDB tile (`/app/avendb/` in the app, for admins) runs the core in the page. After a change to the core, build its
package again and walk the tile's screens in a headless Chrome:

```sh
cd avendb && ./scripts/build-web.sh     # needs the wasm32-unknown-unknown target and wasm-bindgen-cli 0.2.129
cd .. && node scripts/avendb-smoke.mjs  # starts a dev server, checks every screen, screenshots in build/avendb-smoke
```

The Lean build needs [elan](https://github.com/leanprover/elan) (`spec/lean-toolchain` pins the version). After a change
to the rules, `lake exe vectors` in `spec/` writes the vectors again; commit them with the change.

## Linking a device

A new device joins its person's vault by their passkey alone (P8c): through any device that holds the vault's log, or
through the server once every other device is lost.

1. A device that holds the vault, Samuel's Mac say, shows its offer as a QR code (`Node::offer`, text `AVENDB1…` in the
   code's alphanumeric mode): its device, its endpoint and where to reach it. The app knows the server's offer, which
   the server logs as it starts.
2. The new device scans it, connects, and both devices say their hellos. Then the new device says its passkey's hello:
   a WebAuthn assertion and an SLH-DSA signature, both over a hash of which end it speaks for, the connection's TLS
   exporter and the new device (`PasskeyHello`). Said on another connection, for the other end or for another device,
   it proves nothing.
3. The peer checks it against the passkey its vaults name and hands back the link card: the logs of the vaults the
   passkey owns and of those that own them, up the chains, and nothing about any space or entry (T20).
4. The new device adds itself to the vault the passkey is the root of, signed by the passkey and by itself (`join`),
   and sends that op with its McEliece key. The peer takes it only for the device on the connection, and only if the
   rules take it (`accept_join`); it boxes the vault key for the new device, and the two sync by caps.

A device the server doesn't know yet reaches it straight, over UDP, as its relay lets in only the devices it knows,
or, with no UDP of its own, as in a browser, through the relay by its passkey's pass (see
[A device in the browser](#a-device-in-the-browser)). Once the device has joined, the relay lets it in. A forged code
gains an attacker nothing: the passkey's hello names the new device and the connection, and every op of a card is
signed.

## A device in the browser

`crates/avendb-browser` is a device of its person in a web page (P8d): the network crate as WebAssembly, so a page is a
device of its own, as a Mac or a phone is.

- A page has no UDP, so its node reaches every peer through the server's relay. The relay lets in only the devices the
  server knows, so a new device shows it a pass its person's passkey signed (`sign::RelayPass`): a WebAuthn assertion
  and an SLH-DSA signature over the device's endpoint and the time. The relay honours it for ten minutes, and only for
  a passkey that is the root of a vault the server knows. Replayed, it lets in that same endpoint and no other. The pass
  rides in iroh's relay handshake, as its auth token, so the relay needs no route of its own. Once the device joined its
  vault, the server knows it, and it needs no pass.
- It links as any new device does: it takes the code another device of its person shows, a Mac's or another
  browser's, its passkey says its hello on their connection, it joins the vault, and they sync. Then the page reads
  and edits documents, and shows its own code, through which the next device links.
- Its TLS is rustls with ring, as aws-lc-rs doesn't build for a browser, and X25519MLKEM768 is written in pure Rust
  (`avendb_net::kx`, checked against aws-lc-rs's). Its tasks and timers run on the page's event loop.
- A big answer comes a page at a time, a few MiB (`Options::page`), each op after the ops it builds on, so a device
  takes each page as it comes and never holds a whole vault's answer at once.

Not yet (P8e): the passkey is a software passkey, brought into the page by its secret, as a platform syncs a passkey
between its person's devices; the browser's own WebAuthn, with its PRF extension, takes its place in the tile. The
device's store is in memory, so a page links again each time it opens, until IndexedDB keeps it.

`scripts/test-browser.sh` builds it (it needs the wasm32-unknown-unknown target, wasm-bindgen-cli 0.2.129 and Chromium,
Playwright's or `$AVENDB_CHROMIUM`) and runs `tests/page.rs`: a relay, the server and Samuel's Mac on this machine, and
two pages in headless Chromium. The first links through the Mac's code, reads Welcome and edits it, and reads the Mac's
answer; the second links through the first page's code, browser to browser, through the relay alone.

## The device's secure boundary

A device's secrets stay in its memory, and only while it needs them (P8c):

- Nothing on disk, in a view, a log line or a debug print holds one: a node's store holds signed ops and McEliece
  public keys, a key prints as its id, and the tile's views show none (`no_view_shows_a_secret`). The server's device
  secret is the one exception, in its folder, readable by its owner alone.
- Every key wipes itself as it is dropped: a key's 32 bytes, a device's and a passkey's keys, and the hash states,
  ciphers and temporaries that held one.
- A locked device holds no key, nothing a key opened, and no McEliece secret half of a key nothing else in its process
  holds, so what it held stays sealed by both schemes. Unlocking derives its keys again from the passkey and makes
  again the pairs it needs, most of a second each.
- Its randomness keeps one key, which every draw replaces with a hash of it, so a copy of the device's memory draws on
  from there and never again what it drew. Unlocking reseeds it with the device's own key, which only the passkey
  derives, so a copy taken while the device was locked doesn't foresee what it draws after. A Lab on a machine keeps no
  entropy.

Wiping goes as far as Rust lets it: a value that moves leaves its old bytes behind until they are overwritten, and the
items a key opened are dropped at lock, not wiped (their memory is Loro's). The passkey lives in the platform's
authenticator, and a device sees its PRF output only during a ceremony. Keys held in the device's own secure chip,
memory kept out of swap and core dumps turned off belong to the app that runs a node on the device.

## The server

`crates/avendb-server` is avenDB's server: a node in a folder of its own and, beside it, its relay. It holds only
ciphertext and opens nothing but what is public.

- At its first start it makes its device's secret (`device.key`, readable by its owner alone) and founds its vault with
  an owner key it then forgets, so nobody changes that vault after, not even whoever takes its disk. It logs its
  offer (`AVENDB1…`): its device, its endpoint, its public address and its relay. The app keeps it, so that devices
  reach the server, and a new device links through it with its person's passkey alone.
- A device takes the server's contact card, its vault's log, and can then grant it relay on a space. The server keeps
  that space's ops and McEliece keys and serves them to the devices that may hold them, also while the device that
  wrote them is away.
- Its relay lets in only the devices the server knows: those of the vaults acting in the spaces it relays, and itself.
  A device the server doesn't know yet makes its first contact straight, over UDP, or through the relay by a pass its
  person's passkey signed, for ten minutes. A device taken out of its vault is let go, and turned away when it tries
  again.
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
| `AVENDB_PUBLIC_ADDR` | its interfaces' addresses | Where devices on UDP reach it from the internet, the server's IP and port 7401, as its offer says |
| `RUST_LOG` | `info` | How much it logs |

### Deploying the server

The server isn't deployed: each of these steps changes production, so each waits on an explicit go. It runs beside the
media vault's server and changes nothing of it.

1. **DNS** (Hetzner DNS): an A record `avendb.maia.city` for the server, as `api.yml`'s `dns` job keeps
   `api.maia.city`'s, or set by hand in the Hetzner DNS console. The relay needs a host name of its own: iroh's relay
   path is `/relay`, and `api.maia.city/relay` is the media vault's relay.
2. **Caddy** (`deploy/Caddyfile`): a site `avendb.maia.city` with `reverse_proxy avendb:3350`. Caddy 2.10 and later
   (`caddy:2-alpine`) offers X25519MLKEM768, the only key exchange a device offers.
3. **Firewall** (`infra/index.ts`): UDP 7401 open, as UDP 7400 is for the media vault.
4. **Compose and image**: a service `avendb` from this image in the root compose files, with
   `AVENDB_RELAY_URL=https://avendb.maia.city`, `AVENDB_PUBLIC_ADDR` set to the server's IP and port 7401, a volume for
   `/data` and `7401:7401/udp`; a workflow job that builds the image from `avendb/` and pushes it beside the media
   vault's; and `deploy/backup.sh` backing up its volume.
5. **Devices**: the offer it logs as it starts goes into the app's configuration.

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
| P8c | Linking a new device by its passkey alone, through a device's QR code or the server's offer: the passkey's hello on the connection, the link card of its vaults' logs (T20), the join the peer takes only for the device on the connection; recovery through the server; keys in the device's secure boundary (wiped as they are dropped, none left once a device locks, randomness no copy rewinds or foresees, no secret in any view); Verifpal models of the hello, the link and the sealed box with the curves broken (Verifpal rather than ProVerif, which has no package here) | Merged |
| P8d | A device in the browser: the network crate as WebAssembly, with X25519MLKEM768 in pure Rust; a new device with no UDP let onto the server's relay by its passkey's pass; big answers a page at a time, each op after its past; two pages in Chromium that link through the relay alone, the second through the first one's code, and sync | Merged |
| P8e | The tile as a real device: the browser's passkeys (WebAuthn with PRF) in place of the software passkey, its store in IndexedDB, linking by QR code in the tile | Next |
| P8f | The server deployed, once that has its go, and scenarios 5 and 17 between this Mac, a second device and the server | |

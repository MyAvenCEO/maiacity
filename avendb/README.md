# avenDB

The user-owned, end-to-end encrypted, local-first database of maia.city. Who may do what is built from four
primitives: a vault (an identity, like a smart account), owning (who decides for a vault), a device (a key that signs
for its vault with all its rights and governs nothing) and a share (a named group of ops on a slice of a vault, resting
on a share its issuer holds). One kind table says what each kind of vault may be (`policy::Kind::rules`): a human vault
is a person's, owned by their passkeys, with their devices; a coop vault is owned by human and coop vaults; an aven, the
person's one AI identity, is owned by their human vault alone, one to a person, and holds no devices; and a device
vault, owned by one human, coop or aven vault, holds the keys of one agent or of the server. An agent, as agentClaude,
is a device vault under its person's aven, holding sub caps of the aven's shares; the server is the device of avenCEO
server, the device vault at the end of the seed. A vault is a flat library of entries, each a Loro document whose type
and tags travel sealed inside its writes. Shares give a vault, or everyone, a level on any slice of a vault: relay,
backup, read, write or owner; a keep share tells one device what to sync; an access request is a record shared with
the vault asked. Least access is the default, and the server and relays only ever see ciphertext.

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is the one reference for how avenDB works, from first principles, and
[`spec/README.md`](spec/README.md) lists every theorem with the Rust tests that guard it. This file says how to build,
test, run and deploy it.

avenDB is its own package in the maiacity repo, apart from the media vault in `vault/`: it has its own Cargo workspace
and lockfile, so the two never build together, and nothing here changes what the media vault, its server or the Studio
app run. Everything avenDB needs lives here: its encryption and passkeys, schemas and lenses, Loro documents and their
history and proposals, and its own iroh networking (its own ALPN, its own iroh versions and TLS crypto).

## Layout

| Path | What it holds |
|---|---|
| `crates/avendb` | The core: the rules every peer applies (`policy`), shares as named groups of ops (`rules`, `slice`), keys and encryption (`keys`), files sealed as blobs (`sealed`), signatures and passkeys (`sign`), the master recovery key (`recovery`, `bin/master-key`), ids, hashes and the one encoding of an edit (`id`, `hash`, `encode`), Loro items (`doc`), schemas and lenses (`lens`), history and proposals (`history`, `merge`), sync by shares and by each log's frontier (`sync`), every message between devices as bytes (`wire`), one JSON language over records (`ops`), the one API, `run(op)` (`engine`), a device's world, database and words as its page reads them (`world`, `data`, `words`), and the Lab every device and test runs on (`lab`), with the plan's scenarios and their cast (`scenarios`, `cast`) |
| `crates/avendb-net` | avenDB on the network: each device a node on an iroh endpoint of its own ed25519 key, X25519MLKEM768 the only key exchange, a hello that proves the device on every connection, sync by shares and keep shares, McEliece keys and file pieces in iroh-blobs behind a gate, each device's holdings told to each peer that may know them (`holdings`), and signed, kept and passed on (`statements`), linking a new device by its passkey, `Node::run`, the jobs it runs in the background (`jobs`), each place's shelf (OPFS, a folder or the server's bucket), and the server's node (`server`) |
| `crates/avendb-server` | avenDB's server as its binary runs it: its node on its shelf, its bucket's S3 client (`bucket`), its relay, which lets in only the devices the server knows, and the Maia Universe's feed (`feed`) (see [The server](#the-server)) |
| `crates/avendb-browser` | A device of its person in a web page: the network crate as WebAssembly, its node reaching every peer through the server's relay, `PageDevice.run` (see [A device in the browser](#a-device-in-the-browser)) |
| `crates/avendb-device` | The same device run natively beside the Mac app, as its sidecar, its calls in lines of JSON (see [Natively, beside the Mac app](#natively-beside-the-mac-app)); the agents' devices, each the MCP server of its harness (`agent`), and the drives it hosts (`drive`) |
| `Dockerfile.server`, `compose.yml` | The server's image, built from `avendb/` alone, which `avendb.yml` deploys (see [Deploying the server](#deploying-the-server)), and a compose file that runs it on this machine, which is not deployed |
| `scripts/build-web.sh` | Builds `avendb-browser` into the page's own device, `src/lib/avendb/device/` in the app (committed, so the app builds without Rust) |
| `scripts/test-browser.sh` | Builds `avendb-browser` for the browser and runs its test page in headless Chromium |
| `spec/` | The Lean model the core is built against, test-first: the rules, the theorems (T1 to T28, K1, H1, H2, O1 to O3, C1 to C4, S1 to S4) and the test vectors both sides replay; and in `spec/protocol/`, Verifpal models of the hello, the link and the sealed box (see `spec/README.md`) |
| `docs/ARCHITECTURE.md` | The design as it ships, section by section, each claim tied to the code or the theorem that holds it |

## Build and test

```sh
cd avendb
cargo test                      # every Rust test, the nodes on iroh among them (over loopback, no network needed)
cargo test -p avendb-net --test files -- --ignored  # the other test it skips: it writes 2 GB to the temporary folder
./scripts/test-browser.sh       # browsers' devices in headless Chromium, linking and syncing through the relay
cd spec && lake build           # the Lean model: proofs, scenario checks, test vectors
cd protocol && ./check.sh       # the protocol models, against Verifpal 1.6.5 (minutes)
```

avenDB's page (`/app/avendb/` in the app, for admins) is a device of its person, `avendb-browser` built into the app
(see [A device in the browser](#a-device-in-the-browser)): it syncs the moment anything changes, with no button to
press. After a change to the core, the network crate or the browser crate, build it again and check the page in a
headless Chrome:

```sh
cd avendb && ./scripts/build-web.sh     # needs the wasm32-unknown-unknown target and wasm-bindgen-cli 0.2.129
cd .. && node scripts/avendb-smoke.mjs  # starts a dev server, opens the page, screenshots in build/avendb-smoke
```

`scripts/avendb-account.mjs` walks the account itself against an avenDB server on the same machine: founding the
person's vault, a note with its proposals, variants and history, the vaults it owns, acting as each, sharing a note
alone and every todo tagged one way, tagging, revoking, signing in again; its header says how to build and start both.
It needs a device built with passkeys of localhost. `scripts/avendb-native.mjs` walks much the same story through the
native device, as the Mac app runs it, each sheet answered by a passkey of maia.city's, so it runs on the device as it
ships.

The Lean build needs [elan](https://github.com/leanprover/elan) (`spec/lean-toolchain` pins the version). After a change
to the rules, `lake exe vectors` in `spec/` writes the vectors again; commit them with the change.

## The master recovery key

One master recovery key is the way back in beside the passkeys (Samuel, 2026-10-13): every human vault is founded with
it among its owners ([ARCHITECTURE.md](docs/ARCHITECTURE.md) §3). It is a signer like any other, a passkey kept in
software (`avendb::recovery`), whose signing keys and seal key all derive from 32 secret bytes. Its person makes it on a
machine of their own, from `avendb/`:

```sh
cargo run --release -p avendb --bin master-key -- new ~/Desktop/master-recovery
cargo run --release -p avendb --bin master-key -- id ~/Desktop/master-recovery.pub
```

`new` prints the secret in the terminal, 64 hex digits to copy and keep offline, and writes it nowhere. Its one file is
`master-recovery.pub`, the public half every vault needs: its P-256 and SLH-DSA keys, its X-Wing and Classic McEliece
keys, a megabyte, and its standing consent to be added as an owner. `new` never writes over a file. `pub` asks for the
secret and makes the `.pub` file again, over one of an older format alone; `id` names the key a `.pub` file holds, or,
with no file, the secret it asks for. Whoever holds the secret owns every vault that added the key: only the `.pub` file
is handed on.

The key's file is built in (`crates/avendb/master-recovery.pub`, `recovery::master`); an empty file builds avenDB
without one. Every key of it is derived with BLAKE3, so a file of the format before edit version 10 is made again with
`pub`. A vault's settings show it among the owners as the master recovery key, and its person removes it, or adds it again, as any
owner: the ops `revoke {vault, owner}` and `share {over, who: {"signer": id}, level: "Owner", what: "everything"}`.

## A device in the browser

`crates/avendb-browser` is a device of its person in a web page: the network crate as WebAssembly, so a page is a
device of its own, as a Mac or a phone is. A page has no UDP, so its node reaches every peer through the server's
relay, which lets a new device in by its passkey's pass ([ARCHITECTURE.md](docs/ARCHITECTURE.md) §11 and §12). Its TLS
is rustls with ring, as aws-lc-rs doesn't build for a browser, and X25519MLKEM768 is written in pure Rust
(`avendb_net::kx`, checked against aws-lc-rs's). Its tasks and timers run on the page's event loop.

A device starts in one of three ways; everything after is one op through `PageDevice.run`
([ARCHITECTURE.md](docs/ARCHITECTURE.md) §8).

- **Found** (`Device::found`, `Node::found_with`): a new person's first browser founds their human vault with the
  passkey they signed up to maiaCITY with, or one it makes, gives avenCEO server, the server's vault, backup on the
  whole of it, so the server keeps its ciphertext, or, if the person turned backups off at setup, relay, so the server
  only lets their devices through and helps them find each other, and writes its card there, in two ceremonies: the
  unlock, which is the pass to the relay, and one for the vault's genesis and the edit that adds the device together
  (three with a new passkey). The server's relay lets any passkey's pass in while it is open to sign-up
  (`AVENDB_SIGNUP`, open by default), so a person with no device yet gets in. The first person to found their vault
  through a server nobody has claimed yet claims it in that same ceremony, founding the seed, Maia Holding GmbH, avenCEO
  GmbH and avenCEO server, a device vault, each owned by the one before, the first by their vault, and Maia City beside
  avenCEO server, a coop avenCEO GmbH owns; the server becomes avenCEO server's device
  ([ARCHITECTURE.md](docs/ARCHITECTURE.md) §3). Each seed vault then follows the person's server setting, backup or
  relay, as every vault founded under them does.
- **Link** (`Device::link`, `Node::link_by_pass`): a browser of a person who has a device already links through the
  code that device shows, in one ceremony: the unlock, which is the pass and signs the join too. Of the keys the
  unlock's assertion recovers to, its passkey's is the one whose vault the peer hands over.
- **Open** (`Device::open`): what the device holds is kept on its shelf in the browser's private file system, OPFS, by
  a worker of its own (`js/store.js`, `js/store.worker.js`; [ARCHITECTURE.md](docs/ARCHITECTURE.md) §14), with what
  opens it again (`Meta`, the vaults it follows among it). It opens again in one ceremony, the unlock; the relay knows
  it, so it needs no pass. While it runs, its worker holds its shelf, so it never runs in two tabs at once. What an
  earlier avenDB kept in OPFS, before the last reset, it clears as it opens.
- **Steps** (`avendb_net::Progress`): each start marks its steps as it takes them, by name, with when each began and how
  long it took: the unlock, the keys, the node, the server, the draft, the ceremony that signs it, the claim, and so
  on (`progress.rs` lists them). The page watches them through the function it hands `found`, `link` or `open`, the
  Mac app through its device's `steps` call, and shows them as they happen in a sheet that slides up from the bottom
  (`src/lib/avendb/Signing.svelte`): every step with its seconds, the passkey's prompts marked as the person's turn.

The page opens on **Your account**, this browser as a device of its person. A new person founds their vault there, with
the maiaCITY passkey or a new one, and claims the server if nobody has yet, so their vault owns avenCEO server. A person
with an account signs in on a new browser with their passkey alone, linking through the server's offer, as after
losing every device, or links it through the code another of their devices shows (a QR code that a phone's camera
opens as a link, `?link=`). It comes with avenDB's server's relay and code filled in (`avendb.maia.city`, see
[Deploying the server](#deploying-the-server)); a test server's can take their place.

Unlocked, the page lays out the vaults this browser knows as a chat app lays out its servers: a bar of vault marks, the
person's own first; beside it the vault's name and its pages, as a database studio lists them (its notes, todos,
articles, stories, Library, flows and functions, its database and jobs, its settings); and the vault the person acts
as. The page keeps no rule: every screen draws from the device's `world` and the reads beside it, every change is one
op the device runs as the vault it names, and the page asks `may` before it offers one (`src/lib/avendb/ops.js`). A
change the vault's owners approve, such as a co-owner, a device or new vaults, runs the passkey's ceremony.

`scripts/test-browser.sh` builds the device with passkeys of `localhost` (the feature `localhost-passkeys`, never in a
build that ships; it needs the wasm32-unknown-unknown target, wasm-bindgen-cli 0.2.129 and Chromium, Playwright's or
`$AVENDB_CHROMIUM`) and runs `tests/page.rs`: a relay open to sign-up and a new server on this machine, and one
headless Chromium whose virtual authenticator, with PRF, holds Eve's passkey. Each of her browsers is a frame of one
tab with a shelf of its own in OPFS; the header of `tests/page.rs` says what each does. `tests/device.rs` runs the same
natively, with a software passkey in the authenticator's place.

### In the Mac app

The Mac app (maiaCITY Studio) shows the same page, but its web view may not use maia.city's passkeys, so each ceremony
runs in a sign-in sheet: maia.city's own sheet page (`/app/avendb/sheet/`), shown by the app
(`vault/app/src/passkey.rs`, macOS's ASWebAuthenticationSession, ephemeral), seals what the ceremony brings back to a
one-time X-Wing key the device named, and the device opens it. [ARCHITECTURE.md](docs/ARCHITECTURE.md) §11 says why
this is safe and where its one gate is, the person's own prompt. `scripts/avendb-sheet.mjs` walks the sheet in a
headless Chrome, the test playing the app, against a server on this machine.

### Natively, beside the Mac app

In the Mac app the device runs natively, not in the page (`crates/avendb-device`): the app builds it with itself
(`vault/app/build.rs`, in this workspace and lockfile, in its `app` profile, optimised) and runs it beside it as its
sidecar (`vault/app/src/avendb.rs`: `avendb-device --dir <folder>`, which logs on its stderr as `RUST_LOG` says, else
its warnings), and the page (`src/lib/avendb/native.js`) calls it as it calls its own device, each call a line of JSON
on the device's stdin, each answer one on its stdout. Its calls include `found`, `link`, `open`, `steps`, `run [op]`,
and `fileStart`, `fileChunk`, `fileEnd` and `fileDrop` to hand `put_file` a file's bytes.

- **Direct.** Its node binds UDP sockets of its own on every interface, IPv4 and IPv6, and maps a port on the router
  where one lets it (UPnP, NAT-PMP, PCP: `Options::direct`), so it reaches the person's other devices directly wherever
  it can, and through the relay only where it must. Its TLS is aws-lc-rs, X25519MLKEM768 only, like the server's.
- **On disk.** It keeps what it holds on a shelf in a folder (`~/avenDB/mac/`,
  `avendb_net::disk`), laid out as the page's in OPFS, with what opens it again (`Meta`). No secret: its keys come back
  from the mask and the passkey's PRF output at every unlock, and either alone tells nothing. It runs on while the app
  does, whichever page is open, and opens again in the unlock alone.
- **Its ceremonies** run in the same sign-in sheet, which the app shows for it: the device makes the one-time X-Wing
  key itself, names it in the sheet's URL, and opens what the sheet page sealed to it; the page sees none of it.
- If the device didn't build with the app, the app's debug build gets a stand-in that says so, and the page runs the
  device itself.
- **Agents.** `avendb-device agent <harness>` runs an agent device as the MCP server of an agent harness on the Mac
  (Claude Code, Codex, Cursor, Grok or our own native aven): agentClaude for `claude`. The app's device answers its
  access request with `agents` (the requests agents left as files), `grant [name, device, shares, avenName]` and
  `deny [name, device]`, and `agentCommand [harness?]` gives the command a harness's MCP settings run. Granting adds the
  agent as a device vault under the person's one aven, founding the aven with their first agent, in one ceremony at
  most, then has the aven pass a share on to it for each vault picked ([ARCHITECTURE.md](docs/ARCHITECTURE.md) §3). An
  agent that is a device of its device vault asks for more with a record, which the page's consent screen answers.
  Its tools: `avendb_vaults`, `avendb_ask` for a read, `avendb_run` for a change (`put_file` saves a file of the Mac
  by its path; `get_file` reads one back to a path, never over a file there unless `overwrite`, a small text file
  inline too), `avendb_add_spark` to capture a spark into the person's own vault or the one named, as the Sparks page
  does, `avendb_read_file` for `get_file`, and `avendb_request_access`.

Passkeys, PRF and a device's secure boundary are in [ARCHITECTURE.md](docs/ARCHITECTURE.md) §11.

## The server

`crates/avendb-server` is avenDB's server: a node on its shelf and, beside it, its relay. It holds only ciphertext and
opens nothing but what is public.

- At its first start it makes its device's secret (`device.key`, readable by its owner alone, or sealed in its bucket),
  and belongs to no vault until a human vault claims it ([ARCHITECTURE.md](docs/ARCHITECTURE.md) §3). It logs its
  offer (`AVENDB1…`): its device, its endpoint, its public address and its relay. The app keeps it, so that devices
  reach the server, and a new device links through it with its person's passkey alone.
- A reset raises `shelf::FLOOR` (`crates/avendb-net/src/shelf.rs`, 10 now, and `FLOOR` in
  `crates/avendb-browser/js/store.worker.js` with it), the generation every place's shelf is at least. What an earlier
  avenDB kept in its bucket or its folder, it clears (`bucket::clear`, `disk::clear`): its first start after a reset
  makes a new shelf generation, with a new device's secret, so a new offer, nobody's until a human vault claims it.
- A vault gives avenCEO server backup on the whole of it, and the server keeps the vault's edits and McEliece keys and
  serves them to the devices that may hold them, also while the device that wrote them is away. With relay instead
  (backups off, at setup or later with the `back_up` op), the server learns only the vault's devices, from its log, to
  let them through its relay; it keeps none of its entries. Every vault founded under a person, their aven and its
  agents' device vaults too, gives it the level their own vault does, as it follows every standing grant of theirs
  ("all my vaults, now and later", `avendb::engine::follow_standing`), so what an aven or an agent writes, an access
  request among it, reaches whoever it is for while the person's devices are away.
- Its relay lets in only the devices the server knows: those of the vaults it relays or backs up, of avenCEO server's
  owners, and itself; while sign-up is open, or until a human vault claims the server, also any passkey's pass, for ten
  minutes. A device taken out of its vault is let go, and turned away when it tries again. A device with no UDP of its
  own, behind a strict firewall say, reaches the server and every other device through the relay alone.

- Its feed serves the Maia Universe the posts it keeps that everyone may read, newest first, as JSON
  (`GET /feed/posts`, `avendb::world::public_posts`): a post an article's content flow made as it was published,
  public while a Public share of its vault reaches it; and the pictures everyone may read that a post shows
  (`GET /feed/files/<vault>/<name>`).

On this machine: `docker compose -f compose.yml up --build` in `avendb/` runs it with iroh on UDP 7401, the relay's
plain HTTP on port 3350 and the feed's on port 3351. Its environment:

| Variable | Default | What it says |
|---|---|---|
| `AVENDB_DATA` | `/data` | Its folder: its shelf, or with a bucket its cache, and its device's secret where it keeps no bucket |
| `AVENDB_BIND` | `0.0.0.0:7401` | The UDP socket of its iroh endpoint, where devices on UDP reach it straight |
| `AVENDB_RELAY_BIND` | `0.0.0.0:3350` | The socket its relay serves plain HTTP on, behind the proxy that ends TLS |
| `AVENDB_FEED_BIND` | `0.0.0.0:3351` | The socket the Maia Universe's feed is served on, plain HTTP behind the same proxy |
| `AVENDB_RELAY_URL` | the relay's own socket | Where devices reach the relay, `https://avendb.maia.city` once deployed |
| `AVENDB_PUBLIC_ADDR` | its interfaces' addresses | Where devices on UDP reach it from the internet, the server's IP and port 7401, as its offer says |
| `AVENDB_SIGNUP` | `open` | `open`: its relay lets in any passkey's pass for ten minutes, so a new person's first browser founds their vault; `closed`: only passkeys of vaults it knows |
| `AVENDB_BUCKET` and the rest | none | Its bucket (see [Deploying the server](#deploying-the-server), step 6) |
| `AVENDB_CACHE` | `8` | With a bucket, the gigabytes of the parts it read lately that its folder caches |
| `RUST_LOG` | `info` | How much it logs |

### Deploying the server

The server runs at `avendb.maia.city`, beside the media vault's server on the same machine, and changes nothing of it.

1. **Its image**: `.github/workflows/avendb.yml` builds this image (`Dockerfile.server`) whenever the server's code
   changes, pushes it to GHCR as `maiacity-avendb`, writes it (`AVENDB_IMAGE`) and the compose profile `avendb` into
   the server's `.env`, and pulls and restarts that one container: the API and the media vault never restart for it,
   and a failed build holds up nothing of theirs. `api.yml` has to have run once before it can.
2. **Everything else** comes from `.github/workflows/api.yml`: the Caddy site `avendb.maia.city` (`deploy/Caddyfile`,
   `reverse_proxy avendb:3350`, and `/feed/*` to `avendb:3351`; its TLS agrees keys by X25519MLKEM768 alone,
   `curves x25519mlkem768`, the only key exchange a device offers, and `avendb.yml` checks a classical one is refused;
   it reads request headers up to 64 KB, as a browser's relay pass rides in the relay's URL and Caddy 2.11 turns it
   away otherwise, which both workflows check), UDP 7401 in the firewall (`infra/index.ts`), the service `avendb` in the
   root compose files, and its settings in the server's `.env`: `AVENDB_RELAY_URL=https://avendb.maia.city`,
   `AVENDB_PUBLIC_ADDR` (the server's IP and port 7401), and its data folder on the Hetzner volume.
3. **DNS**: an A record `avendb.maia.city` for the server. `api.yml`'s `dns` job sets it with a `HETZNER_DNS_TOKEN`;
   without one it is set by hand in the Hetzner DNS console. The relay needs a host name of its own: iroh's relay path
   is `/relay`, and `api.maia.city/relay` is the media vault's relay.
4. **Devices**: the offer it logs as it starts (`avenDB server: offer AVENDB1…`, in both workflows' logs) is filled
   in on **Your account** (`SERVER` in `src/lib/avendb/Account.svelte`), beside its relay. It stays the same as long
   as the server keeps its device secret; after a reset it is a new one, filled in again once that is deployed.
5. **The claim**: the first person to found their vault on **Your account** claims the server, founding the seed, Maia
   Holding GmbH, avenCEO GmbH, avenCEO server and Maia City, and makes it avenCEO server's device, so whoever runs a new
   server founds their vault there first. Every device reads the server from that seed (`avendb::world::seeder`). Both
   workflows log whether it is claimed yet.
6. **Its bucket** ([ARCHITECTURE.md](docs/ARCHITECTURE.md) §14): with `AVENDB_BUCKET`, `AVENDB_BUCKET_ENDPOINT`,
   `AVENDB_BUCKET_REGION`, `AVENDB_BUCKET_ACCESS_KEY`, `AVENDB_BUCKET_SECRET_KEY` and `AVENDB_BUCKET_SEAL` (64 hex
   digits) in its environment, its shelf and its device's secret live in that bucket, every object sealed under the
   seal, and its folder is only a cache: it logs at its start whether it keeps one. `avendb.yml` writes them into the
   server's `.env` at each deploy, from the project's S3 keys (`HETZNER_S3_ACCESS_KEY`, `HETZNER_S3_SECRET_KEY`) and
   the GitHub secret `AVENDB_BUCKET_SEAL`, and the compose files pass them on; with one of those secrets unset, it
   writes none. The bucket is avenDB's own, `maiacity-avendb` in `hel1`, beside the media vault's: `avendb.yml`'s
   `bucket` job makes it with Object Lock, every object version locked for 7 days, or checks the one there.

Its shelf and its device's secret live in its bucket, or on the Hetzner volume where it keeps none, so a rebuilt server
is still the same device, even with its folder lost; the database backups don't hold them. Losing them makes a new
server, a device of nobody: avenCEO server's owner removes the lost device from it, then claims the new server
(`Node::claim`), which adds it to the same device vault, as it has no device left (`Lab::unclaimed_server`), so every
vault's share to avenCEO server stands.

## History

The plan with every scenario, theorem and phase is the Claude Doc
[avenDB: E2E reference plan](https://claude.ai/code/artifact/5e95ec82-8564-4340-8767-7b915afafe59). Each phase was one
PR, merged when its Rust tests passed and its theorems were proven. The table says what each phase built when it
merged, in the words of the time: caps and cells were what shares and audiences are now. Since then, edit format 8
made every share a named group of ops, replaced sync rules with keep shares and the schema lane's publish with schema
and lens entries, added holdings, one `run(op)` API and one shelf per place, as
[ARCHITECTURE.md](docs/ARCHITECTURE.md) describes.

| Phase | What it builds | State |
|---|---|---|
| P0 to P4 | The spec and the API, vaults and signatures, caps and sync by caps, keys and encrypted edits, schemas and lenses | Merged |
| P4b | Post-quantum hardening: SHA-3 ids and hashes (BLAKE3 since VERSION 10), a hash-based signature beside every classical one but a write's, checkpoints that vouch for the writes (T18; since VERSION 9 SLH-DSA signs every edit and checkpoints are gone), a McEliece share beside X-Wing in every key box; the passkey as the only way back in, each device key kept masked by its PRF output and unmasked at every unlock | Merged |
| P5 | History and proposals: every write an edit on a line of its entry's history, proposals from any version, a lossless three-way merge, revert and restore, undo of an older edit, variants in another space (T10) | Merged |
| P6 | Sync log by log: every edit builds on the frontier of its own log (a vault's, a space's or an entry's), a device asks with its frontier of each log and a few edits further back and is sent only what it lacks (T19), devices gossip one digest per log, a device restored from an old backup is flagged when it signs again (a fork); offline devices, random delivery orders, partial delivery, Lean ⇄ Rust vectors for sync (T11, T12, T13); a device that has seen a revocation writes under the new key (T15) | Merged |
| P7 | The avenDB tile: the Lab's whole world in one page, as WebAssembly in the page's workers, every device side by side; pick one and act as it: vaults and the passkeys that sign their changes, spaces, entries read and edited as each app version sees them, history, proposals, access and why, todos, schemas and lenses, sync, locked and offline devices, and the plan's scenarios played green | Merged |
| P8a | Devices on avenDB's own iroh: one encoding for every message between devices, fuzzed; each device a node on an iroh endpoint of its own ed25519 key with X25519MLKEM768 as the only key exchange, and a hello on every connection that proves the device by its SLH-DSA signature over the TLS exporter; sync by caps over avenDB's own ALPN, the McEliece keys in iroh-blobs, handed out only within reach; a node announces each changed digest straight to each peer that may hold the log, not over iroh-gossip, whose topics would tell every member of a log; scenarios 5 and 17 between nodes on one machine | Merged |
| P8b | The server: a node in a folder of its own that keeps its device's secret and its store, founds its vault at its first start with an owner key it then forgets, and hands out its contact card so that a device can grant it relay on a space; its relay, which lets in only the devices of the vaults acting in the spaces it relays and lets go of a device taken out of its vault; each node's store on disk (append-only, a torn record cut back, a forged edit dropped); peers out of reach tried less and less often; scenario 5 through the relay alone; the server's image, not deployed | Merged |
| P8c | Linking a new device by its passkey alone, through a device's QR code or the server's offer: the passkey's hello on the connection, the link card of its vaults' logs (T20), the join the peer takes only for the device on the connection; recovery through the server; keys in the device's secure boundary (wiped as they are dropped, none left once a device locks, randomness no copy rewinds or foresees, no secret in any view); Verifpal models of the hello, the link and the sealed box with the curves broken (Verifpal rather than ProVerif, which has no package here) | Merged |
| P8d | A device in the browser: the network crate as WebAssembly, with X25519MLKEM768 in pure Rust; a new device with no UDP let onto the server's relay by its passkey's pass; big answers a page at a time, each edit after its past; two pages in Chromium that link through the relay alone, the second through the first one's code, and sync | Merged |
| P8e | The tile as a real device: the browser's passkeys (WebAuthn with PRF) sign in ceremonies over each edit, and the Lab holds no secret of them; a new person's first browser founds their vault through the relay open to sign-up; a browser links in four ceremonies and learns the passkey's key from two; its store in IndexedDB, open again in one ceremony; the tile's This browser screen with QR codes; Chromium's virtual authenticator in the test | Merged |
| P8f, vaults | Three kinds of vault, human, coop and aven, each owned only as its kind may be (T21); every act for a coop or an aven vault names the chain of owners it goes through; the server a device of avenCEO, claimed by the first human vault founded through it; the passkey of maiaCITY's sign-up, with PRF, as the vault's root; the example world reset around avenCEO | Merged |
| P8f, deploy | The server at `avendb.maia.city`, beside the media vault: its own image and workflow (`avendb.yml`), its Caddy site, UDP port and settings from `api.yml`; This browser filled in with its relay and offer | Merged |
| P8f, one prompt | No setup code: the first human vault founded through the server owns avenCEO; edits drafted together signed in one ceremony over their batch, so a first browser founds its vault, adds itself and claims the server in one prompt after the unlock and the pass (three in all, four with a new passkey), and This browser says when its vault owns avenCEO | Merged |
| P8f, account | The tile opens on the person's account, the Lab apart and made only when opened: their human vault, its root passkey and its devices, each by the name on its card, an end-to-end encrypted document the device writes itself; a new browser signs in with the passkey alone, through the server; the Lab's simulated person is Alice | Merged |
| P8f, real vaults | Real vaults the person controls instead of the simulated Lab: the vaults this browser knows as a chat app's servers, each by the name on its profile; new aven and coop vaults their vault owns in one ceremony; acting as any of them, its caps deciding what the page shows and does; each vault's owners, devices, access and syncing devices; every node post-quantum only | Merged |
| Two prompts | Setup and sign-in in two passkey prompts each: a new device makes its own secret, kept masked by the PRF output on its salt, so the ceremony that unlocks it is its passkey's pass for it, to the relay and to the peer it links through (no hello of the passkey's any more); a device that doesn't know its passkey's key yet drafts its vault for each key the unlock recovers to, in one batch, and keeps the one the next ceremony verifies under | Merged |
| Flat vaults | No spaces: entries straight in their vault, their type and tags sealed in their writes; caps on any slice (types, tags, authors, entries, creation time, any AND and OR of those), in chains that only narrow (T22); cells, the entries the same caps reach, one key per cell and a key per entry derived from it (T24), kept to what the caps say by the vault's own devices, who move entries as tags change and answer other vaults' tag asks (T23); relays that route by cells and never see a selector, a type or a tag (T25); the page's sharing by rule, tags, Access, Sync and Cells; the server's data started fresh | Merged |
| A, one aven | Four primitives, vault, owns, device and share; four kinds of vault by one kind table (T21): human, coop, aven (a person's one AI identity, owned by their human vault alone, one to a person) and device vault (owned by one human, coop or aven vault; with human vaults, the only kind that holds devices); sub caps by one rule (T22), so an aven passes a coop's share on to its agents' device vaults, and a coop's revoking it ends theirs; one flow adds a device vault (`Place`, `Node::add_device_vault_with`): the server's claim, and each agent under its person's one aven, founded with their first agent, the harness naming no aven; the server the device of avenCEO server, read from the seed (`world::seeder`); every vault founded under a person following their server setting; access requests as records, each a `request` its vault writes and shares with the vault asked in the `Answer` group, answered on the page's one consent screen (`ask`, `requests`); the page's kind rules read from the kind table, and one Owned vaults view; scenarios 27 and 28; the reset to generation 10 | Merged |
| P8f | Scenarios 5 and 17 between this Mac, a phone's browser and the server | Next |

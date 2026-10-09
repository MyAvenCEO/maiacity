# avenDB

The user-owned, end-to-end encrypted database of maia.city. Every identity is a vault, like a smart account: a human
vault is a person's, owned by their passkeys, with their devices; a coop vault is owned by human and coop vaults; an
aven vault, an agent's such as avenCEO, the server's, is owned the same way, and its servers act for it but never govern
it. Vaults hold caps on spaces and single entries, every item is a Loro document whose edits are encrypted under the
item's own key, and each device syncs exactly the items its vaults hold caps on, so servers and relays only ever see
ciphertext.

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
| `crates/avendb-web` | The core as WebAssembly over the Lab's simulated world, read through JSON views and changed through JSON actions; once the tile's Lab, no longer on the page, its tests still run with the workspace's |
| `scripts/build-web.sh` | Builds `avendb-browser` into the page's own device, `src/lib/avendb/device/` in the app (committed, so the app builds without Rust) |
| `scripts/test-browser.sh` | Builds `avendb-browser` for the browser and runs its test page in headless Chromium |
| `spec/` | The Lean model the core is built against, test-first: the rules, the theorems (T1 to T21) and the test vectors both sides replay; and in `spec/protocol/`, Verifpal models of the hello, the link and the sealed box (see `spec/README.md`) |
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

avenDB's page (`/app/avendb/` in the app, for admins) is a device of its person, `avendb-browser` built into the app
(see [A device in the browser](#a-device-in-the-browser)): it syncs the moment anything changes, with no button to
press. After a change to the core, the network crate or the browser crate, build it again and check the page in a
headless Chrome:

```sh
cd avendb && ./scripts/build-web.sh     # needs the wasm32-unknown-unknown target and wasm-bindgen-cli 0.2.129
cd .. && node scripts/avendb-smoke.mjs  # starts a dev server, opens the page, screenshots in build/avendb-smoke
```

`scripts/avendb-account.mjs` walks the account itself against an avenDB server on the same machine: founding the
person's vault, the four vaults it owns, acting as each, sharing and revoking, signing in again; its header says how to
build and start both.

The Lean build needs [elan](https://github.com/leanprover/elan) (`spec/lean-toolchain` pins the version). After a change
to the rules, `lake exe vectors` in `spec/` writes the vectors again; commit them with the change.

## Post-quantum only

Every node, the server's and every browser's, trusts no elliptic curve alone (`Lab::set_pq_only`, set as a node starts
in `avendb_net`): it counts a write only once a checkpoint by its author covers it, signed with SLH-DSA, and every other
op carries an SLH-DSA signature beside its classical one, both checked. A node checkpoints each write of its own as it
makes it, and what it held before as it starts. Keys are sealed with X-Wing and Classic McEliece both, every connection
agrees its keys with X25519MLKEM768 alone, and every hash is SHA-3.

## Linking a device

A new device joins its person's vault by their passkey alone (P8c): through any device that holds the vault's log, or
through the server once every other device is lost.

1. A device that holds the vault, Alice's Mac say, shows its offer as a QR code (`Node::offer`, text `AVENDB1…` in the
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

### The browser's passkey (P8e)

The person's passkey stays in the browser's own authenticator: WebAuthn with its PRF extension
(`crates/avendb-browser/js/passkey.js`). The device never holds the passkey, only what one ceremony at a time brings
back (`sign::Ceremony`): an assertion over a challenge, and the PRF output on the app's salt, from which the passkey's
SLH-DSA key and the key sealed to it derive. The device drafts each op the passkey signs (`Lab::draft`), the passkey
signs the op's id as the ceremony's challenge, and the device keeps the op (`Lab::complete`). The ceremony that unlocks
the device also brings the PRF output on the device's own salt, which ends in 32 random bytes kept on the device; its
keys derive from it at every unlock. The Lab holds no secret of the passkey: it lends the seal secret from the ceremony
for that op alone, and forgets the McEliece pair it made from it once the device locks. Ops drafted together
(`Lab::drafting`) are signed in one ceremony, over their batch: its challenge is the hash of their ids, smallest first
(`sign::batch_challenge`), and each op's signature carries those ids, so it counts for those ops alone; the SLH-DSA
half still signs each op's own id. So a person is asked once where a device would otherwise ask once for each op.

- **Found** (`Device::found`, `Node::found_with`): a new person's first browser founds their human vault with the
  passkey they signed up to maiaCITY with, or one it makes, then its first space, and grants avenCEO relay on it, in
  three ceremonies: the unlock, the pass to the relay, and one for the vault's genesis and the op that adds the device
  together (four with a new passkey). Its P-256 key comes from the new passkey's public key info, or, for maiaCITY's,
  as the one key both the unlock's and the pass's assertions recover to. The server's relay lets any passkey's pass in
  while it is open to sign-up (`AVENDB_SIGNUP`, open by default), so a person with no device yet gets in; from then on
  the server knows the device. The first person to found their vault through a server nobody has claimed yet claims
  it in that same ceremony (see [avenCEO](#avenceo)).
- **Link** (`Device::link`, `Node::link_with`): a browser of a person who has a device already links through the code
  that device shows, in four ceremonies: the unlock, the pass, the passkey's hello, and the join. It never saw the
  passkey made, so it learns its P-256 key as the one key both the unlock's and the pass's assertions recover to
  (`sign::passkey_key`).
- **Open** (`Device::open`): what the device holds is kept in IndexedDB (`js/store.js`), its ops in the order it took
  them and its McEliece keys, as a node keeps them on disk, saved after each change (`Node::changes`). It opens again in
  one ceremony, the unlock; the relay knows it, so it needs no pass.

The page opens on **Your account**, this browser as a device of its person. A new person founds their vault there, with
the maiaCITY passkey or a new one, and claims the server if nobody has yet, so their vault owns avenCEO. A person with
an account signs in on a new browser with their passkey alone, linking through the server's offer, as after losing every
device, or links it through the code another of their devices shows (a QR code that a phone's camera opens as a link,
`?link=`). It comes with avenDB's server's relay and code filled in (`avendb.maia.city`, "Deploying the server",
below); a test server's can take their place.

Unlocked, the page lays out the vaults this browser knows as a chat app lays out its servers: a bar of vault marks, the
person's own first; beside it the picked vault's name and its list, its notes and todos, then its settings; and at the
foot, in the middle, the vault the person acts as. It all comes from the device's world (`Device::world`), shown again
the moment anything arrives (`Device::changed`):

- **Names.** Every vault goes by the name on its profile, a document tagged `avendb:vault` in its home, the first space
  it founded, whose first write acted for the vault (`Device::profile`): the person's own by their maiaCITY name,
  avenCEO's as avenCEO, written by whichever of their devices comes first. Every device goes by the name on its card, a
  document tagged `avendb:device` that it writes itself into its vault's first space and writes again to rename itself
  (`Device::card`). Both are end-to-end encrypted like the notes beside them.
- **Vaults it owns.** The person's vault founds aven and coop vaults it owns, any number in one ceremony of its passkey
  (`Device::found_vaults`, over `Node::approve_with`); the device then founds each one's home, lets avenCEO relay it and
  writes its name there. Its "+" opens on one empty row: the person names each vault they found.
- **Acting as.** The person acts as any vault their vault owns, through it, from the switcher at the foot. The page then
  shows what that vault's caps allow and nothing else, and every write, grant and revocation goes out acting for that
  vault, which the rules check as any peer checks them. Sharing with a role up to write, and revoking it, needs no
  ceremony; making a vault an owner of a space, or revoking that, takes one, the owners' approval
  (`Device::grant`, `Device::revoke`). Marks of the vaults the acting vault holds nothing in are faded.
- **Settings.** Each vault's kind, owners, root and devices; who holds which role on each of its spaces, the grants in
  force and who may revoke them; and which devices receive each space, through which vault, and whether each opens it
  or only relays its ciphertext, as avenCEO's server does.

#### In the Mac app

The Mac app (maiaCITY Studio) shows the same page, but its web view may not use maia.city's passkeys: macOS lets an
app's web view use a relying party's passkeys only with an Apple-signed entitlement tying the app to its domain. So
there each ceremony runs in a sign-in sheet (`js/passkey.js`, `inSheet`). The page makes a one-time X-Wing key for it
(`Sheet`, which never leaves its WebAssembly), and the app (`vault/app/src/passkey.rs`, macOS's
ASWebAuthenticationSession, ephemeral) shows maia.city's own sheet page (`/app/avendb/sheet/`) over its window, with the
challenge, the salts and that key in the fragment. The sheet page runs the ceremony in the passkey prompt as the site
does, seals what it brings back to that key at once, bound to the challenge (`sealCeremony`, `keys::seal_once`: X-Wing
alone, as the key lives for one crossing), wiping the PRF outputs as it seals them, and sends the box to
`city.maia.studio://avendb`, which the sheet hands to the app instead of loading. The page opens it (`Sheet::open`) and
goes on as with the browser's own ceremony; the assertion's origin is maia.city's, which `sign` takes. Nothing crosses
open, and nothing stays on the Mac: each start of the app asks for the passkey again. The passkey itself is made on
maia.city in a browser; the app signs in with it.

What the sheet sends back goes to whichever app opened it: macOS doesn't tell the page which app that is, so any app on
the Mac (or a phone) could open the sheet page with a key of its own and, if the person confirms their passkey, open
what it brings, the PRF output on avenDB's salt among it. The person's passkey prompt is the only gate, and the sheet
page says to confirm only what they just asked for in maiaCITY Studio. An app signed with Apple's associated-domains
entitlement (`webcredentials:maia.city`, listed in maia.city's `apple-app-site-association`) could use the passkey in
its own web view instead, and the sheet could go.

#### PRF, done right

A passkey's PRF output is the root of everything a person holds, so every use of it keeps to these rules, each checked
in the code:

- **One passkey for maiaCITY and avenDB.** Both use the relying party `maia.city`, so the passkey a person signed up to
  maiaCITY with can be their vault's root. maiaCITY's sign-up (`src/lib/auth/client.ts`) asks for the PRF extension
  and for P-256 first: a security key turns its PRF (CTAP2's `hmac-secret`) on only for a passkey made with it, and
  avenDB's ceremonies take P-256 signatures alone. A browser or an authenticator without PRF makes the passkey all the
  same, as maiaCITY never needs it; avenDB then says so and offers to make one of its own. A passkey avenDB makes
  without PRF (`prf.enabled` false) is refused at once, and the authenticator told nobody knows it.
- **User verification in every ceremony.** An authenticator's PRF answers with another secret without it, so each of
  avenDB's ceremonies requires it (`userVerification: 'required'`) and each assertion must show it (`sign::Assertion`
  checks the UP and UV flags); the outputs then stay the same at every ceremony. maiaCITY's own sign-in may skip it,
  and never asks for PRF.
- **Salts of its own.** The passkey's keys come from the output on avenDB's salt (`sign::PRF_SALT`), each device's from
  the output on its own salt, which ends in 32 random bytes the device keeps (`sign::device_salt`). The browser hashes
  each salt with `WebAuthn PRF` before the authenticator sees it, so no other use of the credential gets these outputs,
  and the software passkey of the tests does the same. Each key derives under a label of its own, so the signing key
  and the key sealed to never meet.
- **Bound to the passkey.** A ceremony counts only if its assertion verifies under the passkey's P-256 key and the
  SLH-DSA key derived from its PRF output is the one the vault knows (`sign::Ceremony`): every op a passkey signs
  carries both, so maiaCITY's API, which sees its own sign-ins' assertions and never a PRF output, can't sign for a
  vault, nor can anyone who learns a PRF output without the authenticator.
- **Held as briefly as it can be.** The device copies each output into memory that wipes itself, and wipes the page's
  buffer it came in (`js/passkey.js` hands it over as a view of the browser's own buffer); none is ever sent open,
  logged or shown. In the Mac app the sheet page seals them to the app page's one-time key as it wipes them, and only
  that page opens them ([In the Mac app](#in-the-mac-app)).

Every page on `maia.city` and its subdomains can ask the person's authenticator for a ceremony of that relying party,
so the site's own scripts are part of what guards the root, as they are for any passkey; each ceremony shows the person
a prompt.

`scripts/test-browser.sh` builds it with passkeys of `localhost` (the feature `localhost-passkeys`, never in a build
that ships; it needs the wasm32-unknown-unknown target, wasm-bindgen-cli 0.2.129 and Chromium, Playwright's or
`$AVENDB_CHROMIUM`) and runs `tests/page.rs`: a relay open to sign-up and a new server, nobody's yet, on this machine,
and one headless Chromium driven over its DevTools protocol, whose virtual authenticator, with PRF, holds Eve's passkey.
Each of her browsers is a frame of one tab, with a store of its own in IndexedDB: the first makes her passkey, founds
her vault, claims the server and writes a note (8.0 s, three ceremonies, the server's claim and avenCEO's keys among
the work); the second links through the first one's code and edits the note (3.8 s, four ceremonies); the first closes
and opens again from its store (0.8 s, one ceremony), reads the edit and edits it once more. `tests/device.rs` runs the same natively, with a software passkey in the authenticator's place, and Alice's
browsers linking through her Mac.

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

- At its first start it makes its device's secret (`device.key`, readable by its owner alone), and belongs to no vault
  until a human vault claims it (see [avenCEO](#avenceo)). It logs its offer (`AVENDB1…`): its device, its endpoint, its
  public address and its relay. The app keeps it, so that devices reach the server, and a new device links through it
  with its person's passkey alone.
- A device takes the server's contact card, avenCEO's log, and can then grant avenCEO relay on a space. The server keeps
  that space's ops and McEliece keys and serves them to the devices that may hold them, also while the device that
  wrote them is away.
- Its relay lets in only the devices the server knows: those of the vaults acting in the spaces it relays and of
  avenCEO's owners, and itself; until a human vault claims the server, also any passkey's pass. A device the server
  doesn't know yet makes its first contact straight, over UDP, or through the relay by a pass its person's passkey
  signed, for ten minutes. A device taken out of its vault is let go, and turned away when it tries
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
| `AVENDB_SIGNUP` | `open` | `open`: its relay lets in any passkey's pass for ten minutes, so a new person's first browser founds their vault; `closed`: only passkeys of vaults it knows |
| `RUST_LOG` | `info` | How much it logs |

### avenCEO

The server is a device of avenCEO, an aven vault: it acts for avenCEO, relaying and keeping what avenCEO is granted,
and never governs it. avenCEO's owners are human or coop vaults, whose passkeys approve each change to it. The first
human vault to claim the server owns it (P8f): a person's first device claims it as it founds their vault through it,
in the same ceremony (`Node::found_with`).

1. The device takes the server's card (`Lab::card`). If it names no avenCEO, nobody has claimed the server, and the
   device asks it for its key to seal to (`Lab::claim_key`), which the server hands to whoever asks until then.
2. The person's passkey signs, in one ceremony, their human vault's genesis, the op that adds the device, avenCEO's
   genesis, owned by that human vault, and the op that adds the server as avenCEO's device, sealed to that key
   (`Lab::drafting`, `Lab::claim`). The device keeps the first three and sends the last with avenCEO's log.
3. The server checks that the op adds itself and seals to its own key, every signature, and that the op makes it a
   device of an aven vault by the rules, then signs it too, in its place, and keeps it (`Lab::accept_claim`). Its
   answer, the op and its McEliece key, lets the device box avenCEO's key for it; then they sync.

So nobody claims it after: whoever founds a vault later finds avenCEO on the server's card and grants it relay, and so
does one who lost a race for it, their vault founded all the same. A new server is therefore claimed by whoever founds
a vault through it first, which should be the person who runs it. A device of a vault founded before claims a server
the same way (`Node::claim`), avenCEO's genesis and the op that adds the server in one ceremony; a claim whose answer
was lost finds the server avenCEO's device already, and one the server didn't take is tried again on the same
avenCEO. In the tile, **Your account** says so once its vault owns avenCEO.

A space relayed by avenCEO is relayed to avenCEO's devices and, as for any grant to a vault, to the devices that act for
it: its owners'. They receive what the server's disk holds, the space's ops as ciphertext, never a key.

### Deploying the server

The server runs at `avendb.maia.city`, beside the media vault's server on the same machine, and changes nothing of it.

1. **Its image**: `.github/workflows/avendb.yml` builds this image (`Dockerfile.server`) whenever the server's code
   changes, pushes it to GHCR as `maiacity-avendb`, and restarts that one container on the server: the API and the
   media vault never restart for it, and a failed build holds up nothing of theirs.
2. **Everything else** comes from `.github/workflows/api.yml`: the Caddy site `avendb.maia.city`
   (`deploy/Caddyfile`, `reverse_proxy avendb:3350`; Caddy 2.10 and later offers X25519MLKEM768, the only key exchange
   a device offers; it reads request headers up to 64 KB, as a browser's relay pass rides in the relay's URL and
   Caddy 2.11 turns it away otherwise, which both workflows check), UDP 7401 in the firewall (`infra/index.ts`), the service `avendb` in the root compose files, and
   its settings in the server's `.env`: `AVENDB_RELAY_URL=https://avendb.maia.city`, `AVENDB_PUBLIC_ADDR` (the
   server's IP and port 7401), and its data folder on the Hetzner volume.
3. **DNS**: an A record `avendb.maia.city` for the server. `api.yml`'s `dns` job sets it with a `HETZNER_DNS_TOKEN`;
   without one it is set by hand in the Hetzner DNS console. The relay needs a host name of its own: iroh's relay path
   is `/relay`, and `api.maia.city/relay` is the media vault's relay.
4. **Devices**: the offer it logs as it starts (`avenDB server: offer AVENDB1…`, in both workflows' logs) is filled
   in on **Your account** (`SERVER` in `src/lib/avendb/Account.svelte`), beside its relay. It stays the same as long
   as its folder on the Hetzner volume keeps the server's device secret.
5. **The claim**: the first person to found their vault on **Your account** claims the server as avenCEO's device,
   so whoever runs a new server founds their vault there first. Both workflows log whether it is claimed yet.

Its store and its device's secret live on the Hetzner volume, so a rebuilt server is still the same device; the
database backups don't hold them. Losing them makes a new server, a device of nobody: avenCEO's owners remove the lost
device from avenCEO, then claim the new server (`Node::claim`), which adds it to the same avenCEO, so every space
avenCEO relays keeps its grant.

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
| P8e | The tile as a real device: the browser's passkeys (WebAuthn with PRF) sign in ceremonies over each op, and the Lab holds no secret of them; a new person's first browser founds their vault through the relay open to sign-up; a browser links in four ceremonies and learns the passkey's key from two; its store in IndexedDB, open again in one ceremony; the tile's This browser screen with QR codes; Chromium's virtual authenticator in the test | Merged |
| P8f, vaults | Three kinds of vault, human, coop and aven, each owned only as its kind may be (T21); every act for a coop or an aven vault names the chain of owners it goes through; the server a device of avenCEO, claimed by the first human vault founded through it; the passkey of maiaCITY's sign-up, with PRF, as the vault's root; the example world reset around avenCEO | Merged |
| P8f, deploy | The server at `avendb.maia.city`, beside the media vault: its own image and workflow (`avendb.yml`), its Caddy site, UDP port and settings from `api.yml`; This browser filled in with its relay and offer | Merged |
| P8f, one prompt | No setup code: the first human vault founded through the server owns avenCEO; ops drafted together signed in one ceremony over their batch, so a first browser founds its vault, adds itself and claims the server in one prompt after the unlock and the pass (three in all, four with a new passkey), and This browser says when its vault owns avenCEO | Merged |
| P8f, account | The tile opens on the person's account, the Lab apart and made only when opened: their human vault, its root passkey and its devices, each by the name on its card, an end-to-end encrypted document the device writes itself; a new browser signs in with the passkey alone, through the server; the Lab's simulated person is Alice | Merged |
| P8f, real vaults | Real vaults the person controls instead of the simulated Lab: the vaults this browser knows as a chat app's servers, each by the name on its profile; new aven and coop vaults their vault owns in one ceremony; acting as any of them, its caps deciding what the page shows and does; each vault's owners, devices, access and syncing devices; every node post-quantum only | Merged |
| P8f | Scenarios 5 and 17 between this Mac, a phone's browser and the server | Next |

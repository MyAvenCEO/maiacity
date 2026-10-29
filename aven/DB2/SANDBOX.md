# avenSANDBOX: milestone 1

avenSANDBOX is the network avenDB is built and tested in: two Peer-Lights in one Chromium and two Peers, one of them
the Aven Peer with its relay on, in containers on one machine, started with one command. Milestone 1 builds the sandbox
itself and avenOS in the browser (its dashboard, the account switcher and two apps, Vault and Control Room) as the
starter every later primitive grows from. The first example
app, a chat, comes in milestone 2. **No test scenarios yet.**

## The loop

The point is speed: a change is seen running on every peer in seconds or minutes, never after a 30-minute CI and
deploy round. Nothing in the loop deploys. The Aven Peer runs on the same machine, and "deploying" means restarting its
container.

Targets, measured in this milestone and reported on every run:

| Step | Target | Measured (cloud session, 29 Oct) |
|---|---|---|
| `bun run up` with a warm build, until every peer is live | < 10 s | 1.9 s; with `--check`, 3.6 s (the page only, no peers yet) |
| A change to the page, visible | < 1 s (hot reload) | |
| A Rust change, running on every peer | < 30 s | |
| A new cloud session, image already on disk, until every peer is live | < 2 min | |
| A change to the box's Dockerfile, pushed, until the new image pulls | (none) | 227 s: GitHub builds both platforms |

## The cast

| Peer | What it is | Stores in | Reaches the others |
|---|---|---|---|
| **Aven Peer** | the Peer with `--relay`: the server, with the iroh relay in its process | object storage: a local S3-compatible server in the box, never a real cloud bucket | it runs the relay |
| **Alice Peer** | the Peer, relay off: what the future Mac app embeds, here as a Linux binary | a folder | iroh directly over UDP, the relay as fallback |
| **Alice Peer-Light** | the core as wasm in Playwright's Chromium, page at `alice.localhost` | the OPFS of its origin | through the Aven Peer's relay (browsers can't send UDP) |
| **Bob's Peer-Light** | the same, page at `bob.localhost` | the OPFS of its origin, separate from Alice's (measured) | through the relay |

There are only two kinds of peer, both built from one core:

- A **Peer** is the native Rust binary. The Aven Peer is that binary with its relay on; Alice Peer is the same binary
  with it off.
- A **Peer-Light** is the same core compiled to wasm, running in a browser.

They differ only at the edge: where they store, how they reach the network, and whether they run the relay. What the
Aven Peer keeps for others will come from caps, not from a code path of its own.

Each Peer runs in its own container. Both Peer-Lights share one Chromium, as two origins with two separate storages.
The cast is one file, [`sandbox/cast.json`](sandbox/cast.json); adding a peer is one entry.

### Vaults own vaults

Who may act for whom is avenID's ([README](README.md#decisions-so-far)). The box starts it with a fixed tree in the
cast. As in avenDB-old, vaults own vaults; the concept comes over, no code does.

```
Alice's vault           person    owned by Alice's owner key
├── Aven                network   the network's own vault
│   └── Aven Peer       device
├── Alice Peer          device
└── Alice Peer-Light    device
Bob's vault             person    owned by Bob's owner key
└── Bob's Peer-Light    device
```

- **A person's vault** is owned by its owner key; later by keys and passkeys acting k of n, with recovery.
- **A device's vault** is owned by the vault it serves. The device's key signs for that vault and governs nothing: a
  lost device is revoked by its vault, and the vault loses nothing.
- **Aven, the network's vault,** is owned by Alice's vault. **So Alice's vault is the admin, not Alice's key:** her key
  governs her vault, and through it Aven and the Aven Peer. **Aven acts through its own device:** the Aven Peer signs
  for Aven, within the rights Alice's vault gives it and can take back. No person ever switches into Aven; Alice
  manages it as herself. From milestone 2 on, invites into the network are Aven's, within those rights; Bob is a member
  because Alice invited him.
- **A vault governs everything below it, and sees only that.** avenOS shows a vault what it governs: Alice's Control
  Room has her two devices and the Aven Peer, Bob's his Peer-Light.

Every key is a test key: its Ed25519 seed is `sha256("avenSANDBOX test signer: <id>")`, public on purpose and valid
only inside the box. Invites, caps, Loro and sync logic come in later milestones.

## Storage: one contract, pluggable backends

Storage sits under the core, beside iroh. iroh carries bytes between peers and keeps only its own key. Everything a peer
holds goes through one small contract the core defines, `Store`: later its log, snapshots and files; in milestone 1 just
its key. Each place gets a backend:

| Peer | Backend |
|---|---|
| Aven Peer | object storage over the S3 API: Hetzner in production, a local S3-compatible server in the box |
| Alice Peer | a folder on disk |
| Peer-Lights | OPFS |
| tests and the simulation | memory |

- **The contract is blobs and refs,** like git's objects and refs. A blob is put once and never changes: read it whole
  or a range of it, list, delete. A ref is a name pointing at a blob's hash, changed atomically: a document's head, a
  peer's key. Files, buckets and OPFS all do that well, so every backend behaves the same. No appends: object storage
  has none.
- **One writer per store** (rule 1 in the [README](README.md#the-rules)): a store never has two writers, so we don't
  depend on a bucket's locking.
- **The first backends come from Apache OpenDAL,** Rust's "one layer, all storage" library. Its release 0.59.5 (18 Oct
  2026) has fs, s3, memory and opfs. The core depends only on `Store`, never on OpenDAL, so any backend can be swapped.
- **Our own OPFS backend where speed needs it.** OpenDAL's writes whole files through `createWritable` streams. Ours
  would use sync access handles in the Peer-Light's worker: writes in place, ranges read directly, and one exclusive
  handle per file, which fits the one writer.
- **One conformance suite** that every backend passes, run in the box on all four.

StorageSDK (storagesdk.dev) was considered: it is a TypeScript library for cloud buckets, and the core is Rust, in the
browser too, and needs a folder and OPFS as well.

## avenOS in the browser

```
avenOS                                    on Alice Peer-Light  ( A  Alice's vault ▾ )
                                                     ┌──────────────────────────────────┐
 A  Alice's vault                                    │ Alice Peer-Light can act as      │
    person · governs 4 vaults · 3 peers              │  A  Alice's vault              ✓ │
                                                     └──────────────────────────────────┘
┌────────────────┐ ┌────────────────┐
│ Vault          │ │ Control Room   │
└────────────────┘ └────────────────┘

This device   Alice Peer-Light · serves Alice's vault · key 9f78… · OPFS · mark 3fa1c2d0
● live · 4 peers
```

- **The dashboard** is a grid of apps, two for now: **Vault**, your vault, who owns it and everything below it as a
  tree, and the **Control Room**, below. Any vault in the tree opens in Vault: Alice manages Aven at
  `#/alice/vault/aven`, as herself.
- **The account switcher**, the pill at the top right, picks the person you act as, never a network or a device. A
  Peer-Light acts as the person it serves: Alice Peer-Light as Alice's vault, Bob's Peer-Light as Bob's. `localhost`,
  the box's own view, holds every test key, so it can act as Alice or Bob and show what each one sees. Any other host
  is a visitor's: there avenOS is "coming soon", its apps closed.
- **An address names the person and the app:** `#/alice/control-room`, `#/bob/vault`. One naming anyone you may not act
  as, Aven included, lands on your own dashboard.

The page becomes a real Peer-Light:

- **Its key** comes from the cast and signs for the vault it serves. **Its data** is kept in OPFS through the store: a
  reload keeps it, a wipe empties it. Alice Peer and the Aven Peer keep theirs the same way, in a folder and in S3.
- **It connects** to the Aven Peer over iroh, through the relay.
- **"4 peers"** is presence: the Aven Peer counts who is connected and tells each peer.
- **Its status names a phase:** starting, connecting, live, offline, stalled.
- **The network is private by construction:** nothing outside the machine reaches the box. The invite-only door comes
  in milestone 2, with the first example app: a live chat over iroh-gossip.

## The Control Room

```
localhost:5173/#/alice/control-room                         ( A  Alice's vault ▾ )
Alice's vault governs 3 peers                                     3 live · up 2 m
┌─ Aven Peer · Peer + relay ───┐ ┌─ Alice Peer · Peer ──────────┐
│ ● live · 4 connected         │ │ ● live · direct to Aven Peer │
│ stores in S3 · relays 2      │ │ stores in a folder           │
└──────────────────────────────┘ └──────────────────────────────┘
┌─ Alice Peer-Light ───────────┐
│  avenOS, on its own origin   │
│  ● live · 4 peers            │
└──────────────────────────────┘
timeline  20:14:03.120  Alice Peer → Aven Peer  connected, direct (UDP)
```

The Control Room shows every peer the vault you act as governs, side by side, and nothing else. Switch to Bob's vault
and it shows his Peer-Light. Each Peer-Light runs avenOS in a frame on its own origin; on a
Peer-Light itself, its own pane reads "this device".

Every peer writes its events as JSON lines. The box gathers them into one timeline: one stream on screen and one file
per run. A cloud session can't show a window, so `bun run shot` takes a screenshot of the Control Room to share in the
session.

`bun run up --check` walks through avenOS on every host: whom each may act as (never Aven), what each person's Control
Room and Vault show, the vault each Peer-Light serves and its own OPFS, all held to values written out by hand from the
tree above. It photographs every screen into the run's folder.

## The box

One image holds every tool; every command runs in it.

- **The image** is `ghcr.io/myavenceo/aven/sandbox`, built from `sandbox/box/Dockerfile`. It holds:
  - Playwright's image from Microsoft's registry, at the newest release;
  - stable Rust with the wasm target and wasm-bindgen;
  - bun;
  - Lean, through elan;
  - the third-party crates (iroh, Loro, OpenDAL and the rest), already compiled, so a fresh box builds only our own
    code.

  It's built for amd64 (cloud, CI) and arm64 (OrbStack on Apple Silicon, natively). A GitHub workflow builds it when
  the box's files change and with every daily version bump. The repository is public, so the image is too, and it
  pulls without a token. Each image is tagged with the hash of the box's inputs, so every checkout runs exactly its
  own box; `latest` is main's.
- **Containers** (`sandbox/box/compose.yml`):
  - `aven`: the Aven Peer, the Peer binary with `--relay`;
  - `alice`: Alice Peer, the same binary with the relay off;
  - `s3`: a local S3-compatible server, the Aven Peer's object storage;
  - `browsers`: Chromium with both Peer-Lights and the Vite dev server for avenOS;
  - `builder`: compiles the Peer and the Peer-Light's wasm once, into one shared build folder.
- **Networks:** milestone 1 uses one, `wan`. The P2P lanes add homes behind routers ([below](#real-world-iroh-inside-the-box)).
- **Commands**, from `aven/DB2`:
  - `bun run up`: starts the box and prints avenOS's address;
  - `bun run down`;
  - `bun run logs`;
  - `bun run doctor`: checks versions, Docker settings and kernel features;
  - `bun run shot`: a screenshot of the Control Room;
  - `bun run box <command>`: any command in the box, from `aven/DB2`: `bun run box cargo test`, `bun run box sh -c
    'cd id/spec && lake build'`. Rust's build folder and its crate downloads live in volumes, kept across runs; in a
    cloud session the box reaches crates.io through the session's proxy.
- **One Docker setting:** `allow-direct-routing`, as a flag to `dockerd` or `"allow-direct-routing": true` in its
  config. Docker 28 and later drop routed traffic between its networks; in our NAT test it dropped exactly those
  packets until the setting was on.

### Tools in the image, our code outside it

The image never holds our code. It holds the tools; our crates and pages come from the checkout:

| Layer | Where it lives | Changes when |
|---|---|---|
| Tools: Rust, wasm-bindgen, bun, Lean, Chromium | the image | a version bump, at most daily |
| Third-party crates, compiled | the image, keyed by `Cargo.lock` | a dependency changes |
| Our code: crates, pages, spec | the checkout, mounted into the containers | every edit |
| Our builds | one build folder in a Docker volume, kept across `up` and `down` | every build, incrementally |
| Each peer's data | a volume per peer, the S3 server's included; `wipe` empties one | the peers write |

So a Rust edit costs one incremental build in `builder` and a restart of the peers that run it, about a second; a page
edit is a hot reload; and nothing is ever re-imaged for our own changes. The Peers run the binary straight from the
build folder, and Vite serves the Peer-Light's wasm from it, reloading the pages when it changes. The Aven Peer's
production image comes later and is a separate, slim one: just the binary.

### Where it runs

| Place | How |
|---|---|
| **Mac** (OrbStack) | `bun run up` in `aven/DB2`. OrbStack's Docker engine config gets `"allow-direct-routing": true`. avenOS opens in any Mac browser, and the Peer-Lights can then run in your browser too. The build folder lives in a Docker volume, not in a folder shared with the Mac, where many small writes are slower. |
| **Claude cloud session** | A cloud environment named avenSANDBOX. Its setup script starts `dockerd` with the setting and pulls the image. Anthropic snapshots the disk, image included, and new sessions start from that snapshot for about 7 days; the script must finish in about 5 minutes. The snapshot keeps files, not processes, so `bun run up` starts `dockerd` itself when it isn't running, in a session of its own so it outlives the command. `bun run up` only pulls the image: GitHub builds it, and a pull that fails names why. The environment sets `AVEN_DB2=1`, so the repository's hook skips v1's Rust cache. |
| **GitHub CI** | The `production` branch's checks run `bun run up --check` on a Linux runner, from the same image (macOS runners have no Docker). |

The box is a whole development machine in one image, the same on every platform that runs Docker: a Mac (OrbStack),
Linux, a Claude cloud session, CI, and Windows through Docker Desktop. The image is one image for two platforms: amd64
for cloud sessions and CI, and arm64, so OrbStack on Apple Silicon runs it natively rather than through Rosetta. Each is
built on a GitHub runner of its own kind.

**A cloud environment needs one host beyond the defaults.** GitHub's registry hands out an image's layers from
`pkg-containers.githubusercontent.com`, which the Trusted list doesn't include: there, `docker pull` from `ghcr.io`
is refused and the box builds itself instead (measured 29 Oct 2026). So the environment's network access is Custom
(Eingeschränkt), with the default package managers included and these allowed domains:

```text
ghcr.io
pkg-containers.githubusercontent.com
```

### Production

| Branch | What runs there |
|---|---|
| `main` | Nothing on GitHub: work is checked in the box, in the session that makes it. |
| `production` | Takes changes from `main` only. Every pull request into it and every push to it runs [`avensandbox.yml`](../../.github/workflows/avensandbox.yml): **Only from main** fails a pull request from any other branch, and **avenSANDBOX** runs `bun run up --check`. Later, production also deploys from here. |

**Every push to `production` that passes releases each package that changed, with no step by hand.** A package that
didn't change gets no new version; a push that changes none releases nothing.

| Package | Changes when | Its release |
|---|---|---|
| avenOS | its sources change: `os/`, `vite.config.js`, `package.json`, `bun.lock`, the cast | `@aven/os@<version>`, "avenOS &lt;version&gt;": `aven-os-web-<version>.tar.gz`, built by `bun run build`, with `SHA256SUMS` |
| avenSANDBOX | the box's image changes (its digest, so a new platform counts too) | `@aven/sandbox@<version>`, "avenSANDBOX &lt;version&gt;": `ghcr.io/myavenceo/aven/sandbox:<version>`, amd64 and arm64, named with its digest |

- **A package's versions are its own:** the date in Berlin for its first release that day (`26.10.29`), then
  `26.10.29v2`, `26.10.29v3`; the next day starts again at `26.10.30`.
- **Each release lists only its own package's changes:** the commits that touched it since its previous version, with
  the compare link. The releases page is the changelog.
- **avenPEER's builds** (the native Peer and the Peer-Light's wasm) and **avenDB's** join as packages of their own once
  they exist. On any host but the box's, the released avenOS shows only "avenOS · coming soon".

[`avensandbox-image.yml`](../../.github/workflows/avensandbox-image.yml) builds the box's image whenever its
Dockerfile changes, on any branch, and tags main's as `latest`.

**v1's three workflows are parked** in [`.github/workflows-v1/`](../../.github/workflows-v1/README.md) (Samuel, 29
Oct 2026): moved, not deleted, so `main` runs no CI and deploys nothing. v1's site, API and peer keep running as they
were last deployed; nothing redeploys them, checks that they are up, or rolls them back. Its README says how to
switch one back on.

The cloud environment's setup script is [`sandbox/box/cloud-setup.sh`](sandbox/box/cloud-setup.sh): it puts the box's image and the
page's dependencies on disk, so the environment's snapshot keeps them for every new session.

## Real-world iroh inside the box

The box can stand in for the internet: each container is its own host, each Docker network its own network, and a
router container joins a home network to the WAN with NAT. **Milestone 1 runs only the flat lane;** the others are
designed now and tested from milestone 2 on.

| Lane | How | What iroh should do |
|---|---|---|
| flat (milestone 1) | every peer on `wan` | Peers connect directly over UDP; Peer-Lights go through the relay |
| home NAT | Alice Peer on a home network, behind a router that masquerades and keeps ports | relay first, then a hole-punched direct path |
| hard NAT | the router picks random ports (`--random-fully`) | stays on the relay |
| UDP blocked | the router drops UDP | relay only, over HTTPS |
| roaming | the Peer moves to another network mid-connection | migrates its path |
| bad links | `netem` delay, loss and jitter on a link | keeps working, more slowly |
| browser direct (later) | each Peer-Light in its own Chromium container, behind its own router | a direct WebRTC path between Peer-Lights, plugged in under iroh; the relay as fallback |

iroh in the box runs fully private: our own relay, addresses handed out by the box, no n0 services and no public DNS.

## Measured in a Claude cloud session (29 Oct 2026)

| What | Result |
|---|---|
| Docker | 29.9.2 is installed, but its daemon isn't running at session start; `dockerd` comes up in a second or two |
| Pulls | Microsoft's registry: Playwright's image (3.7 GB) in 37 s. GitHub's registry answers. Docker Hub refused (429), as did Amazon's public registry (data limit). |
| Browsers in Playwright's image | Chromium, WebKit and Firefox all launch. OPFS works in Chromium and Firefox; Linux WebKit has no `navigator.storage` at all. |
| Two Peer-Lights in one Chromium | `alice.localhost` and `bob.localhost`, framed in a `localhost` page, each keep their own OPFS, and it survives a reload |
| NAT | A Peer behind a router container reached a server on another network. The server saw the router's address with the Peer's port kept, the endpoint-independent NAT that hole punching needs. Docker dropped these packets until `allow-direct-routing` was on. |
| Bad links | This kernel has no `netem` ("Specified qdisc kind is unknown"). Check it on OrbStack and in CI; in the cloud, a small UDP delay-and-drop hop in the router can stand in. |
| Session size | 4 vCPUs, 16 GB of RAM, 30 GB of disk (Claude Code's cloud docs) |
| Lean | elan fetches a toolchain on first use, from GitHub's release storage, which the session's proxy refuses (403). So the image holds the toolchain itself. crates.io answers through the proxy. |

## Latest versions, always

Every dependency and tool is pinned exactly at its newest stable release, so every build can be reproduced. `bun run
bump` moves every pin to the newest release. A scheduled GitHub workflow runs it daily, rebuilds the image and puts the
change on a task branch for the next goal. `bun run doctor` names anything that's behind.

The newest releases on 29 Oct 2026:

| Tool | Version |
|---|---|
| Rust | 1.99.1 |
| iroh, iroh-relay | 1.4.1 (v1 is on 1.3.0) |
| loro, loro-crdt | 1.17.1 |
| OpenDAL | 0.59.5 |
| wasm-bindgen | 0.2.129 |
| Playwright and its image (amd64 and arm64) | 1.64.1 |
| bun | 1.4.4 |
| Svelte, Vite, vite-plugin-svelte | 5.57.3, 8.3.5, 7.3.1 |
| TypeScript | 7.0.2 |
| Lean 4 | read from its releases at the first build |

The box also ends a drift: the repository's root pins Playwright 1.56.1, while the cloud session's own copy is 1.63.0.

## Tests in milestone 1

No scenarios yet. The Lean project and the Rust tests build and run in the box with one check each, and the store's
conformance suite runs on all four backends, so milestone 2 starts test-first with nothing left to set up. `bun run up
--check` boots every peer and exits once all four are live: the box's own health check, the one CI runs.

## Layout

```
aven/DB2/
  README.md        the rules
  SANDBOX.md       this plan
  CLAUDE.md        the rules agents load here
  package.json     @aven/os, its own JS, with bun.lock
  Cargo.toml       its own Cargo workspace, with Cargo.lock and target/ (with the first crate)
  os/web/          avenOS's browser client: the dashboard, the account switcher, and its apps in os/web/apps,
                   Vault and Control Room (Svelte 5 + Vite)
  peer/native/     aven-peer: avenPEER's native Peer, one binary; --relay makes it the Aven Peer
  peer/light/      aven-peer-light: avenPEER's Peer-Light, the same core as wasm in a worker
  db/core/         aven-db-core: the pure core every peer runs, without I/O
  db/store/        aven-db-store: the Store contract, its backends and their conformance suite
  db/spec/         Lean: Aven.DB
  id/core/         aven-id: avenID, who may act for a vault, pure
  id/spec/         Lean: Aven.ID
  sandbox/         avenSANDBOX: the runner (up, down, logs, shot, build, doctor), the check, the cast
  sandbox/box/     the image: Dockerfile, compose.yml, the cloud setup script
```

## Done when

- `bun run up` brings up all four peers from the one image: on a Mac (OrbStack), in a cloud session and in CI.
- Both Peer-Lights show avenOS live, with "4 peers" right on each. Alice Peer connects to the Aven Peer
  directly over UDP. The Control Room shows each vault the peers it governs, and one timeline.
- Each peer signs with its cast key for the vault it serves, and keeps its data through the store: the Aven Peer in the
  box's S3 server, Alice Peer in a folder, the Peer-Lights in OPFS. A reload keeps the data; a wipe empties it.
- The store's conformance suite passes on all four backends. Lean and Rust each run their one check in the box,
  `doctor` passes, and every pin is at its newest release.
- The loop's times are measured and written into this file.

## Execution plan

**Step 0, in this thread (done 29 Oct 2026):** the box (its image and workflow, `up`, `down`, `logs`, `doctor`,
`shot`, `build`, `box`, the check and its fence against v1's code, the cloud setup script, avenDB's Cargo workspace
with its five crates as stubs) and avenOS's screens on the cast's vaults: the dashboard, the account switcher, Vault
and Control Room. The UX is settled before the peers run under it.

**Step 1, three threads in parallel (started 29 Oct 2026).** Each works on its own branch with a draft PR, sized by
`.claude/skills/devx-speed`, stays in its own folders and writes what the plan should learn into its PR's body.

| Thread, branch | Builds | Its own check |
|---|---|---|
| **Peers** (Rust and Lean), `claude/avendb-peers` | `db/core`: the status phases, presence and progress counters, pure. `db/spec/`: `Aven.DB`, their model. `peer/native`: the Peer, with the iroh endpoint, the `Router`, our ALPN `aven/db/1` (hello and presence) and `--relay`; its endpoint key is its device key from the cast. `peer/light`: the Peer-Light, the core as wasm in a worker, relay-only. The box's wiring for them (`compose.yml`, `up.mjs`, the check) and avenOS's live parts: the status line, the Control Room's panes, the timeline. State in memory until the store lands. | `lake build`; Rust tests against the model; `bun run up --check` waits for all four peers live, Alice Peer direct over UDP, "4 peers" on each Peer-Light |
| **avenID** (Lean and Rust), `claude/avendb-id` | `id/spec/`: `Aven.ID`, vaults owning vaults, what a vault governs, whom a device acts for and may act on, whom a host may act as; theorems that authority never runs up the tree, a device governs nothing, and no person acts as a network. `id/core/`: `aven-id`, pure, with the cast's keys derived and checked, and a wasm build of its queries for avenOS. | `lake build` without `sorry`; `cargo test`, its property tests checked against the running Lean model |
| **Store** (Rust), `claude/avendb-store` | `db/store`: the conformance suite first, then the `Store` contract (blobs and refs) and its backends through OpenDAL (memory, fs, s3, opfs), with an S3-compatible server in the box | the suite passes on all four backends in the box |

**Step 2, in this thread as the avenDB Goal thread:** collect the three branches, each a merge commit; settle the
lockfile; wire avenOS to avenID's wasm and the peers to the store; run `bun run up --check`, measure the loop and write
the times into this file. Then the change merges into `main`, and `production` releases what changed.

**Samuel's part,** the settings no agent can change:

1. **The cloud environment avenSANDBOX:** at claude.ai/code, the environment selector under the message box, then
   **New environment**: Custom network access with the default package managers and the two domains above,
   `AVEN_DB2=1`, and [`sandbox/box/cloud-setup.sh`](sandbox/box/cloud-setup.sh) as its setup script.
2. **OrbStack:** in its Docker engine config, `"allow-direct-routing": true`.
3. **The `aven/sandbox` package public** (done 29 Oct 2026, after the organization allowed public packages).
4. **`main`'s ruleset without "CI required"** (done 29 Oct 2026): v1's CI is parked, so that check never reports.
5. **A `production` ruleset** (Settings, Rules, New branch ruleset): target `production`, Active, nobody on the bypass
   list. Rules:
   - restrict deletions, and block force pushes;
   - require a pull request, with 0 approvals and merge commits only;
   - require the status checks **Only from main** and **avenSANDBOX**, both from GitHub Actions.

   Optionally, a tag ruleset `releases` on `??.??.??*` that restricts updates and deletions (not creations), so a
   release's tag never moves.

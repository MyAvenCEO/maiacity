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

| Step | Target | Measured (cloud session, 4 vCPU, 30 Oct) |
|---|---|---|
| `bun run up` with a warm build, until every peer is live | < 10 s | **~9.5 s**: `up` 5.3–5.5 s, then all four live 4.0–4.2 s into the check, Chromium's start included |
| A change to the page, visible | < 1 s (hot reload) | **82–193 ms** (a Svelte edit until the browser shows it, 5 runs) |
| A Rust change, running on every peer | < 30 s | **14–17 s**: a change in the shared `link.rs`, so the binary and the Peer-Light's wasm both rebuild (7.9–10.8 s), the Peers restart, and every peer is live about 4 s later |
| A new cloud session, image already on disk, until every peer is live | < 2 min | **35–54 s** (3 runs): `bun run up --check` with every volume empty, dockerd stopped in two of them. The crates come precompiled in the image ([below](#the-third-party-crates-precompiled)): the first build compiles only our crates (24–42 s, was 137–183 s), `up` takes 32–51 s with dockerd's start and the page's dependencies, Lean's vectors 1.6–12.5 s, then all four live 0.7–1.4 s into the check. The whole check passes in 50–71 s |
| `bun run up --check` in all, warm | (none) | 25–32 s, of which the views 7 s and the restart and the wipe 12 s |
| A change to the box's Dockerfile, pushed, until the new image pulls | (none) | cold, nothing cached: 11 min 42 s (amd64 10 min 22 s, arm64 6 min 38 s). A dependency change rebuilds only the crates' layer, the tools coming from the registry's cache: 10 min 13 s (arm64 7 min 2 s, of it the crates 5 min 3 s and the export 80 s). The pull itself: 91 s, 3.23 GB |

Smaller steps, measured by the threads: `lake build` warm 0.15 s each (cold, programs included, 6.1 s for `Aven.ID`,
5.2 s for `Aven.DB`); `sandbox/vectors.sh --check`, both specs, 0.8–0.9 s warm; `cargo test -p aven-id` warm 4.4 s,
2000 model cases; `cargo test -p aven-gen1` 1.1 s, 1000 traces; the store against the running model, 500 traces,
1 s; `cargo test --workspace` 9.1–9.6 s warm (14 s before its dependencies were optimised); `store/check.sh`, all four backends, 11–12 s warm; an incremental `cargo build -p aven-peer` 1.3–2.4 s; aven-id's wasm 1.0 s incremental, 126 KB; the Peer-Light's
debug wasm 8 MB, wasm-bindgen 1.1 s of every change to it (21.5 MB and 2.5–2.9 s before its dependencies were
optimised, [Open questions](#open-questions), 2).

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
├── Maia City           coop      the admin, owned by Alice's vault
│   └── Aven            agent     runs the network
│       └── Aven Peer   device
├── Alice Peer          device
└── Alice Peer-Light    device
Bob's vault             person    owned by Bob's owner key
└── Bob's Peer-Light    device
```

- **A person's vault** is owned by its owner key; later by keys and passkeys acting k of n, with recovery.
- **A device's vault** is owned by the vault it serves. The device's key signs for that vault and governs nothing: a
  lost device is revoked by its vault, and the vault loses nothing.
- **Maia City, a coop's vault,** is owned by Alice's vault and holds no devices; **Aven, the agent that runs the
  network,** is owned by Maia City (PRODUCTION.md, Part C). **So Maia City is the admin, not Alice's key:** her key governs her
  vault, and through it Maia City, Aven and the Aven Peer. **Aven acts through its own device:** the Aven Peer signs
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
| Aven Peer | object storage over the S3 API: Hetzner in production; in the box, versitygw (Versity's S3 gateway over a folder), shipped in the box's image and run as the service `s3` |
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

### The contract

`Store` (`store/src/store.rs`) is an async trait. It carries no OpenDAL types: only `Hash`, `RefName`, bytes and our
`Error`.

| Call | What it does |
|---|---|
| `put(bytes) -> Hash` | The store computes the BLAKE3 hash. The same bytes twice keep one blob. |
| `get(hash)` | The whole blob, checked against its hash (`Error::Corrupt` otherwise), or `None`. |
| `get_range(hash, a..b)` | The bytes `a..b`. A range outside the blob is `Error::Range`. Ranges aren't hash-checked yet; verified ranges come with bao. |
| `has`, `list` (sorted), `delete` | Deleting a missing blob is fine. |
| `get_ref`, `list_refs` (sorted) | |
| `set_ref(name, expected, new)` | Compare-and-set. `expected = None` means the ref must not exist yet. A stale writer gets `Error::Stale`. |
| `delete_ref(name, expected)` | The same rule. |

- **No append.**
- **Ref names are flat:** 1 to 128 characters of `A-Za-z0-9._-`, not starting with a dot.
- **The same layout everywhere:** blobs at `blobs/<hex>`, refs at `refs/<name>`, a ref holding its hash in hex.
- **The contract is Lean's** (`Aven.DB.Store`, README rule 10): blobs named by their BLAKE3 hash, refs and
  compare-and-set, with theorems that a blob never changes, a stale writer is refused, a ref is never torn and, of
  racing writers expecting the same value, exactly the first is done.
- **The suite** (`store/src/conformance.rs`) replays the model's 75 traces (`db/spec/vectors/store.json`: 15
  examples and 60 generated, 1,333 calls), each on a fresh store, and every call must give the model's result. Beside
  them stay three mechanics cases: ranges over 1 MiB, 8 racing writers of which exactly one wins, and readers that
  never see a torn ref while a writer flips it. Cases report rather than panic, so the same suite runs under
  `cargo test` and in a browser. The memory store also follows the running model on 500 random traces.
- **Compare-and-set** runs under one async lock in the store, so the one writer's tasks take turns. S3 also refuses a
  stale write on the server.

### How the backends differ

| Backend | A write is atomic because | Compare-and-set |
|---|---|---|
| memory | it is inserted whole | the lock |
| fs | OpenDAL writes to `<root>/.tmp`, syncs the file, then renames it into place | the lock |
| s3 | one PUT per object, whole or absent | the lock, plus `If-Match` / `If-None-Match: *` on PUT and `If-Match` on DELETE |
| opfs | `createWritable`, which the browser commits whole on close | the lock |

- **versitygw's conditional writes are real:** a stale `If-Match` or `If-None-Match: *` gets 412, on PUT and DELETE,
  under concurrent PUTs too (20 of 20 races, one winner each).
- **S3's ETag is the content's MD5,** so rewriting the same bytes keeps the tag. Harmless, but a test must write fresh
  values.
- **OPFS refuses to delete a missing file;** the shared layer treats that as fine.
- **OPFS refuses a read that races a commit** (`NotReadableError`, sometimes `NotFoundError`); it never tears one. A ref
  read that fails checks whether the file exists and reads again, at most 8 times.
- **OpenDAL's OPFS reads through `getFile()` and `Blob.slice`,** so every read, a range included, costs a fresh `File`.
- **OpenDAL's OPFS found OPFS through `window`,** which a worker lacks, and panicked there. We forked its service to
  take `navigator.storage` from a window or a worker. Our own opfs driver ([`store/README.md`](store/README.md))
  replaced both on 30 Oct 2026, and the fork is gone.

Measured (`conformance::bench`; native in release, OPFS in Chromium 156 on the main thread):

| | memory | fs | s3 (versitygw) | opfs |
|---|---|---|---|---|
| put 200 × 4 KiB | 1.3 ms | 210 ms | 415 ms | 1117–1250 ms |
| get 200 × 4 KiB | 0.9 ms | 93 ms | 170 ms | 515–660 ms |
| put 8 MiB | 2.2 ms | 45 ms | 27 ms | 69–90 ms |
| get 8 MiB | 1.8 ms | 16 ms | 18 ms | 27–36 ms |
| 100 ranges × 4 KiB of 8 MiB | 0.4 ms | 15 ms | 223 ms | 470–570 ms |
| set_ref 100 × | 0.7 ms | 166 ms | 336 ms | 690–870 ms |

This is the case for our own OPFS backend: OpenDAL's pays about 6 ms per small write (5× fs) and 5 ms per 4 KiB range
(30× fs). Sync access handles in the worker read ranges in place, write in place, and, being exclusive, end the refused
reads.

### What each peer keeps

In milestone 1 each peer keeps one small record through its store: when it first started, a blob (`{"peer", "first"}`)
and the ref `first-start` pointing at it (`peer/native/src/record.rs`, the same code in every peer). It tells the
timeline in a `stored` line, and avenOS shows it in the Control Room and on a Peer-Light's dashboard.

| Peer | `--store` | Where, in the box |
|---|---|---|
| Aven Peer | `s3` | the box's `s3` at `http://s3:7070`, bucket `aven` |
| Alice Peer | `fs` | `/data`, its own volume `alice` |
| Peer-Lights | (OPFS, always) | their origins' OPFS, in the check's Chromium profile, the volume `chromium` |

`bun run up --check` proves both halves: after it walks the views, it restarts every peer and finds the same four
records (same time, same blob), then runs `down --wipe` and `up` and finds four new ones. The box is left up, fresh.

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
Room and Vault show, the vault each Peer-Light serves and its own OPFS, held to what the model says avenOS shows
(`Aven.ID.OS`, `id/spec/vectors/avenos.json`), shown by the cast's names. It photographs every screen into the run's
folder. First it regenerates Lean's vectors and fails when they differ from what's committed.

## The box

One image holds every tool; every command runs in it.

- **The image** is `ghcr.io/myavenceo/aven/sandbox`, built from `sandbox/box/Dockerfile`. It holds:
  - Playwright's image from Microsoft's registry, at the newest release;
  - stable Rust with the wasm target and wasm-bindgen;
  - bun;
  - Lean, through elan;
  - the third-party crates (iroh, Loro, OpenDAL and the rest), already compiled, so a fresh box builds only our own
    code ([below](#the-third-party-crates-precompiled)).

  It's built for amd64 (cloud, CI) and arm64 (OrbStack on Apple Silicon, natively). A GitHub workflow builds it when
  any file its build reads changes, a moved pin included. The repository is public, so the image is too,
  and it pulls without a token. Each image is tagged with a hash of those files, so every checkout runs exactly its
  own box; `latest` is main's.
- **Containers** (`sandbox/box/compose.yml`):
  - `aven`: the Aven Peer, the Peer binary with `--relay`;
  - `alice`: Alice Peer, the same binary with the relay off;
  - `s3`: the Aven Peer's object storage, versitygw from the box's own image, at `http://s3:7070`;
  - `browsers`: Chromium with both Peer-Lights and the Vite dev server for avenOS;
  - `builder`: compiles the Peer and the Peer-Light's wasm once, into one shared build folder.
- **Networks:** milestone 1 uses one, `wan`. The P2P lanes add homes behind routers ([below](#real-world-iroh-inside-the-box)).
- **Commands**, from `aven/DB2`:
  - `bun run up`: starts the box and prints avenOS's address;
  - `bun run down`; after `dockerd` restarts (a session that slept), run it before `up`: the containers come back on
    new addresses while a running peer keeps the old one, so the check fails on the network, not on the code;
  - `bun run logs`;
  - `bun run doctor`: checks versions, Docker settings and kernel features, and lists the pins that are behind;
  - `bun run bump [--check]`: moves every pin to its newest stable release, by hand ([below](#latest-versions-always));
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
| Tools: Rust, wasm-bindgen, bun, Lean, Chromium | the image | a person runs `bun run bump` |
| Third-party crates, compiled | the image, keyed by its tag (`Cargo.lock`, the manifests, the fork) | a dependency changes |
| Our code: crates, pages, spec | the checkout, mounted into the containers | every edit |
| Our builds | one build folder in a Docker volume, kept across `up` and `down` | every build, incrementally |
| Each peer's data | a volume per peer, the S3 server's included; `wipe` empties one | the peers write |

So a Rust edit costs one incremental build in `builder` and a restart of the peers that run it, about a second; a page
edit is a hot reload; and nothing is ever re-imaged for our own changes. The Peers run the binary straight from the
build folder, and Vite serves the Peer-Light's wasm from it, reloading the pages when it changes.

### The third-party crates, precompiled

The image's last layer compiles the workspace's dependencies, cargo-chef style
([`sandbox/box/deps.sh`](sandbox/box/deps.sh)):

- **The build context is `aven/DB2`,** cut down by its [`.dockerignore`](.dockerignore) to `Cargo.toml`, `Cargo.lock`,
  every crate's `Cargo.toml`, and `deps.sh`. Never our code.
- **Each of our crates gets a stub:** an empty library, and `fn main() {}` for every bin, example, test and bench its
  manifest names.
- **The stubs build exactly as the loop builds them:** `cargo build -p aven-peer`, the Peer-Light's wasm
  (`-p aven-peer-light --lib --target wasm32-unknown-unknown`), aven-id's wasm in release, and
  `cargo test --workspace --no-run`. Same profiles, targets and features; no RUSTFLAGS anywhere. Then the stubs' own
  artifacts go (`cargo clean -p`, each profile and target), and the fork's too, since the checkout brings its source
  again with newer times. The registry keeps the downloaded `.crate` files: without them cargo downloads all 385
  crates again, though it compiles none.
- **Docker fills an empty named volume from the image's content at its mount path.** So the compiled crates sit at
  `/work/target`, where `avensandbox_target` mounts, and their sources at `/opt/cargo/registry`, where
  `avensandbox_cargo_registry` mounts: a new session's first build finds all 342 dependencies `Fresh` (`cargo build
  -v`) and compiles only our five crates, plus the fork and opendal's thin facade for wasm. A volume that already holds
  a build keeps it.
- **The layers run tools first, crates last,** so a dependency change rebuilds only the crates' layer. GitHub keeps the
  layers' cache in the registry, beside the image (`:cache-amd64`, `:cache-arm64`): the crates' layer is too big for
  its 10 GB Actions cache.
- **The tag** is the first 16 hex digits of a SHA-256 over one line per input, its path and its content's SHA-256:
  `Dockerfile`, `deps.sh`, `tag.mjs`, `.dockerignore`, `Cargo.toml`, `Cargo.lock`, every `Cargo.toml` and the fork's
  files. [`sandbox/box/tag.mjs`](sandbox/box/tag.mjs) is the one definition: `up.mjs` imports it, and both workflows run
  `node aven/DB2/sandbox/box/tag.mjs` (`--files` lists the inputs). The image workflow's paths are the same files.
- **Only the checkout's own box runs** (Samuel, 30 Oct 2026): no fallback to another box, not even one with the same
  tools. A change that moves the tag, a new dependency included, is pushed to its branch first; until GitHub has
  published that box, `bun run up` stops and says so.
- **One box on disk:** once the containers run on the checkout's box, `up` removes the older ones. Each is about
  14 GB on disk (3.2 GB compressed), and a cloud session has 30 GB.

The box is never deployed. What ships is avenPEER's own image, `ghcr.io/myavenceo/aven/peer`, built in two stages:
the binary is compiled in the box's image, then copied onto a minimal base, tens of MB rather than the box's 5 GB.
Production runs it with its live configuration (the real relay, Hetzner's S3); the box's `aven` and `alice` can run
the same image with the box's (its relay, `http://s3:7070`), so what is tested is byte for byte what ships. It comes
once the Peer runs, built and released by the Goal thread like the box.

### The Peer's flags

One `aven-peer` binary runs in the box and in production. Every flag can also come from the environment as
`AVEN_PEER_<FLAG>`, and a flag wins. Nothing checks where it runs, and nothing of the cast is compiled into the binary
or the wasm. The box derives the cast's test keys in `up.mjs` and hands them to compose.

| Flag | What |
|---|---|
| `--name NAME` | what the peer is called in presence and the timeline (required) |
| `--secret HEX` | its Ed25519 secret seed, 64 hex digits (required; better by environment) |
| `--listen ADDR` | its UDP socket, `0.0.0.0:4433` |
| `--relay` | run the relay here: the Aven Peer |
| `--relay-listen ADDR` | the relay's HTTP socket, `0.0.0.0:3340` |
| `--relay-url URL` | the relay every peer reaches, this one's included (required) |
| `--members LIST` | `name=key,…`: the peers it knows by name; the Aven Peer admits only them |
| `--aven HOST:PORT`, `--aven-key HEX` | the Aven Peer's UDP address and key (without `--relay`) |
| `--events DIR` | also write the timeline's lines to `DIR/NAME.jsonl` |
| `--store memory\|fs\|s3` | where it keeps its data, `memory` by default |
| `--store-path DIR` | the folder, with `--store fs` |
| `--s3-endpoint URL`, `--s3-bucket NAME` | the S3 server and bucket, with `--store s3` |
| `--s3-root PREFIX`, `--s3-region NAME` | the store's prefix in the bucket (`/`) and the region (`us-east-1`) |
| `--s3-key ID`, `--s3-secret SECRET` | its credentials (better by environment) |

The Peer-Light takes the same configuration from its page: its name, its seed, the Aven Peer's key, and the page's own
origin as its relay. It always stores in OPFS.

### Where it runs

| Place | How |
|---|---|
| **Mac** (OrbStack) | `bun run up` in `aven/DB2`. OrbStack's Docker engine config gets `"allow-direct-routing": true`. avenOS opens in any Mac browser, and the Peer-Lights can then run in your browser too. The build folder lives in a Docker volume, not in a folder shared with the Mac, where many small writes are slower. |
| **Claude cloud session** | A cloud environment named avenSANDBOX. Its setup script starts `dockerd` with the setting and pulls the image. Anthropic snapshots the disk, image included, and new sessions start from that snapshot for about 7 days; the script must finish in about 5 minutes. The snapshot keeps files, not processes, so `bun run up` starts `dockerd` itself when it isn't running, in a session of its own so it outlives the command. It keeps the last `dockerd`'s pid files too, and a new session reuses those pids, so `up` first removes a pid file whose process isn't `dockerd` or `containerd` (otherwise dockerd refuses to start, as it did on 30 Oct 2026). `bun run up` only pulls the image: GitHub builds it, and a pull that fails names why. The environment sets `AVEN_DB2=1`, so the repository's hook skips v1's Rust cache. |
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
| avenOS | its sources change: `os/`, `vite.config.js`, `package.json`, `bun.lock`, the cast, and avenID's wasm it carries (`id/core`'s sources, manifest and build script) | `@aven/os@<version>`, "avenOS &lt;version&gt;": `aven-os-web-<version>.tar.gz`, built by `bun run build`, with `SHA256SUMS` |
| avenSANDBOX | the box's image changes (its digest, so a new platform counts too) | `@aven/sandbox@<version>`, "avenSANDBOX &lt;version&gt;": `ghcr.io/myavenceo/aven/sandbox:<version>`, amd64 and arm64, named with its digest |

- **A package's versions are its own:** the date in Berlin for its first release that day (`26.10.29`), then
  `26.10.29v2`, `26.10.29v3`; the next day starts again at `26.10.30`.
- **Each release lists only its own package's changes:** the commits that touched it since its previous version, with
  the compare link. The releases page is the changelog.
- **avenPEER's builds** join as a package of its own once they exist: the native Peer for each platform, the
  Peer-Light's wasm, and the node's image, `ghcr.io/myavenceo/aven/peer:<version>`. On any host but the box's, the released avenOS shows only "avenOS · coming soon".

[`avensandbox-image.yml`](../../.github/workflows/avensandbox-image.yml) builds the box's image whenever a file its
build reads changes, on any branch, and tags main's as `latest`.

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

Every dependency and tool is pinned exactly, so every build can be reproduced. **Pins move only by hand** (Samuel, 30
Oct 2026): a person runs `bun run bump` when they choose. No scheduled workflow and no bot updates anything.

- **`bun run bump --check`** lists every pin that's behind its newest stable release, and changes nothing. `bun run
  doctor` prints the same table.
- **`bun run bump`** ([`sandbox/bump.mjs`](sandbox/bump.mjs), its pins and sources in
  [`sandbox/versions.mjs`](sandbox/versions.mjs)) moves every pin to its newest stable release, regenerates `Cargo.lock`
  (`cargo update`) and `bun.lock` (`bun install`) in the box, checks in the box that the workspace with its tests, both
  wasm crates and avenOS's page still build, and prints what moved, from which version to which. A major release that
  breaks that build goes back and is reported. The change stays in the working tree: a person reviews it, runs `bun run
  up --check` and commits it. It never commits, pushes or merges.
- **Pre-releases never count**; nor do yanked crates or deprecated npm releases.

| Pin | Where | Its source |
|---|---|---|
| every crate (`=x.y.z`) | every `Cargo.toml` | crates.io's sparse index |
| every npm package | `package.json` | npm's registry |
| Rust | the Dockerfile's `RUST_VERSION` | Rust's stable channel (static.rust-lang.org) |
| wasm-bindgen's CLI | `WASM_BINDGEN_VERSION` | the `wasm-bindgen` crate: the two must match exactly |
| bun | `BUN_VERSION`, `packageManager`, `setup-bun`'s `bun-version` | npm's `bun` |
| elan, Lean | `ELAN_VERSION`, `LEAN_VERSION`, both `lean-toolchain` files | their GitHub tags, over git; their downloads, from GitHub's release storage |
| Playwright's image | the Dockerfile's `FROM` | Microsoft's registry, at the newest release npm's `playwright` has too: the two move together |
| versitygw | the Dockerfile's `FROM`, by tag and digest | GitHub's registry |
| GitHub Actions | avenDB's workflows | their GitHub tags, over git |

- **A source the network refuses** is named in the table with its reason, and its pin stays where it is; the bump moves
  the rest. A cloud session refuses GitHub's API and `release.lean-lang.org`, so tags come over git, which the
  session's proxy lets through. Where GitHub's release storage is refused, elan's and Lean's downloads go unchecked,
  said so in the table; the image's build on GitHub fetches them.
- **A moved tool or crate is a new box.** The bump's checks run on the box the checkout had. A moved crate changes
  `Cargo.lock` and a moved tool the Dockerfile, so either changes the tag: `bun run up --check` needs the new box,
  which GitHub builds 10 to 12 minutes after the change is pushed to a branch. wasm-bindgen is one: its CLI in the box must match the crate
  exactly.

The box also ends a drift: the repository's root pins Playwright 1.56.1, while the cloud session's own copy is 1.63.0.

## Tests in milestone 1

No scenarios yet. The Lean project and the Rust tests build and run in the box with one check each, and the store's
conformance suite runs on all four backends, so milestone 2 starts test-first with nothing left to set up. `bun run up
--check` boots every peer and exits once all four are live: the box's own health check, the one CI runs.

Tests derive from Lean ([README, rule 10](README.md#the-rules)), since 30 Oct 2026. The expected values once written
by hand in `check.mjs`, `id/core/wasm/check.mjs` and the Rust tests of `id/` and `db/` are Lean examples now, beside
the definitions they show: `decide` checks them where the kernel can run them, `#guard` where it can't (strings,
JSON, hashes). Each spec's `lake exe vectors` exports them with generated cases as JSON, one `{name, input,
expected}` per line, committed beside the spec:

| File | What | Loaded by |
|---|---|---|
| `id/spec/vectors/trees.json` | 100 trees and their queries: the cast's examples, trees that break each rule, input that is no tree, every query on the cast, 80 generated | aven-id's tests, its wasm check |
| `id/spec/vectors/statements.json` | the cast's devices signing, changed statements, what each acts on | aven-id's tests, with real keys |
| `id/spec/vectors/keys.json` | each cast key's seed and Ed25519 public half, derived in Lean | aven-id's tests, against `cast.json` |
| `id/spec/vectors/avenos.json` | whom each host may act as, each Control Room, each Vault view, whom each Peer-Light serves | `sandbox/check.mjs` |
| `db/spec/vectors/status.json`, `presence.json` | example and generated traces, with every state | aven-gen1's tests |
| `db/spec/vectors/timeline.json`, `wire.json` | timeline lines; streams in chunks and the frames each completes | aven-gen1's tests |
| `db/spec/vectors/store.json`, `hashes.json` | store traces with every result; spellings of a hash | the conformance suite on all four backends; aven-db-store's tests |

The model runs, too: aven-id's property test holds 2000 random trees to `aven-id-model`, the rule a tree breaks
included; aven-gen1's 1000 status and presence traces to `aven-db-model`; the memory store 500 traces. Only
mechanics stay outside Lean: crash safety and torn reads in the store, Ed25519's own checks, the peers' persistence,
what a live box shows (its status lines and paths).

## Layout

```
aven/DB2/
  README.md        the rules
  SANDBOX.md       this plan
  PRODUCTION.md    the plan for production: the first admin, then aven.maia.city
  MILESTONE2.md    the plan for milestone 2: invites, the members-only door and gossip, the chat
  CLAUDE.md        the rules agents load here
  package.json     @aven/os, its own JS, with bun.lock
  Cargo.toml       its own Cargo workspace, with Cargo.lock and target/ (with the first crate)
  os/web/          avenOS's browser client: the dashboard, the account switcher, and its apps in os/web/apps,
                   Vault and Control Room (Svelte 5 + Vite); it reads the tree through aven-id's wasm (os/web/id.js)
  peer/native/     aven-peer: avenPEER's native Peer, one binary; --relay makes it the Aven Peer
  peer/light/      aven-peer-light: avenPEER's Peer-Light, the same core as wasm in a worker
  gen1/            aven-gen1: avenDB's first generation every peer runs, without I/O (the wire, the chat's
                   chains, status, presence): it splits up as Docs arrive
  store/           aven-db-store: the Store contract, its backends and their conformance suite
  db/spec/         Lean: Aven.DB, with its vectors in db/spec/vectors
  id/core/         aven-id: avenID, who may act for a vault, pure
  id/spec/         Lean: Aven.ID, with its vectors in id/spec/vectors
  sandbox/         avenSANDBOX: the runner (up, down, logs, shot, build, doctor), the check, the cast, vectors.sh
  sandbox/box/     the image: Dockerfile, compose.yml, the cloud setup script
```

## Decisions

Made in milestone 1's threads and its integration (29–30 Oct 2026).

**avenID**
- **No cycles is defined by a rank:** every owner has a strictly lower height than what it owns. That keeps `WF`
  decidable, so the running model checks a tree itself, and gives the bound that proves `governs` and `chain` complete.
- **The device rules are part of `WF`** (Samuel, 29 Oct): a device's vault has exactly one owner, the vault it serves;
  it owns nothing; it has its own key, the key with its id, which owns nothing either. So `actsFor` is a function.
- **Person and agent vaults may have any known owners,** keys or vaults: room for k of n in milestone 3.
- **`governs` is depth first,** in the tree's order: the Vault app's tree reads the same way.
- **`sees` keeps its name** (the architect, 30 Oct): the devices a vault governs, for its Control Room. avenOS's
  `peersOf` goes. Once caps come, reading data will be wider than governing; the name is to be looked at again then.
- **avenOS reads the tree through aven-id's wasm** (Samuel, 29 Oct): a Vite alias `aven-id` points at
  `target/wasm/aven-id/`, which `bun run up` and `bun run build` build with `id/core/wasm/build.sh`. Nothing is copied
  into `os/web`. `os/web/id.js` keeps only how the page names things.

**The store**
- **Ref names are flat,** so every backend lays them out the same.
- **The suite is a public module,** so later backends and the peers can run it.
- **The OPFS suite runs in Playwright's Chromium, WebKit and Firefox,** served by a small node server: the box has
  no chromedriver for `wasm-bindgen-test-runner`. It runs in a dedicated worker, where the Peer-Light's leader runs.
- **OpenDAL's OPFS service was forked** so it ran in a worker; our own opfs driver replaced it (30 Oct 2026), and the
  fork and its `[patch.crates-io]` are gone.
- **versitygw is the box's S3:** its conditional writes are atomic. s3s-fs passed the suite only because our lock
  serialises compare-and-set; it checks `If-Match` before writing, not with it, and ignores it on DELETE.

**The Peers**
- **One core, two builds:** `aven-peer` is a library and a binary; the Peer-Light depends on it without `native`.
- **Configuration only:** keys, members, relay, addresses and the store come by flag or environment.
- **The builder is a `docker run` from `up.mjs`,** not a compose service: a cloud session's proxy needs host networking
  and its CA, which compose can't add only when they exist.
- **Presence counts the Aven Peer itself,** which gives "4 peers" and "4 connected".
- **The Peer-Light runs in a SharedWorker per origin,** since two Peer-Lights with one key would take the relay from
  each other.
- **The members-only door stays milestone 2's:** the relay admits everyone; the hub refuses keys outside its members.
- **Traces are JSON lines** through `Lean.Data.Json`, all in one process call; the Rust side uses a seeded xorshift, so
  a failure names its seed.

**Rule 10** (30 Oct 2026)
- **Examples are data beside their definitions:** a list of inputs and hand-written answers, one theorem (`decide`)
  or `#guard` over it, and the same list exported. Exported answers are the model's, which the theorem holds equal to
  the hand-written ones.
- **Why a tree is not well formed is the model's:** `Tree.check` names the first rule broken in aven-id's order, and
  `check_iff` proves it names nothing exactly for well-formed trees. A cycle names no vault; which one aven-id finds
  is its own.
- **The store's model is parametric in its hash;** its theorems hold for any. Its examples and traces run it with
  BLAKE3, written in core Lean like SHA-256, SHA-512 and Ed25519's public key: so blob names and the cast's keys come
  from the model too, checked against each specification's known answers.
- **Statements take the signature as sound:** it verifies for exactly what its key signed. Ed25519 itself is
  mechanics.
- **A timeline field never takes the place of `t`, `peer` or `event`** (the model's rule; the Rust used to let it).
- **The vectors are JSON, one vector per line,** keys sorted as Lean writes them, compared as values.
  `sandbox/vectors.sh` writes them; with `--check`, which `up --check` runs, it writes them elsewhere and fails on a
  difference. It builds and checks the specs outside aven/DB2 too, `aven/runtimes/spec` and `aven/actor/spec`, which
  `bun run box` mounts beside aven/DB2 at `/aven/DB2`, so their path to `Aven.Core` resolves: aven/runtimes whole at
  `/aven/runtimes`, since its Cargo workspace builds there too (`cd /aven/runtimes && cargo test`, its build folder a
  volume), and `aven/actor/spec` at `/aven/actor/spec`. Nothing else of the repository enters the box.

**The integration**
- **The peers keep their record through the store** as configuration: `--store s3` for the Aven Peer, `--store fs`
  for Alice Peer, OPFS for the Peer-Lights.
- **The check's Chromium keeps its profile in a volume,** so a Peer-Light's OPFS outlives a check, and a wipe empties
  it with everything else.
- **`Cargo.lock` was settled by cargo,** never by hand: each merge took the lock as it was and let `cargo metadata`
  add the other branch's packages. Every version the branches resolved is kept.
- **Tests compare JSON as values, never as text.** aven-id turns on serde_json's `preserve_order`, and Cargo unifies
  features across the workspace, so after the merge every crate's maps keep insertion order. One test of
  `aven-gen1` had compared a line's text with sorted keys.
- **rustfmt's default width (100)** stays for Rust; the prose wraps at 120. No `rustfmt.toml`.

## Open questions

Raised by the threads, not settled in milestone 1:

1. **Precompiled crates in the image** (settled 30 Oct 2026). The image compiles the third-party crates cargo-chef
   style, Docker copies them into a session's empty build folder on first mount, and the tag hashes every file the
   build reads ([The third-party crates, precompiled](#the-third-party-crates-precompiled)). A new session's first
   build fell from 137–183 s to 28 s, all four peers live 35–54 s after `up --check` starts. The image grew by
   0.79 GB compressed (amd64: 2.44 to 3.23 GB; arm64 0.75 GB), 3.1 GB on disk, and a new session copies another
   2.9 GB into its volumes. Left open: the store's own checks (`cargo test -p aven-db-store`, the OPFS wasm in
   release) resolve features of their own and still compile some crates on their first run; GitHub rebuilds the
   crates' layer whole on any dependency change.
2. **`opt-level` for dependencies** (settled 30 Oct 2026): `[profile.dev.package."*"]` with `opt-level = 1` and
   `debug = "line-tables-only"`, our crates unchanged. Measured in the box, warm:

   | | opt-level 0, full debug | opt-level 1 | opt-level 1, line tables |
   |---|---|---|---|
   | the Peer-Light's wasm, before and after wasm-bindgen | 148 MB, 21.5 MB | 170 MB, 8.1 MB | 71 MB, 8.1 MB |
   | wasm-bindgen | 2.5–2.9 s | 1.1–1.3 s | 1.1 s |
   | a change in `aven-peer`, both builds | 4.5 s | 3.5 s | 2.7 s |
   | `cargo test --workspace` (without the store), warm | 15.6 s | 3.0 s | 3.2 s |
   | the crates, compiled in the image (4 vCPU) | 3 min, 4.1 GB | 7.6 min, 4.8 GB | 5.8 min, 2.6 GB |

   Line tables keep file and line in a dependency's backtrace, and halve what the image and every volume hold.
3. **Hetzner's `If-Match`.** The Aven Peer's server-side compare-and-set needs Hetzner Object Storage to honour
   `If-Match` on PUT and DELETE. Otherwise it relies on the one writer alone, like fs. Check before production.
4. **`set_ref` on a missing blob.** The store doesn't require the blob to exist. Should the core enforce it?
5. **The fs folder's fsync.** fs syncs the file but not its folder after the rename: a power loss can lose the last
   write, never tear it.
6. **A Lean model of the store's contract:** done (30 Oct 2026), `Aven.DB.Store`; its traces run on every backend.
7. **Our own OPFS backend, or OpenDAL's with sync access handles.** OpenDAL's is slow for small writes and ranges and
   refuses reads that race a commit. Sync access handles in the Peer-Light's worker fix both; they exist only in
   workers, which the fork now reaches. Also: offer the fork's fix upstream, so the fork can go.
   **Decided (Samuel, 30 Oct 2026): our own,** `opfs-sync` in `store`, after the agent rename. Measured that day,
   200 × 4 KiB writes: Chromium 14 ms (OpenDAL 2,066), WebKit 4–10 ms (712–869), Firefox 24–45 ms (4,070). Sync access
   handles exist in a dedicated worker in all three engines, but in a SharedWorker only in WebKit, so the Peer-Light
   moves to a dedicated worker run by the one tab that holds a Web Lock; other tabs reach it through a BroadcastChannel,
   and the next tab takes over when it closes. The contract, the Lean model and the conformance suite stay; the
   opendal-opfs fork goes; iOS 15.2–25 may work too (to confirm on a real iOS 18).
8. **Rule 10's vectors:** done (30 Oct 2026), [Tests in milestone 1](#tests-in-milestone-1).

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

**Step 1, three threads in parallel (done 29–30 Oct 2026: #1402, #1403, #1404).** Each works on its own branch with
a draft PR, sized by `.claude/skills/devx-speed`, stays in its own folders and writes what the plan should learn into
its PR's body.

| Thread, branch | Builds | Its own check |
|---|---|---|
| **Peers** (Rust and Lean), `claude/avendb-peers` | `gen1`: the status phases, presence and progress counters, pure. `db/spec/`: `Aven.DB`, their model. `peer/native`: the Peer, with the iroh endpoint, the `Router`, our ALPN `aven/db/1` (hello and presence) and `--relay`; its endpoint key is its device key from the cast. `peer/light`: the Peer-Light, the core as wasm in a worker, relay-only. The box's wiring for them (`compose.yml`, `up.mjs`, the check) and avenOS's live parts: the status line, the Control Room's panes, the timeline. State in memory until the store lands. | `lake build`; Rust tests against the model; `bun run up --check` waits for all four peers live, Alice Peer direct over UDP, "4 peers" on each Peer-Light |
| **avenID** (Lean and Rust), `claude/avendb-id` | `id/spec/`: `Aven.ID`, vaults owning vaults, what a vault governs, whom a device acts for and may act on, whom a host may act as; theorems that authority never runs up the tree, a device governs nothing, and no person acts as a network. `id/core/`: `aven-id`, pure, with the cast's keys derived and checked, and a wasm build of its queries for avenOS. | `lake build` without `sorry`; `cargo test`, its property tests checked against the running Lean model |
| **Store** (Rust), `claude/avendb-store` | `store`: the conformance suite first, then the `Store` contract (blobs and refs) and its backends through OpenDAL (memory, fs, s3, opfs), with an S3-compatible server in the box | the suite passes on all four backends in the box |

**Step 2, the integration (done 30 Oct 2026),** on `claude/avendb-integration`: the three branches collected, each a
merge commit (id, store, peers); `Cargo.lock` settled by cargo; avenOS reading the tree through aven-id's wasm; every
peer keeping its record through the store; `bun run up --check` green, with the restart and the wipe proven; the loop
measured and written into this file. Then the change merges into `main`, and `production` releases what changed.

**Samuel's part,** the settings no agent can change:

1. **The cloud environment avenSANDBOX:** at claude.ai/code, the environment selector under the message box, then
   **New environment**: Custom network access with the default package managers and the two domains above,
   `AVEN_DB2=1`, and this setup script. It only finds the repository's
   [`sandbox/box/cloud-setup.sh`](sandbox/box/cloud-setup.sh) and runs it, so that file can move without breaking a
   session. A setup script that exits non-zero stops every new session before Claude starts: on 29 Oct 2026 an old
   path did that to four at once.

   ```bash
   #!/bin/bash
   # avenSANDBOX: warms the box for new sessions. The real script is the repository's
   # aven/DB2/sandbox/box/cloud-setup.sh; this only finds it, wherever the repository is cloned,
   # and never fails a session.
   for f in aven/DB2/sandbox/box/cloud-setup.sh */aven/DB2/sandbox/box/cloud-setup.sh /home/user/*/aven/DB2/sandbox/box/cloud-setup.sh; do
     if [ -f "$f" ]; then bash "$f"; exit 0; fi
   done
   echo "avenSANDBOX: aven/DB2/sandbox/box/cloud-setup.sh not found; sessions start without a warm box"
   exit 0
   ```
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

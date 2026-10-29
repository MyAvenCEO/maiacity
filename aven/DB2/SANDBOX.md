# avenSANDBOX: milestone 1

avenSANDBOX is the network avenDB2 is built and tested in: two Peer-Lights in one Chromium and two Peers, one of them
the Aven Peer with its relay on, in containers on one machine, started with one command. Milestone 1 builds the sandbox
itself and one page, a "coming soon" landing page, as the starter every later primitive grows from. The first example
app, a chat, comes in milestone 2. **No test scenarios yet.**

## The loop

The point is speed: a change is seen running on every peer in seconds or minutes, never after a 30-minute CI and
deploy round. Nothing in the loop deploys. The Aven Peer runs on the same machine, and "deploying" means restarting its
container.

Targets, measured in this milestone and reported on every run:

| Step | Target |
|---|---|
| `bun run up` with a warm build, until every peer is live | < 10 s |
| A change to the page, visible | < 1 s (hot reload) |
| A Rust change, running on every peer | < 30 s |
| A new cloud session, image already on disk, until every peer is live | < 2 min |

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
The cast is one list in the sandbox's config; adding a peer is one line.

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

## The landing page

```
                      avenDB2
                    coming soon

        ● live · 4 peers · Aven Peer 3 ms
        you: Alice Peer-Light · key 7f3a…
```

The page is a real Peer-Light:

- **Its key** is made on first load and kept in OPFS through the store: a reload keeps it, a wipe makes a new one.
  Alice Peer and the Aven Peer keep theirs the same way, in a folder and in S3.
- **It connects** to the Aven Peer over iroh, through the relay.
- **"4 peers"** is presence: the Aven Peer counts who is connected and tells each peer.
- **Its status names a phase:** starting, connecting, live, offline, stalled.
- **The network is private by construction:** nothing outside the machine reaches the box. The invite-only door comes
  in milestone 2, with the first example app: a live chat over iroh-gossip.

## The control room

```
localhost:5173 · avenSANDBOX                          4 live · up 2 m
┌─ Alice Peer-Light ───────────┐ ┌─ Bob's Peer-Light ───────────┐
│     avenDB2 coming soon      │ │     avenDB2 coming soon      │
│  ● live · 4 peers            │ │  ● live · 4 peers            │
└──────────────────────────────┘ └──────────────────────────────┘
┌─ Alice Peer · Rust ──────────┐ ┌─ Aven Peer · Rust + relay ───┐
│ ● live · direct to Aven Peer │ │ ● live · 4 connected         │
│ stores in a folder           │ │ stores in S3 · relays 2      │
└──────────────────────────────┘ └──────────────────────────────┘
timeline  20:14:03.120  Alice Peer → Aven Peer  connected, direct (UDP)
```

Every peer writes its events as JSON lines. The box gathers them into one timeline: one stream on screen and one file
per run. A cloud session can't show a window, so `bun run shot` takes a screenshot of the control room to share in the session.

## The box

One image holds every tool; every command runs in it.

- **The image** is `ghcr.io/myavenceo/avensandbox`, built from `box/Dockerfile`. It holds:
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
- **Containers** (`box/compose.yml`):
  - `aven`: the Aven Peer, the Peer binary with `--relay`;
  - `alice`: Alice Peer, the same binary with the relay off;
  - `s3`: a local S3-compatible server, the Aven Peer's object storage;
  - `browsers`: Chromium with both Peer-Lights, the Vite dev server and the control room;
  - `builder`: compiles the Peer and the Peer-Light's wasm once, into one shared build folder.
- **Networks:** milestone 1 uses one, `wan`. The P2P lanes add homes behind routers ([below](#real-world-iroh-inside-the-box)).
- **Commands**, from `aven/DB2`:
  - `bun run up`: starts the box and prints the control room's address;
  - `bun run down`;
  - `bun run logs`;
  - `bun run doctor`: checks versions, Docker settings and kernel features;
  - `bun run shot`: a screenshot of the control room.
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
| **Mac** (OrbStack) | `bun run up` in `aven/DB2`. OrbStack's Docker engine config gets `"allow-direct-routing": true`. The control room opens in any Mac browser, and the Peer-Lights can then run in your browser too. The build folder lives in a Docker volume, not in a folder shared with the Mac, where many small writes are slower. |
| **Claude cloud session** | A cloud environment named avenSANDBOX. Its setup script starts `dockerd` with the setting and pulls the image. Anthropic snapshots the disk, image included, and new sessions start from that snapshot for about 7 days; the script must finish in about 5 minutes. The snapshot keeps files, not processes, so a session-start hook starts `dockerd` again. The environment sets `AVEN_DB2=1`, so the repository's hook skips v1's Rust cache. |
| **GitHub CI** | The same image as the job's container, on Linux runners (macOS runners have no Docker). Once per goal, like everything else. |

The cloud environment's setup script, once the image exists:

```bash
dockerd --allow-direct-routing > /var/log/dockerd.log 2>&1 &
for i in $(seq 1 60); do docker info > /dev/null 2>&1 && break; sleep 1; done
docker pull ghcr.io/myavenceo/avensandbox:latest
```

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
  Cargo.toml       its own workspace, with Cargo.lock and target/
  package.json     its own JS, with bun.lock
  box/             Dockerfile, compose.yml, the cloud setup script
  crates/core      the pure core every peer runs, without I/O
  crates/store     the Store contract, its backends and their conformance suite
  crates/peer      the Peer, one binary; --relay makes it the Aven Peer
  crates/web       the Peer-Light: the core as wasm in a worker
  spec/            Lean
  sandbox/         the runner: up, down, doctor, shot, the timeline
  app/             the landing page and the control room (Svelte 5 + Vite)
```

## Done when

- `bun run up` brings up all four peers from the one image: on a Mac (OrbStack), in a cloud session and in CI.
- Both Peer-Lights show the landing page live, with "4 peers" right on each. Alice Peer connects to the Aven Peer
  directly over UDP. The control room shows all four peers and one timeline.
- Each peer keeps its key through the store: the Aven Peer in the box's S3 server, Alice Peer in a folder, the
  Peer-Lights in OPFS. A reload keeps a key; a wipe makes a new one.
- The store's conformance suite passes on all four backends. Lean and Rust each run their one check in the box,
  `doctor` passes, and every pin is at its newest release.
- The loop's times are measured and written into this file.

## Execution plan

**Step 0, in this thread:** a clickable mock of the landing page and the control room, a page Samuel opens on any
device. The UX is settled before any code.

**Step 1, four threads in parallel.** Each works on a task branch with a draft PR and no CI, sized by
`.claude/skills/devx-speed`.

| Thread | Builds | Its own check |
|---|---|---|
| **Box** | the Dockerfile and the image workflow (GitHub's registry, amd64 and arm64, tagged by the hash of the box's inputs); `compose.yml`; `bun run up`, `down`, `logs`, `doctor`, `shot` and `up --check`; the cloud setup script and the session hook; the fence check (no legacy imports, the folder's spelling); the root `Cargo.toml` excluding `aven/DB2`; `check.mjs` and the goal CI running `bun run up --check` | `bun run up` brings up the five containers with placeholder peers, and `doctor` passes in a cloud session |
| **Store** (Rust) | `crates/store`: the contract (blobs and refs), its backends through OpenDAL (s3, fs, opfs, memory) and the conformance suite | the suite passes on memory and fs, on s3 against the box's S3 server, and on opfs in Chromium |
| **Peers** (Rust and Lean) | `crates/core`: the status phases, presence and progress counters, pure. `crates/peer`: the binary, with the iroh endpoint, the `Router`, our ALPN `avendb2/1` (hello and presence), `--relay` and `--store`. `crates/web`: the Peer-Light, the core as wasm in a worker, relay-only, storing in OPFS. `spec/` with its one check. | unit tests; two Peers and a Peer-Light connect over iroh in a test; `lake build` |
| **Page** (JS) | `app/`: the landing page and the control room, first on recorded status, then on the real peers | `svelte-check`; the pages render the recorded status |

The Store thread's first commit is the `Store` trait, so the Peers thread builds on it from the start.

**Step 2, in this thread as the avenDB2 Goal thread:** collect the four branches (`collect.mjs`), bring the box up in a
cloud session, run `bun run up --check`, measure the loop and write the times into this file. Then the goal PR runs CI
once and merges.

**Samuel's part,** the settings no agent can change:

1. Create the cloud environment avenSANDBOX: the setup script above, Trusted network access, `AVEN_DB2=1`.
2. In OrbStack's Docker engine config, set `"allow-direct-routing": true`.
3. Once the first image is pushed, check that the `avensandbox` package on GitHub is public.

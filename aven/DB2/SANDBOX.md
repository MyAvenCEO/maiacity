# avenSANDBOX: milestone 1

avenSANDBOX is the network avenDB2 is built and tested in. Two browser devices, a native node and the server each run
in their own container on one machine, started with one command. Milestone 1 builds the sandbox itself and one page, a
"coming soon" landing page, as the starter every later primitive grows from. **No test scenarios yet.**

## The loop

The point is speed: a change is seen running on every node in seconds or minutes, never after a 30-minute CI and
deploy round. Nothing in the loop deploys. The server runs on the same machine, and "deploying" means restarting its
container.

Targets, measured in this milestone and reported on every run:

| Step | Target |
|---|---|
| `bun run up` with a warm build, until every node is live | < 10 s |
| A change to the page, visible | < 1 s (hot reload) |
| A Rust change, running on every node | < 30 s |
| A new cloud session, image already on disk, until every node is live | < 2 min |

## The cast

| Node | What it is | Keeps its data in | Reaches the others |
|---|---|---|---|
| **Alice** | a browser device: Playwright's Chromium, page at `alice.localhost` | the OPFS of its origin | through the server's relay (browsers can't send UDP) |
| **Bob** | a browser device in the same Chromium, page at `bob.localhost` | the OPFS of its origin, separate from Alice's (measured) | through the relay |
| **Bob's Mac** | the native Rust node, the core of the future Mac app, as a Linux binary | a folder | iroh directly over UDP, the relay as fallback |
| **server** | one Rust process: the iroh relay and the server's peer | a folder now, a local S3-compatible bucket later; never a real cloud bucket | it runs the relay |

Each node is its own container. Both browser devices share one Chromium, as two origins with two separate storages.
The cast is one list in the sandbox's config; adding a device is one line.

## The landing page

```
                    avenDB2
                  coming soon

      ● live · 4 on the network · server 3 ms
      Alice (you) · Bob · Bob's Mac · server
```

The page is a real device:

- **Its key** is made on first load and kept in OPFS: a reload keeps it, a wipe makes a new one.
- **It connects** to the server over iroh, through the relay.
- **"4 on the network"** is presence, counted by the server.
- **Its status names a phase:** starting, connecting, live, offline, stalled.

## The control room

```
localhost:5173 · avenSANDBOX                         4 live · up 2 m
┌─ Alice · alice.localhost ────┐ ┌─ Bob · bob.localhost ────────┐
│     avenDB2 coming soon      │ │     avenDB2 coming soon      │
│  ● live · 4 on the network   │ │  ● live · 4 on the network   │
└──────────────────────────────┘ └──────────────────────────────┘
┌─ Bob's Mac · native node ────┐ ┌─ server · relay + peer ──────┐
│ ● live · direct to server    │ │ ● live · 4 connected         │
│ key 7f3a… · data in /data    │ │ relay: 2 browsers · up 2 m   │
└──────────────────────────────┘ └──────────────────────────────┘
timeline  20:14:03.120  Bob's Mac → server  connected, direct (UDP)
```

Every node writes its events as JSON lines. The box gathers them into one timeline: one stream on screen and one file
per run. A cloud session can't show a window, so `bun run shot` takes a screenshot of the control room for the chat.

## The box

One image holds every tool; every command runs in it.

- **The image** is `ghcr.io/myavenceo/avensandbox`, built from `box/Dockerfile`. It holds:
  - Playwright's image from Microsoft's registry, at the newest release;
  - stable Rust with the wasm target and wasm-bindgen;
  - bun;
  - Lean, through elan;
  - avenDB2's dependencies, already compiled.

  It's built for amd64 (cloud, CI) and arm64 (OrbStack on Apple Silicon, natively). A GitHub workflow builds it when
  the box's files change and with every daily version bump. The repository is public, so the image is too, and it
  pulls without a token.
- **Containers** (`box/compose.yml`):
  - `server`: the relay and the peer;
  - `mac`: the native node;
  - `browsers`: Chromium, the Vite dev server and the control room;
  - `builder`: compiles the Rust once for all of them, into one shared build folder.
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

### Where it runs

| Place | How |
|---|---|
| **Mac** (OrbStack) | `bun run up` in `aven/DB2`. OrbStack's Docker engine config gets `"allow-direct-routing": true`. The control room opens in any Mac browser, and the browser devices can then run in your browser too. |
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
| flat (milestone 1) | every node on `wan` | native nodes connect directly over UDP; browsers go through the relay |
| home NAT | Bob's Mac on a home network, behind a router that masquerades and keeps ports | relay first, then a hole-punched direct path |
| hard NAT | the router picks random ports (`--random-fully`) | stays on the relay |
| UDP blocked | the router drops UDP | relay only, over HTTPS |
| roaming | the node moves to another network mid-connection | migrates its path |
| bad links | `netem` delay, loss and jitter on a link | keeps working, more slowly |

iroh in the box runs fully private: our own relay, addresses handed out by the box, no n0 services and no public DNS.

## Measured in a Claude cloud session (29 Oct 2026)

| What | Result |
|---|---|
| Docker | 29.9.2 is installed, but its daemon isn't running at session start; `dockerd` comes up in a second or two |
| Pulls | Microsoft's registry: Playwright's image (3.7 GB) in 37 s. GitHub's registry answers. Docker Hub refused (429), as did Amazon's public registry (data limit). |
| Browsers in Playwright's image | Chromium, WebKit and Firefox all launch. OPFS works in Chromium and Firefox; Linux WebKit has no `navigator.storage` at all. |
| Two devices in one Chromium | `alice.localhost` and `bob.localhost`, framed in a `localhost` page, each keep their own OPFS, and it survives a reload |
| NAT | A node behind a router container reached a server on another network. The server saw the router's address with the node's port kept, the endpoint-independent NAT that hole punching needs. Docker dropped these packets until `allow-direct-routing` was on. |
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
| wasm-bindgen | 0.2.129 |
| Playwright and its image (amd64 and arm64) | 1.64.1 |
| bun | 1.4.4 |
| Svelte, Vite, vite-plugin-svelte | 5.57.3, 8.3.5, 7.3.1 |
| TypeScript | 7.0.2 |
| Lean 4 | read from its releases at the first build |

The box also ends a drift: the repository's root pins Playwright 1.56.1, while the cloud session's own copy is 1.63.0.

## Tests in milestone 1

No scenarios yet. The Lean project and the Rust tests build and run in the box with one check each, so milestone 2
starts test-first with nothing left to set up. `bun run up --check` boots every node and exits once all four are live:
the box's own health check, the one CI runs.

## Layout

```
aven/DB2/
  README.md        the rules
  SANDBOX.md       this plan
  CLAUDE.md        the rules agents load here
  Cargo.toml       its own workspace, with Cargo.lock and target/
  package.json     its own JS, with bun.lock
  box/             Dockerfile, compose.yml, the cloud setup script
  crates/server    the relay and the peer, one binary
  crates/node      the native node, the core of the future Mac app
  crates/device    the browser device: wasm in a worker
  spec/            Lean
  sandbox/         the runner: up, down, doctor, shot, the timeline
  app/             the landing page and the control room (Svelte 5 + Vite)
```

## Done when

- `bun run up` brings up all four nodes from the one image: on a Mac (OrbStack), in a cloud session and in CI.
- Both browser devices show the landing page live, with "4 on the network". Bob's Mac connects to the server directly
  over UDP. The control room shows all four nodes and one timeline.
- A reload keeps a device's key; a wipe makes a new one.
- Lean and Rust each run their one check in the box, `doctor` passes, and every pin is at its newest release.
- The loop's times are measured and written into this file.

## Threads

- **Box:** the image, compose, the setup script and hook, the workflow, `doctor`, `bump`.
- **Rust:** the server, the native node and the browser device.
- **Page:** the landing page and the control room.

The avenDB2 Goal thread leads them and collects their branches.

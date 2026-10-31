# avenSANDBOX

The box: every peer of avenDB in containers on one machine, started with one command and checked end to end, in three
browsers, before anything ships.

## Owns

- [The box](#the-box): one image of tools, our code outside it, its containers, commands and where it runs.
- [The image and its tag](#the-image-and-its-tag): what the image holds, how it is built, and the tag that ties it to
  one checkout.
- [The cast](#the-cast): the box's four peers and their vaults, with public test keys, and production's stand-in.
- [The check](#the-check): `bun run up --check`, from Lean's vectors to every screen.
- [Topologies](#topologies): real-world networks inside the box, `bun run lanes`.
- [The fuzzer](#the-fuzzer): cargo-fuzz on its own nightly, in the box.
- [Pins](#pins): every version exact, moved only by hand.
- [Checks before production](#checks-before-production): the workflow a change passes on GitHub before it is
  released.

## Uses

- [avenPEERS](../peers/README.md): the Peer binary (`aven-peer`) and its flags, the Peer-Light's wasm, the relay, and
  the releases and deploys that follow the check.
- [avenSTORE](../store/README.md): the backends the cast's peers store in, and the conformance suite it runs on all
  four.
- [avenOS](../os/README.md): the pages the check walks.
- [avenID](../id/README.md): the cast's tree and keys, read by avenID's code; [avenCAPS](../caps/README.md): the
  register production's stand-in keeps.
- [avenRUNTIME](../runtime/README.md): its frozen modules, rebuilt and compared (`freeze.sh --check`).
- [avenDOCS](../docs/README.md): the fuzz targets.
- [avenCORE](../core/README.md) and every package's Lean: the vectors the check regenerates and compares.

## The box

The point is speed: a change is seen running on every peer in seconds, never after a round of CI and deploys. Nothing
in the loop deploys; "deploying" the Aven Peer in the box means restarting its container. One image holds every tool,
and our code never enters it: it stays in the checkout, mounted in.

| Layer | Where it lives | Changes when |
|---|---|---|
| Tools: Rust, wasm-bindgen, bun, Lean, the browsers | the image | a person runs `bun run bump` |
| Third-party crates, compiled | the image, keyed by its tag | a dependency changes |
| Our code: crates, pages, specs | the checkout, mounted into the containers | every edit |
| Our builds | one build folder in a Docker volume, kept across `up` and `down` | every build, incrementally |
| Each peer's data | a volume per peer, the S3 server's included | the peers write; `wipe` empties them |

- **Containers** (`sandbox/box/compose.yml`): `aven`, the Aven Peer (the Peer binary with `--relay`); `alice`, Alice
  Peer (the same binary, relay off); `prod`, production's stand-in ([below](#the-cast)); `s3`, the Aven Peer's object
  storage, versitygw at `http://s3:7070`; `browsers`, Chromium, WebKit and Firefox with the Peer-Lights and avenOS's
  Vite dev server. The build is a `docker run` from `up.mjs` into the one shared build folder, which the Peers run their
  binary from and Vite serves the Peer-Light's wasm from.
- **Commands,** from `aven/DB2`:

  | Command | What |
  |---|---|
  | `bun run up [--check]` | starts the box and prints avenOS's address; with `--check`, runs [the check](#the-check) |
  | `bun run down [--wipe]` | stops it; `--wipe` empties every peer's store. Run it before `up` after `dockerd` restarts |
  | `bun run logs`, `bun run shot` | the peers' logs; a screenshot of the Control Room |
  | `bun run doctor` | versions, Docker's settings and kernel features, and the pins that are behind |
  | `bun run box <command>` | any command in the box: `bun run box cargo test`, `bun run box sh -c 'cd id/spec && lake build'` |
  | `bun run bump [--check]` | moves every pin to its newest stable release ([Pins](#pins)) |
  | `bun run lanes` | the [topologies](#topologies) |

- **One Docker setting:** `allow-direct-routing`. Docker 28 and later drop routed traffic between its networks
  without it.
- **Where it runs:** on a Mac with OrbStack (natively on Apple Silicon), in a Claude cloud session, on GitHub's Linux
  runners, and anywhere else Docker runs. A cloud session's environment is named avenSANDBOX; it sets `AVEN_DB2=1`,
  allows `ghcr.io` and `pkg-containers.githubusercontent.com`, and its setup script runs
  `sandbox/box/cloud-setup.sh`, which puts the image and the page's dependencies on disk for the environment's
  snapshot. The snapshot keeps files, not processes, so `bun run up` starts `dockerd` itself.
- **Private by construction:** nothing outside the machine reaches the box. iroh runs fully private there: the box's
  own relay, addresses the box hands out, no n0 services and no public DNS.
- **The loop's targets:** `bun run up`, warm, until every peer is live, under 10 s; a page change visible under 1 s; a
  Rust change running on every peer under 30 s; a new cloud session with the image on disk, until every peer is live,
  under 2 min.

**Decided:** README rules 2, 10, 12 and 13; SANDBOX.md's decisions, **The builder is a `docker run` from `up.mjs`**,
**The check's Chromium keeps its profile in a volume** · **Lean:** not in Lean (the box is mechanics)

## The image and its tag

The image is the whole development machine, the same on every platform, and its tag ties it to exactly one checkout.

- **`ghcr.io/myavenceo/aven/sandbox`,** built from `sandbox/box/Dockerfile` by GitHub (`avensandbox-image.yml`), never
  locally, for amd64 and arm64, each on a runner of its own kind, whenever a file its build reads changes, on any
  branch. Main's is tagged `latest`. It is public and pulls without a token.
- **It holds:** Playwright's image with Chromium, WebKit and Firefox, at the newest release; stable Rust with the wasm
  target and wasm-bindgen; a dated nightly and cargo-fuzz, for [the fuzzer](#the-fuzzer) only; bun; Lean through elan,
  the toolchain itself in the image; versitygw; and the third-party crates, already compiled.
- **The crates, precompiled** cargo-chef style (`sandbox/box/deps.sh`). The build's context is `aven/DB2`, cut by its
  `.dockerignore` to the manifests, `Cargo.lock` and `deps.sh`, never our code. Each of our crates gets a stub, the
  stubs are built exactly as the loop builds them (the Peer, the Peer-Light's wasm, avenID's wasm in release,
  `cargo test --workspace --no-run`), and then their own artifacts go. A manifest the workspace excludes, such as the
  fuzz targets', is never stubbed. Docker fills an empty named volume from the image at its mount path, so a fresh
  session's first build finds every dependency fresh. Third-party crates build at `opt-level = 1` with line tables
  only.
- **The layers run tools first and crates last,** so a dependency change rebuilds only the crates' layer; GitHub keeps
  the layers' cache in the registry beside the image.
- **The tag** is the first 16 hex digits of a SHA-256 over one line per input, its path and its content's SHA-256. The
  inputs: `sandbox/box/Dockerfile`, `sandbox/box/deps.sh`, `sandbox/box/tag.mjs`, `.dockerignore`, `Cargo.toml`,
  `Cargo.lock`, avenRUNTIME's registry's `Cargo.toml`, and every `Cargo.toml` under `aven/DB2`.
  `sandbox/box/tag.mjs` is the one definition: `up.mjs` imports it, and the workflows run it
  (`node aven/DB2/sandbox/box/tag.mjs`; `--files` lists the inputs).
- **Only the checkout's own box runs,** never another with the same tools. Until GitHub has published the checkout's
  box, 10 to 12 minutes after the push that changes an input, `bun run up` stops and says so.
- **One box on disk:** once the containers run on the checkout's box, `up` removes the older ones.
- **Its release** is `@aven/sandbox@<version>`, made when the image's digest changes
  ([Checks before production](#checks-before-production)).

**Decided:** Samuel, 30 Oct (only the checkout's own box runs); milestone 1's open questions 1 and 2, settled
(the crates precompiled; `opt-level` 1 with line tables) · **Lean:** not in Lean

## The cast

The box always runs the same four peers with the same vaults and public test keys, so every check knows exactly what
every screen must show.

| Peer | What it is | Stores in | Reaches the others |
|---|---|---|---|
| **Aven Peer** | the Peer with `--relay`: the server, the relay in its process | the box's S3 (`s3`, bucket `aven`) | it runs the relay |
| **Alice Peer** | the Peer, relay off | a folder (`/data`, its own volume) | iroh directly over UDP, the relay as fallback |
| **Alice Peer-Light** | the Peer-Light in a browser, at `alice.localhost` | its origin's OPFS | through the relay |
| **Bob's Peer-Light** | the same, at `bob.localhost` | its origin's OPFS, apart from Alice's | through the relay |

```
Alice's vault           person    owned by Alice's owner key
├── Maia City           coop      the admin
│   └── Aven            agent     runs the network
│       └── Aven Peer   device
├── Alice Peer          device
└── Alice Peer-Light    device
Bob's vault             person    owned by Bob's owner key
└── Bob's Peer-Light    device
```

- **Maia City is the admin, not Alice's key.** Its admin acts, tickets among them, count when its owners approve them;
  in the cast that is Alice's vault. Aven acts through its own device, the Aven Peer, within what Maia City gives it.
- **A vault governs everything below it, and sees only that:** Alice's Control Room has her two devices and the Aven
  Peer, Bob's his Peer-Light.
- **Every key is a test key:** its Ed25519 seed is `sha256("avenSANDBOX test signer: <id>")`, public on purpose and
  valid only inside the box. `up.mjs` derives them and hands them to the containers; nothing of the cast is compiled
  into a binary or the wasm.
- **One file,** `sandbox/cast.json`; adding a peer is one entry. Who may act for whom is avenID's, which reads the
  cast's tree ([avenID](../id/README.md)).
- **Production's stand-in** (`prod`) is no peer of the cast: an Aven Peer in production's configuration, with no cast,
  its register in the box's S3 under a root of its own, and the box's test MaiaCityGuardian. avenOS is in front of it at
  `http://localhost:5174`, served by the same Vite, and the release build (`dist/`) as Caddy serves production at
  `localhost:5175`. A passkey's RP ID there is `localhost`.
- **The PRF stand-in** (`sandbox/prf.mjs`): the virtual authenticator WebKit and Firefox run the box's passkeys on has
  no PRF, so the box answers a ceremony's PRF with SHA-256 of a label, the credential's id and the salt. Only the box
  does this; the real PRF is checked against Chromium's own virtual authenticator.
- **Checks run the real path:** a box check never takes keys from the cast's configuration, and product code has no
  fixture path. A check that needs a person's keys signs up through the PRF stand-in and makes the keyring as a person's
  browser would.

**Decided:** A28 (only a vault is an admin; its acts count with its owners' approval); A168 (checks run the real path);
SANDBOX.md's decisions, **The device rules are part of `WF`** ·
**Lean:** `Aven.ID.Cast` — `cast_wf`, `cast_examples`, `aven_not_account`, `coop_not_account`; the cast's keys derived
in `Aven.ID.Keys`

## The check

`bun run up --check` boots every peer and walks everything, in Chromium, WebKit and Firefox, photographing every screen
into the run's folder (`runs/<time>/`) with its timeline and report. A check reads its expected values from Lean's
vectors or from the page that wrote them, never from itself (README rule 10). It fails at the first step that fails.

1. **The fence** (`fence.mjs`): nothing uses v1's code, and the folder is spelled `aven/DB2`.
2. **Lean's vectors** (`vectors.sh --check`): every spec's vectors (`core/spec`, `id/spec`, `db/spec`,
   `aven/runtimes/spec`; `aven/actor/spec` is built) are regenerated in the box and compared with what is committed.
3. **The frozen modules** (`aven/runtimes/freeze.sh --check`): rebuilt, hashed, and compared with the manifest.
4. **The peers and the views** (`check.mjs`): all four live, Alice Peer direct to the Aven Peer over UDP, both
   Peer-Lights through the relay, each showing "4 peers"; avenOS's views held to `avenos.json`; each Peer-Light on its
   own OPFS.
5. **What each peer keeps** (`records.mjs`): a restart keeps every peer's record, a wipe empties it.
6. **Three engines** (`engines.mjs`): the Peer-Lights and the views in WebKit and Firefox, and the release build in all
   three.
7. **No shared file runs on avenOS's origin** (`inline.mjs`).
8. **The drawer** (`drawer.mjs`), held to avenRUNTIME's vectors.
9. **Brain** (`brain.mjs`) at a desktop's and a phone's width.
10. **The runtime host in the browser** (`runtimes.mjs`).
11. **Sign-up and sign-in** (`claim.mjs`), on production's stand-in: a passkey without PRF refused, the first sign-up,
    a second refused, a sign-in, a restart and a wipe.
12. **The members** (`members.mjs`, `chat.mjs`): tickets, joins, the door and the chat.
13. **The first generation's chat** (`dome.mjs`, `video.mjs`, `files.mjs`): its history and files, a phone's video, and
    a 200 MiB file sought and fetched.
14. **Offline first** (`offline.mjs`): opening, writing and signing in without the Aven Peer.
15. **Upgrades** (`upgrade.mjs`): a peer of another wire version refused with `update`, and the one behind follows.

`store/check.sh` runs avenSTORE's suite on all four backends; it is the store's own check, beside this one.

**Decided:** README rule 10; Samuel, 30 Oct (all three engines) · **Lean:** the vectors of every package's Lean;
no theorem of its own

## Topologies

A topology is a real-world network rebuilt inside the box: homes behind routers that do NAT, and what iroh should do
through each. `bun run lanes` runs them (the code still says "lanes", the glossary's old word) as a project of its own
beside the box (`sandbox/box/lanes.yml`), never inside `up`: a WAN with an Aven Peer on it and homes behind router
containers. Each run starts every container afresh, routers included, so no NAT mapping outlives a run.

| Topology | The router | What iroh should do |
|---|---|---|
| flat | none: every peer on one network, `wan` | Peers connect directly over UDP; Peer-Lights go through the relay. The check runs this one |
| home NAT | masquerades and keeps ports | direct to the Aven Peer |
| hard NAT | picks random ports | direct to the Aven Peer: the side behind NAT opens its own mapping by sending first |
| UDP blocked | drops UDP | the relay only, over HTTPS |
| two homes, home NAT | both homes keep ports | the relay first, then a hole-punched direct path |
| two homes, hard NAT | both pick random ports | the relay only |

- **Each run reports** the path iroh took, the time from the Peer's start to its first connection and to a direct path,
  and the router's NAT as conntrack and iptables show it, so the topology is proven to be what it says. A direct path
  must come within 30 s; a relay-only topology must hold 20 s without one.
- **Hole punching** needs each side's public address, which iroh learns from QAD probes to its relay (UDP 7842), with
  the box's test certificates (`sandbox/box/qad.sh`); the routers drop unsolicited UDP to themselves, as a home
  router's firewall does.

**Decided:** A1 (lane (iroh) → topology); MILESTONE2.md, thread C · **Lean:** not in Lean (iroh's paths are mechanics)

## The fuzzer

avenDOCS's import must never panic on any bytes ([avenDOCS](../docs/README.md)). The box fuzzes it with cargo-fuzz,
which needs a nightly toolchain; the nightly is pinned by date and used by nothing else.

- `bun run box sh sandbox/fuzz.sh [target] [seconds]` runs the targets in `db/docs/fuzz` on the image's nightly
  (`$AVEN_NIGHTLY`), every target for 600 s by default:

  | Target | Its input |
  |---|---|
  | `envelope` | any bytes as an envelope |
  | `changes` | any bytes as the Loro update in a member's signed first envelope, so they reach Loro |
  | `segment` | any bytes as a sealed segment |

- Each run keeps its corpus in `db/docs/fuzz/corpus/<target>` and any crash in `db/docs/fuzz/artifacts/<target>`, and
  ends with libFuzzer's numbers.
- The fuzz targets are a workspace of their own, excluded from the main one, so the main build never builds libFuzzer.
  `db/docs/tests/hostile.rs` runs the same inputs on stable in every check.

**Decided:** ledger 09:41 (a pinned nightly and cargo-fuzz in the image, built on GitHub, never locally; a
`bun run box` entry) · **Lean:** not in Lean (fuzzing is mechanics)

## Pins

Every dependency and tool is pinned exactly, so every build can be reproduced. Pins move only by hand: a person runs
`bun run bump` when they choose. No schedule and no bot updates anything.

- **`bun run bump --check`** lists every pin that's behind its newest stable release and changes nothing;
  `bun run doctor` prints the same table.
- **`bun run bump`** (`sandbox/bump.mjs`, its pins and sources in `sandbox/versions.mjs`) moves every pin to its newest
  stable release, regenerates `Cargo.lock` and `bun.lock` in the box, checks there that the workspace with its tests,
  both wasm crates and avenOS's page still build, and prints what moved. A major release that breaks the build goes
  back and is reported. It never commits: a person reviews the change, runs `bun run up --check` and commits it.
- **Pre-releases never count,** nor do yanked crates or deprecated npm releases.
- **A source the network refuses** is named with its reason, and its pin stays where it is.
- **A moved tool or crate is a new box:** it changes the tag, so the check needs the new image, which GitHub builds
  after the change is pushed. wasm-bindgen's CLI in the box must match its crate exactly.

| Pin | Where | Its source |
|---|---|---|
| every crate (`=x.y.z`) | every `Cargo.toml` | crates.io's sparse index |
| every npm package | `package.json` | npm's registry |
| Rust | the Dockerfile's `RUST_VERSION` | Rust's stable channel |
| Rust's nightly, for the fuzzer only | `RUST_NIGHTLY`, a dated nightly | Rust's nightly channel, at a recent date whose build is whole |
| cargo-fuzz | `CARGO_FUZZ_VERSION` | crates.io |
| wasm-bindgen's CLI | `WASM_BINDGEN_VERSION` | the `wasm-bindgen` crate |
| bun | `BUN_VERSION`, `packageManager`, `setup-bun`'s `bun-version` | npm's `bun` |
| elan, Lean | `ELAN_VERSION`, `LEAN_VERSION`, every `lean-toolchain` | their tags, over git |
| Playwright's image | the Dockerfile's `FROM` | Microsoft's registry, at the release npm's `playwright` has too |
| versitygw | the Dockerfile's `FROM`, by tag and digest | GitHub's registry |
| GitHub Actions | avenDB's workflows | their tags, over git |

**Decided:** README rule 13; Samuel, 30 Oct (pins move only by hand) · **Lean:** not in Lean

## Checks before production

`main` runs nothing on GitHub: work is checked in the box, in the session that makes it. Changes reach production
through one branch and one workflow, `.github/workflows/avensandbox.yml`.

- **`production` takes changes from `main` only.** Its check **Only from main** fails a pull request from any other
  branch, and **avenSANDBOX** runs `bun run up --check` from the same image on a Linux runner.
- **Every push to `production` that passes releases each package that changed,** with no step by hand, tagged
  `@aven/<package>@<version>`: avenOS when its sources change, avenSANDBOX when the image's digest changes, and the
  avenPEER image when the node's image changes. A push that changes none releases nothing.
- **A package's versions are its own:** the date in Berlin for its first release that day (`26.10.29`), then
  `26.10.29v2`, `26.10.29v3`. Each release lists only its own package's commits since its previous version.
- What a release then does, the deploy and the upgrade, is avenPEERS's ([avenPEERS](../peers/README.md)).

**Decided:** Samuel, 29 Oct (v1's workflows parked, so `main` runs no CI; `production` takes changes from `main` only
and releases each package that changed); A42 (until release signing exists, a release is the dated release from
`production`) · **Lean:** not in Lean

## Status

| What | Where it stands |
|---|---|
| The box, the image, its tag, the cast, production's stand-in | built |
| The check, steps 1 to 15 | built |
| Docs in the Peers in the check (a commit at one Peer-Light reaching another; catching up 500 envelopes of one Doc in every engine) | not built: only the native test measures catch-up (`db/docs/tests/catchup.rs`) |
| The cast's vault names | text ids (`vault:alice`); 32-byte vault names (L15) are pending, with avenID and avenCAPS |
| Checks on the real path (A168) | the cast's peers still get their device keys by configuration (`--secret`); stage 3's check, the first on the real path, waits for the keyring Doc and the register's Doc |
| Topologies: flat, home NAT, hard NAT, UDP blocked, two homes | built |
| Topologies: roaming, bad links (`netem`), a direct path between Peer-Lights | not built; a cloud session's kernel has no `netem` |
| The fuzzer | built (#1732); runs by hand, no workflow runs it |
| Real Safari and iOS | checked only on Samuel's iPhone; no macOS runner's smoke test |
| The precompiled crates | the store's own checks still compile some crates on their first run; a dependency change rebuilds the crates' layer whole |
| Vite after a restart | takes a second port when the old dev server still holds the first |

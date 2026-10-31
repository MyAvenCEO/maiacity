# avenSANDBOX: milestone 1

The plan that built avenSANDBOX and avenOS's first screens, and where it stands. Milestone 1 built the box (two
Peer-Lights in one Chromium and two Peers, one of them the Aven Peer with its relay on, in containers on one machine,
started with one command) and avenOS in the browser (its dashboard, the account switcher, and Vault and Control Room)
as the starter every later primitive grows from. It is done; this file is its record.

What the box is and how it works is avenSANDBOX's page in avenBRAIN: [avenSANDBOX](brain/sandbox/README.md).

## Done when

- [x] `bun run up` brings up all four peers from the one image: on a Mac (OrbStack), in a cloud session and in CI.
- [x] Both Peer-Lights show avenOS live, with "4 peers" right on each. Alice Peer connects to the Aven Peer directly
  over UDP. The Control Room shows each vault the peers it governs, and one timeline.
- [x] Each peer signs with its cast key for the vault it serves, and keeps its data through the store: the Aven Peer in
  the box's S3 server, Alice Peer in a folder, the Peer-Lights in OPFS. A reload keeps the data; a wipe empties it.
- [x] The store's conformance suite passes on all four backends. Lean and Rust each run their one check in the box,
  `doctor` passes, and every pin is at its newest release.
- [x] The loop's times are measured and written into this file ([below](#the-loop-measured)).

## Execution plan

**Step 0, in this thread (done 29 Oct 2026):** the box (its image and workflow, `up`, `down`, `logs`, `doctor`,
`shot`, `build`, `box`, the check and its fence against v1's code, the cloud setup script, avenDB's Cargo workspace
with its five crates as stubs) and avenOS's screens on the cast's vaults: the dashboard, the account switcher, Vault
and Control Room. The UX is settled before the peers run under it.

**Step 1, three threads in parallel (done 29–30 Oct 2026: #1402, #1403, #1404).** Each worked on its own branch with
a draft PR, sized by `.claude/skills/devx-speed`, stayed in its own folders and wrote what the plan should learn into
its PR's body.

| Thread, branch | Builds | Its own check |
|---|---|---|
| **Peers** (Rust and Lean), `claude/avendb-peers` | `gen1`: the status phases, presence and progress counters, pure. `db/spec/`: `Aven.DB`, their model. `peer/native`: the Peer, with the iroh endpoint, the `Router`, our ALPN `aven/db/1` (hello and presence) and `--relay`; its endpoint key is its device key from the cast. `peer/light`: the Peer-Light, the core as wasm in a worker, relay-only. The box's wiring for them (`compose.yml`, `up.mjs`, the check) and avenOS's live parts: the status line, the Control Room's panes, the timeline. State in memory until the store lands. | `lake build`; Rust tests against the model; `bun run up --check` waits for all four peers live, Alice Peer direct over UDP, "4 peers" on each Peer-Light |
| **avenID** (Lean and Rust), `claude/avendb-id` | `id/spec/`: `Aven.ID`, vaults owning vaults, what a vault governs, whom a device acts for and may act on, whom a host may act as; theorems that authority never runs up the tree, a device governs nothing, and no person acts as a network. `id/core/`: `aven-id`, pure, with the cast's keys derived and checked, and a wasm build of its queries for avenOS. | `lake build` without `sorry`; `cargo test`, its property tests checked against the running Lean model |
| **Store** (Rust), `claude/avendb-store` | `store`: the conformance suite first, then the `Store` contract (blobs and refs) and its backends through OpenDAL (memory, fs, s3, opfs), with an S3-compatible server in the box | the suite passes on all four backends in the box |

**Step 2, the integration (done 30 Oct 2026),** on `claude/avendb-integration`: the three branches collected, each a
merge commit (id, store, peers); `Cargo.lock` settled by cargo; avenOS reading the tree through aven-id's wasm; every
peer keeping its record through the store; `bun run up --check` green, with the restart and the wipe proven; the loop
measured and written into this file. Then the change merged into `main`, and `production` released what changed.

## Samuel's part

The settings no agent can change:

1. **The cloud environment avenSANDBOX:** at claude.ai/code, the environment selector under the message box, then
   **New environment**: Custom network access with the default package managers and two more domains, `ghcr.io` and
   `pkg-containers.githubusercontent.com`, `AVEN_DB2=1`, and this setup script. It only finds the repository's
   [`sandbox/box/cloud-setup.sh`](sandbox/box/cloud-setup.sh) and runs it, so that file can move without breaking a
   session. A setup script that exits non-zero stops every new session before Claude starts.

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

## Status

### The loop, measured

| Step | Target | Measured (cloud session, 4 vCPU, 30 Oct) |
|---|---|---|
| `bun run up` with a warm build, until every peer is live | < 10 s | **~9.5 s**: `up` 5.3–5.5 s, then all four live 4.0–4.2 s into the check, Chromium's start included |
| A change to the page, visible | < 1 s (hot reload) | **82–193 ms** (a Svelte edit until the browser shows it, 5 runs) |
| A Rust change, running on every peer | < 30 s | **14–17 s**: a change in the shared `link.rs`, so the binary and the Peer-Light's wasm both rebuild (7.9–10.8 s), the Peers restart, and every peer is live about 4 s later |
| A new cloud session, image already on disk, until every peer is live | < 2 min | **35–54 s** (3 runs): `bun run up --check` with every volume empty; the first build compiles only our crates (24–42 s), `up` takes 32–51 s with dockerd's start and the page's dependencies, Lean's vectors 1.6–12.5 s, then all four live 0.7–1.4 s into the check |
| A change to the box's Dockerfile, pushed, until the new image pulls | (none) | cold: 11 min 42 s (amd64 10 min 22 s, arm64 6 min 38 s); a dependency change: 10 min 13 s; the pull itself 91 s, 3.23 GB |

### Open, from milestone 1

- **The precompiled crates:** the store's own checks (`cargo test -p aven-db-store`, the OPFS wasm in release) resolve
  features of their own and still compile some crates on their first run; GitHub rebuilds the crates' layer whole on
  any dependency change.
- **`set_ref` on a missing blob:** the store doesn't require the blob to exist. Should it?
- **The fs folder's fsync:** fs syncs the file but not its folder after the rename, so a power loss can lose the last
  write, never tear it.
- **Real Safari and iOS** are confirmed on Samuel's iPhone until a macOS runner's smoke test exists.

What the box grew since, and what it still lacks, is in avenSANDBOX's page, "Status".

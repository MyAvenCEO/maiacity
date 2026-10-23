# No-reset release acceptance: hosted peer, PWA, Mac

Read-only audit, 2026-10-23; published from integrated release head `777ded336f4d50716b3eef8df90722eb8cd14303`. Original inspected sources: release branch `codex/avendb-reliability` at `45aa2b955801c4a1d6c3db9a5e66fcb15aedb34e`; these deployment/native files are unchanged from common base `918c07fe`. The explicit-entry source slice is `354679e70d7433324412e45c660c738afeae28a5`; request-basis is `3a86a2cbd7051399719755c5c4785917329dd997`, accounting is `90c9bbf734b3109ba1292c3849a857a32d7e9a96`. These deployment/native files were rechecked unchanged at the publication base. Re-pin the final integrated/generated-WASM head before using this sequence. This is an operator acceptance plan, not a claim that its deployment steps have run. No build, deployment, account, store, or UI action was performed by this audit.

## Delivery-only repair after this audit

`deploy/stop-avendb.py` now implements the proposed observer/owner separation.
The model mapping is in `avendb/spec/ShutdownOwnership.md`; it adds no new
storage or authorization semantics. The dedicated server rollout holds the host
`.env.lock` through close, settings update, verification and activation. A detached
child inherits that exact lock descriptor and runs SIGTERM with `--timeout=-1`.
The observer waits at most five minutes for completion (individual metadata calls
have bounded waits); expiration/cancellation never authorizes replacement. Do not
explicitly unlock fd 9 in the parent: closing it leaves the child's ownership intact.

Receipts under `.avendb-stop/` bind container ID, image ID, precise Docker start
and restart count to the initial health start. Success additionally requires exit
0, no OOM, and the matching `ended.how=stopped` marker. The child never activates
anything. A later observer can reuse successful evidence for that same stopped
instance. Failed/pending receipts remain blockers; do not remove them or manually
restart/recreate the container as an automatic recovery. Diagnose missing ownership,
storage errors or stale metadata first. The server itself currently exits on a
fence error; this helper does not promise to keep that failed runtime alive.

Before close and immediately before activation, the helper compares the existing
read-write `/data` bind and bucket/endpoint/region/seal/data-directory settings
against Compose, without logging or persisting secrets. Secret rotation that
changes the seal is intentionally outside this no-reset upgrade. A mismatch after
settings update leaves the successfully stopped container in place and refuses
activation; restore the recorded correct configuration under the same host lock
before retrying. API deployments stage Compose/Caddy files, activate them under
the host lock, and explicitly start only `db api caddy` with `--no-deps`; they cannot
bypass the avenDB close gate through orphan removal or implicit dependencies.

`delivery-checks.yml` runs the disposable process/workflow tests and is required
by both deployment jobs. Local validation passed all 17 process/workflow tests
(44.439 s), Python syntax, workflow YAML parsing and whitespace checks.
[CI run 40009347982, job 120605382001](https://github.com/MyAvenCEO/maiacity/actions/runs/40009347982/job/120605382001)
passed on 2026-10-23: all 17 process/workflow checks in 10.051 s and all three
actual Docker checks in 18.246 s. The PR head was
`cc3e3c301c9abfd5c0eba63106414c10f6e1f1ce`; Actions checked out its merge test
commit `9880ad644195d41954afd4b5e46d6e27f0ae6e12` with base
`06fe0685dd4a4160ec0ef32100c503583717be1c`, on Ubuntu 24.04.5.

The actual Docker cases passed:

- `test_cancelled_observer_retains_lock_and_exceeds_default_stop_deadline`:
  cancel the observer, retain the lock and running writer beyond 12 seconds,
  refuse a second gate, then verify persisted toy data and successful close.
- `test_monitor_budget_leaves_real_stop_owned`: expire the monitor budget,
  retain ownership, then resume verified completion.
- `test_real_failed_exit_and_marker_never_authorize_replacement`: an actual
  exit 7/error marker remains refused on repeated observation.

These used a network-disabled toy writer and disposable data on the CI runner;
they verify Docker/process/lock/receipt integration, not Rust journal durability
or production SSH session teardown. No production rollout has been performed.
The original findings below describe the audited base; the implementation does
not retroactively validate earlier releases.

## Release fences to settle first

1. **Server stop deadline is not a durability fence.** `.github/workflows/avendb.yml:142–144` pulls then runs `docker compose … up -d --no-deps avendb`. Neither compose file sets `stop_grace_period`/`stop_signal`; the Dockerfile sets neither. Rust handles SIGTERM and awaits `Running::shutdown` → `Node::shutdown` before returning (`server/src/main.rs:118–121`, `server/src/lib.rs:344–346`). Docker may forcibly kill a process after its stop deadline. A larger arbitrary timeout alone cannot prove accepted writes have fenced.
2. **Recommended bounded rollout, without a forced-close deadline:** one owned remote stop operation using `docker stop --signal=SIGTERM --timeout=-1 maia-city-avendb`; monitor at bounded intervals for a fixed rollout budget (e.g. five minutes). On expiry, fail/hold the rollout, leave the close operation owned, do not kill the container, start its replacement, or fall through to rollback. Cancellation of the monitor must not cancel the owned stop or release a second writer. After exit, require exit code 0, no OOM, and the stopped run's `/data/health.json` `ended.how == "stopped"`. That marker is written only after the awaited shutdown succeeds (`main.rs:72–80`). The delivery-only repair above now implements this workflow change; validate it with a disposable delayed-fence container plus canceled-monitor/failure tests before rollout. Docker documents `--timeout=-1` as no forced timeout: <https://docs.docker.com/reference/cli/docker/container/stop/>.
3. **PWA is not the native app.** `release.json` versions the served frontend; `/feed/health` does not identify the server commit. The Mac's `0.1.0` product version is constant and does not identify its Rust revision. Record each separately.
4. **No blanket offline-shell claim:** `static/app/avendb-files.sw.js:18–26` handles only file streaming through a live page, not a precached application shell. The standalone manifest is not an offline-shell guarantee. Test already-open PWA local reads separately from cold offline launch. Dev-mode Mac pages need `localhost:5173`, while a bundled `custom-protocol` app embeds its pages.

## 1. Pin artifacts and record read-only baseline

Set task variables to reviewed values; use the existing verified SSH `prod` configuration (same host-key pinning as `.github/actions/prod-ssh/action.yml`). Do not disable TLS/host verification or print `.env`/container environment. Commands below are operator instructions, not actions already taken.

```sh
export RELEASE_ROOT=/absolute/path/to/final-clean-release-worktree
export RELEASE_SHA=FULL_40_HEX_INTEGRATED_SHA
export SITE_RUN=EXACT_MAIN_DEPLOY_RUN_ID
export SERVER_RUN=EXACT_MAIN_SERVER_RUN_ID
export EVIDENCE_DIR=/private/tmp/avendb-release-evidence
mkdir -p "$EVIDENCE_DIR"
cd "$RELEASE_ROOT"
git status --short
git rev-parse HEAD
git show --stat --oneline "$RELEASE_SHA"
gh run view "$SITE_RUN" --json headSha,event,status,conclusion,jobs,url
gh run view "$SERVER_RUN" --json headSha,event,status,conclusion,jobs,url
ssh prod 'readlink /opt/maia-city/site/current'
ssh prod "docker inspect maia-city-avendb --format '{{json .State}} {{.Image}} {{.Config.Image}} {{json .Mounts}} {{json .Config.StopSignal}} {{json .Config.StopTimeout}}'"
ssh prod "docker logs --tail 200 maia-city-avendb 2>&1 | grep -E 'avenDB server: (device|offer|data in|its shelf|its run before)'"
```

Record the old site SHA; exact current container ID, image ID and immutable digest/tag; exact `/data` host mount; public server device/endpoint/claim; native app path and executable hash; existing Mac device/endpoint and a few known read-only document/file observations. Keep private content/metadata local. `/data` is `${AVENDB_DATA_PATH}:/data`, with the server's existing bucket/seal configuration retained; same mount alone does not prove same bucket configuration. Require the deployment to preserve existing identity, bucket/seal, and claim settings, without exposing their secret values.

Require final-head Rust/Lean/vector, browser/kernel, Svelte, and WASM CI gates. The WASM bot may append a commit; inspect the resulting head rather than the earlier green parent. A main server job may not trigger for frontend/device-only changes; record the existing server SHA if unchanged. A manual run from a different head is not evidence for this release.

## 2. Verify the published site, then existing PWA session

Site workflow builds with Bun, writes `release.json`, publishes immutable chunks before atomic `site/current`, retains five release folders, and retains hashed chunks at least 30 days (`deploy/publish-site.py:38–130`, `deploy/Caddyfile:58–92`). Its final HTTPS step can emit only a warning, so a green workflow alone is not external byte verification.

Download **that run's** `site` artifact into a new evidence folder; it expires after one day. Validate against its manifest, not only the live site's self-assertion:

```sh
gh run download "$SITE_RUN" --name site --dir "$EVIDENCE_DIR/site-artifact"
mkdir -p "$EVIDENCE_DIR/site-build"
tar -xzf "$EVIDENCE_DIR/site-artifact/site.tgz" -C "$EVIDENCE_DIR/site-build"
export RELEASE_MANIFEST="$EVIDENCE_DIR/site-build/release.json"
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { isList, served, unlike } from './scripts/release.mjs';
const expected = JSON.parse(readFileSync(process.env.RELEASE_MANIFEST, 'utf8'));
if (!isList(expected) || expected.commit !== process.env.RELEASE_SHA) throw Error('wrong artifact revision');
const response = await fetch('https://maia.city/release.json', {cache:'no-store', signal:AbortSignal.timeout(30000)});
if (!response.ok) throw Error(`release.json HTTP ${response.status}`);
const live = await response.json();
if (!isList(live) || live.commit !== expected.commit || unlike(live, expected).length || Object.keys(expected.files).some(k => live.files[k] !== expected.files[k])) throw Error('live manifest differs');
const failures = await served('https://maia.city', expected, {at:2, get:(url, init) => fetch(url, {...init, signal:AbortSignal.timeout(30000)})});
if (failures.length) throw Error(failures.join('\n'));
console.log(JSON.stringify({commit:expected.commit, files:Object.keys(expected.files).length, verified:true}));
JS
```

This imports pure release helpers; it does **not** call `witness`, open an avenDB agent, build, or propose an AIP. Keep TLS verification enabled. Independently built identical bytes are a stronger claim than CI-artifact correspondence and should be labeled separately.

In an existing PWA tab, first retain one currently loaded immutable chunk URL and confirm it still answers with the same bytes after publication. Navigate through the existing account's Note/Docs/Library and a known file; no sign-out, clear-site-data, OPFS deletion, service-worker unregister, new account/link, or test-content writes. Reload normally and verify existing identity/account, known query result, file bytes, and reconnect. Explicit missing Note/Docs targets must remain the selected target while loading, never silently open a substitute. A locally unavailable item is not authenticated global absence. Browser carrier build flag stays `VITE_AVENDB_BROWSER_CARRIERS=false`; no WT/RTC capability advertisement is expected (`transports/config.js`). Browser fallback is the existing authenticated relay.

For offline evidence, use an already loaded page and a file already read completely. Browser context offline simulation must demonstrably stop that page's device transport; an inspector setting affecting only page fetch is insufficient. Missing uncached blobs may legitimately wait/fail. Re-enable networking, observe peers and a successful existing file/query read. No UI editing is necessary. Record cold offline launch as a separate, currently unguaranteed shell capability.

## 3. Hosted peer controlled restart and acceptance

Use the reviewed exact-SHA image and the existing `.env` lock/update path. Keep the previous image digest available. Use the revised exact-head workflow, whose owned stop/fence gate runs **before** any replacement; the historical plain `up` workflow is not acceptable. The stop primitive and read-only completion checks are:

```sh
# MUTATING, only during the authorized rollout under the owned remote coordinator:
docker stop --signal=SIGTERM --timeout=-1 maia-city-avendb
# READ-ONLY, before removing/replacing this stopped container:
docker inspect maia-city-avendb --format '{{.State.Running}} {{.State.ExitCode}} {{.State.OOMKilled}}'
docker cp maia-city-avendb:/data/health.json - | tar -xO
# Only after the explicit success checks and pinned image/config selection:
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps avendb
```

Require `false 0 false`, and matching old `started` plus `ended.how=stopped`; don't mistake another run's marker for this one. A monitor timeout or close error blocks replacement. The coordinator must retain ownership across client disconnect/cancellation; running the blocking primitive in an unowned short-lived SSH command is not that implementation.

After restart compare `.Image` with the expected immutable image and `/data` mount with the baseline. Require the **current container's current startup** log to show the same public device, endpoint, and claimed vault, and its offer. Avoid accepting an old log line. Inspect `/feed/health`: new `started`, `before.started` matching the old run, `before.ended.how=stopped`, no panic/restart loop/OOM, and bounded memory. From the server, the read-only internal feed is accessible without weakening public TLS:

```sh
ssh prod "docker exec maia-city-caddy wget -qO- http://avendb:3351/feed/health"
```

Public `https://avendb.maia.city/feed/health` deliberately requires PQ TLS at Caddy. Use a client that supports the configured group or the actual app/browser; an old curl handshake failure is not a reason to loosen TLS. Internal health alone does not prove the public relay works: require existing browser/Mac reconnection and a known authorized query/blob read through the public endpoint. Counters may grow with valid sync; exact equality in a live account is not a no-loss oracle. Exact signed-history/identity/recovery evidence belongs to the isolated copied-store tests, not repeated full live-store reads.

## 4. Mac build identity, graceful replacement, and smoke check

`vault/app/tauri.conf.json` uses bundle identifier `city.maia.studio`; `vault/app/src/avendb.rs:249` opens **`~/avenDB/mac`**, beside `mac-agents`. Settings remain under `~/Library/Application Support/city.maia.studio`. Preserve those paths, the Keychain/Secure Enclave, and any attached drive identity. `moved()` only relocates the legacy folder if the new one is absent; never delete the new folder to force that branch.

Use the isolated final release worktree. Existing build commands, for the serialized build slot only:

```sh
# Production WASM: normal script, no localhost-passkeys feature.
# Required target compiler/archiver paths are supplied by the existing build environment.
avendb/scripts/build-web.sh
VITE_AVENDB_BROWSER_CARRIERS=false bun --bun run build
# Bundled app build uses frontendDist ../../build and custom-protocol;
# use the existing Tauri build workflow, or its documented direct native binary form:
cd vault
CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=1 cargo build --locked --release -p maiacity-studio --features custom-protocol
```

Do not rebuild WASM if final CI already supplied the exact production package. Preserve the old `.app`/binary separately before installing the new artifact; record `shasum -a 256` for the exact old/new executables and bundled device sidecar, source SHA, and web/WASM hashes. Product version `0.1.0` and file mtime are inadequate. The direct Cargo command builds a binary; it is not itself a signed `.app` installer. `build.rs:110–130` also builds the sidecar in `avendb/target`, so plan disk/CPU for that separate cache rather than assuming the outer `CARGO_TARGET_DIR` covers it. Verify the Touch ID bridge built; its compile failure currently degrades to no Touch ID.

Gracefully quit the actual running app once. With `RUST_LOG=info` set at launch, success shows `waiting for hosted stores`, then `stores fenced; stopping the device runtime`, then `device runtime stopped`; otherwise inspect Activity/current process exit and errors without claiming absent info logs are failure. Five seconds is only a warning. On error the app/store owner stays alive; do not force-kill, overwrite the running executable, or launch a competing host. Require old process exit before opening the candidate against the same store. Unlock using the existing ceremony, compare device/endpoint/account and known documents/files, then quit/reopen once and repeat. Existing Performance, Activity, `native.status()`, `perf` and `network` reads provide diagnostics; avoid the Performance checkpoint/signing controls.

A dev session is two artifacts: Vite frontend from its actual process cwd and native binary from its actual build. A frontend hot reload does not upgrade the running Rust node; the hosted site SHA does not identify either. Inspect process cwd/executable with `lsof -a -p PID -d cwd,txt` and hash the actual binary. Do not use `scripts/watch-main.mjs --once` as an acceptance shortcut: it fetches/fast-forwards, can start `tauri dev`, and runs the release witness with `--run` (possible AIP writes). Do not reset/fast-forward a user's unrelated checkout.

For actual native offline evidence, an already proved process-local network sandbox may be used only in a separate authorized run of the **bundled** app after ordinary close, keeping socket binds and identity/store config intact. A dev build needs its HTTP Vite server and cannot be assumed to cold-start under the same outbound deny profile. Browser DevTools offline does not disable the Mac's native node. Restore ordinary launch for reconnect. Do not change global networking or write smoke-test content to the real account.

## 5. Rollback and completion criteria

- **Site:** if the old SHA is still retained, use the existing publisher, not manual copying over `current`: `ssh prod "python3 - /opt/maia-city/site OLD_FULL_SHA" < deploy/publish-site.py`. This is a deployment mutation and belongs to the authorized operator. The publisher preserves the replaced release and immutable chunks. Re-run artifact/served checks against the old trusted manifest. No account/store rollback accompanies a site rollback.
- **Server:** require explicit persisted-format/backward-read compatibility for the selected old image. Gracefully fence the candidate with the same owned stop algorithm, restore only the recorded image selection under `.env.lock`, retain the same mount/bucket/seal/identity, then replace only `avendb` and compare identity/health/public reconnect. Do not use `down -v`, empty storage, recreate identity, or silently restore older account data. Task9/task6/explicit-entry do not themselves change persistence or authority formats; verify all other integrated changes separately.
- **Mac:** safely close the candidate before reinstalling the saved old app/binary, only when that binary can read the current store. Keep `~/avenDB` and Keychain unchanged; if close fails or compatibility is unknown, hold and investigate rather than forcing rollback.
- **Backup proof:** `.github/workflows/avendb-backups.yml` PR jobs may be green after notices with no S3 recovery. Require a non-PR main/manual run on the selected commit whose actual `Back up, check, rehearse and restore against the test bucket` step executed and passed. This tests isolated bucket data, not the live snapshots. Live `/feed/health.backups` is separate evidence of the latest scheduled live-folder check. Neither permits overwriting a live store.
- **Done:** exact site bytes + exact server image (if changed) + exact native binary accounted for; same identities/configuration; clean durable restarts; existing query/file/offline/reconnect smoke checks with their limits stated; exact-head CI and real recovery steps passed. Missing gates remain open rather than being inferred from a green deploy or faster timing.

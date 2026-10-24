# Deployment ownership and shared mechanics

The site, API and avenDB remain independent releases. CI workflow concurrency is not a replacement for the server's file lock: a detached avenDB close can outlive its SSH/CI observer.

| Release | Owns | Must not restart |
| --- | --- | --- |
| `deploy.yml` | Static build, retained immutable assets, site symlink, validated Caddy route activation | API, avenDB |
| `api.yml` | API image, infrastructure/base compose settings, Postgres/API/Caddy rollout | avenDB |
| `avendb.yml` | avenDB image, bucket/snapshot settings, verified close and activation | API, Postgres, Caddy |

## Shared tools

- `.github/actions/prod-ssh` installs the deploy key and pinned host keys; optional boot waiting is for newly provisioned infrastructure. Never replace pinning with automatic trust.
- `check-avendb.sh` runs relay reachability, PQ/classical TLS, feed and the 24 KB browser-pass WebSocket upgrade probes. API and avenDB use the same implementation. The caller retains its service-specific readiness/bucket checks. DNS/certificate/feed delays retain their warning policy; a non-101 browser upgrade fails. API's existing bucketless failure remains a failure even when HTTPS is not ready.
- `stop-avendb.py` owns graceful close evidence and preserves lock fd 9 in its detached child. Neither a timeout nor an observer disconnect authorizes another writer. Pre-activation verification remains mandatory.
- `publish-site.py` owns immutable asset publication and site release retention. It is not an API/container deployment helper.

## Shared `.env` contract

The API workflow bootstraps the shared compose environment before the first avenDB release. All writers acquire `exec 9>.env.lock; flock -w 300 9` in `APP_DIR` before modifying it. Container deployment jobs also retain the non-cancelling `maia-production-containers` concurrency group. Never explicitly unlock fd 9 while its close child may own it.

- API owns database credentials/configuration, API image/address, site authentication settings, transcription key and avenDB's host/relay/data-path infrastructure settings. The Postgres password is generated only once beside its data, never rotated by rewriting `.env`.
- avenDB owns `AVENDB_IMAGE`, `AVENDB_BUCKET*` and `AVENDB_SNAPSHOTS`. API's rewrite preserves these existing values; it must not select a new image, bucket, seal or device identity.
- `COMPOSE_PROFILES` enables avenDB once its image exists. The avenDB writer retains existing profile values when enabling its own profile. API reconstructs the currently supported profile from the retained image; adding another profile requires updating both writers and this contract.
- The avenDB writer requires existing `AVENDB_DATA_PATH`, checks required bucket secrets, pulls before stopping, and verifies proposed storage settings before `up --no-deps avendb`. No generic environment helper may bypass that sequence.

These environment writers are intentionally not collapsed: they have different ownership and activation preconditions. Shared mechanics must not turn them into interchangeable whole-file writers. Secrets remain in the existing secret/SSH channels and are not echoed by the probe helper. Changes here do not authorize a manual production deployment, secret rotation, store reset or acceptance run.

## Validation

`bun test ./deploy/check-avendb.test.js` uses fake SSH/Docker/curl commands, including large-feed and failed-upgrade cases; it makes no network calls. The Kernel workflow runs it. `delivery-checks.yml` continues to test close ownership with model and disposable Docker cases. Live/installed-device acceptance is separately tracked in `docs/AVENDB_RELEASE_ACCEPTANCE.md` and `docs/AVENDB_UPGRADE_PLAN.md`.

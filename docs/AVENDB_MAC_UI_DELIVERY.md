# Mac UI development delivery — 2026-10-25

## Installed artifact

- Built source: `02e0e61e4f558064290d6ce546a159bbccd7522d`, branch `codex/mac-ui-studio-delivery`.
- Composition: deployed main `7dc7c57a`, Studio's focused `21e076b1` world-error diagnostics, reviewed UI/manifest/lifecycle/CSP fixes, final `278e09a8` report integration, and focused Studio `f78f528f` cross-realm device response cloning. The old Studio branch ancestry was **not** merged: its historical native/WASM differences would regress current main. Native code matches main; native configuration adds only the exact `https://speed.cloudflare.com` diagnostics host.
- Installed bundle: `/Users/samuelandert/Applications/theOS.app`.
- Executable SHA-256: `9c6af982cc0322d9d26a9cda040bab13b9403d04ecd162880624c222cc6b9868`.
- Ad-hoc development signature, identifier `city.maia.studio`; `codesign --verify --deep --strict` passed after installation. ARM64 executable; existing Touch ID bridge built successfully. No notarized/formal release requested.
- Launched GUI PID at verification: `51544`. Fresh stdout/stderr: `/private/tmp/avendb-mac-ui-install/launch-realm.log`.

## Validation and preservation

Final frontend build passed; final combined Svelte check found **0 errors**, 28 existing warnings. Forty-five targeted diagnostics/lifecycle/view/world/security checks passed before the final report-only integration, whose focused checks were run by the release coordinator. Optimized native bundle succeeded; final cached embedding pass completed in 2m50s.

Build command from `vault/app`:

```sh
CARGO_TARGET_DIR=/private/tmp/avendb-mac-ui-target CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=2 \
  bun --bun ../../node_modules/@tauri-apps/cli/tauri.js build --bundles app --ci \
  --config '{"build":{"beforeBuildCommand":""}}'
```

Frontend was built separately first using the committed production WASM (SHA-256 `65258a74ead68ec51c713852ed131a7b03c9bc8ae1b1afac703ac7a716bcef97`). Full build logs and source/frontend/artifact hashes: `/private/tmp/avendb-mac-ui-install/receipt.json`, `/private/tmp/avendb-mac-ui-native-final.log`, `/private/tmp/avendb-mac-ui-final-check.log`.

The former GUI PID `39777` quit normally by AppleScript and exited before replacement. No killall, SIGKILL, vault reset, account migration, Keychain change, or data rollback was performed. `~/avenDB/mac` directory identity remained unchanged (inode `355961656`). Agent CLI processes sharing the executable name were left alone.

Previous installed bundle retained at `~/Applications/theOS-before-ui-20261025-0845.app`, executable hash `37e1619430a396e5c7c0de6b155181f54e26f90063d02715ddb1a301f5c99440`. An earlier initial bundle and a second copy of the automatic-main bundle remain under `/private/tmp/avendb-mac-ui-install/`.

## Automatic installer race — follow-up required

The login agent `city.maia.os-rebuild` independently installed main `7dc7c57a` during this build, replacing the originally observed executable. Its script is `~/Library/Application Support/city.maia.os-rebuild/rebuild.sh`; it checks pending installation **before** its hold-file guard and uses a 20-second force-kill fallback. A hold file alone therefore does not protect an acceptance session.

The dedicated launch agent was temporarily unloaded with `launchctl bootout gui/501 ~/Library/LaunchAgents/city.maia.os-rebuild.plist` before manual installation. Its plist/script remain intact. Do not blindly reload it: inspect/preserve its `pending` state first, because it had built/was building `24b8c4af` and could immediately overwrite this combined artifact. The coordinator owns restoring automation after acceptance and should replace the unsafe shutdown fallback with the established graceful store-fence behavior.

## Not yet established by this delivery

Launching is verified; existing-account unlock, visible-data acceptance and offline/reconnect checks require the coordinator/user's normal passkey ceremony. No claim of completed physical-device acceptance follows from a successful build. Broader Rust checkpoint/bootstrap work is not part of this Mac UI delivery.

## Studio realm correction follow-up

Source commit [02e0e61e](https://github.com/MyAvenCEO/maiacity/commit/02e0e61e4f558064290d6ce546a159bbccd7522d) incorporates Studio's focused cross-realm response correction. Seventeen realm/device tests passed (59 assertions), the frontend build passed, and the complete Svelte check reports 0 errors / 28 existing warnings. Cached native embedding completed in 1m52s. Native log: `/private/tmp/avendb-mac-realm-native-authorized.log`.

GUI 43869 quit normally before replacement. The previously verified 6799187d bundle is retained at `~/Applications/theOS-before-realm-6799187d.app`; the earlier backups remain. New GUI 51544 launched with the exact executable hash recorded above. The store directory inode remains 355961656. Automatic rebuilding remains unloaded pending coordinator reconciliation. Physical unlock/Studio acceptance remains with the coordinator; installing this focused fix does not establish latency acceptance.

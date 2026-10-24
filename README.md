# maiaCITY

The public site, cooperative games, film studio and theOS desktop application. SvelteKit builds the static site; Caddy serves it. avenDB owns vault records and media, with an embedded native device in the Mac app and a browser device for the web. The API remains a separate service, not the studio's storage backend.

## Develop and check

Use the Bun version in `.bun-version`. From the repository root:

```sh
bun install --frozen-lockfile
bun run dev
bun run check
bun --bun run build
bun run preview
```

The build uses Bun's Vite runtime to match the release witness. Production is served at the domain root; `BASE_PATH` is optional for other mounts. Native development additionally requires Rust and the macOS build tools; `vault/app/tauri.conf.json` defines the frontend/native handoff. A page hot reload does not upgrade the native device.

API dependencies and tests:

```sh
cd api && bun install --frozen-lockfile && cd ..
bun test ./api/test
```

`.github/workflows/kernel.yml` is the authoritative application test list and Chromium/WebKit probe gate. `avendb-checks.yml` checks avenDB's Rust/Lean workspace. Tests that exercise native devices, storage migrations or recovery must use isolated stores, never a live device directory.

## Ownership map

| Area | Owner / entry point |
| --- | --- |
| Site and app navigation | `src/routes`, `src/lib/app`; shared game/world descriptors in `game/places.js` |
| Game simulations and film contracts | `game`, `src/lib/sandbox-*`, `src/lib/maiacity-*`; frozen versions stay distinct |
| Vault records, capabilities, synchronization | `avendb`; browser/session integration in `src/lib/avendb` |
| Studio cuts and media | `src/lib/studio/cuts.js`, `aven.js`; media loading/decoding in `media-sources.js` |
| Native device, rendering, MCP commands | `vault/app`; the embedded device is not a packaged avenDB sidecar |
| Public media aliases | `src/lib/media`, `deploy/Caddyfile`; stable public URLs are not private sealed references |
| API and infrastructure | `api`, `infra`, `deploy`; API/site/avenDB have independent release workflows |
| Dynamic code and assets | avenDB publication; `code/` is reviewed bootstrap/recovery input, not a competing live writer |

Read [architecture and retirement decisions](docs/ARCHITECTURE.md) before changing an ownership boundary, [deployment ownership](deploy/OWNERSHIP.md) before changing release mechanics, and [release acceptance](docs/AVENDB_RELEASE_ACCEPTANCE.md) before operating a device. Merged code and green CI are not proof of installed-Mac acceptance or successful recovery.

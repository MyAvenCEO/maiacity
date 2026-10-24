# Same-document session lifetime

Specification before the regression: `session.svelte.js` owns one device for a document. `boot()` holders subscribe to its view; their cleanup stops watching but does not lock, close, replace or reopen that device. Moving between mounted views, even through zero holders, must preserve the exact open device identity and require no additional passkey ceremony. Explicit `session.lock()` remains the boundary that closes it. A new document loads retained metadata into `closed`; it must not silently recover unlock secrets.

The real-browser fixture compiles the actual Svelte session module and exercises actual component mount/unmount hooks and same-document history navigation. Only the worker/WASM and passkey platform boundary is mocked. The fixture's metadata is synthetic and does not use an account or OPFS. A document reload verifies deliberate locking against that metadata; actual OPFS byte retention is separately covered by `scripts/test-avendb-store.mjs` in Chromium and WebKit.

Lean StoredView obligations concern saved-data authentication/retention, not browser process lifetime or passkey ceremony reuse. No new Lean theorem is claimed for Svelte, WebKit, iOS memory eviction or SvelteKit's route loader. This is the deterministic view-lifecycle portion of PWA acceptance; physical iOS launch/background/reconnect remains required.

Run from the repository root with installed dependencies and Playwright engines:

```sh
bun scripts/test-avendb-session.mjs --browser chromium
bun scripts/test-avendb-session.mjs --browser webkit
```

Both commands passed locally on2026-10-23. The existing kernel Chromium/WebKit jobs invoke them using their already installed engines; remote CI results must be checked separately.

## Restart evidence

The fixture also mounts the global `Diagnostics` control and its pre-unlock `LifecycleReport` and starts the bounded lifecycle recorder. Four view changes and explicit lock retain the same document count; a real browser reload increments it, carries forward the previous open phase, and leaves the new session locked. The panel is usable before another unlock. Unit checks cover pagehide/BFCache, malformed or denied sessionStorage, unavailable Navigation Timing, fixed categories and capped counters. No account data, route, identity, content, key, error message or timestamp is stored.

This does not reproduce an iOS foreground WebContent termination. A missing pagehide marker is evidence only that the event was not recorded, not proof of OOM. iOS may discard sessionStorage itself; a missing previous record does not prove there was no earlier document. No unlock secret is persisted and no reload or recovery is triggered by the recorder.

At a 390×844 viewport the fixed top-right control works while locked and open. Its network iframe exposes the manual Run button without leaving or unlocking the document, and no Cloudflare/release-manifest probe occurs before Run. The regression checks Close, Escape, outside click and trigger focus restoration. The former Settings card is removed; the control is mounted outside the app layout phase branches.

---
name: web-security
description: Security review of maiaCITY's web side — the SvelteKit site, the Bun API (passkeys, sessions, capabilities, CORS), avenDB's public feed and its signed POST routes, the sandboxed frames that run vault code (CSP, sandbox, postMessage, provenance), and The OS's web view (Tauri commands, the aven protocol, its CSP). Use when auditing or changing sign-in, sessions, an API or feed route, a page's or a frame's policy, the sandbox hosts, or anything The OS's web view can reach. Part of security-auditor.
allowed-tools: Read Grep Glob Bash
---

# Web security

Ours, not a copy: the checks for the code a browser or a web view talks to. The laws, the order of work and where a
report goes are the master skill's (`security-auditor`); read it first. Findings never go into a public issue, PR or
log before the fix is merged.

## The surfaces

| Surface | Code | What it must hold |
|---|---|---|
| Sign-in | `api/src/passkey.ts` (`@simplewebauthn/server`), `src/lib/avendb/server.js`, `vault/app/src/passkey.rs`, `vault/app/src/auth.rs` | one ceremony, the right origins and RP ID, each challenge used once |
| Sessions | `api/src/session.ts` (a signed cookie: `founderId.expiry.signature`) | no forged, replayed or outlived session |
| Admin and caps | `api/src/index.ts` (`allowed(req, cap)`), `api/src/caps.ts`, `api/src/acl.ts` | every protected route through `allowed`, least access, no role checked by name |
| CORS | `api/src/index.ts` (`cors`, an allowlist from `SITE_ORIGIN`) | credentials only for an origin on the list, `Vary: Origin` |
| SQL | `api/src/db.ts`, `api/src/pg.ts` (`sql` tagged templates; `.unsafe` for migrations and the admin reader) | no request text reaches `.unsafe` |
| The feed | `avendb/crates/avendb-server/src/feed.rs` (public reads with `Access-Control-Allow-Origin: *`; the signed `POST /feed/pass` and `/feed/vaults`) | public reads return only what a Public share reaches; every POST checks a signed pass, not a header |
| Vault code | `src/lib/sandbox/` (`policy.js`, `frame.js`, `lockdown.js`, `view-host.js`, `ViewHost.svelte`), provenance in `game/code/sources/feed.js` and `anchor.js` | third-party code reaches no key, network, storage or page, and only code Maia City's signed edits name runs |
| Page policy | `pageCsp` in `src/lib/sandbox/policy.js`, applied in `vite.config.ts`; kept in step with The OS by `policy.test.js` | no `unsafe-eval`, scripts by hash, `object-src 'none'` |
| The OS | `vault/app/tauri.conf.json` (CSP), `vault/app/capabilities/default.json`, `vault/app/src/main.rs` (`invoke_handler`, the `aven:` protocol), `enclave.rs` | the web view reaches only the commands and files it needs |

## Checks

### Passkeys (WebAuthn)

- The expected origins and RP ID come from configuration, never from the request; a list of origins holds only ours.
- Each challenge is stored server side, bound to the ceremony that asked for it, expires, and is deleted on first use,
  success or failure.
- Where the passkey is the root of a vault (avenDB), user verification is required on both sides of the ceremony;
  check the options and the verify call agree.
- The signature counter and the credential id are checked against the stored credential; a credential is bound to one
  account.
- Sign-up is invite only: the invite is single use, checked before the credential is stored, and claimed in the same
  step.

### Sessions

- The signature is checked in constant time (`timingSafeEqual` on equal-length buffers) before any field is trusted;
  expiry is part of what is signed.
- Cookie: `HttpOnly`, `Secure` outside local development, `SameSite=Lax` or stricter, a `Max-Age` no longer than the
  signed expiry; sign-out clears it with the same attributes.
- A state-changing route takes JSON only, or checks `Origin` against the allowlist, so a cross-site form cannot post
  to it.
- Keys a terminal holds (`keyHolder`) are scoped: the route checks the key's scope and the person's caps, both.

### Routes

- Every protected route calls `allowed(req, cap)` first; grep each handler in `routes:` for it. A route that reads a
  row by id checks the row is the caller's (no IDOR).
- Errors say what is missing, never a stack, a query or a secret.
- Request bodies have a size limit and a shape check before they are used.

### Vault code and frames

- A frame is `sandbox="allow-scripts"` and never also `allow-same-origin` (that pair undoes the sandbox); `allow` is
  `DENY`; `referrerpolicy="no-referrer"`.
- Its policy comes from `frameCsp`: `default-src 'none'`, nothing in `NEVER` opened, workers only from `blob:`.
- `lockdown.js` runs before any builder and removes every way out (`fetch`, `XMLHttpRequest`, `WebSocket`, …); a new
  browser API that can reach the network goes on its list.
- Every `message` handler checks `e.source` is the frame or the worker it expects and caps the size (`BUDGETS.message`);
  nothing a frame sends is used as HTML, a URL or a path without being cleaned.
- Code runs only after provenance: its record and file hashes are among the edits Maia City signed (anchor pinned in
  `game/code/sources/anchor.js`); a check that trusts the server's word is a finding.
- A frozen engine is never edited; a fix is a new engine version beside it.

### The OS

- The CSP in `tauri.conf.json` is never looser than the site's `pageCsp` (`policy.test.js` holds it); `connect-src`
  names only our hosts.
- `capabilities/default.json` grants the fewest plugin permissions; a new command is checked for what a page script
  could make it do (paths outside the app's folders, shell, arbitrary URLs).
- The `aven:` protocol handler refuses `..`, absolute paths and anything outside what it serves.
- Secrets (the Secure Enclave key, device keys) never cross into the web view; the web view asks the Rust side to
  sign.

### The feed

- `Access-Control-Allow-Origin: *` is only on routes whose every row a Public share reaches; anything per person is
  behind a signed pass checked by the server (`POST /feed/pass`).
- Served files are limited by their ending to media a page will not run; a name never becomes a path outside the
  vault's files.
- Load: listings are single-flight and cached (`fresh_or`). Never probe the live feed with bursts; test a local
  server.

## How to check

- Read the handler, then the gate it calls; follow the request's fields to where they are used.
- Local runs only: the site with `bun run dev`, the API with `bun run dev` in `api/`, avenDB's server locally.
- The kernel's tests are the gate every PR and deploy passes (`.github/workflows/kernel.yml`, H7): run the same
  `bun test` list locally after `bunx svelte-kit sync`; `bun test ./src/lib/sandbox/` alone covers the frames and
  their policies.
- Turn each confirmed finding into a test beside the code it fixes, then hand it to `fp-check` and the report.

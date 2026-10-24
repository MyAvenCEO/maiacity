# Public proof verifier lifetime

The public-code verifier uses a separate worker and WebAssembly instance from the
personal avenDB device. Previously its worker remained alive indefinitely after
verification, retaining its WASM heap even after the personal device opened.
This is an avoidable retained resource; it is not proof of the reported iPhone
foreground reload's cause.

`AvenDB/ProofWorker.lean` was checked before implementation. Its three lemmas
model the release condition: no pending proofs, and the current owning worker.
They do not prove JavaScript execution, cryptography, or browser memory limits.

`game/code/sources/proof-worker.js` keeps concurrent requests on one verifier,
then terminates it after one second without pending requests. A subsequent proof
creates a new verifier. A new request cancels idle disposal. Old worker replies
and errors cannot settle a replacement worker's requests. Worker or decoding
failure rejects pending requests and terminates the failed worker; a failed
transfer removes only that request. Proof rejection still propagates normally.
The verifier's cryptographic code, trust anchor, and verified-row cache are
unchanged. No account secrets are persisted or authentication bypassed.

Five deterministic worker/timer regressions (17 assertions) cover concurrent
completion, idle release/recreation, idle cancellation, stale callbacks, fatal
failure/retry, invalid proof, failed transfer and unreadable responses. These
checks establish resource ownership, not a measured iPhone memory reduction or
resolution of the physical-device reload. A permanently unresponsive active
verification remains active; no timeout kills an outstanding proof silently.

Additional validation: real Chromium and WebKit workers passed transfer, concurrent
held-request, idle termination and recreation checks (`scripts/test-proof-worker.mjs`).
The worker replies in that fixture are synthetic; signature verification itself
is unchanged. Full Lean build passed (77 jobs); Svelte check passed with zero
errors and 18 existing warnings in eight files. Independent lifecycle review passed.

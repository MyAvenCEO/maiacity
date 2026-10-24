# Browser persistence buffer ownership

2026-10-24: `Store.put` and `Store.keep` now hand whole standalone buffers to the OPFS worker using the transfer list, as `write` already does. Previously structured cloning kept an additional full journal/snapshot copy alive across this boundary. Rust's shelf bridge creates the JS Uint8Array from its bytes; it does not hand out the WASM memory buffer.

The contract is unchanged for persistence: resolving the call acknowledges the worker operation, not merely posting a message. Whole input buffers are consumed. Subarrays retain their original backing buffer and only their selected bytes are stored. No authorization, encryption, stored format, or vault data changes.

Validation: `scripts/test-avendb-store.mjs` passed in actual disposable desktop WebKit and Chromium for both canonical and shipped bridge files. It checks buffer detachment, subarray preservation, exact bytes after two document/worker restarts, replacement slots, and retained authoritative history. This exercises the existing StoredView persistence premise; it is not a new cryptographic proof.

This removes a concrete transient allocation. It does not establish the cause of the reported physical iPhone document restarts or prove that those restarts are resolved. Physical iPhone confirmation remains required; no live profile was touched by these tests.

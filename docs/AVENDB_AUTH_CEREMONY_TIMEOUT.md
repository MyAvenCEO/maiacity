# Bound authentication waits without accepting a missing approval

Two source paths previously had no deadline: native ASWebAuthenticationSession
waited on a retained oneshot sender, and LocalAuthentication waited on a semaphore
while holding the Enclave bridge's serial request lock. A missing platform
completion could leave unlock pending indefinitely. This identifies an
implementation failure mode, not the cause of the observed installed-app hang.

Both waits now fail after 120 seconds. The native sheet cancels its actual session
on the main thread and releases only its own request identity. Delayed completion
cannot remove a newer sheet; startup checks whether its request already expired.
The Swift path expires a synchronized result holder, invalidates its LAContext,
returns failure, and releases the serial request lock. Late callbacks cannot
revive expired approval or race unsynchronized result reads. There is no automatic
retry, credential replacement, new grant, store reset or bypass of verification.

Validation:
- Lean CeremonyCancellation ownership and terminal-timeout proofs passed.
- Production Swift result helper: first completion, expiration, and 1000 concurrent
  expiration/completion races passed (`sh vault/app/scripts/test-ceremony-result.sh`).
- Full Enclave.swift typecheck passed with current macOS SDK.
- Rust source parses with rustfmt; two native module regressions added, Cargo
  execution pending parent's shared build queue. Run the app crate tests filtered
  by `passkey::tests` on macOS.
- Actual system prompt cancellation and installed-app recovery not yet verified.

An unresponsive macOS main thread can still delay execution of sheet cancellation;
the request nevertheless returns timeout, and a queued start checks its terminal
state. This fix does not establish that replay/startup itself was slow.

# Awaited native listener release

A stopped WebTransport supervisor and idle QUIC connections do not establish that
its UDP socket has been released. In pinned Quinn 0.11.12, dropping the last
EndpointRef wakes a detached EndpointDriver; that driver's later poll releases
its socket. The strict deployment test observed AddrInUse after awaited shutdown.

The Lean scheduling model requires stopped producers, retired endpoint ownership,
and zero outstanding drivers before completion. It does not prove OS behavior.

The implementation constructs the same Quinn endpoint and TLS configuration as
wtransport 0.7.2, with a Tokio-delegating runtime that retains driver JoinHandles.
The public IncomingSessionFuture adapter keeps the HTTP/3 authentication path.
Shutdown joins the accept/session supervisor, retires the endpoint, then joins
runtime drivers. Rotation still replaces only the server TLS config. No timer,
retry, socket-reuse option, authentication change, or weaker assertion is added.

Cancellation preserves the pending supervisor handle, driver task set, and Control
owner, so a later caller resumes the same barrier. Runtime task records are reaped
on spawn and at shutdown. The existing strict Node immediate-rebind regression is
unchanged; retained-listener and cancelled-waiter unit regressions test the lower
layers on a current-thread executor. These tests concern shutdown lifetime, not
physical peer propagation latency or deployment success.

## Validation (2026-10-24, macOS, app profile)

- Full Lean build: 79 jobs passed.
- Transport unit suite: 20 passed, including cancellation at Control, NativeWt,
  and runtime-driver levels; existing TLS/rotation/authentication framing tests.
- Exact deployment regression initially passed in 16.34s, then one repetition
  passed in 15.75s and a second reached the unchanged 20s overall deadline. That
  uninstrumented timeout's exact phase is unknown; it was not an AddrInUse error.
- Added diagnostic phase timestamps only, keeping all assertions and deadline.
  Ten consecutive repetitions then passed: fixture creation 6.23–13.11s;
  concurrent shutdown 0.19–5.87ms, followed immediately by successful UDP rebind.
- Independent source review approved construction/TLS equivalence and completion
  ownership, including cancellation. Linux deployment CI remains the delivery gate.

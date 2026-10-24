# Synthetic generic live-update timing

This measurement extends the existing authenticated two-peer fixture
`live::tests::a_live_edit_reaches_an_authorized_peer_while_its_background_pages_are_stalled_without_server`.
Both ordinary peers use real PQ transport on loopback and synthetic in-memory data.
The mutation creates an ordinary document; there is no chat-specific scheduling.
Three background-page slots remain occupied while the live document is delivered.
The test retains exact decrypted-body equality, unauthorized-entry refusal in the
companion test, and the assertion that unrelated backlog remains blocked.

Run from `avendb/`, with no competing heavy build when comparing samples:

```sh
RUSTC_WRAPPER= CARGO_BUILD_JOBS=1 RUST_MIN_STACK=8388608 cargo test --locked --offline --profile app -p avendb-net --lib live::tests::a_live_edit_reaches_an_authorized_peer_while_its_background_pages_are_stalled_without_server -- --exact --nocapture
```

Read the executed test count: it must be one, not zero filtered tests. Loopback
socket permission is required. The full targeted suite uses filter `live::tests::`
without `--exact` and currently contains six tests.

All reported durations share one monotonic origin immediately before the local
mutation. `mutation_completed_ms` includes admission/lock wait and the mutation;
`mutation_returned_ms` ends when Node::act returns. Both reactive subscribers are
created before the mutation, and targeted local/receiver reads run concurrently
after return. `local_readable_ms` and `receiver_readable_ms` are first observed
decrypted-read upper bounds, including task scheduling and read work. They do not
identify exact initial publication, wire acceptance, or browser DOM paint time.
`durable_ms` and `remote_accept_ms` are explicitly null because this fixture has
no disk fence and no per-edit receive-accept hook. Cold setup, key generation,
connection and initial catch-up are excluded. The 20-second deadline is a hang
guard, not a performance target. This does not measure a real Mac-to-iPhone path.

Observed local sample, 2026-10-24, with all six targeted tests passing (5.83 s):

| Phase | Milliseconds from mutation start |
| --- | ---: |
| Mutation completed | 3.671 |
| Mutation returned | 3.703 |
| Local decrypted read observed | 3.736 |
| Receiver decrypted read observed | 7.180 |

Three background slots stayed held. This is one synthetic sample, not a p95,
physical-device guarantee, or evidence that foreground PWA restart/slow unlock
has been fixed. No production account, store, relay or hosted peer participates.

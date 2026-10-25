# Generic local-write latency: current findings

Target: small authorized local mutations should become visible in under100ms,
without depending on another peer. This remains unproven on physical devices.
Large writes, owner ceremonies and durable completion are measured separately;
no optimistic UI result may conceal a rejected write.

## Actual path

`run::change` calls `Node::try_act`; ordinary writes do not wait for network
acknowledgment or snapshot persistence. Both mutation and reads previously joined
the same foreground FIFO, so a new write could sit behind queued expensive queries.

More importantly, `Lab::write` synchronously calls `refresh`. Under the single
Lab lock this performs policy replay, key indexing/opening, body scan, `show_items`
and upkeep. `show_items` walks all entry lanes and reconstructs capability groups
before its incremental ordinary-entry loop. `make_bringing` also clones policy
state. These are concrete broad-work paths, not proof of their exact share of the
reported3s; measure existing inner Perf counters and admission wait separately.

The UI increments its local revision after the bridge operation returns, then
its reactive query requires another database turn. Running background closures
cannot currently be preempted by priority.

## Implemented queue correction, targeted validation passed

Local `try_act` mutations now have a dedicated bounded admission queue. They may
overtake two queued reads; then a waiting read receives a turn. All foreground
work still shares the three-grant budget against waiting background work. The
actual closure, authorization, signatures, cancellation ownership and persistence
notifications are unchanged. This does not shorten one already-running operation.

Lean `reads_after_write_burst` and `mutation_cannot_extend_foreground_budget`
passed. Added a Rust test covering older queued reads, multiple writes, cancelled
writes and background progress; all four scheduler regressions passed on the combined branch (including the new
mutation-priority test). Full application check also passed with0errors and28
existing warnings. Implementation: [973bb39e](https://github.com/MyAvenCEO/maiacity/commit/973bb39e).

## Remaining work

- Guarded ordinary-entry refresh: avoid rebuilding unchanged key/lane/capability
  preparation; preserve full invalidation on relevant policy changes.
- Validate queue behavior in the actual Node and browser worker.
- Measure small write admission, signing, refresh, notification, reactive query
  and paint on Mac/iPhone/iPad during sustained catch-up.
- Do not declare the100ms target achieved from scheduling tests alone.

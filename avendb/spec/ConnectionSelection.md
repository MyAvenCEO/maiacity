# Crossed sync connection selection

`AvenDB/ConnectionSelection.lean` specifies the narrow repair before the Rust implementation. The reproduced local regression had two unlocked devices holding each other's signed endpoint, both selecting their own outgoing PQ-authenticated connection, and neither opening an optional carrier within 65 seconds. Ordinary sync still worked because both connections were served; transport control correctly rejected messages arriving on the locally unselected connection.

For the same Hello-proven device, when a live selected connection and a new authenticated connection have opposite QUIC sides, both endpoints prefer the connection dialed by the lexicographically lower endpoint. Either direction remains valid as the sole live connection. A dead selected connection is replaced. Same-direction replacement and replacement by a different proven signer at the same endpoint retain their prior behavior, including key moves.

The model's `preferred` is `(local endpoint < remote endpoint) == (QUIC side is Client)`. Both observations invert at the other endpoint, so `preference_agrees` proves the preference is shared. `crossed_arrival_order_agrees` and `crossed_selects_preferred` prove agreement for the two live crossed connections to one device. `sole_connection`, `closed_replaced`, `same_direction_replaced`, and `different_device_replaced` state the compatibility cases. `losing_duplicate_keeps_route` and `same_generation_keeps_route` prohibit retiring the selected carrier when publication does not change its connection generation.

The Rust mapping is the publication boundary in `avendb-net/src/transports/control.rs::connected`, under the existing state-then-peers lock order. Selection rejection returns before map replacement, session retirement, or route removal. Republishing the identical local `Connection::stable_id` also leaves that selected generation and its route intact; the model's `id` means this local identity, not a number compared across endpoints. The model covers this control state, not incidental announcement/job notifications outside it. `Shared::connected` still returns the actual newly authenticated `Peer`; its caller serves that actual connection exactly once, even if it is not selected. Authentication, signed peer membership, exporter-bound control challenges, stale-generation rejection, sync authorization and blob authorization remain unchanged.

This is deliberately not a total order over arbitrary simultaneous connections. It assumes both ends eventually observe the same two authenticated crossed connections and that they stay live long enough to select them. Same-direction raw connections retain last-publication replacement semantics; the normal outbound path serializes dials and cancels extra connection attempts before Hello. Key-move arbitration, process scheduling, network delivery, cryptography and Rust refinement are not proved. The existing `TransportEpoch` model continues to cover challenge/route safety separately.

Validation must include a deterministic real TLS/Hello crossed-dial regression (equal selected exporters, opposite selected sides, and actual authenticated carrier Open), the unchanged relay-loss fresh-edit/sealed-blob test, and existing stale-generation/replacement tests. A Lean result alone is not transport runtime evidence.

```sh
cd avendb/spec
lake env lean AvenDB/ConnectionSelection.lean
```

## Recorded runtime verification — 2026-10-23

The corrected deterministic fixture `opposite_authenticated_completions_select_the_same_control_connection` uses verified Hello plus an ANNOUNCE roundtrip to ensure inbound registration precedes controlled outbound publication. With the old policy it fails selected-exporter equality in5.70s. With the fix, the control suite passes4/4 in5.93s, including a subsequent losing connection preserving both selected connection IDs and route IDs. The existing `transport_control` integration suite passes3/3 in8.92s, including replay/replacement, fallback and concurrent listener shutdown.

The original relay-loss test passes three consecutive runs in12.41s,16.87s,13.33s without changing its65-second deadline, and retains its fresh-edit and gated encrypted-file assertions. Full integrated Lean74jobs pass; regenerated vectors are unchanged. These are local fixture results, not physical-device latency or production deployment evidence.

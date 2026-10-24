# Owner-approved entry projection foundation

This is a read-only primitive, not a completed bootstrap transport. It is not wired into peer reception or application queries. Ordinary signed entry history remains the write and convergence authority.

`Lab::draft_entry_projection` exports the held entry’s JSON records per line and signed-history frontier, encrypts the envelope under the current entry key, and returns content-addressed bytes plus an ordinary unsigned `Action::Snapshot` draft. The existing vault-owner approval ceremony must authorize that draft. Possessing a device, hosting a peer, or holding plaintext does not confer this authority.

`Lab::open_entry_projection` requires a standing owner-approved snapshot in the recipient's verified log, the known entry's matching vault, current held READ/key entitlement, an exact ciphertext hash and size, authenticated encryption, engine/entry/frontier binding, and no known standing later removal. It returns an immutable record projection; it does not install policy, signatures, entry history, or writable state. Full holders additionally compare all stated lines at the stated causal basis with their verified history.

## Trust and completeness

An owner attests the stated record. A recipient without its basis history cannot independently reconstruct that record. The owner does not thereby become a server authority: every peer applies the same owner-signature and recipient-access gates.

“Current” means the locally held verified policy. This does not establish absence of unknown revocations, global freshness, complete discovery, or that no later edit exists. The projection describes only its signed basis. UI consumers must preserve this distinction and must not show a projected record as globally complete or permit mutations against it until the ordinary mutation prerequisites are met.

## Resource bounds

The envelope contains uncompressed JSON records, not Loro snapshots. It imports neither CRDT operations nor writable state. Serialized bytes are bounded to 1 MiB, with at most 16 lines and 64 signed frontier heads. An allocation-free byte scan enforces depth 32 and a total budget of 16,384 JSON tokens across all lines (object keys count too) before parsing. Strict JSON syntax and UTF-8 validation follow in serde_json; its default recursion limit remains enabled. Oversized/deep/wide records fall back to ordinary history. Whole-envelope file transport must enforce the same encoded limit before buffering.

This representation eliminates historical CRDT operation bytes from the read-only view. Ordinary history must still arrive before canonical mutation/convergence. No projection claims a writable CRDT checkpoint.

## Remaining runtime work

1. Persist and publish owner-approved ciphertext through the existing content-addressed file path, retaining the signed snapshot evidence.
2. Discover snapshots and sufficient verified governance/entry-creation evidence for the active query, without promoting peer hints into authority.
3. Enforce encoded limits before network buffering and measure peak parsing memory on iPhone/iPad.
4. Expose projected read-only rows with explicit basis/partial completeness and reconcile them with ordinary entry materialization.
5. Connect signed updates from the frontier without allowing projection state to authorize writes or bypass revocation.
6. Test physical fresh-device first view and restart behavior before declaring bootstrap delivered.

The Lean `EntryProjection` model proves rejection gates and policy-kernel noninterference under explicit Boolean evidence assumptions. It does not prove cryptographic verification, global freshness, Rust extraction, or latency.

# avenDB custom-path activation patch

This is the published iroh 1.3.0 source, pinned to upstream commit
`0072d7d84b233f9e7185eb676f049beaf557ac03` (workspace subdirectory `iroh`).
The crates.io archive SHA-256 is
`885787b892b5e2507c701f132ecbd45d2bad4bbb75157a19427087c16dadb833`,
verified against the original avenDB Cargo.lock before extraction. The upstream
MIT and Apache licenses are included alongside the archive's BSD license.

Local source change: `src/socket/remote_map/remote_state.rs`, the
`RemoteStateMessage::ResolveRemote` handler. Explicit custom addresses supplied
by the application are opened as candidate paths on existing client-side QUIC
connections. Upstream already does the path-validation and selection work; this
patch does not change identities, TLS, transport encryption, address formats or
application authentication. The server side still never initiates a path.

Reason: avenDB negotiates a carrier over an existing authenticated sync connection.
Stock 1.3.0 stores the new candidate but sends new probe connection Initials solely
on the selected relay, and its IP hole punching never opens custom candidates.
Browser WebTransport/WebRTC can therefore report Ready while transporting no bytes.
Closing the authenticated connection to force a redial is incompatible with the
connection-bound route lifetime and is not used as a workaround.

Both Rust workspace roots (`avendb/` and `vault/`, whose Mac app links avenDB) patch
crates.io to this exact directory. The native late-activation regression and real
Chromium forced-data tests must pass before this patch can be delivered. The native late-activation regression passed, and actual Chromium passed forced
WebTransport, relay fallback and WebRTC transfers of fresh edits and sealed files.
The reproducible tests are `avendb-server/tests/transport_activation.rs` and
`avendb-browser/tests/transports.rs`; see `avendb/README.md` for rollout limits.

When upgrading iroh, remove this patch only after the existing-connection regression
passes against the replacement. Keep the original connection alive during that test.

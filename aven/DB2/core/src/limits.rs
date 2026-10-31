//! Every input has a limit before it costs memory or time (ARCHITECTURE.md rule 10), as `Aven.Core.Limits` states
//! them; `limits.json` holds these numbers to Lean's, and each limit from both sides. A reader refuses an envelope or a
//! signed thing past these before it decodes or keeps it; the past and the verdicts run over what a reader already
//! holds, so their cost is bounded by these times the envelopes held. Nesting is bounded by the codec's
//! [`MAX_DEPTH`](crate::MAX_DEPTH).

/// The largest encoded envelope or signed thing a reader decodes: 1 MiB, a store chunk. A Doc's bulk travels in
/// segments and blobs, named by hash; an envelope carries edits and names.
pub const MAX_ENVELOPE_BYTES: usize = 1 << 20;

/// The most tips of other logs one envelope builds on.
pub const MAX_DEPS: usize = 256;

/// The longest branch name, in bytes of UTF-8.
pub const MAX_BRANCH_BYTES: usize = 256;

/// The longest label, in bytes of UTF-8.
pub const MAX_LABEL_BYTES: usize = 256;

/// The longest signer: room for a hybrid key (Ed25519 with ML-DSA-65's 1952 bytes) or a passkey's.
pub const MAX_SIGNER_BYTES: usize = 4096;

/// The longest signature: room for a hybrid one (Ed25519 with ML-DSA-65's 3309 bytes) or a passkey's assertion.
pub const MAX_SIG_BYTES: usize = 16384;

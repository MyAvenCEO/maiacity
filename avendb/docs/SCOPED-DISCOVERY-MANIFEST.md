
## Capsule-backed carrier delivery

New `checkpoint_scope` publication uses `checkpoint_entry_capsule`, preserving
both owner ceremonies and the existing disclosure check. A fresh receiver can
read the signed carrier without deriving an ordinary entry key from an incomplete
private-audience occupancy history. This does not grant access to any member;
member IDs are scheduling hints and every member still needs current authority.

The manifest consumer reads the immutable authenticated base record, never the
mutable suffix overlay. At adoption it retains only manifest records in a
recipient-keyed, 16-entry / 4 MiB bounded memory cache (1 MiB per record), so
canonical-history retirement cannot erase the owner's statement. Every use checks
current entitlement and actor scope, and locking clears the plaintext. Durable
reopening retains retired manifest ciphertext in the same bounded bootstrap
companion, serialized with the ordinary signed frontier. Reopening authenticates
the owner root and current policy before rebuilding the memory cache, without
reactivating a retired overlay. Active and retired anchors share the 16-anchor
bound; this cache creates no alternate durable authority.

Validation added: cold carrier discovery with member history withheld, automatic
pending-member hint, immutable statement after a later carrier write, plaintext
clearing on lock, and a twelve-member real peer delivery fixture using capsule
publication and a durable recipient shelf. Lean `ScopedDiscoveryManifest` passes;
Rust execution remains pending the shared compiler slot.

The public operation registry now recognizes `checkpoint_scope` with only
`vault`, `types`, and `tag`. The public `Node::op` regression exercises both scope
forms without an authenticator, requires an approval response, verifies unchanged
entry inventory and signed-log IDs, and checks all checkpoint pin prefixes remain
empty. Supplying an `approved` field is rejected. Registration was checked for
`checkpoint_view`, `checkpoint_entry_base`, and `checkpoint_entry_capsule` too.

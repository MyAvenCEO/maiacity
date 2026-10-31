# A device acts for a vault

A device has a vault of its own, a **device's vault**, owned by the vault it serves. Its device key **signs for** it.

The device then **acts for** the vault it serves: Alice's phone writes to Alice's vault. It may do only what her
vault lets it, which is written in a [cap](glossary:cap) for that device, its **device cap**. A phone Alice signed
in with her passkey may do everything her vault may, except govern it: changing its owners stays with her owner key.

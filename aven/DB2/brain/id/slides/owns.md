# A key owns a vault

Alice has a [vault](glossary:vault): an identity that can own things, with a name, *Alice's vault*. She also has a
[key](glossary:key), which signs. She keeps it, and no one else has it.

Her vault lists that key as its **owner**. An owner governs the vault: when the key signs, it signs for Alice's vault.

Anyone can check it. The signature fits the key, and the key is on the vault's list of owners.

A vault can have more than one owner, and it says how many of them must agree. That comes later.

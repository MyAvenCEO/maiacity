# avenID

Who is who, and who may do what, told from the ground up: keys, vaults, owners, devices and caps. One idea per
slide, each built on the ones before it.

## The story

1. **A key signs.** A key makes a signature over some words.
2. **Anyone can check a signature.** With the key's public half, and nothing secret.
3. **A vault.** An identity that can own things, with a name.
4. **A key owns a vault.** The owner key governs the vault.
5. **A device keeps its own key.** Made on the device, never leaving it.
6. **A passkey.** The key a phone or browser keeps for a person, unlocked by a finger or a face.
7. **A device acts for a vault.** Within its device cap.
8. **Vaults own vaults.** Authority runs only down.
9. **A cap.** A signed grant that narrows what its issuer holds.

## Owns

avenID says who is who: the keys that sign and seal, the vaults they act for, and the owners who govern them.

- [Keys and suites](#keys-and-suites): what signs, what opens, and the suite every seal and signature names.
- [Hybrid signatures](#hybrid-signatures): Ed25519 and ML-DSA-65 over the same bytes, where authority lasts.
- [Vaults](#vaults): what owns things, its kinds, and a name made from its own genesis.
- [Owners and governing](#owners-and-governing): owns, governs, and authority that runs only down.
- [Approvals, k of n](#approvals-k-of-n): how a vault's owners agree on one act.
- [Devices](#devices): a vault of its own, with keys from its own seed that its owner binds.
- [Passkeys and the PRF step](#passkeys-and-the-prf-step): the owner key and the seal key a passkey derives.
- [MaiaCityGuardian](#maiacityguardian): a full owner of every person's vault for now, and its exit.
- [Seal keys and stanzas](#seal-keys-and-stanzas): X-Wing keys, and a key sealed to one reader.
- [Epochs](#epochs): one key of a Doc or a keyring, its blob, its tags and its rotation.
- [The keyring](#the-keyring): a vault's own Doc of keys, the only Doc sealed to devices.
- [The seal](#the-seal): one construction for envelopes, segments and checkpoints.
- [Padding](#padding): one Padmé for every size a host sees.
- [The heal](#the-heal): getting back to safety after a stolen key.
- [The safe](#the-safe): where a vault's secrets live and act.
- [Built-in types](#built-in-types): `keyring`, `safe` and `epoch`.

## Uses

- [avenCORE](../core/README.md): Values, names and the one codec; signed things, their `[label, body]` names and
  `Sig` (A30); BLAKE3's hash, keyed, derive and extendable modes; `builtinType`; `DocId` and `Hash`.
- [avenDOCS](../docs/README.md): Docs and Records. The keyring and the safe are Docs, and an epoch is a Record.
- [avenCAPS](../caps/README.md): the register (`tree/1`), where vaults are founded, passkey records kept, devices
  signed in and owners changed; device caps, which say what a device may do for its vault; groups, which Doc epochs
  are sealed to; and the `tell` caps the safe acts on.

## Keys and suites

A key signs or opens. A signing key makes a signature over some bytes, and anyone with its public half can check it.
A seal key opens: anyone can seal a secret to its public half, and only its holder opens it.

| Suite | Does | Sizes | Used for |
|---|---|---|---|
| Ed25519 | Signs | Public key 32 B, signature 64 B | A device's key; a hybrid's first half |
| ML-DSA-65 (FIPS 204, empty context) | Signs | Public key 1,952 B, signature 3,309 B | A hybrid's second half |
| ES256 (ECDSA on P-256) | Signs | | A passkey's WebAuthn assertion |
| X-Wing (ML-KEM-768 with X25519) | Opens | Public key 1,216 B, ciphertext 1,120 B | Every key sent |
| XChaCha20-Poly1305, BLAKE3 | Seals, hashes, derives | 256-bit keys | Content, commitments, derivations |

- **Every seal and every signature names its suite.** New cryptography joins as a new suite, never as a redesign:
  HQC for key encapsulation and SLH-DSA for signatures if lattices ever weaken, each reached by rotation.
- **Every derivation has its own label:** BLAKE3's `derive_key("<label>", key)`, so no two uses share a key.
- **The primitives stay outside Lean.** Lean fixes every byte that goes into them and comes out; the code holds them
  to their standards' known answers and to Wycheproof. Ed25519 is verified strictly, so an all-zero key and signature
  never pass.
- **The box's keys are test keys,** public on purpose and valid only in the box: an Ed25519 seed is
  `sha256("avenSANDBOX test signer: <id>")`, and a test passkey's P-256 scalar
  `sha256("avenSANDBOX test passkey: <id>")`.

**Decided:** D10, A43, caps rules 20 and 29  ·  **Lean:** `Aven.ID.Keys`, `Aven.ID.P256` (the box's public halves,
held to RFC 8032 by `#guard`); `Aven.ID.KeyFormats` fixes every derivation's bytes (`derivations.json`)

## Hybrid signatures

Where authority lasts, a signer signs the same bytes twice, with Ed25519 and with ML-DSA-65, and the signature holds
only when both halves verify. A quantum computer that breaks Ed25519 still meets ML-DSA-65, and a flaw in the newer
lattice scheme still meets Ed25519.

- **Its form.** A hybrid key and a hybrid signature are each a Value with exactly three keys, in codec order:
  `{mlDsa, suite: 1, ed25519}`. A key's halves are 32 and 1,952 bytes, a signature's 64 and 3,309. They travel as a
  `Sig`'s `signer` and `sig` bytes beside any signed thing ([avenCORE](../core/README.md)).
- **Where it goes:** caps, revocations, governance and approvals, letters, segments and checkpoints.
- **Where Ed25519 alone goes:** a single live envelope. Its segment's hybrid signature covers it once the segment
  closes: 64 bytes instead of about 3.4 KB each.
- **A passkey's act carries two signatures** beside its one name (A30): the passkey's ES256 assertion, which proves
  the authenticator and the person, and the owner key's hybrid signature, derived from the passkey's PRF
  ([passkeys](#passkeys-and-the-prf-step)). Both must hold, so a quantum attacker would also need the PRF output.

**Decided:** D10, A2, A30, A43, caps rules 20 and 21  ·  **Lean:** `Aven.Core.Hybrid` — `hybrid_needs_both`,
`Signed.hybrid_valid`

## Vaults

A vault is an identity that can own things, like a smart account. Only a vault owns things, holds caps and is an
admin; a key only signs for one. A vault is its owners, how many of them must agree, and what it owns.

- **Kinds:** `person`, `coop`, `agent` (Aven, and MaiaCityGuardian's vault) and `device`. "Kind" means only this.
- **Its name is 32 bytes,** the A30 name of its own genesis: the hash of `["avenID vault 1", {kind, nonce}]`, its
  nonce 32 random bytes drawn at its founding. Nothing that changes is in it (owners, keys, epochs, the statement that
  founds it), so a vault's name never changes. A genesis reads back only with exactly those two keys, one of the four
  kinds and a 32-byte nonce; an unknown kind is refused. Every format names a vault by these bytes, never by text.
- **Where a genesis is born:** the network's own vaults (Maia City's coop, Aven's vault, the guardian's vault) in the
  register's root Record, with fresh nonces in production and fixed ones in the cast; a person's vault and the
  claiming browser's device vault in their claim; a device's own vault in the sign-in that adds it; a later vault in
  its governing vault's statement. The register writes them down ([avenCAPS](../caps/README.md)).
- **Its display name** is a field of its own: 1 to 64 characters, none of them a control character (Unicode's Cc). A
  person's name is at most 48, so `<name>'s browser 99999` still fits. A display name is shown, never parsed: two vaults
  may share one, and the name from the genesis tells them apart.
- **A well-formed tree.** Each vault once. Every vault has an owner, and every owner is a known key or vault. An owner
  always ranks before what it owns, so there are no cycles. A device's vault is owned by exactly one vault, the one it
  serves, and has its own key; no device and no device's key owns anything. A coop is owned only by people's or coops'
  vaults, never a key, and holds no devices. Every display name is valid. aven-id builds only well-formed trees, and
  `check` names the first rule a tree breaks.
- **A vault fingerprint** lets two people compare a vault once, as Signal's safety numbers do, so a host that invents a
  vault looking like Bob's is caught.

**Decided:** rule 15, A1, A28, A42, L13, L15  ·  **Lean:** `Aven.ID.Tree`, `Aven.ID.WF`; `Aven.ID.Check` —
`check_iff`; `Aven.ID.Name` — `name_examples`, `person_name_examples`; `Aven.ID.VaultName` — `vaultName_inj`,
`vaultName_len`, `name_ignores_owners` (#1738)

## Owners and governing

A vault's owners are keys or vaults. A vault owns the vaults directly below it, and governs everything below those,
through a line of owners. Authority runs only down.

- **Governs** is owns, followed down. In a well-formed tree it never returns to where it starts, and what a vault
  governs never governs it.
- **Governing is ownership, never a cap.** A vault's owners change its owners, its devices, its threshold and, later,
  its recovery, k of n. No cap governs, and no device governs.
- **A key holds no authority of its own.** It signs as one of a vault's owners, or as a device's key for the vault the
  device serves, within its device cap ([avenCAPS](../caps/README.md)).
- **A coop's vault** is owned by people's or coops' vaults and holds no devices: it acts only by its owners' approval.
- **avenOS's questions** are answered from these relations and proven against them: what a vault owns and governs,
  the owners above it, which vault a device acts for and which devices act for a vault, which person vaults a device
  can act as (its accounts, never an agent, coop or device vault), and what a device may act on: what its vault
  governs, never a vault above or beside it.

**Decided:** rule 15, A28, A42, caps rule 2  ·  **Lean:** `Aven.ID.Governs` — `governs_irrefl`, `governs_asymm`,
`governs_trans`, `device_governs_nothing`, `device_key_governs_nothing`; `Aven.ID.Correct` — `mem_governs`,
`mem_chain`, `actsFor_device`, `mayActOn_iff`

## Approvals, k of n

An act that needs a vault's owners, such as a grant or an owner change, counts only when k of its n owners agree. Each
agrees by signing the act's one name.

- **Its form.** Approvals are signatures beside the act's name, the hash of `[label, body]` (A30): Core's
  `Sig {signer, sig}`, a set that only grows. They are a list, never an aggregate, so each stays post-quantum on its
  own, and adding one never renames the act.
- **Recursive.** A key approves by signing exactly that name. An owner that is a vault approves by its own quorum, and
  so on up to keys. With every threshold at least 1, an approval always rests on a signature by a key above the vault.
- **Authority through quorums.** Whatever a vault approves, a vault whose quorum it meets alone approves too, so
  authority that runs down the tree speaks for each vault's own owners.
- **Each vault stores its threshold k,** at least 1. Every threshold is 1 today: any one owner is enough.
- **An owner change** is a governance act in the register, never a new genesis. Two concurrent owner changes settle to
  one winner everywhere: the latest by the past, ties by the smallest name. A change that drops a key beats every act
  that key approved outside the change's own past; an act already in its past stays counted. No owner outranks another
  by seniority.
- **What is shown is what is signed.** avenOS renders the act being approved by decoding the exact bytes the passkey
  signs, never from a copy kept beside them.

**Decided:** D14, A2, A28, A30, A42, A45, caps rule 25, ledger 10:45  ·  **Lean:** `Aven.ID.Approve` —
`approval_exact`, `approvesF_exact`, `approves_signed`, `approves_iff`, `alone_approves`, `shown_is_signed`; the
stored threshold, the owner change and its settling (`removal_beats`) not in Lean yet

## Devices

A device is a phone, a browser or a Peer that acts for a vault. It is a vault of its own, of kind `device`, owned by
exactly one vault: the one it serves. What it may do for that vault is its device cap ([avenCAPS](../caps/README.md)).

- **Its key is made on it** and never leaves its safe runtime: an Ed25519 seed, never derived from a passkey. The key
  carries its device vault's id, and signs only for the vault the device serves.
- **Its other keys come from that seed,** in the process that holds it, and are wiped after use:
  - its ML-DSA-65 ξ is `derive_key("avenID device ml-dsa 1", seed)`, which with the Ed25519 half makes its hybrid key;
  - its X-Wing seed is `derive_key("avenID device seal 1", seed)`: its seal key, which its vault's keyring is sealed
    to.

  Nothing else is derived from the seed, and the seed is never exported; outside these derivations only Ed25519's
  scalar signs. A quantum attacker recovers that clamped scalar from the public key, never the seed it was hashed from
  (RFC 8032), so the other halves stay out of reach, as X-Wing's two halves do from its one seed.
- **Its hybrid key counts only once its owner binds it:** where its vault owner's hybrid signature names it, in the
  sign-in that admits the device or, for a device migrated from production, at its owner's owner-epoch op or next
  sign-in. A binding signed only by the device's own Ed25519 never counts, or a quantum forger could bind its own key.
  A device closes segments only once its key is bound, deriving its ML-DSA half for each close and dropping it after.
- **All three rotate together,** with the device key: monthly by themselves, and at once on suspicion
  ([the heal](#the-heal)). A rotation reseals the keyring to the new seal key.
- **Removing a device** is its device cap's revocation. Its keyring rotates at once, and each group and Doc it could
  read rotates at its next use.

**Decided:** rule 15, A42, A43, D11, D19, L6, P4, P6, caps D2, caps rule 17  ·  **Lean:** `Aven.ID.KeyFormats` —
`deviceMlDsaSeed`, `deviceSealSeed`; `Aven.ID.Sign` — `verify_ok`, `sign_verify`; the binding (`device_hybrid_bound`)
not in Lean yet

## Passkeys and the PRF step

A passkey is the key a phone, a browser or a password manager keeps for a person, unlocked by a finger or a face:
ECDSA on P-256 through WebAuthn (ES256), for the RP ID `maia.city`. avenID asks it for one thing more, its PRF: 32
bytes only the authenticator can make, for a given input. From them a passkey derives an owner key and a seal key, so
**a new browser that signs in with a passkey opens its vault with no other device online.**

**An assertion** is checked in WebAuthn's order (Level 3, 7.2): `clientDataJSON` is JSON with a type, a challenge and
an origin; the type is `webauthn.get`; the challenge is the one expected; the origin is one of those expected; it was
not made in a frame of another origin; `authenticatorData` is long enough, holds the RP ID's hash and has the
user-present and user-verified flags; and the passkey signed exactly these bytes. A passkey that counts its signatures
must count up; synced passkeys keep 0, and pass.

**The derivations:**
- The PRF input is `encode(["avenID prf 1", {epoch}])`: the owner's epoch, and no vault. A passkey's PRF secret is
  already its own, and a passkey belongs to one vault, so a vault would separate nothing; without it a new browser asks
  the PRF in its one sign-in tap, before it knows its vault. The browser hands the authenticator
  `SHA-256("WebAuthn PRF" ‖ 0 ‖ input)`.
- From the 32-byte output, `derive_key("avenID owner 1")` read for 64 bytes gives the **owner key**: the first 32 its
  Ed25519 seed, the next 32 its ML-DSA-65 ξ. `derive_key("avenID seal 1")` gives the **seal key**'s X-Wing seed.
- **The owner key is derived, never stored.** Each ceremony derives it, signs and drops it; no safe, keyring or page
  keeps it. Sealing to the seal key needs only its public half, so rotating the keyring needs no ceremony; only opening
  it needs the passkey.
- **The owner epoch** is in the input, so rotating it changes every key derived from it, and a leaked output never
  opens a later epoch.
- Device keys never come from a passkey.

**The passkey record:** its credential id, its ES256 key (SPKI), the owner key's hybrid public half, the seal key's
public half and the owner epoch. The register keeps it and maps the credential id to it
([avenCAPS](../caps/README.md)), so a sign-in names no vault: its vault is the one of the passkey that signed.

**Without PRF, no vault.** A passkey whose provider has no PRF never makes a vault: sign-up refuses and says plainly to
use a passkey provider that can open the vault on any device. So there is one kind of vault, post-quantum and opening
anywhere, and no owner is ES256 only. Providers differ: iCloud Keychain (iOS 18.4 and macOS 15 on), Google Password
Manager, and security keys in Chrome and Firefox answer; Windows Hello only from Windows 11 25H2; 1Password's output
isn't spec-compliant; Bitwarden and Dashlane have none.

**The ceremonies** run on avenOS's page ([avenOS](../os/README.md)). Sign-up evaluates the PRF for owner epoch 1, so
the owner and seal keys exist before the claim's assertion, which signs their public halves, and the owner key signs
the same name; the keyring is then made and sealed to the device and the passkey ([the keyring](#the-keyring)). A new
browser signs in with one tap, asking the PRF for the owner epoch it expects, and once more only after a rotation; the
keyring's stanza for that passkey, opened with the seal key, then gives it everything its vault can read.

**A passkey migrated from production** has a record without owner or seal. Until its owner-epoch op adds them, it
signs nothing else. A migrated passkey without PRF keeps its vault's devices and adds none, until a PRF passkey gives
the vault an owner.

**Its boundary is every origin under `maia.city`.** The input can be guessed, and the passkey answers any origin its
RP ID covers, so every such origin serves only signed releases (A15), and keys live only in the safe within that
boundary. avenOS has no RP ID of its own (A14: no); moving to one would mean a new genesis.

**Its limits:**
- Deleting a passkey loses its PRF, so every vault keeps another way in: its devices and the keyring's other seals.
- The PRF output passes through the page, so a script injected during a ceremony could take it. Rotating the owner
  epoch changes the input and everything derived from it.
- Over USB and NFC, the browser and a security key protect the output with a classical P-256 exchange. Recorded, that
  exchange is the remaining quantum risk. The PRF itself is HMAC-SHA-256, which a quantum computer only halves.

**Decided:** D11, A14, A15, A42, A43, caps rule 21, ledger 09:49, ledger 10:01  ·  **Lean:** `Aven.ID.Passkey` —
`check_ok`; `Aven.ID.KeyFormats` — `prf_input_separates`; `Aven.ID.Network` — `ownerless_only_adds_owner`

## MaiaCityGuardian

MaiaCityGuardian is a full owner of every person's vault, for now: a super admin, not recovery. Its vault, an `agent`
vault its key owns, is among the owners of each person's vault from its founding, and any one owner is enough. It is
the one place where one key is enough, kept for the evaluation phase.

- **The genesis names it** with its hybrid keys (Ed25519 and ML-DSA-65) and its X-Wing key, and it signs the genesis
  beside the claimant's passkey. Every claim names the guardian vault it consents to, and the register's guardian
  setting names the guardian vault new vaults are founded with; it never changes who owns an existing vault
  ([avenCAPS](../caps/README.md)).
- **Each keyring is also sealed to its seal key,** so it restores data, not only control.
- **Its exit comes before the network opens beyond the founding circle,** whatever else is ready. One act per vault
  removes it as an owner and rotates the keyring, so nothing new is sealed to it. Then its secrets are destroyed:
  everything it could open before stays open to whoever kept them.
- **Recommended on the way there:** remove it from a vault as soon as that person has their own way back (a second
  passkey, a recovery kit or chosen guardians), and keep its secret as 2-of-3 pieces in different places, so no single
  stolen copy is the master key.
- **Recovery comes later, and is never one key.** Recovery owners are guardian vaults a person chooses, k of n, whose
  act takes effect only after a delay (seven days, say) in which any owner can cancel it; they restore control, and data
  keys only if the person opts in. A recovery kit is a printed secret whose owner and seal keys are derived as a
  passkey's are from its PRF: a passkey without a device.

**Decided:** D12, A11, A13, A28, A42, caps rule 30  ·  **Lean:** `Aven.ID.Recover` — `guardian_exit`;
`Aven.ID.Network` — `guardian_consented`

## Seal keys and stanzas

X-Wing is the one way a key is sent. Anyone seals a secret to a seal key's public half, and only its holder opens it.
It holds while either ML-KEM-768 or X25519 holds, against an adversary who records today to decrypt later.

**Seal keys:**
- a device's, from its own seed ([devices](#devices));
- a passkey's, from its PRF ([passkeys](#passkeys-and-the-prf-step));
- a vault key: the vault's own, its seed carried inside each keyring epoch ([the keyring](#the-keyring));
- a group key, carried inside its group's epoch ([avenCAPS](../caps/README.md)).

**A stanza** seals a 32-byte key to one reader's seal key, key-committing:
- From X-Wing's shared secret, `derive_key("avenID stanza key 1")` is the cipher's key and
  `derive_key("avenID stanza commit 1")` the commitment's.
- The AAD is `encode({id, epoch, scope, recipient})`: the vault or the Doc, the epoch's number, `keyring` or `doc`, and
  the BLAKE3 of the reader's X-Wing public key.
- `commit` is the commitment key's keyed BLAKE3 of the AAD. The reader checks it in constant time before it decrypts,
  so a stanza holding a wrong key is found at once.
- XChaCha20-Poly1305 seals the key with nonce zero: every key is used once.
- As a Value, in codec order: `{ct, tag, suite: 1, commit, sealed}`. `ct` is X-Wing's 1,120 bytes, `commit` 32,
  `sealed` 48 (the key and Poly1305's tag), and `tag` 32, present only when the stanza has one ([epochs](#epochs)). A
  stanza reads back only in that one form.
- A stanza names no reader: a reader finds its own by its tag, or by opening.

**Decided:** D10, A43, caps rules 18, 20 and 29  ·  **Lean:** `Aven.ID.KeyFormats` — `stanzaCommit`,
`Stanza.ofValue_value` (`stanzas.json`)

## Epochs

An epoch is one key of a Doc or a keyring, from one rotation to the next. Keys travel with what they open: an envelope
names its epoch, an epoch names its blob, and each epoch links to the one before. So nobody waits for a key sent apart,
and a new reader reads history while no one else is online.

**Its key blob** is a Value, its keys in codec order:

| Key | What |
|---|---|
| `n` | Its number |
| `id` | The vault, for a keyring, or the Doc |
| `back` | The previous epoch's key, sealed under `derive_key("avenID back 1", key)` |
| `prev` | The names of the epochs before it |
| `scope` | `keyring` or `doc` |
| `vault` | A keyring's vault key, sealed under `derive_key("avenID keyring vault 1", key)`; present exactly for a keyring |
| `commit` | `keyed_hash(key, "avenID commit 1")`, which a reader checks on opening |
| `scheme` | `flat 1` |
| `stanzas` | The key sealed to each reader, padded |

`back` and `vault` are sealed with the AAD `encode({id, epoch, scope})`. A blob reads back only in its one form:
exactly these lengths, the flat scheme, stanza suite 1, and a vault key exactly for a keyring.

- **Its name** is the BLAKE3 of the blob without its stanzas, so sealing it to one more reader never renames it.
- **It is a Record** of avenID's built-in type `epoch`: the blob, with its signatures beside it under `sigs` (A30). A
  Doc's epochs are in its access map; a keyring's are the keyring's own Records ([the keyring](#the-keyring)).
- **Readers** are vaults, through their vault keys, and groups, through their group keys
  ([avenCAPS](../caps/README.md)). A Doc is sealed to its readers; only a keyring is sealed to devices.
- **Tags.** A reader finds its stanza by its tag, `keyed_hash(tag seed, encode({id, epoch}))`. Its tag seed lives in
  the epoch before: the keyed hash of its X-Wing public key's BLAKE3 under
  `derive_key("avenID tag seed 1", previous epoch's key)`. Every writer that rotates and every reader of the previous
  epoch knows that key and the keeper doesn't, so the keeper links no reader across Docs or epochs. A first epoch's
  stanzas, and a reader new to an epoch, carry no tag: their reader finds them by opening.
- **Padding.** For `n` readers the stanza list holds `padme(max(n, 4))` stanzas: never fewer than four, so a lone
  reader doesn't show, then at most an eighth more ([padding](#padding)). The extra stanzas are random bytes of a
  stanza's lengths that open for no one, and nobody, the writer included, can tell them from a reader's.
- **Write-once.** An epoch Record is never edited. Removing a reader is a rotation. Adding one is a reseal: another
  Record of the same epoch, holding only the new reader's stanza padded to four, with the same header and so the same
  name. Opening an epoch tries the stanzas of every Record that shares its name, so adding a Record never takes an
  opening away.
- **History.** Through `back` the newest key opens all of history, for a reader whose grant reaches it; a grant from
  now on rotates without it. Old readers keep the old keys in their keyrings.
- **Keys run down.** Where every seal opens a key of the vault it is sealed under or of one below it, a party learns
  keys only of the vaults whose keys it holds and those below them, never of a vault above.
- **Schemes.** `flat 1` now: one seal per reader. `tree 1` later, for big groups: a BeeKEM-style tree with X-Wing at
  its nodes and vault and group keys as its leaves, started when Maia City passes about 150 members. Only the `scheme`
  field ever says which. Not MLS: it needs one order of commits per group, a sequencer here; its forward secrecy
  deletes the history Docs keep; and every device would be a member.

**Rotation:**
- Before writing, a writer rotates when its Doc's epoch isn't sealed to the current key of every reader, or still
  seals to a removed one.
- Two writers may rotate at once. Both epochs are valid, nothing is merged, and the next writer uses the one with the
  smaller hash; where forks follow forks, each goes to the smaller hash, from the genesis on. No sequencer is needed.
- A Doc nobody writes is never rotated: nothing new in it is left to protect.
- Nothing is re-encrypted. A rotation seals a new key for what is written next; bytes at rest keep the key they were
  sealed with.
- A write uses an epoch no older than any in what it builds on. Readers check only that: a malicious writer can always
  leak what it writes, so the check is for honest but lagging code.

**What removal guarantees:**
- A removed reader can't open an epoch made after a writer has seen the removal: everything written in that Doc from
  then on, by every writer who knows.
- Writes made at the same time by writers who hadn't heard of it stay readable to the removed reader: they used the
  old epoch.
- What a reader read stays read. No cryptography stops a reader from passing on keys or plaintext it kept.
- Once no one holds a Doc's keys, no sealed copy of it is readable, a keeper's included.

**Decided:** D7, D13, D18, A43, L7, L21, caps rules 15 to 19 and 29, ledger 08:41  ·  **Lean:** `Aven.ID.KeyFormats` —
`name_ignores_stanzas`, `Epoch.ofValue_value`, `tagSeed`, `padded_ge`, `padded_min`, `padded_le`;
`Aven.ID.AccessRecords` — `EpochRecord.ofValue?_value`; `Aven.ID.Epochs` — `confidential`, `unknowable`,
`removal_next_epoch`, `stale_refused`, `authority_down`, `never_above`; `Aven.ID.Forget` — `rotation_shuts_out`,
`forgotten`, `copied_stays`

## The keyring

The keyring is a vault's own Doc of keys, and the only Doc sealed to devices. It holds the vault key, which opens
everything sealed to the vault, so adding a device is one seal, and a device then opens everything its vault can.

- **A Doc of avenID's built-in type `keyring`.** Its Records are `epoch` Records of scope `keyring`, written once as
  every epoch Record is ([epochs](#epochs)): a rotation writes epoch n + 1, its `prev` naming the epoch before, and a
  reseal, for a new device or passkey, writes another Record of the same epoch.
- **The current epoch** is the highest number reachable by `prev`, and at a fork the smaller name, as keepers choose.
- **Sealed to** the vault's devices, through their seal keys; each passkey's seal key; and MaiaCityGuardian's seal key
  while it is an owner. A coop's keyring is sealed to its owners' vault keys.
- **Born at sign-up,** on the real path: the vault's Peer-Light computes the first Record (epoch 1, no `prev`, no
  `back`, a fresh vault key inside, sealed to the device's seal key and the passkey's seal key, padded), and the Doc
  writer makes the keyring Doc and writes it. The vault's other devices sync it as any Doc.
- **Opening:** a device's or a passkey's seal key opens its stanza; that epoch's key opens the vault key; the vault
  key opens a Doc epoch's stanza, found by opening, or by its tag after a rotation.
- **It rotates** when a device or a sealing owner leaves: one seal per device that stays.
- **Pairing** covers a lost passkey, or a new device whose passkey can't answer: the new browser shows a QR code with a
  one-time X-Wing key, both screens show a short code, and once the person confirms, a device already in seals the
  keyring to it.
- The topic a vault's own devices gossip on comes from the keyring epoch's key ([avenPEERS](../peers/README.md)).

**Decided:** A43, D11, L4, L7, L19, L21, P5, caps rule 17  ·  **Lean:** `Aven.ID.KeyFormats` —
`Epoch.ofValue_value`; `Aven.ID.AccessRecords` — `EpochRecord.ofValue?_value`; `Aven.ID.Recover` — `guardian_exit`;
the keyring as a Doc pending on `claude/avenid-keys`, no PR yet: `Aven.ID.Keyring` — `reseal_name`, `reseal_joins`,
`stanzas_mono`, `shared_header`, `current_mem`

## The seal

One construction seals a Doc's loose envelopes, its segments and its checkpoints under the Doc's epoch key. A host
that can't open it sees only the Doc, the epoch and a padded length.

- **Kinds:** `envelope`, `segment`, and `snapshot` for a checkpoint.
- **Keys:** from the epoch's 32-byte key, `derive_key("avenDB <kind> 1")` is the cipher's key and
  `derive_key("avenDB <kind> commit 1")` the commitment's, so no two kinds share a key.
- **Nonce:** 24 random bytes, XChaCha20-Poly1305's.
- **AAD:** `encode({doc, kind, epoch})`, binding the ciphertext to its Doc, its kind and its epoch.
- **Commitment:** the commitment key's keyed BLAKE3 over `encode({aad, nonce})`. A reader checks it in constant time
  before it decrypts, so a sealed thing opens under one key only.
- **Plaintext:** padded before sealing, a `0x80` byte and then zeros, to Padmé's length of its length plus one.
- **Outside:** `encode({ct, doc, epoch, nonce, commit})`, and nothing else. The signer, its writer id and counters,
  the previous segment and the branch are all inside, so sealed sender holds up to the upload: stored bytes and
  forwarding peers never show the signer.
- **Its kind is found by commitment.** A reader computes each kind's commitment over `{aad, nonce}`, takes the one
  that matches and refuses one matching none, before it decrypts; at most one matches. A keeper never carries a kind,
  and an item a keeper serves opens only as a loose envelope or a segment.
- **What else an epoch key derives** is its owner's: a Doc's fetch keys (`avenDB fetch key 1`,
  [avenCAPS](../caps/README.md)) and a group's gossip topic (`avenDB topic 1`, [avenPEERS](../peers/README.md)).

**Decided:** A43, A45, D13, D18, L17, L23, caps rule 23  ·  **Lean:** `Aven.ID.Seal` — `unpad_pad`, `open_seal`,
`open_checks_commit` (`seals.json`); `Aven.ID.Epochs` — `keeper_blind`, `outside_blind`; the kind by commitment
pending on `claude/aven-docs`, no PR yet: `kind_by_commit`, `kindOf_sound`, `kindOf_complete`, `kindOf_seal`

## Padding

Every size a host sees is padded with one Padmé (PURBs). A length keeps its ⌊log₂ ⌊log₂ l⌋⌋ + 1 most significant bits
and rounds the rest up, so it leaks O(log log l) bits and grows by at most an eighth, about 12 %. Below 8 it changes
nothing; 9 becomes 10, 17 becomes 18, 129 becomes 144 and 1000 becomes 1024. A padded length pads to itself.

There is one definition for every use: the seal's plaintext, in bytes, and an epoch's stanza list, in entries, with
its floor of four.

**Decided:** D18, ledger 09:34  ·  **Lean:** `Aven.ID.Padme` — `padme_ge`, `padme_le`

## The heal

A stolen key is healed by an act, not by time.

- **No forward secrecy for kept data.** A Doc's history must stay readable to its readers and their new devices, so
  its old keys are kept, and the newest opens the past. Live changes close into segments under the same key, so a
  ratchet on the live channel would add nothing. Forward secrecy exists only for what is never kept, such as presence,
  typing and calls.
- **The heal,** after a stolen key:
  1. the owners remove the device;
  2. the remaining devices make new device keys;
  3. the keyring rotates, with a new vault key, new tag seeds and new letterbox keys;
  4. every group the vault is in rotates;
  5. each Doc rotates at its next use.

  It costs one rotation per group, in the background, busiest first.
- **When:** device keys rotate monthly by themselves; the full heal runs on suspicion and whenever a device is removed;
  a scheduled full heal for everyone waits for `tree 1`, since with flat groups each heal re-keys every group its person
  is in.
- Without a heal, a key copied in silence stays good, as in every encrypted store.

**Decided:** D19, caps rule 15  ·  **Lean:** `Aven.ID.Epochs` — `heal_evicts`

## The safe

A vault's safe holds its secrets: its device's keys, its vault's keys, its groups' keys, the Doc keys it has learned,
and later passwords, API tokens and other services' credentials. A passkey's owner key isn't among them: it is derived
for each act. The safe works like a password manager, except that its secrets are never handed out.

- **A Doc of avenID's built-in type `safe`,** sealed with its own key and synced like any Doc. It opens only inside a
  **safe runtime**, each host's protected place: it is sealed to each device's safe-runtime key, which never leaves
  its runtime, so sync carries only ciphertext. Adding a device seals the safe to the new device's safe runtime.
- **Secrets never leave a safe runtime.** Everything else holds handles and asks it to act: `unlock`, `lock`, `sign`,
  `open`, `seal`, `derive`, `use` (a credential, for an operation) and `enroll` (seal the safe to a new device). What
  comes out is signatures, ciphertexts, public keys and answers.
- **Unlocking is the safe runtime's:** biometrics, the passkey's PRF, or a timeout. A sensitive act can ask for an
  approval.
- **Actors and agents use secrets without holding them.** The safe acts only when unlocked, and only on a `tell` cap
  that names the act, which it checks again before it acts. An agent can call a bank's API with a token it never sees.
- **Doc keys may be lent to the engine,** in memory, to decrypt quickly, and are wiped when the Doc closes. Identity,
  vault and safe keys never are. A host may keep even Doc keys inside its safe runtime.

**One interface, a backend per host:**

| Host | Safe runtime | Strength |
|---|---|---|
| Mac and iOS app | A separate process, its keys in the Secure Enclave or wrapped by it, unlocked with Face ID or Touch ID | Strong |
| Android | Keystore, with StrongBox or the TEE | Strong |
| Windows | The TPM, through Windows Hello | Strong |
| An always-on Peer | A separate process, its keys sealed at rest; a hardware security module later | Medium |
| A browser (the Peer-Light) | The Peer-Light's own worker on its own origin, never avenOS's page; keys at rest wrapped with a WebCrypto key that can't be exported; a strict Content-Security-Policy and no third-party scripts; unlocked by the passkey's PRF | Weakest, but apart from every app's page |

**Its limits:**
- The browser tier guards only against other pages' code: a bug on the Peer-Light's own origin can use the keys while
  it is unlocked.
- A compromised operating system beats any app.
- An enclave runs only the algorithms it supports. Where ours aren't among them, it guards a wrapping key, and our keys
  are used only inside the safe runtime's process.
- Changed code served from the safe's own origin would run with its keys, so releases are signed (A15). In the browser
  that raises the bar without closing it; the Mac app, which checks signatures before it runs new code, is the trusted
  path.

**Decided:** D17, A15, A42, rule 13, caps rule 34  ·  **Lean:** `Aven.ID.Safe` — `safe_holds`, `stays_inside`,
`enroll_admitted`, `kept_inside`, `acts_on_cap`, `locked_refuses` (`safe.json`)

## Built-in types

avenID's built-in types are `keyring` and `safe`, the root types of the Docs it makes, and `epoch`, the type of an
epoch Record. Each is named by Core's `builtinType` in avenID's namespace, the hash of the label `avenID <name> 1`, so
every reader knows them without fetching anything. Each is a type Doc, whose own type is the type of types, and a
Record of type `epoch` fits only as an epoch Record's one form.

**Decided:** A39, A45  ·  **Lean:** `Aven.ID.Types` — `builtin_typed`; `Aven.ID.AccessRecords` — `idBuiltinFit`

## Status

| Concept | Lean | Rust and TS | Open |
|---|---|---|---|
| Hybrid signatures | `Aven.Core.Hybrid` (#1680) | aven-id `hybrid.rs`, as aven-core's `Verify`; Ed25519 verified strictly (#1680) | |
| Vaults, owners, governing | `Tree`, `WF`, `Check`, `Governs`, `Query`, `Correct`, `Name`; `VaultName` (#1738) | aven-id `tree.rs`, `vault_name.rs` (#1738) | Vault ids are text in `Tree`. `Tree`'s ids, avenCORE's `Target`, `Facts` and `TargetCbor`, avenCAPS and the register switch to the name from the genesis in one step (L15) |
| Approvals, k of n | `Approve` | aven-id `caps/approve.rs` | Stage 4, the tree as the first Doc: `threshold` on each vault with k ≥ 1 in `WF`, the owner-change op, its one-winner settling and `removal_beats`. `Approve`'s own `Sig {key, digest}` gives way to Core's `Sig`. `Recover`'s `settleRemovals` (`never_ownerless`, `removals_win`) states a clash rule this page doesn't have, and goes with the owner-change op |
| Devices | `KeyFormats` `deviceMlDsaSeed`, `deviceSealSeed` (#1731) | `HybridKey::from_device_seed`, `device_ml_dsa_seed`, `device_seal_key`; Peer-Light `deviceHybrid()`, `deviceSeal()`; Peer `keys::hybrid_public`, `seal_public` (#1731) | `device_hybrid_bound`: the sign-in names the device's hybrid public half under its owner's approval (stage 4). Segments close only once it holds. Monthly rotation isn't built |
| Passkeys and the PRF step | `Passkey`, `KeyFormats` (#1680, #1700); the passkey record and `ownerless_only_adds_owner` in `Network` (#1718) | aven-id `prf.rs`, `passkey.rs`; Peer-Light `prfKeys`, `ownerSign`; avenOS's ceremonies and the refusal without PRF (#1700) | The owner key's signature beside the passkey's on the register's claim and sign-in (stage 4); `ownerSign` has no caller yet |
| MaiaCityGuardian | `Recover` `guardian_exit`; the guardian's vault in `Network`'s genesis | | The exit isn't built. `Network`'s `GuardianKeys` text says every claim names the guardian's keys; a claim names its vault |
| Seal keys, stanzas, epochs, padding | `KeyFormats`, `Padme`, `Epochs`, `Forget` (#1680, #1724) | aven-id `seal.rs`, `epoch.rs`, `padme.rs` (#1680, #1724) | |
| Epoch Records | `AccessRecords` (#1716) | aven-id caps `EpochRecord` (#1716) | |
| The keyring | Its epochs in `KeyFormats`; `Keyring` on `claude/avenid-keys`, no PR yet | `Epoch::keyring`, `rotate_keyring` in aven-id; aven-id `keyring.rs` and the Peer-Light's `keyringGenesis` on `claude/avenid-keys` | Making the keyring Doc and writing and syncing its Records is stage 3's ("Docs in the Peers", L21). aven-id's `Epoch::reseal` and `KeyFormats`' text reseal in place, adding a stanza to the epoch; a reseal is a new Record (L21). Pairing isn't built |
| The seal | `Seal` (#1694); the kind by commitment on `claude/aven-docs`, no PR yet | aven-db-docs `seal.rs`, with its own Padmé (#1694); `seal::kind_of` on `claude/aven-docs` | The seal is avenID's (A45): its Rust moves into aven-id, and aven-db-docs drops its Padmé |
| The heal | `Epochs` `heal_evicts` | | Not built |
| The safe | `Safe` | aven-id `safe.rs`, held to `safe.json` | No safe runtime yet: the Peer-Light's own-origin worker comes first, native ones with the Mac app. `safe.json` tags its unions with `kind`, which is only a vault's (A1). The safe's own spec, `aven/DB2/id/safe`, comes with its milestone |
| Built-in types | `Types`, `AccessRecords` (#1716) | aven-id `caps/types.rs` | `Types` also names avenCAPS's `group`, `collection`, `cap` and `revoke` until the split |
| The package | `id/spec` also holds avenCAPS's Lean (`Caps`, `Revoke`, `Keep`, `Network` and the rest) and avenPEERS' (`Records`' wire version and presence, `Node`, `CatchUp`) | aven-id also holds avenCAPS's `caps` and `keep` modules, and production's text statements (`claim.rs`, `network.rs`, `members.rs`, `invite.rs`, `statements.rs`, `sign.rs`) | The split: `caps/spec` (`Aven.Caps`) and crate aven-caps, planned by the caps Lean thread (L10, L11); the Peers' Lean into `peer/spec` (A45); production's text statements go at the cutover |
| Later | | | `tree 1`, once Maia City passes about 150 members; recovery owners with a delay; the recovery kit; a scheduled heal for everyone |

## Open questions

- **How live messages are padded.** D18 rounds live messages up to 256 B, 1 KiB or 4 KiB and uses Padmé above that;
  the seal pads every loose envelope with the one Padmé. One of them goes. The architect decides, with Samuel, whose
  D18 is.
- **The seal's word "kind" and a checkpoint's label.** "Kind" is only a vault's (A1), and what travels is a
  checkpoint, never a snapshot, while the seal says `kind` in its AAD and `avenDB snapshot 1` for a checkpoint.
  Renaming changes `seals.json` and every sealed byte's AAD, so it is free only while nothing stored uses it. The
  architect decides.
- **What owns a device's vault.** Rule 15 says a device's vault is owned by its key and by the vault it serves; the
  Lean has the vault it serves as its one owner, and its key owning nothing (`WF`, `device_key_governs_nothing`). This
  page follows the Lean. The architect decides.

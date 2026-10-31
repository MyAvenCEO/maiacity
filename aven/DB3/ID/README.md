# avenID, from first principles

avenID answers one question: **who is acting?** We build it one concept at a time. A concept enters only when
the ones before it are settled and something needs it. Each step states what the concept is, its smallest useful
version (MVP), and what it leaves out on purpose.

Step 1 has two concepts: **signers** and **vaults**. Nothing else exists yet: no devices, passkeys, keyrings,
encryption, caps, owners or thresholds.

## 1. Signer

A **signer** is a secret key that can sign. Everyone else knows it only by its public key.

- **A signature** proves that the holder of one secret key approved exactly these bytes. Change a byte and it no
  longer verifies.
- **A signer has no rights of its own.** It can prove "this key signed this", nothing more. What that signature counts
  for is decided by the vault it signs for.

**MVP**
- One algorithm: Ed25519.
- A signer is named by its public key: 32 bytes.
- `sign(secret, bytes) → signature` (64 bytes) and `verify(public key, bytes, signature) → yes / no`. Verification
  is strict: one valid encoding per key and signature.

**Not yet:** post-quantum signatures, where the secret key lives, and how a person gets one (passkeys, devices).

## 2. Vault

A **vault** is an identity that lasts. It is who a person, a group or an app *is*. A signer is only how the vault
acts. A vault is what owns things and what others refer to.

- **A vault has a name that never changes.** It doesn't change even if, later, its signers do.
- **An act counts for a vault** when a signer of that vault signed it.

**MVP**
- A vault has exactly **one signer**.
- Its name is 32 bytes, made at its **birth**.
- An act counts for the vault when the vault's signer signed its bytes.

**Not yet:** more than one signer, changing signers, kinds of vault, vaults owning vaults.

## Open questions for step 1

1. **How is a vault's name made?**
   - (a) From its birth: the hash of `{signer, nonce}`. The name then commits to its first signer, so anyone can check
     who founded a vault from the name alone.
   - (b) 32 random bytes, tied to nothing.

   Recommended: (a).
2. **Is a vault's signer fixed for good in the MVP?** Recommended: yes. Changing signers is its own later step.
3. **Ed25519 alone for now, with each signature naming its algorithm,** so post-quantum signatures can be added later
   without a redesign? Recommended: yes.

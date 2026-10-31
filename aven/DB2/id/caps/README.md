# `id`: avenID and avenCAPS

`aven/DB2/id` holds two packages until their code splits: **avenID**, who is who (keys and signatures, sealing, vaults
and their owners), and **avenCAPS**, who may do what (caps, keep caps and offers, the reader's verdict, and Maia City's
register, `tree/1`). Their Lean is `Aven.ID` in `id/spec`, and their Rust is the `aven-id` crate in `id/core`.
Where each caps rule came from is in [`research.md`](research.md).

Its architecture: [avenID](../../brain/id/README.md) and [avenCAPS](../../brain/caps/README.md).

## Build and test

- `lake build` in the box proves `Aven.ID` (`id/spec`, Lean 4.35.0, core only, no `sorry`) and checks every example.
- `lake exe vectors` exports the examples with generated cases into `id/spec/vectors/`.
- `aven-id-model` answers the same cases a backend's property tests draw (`Aven.ID.CapsModel`).
- `cargo test -p aven-id` (in `aven/DB2`) runs the Rust tests, which replay the vectors.

## Files

**Lean modules** (`id/spec/Aven/ID/`); which package each concept belongs to is on its page:

| Module |
|---|
| `CapsCbor` |
| `Authorized` |
| `Member` |
| `Caps` |
| `Types` |
| `Collections` |
| `Holdings` |
| `Keeping` |
| `Approve` |
| `Revoke` |
| `Epochs` |
| `Expiry` |
| `Recover` |
| `Network` |
| `Restore`, `Records` (avenPEER) |
| `Keep` |
| `SealedIndex`, moving to `Aven.Architecture.Sealed` (the docs thread) |
| `Safe` |

**Vectors** (`id/spec/vectors/`):

| File | What |
|---|---|
| `caps.json` | Chains on the cast, their lines of ops in Core's form (A32), each cap with its CBOR bytes, its id and the bytes its device signs, and each chain with the first rule it breaks or none; who keeps a Doc; how avenOS shows a cap; 40 generated chains |
| `authorized.json` | An envelope's signer, Doc and branch, its calls (a merge into main's whole calls) and the chain it names, with what the reader knows: its context, each signing key's vault, each device's cap and the network's members; each check's verdict, the path (own or chain) and the first check that refuses it: own authority, chains in and out of their bounds, a device cap for proposals, an actor host with and without its actor, and merges read whole |
| `collections.json` | A collection's envelopes, the Docs a reader knows, who signs for and governs which vault, and whether it lists a Doc: removals, strangers, reach, nesting and the depth (A32) |
| `revocations.json` | Docs of Core envelopes, each with its name and what caps reads of it, the revocations held, and verdicts: hand-written, and 30 generated Docs with every envelope's verdict |
| `epochs.json` | Who learns which key after Bob's removal and after Alice's heal, and what Bob learns holding Maia City's `below` group |
| `safe.json` | Requests to Alice's safe from her agent and from Mallory, on her Mac and on a host that keeps Doc keys inside, with what each gives back |
| `approvals.json` | Signatures, thresholds and digests on the cast, and whether each approval holds; approvals where an owner is a vault, with a coop of two vaults added |
| `issuers.json` | Chains on the cast with the garden, a coop Alice and Bob own whose quorum each case gives, and its helper: a root over a coop's Docs needs the coop's own owners, a vault without devices issues by its owners' approval alone, an attenuation with no device needs its holder's owners, and Maia City's confirm cap (A28, A38). The context writes the tree out and gives per-vault quorums |
| `expiry.json` | Writes under a cap that expires, with each envelope's signed time, and whether each counts for the clock |
| `network.json` | A ticket's claims in two orders (A12), removals that clash, MaiaCityGuardian's exit |
| `keep.json` | Fetch-key links in the order they came, with the keys a keeper takes, its current key and its flags; proofs and whether they're served; what each vault pays; what a keeper keeps under the keep caps it holds and its own offers (A44); how much each vault may keep, by those offers, and the uploads admitted within it; 30 generated keepers |

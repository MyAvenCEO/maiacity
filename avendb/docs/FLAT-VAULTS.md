# Flat vaults: caps on any slice, a key per entry

Samuel's ask (2026-10-09): no spaces. A vault is a flat library of entries, and caps grant relay, read, write or owner
on any slice of it: the whole vault, one entry, a type ("all todos"), a tag, an author, or any AND/OR of those, so
groups are never hard-coded, only ever what caps select. Every entry has its own key; least access is the default; the
caps also decide which devices sync what; keys rotate as effects of signed edits, as signals drive effects. The
research behind it is `/mnt/project-files/sync-research/reports/E2E database dynamic caps and keys.md` ("Compile caps
into cells, not Biscuits"). This file is the design the Lean model (`spec/`) and the Rust core build against.

## What stays

Vaults and their three kinds, governance (owners, threshold, the passkey as root, devices), acting through `via`
chains, strong removal, the one replay order, Loro items with lenses, proposals and history, per-log frontier sync
with forks, linking by passkey, the claim of the server, X25519MLKEM768 on every connection, SHA-3 for every hash of
ours, X-Wing and Classic McEliece in every sealed box (Samuel's Full hardening; see "Keys"), the server as avenCEO's
device that only ever relays ciphertext.

## What goes

Spaces, `FoundSpace`, `Grant` on a space or an entry, space and entry key families, the space log, per-entry
checkpoints, per-space schema lanes. The page's Spaces view. `avendb-web` (the old simulated tile, no longer on the
page). The server's data starts fresh when this ships (Samuel's "Start fresh", 19:39).

## Entries

An entry belongs to one vault and is named by 32 random bytes its creator draws. Its first write creates it and
carries its **header**, which never changes: its `type` (a symbol: `note`, `todo`, `profile`, `device`, …), its
`author` (the vault the creating device acted for), when it was `created` (as its creator says), and, for a variant,
the entry it came from. Its **tags** are a set of symbols that writes change by deltas (`add`, `remove`), applied in
replay order. Header and tags travel inside the encrypted body of the write, beside the Loro update, so no relay ever
sees a type or a tag:

```
body plaintext = Envelope { header: Option<Header>, tags: Option<TagDelta>, update: Loro bytes }
Header         = { type: Sym, created: u64, variant_of: Option<EntryId> }
TagDelta       = { add: [Sym], remove: [Sym] }
```

A tag delta counts only from a writer allowed to relabel those tags: a device acting for the vault, or a vault whose
cap names the tags in its `relabel` set and whose slice holds the entry before and after (see "Caps").

## Caps

A cap is an edit in the log of its own (`LogId::Cap`), issued by a vault acting through `via`:

```
Cap { over: VaultId, grantee: Vault(VaultId) | Public, role: relay < read < write < owner,
      wide: bool,                      -- selects the whole vault (selector `all`), in the clear
      select: SealedSelector,          -- the selector, sealed to `over` and the grantee (in the clear for Public)
      relabel: [Sym] (sealed with it), parent: Option<CapId>, issuer: VaultId, nonce: u64 }
Revoke { cap: CapId, actor: VaultId, keep: [EditId], via }
```

- **Selectors** (`select`), a deliberately small grammar, so that containment and matching stay linear:
  `all | conj ("or" conj)*` with at most 8 disjuncts, each a conjunction of at most 16 atoms: `type ==/in`,
  `author ==/in`, `entry in` (at most 1,000 ids), `created in [t1, t2)`, `tag has SYM`, `tag has_none SET`,
  `tags within SET`. Type, author, entry and created never change; tags do. "All todos of xyz" is
  `type == todo, author == xyz`, or `type == todo, tag has xyz` for a project label; one note is `entry in {e}`.
- **Roles.** Relay holds no key: it stores and forwards the slice's ciphertext (the server). Read holds the slice's
  keys. Write also writes the slice's entries and creates entries in it. Owner also issues caps on the slice to others
  (delegation) and is governance: issuing or revoking an owner cap takes the issuer's approval (its root, or its
  threshold of owners).
- **Delegation.** A cap with a `parent` is issued by the parent's grantee, and only from an owner cap. Its effective
  slice is the AND of every selector up its chain, its role the lowest, its relabel set the intersection, so a link
  that claims more than its parent gains nothing. A root cap (no parent) is issued by the vault it is over.
- **Public** gets read alone (T8). Caps name vaults or Public, never signers (T4). A device is never a grantee: a cap to
  a vault reaches its devices, and a new phone needs no new cap.
- **Revocation** ends the cap and every cap resting on it. The issuer, `over` itself, or whoever may revoke a cap
  higher up the chain may revoke it. It is a removal: it cuts what it hadn't seen and relied on the cap (T16).
- The selector is sealed (X-Wing + McEliece, like every sealed box) to `over`'s vault key and to the grantee's, so only
  the vault's stewards and the grantee read it. Relays see who holds which role and nothing of what it selects.

## Cells

Nothing groups entries but the caps that select them. A vault's **cells** are the sets of its entries that the same
caps select; the cell is the one unit of keys, sync and rotation.

- **Semantic cell** (`cell_of`): the sorted ids of the vault's live caps that are not `wide` and whose effective slice
  holds the entry. Wide caps cover every cell, so they never split one: avenCEO's relay cap and "share everything" add
  nothing per entry.
- **Assignment.** Every entry is assigned a cell, a sorted list of cap ids (its signature), named on the wire by its
  hash, `CellId = H(vault, signature)`. Only the assignment is in the clear: relays route by it, every peer checks
  writes against it, and none needs a selector, a type or a tag.
- **Who assigns.** A device acting for the vault (a **steward**: it holds the vault master key, reads every selector
  and every entry) assigns an entry's semantic cell as it creates it, and moves it whenever its semantic cell changes:
  `Move { entry, to: signature, keep }` (a tag changed, a new cap selects part of a cell). Only devices acting for the
  vault steward; a vault holding a wide owner cap reads everything but assigns nothing. Moves are removals: a write the
  move hadn't seen that relied on the old assignment is cut, so nobody backdates an edit into an entry after it left
  their slice.
- **Revoked caps stay put.** Only the live part of a signature has to equal the semantic cell; a revoked cap in it
  is ignored, so a revocation moves no entry: the cells it was in move on to a new generation whose key only their
  remaining caps get. An entry that moves for another reason drops the revoked caps from its new signature.
- **Intake.** A writer that is not a steward can't compute cells (it sees no other cap). It creates an entry in its
  cap's **intake cell**, the signature of its cap's chain, readable only by that chain's grantees and the stewards;
  a steward later moves it to its semantic cell, or leaves it there if the header lies outside the writer's slice.
- **Writes** (the operational rule every peer applies, relays included): a write by a device acting for the vault is
  authorized for any cell of the vault. Any other write is authorized when its actor holds a live cap with write or
  more that is wide or in the entry's assigned signature, and names a cell the entry has been assigned at some point;
  a creation names the intake cell of such a cap.
- **Theorem.** When every assignment equals the semantic cell, the operational rule allows exactly the writes the caps'
  selectors allow (compile = meaning). Stewards keep assignments equal (see "Effects").

## Keys

Derive inside the owner domain, wrap only across a trust boundary. Every key is 32 secret bytes; `kid = H(key)`
names it; every box and every write carries the kid of the key it uses, so a reader checks the key it derived or
unwrapped (no invisible salamanders).

| Key | What it is | How a holder gets it |
|---|---|---|
| Device key | per device, derived from its passkey's PRF output as today; its X-Wing + McEliece pair | made again at each unlock |
| Vault seed `S(V, g)` | random, per vault per generation; its pair is the vault key `VEK`; `VMK = KDF(S, "vault master key")` | sealed to `V`'s devices, to its owner vaults' seeds, and to its passkeys' recovery keys |
| Cap key `CEK(C, e)` | `KDF(VMK, cap ‖ epoch)`, caps with read or more | sealed to the grantee's vault key; published for Public |
| Cell key `CK(X, g)` | `KDF(VMK, cell ‖ generation)` | wrapped under the cap key of each live read cap of `X` and of each wide read cap |
| Entry key `EK(e, X, g)` | `KDF(CK(X, g), entry)` | derived; a move wraps the old one under the new one |

- **Seals** (X-Wing + McEliece, sealed boxes) only cross trust boundaries, all at vault level: device ⇄ vault seed,
  vault seed ⇄ owner vault seeds, passkey recovery, cap key → grantee vault, selectors. Everything else is a
  deterministic symmetric wrap (XChaCha20-Poly1305 with a nonce derived from the record's ids), so two stewards that
  rotate the same way emit the same bytes.
- **History links.** `CK(X, g)` wraps `CK(X, g')` of the generation before (a cell link); a move from `X` to `Y` wraps
  `EK(e, X, g)` under `EK(e, Y, g_Y)` for every cell and generation the entry's writes used (a move link). So whoever
  reads an entry now reads its whole history (H1), and nothing of an entry it can't read now.
- **Epochs and generations** start at 0 and move on when a key goes stale (someone who could open it may no longer:
  a removed device, a removed owner, a revoked cap), as `staleKeys` finds them today. A real derived key mixes in the
  ids of the removals that moved its family on, in replay order, so two devices that saw different removals never
  derive the same key for different audiences, and two that saw the same ones derive the same key.
- **What rotates on what** (all bounded, nothing per entry but moves):

| Trigger | Work |
|---|---|
| A cap is issued to a vault, or a vault gains a device | one seal (cap key to the grantee; the vault seed to the device) |
| A cap is revoked | each cell it covered (every cell, for a wide cap) moves to a new generation: one wrap per remaining read cap and one cell link |
| A grantee vault loses a device or an owner | its seed moves on; the cap keys sealed to it and their cells move on (seals + wraps) |
| A steward device is lost | the vault seed moves on, so every cap key and cell key changes (O(caps + cells) records) |
| An entry's tags change, a new cap selects part of a cell | one move per entry, with its move link |

- The abstract schedule (`State::seals`, the model's `sealAll`) says what may open what; a `Keys` edit carries real
  boxes and a peer accepts it only if each is a seal of the schedule (T5, T6), as today.
- **McEliece.** Every sealed box keeps its McEliece share (Full hardening), and there are now only vault-level seals.
  Samuel was asked on a card (2026-10-09 21:01) whether to keep it; until he answers it stays. A vault's McEliece
  pair is made once per seed generation, never at every unlock.

## Effects (stewards)

Signed edits are the sources; covers, cells and reach are derived views; the only effects are signed edits, made by
stewards (devices acting for the vault) as an honest app's upkeep after each batch it takes in:

1. decrypt every cap's selector and every entry's header and tags; work out each entry's semantic cell;
2. move every entry whose signature's live part differs from its semantic cell;
3. seal and wrap every key the schedule names that has no box yet (vault seeds, cap keys, cell keys, links).

- **Rule A**: whoever revokes, removes or moves does the work in the same batch.
- **Rule B**: a writer encrypts under the newest generation its view knows (T15).
- **Rule C**: work nobody did (a grantee lost a device; a non-steward created an entry) falls to any steward, which
  does it as it next syncs. Two stewards doing the same work emit the same moves and the same derived wraps; only
  their sealed boxes differ, and both open to the same key.
- **Rule D**: before writing, a device does its pending upkeep.

Upkeep is level-triggered: desired minus actual, recomputed from the edits after every batch and at start, so a crash
loses nothing and a duplicate costs only bytes.

## Checkpoints

A device's edits carry its classical signature (ed25519) alone. A device vouches for all its own edits since its last
checkpoint in one `Checkpoint { covers }`, signed with SLH-DSA too, before each sync and after a short pause in
editing, rather than one checkpoint per write. A passkey still signs every edit it signs with SLH-DSA too (they are
few). Once a peer stops trusting the curves (post-quantum only, every node's mode), it counts an edit only if each of
its device signers' checkpoints covers it (T18). Checkpoints live in their device's own log, each building on the
last, so two from the same past are a fork.

## Logs and sync

Every edit belongs to one log: `Vault(v)` (governance, devices, its seeds' keys, its schema lane), `Cap(c)` (the
cap, its revocation, its cap keys), `Cell(v, X)` (its cell keys and links), `Entry(e)`
(writes, moves, move links), `Device(d)` (checkpoints). Frontier sync per log stays as it is (T19).

A peer sends device `d` (T12): for each entry `d` may receive (it acts for the vault, or for the grantee of a live cap
of relay or more that is wide or in the entry's signature, or a public cap is), the entry's log, the logs of every
cell it was ever assigned, of every cap in those signatures and of the vault's wide caps with their chains, and the
checkpoints that cover what it sends; the caps naming a vault `d` acts for and the revocations that took them away;
and the logs of the vaults those name, up their owners. Nothing else (T12); two devices that answered each other hold
the same edits for every entry both may receive (T13).

## Wire

Edit format version 5. Ids, signatures, sealed boxes, proposals, lenses and the session frames keep their encodings;
the actions change to: `Genesis`, `AddOwner`, `RemoveOwner`, `SetThreshold`, `AddDevice`, `RemoveDevice`,
`SetRoot` (as before); `Cap`, `Revoke`; `Write { vault, entry, actor, cell, epoch, deps, proposal, via, create, body }`
(`create` is the signature of a new entry's first cell); `Move`; `Keys { name, id, public, boxes, clear }`;
`Publish { vault, actor, via, blob }`; `Checkpoint { covers }`.

## Theorems

T2, T3, T21 (governance), T9 (lenses), T10 (proposals), T11 (convergence), T14 (causal closure), T19 (frontier sync)
and T20 (link card) keep their statements. Restated: T1 (authorized writes, by cells), T4 and T8 (caps), T5, T6, T7
and T15 (keys over seeds, cap keys, cell keys and entry keys), T12 and T13 (sync by cells), T16 (strong removal with
moves and cap chains), T17 (the schema lane per vault), T18 (batched checkpoints). New: T22 the effective slice is
the AND of its chain and matching a selector is its meaning; T23 when assignments equal semantic cells the operational
write rule is the semantic one; T24 a move or a link never hands a key to anyone the entry's current cell doesn't
entitle.

## Later

An incremental core (delta rules over Roaring bitmaps, checked against the replay as its oracle) once vaults reach tens
of thousands of entries; per-cell cursors, fingerprints and set reconciliation (negentropy) for sync; Merkle receipts
for checkpoints; padding; `since_grant` history; invitations; third-party approvals for k-of-n owner caps; caps that
expire on their own; random device keys kept wrapped, so unlocking makes no McEliece pair at all; whole-cell moves
(`MoveCell`, only ever to a narrower signature) to drop revoked caps from signatures that collected many.

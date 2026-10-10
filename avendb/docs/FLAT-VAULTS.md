# Flat vaults: caps on any slice, a key per entry

Samuel's ask (2026-10-09): no spaces. A vault is a flat library of entries, and caps grant relay, read, write or owner
on any slice of it: the whole vault, one entry, a type ("all todos"), a tag, an author, or any AND/OR of those, so
groups are never hard-coded, only ever what caps select. Every entry has its own key; least access is the default; the
caps also decide which devices sync what; keys rotate as effects of signed edits, as signals drive effects. The
research behind it is `/mnt/project-files/sync-research/reports/E2E database dynamic caps and keys.md` ("Compile caps
into cells, not Biscuits"). This file is the design as built: the Lean model (`spec/`, T1 to T25) and the Rust core
(`crates/avendb`) agree on it, held together by the shared vectors.

## What stays

Vaults and their three kinds, governance (owners, threshold, the passkey as root, devices), acting through `via`
chains, strong removal, the one replay order, Loro items with lenses, proposals and history, per-log frontier sync
with forks, per-entry checkpoints, linking by passkey, the claim of the server, X25519MLKEM768 on every connection,
SHA-3 for every hash of ours, X-Wing and Classic McEliece in every sealed box (Samuel kept the McEliece share on
2026-10-09, 21:46), the server as avenCEO's device that only ever relays ciphertext.

## What goes

Spaces, `FoundSpace`, `Grant` on a space or an entry, the space and entry key families, the space log, per-space
schema lanes. The page's Spaces view. `avendb-web` (the old simulated tile, no longer on the page). The server's data
starts fresh when this ships (Samuel's "Start fresh", 19:39).

## Entries

An entry belongs to one vault and is named by 32 random bytes its creator draws. Its first write creates it and
carries its **header**, which never changes: its `type` (a symbol: `note`, `todo`, `doc`, …) and when it was `created`
(as its creator says); its author is the vault the creating write acted for. Its **tags** are a set of symbols that
writes change by deltas (`add`, `remove`), applied in replay order. Header and tags travel inside the encrypted body of
a write, beside the Loro update, so no relay ever sees a type or a tag:

```
Body      = { header: Option<Header>, tags: TagDelta, answers: [EditId], content: Loro update | proposal name | nothing }
Header    = { type: Sym, created: u64 }
TagDelta  = { add: [Sym], remove: [Sym] }
```

A write's tag delta counts when it acts for the entry's vault, and a new entry's added tags are its first tags. Any
other writer's delta is an **ask**: the vault's stewards answer each ask in a write of their own that names it
(`answers`), granting the part the asker's caps let it ask for: those with write or more whose slice holds the entry
both before the whole ask and after it, each as far as the `relabel` set of every cap of its chain allows.

## Caps

A cap is an edit in a log of its own (`LogId::Cap`), issued by a vault acting through `via`:

```
Cap    { over: VaultId, grantee: Vault(VaultId) | Public, role: relay < read < write < owner,
         wide: bool,                     -- selects the whole vault (`Selector::All`), in the clear
         select: Select,                 -- its Slice { select, relabel }, sealed (in the clear for Public)
         parent: Option<CapId>, issuer: VaultId, nonce: u64 }
Revoke { cap: CapId, actor: VaultId, keep: [EditId], via }
```

- **Selectors**, a deliberately small grammar so that matching stays linear: `all`, or at most 8 conjunctions OR-ed,
  each of at most 16 tests: `type in`, `author in`, `entry in`, `created in [t1, t2)`, `tag has`, `tag has none of`,
  `tags within` (lists of at most 1,000). Type, author, entry and created never change; tags do. "All todos of xyz" is
  `type in {todo}, author in {xyz}`, or `type in {todo}, tag has xyz` for a project label; one note is `entry in {e}`.
- **Roles.** Relay holds no key: it stores and forwards the slice's ciphertext (the server). Read holds the slice's
  keys. Write also writes the slice's entries and creates entries through the cap. Owner also issues caps on the slice
  to others, and is governance: issuing an owner cap takes the issuer's approval (its root, or its threshold of owners).
- **Chains (T22).** A cap with a `parent` rests on a live owner cap over the same vault whose grantee is its issuer; a
  wide cap rests only on a wide one. What a chain selects is the AND of its selectors, its role the lowest along it,
  its relabel set the intersection, so a cap that claims more than its parent gains nothing. A root cap (no parent) is
  issued by the vault it is over.
- **Public** gets read alone (T8). Caps name vaults or Public, never signers (T4), nor the vault they are over. A
  device is never a grantee: a cap to a vault reaches its devices, and a new phone needs no new cap.
- **Revocation** ends the cap and every cap resting on it. The issuer, the vault the cap is over, the grantee giving it
  up, or whoever may revoke a cap up its chain may revoke it. It is a removal: it cuts what it hadn't seen and relied on
  the cap (T16).
- **Sealed selectors.** The slice is encrypted under a fresh selector key bound to the cap, and that key is boxed to
  the seed of the vault the cap is over (its stewards keep entries in their cells), of the grantee unless the cap only
  relays, and of the issuer where the issuing device holds or knows it. Relays see who holds which role and nothing of
  what it selects.

## Cells

Nothing groups entries but the caps that select them. A vault's **cells** are the sets of its entries that the same
caps select; the cell is the one unit of keys, sync and rotation.

- **Semantic cell** (`Meaning::cell`): the live caps over the vault that aren't `wide` and whose chain selects the
  entry, in canonical order. Wide caps reach every cell, so they never split one: avenCEO's relay cap and "share
  everything" add nothing per entry.
- **Assignment.** Every entry sits in a cell, a canonical list of cap ids, named on the wire by its hash,
  `CellId = H(vault, caps)`. Only the assignment is in the clear: relays route by it, every peer checks writes against
  it, and none needs a selector, a type or a tag (T25).
- **Stewards.** A device acting for the vault reads every selector and every entry. It creates an entry straight in its
  semantic cell, and moves it whenever its semantic cell changes: `Move { vault, entry, to, keep }` (a tag changed, a
  new cap selects it). Only devices acting for the vault steward; a vault holding a wide owner cap reads everything but
  moves nothing. Moves are removals: a write the move hadn't seen that relied on the old cell is cut, so nobody
  backdates an edit into an entry after it left their slice; a move that doesn't stand itself (its steward was removed
  from the vault meanwhile, say) cuts nothing. A device that never hears of the move (the entry left its reach) can
  still write by its own view; that write is dropped wherever the move is known.
- **Revoked caps stay put.** Only the live part of an entry's cell has to equal its semantic cell; a revoked cap in it
  is ignored, so a revocation moves no entry: the cells it was in move on to a new generation whose key only their
  remaining caps get. An entry that moves for another reason drops the revoked caps from its new cell.
- **Intake.** A writer that is not a steward can't work out cells (it reads no other cap). It creates an entry in its
  cap's **intake cell**, the caps of its cap's chain that aren't wide, readable only by that chain's grantees and the
  stewards. A steward then moves it to its semantic cell, or, when the creator made it outside its own slice (it isn't
  admitted), to the cell no cap of the creator's reaches.
- **Writes** (the operational rule every peer applies, relays included): a write acting for the entry's vault may go
  into any cell of the vault. Any other write needs its actor to hold a live cap with write or more, wide or in the
  cell the entry was in when the write was made; strong removal judges each write in that cell. A creation goes into
  the intake cell of such a cap.
- **T23.** Where an entry's live cell is its semantic cell, the operational rule allows exactly the writes the caps'
  selectors allow, and it never refuses a creation inside its creator's slice. The stewards keep cells equal to
  semantic cells (see "Effects").

## Keys

Derive inside the owner domain, wrap only across a trust boundary. Every key is 32 secret bytes; `kid = H(key)` names
it; every box and every write carries the kid of the key it uses, so a reader checks the key it unwrapped or derived.

| Family | What it is | Who gets it |
|---|---|---|
| Device key | per device, derived from its passkey's PRF output at each unlock; its X-Wing + McEliece pair | itself |
| Seed `Seed(V)` | random per epoch, with an X-Wing + McEliece pair, announced | sealed to V's devices and owner signers, and to the seeds of V's owner vaults |
| Cap key `Cap(V, C)` | random per epoch, caps with read or more | wrapped under V's seed, and boxed to the grantee's seed |
| Cell key `Cell(V, X)` | random per generation | wrapped under V's seed and under the key of each live cap with read or more that reaches X |
| Entry key `Entry(e, stay, g)` | `KDF(Cell(V, X) at g, e ‖ stay)`, X the cell of that stay | derived by whoever opens the cell key; a move wraps the keys of the entry's earlier stays under its new one |

- A family key is made by the first entitled device that needs it, and boxed for every target the schedule names:
  sealed (X-Wing + McEliece) to a signer or to a seed's announced public half, or wrapped (XChaCha20-Poly1305) under a
  key the boxing device holds. A cap's or a cell's key is boxed only by a device that holds it, in practice a steward.
- **History links.** Each epoch's key wraps the one before (a cell's under its next generation), and a move wraps the
  entry's earlier stay keys under the new stay's key (a move link). So whoever reads an entry now reads its whole
  history, and nothing of an entry it can't read now (T24).
- **Epochs and generations** start at 0 and move on when a key goes stale: someone who could open it may no longer (a
  removed device or owner, a revoked cap), or a family stops being public. A vault's cap and cell keys move on with its
  seed. Two devices that make a key for the same epoch at once each box their own; a name may then have two keys, and
  every write and box names the one it uses by its kid.
- **A cell that comes back into use.** A cell no entry is in isn't a family in use: its key doesn't move on with the
  removals while it is empty. The entry that brings it back into use moves it to a new generation, which the creation
  may name, so whoever a removal took out meanwhile, and who may still hold its old key, opens nothing new.
- **What rotates on what** (all bounded, nothing per entry but moves):

| Trigger | Work |
|---|---|
| A cap is issued to a vault, a vault gains a device | a few boxes (the cap key to the grantee; the seed to the device) |
| A cap is revoked | each cell it reached (every cell, for a wide cap) moves to a new generation, boxed to its remaining caps |
| A vault loses a device or an owner | its seed moves on, and with it its cap and cell keys in use; cap keys boxed to its seed move on, and their cells |
| An entry's tags change, a new cap selects it | one move, with its move link |
| An entry moves into an empty cell whose key was boxed before | the cell moves to a new generation |

- The abstract schedule (`State::seals`, the model's `sealAll`) says what may open what; a `Keys` edit carries real
  boxes, and a peer accepts it only if each is a seal of the schedule (T5, T6).

## Effects (stewards)

Signed edits are the sources; cells and reach are derived views; the only effects are signed edits, made by devices as
an honest app's upkeep after each batch they take in (`Lab::refresh`, up to ten rounds until nothing is left to do):

1. replay, open every key it may, read every body and selector it can;
2. make and box the keys its view calls for, wrap older epochs under newer ones, link the keys of moved entries;
3. as a steward, answer the tag asks no write acting for the vault answered yet, then move every entry whose live
   cell differs from its semantic cell (`Meaning::desired`), once no ask waits on it.

- A writer encrypts under its entry's stay key at the cell's newest generation its view knows (T15).
- Two stewards racing to move an entry are harmless: the second move is refused as a move to the cell the entry is in.
- Upkeep is level-triggered: desired minus actual, recomputed from the edits after every batch and at start, so a crash
  loses nothing and a duplicate costs only bytes.

## Checkpoints

A device's writes carry its classical signature (ed25519) alone; every other edit carries the hash-based half
(SLH-DSA) too. A device vouches for its own accepted writes of an entry in `Checkpoint { entry, covers }`, signed with
both. Once a peer stops trusting the curves (post-quantum only, every node's mode), it counts a write only if a
checkpoint by its own author covers it (T18).

## Logs and sync

Every edit belongs to one log: `Vault(v)` (governance, devices, its seed's keys, its schema lane), `Cap(c)` (the cap,
its revocation, its keys), `Cell(v, X)` (its keys), `Entry(e)` (writes, moves, checkpoints, entry keys and move links).
Frontier sync per log stays as it was (T19).

A peer sends device `d` (T12), by its own view: for each entry and cell `d` may receive (it acts for the vault, or for
the grantee of a live cap that is wide or in the cell, or a public cap reaches it), their logs; the logs of every cap
needed to check those (the caps of every cell such an entry was ever in, the vault's wide caps, the caps `d`'s vaults
hold or are over, and every cap those rest on); and the logs of every vault all that names, up their chains of owners.
Nothing else (T12): no other entry, no other cell. Two devices that answered each other hold the same edits for every
entry both may receive (T13). An entry that leaves a device's reach stops syncing to it.

## Wire

Edit format version 5. Ids, signatures, sealed boxes, proposals, lenses and the session frames keep their encodings;
the actions are: `Genesis`, `AddOwner`, `RemoveOwner`, `SetThreshold`, `AddDevice`, `RemoveDevice`, `SetRoot` (as
before); `Cap`, `Revoke`; `Write { vault, entry, actor, stay, generation, deps, proposal, via, create, body }` (`create`
names a new entry's first cell; `stay` is the move that put the entry in the cell the write is under, `None` for its
creation's); `Move { vault, entry, to, keep, via }`; `Keys { name, id, public, boxes, clear }`;
`Publish { vault, actor, via, blob }` (the vault's schema lane, by the vault or a wide owner cap: T17);
`Checkpoint { entry, covers }`. `Slice`, `Select` and `Body` are wire types of their own, inside sealed bytes.

## Theorems

T2, T3, T21 (governance), T9 (lenses), T10 (proposals), T11 (convergence), T14 (causal closure), T19 (frontier sync)
and T20 (link card) keep their statements. Restated for flat vaults: T1 (authorized writes and creations, by cells),
T4 and T8 (caps), T5, T6, T7 and T15 (keys over seeds, cap keys and cell keys), T12 and T13 (sync by cells), T16
(strong removal with moves and cap chains), T17 (the schema lane per vault), T18 (checkpoints). New: T22 a cap grants
no more than the caps it rests on; T23 cells mean what the caps say; T24 an entry's key reaches only its cell's
readers; T25 blind relays. All proven in `spec/` (see its README).

## Later

An incremental core (delta rules over Roaring bitmaps, checked against the replay as its oracle) once vaults reach tens
of thousands of entries; per-cell cursors, fingerprints and set reconciliation (negentropy) for sync; batched device
checkpoints; Merkle receipts for checkpoints; padding; variants that remember the entry they came from; `since_grant`
history; invitations; third-party approvals for k-of-n owner caps; caps that expire on their own; random device keys
kept wrapped, so unlocking makes no McEliece pair at all; whole-cell moves to drop revoked caps from cells that
collected many; a re-entry rule that moves a cell on only if a removal happened while it was empty.

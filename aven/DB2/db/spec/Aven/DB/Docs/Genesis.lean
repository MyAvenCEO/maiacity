import Aven.Core

/-!
# A Doc's genesis, and the built-in types (A30, A39; docs, "A Doc")

A Doc is born with a **genesis**, a Core Value `{pins, type, nonce, vault}`: exactly these keys, no defaults.
- `vault`: the vault the Doc belongs to;
- `type`: its root type, a type Doc (A39: no Doc is ever without one); a Doc never changes type;
- `pins`: the schema versions it accepts, per type: only user types, sorted by type with no type twice, each with its
  schema hashes sorted; the built-in types are never pinned;
- `nonce`: 32 random bytes, so two Docs born alike differ.

The Doc's id is the genesis's name by A30: the hash of `["avenDB genesis 1", genesis]`. The label is its version; it
carries no `by` and no signature of its own. The Doc's first envelope carries it (`Aven.DB.Docs.Body`), and that
envelope's signature and cap authorize it: a `core/1` `put` of the root Record on `vaultType(vault, type)` (A32).

The **built-in types** of the docs layer, `branch`, `closed`, `version` and `split`, are named as avenID's are
(`Aven.ID.builtinType`): the name of the label `avenDB <name> 1`. Each is versioned by its label; its shape is its Lean
structure, so it has no schema hash and is never pinned.

What it proves: `id_fixes`: two well-formed geneses with one id, under a hash nothing collides under, are one genesis,
so the vault and the root type are sealed into the Doc's name (docs, decision 13).
-/

namespace Aven.DB.Docs

open Aven.Core

private def k (s : String) : Bytes := s.toUTF8.toList

/-- `avenDB genesis 1`, spelled out so a proof can read it. -/
def genesisLabel : Bytes := [0x61, 0x76, 0x65, 0x6E, 0x44, 0x42, 0x20, 0x67, 0x65, 0x6E, 0x65, 0x73, 0x69, 0x73, 0x20, 0x31]

#guard genesisLabel = k "avenDB genesis 1"

structure Genesis where
  pins : List (DocId × List Hash)
  type : DocId
  nonce : Bytes
  vault : Bytes
  deriving DecidableEq, Repr

def Genesis.pinsValue (g : Genesis) : Value :=
  .array (g.pins.map fun (t, hs) => .array [.bytes t.hash.bytes, .array (hs.map Hash.value)])

/-- The genesis as a Value, its keys in the codec's order. -/
def Genesis.value (g : Genesis) : Value :=
  .map [(k "pins", g.pinsValue), (k "type", .bytes g.type.hash.bytes), (k "nonce", .bytes g.nonce),
    (k "vault", .bytes g.vault)]

/-- The Doc's id: the genesis's name (A30). -/
def Genesis.id (H : Bytes → Hash) (g : Genesis) : DocId := ⟨H (signingBytes genesisLabel g.value)⟩

/-- Well formed: a 32-byte nonce and type, pins sorted by type with no type twice, each pin's schemas sorted and
distinct, and none of them a built-in type. -/
def Genesis.ok (builtin : DocId → Bool) (g : Genesis) : Bool :=
  g.nonce.length == 32 && g.type.hash.ok && strictlySorted (g.pins.map (·.1.hash.bytes)) &&
    g.pins.all fun (t, hs) => t.hash.ok && !builtin t && !hs.isEmpty && hs.all Hash.ok &&
      strictlySorted (hs.map Hash.bytes)

#guard keysSorted [(k "pins", .null), (k "type", .null), (k "nonce", .null), (k "vault", .null)] = true

/-- Two well-formed geneses with one id are one genesis: what the id names can't be claimed by another. -/
theorem id_fixes {H : Bytes → Hash} (hH : Injective H) {g g' : Genesis} (hc : Canon g.value = true)
    (hc' : Canon g'.value = true) (h : g.id H = g'.id H) : g.value = g'.value := by
  have hl : textOk genesisLabel = true := by decide
  simp only [Genesis.id, DocId.mk.injEq] at h
  exact (signing_separates hl hl hc hc' (hH _ _ h)).2

/-! ## The built-in types -/

/-- A docs built-in type: the name of its label `avenDB <name> 1`, as avenID's built-in types are named. -/
def builtinType (H : Bytes → Hash) (name : String) : DocId := ⟨nameOf H (.text (k ("avenDB " ++ name ++ " 1")))⟩

def builtinNames : List String := ["branch", "closed", "version", "split"]

def isBuiltin (H : Bytes → Hash) (t : DocId) : Bool := builtinNames.any fun n => builtinType H n == t

#guard (typeOfTypes blake3 :: builtinNames.map (builtinType blake3)).Nodup

end Aven.DB.Docs

import Aven.Actor.Messaging

/-!
# An actor's address is its Doc id (A201)

An actor's address names a vault-scoped id and an incarnation, never a device. It is the id of the actor's Doc: the
hash of its genesis, which fixes the actor's vault (32 bytes), its id (the hash of its definition's name, its
spawner's address and the spawner's count) and its incarnation `n`. The genesis has no nonce, so a replay names the
same actors; caps target the actor by that Doc id (`.doc a .self`, `.doc a .spawned`) with no translation.

On the wire an address is `[vault, doc]`: the vault picks the carrier Doc (A33) without reading the genesis, and a
reader refuses an address whose vault isn't its genesis's. A cap naming `.doc a .self` binds one incarnation; a cap
meant to outlast incarnations targets `.spawned` or `.vaultDef`.

The kernel keys its actors by their genesis (`Addr`); `doc_inj` makes that the same as keying them by Doc id.
-/

namespace Aven.Actor

open Aven.Core (Value Bytes Hash DocId Injective encode Shape encode_inj_shape)

/-- An address the codec can write: a 32-byte vault, and an id and incarnation within the profile's limits. -/
def Addr.ok (a : Addr) : Bool :=
  a.vault.length == 32 && decide (a.id.length < Aven.Core.limit) && decide (a.n < Aven.Core.limit)

/-- The genesis's keys, `n`, `id` and `vault`, as their UTF-8 bytes. -/
def keyN : Bytes := [0x6E]
def keyId : Bytes := [0x69, 0x64]
def keyVault : Bytes := [0x76, 0x61, 0x75, 0x6C, 0x74]

/-- The genesis an actor's Doc is named by: `{n, id, vault}`, keys in the codec's order. -/
def Addr.genesis (a : Addr) : Value := .map [(keyN, .uint a.n), (keyId, .bytes a.id), (keyVault, .bytes a.vault)]

/-- The actor's address: its Doc's id, the hash of its genesis. -/
def Addr.doc (H : Bytes → Hash) (a : Addr) : DocId := ⟨H (encode a.genesis)⟩

/-- The address on the wire: `[vault, doc]`. -/
def Addr.wire (H : Bytes → Hash) (a : Addr) : Value := .array [.bytes a.vault, .bytes (a.doc H).hash.bytes]

theorem genesis_shape {a : Addr} (h : a.ok = true) : Shape a.genesis = true := by
  simp only [Addr.ok, Bool.and_eq_true, beq_iff_eq, decide_eq_true_eq] at h
  obtain ⟨⟨hv, hi⟩, hn⟩ := h
  simp [Addr.genesis, Shape, Aven.Core.ShapeMap, Aven.Core.keysSorted, Aven.Core.textOk, hv, hi, hn]
  decide

/-- One Doc id is one actor: when the hash is collision-free, two well-formed addresses with the same Doc id are the
same address. So an address is its Doc id. -/
theorem doc_inj {H : Bytes → Hash} (hH : Injective H) {a b : Addr} (ha : a.ok = true) (hb : b.ok = true)
    (h : a.doc H = b.doc H) : a = b := by
  have e : encode a.genesis = encode b.genesis := hH _ _ (congrArg DocId.hash h)
  have g := encode_inj_shape (genesis_shape ha) (genesis_shape hb) e
  cases a; cases b
  simp only [Addr.genesis, Value.map.injEq, List.cons.injEq, Prod.mk.injEq, Value.uint.injEq, Value.bytes.injEq,
    true_and, and_true] at g
  obtain ⟨rfl, rfl, rfl⟩ := g
  rfl

/-- A new incarnation is a new Doc id: the same id spawned again names another actor. -/
theorem incarnation_new_doc {H : Bytes → Hash} (hH : Injective H) {a b : Addr} (ha : a.ok = true) (hb : b.ok = true)
    (hn : a.n ≠ b.n) : a.doc H ≠ b.doc H := fun h => hn (congrArg Addr.n (doc_inj hH ha hb h))

end Aven.Actor

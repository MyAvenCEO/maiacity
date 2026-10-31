import Aven.Core
import Aven.ID.Tree

/-! # A vault's name (A30; rule 15)

Every vault is named by its own **genesis**: `{kind, nonce}`, its kind and 32 bytes drawn fresh at its founding (as a
Doc's genesis nonce is), signed into being by the statement that founds it. Its name is the A30 name of
`["avenID vault 1", genesis]`, the hash of exactly those bytes: 32 bytes, nothing else.

- **Stable:** the genesis holds nothing that ever changes. Owners change by later statements that name the vault, keys
  and owner epochs rotate, and the passkey's PRF input names no vault (A43), so none of it is in the name
  (`name_ignores_owners`). The founding statement isn't either: it carries the genesis, so the genesis can't carry its
  name.
- **One per vault:** a claim founds a person's vault and its claiming browser's device vault, each with its own
  genesis; the tree's root Record founds the network's own vaults (Maia City's coop, Aven's vault, the guardian's,
  fixed nonces in the cast); a sign-in founds the device vault it adds; a later vault is founded by its governing
  vault's statement. No role suffix and no second encoding.
- **Distinct:** under a hash nothing collides under, two geneses with one name are one genesis (`vaultName_inj`); the
  nonce keeps two vaults of one kind apart.
- **Strict:** a genesis reads back only with exactly its two keys, a kind of exactly `Kind`'s four (the guardian's
  vault is an `agent`), and a nonce of exactly 32 bytes (`Genesis.ofValue?`); an unknown kind is refused.

Display names ("Ada's vault") stay a field of the tree, apart from the name. -/

namespace Aven.ID.VaultName

open Aven.Core

def label : String := "avenID vault 1"
def nonceLen : Nat := 32

/-- A vault's genesis: what it is, and what makes it this one. -/
structure Genesis where
  kind : Kind
  nonce : Bytes
  deriving DecidableEq, Repr

def t (s : String) : Bytes := s.toUTF8.toList

/-! The bytes a proof reads, spelt out: the label, the keys and the four kinds. -/
def labelBytes : Bytes := [0x61, 0x76, 0x65, 0x6E, 0x49, 0x44, 0x20, 0x76, 0x61, 0x75, 0x6C, 0x74, 0x20, 0x31]
def keyKind : Bytes := [0x6B, 0x69, 0x6E, 0x64]
def keyNonce : Bytes := [0x6E, 0x6F, 0x6E, 0x63, 0x65]

/-- The kind as its genesis writes it: exactly these four. -/
def kindBytes : Kind → Bytes
  | .person => [0x70, 0x65, 0x72, 0x73, 0x6F, 0x6E]
  | .coop => [0x63, 0x6F, 0x6F, 0x70]
  | .agent => [0x61, 0x67, 0x65, 0x6E, 0x74]
  | .device => [0x64, 0x65, 0x76, 0x69, 0x63, 0x65]

#guard labelBytes = t label ∧ keyKind = t "kind" ∧ keyNonce = t "nonce"
#guard kindBytes .person = t "person" ∧ kindBytes .coop = t "coop" ∧ kindBytes .agent = t "agent" ∧
  kindBytes .device = t "device"

/-- Exactly those four, nothing else: an unknown kind is refused. -/
def kindOf? (b : Bytes) : Option Kind :=
  if b = kindBytes .person then some .person else if b = kindBytes .coop then some .coop
  else if b = kindBytes .agent then some .agent else if b = kindBytes .device then some .device else none

theorem kindOf_kindBytes (k : Kind) : kindOf? (kindBytes k) = some k := by
  cases k <;> decide

theorem kindBytes_inj {a b : Kind} (h : kindBytes a = kindBytes b) : a = b := by
  have := congrArg kindOf? h
  rwa [kindOf_kindBytes, kindOf_kindBytes, Option.some.injEq] at this

def Genesis.value (g : Genesis) : Value := .map [(keyKind, .text (kindBytes g.kind)), (keyNonce, .bytes g.nonce)]

/-- The name, under any hash: the hash of `["avenID vault 1", genesis]`, as a signed thing's name is (A30). -/
def nameWith (H : Bytes → Hash) (g : Genesis) : Hash := H (signingBytes labelBytes g.value)

/-- The name, under BLAKE3. -/
def vaultName (g : Genesis) : Hash := nameWith blake3 g

/-- A genesis the profile allows: a nonce of 32 bytes. -/
def Genesis.ok (g : Genesis) : Bool := g.nonce.length == nonceLen

theorem genesis_canon {g : Genesis} (h : g.ok = true) : Canon g.value = true := by
  simp only [Genesis.ok, beq_iff_eq, nonceLen] at h
  cases g with
  | mk kind nonce =>
    have base : (lexLt (keyBytes keyKind) (keyBytes keyNonce) && textOk keyKind && textOk keyNonce) = true := by decide
    have kt : textOk (kindBytes kind) = true := by cases kind <;> decide
    simp only [Bool.and_eq_true] at base
    simp_all [Genesis.value, Canon, Shape, ShapeMap, keysSorted, strictlySorted, depth, depthMap, limit, maxDepth]

/-- **Distinct geneses, distinct names**, under a hash nothing collides under. -/
theorem vaultName_inj {H : Bytes → Hash} (hH : Injective H) {a b : Genesis} (ha : a.ok = true) (hb : b.ok = true)
    (h : nameWith H a = nameWith H b) : a = b := by
  have hl : textOk labelBytes = true := by decide
  obtain ⟨_, hv⟩ := signing_separates hl hl (genesis_canon ha) (genesis_canon hb) (hH _ _ h)
  cases a with
  | mk ka na =>
    cases b with
    | mk kb nb =>
      simp only [Genesis.value, Value.map.injEq, List.cons.injEq, Prod.mk.injEq, Value.text.injEq,
        Value.bytes.injEq, true_and, and_true] at hv
      obtain ⟨hk, hn⟩ := hv
      rw [kindBytes_inj hk, hn]

/-- A name is 32 bytes, under any hash whose outputs are. -/
theorem vaultName_len {H : Bytes → Hash} (hok : ∀ b, (H b).ok = true) (g : Genesis) :
    (nameWith H g).bytes.length = 32 := by
  have := hok (signingBytes labelBytes g.value)
  simpa [Hash.ok, nameWith] using this

/-- A vault as it lives: its genesis, and what changes, its owners and its owners' epoch. -/
structure Living where
  genesis : Genesis
  owners : List Owner
  epoch : Nat

def Living.name (H : Bytes → Hash) (v : Living) : Hash := nameWith H v.genesis

/-- **The name depends on the genesis alone:** owners and epochs change, and the name doesn't. -/
theorem name_ignores_owners (H : Bytes → Hash) (v : Living) (owners : List Owner) (epoch : Nat) :
    ({ v with owners, epoch } : Living).name H = v.name H := rfl

/-! ## Reading a genesis back -/

def field (kvs : List (Bytes × Value)) (key : Bytes) : Option Value := (kvs.find? (·.1 == key)).map (·.2)

/-- The fields read, before the write-back check. -/
def Genesis.read? (v : Value) : Option Genesis :=
  match v with
  | .map kvs => do
    let .text k ← field kvs keyKind | none
    let .bytes n ← field kvs keyNonce | none
    some { kind := ← kindOf? k, nonce := n }
  | _ => none

/-- A genesis, and only one its own `value` writes back the same: exactly `kind` and `nonce`, a kind of exactly the four,
a nonce of exactly 32 bytes. -/
def Genesis.ofValue? (v : Value) : Option Genesis :=
  (Genesis.read? v).bind fun g => if g.ok && g.value == v then some g else none

theorem Genesis.ofValue_value {v : Value} {g : Genesis} (h : Genesis.ofValue? v = some g) :
    g.value = v ∧ g.ok = true := by
  unfold Genesis.ofValue? at h
  simp only [Option.bind_eq_some_iff] at h
  obtain ⟨g', _, h⟩ := h
  split at h
  · next hv =>
    cases h
    simp only [Bool.and_eq_true, beq_iff_eq] at hv
    exact ⟨hv.2, hv.1⟩
  · cases h

/-! ## The cast's vaults

Their nonces are fixed, BLAKE3 of `avenSANDBOX vault nonce: <id>`, public on purpose and valid only in the box, so the
cast's names are stable; production's are fresh at founding. -/

def castNonce (id : String) : Bytes := Blake3.digest (t s!"avenSANDBOX vault nonce: {id}")

def castGenesis (kind : Kind) (id : String) : Genesis := { kind, nonce := castNonce id }

def castVaults : List (String × Kind) :=
  [("alice", .person), ("bob", .person), ("maia-city", .coop), ("aven", .agent), ("guardian", .agent),
   ("alice-peer", .device), ("alice-peer-light", .device), ("aven-peer", .device), ("bob-peer-light", .device)]

#guard castVaults.all fun (id, k) => (castGenesis k id).ok && (vaultName (castGenesis k id)).bytes.length == 32
-- every cast vault's name is its own
#guard (castVaults.map fun (id, k) => (vaultName (castGenesis k id)).bytes).eraseDups.length = castVaults.length
#guard castVaults.all fun (id, k) => Genesis.ofValue? (castGenesis k id).value == some (castGenesis k id)

end Aven.ID.VaultName

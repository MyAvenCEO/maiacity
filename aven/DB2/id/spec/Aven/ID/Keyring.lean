import Aven.ID.KeyFormats

/-! # A vault's keyring, as a Doc (A43; stage 3)

A vault's keyring is its own Doc of avenID's built-in `keyring` type, the only Doc sealed to devices: its epochs go to
the vault's devices, by their derived seal keys, and to each passkey's PRF seal key, with the vault key inside. Its
Records are caps' built-in `epoch` Records, each an epoch blob (`Aven.ID.KeyFormats.Epoch`, scope keyring) with
signatures beside it. Built-in Records are written whole and never edited (`Aven.DB.Docs.Builtins`), so:

- **A rotation** writes a Record of epoch n + 1 whose `prev` names the epoch before.
- **A reseal**, for a new device or passkey, writes another Record of the *same* epoch carrying the new reader's stanza:
  it has the same name (`reseal_name`), since an epoch is named without its stanzas, and records only accumulate.
- **Opening** an epoch tries the stanzas of every Record that shares its name (`stanzasOf`): adding a Record never takes
  one away (`stanzas_mono`), and Records that share a name share their whole header, under a hash nothing collides
  under (`shared_header`).
- **The current epoch** is the highest number, and between two of one number the smaller name, as keepers choose
  (`current`, `current_mem`).
- **The genesis**, written by the vault's Peer-Light at sign-up through its real ceremony: epoch 1, no `prev`, no
  `back`, the vault key inside, its stanzas padded (`Genesis.ok`). -/

namespace Aven.ID.Keyring

open Aven.Core Aven.ID.KeyFormats

/-- A keyring Doc's Records, as their epoch blobs. -/
abbrev Records := List Epoch

/-- The name of an epoch under any hash: of its blob without its stanzas. -/
def nameWith (H : Bytes → Hash) (e : Epoch) : Hash := H (encode ({ e with stanzas := [] } : Epoch).value)

theorem name_eq (e : Epoch) : e.name = nameWith blake3 e := rfl

/-- Every stanza of the epoch named `n`, from every Record that carries it. -/
def stanzasOf (H : Bytes → Hash) (rs : Records) (n : Hash) : List Stanza :=
  (rs.filter (nameWith H · == n)).flatMap (·.stanzas)

/-- A reseal's Record: the same epoch, the new reader's stanzas. -/
def reseal (e : Epoch) (stanzas : List Stanza) : Epoch := { e with stanzas }

theorem reseal_name (H : Bytes → Hash) (e : Epoch) (s : List Stanza) : nameWith H (reseal e s) = nameWith H e := rfl

/-- **Adding a Record never takes a stanza away**: whoever could open an epoch still can. -/
theorem stanzas_mono (H : Bytes → Hash) (rs : Records) (r : Epoch) (n : Hash) :
    ∀ s ∈ stanzasOf H rs n, s ∈ stanzasOf H (rs ++ [r]) n := by
  intro s m
  simp only [stanzasOf, List.filter_append, List.flatMap_append, List.mem_append]
  exact .inl m

/-- A reseal's stanzas join its epoch's. -/
theorem reseal_joins (H : Bytes → Hash) (rs : Records) (e : Epoch) (s : List Stanza) :
    ∀ x ∈ s, x ∈ stanzasOf H (rs ++ [reseal e s]) (nameWith H e) := by
  intro x m
  simp [stanzasOf, reseal, nameWith, m]

/-- **Records that share a name share their header** (everything but the stanzas), under an injective hash. -/
theorem shared_header {H : Bytes → Hash} (hH : Injective H) {e f : Epoch} (h : nameWith H e = nameWith H f) :
    encode ({ e with stanzas := [] } : Epoch).value = encode ({ f with stanzas := [] } : Epoch).value :=
  hH _ _ h

/-- One epoch before another as keepers choose: a higher number, or at one number the smaller name. -/
def later (H : Bytes → Hash) (a b : Epoch) : Bool :=
  a.n > b.n || (a.n == b.n && lexLt (nameWith H a).bytes (nameWith H b).bytes)

/-- The current epoch: the latest, by `later`. -/
def current (H : Bytes → Hash) : Records → Option Epoch
  | [] => none
  | r :: rs => some ((rs.foldl fun best x => if later H x best then x else best) r)

theorem current_mem (H : Bytes → Hash) (rs : Records) {e : Epoch} (h : current H rs = some e) : e ∈ rs := by
  cases rs with
  | nil => cases h
  | cons r rs =>
    simp only [current, Option.some.injEq] at h
    subst h
    suffices ∀ (acc : Epoch) (l : List Epoch), acc ∈ r :: rs → (∀ x ∈ l, x ∈ r :: rs) →
        (l.foldl (fun best x => if later H x best then x else best) acc) ∈ r :: rs from
      this r rs (List.mem_cons_self) (fun x m => List.mem_cons_of_mem _ m)
    intro acc l
    induction l generalizing acc with
    | nil => intro ha _; exact ha
    | cons x l ih =>
      intro ha hl
      simp only [List.foldl_cons]
      apply ih
      · split
        · exact hl x List.mem_cons_self
        · exact ha
      · exact fun y m => hl y (List.mem_cons_of_mem _ m)

/-- A keyring's first Record, as sign-up writes it. -/
def Genesis.ok (e : Epoch) : Bool :=
  e.scope == .keyring && e.n == 1 && e.prev.isEmpty && e.back.isNone && e.vault.isSome && e.isPadded

/-! ## Examples: Alice's keyring, its stanzas in a pattern -/

def aliceGenesis : Epoch :=
  { scope := .keyring, id := "alice", n := 1, prev := [], commit := List.replicate 32 1, vault := some (List.replicate 48 2),
    stanzas := (List.range 4).map fun i =>
      { ct := List.replicate ctLen i.toUInt8, commit := List.replicate 32 i.toUInt8,
        sealed := List.replicate 48 i.toUInt8 } }

def aliceReseal : Epoch :=
  reseal aliceGenesis ((List.range 4).map fun i =>
    { ct := List.replicate ctLen (10 + i).toUInt8, commit := List.replicate 32 (10 + i).toUInt8,
      sealed := List.replicate 48 (10 + i).toUInt8 })

def aliceSecond : Epoch :=
  let e := aliceGenesis
  ⟨e.scope, e.id, 2, [e.name.bytes], e.stanzas, List.replicate 32 4, some (List.replicate 48 3), e.vault⟩

#guard Genesis.ok aliceGenesis && !Genesis.ok aliceSecond
#guard aliceReseal.name = aliceGenesis.name
#guard (stanzasOf blake3 [aliceGenesis, aliceReseal, aliceSecond] aliceGenesis.name).length = 8
#guard current blake3 [aliceGenesis, aliceReseal, aliceSecond] = some aliceSecond

end Aven.ID.Keyring

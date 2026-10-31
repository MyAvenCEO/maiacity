import Aven.Core.Bytes

/-!
# The fetch gate: sealed bytes only to a connection that proved their Doc (A22; PEERS.md §3 and §4)

One gate serves every sealed Value a peer hands out for a Doc: a keeper's by arrival number (`Aven.Peer.Keeper`) and a
reader's by version ("Docs in the Peers"). It runs on our own ALPN, `aven/db/1`, because a fetch proof signs the TLS
exporter of the connection that serves (`Aven.ID.Keep`, `served_current`), and iroh opens one connection per ALPN
(the architect, 31 Oct 2026). iroh-blobs stays for files.

- **`prove`:** a device proves a Doc's fetch key on this connection, and only to a peer it knows holds the Doc
  (`prove_only_to_holders`); whether the proof holds is `Keep.serves`. The
  gate keeps the Docs proven on the connection (`proven`).
- **`fetch {doc, hashes}`:** at most `fetchHashes` hashes. Each is served only if the peer holds it *for that Doc*: a
  hash held for another Doc is answered as missing, never served across Docs (`served_proven`, `served_held`). A Doc
  not proven gets nothing (`unproven_nothing`). The items served together stay within `inFlight` bytes, at least one
  item always (`answer_bounded`, `answer_moves`); from the first that doesn't fit on, the rest held are answered `later`,
  so what is served keeps the order asked and the device asks again for the rest. Every
  hash asked is answered exactly once, as served, missing or later (`answer_partition`).
- **`items`:** each item in parts of at most `partBytes`, at consecutive offsets, which together are its bytes
  (`parts_join`, `parts_bounded`), so every frame stays under the wire's 64 KiB.
- **The receiver checks** each reassembled item's hash against the one it asked for before storing it; an item that
  doesn't match is dropped and its sender noted, never stored (`stored_checked`).
-/

namespace Aven.Peer.Fetch

open Aven.Core (Bytes)

/-- The most hashes in one `fetch`. -/
def fetchHashes : Nat := 128
/-- The most bytes of an item in one `items` frame. -/
def partBytes : Nat := 48 * 1024
/-- The most bytes of items one `fetch` is answered with, beyond its first item. -/
def inFlight : Nat := 1024 * 1024

/-- A part of an item: its hash, its offset, the item's whole length, and the bytes. -/
structure Part where
  hash : Nat
  at_ : Nat
  total : Nat
  bytes : Bytes
  deriving DecidableEq, Repr

/-- An item's bytes from `at`, in parts of at most `partBytes`; an empty item is one empty part. -/
def partsFrom (h total : Nat) (at_ : Nat) (b : Bytes) : List Part :=
  if _e : b.length ≤ partBytes then [⟨h, at_, total, b⟩]
  else ⟨h, at_, total, b.take partBytes⟩ :: partsFrom h total (at_ + partBytes) (b.drop partBytes)
termination_by b.length
decreasing_by simp only [List.length_drop]; simp [partBytes] at *; omega

/-- An item in parts. -/
def parts (h : Nat) (b : Bytes) : List Part := partsFrom h b.length 0 b

theorem partsFrom_spec (h total : Nat) : ∀ (k at_ : Nat) (b : Bytes), b.length ≤ k →
    ((partsFrom h total at_ b).flatMap (·.bytes)) = b ∧
      ∀ p ∈ partsFrom h total at_ b, p.hash = h ∧ p.total = total ∧ p.bytes.length ≤ partBytes ∧ at_ ≤ p.at_
  | 0, at_, b, hk => by
    have : b = [] := List.eq_nil_of_length_eq_zero (by omega)
    subst this
    rw [partsFrom]
    simp [partBytes]
  | k + 1, at_, b, hk => by
    rw [partsFrom]
    split
    · rename_i le
      simp only [List.flatMap_cons, List.flatMap_nil, List.append_nil, List.mem_singleton, true_and]
      exact fun p e => by subst e; exact ⟨rfl, rfl, le, Nat.le_refl _⟩
    · rename_i gt
      have ⟨j, all⟩ := partsFrom_spec h total k (at_ + partBytes) (b.drop partBytes)
        (by simp only [List.length_drop]; simp [partBytes] at gt ⊢; omega)
      refine ⟨by simp only [List.flatMap_cons]; rw [j]; exact List.take_append_drop _ _, fun p m => ?_⟩
      rcases List.mem_cons.mp m with rfl | m
      · exact ⟨rfl, rfl, by simp only [List.length_take]; exact Nat.min_le_left _ _, Nat.le_refl _⟩
      · have ⟨a, b', c, d⟩ := all p m
        exact ⟨a, b', c, by omega⟩

/-- **`parts_join`:** an item's parts, in order, are its bytes. -/
theorem parts_join (h : Nat) (b : Bytes) : (parts h b).flatMap (·.bytes) = b :=
  (partsFrom_spec h b.length b.length 0 b (Nat.le_refl _)).1

/-- **`parts_bounded`:** every part is the item's, names its length, and holds at most `partBytes`. -/
theorem parts_bounded (h : Nat) (b : Bytes) :
    ∀ p ∈ parts h b, p.hash = h ∧ p.total = b.length ∧ p.bytes.length ≤ partBytes :=
  fun p m => let ⟨a, b', c, _⟩ := (partsFrom_spec h b.length b.length 0 b (Nat.le_refl _)).2 p m; ⟨a, b', c⟩

/-! ## Whom a device proves to

The gate names a Doc by its id, which the fetch proof signs; gossip and `doc_tips` name it by its topic. Naming it by id
widens nothing a link peer learns, because a device sends `prove {doc}` only to a peer it already knows holds that
Doc: a keeper its vault's keep caps name for it, or a reader it met on the Doc's topic (the architect,
31 Oct 2026). -/

/-- A device may prove a Doc to `peer`: a keeper its vault's keep caps name for the Doc, or a reader it met on the
Doc's topic. -/
def mayProve (keepers met : List String) (peer : String) : Bool := keepers.contains peer || met.contains peer

/-- The peers among `links` a device sends `prove {doc}` to. -/
def provesTo (keepers met links : List String) : List String := links.filter (mayProve keepers met)

/-- **`prove_only_to_holders`:** a device proves a Doc only to a keeper named for it or a reader met on its topic. -/
theorem prove_only_to_holders {keepers met links : List String} {p : String} (h : p ∈ provesTo keepers met links) :
    p ∈ links ∧ (p ∈ keepers ∨ p ∈ met) := by
  simp only [provesTo, mayProve, List.mem_filter, Bool.or_eq_true, List.contains_iff_mem] at h
  exact h

#guard provesTo ["aven-peer"] ["alice-peer"] ["aven-peer", "carol-peer", "alice-peer"] == ["aven-peer", "alice-peer"]

/-! ## Serving -/

/-- What a peer holds: for each sealed hash, the Doc it holds it for and its bytes. -/
abbrev Held := Nat → Option (String × Bytes)

/-- The answer to one `fetch`: the items served with their bytes, the hashes missing for that Doc, and those
deferred. -/
structure Answer where
  served : List (Nat × Bytes)
  missing : List Nat
  later : List Nat
  deriving DecidableEq, Repr

/-- Serve `hs`, in order, while the bytes served stay within `room`, the first always. -/
def serveFrom (held : Held) (doc : String) (first : Bool) (room : Nat) : List Nat → Answer
  | [] => ⟨[], [], []⟩
  | h :: hs =>
    match held h with
    | some (d, b) =>
      if d == doc then
        if first || (b.length ≤ room && 0 < room) then
          let a := serveFrom held doc false (room - b.length) hs
          { a with served := (h, b) :: a.served }
        else
          let a := serveFrom held doc false 0 hs
          { a with later := h :: a.later }
      else
        let a := serveFrom held doc first room hs
        { a with missing := h :: a.missing }
    | none =>
      let a := serveFrom held doc first room hs
      { a with missing := h :: a.missing }

/-- The gate's answer to `fetch {doc, hashes}` on a connection that proved the Docs `proven`: nothing for a Doc not
proven or a fetch of too many hashes (`none`: refused). -/
def answer (proven : List String) (held : Held) (doc : String) (hs : List Nat) : Option Answer :=
  if proven.contains doc && decide (hs.length ≤ fetchHashes) then some (serveFrom held doc true inFlight hs)
  else none

variable (held : Held) (doc : String)

/-- Every item served is held for the Doc asked, with the bytes served. -/
theorem serveFrom_held : ∀ (hs : List Nat) (first : Bool) (room : Nat),
    ∀ x ∈ (serveFrom held doc first room hs).served, held x.1 = some (doc, x.2)
  | [], _, _ => by simp [serveFrom]
  | h :: hs, first, room => by
    intro x m
    simp only [serveFrom] at m
    split at m
    · rename_i d b e
      split at m
      · rename_i dd
        split at m
        · dsimp only at m
          rcases List.mem_cons.mp m with rfl | m
          · simp only [beq_iff_eq] at dd; subst dd; exact e
          · exact serveFrom_held hs _ _ x m
        · exact serveFrom_held hs _ _ x m
      · exact serveFrom_held hs _ _ x m
    · exact serveFrom_held hs _ _ x m

/-- Every hash answered missing isn't held for the Doc asked. -/
theorem serveFrom_missing : ∀ (hs : List Nat) (first : Bool) (room : Nat),
    ∀ h ∈ (serveFrom held doc first room hs).missing, ∀ b, held h ≠ some (doc, b)
  | [], _, _ => by simp [serveFrom]
  | h :: hs, first, room => by
    intro x m b
    simp only [serveFrom] at m
    split at m
    · rename_i d b' e
      split at m
      · split at m
        · exact serveFrom_missing hs _ _ x m b
        · exact serveFrom_missing hs _ _ x m b
      · rename_i dd
        dsimp only at m
        rcases List.mem_cons.mp m with rfl | m
        · rw [e]; intro q; simp only [Option.some.injEq, Prod.mk.injEq] at q; simp [q.1] at dd
        · exact serveFrom_missing hs _ _ x m b
    · rename_i e
      dsimp only at m
      rcases List.mem_cons.mp m with rfl | m
      · rw [e]; simp
      · exact serveFrom_missing hs _ _ x m b

/-- Every hash asked is answered: served, missing or later, and nothing else is. -/
theorem serveFrom_partition : ∀ (hs : List Nat) (first : Bool) (room : Nat) (x : Nat),
    x ∈ hs ↔ x ∈ (serveFrom held doc first room hs).served.map (·.1) ∨ x ∈ (serveFrom held doc first room hs).missing ∨
      x ∈ (serveFrom held doc first room hs).later
  | [], _, _, _ => by simp [serveFrom]
  | h :: hs, first, room, x => by
    simp only [serveFrom]
    split
    · split
      · split
        · rename_i d b _ _ _
          have := serveFrom_partition hs false (room - b.length) x
          simp only [List.map_cons, List.mem_cons, this]
          constructor
          · rintro (e | (a | b | c)) <;> simp_all
          · rintro ((e | a) | b | c) <;> simp_all
        · have := serveFrom_partition hs false 0 x
          simp only [List.mem_cons, this]
          constructor
          · rintro (e | (a | b | c)) <;> simp_all
          · rintro (a | b | (e | c)) <;> simp_all
      · have := serveFrom_partition hs first room x
        simp only [List.mem_cons, this]
        constructor
        · rintro (e | (a | b | c)) <;> simp_all
        · rintro (a | (e | b) | c) <;> simp_all
    · have := serveFrom_partition hs first room x
      simp only [List.mem_cons, this]
      constructor
      · rintro (e | (a | b | c)) <;> simp_all
      · rintro (a | (e | b) | c) <;> simp_all

/-- After the first item, what is served stays within the room. -/
theorem serveFrom_bounded : ∀ (hs : List Nat) (room : Nat),
    ((serveFrom held doc false room hs).served.map (·.2.length)).sum ≤ room
  | [], _ => by simp [serveFrom]
  | h :: hs, room => by
    simp only [serveFrom]
    split
    · rename_i d b _
      split
      · split
        · rename_i fits
          have := serveFrom_bounded hs (room - b.length)
          simp only [Bool.false_or, Bool.and_eq_true, decide_eq_true_eq] at fits
          simp only [List.map_cons, List.sum_cons]
          have := fits.1
          omega
        · exact Nat.le_trans (serveFrom_bounded hs 0) (Nat.zero_le _)
      · exact serveFrom_bounded hs room
    · exact serveFrom_bounded hs room

theorem serveFrom_first_bounded : ∀ (hs : List Nat) (room : Nat),
    ((serveFrom held doc true room hs).served.tail.map (·.2.length)).sum ≤ room
  | [], _ => by simp [serveFrom]
  | h :: hs, room => by
    simp only [serveFrom]
    split
    · rename_i d b _
      split
      · split
        · exact Nat.le_trans (serveFrom_bounded held doc hs (room - b.length)) (Nat.sub_le _ _)
        · rename_i no; simp at no
      · exact serveFrom_first_bounded hs room
    · exact serveFrom_first_bounded hs room

/-- With anything held for the Doc asked, the first such item is served. -/
theorem serveFrom_moves : ∀ (hs : List Nat) (room : Nat) (x : Nat) (b : Bytes), x ∈ hs → held x = some (doc, b) →
    (serveFrom held doc true room hs).served ≠ []
  | [], _, _, _, m, _ => nomatch m
  | h :: hs, room, x, b, m, e => by
    simp only [serveFrom]
    split
    · rename_i d b' e'
      split
      · split
        · simp
        · rename_i no; simp at no
      · rename_i dd
        rcases List.mem_cons.mp m with rfl | m
        · rw [e] at e'; simp only [Option.some.injEq, Prod.mk.injEq] at e'; simp [← e'.1] at dd
        · exact serveFrom_moves hs room x b m e
    · rename_i e'
      rcases List.mem_cons.mp m with rfl | m
      · rw [e] at e'; simp at e'
      · exact serveFrom_moves hs room x b m e

/-- **`unproven_nothing`:** a Doc not proven on the connection, or a fetch of too many hashes, gets nothing. -/
theorem unproven_nothing {proven : List String} {hs : List Nat} (h : proven.contains doc = false ∨ fetchHashes < hs.length) :
    answer proven held doc hs = none := by
  unfold answer
  rcases h with h | h
  · rw [h]; simp
  · simp [Nat.not_le.mpr h]

/-- **`served_proven`, `served_held`:** whatever the gate serves is for a Doc proven on this connection, and held for
that Doc with those bytes: never another Doc's. -/
theorem served_held {proven : List String} {hs : List Nat} {a : Answer} (h : answer proven held doc hs = some a) :
    proven.contains doc = true ∧ ∀ x ∈ a.served, held x.1 = some (doc, x.2) := by
  unfold answer at h
  split at h
  · rename_i c
    simp only [Option.some.injEq] at h
    subst h
    simp only [Bool.and_eq_true, decide_eq_true_eq] at c
    exact ⟨c.1, serveFrom_held held doc hs true inFlight⟩
  · nomatch h

/-- **`answer_partition`:** every hash asked is answered exactly as served, missing or later; one missing isn't held
for the Doc asked. -/
theorem answer_partition {proven : List String} {hs : List Nat} {a : Answer} (h : answer proven held doc hs = some a) :
    (∀ x, x ∈ hs ↔ x ∈ a.served.map (·.1) ∨ x ∈ a.missing ∨ x ∈ a.later) ∧
      ∀ x ∈ a.missing, ∀ b, held x ≠ some (doc, b) := by
  unfold answer at h
  split at h
  · simp only [Option.some.injEq] at h
    subst h
    exact ⟨serveFrom_partition held doc hs true inFlight, serveFrom_missing held doc hs true inFlight⟩
  · nomatch h

/-- **`answer_bounded`, `answer_moves`:** beyond its first item, an answer serves at most `inFlight` bytes; and when
anything asked is held for the Doc, something is served, so each fetch moves the device forward (README, rule 3). -/
theorem answer_bounded {proven : List String} {hs : List Nat} {a : Answer} (h : answer proven held doc hs = some a) :
    (a.served.tail.map (·.2.length)).sum ≤ inFlight ∧
      ∀ x b, x ∈ hs → held x = some (doc, b) → a.served ≠ [] := by
  unfold answer at h
  split at h
  · simp only [Option.some.injEq] at h
    subst h
    exact ⟨serveFrom_first_bounded held doc hs inFlight, fun x b m e => serveFrom_moves held doc hs inFlight x b m e⟩
  · nomatch h

/-! ## Receiving -/

/-- A device puts an item it received in its store only if the hash of its reassembled bytes is the hash it asked
for; otherwise it drops it and notes the sender. -/
def receive (H : Bytes → Nat) (asked : Nat) (ps : List Part) : Option Bytes :=
  let b := ps.flatMap (·.bytes)
  if H b == asked && ps.all (·.hash == asked) then some b else none

/-- **`stored_checked`:** what a device stores hashes to what it asked for. An honest peer's parts are stored whole
(`honest_stored`). -/
theorem stored_checked {H : Bytes → Nat} {asked : Nat} {ps : List Part} {b : Bytes} (h : receive H asked ps = some b) :
    H b = asked ∧ b = ps.flatMap (·.bytes) := by
  dsimp only [receive] at h
  split at h
  · rename_i c
    simp only [Option.some.injEq] at h
    subst h
    simp only [Bool.and_eq_true, beq_iff_eq] at c
    exact ⟨c.1, rfl⟩
  · nomatch h

theorem honest_stored (H : Bytes → Nat) (b : Bytes) : receive H (H b) (parts (H b) b) = some b := by
  dsimp only [receive]
  rw [parts_join]
  have : (parts (H b) b).all (·.hash == H b) = true := by
    simp only [List.all_eq_true, beq_iff_eq]
    exact fun p m => (parts_bounded _ _ p m).1
  simp [this]

/-! ## Examples -/

namespace FetchExamples

def bytes (n : Nat) : Bytes := List.replicate n 7

-- an item of 100 KiB goes in three parts: 48, 48 and 4 KiB, at 0, 48 and 96 KiB
#guard (parts 1 (bytes (100 * 1024))).map (fun p => (p.at_, p.bytes.length)) ==
  [(0, 49152), (49152, 49152), (98304, 4096)]
#guard (parts 1 []).length == 1

/-- Two Docs: d1 holds 1 (500 KiB), 2 (600 KiB) and 3 (1 KiB); d2 holds 9. -/
def twoDocs : Held := fun h =>
  if h = 1 then some ("d1", bytes (500 * 1024)) else if h = 2 then some ("d1", bytes (600 * 1024))
  else if h = 3 then some ("d1", bytes 1024) else if h = 9 then some ("d2", bytes 10) else none

def shape (a : Option Answer) : Option (List Nat × List Nat × List Nat) :=
  a.map fun a => (a.served.map (·.1), a.missing, a.later)

-- proven d1: 9 is d2's, so missing for d1, as is 7; 1 is served, 2 doesn't fit in the bytes in flight, so it and
-- everything held after it waits: what is served keeps the order asked
#guard shape (answer ["d1"] twoDocs "d1" [9, 1, 2, 3, 7]) == some ([1], [9, 7], [2, 3])
-- once one waits, nothing after it is served, not even an empty item
#guard shape (answer ["d1"] (fun h => if h = 4 then some ("d1", []) else twoDocs h) "d1" [1, 2, 4]) ==
  some ([1], [], [2, 4])
-- asked alone, the big item is served: every fetch moves
#guard shape (answer ["d1"] twoDocs "d1" [2]) == some ([2], [], [])
-- not proven, or too many hashes: nothing
#guard shape (answer ["d2"] twoDocs "d1" [1]) == none
#guard shape (answer ["d1"] twoDocs "d1" (List.replicate 129 1)) == none

-- a receiver drops bytes that don't hash to what it asked for
def H (b : Bytes) : Nat := b.length
#guard receive H 4 (parts 4 (bytes 4)) == some (bytes 4)
#guard receive H 5 (parts 5 (bytes 4)) == none

end FetchExamples

end Aven.Peer.Fetch

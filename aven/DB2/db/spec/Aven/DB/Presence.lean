/-!
# Presence

Who is connected, as the Aven Peer counts it and tells each peer (SANDBOX.md, "avenOS in the browser"). The Aven Peer
sees connections, not peers: one peer may hold two (a page open in two tabs, a reconnect racing the old link). So the
state is one entry per open connection, and presence is the peers with at least one. Presence counts each connected
peer once: no peer twice, and none that is gone.

`aven-gen1`'s `presence` module implements this machine, and its tests replay random traces against `Main.lean`.
-/

namespace Aven.DB

/-- A peer, by its index in the cast. -/
abbrev PeerId := Nat

inductive Change where
  | join (p : PeerId)
  | leave (p : PeerId)
  deriving DecidableEq, Repr

structure Presence where
  /-- one entry per open connection, newest first -/
  conns : List PeerId
  deriving DecidableEq, Repr

/-- Each element once, keeping its last occurrence. -/
def dedup : List PeerId → List PeerId
  | [] => []
  | a :: l => if a ∈ dedup l then dedup l else a :: dedup l

theorem mem_dedup (a : PeerId) : ∀ l : List PeerId, a ∈ dedup l ↔ a ∈ l
  | [] => by simp [dedup]
  | b :: l => by
    have ih := mem_dedup a l
    by_cases h : b ∈ dedup l
    · simp only [dedup, h, ite_true, List.mem_cons]
      constructor
      · intro ha; exact Or.inr (ih.mp ha)
      · intro ha; cases ha with
        | inl e => exact e ▸ h
        | inr ha => exact ih.mpr ha
    · simp [dedup, h, ih]

theorem nodup_dedup : ∀ l : List PeerId, (dedup l).Nodup
  | [] => by simp [dedup]
  | b :: l => by
    by_cases h : b ∈ dedup l
    · simp only [dedup, h, ite_true]; exact nodup_dedup l
    · simp only [dedup, h, ite_false]
      exact List.nodup_cons.mpr ⟨h, nodup_dedup l⟩

/-- Insertion sort, structural so the kernel can run it in the examples. -/
def ins (a : PeerId) : List PeerId → List PeerId
  | [] => [a]
  | b :: l => if a ≤ b then a :: b :: l else b :: ins a l

def sort : List PeerId → List PeerId
  | [] => []
  | a :: l => ins a (sort l)

theorem ins_perm (a : PeerId) : ∀ l, (ins a l).Perm (a :: l)
  | [] => .refl _
  | b :: l => by
    unfold ins
    split
    · exact .refl _
    · exact ((ins_perm a l).cons b).trans (.swap a b l)

theorem sort_perm : ∀ l, (sort l).Perm l
  | [] => .refl _
  | a :: l => (ins_perm a _).trans ((sort_perm l).cons a)

namespace Presence

def empty : Presence := ⟨[]⟩

def step (s : Presence) : Change → Presence
  | .join p => ⟨p :: s.conns⟩
  | .leave p => ⟨s.conns.erase p⟩

def run (s : Presence) (cs : List Change) : Presence := cs.foldl step s

/-- The peers connected now. -/
def present (s : Presence) : List PeerId := dedup s.conns

/-- What every peer is told: "N peers". -/
def count (s : Presence) : Nat := s.present.length

/-- The peers as every peer is told them: each once, in order. -/
def told (s : Presence) : List PeerId := sort s.present

/-! ## Presence counts each connected peer once -/

/-- No peer is counted twice. -/
theorem present_once (s : Presence) : s.present.Nodup := nodup_dedup _

/-- Exactly the peers with an open connection are counted. -/
theorem present_iff (s : Presence) (p : PeerId) : p ∈ s.present ↔ p ∈ s.conns := mem_dedup p _

/-- A peer joining is counted, however many connections it holds. -/
theorem join_present (s : Presence) (p : PeerId) : p ∈ (s.step (.join p)).present := by
  rw [present_iff]; simp [step]

/-- A second connection of a peer already counted changes nothing. -/
theorem join_again (s : Presence) (p : PeerId) (h : p ∈ s.conns) :
    (s.step (.join p)).present = s.present := by
  have : p ∈ dedup s.conns := (mem_dedup p _).mpr h
  simp [step, present, dedup, this]

/-- The last connection of a peer leaving takes it out of the count. -/
theorem leave_last (s : Presence) (p : PeerId) (h : s.conns.count p = 1) :
    p ∉ (s.step (.leave p)).present := by
  rw [present_iff]
  simp only [step]
  intro hm
  have h2 : (s.conns.erase p).count p = 0 := by
    rw [List.count_erase_self]; omega
  exact (List.count_eq_zero.mp h2) hm

/-- Another peer leaving never takes a peer out of the count. -/
theorem leave_other (s : Presence) (p q : PeerId) (hne : p ≠ q) :
    p ∈ (s.step (.leave q)).present ↔ p ∈ s.present := by
  rw [present_iff, present_iff]
  exact List.mem_erase_of_ne hne

/-- Every peer is told exactly the peers with an open connection, each once. -/
theorem mem_told (s : Presence) (p : PeerId) : p ∈ s.told ↔ p ∈ s.conns :=
  (sort_perm _).mem_iff.trans (present_iff s p)

theorem told_once (s : Presence) : s.told.Nodup := (sort_perm _).nodup_iff.mpr (present_once s)

end Presence

/-! ## Examples

Changes and what every peer is told after the last, written out by hand: peers 1, 2 and 3 are Alice Peer, Bob's
Peer-Light and a peer that never connected. -/

def presenceExamples : List (String × List Change × List PeerId) := [
  ("a second connection counts once", [.join 1, .join 1, .join 2], [1, 2]),
  ("one of two connections closes", [.join 1, .join 1, .join 2, .leave 1], [1, 2]),
  ("a peer never connected leaves", [.join 1, .join 2, .leave 3], [1, 2]),
  ("the last connection closes", [.join 1, .join 1, .join 2, .leave 1, .leave 3, .leave 1], [2]),
  ("nobody", [], [])]

theorem presence_examples :
    presenceExamples.all (fun (_, cs, ps) => decide ((Presence.empty.run cs).told = ps)) = true := by decide

end Aven.DB

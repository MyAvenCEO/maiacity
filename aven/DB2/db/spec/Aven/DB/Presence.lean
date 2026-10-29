/-!
# Presence

Who is connected, as the Aven Peer counts it and tells each peer (SANDBOX.md, "avenOS in the browser"). The Aven Peer
sees connections, not peers: one peer may hold two (a page open in two tabs, a reconnect racing the old link). So the
state is one entry per open connection, and presence is the peers with at least one. Presence counts each connected
peer once: no peer twice, and none that is gone.

`aven-db-core`'s `presence` module implements this machine, and its tests replay random traces against `Main.lean`.
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

end Presence

end Aven.DB

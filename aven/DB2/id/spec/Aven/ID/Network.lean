import Aven.ID.Caps

/-! # The network: the public and tickets

**The public** (D15) is every member of the invite-only network, and nobody outside it. A public cap's writes count only
from a member (`public_member`), and a member's removal ends them at once: the members group's next epoch is sealed to
the members that remain (`removal_rotates`).

**Tickets** (A12, the architect's recommendation, waiting for Samuel): a ticket is claimed once, by the claim with the
smallest hash, so every peer agrees whatever order the claims reach it in (`ticket_once`). The hash is compared as a
number; `Aven.Core`'s hashes are 32 bytes, read big-endian. `ticket_once` depends on A12. -/

namespace Aven.ID

/-- A write under `c` from `writer`'s vault counts only if `c` isn't public or the writer is a member. -/
def publicWriter (member : String → Bool) (c : Cap) (writer : String) : Bool :=
  c.holder != .«public» || member writer

theorem public_member {member : String → Bool} {c : Cap} {writer : String} (h : publicWriter member c writer = true)
    (p : c.holder = .«public») : member writer = true := by
  simpa [publicWriter, p] using h

/-- The network's members after a removal, and what the members group's next epoch is sealed to. -/
def removeMember (members : List String) (removed : String) : List String := members.filter (· != removed)

/-- A removed member is in no epoch of the members group made after the removal. -/
theorem removal_rotates {members : List String} {removed : String} : removed ∉ removeMember members removed := by
  simp [removeMember]

/-- A claim of a ticket: who claims it, and the claim's hash as a number. -/
structure TicketClaim where
  claimant : String
  hash : Nat
  deriving DecidableEq, Repr

/-- The claim that wins a ticket: the one with the smallest hash. -/
def winner : List TicketClaim → Option TicketClaim
  | [] => none
  | c :: cs =>
    match winner cs with
    | none => some c
    | some w => if c.hash ≤ w.hash then some c else some w

theorem winner_none : ∀ {cs : List TicketClaim}, winner cs = none → cs = []
  | [], _ => rfl
  | c :: cs, h => by
    simp only [winner] at h
    split at h <;> (try split at h) <;> contradiction

/-- The winner is one of the claims, and no claim's hash is smaller. -/
theorem winner_min :
    ∀ {cs : List TicketClaim} {w : TicketClaim}, winner cs = some w → w ∈ cs ∧ ∀ c ∈ cs, w.hash ≤ c.hash
  | [], _, h => nomatch h
  | c :: cs, w, h => by
    simp only [winner] at h
    split at h
    · rename_i n
      cases h
      have e := winner_none n
      subst e
      exact ⟨List.mem_singleton.mpr rfl, fun x m => by simp_all⟩
    · rename_i w' s
      have ⟨wm, wmin⟩ := winner_min s
      split at h
      · rename_i le
        cases h
        refine ⟨List.mem_cons_self, fun x m => ?_⟩
        rcases List.mem_cons.mp m with e | m
        · exact e ▸ Nat.le_refl _
        · exact Nat.le_trans le (wmin x m)
      · rename_i lt
        cases h
        refine ⟨List.mem_cons_of_mem _ wm, fun x m => ?_⟩
        rcases List.mem_cons.mp m with e | m
        · subst e; omega
        · exact wmin x m

/-- A ticket is claimed once: peers holding the same claims, in any order, agree on the winning hash, and on the claim
when hashes differ. -/
theorem ticket_once {cs ds : List TicketClaim} {w v : TicketClaim} (same : ∀ c, c ∈ cs ↔ c ∈ ds)
    (hw : winner cs = some w) (hv : winner ds = some v) : w.hash = v.hash := by
  have ⟨wm, wmin⟩ := winner_min hw
  have ⟨vm, vmin⟩ := winner_min hv
  exact Nat.le_antisymm (wmin v ((same v).mpr vm)) (vmin w ((same w).mp wm))

theorem ticket_once_claim {cs ds : List TicketClaim} {w v : TicketClaim} (same : ∀ c, c ∈ cs ↔ c ∈ ds)
    (distinct : ∀ a ∈ cs, ∀ b ∈ cs, a.hash = b.hash → a = b) (hw : winner cs = some w) (hv : winner ds = some v) :
    w = v :=
  distinct w (winner_min hw).1 v ((same v).mpr (winner_min hv).1) (ticket_once same hw hv)

end Aven.ID

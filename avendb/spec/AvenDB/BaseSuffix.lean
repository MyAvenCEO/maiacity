/- Structural dependency stage, not permission or convergence. Facts are owner-attested
inside an authenticated envelope. Signatures, current authority and CRDT equivalence remain
separate obligations; no writable state is produced by this model. -/
namespace AvenDB.BaseSuffix
structure Fact where
  id : Nat
  entry : Nat
  deps : List Nat

def validFrom (entry : Nat) : List Nat → List Fact → Bool
  | _, [] => true
  | held, fact :: rest =>
      decide (fact.entry = entry) && !(held.contains fact.id) &&
      fact.deps.all held.contains && validFrom entry (fact.id :: held) rest

def links (entry : Nat) (held : List Nat) (suffix : Fact) : Bool :=
  decide (suffix.entry = entry) && !(held.contains suffix.id) && suffix.deps.all held.contains

def writable (_entry : Nat) (_held : List Nat) (_suffix : Fact) : Bool := false

theorem linked_entry (entry : Nat) (held : List Nat) (suffix : Fact)
    (h : links entry held suffix = true) : suffix.entry = entry := by
  simp only [links, Bool.and_eq_true, decide_eq_true_eq] at h
  exact h.1.1

theorem linked_dependency (entry : Nat) (held : List Nat) (suffix : Fact) (dependency : Nat)
    (h : links entry held suffix = true) (member : dependency ∈ suffix.deps) : dependency ∈ held := by
  simp only [links, Bool.and_eq_true] at h
  have contained := List.all_eq_true.mp h.2 dependency member
  exact List.contains_iff_mem.mp contained

theorem duplicate_rejected (entry : Nat) (held : List Nat) (suffix : Fact)
    (h : held.contains suffix.id = true) : links entry held suffix = false := by
  unfold links
  rw [h]
  simp

theorem structural_link_not_permission (entry : Nat) (held : List Nat) (suffix : Fact) :
    writable entry held suffix = false := rfl
-- An unseen concurrent write is selected by membership, never by checkpoint depth.
def unseen (held : List Nat) (fact : Fact) : Bool := !(held.contains fact.id)

theorem absent_selected (held : List Nat) (fact : Fact) (h : fact.id ∉ held) :
    unseen held fact = true := by
  simp [unseen, h]

-- Unsupported or unavailable suffix evidence, or changed entry policy, cannot
-- leave a partial overlay writable. These booleans are implementation premises.
def activate (samePolicy completeSupportedSuffix : Bool) : Bool :=
  samePolicy && completeSupportedSuffix

theorem changed_policy_inactive (complete : Bool) : activate false complete = false := by
  simp [activate]

theorem incomplete_suffix_inactive (policy : Bool) : activate policy false = false := by
  simp [activate]
end AvenDB.BaseSuffix

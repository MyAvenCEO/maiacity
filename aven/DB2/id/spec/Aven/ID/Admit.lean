import Aven.ID.Network

/-! # Acks and newcomers on the settled tree (PEERS.md, Thread B; B1 and B2)

**Honest acks (B1).** An admin device acks a claim on its own when it syncs one, by a policy (PEERS §5, rule 3): ack
only a claim that stands in its own view, and never a claim of a ticket that already has another final claim there.
A device holds what it signed, so its later views hold its earlier acks. Then no device, following the policy, acks
two claims of one ticket (`honest_confirm_once`): only two devices' acks that never saw each other can make a ticket
`contested`.

**Newcomers (B2).** Every relay on the list and every peer's hook let a key in when the settled tree admits it, or
when it brings a statement, its claim or a sign-in naming it as the device, after which the tree would admit it
(`newcomer`, as `Members.newcomer` is today). A newcomer is let in only for its own key (`newcomer_own`), and the
statement it brings, once it reaches the tree, admits it there too (`newcomer_admitted`). So joining works through
any member's relay, with nothing but the tree as its input. -/

namespace Aven.ID

/-- The device a statement brings to the door: a claim's first device, or a sign-in's device. -/
def TreeStatement.brings (s : TreeStatement) : Option String :=
  match s.says with
  | .claim _ _ _ d _ => some d
  | .signIn _ d => some d
  | _ => none

namespace Settle

variable (pinned : Core.Hash)

/-! ## B1: honest acks -/

/-- The ack policy, over the statements a device holds when it signs `a`: an ack names a claim that stands in that
view, and no other claim of its ticket is final there. Any other statement is no ack and passes. -/
def confirmPolicy (V : List TreeStatement) (a : TreeStatement) : Bool :=
  match a.says with
  | .confirm n =>
    (view pinned V).any fun c => c.name == n && standing (view pinned V) c &&
      (view pinned V).all fun f => !(final (view pinned V) f && sameTicket f c && f.name != c.name)
  | _ => true

/-- **`honest_confirm_once`:** a claim `c₁` final among statements a device held (`V₁`, its own earlier ack among them)
stays final in every later view `V₂ ⊇ V₁`, so the policy refuses an ack there of any other claim `c₂` of its ticket.
Names are hashes, so one name is one statement (`uniq`). -/
theorem honest_confirm_once {V₁ V₂ : List TreeStatement} (sub : ∀ x ∈ V₁, x ∈ V₂)
    (uniq : ∀ x ∈ V₂, ∀ y ∈ V₂, x.name = y.name → x = y) {c₁ c₂ a : TreeStatement} (m₁ : c₁ ∈ V₁)
    (f₁ : final (view pinned V₁) c₁ = true) (same : sameTicket c₁ c₂ = true) (other : c₁.name ≠ c₂.name)
    (m₂ : c₂ ∈ V₂) (acks : a.says = .confirm c₂.name) : confirmPolicy pinned V₂ a = false := by
  have f₂ : final (view pinned V₂) c₁ = true := final_mono pinned sub f₁
  have cnt : counted pinned V₂ c₁ = true := claimOk_counted pinned (final_claimOk f₂)
  unfold confirmPolicy
  rw [acks]
  simp only
  cases e : (view pinned V₂).any fun c => c.name == c₂.name && standing (view pinned V₂) c &&
      (view pinned V₂).all fun f => !(final (view pinned V₂) f && sameTicket f c && f.name != c.name)
  · rfl
  · exfalso
    obtain ⟨c, mc, _, hc⟩ := (view_any pinned).mp e
    simp only [Bool.and_eq_true, beq_iff_eq] at hc
    obtain ⟨⟨hn, _⟩, hall⟩ := hc
    have hcc : c = c₂ := uniq c mc c₂ m₂ hn
    subst hcc
    have := view_all pinned hall (sub c₁ m₁) cnt
    simp [f₂, same, other] at this

/-! ## B2: newcomers -/

/-- A claim that would stand with what a peer holds: its device may bring it to a confirmer (A38), which issues its
vault's member cap; until then it is let in for that and nothing else. -/
def pending (S : List TreeStatement) (st : TreeStatement) : Bool :=
  st.ticketOf.isSome && (settle pinned (st :: S)).standing st.name

/-- A relay or a hook lets `key` in: the settled tree admits it, or it brings a statement naming it as the device, with
which the tree would admit it. -/
def newcomer (S : List TreeStatement) (key : String) (s : Option TreeStatement) : Bool :=
  (settle pinned S).admits key ||
    match s with
    | some st => st.brings == some key && (pending pinned S st || (settle pinned (st :: S)).admits key)
    | none => false

/-- **`newcomer_own`:** a key the tree doesn't admit yet gets in only for a statement that names it as its device. -/
theorem newcomer_own {S : List TreeStatement} {key : String} {st : TreeStatement}
    (h : newcomer pinned S key (some st) = true) (no : (settle pinned S).admits key = false) :
    st.brings = some key := by
  simp only [newcomer, no, Bool.false_or, Bool.and_eq_true, beq_iff_eq] at h
  exact h.1

/-- **`newcomer_admitted`:** once the statement a newcomer brought reaches the statements a peer holds, its tree says
what let it in at the relay: the newcomer's claim stands there, waiting for its confirmation, or the tree admits it. -/
theorem newcomer_admitted {S S' : List TreeStatement} {key : String} {st : TreeStatement}
    (h : newcomer pinned S key (some st) = true) (same : ∀ x, x ∈ st :: S ↔ x ∈ S') :
    (settle pinned S').admits key = true ∨ (settle pinned S').standing st.name = true ∨
      (settle pinned S).admits key = true := by
  simp only [newcomer, pending, Bool.or_eq_true, Bool.and_eq_true, beq_iff_eq] at h
  rcases h with h | ⟨_, ⟨_, h⟩ | h⟩
  · exact .inr (.inr h)
  · exact .inr (.inl (by rw [← settle_perm pinned same]; exact h))
  · exact .inl (by rw [← settle_perm pinned same]; exact h)

/-- **`newcomer_none`:** without a statement, only what the tree admits gets in. -/
theorem newcomer_none {S : List TreeStatement} {key : String} :
    newcomer pinned S key none = (settle pinned S).admits key := by
  simp [newcomer]

end Settle

/-! ## Examples -/

namespace AdmitExamples

open Settle TreeExamples

def g : TreeStatement := ⟨100, "alice-passkey", [], .genesis alicesGenesis⟩
def t : TreeStatement := ⟨120, "alice-passkey", [100], .ticket "t-bob"⟩
def bob : TreeStatement := ⟨500, "t-bob", [120], .claim 120 "bob" "bob-passkey" "bob-peer" guardian⟩

-- Bob's browser, not yet a member, is let in at any relay for its claim, and for nothing else
#guard newcomer 100 [g, t] "bob-peer" (some bob)
#guard !newcomer 100 [g, t] "mallory-peer" (some bob)
#guard !newcomer 100 [g, t] "bob-peer" none
-- after the claim, Bob's browser waits for a confirmation; once Aven's device confirms it, Bob's vault holds its
-- member cap and his browser needs no statement
#guard !newcomer 100 [g, t, bob] "bob-peer" none
#guard newcomer 100 [g, t, bob, ⟨510, "aven-peer", [500], .confirm 500⟩] "bob-peer" none

-- the ack policy: Alice's Peer acks Bob's claim; once that ack is in its view, it refuses to ack a leaked one
def leak : TreeStatement := ⟨300, "t-bob", [120], .claim 120 "mallory" "mallory-passkey" "mallory-peer" guardian⟩
def ack1 : TreeStatement := ⟨510, "alice-peer", [500], .confirm 500⟩
#guard confirmPolicy 100 [g, t, bob] ack1
#guard !confirmPolicy 100 [g, t, bob, ack1, leak] ⟨520, "alice-peer", [510, 300], .confirm 300⟩

end AdmitExamples

end Aven.ID

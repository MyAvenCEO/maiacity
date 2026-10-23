import AvenDB.Batches

/-!
# Durable publication of batch roots

V5 assumes that a signer keeps one append-only log. This refinement records the
storage boundary that makes that assumption operational: immutable segments
extend `durable`, and a signed root becomes publishable only after both its
segment and the root object have been acknowledged by storage. Volatile signing
work is not a publication receipt. A receipt names the exact prefix and writer
generation; a delayed receipt cannot authorize a replacement writer.

The model assumes authenticated durable segment bytes and atomic create-only
segment names. The engine authenticates each envelope with a device-derived MAC
before accepting its unpublished tail. This model concerns published roots;
durable capture before acknowledging every legacy signing operation is a later
requirement of root-only authentication, not established by this refinement.

The model assumes atomic create-only segment names. Two writers that try to put
different bytes at the same sequence cannot both extend this state. Backends
without that contract remain on per-edit signatures. An independently copied or
rolled-back entire shelf is another state, not a transition here; V5's fork
proofs detect conflicting roots once the two states meet.
-/

namespace AvenDB.Batches.Durability

structure State where
  signer : SignerId
  generation : Nat
  durable : List EditId
  published : List Root
  deriving DecidableEq, Repr

/-- Receipt of a root object whose exact signer prefix was persisted first. -/
structure Receipt where
  generation : Nat
  leaves : List EditId
  root : Root
  deriving DecidableEq, Repr

/-- Every public root is the exact prefix it says of this one durable log. -/
def Safe (s : State) : Prop :=
  ∀ r ∈ s.published, r.log = s.signer ∧ r.fork = 0 ∧
    r.length ≤ s.durable.length ∧ r.digest = root (s.durable.take r.length)

/-- Storage has acknowledged both the receipt's segment prefix and root object.
    This predicate is checked before publishing, not merely before signing. -/
def Admissible (s : State) (ack : Receipt) : Prop :=
  ack.generation = s.generation ∧ ack.leaves <+: s.durable ∧
    ack.root.log = s.signer ∧ ack.root.fork = 0 ∧
    ack.root.length = ack.leaves.length ∧ ack.root.digest = root ack.leaves

/-- An atomic immutable segment extends the old prefix; it never replaces it. -/
def append (s : State) (ids : List EditId) : State :=
  { s with durable := s.durable ++ ids }

/-- The root object has been persisted and its receipt admitted. -/
def publish (s : State) (ack : Receipt) : State :=
  { s with published := ack.root :: s.published }

/-- Restart forgets volatile work, keeps the durable log and publication objects,
    and invalidates receipts belonging to the previous process. -/
def restart (s : State) : State := { s with generation := s.generation + 1 }

theorem append_keeps_prefix (s : State) (ids : List EditId) :
    s.durable <+: (append s ids).durable := by
  exact List.prefix_append _ _

theorem append_safe {s : State} (h : Safe s) (ids : List EditId) : Safe (append s ids) := by
  intro r hr
  obtain ⟨hs, hf, hl, hd⟩ := h r hr
  refine ⟨hs, hf, ?_, ?_⟩
  · simp only [append, List.length_append]
    omega
  · simp only [append]
    rw [List.take_append_of_le_length hl]
    exact hd

theorem publish_safe {s : State} (h : Safe s) {ack : Receipt}
    (ha : Admissible s ack) : Safe (publish s ack) := by
  intro r hr
  simp only [publish, List.mem_cons] at hr
  rcases hr with hr | hr
  · subst r
    obtain ⟨_, hp, hs, hf, hl, hd⟩ := ha
    refine ⟨hs, hf, ?_, ?_⟩
    · rw [hl]
      exact hp.length_le
    · simp only [publish]
      rw [hd, hl, ← List.prefix_iff_eq_take.1 hp]
  · exact h r hr

theorem restart_safe {s : State} (h : Safe s) : Safe (restart s) := h

theorem restart_preserves_prefix (s : State) :
    (restart s).durable = s.durable ∧ (restart s).published = s.published := by
  exact ⟨rfl, rfl⟩

theorem stale_receipt_rejected {s : State} {ack : Receipt}
    (h : ack.generation ≠ s.generation) : ¬ Admissible s ack := by
  intro ha
  exact h ha.1

theorem old_process_receipt_rejected {s : State} {ack : Receipt}
    (h : ack.generation = s.generation) : ¬ Admissible (restart s) ack := by
  apply stale_receipt_rejected
  simp only [restart]
  omega

/-- Publication can only expose roots of persisted bytes, never a root of a
    volatile append, even if asynchronous writes finish in another order. -/
theorem published_is_durable {s : State} (h : Safe s) {r : Root}
    (hr : r ∈ s.published) :
    r.length ≤ s.durable.length ∧ r.digest = root (s.durable.take r.length) := by
  exact (h r hr).2.2

end AvenDB.Batches.Durability

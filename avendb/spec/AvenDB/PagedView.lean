import AvenDB.Snapshot

/-!
# Authenticated local pages: projection, completeness and invalidation

This is a local stored-view refinement, not permission to trust a peer's snapshot.
An authenticated header commits to the exact engine, device, vault, frontier,
kernel, schema/cap-group state, opened-key epoch and generation. The immutable
page directory names each page's authenticated contents and dependencies.

`Authentic` abstracts collision resistance and successful local-key AEAD opening.
`Closed` is checked by the finite directory worklist in Rust. Ready means all of
that transitive closure is present; a missing page is never an empty entry.
The result is a projection, never a replacement global State. In particular this
does not prove that the declared dependency graph is complete for Lab reads,
that a query's entry set is complete, or that arbitrary tail edits can step on a
partial state. Production activation still requires those separate properties.
-/

namespace AvenDB.PagedView

structure Context where
  engine : Nat
  device : Nat
  vault : Nat
  frontier : Nat
  kernel : Nat
  schema : Nat
  openedEpoch : Nat
  generation : Nat
  deriving DecidableEq, Repr

inductive Read (α : Type) where
  | ready (value : α)
  | missing (pages : List Nat)
  | stale
  deriving DecidableEq, Repr

/-- A validated manifest is the source of expected page values. -/
def Authentic (source fetched : Nat → Option α) : Prop :=
  ∀ p v, fetched p = some v → source p = some v

/-- A finite worklist includes its roots and every dependency of each member. -/
def Closed (dependencies : Nat → List Nat) (roots needed : List Nat) : Prop :=
  (∀ p ∈ roots, p ∈ needed) ∧
  ∀ p ∈ needed, ∀ d ∈ dependencies p, d ∈ needed

inductive Reachable (dependencies : Nat → List Nat) (roots : List Nat) : Nat → Prop where
  | root {p} : p ∈ roots → Reachable dependencies roots p
  | dependency {p d} : Reachable dependencies roots p → d ∈ dependencies p →
      Reachable dependencies roots d

theorem closure_contains_dependencies {dependencies : Nat → List Nat} {roots needed : List Nat}
    (h : Closed dependencies roots needed) {p : Nat} (hp : Reachable dependencies roots p) :
    p ∈ needed := by
  induction hp with
  | root hp => exact h.1 _ hp
  | dependency _ hd ih => exact h.2 _ ih _ hd

/-- Reading is allowed only under the same context, after every needed page has
    arrived. The requested page is checked independently of the worklist too. -/
def read (bound current : Context) (fetched : Nat → Option α) (needed : List Nat) (entry : Nat) : Read α :=
  if bound = current then
    if needed.all (fun p => (fetched p).isSome) then
      match fetched entry with
      | some value => .ready value
      | none => .missing [entry]
    else .missing (needed.filter fun p => (fetched p).isNone)
  else .stale

theorem changed_context_is_stale (bound current : Context) (fetched : Nat → Option α)
    (needed : List Nat) (entry : Nat) (h : bound ≠ current) :
    read bound current fetched needed entry = .stale := by
  simp [read, h]

theorem ready_is_exact_projection {bound current : Context} {source fetched : Nat → Option α}
    {needed : List Nat} {entry : Nat} {value : α} (ha : Authentic source fetched)
    (hr : read bound current fetched needed entry = .ready value) :
    bound = current ∧ source entry = some value := by
  unfold read at hr
  split at hr
  next h =>
    split at hr
    next =>
      split at hr
      next v hv =>
        cases hr
        exact ⟨h, ha entry value hv⟩
      next => contradiction
    next => contradiction
  next => contradiction

theorem ready_has_every_dependency {bound current : Context} {fetched : Nat → Option α}
    {needed : List Nat} {entry : Nat} {value : α}
    (hr : read bound current fetched needed entry = .ready value) :
    ∀ p ∈ needed, (fetched p).isSome = true := by
  unfold read at hr
  split at hr
  next =>
    split at hr
    next h => exact List.all_eq_true.1 h
    next => contradiction
  next => contradiction

theorem missing_dependency_is_not_ready {bound current : Context} {fetched : Nat → Option α}
    {needed : List Nat} {entry p : Nat} (hp : p ∈ needed) (hm : fetched p = none) (value : α) :
    read bound current fetched needed entry ≠ .ready value := by
  intro hr
  have h := ready_has_every_dependency hr p hp
  simp [hm] at h

/-- The projected read supplies no updated kernel or other entry. Hydrating it
    cannot change the authenticated binding that justified the read. -/
def hydrate (context : Context) (fetched : Nat → Option α) (entry : Nat) (value : α) :=
  (context, fun p => if p = entry then some value else fetched p)

theorem hydrate_preserves_context (context : Context) (fetched : Nat → Option α) (entry : Nat) (value : α) :
    (hydrate context fetched entry value).1 = context := rfl

theorem hydrate_preserves_other (context : Context) (fetched : Nat → Option α) (entry other : Nat)
    (value : α) (h : other ≠ entry) :
    (hydrate context fetched entry value).2 other = fetched other := by
  simp [hydrate, h]

end AvenDB.PagedView

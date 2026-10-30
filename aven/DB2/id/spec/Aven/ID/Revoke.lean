import Aven.ID.Caps

/-! # Revocations and acks

A revocation ends a cap and every cap resting on it, and wins over what it had not seen (`id/caps/README.md`, rule 14,
as #1499 restates it). An envelope here is what the docs layer imports: its id, its writer's vault, the cap chain it
writes under (every link's id, root first, so revoking any link reaches it), what it builds on by hash, and the
revocations it acknowledges. Envelopes, logs and hashes are `Aven.Core`'s once it lands; here an id is a string and a
Doc is the list of envelopes a reader holds.

A revocation lives in the Doc, as one of its envelopes, when it ends a cap on that Doc. Otherwise it lives elsewhere
(a cap on a vault's Docs, a group, a device's removal) and reaches the Doc through its kept list, when its revoker held
the Doc, or through another writer's ack. The verdict:

- an envelope whose deps aren't all here **waits**, naming them by hash (`waits_named`);
- a revoked holder's envelope that had seen the revocation never counts, whatever anyone acknowledges: no laundering
  (`seen_never_counts`);
- under a Doc cap, only the revocation's own past is kept (`doc_cap_kept`);
- elsewhere, once the revocation has reached the Doc, only what its kept list or another writer's ack had seen counts
  (`elsewhere_kept`).

`revocation_wins` is the three together. -/

namespace Aven.ID

/-- What the docs layer imports, as caps sees it. -/
structure Envelope where
  id : String
  writer : String
  caps : List String := []
  deps : List String := []
  acks : List String := []
  deriving DecidableEq, Repr

/-- A revocation of `cap`: living in the Doc as the envelope `envelope`, or elsewhere, with a kept list for this Doc
when its revoker held it. -/
structure Revocation where
  id : String
  cap : String
  envelope : Option String := none
  kept : Option (List String) := none
  deriving DecidableEq, Repr

/-- What `id` builds on, transitively, within `fuel` steps. -/
def past (doc : List Envelope) : Nat → String → List String
  | 0, _ => []
  | n + 1, id =>
    match doc.find? (·.id == id) with
    | none => []
    | some e => e.deps ++ e.deps.flatMap (past doc n)

/-- The causal past of `id`: a Doc of `n` envelopes is at most `n` deep. -/
def pastOf (doc : List Envelope) (id : String) : List String := past doc doc.length id

/-- `e` had seen `r`: `r`'s envelope is in `e`'s past, or `e` or something in its past acknowledges `r`. -/
def saw (doc : List Envelope) (e : Envelope) (r : Revocation) : Bool :=
  (match r.envelope with
   | some x => (pastOf doc e.id).contains x
   | none => false) ||
  e.acks.contains r.id ||
  (pastOf doc e.id).any fun d => (doc.find? (·.id == d)).any (·.acks.contains r.id)

/-- The envelopes of other writers in the Doc that acknowledge `r`. -/
def ackers (doc : List Envelope) (e : Envelope) (r : Revocation) : List Envelope :=
  doc.filter fun a => a.acks.contains r.id && a.writer != e.writer

/-- `r` has reached the Doc: it lives in it, its revoker kept a list for it, or another writer acknowledges it. -/
def effective (doc : List Envelope) (e : Envelope) (r : Revocation) : Bool :=
  r.envelope.isSome || r.kept.isSome || !(ackers doc e r).isEmpty

/-- `r` keeps `e`: under a Doc cap, `e` is in the revocation's own past; elsewhere, its kept list names `e` or another
writer's ack had seen it. -/
def keptBy (doc : List Envelope) (e : Envelope) (r : Revocation) : Bool :=
  match r.envelope with
  | some x => (pastOf doc x).contains e.id
  | none => (r.kept.getD []).contains e.id || (ackers doc e r).any fun a => (pastOf doc a.id).contains e.id

/-- `r` ends `e`: `e` writes under the revoked cap, and either had seen `r` or isn't kept by it once it took effect. -/
def rejects (doc : List Envelope) (e : Envelope) (r : Revocation) : Bool :=
  e.caps.contains r.cap && (saw doc e r || (effective doc e r && !keptBy doc e r))

inductive Verdict where
  | counts
  | revoked (revocation : String)
  | waits (missing : List String)
  deriving DecidableEq, Repr

/-- What `e` builds on that isn't here. -/
def missing (doc : List Envelope) (e : Envelope) : List String :=
  e.deps.filter fun d => !doc.any (·.id == d)

/-- The authorized verdict of `e`, with the revocations `rs` the reader holds. -/
def verdict (doc : List Envelope) (rs : List Revocation) (e : Envelope) : Verdict :=
  match missing doc e with
  | [] =>
    match rs.find? (rejects doc e) with
    | some r => .revoked r.id
    | none => .counts
  | m => .waits m

variable {doc : List Envelope} {rs : List Revocation} {e : Envelope}

theorem counts_kept (h : verdict doc rs e = .counts) : ∀ r ∈ rs, rejects doc e r = false := by
  unfold verdict at h
  split at h
  · split at h
    · contradiction
    · rename_i n
      intro r m
      simpa using List.find?_eq_none.mp n r m
  · contradiction

/-- No laundering: a revoked holder's envelope that had seen its revocation never counts. -/
theorem seen_never_counts {r : Revocation} (m : r ∈ rs) (hit : e.caps.contains r.cap = true)
    (s : saw doc e r = true) : verdict doc rs e ≠ .counts := by
  intro h
  have := counts_kept h r m
  simp [rejects, s] at this
  exact this (by simpa using hit)

/-- Under a Doc cap, only the revocation's own past is kept: no other writer's ack can add to it. -/
theorem doc_cap_kept {r : Revocation} {x : String} (m : r ∈ rs) (hit : e.caps.contains r.cap = true)
    (lives : r.envelope = some x) (h : verdict doc rs e = .counts) : (pastOf doc x).contains e.id = true := by
  have := counts_kept h r m
  simp [rejects, effective, keptBy, lives] at this
  simpa using (this (by simpa using hit)).2

/-- Elsewhere, once the revocation has reached the Doc, only what its kept list or another writer's ack had seen
counts. -/
theorem elsewhere_kept {r : Revocation} (m : r ∈ rs) (hit : e.caps.contains r.cap = true)
    (lives : r.envelope = none) (reached : effective doc e r = true) (h : verdict doc rs e = .counts) :
    (r.kept.getD []).contains e.id = true ∨ ∃ a ∈ ackers doc e r, (pastOf doc a.id).contains e.id = true := by
  have := counts_kept h r m
  simp only [rejects, hit, reached, keptBy, lives, Bool.true_and, Bool.or_eq_false_iff, Bool.not_eq_false',
    Bool.or_eq_true, List.any_eq_true] at this
  exact this.2

/-- Revocation wins over what it had not seen (rule 14): the three rules together. -/
theorem revocation_wins {r : Revocation} (m : r ∈ rs) (hit : e.caps.contains r.cap = true)
    (h : verdict doc rs e = .counts) :
    saw doc e r = false ∧
      (∀ x, r.envelope = some x → (pastOf doc x).contains e.id = true) ∧
      (r.envelope = none → effective doc e r = true →
        (r.kept.getD []).contains e.id = true ∨ ∃ a ∈ ackers doc e r, (pastOf doc a.id).contains e.id = true) := by
  refine ⟨?_, fun x l => doc_cap_kept m hit l h, fun l r' => elsewhere_kept m hit l r' h⟩
  cases s : saw doc e r
  · rfl
  · exact absurd h (seen_never_counts m hit s)

/-- A wait names only what the envelope builds on and the reader lacks, by hash, so it can end. -/
theorem waits_named {ms : List String} (h : verdict doc rs e = .waits ms) :
    ms ≠ [] ∧ ∀ d ∈ ms, d ∈ e.deps ∧ doc.any (·.id == d) = false := by
  unfold verdict at h
  split at h
  · split at h <;> contradiction
  · rename_i m n
    cases h
    refine ⟨n, fun d dm => ?_⟩
    simp only [missing, List.mem_filter, Bool.not_eq_true'] at dm
    exact dm

end Aven.ID

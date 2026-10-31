import Aven.ID.Keep
import Aven.ID.Revoke
import Aven.ID.Collections

/-! # Holdings follow caps (A40)

A device or keeper holds only what its caps cover (rule 6: wants ∩ caps), so whenever its coverage shrinks, an honest
peer drops the bytes and keys at its next sync: a delete, for everyone; a Doc leaving a collection; a revoked or
narrowed cap; a withdrawn keep cap. One rule instead of four (Samuel, 31 Oct 2026). Its limit is honest: a copy someone
deliberately took outside avenOS can't be reached by any system.

A peer's sync takes what it fetched and keeps, of everything it holds, what its coverage now covers (`sync`):

- `holds_within_caps`: after its sync, a peer holds nothing outside its coverage, however that shrank;
- `keeps_covered`: and it drops nothing its coverage still covers.

Each shrink is a theorem of its own about coverage, and with `holds_within_caps` it says what a peer holds after:

- a withdrawn keep cap (`Books.withdrawn_dropped`): its keeper holds nothing of a Doc every keep cap listing which its
  issuer withdrew (`withdrawn_not_held`);
- a delete, at a keeper (`Books.deleted_gone`): its keeper holds nothing of the Doc (`deleted_not_held`);
- a delete, at a reader (`delete_ends`): of the Doc's envelopes it holds only the delete and its past (`delete_held`);
- a Doc leaving a collection (`Aven.ID.Collections`): a holder whose cap covers what the collection lists holds nothing
  it no longer lists (`unlisted_not_held`). -/

namespace Aven.ID.Holdings

open Aven.Core

/-- A peer's sync: it takes what it fetched, and keeps, of all it holds, what its coverage covers. -/
def sync {α : Type} (covers : α → Bool) (held fetched : List α) : List α := (held ++ fetched).filter covers

/-- **Holdings follow caps** (A40): after its sync, a peer holds nothing outside its coverage, however that shrank. -/
theorem holds_within_caps {α : Type} {covers : α → Bool} {held fetched : List α} {a : α}
    (h : a ∈ sync covers held fetched) : covers a = true :=
  (List.mem_filter.mp h).2

/-- And it drops nothing its coverage still covers. -/
theorem keeps_covered {α : Type} {covers : α → Bool} {held fetched : List α} {a : α} (m : a ∈ held)
    (c : covers a = true) : a ∈ sync covers held fetched :=
  List.mem_filter.mpr ⟨List.mem_append_left _ m, c⟩

/-- **A withdrawn keep cap's Docs leave its keeper** (D2): after its sync, a keeper holds nothing of a Doc every keep
cap listing which its issuer withdrew, neither bytes nor fetch keys. -/
theorem withdrawn_not_held {α : Type} (b : Books) {d : DocId}
    (w : ∀ l ∈ b.listings, (∃ k, (d, k) ∈ l.docs) → b.withdrawn l.cap = true) (held fetched : List (DocId × α)) :
    ∀ x ∈ sync (fun x => b.keeps x.1) held fetched, x.1 ≠ d := by
  intro x m e
  have k := holds_within_caps m
  rw [e, b.withdrawn_dropped w] at k
  cases k

/-- **A deleted Doc leaves its keeper** (D3): after its sync, a keeper holds nothing of a Doc its vault deleted, while
only that vault lists it. -/
theorem deleted_not_held {α : Type} (b : Books) {d : DocId} {v : String}
    (del : ∃ o ∈ b.orders, o.order = .delete d ∧ b.tree.actsFor o.signer = some v)
    (only : ∀ l ∈ b.listings, (∃ k, (d, k) ∈ l.docs) → l.cap.issuer = v) (held fetched : List (DocId × α)) :
    ∀ x ∈ sync (fun x => b.keeps x.1) held fetched, x.1 ≠ d := by
  intro x m e
  have k := holds_within_caps m
  rw [e, (b.deleted_gone del only).1] at k
  cases k

/-- **A delete ends what a reader holds** (A22): after its sync, a reader holding a delete its vault wrote holds of the
Doc's envelopes only the delete and what is before it. Its device forgets the rest, and the Doc's keys with them. -/
theorem delete_held {nm : Envelope → Hash} {isDelete byOwner : Envelope → Bool} {held fetched : List Envelope}
    {d : Envelope} (hd : d ∈ held ++ fetched) (del : isDelete d = true) (own : byOwner d = true) :
    ∀ e ∈ sync (survives nm isDelete byOwner (held ++ fetched)) held fetched,
      nm d = nm e ∨ Past.Before nm (held ++ fetched) d e := by
  intro e m
  exact delete_ends hd del own (List.mem_filter.mp m).1 (holds_within_caps m)

/-- **A Doc that leaves a collection leaves its holders** (A32): after its sync, a holder whose cap covers what
collection `c` lists holds nothing of a Doc `c` no longer lists. -/
theorem unlisted_not_held {gov : Bytes → Bytes → Bool} {spawned listed : DocId → DocId → Bool} {c : DocId}
    {held fetched : List Facts} {f : Facts} (other : f.id ≠ c) (gone : listed c f.id = false) :
    f ∉ sync ((Target.doc c .lists).coversB gov spawned listed) held fetched := by
  intro m
  have k := holds_within_caps m
  simp [Target.coversB, other, gone] at k

end Aven.ID.Holdings

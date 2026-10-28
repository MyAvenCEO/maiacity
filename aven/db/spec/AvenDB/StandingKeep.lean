/-!
# A device's removal concerns only what rests on an edit it cuts (Fix E, 2026-10-28)

In the middle of a catch-up a device answers a peer by the replay it holds, but nothing a removal since concerns
(`StandingReplay.answerFor`). Until 2026-10-28 a device's removal concerned every peer whenever the removed device had
ever signed a share of a vault (`Lab::standing_for`'s `shared_by`): so an iPhone in the middle of its catch-up of Maia
City, whose history holds removals of devices that once added others, handed its Mac nothing at all, its own new chat
message among it, for as long as its catch-up ran (Samuel 2026-10-28 19:21, "Hskfbs" never reached the Mac).

What a device's removal takes away: the removed device itself, and every edit it had signed that the removal had not
seen (`keep`), which falls with it (`policy::State::remove`, `drop_unseen`). An edit it had seen and keeps stands. So a
removal can take a permission away only from its holder, or by cutting an edit the permission rests on: one the
removed device signed that the removal doesn't keep. Where neither is so, what the replay a device holds allows of
that permission, all its edits allow (`may_mono_kept`): it answers that permission by its replay, and the rest it
answers nothing of till caught up (`answerKept`, `answerKept_safe`).

The model: a permission `p` is its holder's (`holder p`), and rests on any grant of it; a grant is an edit with its id
and its signer. A removal of device `x` that keeps `keep` takes away every permission of `x`'s, and cuts every grant
`x` signed whose id `keep` doesn't name, wherever it stands among the edits: a removal cuts what it hadn't seen, which
came before or after it alike. Rust: `Lab::standing_for` and `Lab::concerned`, a removal of a device concerning a peer
when it removes that peer, or doesn't keep an edit of a vault's, a share's or an audience's log the removed device
signed (on any of which a peer's standing may rest: its own addition, an owner, a grant, an audience's key); and a log
of an entry when it doesn't keep an edit of that log the removed device signed. Every other removal concerns every
peer, as before.
-/

namespace AvenDB.StandingKeep

/-- An edit, as far as who may do what: a grant of permission `p` with its id and signer, a device's removal with the
    ids it keeps, or anything else. -/
inductive Edit where
  | grant (id signer p : Nat)
  | remove (x : Nat) (keep : List Nat)
  | other
  deriving DecidableEq, Repr

/-- A removal among `es` of device `h`. -/
def removed (es : List Edit) (h : Nat) : Bool :=
  es.any fun e => match e with
    | .remove x _ => x == h
    | _ => false

/-- A removal among `es` cuts the grant `id` that `s` signed: one of `s` that doesn't keep it. -/
def cut (es : List Edit) (id s : Nat) : Bool :=
  es.any fun e => match e with
    | .remove x keep => x == s && !keep.contains id
    | _ => false

/-- A grant of `p` among `es` that no removal among `all` cuts. -/
def granted (all es : List Edit) (p : Nat) : Bool :=
  es.any fun e => match e with
    | .grant id s q => q == p && !cut all id s
    | _ => false

/-- What the edits allow: `p`, while its holder isn't removed and a grant of it stands. -/
def may (holder : Nat → Nat) (es : List Edit) (p : Nat) : Bool :=
  !removed es (holder p) && granted es es p

/-- Whether removal `r` concerns permission `p`, by all the edits a device holds, `all`: it removes `p`'s holder, or
    cuts a grant of `p` among them. -/
def concerns (holder : Nat → Nat) (all : List Edit) (p : Nat) : Edit → Bool
  | .remove x keep => x == holder p || all.any fun e => match e with
      | .grant id s q => q == p && s == x && !keep.contains id
      | _ => false
  | _ => false

theorem removed_append (a b : List Edit) (h : Nat) : removed (a ++ b) h = (removed a h || removed b h) := by
  simp [removed, List.any_append]

theorem cut_append (a b : List Edit) (id s : Nat) : cut (a ++ b) id s = (cut a id s || cut b id s) := by
  simp [cut, List.any_append]

/-- No removal since that concerns `p` removes its holder. -/
theorem not_removed_since (holder : Nat → Nat) (since all : List Edit) (p : Nat)
    (h : since.all (fun r => !concerns holder all p r) = true) : removed since (holder p) = false := by
  simp only [removed, List.any_eq_false]
  intro e he
  have := List.all_eq_true.mp h e he
  cases e with
  | remove x keep =>
    simp only [concerns, Bool.not_or, Bool.and_eq_true, Bool.not_eq_true'] at this
    simpa using this.1
  | grant => simp
  | other => simp

/-- No removal since that concerns `p` cuts a grant of `p` among `all`. -/
theorem not_cut_since (holder : Nat → Nat) (since all : List Edit) (p id s : Nat)
    (h : since.all (fun r => !concerns holder all p r) = true) (hg : Edit.grant id s p ∈ all) : cut since id s = false := by
  simp only [cut, List.any_eq_false]
  intro e he
  have hc := List.all_eq_true.mp h e he
  cases e with
  | remove x keep =>
    simp only [concerns, Bool.not_or, Bool.and_eq_true, Bool.not_eq_true'] at hc
    have hall := hc.2
    simp only [List.any_eq_false] at hall
    have := hall _ hg
    simp only [beq_self_eq_true, Bool.true_and, Bool.and_eq_true, Bool.not_eq_true', not_and] at this
    intro hx
    simp only [Bool.and_eq_true, beq_iff_eq, Bool.not_eq_true'] at hx
    obtain ⟨rfl, hk⟩ := hx
    simp_all
  | grant => simp
  | other => simp

/-- With no removal since that concerns `p`, what the held replay allows of `p`, all the edits allow. -/
theorem may_mono_kept (holder : Nat → Nat) (since held : List Edit) (p : Nat)
    (h : since.all (fun r => !concerns holder (since ++ held) p r) = true) (hp : may holder held p = true) :
    may holder (since ++ held) p = true := by
  simp only [may, Bool.and_eq_true, Bool.not_eq_true'] at hp ⊢
  obtain ⟨hr, hgr⟩ := hp
  refine ⟨?_, ?_⟩
  · rw [removed_append, not_removed_since holder since _ p h, hr]; rfl
  · simp only [granted, List.any_eq_true] at hgr ⊢
    obtain ⟨e, he, hg⟩ := hgr
    refine ⟨e, List.mem_append_right _ he, ?_⟩
    cases e with
    | grant id s q =>
      simp only [Bool.and_eq_true, beq_iff_eq, Bool.not_eq_true'] at hg ⊢
      obtain ⟨rfl, hc⟩ := hg
      refine ⟨rfl, ?_⟩
      rw [cut_append, not_cut_since holder since _ q id s h (List.mem_append_right _ he), hc]; rfl
    | remove => simp at hg
    | other => simp at hg

/-- What a device answers of the permissions `asks` in the middle of a catch-up: by the replay it holds, but none a
    removal since concerns; not catching up, by every edit it holds. -/
def answerKept (holder : Nat → Nat) (catching : Bool) (since held : List Edit) (asks : List Nat) : List Nat :=
  if catching then asks.filter fun p => since.all (fun r => !concerns holder (since ++ held) p r) && may holder held p
  else asks.filter (may holder (since ++ held))

/-- Whatever it answers, all its edits allow. -/
theorem answerKept_safe (holder : Nat → Nat) (catching : Bool) (since held : List Edit) (asks : List Nat) (p : Nat)
    (hp : p ∈ answerKept holder catching since held asks) : may holder (since ++ held) p = true := by
  unfold answerKept at hp
  split at hp
  · simp only [List.mem_filter, Bool.and_eq_true] at hp
    exact may_mono_kept holder since held p hp.2.1 hp.2.2
  · simp only [List.mem_filter] at hp
    exact hp.2

namespace Examples

-- permission 1 is device 7's (the Mac's), granted by device 3 (an old iPad) as edit 10; permission 2 is device 8's
def holder : Nat → Nat := fun p => if p = 1 then 7 else 8
def held : List Edit := [.grant 10 3 1, .grant 11 3 2]

-- the iPad removed later, keeping the grant it had seen: the Mac is still answered, not held back for the catch-up
#guard answerKept holder true [.remove 3 [10, 11]] held [1, 2] == [1, 2]
#guard may holder ([.remove 3 [10, 11]] ++ held) 1
-- a removal that didn't see the grant cuts it, so it concerns that permission alone, the other still answered
#guard answerKept holder true [.remove 3 [11]] held [1, 2] == [2]
#guard !may holder ([.remove 3 [11]] ++ held) 1
-- the Mac's own removal concerns what is the Mac's
#guard answerKept holder true [.remove 7 [10, 11]] held [1, 2] == [2]
-- caught up, every edit answers
#guard answerKept holder false [.remove 3 [11]] held [1, 2] == [2]

end Examples

end AvenDB.StandingKeep

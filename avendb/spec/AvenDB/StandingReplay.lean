/-!
# What a device answers with in the middle of a catch-up (G5)

A device that took edits it hasn't replayed yet (a pull's pages before its last, a first sync's backlog) still answers
its peers and checks its person's writes in the meantime. Until 2026-10-27 each such call replayed every edit it held
first (`Lab::latest`): a peer's ask or a person's write in the middle of a first sync of 130,000 edits held the Lab
10-24 s.

Now it answers by the replay it holds (`Lab::standing`) where the edits it took since hold no removal: those can only
add to what anyone may do. `step` models an edit: a grant adds a permission, a removal takes one away. `may` is what
the edits allow. With no removal among the edits since, whatever the replay it holds allows, all of them allow
(`may_mono`): a peer is handed no edit it may not have (`answer_safe`), and a write the replay accepts all of them
accept (`write_safe`). It may hand over less, or refuse a write that leans on an edit not replayed yet, until the
catch-up's next steps: never more. Where a removal came, it replays every edit first, as before (`Examples`).
-/

namespace AvenDB.StandingReplay

/-- An edit, as far as who may do what: a grant of permission `p`, a removal of it, or anything else. -/
inductive Edit where
  | grant (p : Nat)
  | remove (p : Nat)
  | other
  deriving DecidableEq, Repr

def Edit.isRemoval : Edit → Bool
  | .remove _ => true
  | _ => false

/-- What the edits allow, in their order. -/
def may : List Edit → Nat → Bool
  | [], _ => false
  | e :: es, p =>
    match e with
    | .grant q => if q = p then true else may es p
    | .remove q => if q = p then false else may es p
    | .other => may es p

/-- The edits are replayed newest first here: `may (since ++ held)`. With no removal among those since, what the held
    ones allow, all of them allow. -/
theorem may_mono (since held : List Edit) (h : since.all (fun e => !e.isRemoval) = true) (p : Nat)
    (hp : may held p = true) : may (since ++ held) p = true := by
  induction since with
  | nil => simpa using hp
  | cons e es ih =>
    simp only [List.all_cons, Bool.and_eq_true] at h
    obtain ⟨he, hes⟩ := h
    cases e with
    | grant q => simp only [List.cons_append, may]; split <;> simp_all
    | remove q => simp [Edit.isRemoval] at he
    | other => simp only [List.cons_append, may]; exact ih hes

/-- A peer is handed what `may` allows it: by the replay it holds, nothing all its edits wouldn't hand it. -/
theorem answer_safe (since held : List Edit) (h : since.all (fun e => !e.isRemoval) = true) (asks : List Nat) :
    asks.filter (may held) ⊆ asks.filter (may (since ++ held)) := by
  intro p hp
  simp only [List.mem_filter] at hp ⊢
  exact ⟨hp.1, may_mono since held h p hp.2⟩

/-- A write needing permission `p` that the replay it holds accepts, all its edits accept. -/
theorem write_safe (since held : List Edit) (h : since.all (fun e => !e.isRemoval) = true) (p : Nat)
    (ok : may held p = true) : may (since ++ held) p = true :=
  may_mono since held h p ok

/-- What a device answers by (`Lab::standing`): the replay it holds only while a catch-up steps it on (`catching`) and
    no removal came since, else all of its edits. -/
def answerBy (catching : Bool) (since held : List Edit) : List Edit :=
  if catching && since.all (fun e => !e.isRemoval) then held else since ++ held

/-- A device that isn't catching up answers by every edit it holds: nothing steps a lagging replay on, so it never
    answers from a state behind its log (2026-10-28: a drive asked after a receive was told nothing of the newest
    note, for good). -/
theorem answer_current (since held : List Edit) : answerBy false since held = since ++ held := by
  simp [answerBy]

/-- Whatever it answers by, it hands over nothing all its edits wouldn't. -/
theorem answerBy_safe (catching : Bool) (since held : List Edit) (p : Nat) (hp : may (answerBy catching since held) p = true) :
    may (since ++ held) p = true := by
  unfold answerBy at hp
  split at hp
  · rename_i h
    simp only [Bool.and_eq_true] at h
    exact may_mono since held h.2 p hp
  · exact hp

/-- What a device answers its peers by (`Lab::standing_or`): as `answerBy`, but nothing where that would be every edit
    it holds in the middle of a catch-up, a removal among those since, rather than replay them all for each ask. A
    first sync of Maia City, its pages holding removals, replayed every edit for each page's announce and never ended
    (S2, 2026-10-28). -/
def answerOr (catching : Bool) (since held : List Edit) : Option (List Edit) :=
  if catching && !since.all (fun e => !e.isRemoval) then none else some (answerBy catching since held)

/-- A device not catching up answers by every edit it holds, as `answer_current` says: never nothing. -/
theorem answerOr_current (since held : List Edit) : answerOr false since held = some (since ++ held) := by
  simp [answerOr, answerBy]

/-- It answers nothing only in the middle of a catch-up, whose steps end it (`CatchUpBudget.ends_within`). -/
theorem answerOr_none_catching (catching : Bool) (since held : List Edit) (h : answerOr catching since held = none) :
    catching = true := by
  unfold answerOr at h
  cases catching <;> simp_all

/-- What it answers by, when it answers, hands over nothing all its edits wouldn't. -/
theorem answerOr_safe (catching : Bool) (since held es : List Edit) (h : answerOr catching since held = some es) (p : Nat)
    (hp : may es p = true) : may (since ++ held) p = true := by
  unfold answerOr at h
  split at h
  · cases h
  · cases h
    exact answerBy_safe catching since held p hp

namespace Examples

-- a grant since: the held replay allows less, never more
#guard may [.grant 1] 1 && !may [] 1
-- a removal since: the held replay would allow what all of them don't, so it replays every edit first
#guard may [.grant 1] 1 && !may ([.remove 1] ++ [.grant 1]) 1

-- not catching up, a grant since is answered by: the newest edit is never left out
#guard may (answerBy false [.grant 1] []) 1 && !may (answerBy true [.grant 1] []) 1

-- in the middle of a catch-up, a removal since: nothing, not a replay of every edit; caught up: every edit
#guard answerOr true [.remove 1] [.grant 1] == none && answerOr false [.remove 1] [.grant 1] == some [.remove 1, .grant 1]

end Examples

end AvenDB.StandingReplay

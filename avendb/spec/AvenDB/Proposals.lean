import AvenDB.Step
import AvenDB.Doc

/-!
# Proposals, write by write

Every write extends one line of its entry's history (`Write.line`): the main line, or a proposal, which a write starts
(`Proposal.new`) from the version its `deps` name. A line's history is its own writes and every write they build on
(`history`), and what a device shows on a line is Loro's content of the updates in that history (`content`). A merge
is a write on a line that also builds on another line's heads, whose update brings the line to `Doc.lean`'s
`mergeInto` of the base, what both lines' histories hold in common (`base`), and of what each line shows.

T10f to T10h tie `Doc.lean`'s merge to the writes. A write on one line leaves every other line as it was, so main
stays unchanged until a write on it merges a proposal (T10f). A merge's history is the union of both lines' (T10g), so
by Loro's convergence it shows `Doc.lean`'s merge of the two histories, for which T10a to T10c hold; and its update
makes the line show exactly `mergeInto` (T10h), for which T10d and T10e hold: nothing the line changed since the base is
lost, and all the other line changed alone lands.

A line counts its releases (`releases`): its start, an entry's creation for the main line or a draft's or a proposal's
start for its own, and each write on it that brings in writes the line's history held nowhere in that write's own past
(`brings`), a merge of another line. Direct edits make no release. A release's number is one more than the highest
number among the line's releases in its past (T10i), so it is judged on its past alone: the same past gives the same
number whatever order the writes came in, and a number never changes as more writes come (T10j). Two merges made apart
share their number, and the next release counts past both. A version reads as the highest release it holds and how many
of the line's writes it holds after it (`describe`), and a release reads as itself (T10k).
-/

namespace AvenDB

-- a line's history (`history`) and the writes it reaches back to (`reach`) are in `State.lean`, where a draft's
-- landing reads them

/-- The writes of `h` that no write of `h` builds on. -/
def tips (h : List Write) : List EditId :=
  (h.filter fun w => !h.any (·.deps.contains w.edit)).map (·.edit)

/-- The heads of line `l`: what the next write on it builds on. -/
def heads (ws : List Write) (e : EntryId) (l : Option EditId) : List EditId :=
  tips (history ws e l)

/-- What a device holding the writes `ws` shows on line `l`: Loro's content of the updates in the line's history,
    each named by its write's id. -/
def content {P V : Type} (L : Loro P V) (ws : List Write) (e : EntryId) (l : Option EditId) : Rec P V :=
  L.materialize ((history ws e l).map (·.edit))

/-- The base of a merge of line `l'` into line `l`: what Loro shows of the writes both lines' histories hold. -/
def base {P V : Type} (L : Loro P V) (ws : List Write) (e : EntryId) (l l' : Option EditId) : Rec P V :=
  L.materialize (((history ws e l).filter fun w => (history ws e l').any (·.edit == w.edit)).map (·.edit))

/-- The writes come in an order their dependencies respect: no two share an id, and none builds on itself or on one
    after it. Every peer's writes do (`writes_ordered`). -/
def Ordered (ws : List Write) : Prop :=
  (ws.map (·.edit)).Nodup ∧ ws.Pairwise (fun a b => b.edit ∉ a.deps) ∧ ∀ w ∈ ws, w.edit ∉ w.deps

/-! ## Version numbers

A line's releases and their numbers, as `History::releases` counts them, and a version by its releases, as
`History::describe` reads it.
-/

/-- The past of write `w`: every write of its entry it builds on, directly or not. -/
def past (ws : List Write) (w : Write) : List Write :=
  reach ws w.entry fun x => w.deps.contains x.edit

/-- The aven of coop `c`: the one aven it owns alone (`Kind.rules`), if it has one. -/
def avenOf (st : State) (c : VaultId) : Option VaultId :=
  (st.vaults.find? fun v => v.kind == .aven && v.owners == [.vault c]).map (·.id)

/-- The vault write `w` was signed in: the vault its device belongs to, the last owner it acted through, or the vault it
    acted for where it acted directly, as an aven's server does. -/
def signedIn (w : Write) : VaultId := w.via.getLast?.getD w.actor

/-- Who wrote version `heads` of entry `e` (Samuel 2026-10-18: never the coop, always its aven and its human
    collaborators): the aven of the entry's vault, where that vault is a coop with one, first; then the vault each
    counted write of that version was signed in (`signedIn`), each once, in the order they first wrote, where it is a
    human vault or an aven. The Rust core's `world::authors`. -/
def authors (st : State) (e : EntryId) (heads : List EditId) : List VaultId :=
  let vault := (st.entries.find? (·.id == e)).map (·.vault)
  let aven := vault.bind fun v => if (st.vault? v).any (·.kind == .coop) then avenOf st v else none
  let signed := (reach st.counted e (heads.contains ·.edit)).map signedIn |>.filter fun v =>
    (st.vault? v).any fun vt => vt.kind == .human || vt.kind == .aven
  (aven.toList ++ signed).eraseDups

/-- Write `w` brings in writes its line's history held nowhere in its own past: some write it builds on is outside the
    history of its line among its past. Judged on its past alone, never on what came beside it. -/
def brings (ws : List Write) (w : Write) : Bool :=
  w.deps.any fun d => !(history (past ws w) w.entry w.line).any (·.edit == d)

/-- Write `w` is a release of line `l` of entry `e`: it is on the line, and it starts it (an entry's creation, a
    draft's or a proposal's start) or brings in writes, a merge of another line. A direct edit is no release. -/
def isRelease (ws : List Write) (e : EntryId) (l : Option EditId) (w : Write) : Bool :=
  w.entry == e && w.line == l && (w.first || w.proposal == .new || brings ws w)

/-- The number a list of numbered writes gives write `d`: 0 if it numbers none. -/
def numberIn (ns : List (EditId × Nat)) (d : EditId) : Nat :=
  (ns.lookup d).getD 0

/-- Number write `w` on line `l` of entry `e`: the highest number among the writes it builds on, one more if it is a
    release. A write of another entry is skipped. -/
def numberStep (ws : List Write) (e : EntryId) (l : Option EditId) (ns : List (EditId × Nat)) (w : Write) :
    List (EditId × Nat) :=
  if w.entry == e then
    (w.edit, (w.deps.map (numberIn ns)).foldr max 0 + if isRelease ws e l w then 1 else 0) :: ns
  else ns

/-- Every write of entry `e` numbered on line `l`, in one pass over the writes in their order. -/
def numbering (ws : List Write) (e : EntryId) (l : Option EditId) : List (EditId × Nat) :=
  ws.foldl (numberStep ws e l) []

/-- The number of write `w` on line `l` of entry `e`: the highest number among the line's releases it holds, 0 if it
    holds none. A release's number is its version on the line. -/
def number (ws : List Write) (e : EntryId) (l : Option EditId) (w : Write) : Nat :=
  numberIn (numbering ws e l) w.edit

/-- The releases of line `l` of entry `e`, in the writes' order, each with its number (`History::releases`). -/
def releases (ws : List Write) (e : EntryId) (l : Option EditId) : List (EditId × Nat) :=
  (ws.filter (isRelease ws e l)).map fun w => (w.edit, number ws e l w)

/-- The version that is release `n` of line `l`: the line's releases of that number, together, as two merges made
    apart share one (`History::release`). -/
def release (ws : List Write) (e : EntryId) (l : Option EditId) (n : Nat) : List EditId :=
  ((releases ws e l).filter (·.2 == n)).map (·.1)

/-- The writes of entry `e` that the version `v` holds: its heads and everything they build on. -/
def holds (ws : List Write) (e : EntryId) (v : List EditId) : List Write :=
  reach ws e fun x => v.contains x.edit

/-- A version of a line by its releases: the highest number among the line's releases it holds, `none` before the
    line's first, and how many of the line's writes it holds after them. -/
structure Described where
  version : Option Nat
  edits   : Nat
  deriving DecidableEq, Repr

/-- The version `v` of line `l` of entry `e` by its releases (`History::describe`), as `git describe` names a commit
    by its tag and the commits since: the highest number among the line's releases it holds, and how many of the
    line's writes it holds that the releases of that number don't. -/
def describe (ws : List Write) (e : EntryId) (l : Option EditId) (v : List EditId) : Described :=
  let held := holds ws e v
  let rs := (releases ws e l).filter fun r => held.any (·.edit == r.1)
  let mine := held.filter (·.line == l)
  if rs.isEmpty then ⟨none, mine.length⟩ else
    let n := (rs.map (·.2)).foldr max 0
    let released := holds ws e ((rs.filter (·.2 == n)).map (·.1))
    ⟨some n, (mine.filter fun x => !released.any (·.edit == x.edit)).length⟩

/-! ## Reaching back along the dependencies -/

theorem reach_cons (w : Write) (ws : List Write) (e : EntryId) (s : Write → Bool) :
    reach (w :: ws) e s =
      if w.entry == e && (s w || (reach ws e s).any (·.deps.contains w.edit))
      then w :: reach ws e s else reach ws e s := rfl

theorem mem_reach_cons {w x : Write} {ws : List Write} {e : EntryId} {s : Write → Bool} :
    x ∈ reach (w :: ws) e s ↔
      (x = w ∧ w.entry = e ∧ (s w = true ∨ ∃ y ∈ reach ws e s, w.edit ∈ y.deps)) ∨
        x ∈ reach ws e s := by
  rw [reach_cons]
  split
  · rename_i h
    simp only [Bool.and_eq_true, beq_iff_eq, Bool.or_eq_true, List.any_eq_true, List.contains_iff_mem] at h
    simp only [List.mem_cons]
    constructor
    · rintro (rfl | hx)
      · exact .inl ⟨rfl, h.1, h.2⟩
      · exact .inr hx
    · rintro (⟨rfl, -⟩ | hx)
      · exact .inl rfl
      · exact .inr hx
  · rename_i h
    simp only [Bool.and_eq_true, beq_iff_eq, Bool.or_eq_true, List.any_eq_true, List.contains_iff_mem] at h
    constructor
    · exact .inr
    · rintro (⟨rfl, he, hw⟩ | hx)
      · exact absurd ⟨he, hw⟩ h
      · exact hx

/-- What `reach` collects is among the writes, of the entry. -/
theorem mem_reach {x : Write} {ws : List Write} {e : EntryId} {s : Write → Bool}
    (h : x ∈ reach ws e s) : x ∈ ws ∧ x.entry = e := by
  induction ws with
  | nil => simp [reach] at h
  | cons w ws ih =>
    rcases mem_reach_cons.1 h with ⟨rfl, he, -⟩ | h
    · exact ⟨List.mem_cons_self, he⟩
    · obtain ⟨hx, he⟩ := ih h
      exact ⟨List.mem_cons_of_mem _ hx, he⟩

/-- A write added last is collected only as a seed, and then everything it builds on is too. -/
theorem reach_snoc (ws : List Write) (m : Write) (e : EntryId) (s : Write → Bool) :
    reach (ws ++ [m]) e s =
      if m.entry == e && s m then reach ws e (fun w => s w || m.deps.contains w.edit) ++ [m]
      else reach ws e s := by
  induction ws with
  | nil => simp [reach]
  | cons w ws ih =>
    rw [List.cons_append, reach_cons, ih]
    split
    · rw [reach_cons]
      simp only [List.any_append, List.any_cons, List.any_nil, Bool.or_assoc, Bool.or_comm (m.deps.contains w.edit),
        Bool.false_or]
      split
      · rw [List.cons_append]
      · rfl
    · rfl

/-- More seeds, among the writes, collect more. -/
theorem reach_mono {ws : List Write} {e : EntryId} {s t : Write → Bool}
    (h : ∀ w ∈ ws, s w = true → t w = true) : ∀ x ∈ reach ws e s, x ∈ reach ws e t := by
  induction ws with
  | nil => simp [reach]
  | cons w ws ih =>
    have ih := ih fun x hx => h x (List.mem_cons_of_mem _ hx)
    intro x hx
    rcases mem_reach_cons.1 hx with ⟨rfl, he, hw⟩ | hx
    · refine mem_reach_cons.2 (.inl ⟨rfl, he, ?_⟩)
      rcases hw with hw | ⟨y, hy, hd⟩
      · exact .inl (h _ List.mem_cons_self hw)
      · exact .inr ⟨y, ih y hy, hd⟩
    · exact mem_reach_cons.2 (.inr (ih x hx))

/-- What two kinds of seeds collect together is what each collects. -/
theorem reach_or {ws : List Write} {e : EntryId} {s t : Write → Bool} :
    ∀ x ∈ reach ws e (fun w => s w || t w), x ∈ reach ws e s ∨ x ∈ reach ws e t := by
  induction ws with
  | nil => simp [reach]
  | cons w ws ih =>
    intro x hx
    rcases mem_reach_cons.1 hx with ⟨rfl, he, hw⟩ | hx
    · rcases hw with hw | ⟨y, hy, hd⟩
      · rcases Bool.or_eq_true _ _ ▸ hw with hw | hw
        · exact .inl (mem_reach_cons.2 (.inl ⟨rfl, he, .inl hw⟩))
        · exact .inr (mem_reach_cons.2 (.inl ⟨rfl, he, .inl hw⟩))
      · rcases ih y hy with hy | hy
        · exact .inl (mem_reach_cons.2 (.inl ⟨rfl, he, .inr ⟨y, hy, hd⟩⟩))
        · exact .inr (mem_reach_cons.2 (.inl ⟨rfl, he, .inr ⟨y, hy, hd⟩⟩))
    · rcases ih x hx with hx | hx
      · exact .inl (mem_reach_cons.2 (.inr hx))
      · exact .inr (mem_reach_cons.2 (.inr hx))

/-- Seeds that `s` already collects collect nothing more. -/
theorem reach_within {ws : List Write} {e : EntryId} {s t : Write → Bool}
    (hnd : (ws.map (·.edit)).Nodup)
    (h : ∀ w ∈ ws, w.entry = e → t w = true → w ∈ reach ws e s) :
    ∀ x ∈ reach ws e t, x ∈ reach ws e s := by
  induction ws with
  | nil => simp [reach]
  | cons w ws ih =>
    rw [List.map_cons, List.nodup_cons] at hnd
    -- a seed among the later writes is collected among them: it isn't `w`, whose id comes once
    have ih := ih hnd.2 fun z hz he ht => by
      rcases mem_reach_cons.1 (h z (List.mem_cons_of_mem _ hz) he ht) with ⟨rfl, -⟩ | hz'
      · exact absurd (List.mem_map_of_mem hz) hnd.1
      · exact hz'
    intro x hx
    rcases mem_reach_cons.1 hx with ⟨rfl, he, hw⟩ | hx
    · rcases hw with hw | ⟨y, hy, hd⟩
      · exact h _ List.mem_cons_self he hw
      · exact mem_reach_cons.2 (.inl ⟨rfl, he, .inr ⟨y, ih y hy, hd⟩⟩)
    · exact mem_reach_cons.2 (.inr (ih x hx))

/-- Two writes with one id are one, where ids come once. -/
theorem eq_of_edit_eq {ws : List Write} (hnd : (ws.map (·.edit)).Nodup) {a b : Write} (ha : a ∈ ws) (hb : b ∈ ws)
    (h : a.edit = b.edit) : a = b := by
  induction ws with
  | nil => simp at ha
  | cons w ws ih =>
    rw [List.map_cons, List.nodup_cons] at hnd
    rw [List.mem_cons] at ha hb
    rcases ha with ha | ha <;> rcases hb with hb | hb
    · exact ha.trans hb.symm
    · exact absurd (by rw [← ha, h]; exact List.mem_map_of_mem hb) hnd.1
    · exact absurd (by rw [← hb, ← h]; exact List.mem_map_of_mem ha) hnd.1
    · exact ih hnd.2 ha hb

theorem mem_tips {h : List Write} {d : EditId} :
    d ∈ tips h ↔ ∃ w ∈ h, (∀ y ∈ h, w.edit ∉ y.deps) ∧ w.edit = d := by
  simp [tips, and_assoc]

/-- The tips of what `s` collects collect it all again: everything there is built on by a tip. -/
theorem reach_tips {ws : List Write} (hord : Ordered ws) {e : EntryId} {s : Write → Bool}
    (x : Write) :
    x ∈ reach ws e (fun w => (tips (reach ws e s)).contains w.edit) ↔ x ∈ reach ws e s := by
  obtain ⟨hnd, hpw, hself⟩ := hord
  constructor
  · -- each tip is a write `s` collects, the only one with its id
    refine reach_within hnd (fun w hw _ ht => ?_) x
    obtain ⟨y, hy, -, hyw⟩ := mem_tips.1 (List.contains_iff_mem.1 ht)
    rwa [eq_of_edit_eq hnd (mem_reach hy).1 hw hyw] at hy
  · revert x
    induction ws with
    | nil => simp [reach]
    | cons w ws ih =>
      rw [List.map_cons, List.nodup_cons] at hnd
      rw [List.pairwise_cons] at hpw
      have ih := ih hnd.2 hpw.2 fun x hx => hself x (List.mem_cons_of_mem _ hx)
      -- a tip of what the later writes collect is a tip of it all: `w` builds on nothing after it
      have hmono : ∀ x ∈ reach ws e (fun z => (tips (reach ws e s)).contains z.edit),
          x ∈ reach ws e (fun z => (tips (reach (w :: ws) e s)).contains z.edit) := by
        refine reach_mono fun z _ hz => ?_
        obtain ⟨y, hy, hnot, hyz⟩ := mem_tips.1 (List.contains_iff_mem.1 hz)
        refine List.contains_iff_mem.2 (mem_tips.2 ⟨y, mem_reach_cons.2 (.inr hy), fun u hu => ?_, hyz⟩)
        rcases mem_reach_cons.1 hu with ⟨rfl, -⟩ | hu
        · exact hpw.1 y (mem_reach hy).1
        · exact hnot u hu
      intro x hx
      rcases mem_reach_cons.1 hx with ⟨rfl, he, -⟩ | hx
      · refine mem_reach_cons.2 (.inl ⟨rfl, he, ?_⟩)
        by_cases hb : ∃ y ∈ reach ws e s, x.edit ∈ y.deps
        · obtain ⟨y, hy, hd⟩ := hb
          exact .inr ⟨y, hmono y (ih y hy), hd⟩
        · -- nothing after `w` builds on it, nor does `w` itself: `w` is a tip
          refine .inl (List.contains_iff_mem.2 (mem_tips.2 ⟨x, hx, fun u hu hd => ?_, rfl⟩))
          rcases mem_reach_cons.1 hu with ⟨rfl, -⟩ | hu
          · exact hself _ List.mem_cons_self hd
          · exact hb ⟨u, hu, hd⟩
      · exact mem_reach_cons.2 (.inr (hmono x (ih x hx)))

/-- What `reach` collects is the least that holds its seeds and every write of the entry one of it builds on: what holds
    of the seeds and passes back along the dependencies holds of all it collects. -/
theorem reach_induct {ws : List Write} {e : EntryId} {s : Write → Bool} (C : Write → Prop)
    (hs : ∀ x ∈ ws, x.entry = e → s x = true → C x)
    (hd : ∀ x ∈ ws, x.entry = e → ∀ y ∈ ws, y.entry = e → C y → x.edit ∈ y.deps → C x) :
    ∀ x ∈ reach ws e s, C x := by
  induction ws with
  | nil => simp [reach]
  | cons w ws ih =>
    have ih := ih (fun x hx => hs x (List.mem_cons_of_mem _ hx))
      (fun x hx he y hy => hd x (List.mem_cons_of_mem _ hx) he y (List.mem_cons_of_mem _ hy))
    intro x hx
    rcases mem_reach_cons.1 hx with ⟨rfl, he, hw | ⟨y, hy, hdep⟩⟩ | hx
    · exact hs _ List.mem_cons_self he hw
    · obtain ⟨hy', hye⟩ := mem_reach hy
      exact hd _ List.mem_cons_self he y (List.mem_cons_of_mem _ hy') hye (ih y hy) hdep
    · exact ih x hx

/-- A seed among the writes, of the entry, is collected. -/
theorem mem_reach_of_seed {ws : List Write} {e : EntryId} {s : Write → Bool} {x : Write} (hx : x ∈ ws)
    (he : x.entry = e) (hs : s x = true) : x ∈ reach ws e s := by
  induction ws with
  | nil => simp at hx
  | cons w ws ih =>
    rcases List.mem_cons.1 hx with rfl | hx
    · exact mem_reach_cons.2 (.inl ⟨rfl, he, .inl hs⟩)
    · exact mem_reach_cons.2 (.inr (ih hx))

/-- On writes in order, what `reach` collects holds every write of the entry one of it builds on. -/
theorem reach_closed {ws : List Write} (hord : Ordered ws) {e : EntryId} {s : Write → Bool} {x y : Write}
    (hx : x ∈ reach ws e s) (hy : y ∈ ws) (he : y.entry = e) (hd : y.edit ∈ x.deps) : y ∈ reach ws e s := by
  obtain ⟨-, hpw, hself⟩ := hord
  induction ws with
  | nil => simp at hy
  | cons w ws ih =>
    rw [List.pairwise_cons] at hpw
    rcases mem_reach_cons.1 hx with ⟨rfl, -, -⟩ | hx'
    · rcases List.mem_cons.1 hy with rfl | hy'
      · exact absurd hd (hself _ List.mem_cons_self)
      · exact absurd hd (hpw.1 y hy')
    · rcases List.mem_cons.1 hy with rfl | hy'
      · exact mem_reach_cons.2 (.inl ⟨rfl, he, .inr ⟨x, hx', hd⟩⟩)
      · exact mem_reach_cons.2 (.inr (ih hx' hy' hpw.2 fun z hz => hself z (List.mem_cons_of_mem _ hz)))

/-- What `reach` collects comes in the writes' own order. -/
theorem reach_sublist (ws : List Write) (e : EntryId) (s : Write → Bool) : (reach ws e s).Sublist ws := by
  induction ws with
  | nil => simp [reach]
  | cons w ws ih =>
    rw [reach_cons]
    split
    · exact ih.cons_cons w
    · exact ih.cons w

/-- Some of the writes, in their order, come in an order their dependencies respect too. -/
theorem Ordered.sublist {ws ws' : List Write} (hord : Ordered ws') (h : ws.Sublist ws') : Ordered ws :=
  ⟨hord.1.sublist (h.map _), hord.2.1.sublist h, fun w hw => hord.2.2 w (h.subset hw)⟩

/-- Two orders of the same writes, each respecting their dependencies, collect the same writes. -/
theorem reach_congr {ws ws' : List Write} (hord : Ordered ws) (hord' : Ordered ws')
    (h : ∀ x, x ∈ ws ↔ x ∈ ws') {e : EntryId} {s : Write → Bool} (x : Write) :
    x ∈ reach ws e s ↔ x ∈ reach ws' e s := by
  have one : ∀ {ws ws' : List Write}, Ordered ws' → (∀ x, x ∈ ws → x ∈ ws') →
      ∀ x ∈ reach ws e s, x ∈ reach ws' e s := fun hord' h =>
    reach_induct _ (fun x hx he hs => mem_reach_of_seed (h x hx) he hs)
      (fun x hx he y _ _ hy hd => reach_closed hord' hy (h x hx) he hd)
  exact ⟨one hord' (fun x => (h x).1) x, one hord (fun x => (h x).2) x⟩

/-- Writes none of which is a seed collect nothing. -/
theorem reach_nil {ws : List Write} {e : EntryId} {s : Write → Bool} (h : ∀ x ∈ ws, s x = false) :
    reach ws e s = [] := by
  induction ws with
  | nil => rfl
  | cons x ws ih =>
    rw [reach_cons, ih fun y hy => h y (List.mem_cons_of_mem _ hy), h x List.mem_cons_self]
    simp

/-- Lists with the same members agree on whether any of them passes a test. -/
theorem any_eq_of_mem_iff {xs ys : List Write} (h : ∀ x, x ∈ xs ↔ x ∈ ys) (p : Write → Bool) :
    xs.any p = ys.any p := by
  apply Bool.eq_iff_iff.2
  simp only [List.any_eq_true]
  exact ⟨fun ⟨x, hx, hp⟩ => ⟨x, (h x).1 hx, hp⟩, fun ⟨x, hx, hp⟩ => ⟨x, (h x).2 hx, hp⟩⟩

/-! ## T10 for the writes -/

/-- T10f: a write leaves every line it isn't on as it was: main stays unchanged until a write on it merges a proposal.
    -/
theorem T10_other_lines (ws : List Write) (w : Write) (e : EntryId) (l : Option EditId)
    (h : ¬(w.entry = e ∧ w.line = l)) : history (ws ++ [w]) e l = history ws e l := by
  unfold history
  rw [reach_snoc]
  split
  · rename_i hc
    simp only [Bool.and_eq_true, beq_iff_eq] at hc
    exact absurd ⟨hc.1, hc.2⟩ h
  · rfl

/-- T10g: a merge, a write on line `l` that builds on the heads of `l` and of `l'`, makes `l`'s history the union of
    both lines' histories and itself: no write of either is lost, and nothing else comes in. -/
theorem T10_merge_union {ws : List Write} (hord : Ordered ws) {m : Write} {e : EntryId}
    {l l' : Option EditId} (hm : m.entry = e ∧ m.line = l)
    (hdeps : ∀ d, d ∈ m.deps ↔ d ∈ heads ws e l ∨ d ∈ heads ws e l') (x : Write) :
    x ∈ history (ws ++ [m]) e l ↔ x ∈ history ws e l ∨ x ∈ history ws e l' ∨ x = m := by
  have hc : (m.entry == e && m.line == l) = true := by simp [hm.1, hm.2]
  unfold history
  rw [reach_snoc]
  simp only [hc, ↓reduceIte, List.mem_append, List.mem_singleton]
  have hdep : ∀ w ∈ ws, m.deps.contains w.edit = true →
      ((tips (reach ws e (·.line == l))).contains w.edit || (tips (reach ws e (·.line == l'))).contains w.edit)
        = true := fun w _ hw => by
    simpa [heads, history, List.contains_iff_mem] using (hdeps w.edit).1 (List.contains_iff_mem.1 hw)
  constructor
  · rintro (hx | rfl)
    · rcases reach_or x hx with hx | hx
      · exact .inl hx
      · rcases reach_or x (reach_mono hdep x hx) with hx | hx
        · exact .inl ((reach_tips hord x).1 hx)
        · exact .inr (.inl ((reach_tips hord x).1 hx))
    · exact .inr (.inr rfl)
  · rintro (hx | hx | rfl)
    · exact .inl (reach_mono (fun _ _ h => by simp [h]) x hx)
    · refine .inl (reach_mono (fun w _ h => ?_) x ((reach_tips hord x).2 hx))
      have : w.edit ∈ heads ws e l' := by simpa [heads, history, List.contains_iff_mem] using h
      simp [(hdeps w.edit).2 (.inr this)]
    · exact .inr rfl

/-- T10g, as a device shows it: after the merge, line `l` shows `Doc.lean`'s merge of both lines' histories and the
    merge's own update, so the merge laws T10a to T10c hold for what every device shows. -/
theorem T10_merge_content {P V : Type} (L : Loro P V) {ws : List Write} (hord : Ordered ws) {m : Write} 
    {e : EntryId} {l l' : Option EditId} (hm : m.entry = e ∧ m.line = l)
    (hdeps : ∀ d, d ∈ m.deps ↔ d ∈ heads ws e l ∨ d ∈ heads ws e l') :
    content L (ws ++ [m]) e l =
      L.materialize (merge ((history ws e l).map (·.edit)) ((history ws e l').map (·.edit)) ++ [m.edit]) := by
  unfold content
  refine L.converges _ _ fun u => ?_
  simp only [List.mem_map, List.mem_append, mem_merge, List.mem_singleton]
  constructor
  · rintro ⟨x, hx, rfl⟩
    rcases (T10_merge_union hord hm hdeps x).1 hx with hx | hx | rfl
    · exact .inl (.inl ⟨x, hx, rfl⟩)
    · exact .inl (.inr ⟨x, hx, rfl⟩)
    · exact .inr rfl
  · rintro ((⟨x, hx, rfl⟩ | ⟨x, hx, rfl⟩) | rfl)
    · exact ⟨x, (T10_merge_union hord hm hdeps x).2 (.inl hx), rfl⟩
    · exact ⟨x, (T10_merge_union hord hm hdeps x).2 (.inr (.inl hx)), rfl⟩
    · exact ⟨m, (T10_merge_union hord hm hdeps m).2 (.inr (.inr rfl)), rfl⟩

/-- T10h: a merge of line `l'` into line `l`, a write on `l` that builds on both lines' heads and whose update puts the
    merged history to `mergeInto` of the base and of what each line shows, makes `l` show exactly that, and keeps
    every write of both lines (T10g). So by T10d nothing `l` changed since the base is lost, and by T10e all `l'`
    changed alone lands. -/
theorem T10_merge_shows {P V : Type} [DecidableEq V] (L : Loro P V) (join : V → V → V → Option V) (take : P → Bool)
    {ws : List Write} (hord : Ordered ws) {m : Write} {e : EntryId} {l l' : Option EditId} (hm : m.entry = e ∧ m.line = l)
    (hdeps : ∀ d, d ∈ m.deps ↔ d ∈ heads ws e l ∨ d ∈ heads ws e l')
    (hput : m.edit = L.put (merge ((history ws e l).map (·.edit)) ((history ws e l').map (·.edit)))
      (mergeInto join (base L ws e l l') (content L ws e l) (content L ws e l') take)) :
    content L (ws ++ [m]) e l = mergeInto join (base L ws e l l') (content L ws e l) (content L ws e l') take := by
  rw [T10_merge_content L hord hm hdeps, hput]
  exact L.puts _ _

/-! ## Along the past -/

/-- A write's past comes before it. -/
theorem past_before {A B : List Write} {w : Write} (hord : Ordered (A ++ w :: B)) :
    ∀ x ∈ past (A ++ w :: B) w, x ∈ A := by
  obtain ⟨-, hpw, hself⟩ := hord
  rw [List.pairwise_append, List.pairwise_cons] at hpw
  have hw : w.edit ∉ w.deps := hself w (by simp)
  refine reach_induct _ (fun x hx _ hs => ?_) (fun x hx _ y _ _ hy hd => ?_)
  · have hs : x.edit ∈ w.deps := List.contains_iff_mem.1 hs
    rcases List.mem_append.1 hx with hx | hx
    · exact hx
    · rcases List.mem_cons.1 hx with rfl | hx
      · exact absurd hs hw
      · exact absurd hs (hpw.2.1.1 x hx)
  · rcases List.mem_append.1 hx with hx | hx
    · exact hx
    · exact absurd hd (hpw.2.2 y hy x hx)

/-- Induction along the past: what holds of a write whenever it holds of its whole past holds of every write. -/
theorem past_induction {ws : List Write} (hord : Ordered ws) {P : Write → Prop}
    (h : ∀ w ∈ ws, (∀ x ∈ past ws w, P x) → P w) : ∀ w ∈ ws, P w := by
  -- the writes taken from the last back: each one's past is among those before it
  suffices ∀ R B : List Write, ws = R.reverse ++ B → ∀ w ∈ R, P w from
    fun w hw => this ws.reverse [] (by simp) w (List.mem_reverse.2 hw)
  intro R
  induction R with
  | nil => simp
  | cons m R ih =>
    intro B hws w hw
    have hws' : ws = R.reverse ++ m :: B := by simp [hws]
    rcases List.mem_cons.1 hw with rfl | hw
    · refine h w (by simp [hws']) fun x hx => ih (w :: B) hws' x ?_
      rw [hws'] at hord hx
      exact List.mem_reverse.1 (past_before hord x hx)
    · exact ih (m :: B) hws' w hw

/-- The past of a write in the past of `w` is in the past of `w`. -/
theorem past_trans {ws : List Write} (hord : Ordered ws) {w x : Write} (hx : x ∈ past ws w) :
    ∀ y ∈ past ws x, y ∈ past ws w := by
  have he : x.entry = w.entry := (mem_reach hx).2
  refine reach_induct _ (fun y hy hye hs => ?_) (fun y hy hye z _ _ hz hd => ?_)
  · exact reach_closed hord hx hy (hye.trans he) (List.contains_iff_mem.1 hs)
  · exact reach_closed hord hz hy (hye.trans he) hd

/-- Two orders of writes that hold the same past of `w` hold the same past of every write in it. -/
theorem past_of_past {ws ws' : List Write} (hord : Ordered ws) (hord' : Ordered ws') {w : Write}
    (hp : ∀ y, y ∈ past ws w ↔ y ∈ past ws' w) {x : Write} (hx : x ∈ past ws w) :
    ∀ y ∈ past ws x, y ∈ past ws' x := by
  have hx' := (hp x).1 hx
  have he : x.entry = w.entry := (mem_reach hx).2
  have hin : ∀ y ∈ ws, y.entry = x.entry → ∀ z ∈ past ws w, y.edit ∈ z.deps → y ∈ ws' :=
    fun y hy hye z hz hd => (mem_reach ((hp y).1 (reach_closed hord hz hy (hye.trans he) hd))).1
  refine reach_induct _ (fun y hy hye hs => ?_) (fun y hy hye z _ _ hz hd => ?_)
  · exact mem_reach_of_seed (hin y hy hye x hx (List.contains_iff_mem.1 hs)) hye hs
  · exact reach_closed hord' hz (hin y hy hye z ((hp z).2 (past_trans hord' hx' z hz)) hd) hye hd

/-- The writes that come after `w` are not in its past. -/
theorem past_append {ws ws' : List Write} (hord : Ordered (ws ++ ws')) {w : Write} (hw : w ∈ ws) :
    past (ws ++ ws') w = past ws w := by
  have h : reach ws' w.entry (fun x => w.deps.contains x.edit) = [] := reach_nil fun x hx => by
    have := (List.pairwise_append.1 hord.2.1).2.2 w hw x hx
    simpa using this
  unfold past reach at *
  rw [List.foldr_append, h]

/-! ## Numbering, write by write -/

theorem numberIn_cons (k d n : Nat) (ns : List (EditId × Nat)) :
    numberIn ((k, n) :: ns) d = if d = k then n else numberIn ns d := by
  by_cases h : d = k
  · simp [numberIn, List.lookup, h]
  · simp [numberIn, List.lookup, h, beq_eq_false_iff_ne.2 h]

theorem numberStep_of_entry {W : List Write} {e : EntryId} {l : Option EditId} {ns : List (EditId × Nat)}
    {w : Write} (he : w.entry = e) :
    numberStep W e l ns w =
      (w.edit, (w.deps.map (numberIn ns)).foldr max 0 + if isRelease W e l w then 1 else 0) :: ns := by
  simp [numberStep, he]

/-- Writes of other entries, or with other ids, leave the number of `d` as it was. -/
theorem numberIn_foldl {W : List Write} {e : EntryId} {l : Option EditId} {d : EditId} :
    ∀ (B : List Write) (ns : List (EditId × Nat)), (∀ x ∈ B, x.entry = e → x.edit ≠ d) →
      numberIn (B.foldl (numberStep W e l) ns) d = numberIn ns d := by
  intro B
  induction B with
  | nil => intros; rfl
  | cons x B ih =>
    intro ns h
    rw [List.foldl_cons, ih _ fun y hy => h y (List.mem_cons_of_mem _ hy)]
    by_cases hx : x.entry = e
    · rw [numberStep_of_entry hx, numberIn_cons]
      simp only [Ne.symm (h x List.mem_cons_self hx), ↓reduceIte]
    · simp [numberStep, hx]

/-- A write no write of the entry has the id of is numbered 0. -/
theorem number_zero {ws : List Write} {e : EntryId} {l : Option EditId} {d : EditId}
    (h : ∀ x ∈ ws, x.entry = e → x.edit ≠ d) : numberIn (numbering ws e l) d = 0 :=
  numberIn_foldl ws [] h

/-- A write of the entry is numbered as the step that met it said: the highest number among the writes it builds on,
    one more for a release. -/
theorem number_eq {ws : List Write} (hord : Ordered ws) {e : EntryId} {l : Option EditId} {w : Write}
    (hw : w ∈ ws) (he : w.entry = e) :
    number ws e l w =
      (w.deps.map (numberIn (numbering ws e l))).foldr max 0 + if isRelease ws e l w then 1 else 0 := by
  obtain ⟨hnd, hpw, hself⟩ := hord
  obtain ⟨A, B, rfl⟩ := List.append_of_mem hw
  have hnB : ((w :: B).map (·.edit)).Nodup := hnd.sublist ((List.sublist_append_right A (w :: B)).map _)
  rw [List.map_cons, List.nodup_cons] at hnB
  rw [List.pairwise_append, List.pairwise_cons] at hpw
  have hww : w.edit ∉ w.deps := hself w (by simp)
  have hsplit : numbering (A ++ w :: B) e l =
      B.foldl (numberStep (A ++ w :: B) e l) (numberStep (A ++ w :: B) e l
        (A.foldl (numberStep (A ++ w :: B) e l) []) w) := by
    simp only [numbering, List.foldl_append, List.foldl_cons]
  -- what w builds on is numbered before it, and nothing after it changes that
  have hdeps : ∀ d ∈ w.deps, numberIn (numbering (A ++ w :: B) e l) d =
      numberIn (A.foldl (numberStep (A ++ w :: B) e l) []) d := by
    intro d hd
    have hne : ¬d = w.edit := fun h => hww (h ▸ hd)
    rw [hsplit, numberIn_foldl (d := d) B _ fun x hx _ h => hpw.2.1.1 x hx (h ▸ hd), numberStep_of_entry he,
      numberIn_cons]
    simp only [hne, ↓reduceIte]
  rw [List.map_congr_left hdeps]
  unfold number
  rw [hsplit, numberIn_foldl (d := w.edit) B _ fun x hx _ h => hnB.1 (List.mem_map.2 ⟨x, hx, h⟩),
    numberStep_of_entry he, numberIn_cons]
  simp

theorem le_foldr_max {xs : List Nat} {a : Nat} (h : a ∈ xs) : a ≤ xs.foldr max 0 := by
  induction xs with
  | nil => simp at h
  | cons x xs ih =>
    rcases List.mem_cons.1 h with rfl | h
    · exact Nat.le_max_left _ _
    · exact Nat.le_trans (ih h) (Nat.le_max_right _ _)

theorem foldr_max_le {xs : List Nat} {n : Nat} (h : ∀ a ∈ xs, a ≤ n) : xs.foldr max 0 ≤ n := by
  induction xs with
  | nil => exact Nat.zero_le _
  | cons x xs ih =>
    exact Nat.max_le.2 ⟨h x List.mem_cons_self, ih fun a ha => h a (List.mem_cons_of_mem _ ha)⟩

/-- The highest of some numbers is one of them, or 0. -/
theorem foldr_max_mem (xs : List Nat) : xs.foldr max 0 = 0 ∨ xs.foldr max 0 ∈ xs := by
  induction xs with
  | nil => exact .inl rfl
  | cons x xs ih =>
    simp only [List.foldr_cons]
    rcases Nat.le_total x (xs.foldr max 0) with h | h
    · rw [Nat.max_eq_right h]
      rcases ih with ih | ih
      · exact .inl ih
      · exact .inr (List.mem_cons_of_mem _ ih)
    · rw [Nat.max_eq_left h]
      exact .inr List.mem_cons_self

/-- Two lists with the same members, numbered alike, have the same highest number. -/
theorem foldr_max_congr {xs ys : List Write} {f g : Write → Nat} (hm : ∀ x, x ∈ xs ↔ x ∈ ys)
    (hfg : ∀ x ∈ xs, f x = g x) : (xs.map f).foldr max 0 = (ys.map g).foldr max 0 :=
  Nat.le_antisymm
    (foldr_max_le fun a ha => by
      obtain ⟨x, hx, rfl⟩ := List.mem_map.1 ha
      rw [hfg x hx]
      exact le_foldr_max (List.mem_map_of_mem ((hm x).1 hx)))
    (foldr_max_le fun a ha => by
      obtain ⟨x, hx, rfl⟩ := List.mem_map.1 ha
      rw [← hfg x ((hm x).2 hx)]
      exact le_foldr_max (List.mem_map_of_mem ((hm x).2 hx)))

/-- A write's number is at least that of every write in its past, one more if it is a release. -/
theorem number_past_le {ws : List Write} (hord : Ordered ws) {e : EntryId} {l : Option EditId} {w : Write}
    (hw : w ∈ ws) (he : w.entry = e) :
    ∀ x ∈ past ws w, number ws e l x + (if isRelease ws e l w then 1 else 0) ≤ number ws e l w := by
  have step : ∀ y ∈ ws, y.entry = e → ∀ x : Write, x.edit ∈ y.deps →
      number ws e l x ≤ number ws e l y := by
    intro y hy hye x hd
    rw [number_eq hord hy hye]
    exact Nat.le_trans (le_foldr_max (List.mem_map_of_mem (f := numberIn (numbering ws e l)) hd))
      (Nat.le_add_right _ _)
  refine reach_induct _ (fun x _ _ hs => ?_) (fun x _ _ y hy hye hC hd => ?_)
  · rw [number_eq hord hw he]
    exact Nat.add_le_add_right
      (le_foldr_max (List.mem_map_of_mem (f := numberIn (numbering ws e l)) (List.contains_iff_mem.1 hs))) _
  · exact Nat.le_trans (Nat.add_le_add_right (step y hy (hye.trans he) x hd) _) hC

/-- A write's number is the highest number in its past, one more if it is a release. -/
theorem number_of_past {ws : List Write} (hord : Ordered ws) {e : EntryId} {l : Option EditId} {w : Write}
    (hw : w ∈ ws) (he : w.entry = e) :
    number ws e l w = ((past ws w).map (number ws e l)).foldr max 0 + if isRelease ws e l w then 1 else 0 := by
  have hb := number_past_le hord (l := l) hw he
  rw [number_eq hord hw he] at hb ⊢
  congr 1
  refine Nat.le_antisymm (foldr_max_le fun a ha => ?_) (foldr_max_le fun a ha => ?_)
  · obtain ⟨d, hd, rfl⟩ := List.mem_map.1 ha
    by_cases hx : ∃ x ∈ ws, x.entry = e ∧ x.edit = d
    · obtain ⟨x, hx, hxe, rfl⟩ := hx
      exact le_foldr_max (List.mem_map_of_mem (f := number ws e l)
        (mem_reach_of_seed hx (hxe.trans he.symm) (List.contains_iff_mem.2 hd)))
    · rw [number_zero fun x hx' hxe h => hx ⟨x, hx', hxe, h⟩]
      exact Nat.zero_le _
  · obtain ⟨x, hx, rfl⟩ := List.mem_map.1 ha
    exact Nat.le_of_add_le_add_right (hb x hx)

theorem isRelease_entry {ws : List Write} {e : EntryId} {l : Option EditId} {w : Write}
    (h : isRelease ws e l w = true) : w.entry = e := by
  simp only [isRelease, Bool.and_eq_true, beq_iff_eq] at h
  exact h.1.1

/-- A write's number is 0 or that of a release of the line it holds: itself or one in its past. -/
theorem number_held {ws : List Write} (hord : Ordered ws) {e : EntryId} {l : Option EditId} :
    ∀ x ∈ ws, x.entry = e → number ws e l x = 0 ∨
      ∃ r, (r = x ∨ r ∈ past ws x) ∧ isRelease ws e l r = true ∧ number ws e l r = number ws e l x := by
  refine past_induction hord (P := fun x => x.entry = e → number ws e l x = 0 ∨
      ∃ r, (r = x ∨ r ∈ past ws x) ∧ isRelease ws e l r = true ∧ number ws e l r = number ws e l x)
    fun x hx ih hxe => ?_
  by_cases hrel : isRelease ws e l x = true
  · exact .inr ⟨x, .inl rfl, hrel, rfl⟩
  · have hn := number_of_past hord (l := l) hx hxe
    simp only [hrel] at hn
    rcases foldr_max_mem ((past ws x).map (number ws e l)) with h0 | hm
    · exact .inl (hn.trans h0)
    · obtain ⟨y, hy, hyn⟩ := List.mem_map.1 hm
      rcases ih y hy ((mem_reach hy).2.trans hxe) with h0 | ⟨r, hr, hrr, hrn⟩
      · exact .inl (hn.trans (hyn.symm.trans h0))
      · refine .inr ⟨r, .inr ?_, hrr, hrn.trans (hyn.trans hn.symm)⟩
        rcases hr with rfl | hr
        · exact hy
        · exact past_trans hord hy r hr

/-- Whether a write is a release depends on its past alone. -/
theorem isRelease_congr {ws ws' : List Write} (hord : Ordered ws) (hord' : Ordered ws') {w : Write}
    (hp : ∀ y, y ∈ past ws w ↔ y ∈ past ws' w) (e : EntryId) (l : Option EditId) :
    isRelease ws e l w = isRelease ws' e l w := by
  have hh : ∀ y, y ∈ history (past ws w) w.entry w.line ↔ y ∈ history (past ws' w) w.entry w.line :=
    reach_congr (hord.sublist (reach_sublist _ _ _)) (hord'.sublist (reach_sublist _ _ _)) hp
  simp only [isRelease, brings, any_eq_of_mem_iff hh]

/-! ## T10 for version numbers -/

/-- T10i: a release's number is above that of every write in its past, the line's releases there among them: of two
    releases of a line, one in the other's past, the later has the higher number. -/
theorem T10_release_above {ws : List Write} (hord : Ordered ws) {e : EntryId} {l : Option EditId} {w x : Write}
    (hw : w ∈ ws) (hrel : isRelease ws e l w = true) (hx : x ∈ past ws w) : number ws e l x < number ws e l w := by
  have := number_past_le hord (l := l) hw (isRelease_entry hrel) x hx
  simp only [hrel, ↓reduceIte] at this
  exact this

/-- T10i, exactly: a release's number is one more than the highest number among its line's releases in its past, 1 if
    there are none. -/
theorem T10_release_number {ws : List Write} (hord : Ordered ws) {e : EntryId} {l : Option EditId} {w : Write}
    (hw : w ∈ ws) (hrel : isRelease ws e l w = true) :
    number ws e l w = (((past ws w).filter (isRelease ws e l)).map (number ws e l)).foldr max 0 + 1 := by
  have he := isRelease_entry hrel
  rw [number_of_past hord hw he]
  simp only [hrel, ↓reduceIte]
  congr 1
  refine Nat.le_antisymm (foldr_max_le fun a ha => ?_) (foldr_max_le fun a ha => ?_)
  · obtain ⟨x, hx, rfl⟩ := List.mem_map.1 ha
    rcases number_held hord x (mem_reach hx).1 ((mem_reach hx).2.trans he) with h0 | ⟨r, hr, hrr, hrn⟩
    · rw [h0]
      exact Nat.zero_le _
    · rw [← hrn]
      refine le_foldr_max (List.mem_map_of_mem (List.mem_filter.2 ⟨?_, hrr⟩))
      rcases hr with rfl | hr
      · exact hx
      · exact past_trans hord hx r hr
  · obtain ⟨x, hx, rfl⟩ := List.mem_map.1 ha
    exact le_foldr_max (List.mem_map_of_mem (List.mem_filter.1 hx).1)

/-- T10j: a write's number depends on its past alone: two orders of writes that hold the same past of it, possibly in
    another order, give it the same number. -/
theorem T10_number_of_past {ws ws' : List Write} (hord : Ordered ws) (hord' : Ordered ws') {e : EntryId}
    {l : Option EditId} {w : Write} (hw : w ∈ ws) (hw' : w ∈ ws')
    (hp : ∀ x, x ∈ past ws w ↔ x ∈ past ws' w) :
    number ws e l w = number ws' e l w := by
  suffices h : ∀ x ∈ ws, (x = w ∨ x ∈ past ws w) → number ws e l x = number ws' e l x from h w hw (.inl rfl)
  refine past_induction hord (P := fun x => (x = w ∨ x ∈ past ws w) → number ws e l x = number ws' e l x)
    fun x hx ih hxw => ?_
  have hx' : x ∈ ws' := by
    rcases hxw with rfl | h
    · exact hw'
    · exact (mem_reach ((hp x).1 h)).1
  have hpx : ∀ y, y ∈ past ws x ↔ y ∈ past ws' x := by
    rcases hxw with rfl | h
    · exact hp
    · exact fun y => ⟨past_of_past hord hord' hp h y,
        past_of_past hord' hord (fun z => (hp z).symm) ((hp x).1 h) y⟩
  by_cases hxe : x.entry = e
  · rw [number_of_past hord hx hxe, number_of_past hord' hx' hxe, isRelease_congr hord hord' hpx]
    congr 1
    refine foldr_max_congr hpx fun y hy => ih y hy (.inr ?_)
    rcases hxw with rfl | h
    · exact hy
    · exact past_trans hord h y hy
  · -- no write of the entry has its id: both number it 0
    have z : ∀ {ws : List Write}, Ordered ws → x ∈ ws → number ws e l x = 0 := fun ho hm =>
      number_zero fun y hy hye h => hxe (by rw [← eq_of_edit_eq ho.1 hy hm h]; exact hye)
    exact (z hord hx).trans (z hord' hx').symm

/-- T10j, as more writes come: a write's number never changes. -/
theorem T10_number_stays {ws ws' : List Write} (hord : Ordered (ws ++ ws')) {e : EntryId} {l : Option EditId}
    {w : Write} (hw : w ∈ ws) : number (ws ++ ws') e l w = number ws e l w :=
  T10_number_of_past hord (hord.sublist (List.sublist_append_left _ _)) (List.mem_append_left _ hw) hw
    fun x => by rw [past_append hord hw]

/-- T10j, as more writes come: a line's releases keep their numbers and their order, and new ones come after them. -/
theorem T10_releases_stay {ws ws' : List Write} (hord : Ordered (ws ++ ws')) (e : EntryId) (l : Option EditId) :
    ∃ more, releases (ws ++ ws') e l = releases ws e l ++ more := by
  have ho : Ordered ws := hord.sublist (List.sublist_append_left _ _)
  refine ⟨(ws'.filter (isRelease (ws ++ ws') e l)).map fun w => (w.edit, number (ws ++ ws') e l w), ?_⟩
  unfold releases
  rw [List.filter_append, List.map_append]
  congr 1
  rw [List.filter_congr fun w hw => isRelease_congr hord ho (fun x => by rw [past_append hord hw]) e l]
  exact List.map_congr_left fun w hw => congrArg (Prod.mk w.edit) (T10_number_stays hord (List.mem_filter.1 hw).1)

/-- T10j, in every replay order: the same writes, in another order that keeps each after what it builds on, number
    every write alike and give the line the same releases. -/
theorem T10_numbers_every_order {ws ws' : List Write} (hord : Ordered ws) (hord' : Ordered ws')
    (h : ∀ x, x ∈ ws ↔ x ∈ ws') (e : EntryId) (l : Option EditId) :
    (∀ w ∈ ws, number ws e l w = number ws' e l w) ∧ ∀ r, r ∈ releases ws e l ↔ r ∈ releases ws' e l := by
  have hp : ∀ w x, x ∈ past ws w ↔ x ∈ past ws' w := fun _ => reach_congr hord hord' h
  have hn : ∀ w ∈ ws, number ws e l w = number ws' e l w := fun w hw =>
    T10_number_of_past hord hord' hw ((h w).1 hw) (hp w)
  refine ⟨hn, fun r => ?_⟩
  simp only [releases, List.mem_map, List.mem_filter]
  constructor
  · rintro ⟨w, ⟨hw, hr⟩, rfl⟩
    refine ⟨w, ⟨(h w).1 hw, ?_⟩, by rw [hn w hw]⟩
    rwa [← isRelease_congr hord hord' (hp w) e l]
  · rintro ⟨w, ⟨hw, hr⟩, rfl⟩
    have hw' := (h w).2 hw
    refine ⟨w, ⟨hw', ?_⟩, by rw [hn w hw']⟩
    rwa [isRelease_congr hord hord' (hp w) e l]

/-- T10k: a release reads as itself: the version it heads is its number, with no edits after it. -/
theorem T10_release_describes {ws : List Write} (hord : Ordered ws) {e : EntryId} {l : Option EditId} {w : Write}
    (hw : w ∈ ws) (hrel : isRelease ws e l w = true) :
    describe ws e l [w.edit] = ⟨some (number ws e l w), 0⟩ := by
  have he := isRelease_entry hrel
  -- the version holds w and its past
  have hheld : ∀ x ∈ holds ws e [w.edit], x = w ∨ x ∈ past ws w := by
    refine reach_induct _ (fun x hx _ hs => ?_) (fun x hx hxe y _ _ hy hd => ?_)
    · simp only [List.contains_cons, List.contains_nil, Bool.or_false, beq_iff_eq] at hs
      exact .inl (eq_of_edit_eq hord.1 hx hw hs)
    · right
      rcases hy with rfl | hy
      · exact mem_reach_of_seed hx (hxe.trans he.symm) (List.contains_iff_mem.2 hd)
      · exact reach_closed hord hy hx (hxe.trans he.symm) hd
  have hwheld : w ∈ holds ws e [w.edit] := mem_reach_of_seed hw he (by simp)
  generalize hrs : (releases ws e l).filter (fun r => (holds ws e [w.edit]).any (·.edit == r.1)) = rs
  have hmem : (w.edit, number ws e l w) ∈ rs := by
    rw [← hrs]
    refine List.mem_filter.2 ⟨List.mem_map.2 ⟨w, List.mem_filter.2 ⟨hw, hrel⟩, rfl⟩, ?_⟩
    exact List.any_eq_true.2 ⟨w, hwheld, by simp⟩
  -- the releases it holds are w and those in its past, below it
  have hle : ∀ p ∈ rs, p.2 ≤ number ws e l w := by
    intro p hp
    rw [← hrs] at hp
    obtain ⟨hp, hph⟩ := List.mem_filter.1 hp
    obtain ⟨x, hx, rfl⟩ := List.mem_map.1 hp
    obtain ⟨hx, -⟩ := List.mem_filter.1 hx
    obtain ⟨y, hy, hyx⟩ := List.any_eq_true.1 hph
    obtain rfl : y = x := eq_of_edit_eq hord.1 (mem_reach hy).1 hx (by simpa using hyx)
    rcases hheld y hy with rfl | hy
    · exact Nat.le_refl _
    · exact Nat.le_of_lt (T10_release_above hord hw hrel hy)
  have hn : (rs.map (·.2)).foldr max 0 = number ws e l w :=
    Nat.le_antisymm (foldr_max_le fun a ha => by obtain ⟨p, hp, rfl⟩ := List.mem_map.1 ha; exact hle p hp)
      (le_foldr_max (List.mem_map_of_mem (f := (·.2)) hmem))
  have hne : rs.isEmpty = false := by
    cases rs with
    | nil => simp at hmem
    | cons _ _ => rfl
  -- and everything it holds is held by its highest releases, w among them
  have hall : ∀ x ∈ holds ws e [w.edit],
      x ∈ holds ws e ((rs.filter (·.2 == number ws e l w)).map (·.1)) := by
    refine reach_mono fun x _ hx => ?_
    simp only [List.contains_cons, List.contains_nil, Bool.or_false, beq_iff_eq] at hx
    refine List.contains_iff_mem.2 (List.mem_map.2 ⟨(w.edit, number ws e l w), ?_, hx.symm⟩)
    exact List.mem_filter.2 ⟨hmem, by simp⟩
  simp only [describe, hrs, hne, hn]
  simp only [Bool.false_eq_true, ↓reduceIte, Described.mk.injEq, true_and, List.length_eq_zero_iff,
    List.filter_eq_nil_iff]
  intro x hx
  have : (holds ws e ((rs.filter (·.2 == number ws e l w)).map (·.1))).any (·.edit == x.edit) = true :=
    List.any_eq_true.2 ⟨x, hall x (List.mem_filter.1 hx).1, by simp⟩
  simp [this]

end AvenDB

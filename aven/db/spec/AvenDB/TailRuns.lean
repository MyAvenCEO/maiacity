import AvenDB.MoveSteps

/-!
# A late edit replays the last edits only

The proof of V4, M2c of the master plan: a device that receives edits a peer made while it was behind, which sort among
the last edits it holds, replays only the edits after a place before them, from the state it kept there (`Tail`),
rather than every edit it holds again, even where moves come after that place (`V4_tail_replays`).

A replay splits at any place: the replay of the edits before it, then of the rest from where it left off
(`runFrom_append`). What the edits before the place make of each turns only on which of them are removals that stand,
and on the facts the removals after it hide from them (`runFrom_congr`): where the new edits are no removals, and every
removal before the place, and every move after it, is chosen as before and hides what it hid (`hiddenAt_cutsAt_before`), the
edits before the place stand as they stood, and the replay of the rest from the state kept there is the replay of every
edit (`V4_rewind`).

Which removals `resolve` chooses is the same where the new edits are no removals: every removal tried before a move
after the place lies before it, and is tried as before (`resolve_tail`); a move after the place, which stood before,
stands again where the replay with every removal chosen keeps every one of them standing and is inert, no edit kept out
by what a move hides alone. Then trying it on the replay with only the removals chosen before it hides less from the
edits before it, and they stand as in the replay with every removal: an edit's check with an audience narrowed accepts
only where it accepts with less narrowed (`apply_setNarrow_mono`), and with none narrowed by a move it accepts as with
every move's (`runFrom_sandwich`).
-/

namespace AvenDB

namespace Tails

open Stored Trusted Moves

/-! ## Any narrowing -/

/-- The state with its narrowed audiences `n`. -/
def setNarrow (st : State) (n : List (EntryId × Audience)) : State := { st with narrow := n }

section Narrow

variable (st : State) (n : List (EntryId × Audience))

theorem setNarrow_trust : (setNarrow st n).trust = st.trust := rfl

theorem vault?_setNarrow : (setNarrow st n).vault? = st.vault? := by rw [← vault?_trust, setNarrow_trust, vault?_trust]
theorem actsVia_setNarrow : actsVia (setNarrow st n) = actsVia st := by
  rw [← actsVia_trust, setNarrow_trust, actsVia_trust]
theorem approves_setNarrow : approves (setNarrow st n) = approves st := by
  rw [← approves_trust, setNarrow_trust, approves_trust]
theorem entry?_setNarrow : (setNarrow st n).entry? = st.entry? := by cases st; rfl
theorem audienceOk_setNarrow : audienceOk (setNarrow st n) = audienceOk st := by cases st; rfl
theorem wantsOk_setNarrow : wantsOk (setNarrow st n) = wantsOk st := by cases st; rfl
theorem holdsShare_setNarrow : holdsShare (setNarrow st n) = holdsShare st := by
  rw [← holdsShare_trust, setNarrow_trust, holdsShare_trust]
theorem chain_setNarrow : chain (setNarrow st n) = chain st := by
  funext c; simp only [chain, chainN_congr (a := setNarrow st n) (b := st) rfl]; rfl
theorem mayCreate_setNarrow : mayCreate (setNarrow st n) = mayCreate st := by
  funext a v x; simp only [mayCreate, intake, holdsShare_setNarrow, chain_setNarrow]; rfl
theorem actsForN_setNarrow : actsForN (setNarrow st n) = actsForN st := by
  funext s k
  induction k with
  | zero => rfl
  | succ k ih => funext v; simp only [actsForN, ih, vault?_setNarrow]
theorem entitled_setNarrow : entitled (setNarrow st n) = entitled st := by
  funext d k; simp only [entitled, actsFor, actsForN_setNarrow]; rfl
theorem mayBox_setNarrow : mayBox (setNarrow st n) = mayBox st := by
  funext d k; cases k <;> simp only [mayBox, entitled_setNarrow, entry?_setNarrow] <;> rfl
theorem writes_setNarrow : (setNarrow st n).writes = st.writes := rfl
theorem born_setNarrow : (setNarrow st n).born = st.born := rfl
theorem seals_setNarrow : (setNarrow st n).seals = st.seals := rfl
theorem published_setNarrow : (setNarrow st n).published = st.published := rfl
theorem wantsOf_setNarrow : (setNarrow st n).wantsOf = st.wantsOf := by cases st; rfl
theorem wrapOk_setNarrow : wrapOk (setNarrow st n) = wrapOk st := by
  funext d x w; simp only [wrapOk, mayBox_setNarrow, seals_setNarrow]

end Narrow

/-- With more narrowed, a share reaches an entry only where it reached it with less. -/
theorem inAudience_setNarrow_mono (st : State) {n n' : List (EntryId × Audience)} (hn : ∀ x ∈ n', x ∈ n)
    (cp : Share) (en : Entry) (h : inAudience (setNarrow st n) cp en = true) :
    inAudience (setNarrow st n') cp en = true := by
  simp only [inAudience, setNarrow, Bool.and_eq_true, Bool.or_eq_true, List.all_eq_true] at h ⊢
  rcases h with ⟨h1, h2 | ⟨h2, h3⟩⟩
  · exact ⟨h1, .inl h2⟩
  · exact ⟨h1, .inr ⟨h2, fun x hx => h3 x (hn x hx)⟩⟩

theorem mayWrite_setNarrow_mono (st : State) {n n' : List (EntryId × Audience)} (hn : ∀ x ∈ n', x ∈ n)
    (a : VaultId) (en : Entry) (h : mayWrite (setNarrow st n) a en = true) :
    mayWrite (setNarrow st n') a en = true := by
  simp only [mayWrite, holdsShare_setNarrow, Bool.or_eq_true, List.any_eq_true, Bool.and_eq_true] at h ⊢
  rcases h with h | ⟨cp, hcp, hh, hi⟩
  · exact .inl h
  · exact .inr ⟨cp, hcp, hh, inAudience_setNarrow_mono st hn cp en hi⟩

/-- An edit accepted with more narrowed is accepted with less. -/
theorem apply_setNarrow_mono (st : State) {n n' : List (EntryId × Audience)} (hn : ∀ x ∈ n', x ∈ n) (edit : Edit)
    (h : ok (apply (setNarrow st n) edit) = some ()) : ok (apply (setNarrow st n') edit) = some () := by
  by_cases ht : edit.action.isTrust = true
  · rwa [ok_trust, ← apply_trust _ _ ht, setNarrow_trust, ← setNarrow_trust st n, apply_trust _ _ ht, ← ok_trust]
  rcases edit with ⟨id, depth, author, cosigners, action, parents, files⟩
  cases action with
  | write v x actor stay epoch deps proposal via create tags proof touches fits defines adds =>
    simp only [apply, writes_setNarrow, actsVia_setNarrow, entry?_setNarrow, born_setNarrow,
      vault?_setNarrow, audienceOk_setNarrow, mayCreate_setNarrow, ok_ite] at h ⊢
    cases create with
    | some p => obtain ⟨x1, hdr⟩ := p; simpa only [ok_ite, ok_some] using h
    | none =>
      simp only at h ⊢
      cases hen : st.entry? x with
      | none => rw [hen] at h; simp [ok] at h
      | some en =>
        rw [hen] at h
        simp only [ok_ite] at h ⊢
        cases hm : mayWrite (setNarrow st n) actor en
        · simp [hm] at h
        · rw [mayWrite_setNarrow_mono st hn actor en hm]
          rw [hm] at h
          rw [← h]
          cases en.stayAudience stay with
          | none => rfl
          | some _ => simp only [ok_ite]; split <;> rfl
  | mark v x caps wants keep via =>
    simp only [apply, entry?_setNarrow, actsVia_setNarrow, audienceOk_setNarrow, wantsOk_setNarrow,
      wantsOf_setNarrow] at h ⊢
    cases hen : st.entry? x with
    | none => rw [hen] at h; exact h
    | some en =>
      rw [hen] at h
      cases caps <;> cases wants <;> simp only [ok_ite, ok_some] at h ⊢ <;> exact h
  | keys secret to' pub =>
    simp only [apply, mayBox_setNarrow, seals_setNarrow, published_setNarrow] at h ⊢
    revert h; repeat' split
    all_goals simp [ok]
  | checkpoint v c =>
    simp only [apply, vault?_setNarrow, approves_setNarrow] at h ⊢
    revert h; repeat' split
    all_goals simp [ok]
  | wraps x ws =>
    simp only [apply, wrapOk_setNarrow] at h ⊢
    revert h; repeat' split
    all_goals simp [ok]
  | snapshot v c =>
    simp only [apply, vault?_setNarrow, approves_setNarrow] at h ⊢
    revert h; repeat' split
    all_goals simp [ok]
  | _ => simp [Action.isTrust] at ht

/-! ## What a move hides, apart -/

/-- A fact only a move hides: that an entry is in an audience. -/
def isAud : Fact → Bool
  | .audience .. => true
  | _ => false

/-- The entry and audience an audience fact names. -/
def audOf : Fact → Option (EntryId × Audience)
  | .audience e x => some (e, x)
  | _ => none

/-- The facts no move hides. -/
def plain (fs : List Fact) : List Fact := fs.filter fun f => !isAud f

theorem contains_plain {f : Fact} (hf : isAud f = false) : ∀ fs : List Fact, (plain fs).contains f = fs.contains f
  | [] => rfl
  | g :: fs => by
    have ih := contains_plain hf fs
    cases hg : isAud g
    · simp only [plain, List.filter_cons, hg, Bool.not_false, ↓reduceIte, List.contains_cons] at ih ⊢
      rw [ih]
    · simp only [plain, List.filter_cons, hg, Bool.not_true, Bool.false_eq_true, ↓reduceIte, List.contains_cons] at ih ⊢
      rw [ih]
      have : (f == g) = false := by
        cases f <;> cases g <;> simp_all [isAud]
      rw [this, Bool.false_or]

theorem filterMap_plain {β : Type} (g : Fact → Option β) (hg : ∀ f, isAud f = true → g f = none) :
    ∀ fs : List Fact, (plain fs).filterMap g = fs.filterMap g
  | [] => rfl
  | f :: fs => by
    have ih := filterMap_plain g hg fs
    cases hf : isAud f
    · simp only [plain, List.filter_cons, hf, Bool.not_false, ↓reduceIte, List.filterMap_cons] at ih ⊢
      rw [ih]
    · simp only [plain, List.filter_cons, hf, Bool.not_true, Bool.false_eq_true, ↓reduceIte, List.filterMap_cons,
        hg f hf] at ih ⊢
      exact ih

theorem filterMap_plain_nil {β : Type} (g : Fact → Option β) (hg : ∀ f, isAud f = false → g f = none) :
    ∀ fs : List Fact, (plain fs).filterMap g = []
  | [] => rfl
  | f :: fs => by
    have ih := filterMap_plain_nil g hg fs
    cases hf : isAud f
    · simp only [plain, List.filter_cons, hf, Bool.not_false, ↓reduceIte, List.filterMap_cons, hg f hf] at ih ⊢
      exact ih
    · simp only [plain, List.filter_cons, hf, Bool.not_true, Bool.false_eq_true, ↓reduceIte] at ih ⊢
      exact ih

/-- The vaults with nothing hidden from them. -/
theorem vaults_hide_none (st : State) (fs : List Fact) (h : ∀ f ∈ fs, isAud f = true) :
    (st.vaults.map fun vt => { vt with
      owners  := vt.owners.filter fun p => !fs.contains (.owner vt.id p),
      devices := vt.devices.filter fun d => !fs.contains (.device vt.id d),
      root    := if fs.contains (.root vt.id) then none else vt.root }) = st.vaults := by
  have hc : ∀ f, isAud f = false → fs.contains f = false := fun f hf => by
    cases hm : fs.contains f
    · rfl
    · have := h f (List.contains_iff_mem.1 hm) ; rw [hf] at this; exact absurd this (by simp)
  conv => rhs; rw [← List.map_id st.vaults]
  refine List.map_congr_left fun vt _ => ?_
  rw [hc _ rfl]
  have ho : (vt.owners.filter fun p => !fs.contains (.owner vt.id p)) = vt.owners := by
    rw [List.filter_eq_self]; intro p _; rw [hc _ rfl]; rfl
  have hd : (vt.devices.filter fun d => !fs.contains (.device vt.id d)) = vt.devices := by
    rw [List.filter_eq_self]; intro d _; rw [hc _ rfl]; rfl
  rw [ho, hd]
  cases vt; rfl

/-- Hiding facts is hiding those no move hides, with the audiences the moves hide narrowed too. -/
theorem hide_split (st : State) (fs : List Fact) : hide st fs = setNarrow (hide st (plain fs)) (hide st fs).narrow := by
  have hv : ∀ v p, (plain fs).contains (.owner v p) = fs.contains (.owner v p) := fun _ _ => contains_plain rfl fs
  have hd : ∀ v d, (plain fs).contains (.device v d) = fs.contains (.device v d) := fun _ _ => contains_plain rfl fs
  have hr : ∀ v, (plain fs).contains (.root v) = fs.contains (.root v) := fun _ => contains_plain rfl fs
  have hall : ∀ f ∈ fs, (plain fs).isEmpty = true → isAud f = true := by
    intro f hf he
    cases hfa : isAud f
    · have : f ∈ plain fs := List.mem_filter.2 ⟨hf, by simp [hfa]⟩
      rw [List.isEmpty_iff] at he; rw [he] at this; exact absurd this List.not_mem_nil
    · rfl
  by_cases he : fs.isEmpty = true
  · have : fs = [] := List.isEmpty_iff.1 he
    subst this
    unfold hide setNarrow
    simp only [List.isEmpty_nil, ↓reduceIte]
    rfl
  · by_cases hpe : (plain fs).isEmpty = true
    · have hp : hide st (plain fs) = st := by unfold hide; simp only [hpe, ↓reduceIte]
      rw [hp]
      unfold hide setNarrow
      simp only [he, Bool.false_eq_true, ↓reduceIte]
      rw [vaults_hide_none st fs (fun f hf => hall f hf hpe)]
      have hs : ∀ g : Fact → Option ShareId, (∀ f ∈ fs, g f = none) → st.revoked ++ fs.filterMap g = st.revoked :=
        fun g hg => by rw [List.filterMap_eq_nil_iff.2 hg, List.append_nil]
      congr 1
      exact hs _ fun f hf => by have := hall f hf hpe; cases f <;> simp_all [isAud]
    · unfold hide setNarrow
      simp only [he, hpe, Bool.false_eq_true, ↓reduceIte, hv, hd, hr]
      congr 1
      refine congrArg (st.revoked ++ ·) ?_
      refine (filterMap_plain _ ?_ fs).symm
      intro f hf; cases f <;> simp_all [isAud]

/-- What `hide` narrows: what was narrowed, and every audience fact hidden. -/
theorem mem_hide_narrow (st : State) (fs : List Fact) (x : EntryId × Audience) :
    x ∈ (hide st fs).narrow ↔ x ∈ st.narrow ∨ Fact.audience x.1 x.2 ∈ fs := by
  unfold hide
  split
  · rename_i h
    rw [List.isEmpty_iff.1 h]; simp
  · simp only [List.mem_append, List.mem_filterMap]
    constructor
    · rintro (h | ⟨f, hf, hx⟩)
      · exact .inl h
      · right; cases f <;> simp at hx; subst hx; exact hf
    · rintro (h | h)
      · exact .inl h
      · exact .inr ⟨_, h, rfl⟩

/-- An edit accepted with facts hidden is accepted with the same facts no move hides and fewer audiences. -/
theorem apply_hide_mono (st : State) {F G : List Fact} (hp : plain G = plain F) (ha : ∀ f ∈ G, isAud f = true → f ∈ F)
    (edit : Edit) (h : ok (apply (hide st F) edit) = some ()) : ok (apply (hide st G) edit) = some () := by
  rw [hide_split] at h ⊢
  rw [hp]
  refine apply_setNarrow_mono _ (fun x hx => ?_) edit h
  rw [mem_hide_narrow] at hx ⊢
  rcases hx with hx | hx
  · exact .inl hx
  · exact .inr (ha _ hx rfl)

/-! ## A replay with what moves hide set apart -/

/-- The cuts with what each move hides left out. -/
def strip (cs : List (Nat × List EditId × List Fact)) : List (Nat × List EditId × List Fact) :=
  cs.map fun c => (c.1, c.2.1, plain c.2.2)

theorem plain_append (a b : List Fact) : plain (a ++ b) = plain a ++ plain b := List.filter_append a b

theorem hiddenAt_strip (cs : List (Nat × List EditId × List Fact)) (i : Nat) (edit : Edit) :
    hiddenAt (strip cs) i edit = plain (hiddenAt cs i edit) := by
  induction cs with
  | nil => rfl
  | cons c cs ih =>
    unfold hiddenAt at ih ⊢
    simp only [strip, List.map_cons, List.filter_cons] at ih ⊢
    split <;> simp_all [plain_append]

/-- Where a replay is inert, the moves whose facts the cuts `csS` leave out hiding nothing that keeps an edit out, a
    replay with the same removals before each edit, the same facts no move hides from it, and facts that moves hide
    between those of `csS` and those of `cs`, is the same replay. -/
theorem runFrom_sandwich (rem remT : List Edit) (cs csT csS : List (Nat × List EditId × List Fact))
    (l2 : List (Edit × Nat)) :
    ∀ (st : State) (l : List (Edit × Nat)),
      ((l ++ l2).map (·.1.id)).Nodup →
      (∀ p ∈ l, remT.any (·.id == p.1.id) = rem.any (·.id == p.1.id)) →
      (∀ p ∈ l, plain (hiddenAt csT p.2 p.1) = plain (hiddenAt cs p.2 p.1) ∧
        ∀ f ∈ hiddenAt csT p.2 p.1, isAud f = true → f ∈ hiddenAt cs p.2 p.1) →
      (∀ p ∈ l, plain (hiddenAt csS p.2 p.1) = plain (hiddenAt cs p.2 p.1) ∧
        ∀ f ∈ hiddenAt csS p.2 p.1, isAud f = true → f ∈ hiddenAt csT p.2 p.1) →
      runFrom rem csS st (l ++ l2) = runFrom rem cs st (l ++ l2) →
      runFrom remT csT st l = runFrom rem cs st l
  | _, [], _, _, _, _, _ => rfl
  | st, (edit, i) :: rest, hnd, hrem, hcut, hcutS, hin => by
    have hnd' : ((rest ++ l2).map (·.1.id)).Nodup := (List.nodup_cons.1 hnd).2
    have hnot : edit ∉ (rest ++ l2).map Prod.fst := fun hm => by
      obtain ⟨q, hq, rfl⟩ := List.mem_map.1 hm
      exact (List.nodup_cons.1 hnd).1 (List.mem_map.2 ⟨q, hq, rfl⟩)
    have hrem' := fun p hp => hrem p (List.mem_cons_of_mem _ hp)
    have hcut' := fun p hp => hcut p (List.mem_cons_of_mem _ hp)
    have hcutS' := fun p hp => hcutS p (List.mem_cons_of_mem _ hp)
    obtain ⟨hp, ha⟩ := hcut (edit, i) List.mem_cons_self
    obtain ⟨hpS, haS⟩ := hcutS (edit, i) List.mem_cons_self
    have hr := hrem (edit, i) List.mem_cons_self
    dsimp only at hp ha hpS haS hr
    rw [List.cons_append] at hin
    rw [runFrom.eq_2, runFrom.eq_2, hr]
    rw [runFrom.eq_2, runFrom.eq_2] at hin
    split
    · rename_i hs
      simp only [hs, ↓reduceIte] at hin
      exact runFrom_sandwich rem remT cs csT csS l2 st rest hnd' hrem' hcut' hcutS' hin
    · rename_i hs
      simp only [hs, Bool.false_eq_true, ↓reduceIte] at hin
      have hTS : ok (apply (hide st (hiddenAt csT i edit)) edit) = some () →
          ok (apply (hide st (hiddenAt csS i edit)) edit) = some () :=
        apply_hide_mono st (by rw [hpS, hp]) haS edit
      have hFT := apply_hide_mono st hp ha edit
      rcases hF : apply (hide st (hiddenAt cs i edit)) edit with _ | a <;>
        rcases hT : apply (hide st (hiddenAt csT i edit)) edit with _ | b <;>
        rcases hS : apply (hide st (hiddenAt csS i edit)) edit with _ | c <;>
        rcases hst : step st edit with _ | st' <;>
        rw [hF, hT] at hFT <;> rw [hT, hS] at hTS <;> simp only [hF, hS, hst] at hin ⊢ <;>
        simp only [ok, Option.map_none, Option.map_some, reduceCtorEq, forall_const, imp_false] at hFT hTS
      all_goals first
        | exact runFrom_sandwich rem remT cs csT csS l2 st rest hnd' hrem' hcut' hcutS' hin
        | (rw [runFrom_sandwich rem remT cs csT csS l2 st' rest hnd' hrem' hcut' hcutS'
              (by rw [runFrom_append, runFrom_append] at hin ⊢; simpa using hin)])
        | (exfalso; have hm := congrArg (fun r => edit ∈ r.2) hin
           simp only [List.mem_cons, true_or, eq_iff_iff] at hm
           exact hnot (Shares.runFrom_snd_mem _ _ _ _ _ (hm.1 trivial)))

/-! ## A replay split at a place -/

/-- The cuts of the removals of `rem` among `l`, each at its place counted from `n`, taking away what they take among
    `edits`. -/
def cutsAt (edits rem l : List Edit) (n : Nat) : List (Nat × List EditId × List Fact) :=
  (l.zipIdx n).filterMap fun (r, j) =>
    if rem.any (·.id == r.id) then some (j, r.action.keep?.getD [], removes edits r) else none

theorem cuts_eq_cutsAt (edits rem : List Edit) : cuts edits rem = cutsAt edits rem edits 0 := rfl

theorem cutsAt_append (edits rem l₁ l₂ : List Edit) (n : Nat) :
    cutsAt edits rem (l₁ ++ l₂) n = cutsAt edits rem l₁ n ++ cutsAt edits rem l₂ (n + l₁.length) := by
  unfold cutsAt; rw [List.zipIdx_append, List.filterMap_append]

theorem hiddenAt_append' (a b : List (Nat × List EditId × List Fact)) (i : Nat) (edit : Edit) :
    hiddenAt (a ++ b) i edit = hiddenAt a i edit ++ hiddenAt b i edit := by
  unfold hiddenAt; rw [List.filter_append, List.flatMap_append]

/-- What the removals of `rem` among `l` hide from an edit before every one of them. -/
def tailFacts (edits rem l : List Edit) (x : Edit) : List Fact :=
  (l.filter fun r => rem.any (·.id == r.id)).flatMap fun r =>
    if (r.action.keep?.getD []).contains x.id then [] else removes edits r

theorem hiddenAt_cutsAt_before (edits rem : List Edit) (x : Edit) :
    ∀ (l : List Edit) (n i : Nat), i < n → hiddenAt (cutsAt edits rem l n) i x = tailFacts edits rem l x
  | [], _, _, _ => rfl
  | r :: l, n, i, hi => by
    have ih := hiddenAt_cutsAt_before edits rem x l (n + 1) i (by omega)
    unfold cutsAt tailFacts at ih ⊢
    simp only [List.zipIdx_cons, List.filterMap_cons, List.filter_cons]
    by_cases hr : rem.any (·.id == r.id) = true
    · simp only [hr, ↓reduceIte, List.flatMap_cons]
      unfold hiddenAt at ih ⊢
      rw [List.filter_cons, ← ih]
      have : decide (i < n) = true := by simpa using hi
      simp only [this, Bool.true_and]
      split <;> simp_all
    · simp only [hr, Bool.false_eq_true, ↓reduceIte]
      exact ih

theorem cutsAt_congr {edits edits' rem rem' : List Edit}
    (hrem : ∀ r ∈ l, rem'.any (·.id == r.id) = rem.any (·.id == r.id))
    (hrm : ∀ r ∈ l, rem.any (·.id == r.id) = true → removes edits' r = removes edits r) :
    ∀ n, cutsAt edits' rem' l n = cutsAt edits rem l n := by
  induction l with
  | nil => intro n; rfl
  | cons r l ih =>
    intro n
    have ih' := ih (fun q hq => hrem q (List.mem_cons_of_mem _ hq)) (fun q hq => hrm q (List.mem_cons_of_mem _ hq))
      (n + 1)
    unfold cutsAt at ih' ⊢
    simp only [List.zipIdx_cons, List.filterMap_cons, hrem r List.mem_cons_self]
    by_cases h : rem.any (·.id == r.id) = true
    · simp only [h, ↓reduceIte, hrm r List.mem_cons_self h]
      exact congrArg _ ih'
    · simp only [h, Bool.false_eq_true, ↓reduceIte]
      exact ih'

/-- A replay of edits that are removals alike, and have the same facts hidden, is the same replay. -/
theorem runFrom_congr (rem rem' : List Edit) (cs cs' : List (Nat × List EditId × List Fact)) :
    ∀ (st : State) (l : List (Edit × Nat)),
      (∀ p ∈ l, rem'.any (·.id == p.1.id) = rem.any (·.id == p.1.id) ∧ hiddenAt cs' p.2 p.1 = hiddenAt cs p.2 p.1) →
      runFrom rem' cs' st l = runFrom rem cs st l
  | _, [], _ => rfl
  | st, (edit, i) :: rest, h => by
    obtain ⟨hr, hh⟩ := h (edit, i) List.mem_cons_self
    have h' := fun p hp => h p (List.mem_cons_of_mem _ hp)
    dsimp only at hr hh
    rw [runFrom.eq_2, runFrom.eq_2, hr, hh]
    split
    · exact runFrom_congr rem rem' cs cs' st rest h'
    · split
      · rename_i st' _ _; rw [runFrom_congr rem rem' cs cs' st' rest h']
      · exact runFrom_congr rem rem' cs cs' st rest h'

/-- **Rewinding**: a replay of edits `p ++ s'`, where the edits `p` before a place are removals alike, every removal
    among them chosen alike takes away what it took, and the removals after the place hide from each of them what the
    removals after it did before, is the replay of `p ++ s` up to the place, then of `s'` from the state it left. -/
theorem V4_rewind (p s s' R R' : List Edit)
    (hrem : ∀ x ∈ p, R'.any (·.id == x.id) = R.any (·.id == x.id))
    (hrm : ∀ r ∈ p, R.any (·.id == r.id) = true → removes (p ++ s') r = removes (p ++ s) r)
    (htail : ∀ x ∈ p, tailFacts (p ++ s') R' s' x = tailFacts (p ++ s) R s x) :
    runWith (p ++ s') R' =
      ((runFrom R' (cuts (p ++ s') R') (runFrom R (cuts (p ++ s) R) {} p.zipIdx).1 (s'.zipIdx p.length)).1,
        (runFrom R (cuts (p ++ s) R) {} p.zipIdx).2 ++
          (runFrom R' (cuts (p ++ s') R') (runFrom R (cuts (p ++ s) R) {} p.zipIdx).1 (s'.zipIdx p.length)).2) := by
  unfold runWith
  rw [List.zipIdx_append, runFrom_append, Nat.zero_add]
  rw [runFrom_congr R R' (cuts (p ++ s) R) (cuts (p ++ s') R') {} p.zipIdx ?h]
  case h =>
    intro q hq
    have hqp := List.fst_mem_of_mem_zipIdx hq
    have hi : q.2 < p.length := by simpa using (List.mem_zipIdx hq).2.1
    refine ⟨hrem q.1 hqp, ?_⟩
    rw [cuts_eq_cutsAt, cuts_eq_cutsAt, cutsAt_append, cutsAt_append, hiddenAt_append', hiddenAt_append',
      hiddenAt_cutsAt_before _ _ _ s' _ _ (by omega), hiddenAt_cutsAt_before _ _ _ s _ _ (by omega),
      htail q.1 hqp, cutsAt_congr hrem hrm]

/-! ## The removals chosen again -/

/-- A removal that doesn't say who may do what: a move. -/
def isMove (x : Edit) : Bool := x.isRemoval && !x.action.isTrust

theorem move_shape {x : Edit} (hx : isMove x = true) :
    ∃ v e to wants keep via, x.action = .mark v e (some to) wants keep via := by
  rcases x with ⟨_, _, _, _, xa, _, _⟩
  simp only [isMove, Bool.and_eq_true, Bool.not_eq_true'] at hx
  cases xa with
  | mark v e caps wants keep via =>
    cases caps with
    | none => simp [Edit.isRemoval, Action.keep?] at hx
    | some to => exact ⟨v, e, to, wants, keep, via, rfl⟩
  | _ => simp_all [Edit.isRemoval, Action.keep?, Action.isTrust]

theorem removes_aud {x : Edit} (hx : isMove x = true) (edits : List Edit) : ∀ f ∈ removes edits x, isAud f = true := by
  obtain ⟨v, e, to, wants, keep, via, h⟩ := move_shape hx
  simp [removes, h, isAud]

theorem prio_move (base : State) {x : Edit} (hx : isMove x = true) : priority base x = [2, 0, 0, 0] := by
  obtain ⟨v, e, to, wants, keep, via, h⟩ := move_shape hx
  simp [priority, h]

theorem prioLe_refl (a : List Nat) : prioLe a a = true := by simpa using prioLe_total a a

/-- The step `resolve` folds over the removals in priority order. -/
def rstep (edits rem : List Edit) (r : Edit) : List Edit :=
  if (r :: rem).all fun x => (runWith edits (rem ++ [r])).2.any (·.id == x.id) then rem ++ [r] else rem

/-- The removals in priority order, as the replay with none standing ranks them. -/
def cands (edits : List Edit) : List Edit :=
  (edits.filter Edit.isRemoval).mergeSort fun a b =>
    prioLe (priority (runWith edits []).1 a) (priority (runWith edits []).1 b)

theorem resolve_eq (edits : List Edit) : resolve edits = (cands edits).foldl (rstep edits) [] := rfl

theorem foldl_rstep_form (edits : List Edit) :
    ∀ (l acc : List Edit), ∃ c, l.foldl (rstep edits) acc = acc ++ c ∧ ∀ y ∈ c, y ∈ l
  | [], acc => ⟨[], by simp⟩
  | r :: l, acc => by
    obtain ⟨c, hc, hm⟩ := foldl_rstep_form edits l (rstep edits acc r)
    rw [List.foldl_cons]
    by_cases h : ((r :: acc).all fun x => (runWith edits (acc ++ [r])).2.any (·.id == x.id)) = true
    · have hs : rstep edits acc r = acc ++ [r] := by unfold rstep; exact ite_eq_left_iff.2 (fun h' => absurd h h')
      rw [hs] at hc
      refine ⟨r :: c, by rw [hs, hc]; simp, fun y hy => ?_⟩
      rcases List.mem_cons.1 hy with rfl | hy
      · exact List.mem_cons_self
      · exact List.mem_cons_of_mem _ (hm y hy)
    · have hs : rstep edits acc r = acc := by unfold rstep; exact ite_eq_right_iff.2 (fun h' => absurd h' h)
      rw [hs] at hc
      exact ⟨c, by rw [hs, hc], fun y hy => List.mem_cons_of_mem _ (hm y hy)⟩

theorem foldl_congr_prefix' {α β : Type} (f g : β → α → β) (b₀ : β) :
    ∀ (l pre₀ : List α), (∀ pre r post, pre₀ ++ l = pre ++ r :: post → f (pre.foldl g b₀) r = g (pre.foldl g b₀) r) →
      l.foldl f (pre₀.foldl g b₀) = l.foldl g (pre₀.foldl g b₀)
  | [], _, _ => rfl
  | r :: l, pre₀, h => by
    rw [List.foldl_cons, List.foldl_cons, h pre₀ r l rfl]
    have := foldl_congr_prefix' f g b₀ l (pre₀ ++ [r]) (fun pre r' post he => h pre r' post (by simp [← he]))
    simpa [List.foldl_append] using this

theorem foldl_congr_prefix {α β : Type} (f g : β → α → β) (b₀ : β) (l : List α)
    (h : ∀ pre r post, l = pre ++ r :: post → f (pre.foldl g b₀) r = g (pre.foldl g b₀) r) :
    l.foldl f b₀ = l.foldl g b₀ :=
  foldl_congr_prefix' f g b₀ l [] (fun pre r post he => h pre r post (by simpa using he))

/-- Of two edits in a list without repeats, the one a sublist puts first comes before the other. -/
theorem pair_after {C pre post : List Edit} {r x : Edit} (hnd : C.Nodup) (hC : C = pre ++ r :: post)
    (h : List.Sublist [r, x] C) : x ∈ post := by
  subst hC
  rw [List.sublist_append_iff] at h
  obtain ⟨l₁, l₂, he, h1, h2⟩ := h
  have hr : r ∉ pre := fun hm => by
    rw [List.nodup_append] at hnd; exact hnd.2.2 r hm r List.mem_cons_self rfl
  match l₁, l₂, he with
  | [], _, he =>
    simp only [List.nil_append] at he; subst he
    exact List.singleton_sublist.1 (List.cons_sublist_cons.1 h2)
  | [a], _, he =>
    simp only [List.cons_append, List.nil_append, List.cons.injEq] at he
    obtain ⟨rfl, -⟩ := he
    exact absurd (List.singleton_sublist.1 h1) hr
  | [a, b], _, he =>
    simp only [List.cons_append, List.nil_append, List.cons.injEq] at he
    obtain ⟨rfl, -⟩ := he
    exact absurd (h1.subset List.mem_cons_self) hr

/-- Of two edits in a list without repeats split in two, one before an edit of the first part is in the first part. -/
theorem pair_in_left {A B : List Edit} {x r : Edit} (hnd : (A ++ B).Nodup) (hr : r ∈ A)
    (h : List.Sublist [x, r] (A ++ B)) : x ∈ A := by
  rw [List.sublist_append_iff] at h
  obtain ⟨l₁, l₂, he, h1, h2⟩ := h
  match l₁, l₂, he with
  | [], _, he =>
    simp only [List.nil_append] at he; subst he
    have hrB : r ∈ B := h2.subset (by simp)
    rw [List.nodup_append] at hnd
    exact absurd rfl (hnd.2.2 r hr r hrB)
  | [a], _, he =>
    simp only [List.cons_append, List.nil_append, List.cons.injEq] at he
    obtain ⟨rfl, -⟩ := he
    exact h1.subset List.mem_cons_self
  | [a, b], _, he =>
    simp only [List.cons_append, List.nil_append, List.cons.injEq] at he
    obtain ⟨rfl, -⟩ := he
    exact h1.subset List.mem_cons_self

/-- Of two edits in a list without repeats, the one a sublist puts first comes before the other. -/
theorem pair_before {C pre post : List Edit} {r x : Edit} (hnd : C.Nodup) (hC : C = pre ++ r :: post)
    (h : List.Sublist [x, r] C) : x ∈ pre := by
  have hC' : C = (pre ++ [r]) ++ post := by rw [hC]; simp
  rw [hC'] at hnd h
  have hx := pair_in_left hnd (by simp) h
  rcases List.mem_append.1 hx with hx | hx
  · exact hx
  · rw [List.mem_singleton] at hx; subst hx
    have := hnd.sublist h
    simp at this

/-- Of two edits of a list, one comes first. -/
theorem pair_order {x r : Edit} : ∀ {l : List Edit}, x ∈ l → r ∈ l → x ≠ r →
    List.Sublist [x, r] l ∨ List.Sublist [r, x] l
  | a :: l, hx, hr, hne => by
    rcases List.mem_cons.1 hx with rfl | hx'
    · rcases List.mem_cons.1 hr with rfl | hr'
      · exact absurd rfl hne
      · exact .inl (List.cons_sublist_cons.2 (List.singleton_sublist.2 hr'))
    · rcases List.mem_cons.1 hr with rfl | hr'
      · exact .inr (List.cons_sublist_cons.2 (List.singleton_sublist.2 hx'))
      · rcases pair_order hx' hr' hne with h | h
        · exact .inl (h.cons _)
        · exact .inr (h.cons _)

theorem nodup_of_map {α β : Type} (f : α → β) : ∀ {l : List α}, (l.map f).Nodup → l.Nodup
  | [], _ => List.nodup_nil
  | a :: l, h => by
    rw [List.map_cons, List.nodup_cons] at h
    exact List.nodup_cons.2 ⟨fun ha => h.1 (List.mem_map_of_mem ha), nodup_of_map f h.2⟩

theorem isMove_isRemoval {x : Edit} (h : isMove x = true) : x.isRemoval = true := by
  simp only [isMove, Bool.and_eq_true] at h; exact h.1

theorem filter_moves (l : List Edit) : (l.filter Edit.isRemoval).filter isMove = l.filter isMove := by
  rw [List.filter_filter]; congr 1; funext x; simp only [isMove]; cases x.isRemoval <;> simp

/-- The removals ranked, in priority order. -/
theorem cands_sorted (o : List Edit) : (cands o).Pairwise fun a b =>
    prioLe (priority (runWith o []).1 a) (priority (runWith o []).1 b) = true := by
  unfold cands
  exact List.pairwise_mergeSort (le := fun a b => prioLe (priority (runWith o []).1 a) (priority (runWith o []).1 b))
    (fun _ _ _ h1 h2 => prioLe_trans _ _ _ h1 h2) (fun _ _ => prioLe_total _ _) _

/-- Moves rank alike, so the ranking keeps them in their order. -/
theorem moves_sublist_cands (o : List Edit) : List.Sublist (o.filter isMove) (cands o) := by
  unfold cands
  refine List.sublist_mergeSort (le := fun a b => prioLe (priority (runWith o []).1 a) (priority (runWith o []).1 b))
    (fun _ _ _ h1 h2 => prioLe_trans _ _ _ h1 h2) (fun _ _ => prioLe_total _ _) ?_ ?_
  · refine List.pairwise_of_forall_mem_list fun a ha b hb => ?_
    rw [prio_move _ (List.mem_filter.1 ha).2, prio_move _ (List.mem_filter.1 hb).2]
    exact prioLe_refl _
  · rw [← filter_moves]; exact List.filter_sublist

theorem cands_nodup {o : List Edit} (hnd : o.Nodup) : (cands o).Nodup :=
  (List.mergeSort_perm _ _).nodup_iff.2 (hnd.sublist List.filter_sublist)

theorem mem_cands {o : List Edit} {x : Edit} (h : x ∈ cands o) : x ∈ o ∧ x.isRemoval = true :=
  List.mem_filter.1 (List.mem_mergeSort.1 h)

/-- A removal ranked before another says who may do what, or both are moves and it comes first. -/
theorem ranked_before {o pre post : List Edit} {r x : Edit} (hnd : o.Nodup) (hC : cands o = pre ++ r :: post)
    (hx : x ∈ pre) :
    x.action.isTrust = true ∨ (isMove x = true ∧ isMove r = true ∧ List.Sublist [x, r] (o.filter isMove)) := by
  have hCn := cands_nodup hnd
  obtain ⟨hxo, hxr⟩ := mem_cands (o := o) (by rw [hC]; exact List.mem_append_left _ hx)
  obtain ⟨hro, hrr⟩ := mem_cands (o := o) (x := r) (by rw [hC]; simp)
  cases ht : x.action.isTrust
  · right
    have hxm : isMove x = true := by simp [isMove, hxr, ht]
    have hle : prioLe (priority (runWith o []).1 x) (priority (runWith o []).1 r) = true := by
      have hs := cands_sorted o; rw [hC] at hs
      exact (List.pairwise_append.1 hs).2.2 x hx r List.mem_cons_self
    cases hrt : r.action.isTrust
    · have hrm : isMove r = true := by simp [isMove, hrr, hrt]
      refine ⟨hxm, hrm, ?_⟩
      have hne : x ≠ r := by
        rintro rfl; rw [hC] at hCn; exact (List.nodup_append.1 hCn).2.2 x hx x List.mem_cons_self rfl
      rcases pair_order (List.mem_filter.2 ⟨hxo, hxm⟩) (List.mem_filter.2 ⟨hro, hrm⟩) hne with h | h
      · exact h
      · have hp := pair_after hCn hC (h.trans (moves_sublist_cands o))
        rw [hC] at hCn
        exact absurd rfl ((List.nodup_append.1 hCn).2.2 x hx x (List.mem_cons_of_mem _ hp))
    · rw [prioLe_mark_trust _ hxr ht hrr hrt] at hle; exact absurd hle (by simp)
  · exact .inl rfl

/-- A removal ranked after a move is a move after it. -/
theorem ranked_after {o pre post : List Edit} {r y : Edit} (hnd : o.Nodup) (hC : cands o = pre ++ r :: post)
    (hr : isMove r = true) (hy : y ∈ post) : isMove y = true ∧ List.Sublist [r, y] (o.filter isMove) := by
  have hCn := cands_nodup hnd
  obtain ⟨hyo, hyr⟩ := mem_cands (o := o) (by rw [hC]; exact List.mem_append_right _ (List.mem_cons_of_mem _ hy))
  obtain ⟨hro, -⟩ := mem_cands (o := o) (x := r) (by rw [hC]; simp)
  have hle : prioLe (priority (runWith o []).1 r) (priority (runWith o []).1 y) = true := by
    have hs := cands_sorted o; rw [hC] at hs
    exact (List.pairwise_cons.1 (List.pairwise_append.1 hs).2.1).1 y hy
  cases hyt : y.action.isTrust
  · have hym : isMove y = true := by simp [isMove, hyr, hyt]
    refine ⟨hym, ?_⟩
    have hne : y ≠ r := by
      rintro rfl; rw [hC] at hCn
      exact (List.nodup_cons.1 (List.nodup_append.1 hCn).2.1).1 hy
    rcases pair_order (List.mem_filter.2 ⟨hyo, hym⟩) (List.mem_filter.2 ⟨hro, hr⟩) hne with h | h
    · have hp := pair_before hCn hC (h.trans (moves_sublist_cands o))
      rw [hC] at hCn
      exact absurd rfl ((List.nodup_append.1 hCn).2.2 y hp y (List.mem_cons_of_mem _ hy))
    · exact h
  · have hrr := isMove_isRemoval hr
    have hrt : r.action.isTrust = false := by simp only [isMove, Bool.and_eq_true] at hr; simpa using hr.2
    rw [prioLe_mark_trust _ hrr hrt hyr hyt] at hle; exact absurd hle (by simp)

/-! ## What the removals hide, compared -/

/-- The cuts of the removals of `rem` among `p ++ s`, with what those among `s` hide set apart where no move hides it:
    the replay with them is the replay with the moves after the place hiding nothing. -/
def stripTail (edits rem p s : List Edit) : List (Nat × List EditId × List Fact) :=
  cutsAt edits rem p 0 ++ strip (cutsAt edits rem s p.length)

theorem cutsAt_cons (edits X : List Edit) (y : Edit) (l : List Edit) (n : Nat) :
    cutsAt edits X (y :: l) n =
      (if X.any (·.id == y.id) then [(n, y.action.keep?.getD [], removes edits y)] else []) ++
        cutsAt edits X l (n + 1) := by
  unfold cutsAt; rw [List.zipIdx_cons, List.filterMap_cons]
  by_cases h : X.any (·.id == y.id) = true <;> simp [h]

theorem hiddenAt_nil (i : Nat) (x : Edit) : hiddenAt [] i x = [] := rfl

theorem plain_nil : plain [] = [] := rfl

theorem hiddenAt_one (c : Nat × List EditId × List Fact) (i : Nat) (x : Edit) : ∀ f ∈ hiddenAt [c] i x, f ∈ c.2.2 := by
  intro f hf; unfold hiddenAt at hf; simp only [List.filter_cons, List.filter_nil] at hf; split at hf <;> simp_all

theorem plain_plain (fs : List Fact) : plain (plain fs) = plain fs := by
  unfold plain; rw [List.filter_filter]; congr 1; funext f; cases isAud f <;> rfl

theorem mem_plain {f : Fact} {fs : List Fact} : f ∈ plain fs ↔ f ∈ fs ∧ isAud f = false := by
  simp [plain, List.mem_filter]

/-- With fewer removals chosen among `l`, the others moves, an edit has the same facts hidden that no move hides, and
    fewer that moves hide. -/
theorem hiddenAt_cutsAt_mono (edits T R : List Edit) (i : Nat) (x : Edit) :
    ∀ (l : List Edit) (n : Nat), (∀ y ∈ l, T.any (·.id == y.id) = true → R.any (·.id == y.id) = true) →
      (∀ y ∈ l, R.any (·.id == y.id) = true → T.any (·.id == y.id) = false → isMove y = true) →
      plain (hiddenAt (cutsAt edits T l n) i x) = plain (hiddenAt (cutsAt edits R l n) i x) ∧
        ∀ f ∈ hiddenAt (cutsAt edits T l n) i x, f ∈ hiddenAt (cutsAt edits R l n) i x
  | [], _, _, _ => ⟨rfl, fun _ h => h⟩
  | y :: l, n, hTR, hmv => by
    obtain ⟨ih1, ih2⟩ := hiddenAt_cutsAt_mono edits T R i x l (n + 1)
      (fun z hz => hTR z (List.mem_cons_of_mem _ hz)) (fun z hz => hmv z (List.mem_cons_of_mem _ hz))
    rw [cutsAt_cons, cutsAt_cons, hiddenAt_append', hiddenAt_append', plain_append, plain_append]
    by_cases hT : T.any (·.id == y.id) = true
    · have hR := hTR y List.mem_cons_self hT
      simp only [hT, hR, ↓reduceIte]
      refine ⟨by rw [ih1], fun f hf => ?_⟩
      rcases List.mem_append.1 hf with hf | hf
      · exact List.mem_append_left _ hf
      · exact List.mem_append_right _ (ih2 f hf)
    · have hT' : T.any (·.id == y.id) = false := by simpa using hT
      by_cases hR : R.any (·.id == y.id) = true
      · have hm := hmv y List.mem_cons_self hR hT'
        have hp : plain (hiddenAt [(n, y.action.keep?.getD [], removes edits y)] i x) = [] :=
          List.filter_eq_nil_iff.2 fun f hf => by simp [removes_aud hm edits f (hiddenAt_one _ i x f hf)]
        simp only [hT', hR, Bool.false_eq_true, ↓reduceIte, hiddenAt_nil, plain_nil, List.nil_append, hp]
        exact ⟨ih1, fun f hf => List.mem_append_right _ (ih2 f hf)⟩
      · have hR' : R.any (·.id == y.id) = false := by simpa using hR
        simp only [hT', hR', Bool.false_eq_true, ↓reduceIte, hiddenAt_nil, plain_nil, List.nil_append]
        exact ⟨ih1, ih2⟩

theorem zipIdx_ids (l : List Edit) (n : Nat) : (l.zipIdx n).map (·.1.id) = l.map Edit.id := by
  rw [show (fun q : Edit × Nat => q.1.id) = Edit.id ∘ Prod.fst from rfl, ← List.map_map, List.zipIdx_map_fst]

/-- None of the edits of a run over `t` that stood is `x`, where none of `t` has its id. -/
theorem any_tail_false {rem : List Edit} {cs : List (Nat × List EditId × List Fact)} {st : State} {t : List Edit}
    {n : Nat} {x : Edit} (h : ∀ y ∈ t, y.id ≠ x.id) : (runFrom rem cs st (t.zipIdx n)).2.any (·.id == x.id) = false :=
  List.any_eq_false.2 fun y hy => by
    have := Shares.runFrom_snd_mem rem cs st _ y hy
    rw [List.zipIdx_map_fst] at this
    simpa using h y this

/-! ## The removals chosen again -/

/-- **The removals chosen again**: where the edits `s'` after a place hold the removals the edits `s` did, every removal
    among `s` is a move that `resolve` chose, the removals rank as before and take away what they took, and the replay
    of `p ++ s'` with the removals chosen keeps each of them standing and is inert, the moves among `s'` hiding nothing
    that keeps an edit out, `resolve` chooses the removals it chose. -/
theorem resolve_tail (p s s' : List Edit)
    (hids : ((p ++ s).map Edit.id).Nodup) (hids' : ((p ++ s').map Edit.id).Nodup)
    (hrems : s'.filter Edit.isRemoval = s.filter Edit.isRemoval)
    (hmoves : ∀ x ∈ s, x.isRemoval = true → x.action.isTrust = false)
    (hchosen : ∀ x ∈ s, x.isRemoval = true → x ∈ resolve (p ++ s))
    (hcands : cands (p ++ s') = cands (p ++ s))
    (hrm : ∀ r ∈ p ++ s, r.isRemoval = true → removes (p ++ s') r = removes (p ++ s) r)
    (hstand : ∀ x ∈ resolve (p ++ s), (runWith (p ++ s') (resolve (p ++ s))).2.any (·.id == x.id) = true)
    (hinert : runFrom (resolve (p ++ s)) (stripTail (p ++ s') (resolve (p ++ s)) p s') {} (p ++ s').zipIdx =
      runWith (p ++ s') (resolve (p ++ s))) :
    resolve (p ++ s') = resolve (p ++ s) := by
  have hnd := nodup_of_map _ hids
  have hnd' := nodup_of_map _ hids'
  have hM : (p ++ s').filter isMove = (p ++ s).filter isMove := by
    rw [List.filter_append, List.filter_append, ← filter_moves s', ← filter_moves s, hrems]
  rw [resolve_eq (p ++ s'), resolve_eq (p ++ s), hcands]
  refine foldl_congr_prefix (rstep (p ++ s')) (rstep (p ++ s)) [] (cands (p ++ s)) fun pre r post hC => ?_
  obtain ⟨b, hb, hbpre⟩ := foldl_rstep_form (p ++ s) pre []
  simp only [List.nil_append] at hb
  rw [hb]
  obtain ⟨hro, hrr⟩ := mem_cands (o := p ++ s) (x := r) (by rw [hC]; simp)
  have hCn := cands_nodup hnd
  have hrpre : r ∉ pre := fun h => by
    rw [hC] at hCn; exact (List.nodup_append.1 hCn).2.2 r h r List.mem_cons_self rfl
  have hrpost : r ∉ post := fun h => by
    rw [hC] at hCn; exact (List.nodup_cons.1 (List.nodup_append.1 hCn).2.1).1 h
  have hTrem : ∀ x ∈ b ++ [r], x.isRemoval = true := by
    intro x hx
    rcases List.mem_append.1 hx with hx | hx
    · exact (mem_cands (o := p ++ s) (by rw [hC]; exact List.mem_append_left _ (hbpre x hx))).2
    · rw [List.mem_singleton] at hx; exact hx ▸ hrr
  -- every removal tried before `r` lies before the place, or is a move before `r`
  have hbefore : ∀ x ∈ b,
      x ∈ p ∨ (isMove x = true ∧ isMove r = true ∧ List.Sublist [x, r] ((p ++ s).filter isMove)) := by
    intro x hx
    rcases ranked_before hnd hC (hbpre x hx) with ht | h
    · left
      obtain ⟨hxo, hxr⟩ := mem_cands (o := p ++ s) (x := x) (by rw [hC]; exact List.mem_append_left _ (hbpre x hx))
      rcases List.mem_append.1 hxo with h | h
      · exact h
      · rw [hmoves x h hxr] at ht; exact absurd ht (by simp)
    · exact .inr h
  rcases List.mem_append.1 hro with hrp | hrs
  · -- `r` lies before the place: so does every removal tried with it, and the edits after the place change nothing
    have hTp : ∀ x ∈ b ++ [r], x ∈ p := by
      intro x hx
      rcases List.mem_append.1 hx with hx | hx
      · rcases hbefore x hx with h | ⟨-, hrm', hs⟩
        · exact h
        · have hnM : ((p ++ s).filter isMove).Nodup := hnd.sublist List.filter_sublist
          rw [List.filter_append] at hs hnM
          exact (List.mem_filter.1 (pair_in_left hnM (List.mem_filter.2 ⟨hrp, hrm'⟩) hs)).1
      · rw [List.mem_singleton] at hx; exact hx ▸ hrp
    have hnil : ∀ t : List Edit, (∀ y ∈ t, ∀ z ∈ p, z.id ≠ y.id) →
        t.filter (fun y => (b ++ [r]).any (·.id == y.id)) = [] := by
      intro t ht
      refine List.filter_eq_nil_iff.2 fun y hy h => ?_
      obtain ⟨z, hz, he⟩ := List.any_eq_true.1 h
      exact ht y hy z (hTp z hz) (by simpa using he)
    have hdis : ∀ (t : List Edit), ((p ++ t).map Edit.id).Nodup → ∀ y ∈ t, ∀ z ∈ p, z.id ≠ y.id := by
      intro t h y hy z hz
      rw [List.map_append, List.nodup_append] at h
      exact h.2.2 _ (List.mem_map_of_mem hz) _ (List.mem_map_of_mem hy)
    have hT := V4_rewind p s s' (b ++ [r]) (b ++ [r]) (fun _ _ => rfl)
      (fun y hy h => by
        obtain ⟨z, hz, he⟩ := List.any_eq_true.1 h
        have hzy : z = y := eq_of_id_eq hids (List.mem_append_left _ (hTp z hz)) (List.mem_append_left _ hy)
          (by simpa using he)
        exact hrm y (List.mem_append_left _ hy) (hzy ▸ hTrem z hz))
      (fun x _ => by
        unfold tailFacts
        rw [hnil s' (hdis s' hids'), hnil s (hdis s hids)]; rfl)
    have hT0 := V4_rewind p s s (b ++ [r]) (b ++ [r]) (fun _ _ => rfl) (fun _ _ _ => rfl) (fun _ _ => rfl)
    have hc : ((r :: b).all fun x => (runWith (p ++ s') (b ++ [r])).2.any (·.id == x.id)) =
        ((r :: b).all fun x => (runWith (p ++ s) (b ++ [r])).2.any (·.id == x.id)) := by
      rw [hT, hT0]
      refine Stored.all_congr_mem fun x hx => ?_
      have hxp : x ∈ p := hTp x (by
        rcases List.mem_cons.1 hx with rfl | hx
        · simp
        · exact List.mem_append_left _ hx)
      simp only [List.any_append]
      rw [any_tail_false (fun y hy => (hdis s' hids' y hy x hxp).symm),
        any_tail_false (fun y hy => (hdis s hids y hy x hxp).symm)]
    unfold rstep
    rw [hc]
  · -- `r` is a move after the place that stood, tried again with the removals chosen before it
    have hrt := hmoves r hrs hrr
    have hrm' : isMove r = true := by simp [isMove, hrr, hrt]
    have hrR := hchosen r hrs hrr
    have hR : resolve (p ++ s) = post.foldl (rstep (p ++ s)) (rstep (p ++ s) b r) := by
      rw [resolve_eq, hC, List.foldl_append, List.foldl_cons, hb]
    obtain ⟨c, hc, hcpost⟩ := foldl_rstep_form (p ++ s) post (rstep (p ++ s) b r)
    rw [hc] at hR
    have hstep : rstep (p ++ s) b r = b ++ [r] := by
      have h2 : rstep (p ++ s) b r = b ++ [r] ∨ rstep (p ++ s) b r = b := by unfold rstep; split <;> simp
      rcases h2 with h2 | h2
      · exact h2
      · exfalso; rw [h2] at hR; rw [hR] at hrR
        rcases List.mem_append.1 hrR with h | h
        · exact hrpre (hbpre r h)
        · exact hrpost (hcpost r h)
    rw [hstep] at hR
    have hrs' : r ∈ s' := by
      have : r ∈ s'.filter Edit.isRemoval := by rw [hrems]; exact List.mem_filter.2 ⟨hrs, hrr⟩
      exact (List.mem_filter.1 this).1
    obtain ⟨q₁, t, hs'⟩ := List.append_of_mem hrs'
    have ho' : p ++ s' = (p ++ q₁) ++ r :: t := by rw [hs']; simp
    have hQ : p ++ s' = (p ++ q₁ ++ [r]) ++ t := by rw [ho']; simp
    have hct : ∀ y ∈ c, y ∈ t ∧ isMove y = true := by
      intro y hy
      obtain ⟨hym, hsub⟩ := ranked_after hnd hC hrm' (hcpost y hy)
      rw [← hM] at hsub
      exact ⟨pair_after hnd' ho' (hsub.trans List.filter_sublist), hym⟩
    have hbq : ∀ x ∈ b, x ∈ p ++ q₁ := by
      intro x hx
      rcases hbefore x hx with h | ⟨-, -, hsub⟩
      · exact List.mem_append_left _ h
      · rw [← hM] at hsub; exact pair_before hnd' ho' (hsub.trans List.filter_sublist)
    have hQt : ∀ z ∈ p ++ q₁ ++ [r], ∀ y ∈ t, z.id ≠ y.id := by
      have h := hids'; rw [hQ, List.map_append, List.nodup_append] at h
      exact fun z hz y hy => h.2.2 _ (List.mem_map_of_mem hz) _ (List.mem_map_of_mem hy)
    have hagree : ∀ z ∈ p ++ q₁ ++ [r], (b ++ [r]).any (·.id == z.id) = (resolve (p ++ s)).any (·.id == z.id) := by
      intro z hz
      have : c.any (·.id == z.id) = false :=
        List.any_eq_false.2 fun y hy h => hQt z hz y (hct y hy).1 (beq_iff_eq.1 h).symm
      rw [hR, List.any_append (xs := b ++ [r]), this, Bool.or_false]
    have hTR : ∀ y ∈ s', (b ++ [r]).any (·.id == y.id) = true → (resolve (p ++ s)).any (·.id == y.id) = true := by
      intro y _ h; rw [hR, List.any_append, h, Bool.true_or]
    have hmv : ∀ y ∈ s', (resolve (p ++ s)).any (·.id == y.id) = true → (b ++ [r]).any (·.id == y.id) = false →
        isMove y = true := by
      intro y hy h hT
      rw [hR, List.any_append, hT, Bool.false_or] at h
      obtain ⟨z, hz, he⟩ := List.any_eq_true.1 h
      have hzt := (hct z hz).1
      have hzy : z = y := eq_of_id_eq hids' (by rw [hQ]; exact List.mem_append_right _ hzt)
        (List.mem_append_right _ hy) (by simpa using he)
      exact hzy ▸ (hct z hz).2
    have hsplit : ∀ X : List Edit, cuts (p ++ s') X = cutsAt (p ++ s') X p 0 ++ cutsAt (p ++ s') X s' p.length := by
      intro X; rw [cuts_eq_cutsAt, cutsAt_append, Nat.zero_add]
    have hA : cutsAt (p ++ s') (b ++ [r]) p 0 = cutsAt (p ++ s') (resolve (p ++ s)) p 0 :=
      cutsAt_congr (fun z hz => hagree z (by simp [hz])) (fun _ _ _ => rfl) 0
    have hcutT : ∀ (i : Nat) (x : Edit),
        plain (hiddenAt (cuts (p ++ s') (b ++ [r])) i x) = plain (hiddenAt (cuts (p ++ s') (resolve (p ++ s))) i x) ∧
          ∀ f ∈ hiddenAt (cuts (p ++ s') (b ++ [r])) i x, isAud f = true →
            f ∈ hiddenAt (cuts (p ++ s') (resolve (p ++ s))) i x := by
      intro i x
      obtain ⟨h1, h2⟩ := hiddenAt_cutsAt_mono (p ++ s') (b ++ [r]) (resolve (p ++ s)) i x s' p.length hTR hmv
      rw [hsplit, hsplit, hiddenAt_append', hiddenAt_append', hA, plain_append, plain_append, h1]
      refine ⟨rfl, fun f hf _ => ?_⟩
      rcases List.mem_append.1 hf with hf | hf
      · exact List.mem_append_left _ hf
      · exact List.mem_append_right _ (h2 f hf)
    have hcutS : ∀ (i : Nat) (x : Edit),
        plain (hiddenAt (stripTail (p ++ s') (resolve (p ++ s)) p s') i x) =
          plain (hiddenAt (cuts (p ++ s') (resolve (p ++ s))) i x) ∧
          ∀ f ∈ hiddenAt (stripTail (p ++ s') (resolve (p ++ s)) p s') i x, isAud f = true →
            f ∈ hiddenAt (cuts (p ++ s') (b ++ [r])) i x := by
      intro i x
      unfold stripTail
      rw [hsplit, hsplit, hiddenAt_append', hiddenAt_append', hiddenAt_append', hiddenAt_strip, hA, plain_append,
        plain_append, plain_plain]
      refine ⟨rfl, fun f hf hfa => ?_⟩
      rcases List.mem_append.1 hf with hf | hf
      · exact List.mem_append_left _ hf
      · rw [mem_plain] at hf; rw [hf.2] at hfa; exact absurd hfa (by simp)
    have hzip : (p ++ s').zipIdx = (p ++ q₁ ++ [r]).zipIdx ++ t.zipIdx (p ++ q₁ ++ [r]).length := by
      rw [hQ, List.zipIdx_append, Nat.zero_add]
    have hsw := runFrom_sandwich (resolve (p ++ s)) (b ++ [r]) (cuts (p ++ s') (resolve (p ++ s)))
      (cuts (p ++ s') (b ++ [r])) (stripTail (p ++ s') (resolve (p ++ s)) p s') (t.zipIdx (p ++ q₁ ++ [r]).length) {}
      (p ++ q₁ ++ [r]).zipIdx (by rw [← hzip, zipIdx_ids]; exact hids')
      (fun z hz => hagree z.1 (List.fst_mem_of_mem_zipIdx hz))
      (fun z _ => hcutT z.2 z.1) (fun z _ => hcutS z.2 z.1) (by rw [← hzip]; exact hinert)
    have hcond : ((r :: b).all fun x => (runWith (p ++ s') (b ++ [r])).2.any (·.id == x.id)) = true := by
      refine List.all_eq_true.2 fun x hx => ?_
      have hxQ : x ∈ p ++ q₁ ++ [r] := by
        rcases List.mem_cons.1 hx with rfl | hx
        · simp
        · exact List.mem_append_left _ (hbq x hx)
      have hxR : x ∈ resolve (p ++ s) := by
        rw [hR]; rcases List.mem_cons.1 hx with rfl | hx
        · simp
        · simp [hx]
      have hs := hstand x hxR
      unfold runWith at hs ⊢
      rw [hzip, runFrom_append] at hs ⊢
      rw [List.any_append, any_tail_false (fun y hy => (hQt x hxQ y hy).symm), Bool.or_false] at hs
      rw [List.any_append, hsw, hs, Bool.true_or]
    rw [hstep]
    simp only [rstep, hcond, ↓reduceIte]

/-! ## A late edit replays the last edits -/

theorem flatMap_congr_mem {α β : Type} {f g : α → List β} : ∀ {l : List α}, (∀ x ∈ l, f x = g x) →
    l.flatMap f = l.flatMap g
  | [], _ => rfl
  | a :: l, h => by
    rw [List.flatMap_cons, List.flatMap_cons, h a List.mem_cons_self,
      flatMap_congr_mem fun x hx => h x (List.mem_cons_of_mem _ hx)]

/-- The removals among `l` hide nothing from an edit after all of them. -/
theorem hiddenAt_cutsAt_past (edits rem : List Edit) (x : Edit) :
    ∀ (l : List Edit) (n i : Nat), n + l.length ≤ i → hiddenAt (cutsAt edits rem l n) i x = []
  | [], _, _, _ => rfl
  | y :: l, n, i, h => by
    have h' : n + 1 + l.length ≤ i := by simp at h; omega
    have hi : ¬ i < n := by simp at h; omega
    rw [cutsAt_cons, hiddenAt_append', hiddenAt_cutsAt_past edits rem x l (n + 1) i h']
    split <;> simp [hiddenAt, hi]

/-- `resolve` chooses removals among the edits. -/
theorem resolve_removals (o : List Edit) : ∀ x ∈ resolve o, x ∈ o ∧ x.isRemoval = true := by
  intro x hx
  rw [resolve_eq] at hx
  obtain ⟨c, hc, hm⟩ := foldl_rstep_form o (cands o) []
  rw [hc, List.nil_append] at hx
  exact mem_cands (hm x hx)

/-- Where every edit of `l` a test picks is a removal, picking among the removals picks the same. -/
theorem filter_removals (f : Edit → Bool) {l : List Edit} (h : ∀ y ∈ l, f y = true → y.isRemoval = true) :
    l.filter f = (l.filter Edit.isRemoval).filter f := by
  rw [List.filter_filter]
  refine List.filter_congr fun y hy => ?_
  cases hf : f y
  · rfl
  · simp [h y hy hf]

/-- A replay split at a place: the edits `p` before it, then the edits `s` after it, from the state the edits before it
    left, with what only the removals after the place hide. -/
theorem runWith_split (p s : List Edit) (R : List Edit) :
    runWith (p ++ s) R =
      ((runFrom R (cutsAt (p ++ s) R s p.length) (runFrom R (cuts (p ++ s) R) {} p.zipIdx).1 (s.zipIdx p.length)).1,
        (runFrom R (cuts (p ++ s) R) {} p.zipIdx).2 ++
          (runFrom R (cutsAt (p ++ s) R s p.length) (runFrom R (cuts (p ++ s) R) {} p.zipIdx).1
            (s.zipIdx p.length)).2) := by
  unfold runWith
  rw [List.zipIdx_append, runFrom_append, Nat.zero_add]
  rw [runFrom_congr R R (cutsAt (p ++ s) R s p.length) (cuts (p ++ s) R) _ (s.zipIdx p.length) ?h]
  case h =>
    rintro ⟨y, i⟩ hq
    have hi := (List.mem_zipIdx hq).1
    refine ⟨rfl, ?_⟩
    dsimp only
    rw [cuts_eq_cutsAt, cutsAt_append, hiddenAt_append', hiddenAt_cutsAt_past _ _ _ p 0 i (by omega),
      List.nil_append, Nat.zero_add]

/-- What a device keeps of the edits before the place: the state there, and the edits before it that stood. -/
def kept (p s : List Edit) : State × List Edit :=
  runFrom (resolve (p ++ s)) (cuts (p ++ s) (resolve (p ++ s))) {} p.zipIdx

/-- The edits `s'` after the place replayed from the state kept there, with the removals chosen before: what the
    removals among them hide from them, and only that. -/
def tailRun (p s s' : List Edit) : State × List Edit :=
  runFrom (resolve (p ++ s)) (cutsAt (p ++ s') (resolve (p ++ s)) s' p.length) (kept p s).1 (s'.zipIdx p.length)

/-- **V4 (a late edit replays the last edits)**: a device that kept the replay of the edits it held, `p ++ s` in
    order, at a place after `p`, and receives edits that sort after it, `p ++ s'` in order with the same removals after
    the place, all of them moves that stood, replays only `s'` from the state it kept there, with the removals it chose:
    where the removals rank as before and take away what they took, every move after the place stands again, and the
    moves after the place hide nothing that keeps an edit out, from the edits before the place as from those after it.
    The edits before the place stand as they stood. -/
theorem V4_tail_replays (held fresh p s s' : List Edit)
    (ho : order held = p ++ s) (ho' : order (held ++ fresh) = p ++ s')
    (hids : ((p ++ s).map Edit.id).Nodup) (hids' : ((p ++ s').map Edit.id).Nodup)
    (hrems : s'.filter Edit.isRemoval = s.filter Edit.isRemoval)
    (hmoves : ∀ x ∈ s, x.isRemoval = true → x.action.isTrust = false)
    (hchosen : ∀ x ∈ s, x.isRemoval = true → x ∈ resolve (p ++ s))
    (hcands : cands (p ++ s') = cands (p ++ s))
    (hrm : ∀ r ∈ p ++ s, r.isRemoval = true → removes (p ++ s') r = removes (p ++ s) r)
    (hstands : ∀ x ∈ s, x.isRemoval = true → (tailRun p s s').2.any (·.id == x.id) = true)
    (hinertP : runFrom (resolve (p ++ s)) (stripTail (p ++ s) (resolve (p ++ s)) p s) {} p.zipIdx = kept p s)
    (hinertT : runFrom (resolve (p ++ s)) (strip (cutsAt (p ++ s') (resolve (p ++ s)) s' p.length)) (kept p s).1
      (s'.zipIdx p.length) = tailRun p s s') :
    view (held ++ fresh) = (tailRun p s s').1 ∧ standing (held ++ fresh) = (kept p s).2 ++ (tailRun p s s').2 ∧
      standing held = (kept p s).2 ++ (tailRun p s s).2 := by
  have hdis : ∀ x ∈ p, ∀ y ∈ s, y.id ≠ x.id := by
    have h := hids; rw [List.map_append, List.nodup_append] at h
    exact fun x hx y hy he => h.2.2 _ (List.mem_map_of_mem hx) _ (List.mem_map_of_mem hy) he.symm
  -- a removal chosen is a removal held, in both orders
  have hsame : ∀ y ∈ p ++ s', (resolve (p ++ s)).any (·.id == y.id) = true → y ∈ resolve (p ++ s) := by
    intro y hy h
    obtain ⟨z, hz, he⟩ := List.any_eq_true.1 h
    obtain ⟨hzo, hzr⟩ := resolve_removals _ z hz
    have hzo' : z ∈ p ++ s' := by
      rcases List.mem_append.1 hzo with h | h
      · exact List.mem_append_left _ h
      · have : z ∈ s'.filter Edit.isRemoval := by rw [hrems]; exact List.mem_filter.2 ⟨h, hzr⟩
        exact List.mem_append_right _ (List.mem_filter.1 this).1
    exact eq_of_id_eq hids' hzo' hy (by simpa using he) ▸ hz
  have hsame0 : ∀ y ∈ p ++ s, (resolve (p ++ s)).any (·.id == y.id) = true → y ∈ resolve (p ++ s) := by
    intro y hy h
    obtain ⟨z, hz, he⟩ := List.any_eq_true.1 h
    exact eq_of_id_eq hids (resolve_removals _ z hz).1 hy (by simpa using he) ▸ hz
  have hrmP : ∀ r ∈ p, (resolve (p ++ s)).any (·.id == r.id) = true → removes (p ++ s') r = removes (p ++ s) r :=
    fun r hr h => hrm r (List.mem_append_left _ hr) (resolve_removals _ r (hsame0 r (List.mem_append_left _ hr) h)).2
  have htail : ∀ x ∈ p, tailFacts (p ++ s') (resolve (p ++ s)) s' x = tailFacts (p ++ s) (resolve (p ++ s)) s x := by
    intro x _
    unfold tailFacts
    rw [filter_removals _ (fun y hy h => (resolve_removals _ y (hsame y (List.mem_append_right _ hy) h)).2),
      filter_removals _ (fun y hy h => (resolve_removals _ y (hsame0 y (List.mem_append_right _ hy) h)).2), hrems]
    refine flatMap_congr_mem fun y hy => ?_
    obtain ⟨hy, -⟩ := List.mem_filter.1 hy
    obtain ⟨hys, hyr⟩ := List.mem_filter.1 hy
    rw [hrm y (List.mem_append_right _ hys) hyr]
  have hcutsP : cutsAt (p ++ s') (resolve (p ++ s)) p 0 = cutsAt (p ++ s) (resolve (p ++ s)) p 0 :=
    cutsAt_congr (fun _ _ => rfl) hrmP 0
  -- the replay of every edit, with the removals held
  have hrun : runWith (p ++ s') (resolve (p ++ s)) = ((tailRun p s s').1, (kept p s).2 ++ (tailRun p s s').2) := by
    rw [runWith_split]
    unfold tailRun kept
    rw [runFrom_congr (resolve (p ++ s)) (resolve (p ++ s)) (cuts (p ++ s) (resolve (p ++ s)))
      (cuts (p ++ s') (resolve (p ++ s))) {} p.zipIdx ?h]
    case h =>
      rintro ⟨y, i⟩ hq
      have hi := (List.mem_zipIdx hq).2.1
      refine ⟨rfl, ?_⟩
      dsimp only
      rw [cuts_eq_cutsAt, cuts_eq_cutsAt, cutsAt_append, cutsAt_append, hiddenAt_append', hiddenAt_append',
        hiddenAt_cutsAt_before _ _ _ s' _ _ (by omega), hiddenAt_cutsAt_before _ _ _ s _ _ (by omega),
        htail y (List.fst_mem_of_mem_zipIdx hq), hcutsP]
  have hrun0 : runWith (p ++ s) (resolve (p ++ s)) = ((tailRun p s s).1, (kept p s).2 ++ (tailRun p s s).2) := by
    rw [runWith_split]; rfl
  -- every removal chosen stands again
  have hstand : ∀ x ∈ resolve (p ++ s), (runWith (p ++ s') (resolve (p ++ s))).2.any (·.id == x.id) = true := by
    intro x hx
    rw [hrun, List.any_append]
    obtain ⟨hxo, hxr⟩ := resolve_removals _ x hx
    rcases List.mem_append.1 hxo with hxp | hxs
    · have hold := Moves.resolve_stands (p ++ s) x hx
      rw [hrun0, List.any_append] at hold
      unfold tailRun at hold
      rw [any_tail_false (fun y hy => hdis x hxp y hy), Bool.or_false] at hold
      rw [hold, Bool.true_or]
    · rw [hstands x hxs hxr, Bool.or_true]
  -- and the replay is inert
  have hP : runFrom (resolve (p ++ s)) (stripTail (p ++ s') (resolve (p ++ s)) p s') {} p.zipIdx = kept p s := by
    rw [← hinertP]
    refine runFrom_congr _ _ _ _ {} p.zipIdx fun ⟨y, i⟩ hq => ⟨rfl, ?_⟩
    have hi := (List.mem_zipIdx hq).2.1
    dsimp only
    unfold stripTail
    rw [hiddenAt_append', hiddenAt_append', hiddenAt_strip, hiddenAt_strip,
      hiddenAt_cutsAt_before _ _ _ s' _ _ (by omega), hiddenAt_cutsAt_before _ _ _ s _ _ (by omega),
      htail y (List.fst_mem_of_mem_zipIdx hq), hcutsP]
  have hT : runFrom (resolve (p ++ s)) (stripTail (p ++ s') (resolve (p ++ s)) p s') (kept p s).1
      (s'.zipIdx p.length) = tailRun p s s' := by
    rw [← hinertT]
    refine runFrom_congr _ _ _ _ _ _ fun ⟨y, i⟩ hq => ⟨rfl, ?_⟩
    have hi := (List.mem_zipIdx hq).1
    dsimp only
    unfold stripTail
    rw [hiddenAt_append', hiddenAt_cutsAt_past _ _ _ p 0 i (by omega), List.nil_append]
  have hinert : runFrom (resolve (p ++ s)) (stripTail (p ++ s') (resolve (p ++ s)) p s') {} (p ++ s').zipIdx =
      runWith (p ++ s') (resolve (p ++ s)) := by
    rw [hrun, List.zipIdx_append, runFrom_append, Nat.zero_add, hP, hT]
  have hres := resolve_tail p s s' hids hids' hrems hmoves hchosen hcands hrm hstand hinert
  unfold view standing
  simp only [ho', ho, hres, hrun, hrun0, and_self]

end Tails

end AvenDB

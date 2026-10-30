import Aven.DB.Docs.Index

/-!
# A lookup walks down from the root

A reader holds the newest fold's root and fetches nodes by name (docs, "A lookup runs on the device"). From the root
it opens only the children whose span, first to last entry, meets the range, down to the leaves, and keeps the
entries in the range. Here the walk is over a **store**, the Values the reader can fetch by name, and the theorems say:

- `walk_sound`: the walk gives only entries in the range that lie under where it started;
- `walk_complete`: it gives every entry in the range under a node whose summaries are honest (`Good`): each child is
  in the store under the name its summary gives, and its span is its first and last entry;
- `fold_good`: every node a fold builds is honest once the store holds the fold's nodes by their names, and the top
  node holds exactly the fold's entries, so a walk from the root finds every entry of the fold in the range, and only
  those (`walk_exact`);
- `fold_exact`: a fold is a checkpoint. A reader takes one only from a writer of the directory, by its own runtime,
  rebuilding the root from what it covers; a lookup from a fold that checks is exact.
-/

namespace Aven.DB.Docs.Index

open Aven.Core

variable (store : Hash → Option Value)

/-- What lies under an item: an entry is itself; a summary is everything under the child it names. -/
def under : Nat → Value → List Bytes
  | _, .bytes e => [e]
  | d + 1, .array [.bytes _, .bytes _, .bytes n] =>
    match store ⟨n⟩ with
    | some (.array c) => c.flatMap (under d)
    | _ => []
  | _, _ => []

/-- The walk: keep an entry in the range; open a child only when its span meets the range. -/
def walk (lo hi : Bytes) : Nat → Value → List Bytes
  | _, .bytes e => if inRange lo hi e then [e] else []
  | d + 1, .array [.bytes f, .bytes l, .bytes n] =>
    if !lexLt l lo && !lexLt hi f then
      match store ⟨n⟩ with
      | some (.array c) => c.flatMap (walk lo hi d)
      | _ => []
    else []
  | _, _ => []

theorem walk_sound {lo hi x : Bytes} : ∀ {d : Nat} {v : Value}, x ∈ walk store lo hi d v →
    x ∈ under store d v ∧ inRange lo hi x = true
  | _, .bytes e, h => by
    simp only [walk] at h
    split at h
    · next hr => simp only [List.mem_singleton] at h; subst h; exact ⟨by simp [under], hr⟩
    · simp at h
  | d + 1, .array [.bytes f, .bytes l, .bytes n], h => by
    simp only [walk] at h
    split at h
    · simp only [under]
      split at h
      · next c hs =>
        obtain ⟨it, hit, hx⟩ := List.mem_flatMap.mp h
        have := walk_sound hx
        exact ⟨List.mem_flatMap.mpr ⟨it, hit, this.1⟩, this.2⟩
      · simp at h
    · simp at h
  | 0, .array _, h => by simp [walk] at h
  | d + 1, .array [], h => by simp [walk] at h
  | d + 1, .array [_], h => by simp [walk] at h
  | d + 1, .array [_, _], h => by simp [walk] at h
  | d + 1, .array (_ :: _ :: _ :: _ :: _), h => by simp [walk] at h
  | _, .uint _, h => by simp [walk] at h
  | _, .nint _, h => by simp [walk] at h
  | _, .text _, h => by simp [walk] at h
  | _, .map _, h => by simp [walk] at h
  | _, .bool _, h => by simp [walk] at h
  | _, .null, h => by simp [walk] at h

/-- A node's summaries are honest, down to the leaves: each child is in the store under the name its summary gives,
what lies under it is sorted, and its span is its first and last entry. -/
def Good : Nat → Value → Prop
  | _, .bytes _ => True
  | d + 1, .array [.bytes f, .bytes l, .bytes n] =>
    ∃ c, store ⟨n⟩ = some (.array c) ∧ (∀ it ∈ c, Good d it) ∧ (c.flatMap (under store d)).Pairwise Lt ∧
      (c.flatMap (under store d)).head? = some f ∧ (c.flatMap (under store d)).getLast? = some l
  | _, _ => False

/-- An entry between a span's first and last that lies in the range means the span meets the range. -/
theorem meets {lo hi f l x : Bytes} (hf : x = f ∨ Lt f x) (hl : x = l ∨ Lt x l) (hr : inRange lo hi x = true) :
    (!lexLt l lo && !lexLt hi f) = true := by
  simp only [inRange, Bool.and_eq_true, Bool.not_eq_true'] at hr
  simp only [Bool.and_eq_true, Bool.not_eq_true']
  constructor
  · rcases hl with rfl | hlt
    · exact hr.1
    · cases h : lexLt l lo
      · rfl
      · exact absurd (lexLt_trans hlt h) (by simp [hr.1])
  · rcases hf with rfl | hlt
    · exact hr.2
    · cases h : lexLt hi f
      · rfl
      · exact absurd (lexLt_trans h hlt) (by simp [hr.2])

/-- Under an honest node, the walk finds every entry in the range. -/
theorem walk_complete {lo hi x : Bytes} (hr : inRange lo hi x = true) : ∀ {d : Nat} {v : Value},
    Good store d v → x ∈ under store d v → x ∈ walk store lo hi d v
  | _, .bytes e, _, hx => by
    simp only [under, List.mem_singleton] at hx; subst hx; simp [walk, hr]
  | d + 1, .array [.bytes f, .bytes l, .bytes n], hg, hx => by
    obtain ⟨c, hs, hgood, hsort, hh, hl⟩ := hg
    simp only [under, hs] at hx
    obtain ⟨it, hit, hxi⟩ := List.mem_flatMap.mp hx
    have hm : (!lexLt l lo && !lexLt hi f) = true := by
      generalize hL : c.flatMap (under store d) = L at hsort hh hl hx
      match L, hsort, hh with
      | f' :: rest, hsort, hh =>
        simp only [List.head?_cons, Option.some.injEq] at hh
        subst hh
        exact meets (head_le hsort hx) (le_last hsort hl hx) hr
    simp only [walk, hm, ite_true, hs]
    exact List.mem_flatMap.mpr ⟨it, hit, walk_complete hr (hgood it hit) hxi⟩
  | 0, .array _, hg, _ => by simp [Good] at hg
  | d + 1, .array [], hg, _ => by simp [Good] at hg
  | d + 1, .array [_], hg, _ => by simp [Good] at hg
  | d + 1, .array [_, _], hg, _ => by simp [Good] at hg
  | d + 1, .array (_ :: _ :: _ :: _ :: _), hg, _ => by simp [Good] at hg
  | _, .uint _, hg, _ => by simp [Good] at hg
  | _, .nint _, hg, _ => by simp [Good] at hg
  | _, .text _, hg, _ => by simp [Good] at hg
  | _, .map _, hg, _ => by simp [Good] at hg
  | _, .bool _, hg, _ => by simp [Good] at hg
  | _, .null, hg, _ => by simp [Good] at hg

/-! ## A fold's nodes are honest -/

section Fold

variable (boundary : Bytes → Bool) (size : Bytes → Nat) (limit : Nat) (H : Bytes → Hash)

theorem chunksFrom_ne {α : Type} (b : α → Bool) (sz : α → Nat) (lim : Nat) :
    ∀ (cur : List α) (used : Nat) (l : List α), ∀ c ∈ chunksFrom b sz lim cur used l, c ≠ []
  | cur, used, [], c, hc => by
    unfold chunksFrom at hc
    split at hc
    · simp at hc
    · next h => simp only [List.mem_singleton] at hc; subst hc; simpa using h
  | cur, used, x :: xs, c, hc => by
    unfold chunksFrom at hc
    split at hc
    · next h =>
      rcases List.mem_cons.mp hc with rfl | hc
      · simpa using h.1
      · split at hc
        · rcases List.mem_cons.mp hc with rfl | hc
          · simp
          · exact chunksFrom_ne b sz lim [] 0 xs c hc
        · exact chunksFrom_ne b sz lim [x] _ xs c hc
    · split at hc
      · rcases List.mem_cons.mp hc with rfl | hc
        · simp
        · exact chunksFrom_ne b sz lim [] 0 xs c hc
      · exact chunksFrom_ne b sz lim (x :: cur) _ xs c hc

/-- Every node holds at least one item. -/
theorem cut_ne {level : List Value} : ∀ c ∈ cut boundary size limit level, c ≠ [] :=
  chunksFrom_ne _ _ _ [] 0 level

/-- What lies under an honest item is non-empty, and runs from its span's first to its last. -/
theorem good_span : ∀ {d : Nat} {v : Value}, Good store d v →
    (under store d v).head? = some (spanOf v).1 ∧ (under store d v).getLast? = some (spanOf v).2
  | _, .bytes e, _ => by simp [under, spanOf]
  | d + 1, .array [.bytes f, .bytes l, .bytes n], hg => by
    obtain ⟨c, hs, _, _, hh, hl⟩ := hg
    simp only [under, hs, spanOf]
    exact ⟨hh, hl⟩
  | 0, .array _, hg => by simp [Good] at hg
  | d + 1, .array [], hg => by simp [Good] at hg
  | d + 1, .array [_], hg => by simp [Good] at hg
  | d + 1, .array [_, _], hg => by simp [Good] at hg
  | d + 1, .array (_ :: _ :: _ :: _ :: _), hg => by simp [Good] at hg
  | _, .uint _, hg => by simp [Good] at hg
  | _, .nint _, hg => by simp [Good] at hg
  | _, .text _, hg => by simp [Good] at hg
  | _, .map _, hg => by simp [Good] at hg
  | _, .bool _, hg => by simp [Good] at hg
  | _, .null, hg => by simp [Good] at hg

theorem head_flatMap {f : Value → List Bytes} :
    ∀ {c : List Value}, c ≠ [] → (∀ v ∈ c, f v ≠ []) → (c.flatMap f).head? = (f (c.headD .null)).head?
  | [], h, _ => absurd rfl h
  | v :: _, _, hv => by
    obtain ⟨y, ys, hy⟩ := List.exists_cons_of_ne_nil (hv v (by simp))
    simp [List.flatMap_cons, hy]

theorem getLast_flatMap {f : Value → List Bytes} :
    ∀ {c : List Value}, c ≠ [] → (∀ v ∈ c, f v ≠ []) → (c.flatMap f).getLast? = (f (c.getLastD .null)).getLast?
  | [], h, _ => absurd rfl h
  | [v], _, _ => by simp
  | v :: w :: ws, _, hv => by
    have ih := getLast_flatMap (c := w :: ws) (by simp) (fun x hx => hv x (List.mem_cons_of_mem _ hx))
    have hw : ((w :: ws).flatMap f) ≠ [] := by
      obtain ⟨y, ys, hy⟩ := List.exists_cons_of_ne_nil (hv w (by simp))
      simp [List.flatMap_cons, hy]
    have hl : ((w :: ws).flatMap f).getLast?.isSome := by
      cases h : ((w :: ws).flatMap f).getLast? with
      | none => exact absurd (List.getLast?_eq_none_iff.mp h) hw
      | some _ => rfl
    rw [ih] at hl
    rw [List.flatMap_cons, List.getLast?_append, ih]
    cases h : (f ((w :: ws).getLastD .null)).getLast? with
    | none => rw [h] at hl; cases hl
    | some y => simpa [List.getLastD_eq_getLast?] using h.symm

theorem flatMap_flatten' {α β : Type} (f : α → List β) :
    ∀ (L : List (List α)), L.flatten.flatMap f = L.flatMap fun c => c.flatMap f
  | [] => rfl
  | c :: L => by simp [List.flatMap_append, flatMap_flatten' f L]

theorem flatMap_congr' {α β : Type} {f g : α → List β} :
    ∀ {L : List α}, (∀ x ∈ L, f x = g x) → L.flatMap f = L.flatMap g
  | [], _ => rfl
  | x :: L, h => by
    simp only [List.flatMap_cons, h x (by simp), flatMap_congr' (L := L) (fun y hy => h y (List.mem_cons_of_mem _ hy))]

theorem headD_mem' {α : Type} {c : List α} {x : α} (h : c ≠ []) : c.headD x ∈ c := by
  cases c with
  | nil => exact absurd rfl h
  | cons y ys => simp

theorem getLastD_mem' {α : Type} {c : List α} {x : α} (h : c ≠ []) : c.getLastD x ∈ c := by
  rw [List.getLastD_eq_getLast?]
  cases hc : c.getLast? with
  | none => exact absurd (List.getLast?_eq_none_iff.mp hc) h
  | some y => simpa using List.mem_of_getLast? hc

/-- A node a fold builds above honest items is honest, once the store holds it by its name; and what lies under the
level above is what lay under the level below. -/
theorem next_good {d : Nat} {level : List Value} (hg : ∀ it ∈ level, Good store d it)
    (hs : (level.flatMap (under store d)).Pairwise Lt)
    (stored : ∀ c ∈ cut boundary size limit level, store (nameOf H (.array c)) = some (.array c)) :
    (∀ c ∈ cut boundary size limit level, Good store (d + 1) (summary H c)) ∧
      ((cut boundary size limit level).map (summary H)).flatMap (under store (d + 1)) =
        level.flatMap (under store d) := by
  have hflat := chunks_flatten (boundary ∘ itemBytes) (size ∘ itemBytes) limit level
  have hunder : ∀ c ∈ cut boundary size limit level,
      under store (d + 1) (summary H c) = c.flatMap (under store d) := by
    intro c hc
    simp only [summary, under]
    rw [show (⟨(nameOf H (.array c)).bytes⟩ : Hash) = nameOf H (.array c) from rfl, stored c hc]
  have hsub : ∀ c ∈ cut boundary size limit level, ∀ it ∈ c, it ∈ level := by
    intro c hc it hit
    rw [← hflat]; exact List.mem_flatten.mpr ⟨c, hc, hit⟩
  have hne : ∀ c ∈ cut boundary size limit level, ∀ it ∈ c, under store d it ≠ [] := by
    intro c hc it hit h
    have := (good_span store (hg it (hsub c hc it hit))).1
    rw [h] at this; simp at this
  refine ⟨fun c hc => ?_, ?_⟩
  · refine ⟨c, stored c hc, fun it hit => hg it (hsub c hc it hit), ?_, ?_, ?_⟩
    · have : List.Sublist (c.flatMap (under store d))
          (((cut boundary size limit level).flatten).flatMap (under store d)) := by
        rw [flatMap_flatten']
        exact List.sublist_flatten_of_mem (List.mem_map.mpr ⟨c, hc, rfl⟩)
      rw [show cut boundary size limit level = chunks (boundary ∘ itemBytes) (size ∘ itemBytes) limit level from rfl,
        hflat] at this
      exact List.Pairwise.sublist this hs
    · rw [head_flatMap (cut_ne boundary size limit c hc) (hne c hc)]
      exact (good_span store (hg _ (hsub c hc _ (headD_mem' (cut_ne boundary size limit c hc))))).1
    · rw [getLast_flatMap (cut_ne boundary size limit c hc) (hne c hc)]
      exact (good_span store (hg _ (hsub c hc _ (getLastD_mem' (cut_ne boundary size limit c hc))))).2
  · rw [List.flatMap_map]
    rw [show (fun c => under store (d + 1) (summary H c)) = (fun c => under store (d + 1) (summary H c)) from rfl]
    calc ((cut boundary size limit level).flatMap fun c => under store (d + 1) (summary H c))
        = (cut boundary size limit level).flatMap fun c => c.flatMap (under store d) :=
          flatMap_congr' hunder
      _ = ((cut boundary size limit level).flatten).flatMap (under store d) := (flatMap_flatten' _ _).symm
      _ = level.flatMap (under store d) := by
          rw [show cut boundary size limit level = chunks (boundary ∘ itemBytes) (size ∘ itemBytes) limit level
            from rfl, hflat]

/-- Up every level: once the store holds the nodes a fold builds by their names, the top node's items are honest, they
cover exactly what the bottom level held, and the root names the top node. -/
theorem fold_good : ∀ (fuel d : Nat) (level : List Value), (∀ it ∈ level, Good store d it) →
    (level.flatMap (under store d)).Pairwise Lt →
    (∀ lv ∈ (levelsFrom boundary size limit H fuel level).dropLast, ∀ c ∈ lv,
      store (nameOf H (.array c)) = some (.array c)) →
    ∃ top d', (levelsFrom boundary size limit H fuel level).getLast? = some [top] ∧
      rootFrom boundary size limit H fuel level = nameOf H (.array top) ∧ (∀ it ∈ top, Good store d' it) ∧
      top.flatMap (under store d') = level.flatMap (under store d)
  | 0, d, level, hg, _, _ => ⟨level, d, rfl, rfl, hg, rfl⟩
  | fuel + 1, d, level, hg, hs, stored => by
    simp only [levelsFrom, rootFrom] at stored ⊢
    split
    · exact ⟨level, d, rfl, rfl, hg, rfl⟩
    · next hlen =>
      simp only [hlen, ↓reduceIte] at stored
      have hrest : levelsFrom boundary size limit H fuel ((cut boundary size limit level).map (summary H)) ≠ [] := by
        cases fuel <;> simp only [levelsFrom] <;> (try split) <;> simp
      have stored0 : ∀ c ∈ cut boundary size limit level, store (nameOf H (.array c)) = some (.array c) := by
        intro c hc
        apply stored (cut boundary size limit level) _ c hc
        rw [List.dropLast_cons_of_ne_nil hrest]; simp
      obtain ⟨hg', heq⟩ := next_good store boundary size limit H hg hs stored0
      have hg'' : ∀ it ∈ (cut boundary size limit level).map (summary H), Good store (d + 1) it := by
        intro it hit
        obtain ⟨c, hc, rfl⟩ := List.mem_map.mp hit
        exact hg' c hc
      obtain ⟨top, d', hl, hr, htop, hu⟩ := fold_good fuel (d + 1) _ hg'' (heq ▸ hs) (by
        intro lv hlv c hc
        apply stored lv _ c hc
        rw [List.dropLast_cons_of_ne_nil hrest]; exact List.mem_cons_of_mem _ hlv)
      refine ⟨top, d', ?_, hr, htop, hu.trans heq⟩
      rw [List.getLast?_cons, hl]; rfl

/-- **A lookup from the root is exact.** When the reader's store holds a fold's inner nodes by their names, the root
names a node in it, and the walk from that node finds every entry of the fold in the range, and only those. -/
theorem walk_exact (l : List Bytes) (lo hi : Bytes)
    (stored : ∀ lv ∈ (levels boundary size limit H l).dropLast, ∀ c ∈ lv,
      store (nameOf H (.array c)) = some (.array c)) :
    ∃ top d, root boundary size limit H l = nameOf H (.array top) ∧
      ∀ x, x ∈ top.flatMap (walk store lo hi d) ↔ x ∈ l ∧ inRange lo hi x = true := by
  have hg : ∀ it ∈ (entries l).map Value.bytes, Good store 0 it := by
    intro it hit; obtain ⟨e, _, rfl⟩ := List.mem_map.mp hit; trivial
  have hu : ((entries l).map Value.bytes).flatMap (under store 0) = entries l := by
    clear stored hg; induction entries l with
    | nil => rfl
    | cons e es ih => simp only [List.map_cons, List.flatMap_cons, ih]; rfl
  obtain ⟨top, d, _, hr, htop, hcover⟩ :=
    fold_good store boundary size limit H _ 0 _ hg (by rw [hu]; exact entries_sorted l) stored
  refine ⟨top, d, hr, fun x => ⟨fun hx => ?_, fun ⟨hx, hin⟩ => ?_⟩⟩
  · obtain ⟨it, hit, hw⟩ := List.mem_flatMap.mp hx
    have := walk_sound store hw
    refine ⟨entries_mem.mp ?_, this.2⟩
    rw [← hu, ← hcover]
    exact List.mem_flatMap.mpr ⟨it, hit, this.1⟩
  · have hxe : x ∈ top.flatMap (under store d) := by rw [hcover, hu]; exact entries_mem.mpr hx
    obtain ⟨it, hit, hxi⟩ := List.mem_flatMap.mp hxe
    exact List.mem_flatMap.mpr ⟨it, hit, walk_complete store hin (htop it hit) hxi⟩

/-! ## The fold is a checkpoint -/

/-- A fold, as a directory publishes it (docs, "A fold"; rule 12): the directory's version it covers, the root it
makes, the runtime that made it, and the vault of the device that signed it. -/
structure Fold where
  version : List Hash
  root : Hash
  runtime : Hash
  vault : Bytes

/-- A reader takes a fold only from a vault that may write the directory at its version, made by the runtime the
reader runs, and checks it in the background by rebuilding the root from the entries it covers. -/
def Fold.check (mayWrite : Bytes → List Hash → Bool) (runtime : Hash) (covered : List Bytes) (fd : Fold) : Bool :=
  mayWrite fd.vault fd.version && fd.runtime == runtime && fd.root == Index.root boundary size limit H covered

/-- A fold that checks came from a writer, by the reader's runtime, and its root is the root of exactly the entries it
covers; so, once the store holds its nodes, a lookup from it finds every covered entry in the range and only those. -/
theorem fold_exact {mayWrite : Bytes → List Hash → Bool} {runtime : Hash} {covered : List Bytes} {fd : Fold}
    (h : fd.check boundary size limit H mayWrite runtime covered = true) (lo hi : Bytes)
    (stored : ∀ lv ∈ (levels boundary size limit H covered).dropLast, ∀ c ∈ lv,
      store (nameOf H (.array c)) = some (.array c)) :
    mayWrite fd.vault fd.version = true ∧ fd.runtime = runtime ∧
      ∃ top d, fd.root = nameOf H (.array top) ∧
        ∀ x, x ∈ top.flatMap (walk store lo hi d) ↔ x ∈ covered ∧ inRange lo hi x = true := by
  simp only [Fold.check, Bool.and_eq_true, beq_iff_eq] at h
  obtain ⟨top, d, hr, hw⟩ := walk_exact store boundary size limit H covered lo hi stored
  exact ⟨h.1.1, h.1.2, top, d, h.2.trans hr, hw⟩

end Fold

end Aven.DB.Docs.Index

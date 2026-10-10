import AvenDB.CapLemmas
import AvenDB.Lemmas

/-!
# Rules

The proofs of C1 to C4 (`avendb/docs/OPS.md`, caps that name ops), stated as in `Theorems.lean`.

A chain allows a write where every ruled cap of it does, and a cap's chain is the chain of the cap it rests on and the
cap itself (T22), so a cap allows no more than the cap it rests on (C1). Whether a write counts reads, of the caps,
what every peer reads and the rules of the chain the write's proof names, and of the entry its id, vault and cell
alone (C2). A counted write that relies on ruled caps did only what the chain its proof names allows (C3), and a write
that fits, builds on counted writes, whose proof names a cap its actor holds that reaches the entry and whose chain
allows it, counts (C4). Readers count no write that builds on one they don't count, since each write is judged when it
comes, on what it builds on, and the writes they don't count only grow; nor one whose result doesn't fit (S3).
-/

namespace AvenDB.Ruling

/-! ## C1: chains narrow rules -/

theorem chain_narrows {st : State} {cp c : Cap} {main : Bool} {ts : List Touch}
    (h : chainAllows st cp main ts = true) (hc : c ∈ chain st cp) (hr : c.ruled = true) :
    allowsAll c.rules main ts = true := by
  unfold chainAllows at h
  simpa [hr] using List.all_eq_true.1 h c hc

theorem child_narrows {st : State} (hr : Reachable st) {c pc : Cap} (hc : c ∈ st.caps) (hp : c.parent = some pc.id)
    (hpc : pc ∈ st.caps) :
    (ruledChain st pc = true → ruledChain st c = true) ∧
      ∀ main ts, chainAllows st c main ts = true → chainAllows st pc main ts = true := by
  have hw := Caps.capsWell_reachable hr
  obtain ⟨pc', hpc', -⟩ := hw.2 c hc pc.id hp
  -- ids come once, so the parent found is `pc`
  have hid : pc'.id = pc.id := by simpa using List.find?_some hpc'
  obtain rfl := Caps.cap_eq_of_id hw.1 (List.mem_of_find?_eq_some hpc') hpc hid
  have hch := Caps.chain_parent hw hp hpc'
  refine ⟨fun h => ?_, fun main ts h => ?_⟩
  · unfold ruledChain at h ⊢
    rw [hch, List.any_append, h, Bool.true_or]
  · unfold chainAllows at h ⊢
    rw [hch, List.all_append, Bool.and_eq_true] at h
    exact h.1

/-! ## C2: every reader counts the same writes -/

theorem seen_id (vis : List CapId) (c : Cap) : (c.seen vis).id = c.id := rfl
theorem seen_over (vis : List CapId) (c : Cap) : (c.seen vis).over = c.over := rfl
theorem seen_parent (vis : List CapId) (c : Cap) : (c.seen vis).parent = c.parent := rfl
theorem seen_wide (vis : List CapId) (c : Cap) : (c.seen vis).wide = c.wide := rfl
theorem seen_ruled (vis : List CapId) (c : Cap) : (c.seen vis).ruled = c.ruled := rfl
theorem seen_rules (vis : List CapId) (c : Cap) :
    (c.seen vis).rules = if vis.contains c.id then c.rules else [] := rfl
theorem seen_caps (st : State) (vis : List CapId) : (st.seen vis).caps = st.caps.map (Cap.seen vis) := rfl

/-- Looking up a cap among the caps as a reader sees them finds it as a reader sees it. -/
theorem cap?_seen (st : State) (vis : List CapId) (x : CapId) :
    (st.seen vis).cap? x = (st.cap? x).map (Cap.seen vis) := by
  simp only [State.cap?, seen_caps, List.find?_map]; rfl

/-- Whether a cap is live reads only ids and revocations. -/
theorem live_seen (st : State) (vis : List CapId) : (st.seen vis).live = st.live := by
  funext c; simp only [State.live, seen_caps, List.any_map, Function.comp_def, seen_id]; rfl

/-- A cap's chain among the caps as a reader sees them is its chain as a reader sees it. -/
theorem chainN_seen (st : State) (vis : List CapId) :
    ∀ n (c : Cap), chainN (st.seen vis) n (c.seen vis) = (chainN st n c).map (Cap.seen vis)
  | 0, _ => rfl
  | n + 1, c => by
    rw [chainN, chainN, List.map_append]
    congr 1
    simp only [seen_parent]
    cases c.parent with
    | none => rfl
    | some p =>
      simp only [Option.bind_some, cap?_seen]
      cases st.cap? p with
      | none => rfl
      | some q => exact chainN_seen st vis n q

theorem chain_seen (st : State) (vis : List CapId) (c : Cap) :
    chain (st.seen vis) (c.seen vis) = (chain st c).map (Cap.seen vis) := by
  simp only [chain, chainN_seen, seen_caps, List.length_map]

/-- A cap's intake cell reads only its chain's ids and whether they are wide. -/
theorem intake_seen (st : State) (vis : List CapId) (c : Cap) : intake (st.seen vis) (c.seen vis) = intake st c := by
  simp only [intake, chain_seen, List.filter_map, List.map_map]; rfl

/-- Holding a cap reads whether it is live, its grantee and its role. -/
theorem holdsCap_seen (st : State) (vis : List CapId) (a : VaultId) (c : Cap) (r : Role) :
    holdsCap (st.seen vis) a (c.seen vis) r = holdsCap st a c r := by
  simp only [holdsCap, live_seen]; rfl

/-- Whether a cap reaches an entry reads its id, vault and width, and the entry's id, vault and cell. -/
theorem inCell_seen (st : State) (vis : List CapId) (c : Cap) (en : Entry) (attrs : Attrs) :
    inCell (st.seen vis) (c.seen vis) { en with attrs } = inCell st c en := rfl

/-- Whether a chain is ruled reads one bit of each cap, in the clear. -/
theorem ruledChain_seen (st : State) (vis : List CapId) (c : Cap) :
    ruledChain (st.seen vis) (c.seen vis) = ruledChain st c := by
  simp only [ruledChain, chain_seen, List.any_map, Function.comp_def, seen_ruled]

/-- The proof that names a cap opens the rules of every cap of its chain. -/
theorem mem_proofCaps {st : State} {cp c : Cap} (hcp : cp ∈ st.caps) (hc : c ∈ chain st cp) :
    (proofCaps st (some cp.id)).contains c.id = true := by
  simp only [proofCaps, List.contains_iff_mem, List.mem_flatMap, List.mem_filter, List.mem_map]
  exact ⟨cp, ⟨hcp, by simp⟩, c, hc, rfl⟩

/-- Two tests that agree on every member of a list agree on whether every member passes. -/
theorem all_congr_mem {α : Type} {l : List α} {p q : α → Bool} (h : ∀ x ∈ l, p x = q x) : l.all p = l.all q := by
  induction l with
  | nil => rfl
  | cons x l ih =>
    simp only [List.all_cons, h x List.mem_cons_self, ih fun y hy => h y (List.mem_cons_of_mem _ hy)]

/-- Whether a cap lets a write through reads the rules of the chain the write's proof names, and only those. -/
theorem lets_seen (st : State) {cp : Cap} (hcp : cp ∈ st.caps) (proof : Option CapId) (main : Bool)
    (ts : List Touch) :
    lets (st.seen (proofCaps st proof)) (cp.seen (proofCaps st proof)) proof main ts = lets st cp proof main ts := by
  unfold lets
  rw [ruledChain_seen, seen_id]
  by_cases hp : proof = some cp.id
  · subst hp
    simp only [beq_self_eq_true, Bool.true_and]
    congr 1
    unfold chainAllows
    rw [chain_seen, List.all_map]
    refine all_congr_mem fun c hc => ?_
    simp only [Function.comp_def, seen_ruled, seen_rules, mem_proofCaps hcp hc, ite_true]
  · have hf : (proof == some cp.id) = false := by simpa using hp
    simp only [hf, Bool.false_and]

/-- C2: whether readers count a write reads no selector, no relabel set, no type and no tag, and no rules but those
    of the chain its proof names. -/
theorem counts_seen (st : State) (a : VaultId) (en : Entry) (attrs : Attrs) (deps : List EditId)
    (proof : Option CapId) (main : Bool) (ts : List Touch) (fits : Bool) :
    counts (st.seen (proofCaps st proof)) a { en with attrs } deps proof main ts fits =
      counts st a en deps proof main ts fits := by
  unfold counts
  rw [seen_caps, List.any_map]
  congr 2
  refine Caps.any_congr_mem fun cp hcp => ?_
  simp only [Function.comp_def, holdsCap_seen, inCell_seen, lets_seen st hcp]

/-- C2, creations: whether readers count a creation reads no selector, no relabel set and no rules but those of the
    chain its proof names. -/
theorem creates_seen (st : State) (a v : VaultId) (x : Cell) (proof : Option CapId) (fits : Bool) :
    creates (st.seen (proofCaps st proof)) a v x proof fits = creates st a v x proof fits := by
  unfold creates
  rw [seen_caps, List.any_map]
  congr 2
  refine Caps.any_congr_mem fun cp hcp => ?_
  simp only [Function.comp_def, seen_over, holdsCap_seen, intake_seen, lets_seen st hcp]

/-! ## C3: ruled writes do what they may -/

theorem counted_allowed {st : State} {a : VaultId} {en : Entry} {deps : List EditId} {proof : Option CapId}
    {main : Bool} {ts : List Touch} {fits : Bool} (hc : counts st a en deps proof main ts fits = true)
    (hv : a ≠ en.vault)
    (hr : ∀ cp ∈ st.caps, holdsCap st a cp .write = true → inCell st cp en = true → ruledChain st cp = true) :
    ∃ cp ∈ st.caps, proof = some cp.id ∧ holdsCap st a cp .write = true ∧ inCell st cp en = true ∧
      ∀ c ∈ chain st cp, c.ruled = true → allowsAll c.rules main ts = true := by
  unfold counts at hc
  simp only [Bool.and_eq_true, Bool.or_eq_true, beq_iff_eq, List.any_eq_true] at hc
  obtain ⟨-, hc | ⟨cp, hcp, ⟨hh, hi⟩, hl⟩⟩ := hc
  · exact absurd hc hv
  · unfold lets at hl
    rw [hr cp hcp hh hi] at hl
    simp only [Bool.not_true, Bool.false_or, Bool.and_eq_true, beq_iff_eq] at hl
    exact ⟨cp, hcp, hl.1, hh, hi, fun c hc' hcr => chain_narrows hl.2 hc' hcr⟩

/-! ## C4: allowed writes count -/

theorem allowed_counts {st : State} {a : VaultId} {en : Entry} {deps : List EditId} {main : Bool} {ts : List Touch}
    {cp : Cap} (hd : ∀ d ∈ deps, d ∉ st.uncounted) (hcp : cp ∈ st.caps) (hh : holdsCap st a cp .write = true)
    (hi : inCell st cp en = true) (ha : chainAllows st cp main ts = true) :
    counts st a en deps (some cp.id) main ts true = true := by
  unfold counts
  simp only [Bool.true_and, Bool.and_eq_true, Bool.or_eq_true, List.all_eq_true, Bool.not_eq_true', beq_iff_eq,
    List.any_eq_true]
  refine ⟨fun d hd' => ?_, .inr ⟨cp, hcp, ⟨hh, hi⟩, ?_⟩⟩
  · simpa using hd d hd'
  · simp [lets, ha]

theorem allowed_creates {st : State} {a v : VaultId} {cp : Cap} (hcp : cp ∈ st.caps) (hv : cp.over = v)
    (hh : holdsCap st a cp .write = true) (ha : chainAllows st cp true [.create] = true) :
    creates st a v (intake st cp) (some cp.id) true = true := by
  unfold creates
  simp only [Bool.true_and, Bool.or_eq_true, beq_iff_eq, List.any_eq_true, Bool.and_eq_true]
  exact .inr ⟨cp, hcp, ⟨⟨⟨hv, hh⟩, rfl⟩, by simp [lets, ha]⟩⟩

/-! ## Nothing counts that builds on what doesn't -/

/-- Settling keys keeps which writes readers count. -/
theorem settle_uncounted (pre post : State) : (settle pre post).uncounted = post.uncounted := by
  obtain ⟨_, _, _, h⟩ := Caps.keysOnly_settle pre post
  rw [h]

/-- Fewer writes, and the same ones uncounted, keep what readers count closed. -/
theorem CountsClosed.mono {st st' : State} (hc : CountsClosed st) (hw : ∀ w ∈ st'.writes, w ∈ st.writes)
    (hu : st'.uncounted = st.uncounted) : CountsClosed st' := by
  intro w hw' d hd hdu
  rw [hu] at hdu ⊢
  exact hc w (hw w hw') d hd hdu

/-- What a removal keeps of fewer writes, the same ones uncounted, keeps what readers count closed. -/
theorem CountsClosed.drop {st pre mid : State} (hc : CountsClosed st) (hw : ∀ w ∈ mid.writes, w ∈ st.writes)
    (hu : mid.uncounted = st.uncounted) (keep : List EditId) : CountsClosed (dropUnseen pre mid keep) :=
  CountsClosed.mono hc (fun w hw' => hw w ((Caps.dropUnseen_writes pre mid keep).1.subset hw')) hu

/-- A new write with an id no write has, to which every write builds only on writes there are, keeps what readers
    count closed, where readers don't count it if it builds on one they don't count. -/
theorem CountsClosed.add {st : State} (hcc : CausallyClosed st) (hc : CountsClosed st) {w : Write} (b : Bool)
    (hfresh : ∀ x ∈ st.writes, x.edit ≠ w.edit) (hdeps : ∀ d ∈ w.deps, ∃ x ∈ st.writes, x.edit = d)
    (hb : (∃ d ∈ w.deps, d ∈ st.uncounted) → b = false) :
    ∀ x ∈ st.writes ++ [w], ∀ d ∈ x.deps, d ∈ st.counting b w.edit → x.edit ∈ st.counting b w.edit := by
  -- nothing builds on the new write
  have hnot : ∀ x ∈ st.writes ++ [w], ∀ d ∈ x.deps, d ≠ w.edit := by
    intro x hx d hd hdw
    rcases List.mem_append.1 hx with hx | hx
    · obtain ⟨y, hy, hyd, -⟩ := hcc x hx d hd
      exact hfresh y hy (hyd.trans hdw)
    · rw [List.mem_singleton] at hx
      subst hx
      obtain ⟨y, hy, hyd⟩ := hdeps d hd
      exact hfresh y hy (hyd.trans hdw)
  intro x hx d hd hdu
  have hdu' : d ∈ st.uncounted := by
    unfold State.counting at hdu
    split at hdu
    · exact hdu
    · rcases List.mem_append.1 hdu with h | h
      · exact h
      · exact absurd (List.mem_singleton.1 h) (hnot x hx d hd)
  unfold State.counting
  rcases List.mem_append.1 hx with hx | hx
  · have := hc x hx d hd hdu'
    split
    · exact this
    · exact List.mem_append_left _ this
  · rw [List.mem_singleton] at hx
    subst hx
    rw [hb ⟨d, hd, hdu'⟩]
    simp

/-- Each accepted edit keeps what readers count closed. -/
theorem apply_countsClosed {st post : State} {edit : Edit} (hcc : CausallyClosed st) (hc : CountsClosed st)
    (h : apply st edit = some post) : CountsClosed post := by
  unfold apply at h
  dsimp only at h
  split at h
  case h_10 v e actor stay gen deps proposal via create tags proof touches fits hact =>
    split at h
    · cases h
    rename_i hok
    -- the write's id is new
    have hfresh : ∀ x ∈ st.writes, x.edit ≠ edit.id := by
      intro x hx hxe
      simp only [Bool.or_eq_true, List.any_eq_true, beq_iff_eq] at hok
      exact hok (.inl ⟨x, hx, hxe⟩)
    split at h
    · -- a new entry: its first write builds on nothing
      repeat' split at h
      all_goals try cases h
      exact CountsClosed.add hcc hc _ hfresh (fun d hd => by cases hd) (fun ⟨d, hd, _⟩ => by cases hd)
    · repeat' split at h
      all_goals try cases h
      all_goals
        rename_i hdeps _ _
        refine CountsClosed.add hcc hc _ hfresh ?_ ?_
        · intro d hd
          simp only [Bool.not_eq_true', Bool.not_eq_false] at hdeps
          obtain ⟨x, hx, hxd, -⟩ := Caps.depsIn_iff.1 hdeps d hd
          exact ⟨x, hx, hxd⟩
        · rintro ⟨d, hd, hdu⟩
          simp only [counts, Bool.and_eq_false_iff, List.all_eq_false]
          exact .inl (.inr ⟨d, hd, by simpa using hdu⟩)
  all_goals (repeat' split at h) <;> (try cases h) <;>
    first
    | exact CountsClosed.mono hc (fun w hw => hw) rfl
    | (refine CountsClosed.drop hc ?_ ?_ _ <;> first | exact fun w hw => hw | rfl)

/-! ## Writes that don't fit -/

/-- An accepted write whose result doesn't fit its schemas is one its readers don't count. -/
theorem apply_unfit {st post : State} {edit : Edit} (h : apply st edit = some post)
    {v e actor stay gen deps proposal via create tags proof touches}
    (ha : edit.action = .write v e actor stay gen deps proposal via create tags proof touches false) :
    edit.id ∈ post.uncounted := by
  unfold apply at h
  rw [ha] at h
  dsimp only at h
  split at h
  · cases h
  split at h
  · repeat' split at h
    all_goals try cases h
    simp [State.counting, creates]
  · repeat' split at h
    all_goals try cases h
    all_goals simp [State.counting, counts]

/-- The same of a step, which also settles keys. -/
theorem step_unfit {st post : State} {edit : Edit} (h : step st edit = some post)
    {v e actor stay gen deps proposal via create tags proof touches}
    (ha : edit.action = .write v e actor stay gen deps proposal via create tags proof touches false) :
    edit.id ∈ post.uncounted := by
  unfold step at h
  obtain ⟨mid, hmid, rfl⟩ := Option.map_eq_some_iff.1 h
  rw [settle_uncounted]
  exact apply_unfit hmid ha

/-- Readers count no write that builds on one they don't count, in every reachable state. -/
theorem uncounted_closed {st : State} (hr : Reachable st) : CountsClosed st := by
  obtain ⟨edits, rfl⟩ := hr
  suffices h : CausallyClosed (replay {} edits) ∧ CountsClosed (replay {} edits) from h.2
  refine Caps.replay_inv (fun st => CausallyClosed st ∧ CountsClosed st) (fun st st' edit hi h => ?_) edits {}
    ⟨fun w hw => (by cases hw), fun w hw => (by cases hw)⟩
  refine ⟨Core.T14_causally_closed hi.1 h, ?_⟩
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  exact CountsClosed.mono (apply_countsClosed hi.1 hi.2 hpost) (fun w hw => by rwa [Caps.settle_writes] at hw)
    (settle_uncounted _ _)

end AvenDB.Ruling

import AvenDB.CapLemmas
import AvenDB.Lemmas

/-!
# Shares that name ops

The proofs of C1 to C4 (`avendb/docs/ARCHITECTURE.md` §8), stated as in `Theorems.lean`.

A chain allows a write where every share of it is the class of its ops and its ops allow it, and a share's chain is the
chain of the share it rests on and the share itself (T22), so a share allows no more than the share it rests on (C1).
Whether a write counts reads, of the shares, what every peer reads and the ops of the chain the write's proof names, and
of the entry its id, vault and audience alone (C2). A counted write by anyone but the entry's vault relies on the share
its proof names and did only what that share's chain allows (C3), and a write that fits, builds on counted writes, whose
proof names a share its actor holds that reaches the entry and whose chain allows it, counts (C4). Readers count no
write that builds on one they don't count, since each write is judged when it comes, on what it builds on, and the
writes they don't count only grow; nor one whose result doesn't fit (S3).
-/

namespace AvenDB.Ruling

/-! ## C1: chains narrow -/

theorem chain_narrows {st : State} {cp c : Share} {a : Attrs} {main : Bool} {ts : List Touch}
    (h : chainAllows st cp a main ts = true) (hc : c ∈ chain st cp) :
    c.levelOk = true ∧ allowsAll (opsOn st c a) main ts = true := by
  unfold chainAllows at h
  have := List.all_eq_true.1 h c hc
  simp only [Bool.and_eq_true] at this
  exact this

/-- A share with its own ops is the class of its ops, and grants them on every entry. -/
theorem plain_ops {st : State} {c : Share} (hg : c.group = none) (a : Attrs) :
    (c.levelOk = true ↔ c.level = levelOf c.ops) ∧ opsOn st c a = c.ops := by
  simp [Share.levelOk, opsOn, hg]

/-- A share that names a cap group grants no op above its level, whatever later versions of the group add. -/
theorem group_bounded {st : State} {c : Share} {a : Attrs} {o : Op} (ho : o ∈ opsOn st c a) (hg : c.group.isSome) :
    o.level.rank ≤ c.level.rank := by
  unfold opsOn at ho
  cases hc : c.group with
  | none => rw [hc] at hg; cases hg
  | some g =>
    rw [hc] at ho
    obtain ⟨cap, hcap, rfl⟩ := List.mem_map.1 ho
    have := (List.mem_filter.1 hcap).2
    simp only [Cap.holds, Bool.and_eq_true, decide_eq_true_eq] at this
    exact this.1

/-- A share's chain holds the share and shares there are. -/
theorem mem_chainN {st : State} : ∀ (n : Nat) {cp c : Share}, c ∈ chainN st n cp → c = cp ∨ c ∈ st.shares
  | 0, _, _, h => .inl (List.mem_singleton.1 h)
  | n + 1, cp, c, h => by
    rw [chainN, List.mem_append, List.mem_singleton] at h
    rcases h with h | h
    · split at h
      · rename_i p hp
        obtain ⟨q, -, hq⟩ := Option.bind_eq_some_iff.1 hp
        rcases mem_chainN n h with rfl | h
        · exact .inr (List.mem_of_find?_eq_some hq)
        · exact .inr h
      · cases h
    · exact .inl h

theorem mem_chain {st : State} {cp c : Share} (hcp : cp ∈ st.shares) (hc : c ∈ chain st cp) : c ∈ st.shares := by
  rcases mem_chainN _ hc with rfl | h
  · exact hcp
  · exact h

theorem child_narrows {st : State} (hr : Reachable st) {c pc : Share} (hc : c ∈ st.shares) (hp : c.parent = some pc.id)
    (hpc : pc ∈ st.shares) : ∀ a main ts, chainAllows st c a main ts = true → chainAllows st pc a main ts = true := by
  have hw := Shares.sharesWell_reachable hr
  obtain ⟨pc', hpc', -⟩ := hw.2 c hc pc.id hp
  -- ids come once, so the parent found is `pc`
  have hid : pc'.id = pc.id := by simpa using List.find?_some hpc'
  obtain rfl := Shares.eq_of_id hw.1 (List.mem_of_find?_eq_some hpc') hpc hid
  have hch := Shares.chain_parent hw hp hpc'
  intro a main ts h
  unfold chainAllows at h ⊢
  rw [hch, List.all_append, Bool.and_eq_true] at h
  exact h.1

/-! ## C2: every reader counts the same writes -/

theorem seen_id (vis : List ShareId) (c : Share) : (c.seen vis).id = c.id := rfl
theorem seen_over (vis : List ShareId) (c : Share) : (c.seen vis).over = c.over := rfl
theorem seen_parent (vis : List ShareId) (c : Share) : (c.seen vis).parent = c.parent := rfl
theorem seen_wide (vis : List ShareId) (c : Share) : (c.seen vis).wide = c.wide := rfl
theorem seen_level (vis : List ShareId) (c : Share) : (c.seen vis).level = c.level := rfl
theorem seen_group (vis : List ShareId) (c : Share) : (c.seen vis).group = c.group := rfl
theorem seen_ops (vis : List ShareId) (c : Share) :
    (c.seen vis).ops = if vis.contains c.id then c.ops else [] := rfl
theorem seen_shares (st : State) (vis : List ShareId) : (st.seen vis).shares = st.shares.map (Share.seen vis) := rfl

/-- Looking up a share among the shares as a reader sees them finds it as a reader sees it. -/
theorem share?_seen (st : State) (vis : List ShareId) (x : ShareId) :
    (st.seen vis).share? x = (st.share? x).map (Share.seen vis) := by
  simp only [State.share?, seen_shares, List.find?_map]; rfl

/-- Whether a share is live reads only ids and revocations. -/
theorem live_seen (st : State) (vis : List ShareId) : (st.seen vis).live = st.live := by
  funext c; simp only [State.live, seen_shares, List.any_map, Function.comp_def, seen_id]; rfl

/-- A share's chain among the shares as a reader sees them is its chain as a reader sees it. -/
theorem chainN_seen (st : State) (vis : List ShareId) :
    ∀ n (c : Share), chainN (st.seen vis) n (c.seen vis) = (chainN st n c).map (Share.seen vis)
  | 0, _ => rfl
  | n + 1, c => by
    rw [chainN, chainN, List.map_append]
    congr 1
    simp only [seen_parent]
    cases c.parent with
    | none => rfl
    | some p =>
      simp only [Option.bind_some, share?_seen]
      cases st.share? p with
      | none => rfl
      | some q => exact chainN_seen st vis n q

theorem chain_seen (st : State) (vis : List ShareId) (c : Share) :
    chain (st.seen vis) (c.seen vis) = (chain st c).map (Share.seen vis) := by
  simp only [chain, chainN_seen, seen_shares, List.length_map]

/-- A share's intake audience reads only its chain's ids and whether they are wide. -/
theorem intake_seen (st : State) (vis : List ShareId) (c : Share) :
    intake (st.seen vis) (c.seen vis) = intake st c := by
  simp only [intake, chain_seen, List.filter_map, List.map_map]; rfl

/-- Holding a share reads whether it is live, its grantee and its level. -/
theorem holdsShare_seen (st : State) (vis : List ShareId) (a : VaultId) (c : Share) (r : Level) :
    holdsShare (st.seen vis) a (c.seen vis) r = holdsShare st a c r := by
  simp only [holdsShare, live_seen]; rfl

/-- Whether a share reaches an entry reads its id, vault and width, and the entry's id, vault and audience. -/
theorem inAudience_seen (st : State) (vis : List ShareId) (c : Share) (en : Entry) (attrs : Attrs) :
    inAudience (st.seen vis) (c.seen vis) { en with attrs } = inAudience st c en := rfl

/-- What cap groups grant reads the entries, the writes readers count and what they define, which every reader holds
    alike: no share's selector nor ops. -/
theorem capsOf_seen (st : State) (vis : List ShareId) : capsOf (st.seen vis) = capsOf st := by
  have hga : groupAt (st.seen vis) = groupAt st := rfl
  have hinc : ∀ v n gs, includesN (st.seen vis) v n gs = includesN st v n gs := by
    intro v n
    induction n with
    | zero => intro gs; rfl
    | succ n ih =>
      intro gs
      simp only [includesN]
      rw [show includeStep (st.seen vis) v gs = includeStep st v gs from rfl]
      exact ih _
  funext v g
  simp only [capsOf, groupsOf, hinc, hga]
  rfl

/-- The ops a share grants, as a reader who sees its ops sees it, are the ops it grants. -/
theorem opsOn_seen (st : State) {vis : List ShareId} {c : Share} (hv : vis.contains c.id = true) (a : Attrs) :
    opsOn (st.seen vis) (c.seen vis) a = opsOn st c a := by
  unfold opsOn
  rw [seen_group, capsOf_seen, seen_over, seen_level, seen_ops, if_pos hv]

/-- A share's ops, as a reader who sees them sees them, keep what its level says of it. -/
theorem levelOk_seen {vis : List ShareId} {c : Share} (hv : vis.contains c.id = true) :
    (c.seen vis).levelOk = c.levelOk := by
  simp only [Share.levelOk, seen_group, seen_level, seen_ops, hv, ite_true]

/-- The proof that names a share opens the ops of every share of its chain. -/
theorem mem_proofShares {st : State} {cp c : Share} (hcp : cp ∈ st.shares) (hc : c ∈ chain st cp) :
    (proofShares st (some cp.id)).contains c.id = true := by
  simp only [proofShares, List.contains_iff_mem, List.mem_flatMap, List.mem_filter, List.mem_map]
  exact ⟨cp, ⟨hcp, by simp⟩, c, hc, rfl⟩

/-- Two tests that agree on every member of a list agree on whether every member passes. -/
theorem all_congr_mem {α : Type} {l : List α} {p q : α → Bool} (h : ∀ x ∈ l, p x = q x) : l.all p = l.all q := by
  induction l with
  | nil => rfl
  | cons x l ih =>
    simp only [List.all_cons, h x List.mem_cons_self, ih fun y hy => h y (List.mem_cons_of_mem _ hy)]

/-- Whether a share lets a write through reads the ops of the chain the write's proof names, and only those. -/
theorem lets_seen (st : State) {cp : Share} (hcp : cp ∈ st.shares) (proof : Option ShareId) (a : Attrs) (main : Bool)
    (ts : List Touch) :
    lets (st.seen (proofShares st proof)) (cp.seen (proofShares st proof)) proof a main ts =
      lets st cp proof a main ts := by
  unfold lets
  rw [seen_id]
  by_cases hp : proof = some cp.id
  · subst hp
    simp only [beq_self_eq_true, Bool.true_and]
    unfold chainAllows
    rw [chain_seen, List.all_map]
    refine all_congr_mem fun c hc => ?_
    simp only [Function.comp_def, levelOk_seen (mem_proofShares hcp hc), opsOn_seen st (mem_proofShares hcp hc)]
  · have hf : (proof == some cp.id) = false := by simpa using hp
    simp only [hf, Bool.false_and]

/-- C2: whether readers count a write reads no selector, and no ops but those of the chain its proof names; of cap
    groups, what every reader of the vault reads alike. -/
theorem counts_seen (st : State) (a : VaultId) (en : Entry) (deps : List EditId) (proof : Option ShareId) (main : Bool)
    (ts : List Touch) (fits : Bool) :
    counts (st.seen (proofShares st proof)) a en deps proof main ts fits = counts st a en deps proof main ts fits := by
  unfold counts
  rw [seen_shares, List.any_map]
  -- what the vault accepted reads the writes and the accepts, which every reader holds alike
  have ha : accepted (st.seen (proofShares st proof)) en deps = accepted st en deps := rfl
  rw [ha]
  congr 3
  refine Shares.any_congr_mem fun cp hcp => ?_
  simp only [Function.comp_def, holdsShare_seen, lets_seen st hcp]
  rfl

/-- Whether a share with its own ops lets a write through reads no type and no tag of the entry. -/
theorem lets_plain (st : State) {cp : Share} (hcp : cp ∈ st.shares) (hg : ∀ c ∈ st.shares, c.group = none)
    (proof : Option ShareId) (a b : Attrs) (main : Bool) (ts : List Touch) :
    lets st cp proof a main ts = lets st cp proof b main ts := by
  unfold lets chainAllows
  congr 1
  refine all_congr_mem fun c hc => ?_
  rw [(plain_ops (hg c (mem_chain hcp hc)) a).2, (plain_ops (hg c (mem_chain hcp hc)) b).2]

/-- C2, shares with their own ops: where no share names a cap group, whether readers count a write reads no type and
    no tag either. -/
theorem counts_seen_plain (st : State) (hg : ∀ c ∈ st.shares, c.group = none) (a : VaultId) (en : Entry)
    (attrs : Attrs) (deps : List EditId) (proof : Option ShareId) (main : Bool) (ts : List Touch) (fits : Bool) :
    counts (st.seen (proofShares st proof)) a { en with attrs } deps proof main ts fits =
      counts st a en deps proof main ts fits := by
  rw [← counts_seen st a en]
  unfold counts
  rw [seen_shares, List.any_map, List.any_map]
  have ha : accepted (st.seen (proofShares st proof)) { en with attrs } deps =
    accepted (st.seen (proofShares st proof)) en deps := rfl
  rw [ha]
  congr 3
  refine Shares.any_congr_mem fun cp hcp => ?_
  simp only [Function.comp_def, holdsShare_seen, inAudience_seen, lets_seen st hcp]
  rw [lets_plain st hcp hg proof attrs en.attrs]
  rfl

/-- C2, creations: whether readers count a creation reads no selector and no ops but those of the chain its proof
    names. -/
theorem creates_seen (st : State) (a v : VaultId) (x : Audience) (attrs : Attrs) (proof : Option ShareId)
    (main fits : Bool) :
    creates (st.seen (proofShares st proof)) a v x attrs proof main fits = creates st a v x attrs proof main fits := by
  unfold creates
  rw [seen_shares, List.any_map]
  congr 2
  refine Shares.any_congr_mem fun cp hcp => ?_
  simp only [Function.comp_def, seen_over, holdsShare_seen, intake_seen, lets_seen st hcp]

/-! ## C3: counted writes do what they may -/

theorem counted_allowed {st : State} {a : VaultId} {en : Entry} {deps : List EditId} {proof : Option ShareId}
    {main : Bool} {ts : List Touch} {fits : Bool} (hc : counts st a en deps proof main ts fits = true)
    (hv : a ≠ en.vault) :
    ∃ cp ∈ st.shares, proof = some cp.id ∧ holdsShare st a cp .write = true ∧ inAudience st cp en = true ∧
      ∀ c ∈ chain st cp, c.levelOk = true ∧ allowsAll (opsOn st c en.attrs) main ts = true := by
  unfold counts at hc
  simp only [Bool.and_eq_true, Bool.or_eq_true, beq_iff_eq] at hc
  obtain ⟨-, hc | ⟨hany, -⟩⟩ := hc
  · exact absurd hc hv
  · obtain ⟨cp, hcp, hcl⟩ := List.any_eq_true.1 hany
    simp only [Bool.and_eq_true] at hcl
    obtain ⟨⟨hh, hi⟩, hl⟩ := hcl
    unfold lets at hl
    simp only [Bool.and_eq_true, beq_iff_eq] at hl
    exact ⟨cp, hcp, hl.1, hh, hi, fun c hc' => chain_narrows hl.2 hc'⟩

/-- A counted write's touches are each allowed by an op that writes, of every share of the chain it relies on: no read,
    relay, backup or share op lets anything through. -/
theorem counted_writes {st : State} {a : VaultId} {en : Entry} {deps : List EditId} {proof : Option ShareId}
    {main : Bool} {ts : List Touch} {fits : Bool} (hc : counts st a en deps proof main ts fits = true)
    (hv : a ≠ en.vault) :
    ∃ cp ∈ st.shares, proof = some cp.id ∧ ∀ c ∈ chain st cp, ∀ t ∈ ts, ∃ o ∈ opsOn st c en.attrs,
      o.allows main t = true ∧ o.level = .write := by
  obtain ⟨cp, hcp, hp, -, -, hall⟩ := counted_allowed hc hv
  refine ⟨cp, hcp, hp, fun c hc' t ht => ?_⟩
  have := (hall c hc').2
  simp only [allowsAll, List.all_eq_true, List.any_eq_true] at this
  obtain ⟨o, ho, hoa⟩ := this t ht
  exact ⟨o, ho, hoa, level_of_allows hoa⟩

/-! ## M1: a counted merge brings in only what its merge ops' paths reach -/

/-- M1: each place a counted write by anyone but the entry's vault brings a change to by a merge is reached by the path
    of a merge op on the write's line, in every share of the chain it relies on. -/
theorem counted_merges_within {st : State} {a : VaultId} {en : Entry} {deps : List EditId} {proof : Option ShareId}
    {main : Bool} {ts : List Touch} {fits : Bool} (hc : counts st a en deps proof main ts fits = true)
    (hv : a ≠ en.vault) {l : Ops.Loc} (hl : Touch.merged l ∈ ts) :
    ∃ cp ∈ st.shares, proof = some cp.id ∧ ∀ c ∈ chain st cp, ∃ o p, Op.merge o p ∈ opsOn st c en.attrs ∧
      onLine main o = true ∧ reaches p l.steps = true := by
  obtain ⟨cp, hcp, hp, -, -, hall⟩ := counted_allowed hc hv
  refine ⟨cp, hcp, hp, fun c hc' => ?_⟩
  have := (hall c hc').2
  simp only [allowsAll, List.all_eq_true, List.any_eq_true] at this
  obtain ⟨r, hr, hra⟩ := this _ hl
  obtain ⟨o, p, rfl, ho, hp'⟩ := merged_within hra
  exact ⟨o, p, hr, ho, hp'⟩

/-! ## C4: allowed writes count -/

theorem allowed_counts {st : State} {a : VaultId} {en : Entry} {deps : List EditId} {main : Bool} {ts : List Touch}
    {cp : Share} (hd : ∀ d ∈ deps, d ∉ st.uncounted) (hcp : cp ∈ st.shares) (hh : holdsShare st a cp .write = true)
    (hi : inAudience st cp en = true) (ha : chainAllows st cp en.attrs main ts = true)
    (hacc : main = true → Touch.merge ∈ ts → accepted st en deps = true)
    (hland : main = true → landed st en = true) :
    counts st a en deps (some cp.id) main ts true = true := by
  unfold counts
  simp only [Bool.true_and, Bool.and_eq_true, Bool.or_eq_true, List.all_eq_true, Bool.not_eq_true', beq_iff_eq]
  refine ⟨⟨fun d hd' => ?_, ?_⟩, .inr ⟨List.any_eq_true.2 ⟨cp, hcp, ?_⟩, ?_⟩⟩
  · simpa using hd d hd'
  · -- a write on main of a draft that has landed
    cases main
    · exact .inl rfl
    · exact .inl (by simp [hland rfl])
  · simp [lets, ha, hh, hi]
  · cases main
    · exact .inl rfl
    · by_cases hm : Touch.merge ∈ ts
      · exact .inr (hacc rfl hm)
      · exact .inl (by simpa using hm)

/-! ## M2: a merge into main by anyone but the vault counts once the vault accepted what it brings in -/

/-- M2, the default policy (1 of the vault's owners): a counted merge into the main line by anyone but the entry's
    vault builds on an accept of the vault, and on nothing but accepts and writes on the main line. -/
theorem counted_merges_accepted {st : State} {a : VaultId} {en : Entry} {deps : List EditId}
    {proof : Option ShareId} {ts : List Touch} {fits : Bool} (hc : counts st a en deps proof true ts fits = true)
    (hv : a ≠ en.vault) (hm : Touch.merge ∈ ts) : accepted st en deps = true := by
  unfold counts at hc
  simp only [Bool.and_eq_true, Bool.or_eq_true, beq_iff_eq] at hc
  obtain ⟨-, hc | ⟨-, hacc⟩⟩ := hc
  · exact absurd hc hv
  · simpa [hm] using hacc

/-- M2, the vault's own writes: its merges count as every write of it does, by what it builds on and whether it fits,
    and need no accept but their own. -/
theorem owner_counts (st : State) (en : Entry) (deps : List EditId) (proof : Option ShareId) (main : Bool)
    (ts : List Touch) (fits : Bool) :
    counts st en.vault en deps proof main ts fits = (fits && deps.all fun d => !st.uncounted.contains d) := by
  simp [counts]

theorem allowed_creates {st : State} {a v : VaultId} {cp : Share} {attrs : Attrs} {main : Bool}
    (hcp : cp ∈ st.shares) (hv : cp.over = v) (hh : holdsShare st a cp .write = true)
    (ha : chainAllows st cp attrs main [.create] = true) :
    creates st a v (intake st cp) attrs (some cp.id) main true = true := by
  unfold creates
  simp only [Bool.true_and, Bool.or_eq_true, beq_iff_eq, List.any_eq_true, Bool.and_eq_true]
  exact .inr ⟨cp, hcp, ⟨⟨⟨hv, hh⟩, rfl⟩, by simp [lets, ha]⟩⟩

/-! ## Nothing counts that builds on what doesn't -/

/-- Settling keys keeps which writes readers count. -/
theorem settle_uncounted (pre post : State) : (settle pre post).uncounted = post.uncounted := by
  obtain ⟨_, _, _, h⟩ := Shares.keysOnly_settle pre post
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
  CountsClosed.mono hc (fun w hw' => hw w ((Shares.dropUnseen_writes pre mid keep).1.subset hw')) hu

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
  case h_10 v e actor stay epoch deps proposal via create tags proof touches fits defines hact =>
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
          obtain ⟨x, hx, hxd, -⟩ := Shares.depsIn_iff.1 hdeps d hd
          exact ⟨x, hx, hxd⟩
        · rintro ⟨d, hd, hdu⟩
          simp only [counts, Bool.and_eq_false_iff, List.all_eq_false]
          exact .inl (.inl (.inr ⟨d, hd, by simpa using hdu⟩))
  case h_13 =>
    obtain ⟨-, -, -, -, -, -, -, -, -, rfl⟩ := applyClaim_some h
    exact CountsClosed.mono hc (fun w hw => hw) rfl
  all_goals (repeat' split at h) <;> (try cases h) <;>
    first
    | exact CountsClosed.mono hc (fun w hw => hw) rfl
    | (refine CountsClosed.drop hc ?_ ?_ _ <;> first | exact fun w hw => hw | rfl)

/-! ## Writes that don't fit -/

/-- An accepted write whose result doesn't fit its schemas is one its readers don't count. -/
theorem apply_unfit {st post : State} {edit : Edit} (h : apply st edit = some post)
    {v e actor stay epoch deps proposal via create tags proof touches defines}
    (ha : edit.action = .write v e actor stay epoch deps proposal via create tags proof touches false defines) :
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
    {v e actor stay epoch deps proposal via create tags proof touches defines}
    (ha : edit.action = .write v e actor stay epoch deps proposal via create tags proof touches false defines) :
    edit.id ∈ post.uncounted := by
  unfold step at h
  obtain ⟨mid, hmid, rfl⟩ := Option.map_eq_some_iff.1 h
  rw [settle_uncounted]
  exact apply_unfit hmid ha

/-- Readers count no write that builds on one they don't count, in every reachable state. -/
theorem uncounted_closed {st : State} (hr : Reachable st) : CountsClosed st := by
  obtain ⟨edits, rfl⟩ := hr
  suffices h : CausallyClosed (replay {} edits) ∧ CountsClosed (replay {} edits) from h.2
  refine Shares.replay_inv (fun st => CausallyClosed st ∧ CountsClosed st) (fun st st' edit hi h => ?_) edits {}
    ⟨fun w hw => (by cases hw), fun w hw => (by cases hw)⟩
  refine ⟨Core.T14_causally_closed hi.1 h, ?_⟩
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  exact CountsClosed.mono (apply_countsClosed hi.1 hi.2 hpost) (fun w hw => by rwa [Shares.settle_writes] at hw)
    (settle_uncounted _ _)

/-! ## Drafts

A draft is a creation that starts a line of its own (`Proposal.new`): its main line holds nothing until a counted write
on main builds on its creation (`landed`). Only the entry's vault writes on main before then, so only the vault lands a
draft (D1); a draft by anyone but the vault counts exactly where every share of its chain lets a creation on a proposal
through (D2), and until it lands the stewards keep it out of every share to everyone (D3). -/

/-- D1: a counted write on the main line of a draft that hasn't landed is the vault's own. -/
theorem drafts_land_by_their_vault {st : State} {a : VaultId} {en : Entry} {deps : List EditId}
    {proof : Option ShareId} {ts : List Touch} {fits : Bool} (hc : counts st a en deps proof true ts fits = true)
    (hl : landed st en = false) : a = en.vault := by
  unfold counts at hc
  simp only [hl, Bool.and_eq_true, Bool.or_eq_true, beq_iff_eq] at hc
  obtain ⟨⟨-, h⟩, -⟩ := hc
  simpa using h

/-- An op allows a creation on a proposal exactly when it is `create` on no line or on proposals. -/
theorem allows_draft {r : Op} : r.allows false .create = true ↔ r = .create none ∨ r = .create (some .proposals) := by
  cases r with
  | create o =>
    cases o with
    | none => simp [Op.allows, onLine]
    | some o => cases o <;> simp [Op.allows, onLine]
  | _ => simp [Op.allows]

/-- Ops allow a draft exactly when they name `create` on no line or on proposals. -/
theorem allowsAll_draft {rs : List Op} :
    allowsAll rs false [.create] = true ↔ Op.create none ∈ rs ∨ Op.create (some .proposals) ∈ rs := by
  simp only [allowsAll, List.all_cons, List.all_nil, Bool.and_true, List.any_eq_true, allows_draft]
  constructor
  · rintro ⟨r, hr, rfl | rfl⟩
    · exact .inl hr
    · exact .inr hr
  · rintro (h | h)
    · exact ⟨_, h, .inl rfl⟩
    · exact ⟨_, h, .inr rfl⟩

/-- D2 (C3 and C4 for drafts): the readers of an entry count its creation as a draft by anyone but its vault exactly
    when it fits and its proof names a share over the vault that its creator holds with write or more, in whose intake
    audience it was created, every share of whose chain is the class of its ops and names `create` on no line or on
    proposals. -/
theorem draft_creations {st : State} {a v : VaultId} {x : Audience} {attrs : Attrs} {proof : Option ShareId}
    {fits : Bool} (hv : a ≠ v) :
    creates st a v x attrs proof false fits = true ↔ fits = true ∧ ∃ cp ∈ st.shares, proof = some cp.id ∧
      cp.over = v ∧ holdsShare st a cp .write = true ∧ intake st cp = x ∧ ∀ c ∈ chain st cp, c.levelOk = true ∧
        (Op.create none ∈ opsOn st c attrs ∨ Op.create (some .proposals) ∈ opsOn st c attrs) := by
  unfold creates lets chainAllows
  simp only [Bool.and_eq_true, Bool.or_eq_true, beq_iff_eq, hv, false_or, List.any_eq_true, List.all_eq_true,
    allowsAll_draft]
  constructor
  · rintro ⟨hf, cp, hcp, ⟨⟨⟨ho, hh⟩, hx⟩, hp, hall⟩⟩
    exact ⟨hf, cp, hcp, hp, ho, hh, hx, hall⟩
  · rintro ⟨hf, cp, hcp, hp, ho, hh, hx, hall⟩
    exact ⟨hf, cp, hcp, ⟨⟨⟨ho, hh⟩, hx⟩, hp, hall⟩⟩

/-- An accepted creation, on the main line or a draft's own, records its first write on that line, building on
    nothing, and its readers count it exactly as `creates` says of a creation on that line. -/
theorem apply_creation {st post : State} {edit : Edit} (h : apply st edit = some post)
    {v e actor stay epoch deps proposal via x hdr tags proof touches fits defines}
    (ha : edit.action = .write v e actor stay epoch deps proposal via (some (x, hdr)) tags proof touches fits defines) :
    proposal.isOn = false ∧
      post.writes = st.writes ++ [⟨edit.id, edit.author, actor, e, none, epoch, [], proposal, via, true, x⟩] ∧
      post.uncounted = st.counting (creates st actor v x ⟨hdr.type, actor, e, hdr.created, tags.apply []⟩ proof
        (proposal == .main) fits) edit.id := by
  unfold apply at h
  rw [ha] at h
  dsimp only at h
  split at h
  · cases h
  split at h
  · cases h
  rename_i hnew
  split at h
  · cases h
  cases h
  refine ⟨?_, rfl, rfl⟩
  cases hp : proposal.isOn
  · rfl
  · simp [hp] at hnew

/-- D2, a step: a draft's creation is recorded as the start of its own line, and its readers count it exactly as
    `creates` says of a creation on a proposal. -/
theorem draft_step {st st' : State} {edit : Edit} (h : step st edit = some st')
    {v e a epoch via x hdr tags proof touches fits defines}
    (ha : edit.action = .write v e a none epoch [] .new via (some (x, hdr)) tags proof touches fits defines) :
    (⟨edit.id, edit.author, a, e, none, epoch, [], .new, via, true, x⟩ : Write) ∈ st'.writes ∧
      st'.uncounted = st.counting (creates st a v x ⟨hdr.type, a, e, hdr.created, tags.apply []⟩ proof false fits)
        edit.id := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  obtain ⟨-, hw, hu⟩ := apply_creation hpost ha
  rw [Shares.settle_writes, settle_uncounted, hw, hu]
  exact ⟨List.mem_append_right _ (List.mem_singleton_self _), rfl⟩

/-- D3: where the live part of an entry's audience is its semantic audience, as its stewards mark it, a draft that
    hasn't landed is in no audience a share to everyone reaches, unless a live wide share to everyone is over its
    vault: everyone opens no key of its audience. -/
theorem drafts_not_public {st : State} (hr : Reachable st) {en : Entry}
    (haud : liveAudience st en = semAudience st en) (hl : landed st en = false)
    (hwide : ¬∃ cp ∈ st.shares, cp.over = en.vault ∧ cp.wide = true ∧ cp.who = .everyone ∧ st.live cp.id = true) :
    publicKey st (.audience en.vault en.audience) = false := by
  have hw := Shares.sharesWell_reachable hr
  unfold publicKey
  rw [Bool.eq_false_iff]
  intro h
  obtain ⟨cp, hcp, hc⟩ := List.any_eq_true.1 h
  simp only [Bool.and_eq_true, beq_iff_eq, Bool.or_eq_true] at hc
  obtain ⟨⟨⟨⟨hov, hlive⟩, -⟩, hwx⟩, hwho⟩ := hc
  rcases hwx with hwd | hin
  · exact hwide ⟨cp, hcp, hov, hwd, hwho, hlive⟩
  · -- a live share of the entry's audience is in its semantic audience, which leaves every share to everyone out
    have hmem : cp.id ∈ liveAudience st en := List.mem_filter.2 ⟨List.contains_iff_mem.1 hin, hlive⟩
    rw [haud] at hmem
    unfold semAudience at hmem
    split at hmem
    · simp only [mkAudience, List.mem_mergeSort, List.mem_eraseDups, List.mem_map, List.mem_filter] at hmem
      obtain ⟨cp', ⟨hcp', hsel⟩, hid⟩ := hmem
      obtain rfl := Shares.eq_of_id hw.1 hcp' hcp hid
      simp [hl, hwho] at hsel
    · simp at hmem

end AvenDB.Ruling

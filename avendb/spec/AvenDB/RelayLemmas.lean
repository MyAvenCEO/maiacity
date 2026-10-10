import AvenDB.Props

/-!
# Blind relays

The proof of T25: a peer that reads no selector, no type and no tag, such as the server, has every edit stand or fall
as an owner does and knows the same of the operational part of the state. Stated as in `Theorems.lean`.

A simulation. Every rule a peer checks or applies reads only the operational part of a state (`State.ops`): the caps
without their selectors and ops, the entries without their attributes and whether they were let in
(`admits` and `effSelects`, which read those, only ever feed `admitted`). So checking an edit on a state's operational
part, as the relay's copy of it, accepts and refuses alike and changes the operational part alike (`apply_ops`), and
so does settling keys. A relay's copy of an edit keeps its id, depth, author, signers, parents and kind, so it sorts in
the same place, cuts the same, and has the same priority; replay, resolve, the view and the edits that stand follow.

The rewriting lemmas here are proven by `cases`, not `rfl`, so that `simp` also rewrites inside the `Decidable`
instances of the `if`s in `apply`.
-/

namespace AvenDB.Relays

/-! ## The operational part -/

/-- An entry as a relay knows it: its id, vault and stays, without its attributes or whether it was let in. -/
def eblind (en : Entry) : Entry := { en with attrs := ⟨0, 0, 0, 0, []⟩, admitted := false }

/-- The operational part blinds the caps and the entries and keeps the rest. -/
theorem ops_eq (st : State) :
    st.ops = { st with caps := st.caps.map Cap.blind, entries := st.entries.map eblind, uncounted := [] } :=
  rfl

/-- The operational part keeps the vaults. -/
theorem ops_vaults (st : State) : st.ops.vaults = st.vaults := by cases st; rfl
/-- The operational part has the caps as a relay sees them. -/
theorem ops_caps (st : State) : st.ops.caps = st.caps.map Cap.blind := by cases st; rfl
/-- The operational part keeps the revocations. -/
theorem ops_revoked (st : State) : st.ops.revoked = st.revoked := by cases st; rfl
/-- The operational part has the entries as a relay knows them. -/
theorem ops_entries (st : State) : st.ops.entries = st.entries.map eblind := by cases st; rfl
/-- The operational part keeps the writes. -/
theorem ops_writes (st : State) : st.ops.writes = st.writes := by cases st; rfl
/-- The operational part keeps the epochs. -/
theorem ops_epochs (st : State) : st.ops.epochs = st.epochs := by cases st; rfl
/-- The operational part keeps the seals. -/
theorem ops_seals (st : State) : st.ops.seals = st.seals := by cases st; rfl
/-- The operational part keeps what is published. -/
theorem ops_published (st : State) : st.ops.published = st.published := by cases st; rfl
/-- The operational part keeps the schema lanes. -/
theorem ops_lane (st : State) : st.ops.lane = st.lane := by cases st; rfl
/-- The operational part keeps the entry ids ever created. -/
theorem ops_born (st : State) : st.ops.born = st.born := by cases st; rfl
/-- The operational part knows nothing of which writes readers count. -/
theorem ops_uncounted (st : State) : st.ops.uncounted = [] := by cases st; rfl

/-- A cap as a relay sees it keeps its id. -/
theorem blind_id (c : Cap) : c.blind.id = c.id := by cases c; rfl
/-- A cap as a relay sees it keeps the vault it is over. -/
theorem blind_over (c : Cap) : c.blind.over = c.over := by cases c; rfl
/-- A cap as a relay sees it keeps its grantee. -/
theorem blind_grantee (c : Cap) : c.blind.grantee = c.grantee := by cases c; rfl
/-- A cap as a relay sees it keeps its role. -/
theorem blind_role (c : Cap) : c.blind.role = c.role := by cases c; rfl
/-- A cap as a relay sees it keeps whether it is wide. -/
theorem blind_wide (c : Cap) : c.blind.wide = c.wide := by cases c; rfl
/-- A cap as a relay sees it keeps its parent. -/
theorem blind_parent (c : Cap) : c.blind.parent = c.parent := by cases c; rfl
/-- A cap as a relay sees it keeps its issuer. -/
theorem blind_issuer (c : Cap) : c.blind.issuer = c.issuer := by cases c; rfl
/-- A relay sees a cap it already sees blind the same. -/
theorem blind_blind (c : Cap) : c.blind.blind = c.blind := by cases c; rfl
/-- Blinding caps twice is blinding them once. -/
theorem blind_comp_blind : Cap.blind ∘ Cap.blind = Cap.blind := by funext c; cases c; rfl

/-- An entry as a relay knows it keeps its id. -/
theorem eblind_id (en : Entry) : (eblind en).id = en.id := by cases en; rfl
/-- An entry as a relay knows it keeps its vault. -/
theorem eblind_vault (en : Entry) : (eblind en).vault = en.vault := by cases en; rfl
/-- An entry as a relay knows it keeps its stays. -/
theorem eblind_stays (en : Entry) : (eblind en).stays = en.stays := by cases en; rfl
/-- An entry as a relay knows it is in the same cell. -/
theorem eblind_cell (en : Entry) : (eblind en).cell = en.cell := by cases en; rfl
/-- An entry as a relay knows it has the same cells for its stays. -/
theorem eblind_stayCell (en : Entry) : (eblind en).stayCell = en.stayCell := by cases en; rfl
/-- Blinding entries twice is blinding them once. -/
theorem eblind_comp_eblind : eblind ∘ eblind = eblind := by funext en; cases en; rfl

/-- The operational part of the operational part is itself. -/
theorem ops_ops (st : State) : st.ops.ops = st.ops := by
  simp only [ops_eq, List.map_map, blind_comp_blind, eblind_comp_eblind]

/-! ## What reads only the vaults, the epochs and the seals -/

/-- Looking up a vault reads only the vaults. -/
theorem vault?_ops (st : State) : st.ops.vault? = st.vault? := by cases st; rfl
/-- The chain bound counts only the vaults. -/
theorem depth_ops (st : State) : st.ops.depth = st.depth := by cases st; rfl

/-- Acting for a vault reads only the vaults. -/
theorem actsForN_ops (st : State) : actsForN st.ops = actsForN st := by
  funext s n
  induction n with
  | zero => rfl
  | succ n ih => funext v; simp only [actsForN, ih, vault?_ops]

/-- Acting for a vault reads only the vaults. -/
theorem actsFor_ops (st : State) : actsFor st.ops = actsFor st := by
  funext s v; simp only [actsFor, actsForN_ops, depth_ops]

/-- Being listed as an owner reads only the vaults. -/
theorem ownerOf_ops (st : State) : ownerOf st.ops = ownerOf st := by cases st; rfl

/-- Acting for a vault through owners reads only the vaults. -/
theorem actsVia_ops (st : State) : actsVia st.ops = actsVia st := by
  funext s via
  induction via with
  | nil => rfl
  | cons o via ih => funext v; simp only [actsVia, ih, ownerOf_ops]

/-- Approval reads only the vaults. -/
theorem approvesN_ops (st : State) : approvesN st.ops = approvesN st := by
  funext sigs n
  induction n with
  | zero => funext p; cases p <;> rfl
  | succ n ih => funext p; cases p <;> simp only [approvesN, ih, vault?_ops]

/-- Approval reads only the vaults. -/
theorem approves_ops (st : State) : approves st.ops = approves st := by
  funext sigs p; simp only [approves, approvesN_ops, depth_ops]

/-- Ownership reads only the vaults. -/
theorem ownsN_ops (st : State) : ownsN st.ops = ownsN st := by
  funext a n
  induction n with
  | zero => rfl
  | succ n ih => funext x; simp only [ownsN, ih, vault?_ops]

/-- Ownership reads only the vaults. -/
theorem owns_ops (st : State) : owns st.ops = owns st := by
  funext a x; simp only [owns, ownsN_ops, depth_ops]

/-- Who may own vaults reads only the vaults. -/
theorem ownerFits_ops (st : State) : ownerFits st.ops = ownerFits st := by
  funext k p; cases k <;> cases p <;> rfl

/-- A vault's tier reads only the vaults. -/
theorem tierN_ops (st : State) : tierN st.ops = tierN st := by
  funext n
  induction n with
  | zero => rfl
  | succ n ih => funext v; simp only [tierN, ih, vault?_ops]

/-- A vault's tier reads only the vaults. -/
theorem tier_ops (st : State) : tier st.ops = tier st := by
  funext v; simp only [tier, tierN_ops, depth_ops]

/-- Epochs are kept. -/
theorem epochOf_ops (st : State) : st.ops.epochOf = st.epochOf := by cases st; rfl
/-- Current keys are kept. -/
theorem curKey_ops (st : State) : st.ops.curKey = st.curKey := by cases st; rfl
/-- The holders that matter are read off the vaults. -/
theorem holders_ops (st : State) : holders st.ops = holders st := by cases st; rfl
/-- The keys a holder starts out with are current keys. -/
theorem start_ops (st : State) : Holder.start st.ops = Holder.start st := by
  funext h; cases h <;> cases st <;> rfl
/-- Opening seals reads only the seals. -/
theorem openRound_ops (st : State) : openRound st.ops = openRound st := by cases st; rfl
/-- Opening seals reads only the seals. -/
theorem openAll_ops (st : State) : openAll st.ops = openAll st := by
  funext n
  induction n with
  | zero => rfl
  | succ n ih => funext known; simp only [openAll, ih, openRound_ops]
/-- What a holder can open reads only the seals and what is published. -/
theorem opens_ops (st : State) : opens st.ops = opens st := by
  funext start; simp only [opens, openAll_ops, ops_seals, ops_published]

/-! ## What reads the caps, but not their selectors -/

/-- Looking up a cap in the operational part finds it as a relay sees it. -/
theorem cap?_ops (st : State) (c : CapId) : st.ops.cap? c = (st.cap? c).map Cap.blind := by
  simp only [State.cap?, ops_caps, List.find?_map]; rfl

/-- Whether a cap is live reads only ids and revocations. -/
theorem live_ops (st : State) : st.ops.live = st.live := by
  funext c; simp only [State.live, ops_caps, List.any_map, Function.comp_def, blind_id, ops_revoked]

/-- The parent of a cap as a relay sees it is its parent. -/
theorem bind_parent_blind (o : Option Cap) : (o.map Cap.blind).bind (·.parent) = o.bind (·.parent) := by
  cases o <;> rfl

/-- Resting on a cap reads only ids and parents. -/
theorem restsOnN_ops (st : State) : restsOnN st.ops = restsOnN st := by
  funext c n
  induction n with
  | zero => rfl
  | succ n ih => funext x; simp only [restsOnN, ih, cap?_ops, bind_parent_blind]

/-- Resting on a cap reads only ids and parents. -/
theorem restsOn_ops (st : State) : restsOn st.ops = restsOn st := by
  funext c x; simp only [restsOn, restsOnN_ops, ops_caps, List.length_map]

/-- A cap's chain in the operational part is its chain as a relay sees it. -/
theorem chainN_ops (st : State) : ∀ n (c : Cap), chainN st.ops n c.blind = (chainN st n c).map Cap.blind
  | 0, _ => rfl
  | n + 1, c => by
    rw [chainN, chainN, List.map_append]
    congr 1
    simp only [blind_parent]
    cases c.parent with
    | none => rfl
    | some p =>
      simp only [Option.bind_some, cap?_ops]
      cases st.cap? p with
      | none => rfl
      | some q => exact chainN_ops st n q

/-- A cap's chain in the operational part is its chain as a relay sees it. -/
theorem chain_ops (st : State) (c : Cap) : chain st.ops c.blind = (chain st c).map Cap.blind := by
  simp only [chain, chainN_ops, ops_caps, List.length_map]

/-- A cap's intake cell reads only its chain's ids and whether they are wide. -/
theorem intake_ops (st : State) (c : Cap) : intake st.ops c.blind = intake st c := by
  simp only [intake, chain_ops, List.filter_map, List.map_map]; rfl

/-- Whether a cell is one of a vault's reads only the caps' ids, vaults and whether they are wide. -/
theorem cellOk_ops (st : State) : cellOk st.ops = cellOk st := by
  funext v x; simp only [cellOk, ops_caps, List.any_map, Function.comp_def, blind_id, blind_over, blind_wide]

/-- Holding a cap reads whether it is live, its grantee and its role. -/
theorem holdsCap_ops (st : State) : holdsCap st.ops = holdsCap st := by
  funext a c r; simp only [holdsCap, live_ops]

/-- Holding a cap as a relay sees it is holding the cap. -/
theorem holdsCap_blind (st : State) (a : VaultId) (c : Cap) (r : Role) :
    holdsCap st a c.blind r = holdsCap st a c r := by
  cases c; rfl

/-- Whether a cap reaches an entry reads its id, vault and width, and the entry's id, vault and cell. -/
theorem inCell_ops (st : State) : inCell st.ops = inCell st := by cases st; rfl
/-- A cap as a relay sees it reaches what the cap reaches. -/
theorem inCell_blind (st : State) (c : Cap) (en : Entry) : inCell st c.blind en = inCell st c en := by
  cases c; rfl

/-- The write rule reads no selector, type or tag. -/
theorem mayWrite_ops (st : State) : mayWrite st.ops = mayWrite st := by
  funext a en; simp only [mayWrite, ops_caps, List.any_map, Function.comp_def, holdsCap_ops, holdsCap_blind,
    inCell_ops, inCell_blind]

/-- The write rule reads no attribute of the entry. -/
theorem mayWrite_eblind (st : State) (a : VaultId) (en : Entry) :
    mayWrite st a (eblind en) = mayWrite st a en := by
  cases en; rfl

/-- The create rule reads no selector. -/
theorem mayCreate_ops (st : State) : mayCreate st.ops = mayCreate st := by
  funext a v x; simp only [mayCreate, ops_caps, List.any_map, Function.comp_def, holdsCap_ops, holdsCap_blind,
    blind_over, intake_ops]

/-- Looking up an entry in the operational part finds it as a relay knows it. -/
theorem entry?_ops (st : State) (e : EntryId) : st.ops.entry? e = (st.entry? e).map eblind := by
  simp only [State.entry?, ops_entries, List.find?_map]; rfl

/-- Whether a write is authorized reads no selector, type or tag. -/
theorem authorized_ops (st : State) : authorized st.ops = authorized st := by
  funext w; simp only [authorized, actsVia_ops, entry?_ops]
  cases st.entry? w.entry with
  | none => rfl
  | some en => simp only [Option.map_some, mayWrite_ops]; cases en; rfl

/-- Who publishes into a schema lane reads no selector. -/
theorem ownsLane_ops (st : State) : ownsLane st.ops = ownsLane st := by
  funext a v; simp only [ownsLane, ops_caps, List.any_map, Function.comp_def, holdsCap_ops, holdsCap_blind,
    blind_over, blind_wide]

/-- Who may read a key family reads no selector. -/
theorem readsV_ops (st : State) : readsV st.ops = readsV st := by
  funext y k
  cases k with
  | seed v => rfl
  | cap v c => simp only [readsV, cap?_ops, live_ops]; cases st.cap? c <;> rfl
  | cell v x => simp only [readsV, ops_caps, List.any_map, Function.comp_def, live_ops, blind_id, blind_over,
      blind_role, blind_wide, blind_grantee]

/-- Which key families are public reads no selector. -/
theorem publicKey_ops (st : State) : publicKey st.ops = publicKey st := by
  funext k
  cases k with
  | seed v => rfl
  | cap v c => simp only [publicKey, cap?_ops, live_ops]; cases st.cap? c <;> rfl
  | cell v x => simp only [publicKey, ops_caps, List.any_map, Function.comp_def, live_ops, blind_id, blind_over,
      blind_role, blind_wide, blind_grantee]

/-- Who is entitled to a key reads no selector. -/
theorem entitled_ops (st : State) : entitled st.ops = entitled st := by
  funext d k; simp only [entitled, ops_vaults, actsFor_ops, readsV_ops]

/-- What a vault's seed is entitled to reads no selector. -/
theorem entitledV_ops (st : State) : entitledV st.ops = entitledV st := by
  funext x k; simp only [entitledV, ops_vaults, owns_ops, readsV_ops]

/-- What a holder is entitled to reads no selector. -/
theorem holderEntitled_ops (st : State) : Holder.entitled st.ops = Holder.entitled st := by
  funext h; cases h <;> simp only [Holder.entitled, entitled_ops, entitledV_ops, publicKey_ops]

/-- The key families read the vaults, the live caps with read or more, and the entries' cells. -/
theorem keyFams_ops (st : State) : keyFams st.ops = keyFams st := by
  simp only [keyFams, ops_vaults, ops_caps, ops_entries, List.filter_map, List.map_map, live_ops]; rfl

/-- A relay sees whether a new entry brings its cell back into use. -/
theorem reenters_ops (st : State) (v : VaultId) (x : Cell) : reenters st.ops v x = reenters st v x := by
  simp only [reenters, keyFams_ops, ops_seals, curKey_ops]

/-- Whom a key is sealed to reads no selector. -/
theorem targets_ops (st : State) : targets st.ops = targets st := by
  funext k
  cases k with
  | seed v => cases st; rfl
  | cap v c => simp only [targets, cap?_ops, curKey_ops]; cases st.cap? c <;> rfl
  | cell v x => simp only [targets, curKey_ops, ops_caps, List.filter_map, List.map_map, live_ops]; rfl

/-- Which keys go stale reads no selector, type or tag. -/
theorem staleKeys_ops (pre post : State) : staleKeys pre.ops post.ops = staleKeys pre post := by
  simp only [staleKeys, holders_ops, opens_ops, start_ops, keyFams_ops, publicKey_ops, curKey_ops,
    holderEntitled_ops, ops_seals]

/-- Whether a cap rests rightly on its parent reads no selector. -/
theorem capParentOk_ops (st : State) : capParentOk st.ops = capParentOk st := by
  funext c; simp only [capParentOk, cap?_ops, live_ops]
  cases c.parent with
  | none => rfl
  | some p => simp only; cases st.cap? p <;> rfl

/-- Whether a cap as a relay sees it rests rightly on its parent is whether the cap does. -/
theorem capParentOk_blind (st : State) (c : Cap) : capParentOk st c.blind = capParentOk st c := by
  cases c; rfl

/-- Who may revoke a cap reads only issuers, vaults, grantees and parents. -/
theorem mayRevokeN_ops (st : State) (a : VaultId) :
    ∀ n (c : Cap), mayRevokeN st.ops a n c.blind = mayRevokeN st a n c
  | 0, _ => rfl
  | n + 1, c => by
    simp only [mayRevokeN, blind_issuer, blind_over, blind_grantee, blind_parent]
    congr 1
    cases c.parent with
    | none => rfl
    | some p =>
      simp only [Option.bind_some, cap?_ops]
      cases st.cap? p with
      | none => rfl
      | some q => exact mayRevokeN_ops st a n q

/-- Who may revoke a cap reads only issuers, vaults, grantees and parents. -/
theorem mayRevoke_ops (st : State) (a : VaultId) (c : Cap) : mayRevoke st.ops a c.blind = mayRevoke st a c := by
  simp only [mayRevoke, mayRevokeN_ops, ops_caps, List.length_map]

/-- Who may box a key reads no selector, type or tag. -/
theorem mayBox_ops (st : State) : mayBox st.ops = mayBox st := by
  funext d k
  cases k with
  | signer s => rfl
  | «scoped» k ε => simp only [mayBox, keyFams_ops, entitled_ops]; rfl
  | entry e s g => simp only [mayBox, entry?_ops, entitled_ops, epochOf_ops]; cases st.entry? e <;> rfl

/-- How senior a revoker is reads only the cap's chain of issuers. -/
theorem seniority_ops (st : State) (a : VaultId) (c : Cap) : seniority st.ops a c.blind = seniority st a c := by
  simp only [seniority, blind_over, chain_ops, List.findIdx?_map, List.length_map]; rfl

/-- A removal's priority reads no selector, type or tag. -/
theorem priority_ops (st : State) : priority st.ops = priority st := by
  funext edit
  unfold priority
  split
  · simp only [tier_ops, vault?_ops, approves_ops]
  · simp only [tier_ops, vault?_ops, approves_ops]
  · simp only [tier_ops, vault?_ops, approves_ops]
  · simp only [cap?_ops]
    cases st.cap? _ with
    | none => rfl
    | some c => simp only [Option.map_some, Option.elim, seniority_ops]
  · rfl
  · rfl

/-! ## Changes that commute with taking the operational part -/

/-- Changing a vault commutes with taking the operational part. -/
theorem setVault_ops (st : State) (vt : Vault) : (setVault st vt).ops = setVault st.ops vt := by cases st; rfl

/-- Changing an entry commutes with taking the operational part, which knows the entry as a relay does. -/
theorem setEntry_ops (st : State) (en : Entry) : (setEntry st en).ops = setEntry st.ops (eblind en) := by
  simp only [setEntry, ops_eq, List.map_map]
  congr 1
  apply List.map_congr_left; intro x _
  by_cases h : x.id == en.id <;> simp only [Function.comp, eblind_id, h, ite_true, ite_false, Bool.false_eq_true]

/-- Changing the writes commutes with taking the operational part. -/
theorem ops_with_writes (s : State) (W : List Write) :
    ({ s with writes := W } : State).ops = { s.ops with writes := W } := by
  cases s; rfl

/-- Changing the writes, and which of them readers count, commutes with taking the operational part, which knows
    nothing of the second. -/
theorem ops_with_counted (s : State) (W : List Write) (U : List EditId) :
    ({ s with writes := W, uncounted := U } : State).ops = { s.ops with writes := W } := by
  cases s; rfl

/-- Hiding facts commutes with taking the operational part. -/
theorem hide_ops (st : State) (fs : List Fact) : (hide st fs).ops = hide st.ops fs := by
  unfold hide; split <;> rfl

/-- Dropping what a removal hadn't seen reads only authorization, so it commutes with taking the operational part. -/
theorem dropUnseen_ops (pre post : State) (keep : List EditId) :
    (dropUnseen pre post keep).ops = dropUnseen pre.ops post.ops keep := by
  simp only [dropUnseen]
  -- first what the drop reads, then the operational part of what it leaves
  simp only [authorized_ops, ops_writes, ops_entries, ops_vaults, ops_caps, ops_revoked, ops_epochs, ops_seals,
    ops_published, ops_lane, ops_born, List.filter_map, List.any_map]
  simp only [ops_eq, Function.comp_def, eblind_id]

/-- Adding a seal commutes with taking the operational part. -/
theorem addSeal_ops (st : State) (s : Seal) : (addSeal st s).ops = addSeal st.ops s := by
  by_cases h : st.seals.contains s <;>
    simp only [addSeal, ops_seals, h, ite_true, ite_false, Bool.false_eq_true] <;> rfl

/-- Publishing a key commutes with taking the operational part. -/
theorem publish_ops (st : State) (k : KeyName) : (publish st k).ops = publish st.ops k := by
  by_cases h : st.published.contains k <;>
    simp only [publish, ops_published, h, ite_true, ite_false, Bool.false_eq_true] <;> rfl

/-- Starting a new epoch commutes with taking the operational part. -/
theorem bump_ops (st : State) (k : KeyFam) : (bump st k).ops = bump st.ops k := by cases st; rfl

/-- An entry's key reads only the epochs. -/
theorem entryKey_ops (st : State) : entryKey st.ops = entryKey st := by cases st; rfl
/-- An entry's key reads only its id, stay, vault and cell. -/
theorem entryKey_eblind (st : State) (en : Entry) : entryKey st (eblind en) = entryKey st en := by
  cases en; rfl

/-- `linkAll`'s step for one write `w` of entry `en`. -/
def linkW (en : Entry) (acc : State) (w : Write) : State :=
  let acc := addSeal acc ⟨w.key, .scoped (.cell en.vault ((en.stayCell w.stay).getD [])) w.gen⟩
  if w.stay == en.stay || acc.seals.any (fun s => s.secret == w.key && match s.to with
      | .entry e s' _ => e == en.id && s' == en.stay
      | _ => false) then acc
  else addSeal acc ⟨w.key, entryKey acc en⟩

/-- `linkAll`'s step for one entry `en`, given the writes `ws`. -/
def linkE (ws : List Write) (acc : State) (en : Entry) : State :=
  let acc := addSeal acc ⟨entryKey acc en, acc.curKey (.cell en.vault en.cell)⟩
  (ws.filter (·.entry == en.id)).foldl (linkW en) acc

/-- `linkAll` is a fold of `linkE` over the entries. -/
theorem linkAll_eq (st : State) : linkAll st = st.entries.foldl (linkE st.writes) st := rfl

/-- Linking one write commutes with taking the operational part. -/
theorem linkW_ops (en : Entry) (acc : State) (w : Write) : linkW en acc.ops w = (linkW en acc w).ops := by
  simp only [linkW, ← addSeal_ops, ops_seals, entryKey_ops]
  split <;> rfl

/-- Linking one entry commutes with taking the operational part, which knows the entry as a relay does. -/
theorem linkE_ops (ws : List Write) (en : Entry) (acc : State) :
    linkE ws acc.ops (eblind en) = (linkE ws acc en).ops := by
  simp only [linkE, entryKey_eblind, eblind_vault, eblind_cell, eblind_id, entryKey_ops, curKey_ops, ← addSeal_ops]
  exact List.foldl_hom State.ops (fun acc w => linkW_ops en acc w)

/-- Linking the entry keys commutes with taking the operational part. -/
theorem linkAll_ops (st : State) : (linkAll st).ops = linkAll st.ops := by
  rw [linkAll_eq, linkAll_eq, ops_entries, ops_writes, List.foldl_map]
  exact (List.foldl_hom State.ops (fun acc en => linkE_ops st.writes en acc)).symm

/-- `sealAll`'s step for one key family. -/
def sealK (acc : State) (k : KeyFam) : State :=
  let acc := (targets acc k).foldl (fun a t => addSeal a ⟨a.curKey k, t⟩) acc
  if publicKey acc k then publish acc (acc.curKey k) else acc

/-- `sealAll` links after a fold of `sealK` over the key families. -/
theorem sealAll_eq (st : State) : sealAll st = linkAll ((keyFams st).foldl sealK st) := rfl

/-- Sealing one key family commutes with taking the operational part. -/
theorem sealK_ops (acc : State) (k : KeyFam) : sealK acc.ops k = (sealK acc k).ops := by
  simp only [sealK, targets_ops]
  rw [List.foldl_hom State.ops (g₁ := fun a t => addSeal a ⟨a.curKey k, t⟩) (fun a t => by
    simp only [curKey_ops, addSeal_ops])]
  simp only [publicKey_ops, curKey_ops, ← publish_ops]
  split <;> rfl

/-- Sealing every key commutes with taking the operational part. -/
theorem sealAll_ops (st : State) : (sealAll st).ops = sealAll st.ops := by
  rw [sealAll_eq, sealAll_eq, linkAll_ops, keyFams_ops]
  congr 1
  exact (List.foldl_hom State.ops (fun acc k => sealK_ops acc k)).symm

/-- Settling keys after a change reads only the operational parts of the states before and after it. -/
theorem settle_ops (pre post : State) : (settle pre post).ops = settle pre.ops post.ops := by
  simp only [settle, sealAll_ops, staleKeys_ops]
  congr 1
  exact (List.foldl_hom State.ops (fun st k => bump_ops st k)).symm

/-! ## Checking an edit -/

/-- An edit's signers are its author and its cosigners. -/
theorem sigs_mk (id depth author cosigners action parents) :
    Edit.sigs ⟨id, depth, author, cosigners, action, parents⟩ = author :: cosigners := by
  cases action <;> rfl

/-- Taking the operational part of a refusal is a refusal. -/
theorem map_ite_none {α β : Type} (f : α → β) (c : Prop) [Decidable c] (x : Option α) :
    Option.map f (if c then none else x) = if c then none else Option.map f x := by
  split <;> rfl

/-- Checking a relay's copy of an edit on the operational part of a state accepts it exactly when checking the edit on
    the state does, and the results have the same operational part. -/
theorem apply_ops (st : State) (edit : Edit) :
    (apply st.ops edit.blind).map State.ops = (apply st edit).map State.ops := by
  rcases edit with ⟨id, depth, author, cosigners, action, parents⟩
  -- in each case: unfold the relay's copy, then what the checks read, then push the operational part inside
  cases action with
  | genesis v kind owners threshold root =>
    simp only [Edit.blind, Action.blind]
    simp only [apply, sigs_mk, vault?_ops, ownerFits_ops, approves_ops, ops_vaults]
    simp only [map_ite_none, Option.map_some, ops_eq, List.map_map, blind_comp_blind, eblind_comp_eblind]
  | addOwner v p =>
    simp only [Edit.blind, Action.blind]
    simp only [apply, sigs_mk, vault?_ops, ownerFits_ops, approves_ops, owns_ops]
    cases st.vault? v with
    | none => rfl
    | some vt => simp only [map_ite_none, Option.map_some, setVault_ops, ops_ops]
  | removeOwner v p keep =>
    simp only [Edit.blind, Action.blind]
    simp only [apply, sigs_mk, vault?_ops, approves_ops]
    cases st.vault? v with
    | none => rfl
    | some vt => simp only [map_ite_none, Option.map_some, dropUnseen_ops, setVault_ops, ops_ops]
  | setThreshold v n =>
    simp only [Edit.blind, Action.blind]
    simp only [apply, sigs_mk, vault?_ops, approves_ops]
    cases st.vault? v with
    | none => rfl
    | some vt => simp only [map_ite_none, Option.map_some, setVault_ops, ops_ops]
  | addDevice v d =>
    simp only [Edit.blind, Action.blind]
    simp only [apply, sigs_mk, vault?_ops, approves_ops]
    cases st.vault? v with
    | none => rfl
    | some vt => simp only [map_ite_none, Option.map_some, setVault_ops, ops_ops]
  | removeDevice v d keep =>
    simp only [Edit.blind, Action.blind]
    simp only [apply, sigs_mk, vault?_ops, approves_ops]
    cases st.vault? v with
    | none => rfl
    | some vt => simp only [map_ite_none, Option.map_some, dropUnseen_ops, setVault_ops, ops_ops]
  | setRoot v r keep =>
    simp only [Edit.blind, Action.blind]
    simp only [apply, sigs_mk, vault?_ops]
    cases st.vault? v with
    | none => rfl
    | some vt => simp only [map_ite_none, Option.map_some, setVault_ops, ops_ops]
  | cap c via =>
    -- the checks read no selector, and the new cap is kept as a relay sees it
    simp only [Edit.blind, Action.blind]
    simp only [apply, sigs_mk, vault?_ops, cap?_ops, Option.isSome_map, actsVia_ops, capParentOk_ops,
      capParentOk_blind, approves_ops, ops_caps, blind_id, blind_over, blind_grantee, blind_role, blind_issuer]
    simp only [map_ite_none, Option.map_some, ops_eq, List.map_map, List.map_append, blind_comp_blind,
      eblind_comp_eblind, List.map_cons, List.map_nil, blind_blind]
  | revoke cid actor keep via =>
    simp only [Edit.blind, Action.blind]
    simp only [apply, sigs_mk, cap?_ops, live_ops, actsVia_ops, approves_ops]
    cases st.cap? cid with
    | none => rfl
    | some c =>
      simp only [Option.map_some, mayRevoke_ops, blind_role, ops_vaults, ops_caps, ops_revoked, ops_entries,
        ops_writes, ops_epochs, ops_seals, ops_published, ops_lane, ops_born, restsOn_ops,
        List.filter_map, List.map_map, Function.comp_def, blind_id]
      simp only [map_ite_none, Option.map_some, dropUnseen_ops, ops_ops]
      simp only [ops_eq, List.map_map, blind_comp_blind, eblind_comp_eblind]
  | write v e actor stay gen deps proposal via create tags =>
    -- the header and the tags reach only the entry's attributes and whether it was let in
    simp only [Edit.blind, Action.blind]
    cases create with
    | none =>
      simp only [Option.map_none]
      by_cases hav : (actor == v) = true
      · simp only [apply, hav, ite_true, actsVia_ops, entry?_ops]
        simp only [map_ite_none]
        cases st.entry? e with
        | none => rfl
        | some en =>
          simp only [Option.map_some, eblind_vault, mayWrite_ops, mayWrite_eblind, eblind_stayCell, eblind_cell]
          simp only [map_ite_none]
          cases en.stayCell stay with
          | none => rfl
          | some x =>
            simp only [epochOf_ops, ops_writes]
            simp only [map_ite_none, Option.map_some, ops_with_counted, setEntry_ops, ops_ops]
            rfl
      · simp only [apply, hav, ite_false, Bool.false_eq_true, actsVia_ops, entry?_ops]
        simp only [map_ite_none]
        cases st.entry? e with
        | none => rfl
        | some en =>
          simp only [Option.map_some, eblind_vault, mayWrite_ops, mayWrite_eblind, eblind_stayCell, eblind_cell]
          simp only [map_ite_none]
          cases en.stayCell stay with
          | none => rfl
          | some x =>
            simp only [epochOf_ops, ops_writes]
            simp only [map_ite_none, Option.map_some, ops_with_counted, ops_ops]
    | some p =>
      obtain ⟨x, hdr⟩ := p
      simp only [Option.map_some]
      simp only [apply, ops_writes, actsVia_ops, entry?_ops, Option.isSome_map, ops_born, vault?_ops, cellOk_ops,
        mayCreate_ops, epochOf_ops, reenters_ops]
      simp only [map_ite_none, Option.map_some, ops_eq, List.map_map, List.map_append, blind_comp_blind,
        eblind_comp_eblind, List.map_cons, List.map_nil]
      rfl
  | move v e to keep via =>
    simp only [Edit.blind, Action.blind]
    simp only [apply, entry?_ops, actsVia_ops, cellOk_ops]
    cases st.entry? e with
    | none => rfl
    | some en =>
      simp only [Option.map_some, eblind_vault, eblind_cell, eblind_stays]
      simp only [map_ite_none, Option.map_some, dropUnseen_ops, setEntry_ops, ops_ops]
      rfl
  | keys secret to pub =>
    simp only [Edit.blind, Action.blind]
    simp only [apply, mayBox_ops, ops_seals, ops_published]
    simp only [map_ite_none, Option.map_some, ops_ops]
  | publish v actor blob via =>
    simp only [Edit.blind, Action.blind]
    simp only [apply, vault?_ops, ops_lane, actsVia_ops, ownsLane_ops]
    simp only [map_ite_none, Option.map_some, ops_eq, List.map_map, blind_comp_blind, eblind_comp_eblind]
  | checkpoint e covers =>
    simp only [Edit.blind, Action.blind]
    simp only [apply, ops_writes]
    simp only [map_ite_none, Option.map_some, ops_ops]

/-! ## A relay's copy of an edit -/

/-- A relay's copy of an edit keeps its id. -/
theorem eblind_edit_id (o : Edit) : o.blind.id = o.id := by cases o; rfl
/-- A relay's copy of an edit keeps its depth. -/
theorem eblind_edit_depth (o : Edit) : o.blind.depth = o.depth := by cases o; rfl
/-- A relay's copy of an edit keeps its parents. -/
theorem eblind_edit_parents (o : Edit) : o.blind.parents = o.parents := by cases o; rfl
/-- A relay's copy of an edit keeps what it keeps, if it is a removal. -/
theorem eblind_edit_keep? (o : Edit) : o.blind.action.keep? = o.action.keep? := by
  rcases o with ⟨_, _, _, _, a, _⟩; cases a <;> rfl
/-- A relay's copy of a removal is a removal. -/
theorem eblind_edit_isRemoval (o : Edit) : o.blind.isRemoval = o.isRemoval := by
  simp only [Edit.isRemoval, eblind_edit_keep?]
/-- A relay's copy of an edit sorts among the removals when the edit does. -/
theorem eblind_edit_rank (o : Edit) : o.blind.rank = o.rank := by
  rcases o with ⟨_, _, _, _, a, _⟩; cases a <;> rfl
/-- A relay copies a copy unchanged. -/
theorem eblind_edit_blind (o : Edit) : o.blind.blind = o.blind := by
  rcases o with ⟨_, _, _, _, a, _⟩
  cases a with
  | cap c via => simp only [Edit.blind, Action.blind, blind_blind]
  | write v e a s g deps p via create tags => cases create <;> rfl
  | _ => rfl

/-- A relay's copy of a removal has its priority. -/
theorem priority_blind (st : State) (o : Edit) : priority st o.blind = priority st o := by
  rcases o with ⟨_, _, _, _, a, _⟩; cases a <;> rfl

/-! ## One step, and a replay -/

/-- On states with the same operational part, a relay's copy of an edit is accepted exactly when the edit is, and the
    results have the same operational part. -/
theorem apply_sim {st st' : State} (h : st.ops = st'.ops) (edit : Edit) :
    (apply st' edit.blind).map State.ops = (apply st edit).map State.ops := by
  rw [← apply_ops st edit, h, ← apply_ops st' edit.blind, eblind_edit_blind]

/-- The same of a step, which also settles keys. -/
theorem step_sim {st st' : State} (h : st.ops = st'.ops) (edit : Edit) :
    (step st' edit.blind).map State.ops = (step st edit).map State.ops := by
  have hs : ∀ s : State, State.ops ∘ settle s = settle s.ops ∘ State.ops := fun s => funext fun p => settle_ops s p
  simp only [step, Option.map_map, hs]
  rw [← Option.map_map, ← Option.map_map, apply_sim h, h]

/-- Hiding the same facts keeps the operational parts equal. -/
theorem hide_sim {st st' : State} (h : st.ops = st'.ops) (fs : List Fact) : (hide st fs).ops = (hide st' fs).ops := by
  rw [hide_ops, hide_ops, h]

/-- Replaying relay copies of the edits from a state with the same operational part ends with the same operational
    part, and the relay copies of the same edits stand. -/
theorem runFrom_blind (rem : List Edit) (cs : List (Nat × List EditId × List Fact)) :
    ∀ (l : List (Edit × Nat)) (st st' : State), st.ops = st'.ops →
    (runFrom (rem.map Edit.blind) cs st' (l.map (Prod.map Edit.blind id))).1.ops = (runFrom rem cs st l).1.ops ∧
    (runFrom (rem.map Edit.blind) cs st' (l.map (Prod.map Edit.blind id))).2 = (runFrom rem cs st l).2.map Edit.blind
  | [], _, _, h => ⟨h.symm, rfl⟩
  | (edit, i) :: rest, st, st', h => by
    have hrem : (rem.map Edit.blind).any (·.id == edit.blind.id) = rem.any (·.id == edit.id) := by
      simp only [List.any_map, Function.comp_def, eblind_edit_id]
    have hhid : hiddenAt cs i edit.blind = hiddenAt cs i edit := by simp only [hiddenAt, eblind_edit_id]
    have ha := apply_sim (hide_sim h (hiddenAt cs i edit)) edit
    have hs := step_sim h edit
    simp only [List.map_cons, Prod.map, id, runFrom, eblind_edit_isRemoval, hrem, hhid]
    split
    · exact runFrom_blind rem cs rest st st' h
    · -- the check with the hidden facts, and the step, go alike on both sides
      cases h1 : apply (hide st (hiddenAt cs i edit)) edit with
      | none =>
        rw [h1] at ha
        cases h1' : apply (hide st' (hiddenAt cs i edit)) edit.blind with
        | none => simp only; exact runFrom_blind rem cs rest st st' h
        | some _ => rw [h1'] at ha; exact absurd ha (by simp)
      | some a =>
        rw [h1] at ha
        cases h1' : apply (hide st' (hiddenAt cs i edit)) edit.blind with
        | none => rw [h1'] at ha; exact absurd ha (by simp)
        | some a' =>
          cases h2 : step st edit with
          | none =>
            rw [h2] at hs
            cases h2' : step st' edit.blind with
            | none => simp only; exact runFrom_blind rem cs rest st st' h
            | some _ => rw [h2'] at hs; exact absurd hs (by simp)
          | some b =>
            rw [h2] at hs
            cases h2' : step st' edit.blind with
            | none => rw [h2'] at hs; exact absurd hs (by simp)
            | some b' =>
              rw [h2'] at hs
              have ih := runFrom_blind rem cs rest b b' (Option.some.inj hs).symm
              simp only [List.map_cons]
              exact ⟨ih.1, by rw [ih.2]⟩

/-! ## What a removal takes away -/

/-- The caps relay copies of edits issue are the caps the edits issue, as a relay sees them. -/
theorem capsIn_blind (edits : List Edit) : capsIn (edits.map Edit.blind) = (capsIn edits).map Cap.blind := by
  simp only [capsIn, List.filterMap_map, List.map_filterMap]
  congr 1
  funext o
  rcases o with ⟨_, _, _, _, a, _⟩
  cases a <;> rfl

/-- Resting on a cap among caps reads only their ids and parents. -/
theorem restsOnIn_blind (cs : List Cap) (c : CapId) :
    ∀ n x, restsOnIn (cs.map Cap.blind) c n x = restsOnIn cs c n x
  | 0, _ => rfl
  | n + 1, x => by
    simp only [restsOnIn, List.find?_map, Function.comp_def, blind_id, bind_parent_blind, restsOnIn_blind cs c n]

/-- A relay's copy of a removal takes away what the removal does. -/
theorem removes_blind (edits : List Edit) (r : Edit) : removes (edits.map Edit.blind) r.blind = removes edits r := by
  rcases r with ⟨_, _, _, _, a, _⟩
  cases a with
  | revoke c actor keep via =>
    simp only [Edit.blind, Action.blind, removes, capsIn_blind, List.filter_map, List.map_map, List.length_map,
      restsOnIn_blind, Function.comp_def, blind_id]
  | _ => rfl

/-- Relay copies of the edits and the removals cut what they do. -/
theorem cuts_blind (edits rem : List Edit) : cuts (edits.map Edit.blind) (rem.map Edit.blind) = cuts edits rem := by
  simp only [cuts, List.zipIdx_map, List.filterMap_map]
  congr 1
  funext p
  rcases p with ⟨r, j⟩
  simp only [Function.comp_def, Prod.map, id, List.any_map, eblind_edit_id, eblind_edit_keep?, removes_blind]

/-- Replaying relay copies with relay copies of the removals ends with the same operational part, and the relay
    copies of the same edits stand. -/
theorem runWith_blind (edits rem : List Edit) :
    (runWith (edits.map Edit.blind) (rem.map Edit.blind)).1.ops = (runWith edits rem).1.ops ∧
    (runWith (edits.map Edit.blind) (rem.map Edit.blind)).2 = (runWith edits rem).2.map Edit.blind := by
  simp only [runWith, cuts_blind, List.zipIdx_map]
  exact runFrom_blind rem (cuts edits rem) edits.zipIdx {} {} rfl

/-! ## The order, the removals that stand, and the view -/

/-- Relay copies compare as the edits do. -/
theorem before_blind (a b : Edit) : a.blind.before b.blind = a.before b := by
  simp only [Edit.before, eblind_edit_depth, eblind_edit_rank, eblind_edit_id]

/-- A relay's copy of an edit is malformed among relay copies exactly when the edit is. -/
theorem wellFormed_blind (edits : List Edit) (o : Edit) :
    wellFormed (edits.map Edit.blind) o.blind = wellFormed edits o := by
  simp only [wellFormed, eblind_edit_parents, List.all_map, Function.comp_def, eblind_edit_id, eblind_edit_depth]

/-- Relay copies sort in the order of the edits. -/
theorem order_blind (edits : List Edit) : order (edits.map Edit.blind) = (order edits).map Edit.blind := by
  simp only [order, List.filter_map, Function.comp_def, wellFormed_blind]
  exact (List.map_mergeSort (fun a _ b _ => (before_blind a b).symm)).symm

/-- The removals that stand among relay copies are the relay copies of those that stand among the edits. -/
theorem resolve_blind (edits : List Edit) : resolve (edits.map Edit.blind) = (resolve edits).map Edit.blind := by
  -- the replays without removals agree on their operational part, so on every priority
  have hbase : (runWith (edits.map Edit.blind) []).1.ops = (runWith edits []).1.ops := by
    simpa using (runWith_blind edits []).1
  have hprio : ∀ o, priority (runWith (edits.map Edit.blind) []).1 o.blind = priority (runWith edits []).1 o := by
    intro o
    rw [priority_blind, ← priority_ops, hbase, priority_ops]
  -- the candidates are the relay copies, in the same order
  have hcands : ((edits.map Edit.blind).filter Edit.isRemoval).mergeSort
      (fun a b => prioLe (priority (runWith (edits.map Edit.blind) []).1 a)
        (priority (runWith (edits.map Edit.blind) []).1 b)) =
      ((edits.filter Edit.isRemoval).mergeSort
        (fun a b => prioLe (priority (runWith edits []).1 a) (priority (runWith edits []).1 b))).map Edit.blind := by
    rw [List.filter_map, Function.comp_def]
    simp only [eblind_edit_isRemoval]
    exact (List.map_mergeSort (fun a _ b _ => by rw [hprio, hprio])).symm
  unfold resolve
  simp only []
  rw [hcands, List.foldl_map]
  -- each candidate is kept on both sides alike
  have h := List.foldl_hom (List.map Edit.blind) (l := (edits.filter Edit.isRemoval).mergeSort
      (fun a b => prioLe (priority (runWith edits []).1 a) (priority (runWith edits []).1 b))) (init := [])
    (g₁ := fun rem r =>
      if (r :: rem).all (fun x => (runWith edits (rem ++ [r])).2.any (·.id == x.id)) then rem ++ [r] else rem)
    (g₂ := fun rem r =>
      if (r.blind :: rem).all (fun x => (runWith (edits.map Edit.blind) (rem ++ [r.blind])).2.any (·.id == x.id))
      then rem ++ [r.blind] else rem) (by
      intro rem r
      have hr : rem.map Edit.blind ++ [r.blind] = (rem ++ [r]).map Edit.blind := by simp
      have hc : ((r.blind :: rem.map Edit.blind).all fun x =>
          (runWith (edits.map Edit.blind) (rem.map Edit.blind ++ [r.blind])).2.any (·.id == x.id)) =
          ((r :: rem).all fun x => (runWith edits (rem ++ [r])).2.any (·.id == x.id)) := by
        rw [hr, (runWith_blind edits (rem ++ [r])).2]
        simp only [List.all_cons, List.any_map, Function.comp_def, eblind_edit_id, List.all_map]
      rw [hc, apply_ite (List.map Edit.blind), hr])
  simpa using h

/-- What a relay holding the relay copies knows has the operational part of what a peer holding the edits knows. -/
theorem view_blind (edits : List Edit) : (view (edits.map Edit.blind)).ops = (view edits).ops := by
  simp only [view, order_blind, resolve_blind]
  exact (runWith_blind _ _).1

/-- The edits that stand for a relay are the relay copies of those that stand for a peer holding the edits. -/
theorem standing_blind (edits : List Edit) : standing (edits.map Edit.blind) = (standing edits).map Edit.blind := by
  simp only [standing, order_blind, resolve_blind]
  exact (runWith_blind _ _).2

theorem T25_blind_relays (edits : List Edit) :
    (view (edits.map Edit.blind)).ops = (view edits).ops ∧
      (standing (edits.map Edit.blind)).map (·.id) = (standing edits).map (·.id) := by
  refine ⟨view_blind edits, ?_⟩
  simp only [standing_blind, List.map_map, Function.comp_def, eblind_edit_id]

end AvenDB.Relays

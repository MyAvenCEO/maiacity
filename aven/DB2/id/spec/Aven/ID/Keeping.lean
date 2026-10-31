import Aven.ID.Caps

/-! # Keeping: who keeps a vault's Docs (A22)

A vault decides who keeps its data and who sees it, by its caps (Samuel, 31 Oct 2026): keep caps for keepers, keys and
read caps for readers. A keep cap is a cap like any other, a grant from the vault to a keeper's vault, and its lines
name `core/1`'s op `keep` on targets in Core's grammar (A8), so a target may be every Doc of a vault, of one type, or
what a collection lists (A32). A keeper is blind, so the issuing vault's devices, which read each Doc's facts, resolve
the target to the Doc ids they hand the keeper, each with its first fetch key: exactly the Docs it covers (`resolve`,
`resolve_exact`). What the keeper does
with them is `Aven.ID.Keep`'s. The Values a Doc's Records name, a file's chunks among them, are kept with it.

**The vault's owner always decides where its data goes** (Samuel, 31 Oct 2026). A keep cap may not share, so no keeper
passes data on: a chain that keeps has one holder, the keeper its root names, and every link after the root only
attenuates (`keep_one_holder`). A cap keeps a Doc only as the chain's root does, and the root's issuer has authority
over every line, its own vault or one it governs (`keeper_named_by_owner`). So no one else extends it, not Maia City
adding servers and not a keeper: a new keeper needs a new keep cap from the owner.

**A keeper decides only about its own resources** (A44): its vault offers storage to a vault or a group, as an op
`keep-offer` bounded by quota and rate (`keepOffer`, `offerLine`), and it keeps a Doc only where the owner's keep cap
names it and its own offer covers that owner (`Aven.ID.Keep`, `kept_only_offered`): keep caps ∩ offers.

**By default** a new vault issues a keep cap for everything of its own to Maia City's keeper, the Aven Peer acting for
Aven (`defaultKeep`, `default_kept`). It is an ordinary grant: it holds only with its owners' approval (D14), however
the join collects it, and without one it breaks `.approval` (`default_approved`, `default_needs_owner`). The vault can
withdraw it or issue others. A vault it governs starts with its own, so withdrawing that one isn't undone from above.
Every keeper of a Doc, by keep caps that are valid roots, is named by one its issuer's owners approved, whose line
covering the Doc lies in its issuer's authority (`keepers_by_owner`).

Coverage is Core's `Target.covers`, decided (`Target.coversB`, `Target.coversB_iff`): who governs whom, which actor
spawned which and what a collection lists (`Aven.ID.Collections`) are functions a device evaluates. -/

namespace Aven.ID

open Aven.Core

section

variable (gov : Bytes → Bytes → Bool) (spawned lists : DocId → DocId → Bool)

/-- A cap keeps the Doc whose genesis fixed `f`: one of its `keep` lines covers it. -/
def Cap.keeps (roles : List Role) (c : Cap) (f : Facts) : Bool :=
  (c.grants roles).any fun l => l.op == coreOp .keep && l.doc.coversB gov spawned lists f

theorem keeps_iff {roles : List Role} {c : Cap} {f : Facts} :
    c.keeps gov spawned lists roles f = true ↔
      (c.grants roles).reaches (gov · · = true) (spawned · · = true) (lists · · = true) f (coreOp .keep) := by
  simp only [Cap.keeps, List.any_eq_true, Bool.and_eq_true, beq_iff_eq, Target.coversB_iff, Grant.reaches]

/-- avenID's own op, by its id: the name of its stored form `{"op": name, "plugin": "id/1"}`. -/
def idOp (name : String) : OpId := OpId.ofPlugin blake3 "id/1" name

/-- **A keeper's offer** (A44): its vault offers its storage to a vault or a group, as much as the `quota` bound, in
bytes, and as fast as the `rate` bound, in bytes a second. Placement has one source, the owner's keep caps; a keeper
decides only about its own resources. -/
def keepOffer : OpId := idOp "keep-offer"

def rateParam : Bytes := "rate".toUTF8.toList
def quotaParam : Bytes := "quota".toUTF8.toList

/-- An offer's line: `keep-offer` on the keeper's vault, its rate and quota each bounded to one value. -/
def offerLine (keeper : String) (rate quota : Nat) : Line :=
  ⟨keepOffer, .vault (vaultId keeper) false, [(rateParam, some [.uint rate]), (quotaParam, some [.uint quota])]⟩

/-- The quota an offer gives: the largest its `keep-offer` lines bound. -/
def Cap.offerQuota (o : Cap) : Nat :=
  (o.grant.filterMap fun l =>
    if l.op == keepOffer then
      match l.bound quotaParam with
      | some [.uint q] => some q
      | _ => none
    else none).foldr max 0

/-- A keep cap's keeper: the vault that holds it. Only a vault keeps. -/
def Cap.keeper (c : Cap) : Option String :=
  match c.holder with
  | .vault k => some k
  | _ => none

/-- A Doc's keepers: the vaults its keep caps name for it. -/
def keepersOf (roles : List Role) (caps : List Cap) (f : Facts) : List String :=
  (caps.filter (·.keeps gov spawned lists roles f)).filterMap (·.keeper)

/-- Every keeper of a Doc is the vault holding one of the caps that keeps it. -/
theorem keepers_by_caps {roles : List Role} {caps : List Cap} {f : Facts} {k : String}
    (h : k ∈ keepersOf gov spawned lists roles caps f) :
    ∃ c ∈ caps, c.holder = .vault k ∧ c.keeps gov spawned lists roles f = true := by
  simp only [keepersOf, List.mem_filterMap, List.mem_filter] at h
  obtain ⟨c, ⟨m, kc⟩, hk⟩ := h
  refine ⟨c, m, ?_, kc⟩
  unfold Cap.keeper at hk
  split at hk <;> simp_all

/-- A keep cap's holder keeps every Doc the cap keeps. -/
theorem holder_keeps {roles : List Role} {caps : List Cap} {c : Cap} {f : Facts} {k : String} (m : c ∈ caps)
    (kc : c.keeps gov spawned lists roles f = true) (held : c.holder = .vault k) :
    k ∈ keepersOf gov spawned lists roles caps f := by
  simp only [keepersOf, List.mem_filterMap, List.mem_filter]
  exact ⟨c, ⟨m, kc⟩, by simp [Cap.keeper, held]⟩

/-- What a keep cap's issuer hands its keeper: the Docs among those it holds, with their facts and first fetch keys,
that the cap keeps, each by its id with its first fetch key. -/
def resolve (roles : List Role) (c : Cap) (held : List (Facts × Nat)) : List (DocId × Nat) :=
  (held.filter fun (f, _) => c.keeps gov spawned lists roles f).map fun (f, k) => (f.id, k)

/-- **The keeper is handed exactly the Docs a keep cap covers** (A22): a Doc is in the list exactly when its issuer
holds it and the cap keeps it. -/
theorem resolve_exact {roles : List Role} {c : Cap} {held : List (Facts × Nat)} {d : DocId} {k : Nat} :
    (d, k) ∈ resolve gov spawned lists roles c held ↔
      ∃ f, (f, k) ∈ held ∧ f.id = d ∧ c.keeps gov spawned lists roles f = true := by
  simp only [resolve, List.mem_map, List.mem_filter, Prod.mk.injEq, Prod.exists]
  constructor
  · rintro ⟨f, k', ⟨m, kf⟩, rfl, rfl⟩
    exact ⟨f, m, rfl, kf⟩
  · rintro ⟨f, m, rfl, kf⟩
    exact ⟨f, k, ⟨m, kf⟩, rfl, rfl⟩

/-- The keep cap a new vault `v` starts with: every Doc of its own, to Maia City's keeper `k`, the Aven Peer acting for
Aven. Its owner approves it as they join (D14, A44): the tree's claim carries it, and a vault migrated from production
approves it at its next sign-in. It may not share, and the vault can withdraw it. No device need sign it: its owner's
approval proves its issuer (A28). -/
def defaultKeep (v k : String) (signer : Option String) (approvals : List Sig) : Cap :=
  { id := "keep-" ++ v, issuer := v, holder := .vault k, signer, approvals,
    grant := [⟨coreOp .keep, .vault (vaultId v) false, []⟩] }

/-- A cap is vault `v`'s default keep cap at keeper `k`: it says exactly what the default says, whatever its id and
signatures. The tree's claim checks the keep cap it carries with this (A44). -/
def Cap.isDefaultKeep (v k : String) (c : Cap) : Bool :=
  c.form == .grant && c.issuer == v && c.holder == .vault k && c.parent == none && c.role == none &&
    c.share == 0 && c.grant == (defaultKeep v k none []).grant && c.conditions == {}

theorem isDefaultKeep_iff {v k : String} {c : Cap} :
    c.isDefaultKeep v k = true ↔ c.form = .grant ∧ c.issuer = v ∧ c.holder = .vault k ∧ c.parent = none ∧
      c.role = none ∧ c.share = 0 ∧ c.grant = [⟨coreOp .keep, .vault (vaultId v) false, []⟩] ∧ c.conditions = {} := by
  simp [Cap.isDefaultKeep, defaultKeep, and_assoc]

/-- A vault with its default keep cap has every Doc of its own kept by Maia City's keeper. -/
theorem default_kept {roles : List Role} {caps : List Cap} {v k : String} {signer : Option String}
    {approvals : List Sig} {f : Facts} (h : defaultKeep v k signer approvals ∈ caps) (own : f.vault = vaultId v) :
    k ∈ keepersOf gov spawned lists roles caps f := by
  simp only [keepersOf, List.mem_filterMap, List.mem_filter]
  exact ⟨_, ⟨h, by simp [Cap.keeps, Cap.grants, defaultKeep, Target.coversB, own]⟩, rfl⟩

/-- **The claim's keep cap keeps the new vault** (A44): any cap that says what the default says has its keeper keep
every Doc of the vault, whoever wrote it out. -/
theorem isDefaultKeep_kept {roles : List Role} {caps : List Cap} {c : Cap} {v k : String} {f : Facts}
    (h : c.isDefaultKeep v k = true) (m : c ∈ caps) (own : f.vault = vaultId v) :
    k ∈ keepersOf gov spawned lists roles caps f := by
  obtain ⟨_, _, ho, _, hr, _, hg, _⟩ := isDefaultKeep_iff.mp h
  simp only [keepersOf, List.mem_filterMap, List.mem_filter]
  exact ⟨c, ⟨m, by simp [Cap.keeps, Cap.grants, hr, hg, Target.coversB, own]⟩, by simp [Cap.keeper, ho]⟩

end

variable {x : Ctx}

/-- Whether a grant keeps anything: one of its lines names `keep`. -/
def Grant.keeps (g : Grant) : Bool := g.any (·.op == coreOp .keep)

/-- A grant within one that keeps nothing keeps nothing: each line lies within one of the other's, with its op. -/
theorem within_keeps {g h : Grant} (w : g.within h = true) (k : g.keeps = true) : h.keeps = true := by
  simp only [Grant.keeps, Grant.within, List.all_eq_true, List.any_eq_true, beq_iff_eq] at w k ⊢
  obtain ⟨l, ml, lk⟩ := k
  obtain ⟨m, mm, lm⟩ := w l ml
  simp only [Line.within, Bool.and_eq_true, beq_iff_eq] at lm
  exact ⟨m, mm, lm.1.1 ▸ lk⟩

theorem links_keep : ∀ {p : Cap} {cs : List Cap}, (linksRules x p cs).all (·.1) = true →
    ∀ c ∈ cs, (c.grants x.roles).keeps = true → (p.grants x.roles).keeps = true
  | _, [], _, _, m => nomatch m
  | p, c :: cs, h, d, m => by
    obtain ⟨l, rest⟩ := linksRules_cons.mp h
    obtain ⟨_, _, _, w, _⟩ := linkRules_ok l
    intro k
    rcases List.mem_cons.mp m with e | m
    · exact within_keeps w (e ▸ k)
    · exact within_keeps w (links_keep rest d m k)

/-- A cap of a valid chain that keeps rests on a root that keeps. -/
theorem keep_from_root {r : Cap} {cs : List Cap} (h : chainOk x (r :: cs) = true) {c : Cap} (m : c ∈ r :: cs)
    (k : (c.grants x.roles).keeps = true) : (r.grants x.roles).keeps = true := by
  rw [chainOk, chainRules, rules_all] at h
  rcases List.mem_cons.mp m with e | m
  · exact e ▸ k
  · exact links_keep h.2 c m k

/-- After a cap that may not share, every link only attenuates: it keeps the holder and shares nothing. -/
theorem links_unshared : ∀ {p : Cap} {cs : List Cap}, (linksRules x p cs).all (·.1) = true → p.share = 0 →
    ∀ c ∈ cs, c.holder = p.holder ∧ c.share = 0
  | _, [], _, _, _, m => nomatch m
  | p, c :: cs, h, z, d, m => by
    obtain ⟨l, rest⟩ := linksRules_cons.mp h
    obtain ⟨_, _, o, _, sh, _⟩ := linkRules_ok l
    have hc : c.holder = p.holder ∧ c.share = 0 := by
      cases kc : c.form
      · simp only [kc, CapForm.hops] at sh
        omega
      · simp only [kc, CapForm.hops] at sh
        exact ⟨o.resolve_left (by simp [kc]), by omega⟩
    rcases List.mem_cons.mp m with e | m
    · exact e ▸ hc
    · obtain ⟨h1, h2⟩ := links_unshared rest hc.2 d m
      exact ⟨h1.trans hc.1, h2⟩

/-- **No keeper passes a vault's data on** (A22): a chain that keeps has one holder, the keeper its root names, and
shares nothing. A keep cap may not share, so every link after its root only attenuates. -/
theorem keep_one_holder {r : Cap} {cs : List Cap} (h : chainOk x (r :: cs) = true)
    (k : ∃ c ∈ r :: cs, (c.grants x.roles).keeps = true) :
    ∀ c ∈ r :: cs, c.holder = r.holder ∧ c.share = 0 := by
  obtain ⟨c, mc, kc⟩ := k
  have kr := keep_from_root h mc kc
  rw [chainOk, chainRules, rules_all] at h
  obtain ⟨_, _, _, caps⟩ := rootRules_ok h.1
  have z : r.share = 0 := by
    simp only [Grant.keeps, List.any_eq_true, beq_iff_eq] at kr
    obtain ⟨l, ml, lk⟩ := kr
    exact (capRules_ok caps).2.2.2.1 l ml lk
  intro c m
  rcases List.mem_cons.mp m with e | m
  · subst e
    exact ⟨rfl, z⟩
  · exact links_unshared h.2 z c m

/-- **The owner decides who keeps** (A22): under a valid chain, a cap keeps a Doc only as the chain's root does, a grant
by a vault with authority over every line, its own vault or one it governs, to that very keeper. No one else extends
it. -/
theorem keeper_named_by_owner (gov : Bytes → Bytes → Bool) (spawned lists : DocId → DocId → Bool) {r : Cap}
    {cs : List Cap} (h : chainOk x (r :: cs) = true) {c : Cap} (m : c ∈ r :: cs) {f : Facts}
    (k : c.keeps gov spawned lists x.roles f = true) :
    c.holder = r.holder ∧ r.keeps gov spawned lists x.roles f = true ∧
      ∀ l ∈ c.grants x.roles, authorityOver x r.issuer l = true := by
  have kk : (c.grants x.roles).keeps = true := by
    simp only [Cap.keeps, Grant.keeps, List.any_eq_true, Bool.and_eq_true] at k ⊢
    obtain ⟨l, ml, lk, _⟩ := k
    exact ⟨l, ml, lk⟩
  refine ⟨(keep_one_holder h ⟨c, m, kk⟩ c m).1, ?_, root_authority h c m⟩
  rw [keeps_iff] at k ⊢
  exact narrow_chain _ _ _ h c m f _ k

/-- **Only an owner places a keeper** (A22): every keeper of a Doc, by keep caps that are valid roots as every
owner-issued one is, is named by one its issuer's owners approved (D14), with a `keep` line covering the Doc in its
issuer's authority: the Doc's own vault, or one that governs it. -/
theorem keepers_by_owner (gov : Bytes → Bytes → Bool) (spawned lists : DocId → DocId → Bool) {caps : List Cap}
    (valid : ∀ c ∈ caps, chainOk x [c] = true) {f : Facts} {k : String}
    (h : k ∈ keepersOf gov spawned lists x.roles caps f) :
    ∃ c ∈ caps, c.holder = .vault k ∧ x.tree.approves x.threshold c.issuer c.id c.approvals = true ∧
      ∃ l ∈ c.grants x.roles, l.op = coreOp .keep ∧ l.doc.coversB gov spawned lists f = true ∧
        authorityOver x c.issuer l = true := by
  obtain ⟨c, m, held, kc⟩ := keepers_by_caps gov spawned lists h
  have ok := valid c m
  have form : c.form = .grant := by
    have r := ok
    rw [chainOk, chainRules, rules_all] at r
    exact (rootRules_ok r.1).2.1
  simp only [Cap.keeps, List.any_eq_true, Bool.and_eq_true, beq_iff_eq] at kc
  obtain ⟨l, ml, lk, lc⟩ := kc
  exact ⟨c, m, held, (grant_approved ok c (List.mem_singleton_self c)).2 form, l, ml, lk, lc,
    root_authority ok c (List.mem_singleton_self c) l ml⟩

/-- A default keep cap holds as a chain only with its owners' approval (D14). -/
theorem default_approved {v k : String} {s : Option String} {a : List Sig}
    (h : chainOk x [defaultKeep v k s a] = true) : x.tree.approves x.threshold v ("keep-" ++ v) a = true :=
  (grant_approved h _ (List.mem_singleton_self _)).2 rfl

/-- **A claim's keep cap needs its vault's owners** (A44, D14): a cap that says what the default says holds as a chain
only with the approval of the vault it keeps, by its own quorum. -/
theorem isDefaultKeep_approved {c : Cap} {v k : String} (h : c.isDefaultKeep v k = true) (ok : chainOk x [c] = true) :
    x.tree.approves x.threshold v c.id c.approvals = true := by
  obtain ⟨hf, hi, _⟩ := isDefaultKeep_iff.mp h
  have a := (grant_approved ok c (List.mem_singleton_self c)).2 hf
  rwa [hi] at a

/-- **The default needs its owner** (A22, D14): a default keep cap is an ordinary grant, however the join collects its
approval. Signed by a device of its vault but with no approval, it breaks `.approval`, every threshold being one or
more. -/
theorem default_needs_owner {v k s : String} (pos : ∀ w, 1 ≤ x.threshold w) (dev : x.tree.actsFor s = some v) :
    chainError x [defaultKeep v k s []] = some (.approval ("keep-" ++ v)) := by
  have none : x.tree.approves x.threshold v ("keep-" ++ v) [] = false := by
    cases h : x.tree.approves x.threshold v ("keep-" ++ v) []
    · rfl
    · obtain ⟨_, _, m⟩ := Tree.approves_signed pos h
      simp at m
  simp [chainError, chainRules, rootRules, capRules, linksRules, defaultKeep, Cap.grants, authorityOver, lineVault,
    anchor, authorityOverVault, Tree.issued, Holder.typed, dev, none]

end Aven.ID

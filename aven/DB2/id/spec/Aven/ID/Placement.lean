import Aven.ID.Caps

/-! # Placement: who keeps a vault's Docs (A22)

A vault decides who keeps its data and who sees it, by its caps (Samuel, 31 Oct 2026): keep caps for keepers, keys and
read caps for readers. A keep cap is a cap like any other, a grant from the vault to a keeper's vault, and its lines
`keep` targets in Core's grammar (A8), so a target may be a query: every Doc of a vault, or of one type. A keeper is
blind, so the issuing vault's devices, which read each Doc's facts, resolve the target to the Doc ids they hand the
keeper, each with its first fetch key: exactly the Docs it covers (`resolve`, `resolve_exact`). What the keeper does
with them is `Aven.ID.Keep`'s. The Values a Doc's Records name, a file's chunks among them, are kept with it.

**The vault's owner always decides where its data goes** (Samuel, 31 Oct 2026). A keep cap may not share, so no keeper
passes data on: a chain that keeps has one holder, the keeper its root names, and every link after the root only
attenuates (`keep_one_holder`). A cap keeps a Doc only as the chain's root does, and the root's issuer has authority
over every line, its own vault or one it governs (`keeper_named_by_owner`). So no one else extends it, not Maia City
adding servers and not a keeper: a new keeper needs a new keep cap from the owner.

**By default** a new vault issues a keep cap for everything of its own to Maia City's keeper, the Aven Peer acting for
Aven (`defaultKeep`, `default_kept`). It is an ordinary grant: it holds only with its owners' approval (D14), however
the join collects it, and without one it breaks `.approval` (`default_approved`, `default_needs_owner`). The vault can
withdraw it or issue others. A vault it governs starts with its own, so withdrawing that one isn't undone from above.
Every keeper of a Doc, by keep caps that are valid roots, is named by one its issuer's owners approved, whose line
covering the Doc lies in its issuer's authority (`keepers_by_owner`).

Coverage is Core's `Target.covers`, computed (`coversB`, `coversB_iff`): who governs whom and which actor spawned which
are functions a device evaluates. -/

namespace Aven.ID

open Aven.Core

section

variable (gov : Bytes → Bytes → Bool) (spawned : DocId → DocId → Bool)

/-- Core's `Target.covers`, computed, with `gov` and `spawned` as a device evaluates them. -/
def coversB : Target → Facts → Bool
  | .doc d, f => f.id == d
  | .vault v b, f => f.vault == v || (b && gov v f.vault)
  | .vaultType v t b, f => f.type == t && (f.vault == v || (b && gov v f.vault))
  | .actor a b, f => f.id == a || (b && spawned a f.id)
  | .vaultDef v d, f => f.vault == v && f.type == d

theorem coversB_iff {t : Target} {f : Facts} :
    coversB gov spawned t f = true ↔ t.covers (fun v w => gov v w = true) (fun a b => spawned a b = true) f := by
  cases t <;> simp [coversB, Target.covers]

/-- A cap keeps the Doc whose genesis fixed `f`: one of its `keep` lines covers it. -/
def Cap.keeps (roles : List Role) (c : Cap) (f : Facts) : Bool :=
  (c.grants roles).any fun l => l.verb == .keep && coversB gov spawned l.target f

theorem keeps_iff {roles : List Role} {c : Cap} {f : Facts} :
    c.keeps gov spawned roles f = true ↔
      (c.grants roles).reaches (fun v w => gov v w = true) (fun a b => spawned a b = true) f .keep := by
  simp only [Cap.keeps, List.any_eq_true, Bool.and_eq_true, beq_iff_eq, coversB_iff, Grant.reaches]

/-- A keep cap's keeper: the vault that holds it. Only a vault keeps. -/
def Cap.keeper (c : Cap) : Option String :=
  match c.holder with
  | .vault k => some k
  | _ => none

/-- A Doc's keepers: the vaults its keep caps name for it. -/
def keepersOf (roles : List Role) (caps : List Cap) (f : Facts) : List String :=
  (caps.filter (·.keeps gov spawned roles f)).filterMap (·.keeper)

/-- Every keeper of a Doc is the vault holding one of the caps that keeps it. -/
theorem keepers_by_caps {roles : List Role} {caps : List Cap} {f : Facts} {k : String}
    (h : k ∈ keepersOf gov spawned roles caps f) :
    ∃ c ∈ caps, c.holder = .vault k ∧ c.keeps gov spawned roles f = true := by
  simp only [keepersOf, List.mem_filterMap, List.mem_filter] at h
  obtain ⟨c, ⟨m, kc⟩, hk⟩ := h
  refine ⟨c, m, ?_, kc⟩
  unfold Cap.keeper at hk
  split at hk <;> simp_all

/-- A keep cap's holder keeps every Doc the cap keeps. -/
theorem holder_keeps {roles : List Role} {caps : List Cap} {c : Cap} {f : Facts} {k : String} (m : c ∈ caps)
    (kc : c.keeps gov spawned roles f = true) (held : c.holder = .vault k) :
    k ∈ keepersOf gov spawned roles caps f := by
  simp only [keepersOf, List.mem_filterMap, List.mem_filter]
  exact ⟨c, ⟨m, kc⟩, by simp [Cap.keeper, held]⟩

/-- What a keep cap's issuer hands its keeper: the Docs among those it holds, with their facts and first fetch keys,
that the cap keeps, each by its id with its first fetch key. -/
def resolve (roles : List Role) (c : Cap) (held : List (Facts × Nat)) : List (DocId × Nat) :=
  (held.filter fun (f, _) => c.keeps gov spawned roles f).map fun (f, k) => (f.id, k)

/-- **The keeper is handed exactly the Docs a keep cap covers** (A22): a Doc is in the list exactly when its issuer
holds it and the cap keeps it. -/
theorem resolve_exact {roles : List Role} {c : Cap} {held : List (Facts × Nat)} {d : DocId} {k : Nat} :
    (d, k) ∈ resolve gov spawned roles c held ↔ ∃ f, (f, k) ∈ held ∧ f.id = d ∧ c.keeps gov spawned roles f = true := by
  simp only [resolve, List.mem_map, List.mem_filter, Prod.mk.injEq, Prod.exists]
  constructor
  · rintro ⟨f, k', ⟨m, kf⟩, rfl, rfl⟩
    exact ⟨f, m, rfl, kf⟩
  · rintro ⟨f, m, rfl, kf⟩
    exact ⟨f, k, ⟨m, kf⟩, rfl, rfl⟩

/-- The keep cap a new vault `v` starts with: every Doc of its own, to Maia City's keeper `k`, the Aven Peer acting for
Aven. Its owner approves it with what they sign to join (D14). It may not share, and the vault can withdraw it. -/
def defaultKeep (v k signer : String) (approvals : List Sig) : Cap :=
  { id := "keep-" ++ v, issuer := v, holder := .vault k, signer, approvals,
    grant := [⟨.vault (vaultId v) false, .keep, []⟩] }

/-- A vault with its default keep cap has every Doc of its own kept by Maia City's keeper. -/
theorem default_kept {roles : List Role} {caps : List Cap} {v k signer : String} {approvals : List Sig} {f : Facts}
    (h : defaultKeep v k signer approvals ∈ caps) (own : f.vault = vaultId v) :
    k ∈ keepersOf gov spawned roles caps f := by
  simp only [keepersOf, List.mem_filterMap, List.mem_filter]
  exact ⟨_, ⟨h, by simp [Cap.keeps, Cap.grants, defaultKeep, coversB, own]⟩, rfl⟩

end

variable {x : Ctx}

/-- A grant within one that keeps nothing keeps nothing: each line lies within one of the other's, with its verb. -/
theorem within_keeps {g h : Grant} (w : g.within h = true) (k : g.any (·.verb == .keep) = true) :
    h.any (·.verb == .keep) = true := by
  simp only [Grant.within, List.all_eq_true, List.any_eq_true, beq_iff_eq] at w k ⊢
  obtain ⟨l, ml, lk⟩ := k
  obtain ⟨m, mm, lm⟩ := w l ml
  simp only [Line.within, Bool.and_eq_true, beq_iff_eq] at lm
  exact ⟨m, mm, lm.1.2 ▸ lk⟩

theorem links_keep : ∀ {p : Cap} {cs : List Cap}, (linksRules x p cs).all (·.1) = true →
    ∀ c ∈ cs, (c.grants x.roles).any (·.verb == .keep) = true → (p.grants x.roles).any (·.verb == .keep) = true
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
    (k : (c.grants x.roles).any (·.verb == .keep) = true) : (r.grants x.roles).any (·.verb == .keep) = true := by
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
      cases kc : c.kind
      · simp only [kc, CapKind.hops] at sh
        omega
      · simp only [kc, CapKind.hops] at sh
        exact ⟨o.resolve_left (by simp [kc]), by omega⟩
    rcases List.mem_cons.mp m with e | m
    · exact e ▸ hc
    · obtain ⟨h1, h2⟩ := links_unshared rest hc.2 d m
      exact ⟨h1.trans hc.1, h2⟩

/-- **No keeper passes a vault's data on** (A22): a chain that keeps has one holder, the keeper its root names, and
shares nothing. A keep cap may not share, so every link after its root only attenuates. -/
theorem keep_one_holder {r : Cap} {cs : List Cap} (h : chainOk x (r :: cs) = true)
    (k : ∃ c ∈ r :: cs, (c.grants x.roles).any (·.verb == .keep) = true) :
    ∀ c ∈ r :: cs, c.holder = r.holder ∧ c.share = 0 := by
  obtain ⟨c, mc, kc⟩ := k
  have kr := keep_from_root h mc kc
  rw [chainOk, chainRules, rules_all] at h
  obtain ⟨_, _, _, caps⟩ := rootRules_ok h.1
  have z : r.share = 0 := by
    simp only [List.any_eq_true, beq_iff_eq] at kr
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
theorem keeper_named_by_owner (gov : Bytes → Bytes → Bool) (spawned : DocId → DocId → Bool) {r : Cap} {cs : List Cap}
    (h : chainOk x (r :: cs) = true) {c : Cap} (m : c ∈ r :: cs) {f : Facts}
    (k : c.keeps gov spawned x.roles f = true) :
    c.holder = r.holder ∧ r.keeps gov spawned x.roles f = true ∧
      ∀ l ∈ c.grants x.roles, authorityOver x r.issuer l = true := by
  have kk : (c.grants x.roles).any (·.verb == .keep) = true := by
    simp only [Cap.keeps, List.any_eq_true, Bool.and_eq_true] at k ⊢
    obtain ⟨l, ml, lk, _⟩ := k
    exact ⟨l, ml, lk⟩
  refine ⟨(keep_one_holder h ⟨c, m, kk⟩ c m).1, ?_, root_authority h c m⟩
  rw [keeps_iff] at k ⊢
  exact narrow_chain _ _ h c m f .keep k

/-- **Only an owner places a keeper** (A22): every keeper of a Doc, by keep caps that are valid roots as every
owner-issued one is, is named by one its issuer's owners approved (D14), with a `keep` line covering the Doc in its
issuer's authority: the Doc's own vault, or one that governs it. -/
theorem keepers_by_owner (gov : Bytes → Bytes → Bool) (spawned : DocId → DocId → Bool) {caps : List Cap}
    (valid : ∀ c ∈ caps, chainOk x [c] = true) {f : Facts} {k : String}
    (h : k ∈ keepersOf gov spawned x.roles caps f) :
    ∃ c ∈ caps, c.holder = .vault k ∧ x.tree.approves x.threshold c.issuer c.id c.approvals = true ∧
      ∃ l ∈ c.grants x.roles, l.verb = .keep ∧ coversB gov spawned l.target f = true ∧
        authorityOver x c.issuer l = true := by
  obtain ⟨c, m, held, kc⟩ := keepers_by_caps gov spawned h
  have ok := valid c m
  have kind : c.kind = .grant := by
    have r := ok
    rw [chainOk, chainRules, rules_all] at r
    exact (rootRules_ok r.1).2.1
  simp only [Cap.keeps, List.any_eq_true, Bool.and_eq_true, beq_iff_eq] at kc
  obtain ⟨l, ml, lk, lc⟩ := kc
  exact ⟨c, m, held, (grant_approved ok c (List.mem_singleton_self c)).2 kind, l, ml, lk, lc,
    root_authority ok c (List.mem_singleton_self c) l ml⟩

/-- A default keep cap holds as a chain only with its owners' approval (D14). -/
theorem default_approved {v k s : String} {a : List Sig} (h : chainOk x [defaultKeep v k s a] = true) :
    x.tree.approves x.threshold v ("keep-" ++ v) a = true :=
  (grant_approved h _ (List.mem_singleton_self _)).2 rfl

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
  simp [chainError, chainRules, rootRules, capRules, linksRules, defaultKeep, Cap.grants, authorityOver, anchor,
    authorityOverVault, dev, none]

end Aven.ID

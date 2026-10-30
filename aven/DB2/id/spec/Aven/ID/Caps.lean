import Aven.ID.Approve

/-! # Caps

A cap is a signed grant from one vault to another: operations on targets, under conditions, resting on a parent or on
its issuer's own authority (`id/caps/README.md`). This module is caps' own part: grants as sets, conditions, holders,
roles and chains. What a grant reaches is `Aven.Core`'s, once it lands: the target grammar, the verbs and the
footprints. Until then an **atom** names the vault whose Docs it concerns and an opaque permission inside it, and a
grant is a list of atoms. One grant lies within another when each of its atoms is one of the other's: the subset check
every link of a chain must pass (rule 3).

A chain is written root first. `chainRules` lists every rule each cap of it must keep, in the order a reader checks
them, so `chainError` names the first one a bad chain breaks, and `chainOk` holds exactly when none is broken. The
theorems: a chain only narrows (`narrow_chain`); every atom it grants lies in its root issuer's authority
(`root_authority`); it is no longer than its root may be shared (`chain_short`); every cap in it carries its issuer's
owners' approval (`grant_approved`, D14); a cap issued from a group's cap lives only while its issuer is in the group
(`child_live`); the public never passes a cap on and may not share (`public_bounded`, D15); and a role is pinned by its
id (`role_pinned`, D6). -/

namespace Aven.ID

/-- What a grant reaches, until `Aven.Core`'s targets, verbs and footprints: the vault whose Docs it concerns, and an
opaque permission inside it. -/
structure Atom where
  vault : String
  what : String
  deriving DecidableEq, Repr

abbrev Grant := List Atom

/-- `g` lies within `h`: each atom of `g` is one of `h`'s. -/
def Grant.within (g h : Grant) : Bool := g.all fun a => decide (a ∈ h)

theorem Grant.within_iff {g h : Grant} : g.within h = true ↔ ∀ a ∈ g, a ∈ h := by
  simp [Grant.within]

theorem Grant.within_refl (g : Grant) : g.within g = true := Grant.within_iff.mpr fun _ m => m

theorem Grant.within_trans {g h k : Grant} (a : g.within h = true) (b : h.within k = true) : g.within k = true :=
  Grant.within_iff.mpr fun x m => Grant.within_iff.mp b x (Grant.within_iff.mp a x m)

/-- Which branches a cap may write: any, main only, proposals only, or one branch by its hash (never main). -/
inductive Branches where
  | any
  | main
  | proposals
  | one (branch : String)
  deriving DecidableEq, Repr

def Branches.within : Branches → Branches → Bool
  | _, .any => true
  | .main, .main => true
  | .proposals, .proposals => true
  | .one _, .proposals => true
  | .one b, .one c => b == c
  | _, _ => false

theorem Branches.within_trans {a b c : Branches} (h : a.within b = true) (k : b.within c = true) :
    a.within c = true := by
  cases a <;> cases b <;> cases c <;> simp_all [Branches.within]

/-- How much history a reader opens: all of it, or only from the grant on. -/
inductive History where
  | all
  | fromNow
  deriving DecidableEq, Repr

def History.within : History → History → Bool
  | _, .all => true
  | .fromNow, .fromNow => true
  | .all, .fromNow => false

theorem History.within_trans {a b c : History} (h : a.within b = true) (k : b.within c = true) :
    a.within c = true := by
  cases a <;> cases b <;> cases c <;> simp_all [History.within]

/-- A bound that may be absent: `atMost c p` when `c` is no looser than `p`, an absent bound being none at all. -/
def atMost : Option Nat → Option Nat → Bool
  | _, none => true
  | some c, some p => decide (c ≤ p)
  | none, some _ => false

theorem atMost_trans {a b c : Option Nat} (h : atMost a b = true) (k : atMost b c = true) : atMost a c = true := by
  cases a <;> cases b <;> cases c <;> simp_all [atMost] <;> omega

/-- A cap's conditions (`id/caps/README.md`, "Conditions"): times as numbers, `approve` the approvals each act under
it needs, `uses` how many acts (counted only where one router or kernel counts them), `own` that it changes only
Records its holder created. -/
structure Conditions where
  notBefore : Nat := 0
  expires : Option Nat := none
  approve : Nat := 0
  uses : Option Nat := none
  own : Bool := false
  branches : Branches := .any
  history : History := .all
  deriving DecidableEq, Repr

/-- `c` is at least as strict as `p` in every condition. -/
def Conditions.narrows (c p : Conditions) : Bool :=
  decide (p.notBefore ≤ c.notBefore) && atMost c.expires p.expires && decide (p.approve ≤ c.approve) &&
    atMost c.uses p.uses && (!p.own || c.own) && c.branches.within p.branches && c.history.within p.history

theorem Conditions.narrows_trans {a b c : Conditions} (h : a.narrows b = true) (k : b.narrows c = true) :
    a.narrows c = true := by
  simp only [Conditions.narrows, Bool.and_eq_true, decide_eq_true_eq] at h k ⊢
  obtain ⟨⟨⟨⟨⟨⟨n1, e1⟩, a1⟩, u1⟩, o1⟩, b1⟩, h1⟩ := h
  obtain ⟨⟨⟨⟨⟨⟨n2, e2⟩, a2⟩, u2⟩, o2⟩, b2⟩, h2⟩ := k
  refine ⟨⟨⟨⟨⟨⟨by omega, atMost_trans e1 e2⟩, by omega⟩, atMost_trans u1 u2⟩, ?_⟩, Branches.within_trans b1 b2⟩,
    History.within_trans h1 h2⟩
  cases ha : a.own <;> cases hb : b.own <;> cases hc : c.own <;> simp_all

/-- Who holds a cap: a vault (devices are vaults), everyone in a group (its Doc), the public (every member of the
network, D15), or a ticket's one-time key until a vault claims it. -/
inductive Holder where
  | vault (id : String)
  | group (doc : String)
  | «public»
  | ticket (key : String)
  deriving DecidableEq, Repr

/-- A role: a named bundle of grants, named by its hash, so it never changes under its holders (D6). -/
structure Role where
  id : String
  name : String
  grant : Grant
  deriving DecidableEq, Repr

/-- A cap. Its id is its hash, once `Aven.Core` names Values; its signature travels beside it, by its issuer's device,
with its issuer's owners' approvals over its id. -/
structure Cap where
  id : String
  issuer : String
  holder : Holder
  parent : Option String := none
  grant : Grant := []
  role : Option String := none
  share : Nat := 0
  conditions : Conditions := {}
  signer : String
  approvals : List Sig := []
  deriving DecidableEq, Repr

/-- What a cap grants: its role's grant, pinned by the role's id, or its own. A role it names but nobody holds grants
nothing. -/
def Cap.grants (roles : List Role) (c : Cap) : Grant :=
  match c.role with
  | none => c.grant
  | some r => ((roles.find? (·.id == r)).map (·.grant)).getD []

/-- A new version of a role is a new id, so it changes nothing a cap naming the old one grants. -/
theorem role_pinned {roles : List Role} {c : Cap} {r : Role} (pinned : ∀ x, c.role = some x → r.id ≠ x) :
    c.grants (r :: roles) = c.grants roles := by
  unfold Cap.grants
  cases h : c.role with
  | none => rfl
  | some x => simp [pinned x h]

/-- What a reader knows when it checks a chain: the tree, how many owners each vault needs (1 today), who is in each
group now, and the roles it holds. -/
structure Ctx where
  tree : Tree
  threshold : String → Nat := fun _ => 1
  inGroup : String → String → Bool := fun _ _ => false
  roles : List Role := []

/-- The first rule a chain breaks. -/
inductive ChainError where
  | empty
  | notRoot (cap : String)
  | authority (cap : String) (atom : Atom)
  | signer (cap : String)
  | approval (cap : String)
  | publicShares (cap : String)
  | parent (cap : String)
  | issuer (cap : String)
  | wider (cap : String)
  | share (cap : String)
  | conditions (cap : String)
  deriving DecidableEq, Repr

/-- `issuer` has authority over `a`: it is `a`'s vault, or governs it. Authority runs down the tree. -/
def authorityOver (t : Tree) (issuer : String) (a : Atom) : Bool :=
  a.vault == issuer || (t.governs issuer).contains a.vault

/-- `issuer` holds `p`: it is `p`'s vault, or in `p`'s group now. The public and tickets pass nothing on. -/
def holds (x : Ctx) (p : Cap) (issuer : String) : Bool :=
  match p.holder with
  | .vault v => v == issuer
  | .group g => x.inGroup g issuer
  | .«public» => false
  | .ticket _ => false

/-- What every cap must keep: a device of its issuer signed it, its issuer's owners approved it (D14), and a public cap
may not share. -/
def capRules (x : Ctx) (c : Cap) : List (Bool × ChainError) :=
  [(x.tree.actsFor c.signer == some c.issuer, .signer c.id),
   (x.tree.approved (x.threshold c.issuer) c.issuer c.id c.approvals, .approval c.id),
   (c.holder != .«public» || c.share == 0, .publicShares c.id)]

/-- A root names no parent, and every atom it grants lies in its issuer's authority. -/
def rootRules (x : Ctx) (r : Cap) : List (Bool × ChainError) :=
  [(r.parent.isNone, .notRoot r.id)] ++
    ((r.grants x.roles).map fun a => (authorityOver x.tree r.issuer a, .authority r.id a)) ++ capRules x r

/-- A link names its parent, is issued by its parent's holder, and narrows it: its grant within, its share depth lower,
its conditions at least as strict. -/
def linkRules (x : Ctx) (p c : Cap) : List (Bool × ChainError) :=
  [(c.parent == some p.id, .parent c.id), (holds x p c.issuer, .issuer c.id),
   ((c.grants x.roles).within (p.grants x.roles), .wider c.id), (decide (c.share + 1 ≤ p.share), .share c.id),
   (c.conditions.narrows p.conditions, .conditions c.id)] ++ capRules x c

def linksRules (x : Ctx) : Cap → List Cap → List (Bool × ChainError)
  | _, [] => []
  | p, c :: cs => linkRules x p c ++ linksRules x c cs

/-- Every rule a chain, root first, must keep, in the order a reader checks them. -/
def chainRules (x : Ctx) : List Cap → List (Bool × ChainError)
  | [] => [(false, .empty)]
  | r :: cs => rootRules x r ++ linksRules x r cs

def chainOk (x : Ctx) (cs : List Cap) : Bool := (chainRules x cs).all (·.1)

/-- The first rule a chain breaks, or none. -/
def chainError (x : Ctx) (cs : List Cap) : Option ChainError :=
  ((chainRules x cs).find? fun r => !r.1).map (·.2)

theorem chainError_none {x : Ctx} {cs : List Cap} : chainError x cs = none ↔ chainOk x cs = true := by
  simp [chainError, chainOk, List.find?_eq_none, List.all_eq_true]

variable {x : Ctx}

theorem rules_all {l m : List (Bool × ChainError)} :
    (l ++ m).all (·.1) = true ↔ l.all (·.1) = true ∧ m.all (·.1) = true := by
  simp only [List.all_append, Bool.and_eq_true]

theorem capRules_ok {c : Cap} (h : (capRules x c).all (·.1) = true) :
    x.tree.actsFor c.signer = some c.issuer ∧ x.tree.approved (x.threshold c.issuer) c.issuer c.id c.approvals = true ∧
      (c.holder = .«public» → c.share = 0) := by
  simp only [capRules, List.all_cons, List.all_nil, Bool.and_true, Bool.and_eq_true, beq_iff_eq, Bool.or_eq_true,
    bne_iff_ne, ne_eq] at h
  obtain ⟨s, a, p⟩ := h
  exact ⟨s, a, fun e => by simp_all⟩

theorem linkRules_ok {p c : Cap} (h : (linkRules x p c).all (·.1) = true) :
    c.parent = some p.id ∧ holds x p c.issuer = true ∧ (c.grants x.roles).within (p.grants x.roles) = true ∧
      c.share + 1 ≤ p.share ∧ c.conditions.narrows p.conditions = true ∧ (capRules x c).all (·.1) = true := by
  rw [linkRules, rules_all] at h
  obtain ⟨h, k⟩ := h
  simp only [List.all_cons, List.all_nil, Bool.and_true, Bool.and_eq_true, beq_iff_eq, decide_eq_true_eq] at h
  obtain ⟨a, b, c', d, e⟩ := h
  exact ⟨a, b, c', d, e, k⟩

theorem rootRules_ok {r : Cap} (h : (rootRules x r).all (·.1) = true) :
    r.parent = none ∧ (∀ a ∈ r.grants x.roles, authorityOver x.tree r.issuer a = true) ∧
      (capRules x r).all (·.1) = true := by
  rw [rootRules, rules_all, rules_all] at h
  obtain ⟨⟨h, m⟩, k⟩ := h
  simp only [List.all_cons, List.all_nil, Bool.and_true, Option.isNone_iff_eq_none] at h
  refine ⟨h, fun a ma => ?_, k⟩
  simp only [List.all_map, List.all_eq_true, Function.comp_apply] at m
  exact m a ma

theorem linksRules_cons {p c : Cap} {cs : List Cap} :
    (linksRules x p (c :: cs)).all (·.1) = true ↔
      (linkRules x p c).all (·.1) = true ∧ (linksRules x c cs).all (·.1) = true := by
  rw [linksRules, rules_all]

/-- Every cap after `p` in a chain lies within `p`. -/
theorem links_narrow : ∀ {p : Cap} {cs : List Cap}, (linksRules x p cs).all (·.1) = true →
    ∀ c ∈ cs, (c.grants x.roles).within (p.grants x.roles) = true
  | _, [], _, _, m => nomatch m
  | p, c :: cs, h, d, m => by
    obtain ⟨l, rest⟩ := linksRules_cons.mp h
    have w := (linkRules_ok l).2.2.1
    rcases List.mem_cons.mp m with e | m
    · exact e ▸ w
    · exact Grant.within_trans (links_narrow rest d m) w

/-- A chain only narrows: every cap in it grants within its root. -/
theorem narrow_chain {r : Cap} {cs : List Cap} (h : chainOk x (r :: cs) = true) :
    ∀ c ∈ r :: cs, (c.grants x.roles).within (r.grants x.roles) = true := by
  rw [chainOk, chainRules, rules_all] at h
  intro c m
  rcases List.mem_cons.mp m with e | m
  · exact e ▸ Grant.within_refl _
  · exact links_narrow h.2 c m

/-- No authority from nowhere: every atom a chain grants lies in its root issuer's authority, its own vault or one it
governs. -/
theorem root_authority {r : Cap} {cs : List Cap} (h : chainOk x (r :: cs) = true) :
    ∀ c ∈ r :: cs, ∀ a ∈ c.grants x.roles, authorityOver x.tree r.issuer a = true := by
  intro c m a ma
  have root := rootRules_ok (rules_all.mp (by simpa [chainOk, chainRules] using h)).1
  exact root.2.1 a (Grant.within_iff.mp (narrow_chain h c m) a ma)

/-- A chain is no longer than its root may be shared: every link lowers the share depth. -/
theorem links_short : ∀ {p : Cap} {cs : List Cap}, (linksRules x p cs).all (·.1) = true → cs.length ≤ p.share
  | _, [], _ => Nat.zero_le _
  | p, c :: cs, h => by
    obtain ⟨l, rest⟩ := linksRules_cons.mp h
    have := links_short rest
    have := (linkRules_ok l).2.2.2.1
    simp only [List.length_cons]
    omega

theorem chain_short {r : Cap} {cs : List Cap} (h : chainOk x (r :: cs) = true) : cs.length ≤ r.share := by
  rw [chainOk, chainRules, rules_all] at h
  exact links_short h.2

theorem links_caps : ∀ {p : Cap} {cs : List Cap}, (linksRules x p cs).all (·.1) = true →
    ∀ c ∈ cs, (capRules x c).all (·.1) = true
  | _, [], _, _, m => nomatch m
  | _, c :: _, h, d, m => by
    obtain ⟨l, rest⟩ := linksRules_cons.mp h
    rcases List.mem_cons.mp m with e | m
    · exact e ▸ (linkRules_ok l).2.2.2.2.2
    · exact links_caps rest d m

/-- Every grant carries its issuer's owners' approval, and a device of its issuer signed it (D14). -/
theorem grant_approved {r : Cap} {cs : List Cap} (h : chainOk x (r :: cs) = true) :
    ∀ c ∈ r :: cs, x.tree.actsFor c.signer = some c.issuer ∧
      x.tree.approved (x.threshold c.issuer) c.issuer c.id c.approvals = true := by
  rw [chainOk, chainRules, rules_all] at h
  intro c m
  rcases List.mem_cons.mp m with e | m
  · exact e ▸ (capRules_ok (rootRules_ok h.1).2.2).imp id (·.1)
  · exact (capRules_ok (links_caps h.2 c m)).imp id (·.1)

/-- A cap issued from a group's cap lives only while its issuer is in the group. -/
theorem child_live {p c : Cap} {g : String} (h : (linkRules x p c).all (·.1) = true) (held : p.holder = .group g) :
    x.inGroup g c.issuer = true := by
  have := (linkRules_ok h).2.1
  simpa [holds, held] using this

/-- The public passes nothing on, and a public cap may not share (D15). -/
theorem public_bounded {p c : Cap} (h : (linkRules x p c).all (·.1) = true) : p.holder ≠ .«public» := by
  intro e
  have := (linkRules_ok h).2.1
  simp [holds, e] at this

theorem public_no_share {r : Cap} {cs : List Cap} (h : chainOk x (r :: cs) = true) :
    ∀ c ∈ r :: cs, c.holder = .«public» → c.share = 0 := by
  rw [chainOk, chainRules, rules_all] at h
  intro c m
  rcases List.mem_cons.mp m with e | m
  · exact e ▸ (capRules_ok (rootRules_ok h.1).2.2).2.2
  · exact (capRules_ok (links_caps h.2 c m)).2.2

end Aven.ID

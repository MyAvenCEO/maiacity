import Aven.ID.Approve
import Aven.ID.Types

/-! # Caps

A cap is a signed grant from one vault to another: ops on Docs, under conditions, resting on a parent or on its
issuer's own authority (`id/caps/README.md`). Caps are built from ops (A32): a **line** names an op by its id
(`Aven.Core.OpId`, the name of its stored form: one of `core/1`'s or a plugin's), the Docs it may act on as a target in
Core's one grammar (A8), and bounds on the op's parameters (`Aven.Core.Bound`); a parameter it doesn't bound is free.
A line names no step: the steps a call writes are its op's lowering, which every reader computes (the engine's
`footprint_steps`), so what an owner approves is the op's name and definition, exactly what it lets the holder do. A
grant is a list of lines. One grant lies within another when each of its lines lies within one of the other's: the
same op, a narrower target (`Target.le`), and every bound at least as tight (`Bound.within`). That is the check every
link of a chain must pass (rule 3).

A chain is written root first. Each link after the root is a **grant**, which passes its parent on to a holder with
its issuer's owners' approval (D14), or an **attenuation**, which narrows its parent for the same holder, as a cap that
travels on in a message narrows per hop (D16). An attenuation grants nothing new, so it needs no approval (A27).
`chainRules` lists every rule each cap of it must keep, in the order a reader checks them, so `chainError` names the
first one a bad chain breaks, and `chainOk` holds exactly when none is broken. The theorems: a chain only narrows, so no
cap in it lets an op reach a Doc, or allows a call, that its root doesn't (`narrow_chain`, `narrow_ops`, through Core's
`Target.le_sound` and `Bound.within_allows`); every line it grants lies in its root issuer's authority
(`root_authority`); it passes its root on no more often than its root may be shared (`chain_short`); every grant in it
carries its issuer's owners' approval (`grant_approved`, D14), so a cap reaches a new holder only by an approved grant
(`new_holder_granted`); an attenuation keeps its parent's holder, a device of that holder signs it, and it lies within
its parent (`attenuate_within`, `attenuate_signed`); every holder in a chain got there by an approved grant in it, so a
chain starts from authority (`holder_granted`); a group that holds a cap is a Doc of avenID's type `group`, itself a
type Doc (`group_typed`, A39); a cap issued from a group's cap lives only while its issuer is in the group
(`child_live`); the public never passes a cap on and may not share (`public_bounded`, D15), nor may a keep cap, so no
keeper passes a vault's data on (A22, `Aven.ID.Keeping`); a grant whose ops write nothing lets no call write
(`no_step_without_write`, A2); and a role is pinned by its id (`role_pinned`, D6). -/

namespace Aven.ID

/-- A vault's id as Core's targets name it: the bytes of `v:` and its name, as Core's vectors write them. -/
def vaultId (v : String) : Core.Bytes := ("v:" ++ v).toUTF8.toList

/-- `core/1`'s op, by its id: the BLAKE3 name of its stored form. -/
def coreOp (o : Core.CoreOp) : Core.OpId := o.id Core.blake3

/-- One line of a grant: an op by its id, the Docs it may act on, and bounds on its parameters. A parameter it doesn't
bound is free. -/
structure Line where
  op : Core.OpId
  doc : Core.Target
  params : List (Core.Bytes × Core.Bound) := []
  deriving DecidableEq, Repr

abbrev Grant := List Line

/-- The bound a line puts on parameter `p`: the first it names for it, else any value. -/
def Line.bound (l : Line) (p : Core.Bytes) : Core.Bound :=
  match l.params.find? (·.1 == p) with
  | some (_, b) => b
  | none => none

/-- A line within another: the same op, a narrower target, and each parameter the other bounds bounded at least as
tightly. -/
def Line.within (l m : Line) : Bool :=
  l.op == m.op && l.doc.le m.doc && m.params.all fun (p, b) => (l.bound p).within b

/-- A line's bounds hold for a call's parameters. -/
def Line.admits (l : Line) (c : Core.Call) : Bool := l.params.all fun (p, b) => b.allows (c.param p)

/-- `g` lies within `h`: each of its lines within one of `h`'s. -/
def Grant.within (g h : Grant) : Bool := g.all fun l => h.any l.within

/-- A grant lets op `o` reach the Doc whose genesis fixed `f`: one of its lines names the op and covers the Doc. Who
governs whom, which actor spawned which and what a collection lists are avenID's, the actors' and the collections'
(`Aven.ID.Collections`), so they are parameters, as in Core. -/
def Grant.reaches (gov : Core.Bytes → Core.Bytes → Prop) (spawned lists : Core.DocId → Core.DocId → Prop) (g : Grant)
    (f : Core.Facts) (o : Core.OpId) : Prop :=
  ∃ l ∈ g, l.op = o ∧ l.doc.covers gov spawned lists f

/-- A grant allows a call on the Doc `f`: one of its lines names the call's op, covers the Doc, and its bounds hold
for the call's parameters. -/
def Grant.allows (gov : Core.Bytes → Core.Bytes → Prop) (spawned lists : Core.DocId → Core.DocId → Prop) (g : Grant)
    (f : Core.Facts) (c : Core.Call) : Prop :=
  ∃ l ∈ g, l.op = c.op ∧ l.doc.covers gov spawned lists f ∧ l.admits c = true

/-- A call a grant allows reaches its Doc by its op. -/
theorem Grant.allows_reaches {gov : Core.Bytes → Core.Bytes → Prop} {spawned lists : Core.DocId → Core.DocId → Prop}
    {g : Grant} {f : Core.Facts} {c : Core.Call} (a : g.allows gov spawned lists f c) :
    g.reaches gov spawned lists f c.op := by
  obtain ⟨l, ml, lo, lc, _⟩ := a
  exact ⟨l, ml, lo, lc⟩

/-- **A grant whose ops write nothing lets a call write nothing** (A2): when every op a grant names lowers to no step,
every call it allows lowers to none, so the verdict's footprint part lets its envelope bring, change or remove no
Record (the engine's `footprint_steps`). `core/1`'s read, tell, keep and share are such ops (`CoreOp.writes`). -/
theorem no_step_without_write {gov : Core.Bytes → Core.Bytes → Prop} {spawned lists : Core.DocId → Core.DocId → Prop}
    {steps : Core.Call → List Core.Step} {g : Grant} (h : ∀ l ∈ g, ∀ c : Core.Call, c.op = l.op → steps c = [])
    {f : Core.Facts} {c : Core.Call} (a : g.allows gov spawned lists f c) : steps c = [] := by
  obtain ⟨l, ml, lo, _⟩ := a
  exact h l ml c lo.symm

/-- A narrower line admits no call the wider one doesn't: every bound the wider one puts, the narrower one keeps. -/
theorem Line.within_admits {l m : Line} {c : Core.Call} (w : l.within m = true) (a : l.admits c = true) :
    m.admits c = true := by
  simp only [Line.within, Bool.and_eq_true, List.all_eq_true] at w
  simp only [Line.admits, List.all_eq_true] at a ⊢
  intro ⟨p, b⟩ mb
  have wb := w.2 (p, b) mb
  simp only [Line.bound] at wb
  split at wb
  · rename_i q b' e
    have hq : (q == p) = true := by simpa using List.find?_some e
    have mq := a (q, b') (List.mem_of_find?_eq_some e)
    rw [beq_iff_eq.mp hq] at mq
    exact Core.Bound.within_allows wb mq
  · cases b with
    | none => rfl
    | some _ => simp [Core.Bound.within] at wb

theorem Grant.within_reaches {gov : Core.Bytes → Core.Bytes → Prop} {spawned lists : Core.DocId → Core.DocId → Prop}
    {g h : Grant} {f : Core.Facts} {o : Core.OpId} (w : g.within h = true) (r : g.reaches gov spawned lists f o) :
    h.reaches gov spawned lists f o := by
  obtain ⟨l, ml, lo, lc⟩ := r
  simp only [Grant.within, List.all_eq_true, List.any_eq_true] at w
  obtain ⟨m, mm, lm⟩ := w l ml
  simp only [Line.within, Bool.and_eq_true, beq_iff_eq] at lm
  exact ⟨m, mm, lm.1.1 ▸ lo, Core.Target.le_sound lm.1.2 lc⟩

theorem Grant.within_allows {gov : Core.Bytes → Core.Bytes → Prop} {spawned lists : Core.DocId → Core.DocId → Prop}
    {g h : Grant} {f : Core.Facts} {c : Core.Call} (w : g.within h = true) (a : g.allows gov spawned lists f c) :
    h.allows gov spawned lists f c := by
  obtain ⟨l, ml, lo, lc, la⟩ := a
  simp only [Grant.within, List.all_eq_true, List.any_eq_true] at w
  obtain ⟨m, mm, lm⟩ := w l ml
  have lm' := lm
  simp only [Line.within, Bool.and_eq_true, beq_iff_eq] at lm'
  exact ⟨m, mm, lm'.1.1 ▸ lo, Core.Target.le_sound lm'.1.2 lc, Line.within_admits lm la⟩

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

/-- Main, as an envelope names its branch. -/
def mainBranch : Core.Bytes := "main".toUTF8.toList

/-- Whether a cap with these branches writes on `branch`: main only on main, proposals on every branch but main, one
branch only on it. -/
def Branches.allows : Branches → Core.Bytes → Bool
  | .any, _ => true
  | .main, b => b == mainBranch
  | .proposals, b => b != mainBranch
  | .one c, b => b == c.toUTF8.toList && b != mainBranch

/-- A narrower cap's branches allow no branch the wider one's don't. -/
theorem Branches.allows_within {a b : Branches} {br : Core.Bytes} (w : a.within b = true) (al : a.allows br = true) :
    b.allows br = true := by
  cases a <;> cases b <;> simp_all [Branches.within, Branches.allows] <;> exact al.1 ▸ al.2

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

theorem Conditions.narrows_branches {c p : Conditions} (h : c.narrows p = true) :
    c.branches.within p.branches = true := by
  simp only [Conditions.narrows, Bool.and_eq_true] at h
  exact h.1.2

theorem Conditions.narrows_trans {a b c : Conditions} (h : a.narrows b = true) (k : b.narrows c = true) :
    a.narrows c = true := by
  simp only [Conditions.narrows, Bool.and_eq_true, decide_eq_true_eq] at h k ⊢
  obtain ⟨⟨⟨⟨⟨⟨n1, e1⟩, a1⟩, u1⟩, o1⟩, b1⟩, h1⟩ := h
  obtain ⟨⟨⟨⟨⟨⟨n2, e2⟩, a2⟩, u2⟩, o2⟩, b2⟩, h2⟩ := k
  refine ⟨⟨⟨⟨⟨⟨by omega, atMost_trans e1 e2⟩, by omega⟩, atMost_trans u1 u2⟩, ?_⟩, Branches.within_trans b1 b2⟩,
    History.within_trans h1 h2⟩
  cases ha : a.own <;> cases hb : b.own <;> cases hc : c.own <;> simp_all

/-- Who holds a cap: a vault (a device is its own vault), everyone in a group of vaults (its Doc, of avenID's type
`group`), or the public (every member of the network, D15). Nothing else holds one: a bearer key, a ticket's one-time
key or a fetch key, proves a condition of a cap and never holds it (rule 15, A42). -/
inductive Holder where
  | vault (id : String)
  | group (doc : Core.DocId)
  | «public»
  deriving DecidableEq, Repr

/-- A role: a named bundle of grants, named by its hash, so it never changes under its holders (D6). -/
structure Role where
  id : String
  name : String
  grant : Grant
  deriving DecidableEq, Repr

/-- A cap's form, what it does: a **grant** starts a chain or passes its parent on to a holder, with its issuer's
owners' approval (D14); an **attenuation** narrows its parent for the same holder, as a cap that travels on in a message
narrows per hop (D16). It grants nothing new, so it needs no approval (A27). ("Kind" is only a vault's, A1.) -/
inductive CapForm where
  | grant
  | attenuate
  deriving DecidableEq, Repr

/-- How many hops a link passes its parent on: a grant one, an attenuation none, since its holder stays. -/
def CapForm.hops : CapForm → Nat
  | .grant => 1
  | .attenuate => 0

/-- A form as a cap's bytes and the vectors write it. -/
def CapForm.name : CapForm → String
  | .grant => "grant"
  | .attenuate => "attenuate"

/-- A cap. Its id is its hash, once `Aven.Core` names Values; its signature travels beside it, by its issuer's device,
with its issuer's owners' approvals over its id. An attenuation carries none. -/
structure Cap where
  id : String
  issuer : String
  holder : Holder
  parent : Option String := none
  form : CapForm := .grant
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
group now, the roles it holds, and what each Doc it knows is, as the Doc's genesis fixes it: its vault and root type. -/
structure Ctx where
  tree : Tree
  threshold : String → Nat := fun _ => 1
  inGroup : Core.DocId → String → Bool := fun _ _ => false
  roles : List Role := []
  facts : Core.DocId → Option Core.Facts := fun _ => none

/-- The first rule a chain breaks. -/
inductive ChainError where
  | empty
  | notRoot (cap : String)
  | authority (cap : String) (line : Line)
  | signer (cap : String)
  | approval (cap : String)
  | publicShares (cap : String)
  | keepShares (cap : String)
  | group (cap : String)
  | parent (cap : String)
  | issuer (cap : String)
  | holder (cap : String)
  | wider (cap : String)
  | share (cap : String)
  | conditions (cap : String)
  deriving DecidableEq, Repr

/-- `issuer` has authority over vault `v`'s Docs: `v` is its own, or one it governs. Authority runs down the tree. -/
def authorityOverVault (t : Tree) (issuer : String) (v : Core.Bytes) : Bool :=
  v == vaultId issuer || (t.governs issuer).any (vaultId · == v)

/-- What a target is anchored to: the vault it names, or the Doc (an actor or a collection is a Doc). -/
def anchor : Core.Target → Core.Bytes ⊕ Core.DocId
  | .vault v _ | .vaultType v _ _ => .inl v
  | .doc d _ => .inr d

/-- A narrower target is anchored where the wider one is. -/
theorem anchor_le {a b : Core.Target} (h : a.le b = true) : anchor a = anchor b := by
  cases a <;> cases b <;> simp_all [Core.Target.le, anchor]

/-- `issuer` has authority over a line: over the vault its target names, or over the vault the Doc, actor or collection
it names belongs to. A Doc the reader doesn't know gives none. -/
def authorityOver (x : Ctx) (issuer : String) (l : Line) : Bool :=
  match anchor l.doc with
  | .inl v => authorityOverVault x.tree issuer v
  | .inr d =>
    match x.facts d with
    | some f => authorityOverVault x.tree issuer f.vault
    | none => false

/-- Authority over the wider line is authority over the narrower one. -/
theorem authority_le {x : Ctx} {i : String} {l m : Line} (le : l.doc.le m.doc = true)
    (h : authorityOver x i m = true) : authorityOver x i l = true := by
  unfold authorityOver at h ⊢
  rw [anchor_le le]
  exact h

/-- `issuer` holds `p`: it is `p`'s vault, or in `p`'s group now. The public passes nothing on. -/
def holds (x : Ctx) (p : Cap) (issuer : String) : Bool :=
  match p.holder with
  | .vault v => v == issuer
  | .group g => x.inGroup g issuer
  | .«public» => false

/-- A holder the reader can type: a group that holds a cap is a Doc of avenID's type `group` (A39). -/
def Holder.typed (x : Ctx) : Holder → Bool
  | .group g => (x.facts g).any (·.type == groupType)
  | _ => true

/-- What every cap must keep: a device of its issuer signed it, its issuer's owners approved it, an owner vault by its
own quorum (D14), unless it only attenuates; a public cap may not share, and nor may a keep cap, so no keeper passes a
vault's data on (A22); and a group that holds it is a group Doc (A39). -/
def capRules (x : Ctx) (c : Cap) : List (Bool × ChainError) :=
  [(x.tree.actsFor c.signer == some c.issuer, .signer c.id),
   (c.form == .attenuate || x.tree.approves x.threshold c.issuer c.id c.approvals, .approval c.id),
   (c.holder != .«public» || c.share == 0, .publicShares c.id),
   (c.share == 0 || (c.grants x.roles).all (·.op != coreOp .keep), .keepShares c.id),
   (c.holder.typed x, .group c.id)]

/-- A root names no parent and is a grant, so a chain starts from authority, and every atom it grants lies in its
issuer's authority. -/
def rootRules (x : Ctx) (r : Cap) : List (Bool × ChainError) :=
  [(r.parent.isNone && r.form == .grant, .notRoot r.id)] ++
    ((r.grants x.roles).map fun l => (authorityOver x r.issuer l, .authority r.id l)) ++ capRules x r

/-- A link names its parent, is issued by a holder of its parent, and narrows it: its grant within, its conditions at
least as strict. A grant passes it on one hop, so its share depth is lower; an attenuation keeps its parent's holder,
and its share depth is no deeper. -/
def linkRules (x : Ctx) (p c : Cap) : List (Bool × ChainError) :=
  [(c.parent == some p.id, .parent c.id), (holds x p c.issuer, .issuer c.id),
   (c.form == .grant || c.holder == p.holder, .holder c.id),
   ((c.grants x.roles).within (p.grants x.roles), .wider c.id),
   (decide (c.share + c.form.hops ≤ p.share), .share c.id), (c.conditions.narrows p.conditions, .conditions c.id)] ++
    capRules x c

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
    x.tree.actsFor c.signer = some c.issuer ∧
      (c.form = .grant → x.tree.approves x.threshold c.issuer c.id c.approvals = true) ∧
      (c.holder = .«public» → c.share = 0) ∧ (∀ l ∈ c.grants x.roles, l.op = coreOp .keep → c.share = 0) ∧
      c.holder.typed x = true := by
  simp only [capRules, List.all_cons, List.all_nil, Bool.and_true, Bool.and_eq_true, beq_iff_eq, Bool.or_eq_true,
    bne_iff_ne, ne_eq, List.all_eq_true] at h
  obtain ⟨s, a, p, k, ty⟩ := h
  exact ⟨s, fun g => a.resolve_left (by simp [g]), fun e => by simp_all, fun l ml lk => k.resolve_right fun n =>
    n l ml lk, ty⟩

theorem linkRules_ok {p c : Cap} (h : (linkRules x p c).all (·.1) = true) :
    c.parent = some p.id ∧ holds x p c.issuer = true ∧ (c.form = .grant ∨ c.holder = p.holder) ∧
      (c.grants x.roles).within (p.grants x.roles) = true ∧ c.share + c.form.hops ≤ p.share ∧
      c.conditions.narrows p.conditions = true ∧ (capRules x c).all (·.1) = true := by
  rw [linkRules, rules_all] at h
  obtain ⟨h, k⟩ := h
  simp only [List.all_cons, List.all_nil, Bool.and_true, Bool.and_eq_true, Bool.or_eq_true, beq_iff_eq,
    decide_eq_true_eq] at h
  obtain ⟨a, b, o, c', d, e⟩ := h
  exact ⟨a, b, o, c', d, e, k⟩

theorem rootRules_ok {r : Cap} (h : (rootRules x r).all (·.1) = true) :
    r.parent = none ∧ r.form = .grant ∧ (∀ l ∈ r.grants x.roles, authorityOver x r.issuer l = true) ∧
      (capRules x r).all (·.1) = true := by
  rw [rootRules, rules_all, rules_all] at h
  obtain ⟨⟨h, m⟩, k⟩ := h
  simp only [List.all_cons, List.all_nil, Bool.and_true, Bool.and_eq_true, Option.isNone_iff_eq_none,
    beq_iff_eq] at h
  refine ⟨h.1, h.2, fun a ma => ?_, k⟩
  simp only [List.all_map, List.all_eq_true, Function.comp_apply] at m
  exact m a ma

theorem linksRules_cons {p c : Cap} {cs : List Cap} :
    (linksRules x p (c :: cs)).all (·.1) = true ↔
      (linkRules x p c).all (·.1) = true ∧ (linksRules x c cs).all (·.1) = true := by
  rw [linksRules, rules_all]

/-- Every cap after `p` in a chain reaches nothing `p` doesn't. -/
theorem links_reach (gov : Core.Bytes → Core.Bytes → Prop) (spawned lists : Core.DocId → Core.DocId → Prop) :
    ∀ {p : Cap} {cs : List Cap}, (linksRules x p cs).all (·.1) = true → ∀ c ∈ cs, ∀ f v,
      (c.grants x.roles).reaches gov spawned lists f v → (p.grants x.roles).reaches gov spawned lists f v
  | _, [], _, _, m => nomatch m
  | p, c :: cs, h, d, m => by
    obtain ⟨l, rest⟩ := linksRules_cons.mp h
    obtain ⟨_, _, _, w, _⟩ := linkRules_ok l
    intro f v r
    rcases List.mem_cons.mp m with e | m
    · exact Grant.within_reaches w (e ▸ r)
    · exact Grant.within_reaches w (links_reach gov spawned lists rest d m f v r)

/-- Every cap after `p` in a chain allows no call `p` doesn't. -/
theorem links_allow (gov : Core.Bytes → Core.Bytes → Prop) (spawned lists : Core.DocId → Core.DocId → Prop) :
    ∀ {p : Cap} {cs : List Cap}, (linksRules x p cs).all (·.1) = true → ∀ c ∈ cs, ∀ f s,
      (c.grants x.roles).allows gov spawned lists f s → (p.grants x.roles).allows gov spawned lists f s
  | _, [], _, _, m => nomatch m
  | p, c :: cs, h, d, m => by
    obtain ⟨l, rest⟩ := linksRules_cons.mp h
    obtain ⟨_, _, _, w, _⟩ := linkRules_ok l
    intro f s a
    rcases List.mem_cons.mp m with e | m
    · exact Grant.within_allows w (e ▸ a)
    · exact Grant.within_allows w (links_allow gov spawned lists rest d m f s a)

/-- A chain only narrows: no cap in it lets an op reach a Doc its root doesn't. -/
theorem narrow_chain (gov : Core.Bytes → Core.Bytes → Prop) (spawned lists : Core.DocId → Core.DocId → Prop) {r : Cap}
    {cs : List Cap} (h : chainOk x (r :: cs) = true) : ∀ c ∈ r :: cs, ∀ f v,
      (c.grants x.roles).reaches gov spawned lists f v → (r.grants x.roles).reaches gov spawned lists f v := by
  rw [chainOk, chainRules, rules_all] at h
  intro c m f v rc
  rcases List.mem_cons.mp m with e | m
  · exact e ▸ rc
  · exact links_reach gov spawned lists h.2 c m f v rc

/-- **And no cap in it allows a call its root doesn't** (A32): the same op, on a Doc the root covers, with parameters
the root's bounds allow. Bounds narrow too. -/
theorem narrow_ops (gov : Core.Bytes → Core.Bytes → Prop) (spawned lists : Core.DocId → Core.DocId → Prop) {r : Cap}
    {cs : List Cap} (h : chainOk x (r :: cs) = true) : ∀ c ∈ r :: cs, ∀ f s,
      (c.grants x.roles).allows gov spawned lists f s → (r.grants x.roles).allows gov spawned lists f s := by
  rw [chainOk, chainRules, rules_all] at h
  intro c m f s a
  rcases List.mem_cons.mp m with e | m
  · exact e ▸ a
  · exact links_allow gov spawned lists h.2 c m f s a

theorem links_authority {i : String} : ∀ {p : Cap} {cs : List Cap},
    (∀ l ∈ p.grants x.roles, authorityOver x i l = true) → (linksRules x p cs).all (·.1) = true →
      ∀ c ∈ cs, ∀ l ∈ c.grants x.roles, authorityOver x i l = true
  | _, [], _, _, _, m => nomatch m
  | p, c :: cs, hp, h, d, m => by
    obtain ⟨lk, rest⟩ := linksRules_cons.mp h
    obtain ⟨_, _, _, w, _⟩ := linkRules_ok lk
    have hc : ∀ l ∈ c.grants x.roles, authorityOver x i l = true := by
      intro l ml
      simp only [Grant.within, List.all_eq_true, List.any_eq_true] at w
      obtain ⟨n, mn, ln⟩ := w l ml
      simp only [Line.within, Bool.and_eq_true] at ln
      exact authority_le ln.1.2 (hp n mn)
    rcases List.mem_cons.mp m with e | m
    · exact e ▸ hc
    · exact links_authority hc rest d m

/-- No authority from nowhere: every line a chain grants lies in its root issuer's authority, its own vault or one it
governs. -/
theorem root_authority {r : Cap} {cs : List Cap} (h : chainOk x (r :: cs) = true) :
    ∀ c ∈ r :: cs, ∀ l ∈ c.grants x.roles, authorityOver x r.issuer l = true := by
  rw [chainOk, chainRules, rules_all] at h
  have root := (rootRules_ok h.1).2.2.1
  intro c m
  rcases List.mem_cons.mp m with e | m
  · exact e ▸ root
  · exact links_authority root h.2 c m

/-- Links pass `p` on no more often than it may be shared: every grant lowers the share depth, and an attenuation, which
keeps its holder, never raises it. -/
theorem links_short : ∀ {p : Cap} {cs : List Cap}, (linksRules x p cs).all (·.1) = true →
    (cs.filter (·.form == .grant)).length ≤ p.share
  | _, [], _ => Nat.zero_le _
  | p, c :: cs, h => by
    obtain ⟨l, rest⟩ := linksRules_cons.mp h
    have := links_short rest
    obtain ⟨_, _, _, _, sh, _⟩ := linkRules_ok l
    cases k : c.form <;> simp only [k, CapForm.hops] at sh <;> simp [k] <;> omega

/-- A chain passes its root on no more often than its root may be shared. -/
theorem chain_short {r : Cap} {cs : List Cap} (h : chainOk x (r :: cs) = true) :
    (cs.filter (·.form == .grant)).length ≤ r.share := by
  rw [chainOk, chainRules, rules_all] at h
  exact links_short h.2

theorem links_caps : ∀ {p : Cap} {cs : List Cap}, (linksRules x p cs).all (·.1) = true →
    ∀ c ∈ cs, (capRules x c).all (·.1) = true
  | _, [], _, _, m => nomatch m
  | _, c :: _, h, d, m => by
    obtain ⟨l, rest⟩ := linksRules_cons.mp h
    rcases List.mem_cons.mp m with e | m
    · exact e ▸ (linkRules_ok l).2.2.2.2.2.2
    · exact links_caps rest d m

/-- A branch the last cap of valid links allows, every cap above it allows: conditions narrow down a chain. -/
theorem links_branch {br : Core.Bytes} : ∀ {p : Cap} {cs : List Cap} {last : Cap},
    (linksRules x p cs).all (·.1) = true → (p :: cs).getLast? = some last → last.conditions.branches.allows br = true →
      ∀ c ∈ p :: cs, c.conditions.branches.allows br = true
  | p, [], last, _, hl, al, c, m => by
    simp only [List.getLast?_singleton, Option.some.injEq] at hl
    simp only [List.mem_cons, List.not_mem_nil, or_false] at m
    subst hl m
    exact al
  | p, c' :: cs, last, h, hl, al, c, m => by
    obtain ⟨lk, rest⟩ := linksRules_cons.mp h
    have ih := links_branch rest (by simpa only [List.getLast?_cons_cons] using hl) al
    rcases List.mem_cons.mp m with e | m
    · exact e ▸ Branches.allows_within (Conditions.narrows_branches (linkRules_ok lk).2.2.2.2.2.1)
        (ih c' (List.mem_cons_self ..))
    · exact ih c m

/-- A device of its issuer signed every cap of a chain, and every grant in it carries its issuer's owners' approval, an
owner vault's by its own quorum (D14). An attenuation grants nothing new and carries none. -/
theorem grant_approved {r : Cap} {cs : List Cap} (h : chainOk x (r :: cs) = true) :
    ∀ c ∈ r :: cs, x.tree.actsFor c.signer = some c.issuer ∧
      (c.form = .grant → x.tree.approves x.threshold c.issuer c.id c.approvals = true) := by
  rw [chainOk, chainRules, rules_all] at h
  intro c m
  rcases List.mem_cons.mp m with e | m
  · exact e ▸ (capRules_ok (rootRules_ok h.1).2.2.2).imp id (·.1)
  · exact (capRules_ok (links_caps h.2 c m)).imp id (·.1)

/-- A cap reaches a new holder only by a grant its issuer's owners approved (D14): an attenuation keeps its parent's
holder. -/
theorem new_holder_granted {p c : Cap} (h : (linkRules x p c).all (·.1) = true) (other : c.holder ≠ p.holder) :
    c.form = .grant ∧ x.tree.approves x.threshold c.issuer c.id c.approvals = true := by
  obtain ⟨_, _, o, _, _, _, k⟩ := linkRules_ok h
  have g := o.resolve_right other
  exact ⟨g, (capRules_ok k).2.1 g⟩

/-- **An attenuation grants nothing new** (A27): it keeps its parent's holder, reaches and allows nothing its parent
doesn't, shares no further, and its conditions are at least as strict: no later expiry, no other branches. -/
theorem attenuate_within (gov : Core.Bytes → Core.Bytes → Prop) (spawned lists : Core.DocId → Core.DocId → Prop)
    {p c : Cap} (h : (linkRules x p c).all (·.1) = true) (att : c.form = .attenuate) :
    c.holder = p.holder ∧
      (∀ f v, (c.grants x.roles).reaches gov spawned lists f v → (p.grants x.roles).reaches gov spawned lists f v) ∧
      (∀ f s, (c.grants x.roles).allows gov spawned lists f s → (p.grants x.roles).allows gov spawned lists f s) ∧
      c.share ≤ p.share ∧ c.conditions.narrows p.conditions = true := by
  obtain ⟨_, _, o, w, sh, n, _⟩ := linkRules_ok h
  rw [att, CapForm.hops, Nat.add_zero] at sh
  exact ⟨o.resolve_left (by simp [att]), fun f v => Grant.within_reaches w, fun f s => Grant.within_allows w, sh, n⟩

/-- A device of its holder signs an attenuation: the signer acts for a vault that holds it, the parent's own vault for a
vault's cap, or a vault in the group now for a group's. -/
theorem attenuate_signed {p c : Cap} (h : (linkRules x p c).all (·.1) = true) (att : c.form = .attenuate) :
    x.tree.actsFor c.signer = some c.issuer ∧ holds x c c.issuer = true := by
  obtain ⟨_, hp, o, _, _, _, k⟩ := linkRules_ok h
  have same : c.holder = p.holder := o.resolve_left (by simp [att])
  refine ⟨(capRules_ok k).1, ?_⟩
  unfold holds at hp ⊢
  rw [same]
  exact hp

/-- An approved grant: the caps that start a chain or pass it to a new holder. -/
def Granted (x : Ctx) (g : Cap) : Prop :=
  g.form = .grant ∧ x.tree.approves x.threshold g.issuer g.id g.approvals = true

theorem links_granted {L : List Cap} : ∀ {p : Cap} {cs : List Cap}, (linksRules x p cs).all (·.1) = true →
    (∀ c ∈ cs, c ∈ L) → (∃ g ∈ L, Granted x g ∧ g.holder = p.holder) →
      ∀ c ∈ cs, ∃ g ∈ L, Granted x g ∧ g.holder = c.holder
  | _, [], _, _, _, _, m => nomatch m
  | p, c :: cs, h, sub, hp, d, m => by
    obtain ⟨lk, rest⟩ := linksRules_cons.mp h
    obtain ⟨_, _, o, _, _, _, k⟩ := linkRules_ok lk
    have hc : ∃ g ∈ L, Granted x g ∧ g.holder = c.holder := by
      cases kc : c.form
      · exact ⟨c, sub c (List.mem_cons_self ..), ⟨kc, (capRules_ok k).2.1 kc⟩, rfl⟩
      · obtain ⟨g, mg, gg, gh⟩ := hp
        exact ⟨g, mg, gg, gh.trans (o.resolve_left (by simp [kc])).symm⟩
    rcases List.mem_cons.mp m with e | m
    · exact e ▸ hc
    · exact links_granted rest (fun c' m' => sub c' (List.mem_cons_of_mem _ m')) hc d m

/-- **A chain starts from authority** (A27, D14): every cap of it is held by a holder an approved grant in it reached.
Its root is one, and an attenuation only follows an approved grant, directly or through other attenuations. -/
theorem holder_granted {r : Cap} {cs : List Cap} (h : chainOk x (r :: cs) = true) :
    ∀ c ∈ r :: cs, ∃ g ∈ r :: cs, Granted x g ∧ g.holder = c.holder := by
  rw [chainOk, chainRules, rules_all] at h
  obtain ⟨_, kr, _, k⟩ := rootRules_ok h.1
  have hr : ∃ g ∈ r :: cs, Granted x g ∧ g.holder = r.holder :=
    ⟨r, List.mem_cons_self .., ⟨kr, (capRules_ok k).2.1 kr⟩, rfl⟩
  intro c m
  rcases List.mem_cons.mp m with e | m
  · exact e ▸ hr
  · exact links_granted h.2 (fun c' m' => List.mem_cons_of_mem _ m') hr c m

/-- A cap issued from a group's cap, a grant or an attenuation, lives only while its issuer is in the group. -/
theorem child_live {p c : Cap} {g : Core.DocId} (h : (linkRules x p c).all (·.1) = true) (held : p.holder = .group g) :
    x.inGroup g c.issuer = true := by
  have := (linkRules_ok h).2.1
  simpa [holds, held] using this

/-- The public passes nothing on, nor narrows it, and a public cap may not share (D15). -/
theorem public_bounded {p c : Cap} (h : (linkRules x p c).all (·.1) = true) : p.holder ≠ .«public» := by
  intro e
  have := (linkRules_ok h).2.1
  simp [holds, e] at this

/-- **A group that holds a cap is a typed Doc** (A39): in a valid chain every group holder is a Doc the reader knows,
of avenID's type `group`, which is a type Doc, its own type the type of types. -/
theorem group_typed {r : Cap} {cs : List Cap} (h : chainOk x (r :: cs) = true) :
    ∀ c ∈ r :: cs, ∀ g, c.holder = .group g →
      ∃ f, x.facts g = some f ∧ f.type = groupType ∧ (builtinFacts groupType).isType Core.blake3 = true := by
  rw [chainOk, chainRules, rules_all] at h
  intro c m g hg
  have caps : (capRules x c).all (·.1) = true := by
    rcases List.mem_cons.mp m with e | m
    · exact e ▸ (rootRules_ok h.1).2.2.2
    · exact links_caps h.2 c m
  have ty := (capRules_ok caps).2.2.2.2
  rw [hg, Holder.typed] at ty
  cases e : x.facts g with
  | none => simp [e] at ty
  | some f =>
    rw [e] at ty
    exact ⟨f, rfl, by simpa using ty, builtin_typed _⟩

theorem public_no_share {r : Cap} {cs : List Cap} (h : chainOk x (r :: cs) = true) :
    ∀ c ∈ r :: cs, c.holder = .«public» → c.share = 0 := by
  rw [chainOk, chainRules, rules_all] at h
  intro c m
  rcases List.mem_cons.mp m with e | m
  · exact e ▸ (capRules_ok (rootRules_ok h.1).2.2.2).2.2.1
  · exact (capRules_ok (links_caps h.2 c m)).2.2.1

end Aven.ID

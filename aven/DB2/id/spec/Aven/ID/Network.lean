import Aven.ID.Caps
import Aven.Core

/-! # The network: the public, tickets and the tree

**The public** (D15) is every member of the invite-only network, and nobody outside it. A public cap's writes count only
from a member (`public_member`), and a member's removal ends them at once: the members group's next epoch is sealed to
the members that remain (`removal_rotates`).

**Tickets** (A12, decided 30 Oct 2026): a ticket is claimed once, by the claim with the smallest hash, so every peer
agrees whatever order the claims reach it in (`ticket_once`). The hash is compared as a number: `Aven.Core`'s 32 bytes,
read big-endian (`hashNum`).

**The tree is a Doc of signed statements** (A10 to A13, PEERS.md §5). Every statement names the tips it saw, so "in the
past of" is decidable (`InPast`, decided by `inPast`, `inPast_iff`). `settle` is a function of the set of statements:
1. a statement counts when it passes its own checks and descends from the pinned genesis, which the claimant's passkey
   and MaiaCityGuardian both signed;
2. a withdrawal wins over every claim of its ticket not in its past;
3. a claim is final once an admin key's ack names it and has it in its past, and a withdrawal never wins over a final
   claim. An admin device acks only the claim that stands in its own view;
4. of a ticket's claims, a final one wins over the rest, and among final ones, or among the rest when none is, the
   smallest hash. Two final claims of one ticket can only come from acks that didn't see each other: the ticket is
   `contested`;
5. a list's remove wins over every add that hadn't seen it;
6. the door admits the member vaults' devices (K12).

The theorems:
- `settle_perm`: peers holding the same statements, in any order, settle the same tree;
- `settle_ticket_once`: a ticket founds at most one vault;
- `settle_withdrawn`: a withdrawal leaves no claim of its ticket standing that isn't final and wasn't in its past;
- `settle_final`: a final claim stays final whatever is added, and stands unless another claim of its ticket with a
  smaller hash is made final, which only an ack that never saw the first can do;
- `settle_door`: the door admits exactly the devices of the member vaults, so it is a function of the tree alone;
- `settle_genesis`: nothing outside the pinned genesis's descendants changes the tree;
- `genesis_pinned`: everything in the tree descends from the pinned genesis, signed by its claimant's passkey and
  MaiaCityGuardian (A11);
- `guardian_consented`: a claim counts only if it names the genesis's guardian (A13);
- `settle_listed`: a list's entry stands only through an add that saw every remove of it.

`settle_restore`, production's ref order, and `trees.json` are avenPEER's (PEERS.md, Thread A). -/

namespace Aven.ID

/-- A write under `c` from `writer`'s vault counts only if `c` isn't public or the writer is a member. -/
def publicWriter (member : String → Bool) (c : Cap) (writer : String) : Bool :=
  c.holder != .«public» || member writer

theorem public_member {member : String → Bool} {c : Cap} {writer : String} (h : publicWriter member c writer = true)
    (p : c.holder = .«public») : member writer = true := by
  simpa [publicWriter, p] using h

/-- The network's members after a removal, and what the members group's next epoch is sealed to. -/
def removeMember (members : List String) (removed : String) : List String := members.filter (· != removed)

/-- A removed member is in no epoch of the members group made after the removal. -/
theorem removal_rotates {members : List String} {removed : String} : removed ∉ removeMember members removed := by
  simp [removeMember]

/-- A claim of a ticket: who claims it, and the claim's hash as a number. -/
structure TicketClaim where
  claimant : String
  hash : Nat
  deriving DecidableEq, Repr

/-- The claim that wins a ticket: the one with the smallest hash. -/
def winner : List TicketClaim → Option TicketClaim
  | [] => none
  | c :: cs =>
    match winner cs with
    | none => some c
    | some w => if c.hash ≤ w.hash then some c else some w

theorem winner_none : ∀ {cs : List TicketClaim}, winner cs = none → cs = []
  | [], _ => rfl
  | c :: cs, h => by
    simp only [winner] at h
    split at h <;> (try split at h) <;> contradiction

/-- The winner is one of the claims, and no claim's hash is smaller. -/
theorem winner_min :
    ∀ {cs : List TicketClaim} {w : TicketClaim}, winner cs = some w → w ∈ cs ∧ ∀ c ∈ cs, w.hash ≤ c.hash
  | [], _, h => nomatch h
  | c :: cs, w, h => by
    simp only [winner] at h
    split at h
    · rename_i n
      cases h
      have e := winner_none n
      subst e
      exact ⟨List.mem_singleton.mpr rfl, fun x m => by simp_all⟩
    · rename_i w' s
      have ⟨wm, wmin⟩ := winner_min s
      split at h
      · rename_i le
        cases h
        refine ⟨List.mem_cons_self, fun x m => ?_⟩
        rcases List.mem_cons.mp m with e | m
        · exact e ▸ Nat.le_refl _
        · exact Nat.le_trans le (wmin x m)
      · rename_i lt
        cases h
        refine ⟨List.mem_cons_of_mem _ wm, fun x m => ?_⟩
        rcases List.mem_cons.mp m with e | m
        · subst e; omega
        · exact wmin x m

/-- A ticket is claimed once: peers holding the same claims, in any order, agree on the winning hash, and on the claim
when hashes differ. -/
theorem ticket_once {cs ds : List TicketClaim} {w v : TicketClaim} (same : ∀ c, c ∈ cs ↔ c ∈ ds)
    (hw : winner cs = some w) (hv : winner ds = some v) : w.hash = v.hash := by
  have ⟨wm, wmin⟩ := winner_min hw
  have ⟨vm, vmin⟩ := winner_min hv
  exact Nat.le_antisymm (wmin v ((same v).mpr vm)) (vmin w ((same w).mp wm))

theorem ticket_once_claim {cs ds : List TicketClaim} {w v : TicketClaim} (same : ∀ c, c ∈ cs ↔ c ∈ ds)
    (distinct : ∀ a ∈ cs, ∀ b ∈ cs, a.hash = b.hash → a = b) (hw : winner cs = some w) (hv : winner ds = some v) :
    w = v :=
  distinct w (winner_min hw).1 v ((same v).mpr (winner_min hv).1) (ticket_once same hw hv)

/-! ## The tree as a Doc of signed statements

A10 to A13, decided on 30 Oct 2026 (PEERS.md, §5). Every statement names the tips it saw, so "in the past of" is
decidable and no order is an input: `settle` is a function of the set of statements. -/

/-- A hash as `settle` compares it: `Aven.Core`'s 32 bytes, read big-endian. -/
def hashNum (h : Aven.Core.Hash) : Nat := h.bytes.foldl (fun n b => n * 256 + b.toNat) 0

/-- MaiaCityGuardian's hybrid keys, named in the genesis and in every claim (A13). -/
structure GuardianKeys where
  ed25519 : String
  mlDsa : String
  xWing : String
  deriving DecidableEq, Repr

/-- The network's first statement (A11): the RP ID and origins, the claimant's vault with its passkey and first
devices, the admin coop it governs, the agent, the Aven Peer's device key, the guardian, and the keys whose signatures
it carries. -/
structure Genesis where
  rpId : String
  origins : List String
  claimant : String
  passkey : String
  devices : List String
  coop : String
  agent : String
  avenPeer : String
  guardian : GuardianKeys
  signedBy : List String
  deriving DecidableEq, Repr

/-- The claimant's passkey and MaiaCityGuardian's hybrid keys both signed it. -/
def Genesis.consented (g : Genesis) : Bool :=
  g.signedBy.contains g.passkey && g.signedBy.contains g.guardian.ed25519 && g.signedBy.contains g.guardian.mlDsa

/-- What a tree statement says. -/
inductive TreeSays where
  | genesis (g : Genesis)
  /-- A device joins `vault`, signed by the vault's passkey. -/
  | signIn (vault device : String)
  /-- A ticket (an invite) with its one-time key, signed by an admin key. -/
  | ticket (key : String)
  /-- Ticket `ticket` (the ticket statement's name) withdrawn, by an admin key. -/
  | withdrawal (ticket : Nat)
  /-- A claim of a ticket, signed by its one-time key: it founds `vault` with its passkey and first device, and names
  the guardian it consents to. -/
  | claim (ticket : Nat) (vault passkey device : String) (guardian : GuardianKeys)
  /-- An admin device acks the claim it names, which makes it final. -/
  | ack (claim : Nat)
  | relayAdd (device : String)
  | relayRemove (device : String)
  | keeperAdd (device : String)
  | keeperRemove (device : String)
  deriving DecidableEq, Repr

/-- A tree statement: its name (its hash, `hashNum`), the key that signed it, the names of the tree's newest
statements it saw, and what it says. -/
structure TreeStatement where
  name : Nat
  signer : String
  tips : List Nat
  says : TreeSays
  deriving DecidableEq, Repr

/-- The ticket a claim claims. -/
def TreeStatement.ticketOf (s : TreeStatement) : Option Nat :=
  match s.says with
  | .claim t .. => some t
  | _ => none

/-- The tree `settle` gives: which statements count, which claims are final and which stand, the member vaults, the
devices the door admits, and the relay and keeper lists. -/
structure Settled where
  counted : Nat → Bool
  final : Nat → Bool
  standing : Nat → Bool
  /-- Tickets with two final claims: two admin devices acked different claims without seeing each other. -/
  contested : Nat → Bool
  member : String → Bool
  admits : String → Bool
  relay : String → Bool
  keeper : String → Bool

namespace Settle

/-! ### The past -/

/-- `b` is in `a`'s past among `S`: `a` names it as a tip, or names something whose past holds it. -/
inductive InPast (S : List TreeStatement) (a : TreeStatement) : TreeStatement → Prop
  | tip {b : TreeStatement} : b ∈ S → b.name ∈ a.tips → InPast S a b
  | step {b c : TreeStatement} : InPast S a b → c ∈ S → c.name ∈ b.tips → InPast S a c

variable {S S' : List TreeStatement} {a b c : TreeStatement}

theorem InPast.mem (h : InPast S a b) : b ∈ S := by
  cases h with
  | tip m _ => exact m
  | step _ m _ => exact m

theorem InPast.trans (h₁ : InPast S a b) (h₂ : InPast S b c) : InPast S a c := by
  induction h₂ with
  | tip m t => exact .step h₁ m t
  | step _ m t ih => exact .step ih m t

theorem InPast.mono (hs : ∀ x ∈ S, x ∈ S') (h : InPast S a b) : InPast S' a b := by
  induction h with
  | tip m t => exact .tip (hs _ m) t
  | step _ m t ih => exact .step ih (hs _ m) t

/-- Another statement of `S` with the same name is in the past too. -/
theorem InPast.rename (h : InPast S a b) (m : c ∈ S) (n : c.name = b.name) : InPast S a c := by
  cases h with
  | tip _ t => exact .tip m (n ▸ t)
  | step h' _ t => exact .step h' m (n ▸ t)

/-- Each name once, the first time it comes. -/
def dedup : List Nat → List Nat
  | [] => []
  | x :: xs => if (dedup xs).contains x then dedup xs else x :: dedup xs

theorem mem_dedup {x : Nat} : ∀ {l : List Nat}, x ∈ dedup l ↔ x ∈ l
  | [] => by simp [dedup]
  | y :: ys => by
    simp only [dedup]
    split
    · rename_i h
      simp only [List.contains_iff_mem, mem_dedup] at h
      simp only [mem_dedup, List.mem_cons]
      constructor
      · exact .inr
      · rintro (rfl | m)
        · exact h
        · exact m
    · simp [mem_dedup]

theorem nodup_dedup : ∀ (l : List Nat), (dedup l).Nodup
  | [] => by simp [dedup]
  | y :: ys => by
    simp only [dedup]
    split
    · exact nodup_dedup ys
    · rename_i h
      simp only [List.contains_iff_mem] at h
      refine List.nodup_cons.mpr ⟨?_, nodup_dedup ys⟩
      intro m
      simp_all

/-- The names one round adds: of statements of `S` not yet known, named as a tip by one already known. -/
def fresh (S : List TreeStatement) (K : List Nat) : List Nat :=
  dedup ((S.filter fun c => !K.contains c.name && S.any fun b => K.contains b.name && b.tips.contains c.name).map
    (·.name))

/-- The names in `a`'s past among `S` after `n + 1` rounds. -/
def pastNames (S : List TreeStatement) (a : TreeStatement) : Nat → List Nat
  | 0 => dedup ((S.filter fun b => a.tips.contains b.name).map (·.name))
  | n + 1 => pastNames S a n ++ fresh S (pastNames S a n)

/-- `b` is in `a`'s past among `S`, decided: `S` has `b`, and as many rounds as `S` has statements find its name. -/
def inPast (S : List TreeStatement) (a b : TreeStatement) : Bool :=
  S.contains b && (pastNames S a (S.length + 1)).contains b.name

theorem pastNames_mono {n m : Nat} {x : Nat} (le : n ≤ m) (h : x ∈ pastNames S a n) : x ∈ pastNames S a m := by
  induction le with
  | refl => exact h
  | step _ ih => exact List.mem_append_left _ ih

theorem pastNames_sub : ∀ {n : Nat} {x : Nat}, x ∈ pastNames S a n → x ∈ S.map (·.name)
  | 0, x, h => by
    simp only [pastNames, mem_dedup, List.mem_map, List.mem_filter] at h ⊢
    obtain ⟨b, ⟨m, _⟩, e⟩ := h
    exact ⟨b, m, e⟩
  | n + 1, x, h => by
    simp only [pastNames, List.mem_append] at h
    rcases h with h | h
    · exact pastNames_sub h
    · simp only [fresh, mem_dedup, List.mem_map, List.mem_filter] at h ⊢
      obtain ⟨c, ⟨m, _⟩, e⟩ := h
      exact ⟨c, m, e⟩

theorem pastNames_nodup : ∀ (n : Nat), (pastNames S a n).Nodup
  | 0 => nodup_dedup _
  | n + 1 => by
    simp only [pastNames]
    refine List.nodup_append.mpr ⟨pastNames_nodup n, nodup_dedup _, ?_⟩
    intro x hx y hy e
    subst e
    simp only [fresh, mem_dedup, List.mem_map, List.mem_filter, Bool.and_eq_true, Bool.not_eq_true'] at hy
    obtain ⟨c, ⟨_, ⟨nk, _⟩⟩, rfl⟩ := hy
    rw [List.contains_iff_mem.mpr hx] at nk
    cases nk

/-- Every name found is the name of a statement of `S` in `a`'s past. -/
theorem pastNames_sound : ∀ {n : Nat} {x : Nat}, x ∈ pastNames S a n → ∃ b ∈ S, b.name = x ∧ InPast S a b
  | 0, x, h => by
    simp only [pastNames, mem_dedup, List.mem_map, List.mem_filter, List.contains_iff_mem] at h
    obtain ⟨b, ⟨m, t⟩, e⟩ := h
    exact ⟨b, m, e, .tip m t⟩
  | n + 1, x, h => by
    simp only [pastNames, List.mem_append] at h
    rcases h with h | h
    · exact pastNames_sound h
    · simp only [fresh, mem_dedup, List.mem_map, List.mem_filter, Bool.and_eq_true, List.any_eq_true,
        List.contains_iff_mem] at h
      obtain ⟨c, ⟨mc, ⟨_, ⟨b, mb, kb, tb⟩⟩⟩, rfl⟩ := h
      obtain ⟨b', mb', e, pb'⟩ := pastNames_sound kb
      exact ⟨c, mc, rfl, .step (pb'.rename mb e.symm) mc tb⟩

/-- Once a round adds nothing, everything in `a`'s past has been found. -/
theorem pastNames_closed {j : Nat} (hj : fresh S (pastNames S a j) = []) (h : InPast S a b) :
    b.name ∈ pastNames S a j := by
  induction h with
  | tip m t =>
    refine pastNames_mono (Nat.zero_le j) ?_
    simp only [pastNames, mem_dedup, List.mem_map, List.mem_filter, List.contains_iff_mem]
    exact ⟨_, ⟨m, t⟩, rfl⟩
  | @step b c hb m t ih =>
    apply Classical.byContradiction
    intro nk
    have : c.name ∈ fresh S (pastNames S a j) := by
      simp only [fresh, mem_dedup, List.mem_map, List.mem_filter, Bool.and_eq_true, List.any_eq_true,
        List.contains_iff_mem, Bool.not_eq_true']
      refine ⟨c, ⟨m, ⟨?_, ⟨b, hb.mem, ih, t⟩⟩⟩, rfl⟩
      simpa using nk
    rw [hj] at this
    exact absurd this (by simp)

/-- Each round that adds a name makes the list longer, and the list is never longer than `S`. -/
theorem pastNames_grows : ∀ (m : Nat), (∀ j < m, fresh S (pastNames S a j) ≠ []) → m ≤ (pastNames S a m).length
  | 0, _ => Nat.zero_le _
  | m + 1, h => by
    have ih := pastNames_grows m fun j hj => h j (by omega)
    have ne := h m (by omega)
    simp only [pastNames, List.length_append]
    have : 0 < (fresh S (pastNames S a m)).length := List.length_pos_iff.mpr ne
    omega

theorem pastNames_short (n : Nat) : (pastNames S a n).length ≤ S.length := by
  have := (pastNames_nodup (S := S) (a := a) n).length_le_of_subset fun x m => pastNames_sub m
  simpa using this

/-- `inPast` decides `InPast`. -/
theorem inPast_iff : inPast S a b = true ↔ InPast S a b := by
  simp only [inPast, Bool.and_eq_true, List.contains_iff_mem]
  constructor
  · rintro ⟨m, k⟩
    obtain ⟨b', _, e, p⟩ := pastNames_sound k
    exact p.rename m e.symm
  · intro h
    refine ⟨h.mem, ?_⟩
    have : ∃ j, j ≤ S.length ∧ fresh S (pastNames S a j) = [] := by
      apply Classical.byContradiction
      intro no
      have g := pastNames_grows (S := S) (a := a) (S.length + 1) fun j hj e => no ⟨j, by omega, e⟩
      have := pastNames_short (S := S) (a := a) (S.length + 1)
      omega
    obtain ⟨j, le, hj⟩ := this
    exact pastNames_mono (by omega) (pastNames_closed hj h)

theorem inPast_set (h : ∀ x, x ∈ S ↔ x ∈ S') : inPast S = inPast S' := by
  funext a b
  apply Bool.eq_iff_iff.mpr
  rw [inPast_iff, inPast_iff]
  exact ⟨InPast.mono fun x m => (h x).mp m, InPast.mono fun x m => (h x).mpr m⟩

theorem any_set {l l' : List TreeStatement} (h : ∀ x, x ∈ l ↔ x ∈ l') (p : TreeStatement → Bool) :
    l.any p = l'.any p := by
  apply Bool.eq_iff_iff.mpr
  simp only [List.any_eq_true, h]

theorem all_set {l l' : List TreeStatement} (h : ∀ x, x ∈ l ↔ x ∈ l') (p : TreeStatement → Bool) :
    l.all p = l'.all p := by
  apply Bool.eq_iff_iff.mpr
  simp only [List.all_eq_true, h]

/-! ### What counts -/

variable (ok : TreeStatement → Bool) (pinned : Nat)

/-- The pinned genesis: its name is the pinned one, it passes its own checks, and both its signers are there. -/
def pinnedGenesis (g : TreeStatement) : Bool :=
  g.name == pinned && ok g &&
    match g.says with
    | .genesis gen => gen.consented
    | _ => false

/-- A descendant of the pinned genesis among `S`: the genesis, or a statement with it in its past. -/
def Desc (S : List TreeStatement) (s : TreeStatement) : Prop :=
  pinnedGenesis ok pinned s = true ∨ ∃ g ∈ S, pinnedGenesis ok pinned g = true ∧ InPast S s g

/-- Part of the tree: it passes its own checks and descends from the pinned genesis. -/
def counted (S : List TreeStatement) (s : TreeStatement) : Bool :=
  ok s && (pinnedGenesis ok pinned s || S.any fun g => pinnedGenesis ok pinned g && inPast S s g)

theorem counted_iff : counted ok pinned S s = true ↔ ok s = true ∧ Desc ok pinned S s := by
  simp only [counted, Desc, Bool.and_eq_true, Bool.or_eq_true, List.any_eq_true, inPast_iff]

/-- What the rest of `settle` reads: the pinned name, the counted statements, and the past between them. -/
structure View where
  pinned : Nat
  any : (TreeStatement → Bool) → Bool
  all : (TreeStatement → Bool) → Bool
  past : TreeStatement → TreeStatement → Bool

/-- Each statement of `C` with the names in its past among `S`, worked out once. -/
def pastTable (S C : List TreeStatement) : List (TreeStatement × List Nat) :=
  C.map fun x => (x, pastNames S x (S.length + 1))

/-- A statement's row of a table, if it has one. -/
def row (T : List (TreeStatement × List Nat)) (a : TreeStatement) : Option (List Nat) :=
  (T.find? (·.1 == a)).map (·.2)

/-- The counted statements once, and each one's past once: a reader holds the past between them. -/
def view (S : List TreeStatement) : View :=
  let C := S.filter (counted ok pinned S)
  let T := pastTable S C
  { pinned := pinned
    any := C.any
    all := C.all
    past := fun a b => C.contains b && ((row T a).map (·.contains b.name)).getD false }

/-! ### The settle rule -/

/-- The pinned genesis says `P`. -/
def gen (v : View) (P : Genesis → Bool) : Bool :=
  v.any fun g => g.name == v.pinned &&
    match g.says with
    | .genesis gen => gen.consented && P gen
    | _ => false

/-- An admin key: the claimant's passkey, its first devices, or a device that passkey signed in to its vault. -/
def admin (v : View) (k : String) : Bool :=
  gen v (fun g => k == g.passkey || g.devices.contains k) ||
    v.any fun s =>
      match s.says with
      | .signIn vault d => d == k && gen v (fun g => vault == g.claimant && s.signer == g.passkey)
      | _ => false

/-- A claim that counts: its ticket was issued by an admin key, is in its past and has the one-time key that signed
the claim, and it names the genesis's guardian (A13). -/
def claimOk (v : View) (c : TreeStatement) : Bool :=
  match c.says with
  | .claim t _ _ _ guardian =>
    (v.any fun s => s.name == t && admin v s.signer && s.says == .ticket c.signer && v.past c s) &&
      gen v (fun g => g.guardian == guardian)
  | _ => false

/-- Two claims of one ticket. -/
def sameTicket (c d : TreeStatement) : Bool := c.ticketOf.isSome && c.ticketOf == d.ticketOf

/-- A claim is final once an admin key's ack that names it has it in its past. -/
def final (v : View) (c : TreeStatement) : Bool :=
  claimOk v c && v.any fun a => admin v a.signer && a.says == .ack c.name && v.past a c

/-- `w` wins over claim `c`: an admin key's withdrawal of its ticket that didn't have it in its past. -/
def beats (v : View) (w c : TreeStatement) : Bool :=
  match c.ticketOf with
  | some t => admin v w.signer && w.says == .withdrawal t && !v.past w c
  | none => false

/-- A claim stands: of its ticket's final claims the one with the smallest hash; if none is final, of the claims no
withdrawal wins over, the one with the smallest hash. -/
def standing (v : View) (c : TreeStatement) : Bool :=
  claimOk v c &&
    if v.any (fun f => final v f && sameTicket f c) then
      final v c && v.all fun f => !(final v f && sameTicket f c) || decide (c.name ≤ f.name)
    else
      !(v.any fun w => beats v w c) &&
        v.all fun d => !(claimOk v d && sameTicket d c && !(v.any fun w => beats v w d)) || decide (c.name ≤ d.name)

/-- A member vault: the claimant's, the admin coop, the agent, and every vault a standing claim founds. -/
def member (v : View) (vault : String) : Bool :=
  gen v (fun g => vault == g.claimant || vault == g.coop || vault == g.agent) ||
    v.any fun c =>
      standing v c &&
        match c.says with
        | .claim _ founded _ _ _ => founded == vault
        | _ => false

/-- `p` is `vault`'s passkey: the claimant's, or the one a standing claim names. -/
def passkeyOf (v : View) (vault p : String) : Bool :=
  gen v (fun g => vault == g.claimant && p == g.passkey) ||
    v.any fun c =>
      standing v c &&
        match c.says with
        | .claim _ founded pk _ _ => founded == vault && pk == p
        | _ => false

/-- `d` is a device of `vault`: the claimant's first devices, the agent's Aven Peer, a standing claim's first device,
or a device the vault's passkey signed in. -/
def deviceOf (v : View) (vault d : String) : Bool :=
  gen v (fun g => (vault == g.claimant && g.devices.contains d) || (vault == g.agent && d == g.avenPeer)) ||
    (v.any fun c =>
      standing v c &&
        match c.says with
        | .claim _ founded _ dev _ => founded == vault && dev == d
        | _ => false) ||
    v.any fun s =>
      match s.says with
      | .signIn signed dev => signed == vault && dev == d && passkeyOf v vault s.signer
      | _ => false

/-- The door admits the devices of the member vaults (K12). -/
def admits (v : View) (d : String) : Bool :=
  gen v (fun g => g.devices.contains d || d == g.avenPeer) ||
    (v.any fun c =>
      standing v c &&
        match c.says with
        | .claim _ _ _ dev _ => dev == d
        | _ => false) ||
    v.any fun s =>
      match s.says with
      | .signIn vault dev => dev == d && passkeyOf v vault s.signer
      | _ => false

/-- A list's entry stands while an admin key's add of it has every admin key's remove of it in its past: a remove wins
over every add that hadn't seen it, the ones it saw and the ones made at the same time, and an add made after it
stands again. -/
def listed (v : View) (add remove : String → TreeSays) (d : String) : Bool :=
  v.any fun a => admin v a.signer && a.says == add d &&
    !(v.any fun r => admin v r.signer && r.says == remove d && !v.past a r)

/-! ### Reading the view -/

theorem view_any {p : TreeStatement → Bool} :
    (view ok pinned S).any p = true ↔ ∃ x ∈ S, counted ok pinned S x = true ∧ p x = true := by
  simp only [view, List.any_eq_true, List.mem_filter, and_assoc]

theorem view_all_iff {p : TreeStatement → Bool} :
    (view ok pinned S).all p = true ↔ ∀ x ∈ S, counted ok pinned S x = true → p x = true := by
  simp only [view, List.all_eq_true, List.mem_filter, and_imp]

theorem view_all {p : TreeStatement → Bool} (h : (view ok pinned S).all p = true) {x : TreeStatement} (m : x ∈ S)
    (cx : counted ok pinned S x = true) : p x = true :=
  (view_all_iff ok pinned).mp h x m cx

theorem row_table {C : List TreeStatement} :
    row (pastTable S C) a = if a ∈ C then some (pastNames S a (S.length + 1)) else none := by
  induction C with
  | nil => simp [row, pastTable]
  | cons x xs ih =>
    by_cases e : x = a
    · subst e
      simp [row, pastTable]
    · have ne : (x == a) = false := by simpa using e
      simp only [row, pastTable, List.map_cons, List.find?_cons, ne] at ih ⊢
      rw [ih]
      by_cases m : a ∈ xs <;> simp [m, Ne.symm e]

theorem view_past : (view ok pinned S).past a b = true ↔
    (a ∈ S ∧ counted ok pinned S a = true) ∧ (b ∈ S ∧ counted ok pinned S b = true) ∧ InPast S a b := by
  have key : (b ∈ S ∧ (pastNames S a (S.length + 1)).contains b.name = true) ↔ InPast S a b := by
    rw [← inPast_iff]
    simp only [inPast, Bool.and_eq_true, List.contains_iff_mem]
  simp only [view, row_table, Bool.and_eq_true, List.contains_iff_mem, List.mem_filter]
  by_cases ma : a ∈ S ∧ counted ok pinned S a = true
  · simp only [ma, ite_true, Option.map_some, Option.getD_some, true_and]
    constructor
    · rintro ⟨mb, k⟩
      exact ⟨mb, key.mp ⟨mb.1, k⟩⟩
    · rintro ⟨mb, p⟩
      exact ⟨mb, (key.mpr p).2⟩
  · simp only [ma, ite_false, Option.map_none, Option.getD_none, false_and, iff_false]
    simp

theorem claimOk_ticket {v : View} (h : claimOk v c = true) : ∃ t, c.ticketOf = some t := by
  unfold claimOk at h
  unfold TreeStatement.ticketOf
  split at h
  · exact ⟨_, rfl⟩
  · cases h

theorem claimOk_counted (h : claimOk (view ok pinned S) c = true) : counted ok pinned S c = true := by
  unfold claimOk at h
  split at h
  · simp only [Bool.and_eq_true, view_any] at h
    obtain ⟨⟨x, _, _, hx⟩, _⟩ := h
    exact ((view_past ok pinned).mp hx.2).1.2
  · cases h

theorem final_claimOk {v : View} (h : final v c = true) : claimOk v c = true := by
  simp only [final, Bool.and_eq_true] at h
  exact h.1

theorem standing_claimOk {v : View} (h : standing v c = true) : claimOk v c = true := by
  simp only [standing, Bool.and_eq_true] at h
  exact h.1

theorem sameTicket_self {v : View} (h : claimOk v c = true) : sameTicket c c = true := by
  obtain ⟨t, ht⟩ := claimOk_ticket h
  simp [sameTicket, ht]

theorem sameTicket_of {c d : TreeStatement} {t : Nat} (hc : c.ticketOf = some t) (hd : d.ticketOf = some t) :
    sameTicket c d = true := by
  simp [sameTicket, hc, hd]

def settleView (v : View) : Settled where
  counted n := v.any (·.name == n)
  final n := v.any fun c => c.name == n && final v c
  standing n := v.any fun c => c.name == n && standing v c
  contested t := v.any fun f => f.ticketOf == some t && final v f &&
    v.any fun f' => f'.ticketOf == some t && f'.name != f.name && final v f'
  member := member v
  admits := admits v
  relay := listed v .relayAdd .relayRemove
  keeper := listed v .keeperAdd .keeperRemove

end Settle

open Settle in
/-- The tree from a set of statements: `ok` is each statement's own checks (signatures, assertions, texts), and
`pinned` the genesis's name that every member pins. -/
def settle (ok : TreeStatement → Bool) (pinned : Nat) (S : List TreeStatement) : Settled :=
  settleView (view ok pinned S)

namespace Settle

variable (ok : TreeStatement → Bool) (pinned : Nat)
variable {S S' X : List TreeStatement} {a b c : TreeStatement}

/-! ### `settle_perm`: no order is an input -/

theorem counted_set (h : ∀ x, x ∈ S ↔ x ∈ S') : counted ok pinned S = counted ok pinned S' := by
  funext s
  simp only [counted, inPast_set h, any_set h]

theorem View.ext' {v w : View} (p : v.pinned = w.pinned) (a : v.any = w.any) (l : v.all = w.all)
    (q : v.past = w.past) : v = w := by
  cases v
  cases w
  simp_all

theorem past_set (h : ∀ x, x ∈ S ↔ x ∈ S') : InPast S a b ↔ InPast S' a b :=
  ⟨InPast.mono fun x m => (h x).mp m, InPast.mono fun x m => (h x).mpr m⟩

theorem view_set (h : ∀ x, x ∈ S ↔ x ∈ S') : view ok pinned S = view ok pinned S' := by
  have hc := counted_set ok pinned h
  have hf : ∀ x, x ∈ S.filter (counted ok pinned S) ↔ x ∈ S'.filter (counted ok pinned S') := by
    intro x
    simp only [List.mem_filter, h, hc]
  refine View.ext' rfl (funext (any_set hf)) (funext (all_set hf)) (funext fun a => funext fun b => ?_)
  apply Bool.eq_iff_iff.mpr
  rw [view_past, view_past, hc, past_set h, h, h]

end Settle

open Settle in
/-- Two peers holding the same statements, in whatever order they came, settle the same tree. -/
theorem settle_perm (ok : TreeStatement → Bool) (pinned : Nat) {S S' : List TreeStatement}
    (h : ∀ x, x ∈ S ↔ x ∈ S') : settle ok pinned S = settle ok pinned S' := by
  simp only [settle, view_set ok pinned h]

namespace Settle

variable (ok : TreeStatement → Bool) (pinned : Nat)
variable {S S' X : List TreeStatement} {a b c : TreeStatement}

/-! ### `settle_genesis`: only the pinned genesis's descendants count -/

/-- A path between descendants never passes a statement that isn't one. -/
theorem past_without (hX : ∀ x ∈ X, ¬ Desc ok pinned (S ++ X) x) (h : InPast (S ++ X) a c)
    (d : Desc ok pinned (S ++ X) c) : InPast S a c := by
  induction h with
  | tip m t =>
    rcases List.mem_append.mp m with m | m
    · exact .tip m t
    · exact absurd d (hX _ m)
  | @step b c hb m t ih =>
    have db : Desc ok pinned (S ++ X) b := by
      have bc : InPast (S ++ X) b c := .tip m t
      rcases d with g | ⟨g, mg, pg, cg⟩
      · exact .inr ⟨c, m, g, bc⟩
      · exact .inr ⟨g, mg, pg, bc.trans cg⟩
    rcases List.mem_append.mp m with m' | m'
    · exact .step (ih db) m' t
    · exact absurd d (hX _ m')

theorem desc_without (hX : ∀ x ∈ X, ¬ Desc ok pinned (S ++ X) x) {s : TreeStatement} :
    Desc ok pinned (S ++ X) s ↔ Desc ok pinned S s := by
  constructor
  · rintro (g | ⟨g, mg, pg, sg⟩)
    · exact .inl g
    · rcases List.mem_append.mp mg with mg | mg
      · exact .inr ⟨g, mg, pg, past_without ok pinned hX sg (.inl pg)⟩
      · exact absurd (.inl pg) (hX _ mg)
  · rintro (g | ⟨g, mg, pg, sg⟩)
    · exact .inl g
    · exact .inr ⟨g, List.mem_append_left _ mg, pg, sg.mono fun x m => List.mem_append_left _ m⟩

theorem counted_without (hX : ∀ x ∈ X, ¬ Desc ok pinned (S ++ X) x) :
    counted ok pinned (S ++ X) = counted ok pinned S := by
  funext s
  apply Bool.eq_iff_iff.mpr
  rw [counted_iff, counted_iff, desc_without ok pinned hX]

theorem view_without (hX : ∀ x ∈ X, ¬ Desc ok pinned (S ++ X) x) : view ok pinned (S ++ X) = view ok pinned S := by
  have hc := counted_without ok pinned hX
  have hf : (S ++ X).filter (counted ok pinned S) = S.filter (counted ok pinned S) := by
    have none : X.filter (counted ok pinned S) = [] := by
      refine List.filter_eq_nil_iff.mpr fun x m cx => ?_
      have ⟨_, d⟩ := (counted_iff ok pinned).mp cx
      exact hX x m ((desc_without ok pinned hX).mpr d)
    rw [List.filter_append, none, List.append_nil]
  have hm : ∀ x, counted ok pinned S x = true → (x ∈ S ++ X ↔ x ∈ S) := by
    intro x cx
    refine ⟨fun m => ?_, List.mem_append_left _⟩
    rcases List.mem_append.mp m with m | m
    · exact m
    · have ⟨_, d⟩ := (counted_iff ok pinned).mp cx
      exact absurd ((desc_without ok pinned hX).mpr d) (hX x m)
  have hf' : ∀ x, x ∈ (S ++ X).filter (counted ok pinned (S ++ X)) ↔ x ∈ S.filter (counted ok pinned S) := by
    intro x
    rw [hc, hf]
  refine View.ext' rfl (funext (any_set hf')) (funext (all_set hf')) (funext fun a => funext fun b => ?_)
  apply Bool.eq_iff_iff.mpr
  rw [view_past, view_past, hc]
  constructor
  · rintro ⟨⟨ma, ca⟩, ⟨mb, cb⟩, p⟩
    have ⟨_, d⟩ := (counted_iff ok pinned).mp cb
    exact ⟨⟨(hm a ca).mp ma, ca⟩, ⟨(hm b cb).mp mb, cb⟩,
      past_without ok pinned hX p ((desc_without ok pinned hX).mpr d)⟩
  · rintro ⟨⟨ma, ca⟩, ⟨mb, cb⟩, p⟩
    exact ⟨⟨List.mem_append_left _ ma, ca⟩, ⟨List.mem_append_left _ mb, cb⟩,
      p.mono fun x m => List.mem_append_left _ m⟩

end Settle

open Settle in
/-- Nothing outside the pinned genesis's descendants changes the tree. -/
theorem settle_genesis (ok : TreeStatement → Bool) (pinned : Nat) {S X : List TreeStatement}
    (hX : ∀ x ∈ X, ¬ Desc ok pinned (S ++ X) x) : settle ok pinned (S ++ X) = settle ok pinned S := by
  simp only [settle, view_without ok pinned hX]

namespace Settle

variable (ok : TreeStatement → Bool) (pinned : Nat)
variable {S S' X : List TreeStatement} {a b c : TreeStatement}

/-- Every statement in the tree is the pinned genesis or has it in its past, and that genesis carries the signatures of
its claimant's passkey and of MaiaCityGuardian (A11, A13). -/
theorem genesis_pinned {s : TreeStatement} (h : counted ok pinned S s = true) :
    ∃ g gen, g.name = pinned ∧ ok g = true ∧ g.says = .genesis gen ∧ gen.consented = true ∧
      (g = s ∨ (g ∈ S ∧ InPast S s g)) := by
  have pg : ∀ {g}, pinnedGenesis ok pinned g = true →
      ∃ gen, g.name = pinned ∧ ok g = true ∧ g.says = .genesis gen ∧ gen.consented = true := by
    intro g h
    unfold pinnedGenesis at h
    simp only [Bool.and_eq_true, beq_iff_eq] at h
    obtain ⟨⟨n, o⟩, c⟩ := h
    split at c
    · rename_i gen e
      exact ⟨gen, n, o, e, c⟩
    · cases c
  obtain ⟨_, d⟩ := (counted_iff ok pinned).mp h
  rcases d with g | ⟨g, mg, pgg, sg⟩
  · obtain ⟨gen, n, o, e, c⟩ := pg g
    exact ⟨s, gen, n, o, e, c, .inl rfl⟩
  · obtain ⟨gen, n, o, e, c⟩ := pg pgg
    exact ⟨g, gen, n, o, e, c, .inr ⟨mg, sg⟩⟩

/-- A claim counts only if it names the guardian the pinned genesis names (A13): nobody joins without being shown
who co-owns their vault. -/
theorem guardian_consented (h : claimOk (view ok pinned S) c = true) :
    ∃ t vault passkey device guardian, c.says = .claim t vault passkey device guardian ∧
      ∃ g ∈ S, g.name = pinned ∧ ∃ gen, g.says = .genesis gen ∧ gen.consented = true ∧ gen.guardian = guardian := by
  unfold claimOk at h
  split at h
  · rename_i t vault passkey device guardian e
    refine ⟨t, vault, passkey, device, guardian, e, ?_⟩
    simp only [Bool.and_eq_true] at h
    have := h.2
    simp only [gen, view_any, Bool.and_eq_true, beq_iff_eq] at this
    obtain ⟨g, mg, _, n, hg⟩ := this
    split at hg
    · rename_i gen eg
      simp only [Bool.and_eq_true, beq_iff_eq] at hg
      exact ⟨g, mg, n, gen, eg, hg.1, hg.2⟩
    · cases hg
  · cases h

/-! ### Tickets, withdrawals and finality -/

/-- A ticket founds at most one vault: two standing claims of one ticket are one claim, by name. -/
theorem settle_ticket_once {c d : TreeStatement} (mc : c ∈ S) (md : d ∈ S)
    (hc : standing (view ok pinned S) c = true) (hd : standing (view ok pinned S) d = true)
    (same : c.ticketOf = d.ticketOf) : c.name = d.name := by
  have okc := standing_claimOk hc
  have okd := standing_claimOk hd
  have cc := claimOk_counted ok pinned okc
  have cd := claimOk_counted ok pinned okd
  obtain ⟨t, ht⟩ := claimOk_ticket okc
  have hdt : d.ticketOf = some t := same ▸ ht
  have st : ∀ f, sameTicket f c = sameTicket f d := by
    intro f
    simp [sameTicket, ht, hdt]
  have scd : sameTicket c d = true := sameTicket_of ht hdt
  have sdc : sameTicket d c = true := sameTicket_of hdt ht
  unfold standing at hc hd
  simp only [st] at hc
  by_cases hF : (view ok pinned S).any (fun f => final (view ok pinned S) f && sameTicket f d) = true
  · simp only [hF, ite_true, Bool.and_eq_true] at hc hd
    have le₁ := view_all ok pinned hc.2.2 md cd
    have le₂ := view_all ok pinned hd.2.2 mc cc
    simp only [hd.2.1, hc.2.1, sameTicket_self okd, scd, Bool.and_self, Bool.not_true, Bool.false_or,
      decide_eq_true_eq] at le₁ le₂
    omega
  · simp only [hF, Bool.false_eq_true, ite_false, Bool.and_eq_true, Bool.not_eq_true'] at hc hd
    have le₁ := view_all ok pinned hc.2.2 md cd
    have le₂ := view_all ok pinned hd.2.2 mc cc
    simp only [okd, okc, sameTicket_self okd, scd, hd.2.1, hc.2.1, Bool.not_false, Bool.and_self, Bool.not_true,
      Bool.false_or, decide_eq_true_eq] at le₁ le₂
    omega

/-- A withdrawal of a ticket leaves no claim of it standing that isn't final and wasn't in the withdrawal's past. -/
theorem settle_withdrawn {w : TreeStatement} {t : Nat} (mw : w ∈ S) (cw : counted ok pinned S w = true)
    (aw : admin (view ok pinned S) w.signer = true) (says : w.says = .withdrawal t) (ct : c.ticketOf = some t)
    (np : ¬ InPast S w c) (nf : final (view ok pinned S) c = false) : standing (view ok pinned S) c = false := by
  have hb : (view ok pinned S).any (fun x => beats (view ok pinned S) x c) = true := by
    refine (view_any ok pinned).mpr ⟨w, mw, cw, ?_⟩
    have pf : (view ok pinned S).past w c = false := by
      cases e : (view ok pinned S).past w c
      · rfl
      · exact absurd ((view_past ok pinned).mp e).2.2 np
    simp [beats, ct, aw, says, pf]
  unfold standing
  split <;> simp [nf, hb]

/-! ### Monotone in the statements: what finality needs -/

theorem counted_mono (sub : ∀ x ∈ S, x ∈ S') (h : counted ok pinned S a = true) : counted ok pinned S' a = true := by
  have ⟨o, d⟩ := (counted_iff ok pinned).mp h
  refine (counted_iff ok pinned).mpr ⟨o, ?_⟩
  rcases d with g | ⟨g, mg, pg, sg⟩
  · exact .inl g
  · exact .inr ⟨g, sub g mg, pg, sg.mono sub⟩

theorem any_mono (sub : ∀ x ∈ S, x ∈ S') {p q : TreeStatement → Bool} (pq : ∀ x, p x = true → q x = true)
    (h : (view ok pinned S).any p = true) : (view ok pinned S').any q = true := by
  obtain ⟨x, m, cx, px⟩ := (view_any ok pinned).mp h
  exact (view_any ok pinned).mpr ⟨x, sub x m, counted_mono ok pinned sub cx, pq x px⟩

theorem past_mono (sub : ∀ x ∈ S, x ∈ S') (h : (view ok pinned S).past a b = true) :
    (view ok pinned S').past a b = true := by
  obtain ⟨⟨ma, ca⟩, ⟨mb, cb⟩, p⟩ := (view_past ok pinned).mp h
  exact (view_past ok pinned).mpr
    ⟨⟨sub a ma, counted_mono ok pinned sub ca⟩, ⟨sub b mb, counted_mono ok pinned sub cb⟩, p.mono sub⟩

theorem gen_mono (sub : ∀ x ∈ S, x ∈ S') {P : Genesis → Bool} (h : gen (view ok pinned S) P = true) :
    gen (view ok pinned S') P = true :=
  any_mono ok pinned sub (fun _ hx => hx) h

theorem admin_mono (sub : ∀ x ∈ S, x ∈ S') {k : String} (h : admin (view ok pinned S) k = true) :
    admin (view ok pinned S') k = true := by
  unfold admin at h ⊢
  simp only [Bool.or_eq_true] at h ⊢
  rcases h with h | h
  · exact .inl (gen_mono ok pinned sub h)
  · refine .inr (any_mono ok pinned sub (fun x hx => ?_) h)
    split at hx
    · simp only [Bool.and_eq_true] at hx ⊢
      exact ⟨hx.1, gen_mono ok pinned sub hx.2⟩
    · cases hx

theorem claimOk_mono (sub : ∀ x ∈ S, x ∈ S') (h : claimOk (view ok pinned S) c = true) :
    claimOk (view ok pinned S') c = true := by
  unfold claimOk at h ⊢
  split at h
  · simp only [Bool.and_eq_true] at h ⊢
    refine ⟨any_mono ok pinned sub (fun x hx => ?_) h.1, gen_mono ok pinned sub h.2⟩
    simp only [Bool.and_eq_true] at hx ⊢
    exact ⟨⟨⟨hx.1.1.1, admin_mono ok pinned sub hx.1.1.2⟩, hx.1.2⟩, past_mono ok pinned sub hx.2⟩
  · cases h

theorem final_mono (sub : ∀ x ∈ S, x ∈ S') (h : final (view ok pinned S) c = true) :
    final (view ok pinned S') c = true := by
  simp only [final, Bool.and_eq_true] at h ⊢
  refine ⟨claimOk_mono ok pinned sub h.1, any_mono ok pinned sub (fun x hx => ?_) h.2⟩
  simp only [Bool.and_eq_true] at hx ⊢
  exact ⟨⟨admin_mono ok pinned sub hx.1.1, hx.1.2⟩, past_mono ok pinned sub hx.2⟩

/-- A final claim stays final whatever is added, and stands unless what is added makes another claim of its ticket
with a smaller hash final: only an admin's ack that never saw the first ack can. -/
theorem settle_final (sub : ∀ x ∈ S, x ∈ S') (mc : c ∈ S) (hf : final (view ok pinned S) c = true) :
    final (view ok pinned S') c = true ∧
      ((∀ f ∈ S', final (view ok pinned S') f = true → sameTicket f c = true → c.name ≤ f.name) →
        standing (view ok pinned S') c = true) := by
  have f' := final_mono ok pinned sub hf
  refine ⟨f', fun least => ?_⟩
  have okc := final_claimOk f'
  have cc := claimOk_counted ok pinned okc
  have hF : (view ok pinned S').any (fun f => final (view ok pinned S') f && sameTicket f c) = true :=
    (view_any ok pinned).mpr ⟨c, sub c mc, cc, by simp [f', sameTicket_self okc]⟩
  unfold standing
  simp only [hF, ite_true, okc, f', Bool.true_and]
  refine (view_all_iff ok pinned).mpr fun f mf _ => ?_
  by_cases ff : final (view ok pinned S') f = true
  · by_cases sf : sameTicket f c = true
    · simp [ff, sf, least f mf ff sf]
    · simp [ff, sf]
  · simp [ff]

/-! ### The door -/

theorem gen_elim {P : Genesis → Bool} (h : gen (view ok pinned S) P = true) :
    ∃ g ∈ S, counted ok pinned S g = true ∧ g.name = pinned ∧
      ∃ gs, g.says = .genesis gs ∧ gs.consented = true ∧ P gs = true := by
  obtain ⟨g, mg, cg, hg⟩ := (view_any ok pinned).mp h
  simp only [Bool.and_eq_true, beq_iff_eq] at hg
  obtain ⟨n, hg⟩ := hg
  split at hg
  · rename_i gs e
    simp only [Bool.and_eq_true] at hg
    exact ⟨g, mg, cg, n, gs, e, hg.1, hg.2⟩
  · cases hg

theorem gen_intro {g : TreeStatement} {gs : Genesis} {P : Genesis → Bool} (mg : g ∈ S)
    (cg : counted ok pinned S g = true) (n : g.name = pinned) (e : g.says = .genesis gs) (c : gs.consented = true)
    (hp : P gs = true) : gen (view ok pinned S) P = true :=
  (view_any ok pinned).mpr ⟨g, mg, cg, by simp [n, e, c, hp, view]⟩

/-- The door admits exactly the devices of the member vaults (K12): the claimant's first devices, the Aven Peer, the
first device of each vault a standing claim founds, and the devices a member's passkey signs in. So it is a function of
the settled tree alone (`door_from_tree`), and no position opens it. -/
theorem settle_door {d : String} :
    admits (view ok pinned S) d = true ↔
      ∃ vault, member (view ok pinned S) vault = true ∧ deviceOf (view ok pinned S) vault d = true := by
  constructor
  · intro h
    unfold admits at h
    simp only [Bool.or_eq_true] at h
    rcases h with (h | h) | h
    · obtain ⟨g, mg, cg, n, gs, e, c, hp⟩ := gen_elim ok pinned h
      simp only [Bool.or_eq_true, beq_iff_eq] at hp
      rcases hp with hp | hp
      · refine ⟨gs.claimant, ?_, ?_⟩
        · unfold member
          simp only [Bool.or_eq_true]
          exact .inl (gen_intro ok pinned mg cg n e c (by simp))
        · unfold deviceOf
          simp only [Bool.or_eq_true]
          exact .inl (.inl (gen_intro ok pinned mg cg n e c (by simp [List.contains_iff_mem.mp hp])))
      · refine ⟨gs.agent, ?_, ?_⟩
        · unfold member
          simp only [Bool.or_eq_true]
          exact .inl (gen_intro ok pinned mg cg n e c (by simp))
        · unfold deviceOf
          simp only [Bool.or_eq_true]
          exact .inl (.inl (gen_intro ok pinned mg cg n e c (by simp [hp])))
    · obtain ⟨c, mc, cc, hc⟩ := (view_any ok pinned).mp h
      simp only [Bool.and_eq_true] at hc
      obtain ⟨st, hc⟩ := hc
      split at hc
      · rename_i t founded pk dev gk e
        refine ⟨founded, ?_, ?_⟩
        · unfold member
          simp only [Bool.or_eq_true]
          exact .inr ((view_any ok pinned).mpr ⟨c, mc, cc, by simp [st, e]⟩)
        · unfold deviceOf
          simp only [Bool.or_eq_true]
          exact .inl (.inr ((view_any ok pinned).mpr ⟨c, mc, cc, by simp_all⟩))
      · cases hc
    · obtain ⟨s, ms, cs, hs⟩ := (view_any ok pinned).mp h
      split at hs
      · rename_i vault dev e
        simp only [Bool.and_eq_true, beq_iff_eq] at hs
        obtain ⟨rfl, pk⟩ := hs
        refine ⟨vault, ?_, ?_⟩
        · unfold passkeyOf at pk
          unfold member
          simp only [Bool.or_eq_true] at pk ⊢
          rcases pk with pk | pk
          · obtain ⟨g, mg, cg, n, gs, eg, c, hp⟩ := gen_elim ok pinned pk
            simp only [Bool.and_eq_true, beq_iff_eq] at hp
            exact .inl (gen_intro ok pinned mg cg n eg c (by simp [hp.1]))
          · refine .inr (any_mono ok pinned (fun _ m => m) (fun x hx => ?_) pk)
            cases hx' : x.says <;> simp_all
        · unfold deviceOf
          simp only [Bool.or_eq_true]
          exact .inr ((view_any ok pinned).mpr ⟨s, ms, cs, by simp [e, pk]⟩)
      · cases hs
  · rintro ⟨vault, _, h⟩
    unfold deviceOf at h
    unfold admits
    simp only [Bool.or_eq_true] at h ⊢
    rcases h with (h | h) | h
    · refine .inl (.inl (any_mono ok pinned (fun _ m => m) (fun x hx => ?_) h))
      cases hx' : x.says
      case genesis gs =>
        simp only [hx', Bool.and_eq_true, Bool.or_eq_true, beq_iff_eq] at hx ⊢
        obtain ⟨n, c, hp⟩ := hx
        refine ⟨n, c, ?_⟩
        rcases hp with ⟨_, hp⟩ | ⟨_, hp⟩
        · exact .inl hp
        · exact .inr hp
      all_goals simp [hx'] at hx
    · refine .inl (.inr (any_mono ok pinned (fun _ m => m) (fun x hx => ?_) h))
      cases hx' : x.says <;> simp_all
    · refine .inr (any_mono ok pinned (fun _ m => m) (fun x hx => ?_) h)
      cases hx' : x.says <;> simp_all

/-- A list's entry stands only through an add that saw every remove of it. -/
theorem settle_listed {add remove : String → TreeSays} {d : String}
    (h : listed (view ok pinned S) add remove d = true) :
    ∃ a ∈ S, counted ok pinned S a = true ∧ admin (view ok pinned S) a.signer = true ∧ a.says = add d ∧
      ∀ r ∈ S, counted ok pinned S r = true → admin (view ok pinned S) r.signer = true → r.says = remove d →
        InPast S a r := by
  obtain ⟨a, ma, ca, ha⟩ := (view_any ok pinned).mp h
  simp only [Bool.and_eq_true, beq_iff_eq, Bool.not_eq_true'] at ha
  obtain ⟨⟨aa, sa⟩, none⟩ := ha
  refine ⟨a, ma, ca, aa, sa, fun r mr cr ar sr => Classical.byContradiction fun np => ?_⟩
  have pf : (view ok pinned S).past a r = false := by
    cases e : (view ok pinned S).past a r
    · rfl
    · exact absurd ((view_past ok pinned).mp e).2.2 np
  have : (view ok pinned S).any (fun r => admin (view ok pinned S) r.signer && r.says == remove d &&
      !(view ok pinned S).past a r) = true :=
    (view_any ok pinned).mpr ⟨r, mr, cr, by simp [ar, sr, pf]⟩
  rw [this] at none
  cases none

end Settle

/-- The settled tree as sorted lists over what `S` names: for vectors and checks. -/
structure Listed where
  counted : List Nat
  final : List Nat
  standing : List Nat
  contested : List Nat
  members : List String
  admitted : List String
  relays : List String
  keepers : List String
  deriving DecidableEq, Repr

/-- The vaults and the keys a statement names. -/
def TreeStatement.mentions (s : TreeStatement) : List String × List String :=
  match s.says with
  | .genesis g => ([g.claimant, g.coop, g.agent], g.avenPeer :: g.devices)
  | .signIn vault device => ([vault], [device])
  | .ticket _ | .withdrawal _ | .ack _ => ([], [])
  | .claim _ vault _ device _ => ([vault], [device])
  | .relayAdd d | .relayRemove d | .keeperAdd d | .keeperRemove d => ([], [d])

def Settled.listed (t : Settled) (S : List TreeStatement) : Listed :=
  let nats (l : List Nat) := l.eraseDups.mergeSort (· ≤ ·)
  let strs (l : List String) := l.eraseDups.mergeSort fun a b => decide (a < b) || a == b
  let names := nats (S.map (·.name))
  let vaults := strs (S.flatMap (·.mentions.1))
  let keys := strs (S.flatMap (·.mentions.2))
  { counted := names.filter t.counted, final := names.filter t.final, standing := names.filter t.standing
    contested := (nats (S.filterMap (·.ticketOf))).filter t.contested, members := vaults.filter t.member
    admitted := keys.filter t.admits, relays := keys.filter t.relay, keepers := keys.filter t.keeper }

/-! ### An example tree

Alice founds the network, signed by her passkey and MaiaCityGuardian, and signs in a second device. Bob claims his
ticket and an admin device acks it; a leaked copy of his link claims it again with a smaller hash, too late. Carol's
ticket is withdrawn by a withdrawal that never saw her claim. Dan's claim names another guardian. Two of Alice's devices
ack different claims of Eve's ticket without seeing each other, so the smaller hash wins and the ticket is contested.
A relay is removed and added again, another removed while it was added. A second genesis, and a bad ticket, change
nothing. -/

namespace TreeExamples

def guardian : GuardianKeys := ⟨"guardian-ed25519", "guardian-ml-dsa", "guardian-x-wing"⟩

def alicesGenesis : Genesis :=
  { rpId := "maia.city", origins := ["https://maia.city"], claimant := "alice", passkey := "alice-passkey",
    devices := ["alice-peer"], coop := "maia-city", agent := "aven", avenPeer := "aven-peer", guardian,
    signedBy := ["alice-passkey", "guardian-ed25519", "guardian-ml-dsa"] }

def statements : List TreeStatement :=
  [⟨100, "alice-passkey", [], .genesis alicesGenesis⟩,
   ⟨110, "alice-passkey", [100], .signIn "alice" "alice-peer-light"⟩,
   ⟨120, "alice-passkey", [110], .ticket "t-bob"⟩,
   ⟨500, "t-bob", [120], .claim 120 "bob" "bob-passkey" "bob-peer-light" guardian⟩,
   ⟨510, "alice-peer", [500], .ack 500⟩,
   ⟨300, "t-bob", [120], .claim 120 "mallory" "mallory-passkey" "mallory-peer" guardian⟩,
   ⟨310, "mallory-passkey", [300], .signIn "mallory" "mallory-peer-2"⟩,
   ⟨520, "bob-passkey", [510], .signIn "bob" "bob-peer"⟩,
   ⟨130, "alice-passkey", [100], .ticket "t-carol"⟩,
   ⟨600, "t-carol", [130], .claim 130 "carol" "carol-passkey" "carol-peer" guardian⟩,
   ⟨610, "alice-passkey", [130], .withdrawal 130⟩,
   ⟨140, "alice-passkey", [100], .ticket "t-dan"⟩,
   ⟨650, "t-dan", [140], .claim 140 "dan" "dan-passkey" "dan-peer" ⟨"other-ed25519", "other-ml-dsa", "other-x"⟩⟩,
   ⟨160, "alice-passkey", [100], .ticket "t-eve"⟩,
   ⟨800, "t-eve", [160], .claim 160 "eve" "eve-passkey" "eve-peer" guardian⟩,
   ⟨790, "t-eve", [160], .claim 160 "eve2" "eve2-passkey" "eve2-peer" guardian⟩,
   ⟨810, "alice-peer", [800], .ack 800⟩,
   ⟨811, "alice-peer-light", [790], .ack 790⟩,
   ⟨700, "alice-passkey", [100], .relayAdd "aven-peer"⟩,
   ⟨740, "alice-passkey", [700], .relayRemove "aven-peer"⟩,
   ⟨750, "alice-passkey", [740], .relayAdd "aven-peer"⟩,
   ⟨710, "alice-passkey", [520], .relayAdd "bob-peer"⟩,
   ⟨720, "alice-passkey", [100], .relayRemove "bob-peer"⟩,
   ⟨730, "alice-passkey", [100], .keeperAdd "alice-peer"⟩,
   ⟨50, "eve-passkey", [], .genesis { alicesGenesis with
     claimant := "eve", passkey := "eve-passkey", signedBy := ["eve-passkey", "guardian-ed25519", "guardian-ml-dsa"] }⟩,
   ⟨60, "eve-passkey", [50], .ticket "t-other"⟩,
   ⟨150, "alice-passkey", [100], .ticket "t-bad"⟩,
   ⟨660, "t-bad", [150], .claim 150 "frank" "frank-passkey" "frank-peer" guardian⟩]

/-- Every statement passes its own checks but the bad ticket. -/
def ok (s : TreeStatement) : Bool := s.name != 150

def expected : Listed :=
  { counted := [100, 110, 120, 130, 140, 160, 300, 310, 500, 510, 520, 600, 610, 650, 660, 700, 710, 720, 730, 740,
      750, 790, 800, 810, 811]
    final := [500, 790, 800], standing := [500, 790], contested := [160]
    members := ["alice", "aven", "bob", "eve2", "maia-city"]
    admitted := ["alice-peer", "alice-peer-light", "aven-peer", "bob-peer", "bob-peer-light", "eve2-peer"]
    relays := ["aven-peer"], keepers := ["alice-peer"] }

#guard (settle ok 100 statements).listed statements == expected
#guard (settle ok 100 statements.reverse).listed statements == expected
-- Pinned to the other genesis, only its own statements count.
#guard (settle ok 50 statements).listed statements ==
  { expected with
    counted := [50, 60], final := [], standing := [], contested := [], members := ["aven", "eve", "maia-city"],
    admitted := ["alice-peer", "aven-peer"], relays := [], keepers := [] }

end TreeExamples

end Aven.ID

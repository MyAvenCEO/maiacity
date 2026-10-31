import Aven.ID.Caps
import Aven.ID.Approve
import Aven.Core

/-! # The network: the public, tickets and the tree

**The public** (D15) is every member of the invite-only network, and nobody outside it. A public cap's writes count only
from a member (`public_member`), and a member's removal ends them at once: the members group's next epoch is sealed to
the members that remain (`removal_rotates`).

**Tickets** (A12, decided 30 Oct 2026): a ticket is claimed once, by the claim with the smallest hash, so every peer
agrees whatever order the claims reach it in (`ticket_once`). The hash is compared as a number: `Aven.Core`'s 32 bytes,
read big-endian (`hashNum`).

**The tree is a Doc of Core envelopes** (A10 to A13, A30, A39; PEERS.md §5). A peer stores each envelope under its
name and reads it as the statement it carries (`Aven.ID.TreeDoc`): its signer, its parents (the tips it saw) and what it
says (`TreeSays`, its body: `TreeSays.toValue`, read back by `TreeSays.ofValue_toValue`). The past is Core's
(`Aven.Core.Past`: `Before`, decided by `inPast`). `settle` is a function of the set of statements that passed their
own checks:
1. a statement counts when it descends from the pinned genesis, which the claimant's passkey and MaiaCityGuardian both
   signed;
2. a withdrawal wins over every claim of its ticket not in its past;
3. a claim is final once a confirmation names it and has it in its past (A38), and a withdrawal never wins over a final
   claim. A confirmer confirms only the claim that stands in its own view (`confirmPolicy`);
4. of a ticket's claims, a final one wins over the rest, and among final ones, or among the rest when none is, the
   smallest hash (`hashAtMost`). Two final claims of one ticket can only come from confirmations that didn't see each
   other: the ticket is `contested`;
5. a list's remove wins over every add that hadn't seen it. Tickets, withdrawals and the lists count only with Maia
   City's owners' approval (`byAdmin`, `Tree.approves`): the admin is a vault, never a key (rule 15, A28). A device of
   a vault holding Maia City's confirm cap confirms for it (`confirmer`);
6. the door admits the member vaults' devices (K12).

The theorems:
- `settle_perm`: peers holding the same statements, in any order, settle the same tree;
- `settle_ticket_once`: a ticket founds at most one vault;
- `settle_withdrawn`: a withdrawal leaves no claim of its ticket standing that isn't final and wasn't in its past;
- `settle_final`: a final claim stays final whatever is added, and stands unless another claim of its ticket with a
  smaller hash is made final, which only a confirmation that never saw the first can do;
- `settle_door`: the door admits exactly the devices of the member vaults, so it is a function of the tree alone;
- `settle_genesis`: nothing outside the pinned genesis's descendants changes the tree;
- `genesis_pinned`: everything in the tree descends from the pinned genesis, signed by its claimant's passkey and
  MaiaCityGuardian (A11);
- `guardian_consented`: a claim counts only if it names the genesis's guardian (A13);
- `settle_listed`: a list's entry stands only through an add that saw every remove of it;
- `admin_by_owners`, `device_not_admin`: an admin act counts only with Maia City's owners' approval (`Tree.approves`),
  resting on an owner key above the coop, never a device's (rule 15, A28).

`settle_restore`, production's ref order, the record kinds and `settled.json` are avenPEER's (`Aven.ID.Restore`,
`Aven.ID.Records`; PEERS.md, Thread A). -/

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

/-! ## The tree as a Doc of Core envelopes

A10 to A13, decided on 30 Oct 2026 (PEERS.md, §5), and A30. Every statement names the tips it saw, its parents, so "in
the past of" is decidable and no order is an input: `settle` is a function of the set of statements. -/

/-- A hash as `settle` compares it: `Aven.Core`'s 32 bytes, read big-endian. -/
def hashNum (h : Aven.Core.Hash) : Nat := h.bytes.foldl (fun n b => n * 256 + b.toNat) 0

/-- `a` is `b`, or smaller as a number: of two claims, the smaller hash wins. Two different hashes with one number
(never two of Core's 32 bytes) are neither, so neither wins. -/
def hashAtMost (a b : Aven.Core.Hash) : Bool := a == b || decide (hashNum a < hashNum b)

theorem hashAtMost_antisymm {a b : Aven.Core.Hash} (h₁ : hashAtMost a b = true) (h₂ : hashAtMost b a = true) :
    a = b := by
  simp only [hashAtMost, Bool.or_eq_true, beq_iff_eq, decide_eq_true_eq] at h₁ h₂
  rcases h₁ with h | h
  · exact h
  · rcases h₂ with h' | h'
    · exact h'.symm
    · omega

/-- MaiaCityGuardian's hybrid keys, named in the genesis and in every claim (A13). -/
structure GuardianKeys where
  ed25519 : String
  mlDsa : String
  xWing : String
  deriving DecidableEq, Repr

/-- An owner's hybrid public key, derived from a passkey's PRF (`Aven.ID.KeyFormats`, `Aven.Core.Hybrid`). -/
structure HybridKey where
  ed25519 : String
  mlDsa : String
  deriving DecidableEq, Repr

/-- A passkey's record in the register (caps README, "Passkeys and the PRF step"): its WebAuthn credential id, its
ES256 key, the owner's hybrid key and the X-Wing seal key derived from its PRF, and the owner epoch. A record migrated
from production has no owner or seal until its passkey adds them (`ownerEpoch`); a passkey without an owner signs
nothing else (`ownerless_only_adds_owner`). -/
structure Passkey where
  credential : String
  spki : String
  owner : Option HybridKey
  sealKey : Option String
  epoch : Nat
  deriving DecidableEq, Repr

/-- The network's first statement (A11): the RP ID and origins, the claimant's vault with its passkey and first
devices, the admin coop (Maia City's vault) and the vaults that own it, the agent, the Aven Peer's device key, the
guardian, and the keys whose signatures it carries. The admin is the coop's vault, never a key (rule 15, A28). -/
structure Genesis where
  rpId : String
  origins : List String
  claimant : String
  passkey : Passkey
  devices : List String
  coop : String
  coopOwners : List String
  /-- how many of Maia City's owners approve for it (k of n, D14, A28) -/
  coopThreshold : Nat := 1
  agent : String
  avenPeer : String
  guardian : GuardianKeys
  /-- MaiaCityGuardian's vault: its key is that vault's owner, and the vault owns each person's vault (rule 15, A28) -/
  guardianVault : String
  /-- the vaults holding Maia City's standing confirm cap (A38): Aven's, so the Aven Peer confirms on its own -/
  confirmers : List String
  signedBy : List String
  deriving DecidableEq, Repr

/-- The claimant's passkey and MaiaCityGuardian's hybrid keys both signed it, and the claimant's passkey has an owner:
its PRF gave the owner key at the signing (A42). -/
def Genesis.consented (g : Genesis) : Bool :=
  decide (1 ≤ g.coopThreshold) && g.passkey.owner.isSome && g.signedBy.contains g.passkey.spki &&
    g.signedBy.contains g.guardian.ed25519 &&
    g.signedBy.contains g.guardian.mlDsa

/-- The vaults the genesis founds, as `Aven.ID.Approve` reads them: the claimant's vault, owned by its passkey and
MaiaCityGuardian's vault; the admin coop, owned by the vaults the genesis names; the agent, owned by the coop; and
MaiaCityGuardian's vault, owned by its key. -/
def Genesis.tree (g : Genesis) : Tree :=
  { keys := [g.passkey.spki, g.guardian.ed25519]
    vaults := [⟨g.claimant, "", .person, [.key g.passkey.spki, .vault g.guardianVault], 1⟩,
      ⟨g.coop, "", .coop, g.coopOwners.map .vault, g.coopThreshold⟩, ⟨g.agent, "", .agent, [.vault g.coop], 1⟩,
      ⟨g.guardianVault, "", .agent, [.key g.guardian.ed25519], 1⟩] }

/-- What every tree statement's signer signs, as `Aven.ID.Approve` names a digest: the statement itself. -/
def stmtDigest : String := "tree statement"

/-- In the tree a genesis founds, the only owner keys are the claimant's passkey and MaiaCityGuardian's: a device's
key owns nothing. -/
theorem Genesis.keyAbove {g : Genesis} {k b : String} (h : g.tree.KeyAbove k b) :
    k = g.passkey.spki ∨ k = g.guardian.ed25519 := by
  induction h with
  | own ko =>
    obtain ⟨v, hv, mk⟩ := ko
    have mv : v ∈ g.tree.vaults := List.mem_of_find?_eq_some hv
    simp only [Genesis.tree, List.mem_cons, List.not_mem_nil, or_false] at mv
    rcases mv with rfl | rfl | rfl | rfl <;>
      simp [Vault.ownerKeys, Owner.key?, List.filterMap_map] at mk
    · exact .inl mk
    · exact .inr mk
  | up _ _ ih => exact ih

/-- In the tree a consented genesis founds, every threshold is at least one: no approval passes on no signature. -/
theorem Genesis.threshold_pos (g : Genesis) (h : 1 ≤ g.coopThreshold) (x : String) : 1 ≤ g.tree.threshold x := by
  unfold Tree.threshold Tree.get? Genesis.tree
  simp only [List.find?]
  split <;> simp_all <;> split <;> simp_all <;> split <;> simp_all <;> split <;> simp_all

/-- The claimant's own vault takes one owner. -/
theorem Genesis.threshold_claimant (g : Genesis) : g.tree.threshold g.claimant = 1 := by
  simp [Tree.threshold, Tree.get?, Genesis.tree]

/-- The claimant's passkey approves for the claimant's own vault. -/
theorem Genesis.approvesF_own (g : Genesis) (d : String) (f : Nat) :
    g.tree.approvesF g.tree.threshold d [⟨g.passkey.spki, d⟩] (f + 1) g.claimant = true := by
  unfold Tree.approvesF
  have e : g.tree.get? g.claimant =
      some ⟨g.claimant, "", .person, [.key g.passkey.spki, .vault g.guardianVault], 1⟩ := by
    simp [Tree.get?, Genesis.tree]
  rw [e, g.threshold_claimant]
  simp only [decide_eq_true_eq]
  exact List.length_pos_iff_exists_mem.mpr
    ⟨.key g.passkey.spki, List.mem_filter.mpr ⟨mem_ownersOnce.mpr (by simp), by simp [Tree.ownerApproves]⟩⟩

theorem Genesis.approves_own (g : Genesis) (d : String) :
    g.tree.approves g.tree.threshold g.claimant d [⟨g.passkey.spki, d⟩] = true :=
  g.approvesF_own d _

/-- The claimant's passkey alone approves for Maia City when the claimant's vault owns it and Maia City takes one
owner: one tap today. -/
theorem Genesis.approves_claimant (g : Genesis) (hc : g.claimant ∈ g.coopOwners) (one : g.coopThreshold = 1)
    (d : String) : g.tree.approves g.tree.threshold g.coop d [⟨g.passkey.spki, d⟩] = true := by
  have key := g.approvesF_own d
  unfold Tree.approves
  by_cases e : g.claimant = g.coop
  · rw [← e]; exact key _
  · unfold Tree.approvesF
    have ec : g.tree.get? g.coop = some ⟨g.coop, "", .coop, g.coopOwners.map .vault, g.coopThreshold⟩ := by
      simp [Tree.get?, Genesis.tree, e]
    have tc : g.tree.threshold g.coop = 1 := by simp [Tree.threshold, ec, one]
    rw [ec, tc]
    simp only [decide_eq_true_eq]
    exact List.length_pos_iff_exists_mem.mpr
      ⟨.vault g.claimant, List.mem_filter.mpr ⟨mem_ownersOnce.mpr (by simp [hc]),
        by simp only [Tree.ownerApproves]; exact key 3⟩⟩

/-- What a tree statement says. -/
inductive TreeSays where
  | genesis (g : Genesis)
  /-- A device joins the vault of the passkey that signs it (the register maps the passkey to its vault), which
  needs that passkey's owner beside its ES256 (caps rule 21): the body names no vault. -/
  | signIn (device : String)
  /-- A ticket (an invite) with its one-time key, signed by an admin passkey. -/
  | ticket (key : String)
  /-- Ticket `ticket` (the ticket statement's name) withdrawn, by an admin passkey. -/
  | withdrawal (ticket : Core.Hash)
  /-- A claim of a ticket, signed by its one-time key: it founds `vault` with its passkey's record and its devices
  (a new claim's first device; a migrated join's every device, A42), and names the guardian vault it consents to,
  which co-owns the vault it founds (A13, A42). -/
  | claim (ticket : Core.Hash) (vault : String) (passkey : Passkey) (devices : List String) (guardian : String)
  /-- The confirm op (A38): a device of a vault holding Maia City's standing confirm cap confirms the claim it names,
  which issues the claim's vault its member cap. -/
  | confirm (claim : Core.Hash)
  /-- The relay list names vaults, never devices (rule 15, A28): a vault on it runs a relay on its devices. Who keeps
  what is the owner's keep caps and the keepers' offers, not a list (A44). -/
  | relayAdd (vault : String)
  | relayRemove (vault : String)
  /-- Maia City's changes to what the genesis named (rule 15, A28): the Aven Peer's device key, avenOS's origins, and
  MaiaCityGuardian's vault. Each counts only with its owners' approval; the latest settles it. -/
  | setAvenPeer (key : String)
  | setOrigins (origins : List String)
  | setGuardian (vault : String)
  /-- The owner-epoch op: a passkey adds the owner and seal keys its PRF derives, signed by its ES256 alone, the one
  act a passkey without an owner signs (A42). -/
  | ownerEpoch (credential : String) (owner : HybridKey) (sealKey : String) (epoch : Nat)
  /-- An owner change (A28, A191): `vault`'s owners and its threshold k from now on, approved by its owners in force in
  the change's own past. -/
  | setOwners (vault : String) (owners : List Owner) (threshold : Nat)
  deriving DecidableEq, Repr

/-! ### The body on Core's envelope (A30)

A tree statement is a Core envelope of the tree Doc (A39): its body is a call of one of `tree/1`'s ops
(`TreeSays.toValue`, below). Strings are UTF-8 text; a reference to another statement is its 32-byte name. `ofValue`
reads it back (`TreeSays.ofValue_toValue`), so a body names one thing whatever reads it. -/

namespace Body
open Core

def utf8 (s : String) : Bytes := s.toUTF8.data.toList
def ofUtf8 (b : Bytes) : Option String := String.fromUTF8? ⟨b.toArray⟩

theorem ofUtf8_utf8 (s : String) : ofUtf8 (utf8 s) = some s := by
  simp only [ofUtf8, utf8, Array.toArray_toList]
  unfold String.fromUTF8?
  split
  · next h => simp [String.fromUTF8]
  · next h => exact absurd s.isValidUTF8 h

def text (s : String) : Value := .text (utf8 s)
def ofText : Value → Option String
  | .text b => ofUtf8 b
  | _ => none

theorem ofText_text (s : String) : ofText (text s) = some s := ofUtf8_utf8 s

/-- Another statement, by its name: Core's 32 bytes. -/
def ref (h : Hash) : Value := .bytes h.bytes
def ofRef : Value → Option Hash
  | .bytes b => if b.length == 32 then some ⟨b⟩ else none
  | _ => none

theorem ofRef_ref {h : Hash} (ok : h.ok = true) : ofRef (ref h) = some h := by
  simp only [Hash.ok, beq_iff_eq] at ok
  simp [ofRef, ref, ok]

def texts (l : List String) : Value := .array (l.map text)
def ofTexts : Value → Option (List String)
  | .array xs => xs.mapM ofText
  | _ => none

theorem ofTexts_texts (l : List String) : ofTexts (texts l) = some l := by
  induction l with
  | nil => rfl
  | cons s l ih =>
    simp only [ofTexts, texts, List.map_cons, List.mapM_cons, ofText_text] at ih ⊢
    simp [ih]

end Body

open Body in
def GuardianKeys.toValue (k : GuardianKeys) : Core.Value := .array [text k.ed25519, text k.mlDsa, text k.xWing]

open Body in
def GuardianKeys.ofValue : Core.Value → Option GuardianKeys
  | .array [a, b, c] => do pure ⟨← ofText a, ← ofText b, ← ofText c⟩
  | _ => none

theorem GuardianKeys.ofValue_toValue (k : GuardianKeys) : ofValue k.toValue = some k := by
  simp [toValue, ofValue, Body.ofText_text]

open Body in
/-- An owner's hybrid key as a map, its keys in the codec's order. -/
def HybridKey.toValue (h : HybridKey) : Core.Value :=
  .map [(utf8 "mlDsa", text h.mlDsa), (utf8 "ed25519", text h.ed25519)]

open Body in
def HybridKey.ofValue : Core.Value → Option HybridKey
  | .map [(km, m), (ke, e)] =>
    if km == utf8 "mlDsa" && ke == utf8 "ed25519" then do pure ⟨← ofText e, ← ofText m⟩ else none
  | _ => none

theorem HybridKey.ofValue_toValue (h : HybridKey) : ofValue h.toValue = some h := by
  simp [toValue, ofValue, Body.ofText_text]

open Body in
/-- An optional Value: null when absent. -/
def optValue {α : Type} (f : α → Core.Value) : Option α → Core.Value
  | some a => f a
  | none => .null

def ofOpt {α : Type} (f : Core.Value → Option α) : Core.Value → Option (Option α)
  | .null => some none
  | v => (f v).map some

open Body in
/-- A passkey record as a map, `{seal, spki, epoch, owner, credential}` in the codec's order; an absent owner or seal is
null. -/
def Passkey.toValue (k : Passkey) : Core.Value :=
  .map [(utf8 "seal", optValue text k.sealKey), (utf8 "spki", text k.spki), (utf8 "epoch", .uint k.epoch),
    (utf8 "owner", optValue HybridKey.toValue k.owner), (utf8 "credential", text k.credential)]

open Body in
def Passkey.ofValue : Core.Value → Option Passkey
  | .map [(ks, se), (kk, sp), (ke, .uint ep), (ko, ow), (kc, cr)] =>
    if ks == utf8 "seal" && kk == utf8 "spki" && ke == utf8 "epoch" && ko == utf8 "owner" &&
        kc == utf8 "credential" then
      do pure ⟨← ofText cr, ← ofText sp, ← ofOpt HybridKey.ofValue ow, ← ofOpt ofText se, ep⟩
    else none
  | _ => none

theorem Passkey.ofValue_toValue (k : Passkey) : ofValue k.toValue = some k := by
  rcases k with ⟨cr, sp, ow, se, ep⟩
  cases ow <;> cases se <;>
    simp [toValue, ofValue, optValue, Body.text, HybridKey.toValue, ofOpt, Body.ofText, Body.ofUtf8_utf8,
      HybridKey.ofValue]

open Body in
/-- An owner as a map of one key: `{"key": k}` or `{"vault": v}`. -/
def Owner.toValue : Owner → Core.Value
  | .key k => .map [(utf8 "key", text k)]
  | .vault v => .map [(utf8 "vault", text v)]

open Body in
def Owner.ofValue : Core.Value → Option Owner
  | .map [(kk, x)] =>
    if kk == utf8 "key" then .key <$> ofText x else if kk == utf8 "vault" then .vault <$> ofText x else none
  | _ => none

theorem Owner.ofValue_toValue (o : Owner) : ofValue o.toValue = some o := by
  have ne : (Body.utf8 "vault" == Body.utf8 "key") = false := by decide
  cases o <;> simp [toValue, ofValue, Body.ofText_text, ne]

theorem Owner.ofValues (os : List Owner) : os.mapM (Owner.ofValue ∘ Owner.toValue) = some os := by
  induction os with
  | nil => rfl
  | cons o os ih => simp [List.mapM_cons, Owner.ofValue_toValue, ih]

open Body in
def Genesis.toValue (g : Genesis) : Core.Value :=
  .array [text g.rpId, texts g.origins, text g.claimant, g.passkey.toValue, texts g.devices, text g.coop,
    texts g.coopOwners, .uint g.coopThreshold, text g.agent, text g.avenPeer, g.guardian.toValue, text g.guardianVault,
    texts g.confirmers,
    texts g.signedBy]

open Body in
def Genesis.ofValue : Core.Value → Option Genesis
  | .array [rp, os, cl, pk, ds, co, cos, .uint th, ag, ap, gu, gv, cf, sb] => do
    pure ⟨← ofText rp, ← ofTexts os, ← ofText cl, ← Passkey.ofValue pk, ← ofTexts ds, ← ofText co, ← ofTexts cos,
      th, ← ofText ag, ← ofText ap, ← GuardianKeys.ofValue gu, ← ofText gv, ← ofTexts cf, ← ofTexts sb⟩
  | _ => none

theorem Genesis.ofValue_toValue (g : Genesis) : ofValue g.toValue = some g := by
  simp [toValue, ofValue, Body.ofText_text, Body.ofTexts_texts, GuardianKeys.ofValue_toValue,
    Passkey.ofValue_toValue]

/-! ### The tree's ops (A32): `tree/1`

Each statement is a call of one of `tree/1`'s ops (`Aven.Core.Call`): `{"op": id, "params": {…}}`. An op's id is the
name of its stored form `{"op": name, "plugin": "tree/1"}`, as `core/1`'s are (`Aven.Core.CoreOp.id`). The params are
a map with text keys in the codec's order, shorter first. `ofValue` reads a body back when the ops' ids differ, which
they do under any hash nothing collides under (`TreeSays.ofValue_toValue`; for BLAKE3, checked below). -/

inductive TreeOp where
  | genesis | signIn | ticket | withdraw | claim | confirm | relayAdd | relayRemove | setAvenPeer | setOrigins
  | setGuardian | ownerEpoch | setOwners
  deriving DecidableEq, Repr

def TreeOp.name : TreeOp → String
  | .genesis => "genesis" | .signIn => "signIn" | .ticket => "ticket" | .withdraw => "withdraw" | .claim => "claim"
  | .confirm => "confirm" | .relayAdd => "relayAdd" | .relayRemove => "relayRemove"
  | .setAvenPeer => "setAvenPeer" | .setOrigins => "setOrigins" | .setGuardian => "setGuardian"
  | .ownerEpoch => "ownerEpoch" | .setOwners => "setOwners"

def TreeOp.all : List TreeOp :=
  [.genesis, .signIn, .ticket, .withdraw, .claim, .confirm, .relayAdd, .relayRemove, .setAvenPeer, .setOrigins,
   .setGuardian, .ownerEpoch, .setOwners]

theorem TreeOp.mem_all (o : TreeOp) : o ∈ TreeOp.all := by cases o <;> simp [TreeOp.all]

open Body in
/-- An op's stored form, `{"op": name, "plugin": "tree/1"}`, its keys in the codec's order. -/
def TreeOp.value (o : TreeOp) : Core.Value := .map [(utf8 "op", text o.name), (utf8 "plugin", text "tree/1")]

/-- An op's id: the name of its stored form. -/
def TreeOp.id (H : Core.Bytes → Core.Hash) (o : TreeOp) : Core.OpId := Core.nameOf H o.value

/-- The ops' ids differ. -/
def TreeOp.distinct (H : Core.Bytes → Core.Hash) : Prop := ∀ a b : TreeOp, a.id H = b.id H → a = b

/-- The op whose id this is. -/
def TreeOp.ofId (H : Core.Bytes → Core.Hash) (id : Core.Bytes) : Option TreeOp :=
  TreeOp.all.find? fun o => (o.id H).bytes == id

theorem TreeOp.ofId_id {H : Core.Bytes → Core.Hash} (d : TreeOp.distinct H) (o : TreeOp) :
    TreeOp.ofId H (o.id H).bytes = some o := by
  unfold TreeOp.ofId
  cases e : TreeOp.all.find? fun x => (x.id H).bytes == (o.id H).bytes with
  | none =>
    exact absurd e (by simpa [List.find?_eq_none] using ⟨o, TreeOp.mem_all o, rfl⟩)
  | some x =>
    have := List.find?_some e
    simp only [beq_iff_eq] at this
    exact congrArg some (d x o (by cases hx : x.id H; cases ho : o.id H; simp_all))

/-- The op a statement calls. -/
def TreeSays.op : TreeSays → TreeOp
  | .genesis _ => .genesis | .signIn .. => .signIn | .ticket _ => .ticket | .withdrawal _ => .withdraw
  | .claim .. => .claim | .confirm _ => .confirm | .relayAdd _ => .relayAdd | .relayRemove _ => .relayRemove
  | .setAvenPeer _ => .setAvenPeer | .setOrigins _ => .setOrigins | .setGuardian _ => .setGuardian
  | .ownerEpoch .. => .ownerEpoch | .setOwners .. => .setOwners

open Body in
/-- A statement's params, in the codec's order: shorter keys first, then by their bytes. -/
def TreeSays.params : TreeSays → List (Core.Bytes × Core.Value)
  | .genesis g => [(utf8 "genesis", g.toValue)]
  | .signIn d => [(utf8 "device", text d)]
  | .ticket k => [(utf8 "key", text k)]
  | .withdrawal t => [(utf8 "ticket", ref t)]
  | .claim t v p ds g =>
    [(utf8 "vault", text v), (utf8 "ticket", ref t), (utf8 "devices", texts ds), (utf8 "passkey", p.toValue),
     (utf8 "guardian", text g)]
  | .confirm c => [(utf8 "claim", ref c)]
  | .relayAdd v | .relayRemove v | .setGuardian v => [(utf8 "vault", text v)]
  | .setAvenPeer k => [(utf8 "key", text k)]
  | .setOrigins os => [(utf8 "origins", texts os)]
  | .ownerEpoch c o se e =>
    [(utf8 "seal", text se), (utf8 "epoch", .uint e), (utf8 "owner", o.toValue), (utf8 "credential", text c)]
  | .setOwners v os th =>
    [(utf8 "vault", text v), (utf8 "owners", .array (os.map Owner.toValue)), (utf8 "threshold", .uint th)]

/-- A statement as the call its envelope carries. -/
def TreeSays.call (H : Core.Bytes → Core.Hash) (s : TreeSays) : Core.Call := ⟨s.op.id H, s.params⟩

/-- The body of a tree statement: its call. -/
def TreeSays.toValue (H : Core.Bytes → Core.Hash) (s : TreeSays) : Core.Value := (s.call H).value

open Body in
/-- A statement from an op and its params. -/
def TreeSays.ofParams : TreeOp → List (Core.Bytes × Core.Value) → Option TreeSays
  | .genesis, [(kg, g)] => if kg == utf8 "genesis" then .genesis <$> Genesis.ofValue g else none
  | .signIn, [(kd, d)] => if kd == utf8 "device" then .signIn <$> ofText d else none
  | .ticket, [(kk, k)] => if kk == utf8 "key" then .ticket <$> ofText k else none
  | .withdraw, [(kt, t)] => if kt == utf8 "ticket" then .withdrawal <$> ofRef t else none
  | .claim, [(kv, v), (kt, t), (kd, ds), (kp, p), (kg, g)] =>
    if kv == utf8 "vault" && kt == utf8 "ticket" && kd == utf8 "devices" && kp == utf8 "passkey" &&
        kg == utf8 "guardian" then
      do pure (.claim (← ofRef t) (← ofText v) (← Passkey.ofValue p) (← ofTexts ds) (← ofText g))
    else none
  | .confirm, [(kc, c)] => if kc == utf8 "claim" then .confirm <$> ofRef c else none
  | .relayAdd, [(kv, v)] => if kv == utf8 "vault" then .relayAdd <$> ofText v else none
  | .relayRemove, [(kv, v)] => if kv == utf8 "vault" then .relayRemove <$> ofText v else none
  | .setAvenPeer, [(kk, k)] => if kk == utf8 "key" then .setAvenPeer <$> ofText k else none
  | .setOrigins, [(ko, os)] => if ko == utf8 "origins" then .setOrigins <$> ofTexts os else none
  | .setGuardian, [(kv, v)] => if kv == utf8 "vault" then .setGuardian <$> ofText v else none
  | .ownerEpoch, [(ks, se), (ke, .uint e), (ko, o), (kc, c)] =>
    if ks == utf8 "seal" && ke == utf8 "epoch" && ko == utf8 "owner" && kc == utf8 "credential" then
      do pure (.ownerEpoch (← ofText c) (← HybridKey.ofValue o) (← ofText se) e)
    else none
  | .setOwners, [(kv, v), (ko, .array os), (kt, .uint th)] =>
    if kv == utf8 "vault" && ko == utf8 "owners" && kt == utf8 "threshold" then
      do pure (.setOwners (← ofText v) (← os.mapM Owner.ofValue) th)
    else none
  | _, _ => none

/-- A body read back as the statement it calls, if it is exactly a call of one of `tree/1`'s ops: the call it reads
encodes back to it. -/
def TreeSays.ofValue (H : Core.Bytes → Core.Hash) (v : Core.Value) : Option TreeSays :=
  match v with
  | .map [(_, .bytes id), (_, .map ps)] =>
    if (Core.Call.mk ⟨id⟩ ps).value == v then (TreeOp.ofId H id).bind fun o => TreeSays.ofParams o ps else none
  | _ => none

/-- The names a body refers to, each a 32-byte name. -/
def TreeSays.refsOk : TreeSays → Bool
  | .withdrawal t | .claim t .. | .confirm t => t.ok
  | _ => true

theorem TreeSays.ofParams_params (s : TreeSays) (h : s.refsOk) : ofParams s.op s.params = some s := by
  cases s <;> simp_all [op, params, ofParams, refsOk, Body.ofText_text, Body.ofTexts_texts, Body.ofRef_ref,
    Genesis.ofValue_toValue, Passkey.ofValue_toValue, HybridKey.ofValue_toValue, Owner.ofValues]

/-- A body reads back as the statement it was made from, whenever the ops' ids differ. -/
theorem TreeSays.ofValue_toValue {H : Core.Bytes → Core.Hash} (d : TreeOp.distinct H) (s : TreeSays)
    (h : s.refsOk) : ofValue H (s.toValue H) = some s := by
  simp [ofValue, toValue, call, Core.Call.value, TreeOp.ofId_id d, ofParams_params s h]

/-- A passkey record for the checks below. -/
def carolKey : Passkey := ⟨"carol-credential", "carol-passkey", some ⟨"carol-ed25519", "carol-ml-dsa"⟩, none, 1⟩

-- under BLAKE3, `tree/1`'s ids differ, and the stored forms and the calls are canonical
#guard (TreeOp.all.map fun o => (o.id Core.blake3).bytes).eraseDups.length == TreeOp.all.length
#guard TreeOp.all.all fun o => Core.Canon o.value
#guard Core.Canon ((TreeSays.claim ⟨Core.be 32 7⟩ "carol" carolKey ["carol-light"] "guardian").toValue Core.blake3)
#guard TreeSays.ofValue Core.blake3
    ((TreeSays.claim ⟨Core.be 32 7⟩ "carol" carolKey ["carol-light"] "guardian").toValue Core.blake3) ==
  some (.claim ⟨Core.be 32 7⟩ "carol" carolKey ["carol-light"] "guardian")
#guard TreeSays.ofValue Core.blake3 (.array [Body.text "nope"]) == none

/-- A tree statement, as a peer reads it from the envelope it stores by name (A30): its name, the key that signed it,
its parents (the names of the tree's newest statements it saw), and what it says. -/
structure TreeStatement where
  name : Core.Hash
  signer : String
  parents : List Core.Hash
  says : TreeSays
  /-- the other keys whose signatures sit beside its name (A30): approvals of the same act, k of n (D14) -/
  approvals : List String
  deriving DecidableEq, Repr

/-- Every key that signed a statement: its signer and its approvals. -/
def TreeStatement.keys (s : TreeStatement) : List String := s.signer :: s.approvals

/-- The ticket a claim claims. -/
def TreeStatement.ticketOf (s : TreeStatement) : Option Core.Hash :=
  match s.says with
  | .claim t .. => some t
  | _ => none

/-- The tree `settle` gives: which statements count, which claims are final and which stand, the member vaults, the
devices the door admits, and the relay list. -/
structure Settled where
  counted : Core.Hash → Bool
  final : Core.Hash → Bool
  standing : Core.Hash → Bool
  /-- Tickets with two final claims: two confirmers confirmed different claims without seeing each other. -/
  contested : Core.Hash → Bool
  member : String → Bool
  admits : String → Bool
  relay : String → Bool
  /-- the Aven Peer's device key now: the genesis's, or Maia City's latest change of it -/
  avenPeer : String → Bool
  /-- avenOS's origins now -/
  origin : String → Bool
  /-- MaiaCityGuardian's vault now -/
  guardianVault : String → Bool

instance : Core.Past.Parents TreeStatement := ⟨TreeStatement.parents⟩

open Core.Past (Before past inPast found_iff)

namespace Settle

/-! ### The past: Core's (A30)

A statement's parents are the tips it saw. `Aven.Core.Past` decides the past over them by the names a peer stores
statements under (`Before`, `inPast`), as it does for every Doc's envelopes. -/

variable {S S' : List TreeStatement} {a b c : TreeStatement}

/-- `inPast` decides `Before` for a statement of `S`. -/
theorem inPast_iff (m : b ∈ S) : inPast TreeStatement.name S a b = true ↔ Before TreeStatement.name S a b :=
  Core.Past.inPast_iff m

theorem inPast_set (h : ∀ x, x ∈ S ↔ x ∈ S') : inPast TreeStatement.name S = inPast TreeStatement.name S' := by
  funext a b
  apply Bool.eq_iff_iff.mpr
  rw [Core.Past.inPast, Core.Past.inPast, found_iff, found_iff]
  constructor <;> rintro ⟨y, m, e, p⟩
  · exact ⟨y, (h y).mp m, e, p.mono fun x m => (h x).mp m⟩
  · exact ⟨y, (h y).mpr m, e, p.mono fun x m => (h x).mpr m⟩

theorem any_set {l l' : List TreeStatement} (h : ∀ x, x ∈ l ↔ x ∈ l') (p : TreeStatement → Bool) :
    l.any p = l'.any p := by
  apply Bool.eq_iff_iff.mpr
  simp only [List.any_eq_true, h]

theorem all_set {l l' : List TreeStatement} (h : ∀ x, x ∈ l ↔ x ∈ l') (p : TreeStatement → Bool) :
    l.all p = l'.all p := by
  apply Bool.eq_iff_iff.mpr
  simp only [List.all_eq_true, h]

/-! ### What counts -/

variable (pinned : Core.Hash)

/-- The pinned genesis: its name is the pinned one, it is the first statement, building on nothing, it passes its own
checks, and both its signers are there. -/
def pinnedGenesis (g : TreeStatement) : Bool :=
  g.name == pinned && g.parents.isEmpty &&
    match g.says with
    | .genesis gen => gen.consented
    | _ => false

/-- A descendant of the pinned genesis among `S`: the genesis, or a statement with it in its past. -/
def Desc (S : List TreeStatement) (s : TreeStatement) : Prop :=
  pinnedGenesis pinned s = true ∨ ∃ g ∈ S, pinnedGenesis pinned g = true ∧ Before TreeStatement.name S s g

end Settle

/-- What the tree type's fit takes (A39, A149): the setup, its root Record, only whole at birth, in the first statement,
which builds on nothing; it refuses it anywhere else, so no later statement edits it. -/
def TreeStatement.fit (s : TreeStatement) : Bool :=
  match s.says with
  | .genesis _ => s.parents.isEmpty
  | _ => true

/-- Every parent `x` names is held: the name of a statement of `S`. -/
def TreeStatement.parentsHeld (S : List TreeStatement) (x : TreeStatement) : Bool :=
  x.parents.all fun h => S.any (·.name == h)

namespace Settle

variable (pinned : Core.Hash)
variable {S S' : List TreeStatement} {a b c : TreeStatement}

/-- `s`'s whole past is held (rule 11): it and everything before it name only parents `S` holds. This is Core's
`Closed`, read through `Aven.Core.Past` (`Aven.Core.Past.reaches_iff`: Core's past is the envelope and what is `Before`
it). A statement built on a parent a peer lacks waits, and counts for nothing until it comes. -/
def Closed (S : List TreeStatement) (s : TreeStatement) : Prop :=
  ∀ x, (x = s ∨ Before TreeStatement.name S s x) → ∀ h ∈ x.parents, ∃ y ∈ S, y.name = h

/-- What counts, as Core's `Counts` judges it (A45, A191): a descendant of the pinned genesis whose whole past is held
(`Closed`) and fits, all of it. Splits don't arise: a statement is its own log's one envelope. -/
def Counts (S : List TreeStatement) (s : TreeStatement) : Prop :=
  Desc pinned S s ∧ Closed S s ∧ ∀ x, (x = s ∨ Before TreeStatement.name S s x) → x.fit = true

/-- Part of the tree: it counts, decided. -/
def counted (S : List TreeStatement) (s : TreeStatement) : Bool :=
  (pinnedGenesis pinned s || S.any fun g => pinnedGenesis pinned g && inPast TreeStatement.name S s g) &&
    (s.parentsHeld S && S.all fun x => !inPast TreeStatement.name S s x || x.parentsHeld S) &&
    (s.fit && S.all fun x => !inPast TreeStatement.name S s x || x.fit)

theorem parentsHeld_iff {x : TreeStatement} : x.parentsHeld S = true ↔ ∀ h ∈ x.parents, ∃ y ∈ S, y.name = h := by
  simp [TreeStatement.parentsHeld]

/-- Over a statement's past and itself, decided. -/
theorem past_all {p : TreeStatement → Bool} :
    (p s && S.all fun x => !inPast TreeStatement.name S s x || p x) = true ↔
      ∀ x, (x = s ∨ Before TreeStatement.name S s x) → p x = true := by
  simp only [Bool.and_eq_true, List.all_eq_true, Bool.or_eq_true, Bool.not_eq_true']
  constructor
  · rintro ⟨hs, h⟩ x (rfl | bx)
    · exact hs
    · rcases h x bx.mem with e | e
      · rw [(inPast_iff bx.mem).mpr bx] at e; cases e
      · exact e
  · intro h
    refine ⟨h s (.inl rfl), fun x m => ?_⟩
    cases e : inPast TreeStatement.name S s x
    · exact .inl rfl
    · exact .inr (h x (.inr ((inPast_iff m).mp e)))

theorem counted_iff : counted pinned S s = true ↔ Counts pinned S s := by
  have hd : (pinnedGenesis pinned s || S.any fun g => pinnedGenesis pinned g && inPast TreeStatement.name S s g) =
      true ↔ Desc pinned S s := by
    simp only [Desc, Bool.and_eq_true, Bool.or_eq_true, List.any_eq_true]
    constructor
    · rintro (g | ⟨g, m, pg, p⟩)
      · exact .inl g
      · exact .inr ⟨g, m, pg, (inPast_iff m).mp p⟩
    · rintro (g | ⟨g, m, pg, p⟩)
      · exact .inl g
      · exact .inr ⟨g, m, pg, (inPast_iff m).mpr p⟩
  have hc : (s.parentsHeld S && S.all fun x => !inPast TreeStatement.name S s x || x.parentsHeld S) = true ↔
      Closed S s := by
    rw [past_all (p := TreeStatement.parentsHeld S)]
    exact ⟨fun h x hx => parentsHeld_iff.mp (h x hx), fun h x hx => parentsHeld_iff.mpr (h x hx)⟩
  have hf := past_all (S := S) (s := s) (p := TreeStatement.fit)
  unfold counted
  constructor
  · intro h
    have h1 := (Bool.and_eq_true _ _).mp h
    have h2 := (Bool.and_eq_true _ _).mp h1.1
    exact ⟨hd.mp h2.1, hc.mp h2.2, hf.mp h1.2⟩
  · rintro ⟨d, cl, ft⟩
    exact (Bool.and_eq_true _ _).mpr ⟨(Bool.and_eq_true _ _).mpr ⟨hd.mpr d, hc.mpr cl⟩, hf.mpr ft⟩

theorem Counts.desc (h : Counts pinned S s) : Desc pinned S s := h.1

/-- What the rest of `settle` reads: the pinned name, the counted statements, and the past between them. -/
structure View where
  pinned : Core.Hash
  any : (TreeStatement → Bool) → Bool
  all : (TreeStatement → Bool) → Bool
  past : TreeStatement → TreeStatement → Bool

/-- Each statement of `C` with the names in its past among `S`, worked out once. -/
def pastTable (S C : List TreeStatement) : List (TreeStatement × List Core.Hash) :=
  C.map fun x => (x, past TreeStatement.name S x)

/-- A statement's row of a table, if it has one. -/
def row (T : List (TreeStatement × List Core.Hash)) (a : TreeStatement) : Option (List Core.Hash) :=
  (T.find? (·.1 == a)).map (·.2)

/-- The counted statements once, and each one's past once: a reader holds the past between them. -/
def view (S : List TreeStatement) : View :=
  let C := S.filter (counted pinned S)
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

/-- An admin act's keys: Maia City's owners approve it (`Tree.approves`, D14), k of n by each vault's stored threshold
(`Tree.threshold`, A28), recursive through the vaults that own the coop, down to their owner keys. The admin is Maia
City's vault, never a key (rule 15, A28): tickets, withdrawals and the relay list count only so. A device's key owns
nothing, so it never approves (`device_not_admin`); "the more secure way" (Samuel, 31 Oct 2026) holds. -/
def byAdmin (v : View) (ks : List String) : Bool :=
  gen v (fun g => g.tree.approves g.tree.threshold g.coop stmtDigest (ks.map (⟨·, stmtDigest⟩)))

/-- Passkey `p` added its owner and seal keys (`ownerEpoch`, signed by `p`'s ES256). -/
def ownerAdded (v : View) (p : String) : Bool :=
  v.any fun s => s.signer == p && match s.says with
    | .ownerEpoch .. => true
    | _ => false

/-- A confirmation's signer (A38, A42's one answer): a key acting for a vault that holds Maia City's standing confirm
cap, which the genesis grants with its owners' approval (rule 15). A vault acts by its owners' approval
(`Tree.approves` on it) or by its devices: the claimant's first devices or the Aven Peer when the claimant's vault or
Aven's holds it, or a device that vault's owners signed in (its device cap). No other key confirms, not even Maia
City's owners as such. The confirm op is bounded by what it confirms: only a claim of a ticket Maia City issued,
standing (not withdrawn, not beaten). -/
def confirmer (v : View) (k : String) : Bool :=
  gen v (fun g => g.confirmers.any fun x => g.tree.approves g.tree.threshold x stmtDigest [⟨k, stmtDigest⟩]) ||
    gen v (fun g => (g.confirmers.contains g.claimant && g.devices.contains k) ||
      (g.confirmers.contains g.agent && k == g.avenPeer)) ||
    v.any fun s =>
      match s.says with
      | .signIn d =>
        d == k && (gen v (fun g => g.confirmers.contains g.claimant && s.signer == g.passkey.spki &&
          g.passkey.owner.isSome) ||
          gen v (fun g => g.confirmers.contains g.claimant && s.signer == g.passkey.spki) && ownerAdded v s.signer)
      | _ => false

/-- A change Maia City's owners approved (rule 15, A28): `sel` picks which setting it changes. -/
def configBy (v : View) (sel : TreeSays → Bool) (s : TreeStatement) : Bool := byAdmin v s.keys && sel s.says

def isGuardianSet : TreeSays → Bool | .setGuardian _ => true | _ => false

/-- `x` is a guardian vault Maia City named, as `c` saw it: the genesis's, or one an approved change in `c`'s past
set. Which one new vaults are founded with now is the latest (`Settled.guardianVault`), and an honest confirmer
confirms only a claim that names it (`confirmPolicy`); a change never touches a vault founded before it (A42). -/
def guardianNamed (v : View) (c : TreeStatement) (x : String) : Bool :=
  gen v (fun g => g.guardianVault == x) ||
    v.any fun s => configBy v isGuardianSet s && s.says == .setGuardian x && v.past c s

/-- A claim that counts: its ticket was issued by an admin passkey, is in its past and has the one-time key that signed
the claim, and it names a guardian vault Maia City named, as the claim saw it (`guardianNamed`, A13, A42). -/
def claimOk (v : View) (c : TreeStatement) : Bool :=
  match c.says with
  | .claim t _ _ _ guardian =>
    (v.any fun s => s.name == t && byAdmin v s.keys && s.says == .ticket c.signer && v.past c s) &&
      guardianNamed v c guardian
  | _ => false

/-- Two claims of one ticket. -/
def sameTicket (c d : TreeStatement) : Bool := c.ticketOf.isSome && c.ticketOf == d.ticketOf

/-- A claim is final once a confirmation that names it has it in its past: its vault holds a member cap (A38). -/
def final (v : View) (c : TreeStatement) : Bool :=
  claimOk v c && v.any fun a => confirmer v a.signer && a.says == .confirm c.name && v.past a c

/-- `w` wins over claim `c`: an admin passkey's withdrawal of its ticket that didn't have it in its past. -/
def beats (v : View) (w c : TreeStatement) : Bool :=
  match c.ticketOf with
  | some t => byAdmin v w.keys && w.says == .withdrawal t && !v.past w c
  | none => false

/-- A claim stands: of its ticket's final claims the one with the smallest hash; if none is final, of the claims no
withdrawal wins over, the one with the smallest hash. -/
def standing (v : View) (c : TreeStatement) : Bool :=
  claimOk v c &&
    if v.any (fun f => final v f && sameTicket f c) then
      final v c && v.all fun f => !(final v f && sameTicket f c) || hashAtMost c.name f.name
    else
      !(v.any fun w => beats v w c) &&
        v.all fun d => !(claimOk v d && sameTicket d c && !(v.any fun w => beats v w d)) || hashAtMost c.name d.name

/-- A member vault: the claimant's, the admin coop, the agent, and every vault a standing claim founds once it is
confirmed, which is its member cap (A38). -/
def member (v : View) (vault : String) : Bool :=
  gen v (fun g => vault == g.claimant || vault == g.coop || vault == g.agent) ||
    v.any fun c =>
      standing v c && final v c &&
        match c.says with
        | .claim _ founded _ _ _ => founded == vault
        | _ => false

/-- `p` is the passkey of some vault and has an owner: `passkeyOf` for whichever vault the register maps it to. -/
def signsIn (v : View) (p : String) : Bool :=
  (gen v (fun g => p == g.passkey.spki && g.passkey.owner.isSome) ||
    gen v (fun g => p == g.passkey.spki) && ownerAdded v p) ||
    v.any fun c =>
      standing v c && final v c &&
        match c.says with
        | .claim _ _ pk _ _ => pk.spki == p && (pk.owner.isSome || ownerAdded v p)
        | _ => false

/-- `p` is the passkey of `vault` and has an owner, so it signs `vault`'s sign-ins (caps rule 21): the claimant's
passkey for the claimant's vault, or a standing, final claim's passkey for the vault it founds; its record names an
owner, or the passkey added one (`ownerEpoch`). The register maps a passkey to its vault, so a sign-in names none
(`signIn_own_vault`). -/
def passkeyOf (v : View) (vault p : String) : Bool :=
  (gen v (fun g => vault == g.claimant && p == g.passkey.spki && g.passkey.owner.isSome) ||
    gen v (fun g => vault == g.claimant && p == g.passkey.spki) && ownerAdded v p) ||
    v.any fun c =>
      standing v c && final v c &&
        match c.says with
        | .claim _ founded pk _ _ => founded == vault && pk.spki == p && (pk.owner.isSome || ownerAdded v p)
        | _ => false

/-- The latest such change: no approved change of the same setting has it in its past, and of the changes nothing
came after, it has the smallest name. Concurrent changes settle the same everywhere. -/
def latest (v : View) (sel : TreeSays → Bool) (s : TreeStatement) : Bool :=
  configBy v sel s && (v.all fun t => !(configBy v sel t && v.past t s)) &&
    v.all fun t => !(configBy v sel t && (v.all fun u => !(configBy v sel u && v.past u t)) &&
      decide (hashNum t.name < hashNum s.name))

def isPeerSet : TreeSays → Bool | .setAvenPeer _ => true | _ => false
def isOriginsSet : TreeSays → Bool | .setOrigins _ => true | _ => false

/-- A setting now: the latest approved change's, or the genesis's while there is none. -/
def setting (v : View) (sel : TreeSays → Bool) (now : TreeSays → Bool) (genesis : Genesis → Bool) : Bool :=
  if v.any (configBy v sel) then v.any fun s => latest v sel s && now s.says else gen v genesis

/-- The Aven Peer's device key now. -/
def peerIs (v : View) (d : String) : Bool :=
  setting v isPeerSet (· == .setAvenPeer d) (fun g => g.avenPeer == d)

/-- `d` is a device of `vault`: the claimant's first devices, the agent's Aven Peer, a standing claim's devices, or a
device the vault's passkey signed in. -/
def deviceOf (v : View) (vault d : String) : Bool :=
  (gen v (fun g => vault == g.claimant && g.devices.contains d) || (gen v (fun g => vault == g.agent) && peerIs v d)) ||
    (v.any fun c =>
      standing v c && final v c &&
        match c.says with
        | .claim _ founded _ devs _ => founded == vault && devs.contains d
        | _ => false) ||
    v.any fun s =>
      match s.says with
      | .signIn dev => dev == d && passkeyOf v vault s.signer
      | _ => false

/-- The door admits the devices of the member vaults (K12). -/
def admits (v : View) (d : String) : Bool :=
  (gen v (fun g => g.devices.contains d) || peerIs v d) ||
    (v.any fun c =>
      standing v c && final v c &&
        match c.says with
        | .claim _ _ _ devs _ => devs.contains d
        | _ => false) ||
    v.any fun s =>
      match s.says with
      | .signIn dev => dev == d && signsIn v s.signer
      | _ => false

/-- A list's entry stands while an admin act's add of it has every admin act's remove of it in its past: a remove wins
over every add that hadn't seen it, the ones it saw and the ones made at the same time, and an add made after it
stands again. -/
def listed (v : View) (add remove : String → TreeSays) (d : String) : Bool :=
  v.any fun a => byAdmin v a.keys && a.says == add d &&
    !(v.any fun r => byAdmin v r.keys && r.says == remove d && !v.past a r)

/-! ### Reading the view -/

theorem view_any {p : TreeStatement → Bool} :
    (view pinned S).any p = true ↔ ∃ x ∈ S, counted pinned S x = true ∧ p x = true := by
  simp only [view, List.any_eq_true, List.mem_filter, and_assoc]

theorem view_all_iff {p : TreeStatement → Bool} :
    (view pinned S).all p = true ↔ ∀ x ∈ S, counted pinned S x = true → p x = true := by
  simp only [view, List.all_eq_true, List.mem_filter, and_imp]

theorem view_all {p : TreeStatement → Bool} (h : (view pinned S).all p = true) {x : TreeStatement} (m : x ∈ S)
    (cx : counted pinned S x = true) : p x = true :=
  (view_all_iff pinned).mp h x m cx

theorem row_table {C : List TreeStatement} :
    row (pastTable S C) a = if a ∈ C then some (past TreeStatement.name S a) else none := by
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

theorem view_past : (view pinned S).past a b = true ↔
    (a ∈ S ∧ counted pinned S a = true) ∧ (b ∈ S ∧ counted pinned S b = true) ∧
      Before TreeStatement.name S a b := by
  have key : (b ∈ S ∧ (past TreeStatement.name S a).contains b.name = true) ↔ Before TreeStatement.name S a b :=
    ⟨fun ⟨m, k⟩ => (inPast_iff m).mp k, fun p => ⟨p.mem, (inPast_iff p.mem).mpr p⟩⟩
  simp only [view, row_table, Bool.and_eq_true, List.contains_iff_mem, List.mem_filter]
  by_cases ma : a ∈ S ∧ counted pinned S a = true
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

theorem claimOk_counted (h : claimOk (view pinned S) c = true) : counted pinned S c = true := by
  unfold claimOk at h
  split at h
  · simp only [Bool.and_eq_true, view_any] at h
    obtain ⟨⟨x, _, _, hx⟩, _⟩ := h
    exact ((view_past pinned).mp hx.2).1.2
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

theorem sameTicket_of {c d : TreeStatement} {t : Core.Hash} (hc : c.ticketOf = some t) (hd : d.ticketOf = some t) :
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
  avenPeer := peerIs v
  origin o := setting v isOriginsSet (fun x => match x with | .setOrigins os => os.contains o | _ => false)
    (fun g => g.origins.contains o)
  guardianVault x := setting v isGuardianSet (· == .setGuardian x) (fun g => g.guardianVault == x)

end Settle

open Settle in
/-- The tree from a set of statements that passed their own checks (signatures, assertions, texts; `TreeDoc.read`
reads them from the envelopes a peer stores), and `pinned` the genesis's name that every member pins. A statement that
fails its checks is not in the set, so it carries no other's past. -/
def settle (pinned : Core.Hash) (S : List TreeStatement) : Settled :=
  settleView (view pinned S)

namespace Settle

variable (pinned : Core.Hash)
variable {S S' X : List TreeStatement} {a b c : TreeStatement}

/-! ### `settle_perm`: no order is an input -/

theorem counts_set (h : ∀ x, x ∈ S ↔ x ∈ S') {s : TreeStatement} : Counts pinned S s → Counts pinned S' s := by
  have sub : ∀ x ∈ S, x ∈ S' := fun x m => (h x).mp m
  have bk : ∀ {x}, (x = s ∨ Before TreeStatement.name S' s x) → x = s ∨ Before TreeStatement.name S s x :=
    fun hx => hx.imp_right (Before.mono fun x m => (h x).mpr m)
  rintro ⟨d, cl, ft⟩
  refine ⟨?_, fun x hx k mk => ?_, fun x hx => ft x (bk hx)⟩
  · rcases d with g | ⟨g, mg, pg, sg⟩
    · exact .inl g
    · exact .inr ⟨g, sub g mg, pg, sg.mono sub⟩
  · obtain ⟨y, my, ny⟩ := cl x (bk hx) k mk
    exact ⟨y, sub y my, ny⟩

theorem counted_set (h : ∀ x, x ∈ S ↔ x ∈ S') : counted pinned S = counted pinned S' := by
  funext s
  apply Bool.eq_iff_iff.mpr
  rw [counted_iff, counted_iff]
  exact ⟨counts_set pinned h, counts_set pinned fun x => (h x).symm⟩

theorem View.ext' {v w : View} (p : v.pinned = w.pinned) (a : v.any = w.any) (l : v.all = w.all)
    (q : v.past = w.past) : v = w := by
  cases v
  cases w
  simp_all

theorem past_set (h : ∀ x, x ∈ S ↔ x ∈ S') :
    Before TreeStatement.name S a b ↔ Before TreeStatement.name S' a b :=
  ⟨Before.mono fun x m => (h x).mp m, Before.mono fun x m => (h x).mpr m⟩

theorem view_set (h : ∀ x, x ∈ S ↔ x ∈ S') : view pinned S = view pinned S' := by
  have hc := counted_set pinned h
  have hf : ∀ x, x ∈ S.filter (counted pinned S) ↔ x ∈ S'.filter (counted pinned S') := by
    intro x
    simp only [List.mem_filter, h, hc]
  refine View.ext' rfl (funext (any_set hf)) (funext (all_set hf)) (funext fun a => funext fun b => ?_)
  apply Bool.eq_iff_iff.mpr
  rw [view_past, view_past, hc, past_set h, h, h]

end Settle

open Settle in
/-- Two peers holding the same statements, in whatever order they came, settle the same tree. -/
theorem settle_perm (pinned : Core.Hash) {S S' : List TreeStatement}
    (h : ∀ x, x ∈ S ↔ x ∈ S') : settle pinned S = settle pinned S' := by
  simp only [settle, view_set pinned h]

namespace Settle

variable (pinned : Core.Hash)
variable {S S' X : List TreeStatement} {a b c : TreeStatement}

/-! ### `settle_genesis`: only the pinned genesis's descendants count -/

/-- From a statement of `S`, the past never reaches a statement of `X` that nothing of `S` names. -/
theorem before_without (hN : ∀ x ∈ X, ∀ s ∈ S, x.name ∉ s.parents) (ma : a ∈ S)
    (h : Before TreeStatement.name (S ++ X) a c) : c ∈ S ∧ Before TreeStatement.name S a c := by
  induction h with
  | tip m t =>
    rcases List.mem_append.mp m with m | m
    · exact ⟨m, .tip m t⟩
    · exact absurd t (hN _ m _ ma)
  | step _ m t ih =>
    obtain ⟨mb, bb⟩ := ih
    rcases List.mem_append.mp m with m | m
    · exact ⟨m, .step bb m t⟩
    · exact absurd t (hN _ m _ mb)

theorem counts_without (hN : ∀ x ∈ X, ∀ s ∈ S, x.name ∉ s.parents) {s : TreeStatement} (ms : s ∈ S) :
    Counts pinned (S ++ X) s ↔ Counts pinned S s := by
  have sub : ∀ x ∈ S, x ∈ S ++ X := fun x m => List.mem_append_left _ m
  have back : ∀ {x}, (x = s ∨ Before TreeStatement.name (S ++ X) s x) → x ∈ S ∧ (x = s ∨ Before TreeStatement.name S s x) :=
    fun {x} h => by
      rcases h with rfl | h
      · exact ⟨ms, .inl rfl⟩
      · obtain ⟨m, b⟩ := before_without hN ms h
        exact ⟨m, .inr b⟩
  have fwd : ∀ {x}, (x = s ∨ Before TreeStatement.name S s x) → x = s ∨ Before TreeStatement.name (S ++ X) s x :=
    fun {x} h => h.imp_right (Before.mono sub)
  constructor
  · rintro ⟨d, cl, ft⟩
    refine ⟨?_, fun x hx h mh => ?_, fun x hx => ft x (fwd hx)⟩
    · rcases d with g | ⟨g, _, pg, sg⟩
      · exact .inl g
      · obtain ⟨mg, sg⟩ := before_without hN ms sg
        exact .inr ⟨g, mg, pg, sg⟩
    · obtain ⟨y, my, ny⟩ := cl x (fwd hx) h mh
      rcases List.mem_append.mp my with my | my
      · exact ⟨y, my, ny⟩
      · have mx : x ∈ S := by
          rcases hx with rfl | hx
          · exact ms
          · exact hx.mem
        exact absurd (ny ▸ mh) (hN y my x mx)
  · rintro ⟨d, cl, ft⟩
    refine ⟨?_, fun x hx h mh => ?_, fun x hx => ft x (back hx).2⟩
    · rcases d with g | ⟨g, mg, pg, sg⟩
      · exact .inl g
      · exact .inr ⟨g, sub g mg, pg, sg.mono sub⟩
    · obtain ⟨y, my, ny⟩ := cl x (back hx).2 h mh
      exact ⟨y, sub y my, ny⟩

theorem counted_without (hX : ∀ x ∈ X, ¬ Desc pinned (S ++ X) x) (hN : ∀ x ∈ X, ∀ s ∈ S, x.name ∉ s.parents)
    {s : TreeStatement} (m : s ∈ S ++ X) : counted pinned (S ++ X) s = (s ∈ S && counted pinned S s) := by
  by_cases ms : s ∈ S
  · apply Bool.eq_iff_iff.mpr
    simp only [ms, decide_true, Bool.true_and]
    rw [counted_iff, counted_iff, counts_without pinned hN ms]
  · have mx : s ∈ X := (List.mem_append.mp m).resolve_left ms
    simp only [ms, decide_false, Bool.false_and]
    cases e : counted pinned (S ++ X) s
    · rfl
    · exact absurd ((counted_iff pinned).mp e).desc (hX s mx)

theorem view_without (hX : ∀ x ∈ X, ¬ Desc pinned (S ++ X) x) (hN : ∀ x ∈ X, ∀ s ∈ S, x.name ∉ s.parents) :
    view pinned (S ++ X) = view pinned S := by
  have hm : ∀ x, x ∈ S ++ X ∧ counted pinned (S ++ X) x = true ↔ x ∈ S ∧ counted pinned S x = true := by
    intro x
    constructor
    · rintro ⟨m, c⟩
      rw [counted_without pinned hX hN m] at c
      simpa using c
    · rintro ⟨m, c⟩
      have m' : x ∈ S ++ X := List.mem_append_left _ m
      exact ⟨m', by rw [counted_without pinned hX hN m']; simpa [m] using c⟩
  have hf : ∀ x, x ∈ (S ++ X).filter (counted pinned (S ++ X)) ↔ x ∈ S.filter (counted pinned S) := by
    intro x
    simp only [List.mem_filter]
    exact hm x
  refine View.ext' rfl (funext (any_set hf)) (funext (all_set hf)) (funext fun a => funext fun b => ?_)
  apply Bool.eq_iff_iff.mpr
  rw [view_past, view_past, hm, hm]
  constructor
  · rintro ⟨ha, hb, p⟩
    exact ⟨ha, hb, (before_without hN ha.1 p).2⟩
  · rintro ⟨ha, hb, p⟩
    exact ⟨ha, hb, p.mono fun x m => List.mem_append_left _ m⟩

end Settle
open Settle in
/-- Nothing outside the pinned genesis's descendants that nothing in the tree builds on changes the tree. -/
theorem settle_genesis (pinned : Core.Hash) {S X : List TreeStatement}
    (hX : ∀ x ∈ X, ¬ Desc pinned (S ++ X) x) (hN : ∀ x ∈ X, ∀ s ∈ S, x.name ∉ s.parents) :
    settle pinned (S ++ X) = settle pinned S := by
  simp only [settle, view_without pinned hX hN]

namespace Settle

variable (pinned : Core.Hash)
variable {S S' X : List TreeStatement} {a b c : TreeStatement}

/-- Every statement in the tree is the pinned genesis or has it in its past, and that genesis carries the signatures of
its claimant's passkey and of MaiaCityGuardian (A11, A13). -/
theorem genesis_pinned {s : TreeStatement} (h : counted pinned S s = true) :
    ∃ g gen, g.name = pinned ∧ g.says = .genesis gen ∧ gen.consented = true ∧
      (g = s ∨ (g ∈ S ∧ Before TreeStatement.name S s g)) := by
  have pg : ∀ {g}, pinnedGenesis pinned g = true →
      ∃ gen, g.name = pinned ∧ g.says = .genesis gen ∧ gen.consented = true := by
    intro g h
    unfold pinnedGenesis at h
    simp only [Bool.and_eq_true, beq_iff_eq] at h
    obtain ⟨⟨n, _⟩, c⟩ := h
    split at c
    · rename_i gen e
      exact ⟨gen, n, e, c⟩
    · cases c
  obtain d := ((counted_iff pinned).mp h).desc
  rcases d with g | ⟨g, mg, pgg, sg⟩
  · obtain ⟨gen, n, e, c⟩ := pg g
    exact ⟨s, gen, n, e, c, .inl rfl⟩
  · obtain ⟨gen, n, e, c⟩ := pg pgg
    exact ⟨g, gen, n, e, c, .inr ⟨mg, sg⟩⟩

/-- A claim counts only if it names a guardian vault Maia City named, as the claim saw it (A13, A42): the pinned
genesis's, or one an approved change in the claim's past set. Nobody joins without being shown who co-owns their
vault. -/
theorem guardian_consented (h : claimOk (view pinned S) c = true) :
    ∃ t vault passkey device guardian, c.says = .claim t vault passkey device guardian ∧
      ((∃ g ∈ S, g.name = pinned ∧ ∃ gen, g.says = .genesis gen ∧ gen.consented = true ∧
        gen.guardianVault = guardian) ∨
       ∃ s ∈ S, counted pinned S s = true ∧ byAdmin (view pinned S) s.keys = true ∧
        s.says = .setGuardian guardian ∧ Before TreeStatement.name S c s) := by
  unfold claimOk at h
  split at h
  · rename_i t vault passkey device guardian e
    refine ⟨t, vault, passkey, device, guardian, e, ?_⟩
    simp only [Bool.and_eq_true] at h
    have := h.2
    simp only [guardianNamed, Bool.or_eq_true] at this
    rcases this with this | this
    · left
      simp only [gen, view_any, Bool.and_eq_true, beq_iff_eq] at this
      obtain ⟨g, mg, _, n, hg⟩ := this
      split at hg
      · rename_i gen eg
        simp only [Bool.and_eq_true, beq_iff_eq] at hg
        exact ⟨g, mg, n, gen, eg, hg.1, hg.2⟩
      · cases hg
    · right
      obtain ⟨s, ms, cs, hs⟩ := (view_any pinned).mp this
      simp only [configBy, Bool.and_eq_true, beq_iff_eq] at hs
      exact ⟨s, ms, cs, hs.1.1.1, hs.1.2, ((view_past pinned).mp hs.2).2.2⟩
  · cases h

/-! ### Tickets, withdrawals and finality -/

/-- A ticket founds at most one vault: two standing claims of one ticket are one claim, by name. -/
theorem settle_ticket_once {c d : TreeStatement} (mc : c ∈ S) (md : d ∈ S)
    (hc : standing (view pinned S) c = true) (hd : standing (view pinned S) d = true)
    (same : c.ticketOf = d.ticketOf) : c.name = d.name := by
  have okc := standing_claimOk hc
  have okd := standing_claimOk hd
  have cc := claimOk_counted pinned okc
  have cd := claimOk_counted pinned okd
  obtain ⟨t, ht⟩ := claimOk_ticket okc
  have hdt : d.ticketOf = some t := same ▸ ht
  have st : ∀ f, sameTicket f c = sameTicket f d := by
    intro f
    simp [sameTicket, ht, hdt]
  have scd : sameTicket c d = true := sameTicket_of ht hdt
  have sdc : sameTicket d c = true := sameTicket_of hdt ht
  unfold standing at hc hd
  simp only [st] at hc
  by_cases hF : (view pinned S).any (fun f => final (view pinned S) f && sameTicket f d) = true
  · simp only [hF, ite_true, Bool.and_eq_true] at hc hd
    have le₁ := view_all pinned hc.2.2 md cd
    have le₂ := view_all pinned hd.2.2 mc cc
    simp only [hd.2.1, hc.2.1, sameTicket_self okd, scd, Bool.and_self, Bool.not_true, Bool.false_or] at le₁ le₂
    exact hashAtMost_antisymm le₁ le₂
  · simp only [hF, Bool.false_eq_true, ite_false, Bool.and_eq_true, Bool.not_eq_true'] at hc hd
    have le₁ := view_all pinned hc.2.2 md cd
    have le₂ := view_all pinned hd.2.2 mc cc
    simp only [okd, okc, sameTicket_self okd, scd, hd.2.1, hc.2.1, Bool.not_false, Bool.and_self, Bool.not_true,
      Bool.false_or] at le₁ le₂
    exact hashAtMost_antisymm le₁ le₂

/-- A withdrawal of a ticket leaves no claim of it standing that isn't final and wasn't in the withdrawal's past. -/
theorem settle_withdrawn {w : TreeStatement} {t : Core.Hash} (mw : w ∈ S) (cw : counted pinned S w = true)
    (aw : byAdmin (view pinned S) w.keys = true) (says : w.says = .withdrawal t) (ct : c.ticketOf = some t)
    (np : ¬ Before TreeStatement.name S w c) (nf : final (view pinned S) c = false) :
    standing (view pinned S) c = false := by
  have hb : (view pinned S).any (fun x => beats (view pinned S) x c) = true := by
    refine (view_any pinned).mpr ⟨w, mw, cw, ?_⟩
    have pf : (view pinned S).past w c = false := by
      cases e : (view pinned S).past w c
      · rfl
      · exact absurd ((view_past pinned).mp e).2.2 np
    simp [beats, ct, aw, says, pf]
  unfold standing
  split <;> simp [nf, hb]

/-! ### Monotone in the statements: what finality needs -/

/-- Past a statement whose whole past is held, more statements find nothing more: one name is one statement. -/
theorem before_closed (sub : ∀ x ∈ S, x ∈ S') (uniq : ∀ x ∈ S', ∀ y ∈ S', x.name = y.name → x = y)
    (cl : Closed S a) {x : TreeStatement} (h : Before TreeStatement.name S' a x) :
    x ∈ S ∧ Before TreeStatement.name S a x := by
  induction h with
  | tip m t =>
    obtain ⟨y, my, ny⟩ := cl a (.inl rfl) _ t
    have e := uniq y (sub y my) _ m ny
    subst e
    exact ⟨my, .tip my t⟩
  | step _ m t ih =>
    obtain ⟨mb, bb⟩ := ih
    obtain ⟨y, my, ny⟩ := cl _ (.inr bb) _ t
    have e := uniq y (sub y my) _ m ny
    subst e
    exact ⟨my, .step bb my t⟩

theorem past_closed (sub : ∀ x ∈ S, x ∈ S') (uniq : ∀ x ∈ S', ∀ y ∈ S', x.name = y.name → x = y)
    (cl : Closed S a) {x : TreeStatement} :
    Before TreeStatement.name S' a x ↔ Before TreeStatement.name S a x :=
  ⟨fun h => (before_closed sub uniq cl h).2, Before.mono sub⟩

/-- What counts keeps counting as more statements come (A191): its whole past is held, so it is the same past. -/
theorem counts_mono (sub : ∀ x ∈ S, x ∈ S') (uniq : ∀ x ∈ S', ∀ y ∈ S', x.name = y.name → x = y)
    (h : Counts pinned S a) : Counts pinned S' a := by
  obtain ⟨d, cl, ft⟩ := h
  have bk : ∀ {x}, (x = a ∨ Before TreeStatement.name S' a x) → x = a ∨ Before TreeStatement.name S a x :=
    fun hx => hx.imp_right (past_closed sub uniq cl).mp
  refine ⟨?_, fun x hx k mk => ?_, fun x hx => ft x (bk hx)⟩
  · rcases d with g | ⟨g, mg, pg, sg⟩
    · exact .inl g
    · exact .inr ⟨g, sub g mg, pg, sg.mono sub⟩
  · obtain ⟨y, my, ny⟩ := cl x (bk hx) k mk
    exact ⟨y, sub y my, ny⟩

theorem counted_mono (sub : ∀ x ∈ S, x ∈ S') (uniq : ∀ x ∈ S', ∀ y ∈ S', x.name = y.name → x = y)
    (h : counted pinned S a = true) : counted pinned S' a = true :=
  (counted_iff pinned).mpr (counts_mono pinned sub uniq ((counted_iff pinned).mp h))

theorem any_imp {p q : TreeStatement → Bool} (pq : ∀ x, p x = true → q x = true)
    (h : (view pinned S).any p = true) : (view pinned S).any q = true := by
  obtain ⟨x, m, cx, px⟩ := (view_any pinned).mp h
  exact (view_any pinned).mpr ⟨x, m, cx, pq x px⟩

section Mono

-- `S'` holds what `S` holds and more, and one name is one statement in it (names are hashes)
variable (sub : ∀ x ∈ S, x ∈ S') (uniq : ∀ x ∈ S', ∀ y ∈ S', x.name = y.name → x = y)
include sub uniq

theorem any_mono {p q : TreeStatement → Bool} (pq : ∀ x, p x = true → q x = true)
    (h : (view pinned S).any p = true) : (view pinned S').any q = true := by
  obtain ⟨x, m, cx, px⟩ := (view_any pinned).mp h
  exact (view_any pinned).mpr ⟨x, sub x m, counted_mono pinned sub uniq cx, pq x px⟩

theorem past_mono (h : (view pinned S).past a b = true) :
    (view pinned S').past a b = true := by
  obtain ⟨⟨ma, ca⟩, ⟨mb, cb⟩, p⟩ := (view_past pinned).mp h
  exact (view_past pinned).mpr
    ⟨⟨sub a ma, counted_mono pinned sub uniq ca⟩, ⟨sub b mb, counted_mono pinned sub uniq cb⟩, p.mono sub⟩

theorem gen_mono {P : Genesis → Bool} (h : gen (view pinned S) P = true) :
    gen (view pinned S') P = true :=
  any_mono pinned sub uniq (fun _ hx => hx) h

theorem ownerAdded_mono {p : String} (h : ownerAdded (view pinned S) p = true) :
    ownerAdded (view pinned S') p = true :=
  any_mono pinned sub uniq (fun _ hx => hx) h

theorem confirmer_mono {k : String} (h : confirmer (view pinned S) k = true) :
    confirmer (view pinned S') k = true := by
  unfold confirmer at h ⊢
  simp only [Bool.or_eq_true] at h ⊢
  rcases h with (h | h) | h
  · exact .inl (.inl (gen_mono pinned sub uniq h))
  · exact .inl (.inr (gen_mono pinned sub uniq h))
  · refine .inr (any_mono pinned sub uniq (fun x hx => ?_) h)
    split at hx
    · simp only [Bool.and_eq_true, Bool.or_eq_true] at hx ⊢
      refine ⟨hx.1, ?_⟩
      rcases hx.2 with g | ⟨g, o⟩
      · exact .inl (gen_mono pinned sub uniq g)
      · exact .inr ⟨gen_mono pinned sub uniq g, ownerAdded_mono pinned sub uniq o⟩
    · cases hx

theorem claimOk_mono (h : claimOk (view pinned S) c = true) :
    claimOk (view pinned S') c = true := by
  unfold claimOk at h ⊢
  split at h
  · simp only [Bool.and_eq_true] at h ⊢
    refine ⟨any_mono pinned sub uniq (fun x hx => ?_) h.1, ?_⟩
    · simp only [Bool.and_eq_true] at hx ⊢
      exact ⟨⟨⟨hx.1.1.1, gen_mono pinned sub uniq hx.1.1.2⟩, hx.1.2⟩, past_mono pinned sub uniq hx.2⟩
    · have g := h.2
      simp only [guardianNamed, Bool.or_eq_true] at g ⊢
      rcases g with g | g
      · exact .inl (gen_mono pinned sub uniq g)
      · refine .inr (any_mono pinned sub uniq (fun x hx => ?_) g)
        simp only [configBy, Bool.and_eq_true] at hx ⊢
        exact ⟨⟨⟨gen_mono pinned sub uniq hx.1.1.1, hx.1.1.2⟩, hx.1.2⟩, past_mono pinned sub uniq hx.2⟩
  · cases h

theorem final_mono (h : final (view pinned S) c = true) :
    final (view pinned S') c = true := by
  simp only [final, Bool.and_eq_true] at h ⊢
  refine ⟨claimOk_mono pinned sub uniq h.1, any_mono pinned sub uniq (fun x hx => ?_) h.2⟩
  simp only [Bool.and_eq_true] at hx ⊢
  exact ⟨⟨confirmer_mono pinned sub uniq hx.1.1, hx.1.2⟩, past_mono pinned sub uniq hx.2⟩

/-- A final claim stays final whatever is added (its whole past is held, so it stays the same past), and stands unless what is added makes another claim of its ticket
with a smaller hash final: only a confirmation that never saw the first can. -/
theorem settle_final (mc : c ∈ S) (hf : final (view pinned S) c = true) :
    final (view pinned S') c = true ∧
      ((∀ f ∈ S', final (view pinned S') f = true → sameTicket f c = true → hashAtMost c.name f.name = true) →
        standing (view pinned S') c = true) := by
  have f' := final_mono pinned sub uniq hf
  refine ⟨f', fun least => ?_⟩
  have okc := final_claimOk f'
  have cc := claimOk_counted pinned okc
  have hF : (view pinned S').any (fun f => final (view pinned S') f && sameTicket f c) = true :=
    (view_any pinned).mpr ⟨c, sub c mc, cc, by simp [f', sameTicket_self okc]⟩
  unfold standing
  simp only [hF, ite_true, okc, f', Bool.true_and]
  refine (view_all_iff pinned).mpr fun f mf _ => ?_
  by_cases ff : final (view pinned S') f = true
  · by_cases sf : sameTicket f c = true
    · simp [ff, sf, least f mf ff sf]
    · simp [ff, sf]
  · simp [ff]

end Mono

/-! ### The door -/

theorem gen_elim {P : Genesis → Bool} (h : gen (view pinned S) P = true) :
    ∃ g ∈ S, counted pinned S g = true ∧ g.name = pinned ∧
      ∃ gs, g.says = .genesis gs ∧ gs.consented = true ∧ P gs = true := by
  obtain ⟨g, mg, cg, hg⟩ := (view_any pinned).mp h
  simp only [Bool.and_eq_true, beq_iff_eq] at hg
  obtain ⟨n, hg⟩ := hg
  split at hg
  · rename_i gs e
    simp only [Bool.and_eq_true] at hg
    exact ⟨g, mg, cg, n, gs, e, hg.1, hg.2⟩
  · cases hg

theorem gen_intro {g : TreeStatement} {gs : Genesis} {P : Genesis → Bool} (mg : g ∈ S)
    (cg : counted pinned S g = true) (n : g.name = pinned) (e : g.says = .genesis gs) (c : gs.consented = true)
    (hp : P gs = true) : gen (view pinned S) P = true :=
  (view_any pinned).mpr ⟨g, mg, cg, by simp [n, e, c, hp, view]⟩

/-- The Aven Peer's key is set only where there is a pinned genesis. -/
theorem peerIs_gen {d : String} (h : peerIs (view pinned S) d = true) :
    gen (view pinned S) (fun _ => true) = true := by
  unfold peerIs setting at h
  split at h
  · obtain ⟨s, _, _, hs⟩ := (view_any pinned).mp h
    simp only [latest, configBy, byAdmin, Bool.and_eq_true] at hs
    obtain ⟨g, mg, cg, n, gs, e, c, _⟩ := gen_elim pinned hs.1.1.1.1
    exact gen_intro pinned mg cg n e c rfl
  · obtain ⟨g, mg, cg, n, gs, e, c, _⟩ := gen_elim pinned h
    exact gen_intro pinned mg cg n e c rfl

/-- **`config_by_admin`:** a setting changed from the genesis's only by a change Maia City's owners approved. -/
theorem config_by_admin {sel now : TreeSays → Bool} {genesis : Genesis → Bool}
    (h : setting (view pinned S) sel now genesis = true)
    (changed : (view pinned S).any (configBy (view pinned S) sel) = true) :
    ∃ s ∈ S, byAdmin (view pinned S) s.keys = true ∧ sel s.says = true ∧ now s.says = true := by
  unfold setting at h
  simp only [changed, ↓reduceIte] at h
  obtain ⟨s, ms, _, hs⟩ := (view_any pinned).mp h
  simp only [latest, configBy, Bool.and_eq_true] at hs
  exact ⟨s, ms, hs.1.1.1.1, hs.1.1.1.2, hs.2⟩

/-- A passkey that signs in has a vault, a member's, and is that vault's passkey. -/
theorem signsIn_vault {p : String} (h : signsIn (view pinned S) p = true) :
    ∃ vault, member (view pinned S) vault = true ∧ passkeyOf (view pinned S) vault p = true := by
  unfold signsIn at h
  simp only [Bool.or_eq_true, Bool.and_eq_true] at h
  rcases h with (h | ⟨h, o⟩) | h
  · obtain ⟨g, mg, cg, n, gs, e, c, hp⟩ := gen_elim pinned h
    simp only [Bool.and_eq_true, beq_iff_eq] at hp
    refine ⟨gs.claimant, ?_, ?_⟩
    · unfold member; simp only [Bool.or_eq_true]
      exact .inl (gen_intro pinned mg cg n e c (by simp))
    · unfold passkeyOf; simp only [Bool.or_eq_true, Bool.and_eq_true]
      exact .inl (.inl (gen_intro pinned mg cg n e c (by simp [hp.1, hp.2])))
  · obtain ⟨g, mg, cg, n, gs, e, c, hp⟩ := gen_elim pinned h
    simp only [beq_iff_eq] at hp
    refine ⟨gs.claimant, ?_, ?_⟩
    · unfold member; simp only [Bool.or_eq_true]
      exact .inl (gen_intro pinned mg cg n e c (by simp))
    · unfold passkeyOf; simp only [Bool.or_eq_true, Bool.and_eq_true]
      exact .inl (.inr ⟨gen_intro pinned mg cg n e c (by simp [hp]), o⟩)
  · obtain ⟨c, mc, cc, hc⟩ := (view_any pinned).mp h
    simp only [Bool.and_eq_true] at hc
    obtain ⟨⟨st, fi⟩, hc⟩ := hc
    split at hc
    · rename_i t founded pk devs gk e
      refine ⟨founded, ?_, ?_⟩
      · unfold member; simp only [Bool.or_eq_true]
        exact .inr ((view_any pinned).mpr ⟨c, mc, cc, by simp [st, fi, e]⟩)
      · unfold passkeyOf; simp only [Bool.or_eq_true]
        exact .inr ((view_any pinned).mpr ⟨c, mc, cc, by simp_all⟩)
    · cases hc

/-- A vault's passkey signs in. -/
theorem passkeyOf_signsIn {vault p : String} (h : passkeyOf (view pinned S) vault p = true) :
    signsIn (view pinned S) p = true := by
  unfold passkeyOf at h
  unfold signsIn
  simp only [Bool.or_eq_true, Bool.and_eq_true] at h ⊢
  rcases h with (h | ⟨h, o⟩) | h
  · refine .inl (.inl (any_imp pinned (fun x hx => ?_) h))
    cases hx' : x.says
    case genesis gs => simp_all
    all_goals simp [hx'] at hx
  · refine .inl (.inr ⟨any_imp pinned (fun x hx => ?_) h, o⟩)
    cases hx' : x.says
    case genesis gs => simp_all
    all_goals simp [hx'] at hx
  · refine .inr (any_imp pinned (fun x hx => ?_) h)
    cases hx' : x.says <;> simp_all

/-- **`signIn_own_vault`:** a sign-in adds a device only to the vault of the passkey that signed it, a passkey with an
owner: the body names no vault, and no other vault's passkey can sign one in (caps rule 21, A42). -/
theorem signIn_own_vault {vault d : String} {s : TreeStatement} (ms : s ∈ S) (cs : counted pinned S s = true)
    (e : s.says = .signIn d) :
    passkeyOf (view pinned S) vault s.signer = true → deviceOf (view pinned S) vault d = true := by
  intro pk
  unfold deviceOf
  simp only [Bool.or_eq_true]
  exact .inr ((view_any pinned).mpr ⟨s, ms, cs, by simp [e, pk]⟩)

/-- A passkey whose record has no owner, and which added none, signs in no device. -/
theorem ownerless_signs_in_nothing {vault p : String}
    (noOwner : ∀ g ∈ S, ∀ gs, g.says = .genesis gs → p = gs.passkey.spki → gs.passkey.owner = none)
    (noClaimOwner : ∀ c ∈ S, ∀ t founded pk ds gu, c.says = .claim t founded pk ds gu → pk.spki = p →
      pk.owner = none)
    (noEpoch : ∀ s ∈ S, s.signer = p → ∀ c o se e, s.says ≠ .ownerEpoch c o se e) :
    passkeyOf (view pinned S) vault p = false := by
  have na : ownerAdded (view pinned S) p = false := by
    cases h : ownerAdded (view pinned S) p
    · rfl
    · obtain ⟨s, ms, _, hs⟩ := (view_any pinned).mp h
      simp only [Bool.and_eq_true, beq_iff_eq] at hs
      split at hs
      · rename_i c o se e' he
        exact absurd he (noEpoch s ms hs.1 c o se e')
      · simp at hs
  cases h : passkeyOf (view pinned S) vault p
  · rfl
  · exfalso
    unfold passkeyOf at h
    simp only [na, Bool.and_false, Bool.or_false, Bool.or_eq_true] at h
    rcases h with h | h
    · obtain ⟨g, mg, _, _, gs, e, _, hp⟩ := gen_elim pinned h
      simp only [Bool.and_eq_true, beq_iff_eq, Option.isSome_iff_ne_none] at hp
      exact hp.2 (noOwner g mg gs e hp.1.2)
    · obtain ⟨c, mc, _, hc⟩ := (view_any pinned).mp h
      simp only [Bool.and_eq_true] at hc
      split at hc
      · rename_i t founded pk ds gu e
        simp only [Bool.and_eq_true, beq_iff_eq, Option.isSome_iff_ne_none] at hc
        exact hc.2.2 (noClaimOwner c mc t founded pk ds gu e hc.2.1.2)
      · simp at hc

/-- A signature by a key that owns no vault of the tree never makes an approval: k of n counts owners only. -/
theorem approvesF_extra {t : Tree} {th : String → Nat} {d : String} {sigs : List Sig} {p : String}
    (np : ∀ v ∈ t.vaults, p ∉ v.ownerKeys) :
    ∀ {f : Nat} {vault : String}, t.approvesF th d (⟨p, d⟩ :: sigs) f vault = true →
      t.approvesF th d sigs f vault = true
  | 0, _, h => by simp [Tree.approvesF] at h
  | f + 1, vault, h => by
    unfold Tree.approvesF at h ⊢
    cases g : t.get? vault with
    | none => simp [g] at h
    | some v =>
      simp only [g, decide_eq_true_eq] at h ⊢
      refine Nat.le_trans h (length_filter_le fun o m ho => ?_)
      cases o with
      | key k =>
        simp only [Tree.ownerApproves, List.contains_cons, Bool.or_eq_true, beq_iff_eq, Sig.mk.injEq,
          and_true] at ho ⊢
        rcases ho with rfl | ho
        · have mk : Owner.key k ∈ v.owners := mem_ownersOnce.mp m
          exact absurd (List.mem_filterMap.mpr ⟨_, mk, rfl⟩ : k ∈ v.ownerKeys) (np v (Tree.get?_some g).1)
        · exact ho
      | vault a =>
        simp only [Tree.ownerApproves] at ho ⊢
        exact approvesF_extra np ho

/-- **`ownerless_only_adds_owner`** (A42): a passkey whose record has no owner, and which signed no owner-epoch op of
its own, has no act counted but that op. It signs in no device; its signature beside an act adds nothing to Maia City's
approval of it; and it confirms nothing. -/
theorem ownerless_only_adds_owner {p : String}
    (noOwner : ∀ g ∈ S, ∀ gs, g.says = .genesis gs → p = gs.passkey.spki → gs.passkey.owner = none)
    (noClaimOwner : ∀ c ∈ S, ∀ t founded pk ds gu, c.says = .claim t founded pk ds gu → pk.spki = p →
      pk.owner = none)
    (noEpoch : ∀ s ∈ S, s.signer = p → ∀ c o se e, s.says ≠ .ownerEpoch c o se e)
    (notGuardian : ∀ g ∈ S, ∀ gs, g.says = .genesis gs → p ≠ gs.guardian.ed25519)
    (notDevice : ∀ g ∈ S, ∀ gs, g.says = .genesis gs → p ∉ gs.devices ∧ p ≠ gs.avenPeer)
    (notSignedIn : ∀ s ∈ S, s.says ≠ .signIn p) :
    (∀ vault, passkeyOf (view pinned S) vault p = false) ∧
      (∀ ks, byAdmin (view pinned S) (p :: ks) = true → byAdmin (view pinned S) ks = true) ∧
      confirmer (view pinned S) p = false := by
  -- in a pinned genesis's tree, p owns no vault: its owner keys are the claimant's passkey, which has an owner, and
  -- MaiaCityGuardian's
  have notKey : ∀ g ∈ S, ∀ gs, g.says = .genesis gs → gs.consented = true →
      ∀ v ∈ gs.tree.vaults, p ∉ v.ownerKeys := by
    intro g mg gs e c v mv
    have ps : p ≠ gs.passkey.spki := fun h => by
      simp [Genesis.consented, noOwner g mg gs e h] at c
    have pg := notGuardian g mg gs e
    simp only [Genesis.tree, List.mem_cons, List.not_mem_nil, or_false] at mv
    rcases mv with rfl | rfl | rfl | rfl <;>
      simp [Vault.ownerKeys, Owner.key?, List.filterMap_map, Function.comp_def, ps, pg]
  refine ⟨fun _ => ownerless_signs_in_nothing pinned noOwner noClaimOwner noEpoch, fun ks h => ?_, ?_⟩
  · obtain ⟨g, mg, cg, n, gs, e, c, ap⟩ := gen_elim pinned h
    simp only [List.map_cons, Tree.approves] at ap
    exact gen_intro pinned mg cg n e c (approvesF_extra (notKey g mg gs e c) ap)
  · cases h : confirmer (view pinned S) p
    · rfl
    · exfalso
      unfold confirmer at h
      simp only [Bool.or_eq_true] at h
      rcases h with (h | h) | h
      · obtain ⟨g, mg, _, _, gs, e, c, ap⟩ := gen_elim pinned h
        simp only [List.any_eq_true] at ap
        obtain ⟨x, _, ap⟩ := ap
        have pos : ∀ y, 1 ≤ gs.tree.threshold y := by
          simp only [Genesis.consented, Bool.and_eq_true, decide_eq_true_eq] at c
          exact gs.threshold_pos c.1.1.1.1
        unfold Tree.approves at ap
        obtain ⟨k, _, mk⟩ := Tree.approvesF_signed pos (approvesF_extra (notKey g mg gs e c) ap)
        simp at mk
      · obtain ⟨g, mg, _, _, gs, e, _, hp⟩ := gen_elim pinned h
        simp only [Bool.or_eq_true, Bool.and_eq_true, List.contains_iff_mem, beq_iff_eq] at hp
        rcases hp with ⟨_, d⟩ | ⟨_, d⟩
        · exact (notDevice g mg gs e).1 d
        · exact (notDevice g mg gs e).2 d
      · obtain ⟨s, ms, _, hs⟩ := (view_any pinned).mp h
        split at hs
        · rename_i d e
          simp only [Bool.and_eq_true, beq_iff_eq] at hs
          exact notSignedIn s ms (hs.1 ▸ e)
        · cases hs

/-- The door admits exactly the devices of the member vaults (K12): the claimant's first devices, the Aven Peer, the
first device of each vault a standing claim founds, and the devices a member's passkey signs in. So it is a function of
the settled tree alone (`door_from_tree`), and no position opens it. -/
theorem settle_door {d : String} :
    admits (view pinned S) d = true ↔
      ∃ vault, member (view pinned S) vault = true ∧ deviceOf (view pinned S) vault d = true := by
  constructor
  · intro h
    unfold admits at h
    simp only [Bool.or_eq_true] at h
    rcases h with ((h | h) | h) | h
    · obtain ⟨g, mg, cg, n, gs, e, c, hp⟩ := gen_elim pinned h
      refine ⟨gs.claimant, ?_, ?_⟩
      · unfold member
        simp only [Bool.or_eq_true]
        exact .inl (gen_intro pinned mg cg n e c (by simp))
      · unfold deviceOf
        simp only [Bool.or_eq_true]
        exact .inl (.inl (.inl (gen_intro pinned mg cg n e c (by simp [List.contains_iff_mem.mp hp]))))
    · obtain ⟨g, mg, cg, n, gs, e, c, _⟩ := gen_elim pinned (peerIs_gen pinned h)
      refine ⟨gs.agent, ?_, ?_⟩
      · unfold member
        simp only [Bool.or_eq_true]
        exact .inl (gen_intro pinned mg cg n e c (by simp))
      · unfold deviceOf
        simp only [Bool.or_eq_true, Bool.and_eq_true]
        exact .inl (.inl (.inr ⟨gen_intro pinned mg cg n e c (by simp), h⟩))
    · obtain ⟨c, mc, cc, hc⟩ := (view_any pinned).mp h
      simp only [Bool.and_eq_true] at hc
      obtain ⟨st, hc⟩ := hc
      split at hc
      · rename_i t founded pk dev gk e
        refine ⟨founded, ?_, ?_⟩
        · unfold member
          simp only [Bool.or_eq_true]
          exact .inr ((view_any pinned).mpr ⟨c, mc, cc, by simp [st, e]⟩)
        · unfold deviceOf
          simp only [Bool.or_eq_true]
          exact .inl (.inr ((view_any pinned).mpr ⟨c, mc, cc, by simp_all⟩))
      · cases hc
    · obtain ⟨s, ms, cs, hs⟩ := (view_any pinned).mp h
      split at hs
      · rename_i dev e
        simp only [Bool.and_eq_true, beq_iff_eq] at hs
        obtain ⟨rfl, pk⟩ := hs
        have sv := signsIn_vault pinned pk
        obtain ⟨vault, mv, pv⟩ := sv
        refine ⟨vault, mv, ?_⟩
        unfold deviceOf
        simp only [Bool.or_eq_true]
        exact .inr ((view_any pinned).mpr ⟨s, ms, cs, by simp [e, pv]⟩)
      · cases hs
  · rintro ⟨vault, _, h⟩
    unfold deviceOf at h
    unfold admits
    simp only [Bool.or_eq_true, Bool.and_eq_true] at h ⊢
    rcases h with ((h | ⟨_, h⟩) | h) | h
    · refine .inl (.inl (.inl (any_imp pinned (fun x hx => ?_) h)))
      cases hx' : x.says
      case genesis gs =>
        simp only [hx', Bool.and_eq_true, beq_iff_eq] at hx ⊢
        obtain ⟨n, c, _, hp⟩ := hx
        exact ⟨n, c, hp⟩
      all_goals simp [hx'] at hx
    · exact .inl (.inl (.inr h))
    · refine .inl (.inr (any_imp pinned (fun x hx => ?_) h))
      cases hx' : x.says <;> simp_all
    · refine .inr (any_imp pinned (fun x hx => ?_) h)
      split at hx
      · simp only [Bool.and_eq_true] at hx
        simp only [hx.1, Bool.true_and]
        exact passkeyOf_signsIn pinned hx.2
      · cases hx

/-! ### Rule 15: the admin is a vault -/

/-- **`admin_by_owners`:** an admin act counts only with Maia City's owners' approval, through the vaults that own it,
resting on a signature by an owner key above the coop: the claimant's passkey or MaiaCityGuardian's, never a device's
key (rule 15, A28). -/
theorem admin_by_owners {ks : List String} (h : byAdmin (view pinned S) ks = true) :
    ∃ g ∈ S, counted pinned S g = true ∧ g.name = pinned ∧ ∃ gs, g.says = .genesis gs ∧ gs.consented = true ∧
      gs.tree.approves gs.tree.threshold gs.coop stmtDigest (ks.map (⟨·, stmtDigest⟩)) = true ∧
      ∃ k ∈ ks, gs.tree.KeyAbove k gs.coop ∧ (k = gs.passkey.spki ∨ k = gs.guardian.ed25519) := by
  obtain ⟨g, mg, cg, n, gs, e, c, ap⟩ := gen_elim pinned h
  have pos : ∀ x, 1 ≤ gs.tree.threshold x := by
    simp only [Genesis.consented, Bool.and_eq_true, decide_eq_true_eq] at c
    exact gs.threshold_pos c.1.1.1.1
  obtain ⟨k', ka, mk⟩ := Tree.approvesF_signed pos ap
  simp only [List.mem_map, Sig.mk.injEq, and_true] at mk
  obtain ⟨k, mk, rfl⟩ := mk
  exact ⟨g, mg, cg, n, gs, e, c, ap, k, mk, ka, Genesis.keyAbove ka⟩

/-- **`device_not_admin`:** a key that is neither the pinned genesis's passkey nor MaiaCityGuardian's, a device's
among them, never signs an admin act. -/
theorem device_not_admin {ks : List String}
    (no : ∀ k ∈ ks, ∀ g ∈ S, ∀ gs, g.says = .genesis gs → k ≠ gs.passkey.spki ∧ k ≠ gs.guardian.ed25519) :
    byAdmin (view pinned S) ks = false := by
  cases h : byAdmin (view pinned S) ks
  · rfl
  · obtain ⟨g, mg, _, _, gs, e, _, _, k, mk, _, ko⟩ := admin_by_owners pinned h
    rcases ko with ko | ko
    · exact absurd ko (no k mk g mg gs e).1
    · exact absurd ko (no k mk g mg gs e).2

/-- A list's entry stands only through an admin act's add that saw every remove of it. -/
theorem settle_listed {add remove : String → TreeSays} {d : String}
    (h : listed (view pinned S) add remove d = true) :
    ∃ a ∈ S, counted pinned S a = true ∧ byAdmin (view pinned S) a.keys = true ∧ a.says = add d ∧
      ∀ r ∈ S, counted pinned S r = true → byAdmin (view pinned S) r.keys = true → r.says = remove d →
        Before TreeStatement.name S a r := by
  obtain ⟨a, ma, ca, ha⟩ := (view_any pinned).mp h
  simp only [Bool.and_eq_true, beq_iff_eq, Bool.not_eq_true'] at ha
  obtain ⟨⟨aa, sa⟩, none⟩ := ha
  refine ⟨a, ma, ca, aa, sa, fun r mr cr ar sr => Classical.byContradiction fun np => ?_⟩
  have pf : (view pinned S).past a r = false := by
    cases e : (view pinned S).past a r
    · rfl
    · exact absurd ((view_past pinned).mp e).2.2 np
  have : (view pinned S).any (fun r => byAdmin (view pinned S) r.keys && r.says == remove d &&
      !(view pinned S).past a r) = true :=
    (view_any pinned).mpr ⟨r, mr, cr, by simp [ar, sr, pf]⟩
  rw [this] at none
  cases none

end Settle

/-- The settled tree as sorted lists over what `S` names: for vectors and checks. -/
structure Listed where
  counted : List Core.Hash
  final : List Core.Hash
  standing : List Core.Hash
  contested : List Core.Hash
  members : List String
  admitted : List String
  relays : List String
  avenPeer : List String
  origins : List String
  guardianVault : List String
  deriving DecidableEq, Repr

/-- The origins a statement names. -/
def TreeStatement.originsNamed (s : TreeStatement) : List String :=
  match s.says with
  | .genesis g => g.origins
  | .setOrigins os => os
  | _ => []

/-- The vaults and the keys a statement names. -/
def TreeStatement.mentions (s : TreeStatement) : List String × List String :=
  match s.says with
  | .genesis g => ([g.claimant, g.coop, g.agent, g.guardianVault], g.avenPeer :: g.devices)
  | .signIn device => ([], [device])
  | .ticket _ | .withdrawal _ | .confirm _ => ([], [])
  | .claim _ vault _ devices _ => ([vault], devices)
  | .relayAdd v | .relayRemove v | .setGuardian v => ([v], [])
  | .setAvenPeer k => ([], [k])
  | .setOrigins _ | .ownerEpoch .. => ([], [])
  | .setOwners v os _ => (v :: os.filterMap Owner.vault?, os.filterMap Owner.key?)

def Settled.listed (t : Settled) (S : List TreeStatement) : Listed :=
  let hashes (l : List Core.Hash) := l.eraseDups.mergeSort fun a b => decide (hashNum a ≤ hashNum b)
  let strs (l : List String) := l.eraseDups.mergeSort fun a b => decide (a < b) || a == b
  let names := hashes (S.map (·.name))
  let vaults := strs (S.flatMap (·.mentions.1))
  let keys := strs (S.flatMap (·.mentions.2))
  { counted := names.filter t.counted, final := names.filter t.final, standing := names.filter t.standing
    contested := (hashes (S.filterMap (·.ticketOf))).filter t.contested, members := vaults.filter t.member
    admitted := keys.filter t.admits, relays := vaults.filter t.relay
    avenPeer := keys.filter t.avenPeer, origins := (strs (S.flatMap (·.originsNamed))).filter t.origin
    guardianVault := vaults.filter t.guardianVault }

/-! ### An example tree

Alice founds the network, signed by her passkey and MaiaCityGuardian, and signs in a second device. Bob claims his
ticket and Alice's device confirms it; a leaked copy of his link claims it again with a smaller hash, too late. Carol's
ticket is withdrawn by a withdrawal that never saw her claim. Dan's claim names a guardian vault Maia City never named.
Two of Alice's devices confirm different claims of Eve's ticket without seeing each other, so the smaller hash wins and
the ticket is contested. A relay is removed and added again, another removed while it was added. A second genesis
changes nothing, and a bad ticket, which a peer drops, takes the claim built on it out with it. The names are numbers
written as 32 bytes. -/

namespace TreeExamples

/-- The examples' names are numbers, each written as Core's 32 bytes, big-endian, so `hashNum` reads it back. -/
scoped instance (n : Nat) : OfNat Core.Hash n := ⟨⟨Core.be 32 n⟩⟩

def guardian : GuardianKeys := ⟨"guardian-ed25519", "guardian-ml-dsa", "guardian-x-wing"⟩

/-- A passkey's record in the examples: its PRF gave it an owner and a seal key. -/
def pk (spki : String) : Passkey :=
  ⟨spki ++ "-credential", spki, some ⟨spki ++ "-ed25519", spki ++ "-ml-dsa"⟩, some (spki ++ "-seal"), 1⟩

def alicesGenesis : Genesis :=
  { rpId := "maia.city", origins := ["https://maia.city"], claimant := "alice", passkey := pk "alice-passkey",
    devices := ["alice-peer"], coop := "maia-city", coopOwners := ["alice"], agent := "aven", avenPeer := "aven-peer",
    guardian, guardianVault := "maia-city-guardian", confirmers := ["aven", "alice"],
    signedBy := ["alice-passkey", "guardian-ed25519", "guardian-ml-dsa"] }

def statements : List TreeStatement :=
  [⟨100, "alice-passkey", [], .genesis alicesGenesis, []⟩,
   ⟨110, "alice-passkey", [100], .signIn "alice-peer-light", []⟩,
   ⟨120, "alice-passkey", [110], .ticket "t-bob", []⟩,
   ⟨500, "t-bob", [120], .claim 120 "bob" (pk "bob-passkey") ["bob-peer-light"] "maia-city-guardian", []⟩,
   ⟨510, "alice-peer", [500], .confirm 500, []⟩,
   ⟨300, "t-bob", [120], .claim 120 "mallory" (pk "mallory-passkey") ["mallory-peer"] "maia-city-guardian", []⟩,
   ⟨310, "mallory-passkey", [300], .signIn "mallory-peer-2", []⟩,
   ⟨520, "bob-passkey", [510], .signIn "bob-peer", []⟩,
   ⟨130, "alice-passkey", [100], .ticket "t-carol", []⟩,
   ⟨600, "t-carol", [130], .claim 130 "carol" (pk "carol-passkey") ["carol-peer"] "maia-city-guardian", []⟩,
   ⟨610, "alice-passkey", [130], .withdrawal 130, []⟩,
   ⟨140, "alice-passkey", [100], .ticket "t-dan", []⟩,
   ⟨650, "t-dan", [140], .claim 140 "dan" (pk "dan-passkey") ["dan-peer"] "other-guardian", []⟩,
   ⟨160, "alice-passkey", [100], .ticket "t-eve", []⟩,
   ⟨800, "t-eve", [160], .claim 160 "eve" (pk "eve-passkey") ["eve-peer"] "maia-city-guardian", []⟩,
   ⟨790, "t-eve", [160], .claim 160 "eve2" (pk "eve2-passkey") ["eve2-peer"] "maia-city-guardian", []⟩,
   ⟨810, "alice-peer", [800], .confirm 800, []⟩,
   ⟨811, "alice-peer-light", [790], .confirm 790, []⟩,
   ⟨700, "alice-passkey", [100], .relayAdd "aven", []⟩,
   ⟨740, "alice-passkey", [700], .relayRemove "aven", []⟩,
   ⟨750, "alice-passkey", [740], .relayAdd "aven", []⟩,
   ⟨710, "alice-passkey", [520], .relayAdd "bob", []⟩,
   ⟨720, "alice-passkey", [100], .relayRemove "bob", []⟩,
   ⟨50, "eve-passkey", [], .genesis { alicesGenesis with
     claimant := "eve", passkey := pk "eve-passkey", coopOwners := ["eve"],
     signedBy := ["eve-passkey", "guardian-ed25519", "guardian-ml-dsa"] }, []⟩,
   ⟨60, "eve-passkey", [50], .ticket "t-other", []⟩,
   ⟨150, "alice-passkey", [100], .ticket "t-bad", []⟩,
   ⟨660, "t-bad", [150], .claim 150 "frank" (pk "frank-passkey") ["frank-peer"] "maia-city-guardian", []⟩]

/-- What a peer keeps: every statement but the bad ticket, which fails its own checks. -/
def kept : List TreeStatement := statements.filter (·.name != 150)

def expected : Listed :=
  { counted := [100, 110, 120, 130, 140, 160, 300, 310, 500, 510, 520, 600, 610, 650, 700, 710, 720, 740, 750,
      790, 800, 810, 811]
    final := [500, 790, 800], standing := [500, 790], contested := [160]
    members := ["alice", "aven", "bob", "eve2", "maia-city"]
    admitted := ["alice-peer", "alice-peer-light", "aven-peer", "bob-peer", "bob-peer-light", "eve2-peer"]
    relays := ["aven"], avenPeer := ["aven-peer"], origins := ["https://maia.city"]
    guardianVault := ["maia-city-guardian"] }

#guard (settle 100 kept).listed statements == expected
#guard (settle 100 kept.reverse).listed statements == expected
-- Pinned to the other genesis, only its own statements count.
#guard (settle 50 kept).listed statements ==
  { expected with
    counted := [50, 60], final := [], standing := [], contested := [], members := ["aven", "eve", "maia-city"],
    admitted := ["alice-peer", "aven-peer"], relays := [] }


-- k of n (D14, A28): Maia City owned by Alice's vault and MaiaCityGuardian's, two of two. A ticket Alice's passkey
-- signs alone doesn't count; with the guardian's approval beside its name (A30) it does, and its claim then stands.
def twoOfTwo : Genesis := { alicesGenesis with coopOwners := ["alice", "maia-city-guardian"], coopThreshold := 2 }
def alone : List TreeStatement :=
  [⟨100, "alice-passkey", [], .genesis twoOfTwo, []⟩, ⟨120, "alice-passkey", [100], .ticket "t-bob", []⟩,
   ⟨500, "t-bob", [120], .claim 120 "bob" (pk "bob-passkey") ["bob-peer"] "maia-city-guardian", []⟩]
def approved : List TreeStatement :=
  [⟨100, "alice-passkey", [], .genesis twoOfTwo, []⟩,
   ⟨120, "alice-passkey", [100], .ticket "t-bob", ["guardian-ed25519"]⟩,
   ⟨500, "t-bob", [120], .claim 120 "bob" (pk "bob-passkey") ["bob-peer"] "maia-city-guardian", []⟩]
#guard !(settle 100 alone).standing 500
#guard (settle 100 approved).standing 500
-- a threshold of zero is no genesis anyone pinned: nothing counts
#guard !(settle 100 [⟨100, "alice-passkey", [], .genesis { twoOfTwo with coopThreshold := 0 }, []⟩]).counted 100
end TreeExamples

end Aven.ID

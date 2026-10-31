import Aven.ID.Authorized

/-! # Membership is a cap (A38)

Maia City's vault grants each member's vault a member cap, which is what a join is (A38). The confirm op that Aven holds
under Maia City's confirm cap issues it, for a claim of a ticket Maia City issued: **the confirm envelope is the
issuance** (the architect and avenPEER, 31 Oct 2026). So a member cap is Maia City's act, carried out under the cap its
owners approved: it is no grant of the confirmer's own, so D14 asks the confirmer's owners nothing for each member, and
there is no second cap object to keep in step. A ticket is a cap from Maia City to the vault its claim founds; its
one-time key only authorizes the claim and holds nothing (A28, A42).

- `confirmCap`: Maia City's grant to a confirmer vault, one line: `tree/1`'s confirm on the tree Doc, for any claim. A
  coop has no devices, so no device signs it: Maia City's owners approve it (A28).
- `memberCap`: Maia City's grant to a member's vault, its lines fixed by `tree/1`'s confirm (`memberLines`): reading the
  chat, putting its messages, and signing in its own devices on the tree Doc. The sign-in names no vault, and the
  signing passkey's vault is the one it adds a device to (avenPEER's `signIn_own_vault`). No tickets: those stay Maia
  City's own.
- `confirm_only`: the confirm cap allows nothing but a confirm, on the tree Doc;
- `member_by_confirm`: a reader counts a vault as a member only by an authorized confirm on the tree Doc, naming a claim
  that founded it, written on its signer's vault's own authority or under a chain whose root allows that confirm.

What the tree settles, which claims stand and whom each founded, is avenPEER's (`Aven.ID.Network`, `Settled.member`),
so it is a parameter here, as are the tree Doc, the chat Doc and the chat message's type, which Maia City's genesis
names. -/

namespace Aven.ID

open Aven.Core

/-- `tree/1`'s op, by its id. -/
def treeOp (name : String) : OpId := pluginOp "tree/1" name

def confirmOp : OpId := treeOp "confirm"
def signInOp : OpId := treeOp "signIn"

/-- The claim a confirm names, by its name. -/
def claimParam : Bytes := "claim".toUTF8.toList

/-- A confirm of claim `c`. -/
def confirmCall (c : Bytes) : Call := ⟨confirmOp, [(claimParam, .bytes c)]⟩

section
variable (tree chat message : DocId)

/-- Maia City's confirm cap to confirmer vault `v`, with its owners' approvals: `tree/1`'s confirm on the tree Doc, for
any claim. -/
def confirmCap (v : String) (approvals : List Sig) : Cap :=
  { id := "confirm-" ++ v, issuer := "maia-city", holder := .vault v,
    grant := [⟨confirmOp, .doc tree .self, [(claimParam, none)]⟩], approvals }

/-- What `tree/1`'s confirm grants a member's vault: reading the chat and putting its messages, and signing in its own
devices on the tree Doc. -/
def memberLines : Grant :=
  [⟨coreOp .read, .doc chat .self, []⟩, ⟨coreOp .put, .doc chat .self, [(typeParam, some [docValue message])]⟩,
   ⟨signInOp, .doc tree .self, []⟩]

/-- The member cap (A38): Maia City's grant to member vault `v`. The confirm envelope that names `v`'s claim is its
issuance, so it carries no signature of its own. -/
def memberCap (v : String) : Cap :=
  { id := "member-" ++ v, issuer := "maia-city", holder := .vault v, grant := memberLines tree chat message }

/-- **The confirm cap only confirms**: whatever call it allows is a confirm, on the tree Doc. -/
theorem confirm_only (gov : Bytes → Bytes → Prop) (spawned lists : DocId → DocId → Prop) {v : String}
    {a : List Sig} {roles : List Role} {f : Facts} {c : Call}
    (h : ((confirmCap tree v a).grants roles).allows gov spawned lists f c) : c.op = confirmOp ∧ f.id = tree := by
  obtain ⟨l, ml, op, cov, _⟩ := h
  simp only [confirmCap, Cap.grants, List.mem_singleton] at ml
  subst ml
  exact ⟨op.symm, cov⟩

variable (r : Reader) (gov : Bytes → Bytes → Prop) (spawned lists : DocId → DocId → Prop)

/-- A confirmation a reader counts: an envelope caps authorizes, on the tree Doc, calling `tree/1`'s confirm for
claim `c`. -/
def Reader.Confirms (e : Envelope) (c : Bytes) : Prop :=
  r.Authorized gov spawned lists e ∧ e.doc = tree ∧ confirmCall c ∈ r.calls e

/-- Vault `v` holds the member cap: the reader counts a confirmation of a claim that founded `v`, as the tree settles
claims (`founded`). -/
def Reader.Member (founded : Bytes → Option String) (v : String) : Prop :=
  ∃ e c, r.Confirms tree gov spawned lists e c ∧ founded c = some v

/-- **A member only by a confirm** (A38): a reader counts a vault as a member only by an authorized confirm on the tree
Doc, naming a claim that founded it, its signing device within its device cap, and written on its signer's vault's
own authority, the tree Doc's vault or one that governs it, or under a chain whose root allows that confirm. -/
theorem member_by_confirm {founded : Bytes → Option String} {v : String}
    (h : r.Member tree gov spawned lists founded v) :
    ∃ e c, founded c = some v ∧ e.doc = tree ∧ r.WithinDevice gov spawned lists e ∧
      ((r.Own gov e ∧ ¬ r.HostSigned e) ∨
        ∃ root rest f, r.chain e = root :: rest ∧ r.facts e.doc = some f ∧
          (root.grants r.ctx.roles).allows gov spawned lists f (confirmCall c)) := by
  obtain ⟨e, c, ⟨⟨wd, auth⟩, doc, mc⟩, fd⟩ := h
  refine ⟨e, c, fd, doc, wd, auth.imp id fun ch => ?_⟩
  obtain ⟨root, rest, f, hc, hf, calls, _⟩ := chain_root r gov spawned lists ch.1
  exact ⟨root, rest, f, hc, hf, calls _ mc⟩

end

end Aven.ID

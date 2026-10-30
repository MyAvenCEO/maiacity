import Aven.ID.Json
import Aven.ID.InviteTrace

/-! # What was stored before the agent

Until 30 Oct 2026 the kind `agent` was called `network` (Samuel, 30 Oct 2026: avens are agents; members belong to the
admin coop). Production keeps what its store holds (PRODUCTION.md, "No wiping in production"), so the new model reads
the old one:

- **The statements** a store holds (claims, sign-ins, invites, withdrawals, joins) never named a kind: their `network`
  names the network by its agent's id, and their texts are the ones their passkeys signed. They read as they always
  have, and the tree they make is the one they made then but for the agent's kind, and its members belong to the admin
  coop (`aven-id`'s test of `tests/before`, made with the code of main before the change).
- **A tree written out the old way** (`Tree.jsonBefore`, as the cast and the trees told to devices wrote it) reads back
  as the same tree (`Kind.parse_before`, and the traces' trees below). -/

open Lean

namespace Aven.ID

/-- A kind's name as it was written before 30 Oct 2026. -/
def Kind.before : Kind → String
  | .agent => "network"
  | k => k.name

/-- Every kind's old name reads as that kind: an agent's vault written as a network's is an agent's. -/
theorem Kind.parse_before (k : Kind) : Kind.parse k.before = some k := by
  cases k <;> decide

/-- Every kind's name reads as that kind. -/
theorem Kind.parse_name (k : Kind) : Kind.parse k.name = some k := by
  cases k <;> decide

def Vault.jsonBefore (v : Vault) : Json :=
  Json.mkObj [("id", v.id), ("name", v.name), ("kind", v.kind.before), ("owners", toJson (v.owners.map Owner.name))]

def Tree.jsonBefore (t : Tree) : Json :=
  Json.mkObj [("keys", toJson t.keys), ("vaults", Json.arr (t.vaults.map Vault.jsonBefore).toArray)]

/-- Whether a tree written the old way reads back as itself. -/
def Tree.readsBefore (t : Tree) : Bool := ((parseTree t.jsonBefore).toOption.map Tree.json) == some t.json

-- every tree the claim and member examples make, after every step, written the old way, reads back as itself
#guard claimExamples.all fun (_, founding, ops, _) => (founding.run ops).all fun (_, s) => s.tree.readsBefore
#guard memberExamples.all fun (_, ops, _) => (boxMembers.run ops).all fun (_, m) => m.tree.readsBefore
#guard cast.readsBefore

end Aven.ID

import Aven.ID.InviteTrace
import Aven.ID.ClaimJson

/-! # Invites, joins and withdrawals as JSON

The form of `vectors/invites.json`, beside the claim's (`Aven.ID.ClaimJson`). A join carries its one-time key's
signature as the model knows one, the key that made it and what it signed, so a test signs exactly that with the
one-time key's real secret:

```
invite:   {"network":"aven","invite":"<one-time key>","passkey":"passkey-a","assertion":{…}}
withdraw: {"network":"aven","invite":"<one-time key>","passkey":"passkey-a","assertion":{…}}
join:     {"network":"aven","invite":"<one-time key>","person":"person-b","name":"Bea","passkey":{"id":"passkey-b","spki":"3059…"},
           "device":{"id":"device-4","key":"…"},"signature":{"signer":"<one-time key>","signed":"avenID join 1\n…"},
           "assertion":{…}}
invites:  [{"id":"invite-…","key":"…","state":"open"|"used"|"withdrawn"}]
```
-/

open Lean

namespace Aven.ID

def Invite.json (i : Invite) : Json :=
  Json.mkObj [("network", i.network), ("invite", i.key), ("passkey", i.passkey), ("assertion", i.assertion.json)]

def Withdrawal.json (w : Withdrawal) : Json :=
  Json.mkObj [("network", w.network), ("invite", w.key), ("passkey", w.passkey), ("assertion", w.assertion.json)]

def Join.json (j : Join) : Json :=
  Json.mkObj [("network", j.network), ("invite", j.invite), ("person", j.person), ("name", j.name),
    ("passkey", Json.mkObj [("id", j.passkey), ("spki", j.passkeyKey)]),
    ("device", Json.mkObj [("id", j.device), ("key", j.deviceKey)]),
    ("signature", Json.mkObj [("signer", j.signature.1), ("signed", j.signature.2)]),
    ("assertion", j.assertion.json)]

def MemberError.json : MemberError → Json
  | .claim why => Json.mkObj [("error", "claim"), ("claim", why.json)]
  | .unclaimed => Json.mkObj [("error", "unclaimed")]
  | .wrongNetwork => Json.mkObj [("error", "wrongNetwork")]
  | .name => Json.mkObj [("error", "name")]
  | .notAdmin => Json.mkObj [("error", "notAdmin")]
  | .assertion why => Json.mkObj [("error", "assertion"), ("why", why.name)]
  | .knownInvite => Json.mkObj [("error", "knownInvite")]
  | .noInvite => Json.mkObj [("error", "noInvite")]
  | .used => Json.mkObj [("error", "used")]
  | .withdrawn => Json.mkObj [("error", "withdrawn")]
  | .badInviteSignature => Json.mkObj [("error", "badInviteSignature")]
  | .notFromDevice => Json.mkObj [("error", "notFromDevice")]
  | .known => Json.mkObj [("error", "known")]
  | .invalid why => Json.mkObj [("error", "invalid"), ("invalid", why.json)]

def Members.treeJson (m : Members) : Json :=
  Json.mkObj [("keys", Json.arr (m.publics.map fun (id, k) => toJson [id, k]).toArray),
    ("vaults", Json.arr (m.vaults.map Vault.json).toArray)]

def Members.invitesJson (m : Members) : Json :=
  Json.arr (m.invites.map fun i =>
    Json.mkObj [("id", inviteId i.key), ("key", i.key), ("state", m.state i.key)]).toArray

def MemberOp.json : MemberOp → Json
  | .claim p d t => Op.json (.claim p d t)
  | .signIn p d t => Op.json (.signIn p d t)
  | .invite p k t => Json.mkObj [("op", "invite"), ("invite", (MemberOp.inviteOf p k t).json)]
  | .withdraw p k t => Json.mkObj [("op", "withdraw"), ("withdraw", (MemberOp.withdrawalOf p k t).json)]
  | .join k p d t =>
    let (j, sender) := MemberOp.joinOf k p d t
    Json.mkObj [("op", "join"), ("from", sender), ("join", j.json)]
  | .restart => Json.mkObj [("op", "restart")]
  | .wipe => Json.mkObj [("op", "wipe")]

/-- The challenge the step's passkey was asked to sign, as the page computes it. -/
def MemberOp.challenge : MemberOp → Json
  | .claim p d t => Op.challenge (.claim p d t)
  | .signIn p d t => Op.challenge (.signIn p d t)
  | .invite p k t => challengeOf (MemberOp.inviteOf p k t).text
  | .withdraw p k t => challengeOf (MemberOp.withdrawalOf p k t).text
  | .join k p d t => challengeOf (MemberOp.joinOf k p d t).1.text
  | _ => Json.null

/-- A trace's vector: the server, the keys asked at the door and the steps; for each step the challenge, whether the
door would let its sender in for it beforehand (a claim's, a sign-in's or a join's), the answer, and after it the tree,
the members, the invites and what the door says of each key. -/
def memberVector (m : Members) (ops : List MemberOp) : Json × Json :=
  let input := Json.mkObj [("server", m.server.json), ("doorKeys", toJson doorKeys),
    ("ops", Json.arr (ops.map MemberOp.json).toArray)]
  let befores := m :: (m.run ops).map (·.2)
  let steps := ((ops.zip befores).zip (m.run ops)).map fun ((op, before), answer, m') =>
    Json.mkObj [("challenge", op.challenge),
      ("newcomer", match op.pending with
        | some (sender, p) => toJson (before.newcomer sender p)
        | none => Json.null),
      ("answer", match answer with | none => Json.mkObj [("ok", true)] | some why => why.json),
      ("tree", m'.treeJson), ("members", toJson m'.members), ("invites", m'.invitesJson),
      ("door", toJson (doorKeys.map m'.admits))]
  (input, Json.arr steps.toArray)

end Aven.ID

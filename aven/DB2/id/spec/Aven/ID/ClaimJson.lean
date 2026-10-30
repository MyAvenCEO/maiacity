import Aven.ID.ClaimTrace
import Aven.ID.Json

/-! # Passkeys, claims and sign-ins as JSON

The form of `vectors/passkeys.json` and `vectors/claims.json`. Bytes are hex; `clientData` is the text the browser
wrote. An assertion carries what its passkey signed (`signed`), so a test signs exactly that with the passkey's real
key and checks what was sent:

```
assertion: {"clientData":"{…}","authData":"49960de5…","signer":"passkey-a","signed":{"clientData":"…","authData":"…"}}
claim:     {"network":"aven","person":"person-a","passkey":{"id":"passkey-a","spki":"3059…"},
            "device":{"id":"device-1","key":"…"},"assertion":{…}}
sign-in:   {"network":"aven","device":{"id":"device-2","key":"…"},"assertion":{…}}
tree:      {"keys":[["passkey-a","es256:3059…"],…],"vaults":[{"id":"person-a","kind":"person","owners":["key:passkey-a"]},…]}
```
-/

open Lean

namespace Aven.ID

def Assertion.json (a : Assertion) : Json :=
  Json.mkObj [("clientData", a.clientData), ("authData", Keys.hex a.authData), ("signer", a.signer),
    ("signed", Json.mkObj [("clientData", a.signed.1), ("authData", Keys.hex a.signed.2)])]

def AssertionError.name : AssertionError → String
  | .clientData => "clientData"
  | .type => "type"
  | .challenge => "challenge"
  | .origin => "origin"
  | .authData => "authData"
  | .rpId => "rpId"
  | .notPresent => "notPresent"
  | .notVerified => "notVerified"
  | .badSignature => "badSignature"

def ClaimError.json : ClaimError → Json
  | .taken => Json.mkObj [("error", "taken")]
  | .notFromDevice => Json.mkObj [("error", "notFromDevice")]
  | .wrongNetwork => Json.mkObj [("error", "wrongNetwork")]
  | .assertion why => Json.mkObj [("error", "assertion"), ("why", why.name)]
  | .invalid why => Json.mkObj [("error", "invalid"), ("invalid", why.json)]
  | .unclaimed => Json.mkObj [("error", "unclaimed")]
  | .known => Json.mkObj [("error", "known")]

def Claim.json (c : Claim) : Json :=
  Json.mkObj [("network", c.network), ("person", c.person),
    ("passkey", Json.mkObj [("id", c.passkey), ("spki", c.passkeyKey)]),
    ("device", Json.mkObj [("id", c.device), ("key", c.deviceKey)]), ("assertion", c.assertion.json)]

def SignIn.json (i : SignIn) : Json :=
  Json.mkObj [("network", i.network), ("device", Json.mkObj [("id", i.device), ("key", i.deviceKey)]),
    ("assertion", i.assertion.json)]

def Server.treeJson (s : Server) : Json :=
  Json.mkObj [("keys", Json.arr (s.publics.map fun (id, k) => toJson [id, k]).toArray),
    ("vaults", Json.arr (s.vaults.map Vault.json).toArray)]

def Server.json (s : Server) : Json :=
  Json.mkObj [("network", s.network), ("peer", s.peer), ("peerKey", s.peerKey), ("rpId", s.rp.rpId),
    ("origins", toJson s.rp.origins), ("guardian", toJson s.guardian)]

/-- A step as a browser sends it: the statement, and the key of the browser that sends it. -/
def Op.json : Op → Json
  | .claim p d t =>
    let (c, sender) := Op.claimOf p d t
    Json.mkObj [("op", "claim"), ("from", sender), ("claim", c.json)]
  | .signIn p d t =>
    let (i, sender) := Op.signInOf p d t
    Json.mkObj [("op", "signIn"), ("from", sender), ("signIn", i.json)]
  | .restart => Json.mkObj [("op", "restart")]
  | .wipe => Json.mkObj [("op", "wipe")]

/-- The challenge the step's passkey was asked to sign, as the page computes it. -/
def Op.challenge : Op → Json
  | .claim p d t => challengeOf (Op.claimOf p d t).1.text
  | .signIn p d t => challengeOf (Op.signInOf p d t).1.text
  | _ => Json.null

/-- A trace's vector: the server and its steps; for each step the challenge, the answer and the tree after it. -/
def traceVector (s : Server) (ops : List Op) : Json × Json :=
  let input := Json.mkObj [("server", s.json), ("ops", Json.arr (ops.map Op.json).toArray)]
  let steps := (ops.zip (s.run ops)).map fun (op, answer, s') =>
    Json.mkObj [("challenge", op.challenge), ("claimed", toJson s'.claim.isSome),
      ("answer", match answer with | none => Json.mkObj [("ok", true)] | some why => why.json),
      ("tree", s'.treeJson)]
  (input, Json.arr steps.toArray)

end Aven.ID

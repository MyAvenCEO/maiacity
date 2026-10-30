import Lean.Data.Json
import Aven.ID.Safe

/-! # The safe's vectors (R13)

`safe.json`: requests to Alice's safe from her agent and from Mallory, on her Mac and on a host that keeps Doc keys
inside its safe runtime, with what each request gives back (`Aven.ID.Safe`). A backend's tests build a test runtime
from each vector's lists, replay the requests and compare. Bytes are hex, Doc ids and epochs Core's text. -/

open Lean Aven.Core

namespace Aven.ID.Safe

def Secret.json : Secret → Json
  | .identity d => Json.mkObj [("kind", "identity"), ("device", d)]
  | .vault v => Json.mkObj [("kind", "vault"), ("name", v)]
  | .group g => Json.mkObj [("kind", "group"), ("name", g)]
  | .safe => Json.mkObj [("kind", "safe")]
  | .doc d e => Json.mkObj [("kind", "doc"), ("doc", d.text), ("epoch", e.text)]
  | .credential c => Json.mkObj [("kind", "credential"), ("name", c)]

def Op.json : Op → Json
  | .unlock f => Json.mkObj [("kind", "unlock"), ("factor", f)]
  | .lock => Json.mkObj [("kind", "lock")]
  | .sign k m => Json.mkObj [("kind", "sign"), ("key", k.json), ("msg", hex m)]
  | .open st => Json.mkObj [("kind", "open"), ("to", st.to.json), ("inner", st.inner.json)]
  | .seal to x => Json.mkObj [("kind", "seal"), ("to", to.json), ("secret", x.json)]
  | .derive k l => Json.mkObj [("kind", "derive"), ("key", k.json), ("label", l)]
  | .use c call => Json.mkObj [("kind", "use"), ("credential", c), ("call", hex call)]
  | .enroll dv => Json.mkObj [("kind", "enroll"), ("device", dv)]

def Ask.json (a : Ask) : Json := Json.mkObj [("asker", a.asker), ("op", a.op.json)]

def Out.json : Out → Json
  | .plain x => Json.mkObj [("kind", "plain"), ("secret", x.json)]
  | .sealed to x => Json.mkObj [("kind", "sealed"), ("to", to.json), ("secret", x.json)]
  | .signature k m => Json.mkObj [("kind", "signature"), ("key", k.json), ("msg", hex m)]
  | .publicKey k l => Json.mkObj [("kind", "publicKey"), ("key", k.json), ("label", l)]
  | .answer b => Json.mkObj [("kind", "answer"), ("bytes", hex b)]
  | .done => Json.mkObj [("kind", "done")]
  | .refused => Json.mkObj [("kind", "refused")]

/-- A runtime as lists; `service` names the stand-in service, which answers a call with its bytes reversed. -/
def Listed.json (l : Listed) : Json :=
  Json.mkObj [("factors", toJson l.factors), ("askers", toJson l.askers), ("devices", toJson l.devices),
    ("lends", toJson l.lends), ("service", "reverse")]

def Safe.json (s : Safe) : Json :=
  Json.mkObj [("unlocked", toJson s.unlocked), ("holds", Json.arr (s.holds.map Secret.json).toArray)]

open SafeExamples in
/-- Each run: the runtime, the safe and the requests as input, and what each request gives back as expected. -/
def safeVectors : List Json :=
  let vector (name : String) (l : Listed) (as : List Ask) :=
    Json.mkObj [("name", name),
      ("input", Json.mkObj [("runtime", l.json), ("safe", alicesSafe.json),
        ("asks", Json.arr (as.map Ask.json).toArray)]),
      ("expected", Json.mkObj [("outs", Json.arr ((run l.runtime alicesSafe as).map Out.json).toArray)])]
  [vector "Alice's safe on her Mac" mac asks,
   vector "Alice's safe on a host that keeps Doc keys inside" strict asks,
   vector "the same requests from Mallory, whose cap names nothing" mac
     (asks.map fun a => { a with asker := "mallory" })]

end Aven.ID.Safe

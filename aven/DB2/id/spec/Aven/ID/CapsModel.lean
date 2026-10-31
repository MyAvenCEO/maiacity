import Aven.ID.CapsJson
import Aven.ID.Authorized
import Aven.ID.Member
import Aven.ID.Json
import Aven.Core.Model

/-! # Caps in the running model

`aven-id-model` answers caps' cases as well as trees, so a backend's property tests ask the same Lean the vectors
come from (README, rule 10). Each case is one JSON object, read in the form its vectors write:

- `{"chain": [cap…], "context": {…}}`, as `caps.json` and `issuers.json` write a chain, answers `{"ok": true}` or
  `{"ok": false, "error": {"rule", "cap"[, "line"]}}` (`chainError`). The context's tree is `"cast"` or a tree as
  `trees.json` writes one; its `threshold` is every vault's quorum but those its optional `thresholds` give (A28).
- `{"context", "caps": [cap…], "doc": facts}` answers `{"keepers": [vault…]}`, who keeps the Doc (`keepersOf`).
- `{"doc": [entry…], "revocations": [rev…][, "envelope": name]}`, as `revocations.json` writes a Doc, answers the
  verdict of the envelope named, or of every one (`verdict`). With `"owner": vault` beside the envelope it answers
  `{"survives": bool}` instead, a delete being an envelope whose body says `"delete": true`, written for the owner's
  vault (`survives`).
- `{"context", "envelope", "calls", "chain", "keys", "deviceCaps", "members", "actor"}`, as `authorized.json` writes
  a case, answers the reader's verdict on the envelope: each check, the path and the first check that refuses it
  (`Reader.authorizedB`, which `authorizedB_iff` makes `Authorized`).
- The same with `"tree"` and `"founded": [{"claim", "vault"}]`, as `member.json` writes a case, answers
  `{"authorized", "members"}`: whether caps authorizes it and the vaults it makes members (`Reader.membersB`, A38).
- `{"context", "keys", "members", "held": [cap…], "doc", "signer"}`, as `reach.json` writes a case, answers
  `{"reaches": bool}`: whether the signer's chain reaches the Doc at all, the docs layer's step 4 (`Reader.reachesB`).

A Doc's names are taken as each entry gives them, with the vault, caps and acks it lists and the envelope's `prev`
and `deps`; aven-core's tests own the hashing. -/

namespace Aven.ID.CapsModel

open Lean Aven.Core

def req {α : Type} (o : Option α) (why : String) : Except String α := o.elim (.error why) pure

/-- A hash from its readable form, `b3:<hex>`. -/
def hash? (s : String) : Option Hash :=
  match s.toList with
  | 'b' :: '3' :: ':' :: rest => (Model.unhexChars rest).map (⟨·⟩)
  | _ => none

def docId (s : String) : Except String DocId := req (Model.docId? s) s!"{s} is no Doc id"

def hashOf (s : String) : Except String Hash := req (hash? s) s!"{s} is no hash"

/-- Map keys in the codec's order: shorter first, then by their bytes. -/
def keyLt (a b : Bytes) : Bool :=
  a.length < b.length || (a.length == b.length && decide (a.map (·.toNat) < b.map (·.toNat)))

/-- An object's members, in the codec's order. -/
def members (j : Json) : Except String (List (String × Json)) := do
  match j with
  | .obj kvs =>
    let all : List (String × Json) := kvs.toList
    pure (all.mergeSort fun a b => keyLt a.1.toUTF8.toList b.1.toUTF8.toList || a.1 == b.1)
  | _ => throw "not an object"

/-- A Value from its readable form (`Aven.Core.Value.json`): `{"bytes": hex}` is a byte string, any other object a
map, its keys in the codec's order. -/
partial def valueOf : Json → Except String Value
  | .null => pure .null
  | .bool b => pure (.bool b)
  | .num n =>
    if n.exponent == 0 then
      pure (if n.mantissa ≥ 0 then .uint n.mantissa.toNat else .nint (-n.mantissa - 1).toNat)
    else throw "a number that is no integer"
  | .str s => pure (.text s.toUTF8.toList)
  | .arr xs => return .array (← xs.toList.mapM valueOf)
  | j@(.obj _) => do
    match j.getObjValAs? String "bytes", members j with
    | .ok h, .ok [_] => return .bytes (← req (Model.unhex? h) "bytes that aren't hex")
    | _, .ok kvs => return .map (← kvs.mapM fun (k, v) => return (k.toUTF8.toList, ← valueOf v))
    | _, .error e => throw e

def targetOf (j : Json) : Except String Target := do
  match j.getObjValAs? String "doc" with
  | .ok d =>
    let reach ← match ← j.getObjValAs? String "reach" with
      | "self" => pure Reach.self
      | "spawned" => pure .spawned
      | "lists" => pure .lists
      | r => throw s!"reach {r} is unknown"
    return .doc (← docId d) reach
  | .error _ =>
    let v := (← j.getObjValAs? String "vault").toUTF8.toList
    let below ← j.getObjValAs? Bool "below"
    match j.getObjValAs? String "type" with
    | .ok t => return .vaultType v (← docId t) below
    | .error _ => return .vault v below

def boundOf : Json → Except String Bound
  | .null => pure none
  | .arr vs => return some (← vs.toList.mapM valueOf)
  | _ => throw "a bound is null or an array"

def lineOf (j : Json) : Except String Line := do
  let ps ← members (← j.getObjVal? "params")
  return ⟨← hashOf (← j.getObjValAs? String "op"), ← targetOf (← j.getObjVal? "doc"),
    ← ps.mapM fun (p, b) => return (p.toUTF8.toList, ← boundOf b)⟩

def holderOf (j : Json) : Except String Holder := do
  if j == Json.str "public" then return .«public»
  match j.getObjValAs? String "vault" with
  | .ok v => return .vault v
  | .error _ => return .group (← docId (← j.getObjValAs? String "group"))

def branchesOf (j : Json) : Except String Branches := do
  match j with
  | .str "any" => pure .any
  | .str "main" => pure .main
  | .str "proposals" => pure .proposals
  | _ => return .one (← j.getObjValAs? String "branch")

def historyOf : Json → Except String History
  | .str "all" => pure .all
  | .str "from-now" => pure .fromNow
  | _ => throw "history is all or from-now"

def optNatOf (j : Json) (k : String) : Except String (Option Nat) :=
  match j.getObjValD k with
  | .null => pure none
  | v => return some (← fromJson? v)

def conditionsOf (j : Json) : Except String Conditions :=
  return { notBefore := ← j.getObjValAs? Nat "notBefore", expires := ← optNatOf j "expires",
           approve := ← j.getObjValAs? Nat "approve", uses := ← optNatOf j "uses", own := ← j.getObjValAs? Bool "own",
           branches := ← branchesOf (← j.getObjVal? "branches"), history := ← historyOf (← j.getObjVal? "history") }

def optStr (j : Json) (k : String) : Option String := (j.getObjValAs? String k).toOption

def capOf (j : Json) : Except String Cap := do
  let form ← match ← j.getObjValAs? String "form" with
    | "grant" => pure CapForm.grant
    | "attenuate" => pure .attenuate
    | f => throw s!"form {f} is unknown"
  return { id := ← j.getObjValAs? String "id", issuer := ← j.getObjValAs? String "issuer",
           holder := ← holderOf (← j.getObjVal? "holder"), parent := optStr j "parent", form,
           grant := ← (← j.getObjValAs? (Array Json) "grant").toList.mapM lineOf, role := optStr j "role",
           share := ← j.getObjValAs? Nat "share", conditions := ← conditionsOf (← j.getObjVal? "conditions"),
           signer := optStr j "signer",
           approvals := ← (← j.getObjValAs? (Array Json) "approvals").toList.mapM fun a =>
             return ⟨← a.getObjValAs? String "key", ← a.getObjValAs? String "digest"⟩ }

def factsOf (j : Json) : Except String Facts :=
  return ⟨← docId (← j.getObjValAs? String "id"), (← j.getObjValAs? String "vault").toUTF8.toList,
    ← docId (← j.getObjValAs? String "type")⟩

/-- A reader's context: the tree, one threshold for every vault but those its optional `thresholds` give their own
(A28), who is in each group, the roles, what each Doc is. -/
def ctxOf (j : Json) : Except String Ctx := do
  let tree ← match ← j.getObjVal? "tree" with
    | .str "cast" => pure cast
    | t => parseTree t
  let k ← j.getObjValAs? Nat "threshold"
  let own ← match j.getObjValD "thresholds" with
    | .null => pure []
    | t => do (← members t).mapM fun (v, n) => return (v, ← fromJson? (α := Nat) n)
  let groups ← (← j.getObjValAs? (Array Json) "groups").toList.mapM fun g =>
    return (← docId (← g.getObjValAs? String "group"), ← g.getObjValAs? (List String) "members")
  let roles ← (← j.getObjValAs? (Array Json) "roles").toList.mapM fun r =>
    return (⟨← r.getObjValAs? String "id", ← r.getObjValAs? String "name",
      ← (← r.getObjValAs? (Array Json) "grant").toList.mapM lineOf⟩ : Role)
  let facts ← (← j.getObjValAs? (Array Json) "docs").toList.mapM factsOf
  return { tree, threshold := fun v => (own.lookup v).getD k, roles, facts := fun d => facts.find? (·.id == d),
           inGroup := fun g v => groups.any fun (h, ms) => h == g && ms.contains v }

/-- The chain's verdict: kept, or the first rule it breaks. -/
def chainAnswer (x : Ctx) (cs : List Cap) : Json :=
  match chainError x cs with
  | none => Json.mkObj [("ok", true)]
  | some e => Json.mkObj [("ok", false), ("error", e.json)]

/-! ## A Doc of envelopes, by the names its entries give -/

/-- One entry of a Doc: the envelope's fields that the past reads, and what caps reads of it. Its body holds only
its name, so the envelope is found by it. -/
structure Entry where
  env : Envelope
  name : Hash
  vault : String
  caps : List Hash
  acks : List Hash
  delete : Bool

def entryOf (j : Json) : Except String Entry := do
  let e ← j.getObjVal? "envelope"
  let name ← hashOf (← j.getObjValAs? String "name")
  let prev ← match e.getObjValD "prev" with
    | .null => pure none
    | p => do pure (some (← hashOf (← fromJson? p)))
  let deps ← (← e.getObjValAs? (List String) "deps").mapM hashOf
  let delete := ((e.getObjValD "body").getObjValAs? Bool "delete").toOption.getD false
  let env : Envelope :=
    { doc := ← docId (← e.getObjValAs? String "doc"), branch := (← e.getObjValAs? String "branch").toUTF8.toList,
      writer := ← e.getObjValAs? Nat "writer", seq := ← e.getObjValAs? Nat "seq", prev, deps,
      body := .bytes name.bytes, sigs := [] }
  return { env, name, vault := ← j.getObjValAs? String "vault",
           caps := ← (← j.getObjValAs? (List String) "caps").mapM hashOf,
           acks := ← (← j.getObjValAs? (List String) "acks").mapM hashOf, delete }

/-- The name an entry gives its envelope. -/
def nameOf (e : Envelope) : Hash :=
  match e.body with
  | .bytes b => ⟨b⟩
  | _ => ⟨[]⟩

def readsOf (es : List Entry) : Reads :=
  let find (e : Envelope) := es.find? (·.name == nameOf e)
  { vault := fun e => ((find e).map (·.vault)).getD "", caps := fun e => ((find e).map (·.caps)).getD [],
    acks := fun e => ((find e).map (·.acks)).getD [] }

def revocationOf (j : Json) : Except String Revocation := do
  let envelope ← match j.getObjValD "envelope" with
    | .null => pure none
    | v => do pure (some (← hashOf (← fromJson? v)))
  let kept ← match j.getObjValD "kept" with
    | .null => pure none
    | v => do pure (some (← (← fromJson? (α := List String) v).mapM hashOf))
  return ⟨← hashOf (← j.getObjValAs? String "id"), ← hashOf (← j.getObjValAs? String "cap"), envelope, kept⟩

def docAnswer (j : Json) : Except String Json := do
  let es ← (← j.getObjValAs? (Array Json) "doc").toList.mapM entryOf
  let doc := es.map (·.env)
  let rd := readsOf es
  let rs ← ((j.getObjValD "revocations").getArr?.toOption.getD #[]).toList.mapM revocationOf
  let named (n : String) : Except String Envelope := do
    let h ← hashOf n
    req (doc.find? (nameOf · == h)) s!"no envelope named {n}"
  match j.getObjValAs? String "envelope", j.getObjValAs? String "owner" with
  | .ok n, .ok owner =>
    let isDelete (e : Envelope) := ((es.find? (·.name == nameOf e)).map (·.delete)).getD false
    let byOwner (e : Envelope) := rd.vault e == owner
    return Json.mkObj [("survives", survives nameOf isDelete byOwner doc (← named n))]
  | .ok n, .error _ => return (verdict nameOf rd doc rs (← named n)).json
  | .error _, _ => return Json.mkObj (doc.map fun e => ((nameOf e).text, (verdict nameOf rd doc rs e).json))

/-- Who governs whom, as authority runs down the context's tree (A28). -/
def govOf (x : Ctx) (v w : Bytes) : Bool := x.governs v w

/-- No actor spawned another and no collection lists a Doc in caps' cases. -/
def noDocs (_ _ : DocId) : Bool := false

/-- Who keeps a Doc (`keepersOf`): `{"context", "caps": [cap…], "doc": facts}`, as `caps.json` writes it. -/
def keepersAnswer (j : Json) : Except String Json := do
  let x ← ctxOf (← j.getObjVal? "context")
  let caps ← (← j.getObjValAs? (Array Json) "caps").toList.mapM capOf
  let f ← factsOf (← j.getObjVal? "doc")
  return Json.mkObj [("keepers", toJson (keepersOf (govOf x) noDocs noDocs x.roles caps f))]

def bytesOf (s : String) : Except String Bytes := req (Model.unhex? s) s!"{s} isn't hex"

/-- A call: its op's id, and its parameters, a map whose keys are put in the codec's order. -/
def callOf (j : Json) : Except String Call := do
  let ps ← members (← j.getObjVal? "params")
  return ⟨← hashOf (← j.getObjValAs? String "op"), ← ps.mapM fun (p, v) => return (p.toUTF8.toList, ← valueOf v)⟩

/-- A device's cap, by the key its device signs with; `"grants": null` is everything its vault may do. -/
def deviceCapOf (j : Json) : Except String (Bytes × DeviceCap) := do
  let grants ← match j.getObjValD "grants" with
    | .null => pure none
    | g => do pure (some (← (← fromJson? (α := Array Json) g).toList.mapM lineOf))
  return (← bytesOf (← j.getObjValAs? String "key"),
    { device := ← j.getObjValAs? String "device", vault := ← j.getObjValAs? String "vault", grants,
      branches := ← branchesOf (← j.getObjVal? "branches"), host := ← j.getObjValAs? Bool "host" })

/-- The reader's verdict on an envelope (`Aven.ID.Authorized`), as `authorized.json` writes a case: the envelope's Doc,
branch and signing key; its calls, for a merge into main every call the whole merge brings; the chain it names, empty
on its vault's own authority; and what the reader knows: its context, each signing key's vault, each device's cap, the
network's members, and the actor an actor host's envelope names. -/
def readerOf (j : Json) : Except String (Ctx × Reader × Envelope) := do
  let x ← ctxOf (← j.getObjVal? "context")
  let ej ← j.getObjVal? "envelope"
  let signer ← bytesOf (← ej.getObjValAs? String "signer")
  let e : Envelope :=
    { doc := ← docId (← ej.getObjValAs? String "doc"), branch := (← ej.getObjValAs? String "branch").toUTF8.toList,
      writer := 0, seq := 0, prev := none, deps := [], body := .null, sigs := [⟨signer, []⟩] }
  let calls ← (← j.getObjValAs? (Array Json) "calls").toList.mapM callOf
  let chain ← (← j.getObjValAs? (Array Json) "chain").toList.mapM capOf
  let keys ← (← j.getObjValAs? (Array Json) "keys").toList.mapM fun k =>
    return (← bytesOf (← k.getObjValAs? String "key"), ← k.getObjValAs? String "vault")
  let dcs ← (← j.getObjValAs? (Array Json) "deviceCaps").toList.mapM deviceCapOf
  let ms ← j.getObjValAs? (List String) "members"
  let actor ← match j.getObjValD "actor" with
    | .null => pure none
    | a => do pure (some (← docId (← fromJson? a)))
  let r : Reader :=
    { ctx := x, chain := fun _ => chain, calls := fun _ => calls, lower := fun _ => [], signer := fun _ => signer,
      vaultOf := fun k => (keys.find? (·.1 == k)).map (·.2), member := ms.contains, facts := x.facts,
      deviceCap := fun k => (dcs.find? (·.1 == k)).map (·.2), actorOf := fun _ => actor }
  return (x, r, e)

def authorizedAnswer (j : Json) : Except String Json := do
  let (x, r, e) ← readerOf j
  let gov := govOf x
  return readerVerdictJson (r.withinDeviceB gov noDocs noDocs e, r.ownB gov e, r.byChainB gov noDocs noDocs e,
    r.hostSignedB e, r.authorizedB gov noDocs noDocs e)

/-- Membership by confirm (A38), as `member.json` writes a case: an envelope in `authorized.json`'s form, with
Maia City's tree Doc and the claims the tree says each founded. Answers whether caps authorizes it and the vaults
it makes members (`Reader.membersB`). -/
def membersAnswer (j : Json) : Except String Json := do
  let (x, r, e) ← readerOf j
  let tree ← docId (← j.getObjValAs? String "tree")
  let fs ← (← j.getObjValAs? (Array Json) "founded").toList.mapM fun f =>
    return (← hashOf (← f.getObjValAs? String "claim"), ← f.getObjValAs? String "vault")
  let founded (h : Hash) : Option String := (fs.find? (·.1 == h)).map (·.2)
  let gov := govOf x
  return Json.mkObj [("authorized", toJson (r.authorizedB gov noDocs noDocs e)),
    ("members", toJson (r.membersB tree gov noDocs noDocs founded e))]

/-- Whether a signer's chain reaches a Doc at all, as `reach.json` writes a case (`Reader.reachesB`). -/
def reachAnswer (j : Json) : Except String Json := do
  let x ← ctxOf (← j.getObjVal? "context")
  let keys ← (← j.getObjValAs? (Array Json) "keys").toList.mapM fun k =>
    return (← bytesOf (← k.getObjValAs? String "key"), ← k.getObjValAs? String "vault")
  let ms ← j.getObjValAs? (List String) "members"
  let held ← (← j.getObjValAs? (Array Json) "held").toList.mapM capOf
  let r : Reader :=
    { ctx := x, chain := fun _ => [], calls := fun _ => [], lower := fun _ => [], signer := fun _ => [],
      vaultOf := fun k => (keys.find? (·.1 == k)).map (·.2), member := ms.contains, facts := x.facts,
      deviceCap := fun _ => none, actorOf := fun _ => none }
  return Json.mkObj [("reaches", toJson (r.reachesB (govOf x) noDocs noDocs held
    (← docId (← j.getObjValAs? String "doc")) (← bytesOf (← j.getObjValAs? String "signer"))))]

/-- A caps case, or `none` when the object is none: a tree's case then. Malformed input is a `format` result. -/
def answer? (j : Json) : Option Json :=
  let format (r : Except String Json) : Json :=
    match r with
    | .ok a => a
    | .error why => Json.mkObj [("format", why)]
  if (j.getObjVal? "held").toOption.isSome then some (format (reachAnswer j))
  else if (j.getObjVal? "founded").toOption.isSome then some (format (membersAnswer j))
  else if (j.getObjVal? "deviceCaps").toOption.isSome then some (format (authorizedAnswer j))
  else if (j.getObjVal? "chain").toOption.isSome then
    some (format do
      let x ← ctxOf (← j.getObjVal? "context")
      let cs ← (← j.getObjValAs? (Array Json) "chain").toList.mapM capOf
      pure (chainAnswer x cs))
  else if (j.getObjVal? "caps").toOption.isSome then some (format (keepersAnswer j))
  else if (j.getObjVal? "doc").toOption.isSome then some (format (docAnswer j))
  else none

end Aven.ID.CapsModel

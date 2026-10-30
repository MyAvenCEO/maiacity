import Aven.ID.CapsExamples
import Aven.ID.Gen
import Lean.Data.Json

/-! # Caps as JSON, and generated cases

The form of `vectors/caps.json`, `revocations.json`, `epochs.json`, `approvals.json` and `network.json`
(`Vectors.lean`). Caps' readable form is JSON until `Aven.Core`'s deterministic CBOR lands (A2); then the vectors add
each cap's bytes and hash. A context names the cast's tree, which `trees.json` carries, and lists who is in each group.

```
cap:      {"id":"cap-a","issuer":"alice","holder":{"vault":"bob"},"parent":null,
           "grant":[{"vault":"alice","what":"read d1"}],"role":null,"share":1,"conditions":{…},
           "signer":"alice-peer","approvals":[{"key":"alice-owner","digest":"cap-a"}]}
error:    {"rule":"wider","cap":"cap-w"}   {"rule":"authority","cap":"cap-x","atom":{…}}   {"rule":"empty"}
envelope: {"id":"b1","writer":"bob","caps":["cap-a"],"deps":[],"acks":[]}
verdict:  "counts"   {"revoked":"rev-a"}   {"waits":["zz"]}
```

Generated chains and Docs come from a seeded xorshift (`Aven.ID.Gen`), so `lake exe vectors` writes the same files on
every run, and their answers are the model's. -/

open Lean

namespace Aven.ID

def Atom.json (a : Atom) : Json := Json.mkObj [("vault", a.vault), ("what", a.what)]

def Branches.json : Branches → Json
  | .any => "any"
  | .main => "main"
  | .proposals => "proposals"
  | .one b => Json.mkObj [("branch", b)]

def History.json : History → Json
  | .all => "all"
  | .fromNow => "from-now"

def Conditions.json (c : Conditions) : Json :=
  Json.mkObj [("notBefore", toJson c.notBefore), ("expires", toJson c.expires), ("approve", toJson c.approve),
    ("uses", toJson c.uses), ("own", toJson c.own), ("branches", c.branches.json), ("history", c.history.json)]

def Holder.json : Holder → Json
  | .vault v => Json.mkObj [("vault", v)]
  | .group g => Json.mkObj [("group", g)]
  | .«public» => "public"
  | .ticket k => Json.mkObj [("ticket", k)]

def Sig.json (s : Sig) : Json := Json.mkObj [("key", s.key), ("digest", s.digest)]

def Cap.json (c : Cap) : Json :=
  Json.mkObj [("id", c.id), ("issuer", c.issuer), ("holder", c.holder.json), ("parent", toJson c.parent),
    ("grant", Json.arr (c.grant.map Atom.json).toArray), ("role", toJson c.role), ("share", toJson c.share),
    ("conditions", c.conditions.json), ("signer", c.signer), ("approvals", Json.arr (c.approvals.map Sig.json).toArray)]

def Role.json (r : Role) : Json :=
  Json.mkObj [("id", r.id), ("name", r.name), ("grant", Json.arr (r.grant.map Atom.json).toArray)]

def ChainError.json : ChainError → Json
  | .empty => Json.mkObj [("rule", "empty")]
  | .notRoot c => Json.mkObj [("rule", "notRoot"), ("cap", c)]
  | .authority c a => Json.mkObj [("rule", "authority"), ("cap", c), ("atom", a.json)]
  | .signer c => Json.mkObj [("rule", "signer"), ("cap", c)]
  | .approval c => Json.mkObj [("rule", "approval"), ("cap", c)]
  | .publicShares c => Json.mkObj [("rule", "publicShares"), ("cap", c)]
  | .parent c => Json.mkObj [("rule", "parent"), ("cap", c)]
  | .issuer c => Json.mkObj [("rule", "issuer"), ("cap", c)]
  | .wider c => Json.mkObj [("rule", "wider"), ("cap", c)]
  | .share c => Json.mkObj [("rule", "share"), ("cap", c)]
  | .conditions c => Json.mkObj [("rule", "conditions"), ("cap", c)]

/-- The cast's context as the vectors give it: the tree by name, one owner per approval, and the groups. -/
def castCtxJson : Json :=
  Json.mkObj [("tree", "cast"), ("threshold", toJson (1 : Nat)),
    ("groups", Json.arr #[Json.mkObj [("group", "g-garden"), ("members", toJson ["alice", "bob"])]]),
    ("roles", Json.arr (castCtx.roles.map Role.json).toArray)]

def chainResult (cs : List Cap) : Json :=
  match chainError castCtx cs with
  | none => Json.mkObj [("ok", true)]
  | some e => Json.mkObj [("ok", false), ("error", e.json)]

def Envelope.json (e : Envelope) : Json :=
  Json.mkObj [("id", e.id), ("writer", e.writer), ("caps", toJson e.caps), ("deps", toJson e.deps),
    ("acks", toJson e.acks)]

def Revocation.json (r : Revocation) : Json :=
  Json.mkObj [("id", r.id), ("cap", r.cap), ("envelope", toJson r.envelope), ("kept", toJson r.kept)]

def Verdict.json : Verdict → Json
  | .counts => "counts"
  | .revoked r => Json.mkObj [("revoked", r)]
  | .waits m => Json.mkObj [("waits", toJson m)]

def docJson (doc : List Envelope) (rs : List Revocation) : List (String × Json) :=
  [("doc", Json.arr (doc.map Envelope.json).toArray), ("revocations", Json.arr (rs.map Revocation.json).toArray)]

def worldJson (w : World) (parties : List String) : Json :=
  Json.mkObj [("own", Json.mkObj (parties.map fun p => (p, toJson (w.own p)))),
    ("seals", Json.arr (w.seals.map fun (k, u) => Json.mkObj [("key", k), ("under", u)]).toArray)]

def TicketClaim.json (c : TicketClaim) : Json := Json.mkObj [("claimant", c.claimant), ("hash", toJson c.hash)]

/-! ## Generated cases -/

def pick (r : Rng) (l : List String) : String × Rng :=
  let (i, r) := r.below (max l.length 1)
  (l[i]?.getD "", r)

def genVaults : List String := ["alice", "bob", "maia-city", "aven"]

def genDevices (v : String) : List String :=
  if v = "alice" then ["alice-peer", "alice-peer-light"] else if v = "bob" then ["bob-peer-light"]
  else if v = "aven" then ["aven-peer"] else []

def genOwner (v : String) : String :=
  if v = "alice" then "alice-owner" else if v = "bob" then "bob-owner" else "no-owner"

def genWhats : List String := ["read d1", "write d1", "read d2"]

/-- A random cap after `parent`: mostly a fair narrowing by the parent's holder, now and then wider, longer, unsigned,
unapproved, or issued by someone else. -/
def genCap (r : Rng) (id : String) (parent : Option Cap) : Cap × Rng := Id.run do
  let mut r := r
  let (k, r1) := r.below 20; r := r1
  let (other, r2) := pick r (if k < 14 then ["alice", "bob"] else genVaults); r := r2
  let issuer := match parent with
    | some p => match p.holder with
      | .vault v => if k < 16 then v else other
      | _ => if k < 10 then "alice" else other
    | none => other
  let (h, r3) := r.below 20; r := r3
  let (hv, r4) := pick r (if h < 11 then ["alice", "bob"] else genVaults); r := r4
  let holder : Holder := if h < 14 then .vault hv else if h < 17 then .group "g-garden" else if h < 19 then .«public»
    else .ticket "t-1"
  let (w, r5) := r.below 2; r := r5
  let (wv, r6) := pick r (issuer :: genVaults); r := r6
  let (what, r7) := pick r genWhats; r := r7
  let wide := k == 3 || k == 7
  let grant := match parent with
    | some p => (if w == 0 then p.grant.take 1 else p.grant) ++ (if wide then [⟨wv, what⟩] else [])
    | none => [⟨if k < 17 then issuer else wv, what⟩] ++ (if w == 0 then [] else [⟨issuer, "read d2"⟩])
  let (sh, r8) := r.below 3; r := r8
  let share := match parent with
    | some p => if k == 5 then p.share + 1 else p.share - 1
    | none => sh + 1
  let (dev, r9) := pick r (genDevices issuer ++ (if k == 11 then ["aven-peer"] else [])); r := r9
  let signer := if k == 13 || dev = "" then "bob-peer-light" else dev
  let approvals := if k == 2 then [] else if k == 9 then [⟨genOwner issuer, "other"⟩] else [⟨genOwner issuer, id⟩]
  let expires := match parent with
    | some p => if k == 6 then none else p.conditions.expires
    | none => if k == 0 then some 100 else none
  pure ({ id, issuer, holder, parent := if k == 19 then some "cap-z" else parent.map (·.id), grant, share, signer,
          approvals, conditions := { expires } }, r)

def genChain (seed : Nat) : List Cap := Id.run do
  let mut r := Rng.seed seed
  let (n, r1) := r.below 4; r := r1
  let mut caps : List Cap := []
  let mut prev : Option Cap := none
  for i in [0:n + 1] do
    let (c, r2) := genCap r s!"cap-{seed}-{i}" prev
    r := r2
    caps := caps ++ [c]
    prev := some c
  pure caps

/-- A random Doc: envelopes by Alice, Bob and Maia City building on earlier ones, Bob's mostly under `cap-a`, now and
then an ack, and one revocation of `cap-a`, living in the Doc or elsewhere, perhaps with a kept list. -/
def genDoc (seed : Nat) : List Envelope × List Revocation := Id.run do
  let mut r := Rng.seed (seed + 1000)
  let (n, r1) := r.below 5; r := r1
  let mut doc : List Envelope := []
  let (inDoc, r2) := r.below 2; r := r2
  let (at_, r3) := r.below (n + 4); r := r3
  for i in [0:n + 4] do
    let (wi, r4) := r.below 3; r := r4
    let writer := ["alice", "bob", "maia-city"][wi]?.getD "alice"
    let (d1, r5) := r.below (i + 1); r := r5
    let (d2, r6) := r.below (i + 1); r := r6
    let deps := ((if d1 < i then [s!"e{d1}"] else []) ++ (if d2 < i ∧ d2 ≠ d1 then [s!"e{d2}"] else []))
    let (a, r7) := r.below 4; r := r7
    let isRev := inDoc == 1 && i == at_
    let acks := if inDoc == 0 && writer ≠ "bob" && a == 0 then ["rev"] else []
    let caps := if writer = "bob" && a ≠ 3 && !isRev then ["cap-a"] else []
    doc := doc ++ [⟨s!"e{i}", if isRev then "alice" else writer, caps, deps, acks⟩]
  let (kept, r8) := r.below 3; r := r8
  let bobs := (doc.filter (·.writer == "bob")).map (·.id)
  let rev : Revocation := if inDoc == 1 then ⟨"rev", "cap-a", some s!"e{at_}", none⟩
    else ⟨"rev", "cap-a", none, if kept == 0 then some (bobs.take 1) else none⟩
  let _ := r
  pure (doc, [rev])

def generatedChains : Nat := 40
def generatedDocs : Nat := 30

end Aven.ID

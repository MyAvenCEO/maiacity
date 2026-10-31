import Aven.ID.CapsExamples
import Aven.ID.Keep
import Aven.ID.Authority
import Aven.ID.Gen
import Aven.Core.Json
import Lean.Data.Json

/-! # Caps as JSON, and generated cases

The form of `vectors/caps.json`, `revocations.json`, `epochs.json`, `approvals.json`, `network.json`, `keep.json`,
`collections.json` and `authorized.json` (`Vectors.lean`). Caps' readable form is JSON. A line's op is its id, as Core's
`ops.json` names `core/1`'s, and its target is written as Core's vectors write it (`targets.json`): Docs as `d:` and
hex; a bound is null for any value, or the values it allows. Each cap carries its CBOR bytes
and hash. The cast's caps and tree are written with their readable handles, fixtures (A210); every byte form, a cap's
CBOR, its hash and what it signs, and every target and Doc's facts, writes a vault as its 32-byte name, the cast
genesis's (`Named.name`, `VaultName.castName`). A context names the cast's tree, which `trees.json` carries, and lists who is in each group and what each Doc
is.

```
cap:      {"id":"cap-a","issuer":"alice","holder":{"vault":"bob"},"parent":null,"form":"grant",
           "grant":[{"op":"b3:…","doc":{"doc":"d:6431","reach":"self"},"params":{}}],"role":null,"share":1,
           "conditions":{…},
           "signer":"alice-peer","approvals":[{"key":"alice-owner","digest":"cap-a"}]}
error:    {"rule":"wider","cap":"cap-w"}   {"rule":"holder","cap":"att-bob"}   {"rule":"empty"}
          {"rule":"authority","cap":"cap-x","line":{…}}
envelope: {"label":"b1","name":"b3:…","vault":"bob","caps":["b3:…"],"acks":[],
           "envelope":{"doc":"d:…","branch":"main","writer":2,"seq":1,"prev":null,"deps":[],"body":{…},…}}
verdict:  "counts"   {"revoked":"b3:…"}   {"waits":["b3:…"]}
link:     {"doc":"d1","n":1,"epoch":7,"key":201,"prev":100,"signer":100}
proof:    {"device":"alice-peer-light","vault":"alice","key":301,"exporter":"x-1"}
```

Generated chains and Docs come from a seeded xorshift (`Aven.ID.Gen`), so `lake exe vectors` writes the same files on
every run, and their answers are the model's. -/

open Lean

namespace Aven.ID

def targetJson : Core.Target → Json
  | .doc d r => Json.mkObj [("doc", d.text), ("reach", r.name)]
  | .vault v b => Json.mkObj [("vault", v.text), ("below", toJson b)]
  | .vaultType v t b => Json.mkObj [("vault", v.text), ("type", t.text), ("below", toJson b)]

def boundJson : Core.Bound → Json
  | none => Json.null
  | some vs => Json.arr (vs.map Core.Value.json).toArray

def Line.json (l : Line) : Json :=
  Json.mkObj [("op", l.op.text), ("doc", targetJson l.doc),
    ("params", Json.mkObj (l.params.map fun (p, b) => (Core.utf8Text p, boundJson b)))]

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

def Holder.json : Holder String → Json
  | .vault v => Json.mkObj [("vault", v)]
  | .group g => Json.mkObj [("group", g.text)]
  | .«public» => "public"

def Sig.json (s : Sig) : Json := Json.mkObj [("key", s.key), ("digest", s.digest)]

def Cap.json (c : Cap String) : Json :=
  Json.mkObj [("id", c.id), ("issuer", c.issuer), ("holder", c.holder.json), ("parent", toJson c.parent),
    ("form", c.form.name), ("grant", Json.arr (c.grant.map Line.json).toArray), ("role", toJson c.role),
    ("share", toJson c.share), ("conditions", c.conditions.json), ("signer", toJson c.signer),
    ("approvals", Json.arr (c.approvals.map Sig.json).toArray),
    ("cbor", Core.hex (c.map Named.name).bytes), ("hash", ((c.map Named.name).digest Core.blake3).text),
    ("signs", Core.hex (c.map Named.name).signing)]

/-- A Doc's facts, as its genesis fixes them: its id, its vault and its root type. -/
def factsJson (f : Core.Facts) : Json :=
  Json.mkObj [("id", f.id.text), ("vault", f.vault.text), ("type", f.type.text)]

def Listing.json (l : Listing) : Json :=
  Json.mkObj [("cap", l.cap.json),
    ("docs", Json.arr (l.docs.map fun (d, k) => Json.mkObj [("doc", d.text), ("fetchKey", toJson k)]).toArray)]

def KeepOrder.json (o : KeepOrder) : Json :=
  match o.order with
  | .withdraw c => Json.mkObj [("withdraw", c), ("signer", o.signer)]
  | .delete d => Json.mkObj [("delete", d.text), ("signer", o.signer)]

/-- A keeper's books on the cast's tree, one owner per approval, with its vault's offers and Maia City's members. -/
def Books.json (b : Books) : Json :=
  Json.mkObj [("keeper", b.keeper), ("tree", "cast"), ("threshold", toJson (1 : Nat)),
    ("listings", Json.arr (b.listings.map Listing.json).toArray),
    ("orders", Json.arr (b.orders.map KeepOrder.json).toArray),
    ("offers", Json.arr (b.offers.map Cap.json).toArray),
    ("groups", Json.arr #[Json.mkObj [("group", gMembers.text), ("members", toJson ["alice", "bob"])]])]

def Role.json (r : Role) : Json :=
  Json.mkObj [("id", r.id), ("name", r.name), ("grant", Json.arr (r.grant.map Line.json).toArray)]

def ChainError.json : ChainError → Json
  | .empty => Json.mkObj [("rule", "empty")]
  | .notRoot c => Json.mkObj [("rule", "notRoot"), ("cap", c)]
  | .authority c l => Json.mkObj [("rule", "authority"), ("cap", c), ("line", l.json)]
  | .signer c => Json.mkObj [("rule", "signer"), ("cap", c)]
  | .approval c => Json.mkObj [("rule", "approval"), ("cap", c)]
  | .publicShares c => Json.mkObj [("rule", "publicShares"), ("cap", c)]
  | .keepShares c => Json.mkObj [("rule", "keepShares"), ("cap", c)]
  | .group c => Json.mkObj [("rule", "group"), ("cap", c)]
  | .parent c => Json.mkObj [("rule", "parent"), ("cap", c)]
  | .issuer c => Json.mkObj [("rule", "issuer"), ("cap", c)]
  | .holder c => Json.mkObj [("rule", "holder"), ("cap", c)]
  | .wider c => Json.mkObj [("rule", "wider"), ("cap", c)]
  | .share c => Json.mkObj [("rule", "share"), ("cap", c)]
  | .conditions c => Json.mkObj [("rule", "conditions"), ("cap", c)]

/-- The cast's context as the vectors give it: the tree by name, one owner per approval, and the groups. -/
def castCtxJson : Json :=
  Json.mkObj [("tree", "cast"), ("threshold", toJson (1 : Nat)),
    ("groups", Json.arr #[Json.mkObj [("group", gGarden.text), ("members", toJson ["alice", "bob"])]]),
    ("roles", Json.arr (castCtx.roles.map Role.json).toArray),
    ("docs", Json.arr ([d1, d2, b1, cityNotes, cityDome, gGarden, album, avenNotes].filterMap fun d =>
      (castFacts d).map factsJson).toArray)]

def chainResult (cs : List (Cap String)) : Json :=
  match chainError castCtx cs with
  | none => Json.mkObj [("ok", true)]
  | some e => Json.mkObj [("ok", false), ("error", e.json)]

open RevokeExamples in
/-- An example envelope: its label, its name, what caps reads of it, its signed time, and the envelope as Core's vectors
write it (`core/spec/vectors/envelopes.json`). -/
def envelopeJson (e : Core.Envelope) : Json :=
  Json.mkObj [("label", label e), ("name", (nm e).text), ("vault", reads.vault e),
    ("caps", toJson ((reads.caps e).map (·.text))), ("acks", toJson ((reads.acks e).map (·.text))),
    ("time", toJson (time e)),
    ("envelope", Json.mkObj [("doc", e.doc.text), ("branch", Core.utf8Text e.branch), ("writer", toJson e.writer),
      ("seq", toJson e.seq), ("prev", toJson (e.prev.map (·.text))), ("deps", toJson (e.deps.map (·.text))),
      ("body", e.body.json),
      ("sigs", Json.arr (e.sigs.map fun x =>
        Json.mkObj [("signer", Core.hex x.signer), ("sig", Core.hex x.sig)]).toArray)])]

def Revocation.json (r : Revocation) : Json :=
  Json.mkObj [("id", r.id.text), ("cap", r.cap.text), ("envelope", toJson (r.envelope.map (·.text))),
    ("kept", toJson (r.kept.map (·.map (·.text))))]

def Verdict.json : Verdict → Json
  | .counts => "counts"
  | .revoked r => Json.mkObj [("revoked", r.text)]
  | .waits m => Json.mkObj [("waits", toJson (m.map (·.text)))]

def docJson (doc : List Core.Envelope) (rs : List Revocation) : List (String × Json) :=
  [("doc", Json.arr (doc.map envelopeJson).toArray), ("revocations", Json.arr (rs.map Revocation.json).toArray)]

def worldJson (w : World) (parties : List String) : Json :=
  Json.mkObj [("own", Json.mkObj (parties.map fun p => (p, toJson (w.own p)))),
    ("seals", Json.arr (w.seals.map fun (k, u) => Json.mkObj [("key", k), ("under", u)]).toArray)]

def TicketClaim.json (c : TicketClaim) : Json := Json.mkObj [("claimant", c.claimant), ("hash", toJson c.hash)]

def FetchLink.json (l : FetchLink) : Json :=
  Json.mkObj [("doc", l.doc), ("n", toJson l.n), ("epoch", toJson l.epoch), ("key", toJson l.key),
    ("prev", toJson l.prev), ("signer", toJson l.signer)]

def Choice.json (c : Choice) : Json :=
  Json.mkObj [("depth", toJson c.depth), ("fork", toJson c.fork), ("branch", toJson c.branch), ("signer", c.signer)]

def Keep.json (s : Keep) : Json :=
  Json.mkObj [("doc", s.doc), ("genesis", toJson s.genesis), ("links", Json.arr (s.links.map FetchLink.json).toArray),
    ("issuer", toJson s.issuer), ("choices", Json.arr (s.choices.map Choice.json).toArray)]

def Keep.Proof.json (p : Keep.Proof) : Json :=
  Json.mkObj [("device", p.device), ("vault", p.vault), ("key", toJson p.key), ("exporter", p.exporter)]


/-- What a keeper takes, by depth, its current fetch key, and its flags, each in order of depth and key. -/
def keepResult (s : Keep) : Json :=
  let pair (i k : Nat) := Json.mkObj [("depth", toJson i), ("key", toJson k)]
  let kept := (List.range (s.depth + 1)).flatMap fun i => ((s.level i).eraseDups.mergeSort (· ≤ ·)).map (i, ·)
  let flags := s.flags.eraseDups.mergeSort fun a b => a.1 < b.1 || (a.1 == b.1 && a.2 ≤ b.2)
  Json.mkObj [("kept", Json.arr (kept.map fun (i, k) => pair i k).toArray), ("current", toJson s.current),
    ("flags", Json.arr (flags.map fun (i, k) => pair i k).toArray), ("unsettled", toJson s.unsettled)]

/-- A reader's verdict on an envelope, as `authorized.json` writes it: each check (`Aven.ID.Authorized`), and the
path it takes, `"own"` or `"chain"`, or `"refused"` with the first check that fails, in the order a reader checks:
`"device"`, its device cap; `"authority"`, neither its vault's own authority, which never counts for an actor host,
nor a chain that allows its calls; `"actor"`, an actor host's envelope under a chain that names no actor (A27). -/
def readerVerdictJson : Bool × Bool × Bool × Bool × Bool → Json
  | (withinDevice, own, byChain, hostSigned, authorized) =>
    let path : String := if !authorized then "refused" else if own && !hostSigned then "own" else "chain"
    let refusal : List (String × Json) :=
      if authorized then []
      else if !withinDevice then [("refusal", "device")]
      else if !byChain then [("refusal", "authority")]
      else [("refusal", "actor")]
    Json.mkObj ([("withinDevice", toJson withinDevice), ("own", toJson own), ("byChain", toJson byChain),
      ("hostSigned", toJson hostSigned), ("authorized", toJson authorized), ("path", path)] ++ refusal)

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

/-- Lines on a vault's Docs, as the cast has them; Aven's Doc `a1` is one the reader doesn't know. -/
def genLines (v : String) : List Line :=
  if v = "alice" then [readOn d1] ++ tasksOn d1 ++ [readOn d2] else if v = "bob" then readOn b1 :: tasksOn b1
  else if v = "maia-city" then [readOn cityDome] else [readOn (docOf "a1")]

/-- A random cap after `parent`: mostly a fair narrowing by the parent's holder, now and then wider, longer, unsigned,
unapproved, issued by someone else, or held by a group the reader doesn't know. A quarter of the links attenuate: by
the parent's holder, keeping it, with no approval, now and then handing the cap to another holder or sharing further;
now and then a chain starts with one. -/
def genCap (r : Rng) (id : String) (parent : Option (Cap String)) : Cap String × Rng := Id.run do
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
  let holder : Holder String := if h < 14 then .vault hv else if h < 17 then .group gGarden else if h < 19 then .«public»
    else .group (docOf "g-unknown")
  let (w, r5) := r.below 2; r := r5
  let (wv, r6) := pick r (issuer :: genVaults); r := r6
  let (li, r7) := r.below 3; r := r7
  let lineOf (v : String) : Line := ((genLines v)[li % (genLines v).length]?).getD (readOn d1)
  let wide := k == 3 || k == 7
  let grant := match parent with
    | some p => (if w == 0 then p.grant.take 1 else p.grant) ++ (if wide then [lineOf wv] else [])
    | none => [lineOf (if k < 17 then issuer else wv)] ++ (if w == 0 then [] else [lineOf issuer])
  let (sh, r8) := r.below 3; r := r8
  let share := match parent with
    | some p => if k == 5 then p.share + 1 else p.share - 1
    | none => sh + 1
  let (dev, r9) := pick r (genDevices issuer ++ (if k == 11 then ["aven-peer"] else [])); r := r9
  let signer := if k == 13 || dev = "" then "bob-peer-light" else dev
  let approvals :=
    if k == 2 then [] else if k == 9 then [⟨genOwner issuer, "other"⟩] else [⟨genOwner issuer, id⟩]
  let expires := match parent with
    | some p => if k == 6 then none else p.conditions.expires
    | none => if k == 0 then some 100 else none
  let (a, r10) := r.below 4; r := r10
  let form : CapForm := if a == 0 && (parent.isSome || k < 4) then .attenuate else .grant
  let (holder, share, approvals) := match form, parent with
    | .attenuate, some p =>
      (if k == 4 then holder else p.holder, if k == 5 then p.share + 1 else p.share, ([] : List Sig))
    | _, _ => (holder, share, approvals)
  pure ({ id, issuer, holder, parent := if k == 19 then some "cap-z" else parent.map (·.id), form, grant, share,
          signer, approvals, conditions := { expires } }, r)

def genChain (seed : Nat) : List (Cap String) := Id.run do
  let mut r := Rng.seed seed
  let (n, r1) := r.below 4; r := r1
  let mut caps : List (Cap String) := []
  let mut prev : Option (Cap String) := none
  for i in [0:n + 1] do
    let (c, r2) := genCap r s!"cap-{seed}-{i}" prev
    r := r2
    caps := caps ++ [c]
    prev := some c
  pure caps

open RevokeExamples in
/-- A random Doc: Core envelopes by Alice, Bob and Maia City building on earlier ones, Bob's mostly under `cap-a`, now
and then an ack, and one revocation of `cap-a`, living in the Doc or elsewhere, perhaps with a kept list. -/
def genDoc (seed : Nat) : List Core.Envelope × List Revocation := Id.run do
  let mut r := Rng.seed (seed + 1000)
  let (n, r1) := r.below 5; r := r1
  let mut doc : List Core.Envelope := []
  let (inDoc, r2) := r.below 2; r := r2
  let (at_, r3) := r.below (n + 4); r := r3
  let rev := Core.blake3 "rev".toUTF8.toList
  for i in [0:n + 4] do
    let (wi, r4) := r.below 3; r := r4
    let isRev := inDoc == 1 && i == at_
    let writer := if isRev then "alice" else ["alice", "bob", "maia-city"][wi]?.getD "alice"
    let (d1, r5) := r.below (i + 1); r := r5
    let (d2, r6) := r.below (i + 1); r := r6
    let deps := ((if d1 < i then [doc[d1]?] else []) ++ (if d2 < i ∧ d2 ≠ d1 then [doc[d2]?] else [])).filterMap
      (·.map nm)
    let (a, r7) := r.below 4; r := r7
    let acks := if inDoc == 0 && writer ≠ "bob" && a == 0 then [rev] else []
    let caps := if writer = "bob" && a ≠ 3 && !isRev then [RevokeExamples.capA] else []
    let w := if writer = "alice" then 1 else if writer = "bob" then 2 else 3
    doc := doc ++ [env w (i + 1) s!"e{i}" writer caps acks deps]
  let (kept, r8) := r.below 3; r := r8
  let bobs := (doc.filter (reads.vault · == "bob")).map nm
  let revocation : Revocation := if inDoc == 1 then ⟨rev, RevokeExamples.capA, (doc[at_]?).map nm, none⟩
    else ⟨rev, RevokeExamples.capA, none, if kept == 0 then some (bobs.take 1) else none⟩
  let _ := r
  pure (doc, [revocation])

/-- A random keeper's links for `d1`, each after a key made before it: mostly rotations, so forks come when two pick
one key, and now and then a link signed by another key, for `d2`, after a key that doesn't chain, or one epoch too
deep. -/
def genKeep (seed : Nat) : Keep := Id.run do
  let mut r := Rng.seed (seed + 2000)
  let (m, r1) := r.below 7; r := r1
  let mut keys : List (Nat × Nat) := [(0, 100)]
  let mut links : List FetchLink := []
  for i in [0:m + 3] do
    let (p, r2) := r.below keys.length; r := r2
    let (d, k) := keys[p]?.getD (0, 100)
    let (e, r3) := r.below 40; r := r3
    let (fault, r4) := r.below 12; r := r4
    let key := 1000 + i
    let link : FetchLink :=
      if fault == 0 then ⟨"d1", d + 1, e, key, k, 999⟩
      else if fault == 1 then ⟨"d2", d + 1, e, key, k, k⟩
      else if fault == 2 then ⟨"d1", d + 1, e, key, 555, 555⟩
      else if fault == 3 then ⟨"d1", d + 2, e, key, k, k⟩
      else ⟨"d1", d + 1, e, key, k, k⟩
    links := links ++ [link]
    if fault ≥ 4 then keys := keys ++ [(d + 1, key)]
  pure { doc := "d1", genesis := 100, links }

def generatedChains : Nat := 40
def generatedDocs : Nat := 30
def generatedKeeps : Nat := 30

/-- What caps reads of a body's `authority` Value (`Authority.ofValue?`), as `authority.json` writes it:
`{"reads": false}`, or `{"reads": true, "caps": [name…], "acks": [name…], "actor": Doc or null}`. -/
def Authority.readJson : Option Authority → Json
  | some a => Json.mkObj [("reads", toJson true), ("caps", toJson (a.caps.map (·.text))),
      ("acks", toJson (a.acks.map (·.text))), ("actor", match a.actor with
        | some d => Json.str d.text
        | none => Json.null)]
  | none => Json.mkObj [("reads", toJson false)]

end Aven.ID

import Aven.ID.CapsExamples
import Aven.ID.Authorized

/-! # The reader's verdict on the cast

`authorized.json`'s cases (`Aven.ID.Authorized`): an envelope's signer, Doc and branch, the chain it names and the
calls it makes, judged by a reader of the cast who knows each signing key's vault, each device's cap and the network's
members. Who governs whom is the cast's tree; no actor spawned another and no collection lists a Doc here. Each case's
answer is written out by hand and checked as the module builds, and `authorizedB_iff` makes it `Authorized`'s. -/

namespace Aven.ID.AuthorizedExamples

open Aven.Core

def key (s : String) : Bytes := s.toUTF8.toList

/-- Who governs whom on the cast, by vault ids `v:<name>`. -/
def castGov (v w : Bytes) : Bool :=
  let name (b : Bytes) : String := ((utf8Text b).drop 2).toString
  (cast.governs (name v)).contains (name w)

/-- The network's members, for public caps (D15). -/
def castMembers : List String := ["alice", "bob"]

/-- Each signing key and the vault its device serves. -/
def castKeys : List (Bytes × String) :=
  [(key "alice-peer-light", "alice"), (key "bob-peer-light", "bob"), (key "alice-agent", "alice"),
   (key "aven-peer", "aven")]

/-- Each device's cap: Alice's and Bob's phones may do everything their vaults may; Alice's agent reads `d1` and
patches its tasks, on proposals only; Aven's Peer, an actor host, holds its hosted actors' standing caps (A27). -/
def castDeviceCaps : List (Bytes × DeviceCap) :=
  [(key "alice-peer-light", ⟨"alice-peer-light", "alice", none, .any, false⟩),
   (key "bob-peer-light", ⟨"bob-peer-light", "bob", none, .any, false⟩),
   (key "alice-agent", ⟨"alice-agent", "alice", some [readOn d1, writeOn .patch d1 tasks], .proposals, false⟩),
   (key "aven-peer", ⟨"aven-peer", "aven", some (readOn d1 :: tasksOn d1 ++ [writeOn .patch avenNotes tasks]), .any,
     true⟩)]

/-- Calls: tick a task done, patch another type, remove a task, add a task, put a note, read. -/
def tick : Call := ⟨coreOp .patch, [(typeParam, docValue tasks), (fieldsParam, .array [fieldValue "done"])]⟩
def patchOther : Call := ⟨coreOp .patch, [(typeParam, docValue d2)]⟩
def removeTask : Call := ⟨coreOp .remove, [(typeParam, docValue tasks)]⟩
def putTask : Call := ⟨coreOp .put, [(typeParam, docValue tasks)]⟩
def putNote : Call := ⟨coreOp .put, [(typeParam, docValue notes)]⟩
def readCall : Call := ⟨coreOp .read, []⟩

/-- An actor Aven's Peer hosts. -/
def anActor : DocId := docOf "an-actor"

/-- A case: its name, the signing key, the Doc, the branch, the chain, the calls, the acting actor, and its answer:
within the device cap, own authority, by chain, host-signed, authorized. -/
structure Case where
  name : String
  signer : String
  doc : DocId
  branch : String := "main"
  chain : List Cap := []
  calls : List Call
  actor : Option DocId := none
  answer : Bool × Bool × Bool × Bool × Bool

def Case.envelope (c : Case) : Envelope :=
  { doc := c.doc, branch := key c.branch, writer := 1, seq := 1, prev := none, deps := [], body := .null,
    signer := key c.signer, sig := [] }

def Case.reader (c : Case) : Reader :=
  { ctx := castCtx, chain := fun _ => c.chain, calls := fun _ => c.calls, lower := fun _ => [],
    vaultOf := fun k => (castKeys.find? (·.1 == k)).map (·.2), member := castMembers.contains,
    facts := castCtx.facts, deviceCap := fun k => (castDeviceCaps.find? (·.1 == k)).map (·.2),
    actorOf := fun _ => c.actor }

def none' (_ _ : DocId) : Bool := false

/-- What a reader of the cast computes. -/
def Case.verdict (c : Case) : Bool × Bool × Bool × Bool × Bool :=
  let r := c.reader
  let e := c.envelope
  (r.withinDeviceB castGov none' none' e, r.ownB castGov e, r.byChainB castGov none' none' e, r.hostSignedB e,
    r.authorizedB castGov none' none' e)

def cases : List Case := [
  { name := "Alice's phone writes her own Doc: her vault's own authority", signer := "alice-peer-light", doc := d1,
    calls := [tick], answer := (true, true, false, false, true) },
  { name := "Bob's phone writes Alice's Doc with no chain: no authority", signer := "bob-peer-light", doc := d1,
    calls := [tick], answer := (true, false, false, false, false) },
  { name := "Bob ticks a task on d1 under cap-a", signer := "bob-peer-light", doc := d1, chain := [capA],
    calls := [tick], answer := (true, false, true, false, true) },
  { name := "under cap-a, a patch of another type: outside its bounds", signer := "bob-peer-light", doc := d1,
    chain := [capA], calls := [patchOther], answer := (true, false, false, false, false) },
  { name := "under cap-a, a remove: an op it doesn't name", signer := "bob-peer-light", doc := d1, chain := [capA],
    calls := [removeTask], answer := (true, false, false, false, false) },
  { name := "Bob reads d1 under cap-b, held by g-garden, which he is in", signer := "bob-peer-light", doc := d1,
    chain := [capA, capB], calls := [readCall], answer := (true, false, true, false, true) },
  { name := "Alice's agent writes on main: its device cap is for proposals", signer := "alice-agent", doc := d1,
    calls := [tick], answer := (false, true, false, false, false) },
  { name := "Alice's agent proposes a tick, within its device cap", signer := "alice-agent", doc := d1,
    branch := "fix-title", calls := [tick], answer := (true, true, false, false, true) },
  { name := "Alice's agent proposes a remove, beyond its device cap", signer := "alice-agent", doc := d1,
    branch := "fix-title", calls := [removeTask], answer := (false, true, false, false, false) },
  { name := "Aven's Peer writes for an actor under cap-host, naming it (A27)", signer := "aven-peer", doc := d1,
    chain := [capHost], calls := [tick], actor := some anActor, answer := (true, false, true, true, true) },
  { name := "the same, naming no actor", signer := "aven-peer", doc := d1, chain := [capHost], calls := [tick],
    answer := (true, false, true, true, false) },
  { name := "Aven's Peer on Aven's own Doc, with no chain: a host never writes on its vault's own authority",
    signer := "aven-peer", doc := avenNotes, calls := [tick], actor := some anActor,
    answer := (true, true, false, true, false) },
  { name := "a merge into main read whole: a put of tasks and a tick, within cap-a", signer := "bob-peer-light",
    doc := d1, chain := [capA], calls := [putTask, tick], answer := (true, false, true, false, true) },
  { name := "a merge into main read whole: a note it brings is beyond cap-a", signer := "bob-peer-light", doc := d1,
    chain := [capA], calls := [tick, putNote], answer := (true, false, false, false, false) },
  { name := "a member reads the city's notes under a public cap", signer := "bob-peer-light", doc := cityNotes,
    chain := [capPublic], calls := [readCall], answer := (true, false, true, false, true) }]

#guard cases.all fun c => c.verdict == c.answer

end Aven.ID.AuthorizedExamples

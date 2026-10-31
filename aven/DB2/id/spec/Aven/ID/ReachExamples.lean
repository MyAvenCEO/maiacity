import Aven.ID.AuthorizedExamples

/-! # Reaching a Doc at all, on the cast (`reach.json`)

Caps' answer to the docs layer's step 4 (`Reader.reachesB`, `Authorize::reaches`): whether a signer's chain reaches a
Doc at all, from the signing key, the Doc and the caps the reader holds, before any of an envelope's body is read. Each
answer is written by hand and checked as the module builds. -/

namespace Aven.ID.ReachExamples

open Aven.Core Aven.ID.AuthorizedExamples

/-- A reader of the cast before any envelope: which vault each key's device serves, the network's members, and what
each Doc is. -/
def reader : Reader :=
  { ctx := castCtx, chain := fun _ => [], calls := fun _ => [], lower := fun _ => [], signer := fun _ => [],
    vaultOf := fun k => (castKeys.find? (·.1 == k)).map (·.2), member := castMembers.contains,
    facts := castCtx.facts, deviceCap := fun _ => none, actorOf := fun _ => none }

/-- A case: its name, the signing key, the Doc, the caps the reader holds, and its answer. -/
structure Case where
  name : String
  signer : String
  doc : DocId
  held : List Cap := []
  answer : Bool

def Case.verdict (c : Case) : Bool := reader.reachesB castGov none' none' c.held c.doc (key c.signer)

def cases : List Case := [
  { name := "Alice's phone, on her own Doc", signer := "alice-peer-light", doc := d1, answer := true },
  { name := "Bob's phone, on his own Doc", signer := "bob-peer-light", doc := b1, answer := true },
  { name := "Alice's phone, on Maia City's Doc: she governs Maia City", signer := "alice-peer-light", doc := cityDome,
    answer := true },
  { name := "Bob's phone, on Alice's Doc, holding her cap to him", signer := "bob-peer-light", doc := d1,
    held := [capA], answer := true },
  { name := "Bob's phone, on Alice's Doc, as one of the group her cap was passed on to", signer := "bob-peer-light",
    doc := d1, held := [capB], answer := true },
  { name := "Bob's phone, on Alice's notes, by her public cap", signer := "bob-peer-light", doc := cityNotes,
    held := [capPublic], answer := true },
  { name := "Bob's phone, on Alice's Doc, holding no cap: a stranger", signer := "bob-peer-light", doc := d1,
    answer := false },
  { name := "Bob's phone, on another Doc of Alice's, with a cap for d1 only", signer := "bob-peer-light", doc := d2,
    held := [capA], answer := false },
  { name := "Bob's phone, on Maia City's Doc: he doesn't govern it", signer := "bob-peer-light", doc := cityDome,
    answer := false },
  { name := "a key no vault's device signs with", signer := "mallory-phone", doc := d1, held := [capA],
    answer := false },
  { name := "a Doc the reader knows nothing of", signer := "alice-peer-light", doc := docOf "unknown",
    answer := false }]

#guard cases.all fun c => c.verdict == c.answer

end Aven.ID.ReachExamples

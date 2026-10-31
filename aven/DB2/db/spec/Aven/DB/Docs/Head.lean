import Aven.Core

/-!
# The head (docs, "The head"; rule 1)

A peer's own record of what it holds of a Doc: a small Value under the store's ref `doc-<id>`, replaced by
compare-and-set, never travelling. Per branch it lists each log's newest envelope that counts, by writer id:

`{doc, branches: {<branch>: {logs: [[writer, envelope], …]}}}`, the logs sorted by writer id.

What a peer tells others is a version, by hash; the head is only where it keeps its own place. Its Records sit in the
root map `records` of each branch's Loro document, flat by id (docs, rule 2).
-/

namespace Aven.DB.Docs

open Aven.Core

private def k (s : String) : Bytes := s.toUTF8.toList

/-- The root map a branch's Records sit in, flat by id. -/
def recordsRoot : String := "records"

structure Head where
  doc : DocId
  branches : List (Bytes × List (Nat × Hash))

def Head.value (h : Head) : Value :=
  .map [(k "doc", .bytes h.doc.hash.bytes),
    (k "branches", .map (h.branches.map fun (b, logs) =>
      (b, .map [(k "logs", .array (logs.map fun (w, e) => .array [.uint w, e.value]))])))]

/-- Well formed: branches in the codec's order of keys, each branch's logs sorted by writer id with none twice. -/
def Head.ok (h : Head) : Bool :=
  keysSorted (h.branches.map fun (b, _) => (b, Value.null)) &&
    h.branches.all fun (_, logs) => (logs.zip logs.tail).all fun (a, b) => a.1 < b.1

#guard keysSorted [(k "doc", .null), (k "branches", .null)] = true

/-! ## What a peer holds of a Doc

The head's companion, kept beside it under the Doc's own ref and replaced by compare-and-set, never travelling: every
envelope the peer holds, counted or not (a split's halves are proofs), in the order it held them, each by its name and
the hash of its encoded bytes, which the store keeps as a Value. Reopening a Doc is its genesis, then these envelopes
imported again in this order: every verdict is worked out afresh from them, and what counts is the same
(`Loro.converges`, `Counts`). The envelope's own bytes are the reader's; a sealed form is the keeper's. -/

structure Held where
  doc : DocId
  envelopes : List (Hash × Hash)

def Held.value (h : Held) : Value :=
  .map [(k "doc", .bytes h.doc.hash.bytes),
    (k "envelopes", .array (h.envelopes.map fun (n, b) => .array [n.value, b.value]))]

def held32? : Value → Option Hash
  | .bytes b => if b.length == 32 then some ⟨b⟩ else none
  | _ => none

def heldPair? : Value → Option (Hash × Hash)
  | .array [n, b] => (held32? n).bind fun n => (held32? b).map (n, ·)
  | _ => none

/-- Read back strictly: exactly its two keys, each pair two 32-byte hashes, no envelope named twice. -/
def Held.ofValue? : Value → Option Held
  | .map [(d, .bytes doc), (e, .array es)] =>
    if d == k "doc" && e == k "envelopes" && doc.length == 32 then
      (es.mapM heldPair?).bind fun ps =>
        if (ps.map (·.1.bytes)).Nodup then some ⟨⟨⟨doc⟩⟩, ps⟩ else none
    else none
  | _ => none

#guard keysSorted [(k "doc", .null), (k "envelopes", .null)] = true

end Aven.DB.Docs

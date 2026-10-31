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

end Aven.DB.Docs

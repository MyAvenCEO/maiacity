namespace AvenDB.ReceiveEmpty

/-!
`Lab::receive_now` still accepts signed edits, marks deferred replay dirty, and refreshes when requested. The only
removed operation is constructing all held blob names when there are no incoming blobs to filter. The thunk below
makes that work explicit: the fast path need not evaluate it. Hash/signature validity and late blob admission stay
unchanged; the Rust differential test compares the complete old receive path for empty, duplicate, malformed,
deferred, unsolicited and delayed-key pages. This lemma is not a proof of the full Rust receive implementation.
-/
def namedIncoming {Blob : Type} [BEq Blob] (names : Unit → List Blob) (incoming : List Blob) : List Blob :=
  incoming.filter (fun blob => (names ()).contains blob)

def namedIncomingFast {Blob : Type} [BEq Blob] (names : Unit → List Blob) (incoming : List Blob) : List Blob :=
  if incoming.isEmpty then [] else namedIncoming names incoming

theorem empty_scan_elimination {Blob : Type} [BEq Blob] (names : Unit → List Blob) (incoming : List Blob) :
    namedIncomingFast names incoming = namedIncoming names incoming := by
  cases incoming <;> simp [namedIncomingFast, namedIncoming]

end AvenDB.ReceiveEmpty

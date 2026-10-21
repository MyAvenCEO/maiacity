import AvenDB.Examples

/-!
# Snapshots

A device replays every edit it holds to know what it knows (`view`). A vault with years of history makes that slow for a
new device, and a device away for long. A snapshot (`Action.snapshot`) lets a device take an entry's state instead: its
slice (`Slice`, `State.sliceOf`), what the edits up to a frontier of the entry's log (`basis`) make of it. The history
stays, held where a device wants it, never replayed to open the entry.

A snapshot is an edit of the vault's own log, accepted only where the vault approves it, by its root or its threshold of
owners, as a checkpoint is; its owners sign it when they unlock, in the same signature. So a device takes a state on
the word of no one but the owners of the entry's vault, who may already write anything there. And it takes that word
only as far as it reaches:

- only a snapshot that stands, so an owner removed by a revocation that hadn't seen it vouches for nothing
  (`statedIn_approved`);
- only states of the vault's own entries, each confined to its entry (`Stated.scoped`, `statedIn_scoped`): a slice puts
  the parts of one entry in place and leaves every other entry, and the kernel (vaults, shares, revocations, epochs,
  who may do what), as they were (`withSlice_kernel`, `withSlice_other`), so a lying owner can lie only about an
  entry it could write anyway, and never about who may do what;
- a device that holds the history checks every state against it (`honest`), and a lie is caught (`lie_detected`);
- a removal that stands after the snapshot sends a device back to the history (`stale`): what it took away may change
  the entry's state, and the snapshot hadn't seen it.

Taken in place, an honest slice is exactly what the history makes of the entry (`withSlice_self`). A device starts
from the latest standing state of each entry that isn't stale (`startStates`, `startStates_sound`), replays the rest and
each entry's edits past its snapshot on top (`startView`), and a device away too long starts so again (`awayTooLong`).
A full copy checks a start (`startsRight`); the scenarios check it, and a proof that every honest start is right for
every history is still to come. In the engine each
slice travels sealed to its entry's readers, a file the snapshot names by its hash, and an entry id is the hash of its
vault, its creator and a nonce (`EntryId::of`), which the slice carries, so its vault can't be claimed.
-/

namespace AvenDB

/-- The ids `ids` with every edit among `edits` they build on, parents first found, at most `n` rounds. -/
def closeN (edits : List Edit) : Nat → List EditId → List EditId
  | 0, ids => ids
  | n + 1, ids =>
    let more := ((edits.filter (ids.contains ·.id)).flatMap (·.parents)).filter (!ids.contains ·)
    if more.isEmpty then ids else closeN edits n (ids ++ more.eraseDups)

/-- The edits of entry `x.entry`'s log the snapshot `c` had seen: its basis and all it builds on. -/
def seenOf (edits : List Edit) (x : Stated) : List EditId := closeN edits edits.length x.basis

/-- The edits a state of snapshot `c` rests on: of its entry's log the ones it had seen, of every other log the ones that
    sort before it. -/
def pastOf (edits : List Edit) (c : Edit) (x : Stated) : List Edit :=
  let seen := seenOf edits x
  edits.filter fun o => if o.log? == some (.entry x.entry) then seen.contains o.id else decide (o.depth < c.depth)

/-- A state of snapshot `c` is honest toward the edits `edits`: each edit of its basis is held, of its entry's log, and
    comes before it, and its slice is what the edits it rests on make of its entry. A device that holds the history
    checks this. -/
def honest (edits : List Edit) (c : Edit) (x : Stated) : Bool :=
  x.basis.all (fun b => edits.any fun o => o.id == b && o.log? == some (.entry x.entry) && decide (o.depth < c.depth)) &&
    (view (pastOf edits c x)).sliceOf x.entry == x.slice

/-- The slice holds the parts of entry `e` alone: each part names `e`, and each part kept by edit names one of the
    slice's own writes. -/
def Slice.within (e : EntryId) (sl : Slice) : Bool :=
  let ids := sl.writes.map (·.edit)
  sl.entries.all (·.id == e) && sl.writes.all (·.entry == e) && sl.marks.all (·.1 == e) &&
    sl.seals.all (·.secret.entry? == some e) && sl.uncounted.all ids.contains && sl.accepts.all ids.contains &&
    sl.defs.all (ids.contains ·.1) && sl.adds.all (ids.contains ·.1)

/-- A state of a snapshot of vault `v` is one a device takes: its slice is its entry's alone, an entry of `v`. -/
def Stated.scoped (v : VaultId) (x : Stated) : Bool :=
  x.slice.within x.entry && x.slice.entries.all (·.vault == v)

/-- The states a device holding `edits` takes: of each snapshot that stands, with its vault, the states scoped to it. -/
def statedIn (edits : List Edit) : List (Edit × VaultId × Stated) :=
  (standing edits).flatMap fun c => match c.action with
    | .snapshot v ss => (ss.filter (·.scoped v)).map (c, v, ·)
    | _ => []

/-- The lies a device holding the history finds: each snapshot and entry whose state isn't honest. -/
def lies (edits : List Edit) : List (EditId × EntryId) :=
  ((statedIn edits).filter fun (c, _, x) => !honest edits c x).map fun (c, _, x) => (c.id, x.entry)

/-- A removal stands after snapshot `c`, outside its entry's log: what it took away may change the entry's state, and
    the snapshot hadn't seen it, so a device opens the entry from its history. -/
def stale (edits : List Edit) (c : Edit) (x : Stated) : Bool :=
  (standing edits).any fun o => o.isRemoval && o.log? != some (.entry x.entry) && decide (c.depth ≤ o.depth)

/-! ## What a snapshot changes -/

/-- A snapshot changes nothing in what a device knows: it is accepted or refused. -/
theorem apply_snapshot {st st' : State} {o : Edit} {v : VaultId} {ss : List Stated} (ha : o.action = .snapshot v ss)
    (h : apply st o = some st') : st' = st := by
  unfold apply at h
  rw [ha] at h
  simp only [Option.ite_none_right_eq_some, Option.some.injEq] at h
  exact h.2.symm

/-- Putting a slice in place leaves the kernel as it was: vaults, shares, revocations, epochs, published keys. -/
theorem withSlice_kernel (st : State) (e : EntryId) (sl : Slice) :
    (st.withSlice e sl).vaults = st.vaults ∧ (st.withSlice e sl).shares = st.shares ∧
      (st.withSlice e sl).revoked = st.revoked ∧ (st.withSlice e sl).epochs = st.epochs ∧
      (st.withSlice e sl).published = st.published :=
  ⟨rfl, rfl, rfl, rfl, rfl⟩

private theorem filter_ne_eq {α : Type} (l : List α) (f : α → EntryId) {e e' : EntryId} (hne : e ≠ e') :
    (l.filter fun a => f a != e).filter (fun a => f a == e') = l.filter fun a => f a == e' := by
  rw [List.filter_filter]
  congr 1
  funext a
  by_cases h : f a = e'
  · subst h; simp [Ne.symm hne]
  · simp [h]

private theorem filter_within {α : Type} (l : List α) (f : α → EntryId) {e e' : EntryId} (hne : e ≠ e')
    (hl : l.all (f · == e)) : l.filter (fun a => f a == e') = [] := by
  rw [List.filter_eq_nil_iff]
  intro a ha
  have := List.all_eq_true.1 hl a ha
  simp only [beq_iff_eq] at this
  simp [this, hne]

private theorem filter_ne_self {α : Type} (l : List α) (f : α → EntryId) (e : EntryId) :
    (l.filter fun a => f a != e).filter (fun a => f a == e) = [] := by
  rw [List.filter_filter, List.filter_eq_nil_iff]
  intro a _
  by_cases h : f a = e <;> simp [h]

private theorem filter_self {α : Type} (l : List α) (f : α → EntryId) (e : EntryId) (hl : l.all (f · == e)) :
    l.filter (fun a => f a == e) = l :=
  List.filter_eq_self.2 fun a ha => List.all_eq_true.1 hl a ha

/-- Putting entry `e`'s slice in place leaves every other entry's own parts as they were: the entry, its writes, its
    marks, the seals of its keys and whether it was born. So a slice lies about its own entry or about none. -/
theorem withSlice_other (st : State) {e e' : EntryId} (sl : Slice) (hne : e ≠ e') (hw : sl.within e = true) :
    let a := (st.withSlice e sl).sliceOf e'
    let b := st.sliceOf e'
    a.entries = b.entries ∧ a.writes = b.writes ∧ a.marks = b.marks ∧ a.seals = b.seals ∧ a.born = b.born := by
  simp only [Slice.within, Bool.and_eq_true] at hw
  obtain ⟨⟨⟨⟨⟨⟨⟨hen, hwr⟩, hmk⟩, hsl⟩, -⟩, -⟩, -⟩, -⟩ := hw
  simp only [State.sliceOf, State.withSlice, List.filter_append]
  refine ⟨?_, ?_, ?_, ?_, ?_⟩
  · rw [filter_ne_eq _ Entry.id hne, filter_within _ Entry.id hne hen, List.append_nil]
  · rw [filter_ne_eq _ Write.entry hne, filter_within _ Write.entry hne hwr, List.append_nil]
  · rw [filter_ne_eq _ (fun m : EntryId × List ShareId => m.1) hne, filter_within _ (fun m : EntryId × List ShareId => m.1) hne hmk, List.append_nil]
  · have hne' : some e ≠ some e' := fun h => hne (Option.some.inj h)
    have h1 : sl.seals.filter (fun x => x.secret.entry? == some e') = [] := List.filter_eq_nil_iff.2 fun s hs => by
      have := List.all_eq_true.1 hsl s hs
      simp only [beq_iff_eq] at this
      simp [this, hne]
    rw [h1, List.append_nil, List.filter_filter]
    congr 1
    funext s
    by_cases h : s.secret.entry? = some e' <;> simp [h, Ne.symm hne']
  · split <;> simp [Ne.symm hne]

/-- Put in place, a slice within its entry is what that entry's own parts then are: the entry, its writes, its marks,
    the seals of its keys. So a device that takes an honest slice holds what the history makes of the entry. -/
theorem withSlice_self (st : State) {e : EntryId} (sl : Slice) (hw : sl.within e = true) :
    let a := (st.withSlice e sl).sliceOf e
    a.entries = sl.entries ∧ a.writes = sl.writes ∧ a.marks = sl.marks ∧ a.seals = sl.seals := by
  simp only [Slice.within, Bool.and_eq_true] at hw
  obtain ⟨⟨⟨⟨⟨⟨⟨hen, hwr⟩, hmk⟩, hsl⟩, -⟩, -⟩, -⟩, -⟩ := hw
  simp only [State.sliceOf, State.withSlice, List.filter_append]
  refine ⟨?_, ?_, ?_, ?_⟩
  · rw [filter_ne_self _ Entry.id, filter_self _ Entry.id e hen, List.nil_append]
  · rw [filter_ne_self _ Write.entry, filter_self _ Write.entry e hwr, List.nil_append]
  · rw [filter_ne_self _ (fun m : EntryId × List ShareId => m.1), filter_self _ (fun m : EntryId × List ShareId => m.1) e hmk, List.nil_append]
  · have h1 : (st.seals.filter (fun x => x.secret.entry? != some e)).filter (fun x => x.secret.entry? == some e) =
        [] := by
      rw [List.filter_filter, List.filter_eq_nil_iff]
      intro s _
      by_cases h : s.secret.entry? = some e <;> simp [h]
    rw [h1, List.nil_append]
    exact List.filter_eq_self.2 fun s hs => List.all_eq_true.1 hsl s hs

/-! ## Whose word a device takes -/

/-- A device takes a state only from a snapshot that stands, of the vault it names. -/
theorem statedIn_approved {edits : List Edit} {c : Edit} {v : VaultId} {x : Stated} (h : (c, v, x) ∈ statedIn edits) :
    c ∈ standing edits ∧ ∃ ss, c.action = .snapshot v ss ∧ x ∈ ss := by
  unfold statedIn at h
  obtain ⟨c', hc, hx⟩ := List.mem_flatMap.1 h
  split at hx
  · rename_i v' ss hact
    obtain ⟨y, hy, hyx⟩ := List.mem_map.1 hx
    simp only [Prod.mk.injEq] at hyx
    obtain ⟨rfl, rfl, rfl⟩ := hyx
    exact ⟨hc, ss, hact, (List.mem_filter.1 hy).1⟩
  · cases hx

/-- A device takes only states scoped to the snapshot's own vault. -/
theorem statedIn_scoped {edits : List Edit} {c : Edit} {v : VaultId} {x : Stated} (h : (c, v, x) ∈ statedIn edits) :
    x.scoped v = true := by
  unfold statedIn at h
  obtain ⟨c', -, hx⟩ := List.mem_flatMap.1 h
  split at hx
  · obtain ⟨y, hy, hyx⟩ := List.mem_map.1 hx
    simp only [Prod.mk.injEq] at hyx
    obtain ⟨rfl, rfl, rfl⟩ := hyx
    exact (List.mem_filter.1 hy).2
  · cases hx

/-- A device holding the history finds every state it would take that isn't honest. -/
theorem lie_detected {edits : List Edit} {c : Edit} {v : VaultId} {x : Stated} (h : (c, v, x) ∈ statedIn edits)
    (hl : honest edits c x = false) : (c.id, x.entry) ∈ lies edits :=
  List.mem_map.2 ⟨(c, v, x), List.mem_filter.2 ⟨h, by simp [hl]⟩, rfl⟩

/-- And none that is. -/
theorem honest_no_lie {edits : List Edit} (h : ∀ y ∈ statedIn edits, honest edits y.1 y.2.2 = true) :
    lies edits = [] := by
  unfold lies
  rw [List.filter_eq_nil_iff.2, List.map_nil]
  intro y hy
  simp [h y hy]

/-! ## Starting from snapshots

A device that starts from snapshots replays the kernel and the entries no snapshot it takes states, puts each state it
takes in place, and replays on top only the edits of that entry's log the snapshot hadn't seen. A state that is stale is
not taken: its entry is replayed from its history (S4). A device away too long starts the same way over what its peers
hold, dropping what it held (S6). -/

/-- The states a device starting from `edits` takes: the latest standing one of each entry that isn't stale. -/
def startStates (edits : List Edit) : List (Edit × Stated) :=
  let ok := (statedIn edits).filter fun (c, _, x) => !stale edits c x
  (ok.filter fun (c, _, x) => !ok.any fun (c', _, x') => x'.entry == x.entry && decide (c.depth < c'.depth)).map
    fun (c, _, x) => (c, x)

/-- What a device knows starting from snapshots: the edits of every log but the taken entries' replayed, each taken
    state put in place, then each taken entry's edits its snapshot hadn't seen replayed on top. -/
def startView (edits : List Edit) : State :=
  let taken := startStates edits
  let mine (o : Edit) : Option Stated :=
    (taken.find? fun (_, x) => o.log? == some (.entry x.entry)).map (·.2)
  let base := view (edits.filter fun o => (mine o).isNone)
  let put := taken.foldl (fun st (_, x) => st.withSlice x.entry x.slice) base
  replay put (order (edits.filter fun o => (mine o).any fun x => !(seenOf edits x).contains o.id))

/-- A device starting from snapshots takes only states it would take (`statedIn`), and none that is stale. -/
theorem startStates_sound {edits : List Edit} {c : Edit} {x : Stated} (h : (c, x) ∈ startStates edits) :
    ∃ v, (c, v, x) ∈ statedIn edits ∧ stale edits c x = false := by
  unfold startStates at h
  obtain ⟨⟨c', v, x'⟩, hy, hyx⟩ := List.mem_map.1 h
  simp only [Prod.mk.injEq] at hyx
  obtain ⟨rfl, rfl⟩ := hyx
  obtain ⟨hok, -⟩ := List.mem_filter.1 hy
  obtain ⟨hin, hs⟩ := List.mem_filter.1 hok
  exact ⟨v, hin, by simpa using hs⟩

/-- What a full copy checks of a start: every entry a device takes from snapshots is as the history makes it. -/
def startsRight (edits : List Edit) : Bool :=
  (startStates edits).all fun (_, x) => (startView edits).sliceOf x.entry == (view edits).sliceOf x.entry

/-- A device that holds `held` and whose peers hold `edits` was away too long when more than `most` of their edits are
    new to it: it then starts from snapshots over `edits` (`startView`), and what it held counts for nothing. -/
def awayTooLong (held edits : List Edit) (most : Nat) : Bool :=
  (edits.filter fun o => !held.contains o).length > most

/-! ## Scenarios -/

namespace Examples

/-- Alice's vault with its devices, and her Mac's note `welcome` with a second write building on its first. -/
def sNote : List Edit := s1 ++ chain 40 [(macA, [], create alice welcome alice [] note)] ++
  [{ id := 41, depth := 41, author := macA, cosigners := [], action := .write alice welcome alice none 0 [40],
     parents := [40] }]

/-- Entry `welcome`'s state after both writes, as Alice's owners state it. -/
def welcomeAt : Stated := { entry := welcome, basis := [41], slice := (view sNote).sliceOf welcome }

/-- Her passkey signs a snapshot of it. -/
def snapA : Edit := { id := 50, depth := 50, author := passkeyA, cosigners := [], action := .snapshot alice [welcomeAt] }
def sSnap : List Edit := sNote ++ [snapA]

/-- A snapshot that leaves out the second write: a lie. -/
def welcomeLie : Stated := { welcomeAt with slice := { welcomeAt.slice with
  writes := welcomeAt.slice.writes.take 1, adds := welcomeAt.slice.adds.filter (·.1 == 40) } }
def sLie : List Edit := sNote ++ chain 50 [(passkeyA, [], .snapshot alice [welcomeLie])]

/-- A state that reaches past its entry, into `charter`'s marks: not scoped, never taken. -/
def welcomeWide : Stated := { welcomeAt with slice := { welcomeAt.slice with marks := [(charter, [])] } }
def sWide : List Edit := sNote ++ chain 50 [(passkeyA, [], .snapshot alice [welcomeWide])]

#guard refused sNote == []
#guard (view sNote).writesOf welcome == [40, 41]
-- the passkey's snapshot stands, and is honest toward the history
#guard refused sSnap == []
#guard (statedIn sSnap).length == 1 && lies sSnap == []
-- a device or another vault's passkey can't sign one
#guard !accepted sNote (attempt macA [] (.snapshot alice [welcomeAt]))
#guard !accepted (sNote ++ s2.drop 3) (attempt passkeyB [] (.snapshot alice [welcomeAt]))
-- a slice that leaves a write out is caught
#guard lies sLie == [(50, welcome)]
-- a slice that reaches into another entry is never taken
#guard (statedIn sWide).isEmpty
-- a device that takes the slice over the kernel alone holds the entry as the history makes it
#guard ((view s1).withSlice welcome welcomeAt.slice).sliceOf welcome == welcomeAt.slice
-- the kernel stays: who acts for Alice is as before
#guard actsFor ((view s1).withSlice welcome welcomeAt.slice) macA alice
-- a revocation after the snapshot sends a device back to the history
#guard !stale sSnap snapA welcomeAt
#guard stale (sSnap ++ chain 60 [(passkeyA, [], .revoke (.device alice phoneA [1, 2, 3, 40, 41, 50]))]) snapA welcomeAt

/-- Her Mac writes the note again after the snapshot: replayed on top of the slice. -/
def sAfter : List Edit := sSnap ++
  [{ id := 60, depth := 60, author := macA, cosigners := [], action := .write alice welcome alice none 0 [41],
     parents := [41] }]

-- starting from the snapshot, a device knows the note as the history makes it, and the kernel as it is
#guard (startStates sSnap).length == 1
#guard (startView sSnap).sliceOf welcome == (view sSnap).sliceOf welcome
#guard actsFor (startView sSnap) macA alice && actsFor (startView sSnap) phoneA alice
-- a write after the snapshot is replayed on top
#guard (startView sAfter).writesOf welcome == [40, 41, 60]
#guard (startView sAfter).sliceOf welcome == (view sAfter).sliceOf welcome
-- a revocation after it: the note comes from its history, and the phone acts for Alice no more
def sRevoked : List Edit := sSnap ++ chain 60 [(passkeyA, [], .revoke (.device alice phoneA [1, 2, 3, 40, 41, 50]))]
#guard (startStates sRevoked).isEmpty
#guard (startView sRevoked).sliceOf welcome == (view sRevoked).sliceOf welcome
#guard !actsFor (startView sRevoked) phoneA alice
-- a state's slice file: its entry's readers fetch it, Bob's Mac, which may not receive the note, doesn't
def sFiled : List Edit := sNote ++ s2.drop 3 ++ chain 60 [(passkeyA, [], .snapshot alice [{ welcomeAt with file := 7 }])]
#guard refused sFiled == []
#guard mayFetch sFiled macA 7 && mayFetch sFiled phoneA 7 && !mayFetch sFiled macB 7 && !mayFetch sFiled macA 8
-- a full copy finds every start right
#guard startsRight sSnap && startsRight sAfter && startsRight sRevoked
-- a device that held only Alice's vault is away too long past one new edit
#guard awayTooLong s1 sAfter 1 && !awayTooLong sNote sSnap 1

end Examples

end AvenDB

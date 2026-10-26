import AvenDB.Snapshot

/-!
# One entry state

P6 of the sync v2 plan (`docs/AVENDB_SYNC_V2.md`). Samuel, 2026-10-26: no caches. A device keeps two things, the
edits it holds (its history) and its stored view (`StoredView.lean`), what those edits make; nothing else is read to
show an entry. No warm metadata, no scratch, no receipts, no judgment slices, no learned lists.

Each entry a device holds is in one of two states (`EntryState`), worked out from its history alone (`entryState`):

- full: no snapshot it takes states the entry, so it opens the entry from the entry's whole log;
- based: it takes its owners' signed snapshot of the entry (`Snapshot.lean`), the newest that stands and isn't stale
  (`startStates`), puts its slice in place, and replays on top only the edits of the entry's log the snapshot hadn't
  seen (`suffix`).

What follows:

- a based state is one a device may take: from a snapshot that stands, of the entry's own vault, not stale
  (`based_sound`), the newest such (`based_newest`);
- a based entry needs no edit a full one doesn't, only its suffix (`needs_sub`), so starting based never costs more
  than replaying, and owners that sign a snapshot at each unlock keep the suffix short (`suffix_empty`);
- the state, and what a device shows, are functions of the history: two devices whose stored views are right
  (`Device.right`) and that hold the same edits show every entry the same (`shows_same`). A side store that changed
  an answer would break this, so none is allowed.
-/

namespace AvenDB

namespace OneState

/-- The one state of an entry: full, or based on its owners' snapshot `c`, which states `x`. -/
inductive EntryState where
  | full
  | based (c : Edit) (x : Stated)
  deriving DecidableEq, Repr

/-- Whether the state is based. -/
def EntryState.isBased : EntryState → Bool
  | .full => false
  | .based .. => true

/-- Entry `e`'s state for a device holding `edits`: based on the snapshot that states it among those it starts from
    (`startStates`), else full. -/
def entryState (edits : List Edit) (e : EntryId) : EntryState :=
  match (startStates edits).find? (fun cx => cx.2.entry == e) with
  | some (c, x) => .based c x
  | none => .full

/-- The edits of entry `e`'s log. -/
def logOf (edits : List Edit) (e : EntryId) : List Edit :=
  edits.filter (·.log? == some (.entry e))

/-- The edits of entry `e`'s log a based state's snapshot hadn't seen: what a device replays on its slice. -/
def suffix (edits : List Edit) (e : EntryId) (x : Stated) : List Edit :=
  (logOf edits e).filter fun o => !(seenOf edits x).contains o.id

/-- The edits of its log a device replays to open entry `e`: every one when full, its suffix when based. -/
def needs (edits : List Edit) (e : EntryId) : List Edit :=
  match entryState edits e with
  | .full => logOf edits e
  | .based _ x => suffix edits e x

/-! ## A based state is one a device may take -/

theorem based_mem {edits : List Edit} {e : EntryId} {c : Edit} {x : Stated}
    (h : entryState edits e = .based c x) : (c, x) ∈ startStates edits ∧ x.entry = e := by
  unfold entryState at h
  split at h
  · rename_i c' x' hf
    obtain ⟨rfl, rfl⟩ := EntryState.based.inj h
    exact ⟨List.mem_of_find?_eq_some hf, by simpa using List.find?_some hf⟩
  · cases h

/-- A based state comes from a snapshot that stands, of the vault it names, scoped to the entry's own parts, and isn't
    stale: whose word a device takes is the owners' alone (`statedIn_approved`, `statedIn_scoped`). -/
theorem based_sound {edits : List Edit} {e : EntryId} {c : Edit} {x : Stated}
    (h : entryState edits e = .based c x) :
    ∃ v, (c, v, x) ∈ statedIn edits ∧ x.scoped v = true ∧ stale edits c x = false ∧ x.entry = e := by
  obtain ⟨hm, he⟩ := based_mem h
  obtain ⟨v, hin, hs⟩ := startStates_sound hm
  exact ⟨v, hin, statedIn_scoped hin, hs, he⟩

/-- A based state is the newest a device may take of its entry: no snapshot that stands and isn't stale, deeper than
    it, states the same entry. So owners that sign at each unlock move every device to their newest word. -/
theorem based_newest {edits : List Edit} {e : EntryId} {c : Edit} {x : Stated}
    (h : entryState edits e = .based c x) :
    ∀ c' v' x', (c', v', x') ∈ statedIn edits → stale edits c' x' = false → x'.entry = x.entry →
      ¬ c.depth < c'.depth := by
  obtain ⟨hm, -⟩ := based_mem h
  intro c' v' x' hin' hs' he' hlt
  unfold startStates at hm
  obtain ⟨⟨c₀, v₀, x₀⟩, hy, hyx⟩ := List.mem_map.1 hm
  simp only [Prod.mk.injEq] at hyx
  obtain ⟨rfl, rfl⟩ := hyx
  obtain ⟨-, hnot⟩ := List.mem_filter.1 hy
  have hok' : (c', v', x') ∈ (statedIn edits).filter fun (c, _, x) => !stale edits c x :=
    List.mem_filter.2 ⟨hin', by simp [hs']⟩
  have : ((statedIn edits).filter fun (c, _, x) => !stale edits c x).any
      (fun (c'', _, x'') => x''.entry == x₀.entry && decide (c₀.depth < c''.depth)) = true :=
    List.any_eq_true.2 ⟨(c', v', x'), hok', by simp [he', hlt]⟩
  simp [this] at hnot

/-! ## A based entry needs no more than a full one -/

/-- A based entry's suffix is part of its log. -/
theorem suffix_sub (edits : List Edit) (e : EntryId) (x : Stated) : suffix edits e x ⊆ logOf edits e :=
  fun _ h => (List.mem_filter.1 h).1

/-- What a device replays to open an entry is part of the entry's log, whatever its state. -/
theorem needs_sub (edits : List Edit) (e : EntryId) : needs edits e ⊆ logOf edits e := by
  unfold needs
  split
  · exact fun _ h => h
  · exact suffix_sub edits e _

/-- An edit of the entry's log the snapshot had seen is never replayed on a based entry. -/
theorem seen_not_needed {edits : List Edit} {e : EntryId} {c : Edit} {x : Stated} {o : Edit}
    (h : entryState edits e = .based c x) (hs : (seenOf edits x).contains o.id = true) : o ∉ needs edits e := by
  unfold needs
  rw [h]
  intro hm
  have := (List.mem_filter.1 hm).2
  simp at this
  exact this (by simpa using hs)

/-- Where the snapshot had seen every edit of the entry's log, as one signed at the last unlock with no write since
    has, a based entry replays nothing. -/
theorem suffix_empty {edits : List Edit} {e : EntryId} {x : Stated}
    (h : ∀ o ∈ logOf edits e, (seenOf edits x).contains o.id = true) : suffix edits e x = [] := by
  unfold suffix
  rw [List.filter_eq_nil_iff]
  intro o ho
  have := h o ho
  simp only [List.contains_iff_mem] at this
  simp [this]

/-! ## Nothing but history and the stored view -/

/-- What a device keeps: the edits it holds and its stored view. There is no third field. -/
structure Device where
  edits  : List Edit
  stored : State

/-- A device's stored view is right: it is what its edits make, each entry full or based (`startView`). -/
def Device.right (d : Device) : Prop := d.stored = startView d.edits

/-- What a device shows of entry `e`: its stored view's slice of it. -/
def Device.shows (d : Device) (e : EntryId) : Slice := d.stored.sliceOf e

/-- What a device shows is what its history makes: no other input. -/
theorem shows_history {d : Device} (h : d.right) (e : EntryId) : d.shows e = (startView d.edits).sliceOf e := by
  unfold Device.shows; rw [h]

/-- Two devices whose stored views are right and that hold the same edits show every entry the same, and hold it in
    the same state. -/
theorem shows_same {d d' : Device} (h : d.right) (h' : d'.right) (he : d.edits = d'.edits) (e : EntryId) :
    d.shows e = d'.shows e ∧ entryState d.edits e = entryState d'.edits e := by
  refine ⟨?_, by rw [he]⟩
  rw [shows_history h, shows_history h', he]

/-! ## Scenarios (`Snapshot.lean`'s) -/

namespace Examples

open AvenDB.Examples

-- before any snapshot, the note is full: its whole log is replayed
#guard entryState sNote welcome == .full
#guard (needs sNote welcome).map (·.id) == [40, 41]
-- the passkey's snapshot makes it based on that snapshot, with nothing to replay
#guard (entryState sSnap welcome).isBased
#guard entryState sSnap welcome == .based snapA welcomeAt
#guard needs sSnap welcome == []
-- a write after the snapshot is the whole suffix
#guard (needs sAfter welcome).map (·.id) == [60]
-- a revocation after it: full again, from its history
#guard entryState sRevoked welcome == .full
-- a lie is never taken by a device that checks: the full copy finds it, and the start isn't right
#guard lies sLie == [(50, welcome)] && !startsRight sLie
-- a slice that reaches past its entry is never a based state
#guard entryState sWide welcome == .full
-- whatever the state, a start is right on these histories
#guard [sNote, sSnap, sAfter, sRevoked].all startsRight

end Examples

end OneState

end AvenDB

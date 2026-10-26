import AvenDB.Sync

/-!
# Blind index (P4 of sync v2)

A view asks for a type or a tag ("the rooms", "the recipes"), but both sit inside an entry's encrypted body, so a peer
that cannot read the entry, the server above all, cannot match them. The blind index lets it match without reading.

The keys a reader of an entry holds give index keys: its vault's seed at an epoch (every device of the vault holds
it) and the key of each share of the entry's audience at an epoch (its grantee holds it). From each index key comes a
token per audience and label, `type:<t>` or `tag:<g>`; here a `Label` stands for the pair (audience, label), so the
audience is in the token and one audience's tokens link to no other's. A device that reads an entry tells the peers it
syncs with the tokens of its labels, under the newest epoch of each of those keys it holds (a row). A device that wants
the entries of some labels computes their tokens for every audience of the vault it knows of, under each key it holds,
and asks any peer `find`: which entries carry one of these tokens. A peer that reads answers from its own entries; the
server answers from the rows it was told. Audience keys themselves would not do: a device opens an audience's key
only once it holds an entry of it, so a new device would find nothing.

What a token reveals (Samuel accepted this on 2026-10-26): to a peer without the key, only which rows of one audience
under one key epoch carry the same label (the equality pattern), never the label, and nothing that links a token of one audience
or epoch to one of another (`blind_reveals_equality_only`, `keys_unlinkable`). The audience and epoch of an entry are
not new to the server: its writes name them in the clear (`Action.write`). A token is a keyed hash (BLAKE3 in key mode
in the core), so that two keys or two labels give the same token only by a collision of the hash; that is the
assumption `Distinct` below, as `Range.Sound` is for fingerprints.

`find` sends nothing but entry ids, and only of entries the asking device syncs by the answering peer's view
(`find_within_T12`): the ids of logs `respond` would send it anyway (T12). It hands out no file and no edit, so T27 is
untouched: the edits still come by sync and the files still follow them. A row authorizes nothing: what `find` names a
device still receives by `respond` alone, row or no row. And `find` misses nothing a peer holds a row of
(`find_complete`): an entry whose row carries one of the asked tokens and which the device syncs is in the answer, so a
device that holds the key of an audience finds every entry of it a peer was told about (`holder_finds`).
-/

namespace AvenDB

namespace BlindIndex

/-- A label an entry is found by: its type or one of its tags, as a number here. -/
abbrev Label := Nat

/-- The key a token is made under: a key family (the vault's seed or a share) and the epoch. -/
abbrev Key := KeyFam × Nat

variable {Tok : Type} [DecidableEq Tok]

/-- Tokens made by `prf` collide only where key and label are the same: an assumption about the hash. -/
def Distinct (prf : Key → Label → Tok) : Prop :=
  ∀ k l k' l', prf k l = prf k' l' → k = k' ∧ l = l'

/-- A row: an entry and one of its labels under one key. What a peer stores is the token alone (`tokOf`). -/
structure Slot where
  entry : EntryId
  key   : Key
  label : Label

/-- What a blind peer holds of a row: the entry, the key's audience and epoch (named in the clear by the entry's
    writes), and the token. -/
structure Row (Tok : Type) where
  entry : EntryId
  key   : Key
  tok   : Tok

/-- The row of a slot under `prf`. -/
def rowOf (prf : Key → Label → Tok) (s : Slot) : Row Tok := ⟨s.entry, s.key, prf s.key s.label⟩

/-- What a blind peer can tell of the rows it holds: each row's entry and key, and the first row carrying the same token.
    Any other thing it computes from them is a function of this. -/
def seen (rows : List (Row Tok)) : List (EntryId × Key × Nat) :=
  rows.map fun r => (r.entry, r.key, rows.findIdx fun t => t.tok == r.tok)

omit [DecidableEq Tok] in
/-- Two tokens are the same exactly when their key and label are. -/
theorem tok_eq_iff {prf : Key → Label → Tok} (hd : Distinct prf) (s t : Slot) :
    prf t.key t.label = prf s.key s.label ↔ t.key = s.key ∧ t.label = s.label := by
  constructor
  · exact hd _ _ _ _
  · rintro ⟨hk, hl⟩; rw [hk, hl]

/-- What a blind peer sees of the rows depends only on the pattern of equal labels within each key: rename the labels
    of every key by any one-to-one map, and make the tokens with any other hash, and it sees the same. So it learns which
    rows of one audience and epoch share a label, and nothing else of the labels. -/
theorem blind_reveals_equality_only {prf prf' : Key → Label → Tok} (hd : Distinct prf) (hd' : Distinct prf')
    (ρ : Key → Label → Label) (hρ : ∀ k l l', ρ k l = ρ k l' → l = l') (slots : List Slot) :
    seen (slots.map (rowOf prf)) =
      seen ((slots.map fun s => { s with label := ρ s.key s.label }).map (rowOf prf')) := by
  unfold seen
  simp only [List.map_map]
  apply List.map_congr_left
  intro s _
  simp only [Function.comp_def, rowOf, List.findIdx_map]
  have hp : (fun t : Slot => prf t.key t.label == prf s.key s.label) =
      (fun t : Slot => prf' t.key (ρ t.key t.label) == prf' s.key (ρ s.key s.label)) := by
    funext t
    apply Bool.eq_iff_iff.mpr
    simp only [beq_iff_eq]
    constructor
    · intro h
      obtain ⟨hk, hl⟩ := hd _ _ _ _ h
      rw [hk, hl]
    · intro h
      obtain ⟨hk, hl⟩ := hd' _ _ _ _ h
      have hl' : t.label = s.label := hρ s.key _ _ (hk ▸ hl)
      rw [hk, hl']
  rw [hp]

omit [DecidableEq Tok] in
/-- Tokens of two keys never match: a token of one audience, or of one epoch, links to no token of another, and a key a
    device lacks (an epoch after it lost access) gives it no token it can match. -/
theorem keys_unlinkable {prf : Key → Label → Tok} (hd : Distinct prf) {k k' : Key} (hk : k ≠ k') (l l' : Label) :
    prf k l ≠ prf k' l' := fun h => hk (hd _ _ _ _ h).1

/-! ## Find -/

/-- The tokens a device asks for: of each label, under each key it holds. -/
def tokensFor (prf : Key → Label → Tok) (keys : List Key) (labels : List Label) : List Tok :=
  keys.flatMap fun k => labels.map (prf k)

/-- A peer's answer to `find` from device `d`, which follows `follow`, for the tokens `toks`, by its view `st` and the
    rows it holds: the entries of the rows carrying one of the tokens that `d` syncs, each once. -/
def find (st : State) (rows : List (Row Tok)) (d : SignerId) (follow : List VaultId) (toks : List Tok) :
    List EntryId :=
  ((rows.filter fun r => toks.contains r.tok && syncsLog st d (.entry r.entry) follow).map (·.entry)).eraseDups

/-- One page of the answer: at most `n` of its entries, from the `skip`th on. A page is part of the answer, so all
    that holds of the answer holds of it. -/
def findPage (st : State) (rows : List (Row Tok)) (d : SignerId) (follow : List VaultId) (toks : List Tok)
    (skip n : Nat) : List EntryId :=
  ((find st rows d follow toks).drop skip).take n

/-- `find` names only entries the asking device syncs by the peer's view: the logs `respond` sends it anyway (T12). -/
theorem find_within_T12 {st : State} {rows : List (Row Tok)} {d : SignerId} {follow : List VaultId}
    {toks : List Tok} {e : EntryId} (h : e ∈ find st rows d follow toks) :
    syncsLog st d (.entry e) follow = true ∧ ∃ r ∈ rows, r.entry = e ∧ r.tok ∈ toks := by
  unfold find at h
  have h := List.mem_eraseDups.mp h
  obtain ⟨r, hr, rfl⟩ := List.mem_map.mp h
  obtain ⟨hin, hc⟩ := List.mem_filter.mp hr
  simp only [Bool.and_eq_true, List.contains_iff_mem] at hc
  exact ⟨hc.2, r, hin, rfl, hc.1⟩

/-- A page names only what the whole answer does. -/
theorem page_within {st : State} {rows : List (Row Tok)} {d : SignerId} {follow : List VaultId} {toks : List Tok}
    {skip n : Nat} {e : EntryId} (h : e ∈ findPage st rows d follow toks skip n) :
    e ∈ find st rows d follow toks :=
  List.mem_of_mem_drop (List.mem_of_mem_take h)

/-- `find` misses no entry the peer holds a row of that carries an asked token and that the device syncs. -/
theorem find_complete {st : State} {rows : List (Row Tok)} {d : SignerId} {follow : List VaultId}
    {toks : List Tok} {r : Row Tok} (hr : r ∈ rows) (ht : r.tok ∈ toks)
    (hs : syncsLog st d (.entry r.entry) follow = true) : r.entry ∈ find st rows d follow toks := by
  unfold find
  apply List.mem_eraseDups.mpr
  exact List.mem_map.mpr ⟨r, List.mem_filter.mpr ⟨hr, by simp [ht, hs]⟩, rfl⟩

/-- A device holding key `k` that asks for label `l` finds every entry a peer holds the row of `l` under `k` of, that
    the device syncs: the rows a reader told the peer find their way to every other reader. -/
theorem holder_finds {prf : Key → Label → Tok} {st : State} {d : SignerId} {follow : List VaultId}
    {keys : List Key} {labels : List Label} {s : Slot} {rows : List (Row Tok)}
    (hk : s.key ∈ keys) (hl : s.label ∈ labels) (hr : rowOf prf s ∈ rows)
    (hs : syncsLog st d (.entry s.entry) follow = true) :
    s.entry ∈ find st rows d follow (tokensFor prf keys labels) := by
  have ht : (rowOf prf s).tok ∈ tokensFor prf keys labels :=
    List.mem_flatMap.mpr ⟨s.key, hk, List.mem_map.mpr ⟨s.label, hl, rfl⟩⟩
  exact find_complete hr ht hs

/-- A device that syncs nothing of a vault is told no entry of it, whatever tokens it asks for and whatever rows the
    peer holds: like `T12_stranger_gets_nothing`, for `find`. -/
theorem find_stranger {st : State} {rows : List (Row Tok)} {d : SignerId} {follow : List VaultId}
    {toks : List Tok} (h : ∀ e, syncsLog st d (.entry e) follow = false) : find st rows d follow toks = [] := by
  apply List.eq_nil_iff_forall_not_mem.mpr
  intro e he
  have := (find_within_T12 he).1
  simp [h e] at this

end BlindIndex

end AvenDB

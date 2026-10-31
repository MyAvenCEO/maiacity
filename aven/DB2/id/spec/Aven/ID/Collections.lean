import Aven.ID.Types

/-! # Collections (A32)

A cap's flexibility comes as a collection (Samuel, 31 Oct 2026: "photos tagged beach from 2026"): a Doc of the sharing
vault, of avenID's type `collection`, that lists Docs, like a smart album. Its vault's devices keep the list with any
op, hand-picked, a query, a rule over facts, an actor or an approved suggestion, and each change to it is an envelope of
the collection that a device of its vault signs: it adds a Doc as an entry of its own, or removes entries, each named by
the envelope that added it, so the list is the same whatever order its changes came in. A cap names the collection and
what it lists (`Target.doc c .lists`), for any op: read, keep, write (add to it) and tell.

What a collection lists is read from the collection Doc's past as a reader holds it, the envelopes `S`:

- **Only its issuer's signed listings decide it** (`listed_by_issuer`): of all the envelopes a reader holds, only the
  listings of a collection that a device of the collection's own vault signed count. So what a cap covers changes only
  by its issuer's signed act, and anyone can check it, keepers too.
- **An edit never changes it** (`edit_keeps_coverage`): an envelope of a listed Doc's content, or anyone else's, changes
  no coverage, so nobody widens a cap by editing a tag.
- **It stays in its vault's authority** (`listed_in_authority`): a collection lists only Docs of its own vault or of
  vaults its vault governs, so a cap on it reaches nothing its issuer couldn't grant directly.
- **It is bounded** (rule 10): collections listing collections go at most `collectionDepth` levels, 8, deep enough for
  albums of albums and shared folders in folders, shallow enough that a reader's check stays small. A deeper tree is
  shared by a cap on its inner collection.
- **A write is judged on its own past** (A42): a write under a cap through a collection counts only if its Doc was
  listed in the write's past (`listsAt`), so lists change by their vault's own acts, never while a reader catches up
  on others' envelopes (`listsAt_catch_up`).

When a Doc leaves the list, the holder's coverage shrinks, and its devices drop the Doc at their next sync
(`Aven.ID.Holdings`, A40). -/

namespace Aven.ID

open Aven.Core

/-- A change to a collection's list: add a Doc as an entry, or remove entries, each named by the envelope that added
it. -/
inductive ListChange where
  | add (d : DocId)
  | remove (entries : List Hash)
  deriving DecidableEq, Repr

/-- A change to a list as the vectors write an envelope's body: `{"add": Doc}` or `{"remove": [entry…]}`. The docs
layer's Records carry it in a collection's own Doc. -/
def ListChange.value : ListChange → Value
  | .add d => .map [("add".toUTF8.toList, .bytes d.hash.bytes)]
  | .remove es => .map [("remove".toUTF8.toList, .array (es.map Hash.value))]

def hashOf? : Value → Option Hash
  | .bytes b => some ⟨b⟩
  | _ => none

/-- A body read back as a change to a list, or as none. -/
def ListChange.ofValue? : Value → Option ListChange
  | .map [(k, .bytes d)] => if k = "add".toUTF8.toList then some (.add ⟨⟨d⟩⟩) else none
  | .map [(k, .array hs)] => if k = "remove".toUTF8.toList then (hs.mapM hashOf?).map .remove else none
  | _ => none

/-- How deep collections nest: a collection lists through at most this many collections, itself included. -/
def collectionDepth : Nat := 8

section

/- `nm` names envelopes; `read` reads a change to a list from an envelope's body; `signs k v` says the device key `k`
signs for vault `v`; `gov v w` says vault `v` governs `w`; `facts` gives each Doc's genesis facts a reader knows. -/
variable (nm : Envelope → Hash) (read : Envelope → Option ListChange) (signs : Bytes → Hash → Bool)
  (gov : Hash → Hash → Bool) (facts : DocId → Option Facts)

/-- A change to collection `c`'s list: an envelope of its Doc, signed by a device of its vault. -/
def changeOf (c : Facts) (e : Envelope) : Option ListChange :=
  if e.doc == c.id && e.sigs.any (signs ·.signer c.vault) then read e else none

/-- Whether removal `r` of collection `c` removes entry `a`. -/
def removes (c : Facts) (r a : Envelope) : Bool :=
  match changeOf read signs c r with
  | some (.remove es) => es.contains (nm a)
  | _ => false

/-- `c` lists `d` directly among `S`: an entry adding `d` that no removal among `S` removes. -/
def listsDirect (S : List Envelope) (c : Facts) (d : DocId) : Bool :=
  S.any fun a => changeOf read signs c a == some (.add d) && !S.any (removes nm read signs c · a)

/-- The Docs `c`'s entries among `S` add, removed or not. -/
def entries (S : List Envelope) (c : Facts) : List DocId :=
  S.filterMap fun a => match changeOf read signs c a with
    | some (.add d) => some d
    | _ => none

/-- A Doc a collection may list: one of its own vault, or of a vault its vault governs. -/
def inReach (c f : Facts) : Bool := f.vault == c.vault || gov c.vault f.vault

/-- `c` lists `d` within `n` levels: `c` is a collection, and lists `d` directly, or lists a collection that lists `d`
within `n - 1` levels; each Doc listed is in the reach of the collection that lists it. -/
def listsWithin (S : List Envelope) : Nat → Facts → DocId → Bool
  | 0, _, _ => false
  | n + 1, c, d =>
    c.type == collectionType &&
      ((listsDirect nm read signs S c d && (facts d).any (inReach gov c)) ||
        (entries read signs S c).any fun e =>
          listsDirect nm read signs S c e && (facts e).any fun f => inReach gov c f && listsWithin S n f d)

/-- What a collection Doc lists among `S`, as Core's targets ask it: `c` is a collection the reader knows, and lists `d`
within `collectionDepth` levels. -/
def lists (S : List Envelope) (c d : DocId) : Bool :=
  match facts c with
  | some f => listsWithin nm read signs gov facts S collectionDepth f d
  | none => false

/-- A listing: an envelope that changes the list of a collection the reader knows, signed by a device of that
collection's vault. Nothing else is. -/
def isListing (e : Envelope) : Bool :=
  match facts e.doc with
  | some f => f.type == collectionType && e.sigs.any (signs ·.signer f.vault) && (read e).isSome
  | none => false

end

/-- The facts a reader knows are each Doc's own. -/
def FactsOk (facts : DocId → Option Facts) : Prop := ∀ d f, facts d = some f → f.id = d

theorem any_filter_of {α : Type} {p g : α → Bool} : ∀ {S : List α}, (∀ a ∈ S, p a = false → g a = false) →
    (S.filter p).any g = S.any g
  | [], _ => rfl
  | a :: S, h => by
    have ih := any_filter_of (S := S) fun b m => h b (List.mem_cons_of_mem _ m)
    cases hp : p a
    · simp [hp, h a List.mem_cons_self hp, ih]
    · simp [hp, ih]

theorem filterMap_filter_of {α β : Type} {p : α → Bool} {g : α → Option β} : ∀ {S : List α},
    (∀ a ∈ S, p a = false → g a = none) → (S.filter p).filterMap g = S.filterMap g
  | [], _ => rfl
  | a :: S, h => by
    have ih := filterMap_filter_of (S := S) fun b m => h b (List.mem_cons_of_mem _ m)
    cases hp : p a
    · simp [hp, h a List.mem_cons_self hp, ih]
    · simp [hp, List.filterMap_cons, ih]

section

variable {nm : Envelope → Hash} {read : Envelope → Option ListChange} {signs : Bytes → Hash → Bool}
  {gov : Hash → Hash → Bool} {facts : DocId → Option Facts}

/-- What doesn't change `c`'s list leaves what it lists directly, and its entries, as they were. -/
theorem listsDirect_filter {p : Envelope → Bool} {S : List Envelope} {c : Facts}
    (h : ∀ a ∈ S, p a = false → changeOf read signs c a = none) (d : DocId) :
    listsDirect nm read signs (S.filter p) c d = listsDirect nm read signs S c d ∧
      entries read signs (S.filter p) c = entries read signs S c := by
  have rm : ∀ a, (S.filter p).any (removes nm read signs c · a) = S.any (removes nm read signs c · a) :=
    fun a => any_filter_of fun r m pr => by simp [removes, h r m pr]
  refine ⟨?_, filterMap_filter_of fun a m pa => by simp [h a m pa]⟩
  simp only [listsDirect, rm]
  exact any_filter_of fun a m pa => by simp [h a m pa]

/-- An envelope that is no listing changes no known collection's list. -/
theorem changeOf_none {c : Facts} (hc : facts c.id = some c) (ty : c.type = collectionType)
    {e : Envelope} (n : isListing read signs facts e = false) : changeOf read signs c e = none := by
  unfold changeOf
  split
  · rename_i h
    simp only [Bool.and_eq_true, beq_iff_eq] at h
    unfold isListing at n
    rw [h.1, hc] at n
    simp only [ty, beq_self_eq_true, h.2, Bool.true_and, Option.isSome_eq_false_iff, Option.isNone_iff_eq_none] at n
    exact n
  · rfl

/-- Leaving out envelopes that are no listings changes nothing a known collection lists, at any depth. -/
theorem listsWithin_filter (ok : FactsOk facts) {p : Envelope → Bool}
    (hp : ∀ a, p a = false → isListing read signs facts a = false) (S : List Envelope) :
    ∀ (n : Nat) (c : Facts) (d : DocId), facts c.id = some c →
      listsWithin nm read signs gov facts (S.filter p) n c d = listsWithin nm read signs gov facts S n c d
  | 0, _, _, _ => rfl
  | n + 1, c, d, hc => by
    simp only [listsWithin]
    by_cases ty : c.type = collectionType
    · have h : ∀ a ∈ S, p a = false → changeOf read signs c a = none :=
        fun a _ pa => changeOf_none hc ty (hp a pa)
      rw [(listsDirect_filter (nm := nm) h d).1, (listsDirect_filter (nm := nm) h d).2]
      have inner : ∀ e, (listsDirect nm read signs (S.filter p) c e && (facts e).any fun f =>
          inReach gov c f && listsWithin nm read signs gov facts (S.filter p) n f d) =
          (listsDirect nm read signs S c e && (facts e).any fun f =>
          inReach gov c f && listsWithin nm read signs gov facts S n f d) := by
        intro e
        rw [(listsDirect_filter (nm := nm) h e).1]
        cases fe : facts e with
        | none => rfl
        | some f =>
          have hf : facts f.id = some f := by rw [ok e f fe]; exact fe
          simp only [Option.any_some, listsWithin_filter ok hp S n f d hf]
      simp only [inner]
    · have : (c.type == collectionType) = false := by simpa using ty
      simp [this]

/-- **Only the issuer's signed listings decide what a collection lists** (`listed_by_issuer`, A32): of the envelopes a
reader holds, the listings, each a change to a known collection's list signed by a device of that collection's own
vault, decide it alone. -/
theorem listed_by_issuer (ok : FactsOk facts) (S : List Envelope) (c d : DocId) :
    lists nm read signs gov facts S c d =
      lists nm read signs gov facts (S.filter (isListing read signs facts)) c d := by
  unfold lists
  cases fc : facts c with
  | none => rfl
  | some f =>
    have hf : facts f.id = some f := by rw [ok c f fc]; exact fc
    exact (listsWithin_filter ok (fun a pa => pa) S collectionDepth f d hf).symm

/-- **An edit never changes coverage** (A32): an envelope that is no listing, an edit to a listed Doc's content or an
envelope anyone else signed, changes nothing any collection lists. -/
theorem edit_keeps_coverage (ok : FactsOk facts) {e : Envelope} (n : isListing read signs facts e = false)
    (S : List Envelope) (c d : DocId) :
    lists nm read signs gov facts (e :: S) c d = lists nm read signs gov facts S c d := by
  rw [listed_by_issuer ok (e :: S), listed_by_issuer ok S]
  simp [n]

/-- An envelope of a Doc that is no collection is no listing, whatever its body says. -/
theorem content_no_listing {e : Envelope} {f : Facts} (hf : facts e.doc = some f) (ty : f.type ≠ collectionType) :
    isListing read signs facts e = false := by
  simp [isListing, hf, ty]

/-- Nor is one signed by a device of no collection's own vault. -/
theorem stranger_no_listing {e : Envelope} {f : Facts} (hf : facts e.doc = some f)
    (stranger : e.sigs.any (signs ·.signer f.vault) = false) : isListing read signs facts e = false := by
  simp [isListing, hf, stranger]

/-- **A collection stays in its vault's authority** (A32): whatever it lists, nested or not, is a Doc of its own vault
or of one its vault governs, authority running down the tree (`gov` transitive). -/
theorem listsWithin_reach (trans : ∀ a b c, gov a b = true → gov b c = true → gov a c = true) {S : List Envelope} :
    ∀ {n : Nat} {c : Facts} {d : DocId}, listsWithin nm read signs gov facts S n c d = true →
      ∃ f, facts d = some f ∧ (f.vault = c.vault ∨ gov c.vault f.vault = true)
  | 0, _, _, h => by simp [listsWithin] at h
  | n + 1, c, d, h => by
    simp only [listsWithin, Bool.and_eq_true, Bool.or_eq_true, List.any_eq_true] at h
    rcases h.2 with ⟨_, r⟩ | ⟨e, _, _, m⟩
    · cases fd : facts d with
      | none => simp [fd] at r
      | some f =>
        simp only [fd, Option.any_some, inReach, Bool.or_eq_true, beq_iff_eq] at r
        exact ⟨f, rfl, r⟩
    · cases fe : facts e with
      | none => simp [fe] at m
      | some g =>
        simp only [fe, Option.any_some, Bool.and_eq_true, inReach, Bool.or_eq_true, beq_iff_eq] at m
        obtain ⟨f, fd, r⟩ := listsWithin_reach trans m.2
        refine ⟨f, fd, ?_⟩
        rcases m.1 with e1 | g1 <;> rcases r with e2 | g2
        · exact .inl (e2.trans e1)
        · exact .inr (e1 ▸ g2)
        · exact .inr (e2 ▸ g1)
        · exact .inr (trans _ _ _ g1 g2)

theorem listed_in_authority (trans : ∀ a b c, gov a b = true → gov b c = true → gov a c = true)
    {S : List Envelope} {c d : DocId} {cf : Facts} (hc : facts c = some cf)
    (h : lists nm read signs gov facts S c d = true) :
    ∃ f, facts d = some f ∧ (f.vault = cf.vault ∨ gov cf.vault f.vault = true) := by
  simp only [lists, hc] at h
  exact listsWithin_reach trans h

end

/-! ## A write, judged on its past (A42) -/

/-- What collection `c` lists for envelope `e`, as a reader holding `S` judges it: from the listings in `e`'s past. A
write under a cap through a collection counts only if its Doc was listed in its past. -/
def listsAt (nm : Envelope → Hash) (read : Envelope → Option ListChange) (signs : Bytes → Hash → Bool) (gov : Hash → Hash → Bool)
    (facts : DocId → Option Facts) (S : List Envelope) (e : Envelope) (c d : DocId) : Bool :=
  lists nm read signs gov facts (S.filter (Past.inPast nm S e)) c d

/-- What `e`'s past among `S ++ X` holds, its past among `S` holds, when nothing of `X` is in it. -/
theorem before_of_append {nm : Envelope → Hash} {S X : List Envelope} {e x : Envelope}
    (outside : ∀ y ∈ X, ¬ Past.Before nm (S ++ X) e y) (h : Past.Before nm (S ++ X) e x) :
    Past.Before nm S e x := by
  induction h with
  | tip m t =>
    rcases List.mem_append.mp m with m' | m'
    · exact .tip m' t
    · exact absurd (.tip m t) (outside _ m')
  | step hb m t ih =>
    rcases List.mem_append.mp m with m' | m'
    · exact .step ih m' t
    · exact absurd (.step hb m t) (outside _ m')

/-- **Catching up on others changes nothing** (A42): envelopes a reader takes in that aren't in a write's past leave
what a collection lists for that write as it was. A removal the write never saw doesn't undo it, and an addition it
never saw doesn't make it count. -/
theorem listsAt_catch_up {nm : Envelope → Hash} {read : Envelope → Option ListChange} {signs : Bytes → Hash → Bool} {gov : Hash → Hash → Bool}
    {facts : DocId → Option Facts} {S X : List Envelope} {e : Envelope}
    (outside : ∀ y ∈ X, ¬ Past.Before nm (S ++ X) e y) (c d : DocId) :
    listsAt nm read signs gov facts (S ++ X) e c d = listsAt nm read signs gov facts S e c d := by
  unfold listsAt
  have same : (S ++ X).filter (Past.inPast nm (S ++ X) e) = S.filter (Past.inPast nm S e) := by
    rw [List.filter_append]
    have hX : X.filter (Past.inPast nm (S ++ X) e) = [] := by
      rw [List.filter_eq_nil_iff]
      intro y my hy
      exact outside y my ((Past.inPast_iff (List.mem_append_right _ my)).mp hy)
    rw [hX, List.append_nil]
    apply List.filter_congr
    intro x mx
    apply Bool.eq_iff_iff.mpr
    rw [Past.inPast_iff (List.mem_append_left _ mx), Past.inPast_iff mx]
    exact ⟨before_of_append outside, Past.Before.mono fun y m => List.mem_append_left _ m⟩
  rw [same]

/-! ## Examples

Samuel's beach album, a collection of his vault that his Mac keeps by hand. Mallory, whose phone signs for no vault of
Samuel's, adds a photo; his Mac adds a photo of Ana's vault, which his doesn't govern; an edit of a listed photo's
content has a body that reads like a listing. None of them lists anything. His Mac removes one entry, which leaves the
list. `trips` lists the album, so it lists what the album lists; a photo of the garden coop, which Samuel's vault
governs, is in reach. A chain of collections lists through 8 levels and no more. -/

namespace CollectionExamples

def utf8 (s : String) : Bytes := s.toUTF8.toList
def docOf (s : String) : DocId := ⟨blake3 (utf8 s)⟩
def photoType : DocId := docOf "type:photo"

def samuel : Hash := blake3 (utf8 "v:samuel")
def garden : Hash := blake3 (utf8 "v:garden")
def ana : Hash := blake3 (utf8 "v:ana")
def mac : Bytes := utf8 "samuel-mac"
def mallory : Bytes := utf8 "mallory-phone"

def signs (k : Bytes) (v : Hash) : Bool := k == mac && v == samuel
def gov (v w : Hash) : Bool := v == samuel && w == garden

def collection (name : String) : Facts := ⟨docOf name, samuel, collectionType⟩
def photo (name : String) (vault : Hash) : Facts := ⟨docOf name, vault, photoType⟩

def beach : Facts := collection "beach"
def trips : Facts := collection "trips"
def p1 : Facts := photo "p1" samuel
def p2 : Facts := photo "p2" samuel
def p3 : Facts := photo "p3" samuel
def q1 : Facts := photo "q1" ana
def g1 : Facts := photo "g1" garden

/-- The `i`th collection of a chain, each listing the next. -/
def link (i : Nat) : Facts := collection s!"chain-{i}"

def known : List Facts := [beach, trips, p1, p2, p3, q1, g1] ++ (List.range 10).map link
def facts (d : DocId) : Option Facts := known.find? (·.id == d)

def nm : Envelope → Hash := Envelope.name blake3
def read (e : Envelope) : Option ListChange := ListChange.ofValue? e.body

def env (doc : DocId) (writer seq : Nat) (signer : Bytes) (l : ListChange) (prev : Option Hash := none) : Envelope :=
  { doc, branch := utf8 "main", writer, seq, prev, deps := [], body := l.value, sigs := [⟨signer, []⟩] }

def a1 : Envelope := env beach.id 1 1 mac (.add p1.id)
def a2 : Envelope := env beach.id 1 2 mac (.add p2.id) (nm a1)
def r1 : Envelope := env beach.id 1 3 mac (.remove [nm a2]) (nm a2)
def m1 : Envelope := env beach.id 2 1 mallory (.add p3.id)
def x1 : Envelope := env beach.id 1 4 mac (.add q1.id) (nm r1)
def x2 : Envelope := env beach.id 1 5 mac (.add g1.id) (nm x1)
def e1 : Envelope := env p1.id 1 1 mac (.add p3.id)
def t1 : Envelope := env trips.id 1 1 mac (.add beach.id)

def beachLog : List Envelope := [a1, a2, r1, m1, x1, x2, e1, t1]

def listed (S : List Envelope) (c d : Facts) : Bool := lists nm read signs gov facts S c.id d.id

#guard listed beachLog beach p1 && listed beachLog beach g1 && listed beachLog trips p1 &&
  listed beachLog trips beach
#guard !listed beachLog beach p2 && !listed beachLog beach p3 && !listed beachLog beach q1 &&
  !listed beachLog trips p2
#guard isListing read signs facts a1 && !isListing read signs facts m1 && !isListing read signs facts e1
-- Before its removal, `p2` is listed.
#guard listed [a1, a2] beach p2
-- What `listed_by_issuer` says, here: the listings alone give the same answers.
#guard [p1, p2, p3, q1, g1].all fun d =>
  listed beachLog beach d == listed (beachLog.filter (isListing read signs facts)) beach d

/-- Two of Bob's writes to `p2` under a cap on what the album lists: one built on `p2`'s entry, one on its removal. -/
def bob : Bytes := utf8 "bob-phone"
def w1 : Envelope :=
  { doc := p2.id, branch := utf8 "main", writer := 3, seq := 1, prev := none, deps := [nm a2], body := .null,
    sigs := [⟨bob, []⟩] }
def w2 : Envelope := { w1 with seq := 2, prev := some (nm w1), deps := [nm r1] }

def listedAt (S : List Envelope) (e : Envelope) (c d : Facts) : Bool := listsAt nm read signs gov facts S e c.id d.id

-- The first was written while `p2` was listed, so it counts whatever the reader catches up on; the second saw the
-- removal.
#guard listedAt (beachLog ++ [w1, w2]) w1 beach p2 && !listedAt (beachLog ++ [w1, w2]) w2 beach p2
#guard listedAt [a1, a2, w1] w1 beach p2 == listedAt (beachLog ++ [w1, w2]) w1 beach p2

/-- A chain of `k + 1` collections: each lists the next, and the last lists `p1`. -/
def chain (k : Nat) : List Envelope :=
  ((List.range k).map fun i => env (link i).id 1 (i + 1) mac (.add (link (i + 1)).id)) ++
    [env (link k).id 1 (k + 1) mac (.add p1.id)]

#guard listed (chain 7) (link 0) p1 && !listed (chain 8) (link 0) p1

end CollectionExamples

end Aven.ID

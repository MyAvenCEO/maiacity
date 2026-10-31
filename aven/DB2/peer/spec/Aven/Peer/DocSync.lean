import Aven.Core.Past
import Aven.Core.CborLaws
import Aven.Core.Text

/-!
# Docs in the Peers: the topic, and sync between readers by version

The Peers own the wire, presence and catch-up (ARCHITECTURE.md, A45). For a Doc they own its topic and the sync
between its readers. This module imports only Core, so it moves with the wire into the Peers' package unchanged.

**The topic.** A Doc's live envelopes travel on the gossip topic `derive_key("avenDB topic 1", epoch key)` (caps
README, "Sealing"): only the Doc's readers, and keepers told it, can find it. A topic is per epoch; a reader joins the
newest epoch's and the one before, so a rotation loses nothing in flight. On the wire a Doc is named by its topic,
never by its id, so a member who isn't a reader learns nothing from a frame.

**Sync by version** (docs README, "Catching up", 2). Two readers who meet on a Doc's topic each tell their tips
(`doc_tips`): the head of each of their logs, as `{writer, seq, name}`. Each answers the other's telling, once its last
page is in, with what lies `beyond` it (`doc_have`), and the other fetches that. An envelope is left out of the answer
only when the tips tell that the other holds it:
- **by name:** a tip names it, or names something it is before (Core's past, `Aven.Core.Past`), which the other holds
  with its whole past;
- **by place:** the tips name one head of its log, further on than it, and this reader holds no split in that log.
  Without a split, the other's log up to its head has this envelope at its place.

A tip that names something this reader doesn't hold, at a place where it holds another envelope, is how a split
shows: that envelope is never left out (`split_shows`), so the other ends up holding both halves. A log with a split
held is answered whole, by name alone (`split_sent`), so both halves reach every reader they meet (`split_spreads`,
`Aven.ID.Node`). A reader tells only what it holds, and holds only a version: what waits for its past isn't held
(rule 11, `Closed`, `Logs`).

**Every page moves, or the exchange stops** (README rule 3): a page that brings no name its receiver didn't hold ends
it, so it ends after at most as many pages as there are names between the two (`sync_moves`).

What it proves:
- `beyond_complete`: without a split between them, whatever a reader holds is held by the other or in its answer;
- `sync_union`: after one exchange both readers hold everything either held, by name;
- `split_sent`, `split_shows`: a split is never left out, held or shown;
- `beyond_new`: nothing the tips name is sent;
- `sync_moves`: a page that moves makes the names held strictly more;
- `Live.ofValue_value`, `Live.of_fits`: what a Doc's topic carries reads back, and fits a gossip message.

Catch-up from keepers, by arrival number, is another exchange (stage 5), never this one.
-/

namespace Aven.Peer.DocSync

open Aven.Core Aven.Core.Past

/-! ## The topic -/

/-- The subkey label a Doc's gossip topic is derived under (caps README, "Sealing"). -/
def topicLabel : String := "avenDB topic 1"

/-- A Doc's gossip topic in one epoch: BLAKE3's key derivation under `topicLabel` over the epoch's key. -/
def topic (epochKey : Bytes) : Bytes := Blake3.deriveKey topicLabel epochKey

/-! ## What a Doc's topic carries

A commit's loose envelope goes out on its Doc's topic sealed, as it is. One too large for a gossip message goes out as
its sealed bytes' hash, and readers fetch it through the fetch gate on `aven/db/1` (`prove`, `fetch`, `items`), as they
fetch a `doc_have`'s. A message is a Value with exactly one key, read back from exactly that (`Live.ofValue_value`). -/

/-- The most one gossip message carries: iroh-gossip's default. -/
def gossipMax : Nat := 4096

/-- A message on a Doc's topic. -/
inductive Live where
  /-- a loose envelope, sealed with the `envelope` kind -/
  | sealed (bytes : Bytes)
  /-- the hash of one too large to gossip, to fetch -/
  | hash (h : Hash)
  deriving DecidableEq, Repr

def Live.value : Live → Value
  | .sealed b => .map [(text "sealed", .bytes b)]
  | .hash h => .map [(text "hash", .bytes h.bytes)]

/-- A message read from exactly its one key; a hash is 32 bytes. -/
def Live.ofValue? : Value → Option Live
  | .map [(k, .bytes b)] =>
    if k = text "sealed" then some (.sealed b)
    else if k = text "hash" ∧ b.length = 32 then some (.hash ⟨b⟩)
    else none
  | _ => none

/-- **One form:** a message reads back from its Value. -/
theorem Live.ofValue_value (l : Live) (h : ∀ x, l = .hash x → x.bytes.length = 32) : Live.ofValue? l.value = some l := by
  cases l with
  | sealed b => simp [Live.value, Live.ofValue?]
  | hash x =>
    have := h x rfl
    simp [Live.value, Live.ofValue?, text_inj, this]

/-- What a writer gossips for a sealed envelope: itself when it fits a message, else its hash. -/
def Live.of (sealed : Bytes) : Live :=
  if (encode (Live.sealed sealed).value).length ≤ gossipMax then .sealed sealed else .hash (blake3 sealed)

/-- **It fits:** a sealed envelope goes out as itself only when its message fits. -/
theorem Live.of_fits {b : Bytes} (h : Live.of b = .sealed b) : (encode (Live.sealed b).value).length ≤ gossipMax := by
  unfold Live.of at h
  split at h
  · assumption
  · cases h

/-! ## What sync reads of an envelope -/

/-- An envelope as sync reads it: its name (A30), its place in its log, and what it builds on. -/
structure Entry where
  name : Hash
  writer : Nat
  seq : Nat
  prev : Option Hash
  deps : List Hash
  deriving DecidableEq, Repr, Inhabited

instance : Parents Entry := ⟨fun e => e.prev.toList ++ e.deps⟩

/-- A log's head, as a tip tells it. -/
structure Tip where
  writer : Nat
  seq : Nat
  name : Hash
  deriving DecidableEq, Repr

def Entry.tip (e : Entry) : Tip := ⟨e.writer, e.seq, e.name⟩

/-- A reader holds a version: everything a held envelope builds on is held, by name (rule 11). -/
def Closed (S : List Entry) : Prop := ∀ a ∈ S, ∀ h ∈ parents a, ∃ b ∈ S, b.name = h

/-- Its logs are whole: each envelope's place is from 1, and past 1 its `prev` is the one before it in its log. -/
def Logs (S : List Entry) : Prop :=
  ∀ b ∈ S, 1 ≤ b.seq ∧ (1 < b.seq → ∃ p ∈ S, b.prev = some p.name ∧ p.writer = b.writer ∧ p.seq + 1 = b.seq)

/-- Names name content: what two readers hold under one name is one envelope (BLAKE3). -/
def Agree (A B : List Entry) : Prop := ∀ a ∈ A, ∀ b ∈ B, a.name = b.name → a = b

/-- No split between two readers: one place, one envelope. -/
def NoSplit (A B : List Entry) : Prop :=
  ∀ a ∈ A, ∀ b ∈ B, a.writer = b.writer → a.seq = b.seq → a.name = b.name

/-- `B` holds `x`, by name. -/
def Holds (B : List Entry) (x : Entry) : Prop := ∃ b ∈ B, b.name = x.name

/-- A split held in writer `w`'s log: two envelopes at one place. -/
def split (S : List Entry) (w : Nat) : Bool :=
  S.any fun a => S.any fun b => a.writer == w && b.writer == w && a.seq == b.seq && a.name != b.name

/-- A reader's tips: the head of each of its logs, each envelope that nothing held names as its `prev`. -/
def tips (S : List Entry) : List Tip :=
  (S.filter fun a => !S.any fun b => b.prev == some a.name).map Entry.tip

/-- What tips `T` tell of `x`: by name, or by place. -/
def told (S : List Entry) (T : List Tip) (x : Entry) : Bool :=
  T.any (fun τ => τ.name == x.name) ||
  S.any (fun t => T.any (fun τ => τ.name == t.name) && inPast Entry.name S t x) ||
  (!split S x.writer && T.any fun τ => τ.writer == x.writer && decide (x.seq < τ.seq) &&
    (T.filter fun σ => σ.writer == x.writer).length == 1)

/-- The answer to tips `T`: what `S` holds that `T` doesn't tell. -/
def beyond (S : List Entry) (T : List Tip) : List Entry := S.filter fun x => !told S T x

/-- The names held, each once. -/
def held (S : List Entry) : List Hash := dedup (S.map Entry.name)

/-- A page moves its receiver when it brings a name the receiver didn't hold. -/
def moves (S page : List Entry) : Bool := page.any fun x => !(S.map Entry.name).contains x.name

/-! ## What it proves -/

theorem Agree.symm {A B : List Entry} (ag : Agree A B) : Agree B A :=
  fun b mb a ma e => (ag a ma b mb e.symm).symm

theorem NoSplit.symm {A B : List Entry} (ns : NoSplit A B) : NoSplit B A :=
  fun b mb a ma w s => (ns a ma b mb w.symm s.symm).symm

/-- A reader's tips name only what it holds, at its place. -/
theorem tips_held {S : List Entry} : ∀ τ ∈ tips S, ∃ b ∈ S, b.name = τ.name ∧ b.writer = τ.writer ∧ b.seq = τ.seq := by
  intro τ m
  simp only [tips, List.mem_map, List.mem_filter] at m
  obtain ⟨b, ⟨mb, _⟩, rfl⟩ := m
  exact ⟨b, mb, rfl, rfl, rfl⟩

/-- Whatever lies before something the other holds, the other holds too: it holds a version, and names name content. -/
theorem held_before {A B : List Entry} (cb : Closed B) (ag : Agree A B) {t x : Entry} (ht : t ∈ A)
    {t' : Entry} (mt' : t' ∈ B) (et : t.name = t'.name) (h : Before Entry.name A t x) : Holds B x := by
  induction h with
  | tip _ p =>
    rw [ag _ ht t' mt' et] at p
    exact cb t' mt' _ p
  | step hb _ p ih =>
    obtain ⟨y, my, ey⟩ := ih
    rw [ag _ hb.mem y my ey.symm] at p
    exact cb y my _ p

/-- A whole log holds every place up to its head. -/
theorem logs_below {B : List Entry} (lb : Logs B) :
    ∀ (d : Nat) (b : Entry), b ∈ B → ∀ k, 1 ≤ k → b.seq = k + d → ∃ c ∈ B, c.writer = b.writer ∧ c.seq = k
  | 0, b, mb, _, _, e => ⟨b, mb, rfl, by omega⟩
  | d + 1, b, mb, k, hk, e => by
    obtain ⟨p, mp, _, wp, sp⟩ := (lb b mb).2 (by omega)
    obtain ⟨c, mc, wc, sc⟩ := logs_below lb d p mp k hk (by omega)
    exact ⟨c, mc, wc.trans wp, sc⟩

/-- What tips told by name, the other holds; and by place too, when there is no split between them. -/
theorem told_held {A B : List Entry} {T : List Tip} (la : Logs A) (cb : Closed B) (lb : Logs B) (ag : Agree A B)
    (ns : NoSplit A B) (hT : ∀ τ ∈ T, ∃ b ∈ B, b.name = τ.name ∧ b.writer = τ.writer ∧ b.seq = τ.seq)
    {a : Entry} (ma : a ∈ A) (tl : told A T a = true) : Holds B a := by
  simp only [told, Bool.or_eq_true, List.any_eq_true, Bool.and_eq_true, beq_iff_eq, decide_eq_true_eq] at tl
  rcases tl with (⟨τ, mτ, e⟩ | ⟨t, mt, ⟨τ, mτ, e⟩, p⟩) | ⟨_, τ, mτ, ⟨w, lt⟩, _⟩
  · obtain ⟨b, mb, eb, _⟩ := hT τ mτ
    exact ⟨b, mb, eb.trans e⟩
  · obtain ⟨b, mb, eb, _⟩ := hT τ mτ
    exact held_before cb ag mt mb (e.symm.trans eb.symm) ((inPast_iff ma).mp p)
  · obtain ⟨b, mb, _, wb, sb⟩ := hT τ mτ
    obtain ⟨c, mc, wc, sc⟩ := logs_below lb (b.seq - a.seq) b mb a.seq (la a ma).1 (by omega)
    exact ⟨c, mc, (ns a ma c mc (by rw [wc, wb, w]) sc.symm).symm⟩

/-- **Nothing is left out:** without a split between them, what `A` holds is held by `B`, or in `A`'s answer to tips
`B` holds. -/
theorem beyond_complete {A B : List Entry} {T : List Tip} (la : Logs A) (cb : Closed B) (lb : Logs B)
    (ag : Agree A B) (ns : NoSplit A B)
    (hT : ∀ τ ∈ T, ∃ b ∈ B, b.name = τ.name ∧ b.writer = τ.writer ∧ b.seq = τ.seq) {a : Entry} (ma : a ∈ A) :
    Holds B a ∨ a ∈ beyond A T := by
  cases tl : told A T a
  · right
    simp only [beyond, List.mem_filter, tl, Bool.not_false, and_true]
    exact ma
  · exact .inl (told_held la cb lb ag ns hT ma tl)

/-- **One exchange makes both whole:** each reader tells its tips, the other answers with what lies beyond them, and
then each holds, by name, everything either held. -/
theorem sync_union {A B : List Entry} (ca : Closed A) (la : Logs A) (cb : Closed B) (lb : Logs B)
    (ag : Agree A B) (ns : NoSplit A B) :
    (∀ x ∈ A ++ B, Holds (A ++ beyond B (tips A)) x) ∧ (∀ x ∈ A ++ B, Holds (B ++ beyond A (tips B)) x) := by
  constructor
  · intro x mx
    rcases List.mem_append.mp mx with m | m
    · exact ⟨x, List.mem_append_left _ m, rfl⟩
    · rcases beyond_complete lb ca la ag.symm ns.symm tips_held m with ⟨y, my, e⟩ | b
      · exact ⟨y, List.mem_append_left _ my, e⟩
      · exact ⟨x, List.mem_append_right _ b, rfl⟩
  · intro x mx
    rcases List.mem_append.mp mx with m | m
    · rcases beyond_complete la cb lb ag ns tips_held m with ⟨y, my, e⟩ | b
      · exact ⟨y, List.mem_append_left _ my, e⟩
      · exact ⟨x, List.mem_append_right _ b, rfl⟩
    · exact ⟨x, List.mem_append_left _ m, rfl⟩

/-- What tips told by name, the other holds, split or not. -/
theorem told_by_name {A B : List Entry} {T : List Tip} (cb : Closed B) (ag : Agree A B)
    (hT : ∀ τ ∈ T, ∃ b ∈ B, b.name = τ.name ∧ b.writer = τ.writer ∧ b.seq = τ.seq) {a : Entry} (ma : a ∈ A)
    (tl : (T.any (fun τ => τ.name == a.name) ||
      A.any (fun t => T.any (fun τ => τ.name == t.name) && inPast Entry.name A t a)) = true) : Holds B a := by
  simp only [Bool.or_eq_true, List.any_eq_true, Bool.and_eq_true, beq_iff_eq] at tl
  rcases tl with ⟨τ, mτ, e⟩ | ⟨t, mt, ⟨τ, mτ, e⟩, p⟩
  · obtain ⟨b, mb, eb, _⟩ := hT τ mτ
    exact ⟨b, mb, eb.trans e⟩
  · obtain ⟨b, mb, eb, _⟩ := hT τ mτ
    exact held_before cb ag mt mb (e.symm.trans eb.symm) ((inPast_iff ma).mp p)

/-- **A split log goes whole:** in a log where this reader holds a split, each of its envelopes is held by the other or
sent, whatever the tips say of places. -/
theorem split_sent {A B : List Entry} {T : List Tip} (cb : Closed B) (ag : Agree A B)
    (hT : ∀ τ ∈ T, ∃ b ∈ B, b.name = τ.name ∧ b.writer = τ.writer ∧ b.seq = τ.seq) {a : Entry} (ma : a ∈ A)
    (sp : split A a.writer = true) : Holds B a ∨ a ∈ beyond A T := by
  cases tl : told A T a
  · right
    simp only [beyond, List.mem_filter, tl, Bool.not_false, and_true]
    exact ma
  · left
    simp only [told, sp, Bool.not_true, Bool.false_and, Bool.or_false] at tl
    exact told_by_name cb ag hT ma tl

/-- **A split shows:** an envelope at the place of a head the tips tell of its log is held by the other or sent, so
when the head is another envelope, the other then holds both halves. -/
theorem split_shows {A B : List Entry} {T : List Tip} (cb : Closed B) (ag : Agree A B)
    (hT : ∀ τ ∈ T, ∃ b ∈ B, b.name = τ.name ∧ b.writer = τ.writer ∧ b.seq = τ.seq) {a : Entry} (ma : a ∈ A)
    {τ : Tip} (mτ : τ ∈ T) (w : τ.writer = a.writer) (s : τ.seq = a.seq) : Holds B a ∨ a ∈ beyond A T := by
  cases tl : told A T a
  · right
    simp only [beyond, List.mem_filter, tl, Bool.not_false, and_true]
    exact ma
  · left
    -- by place it isn't told: the one head of its log is at its own place, not further on
    have byName : (T.any (fun τ => τ.name == a.name) ||
        A.any (fun t => T.any (fun τ => τ.name == t.name) && inPast Entry.name A t a)) = true := by
      simp only [told, Bool.or_eq_true, Bool.and_eq_true, List.any_eq_true, beq_iff_eq, decide_eq_true_eq] at tl
      rcases tl with h | ⟨_, σ, mσ, ⟨wσ, lt⟩, n⟩
      · simpa [Bool.or_eq_true, List.any_eq_true, Bool.and_eq_true, beq_iff_eq] using h
      · exfalso
        have hσ : σ ∈ T.filter fun σ => σ.writer == a.writer := List.mem_filter.mpr ⟨mσ, by simpa using wσ⟩
        have hτ : τ ∈ T.filter fun σ => σ.writer == a.writer := List.mem_filter.mpr ⟨mτ, by simpa using w⟩
        obtain ⟨x, hx⟩ := List.length_eq_one_iff.mp (by simpa using n)
        rw [hx] at hσ hτ
        simp only [List.mem_singleton] at hσ hτ
        subst hσ; subst hτ
        omega
    exact told_by_name cb ag hT ma byName

/-- **Only what is new to the asker:** nothing its tips name is sent. -/
theorem beyond_new {S : List Entry} {T : List Tip} {x : Entry} (m : x ∈ beyond S T) : ∀ τ ∈ T, τ.name ≠ x.name := by
  intro τ mτ e
  simp only [beyond, List.mem_filter] at m
  have : told S T x = true := by
    simp only [told, Bool.or_eq_true, List.any_eq_true, beq_iff_eq]
    exact .inl (.inl ⟨τ, mτ, e⟩)
  rw [this] at m
  exact absurd m.2 (by decide)

/-- **Every page moves:** a page that brings a name the receiver didn't hold makes the names it holds strictly more.
The names two readers hold are finite, so an exchange that stops at the first page that doesn't move ends. -/
theorem sync_moves {S page : List Entry} (h : moves S page = true) : (held S).length < (held (S ++ page)).length := by
  simp only [moves, List.any_eq_true, Bool.not_eq_true'] at h
  obtain ⟨x, mx, nx⟩ := h
  have fresh : x.name ∉ held S := fun m => by
    rw [List.contains_iff_mem.mpr (mem_dedup.mp m)] at nx
    cases nx
  have nd : (x.name :: held S).Nodup := List.nodup_cons.mpr ⟨fresh, nodup_dedup _⟩
  have sub : ∀ y ∈ x.name :: held S, y ∈ held (S ++ page) := by
    intro y my
    simp only [held, mem_dedup, List.mem_cons, List.map_append, List.mem_append, List.mem_map] at my ⊢
    rcases my with rfl | ⟨b, mb, e⟩
    · exact .inr ⟨x, mx, rfl⟩
    · exact .inl ⟨b, mb, e⟩
  have := nd.length_le_of_subset sub
  simp only [List.length_cons] at this
  omega

/-! ## Examples -/

/-- The `i`th example name. -/
def n (i : Nat) : Hash := ⟨[i.toUInt8]⟩

def e (i w s : Nat) (prev : Option Nat) (deps : List Nat) : Entry := ⟨n i, w, s, prev.map n, deps.map n⟩

-- Alice's log (writer 1): 0 ← 1 ← 2; Bob's (writer 2): 3 ← 4, 4 building on 1 too. 5 is a second envelope after 1 in
-- Alice's log: a split with 2.
def alice : List Entry := [e 0 1 1 none [], e 1 1 2 (some 0) [], e 2 1 3 (some 1) []]
def bob : List Entry := [e 0 1 1 none [], e 1 1 2 (some 0) [], e 3 2 1 none [], e 4 2 2 (some 3) [1]]

#guard tips alice = [⟨1, 3, n 2⟩]
#guard tips bob = [⟨1, 2, n 1⟩, ⟨2, 2, n 4⟩]
-- each answers with exactly what the other lacks, though neither knows the other's newest
#guard (beyond alice (tips bob)).map (·.name) = [n 2]
#guard (beyond bob (tips alice)).map (·.name) = [n 3, n 4]
-- one who holds nothing gets everything; one who holds the same gets nothing
#guard (beyond bob []).map (·.name) = bob.map (·.name)
#guard beyond bob (tips bob) = []
-- a split: Carol holds 5 where Alice holds 2. Each sends its half, since the tip at its place names another
def carol : List Entry := [e 0 1 1 none [], e 1 1 2 (some 0) [], e 5 1 3 (some 1) []]
#guard (beyond alice (tips carol)).map (·.name) = [n 2]
#guard (beyond carol (tips alice)).map (·.name) = [n 5]
-- once a reader holds both halves, the log goes whole by name: Alice, holding the split, sends the rest of it too
def both : List Entry := alice ++ [e 5 1 3 (some 1) []]
#guard split both 1 && !split alice 1
#guard (beyond both [⟨1, 3, n 5⟩]).map (·.name) = [n 2]
#guard (beyond both [⟨1, 2, n 1⟩]).map (·.name) = [n 2, n 5]
-- a page of names already held doesn't move; one with a new name does
#guard !moves alice [e 1 1 2 (some 0) []]
#guard moves alice [e 3 2 1 none []]
-- what a topic carries: up to 4085 sealed bytes as they are, more as their hash; each reads back from its bytes
#guard (Live.of (List.replicate 4085 7)) == .sealed (List.replicate 4085 7)
#guard (Live.of (List.replicate 4086 7)) == .hash (blake3 (List.replicate 4086 7))
#guard (encode (Live.of (List.replicate 100000 7)).value).length ≤ gossipMax
#guard [Live.sealed [1, 2, 3], Live.sealed [], Live.hash (blake3 [1])].all fun l =>
  (decodeAll (encode l.value)).bind Live.ofValue? == some l
-- a hash that isn't 32 bytes, another key, a key extra: none
#guard Live.ofValue? (.map [(text "hash", .bytes [1])]) == none
#guard Live.ofValue? (.map [(text "line", .bytes [1])]) == none
#guard Live.ofValue? (.map [(text "sealed", .bytes [1]), (text "x", .null)]) == none
-- a topic is 32 bytes
#guard (topic (List.replicate 32 0)).length = 32

end Aven.Peer.DocSync

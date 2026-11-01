import Aven.ID.Caps
import Aven.ID.Cast

/-! # Epochs and what each party can know

Keys as the model knows them: anything with an equality, names in the examples and Core's bytes where
`Aven.Architecture` joins this to the docs layer, with the cryptography taken as sound (`id/caps/README.md`, "Keys"). A party holds
its own keys: a device its device keys, the keeper only its own. A **seal** `(k, under)` means whoever knows `under`
learns `k`: a key blob's stanza seals a Doc's epoch key to a reader's vault or group key, a keyring is sealed to a
device's key, a vault key lives inside its keyring, and an epoch's `back` seals the epoch before under it. What a party
knows is everything it can open from its own keys, seal by seal.

The theorems:
- a key is learned only as one's own or by opening a seal with a key already known (`confidential`);
- a set of keys none of which a party owns, each sealed only under keys of the set, stays unknown to it
  (`unknowable`); the rest are its instances;
- a new epoch sealed only to the remaining readers stays closed to a removed one (`removal_next_epoch`);
- after a heal, a removed device learns none of the new keys: the keyring's, the vault key, tag seeds, letterbox keys,
  the groups' and Docs' next epochs (`heal_evicts`);
- a party nothing is sealed to, the keeper, knows only its own keys (`keeper_blind`), and sees of a segment only its
  Doc, its epoch and its padded length, so nothing of who wrote it or what it holds (`outside_blind`, D13);
- an envelope under an epoch older than one it builds on doesn't count (`stale_refused`, rule 16);
- authority runs down: where every seal opens a key of the vault it is sealed under or of one below it, as `below`
  groups seal, a party learns keys only of the vaults whose keys it holds and those below them (`authority_down`), and
  none of a vault above them all (`never_above`).

Examples on Alice's and Bob's keys are checked by `decide` and exported as vectors (`epochs.json`). -/

namespace Aven.ID

/-- Who holds which keys, and which keys are sealed under which: `(k, under)`. A key is anything with an equality:
readable names in the examples, Core's bytes where `Aven.Architecture` joins this to the docs layer (R5). -/
structure WorldOf (κ : Type) where
  own : String → List κ
  seals : List (κ × κ)

namespace WorldOf

variable {κ : Type} [DecidableEq κ]

/-- One more step of opening: every key sealed under one already known. -/
def step (w : WorldOf κ) (known : List κ) : List κ :=
  known ++ ((w.seals.filter fun s => decide (s.2 ∈ known) && decide (s.1 ∉ known)).map (·.1))

/-- What `p` knows after `n` steps of opening. -/
def knownAfter (w : WorldOf κ) (p : String) : Nat → List κ
  | 0 => w.own p
  | n + 1 => w.step (w.knownAfter p n)

def knows (w : WorldOf κ) (n : Nat) (p : String) (k : κ) : Bool := decide (k ∈ w.knownAfter p n)

/-- What `p` learns at all: as many steps as there are seals, each opening at least one new key or none. -/
def learns (w : WorldOf κ) (p : String) (k : κ) : Bool := w.knows w.seals.length p k

/-- `S` is closed: every key in it is sealed only under keys in it. -/
def Closed (w : WorldOf κ) (S : List κ) : Prop := ∀ s ∈ w.seals, s.1 ∈ S → s.2 ∈ S

theorem mem_step {w : WorldOf κ} {known : List κ} {k : κ} :
    k ∈ w.step known ↔ k ∈ known ∨ ∃ s ∈ w.seals, s.2 ∈ known ∧ s.1 ∉ known ∧ s.1 = k := by
  simp [step, List.mem_filter, and_assoc]

/-- A key is learned only as one's own or by opening a seal with a key already known. -/
theorem confidential {w : WorldOf κ} {n : Nat} {p : String} {k : κ} (h : w.knows (n + 1) p k = true) :
    w.knows n p k = true ∨ ∃ s ∈ w.seals, s.1 = k ∧ w.knows n p s.2 = true := by
  have h' : k ∈ w.step (w.knownAfter p n) := of_decide_eq_true h
  rcases mem_step.mp h' with h | ⟨s, m, known, _, e⟩
  · exact .inl (decide_eq_true h)
  · exact .inr ⟨s, m, e, decide_eq_true known⟩

/-- Keys of a closed set none of which `p` owns stay unknown to it. -/
theorem unknowable {w : WorldOf κ} {p : String} {S : List κ} (own : ∀ k ∈ S, k ∉ w.own p) (c : w.Closed S) :
    ∀ n, ∀ k ∈ w.knownAfter p n, k ∉ S := by
  intro n
  induction n with
  | zero => intro k m s; exact own k s m
  | succ n ih =>
    intro k m s
    rcases mem_step.mp m with m | ⟨x, xm, known, _, e⟩
    · exact ih k m s
    · exact ih x.2 known (c x xm (e ▸ s))

/-- A new epoch, sealed only to keys of a closed set the removed reader owns nothing of, stays closed to it. -/
theorem removal_next_epoch {w : WorldOf κ} {removed : String} {epoch : κ} {S : List κ} (mem : epoch ∈ S)
    (c : w.Closed S) (own : ∀ k ∈ S, k ∉ w.own removed) : ∀ n, w.knows n removed epoch = false := by
  intro n
  simpa [knows] using fun m => unknowable own c n epoch m mem

/-- After a heal the removed device learns none of the fresh keys, provided every fresh key is sealed only under fresh
keys or the remaining devices' new keys, those device keys are sealed under nothing, and the removed device owns none
of them. Old seals may stay: they open old keys only. -/
theorem heal_evicts {w : WorldOf κ} {d : String} {fresh devices : List κ}
    (sealed : ∀ s ∈ w.seals, s.1 ∈ fresh → s.2 ∈ fresh ∨ s.2 ∈ devices)
    (unsealed : ∀ s ∈ w.seals, s.1 ∉ devices)
    (notOwn : ∀ k ∈ fresh ++ devices, k ∉ w.own d) :
    ∀ n k, k ∈ fresh → w.knows n d k = false := by
  have c : w.Closed (fresh ++ devices) := fun s m h => by
    rcases List.mem_append.mp h with f | dv
    · exact List.mem_append.mpr (sealed s m f)
    · exact absurd dv (unsealed s m)
  intro n k f
  simpa [knows] using fun m => unknowable notOwn c n k m (List.mem_append.mpr (.inl f))

/-- A party nothing is sealed to knows only its own keys: the keeper, which keep caps give no key, learns none. -/
theorem keeper_blind {w : WorldOf κ} {keeper : String} (nothing : ∀ s ∈ w.seals, s.2 ∉ w.own keeper) :
    ∀ n, ∀ k ∈ w.knownAfter keeper n, k ∈ w.own keeper := by
  intro n
  induction n with
  | zero => intro k m; exact m
  | succ n ih =>
    intro k m
    rcases mem_step.mp m with m | ⟨x, xm, known, _, _⟩
    · exact ih k m
    · exact absurd (ih x.2 known) (nothing x xm)

/-! ### Below: authority runs down

A vault's `below` group reads the all group of every vault it governs, and its keys are sealed downward (caps, "The
layers"): every seal opens a key of the vault it is sealed under, or of a vault below that one. A grant of `below` on
`v` is holding `v`'s `below` group. -/

/-- `u` is `v` or a vault `v` governs: what a `below` grant on `v` reaches. -/
def Down (t : Tree String) (v u : String) : Prop := u = v ∨ t.Governs v u

theorem Down.trans {t : Tree String} {a b c : String} (h : Down t a b) (k : Down t b c) : Down t a c := by
  rcases h with rfl | h
  · exact k
  · rcases k with rfl | k
    · exact .inr h
    · exact .inr (Tree.governs_trans h k)

/-- Every seal goes down: a key of a vault is sealed only under a key of that vault or of a vault that governs it. -/
def SealsDown (t : Tree String) (vaultOf : κ → String) (w : WorldOf κ) : Prop :=
  ∀ s ∈ w.seals, Down t (vaultOf s.2) (vaultOf s.1)

/-- **Authority runs down:** a party learns keys only of the vaults whose keys it holds and of the vaults below them.
Holding `v`'s `below` group reads `v`'s Docs and those below it. -/
theorem authority_down {t : Tree String} {vaultOf : κ → String} {w : WorldOf κ} {p : String} {vs : List String}
    (sd : SealsDown t vaultOf w) (own : ∀ k ∈ w.own p, ∃ v ∈ vs, Down t v (vaultOf k)) :
    ∀ n, ∀ k ∈ w.knownAfter p n, ∃ v ∈ vs, Down t v (vaultOf k) := by
  intro n
  induction n with
  | zero => exact own
  | succ n ih =>
    intro k m
    rcases mem_step.mp m with m | ⟨s, sm, known, _, rfl⟩
    · exact ih k m
    · obtain ⟨v, mv, d⟩ := ih s.2 known
      exact ⟨v, mv, d.trans (sd s sm)⟩

/-- **Never above:** in a well-formed tree, a party holding keys only of vaults that `u` governs learns no key of `u`.
A `below` grant on Maia City never reads Alice's vault, which owns Maia City. -/
theorem never_above {t : Tree String} (wf : t.WF) {vaultOf : κ → String} {w : WorldOf κ} {p : String} {vs : List String}
    {u : String} (sd : SealsDown t vaultOf w) (own : ∀ k ∈ w.own p, ∃ v ∈ vs, Down t v (vaultOf k))
    (above : ∀ v ∈ vs, t.Governs u v) : ∀ n, ∀ k ∈ w.knownAfter p n, vaultOf k ≠ u := by
  intro n k m e
  obtain ⟨v, mv, d⟩ := authority_down sd own n k m
  rw [e] at d
  rcases d with h | g
  · subst h
    exact Tree.governs_irrefl wf _ (above _ mv)
  · exact Tree.governs_asymm wf (above v mv) g

/-- The same world with its keys renamed: how the vectors write a world whose keys are pairs. -/
def map {κ' : Type} (f : κ → κ') (w : WorldOf κ) : WorldOf κ' :=
  { own := fun p => (w.own p).map f, seals := w.seals.map fun s => (f s.1, f s.2) }

end WorldOf

/-- `Down`, decided by the `governs` query, for a well-formed tree. -/
def downB (t : Tree String) (v u : String) : Bool := u == v || (t.governs v).contains u

theorem downB_iff {t : Tree String} (wf : t.WF) {v u : String} : downB t v u = true ↔ WorldOf.Down t v u := by
  simp [downB, WorldOf.Down, Tree.mem_governs wf]

/-- A world whose keys are names, as the examples and the cross-spec model's rules read it. -/
abbrev World := WorldOf String

namespace World

theorem confidential {w : World} {n : Nat} {p k : String} (h : w.knows (n + 1) p k = true) :
    w.knows n p k = true ∨ ∃ s ∈ w.seals, s.1 = k ∧ w.knows n p s.2 = true :=
  WorldOf.confidential h

theorem keeper_blind {w : World} {keeper : String} (nothing : ∀ s ∈ w.seals, s.2 ∉ w.own keeper) :
    ∀ n, ∀ k ∈ w.knownAfter keeper n, k ∈ w.own keeper :=
  WorldOf.keeper_blind nothing

end World

/-- A segment as a keeper holds it, on Core's objects (R5): its Doc, its key epoch (named by the hash of its key blob),
and, inside the seal, its envelopes, with their writers and signers, and the sealed bytes. -/
structure Segment where
  doc : Core.DocId
  epoch : Core.Hash
  inside : List Core.Envelope
  body : Core.Bytes

/-- What a keeper sees of a segment (D13): its Doc, its key epoch and its padded length. -/
def Segment.outside (pad : Nat → Nat) (s : Segment) : Core.DocId × Core.Hash × Nat :=
  (s.doc, s.epoch, pad s.body.length)

/-- The keeper is blind to who wrote a segment and what it holds: two segments of one Doc and epoch whose lengths pad
alike look the same from outside, whatever envelopes, writers and signers they hold. -/
theorem outside_blind (pad : Nat → Nat) {s t : Segment} (d : s.doc = t.doc) (e : s.epoch = t.epoch)
    (l : pad s.body.length = pad t.body.length) : s.outside pad = t.outside pad := by
  simp [Segment.outside, d, e, l]

/-- The epochs of what `e` builds on that the reader holds: Core envelopes, named by `nm`, each under its key epoch's
number (`epochOf`). -/
def builtOn (nm : Core.Envelope → Core.Hash) (epochOf : Core.Envelope → Nat) (doc : List Core.Envelope)
    (e : Core.Envelope) : List Nat :=
  e.deps.filterMap fun d => (doc.find? (nm · == d)).map epochOf

/-- Rule 16: an envelope uses an epoch no older than any in what it builds on. -/
def freshEpoch (nm : Core.Envelope → Core.Hash) (epochOf : Core.Envelope → Nat) (doc : List Core.Envelope)
    (e : Core.Envelope) : Bool :=
  (builtOn nm epochOf doc e).all (· ≤ epochOf e)

/-- An envelope under an epoch older than one it builds on doesn't pass. -/
theorem stale_refused {nm : Core.Envelope → Core.Hash} {epochOf : Core.Envelope → Nat} {doc : List Core.Envelope}
    {e x : Core.Envelope} {d : Core.Hash} (ok : freshEpoch nm epochOf doc e = true) (dm : d ∈ e.deps)
    (found : doc.find? (nm · == d) = some x) : epochOf x ≤ epochOf e := by
  have m : epochOf x ∈ builtOn nm epochOf doc e := List.mem_filterMap.mpr ⟨d, dm, by simp [found]⟩
  simpa using (List.all_eq_true.mp ok) _ m

/-- Alice's and Bob's keys, read on one Doc (`d1`) from epoch 1. Bob is removed, and Alice's next write makes epoch 2,
sealed to Alice's vault key only, with epoch 1 behind it. -/
def removalWorld : World where
  own := fun p =>
    if p = "alice-peer" then ["alice-peer-kem"] else if p = "bob-peer-light" then ["bob-peer-light-kem"] else []
  seals := [("alice-keyring", "alice-peer-kem"), ("alice-vault", "alice-keyring"),
    ("bob-keyring", "bob-peer-light-kem"), ("bob-vault", "bob-keyring"),
    ("d1-e1", "alice-vault"), ("d1-e1", "bob-vault"), ("d1-e2", "alice-vault"), ("d1-e1", "d1-e2")]

/-- What each device learns there, written out by hand. -/
def removalExamples : List (String × String × Bool) := [
  ("alice-peer", "d1-e1", true), ("alice-peer", "d1-e2", true), ("bob-peer-light", "d1-e1", true),
  ("bob-peer-light", "d1-e2", false), ("bob-peer-light", "alice-vault", false), ("alice-peer", "bob-vault", false)]

theorem removal_examples : removalExamples.all (fun (p, k, b) => removalWorld.learns p k == b) = true := by decide

/-- Alice loses her Peer-Light and heals: a new device key for her Peer, a new keyring and vault key, her group `g`
and its Doc `d1` at their next epochs, each new one keeping the old behind it. -/
def healWorld : World where
  own := fun p =>
    if p = "alice-peer" then ["alice-peer-kem", "alice-peer-kem-2"]
    else if p = "alice-peer-light" then ["alice-peer-light-kem"] else []
  seals := [("alice-keyring", "alice-peer-kem"), ("alice-keyring", "alice-peer-light-kem"),
    ("alice-vault", "alice-keyring"), ("g-e1", "alice-vault"), ("d1-e1", "g-e1"),
    ("alice-keyring-2", "alice-peer-kem-2"), ("alice-vault-2", "alice-keyring-2"), ("g-e2", "alice-vault-2"),
    ("d1-e2", "g-e2"), ("alice-keyring", "alice-keyring-2"), ("g-e1", "g-e2"), ("d1-e1", "d1-e2")]

def healFresh : List String := ["alice-keyring-2", "alice-vault-2", "g-e2", "d1-e2"]

def healExamples : List (String × String × Bool) := [
  ("alice-peer-light", "d1-e1", true), ("alice-peer-light", "g-e1", true),
  ("alice-peer-light", "alice-keyring-2", false), ("alice-peer-light", "alice-vault-2", false),
  ("alice-peer-light", "g-e2", false), ("alice-peer-light", "d1-e2", false),
  ("alice-peer", "d1-e2", true), ("alice-peer", "d1-e1", true)]

theorem heal_examples : healExamples.all (fun (p, k, b) => healWorld.learns p k == b) = true := by decide

/-- The heal's own hypotheses hold for Alice's, so `heal_evicts` covers every number of steps, not only the
example's. -/
theorem heal_world_evicts : ∀ n k, k ∈ healFresh → healWorld.knows n "alice-peer-light" k = false :=
  WorldOf.heal_evicts (devices := ["alice-peer-kem-2"]) (by decide) (by decide) (by decide)

/-- The cast's vaults with their keys, each a kind and the vault it belongs to: its own `vault` key, its `all` group,
and its `below` group, which reads the all group of every vault it governs. Bob holds his own key and, by a grant, Maia
City's `below` group. -/
def belowWorld : WorldOf (String × String) where
  own := fun p => if p = "bob" then [("vault", "bob"), ("below", "maia-city")] else []
  seals := ["alice", "bob", "maia-city", "aven"].flatMap fun u =>
    [(("all", u), ("vault", u)), (("below", u), ("vault", u)), (("all", u), ("below", u))] ++
      (cast.governs u).map fun x => (("all", x), ("below", u))

/-- What Bob learns there, written out by hand: Maia City's Docs and those below it, and his own; nothing of Alice's,
above Maia City. -/
def belowExamples : List ((String × String) × Bool) := [
  (("all", "maia-city"), true), (("all", "aven"), true), (("all", "aven-peer"), true), (("all", "bob"), true),
  (("all", "bob-peer-light"), true), (("all", "alice"), false), (("vault", "alice"), false),
  (("below", "alice"), false), (("vault", "maia-city"), false)]

theorem below_examples : belowExamples.all (fun (k, b) => belowWorld.learns "bob" k == b) = true := by decide

theorem below_world_seals_down : WorldOf.SealsDown cast Prod.snd belowWorld := by
  have h : belowWorld.seals.all (fun s => downB cast s.2.2 s.1.2) = true := by decide
  exact fun s m => (downB_iff cast_wf).mp (List.all_eq_true.mp h s m)

/-- `authority_down` covers every number of steps, not only the example's: Bob never learns a key of Alice's vault. -/
theorem below_world_never_alice : ∀ n, ∀ k ∈ belowWorld.knownAfter "bob" n, k.2 ≠ "alice" := by
  intro n k m e
  have own : ∀ k ∈ belowWorld.own "bob", ∃ v ∈ ["bob", "maia-city"], WorldOf.Down cast v k.2 := by
    intro k m
    simp only [belowWorld, ↓reduceIte, List.mem_cons, List.not_mem_nil, or_false] at m
    rcases m with rfl | rfl
    · exact ⟨"bob", by simp, .inl rfl⟩
    · exact ⟨"maia-city", by simp, .inl rfl⟩
  obtain ⟨v, mv, d⟩ := WorldOf.authority_down below_world_seals_down own n k m
  have b := (downB_iff cast_wf).mpr d
  rw [e] at b
  simp only [List.mem_cons, List.not_mem_nil, or_false] at mv
  rcases mv with rfl | rfl <;> revert b <;> decide

end Aven.ID

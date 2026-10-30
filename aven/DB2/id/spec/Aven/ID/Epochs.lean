import Aven.ID.Caps

/-! # Epochs and what each party can know

Keys as the model knows them: names, with the cryptography taken as sound (`id/caps/README.md`, "Keys"). A party holds
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
- an envelope under an epoch older than one it builds on doesn't count (`stale_refused`, rule 16).

Examples on Alice's and Bob's keys are checked by `decide` and exported as vectors (`epochs.json`). -/

namespace Aven.ID

/-- Who holds which keys, and which keys are sealed under which: `(k, under)`. -/
structure World where
  own : String → List String
  seals : List (String × String)

namespace World

/-- One more step of opening: every key sealed under one already known. -/
def step (w : World) (known : List String) : List String :=
  known ++ ((w.seals.filter fun s => decide (s.2 ∈ known) && decide (s.1 ∉ known)).map (·.1))

/-- What `p` knows after `n` steps of opening. -/
def knownAfter (w : World) (p : String) : Nat → List String
  | 0 => w.own p
  | n + 1 => w.step (w.knownAfter p n)

def knows (w : World) (n : Nat) (p k : String) : Bool := decide (k ∈ w.knownAfter p n)

/-- What `p` learns at all: as many steps as there are seals, each opening at least one new key or none. -/
def learns (w : World) (p k : String) : Bool := w.knows w.seals.length p k

/-- `S` is closed: every key in it is sealed only under keys in it. -/
def Closed (w : World) (S : List String) : Prop := ∀ s ∈ w.seals, s.1 ∈ S → s.2 ∈ S

theorem mem_step {w : World} {known : List String} {k : String} :
    k ∈ w.step known ↔ k ∈ known ∨ ∃ s ∈ w.seals, s.2 ∈ known ∧ s.1 ∉ known ∧ s.1 = k := by
  simp [step, List.mem_filter, and_assoc]

/-- A key is learned only as one's own or by opening a seal with a key already known. -/
theorem confidential {w : World} {n : Nat} {p k : String} (h : w.knows (n + 1) p k = true) :
    w.knows n p k = true ∨ ∃ s ∈ w.seals, s.1 = k ∧ w.knows n p s.2 = true := by
  have h' : k ∈ w.step (w.knownAfter p n) := of_decide_eq_true h
  rcases mem_step.mp h' with h | ⟨s, m, known, _, e⟩
  · exact .inl (decide_eq_true h)
  · exact .inr ⟨s, m, e, decide_eq_true known⟩

/-- Keys of a closed set none of which `p` owns stay unknown to it. -/
theorem unknowable {w : World} {p : String} {S : List String} (own : ∀ k ∈ S, k ∉ w.own p) (c : w.Closed S) :
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
theorem removal_next_epoch {w : World} {removed epoch : String} {S : List String} (mem : epoch ∈ S)
    (c : w.Closed S) (own : ∀ k ∈ S, k ∉ w.own removed) : ∀ n, w.knows n removed epoch = false := by
  intro n
  simpa [knows] using fun m => unknowable own c n epoch m mem

/-- After a heal the removed device learns none of the fresh keys, provided every fresh key is sealed only under fresh
keys or the remaining devices' new keys, those device keys are sealed under nothing, and the removed device owns none
of them. Old seals may stay: they open old keys only. -/
theorem heal_evicts {w : World} {d : String} {fresh devices : List String}
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
theorem keeper_blind {w : World} {keeper : String} (nothing : ∀ s ∈ w.seals, s.2 ∉ w.own keeper) :
    ∀ n, ∀ k ∈ w.knownAfter keeper n, k ∈ w.own keeper := by
  intro n
  induction n with
  | zero => intro k m; exact m
  | succ n ih =>
    intro k m
    rcases mem_step.mp m with m | ⟨x, xm, known, _, _⟩
    · exact ih k m
    · exact absurd (ih x.2 known) (nothing x xm)

end World

/-- A segment as the keeper holds it: its Doc, its key epoch, and what the seal hides: the writer, the signer, the
bytes. -/
structure Segment where
  doc : String
  epoch : String
  writer : String
  signer : String
  body : List UInt8
  deriving DecidableEq, Repr

/-- What a keeper sees of a segment (D13): its Doc, its key epoch and its padded length. -/
def Segment.outside (pad : Nat → Nat) (s : Segment) : String × String × Nat := (s.doc, s.epoch, pad s.body.length)

/-- The keeper is blind to who wrote a segment and what it holds: two segments of one Doc and epoch whose lengths pad
alike look the same from outside, whatever their writers, signers and bytes. -/
theorem outside_blind (pad : Nat → Nat) {s t : Segment} (d : s.doc = t.doc) (e : s.epoch = t.epoch)
    (l : pad s.body.length = pad t.body.length) : s.outside pad = t.outside pad := by
  simp [Segment.outside, d, e, l]

/-- An envelope as rule 16 sees it: its id, the number of its key epoch, and what it builds on. -/
structure Keyed where
  id : String
  epoch : Nat
  deps : List String
  deriving DecidableEq, Repr

/-- The epochs of what `e` builds on that the reader holds. -/
def builtOn (doc : List Keyed) (e : Keyed) : List Nat :=
  e.deps.filterMap fun d => (doc.find? (·.id == d)).map (·.epoch)

/-- Rule 16: an envelope uses an epoch no older than any in what it builds on. -/
def freshEpoch (doc : List Keyed) (e : Keyed) : Bool := (builtOn doc e).all (· ≤ e.epoch)

/-- An envelope under an epoch older than one it builds on doesn't pass. -/
theorem stale_refused {doc : List Keyed} {e x : Keyed} {d : String} (ok : freshEpoch doc e = true)
    (dm : d ∈ e.deps) (found : doc.find? (·.id == d) = some x) : x.epoch ≤ e.epoch := by
  have m : x.epoch ∈ builtOn doc e := List.mem_filterMap.mpr ⟨d, dm, by simp [found]⟩
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
  World.heal_evicts (devices := ["alice-peer-kem-2"]) (by decide) (by decide) (by decide)

end Aven.ID

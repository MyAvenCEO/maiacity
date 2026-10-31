import Aven.Core

/-! # History: what a peer says of itself, signed, never a peer's word (A193, A194, A197; PEERS.md §6 and §7)

What peers tell each other about themselves travels as history entries, each signed by the one it is about, so who
passed it on never matters:

- **address:** how to reach a device: its home relay and direct addresses;
- **release:** a release's version, its wire version and the hashes of what it ships, signed by a release signer
  (A15), about its release line.

What an entry says is opaque here, named by its hash as a number (`body`): only which entry is newest matters to the
rules. Its body is a map with exactly one key, naming what it is (`Says.value`, A194), so an entry of one is never read
as the other. There are no log-tip entries: a reader learns a Doc's tips from `doc_tips` (A197).

**History is a Core log** (A193, A31, A42). Each entry is a Core envelope (`Aven.Core.Envelope`) in its signer's own
history log: the docs layer derives the log's writer id from the signer and a generation, so each generation is a log
of its own, and a reader knows whose log a Doc and writer id are (`Logs.owner`). The entry's place in it is its
sequence number, and it names the entry before it (`chained`). It counts by Core's one counting rule
(`Aven.Core.Counts`, A45), with this layer's verdicts: it is `fit` when its body is one of the two shapes in its
signer's history log, and `authorized` when it is the signer's to give (`takes`: a device about itself, admitted by the
door; a release by a release signer) and the entry is chained. The newest is the counting entry of the latest
generation at the latest place. Its signature was checked as it came (`Aven.Core.Envelope.placed`): a reader holds no
other.

Two different entries at one place are a split (`Aven.Core.Split`), and a split is final (A4): nothing at or after it
in that log counts, for any reader, however much more it learns (`split_final`), since every entry after it is chained
back through that place. A split ends one generation, not the device: a log's first entry counts whatever other logs
hold (`split_spares_next`), so a device that split re-homes in a new generation (`rehome_new_generation`).

**Presence is a beat** (`Beat`, A35): it decides nothing, and the latest counter is all that matters; a peer ages a
beat by its own clock (`Aven.Peer.CatchUp.present`). A member's tree tips are no entry and no beat: the register is a
Doc, and its tips travel as any Doc's do (`doc_tips`).

The theorems:
- `newest_set`: which entry is newest depends only on the set of entries a peer holds, not their order;
- `newest_signed`: the newest entry about a device was signed by that device (a release's by a release signer), so no
  peer's word stands in for it;
- `newest_agree`: two entries that are both newest are at the same place and say the same thing;
- `split_final`: once a peer holds a split in a log, nothing at or after it there is ever counted;
- `split_spares_next`: a log's first entry counts while nothing splits it, whatever other generations hold;
- `newest_grows`: holding more entries never makes the newest one older, while what was newest still counts;
- `rehome_newest`, `rehome_new_generation`: a device that re-homes, at the next place of its log or in a new
  generation, has its new address taken as newest (`Aven.ID.Node`);
- `beat_newest_set`, `beat_newest_signed`: the same of beats. -/

namespace Aven.Peer
namespace History

open Aven.Core

/-! ## Entries -/

/-- What an entry says: one of two, each by the hash of what it says. -/
inductive Says where
  | address (body : Nat)
  /-- about a release line -/
  | release (line : String) (body : Nat)
  deriving DecidableEq, Repr

/-- Which of the two an entry is: the one key of its body. -/
inductive Which where
  | address
  | release
  deriving DecidableEq, Repr

def Which.key : Which → String
  | .address => "address"
  | .release => "release"

def Says.which : Says → Which
  | .address _ => .address
  | .release _ _ => .release

def Says.body : Says → Nat
  | .address n | .release _ n => n

private def k (s : String) : Bytes := text s

/-- An entry's body: a map with exactly one key, naming what it is (A194); a release's value also names its line. -/
def Says.value : Says → Value
  | .address n => .map [(k "address", .uint n)]
  | .release l n => .map [(k "release", .map [(k "body", .uint n), (k "about", .text (text l))])]

#guard keysSorted [(k "body", Value.uint 0), (k "about", .text [])]

def str? (b : Bytes) : Option String := String.fromUTF8? ⟨b.toArray⟩

/-- An entry's body read back: exactly its keys, none missing and none extra (A42). -/
def Says.read? : Value → Option Says
  | .map [(key, v)] =>
    if key = k "address" then match v with | .uint n => some (.address n) | _ => none
    else if key = k "release" then match v with
      | .map [(kb, .uint n), (ka, .text l)] =>
        if kb = k "body" ∧ ka = k "about" then (str? l).map (.release · n) else none
      | _ => none
    else none
  | _ => none

theorem str_text (s : String) : str? (text s) = some s := fromUTF8_text s

theorem release_ne_address : k "release" ≠ k "address" := by decide +kernel

/-- **`read_value`:** an entry's body reads back as what it says. -/
theorem read_value (s : Says) : Says.read? s.value = some s := by
  cases s <;>
    simp [Says.value, Says.read?, str_text, release_ne_address]

/-- Where history lives: whose history log a Doc and a writer id are, and which generation of it, as the docs layer
derives a writer id from the signer's key, the Doc, the branch and the generation. -/
structure Logs where
  owner : DocId → Nat → Option (String × Nat)

/-- What a reader of history needs: where it lives, how envelopes are named, whom the door admits and who signs
releases. -/
structure Reader where
  logs : Logs
  nm : Envelope → Hash
  admits : String → Bool
  releasers : String → Bool

/-- A history entry as a reader reads it: what it says, who signed it, and the generation of its log. -/
structure Entry where
  says : Says
  signer : String
  generation : Nat
  deriving DecidableEq, Repr

/-- What an entry is about: a release's line, or else its signer. -/
def Entry.about (n : Entry) : String :=
  match n.says with
  | .release l _ => l
  | _ => n.signer

variable (R : Reader)

/-- The entry an envelope is, when it is one: in a signer's history log, on no branch, building on nothing but the
entry before it, and saying one of the two. -/
def entryOf (e : Envelope) : Option Entry :=
  match R.logs.owner e.doc e.writer, Says.read? e.body with
  | some (s, g), some w => if e.branch = [] ∧ e.deps = [] then some ⟨w, s, g⟩ else none
  | _, _ => none

/-- An entry the reader takes: a release signed by a release signer, or any other signed by a device the door admits,
about itself. -/
def takes (n : Entry) : Bool :=
  match n.says with
  | .release _ _ => R.releasers n.signer
  | _ => R.admits n.signer

/-- An entry is chained among `S`: the first of its log names nothing before it, and every other names the entry of
its log at the place before its own. -/
def chained (S : List Envelope) (e : Envelope) : Bool :=
  match e.prev with
  | none => e.seq == 1
  | some h => S.any fun x => R.nm x == h && decide (SameLog x e) && x.seq + 1 == e.seq

/-- Core's `fit`: the envelope is an entry of a signer's history. -/
def fit (e : Envelope) : Bool := (entryOf R e).isSome

/-- Core's `authorized`: the entry is its signer's to give, and it is chained. -/
def authorized (S : List Envelope) (e : Envelope) : Bool :=
  (match entryOf R e with | some n => takes R n | none => false) && chained R S e

/-- An entry counts by Core's one rule (`Aven.Core.Counts`, A45): its whole past is held, fit and authorized, and none
of it is half of a split. -/
def counts (S : List Envelope) (e : Envelope) : Bool := countsB R.nm (fit R) (authorized R S) S e

/-- Its place: generation, then sequence number, then what it says. -/
def place (e : Envelope) : Nat × Nat × Nat :=
  match entryOf R e with
  | some n => (n.generation, e.seq, n.says.body)
  | none => (0, 0, 0)

/-- `a` is newer than `b`: a later generation, or the same one and a later place, or the same place and a smaller
body (two entries of one log at one place are a split, and never count; of two release signers', the smaller wins). -/
def newer (a b : Envelope) : Bool :=
  let (ga, sa, ba) := place R a
  let (gb, sb, bb) := place R b
  gb < ga || (ga == gb && (sb < sa || (sa == sb && ba < bb)))

/-- The entries a reader takes of one sort about one device or release line. -/
def candidates (which : Which) (about : String) (S : List Envelope) : List Envelope :=
  S.filter fun e => match entryOf R e with
    | some n => takes R n && n.says.which == which && n.about == about
    | none => false

/-- `e` is the newest entry of its sort about what it is about among `S`: it counts, and no other one taken that counts
is newer. -/
def isNewest (S : List Envelope) (e : Envelope) : Bool :=
  match entryOf R e with
  | none => false
  | some n =>
    (candidates R n.says.which n.about S).contains e && counts R S e &&
      (candidates R n.says.which n.about S).all fun f => !(counts R S f && newer R f e)

/-- The newest entry of a sort about a device or a release line, if a peer holds any. -/
def newest (which : Which) (about : String) (S : List Envelope) : Option Envelope :=
  (candidates R which about S).find? (isNewest R S)

variable {R} {S S' : List Envelope} {e f : Envelope}

theorem mem_candidates {which : Which} {about : String} :
    e ∈ candidates R which about S ↔ e ∈ S ∧ ∃ n, entryOf R e = some n ∧ takes R n = true ∧ n.says.which = which ∧
      n.about = about := by
  simp only [candidates, List.mem_filter]
  constructor
  · rintro ⟨m, h⟩
    refine ⟨m, ?_⟩
    cases e' : entryOf R e with
    | none => simp [e'] at h
    | some n => simp only [e', Bool.and_eq_true, beq_iff_eq] at h; exact ⟨n, rfl, h.1.1, h.1.2, h.2⟩
  · rintro ⟨m, n, e', t, kk, ka⟩
    simp [m, e', t, kk, ka]

theorem isNewest_iff : isNewest R S e = true ↔ ∃ n, entryOf R e = some n ∧
    (e ∈ S ∧ takes R n = true ∧ counts R S e = true) ∧
      ∀ f ∈ S, ∀ m, entryOf R f = some m → takes R m = true → m.says.which = n.says.which → m.about = n.about →
        counts R S f = true → newer R f e = false := by
  unfold isNewest
  cases en : entryOf R e with
  | none => simp
  | some n =>
    simp only [Bool.and_eq_true, List.contains_iff_mem, mem_candidates, List.all_eq_true, Bool.not_eq_true',
      Option.some.injEq, exists_eq_left', Bool.and_eq_false_iff]
    constructor
    · rintro ⟨⟨⟨m, _, _, t, _, _⟩, c⟩, h⟩
      refine ⟨⟨m, ?_, c⟩, fun f mf m' fm tm km am cf => ?_⟩
      · simp_all
      · rcases h f ⟨mf, m', fm, tm, km, am⟩ with h | h
        · simp [cf] at h
        · exact h
    · rintro ⟨⟨m, t, c⟩, h⟩
      refine ⟨⟨⟨m, n, en, t, rfl, rfl⟩, c⟩, fun f ⟨mf, m', fm, tm, km, am⟩ => ?_⟩
      cases cf : counts R S f
      · exact .inl rfl
      · exact .inr (h f mf m' fm tm km am cf)

/-! ### Counting through Core -/

theorem counts_iff : counts R S e = true ↔
    Counts R.nm (fun x => fit R x = true) (fun x => authorized R S x = true) S e := countsB_iff

theorem chained_set (h : ∀ x, x ∈ S ↔ x ∈ S') : chained R S = chained R S' := by
  funext e
  unfold chained
  cases e.prev with
  | none => rfl
  | some p => exact Bool.eq_iff_iff.mpr (by simp only [List.any_eq_true, h])

theorem reaches_set (h : ∀ x, x ∈ S ↔ x ∈ S') (a b : Envelope) : Reaches R.nm S a b ↔ Reaches R.nm S' a b :=
  ⟨reaches_mono R.nm fun x m => (h x).mp m, reaches_mono R.nm fun x m => (h x).mpr m⟩

theorem counts_set (h : ∀ x, x ∈ S ↔ x ∈ S') : counts R S = counts R S' := by
  funext e
  apply Bool.eq_iff_iff.mpr
  simp only [counts_iff, Counts, Closed, reaches_set h, authorized, chained_set h, h]

/-- **`newest_set`:** holding the same entries, in any order, gives the same newest one. -/
theorem newest_set (h : ∀ x, x ∈ S ↔ x ∈ S') : isNewest R S = isNewest R S' := by
  funext e
  apply Bool.eq_iff_iff.mpr
  simp only [isNewest_iff, h, counts_set h]

/-- **`newest_signed`:** the newest entry about a device was signed by it, which the door admits; a release's by a
release signer. -/
theorem newest_signed (h : isNewest R S e = true) : ∃ n, entryOf R e = some n ∧
    ((n.says.which = .release ∧ R.releasers n.signer = true) ∨
      (n.says.which ≠ .release ∧ n.about = n.signer ∧ R.admits n.signer = true)) := by
  obtain ⟨n, en, ⟨_, t, _⟩, _⟩ := isNewest_iff.mp h
  refine ⟨n, en, ?_⟩
  unfold takes at t
  obtain ⟨s, sg, g⟩ := n
  cases s <;> simp_all [Entry.about, Says.which]

/-- **`newest_agree`:** two newest entries of one sort about one thing are at the same place and say the same thing. -/
theorem newest_agree (h : isNewest R S e = true) (h' : isNewest R S f = true) {n m : Entry}
    (en : entryOf R e = some n) (fm : entryOf R f = some m) (kk : m.says.which = n.says.which)
    (ka : m.about = n.about) : place R e = place R f := by
  obtain ⟨n₀, en₀, ⟨me, te, ce⟩, ne⟩ := isNewest_iff.mp h
  obtain ⟨m₀, fm₀, ⟨mf, tf, cf⟩, nf⟩ := isNewest_iff.mp h'
  rw [en] at en₀; rw [fm] at fm₀
  cases en₀; cases fm₀
  have n₁ := ne f mf m fm tf kk ka cf
  have n₂ := nf e me n en te kk.symm ka.symm ce
  unfold newer at n₁ n₂
  obtain ⟨g, s, b⟩ := place R e
  obtain ⟨g', s', b'⟩ := place R f
  simp only [Bool.or_eq_false_iff, decide_eq_false_iff_not, Bool.and_eq_false_iff, beq_eq_false_iff_ne,
    ne_eq] at n₁ n₂
  simp only [Prod.mk.injEq]
  omega

/-- **`newest_grows`:** an entry newest among more entries is at no earlier place than one newest among fewer, while
the one newest among fewer still counts among more: a split arriving later is the only thing that takes it back (A4). -/
theorem newest_grows (sub : ∀ x ∈ S, x ∈ S') (h : isNewest R S e = true) (still : counts R S' e = true)
    (h' : isNewest R S' f = true) {n m : Entry} (en : entryOf R e = some n) (fm : entryOf R f = some m)
    (kk : m.says.which = n.says.which) (ka : m.about = n.about) :
    (place R e).1 < (place R f).1 ∨ ((place R e).1 = (place R f).1 ∧ (place R e).2.1 ≤ (place R f).2.1) := by
  obtain ⟨n₀, en₀, ⟨me, te, _⟩, _⟩ := isNewest_iff.mp h
  obtain ⟨m₀, fm₀, _, nf⟩ := isNewest_iff.mp h'
  rw [en] at en₀; rw [fm] at fm₀
  cases en₀; cases fm₀
  have n₁ := nf e (sub e me) n en te kk.symm ka.symm still
  unfold newer at n₁
  obtain ⟨g, s, b⟩ := place R e
  obtain ⟨g', s', b'⟩ := place R f
  simp only [Bool.or_eq_false_iff, decide_eq_false_iff_not, Bool.and_eq_false_iff, beq_eq_false_iff_ne,
    ne_eq] at n₁
  omega

/-! ### Splits -/

/-- An entry that counts reaches, in its own log, an entry at every earlier place down to the first: each one names
the one before it, which the reader holds. -/
theorem counts_reaches_place (c : Counts R.nm (fun x => fit R x = true) (fun x => authorized R S x = true) S e) :
    ∀ d j, j + d = e.seq → 1 ≤ j → ∃ x, Reaches R.nm S e x ∧ SameLog x e ∧ x.seq = j := by
  intro d
  induction d with
  | zero => intro j hj _; exact ⟨e, .refl _, ⟨rfl, rfl, rfl⟩, by omega⟩
  | succ d ih =>
    intro j hj one
    obtain ⟨x, rx, lx, sx⟩ := ih (j + 1) (by omega) (by omega)
    have ax : authorized R S x = true := (c.2 x rx).1.2
    simp only [authorized, Bool.and_eq_true] at ax
    have ch := ax.2
    unfold chained at ch
    cases px : x.prev with
    | none => rw [px] at ch; simp at ch; omega
    | some p =>
      rw [px] at ch
      simp only [List.any_eq_true, Bool.and_eq_true, beq_iff_eq, decide_eq_true_eq] at ch
      obtain ⟨y, my, ⟨⟨ny, ly⟩, sy⟩⟩ := ch
      refine ⟨y, reaches_trans R.nm rx (.step my (.inl (by rw [px, ny])) (.refl _)), ?_, by omega⟩
      exact ⟨ly.1.trans lx.1, ly.2.1.trans lx.2.1, ly.2.2.trans lx.2.2⟩

/-- **`split_final`:** two different entries at one place of a log, held by a peer: no entry of that log at or after
that place ever counts for it, however many more entries it learns (A4). A log's places start at 1 (`chained`). -/
theorem split_final {s t : Envelope} (ms : s ∈ S) (mt : t ∈ S) (sp : Split R.nm s t) (sub : ∀ x ∈ S, x ∈ S')
    (one : 1 ≤ s.seq) (log : SameLog e s) (late : s.seq ≤ e.seq) : counts R S' e = false := by
  cases ce : counts R S' e
  · rfl
  · exfalso
    have c := counts_iff.mp ce
    obtain ⟨x, rx, lx, sx⟩ := counts_reaches_place c (e.seq - s.seq) s.seq (by omega) one
    have lxs : SameLog x s := ⟨lx.1.trans log.1, lx.2.1.trans log.2.1, lx.2.2.trans log.2.2⟩
    have nsplit := (c.2 x rx).2
    by_cases q : R.nm x = R.nm s
    · exact nsplit t (sub t mt) ⟨⟨lxs.1.trans sp.1.1, lxs.2.1.trans sp.1.2.1, lxs.2.2.trans sp.1.2.2⟩,
        sx.trans sp.2.1, fun r => sp.2.2 (q.symm.trans r)⟩
    · exact nsplit s (sub s ms) ⟨lxs, sx, q⟩

/-- An entry that names nothing reaches only itself. -/
theorem reaches_root (np : e.prev = none) (nd : e.deps = []) {x : Envelope} (h : Reaches R.nm S e x) : x = e := by
  cases h with
  | refl => rfl
  | step _ hb _ => rcases hb with hb | hb <;> simp_all

theorem entryOf_deps {n : Entry} (h : entryOf R e = some n) : e.deps = [] := by
  unfold entryOf at h
  split at h
  · split at h
    · rename_i c; exact c.2
    · cases h
  · cases h

/-- **`split_spares_next`:** a log's first entry, taken and split by nothing a peer holds, counts: whatever other logs
hold, the signer's earlier generations among them. A split ends its own generation, not the device. -/
theorem split_spares_next {n : Entry} (en : entryOf R e = some n) (t : takes R n = true) (first : e.prev = none)
    (one : e.seq = 1) (alone : ∀ y ∈ S, ¬ Split R.nm e y) : counts R S e = true := by
  apply counts_iff.mpr
  have nd := entryOf_deps en
  refine ⟨fun x rx h hx => ?_, fun x rx => ?_⟩
  · rw [reaches_root first nd rx] at hx
    rcases hx with hx | hx <;> simp_all
  · rw [reaches_root first nd rx]
    refine ⟨⟨by simp [fit, en], ?_⟩, alone⟩
    simp [authorized, en, t, chained, first, one]

/-! ### Re-homing (`Aven.ID.Node`) -/

theorem not_newer_older {a b : Envelope} {n m : Entry} (ea : entryOf R a = some m) (eb : entryOf R b = some n)
    (h : m.generation < n.generation ∨ (m.generation = n.generation ∧ a.seq < b.seq)) : newer R a b = false := by
  simp only [newer, place, ea, eb]
  simp only [Bool.or_eq_false_iff, decide_eq_false_iff_not, Bool.and_eq_false_iff, beq_eq_false_iff_ne, ne_eq]
  omega

/-- **`rehome_new_generation`:** a device that split its log re-homes in a new generation, later than every one it
signed an address in before, and every peer takes its new address as newest: a split ends a generation, not the device
(A42). -/
theorem rehome_new_generation {b : String} {g body : Nat}
    (en : entryOf R e = some ⟨.address body, b, g⟩) (ad : R.admits b = true) (first : e.prev = none)
    (one : e.seq = 1) (alone : ∀ y ∈ S, ¬ Split R.nm e y)
    (later : ∀ f ∈ S, ∀ m, entryOf R f = some m → m.says.which = .address → m.about = b → m.generation < g) :
    isNewest R (e :: S) e = true := by
  have t : takes R ⟨.address body, b, g⟩ = true := by simp [takes, ad]
  have alone' : ∀ y ∈ e :: S, ¬ Split R.nm e y := by
    intro y my
    rcases List.mem_cons.mp my with rfl | my
    · exact fun sp => sp.2.2 rfl
    · exact alone y my
  refine isNewest_iff.mpr ⟨_, en, ⟨List.mem_cons_self .., t, split_spares_next en t first one alone'⟩, ?_⟩
  intro f mf m fm _ km am _
  rcases List.mem_cons.mp mf with rfl | mf
  · simp [newer]
  · exact not_newer_older fm en (.inl (later f mf m fm km am))

/-- With names that never collide, a closed entry's past among more entries is its past among those it was closed
in. -/
theorem reaches_closed_in (hnm : ∀ a b, R.nm a = R.nm b → a = b) {T : List Envelope} (sub : ∀ x ∈ S, x ∈ T) :
    ∀ {a c : Envelope}, Reaches R.nm T a c → Closed R.nm S a → Reaches R.nm S a c := by
  intro a c h
  induction h with
  | refl => exact fun _ => .refl _
  | @step a b c _ hab _ ih =>
    intro hc
    obtain ⟨y, my, ny⟩ := hc a (.refl _) (R.nm b) hab
    have yb := hnm y b ny
    subst yb
    have rb : Reaches R.nm S a y := .step my hab (.refl _)
    exact reaches_trans R.nm rb (ih (closed_past R.nm hc rb))

/-- Along a counting entry's past, places only fall, within its own log. -/
theorem reaches_seq_le (hnm : ∀ a b, R.nm a = R.nm b → a = b)
    (c : Counts R.nm (fun x => fit R x = true) (fun x => authorized R S x = true) S e) :
    ∀ {x}, Reaches R.nm S e x → x.seq ≤ e.seq := by
  suffices ∀ a, Reaches R.nm S e a → ∀ x, Reaches R.nm S a x → x.seq ≤ a.seq from
    fun h => this e (.refl _) _ h
  intro a ra x h
  induction h with
  | refl => exact Nat.le_refl _
  | @step a b x mb hab _ ih =>
    have ok := c.2 a ra
    have fa : fit R a = true := ok.1.1
    have aa : authorized R S a = true := ok.1.2
    obtain ⟨n, en⟩ := Option.isSome_iff_exists.mp fa
    have nd := entryOf_deps en
    have pb : a.prev = some (R.nm b) := by
      rcases hab with h | h
      · exact h
      · simp [nd] at h
    simp only [authorized, Bool.and_eq_true, chained, pb, List.any_eq_true, beq_iff_eq,
      decide_eq_true_eq] at aa
    obtain ⟨y, _, ⟨ny, _⟩, sy⟩ := aa.2
    have yb := hnm y b ny
    subst yb
    have := ih (reaches_trans R.nm ra (.step mb hab (.refl _)))
    omega

/-- **`rehome_newest`:** a device that re-homes signs an address at the next place of its own log, after an entry that
counts and after every address it signed before, and every peer takes it as newest, as long as nothing splits it
(A4, A31). Names never collide, as `Aven.Core.Envelope.name_inj` gives for well-formed envelopes under an injective
hash. -/
theorem rehome_newest (hnm : ∀ a b, R.nm a = R.nm b → a = b) {last : Envelope} {b : String} {g body : Nat}
    (en : entryOf R e = some ⟨.address body, b, g⟩) (ad : R.admits b = true) (mt : last ∈ S)
    (ct : counts R S last = true) (pt : e.prev = some (R.nm last)) (lt : SameLog last e) (st : last.seq + 1 = e.seq)
    (alone : ∀ y ∈ S, ¬ Split R.nm e y)
    (older : ∀ f ∈ S, ∀ m, entryOf R f = some m → m.says.which = .address → m.about = b →
      m.generation < g ∨ (m.generation = g ∧ f.seq < e.seq)) :
    isNewest R (e :: S) e = true := by
  have t : takes R ⟨.address body, b, g⟩ = true := by simp [takes, ad]
  have nd := entryOf_deps en
  have c := counts_iff.mp ct
  have sub : ∀ x ∈ S, x ∈ e :: S := fun x m => List.mem_cons_of_mem _ m
  -- what `e` reaches: itself, or what the last reaches among `S`
  have via : ∀ {x}, Reaches R.nm (e :: S) e x → x = e ∨ Reaches R.nm S last x := by
    intro x h
    cases h with
    | refl => exact .inl rfl
    | step _ hb r =>
      rcases hb with hb | hb
      · rw [pt] at hb
        have := hnm _ _ (Option.some.inj hb).symm
        subst this
        exact .inr (reaches_closed_in hnm sub r c.1)
      · simp [nd] at hb
  have authMono : ∀ x, authorized R S x = true → authorized R (e :: S) x = true := by
    intro x h
    simp only [authorized, Bool.and_eq_true] at h ⊢
    refine ⟨h.1, ?_⟩
    have h2 := h.2
    unfold chained at h2 ⊢
    cases x.prev with
    | none => exact h2
    | some p => simp only [List.any_cons, h2, Bool.or_true]
  have ce : counts R (e :: S) e = true := by
    apply counts_iff.mpr
    refine ⟨fun x rx p hp => ?_, fun x rx => ?_⟩
    · rcases via rx with rfl | rx
      · rw [pt] at hp
        rcases hp with hp | hp
        · exact ⟨last, sub last mt, (Option.some.inj hp).symm⟩
        · simp [nd] at hp
      · obtain ⟨y, my, ny⟩ := c.1 x rx p hp
        exact ⟨y, sub y my, ny⟩
    · rcases via rx with rfl | rx
      · refine ⟨⟨by simp [fit, en], ?_⟩, fun y my => ?_⟩
        · simp only [authorized, en, t, Bool.true_and, chained, pt, List.any_eq_true, Bool.and_eq_true,
            beq_iff_eq, decide_eq_true_eq]
          exact ⟨last, sub last mt, ⟨rfl, lt⟩, st⟩
        · rcases List.mem_cons.mp my with rfl | my
          · exact fun sp => sp.2.2 rfl
          · exact alone y my
      · have ok := c.2 x rx
        refine ⟨⟨ok.1.1, authMono x ok.1.2⟩, fun y my => ?_⟩
        rcases List.mem_cons.mp my with rfl | my
        · intro sp
          have := reaches_seq_le hnm c rx
          have := sp.2.1
          omega
        · exact ok.2 y my
  refine isNewest_iff.mpr ⟨_, en, ⟨List.mem_cons_self .., t, ce⟩, ?_⟩
  intro f mf m fm _ km am _
  rcases List.mem_cons.mp mf with rfl | mf
  · simp [newer]
  · exact not_newer_older fm en (older f mf m fm km am)

/-- `newest` finds the newest entry when there is one. -/
theorem newest_isNewest {which : Which} {about : String} (h : newest R which about S = some e) :
    isNewest R S e = true ∧ ∃ n, entryOf R e = some n ∧ n.says.which = which ∧ n.about = about := by
  have := List.find?_some h
  have m := List.mem_of_find?_eq_some h
  obtain ⟨_, n, en, _, kk, ka⟩ := mem_candidates.mp m
  exact ⟨this, n, en, kk, ka⟩

/-! ## Beats -/

/-- A presence beat: the device it is about, who signed it, its counter, and what it says, by hash. -/
structure Beat where
  about : String
  signer : String
  counter : Nat
  body : Nat
  deriving DecidableEq, Repr

/-- A beat the reader takes: signed by the device it is about, which the door admits. -/
def Beat.takes (admits : String → Bool) (b : Beat) : Bool := b.signer == b.about && admits b.signer

/-- `a` is a later beat than `b`: a larger counter, or the same one and a smaller body. -/
def Beat.newer (a b : Beat) : Bool := b.counter < a.counter || (a.counter == b.counter && a.body < b.body)

/-- `b` is the newest beat about its device among `bs`. -/
def Beat.isNewest (admits : String → Bool) (bs : List Beat) (b : Beat) : Bool :=
  bs.contains b && b.takes admits && bs.all fun c => !(c.takes admits && c.about == b.about && c.newer b)

def Beat.newest (admits : String → Bool) (about : String) (bs : List Beat) : Option Beat :=
  bs.find? fun b => b.about == about && b.isNewest admits bs

/-- **`beat_newest_set`:** holding the same beats, in any order, gives the same newest one. -/
theorem beat_newest_set {admits : String → Bool} {bs bs' : List Beat} (h : ∀ x, x ∈ bs ↔ x ∈ bs') :
    Beat.isNewest admits bs = Beat.isNewest admits bs' := by
  funext b
  apply Bool.eq_iff_iff.mpr
  simp only [Beat.isNewest, Bool.and_eq_true, List.contains_iff_mem, List.all_eq_true, h]

/-- **`beat_newest_signed`:** the newest beat about a device was signed by it, and the door admits it. -/
theorem beat_newest_signed {admits : String → Bool} {bs : List Beat} {b : Beat}
    (h : Beat.isNewest admits bs b = true) : b.signer = b.about ∧ admits b.signer = true := by
  simp only [Beat.isNewest, Beat.takes, Bool.and_eq_true, beq_iff_eq] at h
  exact h.1.2

/-! ## Examples -/

namespace Examples

/-- Each signer's history Doc is named by the signer here, and its writer id is its generation. -/
def logs : Logs := ⟨fun d w => (str? d.hash.bytes).map (·, w)⟩
def admitted (s : String) : Bool := s == "alice-peer" || s == "bob-peer"
def releaseSigners (s : String) : Bool := s == "release-signer"

/-- An entry of `signer`'s history: its generation, its place, the name of the entry before it, and what it says. -/
def entry (signer : String) (generation seq : Nat) (prev : Option Envelope) (says : Says) : Envelope :=
  { doc := ⟨⟨text signer⟩⟩, branch := [], writer := generation, seq, prev := prev.map (·.name blake3),
    deps := [], body := says.value, sigs := [] }

-- Alice's Peer: two addresses, then a split at place 3 (two more); after it, an address chained to one half and one
-- that skips the split by naming place 2: neither counts, so its address is its second (A4)
def a1 := entry "alice-peer" 0 1 none (.address 10)
def a2 := entry "alice-peer" 0 2 (some a1) (.address 22)
def a3 := entry "alice-peer" 0 3 (some a2) (.address 30)
def a3' := entry "alice-peer" 0 3 (some a2) (.address 20)
def a4 := entry "alice-peer" 0 4 (some a3) (.address 40)
def a4skip := entry "alice-peer" 0 4 (some a2) (.address 41)
-- the Aven Peer's own address, in its own log, and nothing it says about Alice
def v1 := entry "aven-peer" 0 1 none (.address 90)
-- Bob's Peer split its first generation and re-homed in its second: the second's address counts (A42); there it
-- split again at place 3, which leaves the address before it
def b1 := entry "bob-peer" 0 1 none (.address 12)
def b2 := entry "bob-peer" 0 2 (some b1) (.address 21)
def b2' := entry "bob-peer" 0 2 (some b1) (.address 22)
def c1 := entry "bob-peer" 1 1 none (.address 100)
def c2 := entry "bob-peer" 1 2 (some c1) (.address 33)
def c3 := entry "bob-peer" 1 3 (some c2) (.address 44)
def c3' := entry "bob-peer" 1 3 (some c2) (.address 45)
-- a release by the release signer, and one Bob's Peer signed: not a release signer's
def r1 := entry "release-signer" 0 1 none (.release "aven" 202)
def d1 := entry "bob-peer" 2 1 none (.release "aven" 505)
-- an entry whose entry before it the peer doesn't hold: it waits (rule 11)
def e2 := entry "bob-peer" 3 2 (some (entry "bob-peer" 3 1 none (.address 7))) (.address 8)
-- Alice's Peer re-homed in a new generation
def a5 := entry "alice-peer" 1 1 none (.address 50)

def entries : List Envelope := [a1, a2, a3, a3', a4, a4skip, v1, b1, b2, b2', c1, c2, c3, c3', r1, d1, e2]

/-- The names, worked out once: BLAKE3 in Lean is slow, and counting asks for a name many times. -/
def names : List (Envelope × Hash) := (a5 :: entries).map fun e => (e, e.name blake3)

def nm (e : Envelope) : Hash :=
  match names.find? (·.1 == e) with
  | some p => p.2
  | none => e.name blake3

def reader : Reader := ⟨logs, nm, admitted, releaseSigners⟩

#guard newest reader .address "alice-peer" entries == some a2
#guard newest reader .address "alice-peer" entries.reverse == some a2
#guard newest reader .address "bob-peer" entries == some c2
#guard newest reader .release "aven" entries == some r1
#guard newest reader .address "aven-peer" entries == none
#guard !counts reader entries a4 && !counts reader entries a4skip && !counts reader entries e2
#guard counts reader entries b1 && !counts reader entries b2
#guard newest reader .address "alice-peer" (a5 :: entries) == some a5

def beats : List Beat :=
  [⟨"mallory-peer", "mallory-peer", 5, 1⟩, ⟨"bob-peer", "bob-peer", 7, 1⟩, ⟨"bob-peer", "bob-peer", 6, 1⟩,
   ⟨"bob-peer", "aven-peer", 9, 1⟩]

#guard Beat.newest admitted "bob-peer" beats == some ⟨"bob-peer", "bob-peer", 7, 1⟩
#guard Beat.newest admitted "mallory-peer" beats == none

end Examples

end History
end Aven.Peer

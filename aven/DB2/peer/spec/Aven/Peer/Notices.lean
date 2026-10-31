import Aven.Core

/-! # Notices: what a peer says of itself, signed, never a peer's word (A193; PEERS.md §6 and §7)

What peers tell each other about themselves travels as notices, each signed by the one it is about, so who passed it
on never matters:

- **address:** how to reach a device: its home relay and direct addresses;
- **log tip:** the newest post of a device's own log, by hash and number;
- **release:** a release's version, its wire version and the hashes of what it ships, signed by a release signer
  (A15);
- **presence:** a device's beat while it is there;
- **tree tip:** the tree statements a member device holds, by their names.

What a notice says is opaque here, named by its hash as a number (`body`): only which notice is newest matters to the
rules. Each kind signs under a label of its own (`Kind.label`), so a notice of one kind is never read as another's.

**History is a Core log** (A193, A31, A42). An address, a log tip or a release notice is an entry in its signer's own
notices log: a Core envelope (`Aven.Core.Envelope`) in the signer's notices Doc, whose writer id the docs layer derives
from the signer and a generation (`Logs`), so each generation is a log of its own. The entry's place in it is its
sequence number, and it names the entry before it (`chained`). It counts by Core's one counting rule
(`Aven.Core.Counts`, A45), with this layer's verdicts: it is `fit` when it carries a notice at its signer's log, and
`authorized` when the notice is the signer's to give (`takes`: a device about itself, admitted by the door; a release
by a release signer) and the entry is chained. The newest is the counting entry of the latest generation at the
latest place. Its signature was checked as it came (`Aven.Core.Envelope.placed`): a reader holds no other.

Two different entries at one place are a split (`Aven.Core.Split`), and a split is final (A4): nothing at or after it
in that log counts, for any reader, however much more it learns (`split_final`), since every entry after it is chained
back through that place. A split ends one generation, not the device: a log's first entry counts whatever other logs
hold (`split_spares_next`), so a device that split re-homes in a new generation (`rehome_new_generation`).

**Presence and tree tips are beats** (`Beat`): they decide nothing, and the latest counter is all that matters; a peer
ages a beat by its own clock (`Aven.Peer.CatchUp.present`).

The theorems:
- `newest_set`: which notice is newest depends only on the set of entries a peer holds, not their order;
- `newest_signed`: the newest notice about a device was signed by that device (a release's by a release signer), so
  no peer's word stands in for it;
- `newest_agree`: two notices that are both newest say the same thing, at the same place;
- `split_final`: once a peer holds a split in a log, nothing at or after it there is ever counted;
- `split_spares_next`: a log's first entry counts while nothing splits it, whatever other generations hold;
- `newest_grows`: holding more entries never makes the newest one older, while what was newest still counts;
- `rehome_newest`, `rehome_new_generation`: a device that re-homes, at the next place of its log or in a new
  generation, has its new address taken as newest (`Aven.ID.Node`);
- `beat_newest_set`, `beat_newest_signed`: the same of beats. -/

namespace Aven.Peer
namespace Notices

open Aven.Core

/-! ## Notices -/

/-- The three kinds of history: each an entry in its signer's notices log. -/
inductive Kind where
  | address
  | logTip
  | release
  deriving DecidableEq, Repr

/-- The label each kind signs under. -/
def Kind.label : Kind → String
  | .address => "aven/peer/address/1"
  | .logTip => "aven/peer/log-tip/1"
  | .release => "aven/peer/release/1"

def Kind.name : Kind → String
  | .address => "address"
  | .logTip => "logTip"
  | .release => "release"

def Kind.ofLabel? (s : String) : Option Kind :=
  if s = Kind.address.label then some .address
  else if s = Kind.logTip.label then some .logTip
  else if s = Kind.release.label then some .release
  else none

theorem label_inj {a b : Kind} (h : a.label = b.label) : a = b := by
  cases a <;> cases b <;> simp_all [Kind.label]

theorem ofLabel_label (k : Kind) : Kind.ofLabel? k.label = some k := by
  cases k <;> simp [Kind.ofLabel?, Kind.label]

/-- A notice: its kind, what it is about (a device; a release's: the name of the release line), who signed it, the
generation of the signer's log it is in, and what it says, by hash. -/
structure Notice where
  kind : Kind
  about : String
  signer : String
  generation : Nat
  body : Nat
  deriving DecidableEq, Repr

private def k (s : String) : Bytes := text s

/-- A notice as its entry's body: keys in the codec's order, shorter first. -/
def Notice.value (n : Notice) : Value :=
  .map [(k "body", .uint n.body), (k "kind", .text (text n.kind.label)), (k "about", .text (text n.about)),
    (k "signer", .text (text n.signer)), (k "generation", .uint n.generation)]

#guard keysSorted (match (Notice.mk .address "" "" 0 0).value with | .map kvs => kvs | _ => [])

def str? (b : Bytes) : Option String := String.fromUTF8? ⟨b.toArray⟩

/-- An entry's body read back as a notice: exactly its keys, none missing and none extra (A42). -/
def Notice.read? : Value → Option Notice
  | .map [(kb, .uint b), (kk, .text kd), (ka, .text a), (ks, .text s), (kg, .uint g)] =>
    if kb = k "body" ∧ kk = k "kind" ∧ ka = k "about" ∧ ks = k "signer" ∧ kg = k "generation" then do
      let kind ← Kind.ofLabel? (← str? kd)
      pure ⟨kind, ← str? a, ← str? s, g, b⟩
    else none
  | _ => none

theorem str_text (s : String) : str? (text s) = some s := fromUTF8_text s

/-- **`read_value`:** a notice reads back as itself. -/
theorem read_value (n : Notice) : Notice.read? n.value = some n := by
  simp [Notice.value, Notice.read?, str_text, ofLabel_label]

/-- Where notices live: each signer's notices Doc, and the writer id of each of its generations, as the docs layer
derives it from the signer's key, the Doc, the branch and the generation. -/
structure Logs where
  doc : String → DocId
  writer : String → Nat → Nat

/-- What a reader of notices needs: where notices live, how envelopes are named, whom the door admits and who signs
releases. -/
structure Reader where
  logs : Logs
  nm : Envelope → Hash
  admits : String → Bool
  releasers : String → Bool

variable (R : Reader)

/-- The notice an entry carries, when it is one at its signer's log: in its notices Doc, on no branch, under the writer
id of its generation, building on nothing but the entry before it. -/
def noticeOf (e : Envelope) : Option Notice :=
  match Notice.read? e.body with
  | some n =>
    if e.doc = R.logs.doc n.signer ∧ e.branch = [] ∧ e.writer = R.logs.writer n.signer n.generation ∧ e.deps = []
    then some n else none
  | none => none

/-- A notice the reader takes: a release signed by a release signer, or any other kind signed by the device it is
about, which the door admits. -/
def takes (n : Notice) : Bool :=
  match n.kind with
  | .release => R.releasers n.signer
  | _ => n.signer == n.about && R.admits n.signer

/-- An entry is chained among `S`: the first of its log names nothing before it, and every other names the entry of
its log at the place before its own. -/
def chained (S : List Envelope) (e : Envelope) : Bool :=
  match e.prev with
  | none => e.seq == 1
  | some h => S.any fun x => R.nm x == h && decide (SameLog x e) && x.seq + 1 == e.seq

/-- Core's `fit`: the entry carries a notice at its signer's log. -/
def fit (e : Envelope) : Bool := (noticeOf R e).isSome

/-- Core's `authorized`: the notice is the signer's to give, and the entry is chained. -/
def authorized (S : List Envelope) (e : Envelope) : Bool :=
  (match noticeOf R e with | some n => takes R n | none => false) && chained R S e

/-- An entry counts by Core's one rule (`Aven.Core.Counts`, A45): its whole past is held, fit and authorized, and none
of it is half of a split. -/
def counts (S : List Envelope) (e : Envelope) : Bool := countsB R.nm (fit R) (authorized R S) S e

/-- Its place: generation, then sequence number, then what it says. -/
def place (e : Envelope) : Nat × Nat × Nat :=
  match noticeOf R e with
  | some n => (n.generation, e.seq, n.body)
  | none => (0, 0, 0)

/-- `a` is newer than `b`: a later generation, or the same one and a later place, or the same place and a smaller
body (two notices of one log at one place are a split, and never count; of two release signers', the smaller wins). -/
def newer (a b : Envelope) : Bool :=
  let (ga, sa, ba) := place R a
  let (gb, sb, bb) := place R b
  gb < ga || (ga == gb && (sb < sa || (sa == sb && ba < bb)))

/-- The entries a reader takes of one kind about one device. -/
def candidates (kind : Kind) (about : String) (S : List Envelope) : List Envelope :=
  S.filter fun e => match noticeOf R e with
    | some n => takes R n && n.kind == kind && n.about == about
    | none => false

/-- `e` is the newest notice of its kind about its device among `S`: it counts, and no other one taken that counts is
newer. -/
def isNewest (S : List Envelope) (e : Envelope) : Bool :=
  match noticeOf R e with
  | none => false
  | some n =>
    (candidates R n.kind n.about S).contains e && counts R S e &&
      (candidates R n.kind n.about S).all fun f => !(counts R S f && newer R f e)

/-- The newest notice of a kind about a device, if a peer holds any. -/
def newest (kind : Kind) (about : String) (S : List Envelope) : Option Envelope :=
  (candidates R kind about S).find? (isNewest R S)

variable {R} {S S' : List Envelope} {e f : Envelope}

theorem mem_candidates {kind : Kind} {about : String} :
    e ∈ candidates R kind about S ↔ e ∈ S ∧ ∃ n, noticeOf R e = some n ∧ takes R n = true ∧ n.kind = kind ∧
      n.about = about := by
  simp only [candidates, List.mem_filter]
  constructor
  · rintro ⟨m, h⟩
    refine ⟨m, ?_⟩
    cases e' : noticeOf R e with
    | none => simp [e'] at h
    | some n => simp only [e', Bool.and_eq_true, beq_iff_eq] at h; exact ⟨n, rfl, h.1.1, h.1.2, h.2⟩
  · rintro ⟨m, n, e', t, kk, ka⟩
    simp [m, e', t, kk, ka]

theorem isNewest_iff : isNewest R S e = true ↔ ∃ n, noticeOf R e = some n ∧
    (e ∈ S ∧ takes R n = true ∧ counts R S e = true) ∧
      ∀ f ∈ S, ∀ m, noticeOf R f = some m → takes R m = true → m.kind = n.kind → m.about = n.about →
        counts R S f = true → newer R f e = false := by
  unfold isNewest
  cases en : noticeOf R e with
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

/-- **`newest_signed`:** the newest notice about a device was signed by it; a release's by a release signer. -/
theorem newest_signed (h : isNewest R S e = true) : ∃ n, noticeOf R e = some n ∧
    ((n.kind = .release ∧ R.releasers n.signer = true) ∨ (n.kind ≠ .release ∧ n.signer = n.about)) := by
  obtain ⟨n, en, ⟨_, t, _⟩, _⟩ := isNewest_iff.mp h
  refine ⟨n, en, ?_⟩
  unfold takes at t
  cases kn : n.kind <;> simp_all

/-- **`newest_agree`:** two newest notices of one kind about one device say the same thing, at the same place. -/
theorem newest_agree (h : isNewest R S e = true) (h' : isNewest R S f = true) {n m : Notice}
    (en : noticeOf R e = some n) (fm : noticeOf R f = some m) (kk : m.kind = n.kind) (ka : m.about = n.about) :
    place R e = place R f := by
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

/-- **`newest_grows`:** a notice newest among more entries is at no earlier place than one newest among fewer, while
the one newest among fewer still counts among more: a split arriving later is the only thing that takes it back (A4). -/
theorem newest_grows (sub : ∀ x ∈ S, x ∈ S') (h : isNewest R S e = true) (still : counts R S' e = true)
    (h' : isNewest R S' f = true) {n m : Notice} (en : noticeOf R e = some n) (fm : noticeOf R f = some m)
    (kk : m.kind = n.kind) (ka : m.about = n.about) :
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
    have ax := ((c.2 x rx).1.2 : authorized R S x = true)
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

theorem noticeOf_deps {n : Notice} (h : noticeOf R e = some n) : e.deps = [] := by
  unfold noticeOf at h
  split at h
  · split at h
    · rename_i c; exact c.2.2.2
    · cases h
  · cases h

/-- **`split_spares_next`:** a log's first entry, taken and split by nothing a peer holds, counts: whatever other logs
hold, the signer's earlier generations among them. A split ends its own generation, not the device. -/
theorem split_spares_next {n : Notice} (en : noticeOf R e = some n) (t : takes R n = true) (first : e.prev = none)
    (one : e.seq = 1) (alone : ∀ y ∈ S, ¬ Split R.nm e y) : counts R S e = true := by
  apply counts_iff.mpr
  have nd := noticeOf_deps en
  refine ⟨fun x rx h hx => ?_, fun x rx => ?_⟩
  · rw [reaches_root first nd rx] at hx
    rcases hx with hx | hx <;> simp_all
  · rw [reaches_root first nd rx]
    refine ⟨⟨by simp [fit, en], ?_⟩, alone⟩
    simp [authorized, en, t, chained, first, one]

/-! ### Re-homing (`Aven.ID.Node`) -/

/-- **`rehome_new_generation`:** a device that split its log re-homes in a new generation, later than every one it
signed an address in before, and every peer takes its new address as newest: a split ends a generation, not the device
(A42). -/
theorem rehome_new_generation {b : String} {g body : Nat}
    (en : noticeOf R e = some ⟨.address, b, b, g, body⟩) (ad : R.admits b = true) (first : e.prev = none)
    (one : e.seq = 1) (alone : ∀ y ∈ S, ¬ Split R.nm e y)
    (later : ∀ f ∈ S, ∀ m, noticeOf R f = some m → m.kind = .address → m.about = b → m.generation < g) :
    isNewest R (e :: S) e = true := by
  have t : takes R ⟨.address, b, b, g, body⟩ = true := by simp [takes, ad]
  have alone' : ∀ y ∈ e :: S, ¬ Split R.nm e y := by
    intro y my
    rcases List.mem_cons.mp my with rfl | my
    · exact fun sp => sp.2.2 rfl
    · exact alone y my
  refine isNewest_iff.mpr ⟨_, en, ⟨List.mem_cons_self .., t, split_spares_next en t first one alone'⟩, ?_⟩
  intro f mf m fm _ km am _
  rcases List.mem_cons.mp mf with rfl | mf
  · simp [newer]
  · have := later f mf m fm km am
    simp only [newer, place, fm, en]
    simp only [Bool.or_eq_false_iff, decide_eq_false_iff_not, Bool.and_eq_false_iff, beq_eq_false_iff_ne, ne_eq]
    omega

/-- With names that never collide, a closed entry's past among more entries is its past among those it was closed
in. -/
theorem reaches_closed_in (hnm : ∀ a b, R.nm a = R.nm b → a = b) {T : List Envelope} :
    ∀ {a c : Envelope}, Reaches R.nm T a c → Closed R.nm S a → (∀ x ∈ S, x ∈ T) → Reaches R.nm S a c := by
  intro a c h
  induction h with
  | refl => exact fun _ _ => .refl _
  | @step a b c _ hab _ ih =>
    intro hc _
    have hb : a.prev = some (R.nm b) ∨ R.nm b ∈ a.deps := hab
    obtain ⟨y, my, ny⟩ := hc a (.refl _) (R.nm b) hb
    have yb := hnm y b ny
    subst yb
    have rb : Reaches R.nm S a y := .step my hab (.refl _)
    exact reaches_trans R.nm rb (ih (closed_past R.nm hc rb) ‹_›)

/-- Along a counting entry's past, places only fall. -/
theorem reaches_seq_le (hnm : ∀ a b, R.nm a = R.nm b → a = b)
    (c : Counts R.nm (fun x => fit R x = true) (fun x => authorized R S x = true) S e) :
    ∀ {x}, Reaches R.nm S e x → x.seq ≤ e.seq ∧ SameLog x e := by
  intro x h
  suffices ∀ a, Reaches R.nm S e a → ∀ x, Reaches R.nm S a x → x.seq ≤ a.seq ∧ SameLog x a by
    exact this e (.refl _) x h
  intro a ra x h
  induction h with
  | refl => exact ⟨Nat.le_refl _, rfl, rfl, rfl⟩
  | @step a b x mb hab rbx ih =>
    have ok := c.2 a ra
    have fa : fit R a = true := ok.1.1
    have aa : authorized R S a = true := ok.1.2
    obtain ⟨n, en⟩ := Option.isSome_iff_exists.mp fa
    have nd := noticeOf_deps en
    have pb : a.prev = some (R.nm b) := by
      rcases hab with h | h
      · exact h
      · simp [nd] at h
    simp only [authorized, Bool.and_eq_true, chained, pb, List.any_eq_true, beq_iff_eq,
      decide_eq_true_eq] at aa
    obtain ⟨y, _, ⟨ny, ly⟩, sy⟩ := aa.2
    have yb := hnm y b ny
    subst yb
    obtain ⟨le, lx⟩ := ih (reaches_trans R.nm ra (.step mb hab (.refl _)))
    exact ⟨by omega, lx.1.trans ly.1, lx.2.1.trans ly.2.1, lx.2.2.trans ly.2.2⟩

/-- **`rehome_newest`:** a device that re-homes signs an address at the next place of its own log, after an entry that
counts and after every address it signed before, and every peer takes it as newest, as long as nothing splits it
(A4, A31). Names never collide, as `Aven.Core.Envelope.name_inj` gives for well-formed envelopes under an injective
hash. -/
theorem rehome_newest (hnm : ∀ a b, R.nm a = R.nm b → a = b) {tip : Envelope} {b : String} {g body : Nat}
    (en : noticeOf R e = some ⟨.address, b, b, g, body⟩) (ad : R.admits b = true) (mt : tip ∈ S)
    (ct : counts R S tip = true) (pt : e.prev = some (R.nm tip)) (lt : SameLog tip e) (st : tip.seq + 1 = e.seq)
    (alone : ∀ y ∈ S, ¬ Split R.nm e y)
    (older : ∀ f ∈ S, ∀ m, noticeOf R f = some m → m.kind = .address → m.about = b →
      m.generation < g ∨ (m.generation = g ∧ f.seq < e.seq)) :
    isNewest R (e :: S) e = true := by
  have t : takes R ⟨.address, b, b, g, body⟩ = true := by simp [takes, ad]
  have nd := noticeOf_deps en
  have c := counts_iff.mp ct
  have sub : ∀ x ∈ S, x ∈ e :: S := fun x m => List.mem_cons_of_mem _ m
  -- what the tip reaches among `e :: S` it reaches among `S`
  have back : ∀ {x}, Reaches R.nm (e :: S) tip x → Reaches R.nm S tip x :=
    fun h => reaches_closed_in hnm h c.1 sub
  -- what `e` reaches: itself, or what the tip reaches
  have via : ∀ {x}, Reaches R.nm (e :: S) e x → x = e ∨ Reaches R.nm S tip x := by
    intro x h
    cases h with
    | refl => exact .inl rfl
    | step _ hb r =>
      rcases hb with hb | hb
      · rw [pt] at hb
        have := hnm _ _ (Option.some.inj hb).symm
        subst this
        exact .inr (back r)
      · simp [nd] at hb
  have chainedMono : ∀ x, chained R S x = true → chained R (e :: S) x = true := by
    intro x h
    unfold chained at h ⊢
    cases x.prev with
    | none => exact h
    | some p => simp only [List.any_cons, h, Bool.or_true]
  have authMono : ∀ x, authorized R S x = true → authorized R (e :: S) x = true := by
    intro x h
    simp only [authorized, Bool.and_eq_true] at h ⊢
    exact ⟨h.1, chainedMono x h.2⟩
  have ce : counts R (e :: S) e = true := by
    apply counts_iff.mpr
    refine ⟨fun x rx p hp => ?_, fun x rx => ?_⟩
    · rcases via rx with rfl | rx
      · rw [pt] at hp
        rcases hp with hp | hp
        · exact ⟨tip, sub tip mt, (Option.some.inj hp).symm⟩
        · simp [nd] at hp
      · obtain ⟨y, my, ny⟩ := c.1 x rx p hp
        exact ⟨y, sub y my, ny⟩
    · rcases via rx with rfl | rx
      · refine ⟨⟨by simp [fit, en], ?_⟩, fun y my => ?_⟩
        · simp only [authorized, en, t, Bool.true_and, chained, pt, List.any_eq_true, Bool.and_eq_true,
            beq_iff_eq, decide_eq_true_eq]
          exact ⟨tip, sub tip mt, ⟨rfl, lt⟩, st⟩
        · rcases List.mem_cons.mp my with rfl | my
          · exact fun sp => sp.2.2 rfl
          · exact alone y my
      · have ok := c.2 x rx
        refine ⟨⟨ok.1.1, authMono x ok.1.2⟩, fun y my => ?_⟩
        rcases List.mem_cons.mp my with rfl | my
        · intro sp
          have := (reaches_seq_le hnm c rx).1
          have := sp.2.1
          omega
        · exact ok.2 y my
  refine isNewest_iff.mpr ⟨_, en, ⟨List.mem_cons_self .., t, ce⟩, ?_⟩
  intro f mf m fm _ km am _
  rcases List.mem_cons.mp mf with rfl | mf
  · simp [newer]
  · have := older f mf m fm km am
    simp only [newer, place, fm, en]
    simp only [Bool.or_eq_false_iff, decide_eq_false_iff_not, Bool.and_eq_false_iff, beq_eq_false_iff_ne, ne_eq]
    omega

/-- `newest` finds the newest notice when there is one. -/
theorem newest_isNewest {kind : Kind} {about : String} (h : newest R kind about S = some e) :
    isNewest R S e = true ∧ ∃ n, noticeOf R e = some n ∧ n.kind = kind ∧ n.about = about := by
  have := List.find?_some h
  have m := List.mem_of_find?_eq_some h
  obtain ⟨_, n, en, _, kk, ka⟩ := mem_candidates.mp m
  exact ⟨this, n, en, kk, ka⟩

/-! ## Beats -/

/-- The two kinds of beat. -/
inductive BeatKind where
  | presence
  | treeTip
  deriving DecidableEq, Repr

def BeatKind.label : BeatKind → String
  | .presence => "aven/peer/presence/1"
  | .treeTip => "aven/peer/tree-tip/1"

def BeatKind.name : BeatKind → String
  | .presence => "presence"
  | .treeTip => "treeTip"

/-- A beat: its kind, the device it is about, who signed it, its counter, and what it says, by hash. -/
structure Beat where
  kind : BeatKind
  about : String
  signer : String
  counter : Nat
  body : Nat
  deriving DecidableEq, Repr

/-- A beat the reader takes: signed by the device it is about, which the door admits. -/
def Beat.takes (admits : String → Bool) (b : Beat) : Bool := b.signer == b.about && admits b.signer

/-- `a` is a later beat than `b`: a larger counter, or the same one and a smaller body. -/
def Beat.newer (a b : Beat) : Bool := b.counter < a.counter || (a.counter == b.counter && a.body < b.body)

/-- `b` is the newest beat of its kind about its device among `bs`. -/
def Beat.isNewest (admits : String → Bool) (bs : List Beat) (b : Beat) : Bool :=
  bs.contains b && b.takes admits &&
    bs.all fun c => !(c.takes admits && c.kind == b.kind && c.about == b.about && c.newer b)

def Beat.newest (admits : String → Bool) (kind : BeatKind) (about : String) (bs : List Beat) : Option Beat :=
  bs.find? fun b => b.kind == kind && b.about == about && b.isNewest admits bs

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

def logs : Logs := ⟨fun s => ⟨blake3 (text s!"notices of {s}")⟩, fun _ g => g⟩
def nm (e : Envelope) : Hash := e.name blake3
def admitted (s : String) : Bool := s == "alice-peer" || s == "bob-peer"
def releaseSigners (s : String) : Bool := s == "release-signer"
def reader : Reader := ⟨logs, nm, admitted, releaseSigners⟩

/-- An entry of `signer`'s notices log: its generation, its place, the entry before it, and what it says. -/
def entry (signer : String) (generation seq : Nat) (prev : Option Envelope) (kind : Kind) (about : String)
    (body : Nat) : Envelope :=
  { doc := logs.doc signer, branch := [], writer := logs.writer signer generation, seq, prev := prev.map nm,
    deps := [], body := (Notice.mk kind about signer generation body).value, sigs := [] }

-- Alice's Peer: an address, a log tip, then a split at place 3 (two addresses); after it, an address chained to one
-- half and one that skips the split by naming place 2: neither counts, so its address is its first (A4)
def a1 := entry "alice-peer" 0 1 none .address "alice-peer" 10
def a2 := entry "alice-peer" 0 2 (some a1) .logTip "alice-peer" 22
def a3 := entry "alice-peer" 0 3 (some a2) .address "alice-peer" 30
def a3' := entry "alice-peer" 0 3 (some a2) .address "alice-peer" 20
def a4 := entry "alice-peer" 0 4 (some a3) .address "alice-peer" 40
def a4skip := entry "alice-peer" 0 4 (some a2) .address "alice-peer" 41
-- the Aven Peer passing on its own word about Alice: not taken
def v1 := entry "aven-peer" 0 1 none .address "alice-peer" 90
-- Bob's Peer split its first generation and re-homed in its second: the second's address counts (A42); its log
-- tips split at place 3, which leaves the tip before it
def b1 := entry "bob-peer" 0 1 none .address "bob-peer" 12
def b2 := entry "bob-peer" 0 2 (some b1) .address "bob-peer" 21
def b2' := entry "bob-peer" 0 2 (some b1) .address "bob-peer" 22
def c1 := entry "bob-peer" 1 1 none .address "bob-peer" 100
def c2 := entry "bob-peer" 1 2 (some c1) .logTip "bob-peer" 33
def c3 := entry "bob-peer" 1 3 (some c2) .logTip "bob-peer" 44
def c3' := entry "bob-peer" 1 3 (some c2) .logTip "bob-peer" 45
-- a release by the release signer, and one Bob's Peer signed: not a release signer's
def r1 := entry "release-signer" 0 1 none .release "aven" 202
def d1 := entry "bob-peer" 2 1 none .release "aven" 505
-- an entry whose entry before it the peer doesn't hold: it waits (rule 11)
def e2 := entry "bob-peer" 3 2 (some (entry "bob-peer" 3 1 none .address "bob-peer" 7)) .address "bob-peer" 8

def entries : List Envelope := [a1, a2, a3, a3', a4, a4skip, v1, b1, b2, b2', c1, c2, c3, c3', r1, d1, e2]

#guard newest reader .address "alice-peer" entries == some a1
#guard newest reader .address "alice-peer" entries.reverse == some a1
#guard newest reader .logTip "alice-peer" entries == some a2
#guard newest reader .address "bob-peer" entries == some c1
#guard newest reader .logTip "bob-peer" entries == some c2
#guard newest reader .release "aven" entries == some r1
#guard newest reader .address "aven-peer" entries == none
#guard !counts reader entries a4 && !counts reader entries a4skip && !counts reader entries e2
#guard counts reader entries b1 && !counts reader entries b2
-- once Alice's Peer re-homes in a new generation, its address is the new one
#guard newest reader .address "alice-peer" (entry "alice-peer" 1 1 none .address "alice-peer" 50 :: entries) ==
  some (entry "alice-peer" 1 1 none .address "alice-peer" 50)

def beats : List Beat :=
  [⟨.presence, "mallory-peer", "mallory-peer", 5, 1⟩, ⟨.presence, "bob-peer", "bob-peer", 7, 1⟩,
   ⟨.presence, "bob-peer", "bob-peer", 6, 1⟩, ⟨.presence, "bob-peer", "aven-peer", 9, 1⟩]

#guard Beat.newest admitted .presence "bob-peer" beats == some ⟨.presence, "bob-peer", "bob-peer", 7, 1⟩
#guard Beat.newest admitted .presence "mallory-peer" beats == none
#guard Beat.newest admitted .treeTip "bob-peer" beats == none

end Examples

end Notices
end Aven.Peer

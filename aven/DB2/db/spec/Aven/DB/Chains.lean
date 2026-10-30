import Aven.DB.Chat
import Aven.DB.Store

/-!
# The chat's chains

The chat keeps its history (`store/README.md`, "The chat keeps its history"): each device keeps a chain of its own
lines. A **line** is a blob: the network, the device, its sequence number, the hash of its previous line (none for the
first), the time and its body, signed by the device's key. A body is typed: a text, or a file (its index's hash, its
size, its name and MIME type, as its sender claims), so a text can never be read as a file. Lines are plain bytes in v1. The device's ref
`chat-<device>` points at its newest line, and each device writes only its own store (README, rule 1).

Every peer keeps every chain it hears, the Aven Peer all of them. It checks a line as the chat checks a message (the
network, a device the door admits, its signature, its body's size and form, a sequence number that starts at 1
exactly when there is no previous line), then:

- **known**: a line it holds already is kept once, by its hash;
- **fork**: another line of the same device at the same place in its chain (the same sequence number, so the same
  previous line) is a fork: a cloned device, an old backup or a stolen key. The new line is kept, not chained, and
  raised;
- **moved**: a line right on top of the device's chain (its previous line is the head, its number one more) moves
  `chat-<device>` forward to it, and so do the lines kept earlier that now fit on top, one after another;
- **gap**: any other line is kept until the lines before it arrive. Lines arrive in order on gossip, so a gap is
  usually a moment's; one still open after `gapWait` makes the peer catch up from the Aven Peer.

So `chat-<device>` only ever moves forward (`chain_suffix`), a line received twice is kept once (`receive_twice`), a
fork is raised and never chained (`fork_raised`), and a line from no member's device is dropped (`stranger_dropped`).

**Catching up:** a returning peer reads the other peer's `chat-*` refs, walks each chain back from its head to the
lines it holds (`missing`), and takes the missing lines oldest first. When its own chain of a device is the start of
the other's, it ends with exactly the other's chain (`catchUp_chain`); and when two peers catch up from each other,
both end with every line either could see (`both_see`). The lines come in bounded pages, each moving the receiver on
from where the last left it (`receiveAll_pages`). A device writes on its own chain only once it has learned its head
from the Aven Peer, so it never forks itself (`learned_never_forks`).

The model names a line by its `id`, the hash of its blob, and takes the signature as sound, as `Aven.DB.Chat` does.
aven-db-core's `chain` module implements it; its tests replay the traces in `vectors/chats.json` with real signed
blobs and their real hashes in place of the names.
-/

namespace Aven.DB.Chains

open Chat (maxText)

abbrev Id := String

/-- How long a gap may stay open, in milliseconds, before the peer catches up from the Aven Peer for the lines before
it. -/
def gapWait : Nat := 5000

/-- The longest MIME type a file line claims, in bytes. -/
def maxType : Nat := 255

/-- What a line says: a text, or a file shared in the chat. -/
inductive Body where
  | text (text : String)
  /-- a file: its index's hash (`Aven.DB.Files`), its size, its name and its MIME type -/
  | file (file : String) (size : Nat) (name : String) (type : String)
  deriving DecidableEq, Repr, Inhabited

/-- A body as the line's bytes carry it, last: its kind first, the free text (a text, a file's name) last. -/
def Body.render : Body → String
  | .text t => "text\n" ++ t
  | .file f n name type => "file " ++ f ++ "\nsize " ++ toString n ++ "\ntype " ++ type ++ "\n" ++ name

/-- A line: its name (the hash of its blob), the network, the device that wrote it, its place in the device's chain,
the name of the line before it, its time (ms), its body, and its signature as the model knows one: the key that made
it and the bytes it signed. -/
structure Line where
  id : Id
  network : String
  device : String
  seq : Nat
  prev : Option Id
  time : Nat
  body : Body
  signer : String
  signed : String
  deriving DecidableEq, Repr, Inhabited

/-- What a device signs: every field but the signature, the body last. The blob is this with the signature after its
`at` line (`sig <hex>`). -/
def Line.signs (l : Line) : String :=
  "avenDB line 1\nnetwork " ++ l.network ++ "\ndevice " ++ l.device ++ "\nseq " ++ toString l.seq ++ "\nprev " ++
    l.prev.getD "none" ++ "\nat " ++ toString l.time ++ "\n" ++ l.body.render

inductive Refusal where
  | wrongNetwork
  /-- the door doesn't admit the device -/
  | notMember
  | badSignature
  | empty
  | tooLong
  /-- not 1 for a first line, or 1 for a line with a previous one -/
  | badSeq
  /-- a file line whose hash isn't one, or whose type is empty, too long or breaks the line -/
  | badFile
  /-- a blob that isn't exactly the bytes its line renders to (`Aven.DB.Chains.read`) -/
  | notCanonical
  deriving DecidableEq, Repr

/-- A body on its own: a text or a file's name of 1 to `maxText` bytes, and a file's hash and type well formed. -/
def Body.check : Body → Except Refusal Unit
  | .text t => if t.utf8ByteSize = 0 then .error .empty else if t.utf8ByteSize > maxText then .error .tooLong else .ok ()
  | .file f _ name type =>
    if !Store.validHash f ∨ type.isEmpty ∨ type.utf8ByteSize > maxType ∨ type.contains '\n' then .error .badFile
    else if name.utf8ByteSize = 0 then .error .empty
    else if name.utf8ByteSize > maxText then .error .tooLong
    else .ok ()

/-- A line on its own. -/
def check (network : String) (members : List String) (l : Line) : Except Refusal Unit :=
  if l.network ≠ network then .error .wrongNetwork
  else if !members.contains l.device then .error .notMember
  else if l.signer ≠ l.device ∨ l.signed ≠ l.signs then .error .badSignature
  else match l.body.check with
    | .error why => .error why
    | .ok () => if l.seq = 0 ∨ (l.seq == 1) != l.prev.isNone then .error .badSeq else .ok ()

theorem check_member {network : String} {members : List String} {l : Line} (h : check network members l = .ok ()) :
    l.device ∈ members := by
  unfold check at h
  split at h; · cases h
  split at h; · cases h
  next k => simpa using k

/-- Whether `l` goes right on top of a chain, newest first. -/
def fits (c : List Line) (l : Line) : Bool :=
  match c with
  | [] => l.prev == none && l.seq == 1
  | h :: _ => l.prev == some h.id && l.seq == h.seq + 1

/-! ## A peer's chains -/

/-- What a peer keeps: each device's chain, newest first, its head the ref `chat-<device>`; the lines kept but not
chained, newest first; and the forks raised. -/
structure Keeper where
  chains : List (String × List Line) := []
  loose : List Line := []
  forks : List Id := []
  deriving DecidableEq, Repr

inductive Answer where
  /-- the chain moved forward to these lines, oldest first -/
  | moved (ids : List Id)
  | known
  | gap
  | fork
  | refused (why : Refusal)
  deriving DecidableEq, Repr

namespace Keeper

def chain (k : Keeper) (d : String) : List Line := (Store.get k.chains d).getD []

/-- Every line it holds of a device. -/
def held (k : Keeper) (d : String) : List Line := k.chain d ++ k.loose.filter (·.device == d)

/-- The lines kept earlier that now fit on top of `c`, one after another: at most `fuel` of them, the number kept
loose, since each takes one (README, rule 3). A fork is never chained. -/
def absorb (d : String) (forks : List Id) : Nat → List Line → List Line → List Id → List Line × List Line × List Id
  | 0, c, loose, moved => (c, loose, moved)
  | f + 1, c, loose, moved =>
    match loose.find? (fun m => m.device == d && fits c m && !forks.contains m.id) with
    | none => (c, loose, moved)
    | some m => absorb d forks f (m :: c) (loose.erase m) (moved ++ [m.id])

/-- A line as it arrives, and what the peer keeps after it. -/
def receive (k : Keeper) (network : String) (members : List String) (l : Line) : Answer × Keeper :=
  match check network members l with
  | .error why => (.refused why, k)
  | .ok () =>
    if (k.held l.device).contains l then (.known, k)
    else if (k.held l.device).any (·.seq == l.seq) then
      (.fork, { k with loose := l :: k.loose, forks := l.id :: k.forks })
    else if fits (k.chain l.device) l then
      let (c, loose, moved) := absorb l.device k.forks k.loose.length (l :: k.chain l.device) k.loose []
      (.moved (l.id :: moved), { k with chains := Store.set k.chains l.device c, loose := loose })
    else (.gap, { k with loose := l :: k.loose })

/-- The lines of `src` (a chain, newest first) newer than the head of `dst`: walking `src` back from its head to what
`dst` holds. -/
def missing (src dst : List Line) : List Line :=
  src.filter fun l => (dst.head?.map (·.seq)).getD 0 < l.seq

/-- Lines received one after another. -/
def receiveAll (k : Keeper) (network : String) (members : List String) (ls : List Line) : Keeper :=
  ls.foldl (fun k l => (k.receive network members l).2) k

/-- Catching up on device `d`'s chain from `src`: the missing lines, oldest first. -/
def catchUp (k src : Keeper) (network : String) (members : List String) (d : String) : Keeper :=
  k.receiveAll network members (missing (src.chain d) (k.chain d)).reverse

/-- The lines a chat shows: every line held but the forks, ordered by time, then device. -/
def shown (k : Keeper) : List Line :=
  let all := k.chains.flatMap (·.2) ++ k.loose.filter (fun l => !k.forks.contains l.id)
  let before (a b : Line) : Bool := a.time < b.time || (a.time == b.time && decide (a.device ≤ b.device))
  let rec ins (a : Line) : List Line → List Line
    | [] => [a]
    | b :: l => if before a b then a :: b :: l else b :: ins a l
  all.foldr ins []

end Keeper

/-! ## Theorems -/

namespace Keeper

variable {k : Keeper} {network : String} {members : List String} {l : Line}

theorem absorb_suffix (d : String) (forks : List Id) :
    ∀ f c loose moved, c <:+ (absorb d forks f c loose moved).1
  | 0, c, loose, moved => List.suffix_refl c
  | f + 1, c, loose, moved => by
    unfold absorb
    split
    · exact List.suffix_refl c
    · next m _ => exact (List.suffix_cons m c).trans (absorb_suffix d forks f _ _ _)

theorem chain_set_self (k : Keeper) (d : String) (c : List Line) (loose : List Line) :
    ({ k with chains := Store.set k.chains d c, loose := loose } : Keeper).chain d = c := by
  simp [chain]

theorem chain_set_ne (k : Keeper) {d e : String} (c : List Line) (loose : List Line) (h : d ≠ e) :
    ({ k with chains := Store.set k.chains d c, loose := loose } : Keeper).chain e = k.chain e := by
  simp [chain, Store.get_set_ne _ _ h]

/-- **Forward only:** every device's chain after a line arrives starts with its chain before. -/
theorem chain_suffix (d : String) : k.chain d <:+ (k.receive network members l).2.chain d := by
  unfold receive
  split
  · exact List.suffix_refl _
  · split
    · exact List.suffix_refl _
    split
    · exact List.suffix_refl _
    split
    · by_cases e : l.device = d
      · subst e
        rw [chain_set_self]
        exact (List.suffix_cons l _).trans (absorb_suffix _ _ _ _ _ _)
      · rw [chain_set_ne _ _ _ e]
        exact List.suffix_refl _
    · exact List.suffix_refl _

/-- A line taken is held: in its device's chain, or kept loose. -/
theorem held_after (hc : check network members l = .ok ()) : l ∈ (k.receive network members l).2.held l.device := by
  unfold receive
  rw [hc]
  simp only
  split
  · next h => simpa using h
  split
  · simp [held]
  split
  · rw [held, chain_set_self]
    exact List.mem_append_left _ ((absorb_suffix _ _ _ _ _ _).mem (List.mem_cons_self ..))
  · simp [held]

/-- **A line received twice is kept once:** the second time it is known, and nothing changes. -/
theorem receive_known (hc : check network members l = .ok ()) (h : l ∈ k.held l.device) :
    k.receive network members l = (.known, k) := by
  unfold receive
  rw [hc]
  simp only
  rw [ite_eq_left (List.contains_iff_mem.mpr h)]

theorem receive_twice (hc : check network members l = .ok ()) :
    ((k.receive network members l).2.receive network members l) = (.known, (k.receive network members l).2) :=
  receive_known hc (held_after hc)

/-- **A fork is raised:** a line of a device at a place in its chain where the peer holds another line is kept, not
chained, and raised; no chain changes. -/
theorem fork_raised (hc : check network members l = .ok ()) (hn : l ∉ k.held l.device)
    (hs : ∃ m ∈ k.held l.device, m.seq = l.seq) :
    k.receive network members l = (.fork, { k with loose := l :: k.loose, forks := l.id :: k.forks }) := by
  unfold receive
  rw [hc]
  simp only
  rw [ite_eq_right (by simpa using hn), ite_eq_left (by obtain ⟨m, mm, e⟩ := hs; exact List.any_eq_true.mpr ⟨m, mm, by simp [e]⟩)]

/-- **A stranger's line is dropped:** a line of a device the door doesn't admit changes nothing. -/
theorem stranger_dropped (h : l.device ∉ members) : (k.receive network members l).2 = k := by
  unfold receive
  split
  · rfl
  · next e => exact absurd (check_member e) h

/-! ## Catching up -/

/-- A chain, newest first: each line right on top of the ones before it. -/
def Valid : List Line → Prop
  | [] => True
  | l :: c => fits c l = true ∧ Valid c

theorem Valid.tail {l : Line} {c : List Line} (h : Valid (l :: c)) : Valid c := h.2

theorem Valid.seq_pos {l : Line} {c : List Line} (h : Valid (l :: c)) : 0 < l.seq := by
  have f := h.1
  cases c with
  | nil => simp [fits] at f; omega
  | cons x _ => simp [fits] at f; omega

/-- In a chain, every line below another has a smaller number. -/
theorem Valid.below : ∀ {l : Line} {c : List Line}, Valid (l :: c) → ∀ x ∈ c, x.seq < l.seq
  | _, [], _ => by simp
  | l, x :: c, h => by
    have f := h.1
    simp only [fits, Bool.and_eq_true, beq_iff_eq] at f
    intro y my
    rcases List.mem_cons.mp my with rfl | my
    · omega
    · have := Valid.below h.2 y my; omega

theorem Valid.append_right : ∀ {p c : List Line}, Valid (p ++ c) → Valid c
  | [], _, h => h
  | _ :: p, _, h => Valid.append_right (p := p) h.2

/-- The lines of a chain's start are all above every line of its rest. -/
theorem Valid.above : ∀ {p c : List Line}, Valid (p ++ c) → ∀ m ∈ p, ∀ x ∈ c, x.seq < m.seq
  | [], _, _ => by simp
  | m :: p, c, h => by
    intro y my x mx
    rcases List.mem_cons.mp my with rfl | my
    · exact Valid.below h x (List.mem_append_right _ mx)
    · exact Valid.above (p := p) h.2 y my x mx

/-- What `dst` misses of `src`, when `dst` is the start of `src`, is the rest of `src`. -/
theorem missing_append {p c : List Line} (h : Valid (p ++ c)) : missing (p ++ c) c = p := by
  unfold missing
  rw [List.filter_append]
  have hc : Valid c := h.append_right
  have low : c.filter (fun l => (c.head?.map (·.seq)).getD 0 < l.seq) = [] := by
    cases c with
    | nil => rfl
    | cons x c =>
      rw [List.filter_eq_nil_iff]
      intro y my
      rcases List.mem_cons.mp my with rfl | my
      · simp
      · have := Valid.below hc y my
        simp only [List.head?_cons, Option.map_some, Option.getD_some]
        exact fun h => absurd (of_decide_eq_true h) (by omega)
  rw [low, List.append_nil, List.filter_eq_self]
  intro m mm
  simp only [decide_eq_true_eq]
  cases c with
  | nil =>
    simp only [List.head?_nil, Option.map_none, Option.getD_none]
    -- a line of a chain has a number of at least 1
    obtain ⟨q, r, e⟩ := List.append_of_mem mm
    subst e
    have v : Valid (m :: (r ++ [])) := by
      have := (show Valid ((q ++ m :: r) ++ []) from h)
      rw [List.append_assoc] at this
      exact Valid.append_right (p := q) this
    exact v.seq_pos
  | cons x c =>
    simpa using Valid.above h m mm x (List.mem_cons_self ..)

theorem missing_self {c : List Line} (h : Valid c) : missing c c = [] := by
  simpa using missing_append (p := []) (c := c) h

/-- Lines that each fit on top of the chain before them, received oldest first onto it, when the peer keeps no loose
line of that device, become its chain. -/
theorem receiveAll_chain {d : String} :
    ∀ (q : List Line) (k : Keeper), Valid (q.reverse ++ k.chain d) →
      (∀ m ∈ k.loose, m.device ≠ d) → (∀ x ∈ q, check network members x = .ok () ∧ x.device = d) →
      (k.receiveAll network members q).chain d = q.reverse ++ k.chain d
  | [], k, _, _, _ => by simp [receiveAll]
  | l :: q, k, v, loose, hq => by
    obtain ⟨hc, hd⟩ := hq l (List.mem_cons_self ..)
    subst hd
    have v1 : Valid (l :: k.chain l.device) := by
      have := v
      rw [List.reverse_cons, List.append_assoc] at this
      exact Valid.append_right this
    have nl : (k.loose.filter (·.device == l.device)) = [] := by
      rw [List.filter_eq_nil_iff]
      intro m mm
      simpa using loose m mm
    have hheld : k.held l.device = k.chain l.device := by simp [held, nl]
    have nm : (k.held l.device).contains l = false := by
      rw [hheld]
      apply Bool.eq_false_iff.mpr
      intro e
      have := Valid.below v1 l (List.contains_iff_mem.mp e)
      omega
    have ns : (k.held l.device).any (·.seq == l.seq) = false := by
      rw [hheld, Bool.eq_false_iff]
      intro e
      obtain ⟨x, mx, s⟩ := List.any_eq_true.mp e
      have := Valid.below v1 x mx
      simp at s
      omega
    -- nothing loose of this device fits: the chain takes the line and stops
    have ab : ∀ f, absorb l.device k.forks f (l :: k.chain l.device) k.loose [] = (l :: k.chain l.device, k.loose, []) := by
      intro f
      cases f with
      | zero => rfl
      | succ f =>
        unfold absorb
        rw [List.find?_eq_none.mpr]
        intro m mm
        simp [loose m mm]
    have step : k.receive network members l =
        (.moved [l.id], { k with chains := Store.set k.chains l.device (l :: k.chain l.device) }) := by
      unfold receive
      rw [hc]
      simp only
      rw [ite_eq_right (by intro h; rw [h] at nm; cases nm), ite_eq_right (by simp [ns]), ite_eq_left v1.1, ab]
    have e : (k.receiveAll network members (l :: q)) =
        ({ k with chains := Store.set k.chains l.device (l :: k.chain l.device) } : Keeper).receiveAll network
          members q := by
      simp only [receiveAll, List.foldl_cons, step]
    rw [e]
    have c1 : ({ k with chains := Store.set k.chains l.device (l :: k.chain l.device) } : Keeper).chain l.device =
        l :: k.chain l.device := by simp [chain]
    rw [receiveAll_chain q _ (by rw [c1]; simpa [List.append_assoc] using v) (by simpa using loose)
      (fun x mx => hq x (List.mem_cons_of_mem _ mx)), c1]
    simp

/-- **Paged:** the missing lines taken a page at a time, in order, end where all of them at once do, so each page
moves the receiver on from where the one before left it (the `lines` frames are bounded). -/
theorem receiveAll_pages (k : Keeper) : ∀ pages : List (List Line),
    pages.foldl (fun k p => k.receiveAll network members p) k = k.receiveAll network members pages.flatten
  | [] => rfl
  | p :: ps => by
    simp only [List.foldl_cons, List.flatten_cons, receiveAll, List.foldl_append]
    exact receiveAll_pages _ ps

/-- **Catching up:** a peer whose chain of device `d` is the start of another's, holding no loose line of `d`, ends
with exactly the other's chain, when every line of it passes the check (the other peer took each through it). -/
theorem catchUp_chain {src : Keeper} {d : String} (v : Valid (src.chain d)) (behind : k.chain d <:+ src.chain d)
    (loose : ∀ m ∈ k.loose, m.device ≠ d) (ok : ∀ x ∈ src.chain d, check network members x = .ok () ∧ x.device = d) :
    (k.catchUp src network members d).chain d = src.chain d := by
  obtain ⟨p, e⟩ := behind
  unfold catchUp
  rw [← e, missing_append (e ▸ v), receiveAll_chain p.reverse k (by simpa [e] using v) loose
    (fun x mx => ok x (e ▸ List.mem_append_left _ (List.mem_reverse.mp mx)))]
  simp

/-- **Both see every line:** when one peer's chain of `d` is the start of the other's, and each catches up from the
other, both end with the longer chain. -/
theorem both_see {a b : Keeper} {d : String} (v : Valid (b.chain d)) (behind : a.chain d <:+ b.chain d)
    (loose : ∀ m ∈ a.loose, m.device ≠ d) (ok : ∀ x ∈ b.chain d, check network members x = .ok () ∧ x.device = d) :
    let a' := a.catchUp b network members d
    a'.chain d = b.chain d ∧ (b.catchUp a' network members d).chain d = b.chain d := by
  have back : ∀ a' : Keeper, a'.chain d = b.chain d → (b.catchUp a' network members d).chain d = b.chain d := by
    intro a' h
    unfold catchUp
    rw [h, missing_self v]
    rfl
  have ha := catchUp_chain v behind loose ok
  exact ⟨ha, back _ ha⟩

/-! ## A device never forks itself

A browser that lost its store but kept its key starts from nothing, and a line it wrote then would be number 1 again:
a fork of its own chain. So a device writes no line to its chain until it has learned its own head from the Aven Peer
(`heads` on connect) and caught up on it; until then, offline from the very start, it queues what it writes,
unchained, and chains it once it knows. Its lines then continue the Aven Peer's chain of it, which takes them as
they are: never a fork (`learned_never_forks`). The Aven Peer itself holds every chain, so it knows from the start. -/

/-- **A device that learned its head never forks itself:** its chain is the Aven Peer's chain of it, caught up; the
lines it writes on top of it, received by the Aven Peer in order, become the Aven Peer's chain of it. -/
theorem learned_never_forks {aven : Keeper} {d : String} (learned : k.chain d = aven.chain d)
    (loose : ∀ m ∈ aven.loose, m.device ≠ d) (q : List Line) (written : Valid (q.reverse ++ k.chain d))
    (ok : ∀ x ∈ q, check network members x = .ok () ∧ x.device = d) :
    (aven.receiveAll network members q).chain d = q.reverse ++ aven.chain d := by
  rw [learned] at written
  exact receiveAll_chain q aven written loose ok

/-- **Learning first:** a device whose chain of itself is the start of the Aven Peer's catches up to exactly it,
then never forks itself. -/
theorem catchUp_then_write {aven : Keeper} {d : String} (v : Valid (aven.chain d))
    (behind : k.chain d <:+ aven.chain d) (kl : ∀ m ∈ k.loose, m.device ≠ d) (al : ∀ m ∈ aven.loose, m.device ≠ d)
    (ok : ∀ x ∈ aven.chain d, check network members x = .ok () ∧ x.device = d) (q : List Line)
    (written : Valid (q.reverse ++ (k.catchUp aven network members d).chain d))
    (qok : ∀ x ∈ q, check network members x = .ok () ∧ x.device = d) :
    (aven.receiveAll network members q).chain d = q.reverse ++ aven.chain d :=
  learned_never_forks (catchUp_chain v behind kl ok) al q written qok

end Keeper

/-! ## Examples

Lines arriving at peers, and peers catching up, written out by hand. The door admits `alice`, `aven`, `bob` and
`carol`; `eve` is no member. A line is written with its name, its device, its number, the name of the line before it,
its time and its body; and how it is tampered with after signing. Each step is a line a peer hears, a line a peer
writes itself, or a peer catching up from another; after each, the answer, the peer's heads, its loose lines, its
forks and what its chat shows. -/

inductive Tamper where
  | none
  /-- signed by another key -/
  | signer (k : String)
  /-- its body changed after signing -/
  | text (s : String)
  /-- for another network -/
  | network (n : String)
  deriving DecidableEq, Repr

def Line.make' (id device : String) (seq : Nat) (prev : Option Id) (time : Nat) (body : Body)
    (t : Tamper := .none) : Line :=
  let network := match t with | .network n => n | _ => "aven"
  let l : Line := ⟨id, network, device, seq, prev, time, body, device, ""⟩
  let l := { l with signed := l.signs }
  match t with
  | .signer k => { l with signer := k }
  | .text s => { l with body := .text s }
  | _ => l

def Line.make (id device : String) (seq : Nat) (prev : Option Id) (time : Nat) (text : String)
    (t : Tamper := .none) : Line := Line.make' id device seq prev time (.text text) t

inductive Step where
  /-- `peer` hears `line` on gossip -/
  | hear (peer : String) (line : Line)
  /-- `peer` catches up on every chain `src` keeps -/
  | catchUp (peer src : String)
  deriving DecidableEq, Repr

def members : List String := ["alice", "aven", "bob", "carol"]
def peers : List String := ["alice", "aven", "bob", "carol"]

abbrev World := List (String × Keeper)

def World.at (w : World) (p : String) : Keeper := (Store.get w p).getD {}

/-- Catching up on every device whose chain `src` keeps, in order of the device's name: the answers, oldest line
first. -/
def Keeper.catchUpAll (k src : Keeper) : List Answer × Keeper :=
  let devices := Store.sort (src.chains.map (·.1))
  devices.foldl (fun (out, k) d =>
    let ls := (Keeper.missing (src.chain d) (k.chain d)).reverse
    ls.foldl (fun (out, k) l => let (a, k') := k.receive "aven" members l; (out ++ [a], k')) (out, k)) ([], k)

def World.step (w : World) : Step → String × List Answer × World
  | .hear p l => let (a, k) := (w.at p).receive "aven" members l; (p, [a], Store.set w p k)
  | .catchUp p src => let (as, k) := (w.at p).catchUpAll (w.at src); (p, as, Store.set w p k)

def World.run (w : World) : List Step → List (String × List Answer × Keeper)
  | [] => []
  | s :: ss => let (p, as, w') := w.step s; (p, as, w'.at p) :: w'.run ss

/-- A peer's heads, by device: what its `chat-*` refs hold. -/
def Keeper.heads (k : Keeper) : List (String × Id) :=
  (Store.sort (k.chains.map (·.1))).filterMap fun d => (k.chain d).head?.map fun l => (d, l.id)

def a1 := Line.make "a1" "alice" 1 none 10 "hi"
def a2 := Line.make "a2" "alice" 2 (some "a1") 20 "how are you"
def a3 := Line.make "a3" "alice" 3 (some "a2") 40 "a movie"
def a2' := Line.make "a2'" "alice" 2 (some "a1") 21 "from a cloned laptop"
def file := Blake3.hash "a movie's index".toUTF8.toList
def f3 := Line.make' "f3" "alice" 3 (some "a2") 45 (.file file 200000000 "dome.mp4" "video/mp4")
def b1 := Line.make "b1" "bob" 1 none 30 "hello"
def b2 := Line.make "b2" "bob" 2 (some "b1") 50 "written offline"

/-- Each example: its steps, and after each the peer it happened at, the answers, the heads, the forks, and the lines
its chat shows, in order. -/
def chainExamples : List (String × List Step × List (String × List Answer × List (String × Id) × List Id × List Id)) := [
  ("lines chain; the head moves forward",
    [.hear "aven" a1, .hear "aven" a2, .hear "aven" b1],
    [("aven", [.moved ["a1"]], [("alice", "a1")], [], ["a1"]),
     ("aven", [.moved ["a2"]], [("alice", "a2")], [], ["a1", "a2"]),
     ("aven", [.moved ["b1"]], [("alice", "a2"), ("bob", "b1")], [], ["a1", "a2", "b1"])]),
  ("a line received twice is kept once",
    [.hear "aven" a1, .hear "aven" a1],
    [("aven", [.moved ["a1"]], [("alice", "a1")], [], ["a1"]),
     ("aven", [.known], [("alice", "a1")], [], ["a1"])]),
  ("a line ahead of the chain waits for the ones before it",
    [.hear "bob" a3, .hear "bob" a1, .hear "bob" a2],
    [("bob", [.gap], [], [], ["a3"]),
     ("bob", [.moved ["a1"]], [("alice", "a1")], [], ["a1", "a3"]),
     ("bob", [.moved ["a2", "a3"]], [("alice", "a3")], [], ["a1", "a2", "a3"])]),
  ("a fork is kept, not chained, and raised",
    [.hear "aven" a1, .hear "aven" a2, .hear "aven" a2', .hear "aven" a3],
    [("aven", [.moved ["a1"]], [("alice", "a1")], [], ["a1"]),
     ("aven", [.moved ["a2"]], [("alice", "a2")], [], ["a1", "a2"]),
     ("aven", [.fork], [("alice", "a2")], ["a2'"], ["a1", "a2"]),
     ("aven", [.moved ["a3"]], [("alice", "a3")], ["a2'"], ["a1", "a2", "a3"])]),
  ("a file is a line of its sender's chain",
    [.hear "aven" a1, .hear "aven" a2, .hear "aven" f3],
    [("aven", [.moved ["a1"]], [("alice", "a1")], [], ["a1"]),
     ("aven", [.moved ["a2"]], [("alice", "a2")], [], ["a1", "a2"]),
     ("aven", [.moved ["f3"]], [("alice", "f3")], [], ["a1", "a2", "f3"])]),
  ("file lines that aren't well formed are dropped",
    [.hear "aven" (.make' "y1" "alice" 1 none 10 (.file "not a hash" 1 "a.png" "image/png")),
     .hear "aven" (.make' "y2" "alice" 1 none 10 (.file file 1 "a.png" "")),
     .hear "aven" (.make' "y3" "alice" 1 none 10 (.file file 1 "a.png" "image/png\ntext")),
     .hear "aven" (.make' "y4" "alice" 1 none 10 (.file file 1 "" "image/png")),
     .hear "aven" (.make' "y5" "alice" 1 none 10 (.file file 1 "a.png" "image/png"))],
    [("aven", [.refused .badFile], [], [], []),
     ("aven", [.refused .badFile], [], [], []),
     ("aven", [.refused .badFile], [], [], []),
     ("aven", [.refused .empty], [], [], []),
     ("aven", [.moved ["y5"]], [("alice", "y5")], [], ["y5"])]),
  ("a non-member's line, and lines tampered with, are dropped",
    [.hear "aven" (.make "e1" "eve" 1 none 10 "let me in"),
     .hear "aven" (.make "x1" "alice" 1 none 10 "hi" (.signer "eve")),
     .hear "aven" (.make "x2" "alice" 1 none 10 "hi" (.text "bye")),
     .hear "aven" (.make "x3" "alice" 1 none 10 "hi" (.network "other")),
     .hear "aven" (.make "x4" "alice" 2 none 10 "hi"),
     .hear "aven" (.make "x5" "alice" 1 none 10 "")],
    [("aven", [.refused .notMember], [], [], []),
     ("aven", [.refused .badSignature], [], [], []),
     ("aven", [.refused .badSignature], [], [], []),
     ("aven", [.refused .wrongNetwork], [], [], []),
     ("aven", [.refused .badSeq], [], [], []),
     ("aven", [.refused .empty], [], [], [])]),
  ("a reload: bob catches up from the Aven Peer and finds the whole chat, in order",
    [.hear "aven" a1, .hear "aven" b1, .hear "aven" a2, .catchUp "bob" "aven"],
    [("aven", [.moved ["a1"]], [("alice", "a1")], [], ["a1"]),
     ("aven", [.moved ["b1"]], [("alice", "a1"), ("bob", "b1")], [], ["a1", "b1"]),
     ("aven", [.moved ["a2"]], [("alice", "a2"), ("bob", "b1")], [], ["a1", "a2", "b1"]),
     ("bob", [.moved ["a1"], .moved ["a2"], .moved ["b1"]], [("alice", "a2"), ("bob", "b1")], [],
      ["a1", "a2", "b1"])]),
  ("a late joiner catches up; a peer that holds part fetches only the rest",
    [.hear "aven" a1, .hear "aven" a2, .hear "carol" a1, .catchUp "carol" "aven"],
    [("aven", [.moved ["a1"]], [("alice", "a1")], [], ["a1"]),
     ("aven", [.moved ["a2"]], [("alice", "a2")], [], ["a1", "a2"]),
     ("carol", [.moved ["a1"]], [("alice", "a1")], [], ["a1"]),
     ("carol", [.moved ["a2"]], [("alice", "a2")], [], ["a1", "a2"])]),
  ("an offline line: bob writes it alone, and on reconnect the Aven Peer catches up from bob, and alice from it",
    [.hear "bob" b1, .hear "aven" b1, .hear "bob" b2, .catchUp "aven" "bob", .catchUp "alice" "aven"],
    [("bob", [.moved ["b1"]], [("bob", "b1")], [], ["b1"]),
     ("aven", [.moved ["b1"]], [("bob", "b1")], [], ["b1"]),
     ("bob", [.moved ["b2"]], [("bob", "b2")], [], ["b1", "b2"]),
     ("aven", [.moved ["b2"]], [("bob", "b2")], [], ["b1", "b2"]),
     ("alice", [.moved ["b1"], .moved ["b2"]], [("bob", "b2")], [], ["b1", "b2"])]),
  ("a fresh profile with a known key that writes before it learns its head forks itself",
    [.hear "aven" b1, .hear "aven" b2, .hear "aven" (.make "b1'" "bob" 1 none 60 "from a fresh profile")],
    [("aven", [.moved ["b1"]], [("bob", "b1")], [], ["b1"]),
     ("aven", [.moved ["b2"]], [("bob", "b2")], [], ["b1", "b2"]),
     ("aven", [.fork], [("bob", "b2")], ["b1'"], ["b1", "b2"])]),
  ("one that learns its head first continues its chain",
    [.hear "aven" b1, .hear "aven" b2, .catchUp "bob" "aven", .hear "aven" (.make "b3" "bob" 3 (some "b2") 60 "from a fresh profile")],
    [("aven", [.moved ["b1"]], [("bob", "b1")], [], ["b1"]),
     ("aven", [.moved ["b2"]], [("bob", "b2")], [], ["b1", "b2"]),
     ("bob", [.moved ["b1"], .moved ["b2"]], [("bob", "b2")], [], ["b1", "b2"]),
     ("aven", [.moved ["b3"]], [("bob", "b3")], [], ["b1", "b2", "b3"])]),
  ("catching up from a peer that knows nothing new changes nothing",
    [.hear "aven" a1, .hear "bob" a1, .catchUp "bob" "aven", .catchUp "aven" "bob"],
    [("aven", [.moved ["a1"]], [("alice", "a1")], [], ["a1"]),
     ("bob", [.moved ["a1"]], [("alice", "a1")], [], ["a1"]),
     ("bob", [], [("alice", "a1")], [], ["a1"]),
     ("aven", [], [("alice", "a1")], [], ["a1"])])]

def World.shows (steps : List Step) : List (String × List Answer × List (String × Id) × List Id × List Id) :=
  (World.run [] steps).map fun (p, as, k) => (p, as, k.heads, k.forks, k.shown.map (·.id))

#guard chainExamples.all fun (_, steps, want) => World.shows steps == want

end Aven.DB.Chains

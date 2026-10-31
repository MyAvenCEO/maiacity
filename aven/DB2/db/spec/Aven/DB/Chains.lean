import Aven.DB.Chat
import Aven.DB.Files
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
from the Aven Peer, so it never forks itself (`learned_never_forks`), unless its own store holds its key: then its
store is its truth, and it writes at once, offline too (`own_store_never_forks`).

The model names a line by its `id`, the hash of its blob, and takes the signature as sound, as `Aven.DB.Chat` does.
aven-gen1's `chain` module implements it; its tests replay the traces in `vectors/chats.json` with real signed
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
  /-- a retraction: the line it deletes, named by its id, and that line's place (its device, number, previous line and
  time), so a peer that never held it can keep its place (`Keeper.stubs`) -/
  | retract (target : Id) (device : String) (seq : Nat) (prev : Option Id) (time : Nat)
  /-- a line whose text this peer dropped (`Keeper.redact`): never the body of a line heard or written -/
  | redacted
  deriving DecidableEq, Repr, Inhabited

/-- A body as the line's bytes carry it, last: its kind first, the free text (a text, a file's name) last. -/
def Body.render : Body → String
  | .text t => "text\n" ++ t
  | .file f n name type => "file " ++ f ++ "\nsize " ++ toString n ++ "\ntype " ++ type ++ "\n" ++ name
  | .retract t d s p time =>
    "retract " ++ t ++ "\ndevice " ++ d ++ "\nseq " ++ toString s ++ "\nprev " ++ p.getD "none" ++ "\nat " ++
      toString time
  | .redacted => "redacted"

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
  /-- a file line whose hash isn't one, whose type is empty, too long or breaks the line, or whose size is past
  `Files.maxFile` -/
  | badFile
  /-- a blob that isn't exactly the bytes its line renders to (`Aven.DB.Chains.read`) -/
  | notCanonical
  /-- a retraction whose target or place isn't one (a number of 0, a first line with a previous one, a field that
  breaks the line), or a body that only a peer's own record holds (`redacted`) -/
  | badRetract
  deriving DecidableEq, Repr

/-- A body on its own: a text or a file's name of 1 to `maxText` bytes, and a file's hash and type well formed. -/
def Body.check : Body → Except Refusal Unit
  | .text t => if t.utf8ByteSize = 0 then .error .empty else if t.utf8ByteSize > maxText then .error .tooLong else .ok ()
  | .file f size name type =>
    if !Store.validHash f ∨ type.isEmpty ∨ type.utf8ByteSize > maxType ∨ type.contains '\n' then .error .badFile
    else if size > Files.maxFile then .error .badFile
    else if name.utf8ByteSize = 0 then .error .empty
    else if name.utf8ByteSize > maxText then .error .tooLong
    else .ok ()
  | .retract t d s p _ =>
    if t.isEmpty ∨ t.contains '\n' ∨ d.isEmpty ∨ d.contains '\n' ∨ s = 0 ∨ (s == 1) != p.isNone ∨
      p.any (fun q => q.isEmpty || q.contains '\n') then .error .badRetract
    else .ok ()
  | .redacted => .error .badRetract

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

/-- The lines a chat shows: every line held but the forks and the retractions, ordered by time, then device. -/
def shown (k : Keeper) : List Line :=
  let all := (k.chains.flatMap (·.2) ++ k.loose.filter (fun l => !k.forks.contains l.id)).filter fun l =>
    match l.body with
    | .retract .. => false
    | _ => true
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

/-! ## A device's own store is its truth

Since a device's key lives in its store (a Peer-Light's `device-key`; a native Peer's store says once it is its key's,
`chain-key`), a lost store means a new device, never an old device with nothing: the store that holds the key holds every
line that key signed, since a line is kept before it is sent (README's rule 3, "a device's own log is its truth and
never waits for another peer"). Whatever the Aven Peer holds of the device's chain is then the start of the store's:
the store's chain is some lines `p` on top of the Aven Peer's. So such a device writes on its own chain at once, offline
from the very start, and keeps each line in its store as it writes it; on reconnect the Aven Peer takes the lines it
missed (`p`, oldest first) and then the new ones, and ends with exactly the device's chain: never a fork. A device
whose store doesn't hold its key (a key given apart from the store: the box's cast, a native Peer's `--secret` with an
empty `--store`) can't tell a new store from a lost one, so it still learns its head first (`learned_never_forks`). -/

/-- **A device whose store holds its key never forks itself:** the Aven Peer's chain of it is the start of the
store's (`own`), so the lines the Aven Peer misses, then those written on top, offline or not, leave the Aven Peer with
exactly the device's chain. -/
theorem own_store_never_forks {aven : Keeper} {d : String} {p : List Line} (own : k.chain d = p ++ aven.chain d)
    (al : ∀ m ∈ aven.loose, m.device ≠ d) (q : List Line) (written : Valid (q.reverse ++ k.chain d))
    (ok : ∀ x ∈ p.reverse ++ q, check network members x = .ok () ∧ x.device = d) :
    (aven.receiveAll network members (p.reverse ++ q)).chain d = q.reverse ++ k.chain d := by
  rw [own] at written ⊢
  have r := receiveAll_chain (p.reverse ++ q) aven
    (by simpa [List.reverse_append, List.append_assoc] using written) al ok
  simpa [List.reverse_append, List.append_assoc] using r

/-- **Nothing to send:** a device whose store holds its key and that the Aven Peer has fully seen writes on top of
the Aven Peer's chain of it, as one that learned its head does. -/
theorem own_store_caught_up {aven : Keeper} {d : String} (own : k.chain d = aven.chain d)
    (al : ∀ m ∈ aven.loose, m.device ≠ d) (q : List Line) (written : Valid (q.reverse ++ k.chain d))
    (ok : ∀ x ∈ q, check network members x = .ok () ∧ x.device = d) :
    (aven.receiveAll network members q).chain d = q.reverse ++ k.chain d :=
  own_store_never_forks (p := []) (by simpa using own) al q written (by simpa using ok)

end Keeper

/-! ## Deleting a line: retractions

A delete is a **retraction**: a line of its own, in the deleting device's chain, signed like every line, whose body
names the retracted line by its id and repeats its place (its device, number, previous line and time). Only the line's
own vault may retract it, from any of its devices: every peer checks that the retraction's device acts for the same
vault as the retracted line's (`author`), and ignores any other retraction (`retracts_author`). A retraction names a
text or a file; one naming a retraction counts for nothing, so a delete is never undone.

After every line, a peer **settles** (`settle`):

- **stubs:** a retraction that counts, naming a line the peer doesn't hold, keeps that line's place as a stub (its id
  and place, no text), so the chain still continues past it, and the line, arriving later, takes the stub's place
  without its text: arrival order doesn't matter (`retracted_congr`). A peer catching up from one that holds only the
  stub is sent the retraction in its place (`standIn`), and catching up sends every retraction before any other line,
  so a peer applies the deletes it learns before it shows or serves what they delete (`catchUpAll`). Once a peer takes
  a retraction, it holds it whatever comes after (`retraction_stays`) and shows the line deleted (`retraction_spreads`):
  the retraction is never dropped, so a device that comes back with the old line can't bring it back to anyone.
- **redaction:** every line it holds that a retraction counts for loses its text (`redact`): its body becomes
  `redacted`, and the bytes it signed go with it. Its id, its place and the links of its chain stay, so the chain still
  verifies by its links (`redact_valid`, `redact_heads`). Its own signature can't be checked again, since it signed the
  text; that would take lines that sign their body's hash, a later line version.
- **files:** a file's bytes are dropped exactly when a redaction took the last line naming it (`settle_dropped`):
  files are named by their hash, so another line naming the same file keeps its bytes.

Every view shows a retracted line as deleted, in place (`retracted_deleted`), and a peer serves no file a retraction
took: its file-serving refuses it as gone even before its bytes are deleted. Deletion binds honest peers only: no peer
can be forced to forget what it was sent.

**Next, once the chat is sealed:** each file gets its own content key, carried inside its line. A delete then removes
the key everywhere the line is held, so whatever ciphertext a keeper still holds is unreadable. Not built yet.
-/

/-- Which vault each device acts for, as the door names it. -/
abbrev Vaults := List (String × String)

/-- The vault a device's lines are said for: its vault, or the device itself when the door names none. -/
def author (vaults : Vaults) (d : String) : String := (Store.get vaults d).getD d

def Body.isRetract : Body → Bool
  | .retract .. => true
  | _ => false

def Body.hasText : Body → Bool
  | .text _ | .file .. => true
  | _ => false

/-- Whether `r` retracts `l`: it names `l` by its id and place, its device acts for `l`'s vault, and `l` is no
retraction. -/
def retracts (vaults : Vaults) (r l : Line) : Bool :=
  match r.body with
  | .retract t d s p time =>
    t == l.id && d == l.device && s == l.seq && p == l.prev && time == l.time &&
      author vaults r.device == author vaults l.device && !l.body.isRetract
  | _ => false

/-- **Only the line's own vault deletes it:** a retraction counts only when its device acts for the line's vault. -/
theorem retracts_author {vaults : Vaults} {r l : Line} (h : retracts vaults r l = true) :
    author vaults r.device = author vaults l.device := by
  unfold retracts at h
  split at h
  · simp only [Bool.and_eq_true, beq_iff_eq] at h
    exact h.1.2
  · cases h

/-- The place a retraction keeps for a line the peer doesn't hold: the line's id and place, without its text. -/
def stub (r : Line) : Option Line :=
  match r.body with
  | .retract t d s p time =>
    some { id := t, network := r.network, device := d, seq := s, prev := p, time := time, body := .redacted,
           signer := "", signed := "" }
  | _ => none

/-- The order stubs are placed in, the same on every peer: by their place, then their retraction's. -/
def stubLe (a b : Line × Line) : Bool :=
  if a.1.device ≠ b.1.device then decide (a.1.device < b.1.device)
  else if a.1.seq ≠ b.1.seq then decide (a.1.seq < b.1.seq)
  else if a.1.time ≠ b.1.time then decide (a.1.time < b.1.time)
  else if a.2.device ≠ b.2.device then decide (a.2.device < b.2.device)
  else decide (a.2.seq ≤ b.2.seq)

/-- The files lines name. -/
def named (ls : List Line) : List String :=
  ls.filterMap fun l => match l.body with
    | .file f .. => some f
    | _ => none

/-- Each name once. -/
def dedup : List String → List String
  | [] => []
  | a :: l => if (dedup l).contains a then dedup l else a :: dedup l

theorem mem_dedup {a : String} : ∀ {l : List String}, a ∈ dedup l ↔ a ∈ l
  | [] => by simp [dedup]
  | b :: l => by
    unfold dedup
    split
    · next h =>
      rw [mem_dedup]
      constructor
      · exact fun m => List.mem_cons_of_mem _ m
      · intro m
        rcases List.mem_cons.mp m with rfl | m
        · exact mem_dedup.mp (List.contains_iff_mem.mp h)
        · exact m
    · simp [mem_dedup]

theorem mem_ins {a b : String} : ∀ {l : List String}, a ∈ Store.ins b l ↔ a = b ∨ a ∈ l
  | [] => by simp [Store.ins]
  | c :: l => by
    unfold Store.ins
    split
    · simp only [List.mem_cons, mem_ins]
      constructor
      · rintro (h | h | h) <;> simp [h]
      · rintro (h | h | h) <;> simp [h]
    · simp only [List.mem_cons]

theorem mem_sort {a : String} : ∀ {l : List String}, a ∈ Store.sort l ↔ a ∈ l
  | [] => by simp [Store.sort]
  | b :: l => by simp [Store.sort, mem_ins, mem_sort]

namespace Keeper

/-- Every line it holds, forks and stubs included. -/
def all (k : Keeper) : List Line := k.chains.flatMap (·.2) ++ k.loose

/-- Every line it holds but the forks: what may count. -/
def live (k : Keeper) : List Line := k.chains.flatMap (·.2) ++ k.loose.filter (fun l => !k.forks.contains l.id)

/-- Whether a retraction it holds counts for `l`. -/
def retracted (k : Keeper) (vaults : Vaults) (l : Line) : Bool := k.live.any (retracts vaults · l)

/-- How a line shows: deleted when its text is gone or a retraction it holds counts for it. -/
def deleted (k : Keeper) (vaults : Vaults) (l : Line) : Bool := l.body == .redacted || k.retracted vaults l

/-- **Deleted for every reader:** a line a held retraction counts for shows as deleted. -/
theorem retracted_deleted {k : Keeper} {vaults : Vaults} {r l : Line} (hr : r ∈ k.live)
    (h : retracts vaults r l = true) : k.deleted vaults l = true := by
  simp only [deleted, retracted, Bool.or_eq_true, List.any_eq_true]
  exact .inr ⟨r, hr, h⟩

/-- **Whatever the arrival order:** whether a line is retracted depends only on which lines a peer holds, not on the
order they came in. -/
theorem retracted_congr {k k' : Keeper} (vaults : Vaults) (l : Line) (same : ∀ m, m ∈ k.live ↔ m ∈ k'.live) :
    k.retracted vaults l = k'.retracted vaults l := by
  unfold retracted
  apply Bool.eq_iff_iff.mpr
  simp only [List.any_eq_true]
  exact ⟨fun ⟨m, hm, e⟩ => ⟨m, (same m).mp hm, e⟩, fun ⟨m, hm, e⟩ => ⟨m, (same m).mpr hm, e⟩⟩

/-- **Another vault's retraction changes nothing:** none of its retractions counts for a line of another vault. -/
theorem other_vault_nothing {k : Keeper} {vaults : Vaults} {l : Line}
    (other : ∀ r ∈ k.live, r.body.isRetract → author vaults r.device ≠ author vaults l.device) :
    k.retracted vaults l = false := by
  unfold retracted
  apply Bool.eq_false_iff.mpr
  intro h
  obtain ⟨r, hr, e⟩ := List.any_eq_true.mp h
  have isr : r.body.isRetract = true := by
    unfold retracts at e
    split at e
    · next b => simp [b, Body.isRetract]
    · cases e
  exact other r hr isr (retracts_author e)

/-- A line put in its place, unchecked: on top of its device's chain, with what then fits after it, or kept loose. -/
def place (k : Keeper) (l : Line) : Keeper :=
  if fits (k.chain l.device) l then
    let (c, loose, _) := absorb l.device k.forks k.loose.length (l :: k.chain l.device) k.loose []
    { k with chains := Store.set k.chains l.device c, loose := loose }
  else { k with loose := l :: k.loose }

/-- Every retraction it holds that counts, naming a line at a place where it holds nothing: that line's stub. -/
def stubs (k : Keeper) (vaults : Vaults) : Keeper :=
  let wanted := (k.live.filterMap fun r => (stub r).map (·, r)).mergeSort stubLe
  wanted.foldl (fun k (s, r) =>
    if author vaults r.device == author vaults s.device &&
        !(k.held s.device).any (fun m => m.id == s.id || m.seq == s.seq) then k.place s
    else k) k

/-- A line without its text, when a retraction it holds counts for it. -/
def redactLine (k : Keeper) (vaults : Vaults) (l : Line) : Line :=
  if l.body.hasText && k.retracted vaults l then { l with body := .redacted, signed := "" } else l

/-- Every line a retraction counts for, without its text. -/
def redact (k : Keeper) (vaults : Vaults) : Keeper :=
  { k with chains := k.chains.map (fun e => (e.1, e.2.map (k.redactLine vaults))),
           loose := k.loose.map (k.redactLine vaults) }

/-- After a line: the stubs placed, the retracted lines' texts dropped, and the files no line names any more, each
once, in order. -/
def settle (k : Keeper) (vaults : Vaults) : List String × Keeper :=
  let k1 := k.stubs vaults
  let k2 := k1.redact vaults
  (Store.sort (dedup ((named k1.all).filter fun f => !(named k2.all).contains f)), k2)

/-- **A file's bytes go exactly when no line names it:** settling drops a file iff a line named it before and none
does after. -/
theorem settle_dropped (k : Keeper) (vaults : Vaults) (f : String) :
    f ∈ (k.settle vaults).1 ↔ f ∈ named (k.stubs vaults).all ∧ f ∉ named (k.settle vaults).2.all := by
  simp [settle, mem_sort, mem_dedup]

/-- Redaction keeps every line's id, previous line and number. -/
theorem redactLine_keeps (k : Keeper) (vaults : Vaults) (l : Line) :
    (k.redactLine vaults l).id = l.id ∧ (k.redactLine vaults l).prev = l.prev ∧
      (k.redactLine vaults l).seq = l.seq := by
  unfold redactLine
  split <;> simp

/-- **Its text gone:** a line a retraction counts for keeps no text, not even in what it signed. -/
theorem redactLine_drops {k : Keeper} {vaults : Vaults} {l : Line} (t : l.body.hasText = true)
    (h : k.retracted vaults l = true) :
    (k.redactLine vaults l).body = .redacted ∧ (k.redactLine vaults l).signed = "" := by
  simp [redactLine, t, h]

theorem get_map {β γ : Type} (g : β → γ) (d : String) :
    ∀ l : List (String × β), Store.get (l.map fun e => (e.1, g e.2)) d = (Store.get l d).map g
  | [] => rfl
  | (x, v) :: l => by
    simp only [List.map_cons, Store.get]
    split
    · rfl
    · exact get_map g d l

theorem redact_chain (k : Keeper) (vaults : Vaults) (d : String) :
    (k.redact vaults).chain d = (k.chain d).map (k.redactLine vaults) := by
  simp only [chain, redact, get_map]
  cases Store.get k.chains d <;> rfl

theorem fits_map {f : Line → Line} (hf : ∀ l, (f l).id = l.id ∧ (f l).prev = l.prev ∧ (f l).seq = l.seq)
    (c : List Line) (l : Line) : fits (c.map f) (f l) = fits c l := by
  cases c with
  | nil => simp [fits, (hf l).2.1, (hf l).2.2]
  | cons h c => simp [fits, (hf h).1, (hf h).2.2, (hf l).2.1, (hf l).2.2]

theorem valid_map {f : Line → Line} (hf : ∀ l, (f l).id = l.id ∧ (f l).prev = l.prev ∧ (f l).seq = l.seq) :
    ∀ c, Valid c → Valid (c.map f)
  | [], _ => trivial
  | l :: c, h => ⟨by rw [fits_map hf]; exact h.1, valid_map hf c h.2⟩

/-- **The chain still verifies after redaction:** a chain whose lines each sat right on top of the one before still
does, each line keeping its id, its number and its previous line. -/
theorem redact_valid (k : Keeper) (vaults : Vaults) (d : String) (v : Valid (k.chain d)) :
    Valid ((k.redact vaults).chain d) := by
  rw [redact_chain]
  exact valid_map (redactLine_keeps k vaults) _ v

/-- **Every head stays:** redaction moves no `chat-<device>` ref. -/
theorem redact_heads (k : Keeper) (vaults : Vaults) (d : String) :
    ((k.redact vaults).chain d).map (·.id) = (k.chain d).map (·.id) := by
  rw [redact_chain, List.map_map]
  exact List.map_congr_left fun l _ => (redactLine_keeps k vaults l).1

/-- A held stub of `l`, by its id. -/
def stubOf (k : Keeper) (l : Line) : Option Line :=
  (k.held l.device).find? fun m => m.id == l.id && m.body == .redacted

/-- The line a stub's place was waiting for, in the stub's place. -/
def fill (k : Keeper) (l : Line) : Keeper :=
  let swap := fun m : Line => if m.id == l.id && m.body == .redacted then l else m
  { k with chains := k.chains.map (fun e => (e.1, e.2.map swap)), loose := k.loose.map swap }

/-- A line as it arrives, then settled: the answer, the files dropped, and what the peer keeps. A line whose stub it
holds takes the stub's place, when it is the same place (then a retraction counts for it again, unless it is one);
another line at that place is a fork. -/
def take (k : Keeper) (network : String) (members : List String) (vaults : Vaults) (l : Line) :
    Answer × List String × Keeper :=
  match check network members l with
  | .error why => (.refused why, [], k)
  | .ok () =>
    let (a, k') : Answer × Keeper := match k.stubOf l with
      | some s =>
        if s.seq == l.seq && s.prev == l.prev && s.time == l.time then (.known, k.fill l)
        else (.fork, { k with loose := l :: k.loose, forks := l.id :: k.forks })
      | none => k.receive network members l
    let (dropped, k'') := k'.settle vaults
    (a, dropped, k'')

/-! ### A retraction, once held, stays

Samuel, 30 Oct 2026: deletion holds the moment a peer meets any other that has it. A peer that takes a retraction
holds it from then on, whatever lines come after (`retraction_stays`), and shows the line it deletes as deleted
(`retraction_spreads`); catching up sends the retractions first (`catchUpAll`). The retraction is never dropped, so a
device that comes back with the old line can't bring it back to anyone. -/

/-- A peer holds `r`, not raised as a fork: it counts. -/
def Holds (k : Keeper) (r : Line) : Prop := r ∈ k.held r.device ∧ k.forks.contains r.id = false

theorem absorb_from_chain (d : String) (forks : List Id) (f : Nat) (c loose : List Line) (moved : List Id)
    {m : Line} (h : m ∈ c) : m ∈ (absorb d forks f c loose moved).1 :=
  (absorb_suffix d forks f c loose moved).mem h

theorem absorb_from_loose (d : String) (forks : List Id) :
    ∀ f c loose moved {m : Line}, m ∈ loose →
      m ∈ (absorb d forks f c loose moved).1 ∨ m ∈ (absorb d forks f c loose moved).2.1
  | 0, _, _, _, _, h => .inr h
  | f + 1, c, loose, moved, m, h => by
    unfold absorb
    split
    · exact .inr h
    · next x hx =>
      by_cases e : m = x
      · subst e
        exact .inl (absorb_from_chain d forks f _ _ _ (List.mem_cons_self ..))
      · exact absorb_from_loose d forks f _ _ _ ((List.mem_erase_of_ne e).mpr h)

theorem absorb_other (d : String) (forks : List Id) :
    ∀ f c loose moved {m : Line}, m ∈ loose → m.device ≠ d → m ∈ (absorb d forks f c loose moved).2.1
  | 0, _, _, _, _, h, _ => h
  | f + 1, c, loose, moved, m, h, n => by
    unfold absorb
    split
    · exact h
    · next x hx =>
      have xd : x.device = d := by
        have := List.find?_some hx
        simp only [Bool.and_eq_true, beq_iff_eq] at this
        exact this.1.1
      exact absorb_other d forks f _ _ _ ((List.mem_erase_of_ne (by rintro rfl; exact n xd)).mpr h) n

/-- Chaining lines of `d` by `absorb` keeps every line a peer held, of every device. -/
theorem absorb_held {k : Keeper} {d : String} {c : List Line} (sub : ∀ m ∈ k.chain d, m ∈ c) (f : Nat)
    (e : String) {m : Line} (h : m ∈ k.held e) :
    m ∈ ({ k with chains := Store.set k.chains d (absorb d k.forks f c k.loose []).1,
                  loose := (absorb d k.forks f c k.loose []).2.1 } : Keeper).held e := by
  simp only [held, List.mem_append, List.mem_filter, beq_iff_eq] at h ⊢
  by_cases de : d = e
  · subst de
    rw [chain_set_self]
    rcases h with h | ⟨h, hd⟩
    · exact .inl (absorb_from_chain _ _ _ _ _ _ (sub m h))
    · rcases absorb_from_loose _ _ _ _ _ _ h with h | h
      · exact .inl h
      · exact .inr ⟨h, hd⟩
  · rw [chain_set_ne _ _ _ de]
    rcases h with h | ⟨h, hd⟩
    · exact .inl h
    · exact .inr ⟨absorb_other _ _ _ _ _ _ h (by rw [hd]; exact Ne.symm de), hd⟩

theorem cons_held {k : Keeper} (l : Line) (e : String) {m : Line} (h : m ∈ k.held e) :
    m ∈ ({ k with loose := l :: k.loose } : Keeper).held e := by
  simp only [held, chain, List.mem_append, List.mem_filter, List.mem_cons] at h ⊢
  rcases h with h | ⟨h, hd⟩
  · exact .inl h
  · exact .inr ⟨.inr h, hd⟩

theorem fork_held {k : Keeper} (l : Line) (e : String) {m : Line} (h : m ∈ k.held e) :
    m ∈ ({ k with loose := l :: k.loose, forks := l.id :: k.forks } : Keeper).held e := by
  simp only [held, chain, List.mem_append, List.mem_filter, List.mem_cons] at h ⊢
  rcases h with h | ⟨h, hd⟩
  · exact .inl h
  · exact .inr ⟨.inr h, hd⟩

theorem place_held (k : Keeper) (s : Line) (e : String) {m : Line} (h : m ∈ k.held e) :
    m ∈ (k.place s).held e := by
  unfold place
  split
  · exact absorb_held (fun _ h => List.mem_cons_of_mem _ h) _ e h
  · exact cons_held s e h

theorem stubs_held (k : Keeper) (vaults : Vaults) (e : String) {m : Line} (h : m ∈ k.held e) :
    m ∈ (k.stubs vaults).held e := by
  unfold stubs
  generalize (List.filterMap _ k.live).mergeSort stubLe = wanted
  induction wanted generalizing k with
  | nil => exact h
  | cons p ps ih =>
    simp only [List.foldl_cons]
    apply ih
    split
    · exact place_held k _ e h
    · exact h

theorem place_forks (k : Keeper) (s : Line) : (k.place s).forks = k.forks := by
  unfold place
  split <;> rfl

theorem stubs_forks (k : Keeper) (vaults : Vaults) : (k.stubs vaults).forks = k.forks := by
  unfold stubs
  generalize (List.filterMap _ k.live).mergeSort stubLe = wanted
  induction wanted generalizing k with
  | nil => rfl
  | cons p ps ih =>
    simp only [List.foldl_cons]
    rw [ih]
    split
    · exact place_forks k _
    · rfl

theorem redactLine_retract {k : Keeper} {vaults : Vaults} {r : Line} (h : r.body.isRetract = true) :
    k.redactLine vaults r = r := by
  unfold redactLine
  have : r.body.hasText = false := by
    cases e : r.body <;> simp_all [Body.isRetract, Body.hasText]
  simp [this]

theorem redact_held {k : Keeper} {vaults : Vaults} {r : Line} (hr : r.body.isRetract = true) (e : String)
    (h : r ∈ k.held e) : r ∈ (k.redact vaults).held e := by
  have keep := redactLine_retract (k := k) (vaults := vaults) hr
  simp only [held, List.mem_append, List.mem_filter] at h ⊢
  rw [redact_chain]
  rcases h with h | ⟨h, hd⟩
  · exact .inl (keep ▸ List.mem_map_of_mem h)
  · refine .inr ⟨?_, hd⟩
    simp only [redact]
    exact keep ▸ List.mem_map_of_mem h

theorem settle_holds {k : Keeper} {vaults : Vaults} {r : Line} (hr : r.body.isRetract = true) (h : k.Holds r) :
    (k.settle vaults).2.Holds r :=
  ⟨redact_held hr _ (stubs_held k vaults _ h.1), by simp only [settle, redact]; rw [stubs_forks]; exact h.2⟩

theorem get_mem {β : Type} : ∀ (l : List (String × β)) {d : String} {v : β}, Store.get l d = some v → (d, v) ∈ l
  | [], _, _, g => by simp [Store.get] at g
  | (x, w) :: l, d, v, g => by
    simp only [Store.get] at g
    split at g
    · next e => cases g; subst e; exact List.mem_cons_self ..
    · exact List.mem_cons_of_mem _ (get_mem l g)

/-- Every line a peer holds of a device, not raised as a fork, counts. -/
theorem held_live {k : Keeper} {r : Line} (h : k.Holds r) : r ∈ k.live := by
  obtain ⟨m, f⟩ := h
  simp only [held, live, List.mem_append, List.mem_filter] at m ⊢
  rcases m with m | ⟨m, _⟩
  · left
    simp only [chain] at m
    cases g : Store.get k.chains r.device with
    | none => simp [g] at m
    | some c =>
      rw [g] at m
      exact List.mem_flatMap.mpr ⟨_, get_mem _ g, m⟩
  · right
    refine ⟨m, ?_⟩
    cases e : k.forks.contains r.id
    · rfl
    · rw [e] at f; cases f

theorem receive_held {k : Keeper} {network : String} {members : List String} (l : Line) (e : String) {m : Line}
    (h : m ∈ k.held e) : m ∈ (k.receive network members l).2.held e := by
  unfold receive
  split
  · exact h
  · split
    · exact h
    split
    · exact fork_held l e h
    split
    · exact absorb_held (fun _ h => List.mem_cons_of_mem _ h) _ e h
    · exact cons_held l e h

theorem receive_forks {k : Keeper} {network : String} {members : List String} (l : Line) :
    (k.receive network members l).2.forks = k.forks ∨ (k.receive network members l).2.forks = l.id :: k.forks := by
  unfold receive
  split
  · exact .inl rfl
  · split
    · exact .inl rfl
    split
    · exact .inr rfl
    split
    · exact .inl rfl
    · exact .inl rfl

theorem fill_held {k : Keeper} {r : Line} (l : Line) (hr : r.body.isRetract = true) (e : String) (h : r ∈ k.held e) :
    r ∈ (k.fill l).held e := by
  have keep : (fun m : Line => if m.id == l.id && m.body == .redacted then l else m) r = r := by
    have : (r.body == .redacted) = false := by cases g : r.body <;> simp_all [Body.isRetract]
    simp [this]
  simp only [held, fill, chain, List.mem_append, List.mem_filter] at h ⊢
  rw [get_map]
  rcases h with h | ⟨h, hd⟩
  · left
    cases g : Store.get k.chains e with
    | none => simp [g] at h
    | some c =>
      simp only [g, Option.getD_some, Option.map_some] at h ⊢
      exact keep ▸ List.mem_map_of_mem h
  · exact .inr ⟨keep ▸ List.mem_map_of_mem h, hd⟩

/-- **A retraction stays:** a peer that holds a retraction holds it after any other line it takes. -/
theorem retraction_stays {k : Keeper} {network : String} {members : List String} {vaults : Vaults} {r : Line}
    (hr : r.body.isRetract = true) (h : k.Holds r) (l : Line) (other : l.id ≠ r.id) :
    (k.take network members vaults l).2.2.Holds r := by
  have forks_ok : ∀ fs : List Id, (fs = k.forks ∨ fs = l.id :: k.forks) → fs.contains r.id = false := by
    rintro fs (rfl | rfl)
    · exact h.2
    · simp only [List.contains_cons, Bool.or_eq_false_iff, beq_eq_false_iff_ne]
      exact ⟨Ne.symm other, by simpa using h.2⟩
  unfold take
  split
  · exact h
  · simp only
    split
    · split
      · exact settle_holds hr ⟨fill_held l hr _ h.1, h.2⟩
      · exact settle_holds hr ⟨fork_held l _ h.1, forks_ok _ (.inr rfl)⟩
    · exact settle_holds hr ⟨receive_held l _ h.1, forks_ok _ (receive_forks l)⟩

/-- **A retraction spreads:** a peer that takes a retraction into its chains or keeps it waiting for the lines before
it, not as a fork, holds it, so every line it deletes shows as deleted there from then on (`retraction_stays`),
whatever order the line comes in. -/
theorem retraction_spreads {k : Keeper} {network : String} {members : List String} {vaults : Vaults} {r l : Line}
    (hc : check network members r = .ok ()) (hr : r.body.isRetract = true) (stub : k.stubOf r = none)
    (fresh : k.forks.contains r.id = false)
    (taken : (k.receive network members r).1 = .gap ∨ ∃ ids, (k.receive network members r).1 = .moved ids)
    (h : retracts vaults r l = true) :
    (k.take network members vaults r).2.2.Holds r ∧ (k.take network members vaults r).2.2.deleted vaults l = true := by
  have holds : (k.take network members vaults r).2.2.Holds r := by
    have notFork : (k.receive network members r).2.forks = k.forks := by
      rcases receive_forks (k := k) (network := network) (members := members) r with e | e
      · exact e
      · exfalso
        revert taken e
        unfold receive
        rw [hc]
        simp only
        split
        · simp
        split
        · simp
        split <;> simp
    unfold take
    rw [hc]
    simp only [stub]
    exact settle_holds hr ⟨held_after hc, by rw [notFork]; exact fresh⟩
  exact ⟨holds, retracted_deleted (held_live holds) h⟩

/-- What a peer sends in place of a line it holds without its text: a retraction that counts for it, the first by its
device and number, the same on every peer. -/
def standIn (k : Keeper) (vaults : Vaults) (l : Line) : Option Line :=
  if l.body == .redacted then
    ((k.live.filter (retracts vaults · l)).mergeSort fun a b =>
      decide (a.device < b.device) || (a.device == b.device && decide (a.seq ≤ b.seq))).head?
  else some l

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

def members : List String := ["alice", "alice2", "aven", "bob", "carol"]
/-- `alice2` is Alice's second device; the Aven Peer acts for Aven. -/
def vaults : Vaults := [("alice", "Alice"), ("alice2", "Alice"), ("aven", "Aven"), ("bob", "Bob"), ("carol", "Carol")]
def peers : List String := ["alice", "aven", "bob", "carol"]

abbrev World := List (String × Keeper)

def World.at (w : World) (p : String) : Keeper := (Store.get w p).getD {}

/-- Catching up on every device whose chain `src` keeps, in order of the device's name, oldest line first, the
retractions before every other line: the answers. -/
def Keeper.catchUpAll (k src : Keeper) : List Answer × Keeper :=
  let devices := Store.sort (src.chains.map (·.1))
  let ls := devices.flatMap fun d =>
    (Keeper.missing (src.chain d) (k.chain d)).reverse.filterMap (src.standIn vaults)
  -- the retractions first, so a peer learns every delete before any line it deletes (`retraction_spreads`)
  let first := ls.filter (·.body.isRetract) ++ ls.filter (!·.body.isRetract)
  first.foldl (fun (out, k) l => let (a, _, k') := k.take "aven" members vaults l; (out ++ [a], k')) ([], k)

/-- A step, at the peer it happens at: its answers and the files it dropped. -/
def World.step (w : World) : Step → String × List Answer × List String × World
  | .hear p l => let (a, dropped, k) := (w.at p).take "aven" members vaults l; (p, [a], dropped, Store.set w p k)
  | .catchUp p src =>
    let k := w.at p
    let (as, k') := k.catchUpAll (w.at src)
    -- the files the whole catch-up dropped: named before it, by no line after
    let dropped := Store.sort (dedup ((named k.all).filter fun f => !(named k'.all).contains f))
    (p, as, dropped, Store.set w p k')

def World.run (w : World) : List Step → List (String × List Answer × List String × Keeper)
  | [] => []
  | s :: ss => let (p, as, dropped, w') := w.step s; (p, as, dropped, w'.at p) :: w'.run ss

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
     .hear "aven" (.make' "y6" "alice" 1 none 10 (.file file (Files.maxFile + 1) "huge.mp4" "video/mp4")),
     .hear "aven" (.make' "y5" "alice" 1 none 10 (.file file Files.maxFile "a.png" "image/png"))],
    [("aven", [.refused .badFile], [], [], []),
     ("aven", [.refused .badFile], [], [], []),
     ("aven", [.refused .badFile], [], [], []),
     ("aven", [.refused .empty], [], [], []),
     ("aven", [.refused .badFile], [], [], []),
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
  (World.run [] steps).map fun (p, as, _, k) => (p, as, k.heads, k.forks, k.shown.map (·.id))

#guard chainExamples.all fun (_, steps, want) => World.shows steps == want

/-! ### Deleting lines -/

/-- Alice deletes `a2` from the device that wrote it, and from her second device; Bob tries to. -/
def ra := Line.make' "ra" "alice" 3 (some "a2") 30 (.retract "a2" "alice" 2 (some "a1") 20)
def ra2 := Line.make' "ra2" "alice2" 1 none 35 (.retract "a2" "alice" 2 (some "a1") 20)
def rb := Line.make' "rb" "bob" 1 none 35 (.retract "a2" "alice" 2 (some "a1") 20)
def a4 := Line.make "a4" "alice" 4 (some "ra") 50 "after the delete"
/-- Alice retracts her retraction: it counts for nothing. -/
def rr := Line.make' "rr" "alice" 4 (some "ra") 50 (.retract "ra" "alice" 3 (some "a2") 30)
/-- The same file shared by Alice and by Bob, then each deletes theirs. -/
def fa := Line.make' "fa" "alice" 1 none 10 (.file file 1000 "dome.mp4" "video/mp4")
def fb := Line.make' "fb" "bob" 1 none 20 (.file file 1000 "dome.mp4" "video/mp4")
def rfa := Line.make' "rfa" "alice" 2 (some "fa") 30 (.retract "fa" "alice" 1 none 10)
def rfb := Line.make' "rfb" "bob" 2 (some "fb") 40 (.retract "fb" "bob" 1 none 20)

/-- After each step: the peer, the answers, the lines its chat shows, those it shows as deleted, the files it dropped. -/
def World.deletes (steps : List Step) : List (String × List Answer × List Id × List Id × List String) :=
  (World.run [] steps).map fun (p, as, dropped, k) =>
    (p, as, k.shown.map (·.id), (k.shown.filter (k.deleted vaults)).map (·.id), dropped)

/-- Each example: its steps, and after each the peer, its answers, the lines its chat shows, those shown as deleted,
and the files it dropped. -/
def retractExamples : List (String × List Step × List (String × List Answer × List Id × List Id × List String)) := [
  ("a retraction by the line's device deletes it, in place; the chain goes on past it",
    [.hear "aven" a1, .hear "aven" a2, .hear "aven" ra, .hear "aven" a4],
    [("aven", [.moved ["a1"]], ["a1"], [], []),
     ("aven", [.moved ["a2"]], ["a1", "a2"], [], []),
     ("aven", [.moved ["ra"]], ["a1", "a2"], ["a2"], []),
     ("aven", [.moved ["a4"]], ["a1", "a2", "a4"], ["a2"], [])]),
  ("the retraction first: its stub keeps the place, and the line never shows",
    [.hear "bob" ra, .hear "bob" a1, .hear "bob" a2],
    [("bob", [.gap], ["a2"], ["a2"], []),
     ("bob", [.moved ["a1", "a2", "ra"]], ["a1", "a2"], ["a2"], []),
     ("bob", [.known], ["a1", "a2"], ["a2"], [])]),
  ("another device of the same vault deletes it",
    [.hear "aven" a1, .hear "aven" a2, .hear "aven" ra2],
    [("aven", [.moved ["a1"]], ["a1"], [], []),
     ("aven", [.moved ["a2"]], ["a1", "a2"], [], []),
     ("aven", [.moved ["ra2"]], ["a1", "a2"], ["a2"], [])]),
  ("another vault's retraction changes nothing",
    [.hear "aven" a1, .hear "aven" a2, .hear "aven" rb],
    [("aven", [.moved ["a1"]], ["a1"], [], []),
     ("aven", [.moved ["a2"]], ["a1", "a2"], [], []),
     ("aven", [.moved ["rb"]], ["a1", "a2"], [], [])]),
  ("a retraction of a retraction counts for nothing",
    [.hear "aven" a1, .hear "aven" a2, .hear "aven" ra, .hear "aven" rr],
    [("aven", [.moved ["a1"]], ["a1"], [], []),
     ("aven", [.moved ["a2"]], ["a1", "a2"], [], []),
     ("aven", [.moved ["ra"]], ["a1", "a2"], ["a2"], []),
     ("aven", [.moved ["rr"]], ["a1", "a2"], ["a2"], [])]),
  ("catching up from a peer that dropped the text: the retractions come first, and in the line's place",
    [.hear "aven" a1, .hear "aven" a2, .hear "aven" ra, .hear "aven" a4, .catchUp "carol" "aven"],
    [("aven", [.moved ["a1"]], ["a1"], [], []),
     ("aven", [.moved ["a2"]], ["a1", "a2"], [], []),
     ("aven", [.moved ["ra"]], ["a1", "a2"], ["a2"], []),
     ("aven", [.moved ["a4"]], ["a1", "a2", "a4"], ["a2"], []),
     ("carol", [.gap, .known, .moved ["a1", "a2", "ra"], .moved ["a4"]], ["a1", "a2", "a4"], ["a2"], [])]),
  ("a file's bytes go once no line names it",
    [.hear "aven" fa, .hear "aven" fb, .hear "aven" rfa, .hear "aven" rfb],
    [("aven", [.moved ["fa"]], ["fa"], [], []),
     ("aven", [.moved ["fb"]], ["fa", "fb"], [], []),
     ("aven", [.moved ["rfa"]], ["fa", "fb"], ["fa"], []),
     ("aven", [.moved ["rfb"]], ["fa", "fb"], ["fa", "fb"], [file])])]

#guard retractExamples.all fun (_, steps, want) => World.deletes steps == want

/-- After a delete, the line keeps its id and place but no text, and its chain still links line to line. -/
def afterDelete : Keeper :=
  ((World.run [] [.hear "aven" a1, .hear "aven" a2, .hear "aven" ra]).getLast?.map (·.2.2.2)).getD {}
#guard (afterDelete.chain "alice").map (fun l => (l.id, l.body == .redacted, l.signed == "")) ==
  [("ra", false, false), ("a2", true, true), ("a1", false, false)]
#guard match afterDelete.chain "alice" with
  | [r, d, f] => fits [d, f] r && fits [f] d && fits [] f
  | _ => false

end Aven.DB.Chains

import Aven.DB.Store

/-!
# The chat

Milestone 2's example app (MILESTONE2.md): one room per network, on one iroh-gossip topic, among members only. Every
message is signed by the device that sends it, and every peer checks every message itself before it shows it or counts
its sender present: the network it is for, a sender the door admits (a member's device, the Aven Peer or a device of
the admin's people, `Aven.ID.Invite`), a signature by exactly that sender over exactly this message, a time after the
sender's last (so a message replayed later is dropped), and a line of 1 to `maxText` bytes. Presence is the senders
heard from in the last `ttl` milliseconds that have not said goodbye: each peer says `here` every `every`
milliseconds. The chat lives in memory only: no store, no history (milestone 4).

A member shares a file by announcing it in the room (store/README.md, "How a file travels"): a message of kind `file`
carrying `{file, size, name, type}`, where `file` is the hash of the file's index (a hash sequence of its chunks), and
`name` and `type` are what its sender claims. It is signed and checked like every message, and its announcement must
hold a hash in the store's spelling and a name and a type of 1 to `maxName` bytes without control characters, so the
signed body reads back one way only. The Aven Peer, hearing one, keeps the file; every member can fetch it.

As `Aven.ID.Sign` does, the model takes the signature as sound: it verifies for exactly the key and bytes signed, and
with no other key. Ed25519 is mechanics; aven-db-core's tests sign for real.

`aven-db-core`'s `chat` module implements this, and its tests replay the traces in `vectors/chat.json`.
-/

namespace Aven.DB.Chat

/-- The longest line, in bytes of UTF-8. -/
def maxText : Nat := 2000
/-- How often each peer says it is here, and how long it counts as present without a word. -/
def every : Nat := 10000
def ttl : Nat := 30000

inductive Kind where
  | here
  | say
  | bye
  | file
  deriving DecidableEq, Repr, Inhabited

def Kind.name : Kind → String
  | .here => "here"
  | .say => "say"
  | .bye => "bye"
  | .file => "file"

/-- The longest name or type a file is announced with, in bytes of UTF-8. -/
def maxName : Nat := 255

/-- A file announced: its index's hash, its size in bytes, and the name and MIME type its sender claims. -/
structure Announce where
  file : String
  size : Nat
  name : String
  type : String
  deriving DecidableEq, Repr, Inhabited

/-- 1 to `maxName` bytes, no control character: one line of the body. -/
def plain (s : String) : Bool :=
  0 < s.utf8ByteSize && s.utf8ByteSize ≤ maxName && s.all fun c => 32 ≤ c.toNat && c.toNat ≠ 127

def Announce.valid (a : Announce) : Bool := Store.validHash a.file && plain a.name && plain a.type

/-- An announcement's lines in the body, each field on its own. -/
def Announce.body (a : Announce) : String :=
  "file " ++ a.file ++ "\nsize " ++ toString a.size ++ "\nname " ++ a.name ++ "\ntype " ++ a.type ++ "\n"

/-- A message: the network's room it is for, the sending device's key, its time (ms), its kind and line (empty but
for `say`), its announcement (only for `file`); and its signature, as the model knows one: the key that made it and
the bytes it signed. -/
structure Message where
  network : String
  sender : String
  time : Nat
  kind : Kind
  text : String
  file : Option Announce
  signer : String
  signed : String
  deriving DecidableEq, Repr, Inhabited

/-- What a sender signs: every field, the announcement's lines, then the line last. A message without an announcement
signs what it signed before announcements were. -/
def Message.body (m : Message) : String :=
  "avenDB chat 1\nnetwork " ++ m.network ++ "\nfrom " ++ m.sender ++ "\nat " ++ toString m.time ++ "\nkind " ++
    m.kind.name ++ "\n" ++ (match m.file with | some a => a.body | none => "") ++ m.text

inductive Refusal where
  | wrongNetwork
  /-- the door doesn't admit the sender -/
  | notMember
  | badSignature
  /-- not after the sender's last message -/
  | stale
  | empty
  | tooLong
  /-- a `here`, a `bye` or a `file` with a line, or anything but a `file` with an announcement -/
  | notSaid
  /-- a `file` without an announcement, or one whose hash, name or type isn't valid -/
  | badFile
  deriving DecidableEq, Repr

/-- A message on its own: for this network, from a key the door admits, signed by it over exactly this, its line's
size. -/
def check (network : String) (members : List String) (m : Message) : Except Refusal Unit :=
  if m.network ≠ network then .error .wrongNetwork
  else if !members.contains m.sender then .error .notMember
  else if m.signer ≠ m.sender ∨ m.signed ≠ m.body then .error .badSignature
  else match m.kind, m.file with
    | .file, none => .error .badFile
    | .file, some a => if m.text ≠ "" then .error .notSaid else if a.valid then .ok () else .error .badFile
    | _, some _ => .error .notSaid
    | .say, none =>
      if m.text.utf8ByteSize = 0 then .error .empty
      else if m.text.utf8ByteSize > maxText then .error .tooLong
      else .ok ()
    | _, none => if m.text = "" then .ok () else .error .notSaid

theorem check_ok {network : String} {members : List String} {m : Message} (h : check network members m = .ok ()) :
    m.network = network ∧ m.sender ∈ members ∧ m.signer = m.sender ∧ m.signed = m.body ∧
      (m.kind = .say → 0 < m.text.utf8ByteSize ∧ m.text.utf8ByteSize ≤ maxText) ∧
      (m.kind ≠ .say → m.text = "") ∧
      (m.kind = .file → ∃ a, m.file = some a ∧ a.valid = true) ∧
      (m.kind ≠ .file → m.file = none) := by
  unfold check at h
  split at h; · cases h
  next n =>
  split at h; · cases h
  next k =>
  split at h; · cases h
  next s =>
  simp only [Bool.not_eq_true', Bool.eq_false_iff, ne_eq, Decidable.not_not, List.contains_iff_mem] at n k
  simp only [not_or, Decidable.not_not] at s
  refine ⟨n, by simpa using k, s.1, s.2, ?_⟩
  cases hk : m.kind <;> cases hf : m.file <;> simp only [hk, hf] at h ⊢ <;>
    (try split at h) <;> (try split at h) <;> simp_all <;> exact Nat.pos_of_ne_zero fun z => by simp_all

/-! ## The room -/

/-- A sender heard: the time of its last message, when it was heard, and whether it said goodbye. -/
structure Seen where
  sender : String
  last : Nat
  heard : Nat
  gone : Bool
  deriving DecidableEq, Repr

/-- What a peer holds of the room: each sender heard, and the lines said and the files announced, in the order they
came. -/
structure Room where
  seen : List Seen := []
  said : List (String × String) := []
  files : List (String × Announce) := []
  deriving DecidableEq, Repr

/-- Insertion sort, structural so the kernel can run it in the examples. -/
def ins (a : String) : List String → List String
  | [] => [a]
  | b :: l => if decide (a < b) then a :: b :: l else b :: ins a l

def sort : List String → List String
  | [] => []
  | a :: l => ins a (sort l)

theorem ins_perm (a : String) : ∀ l, (ins a l).Perm (a :: l)
  | [] => .refl _
  | b :: l => by
    unfold ins
    split
    · exact .refl _
    · exact ((ins_perm a l).cons b).trans (.swap a b l)

theorem sort_perm : ∀ l, (sort l).Perm l
  | [] => .refl _
  | a :: l => (ins_perm a _).trans ((sort_perm l).cons a)

namespace Room

def last? (r : Room) (sender : String) : Option Nat := (r.seen.find? (·.sender == sender)).map (·.last)

/-- A message as it arrives at `now`: checked, then taken. A `bye` takes its sender out of the room. -/
def receive (r : Room) (network : String) (members : List String) (now : Nat) (m : Message) : Except Refusal Room :=
  match check network members m with
  | .error why => .error why
  | .ok () =>
    if (r.last? m.sender).any (m.time ≤ ·) then .error .stale
    else .ok {
      seen := ⟨m.sender, m.time, now, m.kind = .bye⟩ :: r.seen.filter (·.sender != m.sender),
      said := if m.kind = .say then r.said ++ [(m.sender, m.text)] else r.said
      files := r.files ++ (m.file.toList.map (m.sender, ·)) }

/-- Who is in the room at `now`: each sender heard within `ttl` that has not said goodbye, once, in order. -/
def present (r : Room) (now : Nat) : List String :=
  sort ((r.seen.filter fun s => !s.gone && now < s.heard + ttl).map (·.sender))

/-! ## Theorems -/

variable {r r' : Room} {network : String} {members : List String} {now : Nat} {m : Message}

theorem receive_ok (h : r.receive network members now m = .ok r') :
    check network members m = .ok () ∧ (r.last? m.sender).all (· < m.time) ∧
      r'.seen = ⟨m.sender, m.time, now, m.kind = .bye⟩ :: r.seen.filter (·.sender != m.sender) ∧
      r'.said = (if m.kind = .say then r.said ++ [(m.sender, m.text)] else r.said) ∧
      r'.files = r.files ++ (m.file.toList.map (m.sender, ·)) := by
  unfold receive at h
  split at h
  · cases h
  next c =>
  split at h
  · cases h
  next s =>
  cases h
  refine ⟨c, ?_, rfl, rfl, rfl⟩
  cases e : r.last? m.sender with
  | none => rfl
  | some l => simp_all

/-- Every line shown was said by a sender the door admits, signed by it, within the size limit. -/
theorem said_members (h : r.receive network members now m = .ok r') (old : ∀ x ∈ r.said, x.1 ∈ members) :
    ∀ x ∈ r'.said, x.1 ∈ members := by
  obtain ⟨c, _, _, e, _⟩ := receive_ok h
  have mm := (check_ok c).2.1
  rw [e]
  split
  · intro x mx
    rcases List.mem_append.mp mx with mx | mx
    · exact old x mx
    · simp at mx; rw [mx]; exact mm
  · exact old

/-- Every file announced was announced by a sender the door admits, signed by it, with a valid announcement: a hash
in the store's spelling, a name and a type of one line each. -/
theorem files_members (h : r.receive network members now m = .ok r')
    (old : ∀ x ∈ r.files, x.1 ∈ members ∧ x.2.valid = true) : ∀ x ∈ r'.files, x.1 ∈ members ∧ x.2.valid = true := by
  obtain ⟨c, _, _, _, e⟩ := receive_ok h
  have k := check_ok c
  rw [e]
  intro x mx
  rcases List.mem_append.mp mx with mx | mx
  · exact old x mx
  · cases g : m.file with
    | none => simp [g] at mx
    | some a =>
      simp only [g, Option.toList_some, List.map_cons, List.map_nil, List.mem_singleton] at mx
      subst mx
      refine ⟨k.2.1, ?_⟩
      by_cases f : m.kind = .file
      · obtain ⟨b, gb, v⟩ := k.2.2.2.2.2.2.1 f
        rw [g] at gb; cases gb; exact v
      · simp [k.2.2.2.2.2.2.2 f] at g

/-- A message from a key the door doesn't admit changes nothing: it is dropped. -/
theorem stranger_dropped (h : m.sender ∉ members) : ∀ r', r.receive network members now m ≠ .ok r' := by
  intro r' e
  exact h (check_ok (receive_ok e).1).2.1

/-- The same message twice is taken once: the second is stale. -/
theorem replay_stale (h : r.receive network members now m = .ok r') {later : Nat} :
    r'.receive network members later m = .error .stale := by
  obtain ⟨c, _, e, _, _⟩ := receive_ok h
  have l : r'.last? m.sender = some m.time := by simp [last?, e]
  simp [receive, c, l]

/-- Whoever is present was heard within `ttl` and has not said goodbye. -/
theorem mem_present {x : String} : x ∈ r.present now ↔
    ∃ s ∈ r.seen, s.sender = x ∧ s.gone = false ∧ now < s.heard + ttl := by
  simp only [present, (sort_perm _).mem_iff, List.mem_map, List.mem_filter, Bool.and_eq_true, Bool.not_eq_true',
    decide_eq_true_eq]
  exact ⟨fun ⟨a, ⟨m, g, t⟩, e⟩ => ⟨a, m, e, g, t⟩, fun ⟨a, m, e, g, t⟩ => ⟨a, ⟨m, g, t⟩, e⟩⟩

/-- A sender is present right after any word but goodbye, and absent right after goodbye. -/
theorem heard_present (h : r.receive network members now m = .ok r') :
    (m.sender ∈ r'.present now ↔ m.kind ≠ .bye) := by
  obtain ⟨_, _, e, _, _⟩ := receive_ok h
  rw [mem_present, e]
  constructor
  · rintro ⟨s, ms, se, g, _⟩
    rcases List.mem_cons.mp ms with rfl | ms
    · simpa using g
    · simp only [List.mem_filter, bne_iff_ne, ne_eq] at ms
      exact absurd se ms.2
  · intro k
    exact ⟨_, List.mem_cons_self .., rfl, by simpa using k, Nat.lt_add_of_pos_right (by decide)⟩

end Room

/-! ## Examples

Messages as they arrive and what the room shows after each, written out by hand. The door admits `alice`, `bob` and
`aven`; `eve` is no member. Each step is a message (its sender, time, kind, line, and how it is tampered with) arriving
at a time, or the clock moving on. -/

/-- What an attacker does to a message after it was signed. -/
inductive Tamper where
  | none
  /-- signed by another key -/
  | signer (k : String)
  /-- its line changed after signing -/
  | text (s : String)
  /-- sent to another network's room -/
  | network (n : String)
  /-- its announced size changed after signing -/
  | size (n : Nat)
  deriving DecidableEq, Repr

def Message.make (sender : String) (time : Nat) (kind : Kind) (text : String) (t : Tamper := .none)
    (file : Option Announce := none) : Message :=
  let network := match t with | .network n => n | _ => "aven"
  let m : Message := ⟨network, sender, time, kind, text, file, sender, ""⟩
  let m := { m with signed := m.body }
  match t with
  | .signer k => { m with signer := k }
  | .text s => { m with text := s }
  | .size n => { m with file := m.file.map ({ · with size := n }) }
  | _ => m

inductive Step where
  | arrive (now : Nat) (m : Message)
  | clock (now : Nat)
  deriving DecidableEq, Repr

def Step.now : Step → Nat
  | .arrive now _ => now
  | .clock now => now

def members : List String := ["alice", "aven", "bob"]

def Room.step (r : Room) : Step → Option Refusal × Room
  | .arrive now m => match r.receive "aven" members now m with
    | .ok r' => (none, r')
    | .error why => (some why, r)
  | .clock _ => (none, r)

def Room.run (r : Room) : List Step → List (Option Refusal × Room)
  | [] => []
  | s :: ss =>
    let (answer, r') := r.step s
    (answer, r') :: r'.run ss

def long : String := String.ofList (List.replicate (maxText + 1) 'a')
def longest : String := String.ofList (List.replicate maxText 'a')

/-- Each example: its steps, and after each the answer, who is present and how many lines were said. -/
def chatExamples : List (String × List Step × List (Option Refusal × List String × Nat)) := [
  ("members say here and chat; the room shows them, in order",
    [.arrive 0 (.make "alice" 0 .here ""), .arrive 5 (.make "bob" 5 .here ""), .arrive 9 (.make "alice" 9 .say "hi"),
      .arrive 12 (.make "bob" 12 .say "hello")],
    [(none, ["alice"], 0), (none, ["alice", "bob"], 0), (none, ["alice", "bob"], 1), (none, ["alice", "bob"], 2)]),
  ("the Aven Peer's join line", [.arrive 0 (.make "aven" 0 .say "bob joined")], [(none, ["aven"], 1)]),
  ("a stranger's message is dropped", [.arrive 0 (.make "eve" 0 .say "let me in"), .arrive 1 (.make "eve" 1 .here "")],
    [(some .notMember, [], 0), (some .notMember, [], 0)]),
  ("a message signed by another key", [.arrive 0 (.make "bob" 0 .say "it's alice" (.signer "alice"))],
    [(some .badSignature, [], 0)]),
  ("a stranger signs as a member", [.arrive 0 (.make "alice" 0 .say "hi" (.signer "eve"))],
    [(some .badSignature, [], 0)]),
  ("a line changed after signing", [.arrive 0 (.make "alice" 0 .say "hi" (.text "bye"))],
    [(some .badSignature, [], 0)]),
  ("another network's room", [.arrive 0 (.make "alice" 0 .say "hi" (.network "other"))],
    [(some .wrongNetwork, [], 0)]),
  ("a message replayed, and one older than the last",
    [.arrive 0 (.make "alice" 10 .say "hi"), .arrive 1 (.make "alice" 10 .say "hi"), .arrive 2 (.make "alice" 5 .here "")],
    [(none, ["alice"], 1), (some .stale, ["alice"], 1), (some .stale, ["alice"], 1)]),
  ("an empty line, and the longest one and one byte more",
    [.arrive 0 (.make "alice" 0 .say ""), .arrive 1 (.make "alice" 1 .say longest), .arrive 2 (.make "alice" 2 .say long)],
    [(some .empty, [], 0), (none, ["alice"], 1), (some .tooLong, ["alice"], 1)]),
  ("a line in a here", [.arrive 0 (.make "alice" 0 .here "psst")], [(some .notSaid, [], 0)]),
  ("goodbye takes a member out; a word brings it back",
    [.arrive 0 (.make "alice" 0 .here ""), .arrive 1 (.make "bob" 1 .here ""), .arrive 2 (.make "bob" 2 .bye ""),
      .arrive 3 (.make "bob" 3 .say "back")],
    [(none, ["alice"], 0), (none, ["alice", "bob"], 0), (none, ["alice"], 0), (none, ["alice", "bob"], 1)]),
  ("a member quiet for longer than ttl is gone",
    [.arrive 0 (.make "alice" 0 .here ""), .arrive 20000 (.make "bob" 20000 .here ""), .clock 29999, .clock 30000,
      .arrive 30001 (.make "alice" 30001 .here ""), .clock 49999, .clock 50000],
    [(none, ["alice"], 0), (none, ["alice", "bob"], 0), (none, ["alice", "bob"], 0), (none, ["bob"], 0),
      (none, ["alice", "bob"], 0), (none, ["alice", "bob"], 0), (none, ["alice"], 0)])]

def Room.shows (r : Room) (steps : List Step) : List (Option Refusal × List String × Nat) :=
  (steps.zip (r.run steps)).map fun (s, answer, r') => (answer, r'.present s.now, r'.said.length)

#guard chatExamples.all fun (_, steps, want) => ({} : Room).shows steps == want

/-- A file's announcement, as the examples make one: a movie's index and its size. -/
def movie : Announce := ⟨Blake3.hash [1, 2, 3], 209715200, "a movie.mp4", "video/mp4"⟩

/-- Each example: its steps, and after each the answer and the files announced so far, by sender and name. -/
def fileExamples : List (String × List Step × List (Option Refusal × List (String × String))) := [
  ("a member announces a file; the room keeps it",
    [.arrive 0 (.make "alice" 0 .file "" .none (some movie)), .arrive 1 (.make "bob" 1 .file "" .none (some
      { movie with name := "notes.pdf", type := "application/pdf", size := 0 }))],
    [(none, [("alice", "a movie.mp4")]), (none, [("alice", "a movie.mp4"), ("bob", "notes.pdf")])]),
  ("a stranger's announcement is dropped", [.arrive 0 (.make "eve" 0 .file "" .none (some movie))],
    [(some .notMember, [])]),
  ("an announcement changed after signing, or signed by another key",
    [.arrive 0 (.make "alice" 0 .file "" (.size 1) (some movie)),
      .arrive 1 (.make "bob" 1 .file "" (.signer "alice") (some movie))],
    [(some .badSignature, []), (some .badSignature, [])]),
  ("an announcement replayed is stale",
    [.arrive 0 (.make "alice" 7 .file "" .none (some movie)), .arrive 1 (.make "alice" 7 .file "" .none (some movie))],
    [(none, [("alice", "a movie.mp4")]), (some .stale, [("alice", "a movie.mp4")])]),
  ("a file without an announcement, or with a hash, a name or a type that isn't valid",
    [.arrive 0 (.make "alice" 0 .file ""), .arrive 1 (.make "alice" 1 .file "" .none (some { movie with file := "abc" })),
      .arrive 2 (.make "alice" 2 .file "" .none (some { movie with name := "" })),
      .arrive 3 (.make "alice" 3 .file "" .none (some { movie with name := "two\nlines" })),
      .arrive 4 (.make "alice" 4 .file "" .none (some { movie with type := String.ofList (List.replicate (maxName + 1) 'a') })),
      .arrive 5 (.make "alice" 5 .file "" .none (some { movie with type := String.ofList (List.replicate maxName 'a') }))],
    [(some .badFile, []), (some .badFile, []), (some .badFile, []), (some .badFile, []), (some .badFile, []),
      (none, [("alice", "a movie.mp4")])]),
  ("a line with an announcement, and an announcement with a line",
    [.arrive 0 (.make "alice" 0 .say "look" .none (some movie)), .arrive 1 (.make "alice" 1 .file "look" .none (some movie)),
      .arrive 2 (.make "alice" 2 .here "" .none (some movie))],
    [(some .notSaid, []), (some .notSaid, []), (some .notSaid, [])])]

def Room.announced (r : Room) (steps : List Step) : List (Option Refusal × List (String × String)) :=
  (r.run steps).map fun (answer, r') => (answer, r'.files.map fun (who, a) => (who, a.name))

#guard fileExamples.all fun (_, steps, want) => ({} : Room).announced steps == want

end Aven.DB.Chat

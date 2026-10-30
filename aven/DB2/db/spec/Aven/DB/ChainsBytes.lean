import Aven.DB.Chains

/-!
# A line's bytes are canonical

A line travels and rests as a blob, and its name is the hash of those bytes. So one signed line must have exactly one
blob: if two blobs read as the same line, a relaying peer could hand on a copy with the same valid signature but
another name, and a copy that reached the Aven Peer first would make the device's real line look like a fork.

`read` takes a blob only when it is exactly the bytes its fields render to (`Fields.blob`): every hex field lower-case
and of its length (the device's key, the previous line's hash, the signature), every number in canonical decimal, the
network on one line. Anything else is refused as `notCanonical`. Then:

- a blob read is the bytes its line renders to (`read_blob`);
- **one line, one blob, one name:** two blobs read as the same line are the same bytes (`one_id`);
- **the signature covers exactly those bytes:** two blobs whose lines sign the same bytes with the same signature are
  the same bytes (`signed_one_id`), so a signature names one blob.

aven-db-core's `chain::Line::parse` implements `read`; its tests replay the vectors in `vectors/chats.json` (`read`).
-/

namespace Aven.DB.Chains

/-- What a line's blob carries, field by field: the network, the device's key, its number, the previous line's hash,
its time, the signature and the body. -/
structure Fields where
  network : String
  device : String
  seq : Nat
  prev : Option String
  time : Nat
  sig : String
  body : Body
  deriving DecidableEq, Repr, Inhabited

/-- Every field but the signature and the body, as the blob starts: six lines. -/
def Fields.head (f : Fields) : String :=
  "avenDB line 1\nnetwork " ++ f.network ++ "\ndevice " ++ f.device ++ "\nseq " ++ toString f.seq ++ "\nprev " ++
    f.prev.getD "none" ++ "\nat " ++ toString f.time

/-- What the device signs: the head, then the body (`Line.signs`). -/
def Fields.signs (f : Fields) : String := f.head ++ "\n" ++ f.body.render

/-- The blob: the signature after the head. -/
def Fields.blob (f : Fields) : String := f.head ++ "\nsig " ++ f.sig ++ "\n" ++ f.body.render

/-- Exactly `n` lower-case hex digits. -/
def lowerHex (n : Nat) (s : String) : Bool := s.length = n && s.all fun c => c.isDigit || ('a' ≤ c && c ≤ 'f')

/-- The largest number a line carries: Rust's `u64`. -/
def maxNumber : Nat := 2 ^ 64 - 1

/-- Well formed: the device a key, the previous line a hash, the signature 64 bytes, all lower-case hex; the network
on one line; the numbers in range. -/
def Fields.wf (f : Fields) : Bool :=
  f.network.all (· != '\n') && lowerHex 64 f.device && (f.prev.all (lowerHex 64)) && lowerHex 128 f.sig &&
    f.seq ≤ maxNumber && f.time ≤ maxNumber &&
    (match f.body with | .file _ n _ _ => n ≤ maxNumber | .text _ => true)

/-- A number: one or more decimal digits. -/
def number (s : String) : Option Nat :=
  if !s.isEmpty && s.all Char.isDigit then some (s.foldl (fun n c => 10 * n + (c.toNat - '0'.toNat)) 0) else none

/-- `name value`, the value after the name and one space. -/
def field (name : String) (s : String) : Option String :=
  if s.startsWith (name ++ " ") then some (s.drop (name.length + 1)).copy else none

/-- A body read back: a text, or a file's fields, its name the rest. -/
def Body.parse (s : String) : Option Body :=
  if s.startsWith "text\n" then some (.text (s.drop 5).copy)
  else match s.splitOn "\n" with
    | f :: n :: t :: name => do
      let file ← field "file" f
      let size ← number (← field "size" n)
      let type ← field "type" t
      some (.file file size ("\n".intercalate name) type)
    | _ => none

/-- A blob read back as its fields, field by field: the first seven lines, then the body. Lenient on its own; `read`
takes it only when it renders back to the same bytes. -/
def parse (s : String) : Option Fields :=
  match s.splitOn "\n" with
  | v :: n :: d :: q :: p :: a :: g :: body => do
    if v ≠ "avenDB line 1" then none
    let network ← field "network" n
    let device ← field "device" d
    let seq ← number (← field "seq" q)
    let prev ← field "prev" p
    let time ← number (← field "at" a)
    let sig ← field "sig" g
    let body ← Body.parse ("\n".intercalate body)
    some ⟨network, device, seq, if prev = "none" then none else some prev, time, sig, body⟩
  | _ => none

/-- A blob as a line, or `notCanonical`: it must be exactly the bytes its fields render to, well formed. -/
def read (s : String) : Except Refusal Fields :=
  match parse s with
  | some f => if f.blob = s ∧ f.wf then .ok f else .error .notCanonical
  | none => .error .notCanonical

/-! ## Theorems -/

theorem read_blob {s : String} {f : Fields} (h : read s = .ok f) : f.blob = s ∧ f.wf := by
  unfold read at h
  split at h
  · split at h
    · next e => cases h; exact e
    · cases h
  · cases h

/-- **One line, one blob, one name:** two blobs read as the same line are the same bytes, so they hash alike. -/
theorem one_id {s t : String} {f : Fields} (hs : read s = .ok f) (ht : read t = .ok f) : s = t :=
  (read_blob hs).1.symm.trans (read_blob ht).1

/-- Splitting at a newline after the same number of newlines splits alike. -/
theorem split_at_count : ∀ {a a' r r' : List Char}, a.count '\n' = a'.count '\n' →
    a ++ '\n' :: r = a' ++ '\n' :: r' → a = a' ∧ r = r'
  | [], [], _, _, _, e => by simpa using e
  | [], c :: a', _, _, hc, e => by
    simp only [List.nil_append, List.cons_append, List.cons.injEq] at e
    obtain ⟨rfl, -⟩ := e
    simp at hc
  | c :: a, [], _, _, hc, e => by
    simp only [List.nil_append, List.cons_append, List.cons.injEq] at e
    obtain ⟨rfl, -⟩ := e
    simp at hc
  | c :: a, c' :: a', r, r', hc, e => by
    simp only [List.cons_append, List.cons.injEq] at e
    obtain ⟨rfl, e⟩ := e
    have : a.count '\n' = a'.count '\n' := by simpa [List.count_cons] using hc
    obtain ⟨rfl, rfl⟩ := split_at_count this e
    exact ⟨rfl, rfl⟩

theorem count_nl_of_all {s : String} {p : Char → Bool} (h : s.all p) (np : p '\n' = false) :
    s.toList.count '\n' = 0 := by
  rw [List.count_eq_zero]
  intro m
  simp only [String.all_bool_eq, List.all_eq_true] at h
  simp [h _ m] at np

theorem hex_count {n : Nat} {s : String} (h : lowerHex n s) : s.toList.count '\n' = 0 := by
  simp only [lowerHex, Bool.and_eq_true] at h
  exact count_nl_of_all h.2 (by decide)

theorem digits_count (n : Nat) : (Nat.toDigits 10 n).count '\n' = 0 := by
  rw [List.count_eq_zero]
  intro m
  have := Nat.isDigit_of_mem_toDigits (b := 10) (by decide) (by decide) m
  simp at this

/-- A well-formed line's head is six lines: five newlines. -/
theorem head_count {f : Fields} (w : f.wf) : f.head.toList.count '\n' = 5 := by
  simp only [Fields.wf, Bool.and_eq_true] at w
  obtain ⟨⟨⟨⟨⟨⟨hn, hd⟩, hp⟩, -⟩, -⟩, -⟩, -⟩ := w
  have net : f.network.toList.count '\n' = 0 := count_nl_of_all hn (by decide)
  have prev : (f.prev.getD "none").toList.count '\n' = 0 := by
    cases e : f.prev with
    | none => decide
    | some p => rw [e] at hp; exact hex_count (by simpa using hp)
  simp [Fields.head, String.toList_append, List.count_append, net, hex_count hd, prev, digits_count]

/-- **The signature covers exactly the bytes:** two blobs whose lines sign the same bytes with the same signature are
the same bytes. A relaying peer can't re-encode a signed line under another name. -/
theorem signed_one_id {s t : String} {f g : Fields} (hs : read s = .ok f) (ht : read t = .ok g)
    (signs : f.signs = g.signs) (sig : f.sig = g.sig) : s = t := by
  obtain ⟨bs, ws⟩ := read_blob hs
  obtain ⟨bt, wt⟩ := read_blob ht
  have e := congrArg String.toList signs
  simp only [Fields.signs, String.toList_append] at e
  obtain ⟨h, b⟩ := split_at_count ((head_count ws).trans (head_count wt).symm) (by simpa using e)
  rw [← bs, ← bt]
  apply String.toList_injective
  simp [Fields.blob, String.toList_append, h, b, sig]

/-! ## Examples -/

/-- A real-looking line: hex device, previous line and signature. -/
def hexOf (c : Char) (n : Nat) : String := String.ofList (List.replicate n c)

def sample : Fields :=
  ⟨"aven", hexOf 'a' 64, 7, some (hexOf 'b' 64), 1730000000000, hexOf 'c' 128, .text "hi\nthere"⟩

def sampleFile : Fields :=
  { sample with seq := 1, prev := none, body := .file (hexOf 'd' 64) 200000000 "the dome\nat night.mp4" "video/mp4" }

/-- The same line written another way: each is refused. -/
def variants : List (String × String) :=
  let b := sample.blob
  let swap (a c : String) := b.replace a c
  [("a number with a leading zero", swap "\nseq 7\n" "\nseq 007\n"),
   ("a number with a plus", swap "\nseq 7\n" "\nseq +7\n"),
   ("a time with a leading zero", swap "\nat 1730000000000\n" "\nat 01730000000000\n"),
   ("an upper-case device", swap (hexOf 'a' 64) (hexOf 'A' 64)),
   ("an upper-case previous line", swap (hexOf 'b' 64) (hexOf 'B' 64)),
   ("an upper-case signature", swap (hexOf 'c' 128) (hexOf 'C' 128)),
   ("a short signature", swap (hexOf 'c' 128) (hexOf 'c' 126)),
   ("a device padded with a space", swap ("device " ++ hexOf 'a' 64) ("device  " ++ hexOf 'a' 64)),
   ("a number past u64", swap "\nseq 7\n" "\nseq 18446744073709551616\n"),
   ("a file size with a leading zero", sampleFile.blob.replace "size 200000000" "size 0200000000"),
   ("a file size with a plus", sampleFile.blob.replace "size 200000000" "size +200000000"),
   ("a carriage return after the version", swap "avenDB line 1\n" "avenDB line 1\r\n"),
   ("no line at all", "hello")]

def refusedAs (why : Refusal) (s : String) : Bool := match read s with | .error w => w == why | .ok _ => false

#guard (read sample.blob).toOption == some sample
#guard (read sampleFile.blob).toOption == some sampleFile
#guard variants.all fun (_, v) => refusedAs .notCanonical v

end Aven.DB.Chains

import Aven.Core.Cbor
import Aven.Core.CborLaws
import Aven.Core.ValueEq
import Aven.Core.Text
import Aven.Peer.Wire

/-!
# The wire's frames in CBOR (A29, from wire version 2)

From wire version 2, every frame after the greeting is a Value in Core's one codec (rule 1, `Aven.Core.Cbor`): a map
with text keys in the codec's order, sent as its canonical encoding behind a 4-byte big-endian length. The greeting
stays a JSON line, frozen (`Aven.Peer.Wire.Greeting`), so a peer of any version can refuse another with `update`; a peer
sends nothing after its hello until the other's has come.

The rules:
- **one form per frame:** a frame is read only from exactly its keys, each of its kind: no key is optional and none
  is defaulted (README rule 9, A42), so `frameOf` reads back what `frameValue` wrote (`frameOf_value`);
- **one encoding per frame:** each frame names its keys in the codec's order, so a frame that fits the profile is a
  canonical Value (`frameValue_canon`); its bytes are the one encoding of it, a reader refuses any other
  (`Aven.Core.encode_decodeAll`), and reads them back as the frame (`decodeAll_frame`);
- **the length first:** a length above `maxFrame` is refused as soon as its 4 bytes are in, before anything is
  buffered (`push_tooLong`); a length of 0 is no frame;
- **the greeting first:** a stream's first bytes up to its newline are the greeting, at most `maxFrame` of them
  (`greet`); every byte after it is frames.

Text is a `String`'s UTF-8, which is always valid as the codec's table says (`Aven.Core.utf8_text`). A line's blob is
bytes, as CBOR holds them. -/

namespace Aven.Peer
namespace WireCbor

open Aven.Core

/-- The wire version whose frames this module writes. -/
def version : Nat := 3

/-- Text as the codec holds it: its UTF-8 bytes (`Aven.Core.text`). -/
def txt (s : String) : Value := .text (text s)

def readText : Value → Option String
  | .text b => String.fromUTF8? ⟨b.toArray⟩
  | _ => none

/-- A map with these keys, written in the codec's order: each frame names its keys so, and `frameValue_canon` holds
it to that. -/
def obj (kvs : List (String × Value)) : Value := .map (kvs.map fun (k, v) => (text k, v))

/-- The value under a key of a map, if the map has it. -/
def field (kvs : List (Bytes × Value)) (k : String) : Option Value := kvs.lookup (text k)

def keys (kvs : List (Bytes × Value)) : List Bytes := kvs.map (·.1)

/-- A map whose keys are exactly these: the same set, so no key is missing and none is extra. -/
def exactly (kvs : List (Bytes × Value)) (ks : List String) : Bool :=
  kvs.length == ks.length && ks.all fun k => (keys kvs).contains (text k)

def readBytes : Value → Option Bytes
  | .bytes b => some b
  | _ => none

def readNat : Value → Option Nat
  | .uint n => some n
  | _ => none

def readBool : Value → Option Bool
  | .bool b => some b
  | _ => none

def readList (f : Value → Option α) : Value → Option (List α)
  | .array xs => xs.mapM f
  | _ => none

/-- Text or nothing: `null` is the nothing, and the key is there either way. -/
def readOpt : Value → Option (Option String)
  | .null => some none
  | v => some <$> readText v

def optVal : Option String → Value
  | some s => txt s
  | none => .null

def headValue (h : Head) : Value := obj [("id", txt h.id), ("seq", .uint h.seq), ("device", txt h.device)]

def headOf : Value → Option Head
  | .map kvs => do
    guard (exactly kvs ["device", "id", "seq"])
    pure ⟨← readText (← field kvs "device"), ← readText (← field kvs "id"), ← readNat (← field kvs "seq")⟩
  | _ => none

def haveValue (h : Have) : Value := obj [("seq", .uint h.seq), ("device", txt h.device)]

def haveOf : Value → Option Have
  | .map kvs => do
    guard (exactly kvs ["device", "seq"])
    pure ⟨← readText (← field kvs "device"), ← readNat (← field kvs "seq")⟩
  | _ => none

/-- A hash as its Value: its bytes. -/
def hashValue (h : Hash) : Value := .bytes h.bytes

/-- A hash read back: BLAKE3's 32 bytes, nothing else. -/
def hashOf (v : Value) : Option Hash := do
  let b ← readBytes v
  guard (b.length == 32)
  pure ⟨b⟩

/-- A Doc's tip read from exactly its keys, `{seq, name, writer}` (`Aven.Peer.DocSync.Tip.value`). -/
def tipOf : Value → Option DocSync.Tip
  | .map kvs => do
    guard (exactly kvs ["seq", "name", "writer"])
    pure ⟨← readNat (← field kvs "writer"), ← readNat (← field kvs "seq"), ← hashOf (← field kvs "name")⟩
  | _ => none

/-- A frame as its Value. -/
def frameValue : Frame → Value
  | .presence ps => obj [("frame", txt "presence"), ("peers", .array (ps.map txt))]
  | .beat n => obj [("n", .uint n), ("frame", txt "beat")]
  | .claim st => obj [("frame", txt "claim"), ("statement", txt st)]
  | .signIn st => obj [("frame", txt "sign_in"), ("statement", txt st)]
  | .invite st => obj [("frame", txt "invite"), ("statement", txt st)]
  | .withdraw st => obj [("frame", txt "withdraw"), ("statement", txt st)]
  | .join st => obj [("frame", txt "join"), ("statement", txt st)]
  | .network c t st => obj [("tree", optVal t), ("frame", txt "network"), ("claimed", .bool c),
      ("statements", optVal st)]
  | .refused w => obj [("why", txt w), ("frame", txt "refused")]
  | .heads hs more => obj [("more", .bool more), ("frame", txt "heads"), ("heads", .array (hs.map headValue))]
  | .catchUp hs only => obj [("have", .array (hs.map haveValue)), ("only", .bool only), ("frame", txt "catch_up")]
  | .lines ls => obj [("frame", txt "lines"), ("lines", .array (ls.map .bytes))]
  | .kept fs => obj [("files", .array (fs.map txt)), ("frame", txt "kept")]
  | .docTips d ts more => obj [("doc", hashValue d), ("more", .bool more), ("tips", .array (ts.map DocSync.Tip.value)),
      ("frame", txt "doc_tips")]
  | .docHave d vs more => obj [("doc", hashValue d), ("more", .bool more), ("frame", txt "doc_have"),
      ("values", .array (vs.map hashValue))]

/-- A frame read from exactly its keys. -/
def frameOf : Value → Option Frame
  | .map kvs => do
    let one {β : Type} (k : String) (r : Value → Option β) : Option β := field kvs k >>= r
    let statement (mk : String → Frame) : Option Frame := do
      guard (exactly kvs ["frame", "statement"])
      mk <$> one "statement" readText
    match ← one "frame" readText with
    | "presence" => guard (exactly kvs ["frame", "peers"]) *> (.presence <$> one "peers" (readList readText))
    | "beat" => guard (exactly kvs ["frame", "n"]) *> (.beat <$> one "n" readNat)
    | "claim" => statement .claim
    | "sign_in" => statement .signIn
    | "invite" => statement .invite
    | "withdraw" => statement .withdraw
    | "join" => statement .join
    | "network" => do
      guard (exactly kvs ["frame", "claimed", "tree", "statements"])
      pure (.network (← one "claimed" readBool) (← one "tree" readOpt) (← one "statements" readOpt))
    | "refused" => guard (exactly kvs ["frame", "why"]) *> (.refused <$> one "why" readText)
    | "heads" => do
      guard (exactly kvs ["frame", "heads", "more"])
      pure (.heads (← one "heads" (readList headOf)) (← one "more" readBool))
    | "catch_up" => do
      guard (exactly kvs ["frame", "have", "only"])
      pure (.catchUp (← one "have" (readList haveOf)) (← one "only" readBool))
    | "lines" => guard (exactly kvs ["frame", "lines"]) *> (.lines <$> one "lines" (readList readBytes))
    | "kept" => guard (exactly kvs ["frame", "files"]) *> (.kept <$> one "files" (readList readText))
    | "doc_tips" => do
      guard (exactly kvs ["frame", "doc", "tips", "more"])
      pure (.docTips (← one "doc" hashOf) (← one "tips" (readList tipOf)) (← one "more" readBool))
    | "doc_have" => do
      guard (exactly kvs ["frame", "doc", "values", "more"])
      pure (.docHave (← one "doc" hashOf) (← one "values" (readList hashOf)) (← one "more" readBool))
    | _ => none
  | _ => none

/-- A frame's bytes on the stream: its encoding's length, 4 bytes big-endian, then the encoding. -/
def frameBytes (f : Frame) : Bytes :=
  let e := encode (frameValue f)
  be 4 e.length ++ e

/-- What the stream buffers after its greeting: the next frame, if it is all in, and what stays buffered. -/
def step (buf : Bytes) : Except WireError (Option (Frame × Bytes)) :=
  if buf.length < 4 then .ok none
  else
    let n := beNat (buf.take 4)
    if n > maxFrame then .error .tooLong
    else if n = 0 then .error .bad
    else if buf.length < 4 + n then .ok none
    else match decodeAll ((buf.drop 4).take n) >>= frameOf with
      | some f => .ok (some (f, buf.drop (4 + n)))
      | none => .error .bad

/-- One chunk of bytes on top of what is buffered: every whole frame, and what stays buffered. -/
def push (buf chunk : Bytes) : Except WireError (List Frame × Bytes) :=
  go (buf ++ chunk).length (buf ++ chunk) []
where
  go : Nat → Bytes → List Frame → Except WireError (List Frame × Bytes)
    | 0, bs, acc => .ok (acc.reverse, bs)
    | fuel + 1, bs, acc => do
      match ← step bs with
      | some (f, rest) => go fuel rest (f :: acc)
      | none => pure (acc.reverse, bs)

def decode (chunks : List Bytes) : List (List Frame) × Option WireError := Id.run do
  let mut buf : Bytes := []
  let mut out := #[]
  for c in chunks do
    match push buf c with
    | .ok (fs, rest) => out := out.push fs; buf := rest
    | .error e => return (out.toList, some e)
  return (out.toList, none)

/-- A stream's greeting: its bytes up to the first newline, a JSON line (`Aven.Peer.Wire.Greeting`); none yet while the
newline hasn't come; refused once more than `maxFrame` bytes came without it. Returns the bytes after it. -/
def greet (buf : Bytes) : Except WireError (Option (Greeting × Bytes)) :=
  match buf.idxOf? 10 with
  | none => if buf.length > maxFrame then .error .tooLong else .ok none
  | some i =>
    if i > maxFrame then .error .tooLong
    else match String.fromUTF8? ⟨(buf.take i).toArray⟩ >>= Greeting.parse with
      | some g => .ok (some (g, buf.drop (i + 1)))
      | none => .error .bad

/-- A whole stream as it is read, chunk by chunk: its greeting once its line is in, then the frames each chunk
completes, until something is refused. -/
def read (chunks : List Bytes) : Option Greeting × List (List Frame) × Option WireError := Id.run do
  let mut buf : Bytes := []
  let mut greeting : Option Greeting := none
  let mut out := #[]
  for c in chunks do
    buf := buf ++ c
    if greeting.isNone then
      match greet buf with
      | .error e => return (greeting, out.toList, some e)
      | .ok none => out := out.push []; continue
      | .ok (some (g, rest)) => greeting := some g; buf := rest
    match push [] buf with
    | .ok (fs, rest) => out := out.push fs; buf := rest
    | .error e => return (greeting, out.toList, some e)
  return (greeting, out.toList, none)

/-- A greeting's bytes: its JSON line. -/
def greetingBytes (g : Greeting) : Bytes := text (g.json.compress ++ "\n")

/-! ## What it proves -/

/-- **The length first:** a length over `maxFrame` is refused once its 4 bytes are in, whatever follows. -/
theorem step_tooLong {buf : Bytes} (h4 : 4 ≤ buf.length) (hn : maxFrame < beNat (buf.take 4)) :
    step buf = .error .tooLong := by
  unfold step
  simp only [Nat.not_lt.mpr h4, ↓reduceIte, gt_iff_lt, hn]

theorem push_tooLong {buf chunk : Bytes} (h4 : 4 ≤ (buf ++ chunk).length)
    (hn : maxFrame < beNat ((buf ++ chunk).take 4)) : push buf chunk = .error .tooLong := by
  unfold push
  generalize e : (buf ++ chunk).length = m
  cases m with
  | zero => omega
  | succ m =>
    simp only [push.go, step_tooLong h4 hn]
    rfl

/-! ### One form per frame -/

@[simp] theorem readText_txt (s : String) : readText (txt s) = some s := fromUTF8_text s

@[simp] theorem text_beq (a b : String) : (text a == text b) = (a == b) := by
  rw [Bool.eq_iff_iff, beq_iff_eq, beq_iff_eq, text_inj]

@[simp] theorem readList_txt (ls : List String) : readList readText (.array (ls.map txt)) = some ls := by
  induction ls with
  | nil => rfl
  | cons l ls ih =>
    simp only [readList, List.map_cons, List.mapM_cons, readText_txt] at ih ⊢
    rw [ih]; rfl

@[simp] theorem headOf_headValue (h : Head) : headOf (headValue h) = some h := by
  simp [headOf, headValue, obj, exactly, keys, field, List.lookup, guard, readNat]

@[simp] theorem haveOf_haveValue (h : Have) : haveOf (haveValue h) = some h := by
  simp [haveOf, haveValue, obj, exactly, keys, field, List.lookup, guard, readNat]

theorem readList_map {f : α → Value} {g : Value → Option α} (hg : ∀ a, g (f a) = some a) :
    ∀ (xs : List α), readList g (.array (xs.map f)) = some xs
  | [] => rfl
  | x :: xs => by
    have := readList_map hg xs
    simp only [readList, List.map_cons, List.mapM_cons, hg] at this ⊢
    rw [this]; rfl

theorem readBytes_bytes (b : Bytes) : readBytes (.bytes b) = some b := rfl

@[simp] theorem some_seqRight (x : Option α) : (some () *> x) = x := rfl

@[simp] theorem readOpt_optVal (o : Option String) : readOpt (optVal o) = some o := by
  cases o with
  | none => rfl
  | some s => exact congrArg (Option.map some) (readText_txt s)

theorem readList_map_of {f : α → Value} {g : Value → Option α} :
    ∀ (xs : List α), (∀ a ∈ xs, g (f a) = some a) → readList g (.array (xs.map f)) = some xs
  | [], _ => rfl
  | x :: xs, h => by
    have := readList_map_of xs fun a m => h a (List.mem_cons_of_mem _ m)
    simp only [readList, List.map_cons, List.mapM_cons, h x (List.mem_cons_self ..)] at this ⊢
    rw [this]; rfl

theorem hashOf_hashValue {h : Hash} (ok : h.bytes.length = 32) : hashOf (hashValue h) = some h := by
  cases h
  simp_all [hashOf, hashValue, readBytes, guard]

theorem tipOf_value {t : DocSync.Tip} (ok : t.name.bytes.length = 32) : tipOf t.value = some t := by
  obtain ⟨w, s, ⟨n⟩⟩ := t
  simp_all [tipOf, DocSync.Tip.value, exactly, keys, field, List.lookup, guard, readNat, hashOf, readBytes]

/-- A frame's hashes are BLAKE3's 32 bytes, as every peer writes them; the reader refuses any other. -/
def HashesOk : Frame → Prop
  | .docTips d ts _ => d.bytes.length = 32 ∧ ∀ t ∈ ts, t.name.bytes.length = 32
  | .docHave d vs _ => d.bytes.length = 32 ∧ ∀ v ∈ vs, v.bytes.length = 32
  | _ => True

/-- **One form per frame:** a frame reads back from the Value it is written as. -/
theorem frameOf_value (f : Frame) (ok : HashesOk f) : frameOf (frameValue f) = some f := by
  cases f
  case docTips d ts m =>
    obtain ⟨hd, ht⟩ := ok
    have r : readList tipOf (.array (ts.map DocSync.Tip.value)) = some ts :=
      readList_map_of ts fun t m => tipOf_value (ht t m)
    simp [frameValue, frameOf, obj, exactly, keys, field, List.lookup, guard, readBool, r, hashOf_hashValue hd]
  case docHave d vs m =>
    obtain ⟨hd, hv⟩ := ok
    have r : readList hashOf (.array (vs.map hashValue)) = some vs :=
      readList_map_of vs fun v m => hashOf_hashValue (hv v m)
    simp [frameValue, frameOf, obj, exactly, keys, field, List.lookup, guard, readBool, r, hashOf_hashValue hd]
  all_goals simp only [frameValue] <;>
    simp [frameOf, obj, exactly, keys, field, List.lookup, readList_map headOf_headValue,
      readList_map haveOf_haveValue, readList_map readBytes_bytes, guard, readNat, readBool]

/-! ### One encoding per frame -/

/-- Text the profile can write: its UTF-8 shorter than 2⁶⁴ bytes. -/
abbrev Short (s : String) : Prop := (text s).length < limit

/-- What the profile can write of a frame: every number below 2⁶⁴, every text and list shorter. Every frame a peer
sends fits: `maxFrame` is far below. -/
def Fits : Frame → Prop
  | .presence ps | .kept ps => ps.length < limit ∧ ∀ p ∈ ps, Short p
  | .lines ls => ls.length < limit ∧ ∀ l ∈ ls, l.length < limit
  | .beat n => n < limit
  | .claim st | .signIn st | .invite st | .withdraw st | .join st | .refused st => Short st
  | .network _ t st => (∀ s, t = some s → Short s) ∧ (∀ s, st = some s → Short s)
  | .heads hs _ => hs.length < limit ∧ ∀ h ∈ hs, Short h.device ∧ Short h.id ∧ h.seq < limit
  | .catchUp hs _ => hs.length < limit ∧ ∀ h ∈ hs, Short h.device ∧ h.seq < limit
  | .docTips d ts _ => d.bytes.length < limit ∧ ts.length < limit ∧
      ∀ t ∈ ts, t.seq < limit ∧ t.writer < limit ∧ t.name.bytes.length < limit
  | .docHave d vs _ => d.bytes.length < limit ∧ vs.length < limit ∧ ∀ v ∈ vs, v.bytes.length < limit

theorem shape_txt {s : String} (h : Short s) : Shape (txt s) = true := by
  simp [txt, Shape, textOk, utf8_text, show (text _).length < limit from h]

theorem textOk_key (k : String) (h : Short k) : textOk (text k) = true := by
  simp [textOk, utf8_text, show (text _).length < limit from h]

theorem shapeList_map {f : α → Value} {xs : List α} (P : α → Prop) (hf : ∀ a, P a → Shape (f a) = true)
    (hx : ∀ a ∈ xs, P a) : ShapeList (xs.map f) = true := by
  induction xs with
  | nil => rfl
  | cons x xs ih =>
    simp only [List.map_cons, ShapeList, hf x (hx x (List.mem_cons_self ..)), Bool.true_and]
    exact ih fun a m => hx a (List.mem_cons_of_mem _ m)

theorem depthList_map {f : α → Value} {d : Nat} (hf : ∀ a, depth (f a) ≤ d) :
    ∀ (xs : List α), depthList (xs.map f) ≤ d
  | [] => Nat.zero_le _
  | x :: xs => by
    simp only [List.map_cons, depthList]
    exact Nat.max_le.mpr ⟨hf x, depthList_map hf xs⟩



theorem headShape {h : Head} (f : Short h.device ∧ Short h.id ∧ h.seq < limit) : Shape (headValue h) = true := by
  simp [headValue, obj, Shape, ShapeMap, keysSorted, shape_txt f.1, shape_txt f.2.1, f.2.2, textOk_key,
    show Short "id" by decide, show Short "seq" by decide, show Short "device" by decide]
  decide

theorem haveShape {h : Have} (f : Short h.device ∧ h.seq < limit) : Shape (haveValue h) = true := by
  simp [haveValue, obj, Shape, ShapeMap, keysSorted, shape_txt f.1, f.2, textOk_key,
    show Short "seq" by decide, show Short "device" by decide]
  decide

theorem tipShape {t : DocSync.Tip} (f : t.seq < limit ∧ t.writer < limit ∧ t.name.bytes.length < limit) :
    Shape t.value = true := by
  simp [DocSync.Tip.value, Shape, ShapeMap, keysSorted, f.1, f.2.1, f.2.2, textOk_key,
    show Short "seq" by decide, show Short "name" by decide, show Short "writer" by decide]
  decide

/-- **One encoding per frame:** a frame that fits is a canonical Value, so its bytes are the one encoding of it and
every reader decodes them to it (`Aven.Core.decodeAll_encode`). -/
theorem frameValue_canon {f : Frame} (fits : Fits f) : Canon (frameValue f) = true := by
  cases f <;> simp only [frameValue] <;> simp only [Fits] at fits <;>
    simp (config := { decide := true }) [Canon, obj, Shape, ShapeMap, keysSorted, depth, depthMap, txt, textOk,
      utf8_text, optVal, hashValue]
  case beat => exact fits
  case claim | signIn | invite | withdraw | join | refused => exact fits
  case lines =>
    refine ⟨⟨fits.1, shapeList_map (fun l : Bytes => l.length < limit) (fun _ h => by simp [Shape, h]) fits.2⟩, ?_⟩
    have := depthList_map (f := Value.bytes) (d := 1) (fun _ => Nat.le_refl _) ‹List Bytes›
    simp only [maxDepth]; omega
  case presence | kept =>
    refine ⟨⟨fits.1, shapeList_map Short (fun _ h => shape_txt h) fits.2⟩, ?_⟩
    have := depthList_map (f := txt) (d := 1) (fun _ => Nat.le_refl _) ‹List String›
    simp only [maxDepth]; omega
  case heads =>
    refine ⟨⟨fits.1, shapeList_map _ (fun _ h => headShape h) fits.2⟩, ?_⟩
    have := depthList_map (f := headValue) (d := 2) (fun _ => by simp [headValue, obj, depth, depthMap, txt])
      ‹List Head›
    simp only [maxDepth]; omega
  case catchUp =>
    refine ⟨⟨fits.1, shapeList_map _ (fun _ h => haveShape h) fits.2⟩, ?_⟩
    have := depthList_map (f := haveValue) (d := 2) (fun _ => by simp [haveValue, obj, depth, depthMap, txt])
      ‹List Have›
    simp only [maxDepth]; omega
  case docTips =>
    obtain ⟨hd, hl, ht⟩ := fits
    refine ⟨⟨hd, hl, shapeList_map _ (fun _ h => tipShape h) ht⟩, ?_⟩
    have := depthList_map (f := DocSync.Tip.value) (d := 2)
      (fun _ => by simp [DocSync.Tip.value, depth, depthMap]) ‹List DocSync.Tip›
    simp only [maxDepth]; omega
  case docHave =>
    obtain ⟨hd, hl, hv⟩ := fits
    refine ⟨⟨hd, hl, shapeList_map (fun v : Hash => v.bytes.length < limit)
      (fun _ h => by simp [hashValue, Shape, h]) hv⟩, ?_⟩
    have := depthList_map (f := hashValue) (d := 1) (fun _ => by simp [hashValue, depth]) ‹List Hash›
    simp only [maxDepth]; omega
  case network =>
    rename_i t st
    obtain ⟨ht, hs⟩ := fits
    cases t <;> cases st <;> simp_all [Shape, textOk, utf8_text, depth, maxDepth]

/-- **A frame's bytes are read back as it:** whatever fits, written to the stream, is read as itself. -/
theorem decodeAll_frame {f : Frame} (fits : Fits f) (ok : HashesOk f) :
    (decodeAll (encode (frameValue f)) >>= frameOf) = some f := by
  rw [decodeAll_encode _ (frameValue_canon fits)]
  exact frameOf_value f ok

/-! ## Examples -/

def heads2 : List Head := [⟨"ab", "cd", 2⟩, ⟨"ef", "01", 0⟩]

def frameExamples : List Frame := [
  .presence ["alice-peer", "aven-peer"], .presence [], .beat 7, .beat (2 ^ 64 - 1), .claim "{}", .signIn "{\"a\":1}",
  .invite "{}", .withdraw "{}", .join "{}", .network false none none, .network true (some "{}") (some "[]"),
  .refused "taken", .heads heads2 true, .heads [] false, .catchUp [⟨"ab", 1⟩] true, .catchUp [] false,
  .lines [[0x78], [], [0, 255]], .kept ["ab", "cd"], .refused "café ✓",
  .docTips (blake3 [1]) [⟨1, 3, blake3 [2]⟩, ⟨2, 1, blake3 [3]⟩] true, .docTips (blake3 [1]) [] false,
  .docHave (blake3 [1]) [blake3 [4], blake3 [5]] false, .docHave (blake3 [1]) [] true]

-- **One form per frame:** every frame reads back from its Value.
#guard frameExamples.all fun f => frameOf (frameValue f) == some f
-- **One encoding:** every frame's Value is canonical, and its bytes decode to it.
#guard frameExamples.all fun f => Canon (frameValue f) && decodeAll (encode (frameValue f)) == some (frameValue f)

def bytesOf (fs : List Frame) : Bytes := (fs.map frameBytes).flatten

-- whole frames in one chunk; the same cut anywhere
#guard decode [bytesOf frameExamples] == ([frameExamples], none)
#guard (List.range (bytesOf (frameExamples.take 3)).length).all fun i =>
  let bs := bytesOf (frameExamples.take 3)
  (decode ([bs.take i, bs.drop i] : List Bytes)).1.flatten == frameExamples.take 3

-- a key missing, a key extra, a key of the wrong kind: refused, never defaulted
def framed (v : Value) : Bytes := let e := encode v; be 4 e.length ++ e
#guard decode [framed (obj [("frame", txt "heads"), ("heads", .array [])])] == ([], some .bad)
#guard decode [framed (obj [("n", .uint 1), ("extra", .null), ("frame", txt "beat")])] == ([], some .bad)
#guard decode [framed (obj [("n", txt "1"), ("frame", txt "beat")])] == ([], some .bad)
#guard decode [framed (obj [("frame", txt "shout")])] == ([], some .bad)
-- a Doc's id that isn't 32 bytes, a tip with a key extra, a hash that isn't bytes: refused
#guard decode [framed (obj [("doc", .bytes [1]), ("more", .bool false), ("frame", txt "doc_have"),
  ("values", .array [])])] == ([], some .bad)
#guard decode [framed (obj [("doc", hashValue (blake3 [1])), ("more", .bool false),
  ("tips", .array [obj [("x", .null), ("seq", .uint 1), ("name", hashValue (blake3 [2])), ("writer", .uint 1)]]),
  ("frame", txt "doc_tips")])] == ([], some .bad)
#guard decode [framed (obj [("doc", hashValue (blake3 [1])), ("more", .bool false), ("frame", txt "doc_have"),
  ("values", .array [txt "x"])])] == ([], some .bad)
-- bytes that aren't the canonical encoding: a number in a longer form than it needs
#guard decode [be 4 4 ++ [0xA1, 0x61, 0x6E, 0x18]] == ([], some .bad)
-- a length of none, of more than the limit, and of exactly the limit, waiting
#guard decode [[0, 0, 0, 0]] == ([], some .bad)
#guard decode [be 4 (maxFrame + 1)] == ([], some .tooLong)
#guard decode [be 4 maxFrame] == ([[]], none)
-- fewer than 4 bytes: it waits
#guard decode [[0, 0]] == ([[]], none)

-- **A page fits a frame:** `pageSize` heads or files of the longest kind (64-digit keys and names, the largest number)
-- are well under `maxFrame`
def longest : List Head := List.replicate pageSize ⟨String.ofList (List.replicate 64 'f'),
  String.ofList (List.replicate 64 'e'), 2 ^ 64 - 1⟩
#guard (frameBytes (.heads longest true)).length * 2 < maxFrame
#guard (frameBytes (.kept (List.replicate pageSize (String.ofList (List.replicate 64 'f'))))).length * 2 < maxFrame
#guard (frameBytes (.docTips (blake3 [1]) (List.replicate pageSize ⟨2 ^ 64 - 1, 2 ^ 64 - 1, blake3 [2]⟩) true)).length * 2
  < maxFrame
#guard (frameBytes (.docHave (blake3 [1]) (List.replicate pageSize (blake3 [2])) true)).length * 2 < maxFrame

-- a stream: the greeting's line, then frames; cut anywhere, the same
def stream : Bytes := greetingBytes (.hello "alice-peer" wireVersion) ++ bytesOf (frameExamples.take 3)
#guard read [stream] == (some (.hello "alice-peer" wireVersion), [frameExamples.take 3], none)
#guard (List.range stream.length).all fun i =>
  let (g, fs, e) := read ([stream.take i, stream.drop i] : List Bytes)
  g == some (.hello "alice-peer" wireVersion) && fs.flatten == frameExamples.take 3 && e.isNone
-- an update in the hello's place, then nothing
#guard read [greetingBytes (.update wireVersion)] == (some (.update wireVersion), [[]], none)
-- version 0's hello, without its version: no greeting
#guard read [text "{\"frame\":\"hello\",\"peer\":\"a\"}\n"] == (none, [], some .bad)
-- a line without its newline, past the limit
#guard read [List.replicate (maxFrame + 1) 0x61] == (none, [], some .tooLong)

end WireCbor
end Aven.Peer

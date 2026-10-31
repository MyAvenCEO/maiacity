import Aven.Core.Cbor
import Aven.Core.CborLaws
import Aven.Core.ValueEq
import Aven.Core.Text
import Aven.Peer.Wire
import Aven.Peer.Fetch
import Aven.Peer.Keeper

/-!
# The wire's frames in CBOR (A29, wire version 3)

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

/-- An arrival as a keeper tells it: its number and sealed hash. -/
def entryValue (e : Nat × Bytes) : Value := obj [("n", .uint e.1), ("hash", .bytes e.2)]

def entryOf : Value → Option (Nat × Bytes)
  | .map kvs => do
    guard (exactly kvs ["n", "hash"])
    pure (← readNat (← field kvs "n"), ← readBytes (← field kvs "hash"))
  | _ => none

def hashesValue (hs : List Bytes) : Value := .array (hs.map .bytes)

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
  | .prove d k sg => obj [("doc", .bytes d), ("key", .bytes k), ("sig", .bytes sg), ("frame", txt "prove")]
  | .proven d => obj [("doc", .bytes d), ("frame", txt "proven")]
  | .proveRefused d w => obj [("doc", .bytes d), ("why", txt w), ("frame", txt "prove_refused")]
  | .fetch d hs => obj [("doc", .bytes d), ("frame", txt "fetch"), ("hashes", hashesValue hs)]
  | .items d h a t b => obj [("at", .uint a), ("doc", .bytes d), ("hash", .bytes h), ("bytes", .bytes b),
      ("frame", txt "items"), ("total", .uint t)]
  | .missing d hs => obj [("doc", .bytes d), ("frame", txt "missing"), ("hashes", hashesValue hs)]
  | .fetched d hs => obj [("doc", .bytes d), ("frame", txt "fetched"), ("later", hashesValue hs)]
  | .fetchRefused d w => obj [("doc", .bytes d), ("why", txt w), ("frame", txt "fetch_refused")]
  | .keepAfter d n => obj [("n", .uint n), ("doc", .bytes d), ("frame", txt "keep_after")]
  | .keepArrived d es more => obj [("doc", .bytes d), ("more", .bool more), ("frame", txt "keep_arrived"),
      ("entries", .array (es.map entryValue))]
  | .keepPut d h t b cs => obj [("doc", .bytes d), ("hash", .bytes h), ("bytes", .bytes b), ("frame", txt "keep_put"),
      ("total", .uint t), ("covers", hashesValue cs)]
  | .keepPart d h a t b => obj [("at", .uint a), ("doc", .bytes d), ("hash", .bytes h), ("bytes", .bytes b),
      ("frame", txt "keep_part"), ("total", .uint t)]
  | .keepEnd d => obj [("doc", .bytes d), ("frame", txt "keep_end")]
  | .keepTook d es => obj [("doc", .bytes d), ("frame", txt "keep_took"), ("numbers", .array (es.map entryValue))]
  | .keepRefused d w => obj [("doc", .bytes d), ("why", txt w), ("frame", txt "keep_refused")]

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
    | "prove" => do
      guard (exactly kvs ["frame", "doc", "key", "sig"])
      pure (.prove (← one "doc" readBytes) (← one "key" readBytes) (← one "sig" readBytes))
    | "proven" => guard (exactly kvs ["frame", "doc"]) *> (.proven <$> one "doc" readBytes)
    | "prove_refused" => do
      guard (exactly kvs ["frame", "doc", "why"])
      pure (.proveRefused (← one "doc" readBytes) (← one "why" readText))
    | "fetch" => do
      guard (exactly kvs ["frame", "doc", "hashes"])
      pure (.fetch (← one "doc" readBytes) (← one "hashes" (readList readBytes)))
    | "items" => do
      guard (exactly kvs ["frame", "doc", "hash", "at", "total", "bytes"])
      pure (.items (← one "doc" readBytes) (← one "hash" readBytes) (← one "at" readNat) (← one "total" readNat)
        (← one "bytes" readBytes))
    | "missing" => do
      guard (exactly kvs ["frame", "doc", "hashes"])
      pure (.missing (← one "doc" readBytes) (← one "hashes" (readList readBytes)))
    | "fetched" => do
      guard (exactly kvs ["frame", "doc", "later"])
      pure (.fetched (← one "doc" readBytes) (← one "later" (readList readBytes)))
    | "fetch_refused" => do
      guard (exactly kvs ["frame", "doc", "why"])
      pure (.fetchRefused (← one "doc" readBytes) (← one "why" readText))
    | "keep_after" => do
      guard (exactly kvs ["frame", "doc", "n"])
      pure (.keepAfter (← one "doc" readBytes) (← one "n" readNat))
    | "keep_arrived" => do
      guard (exactly kvs ["frame", "doc", "entries", "more"])
      pure (.keepArrived (← one "doc" readBytes) (← one "entries" (readList entryOf)) (← one "more" readBool))
    | "keep_put" => do
      guard (exactly kvs ["frame", "doc", "hash", "total", "bytes", "covers"])
      pure (.keepPut (← one "doc" readBytes) (← one "hash" readBytes) (← one "total" readNat)
        (← one "bytes" readBytes) (← one "covers" (readList readBytes)))
    | "keep_part" => do
      guard (exactly kvs ["frame", "doc", "hash", "at", "total", "bytes"])
      pure (.keepPart (← one "doc" readBytes) (← one "hash" readBytes) (← one "at" readNat) (← one "total" readNat)
        (← one "bytes" readBytes))
    | "keep_end" => guard (exactly kvs ["frame", "doc"]) *> (.keepEnd <$> one "doc" readBytes)
    | "keep_took" => do
      guard (exactly kvs ["frame", "doc", "numbers"])
      pure (.keepTook (← one "doc" readBytes) (← one "numbers" (readList entryOf)))
    | "keep_refused" => do
      guard (exactly kvs ["frame", "doc", "why"])
      pure (.keepRefused (← one "doc" readBytes) (← one "why" readText))
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

@[simp] theorem entryOf_entryValue (e : Nat × Bytes) : entryOf (entryValue e) = some e := by
  simp [entryOf, entryValue, obj, exactly, keys, field, List.lookup, guard, readNat, readBytes]

@[simp] theorem some_seqRight (x : Option α) : (some () *> x) = x := rfl

@[simp] theorem readOpt_optVal (o : Option String) : readOpt (optVal o) = some o := by
  cases o with
  | none => rfl
  | some s => exact congrArg (Option.map some) (readText_txt s)

/-- **One form per frame:** a frame reads back from the Value it is written as. -/
theorem frameOf_value (f : Frame) : frameOf (frameValue f) = some f := by
  cases f <;> simp only [frameValue] <;>
    simp [frameOf, obj, exactly, keys, field, List.lookup, readList_map headOf_headValue,
      readList_map haveOf_haveValue, readList_map readBytes_bytes, readList_map entryOf_entryValue, hashesValue,
      guard, readNat, readBool, readBytes]

/-! ### One encoding per frame -/

/-- Text the profile can write: its UTF-8 shorter than 2⁶⁴ bytes. -/
abbrev Short (s : String) : Prop := (text s).length < limit

/-- The longest reason a refusal names, in UTF-8 bytes: a refusal never carries a frame-sized text. -/
def whyMax : Nat := 64

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
  | .prove d k sg => d.length < limit ∧ k.length < limit ∧ sg.length < limit
  | .proven d | .keepEnd d => d.length < limit
  | .proveRefused d w | .fetchRefused d w | .keepRefused d w => d.length < limit ∧ (text w).length ≤ whyMax
  | .fetch d hs | .missing d hs | .fetched d hs => d.length < limit ∧ hs.length < limit ∧ ∀ h ∈ hs, h.length < limit
  | .items d h a t b => d.length < limit ∧ h.length < limit ∧ a < limit ∧ t < limit ∧ b.length < limit
  | .keepAfter d n => d.length < limit ∧ n < limit
  | .keepArrived d es _ | .keepTook d es => d.length < limit ∧ es.length < limit ∧ ∀ e ∈ es, e.1 < limit ∧ e.2.length < limit
  | .keepPut d h t b cs => d.length < limit ∧ h.length < limit ∧ t < limit ∧ b.length < limit ∧
      cs.length < limit ∧ ∀ c ∈ cs, c.length < limit
  | .keepPart d h a t b => d.length < limit ∧ h.length < limit ∧ a < limit ∧ t < limit ∧ b.length < limit

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

theorem entryShape {e : Nat × Bytes} (f : e.1 < limit ∧ e.2.length < limit) : Shape (entryValue e) = true := by
  simp [entryValue, obj, Shape, ShapeMap, keysSorted, f.1, f.2, textOk_key, show Short "n" by decide,
    show Short "hash" by decide]
  decide

theorem bytesShape : ∀ b : Bytes, b.length < limit → Shape (.bytes b) = true := fun _ h => by simp [Shape, h]

/-- **One encoding per frame:** a frame that fits is a canonical Value, so its bytes are the one encoding of it and
every reader decodes them to it (`Aven.Core.decodeAll_encode`). -/
theorem frameValue_canon {f : Frame} (fits : Fits f) : Canon (frameValue f) = true := by
  cases f <;> simp only [frameValue] <;> simp only [Fits] at fits <;>
    simp (config := { decide := true }) [Canon, obj, Shape, ShapeMap, keysSorted, depth, depthMap, txt, textOk,
      utf8_text, optVal, hashesValue]
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
  case prove | proven | keepEnd => exact fits
  case proveRefused | fetchRefused | keepRefused =>
    exact ⟨fits.1, Nat.lt_of_le_of_lt fits.2 (by decide)⟩
  case keepPart => obtain ⟨d, h, a, t, b⟩ := fits; exact ⟨a, d, h, b, t⟩
  case items => obtain ⟨d, h, a, t, b⟩ := fits; exact ⟨a, d, h, b, t⟩
  case keepAfter => exact ⟨fits.2, fits.1⟩
  case fetch | missing | fetched =>
    refine ⟨⟨fits.1, fits.2.1, shapeList_map _ bytesShape fits.2.2⟩, ?_⟩
    have := depthList_map (f := Value.bytes) (d := 1) (fun _ => Nat.le_refl _) ‹List Bytes›
    simp only [maxDepth]; omega
  case keepArrived | keepTook =>
    refine ⟨⟨fits.1, fits.2.1, shapeList_map _ (fun _ h => entryShape h) fits.2.2⟩, ?_⟩
    have := depthList_map (f := entryValue) (d := 2) (fun _ => by simp [entryValue, obj, depth, depthMap])
      ‹List (Nat × Bytes)›
    simp only [maxDepth]; omega
  case keepPut =>
    obtain ⟨d, h, t, b, cl, cs⟩ := fits
    have sl := shapeList_map _ bytesShape cs
    have := depthList_map (f := Value.bytes) (d := 1) (fun _ => Nat.le_refl _) ‹List Bytes›
    refine ⟨by simp_all, ?_⟩
    simp only [maxDepth]; omega
  case network =>
    rename_i t st
    obtain ⟨ht, hs⟩ := fits
    cases t <;> cases st <;> simp_all [Shape, textOk, utf8_text, depth, maxDepth]

/-- **A frame's bytes are read back as it:** whatever fits, written to the stream, is read as itself. -/
theorem decodeAll_frame {f : Frame} (fits : Fits f) : (decodeAll (encode (frameValue f)) >>= frameOf) = some f := by
  rw [decodeAll_encode _ (frameValue_canon fits)]
  exact frameOf_value f

/-! ## Examples -/

def heads2 : List Head := [⟨"ab", "cd", 2⟩, ⟨"ef", "01", 0⟩]

def frameExamples : List Frame := [
  .presence ["alice-peer", "aven-peer"], .presence [], .beat 7, .beat (2 ^ 64 - 1), .claim "{}", .signIn "{\"a\":1}",
  .invite "{}", .withdraw "{}", .join "{}", .network false none none, .network true (some "{}") (some "[]"),
  .refused "taken", .heads heads2 true, .heads [] false, .catchUp [⟨"ab", 1⟩] true, .catchUp [] false,
  .lines [[0x78], [], [0, 255]], .kept ["ab", "cd"], .refused "café ✓",
  .prove (List.replicate 32 1) (List.replicate 32 2) (List.replicate 64 3), .proven (List.replicate 32 1),
  .proveRefused (List.replicate 32 1) "not current", .fetch (List.replicate 32 1) [List.replicate 32 9, []],
  .fetch [] [], .items (List.replicate 32 1) (List.replicate 32 9) 0 3 [7, 7, 7],
  .missing (List.replicate 32 1) [List.replicate 32 8], .fetched (List.replicate 32 1) [],
  .fetchRefused (List.replicate 32 1) "too many", .keepAfter (List.replicate 32 1) 0,
  .keepArrived (List.replicate 32 1) [(1, List.replicate 32 9), (2 ^ 64 - 1, [])] true,
  .keepArrived (List.replicate 32 1) [] false,
  .keepPut (List.replicate 32 1) (List.replicate 32 9) 4 [5, 6] [List.replicate 32 8],
  .keepPut (List.replicate 32 1) (List.replicate 32 9) 2 [5, 6] [], .keepPart (List.replicate 32 1) (List.replicate 32 9) 2 4 [7, 8],
  .keepEnd (List.replicate 32 1), .keepTook (List.replicate 32 1) [(3, List.replicate 32 9)],
  .keepRefused (List.replicate 32 1) "quota"]

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

-- **The keepers' and the fetch gate's frames fit too,** at their limits: 32-byte hashes, `fetchHashes` of them, a page
-- of `pageSize` arrivals with the largest number, a part of `partBytes` with `coversMax` covers, `putsPerUpload` numbers
def h32 : Bytes := List.replicate 32 0xff
#guard (frameBytes (.fetch h32 (List.replicate Fetch.fetchHashes h32))).length < maxFrame
#guard (frameBytes (.missing h32 (List.replicate Fetch.fetchHashes h32))).length < maxFrame
#guard (frameBytes (.fetched h32 (List.replicate Fetch.fetchHashes h32))).length < maxFrame
#guard (frameBytes (.items h32 h32 (2 ^ 64 - 1) (2 ^ 64 - 1) (List.replicate Fetch.partBytes 0))).length < maxFrame
#guard (frameBytes (.keepArrived h32 (List.replicate pageSize (2 ^ 64 - 1, h32)) true)).length < maxFrame
#guard (frameBytes (.keepPut h32 h32 (2 ^ 64 - 1) (List.replicate Fetch.partBytes 0)
  (List.replicate Keeper.coversMax h32))).length < maxFrame
#guard (frameBytes (.keepPart h32 h32 (2 ^ 64 - 1) (2 ^ 64 - 1) (List.replicate Fetch.partBytes 0))).length < maxFrame
-- a refusal's reason at its longest
def why64 : String := String.ofList (List.replicate whyMax 'w')
#guard (text why64).length ≤ whyMax
#guard [Frame.proveRefused h32 why64, .fetchRefused h32 why64, .keepRefused h32 why64].all fun f =>
  (frameBytes f).length * 100 < maxFrame
-- covers can't slip into a later part, nor an offset into a first part: each shape's keys exactly
#guard decode [framed (obj [("at", .uint 1), ("doc", .bytes h32), ("hash", .bytes h32), ("bytes", .bytes []),
  ("frame", txt "keep_part"), ("total", .uint 2), ("covers", .array [])])] == ([], some .bad)
#guard decode [framed (obj [("at", .uint 0), ("doc", .bytes h32), ("hash", .bytes h32), ("bytes", .bytes []),
  ("frame", txt "keep_put"), ("total", .uint 2), ("covers", .array [])])] == ([], some .bad)
#guard (frameBytes (.keepTook h32 (List.replicate Keeper.putsPerUpload (2 ^ 64 - 1, h32)))).length < maxFrame

-- a stream: the greeting's line, then frames; cut anywhere, the same
def stream : Bytes := greetingBytes (.hello "alice-peer" 2) ++ bytesOf (frameExamples.take 3)
#guard read [stream] == (some (.hello "alice-peer" 2), [frameExamples.take 3], none)
#guard (List.range stream.length).all fun i =>
  let (g, fs, e) := read ([stream.take i, stream.drop i] : List Bytes)
  g == some (.hello "alice-peer" 2) && fs.flatten == frameExamples.take 3 && e.isNone
-- an update in the hello's place, then nothing
#guard read [greetingBytes (.update 2)] == (some (.update 2), [[]], none)
-- version 0's hello, without its version: no greeting
#guard read [text "{\"frame\":\"hello\",\"peer\":\"a\"}\n"] == (none, [], some .bad)
-- a line without its newline, past the limit
#guard read [List.replicate (maxFrame + 1) 0x61] == (none, [], some .tooLong)

end WireCbor
end Aven.Peer

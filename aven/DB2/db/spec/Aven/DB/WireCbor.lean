import Aven.Core.Cbor
import Aven.Core.CborLaws
import Aven.Core.ValueEq
import Aven.DB.Wire

/-!
# The wire's frames in CBOR (A29, wire version 2)

From wire version 2, every frame after the hello is a Value in Core's one codec (rule 1, `Aven.Core.Cbor`): a map
with text keys, sorted as the codec sorts them, sent as its canonical encoding behind a 4-byte big-endian length. JSON
lines stay for one thing only, the hello and its `update` (`Aven.DB.Wire`): the first frame's form is frozen, as the
ALPN's name is, so a peer of any version reads another's hello and can refuse it with `update` (PEERS.md §7). A peer
of version 2 sends nothing after its hello until the other's has come, so a peer of version 1 never reads CBOR.

The rules:
- **one form per frame:** a frame is read only from exactly its keys, each of its kind: no key is optional and none
  is defaulted (README rule 9), so `frameOf` reads back what `frameValue` wrote and nothing else (every example;
  the general theorem is still to prove);
- **one encoding per frame:** a frame's bytes are the canonical encoding of its Value, and a reader refuses any other
  (`Aven.Core.encode_decodeAll`; every example's Value is `Canon`);
- **the length first:** a length above `maxFrame` is refused as soon as its 4 bytes are in, before anything is
  buffered (`push_tooLong`); a length of 0 is no frame.

Still open before the Rust moves: `frameOf_value` and `Canon (frameValue f)` for every frame whose numbers are below
2⁶⁴, proved rather than checked on examples; and whether `lines` carries its blobs as bytes rather than text. -/

namespace Aven.DB
namespace WireCbor

open Aven.Core

/-- The wire version whose frames this module writes. -/
def version : Nat := 2

/-- Text as the codec holds it: its UTF-8 bytes. -/
def txt (s : String) : Value := .text s.toUTF8.toList

def readText : Value → Option String
  | .text b => String.fromUTF8? ⟨b.toArray⟩
  | _ => none

def keyLt (a b : Bytes) : Bool := lexLt (keyBytes a) (keyBytes b)

def insertKey (kv : Bytes × Value) : List (Bytes × Value) → List (Bytes × Value)
  | [] => [kv]
  | x :: xs => if keyLt kv.1 x.1 then kv :: x :: xs else x :: insertKey kv xs

/-- A map with these keys, sorted as the codec sorts them. -/
def obj (kvs : List (String × Value)) : Value :=
  .map (kvs.foldr (fun (k, v) acc => insertKey (k.toUTF8.toList, v) acc) [])

/-- The value under a key of a map, if the map has it. -/
def field (kvs : List (Bytes × Value)) (k : String) : Option Value := kvs.lookup k.toUTF8.toList

def keys (kvs : List (Bytes × Value)) : List Bytes := kvs.map (·.1)

/-- A map whose keys are exactly these: the same set, so no key is missing and none is extra. -/
def exactly (kvs : List (Bytes × Value)) (ks : List String) : Bool :=
  kvs.length == ks.length && ks.all fun k => (keys kvs).contains k.toUTF8.toList

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

def headValue (h : Head) : Value := obj [("device", txt h.device), ("id", txt h.id), ("seq", .uint h.seq)]

def headOf : Value → Option Head
  | .map kvs => do
    guard (exactly kvs ["device", "id", "seq"])
    pure ⟨← readText (← field kvs "device"), ← readText (← field kvs "id"), ← readNat (← field kvs "seq")⟩
  | _ => none

def haveValue (h : Have) : Value := obj [("device", txt h.device), ("seq", .uint h.seq)]

def haveOf : Value → Option Have
  | .map kvs => do
    guard (exactly kvs ["device", "seq"])
    pure ⟨← readText (← field kvs "device"), ← readNat (← field kvs "seq")⟩
  | _ => none

/-- The frames after the hello: `Aven.DB.Wire.Frame` but its hello and `update`, which stay JSON lines. -/
def frameValue : Frame → Option Value
  | .hello .. | .update _ => none
  | .presence ps => obj [("frame", txt "presence"), ("peers", .array (ps.map txt))]
  | .beat n => obj [("frame", txt "beat"), ("n", .uint n)]
  | .claim st => obj [("frame", txt "claim"), ("statement", txt st)]
  | .signIn st => obj [("frame", txt "sign_in"), ("statement", txt st)]
  | .invite st => obj [("frame", txt "invite"), ("statement", txt st)]
  | .withdraw st => obj [("frame", txt "withdraw"), ("statement", txt st)]
  | .join st => obj [("frame", txt "join"), ("statement", txt st)]
  | .network c t st => obj [("frame", txt "network"), ("claimed", .bool c), ("tree", optVal t),
      ("statements", optVal st)]
  | .refused w => obj [("frame", txt "refused"), ("why", txt w)]
  | .heads hs more => obj [("frame", txt "heads"), ("heads", .array (hs.map headValue)), ("more", .bool more)]
  | .catchUp hs only => obj [("frame", txt "catch_up"), ("have", .array (hs.map haveValue)), ("only", .bool only)]
  | .lines ls => obj [("frame", txt "lines"), ("lines", .array (ls.map txt))]
  | .kept fs => obj [("frame", txt "kept"), ("files", .array (fs.map txt))]

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
    | "lines" => guard (exactly kvs ["frame", "lines"]) *> (.lines <$> one "lines" (readList readText))
    | "kept" => guard (exactly kvs ["frame", "files"]) *> (.kept <$> one "files" (readList readText))
    | _ => none
  | _ => none

/-- A frame's bytes on the stream: its encoding's length, 4 bytes big-endian, then the encoding. -/
def frameBytes (f : Frame) : Option Bytes := do
  let e := encode (← frameValue f)
  pure (be 4 e.length ++ e)

/-- What the stream buffers, the frames it gives and how it ends, as `Aven.DB.Wire.push` for JSON lines. -/
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

/-! ## Examples -/

def heads2 : List Head := [⟨"ab", "cd", 2⟩, ⟨"ef", "01", 0⟩]

def frameExamples : List Frame := [
  .presence ["alice-peer", "aven-peer"], .presence [], .beat 7, .beat (2 ^ 64 - 1), .claim "{}", .signIn "{\"a\":1}",
  .invite "{}", .withdraw "{}", .join "{}", .network false none none, .network true (some "{}") (some "[]"),
  .refused "taken", .heads heads2 true, .heads [] false, .catchUp [⟨"ab", 1⟩] true, .catchUp [] false,
  .lines ["x", "y"], .kept ["ab", "cd"], .refused "café ✓"]

-- **One form per frame:** every frame reads back from its Value.
#guard frameExamples.all fun f => (frameValue f >>= frameOf) == some f
-- **One encoding:** every frame's Value is canonical, and its bytes decode to it.
#guard frameExamples.all fun f => match frameValue f with
  | some v => Canon v && decodeAll (encode v) == some v
  | none => false
-- The hello and `update` have no CBOR form: they stay JSON lines.
#guard (frameValue (.hello "a" 2)).isNone && (frameValue (.update 2)).isNone

def bytesOf (fs : List Frame) : Bytes := (fs.filterMap frameBytes).flatten

-- whole frames in one chunk; the same cut anywhere
#guard decode [bytesOf frameExamples] == ([frameExamples], none)
#guard (List.range (bytesOf (frameExamples.take 3)).length).all fun i =>
  let bs := bytesOf (frameExamples.take 3)
  (decode ([bs.take i, bs.drop i] : List Bytes)).1.flatten == frameExamples.take 3

-- a key missing, a key extra, a key of the wrong kind: refused, never defaulted
def framed (v : Value) : Bytes := let e := encode v; be 4 e.length ++ e
#guard decode [framed (obj [("frame", txt "heads"), ("heads", .array [])])] == ([], some .bad)
#guard decode [framed (obj [("frame", txt "beat"), ("n", .uint 1), ("extra", .null)])] == ([], some .bad)
#guard decode [framed (obj [("frame", txt "beat"), ("n", txt "1")])] == ([], some .bad)
#guard decode [framed (obj [("frame", txt "shout")])] == ([], some .bad)
-- bytes that aren't the canonical encoding: a number in a longer form than it needs
#guard decode [be 4 4 ++ [0xA1, 0x61, 0x6E, 0x18]] == ([], some .bad)
-- a length of none, of more than the limit, and of exactly the limit, waiting
#guard decode [[0, 0, 0, 0]] == ([], some .bad)
#guard decode [be 4 (maxFrame + 1)] == ([], some .tooLong)
#guard decode [be 4 maxFrame] == ([[]], none)
-- fewer than 4 bytes: it waits
#guard decode [[0, 0]] == ([[]], none)

end WireCbor
end Aven.DB

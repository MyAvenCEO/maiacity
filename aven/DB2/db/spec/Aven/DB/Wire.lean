import Lean.Data.Json

/-!
# The wire

Our one protocol (README, rule 9), on ALPN `aven/db/1`: frames, one JSON object per line on one stream each way. The
reading half takes bytes as they come and gives whole frames: a line is a frame once its newline arrives, a line that
isn't one is refused, and so is a line that grows past `maxFrame` bytes without its newline. `aven-db-core`'s `wire`
module implements it, and its tests replay the vectors.
-/

open Lean

namespace Aven.DB

inductive Frame where
  /-- the first frame each side sends: the cast's id of the peer it is -/
  | hello (peer : String)
  /-- the Aven Peer tells each peer who is connected, itself included, on every change -/
  | presence (peers : List String)
  /-- the Aven Peer's clock, once per step -/
  | beat (n : Nat)
  deriving DecidableEq, Repr

/-- A line longer than this, without its newline, is refused: no peer needs one. -/
def maxFrame : Nat := 64 * 1024

def Frame.json : Frame → Json
  | .hello p => Json.mkObj [("frame", "hello"), ("peer", p)]
  | .presence ps => Json.mkObj [("frame", "presence"), ("peers", toJson ps)]
  | .beat n => Json.mkObj [("frame", "beat"), ("n", toJson n)]

def Frame.parse (line : String) : Option Frame := do
  let j ← (Json.parse line).toOption
  match ← (j.getObjValAs? String "frame").toOption with
  | "hello" => .hello <$> (j.getObjValAs? String "peer").toOption
  | "presence" => .presence <$> (j.getObjValAs? (List String) "peers").toOption
  | "beat" => .beat <$> (j.getObjValAs? Nat "n").toOption
  | _ => none

inductive WireError where
  | bad
  | tooLong
  deriving DecidableEq, Repr

/-- One chunk of bytes on top of what is buffered: the whole frames, and what stays buffered. -/
def push (buf chunk : String) : Except WireError (List Frame × String) := do
  let lines := (buf ++ chunk).splitOn "\n"
  let rest := lines.getLastD ""
  let frames ← lines.dropLast.mapM fun l => match Frame.parse l with
    | some f => .ok f
    | none => .error .bad
  if rest.utf8ByteSize > maxFrame then throw .tooLong
  pure (frames, rest)

/-- What a stream reads chunk by chunk: the frames of each push, until one is refused. -/
def decode (chunks : List String) : List (List Frame) × Option WireError := Id.run do
  let mut buf := ""
  let mut out := #[]
  for c in chunks do
    match push buf c with
    | .ok (fs, rest) => out := out.push fs; buf := rest
    | .error e => return (out.toList, some e)
  return (out.toList, none)

/-! ## Examples

Chunks as they arrive and the frames each one completes, written out by hand. -/

def wireExamples : List (String × List String × List (List Frame) × Option WireError) := [
  ("three frames in one chunk",
    ["{\"frame\":\"hello\",\"peer\":\"alice-peer\"}\n{\"frame\":\"presence\",\"peers\":[\"a\"]}\n{\"frame\":\"beat\",\"n\":7}\n"],
    [[.hello "alice-peer", .presence ["a"], .beat 7]], none),
  ("a frame split across chunks", ["{\"frame\":\"be", "at\",\"n\":1}", "\n"], [[], [], [.beat 1]], none),
  ("two frames, then half a third", ["{\"frame\":\"beat\",\"n\":1}\n{\"frame\":\"beat\",\"n\":2}\n{\"frame\":"],
    [[.beat 1, .beat 2]], none),
  ("presence of nobody", ["{\"frame\":\"presence\",\"peers\":[]}\n"], [[.presence []]], none),
  ("a line that isn't JSON", ["nope\n"], [], some .bad),
  ("a frame no peer sends", ["{\"frame\":\"shout\"}\n"], [], some .bad),
  ("a beat without its count", ["{\"frame\":\"beat\"}\n"], [], some .bad),
  ("refused after the frames before it", ["{\"frame\":\"beat\",\"n\":3}\n", "{\"frame\":\n"], [[.beat 3]], some .bad),
  ("a line of exactly the limit waits", [String.ofList (List.replicate maxFrame 'x')], [[]], none),
  ("an endless line is refused", [String.ofList (List.replicate (maxFrame + 1) 'x')], [], some .tooLong)]

#guard wireExamples.all fun (_, chunks, frames, err) => decode chunks == (frames, err)

end Aven.DB

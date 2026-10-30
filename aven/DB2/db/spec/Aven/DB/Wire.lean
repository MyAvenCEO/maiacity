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

/-- A device's chain as a peer holds it: the device's key, its newest line's name, and that line's number. -/
structure Head where
  device : String
  id : String
  seq : Nat
  deriving DecidableEq, Repr, ToJson, FromJson

/-- How far a peer holds a device's chain: the number of its newest line there. -/
structure Have where
  device : String
  seq : Nat
  deriving DecidableEq, Repr, ToJson, FromJson

inductive Frame where
  /-- the first frame each side sends: the cast's id of the peer it is -/
  | hello (peer : String)
  /-- the Aven Peer tells each peer who is connected, itself included, on every change -/
  | presence (peers : List String)
  /-- the Aven Peer's clock, once per step -/
  | beat (n : Nat)
  /-- a browser signs up first, so claims an unclaimed network: the claim's statement (`Aven.ID.Claim`) as JSON text -/
  | claim (statement : String)
  /-- a browser signs in with the passkey that claimed the network: the sign-in's statement as JSON text -/
  | signIn (statement : String)
  /-- the admin invites (`Aven.ID.Invite`): the invite's statement as JSON text -/
  | invite (statement : String)
  /-- the admin withdraws an open invite -/
  | withdraw (statement : String)
  /-- a browser joins with an invite -/
  | join (statement : String)
  /-- an Aven Peer that keeps its tree tells each peer whether it is claimed and, to a device the door admits, the
  tree and every statement it holds, so each peer checks the members itself -/
  | network (claimed : Bool) (tree : Option String) (statements : Option String)
  /-- a statement the Aven Peer refused, and why -/
  | refused (why : String)
  /-- the Aven Peer tells a member's peer the head of every chain it keeps (`Aven.DB.Chains`), once linked -/
  | heads (heads : List Head)
  /-- a peer asks for every line newer than what it holds of each chain; a chain it doesn't name, from the first -/
  | catchUp («have» : List Have)
  /-- lines as their blobs, oldest first per chain: the Aven Peer's answer to `catchUp`, or a peer's own lines the
  Aven Peer is missing -/
  | lines (lines : List String)
  deriving DecidableEq, Repr

/-- A line longer than this, without its newline, is refused: no peer needs one. -/
def maxFrame : Nat := 64 * 1024

def Frame.json : Frame → Json
  | .hello p => Json.mkObj [("frame", "hello"), ("peer", p)]
  | .presence ps => Json.mkObj [("frame", "presence"), ("peers", toJson ps)]
  | .beat n => Json.mkObj [("frame", "beat"), ("n", toJson n)]
  | .claim st => Json.mkObj [("frame", "claim"), ("statement", st)]
  | .signIn st => Json.mkObj [("frame", "sign_in"), ("statement", st)]
  | .invite st => Json.mkObj [("frame", "invite"), ("statement", st)]
  | .withdraw st => Json.mkObj [("frame", "withdraw"), ("statement", st)]
  | .join st => Json.mkObj [("frame", "join"), ("statement", st)]
  | .network c t st => Json.mkObj [("frame", "network"), ("claimed", toJson c), ("tree", toJson t),
      ("statements", toJson st)]
  | .refused w => Json.mkObj [("frame", "refused"), ("why", w)]
  | .heads hs => Json.mkObj [("frame", "heads"), ("heads", toJson hs)]
  | .catchUp hs => Json.mkObj [("frame", "catch_up"), ("have", toJson hs)]
  | .lines ls => Json.mkObj [("frame", "lines"), ("lines", toJson ls)]

def Frame.parse (line : String) : Option Frame := do
  let j ← (Json.parse line).toOption
  match ← (j.getObjValAs? String "frame").toOption with
  | "hello" => .hello <$> (j.getObjValAs? String "peer").toOption
  | "presence" => .presence <$> (j.getObjValAs? (List String) "peers").toOption
  | "beat" => .beat <$> (j.getObjValAs? Nat "n").toOption
  | "claim" => .claim <$> (j.getObjValAs? String "statement").toOption
  | "sign_in" => .signIn <$> (j.getObjValAs? String "statement").toOption
  | "invite" => .invite <$> (j.getObjValAs? String "statement").toOption
  | "withdraw" => .withdraw <$> (j.getObjValAs? String "statement").toOption
  | "join" => .join <$> (j.getObjValAs? String "statement").toOption
  | "network" =>
    -- `statements` absent, as an Aven Peer before milestone 2 sends it: none
    let statements := (j.getObjValAs? (Option String) "statements").toOption.join
    (.network · · statements) <$> (j.getObjValAs? Bool "claimed").toOption <*>
      (j.getObjValAs? (Option String) "tree").toOption
  | "refused" => .refused <$> (j.getObjValAs? String "why").toOption
  | "heads" => .heads <$> (j.getObjValAs? (List Head) "heads").toOption
  | "catch_up" => .catchUp <$> (j.getObjValAs? (List Have) "have").toOption
  | "lines" => .lines <$> (j.getObjValAs? (List String) "lines").toOption
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
  ("a claim, a sign-in, then the network and a refusal",
    ["{\"frame\":\"claim\",\"statement\":\"{}\"}\n{\"frame\":\"sign_in\",\"statement\":\"{}\"}\n",
      "{\"frame\":\"network\",\"claimed\":false,\"tree\":null}\n{\"frame\":\"network\",\"claimed\":true,\"tree\":\"{}\"}\n",
      "{\"frame\":\"refused\",\"why\":\"taken\"}\n"],
    [[.claim "{}", .signIn "{}"], [.network false none none, .network true (some "{}") none], [.refused "taken"]], none),
  ("an invite, a withdrawal and a join, then the network with its statements",
    ["{\"frame\":\"invite\",\"statement\":\"{}\"}\n{\"frame\":\"withdraw\",\"statement\":\"{}\"}\n{\"frame\":\"join\",\"statement\":\"{}\"}\n",
      "{\"frame\":\"network\",\"claimed\":true,\"tree\":\"{}\",\"statements\":\"{}\"}\n"],
    [[.invite "{}", .withdraw "{}", .join "{}"], [.network true (some "{}") (some "{}")]], none),
  ("catching up: the heads, what a peer holds, and the lines",
    ["{\"frame\":\"heads\",\"heads\":[{\"device\":\"ab\",\"id\":\"cd\",\"seq\":2}]}\n",
      "{\"frame\":\"catch_up\",\"have\":[{\"device\":\"ab\",\"seq\":1}]}\n{\"frame\":\"lines\",\"lines\":[\"x\",\"y\"]}\n",
      "{\"frame\":\"heads\",\"heads\":[]}\n{\"frame\":\"catch_up\",\"have\":[]}\n"],
    [[.heads [⟨"ab", "cd", 2⟩]], [.catchUp [⟨"ab", 1⟩], .lines ["x", "y"]], [.heads [], .catchUp []]], none),
  ("a head without its number", ["{\"frame\":\"heads\",\"heads\":[{\"device\":\"ab\",\"id\":\"cd\"}]}\n"], [],
    some .bad),
  ("a join without its statement", ["{\"frame\":\"join\"}\n"], [], some .bad),
  ("a claim without its statement", ["{\"frame\":\"claim\"}\n"], [], some .bad),
  ("a line that isn't JSON", ["nope\n"], [], some .bad),
  ("a frame no peer sends", ["{\"frame\":\"shout\"}\n"], [], some .bad),
  ("a beat without its count", ["{\"frame\":\"beat\"}\n"], [], some .bad),
  ("refused after the frames before it", ["{\"frame\":\"beat\",\"n\":3}\n", "{\"frame\":\n"], [[.beat 3]], some .bad),
  ("a line of exactly the limit waits", [String.ofList (List.replicate maxFrame 'x')], [[]], none),
  ("an endless line is refused", [String.ofList (List.replicate (maxFrame + 1) 'x')], [], some .tooLong)]

#guard wireExamples.all fun (_, chunks, frames, err) => decode chunks == (frames, err)

end Aven.DB

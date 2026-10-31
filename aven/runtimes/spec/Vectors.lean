import Aven.Runtime
import Lean.Data.Json

/-!
# The test vectors (aven/DB2/README.md, rule 10)

`lake exe vectors [DIR]` writes the examples and generated cases as JSON, one vector per line, into `DIR` (`vectors/`
by default), where they are committed. Every vector is `{"name", "input", "expected"}`, except the table's rows:

- `table.json`: the registry itself, one row per type, then one per signature: the data the registry crate compiles
  in.
- `registry.json`: a stage, a head (hex), a size and a claim; the decision and the Service Worker's headers
  (`Aven.Runtime.Registry`). The examples, then heads cut and changed at random from them, under random claims.
- `tree.json`: a node tree and its encoding; whether the applier's check passes it (`Aven.Runtime.Tree`).
- `face.json`: a face's tree, its style as typed rules (`Aven.Runtime.Style`) in a Value's JSON form, and its
  encoding; whether it is accepted, what is wrong with it (names, roles, `alt`, which rules are out of range), every
  text with its colour, what it is drawn on, its size in pixels where a slide is narrowest and its weight, and the CSS
  text. The todo app's task row and the a11y cases, then avenBRAIN's slide "A key signs" and what its checks refuse.
- `contract.json`: each failure and an answer as the Value the host hands on, encoded; render keys and their names
  under BLAKE3 (`Aven.Runtime.Contract`).
- `state.json`: a state part, a turn's input and limits, in the one codec; the result the host hands on
  (`Aven.Runtime.State`): the task and list actors of the todo app, hostile parts and inputs among them.
- `contrast.json`: `linear`, the table every contrast check uses, then pairs of colours with their luminances and
  whether they reach 4.5:1 and 3:1.
- `markdown.json`: headings and the ids markdown-runtime gives them; links under rules and what they become, or null
  when only their text stays; links resolved against their document (`base`, `idPrefix`), and resolved and rewritten
  under the brain's rules (`Aven.Runtime.Markdown`).
- `face-runtime.json`: a face part and face data in the one codec; the result the host hands on, the tree, the style
  as typed rules and the placements, or the failure (`Aven.Runtime.FaceRuntime`).
- `markup.json`: markup and face data; the drawn tree, the placements, and whether face-runtime gives the face
  (`faceRun`). The todo app's row and list, and hostile markup whose tags, attributes, URLs and events must go.
-/

open Lean Aven.Core Aven.Runtime

def vector (name : String) (input expected : Json) : Json :=
  Json.mkObj [("name", name), ("input", input), ("expected", expected)]

/-- xorshift64, as the other specs' property tests draw. -/
structure Rng where
  s : UInt64

def Rng.seed (n : Nat) : Rng := ⟨(n.toUInt64 * 0x9e3779b97f4a7c15) ||| 1⟩

def Rng.below (r : Rng) (n : Nat) : Nat × Rng :=
  let x := r.s ^^^ (r.s <<< 13)
  let x := x ^^^ (x >>> 7)
  let x := x ^^^ (x <<< 17)
  (x.toNat % n, ⟨x⟩)

def generated : Nat := 200

/-! ## The registry -/

namespace Aven.Runtime

def Element.json : Element → Json
  | .img => "img" | .audio => "audio" | .video => "video"

def Output.json : Output → Json
  | .tree => "tree" | .pixels => "pixels" | .table => "table"

def Limits.json (l : Limits) : Json :=
  Json.mkObj [("fuel", l.fuel), ("memory", l.memory), ("output", l.output)]

def Mode.json : Mode → Json
  | .native e => Json.mkObj [("native", e.json)]
  | .frame => "frame"
  | .runtime n o l => Json.mkObj [("runtime", n), ("output", o.json), ("limits", l.json)]
  | .download => "download"

def Serve.json : Serve → Json
  | .inline m => Json.mkObj [("inline", m)]
  | .worker => "worker"
  | .attachment => "attachment"

def Claim.json (c : Claim) : Json :=
  Json.mkObj [("type", match c.type with | some t => Json.str t | none => Json.null),
    ("name", match c.name with | some n => Json.str n | none => Json.null)]

def Decision.json (d : Decision) : Json :=
  Json.mkObj [("type", d.type.name), ("mime", d.type.mime), ("mode", d.mode.json), ("serve", d.serve.json),
    ("headers", Json.arr ((headers d).map fun (k, v) => Json.arr #[k, v]).toArray)]

end Aven.Runtime

def registryVector (name : String) (st : Stage) (h : Bytes) (size : Nat) (c : Claim) : Json :=
  vector name (Json.mkObj [("runtimes", st.runtimes), ("head", hex h), ("size", size), ("claim", c.json)])
    (decideFile st h size c).json

def claims : List Claim :=
  [{}, claim "image/png", claim "text/html", claim "image/svg+xml", claim "text/markdown", claim "text/csv",
   claim "application/json", claim "text/plain", claim "application/pdf", claim "video/mp4", named "a.md",
   named "a.svg", named "a.tsv", named "page.html"]

/-- A head cut, changed or prefixed at random, from one of the examples. -/
def mutate (seed : Nat) : String × Stage × Bytes × Nat × Claim := Id.run do
  let r := Rng.seed seed
  let (i, r) := r.below examples.length
  let e := examples[i]?.getD ⟨"", on, [], 0, {}, ⟨.unknown, .download, .attachment⟩⟩
  let mut h := e.head
  let (k, r) := r.below 4
  let (at_, r) := r.below (h.length + 1)
  let (b, r) := r.below 256
  if k == 0 then h := h.take at_
  else if k == 1 then h := h.set at_ b.toUInt8
  else if k == 2 then h := [b.toUInt8] ++ h
  else h := h ++ [b.toUInt8, 0x3C, 0x73, 0x76, 0x67]
  let (j, r) := r.below claims.length
  let (sz, r) := r.below 3
  let size := if sz == 0 then h.length else if sz == 1 then e.size else e.size * 64
  let (st, _) := r.below 2
  return (s!"seed {seed}: {e.name}", ⟨st == 0⟩, h, size, claims[j]!)

def registryVectors : List Json :=
  examples.map (fun e => registryVector e.name e.stage e.head e.size e.claim) ++
  (List.range generated).map fun i =>
    let (name, st, h, size, c) := mutate (i + 1)
    registryVector name st h size c

def table : List Json :=
  registry.map (fun e => Json.mkObj [("type", e.type.name), ("mime", e.type.mime), ("mode", e.mode.json),
      ("bytes", e.bytes), ("pixels", e.pixels)]) ++
  signatures.map fun (t, s) => Json.mkObj [("type", t.name),
    ("signature", Json.arr (s.map fun (o, b) => Json.arr #[o, hex b]).toArray)]

/-! ## Trees and faces -/

namespace Aven.Runtime

partial def Node.json : Node → Json
  | .text s => Json.mkObj [("text", s)]
  | .el tag attrs kids => Json.mkObj [("tag", tag),
      ("attrs", Json.arr (attrs.map fun (k, v) => Json.arr #[k, v]).toArray),
      ("kids", Json.arr (kids.map Node.json).toArray)]

end Aven.Runtime

def treeVectors : List Json :=
  treeExamples.map fun (name, t, _) => vector name (Json.mkObj [("tree", t.json), ("cbor", hex (encode t.value))])
    (check treeLimits t)

namespace Aven.Runtime

def RGB.json (c : RGB) : Json := c.css

end Aven.Runtime

namespace Aven.Runtime

def Look.json (l : Look) : Json :=
  Json.mkObj [("fg", l.fg.json), ("bg", l.bg.json), ("px", toJson l.size.pxAt), ("weight", l.weight)]

end Aven.Runtime

/-- A face: its tree, its style as the Value it crosses in (in the one JSON form of a Value, colours as
`{"bytes": hex}`), and its encoding. -/
def faceVectors : List Json :=
  faceExamples.map fun (name, o, _) =>
    let i := issues o
    vector name (Json.mkObj [("tree", o.tree.json), ("style", Json.arr (o.style.map fun r => r.value.json).toArray),
        ("cbor", hex (encode o.value))])
      (Json.mkObj [("ok", faceOk treeLimits o), ("check", check treeLimits o.tree),
        ("unnamed", i.unnamed.length), ("noRole", i.noRole.length), ("noAlt", i.noAlt.length),
        ("badRules", Json.arr (o.style.zipIdx.filterMap fun (r, n) => if r.ok then none else some (toJson n)).toArray),
        ("texts", Json.arr (o.texts.map fun (l, s) => Json.arr #[l.json, s]).toArray),
        ("small", i.small.length), ("lowContrast", i.lowContrast.length),
        ("css", Json.arr (o.style.map fun r => Json.str r.css).toArray)])

def contrastVectors : List Json :=
  let pair (a b : RGB) : Json :=
    vector s!"{a.css} on {b.css}" (Json.mkObj [("fg", a.json), ("bg", b.json)])
      (Json.mkObj [("fg", a.luminance), ("bg", b.luminance), ("normal", reaches a b 9 2), ("large", reaches a b 3 1)])
  [Json.mkObj [("linear", Json.arr (linear.toList.map toJson).toArray)]] ++
  (List.range 256).filterMap (fun v => if v % 3 == 0 then some (pair (grey v.toUInt8) white) else none) ++
  (List.range generated).map fun i =>
    let r := Rng.seed (i + 1)
    let (a, r) := r.below 16777216
    let (b, _) := r.below 16777216
    let c := fun (n : Nat) => (⟨(n / 65536).toUInt8, (n / 256 % 256).toUInt8, (n % 256).toUInt8⟩ : RGB)
    pair (c a) (c b)

/-! ## The contract -/

/-- A run's result as the host hands it on, encoded; and render keys with their names under BLAKE3. -/
def contractVectors : List Json :=
  let failures := [Failure.badInput, .outOfFuel, .outOfMemory, .refused, .outputTooLarge, .badOutput]
  failures.map (fun f => vector s!"failure {f.name}" (Json.mkObj [("failure", f.name)])
      (Json.mkObj [("cbor", hex (encode (result (.error f))))])) ++
  [vector "ok" (Json.mkObj [("ok", hex (encode (.text (ascii "hi"))))])
      (Json.mkObj [("cbor", hex (encode (result (.ok (.text (ascii "hi"))))))])] ++
  (List.range 8).map fun i =>
    let k : RenderKey := ⟨blake3 (ascii s!"svg-runtime@{i % 3 + 1}"), blake3 (ascii s!"file {i}"),
      .map [(ascii "width", .uint (256 * (i + 1)))]⟩
    vector s!"render key {i}" (Json.mkObj [("runtime", k.runtime.text), ("file", k.file.text),
        ("params", hex (encode k.params))])
      (Json.mkObj [("cbor", hex (encode k.value)), ("name", (k.name blake3).text)])

/-! ## state-runtime -/

def stateVectors : List Json :=
  stateExamples.map fun e =>
    let r := e.run
    vector e.name
      (Json.mkObj [("part", hex (encode e.part)), ("input", hex (encode e.input)), ("limits", e.limits.json)])
      (Json.mkObj [("result", hex (encode (result r))), ("ok", match r with | .ok _ => true | .error _ => false)])

/-! ## Helpers -/

def pathJson (p : Path) : Json := Json.arr (p.map fun
  | .field b => toJson (utf8Text b)
  | .index n => toJson n).toArray

def txt' (s : String) : Value := .text (ascii s)

/-! ## face-runtime's markup: `markup.json` -/

def srcJson : Src → Json
  | .lit s => Json.mkObj [("lit", s)]
  | .data p => Json.mkObj [("$", pathJson p)]
  | .item p => Json.mkObj [("$$", pathJson p)]

partial def markupJson : Markup → Json
  | .text s => Json.mkObj [("text", srcJson s)]
  | .el tag attrs on kids => Json.mkObj [("tag", tag),
      ("attrs", Json.mkObj (attrs.map fun (k', s) => (k', srcJson s))),
      ("$on", match on with | some e => toJson e | none => Json.null),
      ("kids", Json.arr (kids.map markupJson).toArray)]
  | .each p kp body => Json.mkObj [("$each", pathJson p), ("key", pathJson kp), ("body", markupJson body)]
  | .use place comp props => Json.mkObj [("$use", comp), ("place", place),
      ("props", Json.mkObj (props.map fun (k', s) => (k', srcJson s)))]

def mel (tag : String) (attrs : List (String × Src) := []) (on : Option String := none) (kids : List Markup := []) :
    Markup := .el tag attrs on kids

/-- A task's row: a checkbox named by the title, which sends `toggle`, and the title. -/
def rowMarkup : Markup :=
  mel "li" [("class", .lit "task")] none
    [mel "input" [("type", .lit "checkbox"), ("aria-label", .data (path ["title"]))] (some "toggle"),
     mel "span" [] none [.text (.data (path ["title"]))]]

/-- The list's face: a field, and a row per task, keyed by its id. -/
def listMarkup : Markup :=
  mel "section" [] none
    [.use "field" "field" [("hint", .lit "New task")],
     mel "ul" [] none [.each (path ["tasks"]) (path ["id"]) (.use "row" "task-row" [("title", .item (path ["title"]))])]]

/-- Everything a face must not get through. -/
def hostileMarkup : Markup :=
  mel "div" [("onclick", .lit "steal()"), ("style", .lit "position:fixed"), ("data-on", .data (path ["evil"]))] none
    [mel "script" [] none [.text (.lit "steal()")],
     mel "a" [("href", .lit "javascript:steal()")] none [.text (.lit "a link")],
     mel "img" [("src", .lit "https://tracker.example/pixel"), ("alt", .lit "")],
     mel "a" [("href", .data (path ["url"]))] none [.text (.lit "docs")],
     mel "iframe" [("src", Src.lit ("/files/" ++ String.ofList (List.replicate 64 'a')))]]

def tasks : Value := obj [("tasks", .array [obj [("id", txt' "1"), ("title", txt' "Buy milk")],
  obj [("id", txt' "2"), ("title", txt' "Bake bread")], obj [("id", txt' "1"), ("title", txt' "A repeated key")]])]

def faceCases : List (String × Markup × Value) := [
  ("a task's row", rowMarkup, obj [("title", txt' "Buy milk")]),
  ("the list places a field and a row per task, keyed; a repeated key is skipped", listMarkup, tasks),
  ("hostile markup: handlers, styles, scripts, frames, foreign URLs and a forged event are dropped", hostileMarkup,
    obj [("evil", txt' "deleteAll"), ("url", txt' "https://maia.city/docs")]),
  ("an unnamed checkbox is refused for its accessibility", mel "input" [("type", .lit "checkbox")] (some "toggle"),
    obj [])]

def placementJson (pl : Placement) : Json :=
  Json.mkObj [("place", pl.place), ("component", pl.component),
    ("props", Json.mkObj (pl.props.map fun (k', v) => (k', toJson v)))]

def markupVectors : List Json :=
  faceCases.map fun (name, m, data) =>
    let (ns, pls) := draw data .null "" m
    vector name (Json.mkObj [("markup", markupJson m), ("data", Value.json data)])
      (Json.mkObj [("tree", Json.arr (ns.map fun n => Value.json n.value).toArray),
        ("placements", Json.arr (pls.map placementJson).toArray),
        ("faceRun", toJson (faceRun ⟨m, []⟩ data).isSome)])

/-! ## Checks on state and markup before writing -/

-- the list draws two rows, not three: the repeated key is skipped
#guard (draw tasks .null "" listMarkup).2.length == 3
-- the hostile markup's forged event is gone
#guard (draw (obj [("evil", txt' "deleteAll")]) .null "" hostileMarkup).1.all fun n =>
  n.all.all fun x => !(x.attrs.any (·.1 == "data-on"))
-- the row is a face face-runtime gives
#guard (faceRun ⟨rowMarkup, []⟩ (obj [("title", txt' "Buy milk")])).isSome

/-! ## markdown-runtime -/

def markdownVectors : List Json :=
  headingExamples.map (fun (name, hs, _) =>
      vector name (Json.mkObj [("headings", toJson hs)]) (Json.mkObj [("ids", toJson (slugs hs))])) ++
  linkExamples.map (fun (name, href, _) =>
    let rules := avenBrainRules ++ [("evil:", "javascript:")]
    vector name (Json.mkObj [("rules", Json.arr (rules.map fun (a, b) => Json.arr #[a, b]).toArray), ("href", href)])
      (Json.mkObj [("href", match rewrite rules href with | some h => Json.str h | none => Json.null)]))
  ++ resolveExamples.map (fun (name, base, pre, href, _) =>
    vector name (Json.mkObj [("base", base), ("idPrefix", pre), ("href", href)])
      (Json.mkObj [("resolved", resolve base pre href)]))
  ++ linkToExamples.map fun (name, base, pre, href, _) =>
    vector name (Json.mkObj [("rules", Json.arr (brainRules.map fun ((a, b) : String × String) => Json.arr #[a, b]).toArray),
        ("base", base), ("idPrefix", pre), ("href", href)])
      (Json.mkObj [("href", match linkTo { links := brainRules, base, idPrefix := pre } href with
        | some h => Json.str h | none => Json.null)])

/-! ## face-runtime -/

def faceRuntimeVectors : List Json :=
  faceRuntimeExamples.map fun (name, p, i) =>
    vector name (Json.mkObj [("part", hex (encode p)), ("data", hex (encode i))])
      (Json.mkObj [("result", hex (encode (result (run faceRuntime roomy' p i))))])

/-- One vector per line, so a change reads as a diff of lines. -/
def render (vs : List Json) : String :=
  "[\n" ++ ",\n".intercalate (vs.map Json.compress) ++ "\n]\n"

def main (args : List String) : IO Unit := do
  let dir : System.FilePath := args.headD "vectors"
  IO.FS.createDirAll dir
  for (file, vs) in [("table.json", table), ("registry.json", registryVectors), ("tree.json", treeVectors),
      ("face.json", faceVectors), ("contrast.json", contrastVectors),
      ("contract.json", contractVectors),
      ("state.json", stateVectors), ("markup.json", markupVectors),
      ("markdown.json", markdownVectors), ("face-runtime.json", faceRuntimeVectors)] do
    IO.FS.writeFile (dir / file) (render vs)

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
- `tree.json`: a node tree; whether the applier's check passes it (`Aven.Runtime.Tree`).
- `face.json`: a face's tree and style; whether it is accepted, what is wrong with it, and its CSS text
  (`Aven.Runtime.Face`).
- `contrast.json`: `linear`, the table every contrast check uses, then pairs of colours with their luminances and
  whether they reach 4.5:1 and 3:1.
-/

open Lean Aven.Runtime

def vector (name : String) (input expected : Json) : Json :=
  Json.mkObj [("name", name), ("input", input), ("expected", expected)]

def hexOf (b : Bytes) : String :=
  String.join (b.map fun x => hex2 x)

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
  vector name (Json.mkObj [("runtimes", st.runtimes), ("head", hexOf h), ("size", size), ("claim", c.json)])
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
    ("signature", Json.arr (s.map fun (o, b) => Json.arr #[o, hexOf b]).toArray)]

/-! ## Trees and faces -/

namespace Aven.Runtime

partial def Node.json : Node → Json
  | .text s => Json.mkObj [("text", s)]
  | .el tag attrs kids => Json.mkObj [("tag", tag),
      ("attrs", Json.arr (attrs.map fun (k, v) => Json.arr #[k, v]).toArray), ("kids", Json.arr (kids.map Node.json).toArray)]

end Aven.Runtime

def treeVectors : List Json :=
  treeExamples.map fun (name, t, _) => vector name (Json.mkObj [("tree", t.json)]) (check treeLimits t)

namespace Aven.Runtime

def RGB.json (c : RGB) : Json := c.css

def Rule.json (r : Rule) : Json :=
  Json.mkObj [("class", r.cls), ("color", (r.color.map RGB.json).getD Json.null),
    ("background", (r.background.map RGB.json).getD Json.null), ("size", (r.size.map toJson).getD Json.null),
    ("bold", (r.bold.map toJson).getD Json.null)]

def Ctx.json (c : Ctx) : Json :=
  Json.mkObj [("fg", c.fg.json), ("bg", c.bg.json), ("size", c.size), ("bold", c.bold)]

end Aven.Runtime

def faceVectors : List Json :=
  faceExamples.map fun (name, o, _) =>
    let i := issues o
    vector name (Json.mkObj [("tree", o.tree.json), ("style", Json.arr (o.style.map Rule.json).toArray)])
      (Json.mkObj [("ok", faceOk treeLimits o), ("check", check treeLimits o.tree),
        ("unnamed", i.unnamed.length), ("noRole", i.noRole.length), ("noAlt", i.noAlt.length),
        ("lowContrast", Json.arr (i.lowContrast.map fun (c, s) => Json.arr #[c.json, s]).toArray),
        ("badClass", i.badClass.length), ("css", Json.arr (o.style.map fun r => Json.str r.css).toArray)])

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

/-- One vector per line, so a change reads as a diff of lines. -/
def render (vs : List Json) : String :=
  "[\n" ++ ",\n".intercalate (vs.map Json.compress) ++ "\n]\n"

def main (args : List String) : IO Unit := do
  let dir : System.FilePath := args.headD "vectors"
  IO.FS.createDirAll dir
  for (file, vs) in [("table.json", table), ("registry.json", registryVectors), ("tree.json", treeVectors),
      ("face.json", faceVectors), ("contrast.json", contrastVectors)] do
    IO.FS.writeFile (dir / file) (render vs)

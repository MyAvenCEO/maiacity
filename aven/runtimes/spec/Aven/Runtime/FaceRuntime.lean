import Aven.Runtime.Markup
import Aven.Runtime.StateExamples
import Aven.Runtime.StyleExamples

/-!
# face-runtime under the contract (README, "Two kinds of output, and the drawers")

`faceRun` (`Markup`) draws a face and accepts it only when `faceOk` holds. Here it becomes a runtime: its part is a
face part as a Value of the one codec (its markup and its style), its input the face data, and its answer the drawn
tree, the style as typed rules and the placements, as a Value.

The answer carries the style as data, never as CSS text: the drawer, trusted code, writes the CSS itself from rules it
has checked (`Rule.css`, `Aven.Runtime.Style`), so no text a runtime makes ever reaches a stylesheet.

- `faceRuntime_ok`: every answer is the Value of a face that passed `faceOk`: the applier's check, names, roles, alt
  text and contrast.
- A face part reads back from its Value (checked on the examples), so what the vectors write is what the runtime reads.

Forms, every one an array so it needs no map order:

- a source: `["lit", text]`, `["$", path]`, `["$$", path]`, a path as state-runtime writes one;
- markup: `["text", source]`, `["el", tag, [[name, source], …], event or null, [markup, …]]`,
  `["each", path, key path, markup]`, `["use", place, component, [[name, source], …]]`;
- a rule: `Rule.value`, `[[compound, …], [declaration, …]]`: a compound `[tag or null, [class, …]]`, a declaration
  its property's name and its values (`Decl.value`), a length `[hundredths, unit]`, a colour three bytes;
- a face part: `[markup, [rule, …]]`;
- the answer: `{"tree": tree, "style": [rule, …], "placements": [[place, component, [[name, text], …]], …]}`.
-/

namespace Aven.Runtime

open Aven.Core (Value Bytes encode)

def Src.value : Src → Value
  | .lit s => .array [.text (ascii "lit"), .text (ascii s)]
  | .data p => .array [.text (ascii "$"), pathValue p]
  | .item p => .array [.text (ascii "$$"), pathValue p]

def Src.ofValue? : Value → Option Src
  | .array [.text t, v] =>
    if t == ascii "lit" then (text? v).map .lit
    else if t == ascii "$" then (path? v).map .data
    else if t == ascii "$$" then (path? v).map .item
    else none
  | _ => none

def namedSrc? : Value → Option (String × Src)
  | .array [k, s] => do return (← text? k, ← Src.ofValue? s)
  | _ => none

def Markup.value : Markup → Value
  | .text s => .array [.text (ascii "text"), s.value]
  | .el tag attrs on kids =>
    .array [.text (ascii "el"), .text (ascii tag), .array (attrs.map fun (k, s) => .array [.text (ascii k), s.value]),
      (on.map fun e => Value.text (ascii e)).getD .null, .array (kids.attach.map fun ⟨k, _⟩ => k.value)]
  | .each p key body => .array [.text (ascii "each"), pathValue p, pathValue key, body.value]
  | .use place comp props =>
    .array [.text (ascii "use"), .text (ascii place), .text (ascii comp),
      .array (props.map fun (k, s) => .array [.text (ascii k), s.value])]

/-- Markup from its Value, no deeper than `fuel`. -/
def Markup.ofValue? : Nat → Value → Option Markup
  | 0, _ => none
  | fuel + 1, v => match v with
    | .array [.text t, s] => if t == ascii "text" then (Src.ofValue? s).map .text else none
    | .array [.text t, tag, .array attrs, on, .array kids] =>
      if t == ascii "el" then do
        let on ← match on with
          | .null => some none
          | e => (text? e).map some
        return .el (← text? tag) (← mapM namedSrc? attrs) on (← mapM (Markup.ofValue? fuel) kids)
      else none
    | .array [.text t, a, b, c] =>
      if t == ascii "each" then do return .each (← path? a) (← path? b) (← Markup.ofValue? fuel c)
      else if t == ascii "use" then match c with
        | .array props => do return .use (← text? a) (← text? b) (← mapM namedSrc? props)
        | _ => none
      else none
    | _ => none

def rgb? : Value → Option RGB
  | .bytes [r, g, b] => some ⟨r, g, b⟩
  | _ => none

def optOf? {α : Type} (f : Value → Option α) : Value → Option (Option α)
  | .null => some none
  | v => (f v).map some

def intOf? : Value → Option Int
  | .uint n => some n
  | .nint n => some (-((n : Int) + 1))
  | _ => none

def LenUnit.ofName? : String → Option LenUnit
  | "cqw" => some .cqw | "%" => some .pct | "px" => some .px | "em" => some .em | _ => none

def Len.ofValue? : Value → Option Len
  | .array [v, u] => do return ⟨← intOf? v, ← (text? u).bind LenUnit.ofName?⟩
  | _ => none

def Step.ofValue? : Value → Option Step
  | .array [t, a] => match text? t with
    | some "translateX" => (Len.ofValue? a).map .translateX
    | some "translateY" => (Len.ofValue? a).map .translateY
    | some "rotate" => (intOf? a).map .rotate
    | some "scale" => (intOf? a).map .scale
    | _ => none
  | _ => none

/-- The side a property's name ends in: `margin`, `margin-top`, …; `none` for any other. -/
def sideOf? (base name : String) : Option Side :=
  [Side.all, .top, .right, .bottom, .left].find? fun s => name == base ++ s.suffix

def Display.ofName? : String → Option Display
  | "block" => some .block | "inline-block" => some .inlineBlock | "flex" => some .flex | _ => none

def Line.ofName? : String → Option Line
  | "solid" => some .solid | "dotted" => some .dotted | _ => none

/-- A declaration from its Value (`Decl.value`): its property's name, then its values. -/
def Decl.ofValue? : Value → Option Decl
  | .array (t :: args) => do
    let n ← text? t
    match n, args with
    | "position", [v] => match text? v with
      | some "absolute" => some (.position true)
      | some "relative" => some (.position false)
      | _ => none
    | "inset", [] => some .cover
    | "width", [l] => (Len.ofValue? l).map .width
    | "height", [l] => (Len.ofValue? l).map .height
    | "display", [d] => (text? d).bind Display.ofName? |>.map .display
    | "aspect-ratio", [.uint w, .uint h] => some (.aspect w h)
    | "container-type", [] => some .container
    | "overflow", [] => some .clip
    | "gap", [l] => (Len.ofValue? l).map .gap
    | "border-radius", [l] => (Len.ofValue? l).map .radius
    | "background-color", [c] => (rgb? c).map .background
    | "color", [c] => (rgb? c).map .color
    | "font-family", [] => some .sans
    | "font-size", [l] => (Len.ofValue? l).map .size
    | "font-weight", [.uint w] => some (.weight w)
    | "line-height", [h] => (intOf? h).map .leading
    | "letter-spacing", [l] => (Len.ofValue? l).map .tracking
    | "text-transform", [] => some .upper
    | "text-align", [] => some .center
    | "white-space", [] => some .nowrap
    | "transform", [.array ss] => (mapM Step.ofValue? ss).map .transform
    | "transform-origin", [x, y] => do return .origin (← Len.ofValue? x) (← Len.ofValue? y)
    | "clip-path", [] => some .arrowhead
    | n, [l] =>
      match [Side.top, .right, .bottom, .left].find? (·.name == n), sideOf? "margin" n, sideOf? "padding" n with
      | some s, _, _ => (Len.ofValue? l).map (.place s)
      | _, some s, _ => (Len.ofValue? l).map (.margin s)
      | _, _, some s => (Len.ofValue? l).map (.padding s)
      | _, _, _ => none
    | n, [w, line, c] => do
      let s ← sideOf? "border" n
      return .border s (← Len.ofValue? w) (← (text? line).bind Line.ofName?) (← rgb? c)
    | _, _ => none
  | _ => none

/-- A compound from its Value: `[tag or null, [class, …]]`. -/
def Compound.ofValue? : Value → Option Compound
  | .array [t, .array cs] => do
    let tag ← optOf? text? t
    return ⟨tag, ← mapM text? cs⟩
  | _ => none

/-- A rule from its Value: `[[compound, …], [declaration, …]]`. -/
def Rule.ofValue? : Value → Option Rule
  | .array [.array cs, .array ds] => do return ⟨← mapM Compound.ofValue? cs, ← mapM Decl.ofValue? ds⟩
  | _ => none

/-- How deep a face part's markup may nest: the tree's own limit. -/
def markupDepth : Nat := treeLimits.depth

def FacePart.value (fp : FacePart) : Value := .array [fp.markup.value, .array (fp.style.map Rule.value)]

def FacePart.ofValue? : Value → Option FacePart
  | .array [m, .array rs] => do return ⟨← Markup.ofValue? markupDepth m, ← mapM Rule.ofValue? rs⟩
  | _ => none

def Placement.value (p : Placement) : Value :=
  .array [.text (ascii p.place), .text (ascii p.component),
    .array (p.props.map fun (k, v) => .array [.text (ascii k), .text (ascii v)])]

/-- face-runtime's answer as a Value. -/
def faceAnswer (o : FaceOut) (pls : List Placement) : Value :=
  .map [(ascii "tree", o.tree.value), (ascii "style", .array (o.style.map Rule.value)),
    (ascii "placements", .array (pls.map Placement.value))]

/-- face-runtime under the contract. A part that doesn't read as a face part, or a face `faceRun` refuses, is refused.
Fuel and memory grow with the part and the data. -/
def faceRuntime : Runtime where
  eval p i := match FacePart.ofValue? p with
    | some fp => match faceRun fp i with
      | some (o, pls) => .ok (faceAnswer o pls)
      | none => .error .refused
    | none => .error .refused
  fuel p i := 256 * ((encode p).length + (encode i).length) + 256
  memory p i := 64 * ((encode p).length + (encode i).length) + 65536
  input _ := true
  output _ := true

/-- **Every answer is the Value of a face that passed `faceOk`.** -/
theorem faceRuntime_ok {lim : Limits} {p i o : Value} (h : run faceRuntime lim p i = .ok o) :
    ∃ fo pls, o = faceAnswer fo pls ∧ faceOk treeLimits fo = true := by
  have he := (run_ok_fits h).2.2.2
  simp only [faceRuntime] at he
  split at he
  · split at he
    · rename_i fo pls hr; cases he; exact ⟨fo, pls, rfl, faceRun_ok hr⟩
    · cases he
  · cases he

/-! ## Examples -/

def taskRow : FacePart :=
  ⟨.el "li" [("class", .lit "row")] none
    [.el "input" [("type", .lit "checkbox"), ("aria-label", .data (path ["title"]))] (some "toggle") [],
     .el "span" [("class", .lit "title")] none [.text (.data (path ["title"]))]],
   [rule ["row"] [.background white], rule ["title"] [.color (grey 0x22)]]⟩

def taskList : FacePart :=
  ⟨.el "section" [] none
    [.use "field" "field" [("hint", .lit "New task")],
     .el "ul" [] none [.each (path ["tasks"]) (path ["id"]) (.use "row" "task-row" [("title", .item (path ["title"]))])]],
   []⟩

def hostileFace : FacePart :=
  ⟨.el "div" [("onclick", .lit "steal()"), ("style", .lit "position:fixed"), ("data-on", .data (path ["evil"]))] none
    [.el "script" [] none [.text (.lit "steal()")],
     .el "a" [("href", .lit "javascript:steal()")] none [.text (.lit "a link")],
     .el "img" [("src", .lit "https://tracker.example/pixel"), ("alt", .lit "")] none [],
     .el "iframe" [("src", .lit ("/files/" ++ String.ofList (List.replicate 64 'a')))] none []],
   []⟩

/-- Every declaration's form, once: what a part's rules read back from. -/
def everyDecl : List Decl :=
  [.position true, .position false, .cover, .place .top (pct 100), .place .right (cqw (-250)), .place .bottom (px 0),
   .place .left (px 5), .width (cqw 1250), .height (pct 10000), .display .block, .display .inlineBlock, .display .flex,
   .aspect 16 9, .container, .clip, .margin .all (px 0), .margin .top (cqw 100), .padding .left (px 800),
   .padding .all (cqw 50), .gap (cqw 120), .radius (cqw 160), .border .all (px 100) .solid (grey 0xe6),
   .border .top (cqw 60) .dotted ochre, .background cream, .color navy, .sans, .size (cqw 260), .weight 700,
   .leading 115, .tracking (em (-1)), .upper, .center, .nowrap,
   .transform [.translateX (pct (-5000)), .translateY (cqw 20), .rotate (-3247), .scale 150],
   .origin (pct 5000) (px 0), .arrowhead]

/-- The slide as a face part: its markup is one label, its style every rule of the slide and every declaration's form,
in two rules (a rule has at most 32). -/
def slidePart : FacePart :=
  ⟨.el "figure" [("class", .lit "slide sign"), ("role", .lit "img"), ("aria-label", .lit "A key signs.")] none
    [.el "p" [("class", .lit "label key-label")] none [.text (.data (path ["label"]))]],
   slideRules ++ signRules ++ [⟨[{ tag := some "p", classes := ["all"] }, { classes := ["of", "them"] }],
     everyDecl.take 20⟩, rule ["rest"] (everyDecl.drop 20)]⟩

def faceRuntimeExamples : List (String × Value × Value) :=
  [("a task's row", taskRow.value, obj [("title", str "Buy milk")]),
   ("the list places a field and a row per task", taskList.value,
     obj [("tasks", .array [obj [("id", str "1"), ("title", str "Buy milk")], obj [("id", str "2"), ("title", str "Bake bread")],
       obj [("id", str "1"), ("title", str "A repeated key")]])]),
   ("hostile markup loses what it may not have", hostileFace.value, obj [("evil", str "deleteAll")]),
   ("an unnamed checkbox is refused", (FacePart.mk (.el "input" [("type", .lit "checkbox")] (some "toggle") []) []).value,
     obj []),
   ("grey on white is refused", (FacePart.mk (.el "p" [("class", .lit "muted")] none [.text (.lit "almost")])
     [rule ["muted"] [.color (grey 0x77)]]).value, obj []),
   ("the slide's label, styled", slidePart.value, obj [("label", str "Alice’s key")]),
   ("a part that isn't one is refused", .array [str "no"], obj []),
   ("markup deeper than a tree may be is refused",
     (FacePart.mk ((List.range 70).foldl (fun m _ => .el "div" [] none [m]) (.text (.lit "deep"))) []).value, obj [])]

#guard [taskRow, taskList, hostileFace, slidePart].all fun fp =>
  ((FacePart.ofValue? fp.value).map fun q => encode q.value) == some (encode fp.value)

def roomy' : Limits := ⟨10_000_000, 64 * 1048576, 4 * 1048576⟩

#guard (faceRuntimeExamples.map fun (_, p, i) => match run faceRuntime roomy' p i with
  | .ok _ => true
  | .error _ => false) == [true, true, true, false, false, true, false, false]

end Aven.Runtime

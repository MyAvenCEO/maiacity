import Aven.Runtime.Markup
import Aven.Runtime.StateExamples

/-!
# face-runtime under the contract (README, "Two kinds of output, and the drawers")

`faceRun` (`Markup`) draws a face and accepts it only when `faceOk` holds. Here it becomes a runtime: its part is a
face part as a Value of the one codec (its markup and its style), its input the face data, and its answer the drawn
tree, the style as typed rules and the placements, as a Value.

The answer carries the style as data, never as CSS text: the drawer, trusted code, writes the CSS itself from rules it
has checked (`Rule.css`), so no text a runtime makes ever reaches a stylesheet.

- `faceRuntime_ok`: every answer is the Value of a face that passed `faceOk`: the applier's check, names, roles, alt
  text and contrast.
- A face part reads back from its Value (checked on the examples), so what the vectors write is what the runtime reads.

Forms, every one an array so it needs no map order:

- a source: `["lit", text]`, `["$", path]`, `["$$", path]`, a path as state-runtime writes one;
- markup: `["text", source]`, `["el", tag, [[name, source], …], event or null, [markup, …]]`,
  `["each", path, key path, markup]`, `["use", place, component, [[name, source], …]]`;
- a rule: `Rule.value`, `[class, colour or null, background or null, size or null, bold or null]`, a colour as three
  bytes;
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

def Rule.ofValue? : Value → Option Rule
  | .array [c, fg, bg, size, bold] => do
    return ⟨← text? c, ← optOf? rgb? fg, ← optOf? rgb? bg,
      ← optOf? (fun | .uint n => some n | _ => none) size, ← optOf? (fun | .bool b => some b | _ => none) bold⟩
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
   [{ cls := "row", background := some white }, { cls := "title", color := some (grey 0x22) }]⟩

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

def faceRuntimeExamples : List (String × Value × Value) :=
  [("a task's row", taskRow.value, obj [("title", str "Buy milk")]),
   ("the list places a field and a row per task", taskList.value,
     obj [("tasks", .array [obj [("id", str "1"), ("title", str "Buy milk")], obj [("id", str "2"), ("title", str "Bake bread")],
       obj [("id", str "1"), ("title", str "A repeated key")]])]),
   ("hostile markup loses what it may not have", hostileFace.value, obj [("evil", str "deleteAll")]),
   ("an unnamed checkbox is refused", (FacePart.mk (.el "input" [("type", .lit "checkbox")] (some "toggle") []) []).value,
     obj []),
   ("grey on white is refused", (FacePart.mk (.el "p" [("class", .lit "muted")] none [.text (.lit "almost")])
     [{ cls := "muted", color := some (grey 0x77) }]).value, obj []),
   ("a part that isn't one is refused", .array [str "no"], obj []),
   ("markup deeper than a tree may be is refused",
     (FacePart.mk ((List.range 70).foldl (fun m _ => .el "div" [] none [m]) (.text (.lit "deep"))) []).value, obj [])]

#guard [taskRow, taskList, hostileFace].all fun fp =>
  ((FacePart.ofValue? fp.value).map fun q => encode q.value) == some (encode fp.value)

def roomy' : Limits := ⟨10_000_000, 64 * 1048576, 4 * 1048576⟩

#guard (faceRuntimeExamples.map fun (_, p, i) => match run faceRuntime roomy' p i with
  | .ok _ => true
  | .error _ => false) == [true, true, true, false, false, false, false]

end Aven.Runtime

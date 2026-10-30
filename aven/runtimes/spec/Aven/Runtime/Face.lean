import Aven.Runtime.Tree

/-!
# The face-runtime's output (README, "Two kinds of output, and the drawers"; aven/actor/ARCHITECTURE.md, section 5)

The face-runtime draws a face: its markup part and its style part, with the face data, into a node tree and scoped
CSS. Its output is accepted only when:

- **the tree passes the applier's check** (`Tree`);
- **its style is data:** each rule a class name and typed values (colours, a size, a weight), so no CSS text, no
  `url()` and no selector of a face's own ever reaches the page; the CSS text is generated from it;
- **every interactive node has an accessible name,** every non-native interactive node a role and a tab stop, and
  every image an `alt`;
- **every text has enough contrast** against the background it is drawn on, as the style resolves it down the tree:
  WCAG 2.2's 4.5:1, and 3:1 for large text.

Contrast is exact: sRGB's channels are linearized by one table of integers (`linear`, the value × 10⁷, rounded), which
the vectors export, so the face-runtime, the applier's check and any tool compute the same ratio.
-/

namespace Aven.Runtime

open Aven.Core

/-- sRGB's 8-bit channel to linear light, × 10⁷, rounded: (c/255)/12.92 up to 0.04045, else
((c/255 + 0.055)/1.055)^2.4. -/
def linear : Array Nat := #[
  0, 3035, 6071, 9106, 12141, 15176, 18212, 21247, 24282, 27317, 30353, 33465,
  36765, 40247, 43914, 47770, 51815, 56054, 60488, 65121, 69954, 74990, 80232, 85681,
  91341, 97212, 103298, 109601, 116122, 122865, 129830, 137021, 144438, 152085, 159963, 168074,
  176420, 185002, 193824, 202886, 212190, 221739, 231534, 241576, 251869, 262412, 273209, 284260,
  295568, 307134, 318960, 331048, 343398, 356013, 368895, 382044, 395462, 409152, 423114, 437350,
  451862, 466651, 481718, 497066, 512695, 528606, 544803, 561285, 578054, 595112, 612461, 630100,
  648033, 666259, 684782, 703601, 722719, 742136, 761854, 781874, 802198, 822827, 843762, 865005,
  886556, 908417, 930590, 953075, 975873, 998987, 1022417, 1046165, 1070231, 1094617, 1119324, 1144354,
  1169707, 1195384, 1221388, 1247718, 1274377, 1301365, 1328683, 1356333, 1384316, 1412633, 1441285, 1470273,
  1499598, 1529262, 1559265, 1589608, 1620294, 1651322, 1682694, 1714411, 1746474, 1778884, 1811642, 1844750,
  1878208, 1912017, 1946178, 1980693, 2015563, 2050787, 2086369, 2122308, 2158605, 2195262, 2232280, 2269659,
  2307400, 2345506, 2383976, 2422811, 2462013, 2501583, 2541521, 2581829, 2622507, 2663556, 2704978, 2746773,
  2788943, 2831487, 2874408, 2917706, 2961383, 3005438, 3049873, 3094689, 3139887, 3185468, 3231432, 3277781,
  3324515, 3371636, 3419144, 3467041, 3515326, 3564001, 3613068, 3662526, 3712377, 3762621, 3813260, 3864294,
  3915725, 3967552, 4019778, 4072402, 4125426, 4178851, 4232677, 4286905, 4341536, 4396572, 4452012, 4507858,
  4564110, 4620770, 4677838, 4735315, 4793202, 4851499, 4910208, 4969330, 5028865, 5088813, 5149177, 5209956,
  5271151, 5332764, 5394795, 5457245, 5520114, 5583404, 5647115, 5711248, 5775804, 5840784, 5906188, 5972018,
  6038273, 6104956, 6172066, 6239604, 6307571, 6375969, 6444797, 6514056, 6583748, 6653873, 6724432, 6795425,
  6866853, 6938718, 7011019, 7083758, 7156935, 7230551, 7304607, 7379104, 7454042, 7529422, 7605245, 7681511,
  7758222, 7835378, 7912979, 7991027, 8069523, 8148466, 8227858, 8307699, 8387990, 8468732, 8549926, 8631572,
  8713671, 8796224, 8879231, 8962694, 9046612, 9130987, 9215819, 9301109, 9386857, 9473065, 9559734, 9646862,
  9734453, 9822506, 9911021, 10000000]

structure RGB where
  r : UInt8
  g : UInt8
  b : UInt8
  deriving DecidableEq, Repr, Inhabited

def black : RGB := ⟨0, 0, 0⟩
def white : RGB := ⟨255, 255, 255⟩

/-- Relative luminance × 10¹¹. -/
def RGB.luminance (c : RGB) : Nat := 2126 * linear[c.r.toNat]! + 7152 * linear[c.g.toNat]! + 722 * linear[c.b.toNat]!

/-- 0.05 at the luminance's scale. -/
def flare : Nat := 5_000_000_000

/-- Whether two colours reach a ratio of `num / den`: (L₁ + 0.05) / (L₂ + 0.05) ≥ num / den, in integers. -/
def reaches (a b : RGB) (num den : Nat) : Bool :=
  let hi := max a.luminance b.luminance
  let lo := min a.luminance b.luminance
  decide (den * (hi + flare) ≥ num * (lo + flare))

/-- One style rule: a class and typed values. -/
structure Rule where
  cls : String
  color : Option RGB := none
  background : Option RGB := none
  size : Option Nat := none
  bold : Option Bool := none
  deriving DecidableEq, Repr, Inhabited

/-- A class name: lowercase letters, digits and `-`, so it can't close a rule or start another. -/
def classOk (c : String) : Bool :=
  !c.isEmpty && c.toList.all fun ch => ('a' ≤ ch && ch ≤ 'z') || ('0' ≤ ch && ch ≤ '9') || ch == '-'

def RGB.css (c : RGB) : String := "#" ++ hex [c.r, c.g, c.b]

/-- The CSS text of a rule, generated: the only CSS a face ever gives. -/
def Rule.css (r : Rule) : String :=
  let decls := (r.color.map fun c => "color:" ++ c.css).toList ++
    (r.background.map fun c => "background-color:" ++ c.css).toList ++
    (r.size.map fun n => "font-size:" ++ toString n ++ "px").toList ++
    (r.bold.map fun b => "font-weight:" ++ (if b then "700" else "400")).toList
  "." ++ r.cls ++ "{" ++ ";".intercalate decls ++ "}"

def RGB.value (c : RGB) : Value := .bytes [c.r, c.g, c.b]

def opt {α : Type} (f : α → Value) : Option α → Value
  | some a => f a
  | none => .null

/-- A rule as a Value: `[class, color, background, size, bold]`, each missing value null. -/
def Rule.value (r : Rule) : Value :=
  .array [.text (ascii r.cls), opt RGB.value r.color, opt RGB.value r.background, opt Value.uint r.size,
    opt Value.bool r.bold]

structure FaceOut where
  tree : Node
  style : List Rule
  deriving Repr, Inhabited

/-- A face's output as the Value it crosses in: `{"tree": …, "style": [rule, …]}`, keys in the codec's order. -/
def FaceOut.value (o : FaceOut) : Value := .map [(ascii "tree", o.tree.value), (ascii "style", .array (o.style.map Rule.value))]

/-- What a text is drawn with: its colour, the background under it, its size in pixels and its weight. -/
structure Ctx where
  fg : RGB
  bg : RGB
  size : Nat
  bold : Bool
  deriving DecidableEq, Repr, Inhabited

/-- The page a face is drawn on, before any rule. -/
def Ctx.base : Ctx := ⟨black, white, 16, false⟩

def Node.attr (n : Node) (k : String) : Option String := (n.attrs.find? (·.1 == k)).map (·.2)

def Node.classes (n : Node) : List String := ((n.attr "class").getD "").splitOn " " |>.filter (!·.isEmpty)

/-- The rules for a node's classes, in the style's order, the later winning. -/
def Ctx.apply (c : Ctx) (style : List Rule) (n : Node) : Ctx :=
  style.foldl (fun c r => if n.classes.contains r.cls then
    { fg := r.color.getD c.fg, bg := r.background.getD c.bg, size := r.size.getD c.size, bold := r.bold.getD c.bold }
    else c) c

/-- Every text with what it is drawn with. -/
def Node.texts (style : List Rule) : Ctx → Node → List (Ctx × String)
  | c, .text s => if s.trimAscii.isEmpty then [] else [(c, s)]
  | c, .el tag attrs kids =>
    let c' := c.apply style (.el tag attrs kids)
    kids.attach.flatMap fun ⟨k, _⟩ => k.texts style c'

/-- Large text: at least 24 px, or 18.66 px bold (WCAG's 18 pt and 14 pt). -/
def Ctx.large (c : Ctx) : Bool := c.size ≥ 24 || (c.bold && c.size ≥ 19)

/-- Enough contrast: 4.5:1, or 3:1 for large text. -/
def Ctx.contrastOk (c : Ctx) : Bool := if c.large then reaches c.fg c.bg 3 1 else reaches c.fg c.bg 9 2

/-- The text inside a node. -/
def Node.content : Node → String
  | .text s => s
  | .el _ _ kids => String.join (kids.attach.map fun ⟨k, _⟩ => k.content)

def nativeInteractive : List String := ["a", "button", "input", "summary"]

def roles : List String := ["button", "link", "checkbox", "switch", "radio", "tab", "menuitem", "option"]

def Node.interactive (n : Node) : Bool :=
  match n.tag? with
  | some t => nativeInteractive.contains t || (n.attr "data-on").isSome || (n.attr "tabindex").isSome
  | none => false

def nonEmpty (s : Option String) : Bool := match s with
  | some v => !v.trimAscii.isEmpty
  | none => false

/-- An accessible name: `aria-label`, `title` or text inside. -/
def Node.named (n : Node) : Bool :=
  nonEmpty (n.attr "aria-label") || nonEmpty (n.attr "title") || !n.content.trimAscii.isEmpty

/-- A node that takes clicks without being a native control has a role and a tab stop. -/
def Node.roleOk (n : Node) : Bool :=
  match n.tag? with
  | some t => nativeInteractive.contains t || !(n.attr "data-on").isSome ||
      (((n.attr "role").map roles.contains).getD false && (n.attr "tabindex").isSome)
  | none => true

def Node.altOk (n : Node) : Bool := n.tag? != some "img" || (n.attr "alt").isSome

/-- What a face's output gets wrong, by kind. -/
structure Issues where
  unnamed : List Node
  noRole : List Node
  noAlt : List Node
  lowContrast : List (Ctx × String)
  badClass : List Rule
  deriving Repr

def issues (o : FaceOut) : Issues :=
  ⟨o.tree.all.filter (fun n => n.interactive && !n.named), o.tree.all.filter (!·.roleOk),
   o.tree.all.filter (!·.altOk), (o.tree.texts o.style Ctx.base).filter (!·.1.contrastOk),
   o.style.filter (!classOk ·.cls)⟩

/-- The face-runtime's output is accepted. -/
def faceOk (l : TreeLimits) (o : FaceOut) : Bool :=
  let i := issues o
  check l o.tree && i.unnamed.isEmpty && i.noRole.isEmpty && i.noAlt.isEmpty && i.lowContrast.isEmpty &&
    i.badClass.isEmpty

/-! ## What an accepted face guarantees -/

theorem filter_empty {α : Type} {p : α → Bool} {l : List α} (h : (l.filter p).isEmpty = true) :
    ∀ x ∈ l, p x = false := by
  intro x hx
  cases hp : p x with
  | false => rfl
  | true =>
    have : x ∈ l.filter p := List.mem_filter.mpr ⟨hx, hp⟩
    rw [List.isEmpty_iff] at h
    rw [h] at this
    cases this

theorem faceOk_parts {l : TreeLimits} {o : FaceOut} (h : faceOk l o = true) :
    check l o.tree = true ∧ (issues o).unnamed.isEmpty = true ∧ (issues o).noRole.isEmpty = true ∧
    (issues o).noAlt.isEmpty = true ∧ (issues o).lowContrast.isEmpty = true ∧ (issues o).badClass.isEmpty = true := by
  unfold faceOk at h
  simp only [Bool.and_eq_true] at h
  exact ⟨h.1.1.1.1.1, h.1.1.1.1.2, h.1.1.1.2, h.1.1.2, h.1.2, h.2⟩

/-- An accepted face passes the applier's check. -/
theorem face_passes_check {l : TreeLimits} {o : FaceOut} (h : faceOk l o = true) : check l o.tree = true :=
  (faceOk_parts h).1

/-- Every interactive node of an accepted face has an accessible name. -/
theorem face_named {l : TreeLimits} {o : FaceOut} (h : faceOk l o = true) :
    ∀ n ∈ o.tree.all, n.interactive = true → n.named = true := by
  intro n hn hi
  have := filter_empty (faceOk_parts h).2.1 n hn
  simp only [hi, Bool.true_and, Bool.not_eq_false'] at this
  exact this

/-- Every node of an accepted face that takes clicks without being a native control has a role and a tab stop. -/
theorem face_roles {l : TreeLimits} {o : FaceOut} (h : faceOk l o = true) : ∀ n ∈ o.tree.all, n.roleOk = true := by
  intro n hn
  have := filter_empty (faceOk_parts h).2.2.1 n hn
  simpa using this

/-- Every image of an accepted face has an `alt`. -/
theorem face_alt {l : TreeLimits} {o : FaceOut} (h : faceOk l o = true) : ∀ n ∈ o.tree.all, n.altOk = true := by
  intro n hn
  have := filter_empty (faceOk_parts h).2.2.2.1 n hn
  simpa using this

/-- Every text of an accepted face has enough contrast against what it is drawn on. -/
theorem face_contrast {l : TreeLimits} {o : FaceOut} (h : faceOk l o = true) :
    ∀ p ∈ o.tree.texts o.style Ctx.base, p.1.contrastOk = true := by
  intro p hp
  have := filter_empty (faceOk_parts h).2.2.2.2.1 p hp
  simpa using this

/-- Every class of an accepted face's style is a plain name. -/
theorem face_classes {l : TreeLimits} {o : FaceOut} (h : faceOk l o = true) : ∀ r ∈ o.style, classOk r.cls = true := by
  intro r hr
  have := filter_empty (faceOk_parts h).2.2.2.2.2 r hr
  simpa using this

/-! ## Examples -/

def grey (v : UInt8) : RGB := ⟨v, v, v⟩

#guard reaches (grey 0x76) white 9 2
#guard !reaches (grey 0x77) white 9 2
#guard reaches (grey 0x95) white 3 1 == false
#guard reaches white ⟨0, 0x60, 0xdf⟩ 9 2
#guard reaches black white 21 1
#guard (Rule.css { cls := "title", color := some (grey 0x22), size := some 24, bold := some true }) ==
  ".title{color:#222222;font-size:24px;font-weight:700}"

def task : FaceOut :=
  ⟨el "li" [("class", "row")]
    [el "input" [("type", "checkbox"), ("aria-label", "Done"), ("data-on", "toggle")],
     el "span" [("class", "title")] [txt "Buy bread"],
     el "button" [("type", "button"), ("data-on", "remove"), ("aria-label", "Remove")] [txt "×"]],
   [{ cls := "row", background := some white }, { cls := "title", color := some (grey 0x22) }]⟩

def faceExamples : List (String × FaceOut × Bool) :=
  [("a task row", task, true),
   ("dark text on a dark card", ⟨el "div" [("class", "card")] [txt "hidden"],
     [{ cls := "card", color := some (grey 0x33), background := some (grey 0x22) }]⟩, false),
   ("#777777 on white", ⟨el "p" [("class", "muted")] [txt "almost"], [{ cls := "muted", color := some (grey 0x77) }]⟩,
     false),
   ("#767676 on white", ⟨el "p" [("class", "muted")] [txt "just"], [{ cls := "muted", color := some (grey 0x76) }]⟩,
     true),
   ("large #959595 on white fails 3:1", ⟨el "h1" [("class", "big")] [txt "Title"],
     [{ cls := "big", color := some (grey 0x95), size := some 32 }]⟩, false),
   ("large #949494 on white", ⟨el "h1" [("class", "big")] [txt "Title"],
     [{ cls := "big", color := some (grey 0x94), size := some 32 }]⟩, true),
   ("white on a background set above", ⟨el "div" [("class", "brand")] [el "p" [] [txt "on blue"]],
     [{ cls := "brand", color := some white, background := some ⟨0, 0x60, 0xdf⟩ }]⟩, true),
   ("a later rule wins", ⟨el "p" [("class", "a b")] [txt "x"],
     [{ cls := "a", color := some (grey 0xcc) }, { cls := "b", color := some black }]⟩, true),
   ("a button with no name", ⟨el "button" [("data-on", "go")] [], []⟩, false),
   ("a button named by its label", ⟨el "button" [("data-on", "go"), ("aria-label", "Go")] [], []⟩, true),
   ("a clickable div without a role", ⟨el "div" [("data-on", "open")] [txt "Open"], []⟩, false),
   ("a clickable div with a role and a tab stop", ⟨el "div" [("data-on", "open"), ("role", "button"),
     ("tabindex", "0")] [txt "Open"], []⟩, true),
   ("an image without alt", ⟨el "img" [("src", aHash)], []⟩, false),
   ("a decorative image", ⟨el "img" [("src", aHash), ("alt", "")], []⟩, true),
   ("a script in a face", ⟨el "div" [] [el "script" [] [txt "x"]], []⟩, false),
   ("a class that closes its rule", ⟨el "p" [] [txt "x"], [{ cls := "a}body{color:red" }]⟩, false)]

#guard faceExamples.all fun (_, o, ok) => faceOk treeLimits o == ok
#guard faceExamples.all fun (_, o, _) => Canon o.value

end Aven.Runtime

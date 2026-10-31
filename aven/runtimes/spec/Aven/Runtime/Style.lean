import Aven.Runtime.Face

/-!
# The face-runtime's output: a tree and its style, typed (README, "Two kinds of output, and the drawers")

The face-runtime draws a face, its markup part and its style part with the face data, into a node tree and its
style. The style is data: a rule is a selector and typed declarations, the subset avenBRAIN's slides are written in
and nothing else:

- **selectors** are descendant chains, one to four compounds deep, each compound an optional tag of the tree's
  allowlist and up to four class names (`.slide .label`, `.sign .signs-1`, `.slide img`). No pseudo-classes, no
  attribute selectors, no other combinators. Which rule wins is CSS's: the more classes, then the more tags, then the
  later rule;
- **declarations** are typed: lengths in `cqw`, `%`, `px` or `em` with two decimals, colours as RGB, a font weight in
  hundreds, a transform of `translateX`, `translateY`, `rotate` and `scale`, and the one arrowhead clip-path. No
  custom properties, no `url()`, no free text: the drawer writes the CSS text from the data (`Rule.css`).

A face is accepted (`faceOk`) only when:

- **the tree passes the applier's check** (`Tree`), and every interactive node has an accessible name, every
  non-native interactive node a role and a tab stop, every image an `alt` (`Face`);
- **every rule is of the types,** its values in range;
- **every text is at least 9 px where a slide is smallest,** 356 px wide, a phone's width: 2.6cqw is 9.26 px there,
  2.5cqw only 8.9 px, as Firefox measures it, so 2.6cqw is the smallest a slide writes (avenBRAIN's STYLE.md and its
  box check). A size in `px` is held to the same 9 px;
- **every text has enough contrast** against what it is drawn on, as the style resolves it down the tree (WCAG 2.2's
  4.5:1, 3:1 for large text, by `Face`'s table of linear light). What a text is drawn on is the nearest background
  above it, or an earlier sibling layer that covers its whole parent (absolute, `inset: 0`) with a background. An image
  or a partly placed layer under a text isn't seen: a face places its labels on the ground, not on its drawings.
-/

namespace Aven.Runtime

open Aven.Core

/-! ## Values -/

/-- A number with two decimals, in hundredths: 4.2 is 420. -/
abbrev Dec := Int

/-- Two digits, a leading zero kept. -/
def two (n : Nat) : String := (if n < 10 then "0" else "") ++ toString n

/-- A number's CSS text: the shortest decimal, no trailing zeros. -/
def Dec.css (d : Dec) : String :=
  let n := d.natAbs
  let frac := n % 100
  (if d < 0 then "-" else "") ++ toString (n / 100) ++
    (if frac = 0 then "" else if frac % 10 = 0 then "." ++ toString (frac / 10) else "." ++ two frac)

inductive LenUnit where
  | cqw | pct | px | em
  deriving DecidableEq, Repr, Inhabited

def LenUnit.name : LenUnit → String
  | .cqw => "cqw" | .pct => "%" | .px => "px" | .em => "em"

/-- A length: a number with two decimals and its unit. -/
structure Len where
  v : Dec
  unit : LenUnit
  deriving DecidableEq, Repr, Inhabited

def Len.css (l : Len) : String := if l.v = 0 then "0" else l.v.css ++ l.unit.name

def cqw (v : Dec) : Len := ⟨v, .cqw⟩
def pct (v : Dec) : Len := ⟨v, .pct⟩
def px (v : Dec) : Len := ⟨v, .px⟩
def em (v : Dec) : Len := ⟨v, .em⟩

/-- A length within ±10,000 units, in one of `units`. -/
def Len.within (units : List LenUnit) (l : Len) : Bool := units.contains l.unit && l.v.natAbs ≤ 1000000

inductive Side where
  | all | top | right | bottom | left
  deriving DecidableEq, Repr, Inhabited

def Side.suffix : Side → String
  | .all => "" | .top => "-top" | .right => "-right" | .bottom => "-bottom" | .left => "-left"

def Side.name : Side → String
  | .all => "" | .top => "top" | .right => "right" | .bottom => "bottom" | .left => "left"

inductive Line where
  | solid | dotted
  deriving DecidableEq, Repr, Inhabited

def Line.name : Line → String
  | .solid => "solid" | .dotted => "dotted"

inductive Display where
  | block | inlineBlock | flex
  deriving DecidableEq, Repr, Inhabited

def Display.name : Display → String
  | .block => "block" | .inlineBlock => "inline-block" | .flex => "flex"

/-- One step of a transform. `rotate` in hundredths of a degree, `scale` in hundredths. -/
inductive Step where
  | translateX (l : Len)
  | translateY (l : Len)
  | rotate (deg : Dec)
  | scale (s : Dec)
  deriving DecidableEq, Repr, Inhabited

def Step.css : Step → String
  | .translateX l => "translateX(" ++ l.css ++ ")"
  | .translateY l => "translateY(" ++ l.css ++ ")"
  | .rotate d => "rotate(" ++ d.css ++ "deg)"
  | .scale s => "scale(" ++ s.css ++ ")"

def Step.ok : Step → Bool
  | .translateX l | .translateY l => l.within [.pct, .cqw, .px]
  | .rotate d => d.natAbs ≤ 36000
  | .scale s => 0 < s && s ≤ 1000

/-! ## Declarations -/

/-- A declaration, typed: the only properties a face's style has. -/
inductive Decl where
  /-- `position: relative`, or `absolute` -/
  | position (absolute : Bool)
  /-- `inset: 0`: the layer covers its whole parent -/
  | cover
  /-- `left`, `top`, `right` or `bottom` (never `all`) -/
  | place (side : Side) (l : Len)
  | width (l : Len)
  | height (l : Len)
  | display (d : Display)
  /-- `aspect-ratio: w / h` -/
  | aspect (w h : Nat)
  /-- `container-type: inline-size`, so `cqw` inside is a hundredth of this element's width -/
  | container
  /-- `overflow: hidden` -/
  | clip
  | margin (side : Side) (l : Len)
  | padding (side : Side) (l : Len)
  | gap (l : Len)
  | radius (l : Len)
  | border (side : Side) (w : Len) (line : Line) (c : RGB)
  | background (c : RGB)
  | color (c : RGB)
  /-- `font-family`: the one bundled sans, Inter -/
  | sans
  | size (l : Len)
  /-- `font-weight`, 100 to 900 in hundreds -/
  | weight (w : Nat)
  /-- `line-height`, unitless, in hundredths -/
  | leading (h : Dec)
  /-- `letter-spacing` -/
  | tracking (l : Len)
  /-- `text-transform: uppercase` -/
  | upper
  /-- `text-align: center` -/
  | center
  /-- `white-space: nowrap` -/
  | nowrap
  | transform (steps : List Step)
  | origin (x y : Len)
  /-- `clip-path`: the arrowhead, `polygon(0 0, 100% 50%, 0 100%, 25% 50%)`, the only shape -/
  | arrowhead
  deriving DecidableEq, Repr, Inhabited

def Decl.css : Decl → String
  | .position a => "position:" ++ (if a then "absolute" else "relative")
  | .cover => "inset:0"
  | .place s l => s.name ++ ":" ++ l.css
  | .width l => "width:" ++ l.css
  | .height l => "height:" ++ l.css
  | .display d => "display:" ++ d.name
  | .aspect w h => "aspect-ratio:" ++ toString w ++ "/" ++ toString h
  | .container => "container-type:inline-size"
  | .clip => "overflow:hidden"
  | .margin s l => "margin" ++ s.suffix ++ ":" ++ l.css
  | .padding s l => "padding" ++ s.suffix ++ ":" ++ l.css
  | .gap l => "gap:" ++ l.css
  | .radius l => "border-radius:" ++ l.css
  | .border s w line c => "border" ++ s.suffix ++ ":" ++ w.css ++ " " ++ line.name ++ " " ++ c.css
  | .background c => "background-color:" ++ c.css
  | .color c => "color:" ++ c.css
  | .sans => "font-family:'Inter Variable',system-ui,sans-serif"
  | .size l => "font-size:" ++ l.css
  | .weight w => "font-weight:" ++ toString w
  | .leading h => "line-height:" ++ h.css
  | .tracking l => "letter-spacing:" ++ l.css
  | .upper => "text-transform:uppercase"
  | .center => "text-align:center"
  | .nowrap => "white-space:nowrap"
  | .transform ss => "transform:" ++ " ".intercalate (ss.map Step.css)
  | .origin x y => "transform-origin:" ++ x.css ++ " " ++ y.css
  | .arrowhead => "clip-path:polygon(0 0,100% 50%,0 100%,25% 50%)"

def boxUnits : List LenUnit := [.cqw, .pct, .px]

/-- A declaration's values are in range. -/
def Decl.ok : Decl → Bool
  | .place s l => s != .all && l.within boxUnits
  | .width l | .height l | .gap l => l.within boxUnits && 0 ≤ l.v
  | .aspect w h => 1 ≤ w && w ≤ 100 && 1 ≤ h && h ≤ 100
  | .margin _ l => l.within boxUnits
  | .padding _ l | .radius l => l.within boxUnits && 0 ≤ l.v
  | .border _ w _ _ => w.within [.cqw, .px] && 0 ≤ w.v
  | .size l => l.within [.cqw, .px] && 0 < l.v
  | .weight w => 1 ≤ w / 100 && w / 100 ≤ 9 && w % 100 == 0
  | .leading h => 50 ≤ h && h ≤ 300
  | .tracking l => l.within [.em] && l.v.natAbs ≤ 50
  | .transform ss => !ss.isEmpty && ss.length ≤ 4 && ss.all Step.ok
  | .origin x y => x.within boxUnits && y.within boxUnits
  | _ => true

/-! ## Selectors and rules -/

/-- One compound: an optional tag and class names, `img`, `.label`, `p.label.relation`. -/
structure Compound where
  tag : Option String := none
  classes : List String := []
  deriving DecidableEq, Repr, Inhabited

def Compound.ok (c : Compound) : Bool :=
  (c.tag.isSome || !c.classes.isEmpty) && c.classes.length ≤ 4 && c.classes.all classOk &&
    c.tag.all fun t => tagOk t

def Compound.css (c : Compound) : String := c.tag.getD "" ++ String.join (c.classes.map ("." ++ ·))

def Compound.matches (c : Compound) (n : Node) : Bool :=
  c.tag.all (fun t => n.tag? == some t) && c.classes.all n.classes.contains

/-- A selector: compounds from the outermost, each a descendant of the one before. -/
abbrev Selector := List Compound

def Selector.ok (s : Selector) : Bool := 1 ≤ s.length && s.length ≤ 4 && s.all Compound.ok

def Selector.css (s : Selector) : String := " ".intercalate (s.map Compound.css)

/-- CSS's specificity: classes first, then tags. -/
def Selector.specificity (s : Selector) : Nat × Nat :=
  ((s.map (·.classes.length)).sum, (s.filter (·.tag.isSome)).length)

/-- The compounds before the last, nearest first, matched up the ancestors, nearest first: the nearest ancestor that
matches each is taken, which finds a match whenever there is one. -/
def ancestorsMatch : List Compound → List Node → Bool
  | [], _ => true
  | _ :: _, [] => false
  | c :: cs, a :: as => if c.matches a then ancestorsMatch cs as else ancestorsMatch (c :: cs) as

/-- Whether a selector picks node `n`, its ancestors nearest first. -/
def Selector.matches (s : Selector) (ancestors : List Node) (n : Node) : Bool :=
  match s.reverse with
  | [] => false
  | c :: cs => c.matches n && ancestorsMatch cs ancestors

/-- A rule: a selector and its declarations, in order. -/
structure Rule where
  sel : Selector
  decls : List Decl
  deriving DecidableEq, Repr, Inhabited

def Rule.ok (r : Rule) : Bool := r.sel.ok && !r.decls.isEmpty && r.decls.length ≤ 32 && r.decls.all Decl.ok

/-- The CSS text of a rule, generated: the only CSS a face ever gives. -/
def Rule.css (r : Rule) : String := r.sel.css ++ "{" ++ ";".intercalate (r.decls.map Decl.css) ++ "}"

/-- `.a .b …`: a chain of single classes. -/
def cls (cs : List String) : Selector := cs.map fun c => { classes := [c] }

/-- A rule for a chain of single classes. -/
def rule (cs : List String) (ds : List Decl) : Rule := ⟨cls cs, ds⟩

/-! ## The cascade -/

def lexLe (a b : Nat × Nat) : Bool := a.1 < b.1 || (a.1 == b.1 && a.2 ≤ b.2)

/-- The declarations that reach node `n`, in the order they apply: matching rules by specificity, the later rule
last among equals (a stable sort), each rule's declarations in order. -/
def cascade (style : List Rule) (ancestors : List Node) (n : Node) : List Decl :=
  ((style.filter fun r => r.sel.matches ancestors n).mergeSort fun a b => lexLe a.sel.specificity b.sel.specificity)
    |>.flatMap (·.decls)

/-- What a text is drawn with: its colour, what it is drawn on, its size and its weight. -/
structure Look where
  fg : RGB
  bg : RGB
  size : Len
  weight : Nat
  deriving DecidableEq, Repr, Inhabited

/-- The page a face is drawn on, before any rule. -/
def Look.base : Look := ⟨black, white, px 1600, 400⟩

/-- The declarations that reach a node, applied to what it inherits. A background is the node's own; a text inside
is drawn on it. -/
def Look.apply (l : Look) (ds : List Decl) : Look :=
  ds.foldl (fun l d => match d with
    | .color c => { l with fg := c }
    | .background c => { l with bg := c }
    | .size s => { l with size := s }
    | .weight w => { l with weight := w }
    | _ => l) l

/-- Whether the declarations make a layer that covers its whole parent with a background: what it paints, if so. -/
def covers (ds : List Decl) : Option RGB :=
  if ds.contains (.position true) && ds.contains .cover then
    ds.foldl (fun b d => match d with | .background c => some c | _ => b) none
  else none

/-- The width a slide is smallest at, a phone's: `cqw` is measured there. -/
def narrowest : Nat := 356

/-- A size in hundredths of a pixel, where the slide is narrowest. -/
def Len.pxAt (l : Len) : Int :=
  match l.unit with
  | .px => l.v
  | .cqw => l.v * narrowest / 100
  | _ => 0

/-- The smallest text, in hundredths of a pixel where a slide is narrowest: 9 px, which 2.6cqw reaches and 2.5cqw
doesn't. -/
def minText : Int := 900

/-- Large text: at least 24 px, or 18.66 px bold (WCAG's 18 pt and 14 pt). -/
def Look.large (l : Look) : Bool := 2400 ≤ l.size.pxAt || (700 ≤ l.weight && 1866 ≤ l.size.pxAt)

def Look.contrastOk (l : Look) : Bool := if l.large then reaches l.fg l.bg 3 1 else reaches l.fg l.bg 9 2

def Look.sizeOk (l : Look) : Bool := minText ≤ l.size.pxAt

mutual
/-- Every text with what it is drawn with; `ancestors` nearest first. -/
def textsOf (style : List Rule) (ancestors : List Node) (l : Look) : Node → List (Look × String)
  | .text s => if s.trimAscii.isEmpty then [] else [(l, s)]
  | .el tag attrs kids =>
    let n := Node.el tag attrs kids
    kidsTexts style (n :: ancestors) (l.apply (cascade style ancestors n)) kids

/-- The children in order: a layer that covers its parent with a background is what the later ones are drawn on. -/
def kidsTexts (style : List Rule) (ancestors : List Node) (l : Look) : List Node → List (Look × String)
  | [] => []
  | k :: ks =>
    let l' := match k with
      | .el .. => match covers (cascade style ancestors k) with
        | some c => { l with bg := c }
        | none => l
      | .text _ => l
    textsOf style ancestors l k ++ kidsTexts style ancestors l' ks
end

/-! ## A face -/

structure FaceOut where
  tree : Node
  style : List Rule
  deriving Repr, Inhabited

def FaceOut.texts (o : FaceOut) : List (Look × String) := textsOf o.style [] Look.base o.tree

/-- What a face gets wrong, by kind. -/
structure Issues where
  unnamed : List Node
  noRole : List Node
  noAlt : List Node
  badRule : List Rule
  small : List (Look × String)
  lowContrast : List (Look × String)
  deriving Repr

def issues (o : FaceOut) : Issues :=
  ⟨o.tree.all.filter (fun n => n.interactive && !n.named), o.tree.all.filter (!·.roleOk),
   o.tree.all.filter (!·.altOk), o.style.filter (!·.ok), o.texts.filter (!·.1.sizeOk),
   o.texts.filter (!·.1.contrastOk)⟩

/-- A face is accepted. -/
def faceOk (l : TreeLimits) (o : FaceOut) : Bool :=
  let i := issues o
  check l o.tree && i.unnamed.isEmpty && i.noRole.isEmpty && i.noAlt.isEmpty && i.badRule.isEmpty &&
    i.small.isEmpty && i.lowContrast.isEmpty

theorem faceOk_parts {l : TreeLimits} {o : FaceOut} (h : faceOk l o = true) :
    check l o.tree = true ∧ (issues o).unnamed.isEmpty = true ∧ (issues o).noRole.isEmpty = true ∧
    (issues o).noAlt.isEmpty = true ∧ (issues o).badRule.isEmpty = true ∧
    (issues o).small.isEmpty = true ∧ (issues o).lowContrast.isEmpty = true := by
  unfold faceOk at h
  simp only [Bool.and_eq_true] at h
  exact ⟨h.1.1.1.1.1.1, h.1.1.1.1.1.2, h.1.1.1.1.2, h.1.1.1.2, h.1.1.2, h.1.2, h.2⟩

/-- An accepted face passes the applier's check. -/
theorem face_passes_check {l : TreeLimits} {o : FaceOut} (h : faceOk l o = true) : check l o.tree = true :=
  (faceOk_parts h).1

/-- Every rule of an accepted face is of the types: a plain selector, values in range. -/
theorem face_rules {l : TreeLimits} {o : FaceOut} (h : faceOk l o = true) : ∀ r ∈ o.style, r.ok = true := by
  intro r hr
  have := filter_empty (faceOk_parts h).2.2.2.2.1 r hr
  simpa using this

/-- Every text of an accepted face is at least 9 px where the slide is narrowest (2.6cqw). -/
theorem face_size {l : TreeLimits} {o : FaceOut} (h : faceOk l o = true) :
    ∀ p ∈ o.texts, minText ≤ p.1.size.pxAt := by
  intro p hp
  have := filter_empty (faceOk_parts h).2.2.2.2.2.1 p hp
  simpa [Look.sizeOk] using this

/-- Every text of an accepted face has enough contrast against what it is drawn on. -/
theorem face_contrast {l : TreeLimits} {o : FaceOut} (h : faceOk l o = true) :
    ∀ p ∈ o.texts, p.1.contrastOk = true := by
  intro p hp
  have := filter_empty (faceOk_parts h).2.2.2.2.2.2 p hp
  simpa using this

/-- Every node of an accepted face that takes clicks without being a native control has a role and a tab stop. -/
theorem face_roles {l : TreeLimits} {o : FaceOut} (h : faceOk l o = true) : ∀ n ∈ o.tree.all, n.roleOk = true := by
  intro n hn
  have := filter_empty (faceOk_parts h).2.2.1 n hn
  simpa using this

/-- Every interactive node of an accepted face has an accessible name, and every image an `alt`. -/
theorem face_named {l : TreeLimits} {o : FaceOut} (h : faceOk l o = true) :
    (∀ n ∈ o.tree.all, n.interactive = true → n.named = true) ∧ ∀ n ∈ o.tree.all, n.altOk = true := by
  refine ⟨fun n hn hi => ?_, fun n hn => ?_⟩
  · have := filter_empty (faceOk_parts h).2.1 n hn
    simp only [hi, Bool.true_and, Bool.not_eq_false'] at this
    exact this
  · have := filter_empty (faceOk_parts h).2.2.2.1 n hn
    simpa using this

/-! ## As Values -/

def Value.int (i : Int) : Value := if 0 ≤ i then .uint i.toNat else .nint (i.natAbs - 1)

def Len.value (l : Len) : Value := .array [Value.int l.v, .text (ascii l.unit.name)]

def Step.value : Step → Value
  | .translateX l => .array [.text (ascii "translateX"), l.value]
  | .translateY l => .array [.text (ascii "translateY"), l.value]
  | .rotate d => .array [.text (ascii "rotate"), Value.int d]
  | .scale s => .array [.text (ascii "scale"), Value.int s]

/-- A declaration as a Value: its property's name, then its values. -/
def Decl.value (d : Decl) : Value :=
  let t (s : String) : Value := .text (ascii s)
  .array <| match d with
  | .position a => [t "position", t (if a then "absolute" else "relative")]
  | .cover => [t "inset"]
  | .place s l => [t s.name, l.value]
  | .width l => [t "width", l.value]
  | .height l => [t "height", l.value]
  | .display x => [t "display", t x.name]
  | .aspect w h => [t "aspect-ratio", .uint w, .uint h]
  | .container => [t "container-type"]
  | .clip => [t "overflow"]
  | .margin s l => [t ("margin" ++ s.suffix), l.value]
  | .padding s l => [t ("padding" ++ s.suffix), l.value]
  | .gap l => [t "gap", l.value]
  | .radius l => [t "border-radius", l.value]
  | .border s w line c => [t ("border" ++ s.suffix), w.value, t line.name, c.value]
  | .background c => [t "background-color", c.value]
  | .color c => [t "color", c.value]
  | .sans => [t "font-family"]
  | .size l => [t "font-size", l.value]
  | .weight w => [t "font-weight", .uint w]
  | .leading h => [t "line-height", Value.int h]
  | .tracking l => [t "letter-spacing", l.value]
  | .upper => [t "text-transform"]
  | .center => [t "text-align"]
  | .nowrap => [t "white-space"]
  | .transform ss => [t "transform", .array (ss.map Step.value)]
  | .origin x y => [t "transform-origin", x.value, y.value]
  | .arrowhead => [t "clip-path"]

/-- A compound as a Value: `[tag or null, [class, …]]`. -/
def Compound.value (c : Compound) : Value :=
  .array [opt (fun s => .text (ascii s)) c.tag, .array (c.classes.map fun s => .text (ascii s))]

/-- A rule as a Value: `[[compound, …], [declaration, …]]`. -/
def Rule.value (r : Rule) : Value := .array [.array (r.sel.map Compound.value), .array (r.decls.map Decl.value)]

def FaceOut.value (o : FaceOut) : Value :=
  .map [(ascii "tree", o.tree.value), (ascii "style", .array (o.style.map Rule.value))]

end Aven.Runtime

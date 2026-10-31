import Aven.Runtime.Tree

/-!
# What every face is checked with (README, "Two kinds of output, and the drawers")

The face-runtime's output is a node tree and a style (`Style`: rules as data, its checks of size and contrast). What
they share, here:

- **contrast is exact:** sRGB's channels are linearized by one table of integers (`linear`, the value × 10⁷, rounded),
  which the vectors export, so the face-runtime, the applier's check and any tool compute the same ratio (`reaches`);
- **a class name** is lowercase letters, digits and `-` (`classOk`), so it can't close a rule or start another;
- **every interactive node has an accessible name** (`Node.named`), every non-native interactive node a role and a tab
  stop (`Node.roleOk`), and every image an `alt` (`Node.altOk`).
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

/-- A class name: lowercase letters, digits and `-`, so it can't close a rule or start another. -/
def classOk (c : String) : Bool :=
  !c.isEmpty && c.toList.all fun ch => ('a' ≤ ch && ch ≤ 'z') || ('0' ≤ ch && ch ≤ '9') || ch == '-'

def RGB.css (c : RGB) : String := "#" ++ hex [c.r, c.g, c.b]

def RGB.value (c : RGB) : Value := .bytes [c.r, c.g, c.b]

def opt {α : Type} (f : α → Value) : Option α → Value
  | some a => f a
  | none => .null

def Node.attr (n : Node) (k : String) : Option String := (n.attrs.find? (·.1 == k)).map (·.2)

def Node.classes (n : Node) : List String := ((n.attr "class").getD "").splitOn " " |>.filter (!·.isEmpty)

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

/-- An empty filter leaves nothing that passes: what every "no issue of this kind" check unfolds to. -/
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

/-! ## Examples -/

def grey (v : UInt8) : RGB := ⟨v, v, v⟩

#guard reaches (grey 0x76) white 9 2
#guard !reaches (grey 0x77) white 9 2
#guard reaches (grey 0x95) white 3 1 == false
#guard reaches white ⟨0, 0x60, 0xdf⟩ 9 2
#guard reaches black white 21 1

end Aven.Runtime

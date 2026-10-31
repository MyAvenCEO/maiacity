import Aven.Runtime.Style

/-!
# A slide, styled (avenBRAIN's `brain/style/slide.css` and `brain/id/slides/sign.*`)

The slide "A key signs" as a styled face: its tree as avenBRAIN writes it, and its CSS as typed rules. The examples
around it are what the checks refuse: text under 9 px, too little contrast, a layer covering the ground, a selector
or a value out of range, and which rule wins.
-/

namespace Aven.Runtime

open Aven.Core

/-- `.a .b …`: a chain of single classes. -/
def cls (cs : List String) : Selector := cs.map fun c => { classes := [c] }

def rule (cs : List String) (ds : List Decl) : StyleRule := ⟨cls cs, ds⟩

def hexRGB (r g b : UInt8) : RGB := ⟨r, g, b⟩

def navy : RGB := hexRGB 0x23 0x32 0x4a
def cream : RGB := hexRGB 0xfc 0xf5 0xea
def line : RGB := hexRGB 0xe6 0xd8 0xc4
def ochre : RGB := hexRGB 0xc4 0x92 0x3f
def ochreInk : RGB := hexRGB 0x7d 0x4f 0x12
def quiet : RGB := hexRGB 0x4a 0x54 0x68

/-- `brain/style/slide.css`, rule by rule (a selector list is one rule per selector). -/
def slideRules : List StyleRule :=
  [rule ["slide"] [.position false, .width (pct 10000), .aspect 16 9, .margin .all (px 0), .clip, .container,
      .color navy, .background cream, .border .all (px 100) .solid line, .radius (cqw 160)],
   ⟨[{ classes := ["slide"] }, { tag := some "div" }], [.position true, .display .block]⟩,
   ⟨[{ classes := ["slide"] }, { tag := some "span" }], [.position true, .display .block]⟩,
   ⟨[{ classes := ["slide"] }, { tag := some "img" }], [.position true, .display .block]⟩,
   rule ["slide", "title"] [.position true, .place .left (pct 400), .place .top (pct 600), .margin .all (px 0)],
   rule ["slide", "headline"] [.margin .all (px 0), .sans, .size (cqw 420), .weight 800, .leading 100,
      .tracking (em (-1)), .nowrap],
   rule ["slide", "label"] [.position true, .margin .all (px 0), .sans, .size (cqw 260), .weight 700, .leading 115,
      .tracking (em 4), .upper, .center, .nowrap, .transform [.translateX (pct (-5000))]],
   rule ["slide", "relation"] [.color ochreInk, .weight 800],
   rule ["slide", "note"] [.position true, .margin .all (px 0), .color quiet, .sans, .size (cqw 280), .weight 500,
      .leading 130],
   rule ["slide", "path"] [.cover],
   rule ["slide", "dots"] [.height (px 0), .border .top (cqw 60) .dotted ochre, .origin (px 0) (px 0)],
   rule ["slide", "head"] [.width (cqw 240), .height (cqw 240), .background ochre, .arrowhead,
      .origin (pct 5000) (pct 5000)]]

/-- `brain/id/slides/sign.css`: where each layer of "A key signs" stands (two of the path's eight dots). -/
def signRules : List StyleRule :=
  [rule ["sign", "key"] [.place .left (pct 900), .place .top (pct 2133), .width (cqw 2800), .height (cqw 2800)],
   rule ["sign", "key-label"] [.place .left (pct 2300), .place .top (pct 6812)],
   rule ["sign", "signs-1"] [.place .left (pct 3600), .place .top (pct 5333), .width (cqw 326),
      .transform [.rotate (-3247)]],
   rule ["sign", "signs-8"] [.place .left (pct 5525), .place .top (pct 5022), .width (cqw 326),
      .transform [.rotate 3247]],
   rule ["sign", "signs-head"] [.place .left (pct 5680), .place .top (pct 5120), .transform [.rotate 3247]],
   rule ["sign", "signs-name"] [.place .left (pct 4700), .place .top (pct 3804)],
   rule ["sign", "words"] [.place .left (pct 5800), .place .top (pct 1778), .width (cqw 3200), .height (cqw 3200)],
   rule ["sign", "words-label"] [.place .left (pct 7400), .place .top (pct 6898)]]

def art (n : Nat) : String := "/files/" ++ String.ofList ((toString n).toList ++ List.replicate (64 - (toString n).length) 'a')

/-- `brain/id/slides/sign.html`. -/
def signTree : Node :=
  el "figure" [("class", "slide sign"), ("role", "img"), ("aria-label", "Alice's key signs a letter.")]
    [el "img" [("class", "obj key"), ("src", art 1), ("alt", "")],
     el "p" [("class", "label key-label")] [txt "Alice’s key"],
     el "div" [("class", "path signs")]
       [el "div" [("class", "dots signs-1")], el "div" [("class", "dots signs-8")],
        el "div" [("class", "head signs-head")]],
     el "p" [("class", "label relation signs-name")] [txt "signs"],
     el "img" [("class", "obj words"), ("src", art 2), ("alt", "")],
     el "p" [("class", "label words-label")] [txt "Words + signature"],
     el "header" [("class", "title")] [el "h2" [("class", "headline")] [txt "A key signs"]]]

def sign : Styled := ⟨signTree, slideRules ++ signRules⟩

/-- A slide with one more text and one more rule. -/
def withNote (note : Node) (rs : List StyleRule) : Styled :=
  ⟨el "figure" [("class", "slide sign"), ("role", "img"), ("aria-label", "A note.")] [note], slideRules ++ rs⟩

def noteP (c : String) (s : String) : Node := el "p" [("class", c)] [txt s]

def styleExamples : List (String × Styled × Bool) :=
  [("the slide \"A key signs\"", sign, true),
   ("a label at 2.5cqw is too small", withNote (noteP "label" "tiny") [rule ["slide", "label"] [.size (cqw 250)]],
     false),
   ("a label at 2.6cqw is the smallest", withNote (noteP "label" "small") [rule ["slide", "label"] [.size (cqw 260)]],
     true),
   ("9px is the smallest in pixels", withNote (noteP "note" "px") [rule ["slide", "note"] [.size (px 900)]], true),
   ("8.99px is too small", withNote (noteP "note" "px") [rule ["slide", "note"] [.size (px 899)]], false),
   ("ochre text on the cream is too faint", withNote (noteP "note" "faint") [rule ["slide", "note"] [.color ochre]],
     false),
   ("a more specific rule wins over a later one", withNote (noteP "note" "navy")
     [rule ["note"] [.color (hexRGB 0xcc 0xcc 0xcc)], rule ["slide", "note"] [.color navy]], true),
   ("an equally specific later rule wins", withNote (noteP "note" "grey")
     [rule ["slide", "note"] [.color navy], rule ["slide", "note"] [.color (hexRGB 0xcc 0xcc 0xcc)]], false),
   ("a rule for another slide's layer doesn't reach this one", withNote (noteP "note" "navy")
     [rule ["owns", "note"] [.color (hexRGB 0xcc 0xcc 0xcc)]], true),
   ("a covering layer is what later text is drawn on", ⟨el "figure" [("class", "slide")]
     [el "div" [("class", "veil")], noteP "note" "hidden"],
     slideRules ++ [rule ["slide", "veil"] [.cover, .background navy]]⟩, false),
   ("light text on a covering layer", ⟨el "figure" [("class", "slide")]
     [el "div" [("class", "veil")], noteP "note" "shown"],
     slideRules ++ [rule ["slide", "veil"] [.cover, .background navy], rule ["slide", "note"] [.color cream]]⟩, true),
   ("a layer that covers only part isn't seen", ⟨el "figure" [("class", "slide")]
     [el "div" [("class", "patch")], noteP "note" "on the cream"],
     slideRules ++ [rule ["slide", "patch"] [.place .left (pct 0), .width (pct 5000), .background navy]]⟩, true),
   ("a class that closes its rule", withNote (noteP "note" "x") [rule ["note}body{color:red"] [.color navy]], false),
   ("a selector five deep", withNote (noteP "note" "x") [rule ["slide", "a", "b", "c", "note"] [.color navy]], false),
   ("a tag selector for a forbidden tag", withNote (noteP "note" "x")
     [⟨[{ tag := some "script" }], [.color navy]⟩], false),
   ("a weight between the hundreds", withNote (noteP "note" "x") [rule ["slide", "note"] [.weight 450]], false),
   ("a scale of zero", withNote (noteP "note" "x") [rule ["slide", "note"] [.transform [.scale 0]]], false),
   ("a rule with nothing in it", withNote (noteP "note" "x") [rule ["slide", "note"] []], false)]

#guard styleExamples.all fun (_, o, ok) => styledOk treeLimits o == ok
#guard styleExamples.all fun (_, o, _) => Canon o.value

-- the CSS text, generated
#guard (slideRules.map StyleRule.css)[6]! ==
  ".slide .label{position:absolute;margin:0;font-family:'Inter Variable',system-ui,sans-serif;font-size:2.6cqw;" ++
  "font-weight:700;line-height:1.15;letter-spacing:0.04em;text-transform:uppercase;text-align:center;" ++
  "white-space:nowrap;transform:translateX(-50%)}"
#guard (slideRules.map StyleRule.css)[1]! == ".slide div{position:absolute;display:block}"
#guard (signRules.map StyleRule.css)[2]! ==
  ".sign .signs-1{left:36%;top:53.33%;width:3.26cqw;transform:rotate(-32.47deg)}"
#guard (slideRules.map StyleRule.css)[10]! == ".slide .dots{height:0;border-top:0.6cqw dotted #c4923f;transform-origin:0 0}"
-- the label's text in the slide: navy on cream, 2.6cqw bold, 9.26 px where the slide is narrowest
#guard sign.texts.map (fun (l, _) => (l.fg, l.bg, l.size.pxAt, l.weight)) ==
  [(navy, cream, 925, 700), (ochreInk, cream, 925, 800), (navy, cream, 925, 700), (navy, cream, 1495, 800)]

end Aven.Runtime

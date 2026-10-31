import Aven.Runtime.Style

/-!
# Faces, and a slide (avenBRAIN's `brain/style/slide.css` and `brain/id/slides/sign.*`)

What every face is held to: the todo app's task row, names, roles, `alt` and contrast at WCAG's lines. Then the slide
"A key signs" as a face: its tree as avenBRAIN writes it, and its CSS as typed rules, with what the checks refuse
around it: text under 9 px, too little contrast, a layer covering the ground, a selector or a value out of range, and
which rule wins.
-/

namespace Aven.Runtime

open Aven.Core

def hexRGB (r g b : UInt8) : RGB := ⟨r, g, b⟩

def navy : RGB := hexRGB 0x23 0x32 0x4a
def cream : RGB := hexRGB 0xfc 0xf5 0xea
def line : RGB := hexRGB 0xe6 0xd8 0xc4
def ochre : RGB := hexRGB 0xc4 0x92 0x3f
def ochreInk : RGB := hexRGB 0x7d 0x4f 0x12
def quiet : RGB := hexRGB 0x4a 0x54 0x68

/-- `brain/style/slide.css`, rule by rule (a selector list is one rule per selector). -/
def slideRules : List Rule :=
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
def signRules : List Rule :=
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

def sign : FaceOut := ⟨signTree, slideRules ++ signRules⟩

/-- A slide with one more text and one more rule. -/
def withNote (note : Node) (rs : List Rule) : FaceOut :=
  ⟨el "figure" [("class", "slide sign"), ("role", "img"), ("aria-label", "A note.")] [note], slideRules ++ rs⟩

def noteP (c : String) (s : String) : Node := el "p" [("class", c)] [txt s]

def slideExamples : List (String × FaceOut × Bool) :=
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

/-- A task row of the todo app: a checkbox, its title and a remove button. -/
def task : FaceOut :=
  ⟨el "li" [("class", "row")]
    [el "input" [("type", "checkbox"), ("aria-label", "Done"), ("data-on", "toggle")],
     el "span" [("class", "title")] [txt "Buy bread"],
     el "button" [("type", "button"), ("data-on", "remove"), ("aria-label", "Remove")] [txt "×"]],
   [rule ["row"] [.background white], rule ["title"] [.color (grey 0x22)]]⟩

def blue : RGB := ⟨0, 0x60, 0xdf⟩

/-- What every face is held to, slide or not: names, roles, `alt`, the applier's check, and contrast at WCAG's lines
(#767676 on white is the lightest grey that reaches 4.5:1, #949494 the lightest large one that reaches 3:1). -/
def a11yExamples : List (String × FaceOut × Bool) :=
  [("a task row", task, true),
   ("dark text on a dark card", ⟨el "div" [("class", "card")] [txt "hidden"],
     [rule ["card"] [.color (grey 0x33), .background (grey 0x22)]]⟩, false),
   ("#777777 on white", ⟨el "p" [("class", "muted")] [txt "almost"], [rule ["muted"] [.color (grey 0x77)]]⟩, false),
   ("#767676 on white", ⟨el "p" [("class", "muted")] [txt "just"], [rule ["muted"] [.color (grey 0x76)]]⟩, true),
   ("large #959595 on white fails 3:1", ⟨el "h1" [("class", "big")] [txt "Title"],
     [rule ["big"] [.color (grey 0x95), .size (px 3200)]]⟩, false),
   ("large #949494 on white", ⟨el "h1" [("class", "big")] [txt "Title"],
     [rule ["big"] [.color (grey 0x94), .size (px 3200)]]⟩, true),
   ("white on a background set above", ⟨el "div" [("class", "brand")] [el "p" [] [txt "on blue"]],
     [rule ["brand"] [.color white, .background blue]]⟩, true),
   ("a later rule wins", ⟨el "p" [("class", "a b")] [txt "x"],
     [rule ["a"] [.color (grey 0xcc)], rule ["b"] [.color black]]⟩, true),
   ("a button with no name", ⟨el "button" [("data-on", "go")] [], []⟩, false),
   ("a button named by its label", ⟨el "button" [("data-on", "go"), ("aria-label", "Go")] [], []⟩, true),
   ("a clickable div without a role", ⟨el "div" [("data-on", "open")] [txt "Open"], []⟩, false),
   ("a clickable div with a role and a tab stop", ⟨el "div" [("data-on", "open"), ("role", "button"),
     ("tabindex", "0")] [txt "Open"], []⟩, true),
   ("an image without alt", ⟨el "img" [("src", aHash)], []⟩, false),
   ("a decorative image", ⟨el "img" [("src", aHash), ("alt", "")], []⟩, true),
   ("a script in a face", ⟨el "div" [] [el "script" [] [txt "x"]], []⟩, false)]

/-- Every face example: what every face is held to, then the slide and what its checks refuse. -/
def faceExamples : List (String × FaceOut × Bool) := a11yExamples ++ slideExamples

#guard faceExamples.all fun (_, o, ok) => faceOk treeLimits o == ok
#guard faceExamples.all fun (_, o, _) => Canon o.value

-- the CSS text, generated
#guard (slideRules.map Rule.css)[6]! ==
  ".slide .label{position:absolute;margin:0;font-family:'Inter Variable',system-ui,sans-serif;font-size:2.6cqw;" ++
  "font-weight:700;line-height:1.15;letter-spacing:0.04em;text-transform:uppercase;text-align:center;" ++
  "white-space:nowrap;transform:translateX(-50%)}"
#guard (slideRules.map Rule.css)[1]! == ".slide div{position:absolute;display:block}"
#guard (signRules.map Rule.css)[2]! ==
  ".sign .signs-1{left:36%;top:53.33%;width:3.26cqw;transform:rotate(-32.47deg)}"
#guard (slideRules.map Rule.css)[10]! == ".slide .dots{height:0;border-top:0.6cqw dotted #c4923f;transform-origin:0 0}"
-- the label's text in the slide: navy on cream, 2.6cqw bold, 9.26 px where the slide is narrowest
#guard sign.texts.map (fun (l, _) => (l.fg, l.bg, l.size.pxAt, l.weight)) ==
  [(navy, cream, 925, 700), (ochreInk, cream, 925, 800), (navy, cream, 925, 700), (navy, cream, 1495, 800)]

end Aven.Runtime

/-!
# The node-tree allowlist (README, "Two kinds of output, and the drawers")

The one output that becomes DOM: the trees file runtimes give and the face-runtime gives. The applier checks every
tree against this allowlist again before it writes a node, whoever made the tree. A tree passes when every node does
and the whole is within its limits:

- **Tags** only from the allowlist; never `script`, `style`, `iframe`, `object`, `embed`, `form`, `svg` and the rest of
  `forbidden`.
- **Attributes** only from the allowlist, for their tag; never an event handler (`on…`) or `style`.
- **URLs** only where a URL belongs: `src` names a file of the network by its hash (`/files/<64 hex>`), so nothing
  is fetched from outside the network; `href` is `https:`, `mailto:` or a fragment, followed only by a click, through
  the host's confirmation.
- **Limits** on depth, nodes and text.
-/

namespace Aven.Runtime

/-- A node: text, or an element with attributes and children. -/
inductive Node where
  | text (s : String)
  | el (tag : String) (attrs : List (String × String)) (kids : List Node)
  deriving Repr, Inhabited

/-- The node and every node below it, in document order. -/
def Node.all : Node → List Node
  | .text s => [.text s]
  | .el tag attrs kids => .el tag attrs kids :: kids.attach.flatMap fun ⟨k, _⟩ => k.all

def Node.depth : Node → Nat
  | .text _ => 1
  | .el _ _ kids => 1 + (kids.attach.map fun ⟨k, _⟩ => k.depth).foldl max 0

def Node.tag? : Node → Option String
  | .el tag _ _ => some tag
  | .text _ => none

def Node.attrs : Node → List (String × String)
  | .el _ attrs _ => attrs
  | .text _ => []

def Node.textLength : Node → Nat
  | .text s => s.utf8ByteSize
  | .el .. => 0

def allowedTags : List String :=
  ["div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "dl", "dt", "dd", "pre", "code", "em",
   "strong", "b", "i", "u", "s", "sub", "sup", "del", "ins", "kbd", "mark", "small", "blockquote", "hr", "br", "a",
   "img", "table", "caption", "thead", "tbody", "tr", "th", "td", "button", "input", "label", "section", "article",
   "header", "footer", "nav", "figure", "figcaption", "details", "summary", "slot"]

/-- Never allowed, whatever the allowlist says: what runs, styles, frames, submits or leaves the allowlist's world. -/
def forbidden : List String :=
  ["script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "link", "meta", "base", "form",
   "svg", "math", "template", "noscript", "portal", "video", "audio", "source", "track", "canvas"]

def globalAttrs : List String :=
  ["class", "id", "role", "title", "lang", "dir", "tabindex", "hidden", "data-on", "data-key", "data-place"]

def tagAttrs : String → List String
  | "a" => ["href"]
  | "img" => ["src", "alt", "width", "height"]
  | "td" | "th" => ["colspan", "rowspan", "scope"]
  | "input" => ["type", "checked", "disabled", "value", "placeholder", "name"]
  | "button" => ["type", "disabled"]
  | "label" => ["for"]
  | "ol" => ["start"]
  | "li" => ["value"]
  | "details" => ["open"]
  | _ => []

def isHex (c : Char) : Bool := ('0' ≤ c && c ≤ '9') || ('a' ≤ c && c ≤ 'f')

/-- A file of the network, by its hash: `/files/<64 lowercase hex>`. -/
def isFileUrl (v : String) : Bool :=
  let cs := v.toList
  "/files/".toList.isPrefixOf cs && cs.length == 71 && (cs.drop 7).all isHex

/-- A link a click may follow: `https:`, `mailto:` or a fragment of this page. -/
def isLink (v : String) : Bool :=
  let cs := v.toList
  "https://".toList.isPrefixOf cs || "mailto:".toList.isPrefixOf cs || "#".toList.isPrefixOf cs

def valueOk (k v : String) : Bool :=
  if k == "href" then isLink v
  else if k == "src" then isFileUrl v
  else if k == "tabindex" then v == "0" || v == "-1"
  else if k == "type" then ["text", "checkbox", "radio", "number", "search", "button"].contains v
  else true

def isAria (k : String) : Bool := "aria-".toList.isPrefixOf k.toList

def isHandler (k : String) : Bool := "on".toList.isPrefixOf (k.toList.map Char.toLower)

def attrOk (tag : String) (a : String × String) : Bool :=
  !isHandler a.1 && a.1 != "style" &&
  (globalAttrs.contains a.1 || isAria a.1 || (tagAttrs tag).contains a.1) && valueOk a.1 a.2

def tagOk (tag : String) : Bool := allowedTags.contains tag && !forbidden.contains tag

def nodeOk : Node → Bool
  | .text _ => true
  | .el tag attrs _ => tagOk tag && attrs.all (attrOk tag)

structure TreeLimits where
  depth : Nat
  nodes : Nat
  text : Nat
  deriving DecidableEq, Repr

def treeLimits : TreeLimits := ⟨64, 20000, 8 * 1048576⟩

/-- The applier's check. -/
def check (l : TreeLimits) (t : Node) : Bool :=
  t.all.all nodeOk && decide (t.depth ≤ l.depth) && decide (t.all.length ≤ l.nodes) &&
    decide ((t.all.map Node.textLength).sum ≤ l.text)

/-! ## What a checked tree can't hold -/

theorem check_nodes {l : TreeLimits} {t : Node} (h : check l t = true) : ∀ n ∈ t.all, nodeOk n = true := by
  unfold check at h
  simp only [Bool.and_eq_true] at h
  exact List.all_eq_true.mp h.1.1.1

theorem check_attrs {l : TreeLimits} {t : Node} (h : check l t = true) {tag : String} {attrs kids}
    (hn : Node.el tag attrs kids ∈ t.all) : tagOk tag = true ∧ ∀ a ∈ attrs, attrOk tag a = true := by
  have := check_nodes h _ hn
  simp only [nodeOk, Bool.and_eq_true] at this
  exact ⟨this.1, List.all_eq_true.mp this.2⟩

/-- No forbidden element anywhere: no script, style, frame, object, form or SVG. -/
theorem check_no_forbidden {l : TreeLimits} {t : Node} (h : check l t = true) {n : Node} (hn : n ∈ t.all)
    {tag : String} (ht : n.tag? = some tag) : tag ∉ forbidden := by
  cases n with
  | text => cases ht
  | el tag' attrs kids =>
    simp only [Node.tag?, Option.some.injEq] at ht
    subst ht
    have := (check_attrs h hn).1
    simp only [tagOk, Bool.and_eq_true, Bool.not_eq_true'] at this
    intro hm
    have hc : forbidden.contains tag' = true := List.contains_iff_mem.mpr hm
    rw [this.2] at hc
    cases hc

theorem no_script {l : TreeLimits} {t : Node} (h : check l t = true) {n : Node} (hn : n ∈ t.all) :
    n.tag? ≠ some "script" := fun ht => check_no_forbidden h hn ht (by decide)

/-- No event handler and no `style` attribute anywhere. -/
theorem check_no_handlers {l : TreeLimits} {t : Node} (h : check l t = true) {n : Node} (hn : n ∈ t.all)
    {a : String × String} (ha : a ∈ n.attrs) : isHandler a.1 = false ∧ a.1 ≠ "style" := by
  cases n with
  | text => simp [Node.attrs] at ha
  | el tag attrs kids =>
    have := (check_attrs h hn).2 a ha
    simp only [attrOk, Bool.and_eq_true, Bool.not_eq_true', bne_iff_ne, ne_eq] at this
    exact ⟨this.1.1.1, this.1.1.2⟩

/-- Every `src` is a file of the network by its hash, and every `href` a link a click may follow: nothing in a tree
is fetched from outside the network. -/
theorem check_urls {l : TreeLimits} {t : Node} (h : check l t = true) {n : Node} (hn : n ∈ t.all)
    {a : String × String} (ha : a ∈ n.attrs) :
    (a.1 = "src" → isFileUrl a.2 = true) ∧ (a.1 = "href" → isLink a.2 = true) := by
  cases n with
  | text => simp [Node.attrs] at ha
  | el tag attrs kids =>
    have := (check_attrs h hn).2 a ha
    simp only [attrOk, Bool.and_eq_true] at this
    have hv := this.2
    constructor
    · intro hk; simpa [valueOk, hk] using hv
    · intro hk; simpa [valueOk, hk] using hv

/-- A checked tree is within its limits. -/
theorem check_bounded {l : TreeLimits} {t : Node} (h : check l t = true) :
    t.depth ≤ l.depth ∧ t.all.length ≤ l.nodes ∧ (t.all.map Node.textLength).sum ≤ l.text := by
  unfold check at h
  simp only [Bool.and_eq_true, decide_eq_true_eq] at h
  exact ⟨h.1.1.2, h.1.2, h.2⟩

/-! ## Examples -/

def el (tag : String) (attrs : List (String × String) := []) (kids : List Node := []) : Node := .el tag attrs kids
def txt (s : String) : Node := .text s

def aHash : String := "/files/" ++ String.ofList (List.replicate 64 'a')

/-- Nested `n` deep. -/
def nest : Nat → Node
  | 0 => txt "deep"
  | n + 1 => el "div" [] [nest n]

def treeExamples : List (String × Node × Bool) :=
  [("a paragraph", el "p" [] [txt "Hello, ", el "strong" [] [txt "world"]], true),
   ("a list with classes and ARIA", el "ul" [("class", "tasks"), ("aria-label", "Tasks")]
     [el "li" [] [txt "one"], el "li" [] [txt "two"]], true),
   ("a link to https", el "a" [("href", "https://maia.city")] [txt "maiaCITY"], true),
   ("a link to a fragment", el "a" [("href", "#top")] [txt "top"], true),
   ("an image of the network by hash", el "img" [("src", aHash), ("alt", "a dome")], true),
   ("a button with an event by name", el "button" [("type", "button"), ("data-on", "add")] [txt "Add"], true),
   ("a script", el "div" [] [el "script" [] [txt "alert(1)"]], false),
   ("a style element", el "style" [] [txt "body{display:none}"], false),
   ("an iframe", el "iframe" [("src", aHash)], false),
   ("an SVG", el "svg" [] [], false),
   ("a form", el "form" [] [el "button" [] [txt "go"]], false),
   ("an unknown tag", el "marquee" [] [txt "hi"], false),
   ("an onclick", el "div" [("onclick", "steal()")] [], false),
   ("an ONLOAD in capitals", el "img" [("ONLOAD", "steal()"), ("src", aHash), ("alt", "")], false),
   ("a style attribute", el "p" [("style", "background:url(https://evil.example/x)")] [txt "x"], false),
   ("a javascript: link", el "a" [("href", "javascript:steal()")] [txt "click"], false),
   ("a data: link", el "a" [("href", "data:text/html,<script>1</script>")] [txt "click"], false),
   ("a plain http link", el "a" [("href", "http://maia.city")] [txt "click"], false),
   ("a remote image", el "img" [("src", "https://evil.example/pixel.png"), ("alt", "")], false),
   ("a data: image", el "img" [("src", "data:image/png;base64,AAAA"), ("alt", "")], false),
   ("an image by a hash in capitals", el "img" [("src", "/files/" ++ String.ofList (List.replicate 64 'A')),
     ("alt", "")], false),
   ("a srcset", el "img" [("src", aHash), ("srcset", "https://evil.example/x 2x"), ("alt", "")], false),
   ("an href on a div", el "div" [("href", "https://maia.city")] [], false),
   ("an input of type file", el "input" [("type", "file")], false),
   ("a tabindex of 5", el "div" [("tabindex", "5")] [], false),
   ("64 deep", nest 63, true),
   ("65 deep", nest 64, false)]

#guard treeExamples.all fun (_, t, ok) => check treeLimits t == ok

end Aven.Runtime

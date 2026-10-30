import Aven.Actor.State
import Aven.Runtime.Face

/-!
# face-runtime's input: markup (ARCHITECTURE.md, sections 5, 6 and 8)

A face's `markup` part is a tree in a small vocabulary, with no conditionals: the markup computes nothing.

- **Text**, literal or looked up: `$` in the face data, `$$` in the current list item.
- **Elements**, with attributes from the same sources, and `$on`: the name of the event a click on it sends.
- **`$each`**: the body once per item of a list in the face data, keyed by a path in the item. An item whose key
  repeats an earlier one is skipped, so keys stay unique.
- **`$use`**: places a component at a named place. It draws as an empty `slot` the applier fits the placed face
  actor's root into, and it is a placement the kernel turns into a spawn, a `props` tell or a retirement
  (section 6). Its place is the path of places and keys down to it, so a place inside `$each` is per item.

Drawing gives nodes and placements. What it proves, for any markup and any data:

- `draw_nodes_ok`: every node drawn passes the applier's per-node check (`Aven.Runtime.nodeOk`): a tag the allowlist
  refuses is dropped with what is under it, and an attribute it refuses is dropped. So a face can fail only on its
  limits or its accessibility, which `faceRun` checks with `Aven.Runtime.faceOk`.
- `draw_events`: every event a drawn node carries is one the markup names, so the clicks a face can send are known
  from its definition.

The `style` part is `Aven.Runtime`'s list of rules: style as data, never CSS text.
-/

namespace Aven.Actor

open Aven.Core (Value TypeId Bytes)
open Aven.Runtime (Node nodeOk tagOk attrOk FaceOut faceOk treeLimits)

/-- Where a piece of text comes from: a literal, `$` (the face data) or `$$` (the current list item). -/
inductive Src where
  | lit (s : String)
  | data (p : Path)
  | item (p : Path)
  deriving Repr, Inhabited

inductive Markup where
  | text (src : Src)
  | el (tag : String) (attrs : List (String × Src)) (on : Option String) (kids : List Markup)
  | each (list : Path) (key : Path) (body : Markup)
  | use (place : String) (component : String) (props : List (String × Src))
  deriving Repr, Inhabited

/-- A Value as text: text as itself, numbers in decimal, `true` and `false`; anything else is empty. -/
def render : Value → String
  | .text b => (String.fromUTF8? ⟨b.toArray⟩).getD ""
  | .uint n => toString n
  | .nint n => "-" ++ toString (n + 1)
  | .bool b => toString b
  | _ => ""

def Src.eval (src : Src) (data item : Value) : String :=
  match src with
  | .lit s => s
  | .data p => ((getAt data p).map render).getD ""
  | .item p => ((getAt item p).map render).getD ""

/-- A placement: the place, the component placed there, and its props. -/
structure Placement where
  place : String
  component : String
  props : List (String × String)
  deriving Repr, Inhabited

/-- The items of the list at `p`, with their keys, skipping an item whose key repeats an earlier one. -/
def keyed (data : Value) (p key : Path) : List (String × Value) :=
  let items := match getAt data p with
    | some (.array xs) => xs
    | _ => []
  (items.map fun it => (((getAt it key).map render).getD "", it)).foldl
    (fun acc kv => if acc.any (·.1 == kv.1) then acc else acc ++ [kv]) []

/-- The attributes the runtime writes itself; markup can't set them. -/
def reserved : List String := ["data-on", "data-place"]

/-- An element's attributes: each source evaluated, the event added, and whatever the allowlist refuses dropped. -/
def attrsOf (tag : String) (attrs : List (String × Src)) (on : Option String) (data item : Value) :
    List (String × String) :=
  (((attrs.filter fun a => !reserved.contains a.1).map fun (a : String × Src) => (a.1, a.2.eval data item)) ++ ((on.map fun e => [("data-on", e)]).getD [])).filter
    (attrOk tag)

def draw (data item : Value) (pre : String) : Markup → List Node × List Placement
  | .text src => ([.text (src.eval data item)], [])
  | .el tag attrs on kids =>
    if tagOk tag then
      let rs := kids.attach.map fun ⟨k, _⟩ => draw data item pre k
      ([.el tag (attrsOf tag attrs on data item) (rs.flatMap (·.1))], rs.flatMap (·.2))
    else ([], [])
  | .each p key body =>
    let rs := (keyed data p key).map fun (kt, it) => draw data it (pre ++ "/" ++ kt) body
    (rs.flatMap (·.1), rs.flatMap (·.2))
  | .use place comp props =>
    let at_ := pre ++ "/" ++ place
    ([.el "slot" [("data-place", at_)] []], [⟨at_, comp, props.map fun (a : String × Src) => (a.1, a.2.eval data item)⟩])

/-- The events a markup names. -/
def Markup.events : Markup → List String
  | .text _ => []
  | .el _ _ on kids => on.toList ++ kids.attach.flatMap fun ⟨k, _⟩ => k.events
  | .each _ _ body => body.events
  | .use .. => []

/-! ## Every drawn node passes the allowlist -/

theorem attrsOf_ok (tag : String) (attrs : List (String × Src)) (on : Option String) (data item : Value) :
    (attrsOf tag attrs on data item).all (attrOk tag) = true := by
  simp only [attrsOf, List.all_eq_true, List.mem_filter]
  intro a ha; exact ha.2

theorem slot_ok (at_ : String) : nodeOk (.el "slot" [("data-place", at_)] []) = true := by
  simp [nodeOk, tagOk, Aven.Runtime.allowedTags, Aven.Runtime.forbidden, attrOk, Aven.Runtime.isHandler,
    Aven.Runtime.globalAttrs, Aven.Runtime.valueOk]
  decide

theorem draw_nodes_ok (data item : Value) (pre : String) (m : Markup) :
    ∀ n ∈ (draw data item pre m).1, ∀ x ∈ n.all, nodeOk x = true := by
  induction item, pre, m using draw.induct data with
  | case1 item pre src => intro n hn x hx; simp [draw] at hn; subst hn; simp [Node.all] at hx; subst hx; rfl
  | case2 item pre tag attrs on kids htag ih =>
    intro n hn x hx
    simp only [draw, htag, ite_true, List.mem_singleton] at hn
    subst hn
    simp only [Node.all, List.mem_cons, List.mem_flatMap] at hx
    rcases hx with rfl | ⟨⟨k, hk⟩, -, hx⟩
    · simp only [nodeOk, htag, Bool.true_and]; exact attrsOf_ok ..
    · simp only [List.mem_flatMap, List.mem_map, List.mem_attach, true_and, Subtype.exists] at hk
      obtain ⟨r, ⟨k', hk', rfl⟩, hkr⟩ := hk
      exact ih k' hk' k hkr x hx
  | case3 => intro n hn; simp [draw, *] at hn
  | case4 item pre p key body ih =>
    intro n hn x hx
    simp only [draw, List.mem_flatMap, List.mem_map] at hn
    obtain ⟨r, ⟨⟨kt, it⟩, -, rfl⟩, hn⟩ := hn
    exact ih kt it n hn x hx
  | case5 item pre place comp props =>
    intro n hn x hx
    simp only [draw, List.mem_singleton] at hn
    subst hn
    simp only [Node.all, List.attach_nil, List.flatMap_nil, List.mem_singleton] at hx
    subst hx
    exact slot_ok _

theorem attrsOf_event {tag : String} {attrs : List (String × Src)} {on : Option String} {data item : Value}
    {e : String} (h : ("data-on", e) ∈ attrsOf tag attrs on data item) : e ∈ on.toList := by
  simp only [attrsOf, List.mem_filter, List.mem_append, List.mem_map] at h
  obtain ⟨h | h, -⟩ := h
  · obtain ⟨a, ha, hae⟩ := h
    have : a.1 = "data-on" := congrArg Prod.fst hae
    simp [reserved, this] at ha
  · cases on with
    | none => simp at h
    | some e' => simp at h; simp [h]

/-- Every event a drawn node carries is one the markup names. -/
theorem draw_events (data item : Value) (pre : String) (m : Markup) :
    ∀ n ∈ (draw data item pre m).1, ∀ x ∈ n.all, ∀ e, ("data-on", e) ∈ x.attrs → e ∈ m.events := by
  induction item, pre, m using draw.induct data with
  | case1 item pre src =>
    intro n hn x hx e he; simp [draw] at hn; subst hn; simp [Node.all] at hx; subst hx; simp [Node.attrs] at he
  | case2 item pre tag attrs on kids htag ih =>
    intro n hn x hx e he
    simp only [draw, htag, ite_true, List.mem_singleton] at hn
    subst hn
    simp only [Node.all, List.mem_cons, List.mem_flatMap] at hx
    rcases hx with rfl | ⟨⟨k, hk⟩, -, hx⟩
    · simp only [Markup.events, List.mem_append]; exact .inl (attrsOf_event he)
    · simp only [List.mem_flatMap, List.mem_map, List.mem_attach, true_and, Subtype.exists] at hk
      obtain ⟨r, ⟨k', hk', rfl⟩, hkr⟩ := hk
      simp only [Markup.events, List.mem_append, List.mem_flatMap, List.mem_attach, true_and, Subtype.exists]
      exact .inr ⟨k', hk', ih k' hk' k hkr x hx e he⟩
  | case3 => intro n hn; simp [draw, *] at hn
  | case4 item pre p key body ih =>
    intro n hn x hx e he
    simp only [draw, List.mem_flatMap, List.mem_map] at hn
    obtain ⟨r, ⟨⟨kt, it⟩, -, rfl⟩, hn⟩ := hn
    simp only [Markup.events]
    exact ih kt it n hn x hx e he
  | case5 item pre place comp props =>
    intro n hn x hx e he
    simp only [draw, List.mem_singleton] at hn
    subst hn
    simp only [Node.all, List.attach_nil, List.flatMap_nil, List.mem_singleton] at hx
    subst hx
    simp [Node.attrs] at he

/-- A face part: its markup and its style. -/
structure FacePart where
  markup : Markup
  style : List Aven.Runtime.Rule
  deriving Repr, Inhabited

/-- face-runtime: the tree under one root, its style, and its placements; refused when the face fails the applier's
check or its accessibility (`Aven.Runtime.faceOk`), or when two placements share a place. -/
def faceRun (fp : FacePart) (data : Value) : Option (FaceOut × List Placement) :=
  let (ns, pls) := draw data .null "" fp.markup
  let o : FaceOut := ⟨.el "div" [] ns, fp.style⟩
  if faceOk treeLimits o && (pls.map (·.place)).eraseDups.length == pls.length then some (o, pls) else none

/-- What face-runtime gives back passes the applier's check and every accessibility rule. -/
theorem faceRun_ok {fp : FacePart} {data : Value} {o : FaceOut} {pls : List Placement}
    (h : faceRun fp data = some (o, pls)) : faceOk treeLimits o = true := by
  unfold faceRun at h
  split at h
  simp only [Bool.and_eq_true, beq_iff_eq] at h
  split at h
  · next hc => simp only [Option.some.injEq, Prod.mk.injEq] at h; obtain ⟨rfl, -⟩ := h; exact hc.1
  · simp at h

end Aven.Actor

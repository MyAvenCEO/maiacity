import Aven.Runtime.Tree
import Aven.Runtime.State

/-!
# markdown-runtime (README, "The first file runtimes, in order")

GitHub-flavoured Markdown to a node tree. The parser itself is mechanics (README of aven/DB2, rule 10): a CommonMark
parser in Rust, held by its own tests and a hostile corpus. What has exact answers is here, and the runtime's Rust
replays it:

- **Heading ids,** GitHub's way (`slug`, `slugs`): lowercase ASCII letters, digits, `-` and `_` kept, a space becomes
  `-`, ASCII punctuation goes, and a heading whose slug came before gets `-1`, `-2`, …. Letters beyond ASCII are kept
  as they are; punctuation beyond ASCII (general punctuation, Latin-1's signs, CJK's) goes.
- **Links** (`rewrite`): a link the allowlist takes (`https:`, `mailto:`, `#…`) stays; any other is rewritten by the
  first rule whose prefix it starts with (`glossary:` → `#/brain/glossary/`, say), and kept only if the result is a
  link the allowlist takes. Otherwise the link's text stays, without a link (`rewrite_link`).
- **The runtime** (`markdownRuntime`), stated for any parser: its part is the file's bytes, its input the link rules,
  and an answer is a tree that passed the applier's check (`markdown_ok`). A parser bug can make a file download; it
  can never put an unchecked node on a page.
-/

namespace Aven.Runtime

open Aven.Core (Value Bytes encode)

/-! ## Heading ids -/

/-- Punctuation beyond ASCII: general punctuation, Latin-1's signs, and CJK's symbols and punctuation. -/
def wide (c : Char) : Bool :=
  (0x2000 ≤ c.val && c.val ≤ 0x206F) || (0xA0 ≤ c.val && c.val ≤ 0xBF) || (0x3000 ≤ c.val && c.val ≤ 0x303F) ||
    c.val == 0xD7 || c.val == 0xF7

def slugChar (c : Char) : List Char :=
  if 'A' ≤ c && c ≤ 'Z' then [c.toLower]
  else if ('a' ≤ c && c ≤ 'z') || ('0' ≤ c && c ≤ '9') || c == '-' || c == '_' then [c]
  else if c == ' ' then ['-']
  else if c.val ≥ 128 && !wide c then [c]
  else []

/-- A heading's slug. -/
def slug (s : String) : String := String.ofList (s.toList.flatMap slugChar)

/-- Every heading's id, in order: its slug, or its slug and `-n` where the same slug came `n` times before. -/
def slugs (hs : List String) : List String :=
  (hs.foldl (fun (seen, out) h =>
    let s := slug h
    let n := seen.count s
    (s :: seen, out ++ [if n == 0 then s else s ++ "-" ++ toString n])) (([] : List String), ([] : List String))).2

/-! ## Links -/

/-- A link's target: kept when the allowlist takes it; otherwise the first rule whose prefix it starts with rewrites it,
and the result is kept only when the allowlist takes it. `none`: the link's text stays, without a link. -/
def rewrite (rules : List (String × String)) (href : String) : Option String :=
  if isLink href then some href
  else match rules.find? (fun r => r.1.toList.isPrefixOf href.toList) with
    | some (f, t) =>
      let out := t ++ String.ofList (href.toList.drop f.length)
      if isLink out then some out else none
    | none => none

/-- **Every link kept is one the allowlist takes.** -/
theorem rewrite_link {rules : List (String × String)} {href out : String} (h : rewrite rules href = some out) :
    isLink out = true := by
  unfold rewrite at h
  split at h
  · cases h; assumption
  · split at h
    · dsimp only at h
      split at h
      · cases h; assumption
      · cases h
    · cases h

/-! ## The runtime -/

/-- The runtime's input: the link rules, `{"links": [[prefix, replacement], …]}`, or `{}` for none. -/
structure Params where
  links : List (String × String)
  deriving Repr, Inhabited

def rule? : Value → Option (String × String)
  | .array [a, b] => do return (← text? a, ← text? b)
  | _ => none

def Params.ofValue? : Value → Option Params
  | .map [] => some ⟨[]⟩
  | .map [(k, .array rs)] => if k == ascii "links" then (mapM rule? rs).map Params.mk else none
  | _ => none

/-- markdown-runtime under the contract, for a parser `parse`: the part is the file's bytes, which must be UTF-8; the
answer is the parsed tree, only when it passes the applier's check, as its Value. Fuel and memory grow with the file. -/
def markdownRuntime (parse : Params → String → Node) (l : TreeLimits) : Runtime where
  eval p i := match p, Params.ofValue? i with
    | .bytes b, some ps => match String.fromUTF8? ⟨b.toArray⟩ with
      | some s => let t := parse ps s; if check l t then .ok t.value else .error .refused
      | none => .error .refused
    | _, _ => .error .refused
  fuel p _ := 64 * (encode p).length + 64
  memory p _ := 16 * (encode p).length + 65536
  input i := (Params.ofValue? i).isSome
  output _ := true

/-- **Every answer is a tree that passed the applier's check,** whatever the parser does. -/
theorem markdown_ok {parse : Params → String → Node} {l : TreeLimits} {lim : Limits} {p i o : Value}
    (h : run (markdownRuntime parse l) lim p i = .ok o) : ∃ t, o = t.value ∧ check l t = true := by
  have he := (run_ok_fits h).2.2.2
  simp only [markdownRuntime] at he
  split at he
  · split at he
    · split at he
      · rename_i hc; cases he; exact ⟨_, rfl, hc⟩
      · cases he
    · cases he
  · cases he

/-! ## Examples -/

def headingExamples : List (String × List String × List String) :=
  [("a plain heading", ["Hello World"], ["hello-world"]),
   ("punctuation goes", ["What's new? (2026)"], ["whats-new-2026"]),
   ("hyphens and underscores stay", ["a-b_c"], ["a-b_c"]),
   ("repeats are numbered", ["Intro", "Intro", "Intro"], ["intro", "intro-1", "intro-2"]),
   ("letters beyond ASCII stay", ["Grüße aus Köln"], ["grüße-aus-köln"]),
   ("punctuation beyond ASCII goes", ["Vault — key’s owner"], ["vault--keys-owner"]),
   ("only punctuation", ["!!!", "???"], ["", "-1"]),
   ("code and spaces", ["The `Store` contract"], ["the-store-contract"])]

#guard headingExamples.all fun (_, hs, ids) => slugs hs == ids

def avenBrainRules : List (String × String) :=
  [("glossary:", "#/brain/glossary/"), ("aven/", "https://github.com/MyAvenCEO/maiacity/blob/main/aven/")]

def linkExamples : List (String × String × Option String) :=
  [("an https link stays", "https://maia.city", some "https://maia.city"),
   ("a fragment stays", "#vault", some "#vault"),
   ("a mail link stays", "mailto:hi@maia.city", some "mailto:hi@maia.city"),
   ("a glossary link is rewritten", "glossary:vault", some "#/brain/glossary/vault"),
   ("a repository path is rewritten", "aven/DB2/README.md", some "https://github.com/MyAvenCEO/maiacity/blob/main/aven/DB2/README.md"),
   ("javascript: goes", "javascript:steal()", none),
   ("plain http goes", "http://maia.city", none),
   ("data: goes", "data:text/html,<script>1</script>", none),
   ("a relative path no rule names goes", "../secrets", none),
   ("a rule can't make a link the allowlist refuses", "evil:x", none)]

#guard linkExamples.all fun (_, href, out) => rewrite (avenBrainRules ++ [("evil:", "javascript:")]) href == out

end Aven.Runtime

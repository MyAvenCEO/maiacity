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
- **Links resolve against their document** (`resolve`, v2): a link with a scheme (`https:`, `glossary:`) is never
  resolved; a fragment alone (`#heading`) gets the document's `idPrefix`, so it still reaches its heading; any other
  is a path, resolved lexically against `base`, the document's own path, by RFC 3986's `remove_dot_segments`, with
  `..` clamped at the root (`removeDots_no_dots`), its query and fragment kept. No fetch and no lookup: what a link in a
  Markdown document points to is Markdown's (ARCHITECTURE A45), and `base` names a path, never a place.
- **Links** (`rewrite`): a link the allowlist takes (`https:`, `mailto:`, `#…`) stays; any other is rewritten by the
  first rule whose prefix it starts with (`glossary:` → `#/brain/glossary/`, say), and kept only if the result is a
  link the allowlist takes. Otherwise the link's text stays, without a link (`rewrite_link`). The rules, `base` and
  `idPrefix` are the input: the document's owner gives them (the brain, its package pages and the repository's URL),
  and the runtime knows no repository.
- **Heading ids** carry `idPrefix`, so two documents on one page never share an id.
- **A soft break is a space** (v2): a line break inside a paragraph is ` `, as CommonMark allows, so a paragraph's
  text is one line. A table's header cell names its column (`scope="col"`), for a reader that reads it aloud.
- **The runtime** (`markdownRuntime`), stated for any parser: its part is the file's bytes, its input the params, and
  an answer is a tree that passed the applier's check (`markdown_ok`). A parser bug can make a file download; it can
  never put an unchecked node on a page.
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

/-! ## Resolving a link against its document -/

/-- Whether an href starts with a scheme (RFC 3986, 3.1): a letter, then letters, digits, `+`, `-` or `.`, then `:`. -/
def hasScheme (href : String) : Bool :=
  let name := href.toList.takeWhile (· != ':')
  name.length < href.length && match name with
    | c :: cs => c.isAlpha && cs.all fun c => c.isAlphanum || c == '+' || c == '-' || c == '.'
    | [] => false

/-- RFC 3986's `remove_dot_segments` over a path's segments, `..` clamped at the root: `.` goes, `..` takes back the
segment before it if there is one. A path that ends in `.` or `..` names a directory, and keeps its last `/`. -/
def removeDots (segs : List String) : List String :=
  let out := segs.foldl (fun acc s => if s == "." then acc else if s == ".." then acc.dropLast else acc ++ [s]) []
  if segs.getLast? == some "." || segs.getLast? == some ".." then out ++ [""] else out

/-- `s` cut at the first `c`: what comes before, and what comes after, if `c` is in it. -/
def cut (s : String) (c : Char) : String × Option String :=
  match s.toList.span (· != c) with
  | (a, _ :: b) => (String.ofList a, some (String.ofList b))
  | (a, []) => (String.ofList a, none)

/-- A link's target, resolved against its document: a scheme's never; a fragment alone gets `idPrefix`; a path is
merged with the directory of `base` (or the root, after a leading `/`) and its dot segments removed, its query and
fragment kept. -/
def resolve (base idPrefix href : String) : String :=
  if hasScheme href then href else
  let (rest, frag) := cut href '#'
  let (path, query) := cut rest '?'
  let tail := (query.map ("?" ++ ·)).getD "" ++ (frag.map ("#" ++ ·)).getD ""
  if path.isEmpty && query.isNone then
    match frag with
    | some f => "#" ++ idPrefix ++ f
    | none => href
  else
    let segs :=
      if path.isEmpty then base.splitOn "/"
      else if path.startsWith "/" then (path.drop 1).toString.splitOn "/"
      else (base.splitOn "/").dropLast ++ path.splitOn "/"
    "/".intercalate (removeDots segs) ++ tail

/-- **A resolved path has no dot segments,** whatever `..` it held: it never climbs above the root. -/
theorem removeDots_no_dots (segs : List String) : ∀ s ∈ removeDots segs, s ≠ "." ∧ s ≠ ".." := by
  have h : ∀ (acc : List String), (∀ s ∈ acc, s ≠ "." ∧ s ≠ "..") → ∀ (l : List String),
      ∀ s ∈ l.foldl (fun acc s => if s == "." then acc else if s == ".." then acc.dropLast else acc ++ [s]) acc,
        s ≠ "." ∧ s ≠ ".." := by
    intro acc hacc l
    induction l generalizing acc with
    | nil => exact hacc
    | cons x xs ih =>
      apply ih
      intro s hs
      by_cases h1 : x = "."
      · simp [h1] at hs; exact hacc s hs
      · by_cases h2 : x = ".."
        · simp [h2] at hs; exact hacc s (List.dropLast_subset _ hs)
        · have h1' : (x == ".") = false := by simpa using h1
          have h2' : (x == "..") = false := by simpa using h2
          simp only [h1', h2', Bool.false_eq_true, ite_false, List.mem_append, List.mem_singleton] at hs
          rcases hs with hs | rfl
          · exact hacc s hs
          · exact ⟨h1, h2⟩
  intro s hs
  unfold removeDots at hs
  split at hs
  · rcases List.mem_append.mp hs with hs | hs
    · exact h [] (by simp) segs s hs
    · simp at hs; subst hs; decide
  · exact h [] (by simp) segs s hs

/-! ## The runtime -/

/-- The runtime's input (v2): the link rules, the document's path and its ids' prefix, `{"links": [[prefix,
replacement], …], "base": path, "idPrefix": prefix}`, each optional, no other key: `{}` is no rules, the root and no
prefix. -/
structure Params where
  links : List (String × String)
  base : String := ""
  idPrefix : String := ""
  deriving Repr, Inhabited

def rule? : Value → Option (String × String)
  | .array [a, b] => do return (← text? a, ← text? b)
  | _ => none

/-- The params from their Value: a map whose keys are among `links`, `base` and `idPrefix`, each once. -/
def Params.ofValue? : Value → Option Params
  | .map kvs =>
    let keys := kvs.map (·.1)
    let known := [ascii "links", ascii "base", ascii "idPrefix"]
    if keys.all known.contains && keys.eraseDups.length == keys.length then do
      let links ← match kvs.lookup (ascii "links") with
        | some (.array rs) => mapM rule? rs
        | some _ => none
        | none => some []
      let base ← match kvs.lookup (ascii "base") with
        | some v => text? v
        | none => some ""
      let idPrefix ← match kvs.lookup (ascii "idPrefix") with
        | some v => text? v
        | none => some ""
      return { links, base, idPrefix }
    else none
  | _ => none

/-- A link in a document: resolved against it, then rewritten by the rules (`none`: its text stays, without a link). -/
def linkTo (p : Params) (href : String) : Option String := rewrite p.links (resolve p.base p.idPrefix href)

/-- **Every link kept is one the allowlist takes,** however it resolved. -/
theorem linkTo_link {p : Params} {href out : String} (h : linkTo p href = some out) : isLink out = true :=
  rewrite_link h

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

/-- Links resolved against a document: its path, its ids' prefix, the link, and where it resolves to. -/
def resolveExamples : List (String × String × String × String × String) :=
  [("a sibling file", "aven/DB2/brain/README.md", "", "GLOSSARY.md", "aven/DB2/brain/GLOSSARY.md"),
   ("a folder, its slash kept", "aven/DB2/brain/STYLE.md", "", "style/reference/", "aven/DB2/brain/style/reference/"),
   ("up a level", "aven/DB2/brain/id/README.md", "", "../GLOSSARY.md", "aven/DB2/brain/GLOSSARY.md"),
   ("a fragment and a query are kept", "aven/DB2/brain/id/README.md", "", "../VOICE.md?plain=1#rules",
     "aven/DB2/brain/VOICE.md?plain=1#rules"),
   (".. never climbs above the root", "aven/README.md", "", "../../../../etc/passwd", "etc/passwd"),
   ("from the root", "aven/DB2/brain/README.md", "", "/aven/runtimes/README.md", "aven/runtimes/README.md"),
   ("dot segments go", "aven/DB2/brain/README.md", "", "./id/./slides/../README.md", "aven/DB2/brain/id/README.md"),
   ("a path that ends in .. is a folder", "aven/DB2/brain/id/README.md", "", "..", "aven/DB2/brain/"),
   ("a fragment alone gets the prefix", "aven/DB2/brain/GLOSSARY.md", "g-", "#vault", "#g-vault"),
   ("a fragment alone, no prefix", "aven/DB2/brain/README.md", "", "#the-story", "#the-story"),
   ("a scheme is never resolved", "aven/DB2/brain/README.md", "g-", "glossary:vault", "glossary:vault"),
   ("https is never resolved", "aven/DB2/brain/README.md", "", "https://maia.city/a/../b", "https://maia.city/a/../b"),
   ("javascript: stays itself, for the allowlist to refuse", "aven/README.md", "", "javascript:x", "javascript:x"),
   ("a query alone is the document's", "aven/DB2/brain/README.md", "", "?plain=1", "aven/DB2/brain/README.md?plain=1"),
   ("no document: from the root", "", "", "aven/DB2/README.md", "aven/DB2/README.md")]

#guard resolveExamples.all fun (_, base, pre, href, out) => resolve base pre href == out

/-- The brain's own rules, as it gives them: its package pages first, then the repository. -/
def brainRules : List (String × String) :=
  [("glossary:", "#/brain/glossary/"), ("aven/DB2/brain/id/README.md", "#/brain/id"),
   ("aven/", "https://github.com/MyAvenCEO/maiacity/blob/main/aven/")]

/-- Links in a document under the brain's rules: where each goes, or `none` for its text alone. -/
def linkToExamples : List (String × String × String × String × Option String) :=
  [("a term", "aven/DB2/brain/id/slides/owns.md", "", "glossary:vault", some "#/brain/glossary/vault"),
   ("a package's page", "aven/DB2/brain/README.md", "", "id/README.md", some "#/brain/id"),
   ("a file in the repository", "aven/DB2/brain/VOICE.md", "", "GLOSSARY.md",
     some "https://github.com/MyAvenCEO/maiacity/blob/main/aven/DB2/brain/GLOSSARY.md"),
   ("in the glossary, a heading of its own", "aven/DB2/brain/GLOSSARY.md", "g-", "#vault", some "#g-vault"),
   ("outside every rule: text only", "x/README.md", "", "../../secret", none),
   ("javascript: text only", "aven/README.md", "", "javascript:steal()", none)]

#guard linkToExamples.all fun (_, base, pre, href, out) => linkTo { links := brainRules, base, idPrefix := pre } href == out

end Aven.Runtime

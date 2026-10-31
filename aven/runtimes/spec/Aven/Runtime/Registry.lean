import Aven.Runtime.Contract

/-!
# The file registry (README, "The file registry: one source of truth")

One entry per file type, and one function, `decideFile` (the README's `decide`), from a file's first bytes, its size and
what its sender claims to its **decision**: what it really is, how it shows (`native`, `frame`, `runtime` or
`download`), within which limits, and how the Service Worker serves it. The Service Worker, the chat and the Peer-Light
all run this function, compiled from one Rust crate that replays these vectors; nothing else lists types.

- **The bytes decide.** A binary type is named by its signatures, a text type by its bytes being UTF-8 and then by its
  root element. The claim (a media type and a file name) only chooses among the text formats the bytes can't tell
  apart: Markdown, CSV, TSV, JSON or plain text. It can never make a file `native` or `frame`.
- **No script is ever shown by the browser.** HTML, XHTML and other XML download; SVG is rasterized by a runtime.
- **Over a limit is a download.** A native image's dimensions are read from its header before it reaches the decoder.
- **No runtime before the files origin** (decision 3): until then every `runtime` decision is a `download`.
-/

namespace Aven.Runtime

open Aven.Core

/-- The first bytes the registry reads: the first 64 KiB of the file's first chunk. -/
def headMax : Nat := 65536

inductive FileType where
  | png | jpeg | gif | webp | avif | bmp
  | mp4 | mov | webm | ogg | mp3 | wav | flac
  | pdf
  | svg | html | xml
  | json | markdown | csv | tsv | text
  | unknown
  deriving DecidableEq, Repr, Inhabited

/-- The media type the registry serves a file as: the sniffed one, never the claimed one. -/
def FileType.mime : FileType → String
  | .png => "image/png" | .jpeg => "image/jpeg" | .gif => "image/gif" | .webp => "image/webp"
  | .avif => "image/avif" | .bmp => "image/bmp"
  | .mp4 => "video/mp4" | .mov => "video/quicktime" | .webm => "video/webm" | .ogg => "audio/ogg"
  | .mp3 => "audio/mpeg"
  | .wav => "audio/wav" | .flac => "audio/flac"
  | .pdf => "application/pdf"
  | .svg => "image/svg+xml" | .html => "text/html" | .xml => "application/xml"
  | .json => "application/json" | .markdown => "text/markdown" | .csv => "text/csv"
  | .tsv => "text/tab-separated-values" | .text => "text/plain"
  | .unknown => "application/octet-stream"

def FileType.name : FileType → String
  | .png => "png" | .jpeg => "jpeg" | .gif => "gif" | .webp => "webp" | .avif => "avif" | .bmp => "bmp"
  | .mp4 => "mp4" | .mov => "mov" | .webm => "webm" | .ogg => "ogg" | .mp3 => "mp3" | .wav => "wav" | .flac => "flac"
  | .pdf => "pdf" | .svg => "svg" | .html => "html" | .xml => "xml"
  | .json => "json" | .markdown => "markdown" | .csv => "csv" | .tsv => "tsv" | .text => "text"
  | .unknown => "unknown"

/-! ## Signatures -/

/-- A signature: bytes at offsets, all of which must be there. -/
abbrev Sig := List (Nat × Bytes)

def Sig.matches (s : Sig) (h : Bytes) : Bool := s.all fun (o, b) => b.isPrefixOf (h.drop o)

/-- `ftyp` boxes: an ISO base media file, its major brand at 8. The box is small, so its size's first byte is 0. -/
def ftyp (brand : Bytes) : Sig := [(0, [0x00]), (4, [0x66, 0x74, 0x79, 0x70]), (8, brand)]

/-- Every binary type's signatures. A type may have several; no two types' signatures can match the same bytes
(`signatures_apart`). -/
def signatures : List (FileType × Sig) :=
  [(.png, [(0, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])]),
   (.jpeg, [(0, [0xFF, 0xD8, 0xFF])]),
   (.gif, [(0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])]),
   (.gif, [(0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])]),
   (.webp, [(0, [0x52, 0x49, 0x46, 0x46]), (8, [0x57, 0x45, 0x42, 0x50])]),
   (.wav, [(0, [0x52, 0x49, 0x46, 0x46]), (8, [0x57, 0x41, 0x56, 0x45])]),
   (.bmp, [(0, [0x42, 0x4D])]),
   (.avif, ftyp [0x61, 0x76, 0x69, 0x66]),
   (.avif, ftyp [0x61, 0x76, 0x69, 0x73]),
   (.mp4, ftyp [0x69, 0x73, 0x6F, 0x6D]),
   (.mp4, ftyp [0x69, 0x73, 0x6F, 0x32]),
   (.mp4, ftyp [0x6D, 0x70, 0x34, 0x31]),
   (.mp4, ftyp [0x6D, 0x70, 0x34, 0x32]),
   (.mp4, ftyp [0x4D, 0x34, 0x56, 0x20]),
   (.mp4, ftyp [0x4D, 0x34, 0x41, 0x20]),
   (.mp4, ftyp [0x64, 0x61, 0x73, 0x68]),
   (.mov, ftyp [0x71, 0x74, 0x20, 0x20]),
   (.webm, [(0, [0x1A, 0x45, 0xDF, 0xA3])]),
   (.ogg, [(0, [0x4F, 0x67, 0x67, 0x53])]),
   (.mp3, [(0, [0x49, 0x44, 0x33])]),
   (.mp3, [(0, [0xFF, 0xFB])]),
   (.mp3, [(0, [0xFF, 0xF3])]),
   (.mp3, [(0, [0xFF, 0xF2])]),
   (.flac, [(0, [0x66, 0x4C, 0x61, 0x43])]),
   (.pdf, [(0, [0x25, 0x50, 0x44, 0x46, 0x2D])])]

/-- Two signatures clash when some byte both fix differs: then no bytes match both. -/
def Sig.clash (a b : Sig) : Bool :=
  a.any fun (o, x) => b.any fun (o', y) =>
    (List.range x.length).any fun i => decide (o' ≤ o + i) && (match y[o + i - o']? with
      | some c => c != x[i]!
      | none => false)

/-- The first binary type whose signature matches. -/
def sniffBinary (h : Bytes) : Option FileType := (signatures.find? fun (_, s) => s.matches h).map (·.1)

/-! ## Text -/

def isCont (b : UInt8) : Bool := b &&& 0xC0 == 0x80

/-- Valid UTF-8 without NUL. A sequence cut by the end of the head is accepted, since the head may end mid-character. -/
def textHead : Bytes → Bool
  | [] => true
  | b :: rest =>
    if b == 0 then false
    else if b < 0x80 then textHead rest
    else
      let n := if b ≥ 0xC2 && b ≤ 0xDF then 1 else if b &&& 0xF0 == 0xE0 then 2
        else if b ≥ 0xF0 && b ≤ 0xF4 then 3 else 0
      if n == 0 then false
      else if (rest.take n).all isCont then (if rest.length < n then true else textHead (rest.drop n))
      else false
termination_by l => l.length
decreasing_by all_goals (simp_wf; try omega)

def lower (b : UInt8) : UInt8 := if b ≥ 0x41 && b ≤ 0x5A then b + 32 else b

def isSpace (b : UInt8) : Bool := b == 0x20 || b == 0x09 || b == 0x0A || b == 0x0D || b == 0x0C

/-- The bytes after a BOM, white space, comments and an XML prolog: where a markup document's root starts. -/
def skipLead (fuel : Nat) (h : Bytes) : Bytes × Bool :=
  match fuel with
  | 0 => (h, false)
  | fuel + 1 =>
    let h := (if [0xEF, 0xBB, 0xBF].isPrefixOf h then h.drop 3 else h).dropWhile isSpace
    if (ascii "<?xml").isPrefixOf (h.map lower) then
      let rest := (afterMark (ascii "?>") h)
      ((skipLead fuel rest).1, true)
    else if (ascii "<!--").isPrefixOf h then skipLead fuel (afterMark (ascii "-->") h)
    else (h, false)
where
  /-- After the first `m`, or nothing when there is none. -/
  afterMark (m : Bytes) : Bytes → Bytes
    | [] => []
    | x :: xs => if m.isPrefixOf (x :: xs) then (x :: xs).drop m.length else afterMark m xs

/-- A tag at the start, followed by a space, `>` or `/`. -/
def startsTag (tag : String) (h : Bytes) : Bool :=
  let t := ascii tag
  t.isPrefixOf (h.map lower) && match (h.drop t.length).head? with
    | some c => isSpace c || c == 0x3E || c == 0x2F
    | none => false

/-- Bytes the browser would read as HTML (WHATWG's sniffing table, at the root). -/
def htmlRoot (h : Bytes) : Bool :=
  (ascii "<!doctype html").isPrefixOf (h.map lower) ||
  ["<html", "<head", "<body", "<script", "<iframe", "<frameset", "<object", "<embed", "<style", "<title", "<table",
   "<div", "<a", "<p", "<br", "<h1", "<font", "<b"].any (startsTag · h)

/-- What a sender says: a media type and a file name, either missing. -/
structure Claim where
  type : Option String := none
  name : Option String := none
  deriving DecidableEq, Repr, Inhabited

/-- A claimed type's essence: before any `;`, trimmed, lowercase. -/
def essence (t : String) : String := ((t.splitOn ";").headD "").trimAscii.toString.toLower

def Claim.ext (c : Claim) : String := match c.name with
  | some n => match (n.splitOn ".").reverse with
    | e :: _ :: _ => e.toLower
    | _ => ""
  | none => ""

/-- What a claim chooses among the text formats. Only these: a claim never names a binary type, SVG or a script. -/
def Claim.text (c : Claim) : FileType :=
  let t := (c.type.map essence).getD ""
  if t == "text/html" || t == "application/xhtml+xml" then .html
  else if t == "image/svg+xml" || t == "application/xml" || t == "text/xml" then .xml
  else if t == "text/markdown" || t == "text/x-markdown" then .markdown
  else if t == "text/csv" then .csv
  else if t == "text/tab-separated-values" then .tsv
  else if t == "application/json" || t.endsWith "+json" then .json
  else if t != "" && t != "text/plain" && t != "application/octet-stream" then .text
  else match c.ext with
    | "md" | "markdown" => .markdown
    | "csv" => .csv
    | "tsv" => .tsv
    | "json" => .json
    | "html" | "htm" | "xhtml" => .html
    | "svg" | "xml" => .xml
    | _ => .text

/-- What the file really is. -/
def sniff (h : Bytes) (c : Claim) : FileType :=
  match sniffBinary h with
  | some t => t
  | none =>
    if !textHead h then .unknown
    else
      let (root, prolog) := skipLead 8 h
      if startsTag "<svg" root then .svg
      else if htmlRoot root then .html
      else if prolog then .xml
      else c.text

/-! ## Dimensions, read from a native image's header -/

def at8 (h : Bytes) (i : Nat) : Option Nat := h[i]?.map (·.toNat)

def be16 (h : Bytes) (i : Nat) : Option Nat := do return (← at8 h i) * 256 + (← at8 h (i + 1))
def le16 (h : Bytes) (i : Nat) : Option Nat := do return (← at8 h i) + (← at8 h (i + 1)) * 256
def be32 (h : Bytes) (i : Nat) : Option Nat := do return (← be16 h i) * 65536 + (← be16 h (i + 2))
def le24 (h : Bytes) (i : Nat) : Option Nat := do return (← le16 h i) + (← at8 h (i + 2)) * 65536
def le32 (h : Bytes) (i : Nat) : Option Nat := do return (← le16 h i) + (← le16 h (i + 2)) * 65536

/-- A signed 32-bit number's size: BMP's height is negative when its rows run top down. -/
def abs32 (n : Nat) : Nat := if n ≥ 2 ^ 31 then 2 ^ 32 - n else n

/-- JPEG's dimensions, from its first start-of-frame segment. -/
def jpegDims (h : Bytes) : Nat → Nat → Option (Nat × Nat)
  | 0, _ => none
  | fuel + 1, i => do
    if (← at8 h i) != 0xFF then none
    let m ← at8 h (i + 1)
    if m == 0xFF then jpegDims h fuel (i + 1)
    else if m == 0xD8 || m == 0x01 || (m ≥ 0xD0 && m ≤ 0xD7) then jpegDims h fuel (i + 2)
    else if m ≥ 0xC0 && m ≤ 0xCF && m != 0xC4 && m != 0xC8 && m != 0xCC then
      return (← be16 h (i + 7), ← be16 h (i + 5))
    else jpegDims h fuel (i + 2 + (← be16 h (i + 2)))

/-- Every `ispe` box's width and height in an AVIF's head; the largest counts. -/
def ispes (h : Bytes) : Nat → Nat → List (Nat × Nat)
  | 0, _ => []
  | fuel + 1, i =>
    if i + 16 > h.length then []
    else if (ascii "ispe").isPrefixOf (h.drop i) then
      match be32 h (i + 8), be32 h (i + 12) with
      | some w, some ht => (w, ht) :: ispes h fuel (i + 1)
      | _, _ => ispes h fuel (i + 1)
    else ispes h fuel (i + 1)

/-- A native image's width and height, from its header; `none` when the head doesn't say. -/
def dims (t : FileType) (h : Bytes) : Option (Nat × Nat) :=
  match t with
  | .png => if (ascii "IHDR").isPrefixOf (h.drop 12) then do return (← be32 h 16, ← be32 h 20) else none
  | .gif => do return (← le16 h 6, ← le16 h 8)
  | .bmp => do return (abs32 (← le32 h 18), abs32 (← le32 h 22))
  | .jpeg => jpegDims h h.length 2
  | .webp =>
    let chunk := (h.drop 12).take 4
    if chunk == ascii "VP8X" then do return ((← le24 h 24) + 1, (← le24 h 27) + 1)
    else if chunk == ascii "VP8 " then do return ((← le16 h 26) % 16384, (← le16 h 28) % 16384)
    else if chunk == ascii "VP8L" then do
      let b0 ← at8 h 21; let b1 ← at8 h 22; let b2 ← at8 h 23; let b3 ← at8 h 24
      return ((b1 % 64) * 256 + b0 + 1, (b3 % 16) * 1024 + b2 * 4 + b1 / 64 + 1)
    else none
  | .avif => (ispes h h.length 0).foldl (fun acc (w, ht) => match acc with
      | some (w', h') => some (max w w', max ht h')
      | none => some (w, ht)) none
  | _ => none

/-! ## Entries and decisions -/

/-- A browser element that shows a file natively. -/
inductive Element where
  | img | audio | video
  deriving DecidableEq, Repr

/-- What a file runtime gives back (README, "Two kinds of output"). -/
inductive Output where
  | tree | pixels | table
  deriving DecidableEq, Repr

/-- How a file shows: its mode. -/
inductive Mode where
  | native (e : Element)
  | frame
  | runtime (name : String) (out : Output) (limits : Limits)
  | download
  deriving DecidableEq, Repr

/-- Shown by the browser itself: natively or in a frame. -/
def Mode.shown : Mode → Bool
  | .native _ | .frame => true
  | _ => false

def MiB : Nat := 1048576

/-- One type's entry: how it shows and the most bytes it may have; for an image, the most pixels. -/
structure Entry where
  type : FileType
  mode : Mode
  bytes : Nat
  pixels : Nat := 0
  deriving DecidableEq, Repr

/-- Fuel, memory and output for a runtime that parses text into a tree or a table. -/
def textLimits : Limits := ⟨2_000_000_000, 256 * MiB, 8 * MiB⟩

/-- The registry, one entry per type. -/
def registry : List Entry :=
  [⟨.png, .native .img, 64 * MiB, 64 * MiB⟩, ⟨.jpeg, .native .img, 64 * MiB, 64 * MiB⟩,
   ⟨.gif, .native .img, 64 * MiB, 64 * MiB⟩, ⟨.webp, .native .img, 64 * MiB, 64 * MiB⟩,
   ⟨.avif, .native .img, 64 * MiB, 64 * MiB⟩, ⟨.bmp, .native .img, 64 * MiB, 64 * MiB⟩,
   ⟨.mp4, .native .video, 65536 * MiB, 0⟩, ⟨.mov, .native .video, 65536 * MiB, 0⟩,
   ⟨.webm, .native .video, 65536 * MiB, 0⟩,
   ⟨.ogg, .native .audio, 4096 * MiB, 0⟩, ⟨.mp3, .native .audio, 4096 * MiB, 0⟩,
   ⟨.wav, .native .audio, 4096 * MiB, 0⟩, ⟨.flac, .native .audio, 4096 * MiB, 0⟩,
   ⟨.pdf, .frame, 256 * MiB, 0⟩,
   ⟨.svg, .runtime "svg-runtime" .pixels ⟨4_000_000_000, 256 * MiB, 64 * MiB⟩, 4 * MiB, 16 * MiB⟩,
   ⟨.html, .download, 0, 0⟩, ⟨.xml, .download, 0, 0⟩,
   ⟨.json, .runtime "json-runtime" .tree textLimits, 4 * MiB, 0⟩,
   ⟨.markdown, .runtime "markdown-runtime" .tree textLimits, 1 * MiB, 0⟩,
   ⟨.csv, .runtime "csv-runtime" .table textLimits, 64 * MiB, 0⟩,
   ⟨.tsv, .runtime "csv-runtime" .table textLimits, 64 * MiB, 0⟩,
   ⟨.text, .runtime "text-runtime" .tree textLimits, 16 * MiB, 0⟩,
   ⟨.unknown, .download, 0, 0⟩]

def entry (t : FileType) : Entry := (registry.find? (·.type == t)).getD ⟨t, .download, 0, 0⟩

/-- The type a claimed media type names, by its essence; `unknown` for any other. Only for what a claim may label
(the chat's card before the bytes are read): a decision never takes it, since the bytes decide. -/
def FileType.ofMime (m : String) : FileType :=
  ((registry.find? (·.type.mime == essence m)).map (·.type)).getD .unknown

/-- Where the registry stands: whether the files origin runs file runtimes yet (decision 3). -/
structure Stage where
  runtimes : Bool
  deriving DecidableEq, Repr

/-- How the Service Worker serves a file: inline as its sniffed type, only to the runtime's worker, or as an
attachment. -/
inductive Serve where
  | inline (mime : String)
  | worker
  | attachment
  deriving DecidableEq, Repr

structure Decision where
  type : FileType
  mode : Mode
  serve : Serve
  deriving DecidableEq, Repr

def serveFor (t : FileType) : Mode → Serve
  | .native _ | .frame => .inline t.mime
  | .runtime .. => .worker
  | .download => .attachment

/-- A native image is within its pixel limit, by the dimensions its own header declares. -/
def imgOk (t : FileType) (h : Bytes) : Bool :=
  match dims t h with
  | some (w, ht) => decide (0 < w) && decide (0 < ht) && decide (w * ht ≤ (entry t).pixels)
  | none => false

/-- An entry's mode, held to the stage and, for an image, to its dimensions. -/
def gate (st : Stage) (t : FileType) (h : Bytes) : Mode → Mode
  | .native .img => if imgOk t h then .native .img else .download
  | .runtime n o l => if st.runtimes then .runtime n o l else .download
  | m => m

/-- How a file shows, within its entry's limits and the stage. -/
def modeFor (st : Stage) (t : FileType) (h : Bytes) (size : Nat) : Mode :=
  if size > (entry t).bytes then .download else gate st t h (entry t).mode

/-- The registry's one function: a file's head (at most `headMax` bytes), its size and its claim to its decision. -/
def decideFile (st : Stage) (h : Bytes) (size : Nat) (c : Claim) : Decision :=
  let h := h.take headMax
  let t := sniff h c
  let s := modeFor st t h size
  ⟨t, s, serveFor t s⟩

/-- The headers of every answer the Service Worker gives for a file. -/
def headers (d : Decision) : List (String × String) :=
  let (type, disposition) := match d.serve with
    | .inline m => (m, "inline")
    | _ => ("application/octet-stream", "attachment")
  [("Content-Type", type), ("Content-Disposition", disposition), ("X-Content-Type-Options", "nosniff"),
   ("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; object-src 'self'"),
   ("Cross-Origin-Resource-Policy", "same-origin")]

/-! ## What the registry guarantees -/

/-- The types a browser could run a script in. -/
def scriptable (t : FileType) : Bool := t == .html || t == .xml || t == .svg

theorem take_drop_get {l x : Bytes} {o i : Nat} (h : x.isPrefixOf (l.drop o) = true) (hi : i < x.length) :
    l[o + i]? = x[i]? := by
  obtain ⟨t, ht⟩ := List.isPrefixOf_iff_prefix.mp h
  have : (l.drop o)[i]? = x[i]? := by rw [← ht, List.getElem?_append_left hi]
  rwa [List.getElem?_drop] at this

/-- Bytes that match both of two signatures make them agree wherever both fix a byte, so they don't clash. -/
theorem no_clash {a b : Sig} {h : Bytes} (ha : a.matches h = true) (hb : b.matches h = true) : a.clash b = false := by
  cases hc : a.clash b with
  | false => rfl
  | true =>
    exfalso
    unfold Sig.clash at hc
    simp only [List.any_eq_true, List.mem_range, Bool.and_eq_true, decide_eq_true_eq] at hc
    obtain ⟨⟨o, x⟩, hx, ⟨o', y⟩, hy, i, hi, hle, hm⟩ := hc
    unfold Sig.matches at ha hb
    rw [List.all_eq_true] at ha hb
    have hxh := take_drop_get (ha _ hx) hi
    cases hyi : y[o + i - o']? with
    | none => simp [hyi] at hm
    | some c =>
      simp only [hyi, bne_iff_ne, ne_eq] at hm
      have hlt : o + i - o' < y.length := (List.getElem?_eq_some_iff.mp hyi).1
      have hyh := take_drop_get (hb _ hy) hlt
      rw [show o' + (o + i - o') = o + i by omega, hyi, hxh] at hyh
      apply hm
      simp only at hyh
      rw [List.getElem!_eq_getElem?_getD, hyh]; rfl

/-- Any two entries of different types clash: no bytes match both. -/
theorem signatures_apart : ∀ a ∈ signatures, ∀ b ∈ signatures, a.1 ≠ b.1 → a.2.clash b.2 = true := by decide

/-- So the order of the table doesn't matter: whichever signature matches names the type. -/
theorem sniffBinary_unique {h : Bytes} {t : FileType} {s : Sig} (hm : (t, s) ∈ signatures) (hs : s.matches h = true) :
    sniffBinary h = some t := by
  unfold sniffBinary
  cases hf : signatures.find? (fun (_, s) => s.matches h) with
  | none =>
    rw [List.find?_eq_none] at hf
    exact absurd hs (by simpa using hf _ hm)
  | some e =>
    simp only [Option.map_some, Option.some.injEq]
    have he := List.mem_of_find?_eq_some hf
    have hem : e.2.matches h = true := by simpa using List.find?_some hf
    apply Decidable.byContradiction
    intro hne
    have := signatures_apart e he (t, s) hm hne
    rw [no_clash hem hs] at this
    exact Bool.false_ne_true this

/-- Bytes with a binary signature are that type, whatever the claim. -/
theorem sniff_binary {h : Bytes} {t : FileType} (hb : sniffBinary h = some t) (c : Claim) : sniff h c = t := by
  simp [sniff, hb]

/-- A binary file's whole decision ignores the claim. -/
theorem decide_binary_ignores_claim (st : Stage) (h : Bytes) (size : Nat) (c c' : Claim) {t : FileType}
    (hb : sniffBinary (h.take headMax) = some t) : decideFile st h size c = decideFile st h size c' := by
  simp [decideFile, sniff, hb]

/-- The types a claim can choose. -/
def textual (t : FileType) : Bool :=
  t == .html || t == .xml || t == .json || t == .markdown || t == .csv || t == .tsv || t == .text

theorem claim_text_textual (c : Claim) : textual c.text = true := by
  unfold Claim.text
  dsimp only
  repeat' split
  all_goals rfl

/-- Every type the bytes don't fix by a signature comes from the claim, or is SVG, HTML, XML or unknown. -/
theorem sniff_cases (h : Bytes) (c : Claim) :
    (∃ t, sniffBinary h = some t ∧ sniff h c = t) ∨ sniff h c = .unknown ∨ sniff h c = .svg ∨ sniff h c = .html ∨
    sniff h c = .xml ∨ sniff h c = c.text := by
  unfold sniff
  cases hb : sniffBinary h with
  | some t => exact .inl ⟨t, rfl, rfl⟩
  | none =>
    dsimp only
    repeat' split
    all_goals simp

/-- What each type may show as, at most. -/
theorem gate_cases (st : Stage) (t : FileType) (h : Bytes) (m : Mode) :
    gate st t h m = .download ∨ gate st t h m = m := by
  cases m with
  | native e => cases e <;> simp only [gate] <;> (try split) <;> simp
  | runtime n o l => simp only [gate]; split <;> simp
  | frame => simp [gate]
  | download => simp [gate]

theorem modeFor_of_entry (st : Stage) (t : FileType) (h : Bytes) (size : Nat) :
    modeFor st t h size = .download ∨ modeFor st t h size = (entry t).mode := by
  unfold modeFor
  split
  · exact .inl rfl
  · exact gate_cases st t h _

/-- A textual type never shows natively or framed. -/
theorem textual_entry (t : FileType) (ht : textual t = true) : (entry t).mode.shown = false := by
  cases t <;> first | rfl | (simp [textual] at ht)

/-- The browser never shows a scriptable type: HTML and XML download, SVG goes through its runtime. -/
theorem scriptable_entry (t : FileType) (ht : scriptable t = true) : (entry t).mode.shown = false := by
  cases t <;> first | rfl | (simp [scriptable] at ht)

theorem modeFor_shown {st : Stage} {t : FileType} {h : Bytes} {size : Nat}
    (hs : (modeFor st t h size).shown = true) : (entry t).mode.shown = true := by
  rcases modeFor_of_entry st t h size with h1 | h1 <;> rw [h1] at hs
  · cases hs
  · exact hs

/-- **The claim never adds:** a file shown natively or framed shows so whatever its sender claims, as its own type. -/
theorem claim_never_adds (st : Stage) (h : Bytes) (size : Nat) (c c' : Claim)
    (hs : (decideFile st h size c).mode.shown = true) : decideFile st h size c' = decideFile st h size c := by
  cases hb : sniffBinary (h.take headMax) with
  | some t => exact decide_binary_ignores_claim st h size c' c hb
  | none =>
    exfalso
    have hcases := sniff_cases (h.take headMax) c
    simp only [hb, reduceCtorEq, false_and, exists_false, false_or] at hcases
    simp only [decideFile] at hs
    have he := modeFor_shown hs
    generalize sniff (h.take headMax) c = t at he hcases
    have hnot : (entry t).mode.shown = false := by
      rcases hcases with h1 | h1 | h1 | h1 | h1 <;> subst h1
      · rfl
      · exact scriptable_entry _ rfl
      · exact scriptable_entry _ rfl
      · exact scriptable_entry _ rfl
      · exact textual_entry _ (claim_text_textual c)
    rw [hnot] at he
    cases he

/-- Unknown bytes download. -/
theorem unknown_downloads (st : Stage) (h : Bytes) (size : Nat) (c : Claim)
    (hu : (decideFile st h size c).type = .unknown) : (decideFile st h size c).mode = .download := by
  simp only [decideFile] at hu ⊢
  rw [hu]
  rcases modeFor_of_entry st .unknown (h.take headMax) size with h1 | h1 <;> rw [h1] <;> rfl

/-- A file over its type's limit downloads. -/
theorem over_limit_downloads (st : Stage) (h : Bytes) (size : Nat) (c : Claim)
    (hl : size > (entry (decideFile st h size c).type).bytes) : (decideFile st h size c).mode = .download := by
  simp only [decideFile] at hl ⊢
  simp [modeFor, hl]

theorem gate_img {st : Stage} {t : FileType} {h : Bytes} {m : Mode} (hg : gate st t h m = .native .img) :
    m = .native .img ∧ imgOk t h = true := by
  cases m with
  | native e => cases e <;> simp only [gate] at hg <;> (try split at hg) <;> simp_all
  | runtime n o l => simp only [gate] at hg; split at hg <;> cases hg
  | frame => simp [gate] at hg
  | download => simp [gate] at hg

/-- A native image is within its pixel limit, by the dimensions its own header declares. -/
theorem native_img_dims (st : Stage) (h : Bytes) (size : Nat) (c : Claim)
    (hn : (decideFile st h size c).mode = .native .img) :
    ∃ w ht, dims (decideFile st h size c).type (h.take headMax) = some (w, ht) ∧ 0 < w ∧ 0 < ht ∧
      w * ht ≤ (entry (decideFile st h size c).type).pixels := by
  simp only [decideFile] at hn ⊢
  generalize sniff (h.take headMax) c = t at hn ⊢
  unfold modeFor at hn
  split at hn
  · cases hn
  · have hok := (gate_img hn).2
    unfold imgOk at hok
    split at hok
    · rename_i w ht hd
      simp only [Bool.and_eq_true, decide_eq_true_eq] at hok
      exact ⟨w, ht, hd, hok.1.1, hok.1.2, hok.2⟩
    · cases hok

/-- Before the files origin, nothing runs: every decision is native, frame or download. -/
theorem no_runtime_before_origin (h : Bytes) (size : Nat) (c : Claim) :
    ∀ n o l, (decideFile ⟨false⟩ h size c).mode ≠ .runtime n o l := by
  intro n o l
  simp only [decideFile]
  generalize sniff (h.take headMax) c = t
  unfold modeFor
  split
  · simp
  · generalize (entry t).mode = m
    cases m with
    | native e => cases e <;> simp only [gate] <;> (try split) <;> simp
    | runtime => simp [gate]
    | frame => simp [gate]
    | download => simp [gate]

/-- Inline only for native and framed files, and then as the sniffed type; everything else is an attachment or for the
runtime's worker only. -/
theorem serve_inline (st : Stage) (h : Bytes) (size : Nat) (c : Claim) (m : String)
    (hi : (decideFile st h size c).serve = .inline m) :
    m = (decideFile st h size c).type.mime ∧ (decideFile st h size c).mode.shown = true := by
  simp only [decideFile] at hi ⊢
  generalize modeFor st (sniff (h.take headMax) c) (h.take headMax) size = s at hi ⊢
  cases s with
  | native e => simp [serveFor] at hi; exact ⟨hi.symm, rfl⟩
  | frame => simp [serveFor] at hi; exact ⟨hi.symm, rfl⟩
  | runtime => simp [serveFor] at hi
  | download => simp [serveFor] at hi

/-- No decision ever serves a scriptable type inline. -/
theorem scriptable_never_inline (st : Stage) (h : Bytes) (size : Nat) (c : Claim) (m : String)
    (hs : scriptable (decideFile st h size c).type = true) : (decideFile st h size c).serve ≠ .inline m := by
  intro hi
  have hshown := (serve_inline st h size c m hi).2
  have hnot := scriptable_entry _ hs
  simp only [decideFile] at hshown hnot
  rw [modeFor_shown hshown] at hnot
  cases hnot

end Aven.Runtime

import Aven.Runtime.Registry

/-!
# The registry's examples

Real heads and hostile ones, each with the decision the registry gives. `lake build` checks every one, and `vectors`
exports them (`registry.json`) for the registry crate, its wasm, the Service Worker and the chat to replay.
-/

namespace Aven.Runtime

open Aven.Core

def be32b (n : Nat) : Bytes := [(n / 16777216 % 256).toUInt8, (n / 65536 % 256).toUInt8, (n / 256 % 256).toUInt8,
  (n % 256).toUInt8]
def le16b (n : Nat) : Bytes := [(n % 256).toUInt8, (n / 256 % 256).toUInt8]
def le24b (n : Nat) : Bytes := [(n % 256).toUInt8, (n / 256 % 256).toUInt8, (n / 65536 % 256).toUInt8]
def le32b (n : Nat) : Bytes := le16b (n % 65536) ++ le16b (n / 65536)
def be16b (n : Nat) : Bytes := [(n / 256 % 256).toUInt8, (n % 256).toUInt8]

def pngHead (w h : Nat) : Bytes :=
  [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] ++ be32b 13 ++ ascii "IHDR" ++ be32b w ++ be32b h ++
  [0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89]

def gifHead (w h : Nat) : Bytes := ascii "GIF89a" ++ le16b w ++ le16b h ++ [0xF7, 0x00, 0x00]

def jpegHead (w h : Nat) : Bytes :=
  [0xFF, 0xD8, 0xFF, 0xE0] ++ be16b 16 ++ ascii "JFIF" ++
  [0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00] ++
  [0xFF, 0xC0] ++ be16b 17 ++ [0x08] ++ be16b h ++ be16b w ++ [0x03, 0x01, 0x22, 0x00]

def webpHead (w h : Nat) : Bytes :=
  ascii "RIFF" ++ le32b 1000 ++ ascii "WEBP" ++ ascii "VP8X" ++ le32b 10 ++ [0x10, 0, 0, 0] ++ le24b (w - 1) ++
  le24b (h - 1)

def avifHead (w h : Nat) : Bytes :=
  be32b 28 ++ ascii "ftyp" ++ ascii "avif" ++ be32b 0 ++ ascii "avifmif1miaf" ++
  be32b 20 ++ ascii "ispe" ++ be32b 0 ++ be32b w ++ be32b h

def bmpHead (w h : Nat) : Bytes := ascii "BM" ++ le32b 1000 ++ le32b 0 ++ le32b 54 ++ le32b 40 ++ le32b w ++ le32b h

def mp4Head : Bytes := be32b 24 ++ ascii "ftyp" ++ ascii "isom" ++ be32b 512 ++ ascii "isomiso2"

/-- An iPhone's movie: QuickTime, its `ftyp` brand `qt  `. -/
def movHead : Bytes := be32b 20 ++ ascii "ftyp" ++ ascii "qt  " ++ be32b 0 ++ ascii "qt  "

def on : Stage := ⟨true⟩
def off : Stage := ⟨false⟩

def claim (t : String) : Claim := { type := some t }
def named (n : String) : Claim := { name := some n }

def svgPixels : Mode := .runtime "svg-runtime" .pixels ⟨4_000_000_000, 256 * MiB, 64 * MiB⟩
def textTree (n : String) : Mode := .runtime n .tree textLimits

/-- An example: its name, the stage, the head, the file's size, the claim, and the decision. -/
structure Example where
  name : String
  stage : Stage
  head : Bytes
  size : Nat
  claim : Claim
  decision : Decision

def ex (name : String) (st : Stage) (h : Bytes) (size : Nat) (c : Claim) (t : FileType) (m : Mode) : Example :=
  ⟨name, st, h, size, c, ⟨t, m, serveFor t m⟩⟩

def examples : List Example :=
  [ex "a PNG" on (pngHead 640 480) 4096 (claim "image/png") .png (.native .img),
   ex "a PNG claimed as HTML is a PNG" on (pngHead 640 480) 4096 (claim "text/html") .png (.native .img),
   ex "a PNG with HTML after its header is a PNG, served as one" on
     (pngHead 1 1 ++ ascii "<html><script>alert(1)</script></html>") 4096 (claim "text/html") .png (.native .img),
   ex "a PNG of 100000 × 100000 downloads" on (pngHead 100000 100000) 4096 (claim "image/png") .png .download,
   ex "a PNG of no width downloads" on (pngHead 0 480) 4096 (claim "image/png") .png .download,
   ex "a PNG cut before its dimensions downloads" on ((pngHead 640 480).take 20) 20 (claim "image/png") .png .download,
   ex "a PNG over 64 MiB downloads" on (pngHead 640 480) (65 * MiB) (claim "image/png") .png .download,
   ex "a JPEG" on (jpegHead 1920 1080) 300000 (claim "image/jpeg") .jpeg (.native .img),
   ex "a JPEG cut before its frame downloads" on ((jpegHead 1920 1080).take 22) 22 (claim "image/jpeg") .jpeg
     .download,
   ex "a GIF" on (gifHead 320 200) 9000 {} .gif (.native .img),
   ex "a WebP" on (webpHead 800 600) 9000 (claim "image/webp") .webp (.native .img),
   ex "an AVIF" on (avifHead 1024 768) 9000 (claim "image/avif") .avif (.native .img),
   ex "a BMP" on (bmpHead 64 64) 12342 (claim "image/bmp") .bmp (.native .img),
   ex "a BMP with rows top down" on (bmpHead 64 (2 ^ 32 - 64)) 12342 (claim "image/bmp") .bmp (.native .img),
   ex "an MP4" on mp4Head (300 * MiB) (claim "video/mp4") .mp4 (.native .video),
   ex "an iPhone movie, by its name only" on movHead (300 * MiB) { name := some "IMG_0042.MOV" } .mov (.native .video),
   ex "a WebM claimed as nothing" on [0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81] (20 * MiB) {} .webm
     (.native .video),
   ex "an MP3 with ID3" on (ascii "ID3" ++ [0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]) (5 * MiB) {} .mp3
     (.native .audio),
   ex "a WAV" on (ascii "RIFF" ++ le32b 1000 ++ ascii "WAVEfmt ") 1008 {} .wav (.native .audio),
   ex "a FLAC" on (ascii "fLaC" ++ [0, 0, 0, 34]) (30 * MiB) {} .flac (.native .audio),
   ex "an Ogg" on (ascii "OggS" ++ [0, 2, 0, 0]) (3 * MiB) {} .ogg (.native .audio),
   ex "a PDF is framed" on (ascii "%PDF-1.7\n%âãÏÓ\n") (2 * MiB) (claim "application/pdf") .pdf .frame,
   ex "a PDF claimed as an image is a PDF" on (ascii "%PDF-1.4\n") 1000 (claim "image/png") .pdf .frame,
   ex "HTML claimed as a PNG downloads" on (ascii "<!DOCTYPE html><html><script>alert(1)</script>") 50
     (claim "image/png") .html .download,
   ex "HTML claimed as text downloads" on (ascii "  <html>\n<body onload=x()>") 50 (claim "text/plain") .html
     .download,
   ex "a script claimed as Markdown downloads" on (ascii "<script>fetch('/keys')</script>") 40
     (claim "text/markdown") .html .download,
   ex "XHTML behind an XML prolog downloads" on
     (ascii "<?xml version=\"1.0\"?>\n<html xmlns=\"http://www.w3.org/1999/xhtml\"><script/></html>") 90
     (claim "application/xhtml+xml") .html .download,
   ex "other XML downloads" on (ascii "<?xml version=\"1.0\"?><feed/>") 30 (claim "application/atom+xml") .xml
     .download,
   ex "an SVG is rasterized" on (ascii "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\"/>") 60
     (claim "image/svg+xml") .svg svgPixels,
   ex "an SVG claimed as a PNG is an SVG" on (ascii "<svg><script>alert(1)</script></svg>") 40 (claim "image/png")
     .svg svgPixels,
   ex "an SVG behind a prolog and a comment" on
     ([0xEF, 0xBB, 0xBF] ++ ascii "<?xml version=\"1.0\"?>\n<!-- drawn -->\n<svg viewBox=\"0 0 1 1\"></svg>") 80 {} .svg
     svgPixels,
   ex "an SVG before the files origin downloads" off (ascii "<svg></svg>") 11 (claim "image/svg+xml") .svg .download,
   ex "an SVG over 4 MiB downloads" on (ascii "<svg></svg>") (5 * MiB) (claim "image/svg+xml") .svg .download,
   ex "text claimed as SVG is XML, which downloads" on (ascii "hello") 5 (claim "image/svg+xml") .xml .download,
   ex "Markdown by its type" on (ascii "# Title\n\nSome *text*.\n") 25 (claim "text/markdown") .markdown
     (textTree "markdown-runtime"),
   ex "Markdown by its name" on (ascii "# Title\n") 8 (named "notes.md") .markdown (textTree "markdown-runtime"),
   ex "CSV" on (ascii "a,b\n1,2\n") 8 (claim "text/csv; charset=utf-8") .csv
     (.runtime "csv-runtime" .table textLimits),
   ex "TSV by its name" on (ascii "a\tb\n1\t2\n") 8 (named "table.tsv") .tsv (.runtime "csv-runtime" .table textLimits),
   ex "JSON" on (ascii "{\"a\": [1, 2]}") 13 (claim "application/json") .json (textTree "json-runtime"),
   ex "JSON claimed as nothing is text" on (ascii "{\"a\": 1}") 8 {} .text (textTree "text-runtime"),
   ex "code is text" on (ascii "fn main() {}\n") 13 (claim "text/x-rust") .text (textTree "text-runtime"),
   ex "UTF-8 text" on (ascii "Grüße, 世界\n") 16 {} .text (textTree "text-runtime"),
   ex "an empty file is text" on [] 0 {} .text (textTree "text-runtime"),
   ex "Markdown before the files origin downloads" off (ascii "# Title\n") 8 (claim "text/markdown") .markdown
     .download,
   ex "text with NUL is unknown, which downloads" on (ascii "abc" ++ [0x00] ++ ascii "def") 7 (claim "text/plain")
     .unknown .download,
   ex "bytes that aren't UTF-8 download" on [0xC3, 0x28, 0x41] 3 (claim "text/plain") .unknown .download,
   ex "UTF-16 downloads" on [0xFF, 0xFE, 0x41, 0x00] 4 (claim "text/plain") .unknown .download,
   ex "an ELF binary claimed as an image downloads" on ([0x7F] ++ ascii "ELF" ++ [0x02, 0x01, 0x01, 0x00]) 9000
     (claim "image/png") .unknown .download]

def Example.holds (e : Example) : Bool :=
  let d := decideFile e.stage e.head e.size e.claim
  d == e.decision

#guard examples.all Example.holds

-- a claimed type names its type by its essence, whatever its case and parameters; anything else is unknown
#guard registry.all fun e => FileType.ofMime e.type.mime == e.type
#guard FileType.ofMime "Video/QuickTime; codecs=hvc1" == .mov
#guard FileType.ofMime "image/x-icon" == .unknown

end Aven.Runtime

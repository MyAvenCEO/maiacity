import Lean.Data.Json
import Aven.ID.Records
import Aven.ID.Keys

/-! # The release record (PEERS.md §7, A15)

One record per release, published beside it and served by avenOS at `/release.json`: the release's version, a
counter (larger is newer, as every record's, `Aven.ID.Records`), the wire version it speaks (`Aven.DB.Wire`), each file
of avenOS's build with its SHA-256, and the SHA-256 of the Peer's binary per platform. avenOS's build as one hash is
`osHash`: the files listed as `sha256sum` lists them, sorted by path, hashed; `release.json` itself is not among them.
It is signed under `RecordKind.release`'s label by the release signers, once they are agreed (A15); until then a record
carries no signature, and how a device treats that is its `Unsigned` policy.

What a device does with a record it fetched (`check`): a Service Worker before new code activates, a native Peer before
it tells its owner. It stays on what it runs unless the record is newer; it refuses one that is malformed, whose `os`
isn't its files' hash, that no release signer signed while its policy wants one, or any of whose files it fetched with
other bytes; otherwise the release is ready, and the device switches at its next safe point.

The theorems:
- `ready_newer`: a device only ever moves to a newer release, never back;
- `ready_os`: a ready release's `os` is the hash of exactly the files it lists;
- `ready_files`: every file a ready release lists was fetched with the bytes it names;
- `ready_signed`: a device that wants signatures moves only to a release a release signer signed. -/

namespace Aven.ID
namespace Release

/-- A file of avenOS's build: its path from the origin's root, and the SHA-256 of its bytes, hex. -/
structure File where
  path : String
  sha256 : String
  deriving DecidableEq, Repr

structure Release where
  /-- avenOS's dated version: `26.10.31`, `26.10.31v2` -/
  version : String
  /-- larger is newer: the release's time in seconds -/
  counter : Nat
  /-- the wire version it speaks -/
  wire : Nat
  /-- avenOS's build, `release.json` itself not among them -/
  files : List File
  /-- the Peer's binary per platform (`linux/amd64`): its SHA-256 -/
  peer : List (String × String)
  deriving DecidableEq, Repr

/-- A SHA-256 as the record writes it: 64 lowercase hex digits. -/
def isHash (s : String) : Bool := s.length == 64 && s.all fun c => c.isDigit || ('a' ≤ c && c ≤ 'f')

def insertPath (f : File) : List File → List File
  | [] => [f]
  | g :: gs => if decide (f.path < g.path) then f :: g :: gs else g :: insertPath f gs

/-- The files in order of their paths. -/
def sorted (fs : List File) : List File := fs.foldr insertPath []

/-- The build as `sha256sum` lists it: `<sha256>  <path>` and a newline per file, by path. -/
def listing (fs : List File) : String := String.join ((sorted fs).map fun f => s!"{f.sha256}  {f.path}\n")

/-- avenOS's build as one hash: its listing's SHA-256. -/
def osHash (fs : List File) : String := Keys.hex (Keys.sha256.digest (listing fs).toUTF8.toList)

/-- Well formed: a version, every hash 64 hex digits, every path from the root and named once. -/
def wellFormed (r : Release) : Bool :=
  !r.version.isEmpty && !r.files.isEmpty && r.files.all (fun f => f.path.startsWith "/" && isHash f.sha256) &&
    (r.files.map (·.path)).Nodup && r.peer.all (fun (p, h) => !p.isEmpty && isHash h) &&
    (r.peer.map (·.1)).Nodup

/-- How a device treats a record no release signer signed, while the signers aren't agreed (A15): refuse it, or check
its hashes against what it fetched and switch, saying it is unsigned. -/
inductive Unsigned where
  | refuse
  | integrity
  deriving DecidableEq, Repr

structure Device where
  /-- the counter of the release it runs, if it runs one with a record -/
  running : Option Nat
  /-- the release signers' keys it trusts -/
  signers : List String
  unsigned : Unsigned
  deriving DecidableEq, Repr

inductive Verdict where
  /-- nothing newer: the device stays on what it runs -/
  | stay
  /-- the record or a file is wrong, and why: the device stays, and says so -/
  | refuse (why : String)
  /-- the release is fetched and checked: the device switches at its next safe point; `signed` by a release signer -/
  | ready (signed : Bool)
  deriving DecidableEq, Repr

/-- What a device does with a record (`os`: the build's hash as the record states it; `signedBy`: the keys whose
signatures over it verified, `Aven.Core.Signed.valid`) and the files it fetched for it, each with its bytes' hash. -/
def check (d : Device) (r : Release) (os : String) (signedBy : List String) (fetched : List File) : Verdict :=
  if !wellFormed r then .refuse "malformed"
  else if os != osHash r.files then .refuse "os"
  else if d.running.any (r.counter ≤ ·) then .stay
  else
    let signed := signedBy.any d.signers.contains
    if !signed && d.unsigned == .refuse then .refuse "unsigned"
    else match r.files.find? (!fetched.contains ·) with
      | some f => .refuse s!"file {f.path}"
      | none => .ready signed

variable {d : Device} {r : Release} {os : String} {signedBy : List String} {fetched : List File} {s : Bool}

theorem ready_parts (h : check d r os signedBy fetched = .ready s) :
    wellFormed r = true ∧ os = osHash r.files ∧ d.running.any (r.counter ≤ ·) = false ∧
      (signedBy.any d.signers.contains = false → d.unsigned ≠ .refuse) ∧
      r.files.find? (!fetched.contains ·) = none ∧ s = signedBy.any d.signers.contains := by
  unfold check at h
  by_cases w : wellFormed r <;> simp only [w, Bool.not_true, Bool.not_false, Bool.false_eq_true, ↓reduceIte,
    reduceCtorEq] at h
  by_cases o : (os != osHash r.files) = true <;> simp only [o, ↓reduceIte, reduceCtorEq] at h
  simp only [bne_iff_ne, ne_eq, Decidable.not_not] at o
  by_cases n : d.running.any (r.counter ≤ ·) = true <;> simp only [n, ↓reduceIte, reduceCtorEq] at h
  simp only [Bool.not_eq_true] at n
  by_cases u : (!signedBy.any d.signers.contains && d.unsigned == .refuse) = true <;>
    simp only [u, ↓reduceIte, reduceCtorEq] at h
  split at h
  · cases h
  · next e =>
    simp only [Verdict.ready.injEq] at h
    refine ⟨w, o, n, fun x => ?_, e, h.symm⟩
    intro r'
    simp [x, r'] at u

/-- **`ready_newer`:** a device moves only to a newer release, never back. -/
theorem ready_newer (h : check d r os signedBy fetched = .ready s) : ∀ c, d.running = some c → c < r.counter := by
  intro c e
  have n := (ready_parts h).2.2.1
  simp only [e, Option.any_some, decide_eq_false_iff_not, Nat.not_le] at n
  exact n

/-- **`ready_os`:** a ready release's build hash is its files' hash. -/
theorem ready_os (h : check d r os signedBy fetched = .ready s) : os = osHash r.files := (ready_parts h).2.1

/-- **`ready_files`:** every file a ready release lists was fetched with the bytes it names. -/
theorem ready_files (h : check d r os signedBy fetched = .ready s) : ∀ f ∈ r.files, f ∈ fetched := by
  intro f m
  have none := (ready_parts h).2.2.2.2.1
  have := List.find?_eq_none.mp none f m
  simpa using this

/-- **`ready_signed`:** a device that wants signatures moves only to a release one of its signers signed. -/
theorem ready_signed (h : check d r os signedBy fetched = .ready s) (want : d.unsigned = .refuse) :
    s = true ∧ ∃ k ∈ signedBy, k ∈ d.signers := by
  have p := ready_parts h
  have signed : signedBy.any d.signers.contains = true := by
    cases e : signedBy.any d.signers.contains
    · exact absurd want (p.2.2.2.1 e)
    · rfl
  refine ⟨p.2.2.2.2.2.trans signed, ?_⟩
  obtain ⟨k, m, c⟩ := List.any_eq_true.mp signed
  exact ⟨k, m, by simpa using c⟩

/-! ## As JSON

`release.json`, as the release workflow writes it and a device reads it: `files` by path, `peer` as an object keyed by
platform, and `os`, the build's hash, beside them. Its signatures, once there are signers, go beside it. -/

open Lean in
def Release.json (r : Release) : Json :=
  Json.mkObj [("record", "aven/release/1"), ("version", r.version), ("counter", toJson r.counter),
    ("wire", toJson r.wire), ("os", osHash r.files),
    ("files", Json.arr ((sorted r.files).map fun f => Json.mkObj [("path", f.path), ("sha256", f.sha256)]).toArray),
    ("peer", Json.mkObj (r.peer.map fun (p, h) => (p, Json.str h)))]

open Lean in
def Verdict.json : Verdict → Json
  | .stay => Json.mkObj [("verdict", "stay")]
  | .refuse why => Json.mkObj [("verdict", "refuse"), ("why", why)]
  | .ready signed => Json.mkObj [("verdict", "ready"), ("signed", toJson signed)]

def Unsigned.name : Unsigned → String
  | .refuse => "refuse"
  | .integrity => "integrity"

/-! ## Examples -/

namespace ReleaseExamples

def hashOf (c : Char) : String := String.ofList (List.replicate 64 c)

def files : List File := [⟨"/index.html", hashOf 'a'⟩, ⟨"/assets/app-1.js", hashOf 'b'⟩,
  ⟨"/peer-light/aven_peer_light_bg.wasm", hashOf 'c'⟩]

def release (counter : Nat) : Release :=
  ⟨"26.10.31", counter, 1, files, [("linux/amd64", hashOf 'd'), ("linux/arm64", hashOf 'e')]⟩

#guard listing files = s!"{hashOf 'b'}  /assets/app-1.js\n{hashOf 'a'}  /index.html\n{hashOf 'c'}  /peer-light/aven_peer_light_bg.wasm\n"
#guard listing files = listing files.reverse
-- the empty listing's hash is SHA-256 of nothing
#guard osHash [] = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

def trusting : Device := ⟨some 100, ["release-signer"], .refuse⟩
def unsure : Device := ⟨some 100, [], .integrity⟩

def built := osHash files

#guard check trusting (release 101) built ["release-signer"] files = .ready true
#guard check trusting (release 101) built [] files = .refuse "unsigned"
#guard check trusting (release 101) built ["stranger"] files = .refuse "unsigned"
#guard check unsure (release 101) built [] files = .ready false
#guard check unsure (release 100) built [] files = .stay
#guard check unsure (release 99) built [] files = .stay
#guard check ⟨none, [], .integrity⟩ (release 1) built [] files = .ready false
#guard check unsure (release 101) (hashOf 'f') [] files = .refuse "os"
#guard check unsure (release 101) built [] (files.drop 1) = .refuse "file /index.html"
#guard check unsure (release 101) built [] (⟨"/index.html", hashOf 'f'⟩ :: files.drop 1) = .refuse "file /index.html"
#guard check unsure { release 101 with version := "" } built [] files = .refuse "malformed"
#guard check unsure { release 101 with files := files ++ [⟨"/index.html", hashOf 'a'⟩] } built [] files = .refuse "malformed"
#guard check unsure { release 101 with peer := [("linux/amd64", "nope")] } built [] files = .refuse "malformed"

/-- Devices, records and what each fetched, for the vectors: every way `check` answers. -/
def cases : List (String × Device × Release × String × List String × List File) := [
  ("a signed newer release, to a device that wants signatures", trusting, release 101, built, ["release-signer"], files),
  ("an unsigned one, to that device", trusting, release 101, built, [], files),
  ("signed by a stranger", trusting, release 101, built, ["stranger"], files),
  ("an unsigned one, to a device that checks integrity only", unsure, release 101, built, [], files),
  ("the release it runs", unsure, release 100, built, [], files),
  ("an older one", unsure, release 99, built, [], files),
  ("a first release, to a device that runs none with a record", ⟨none, [], .integrity⟩, release 1, built, [], files),
  ("a build hash that isn't its files'", unsure, release 101, hashOf 'f', [], files),
  ("a file not fetched", unsure, release 101, built, [], files.drop 1),
  ("a file fetched with other bytes", unsure, release 101, built, [], ⟨"/index.html", hashOf 'f'⟩ :: files.drop 1),
  ("no version", unsure, { release 101 with version := "" }, built, [], files),
  ("a path twice", unsure, { release 101 with files := files ++ [⟨"/index.html", hashOf 'a'⟩] }, built, [], files),
  ("a platform's hash that isn't one", unsure, { release 101 with peer := [("linux/amd64", "nope")] }, built, [], files)]

end ReleaseExamples

end Release
end Aven.ID

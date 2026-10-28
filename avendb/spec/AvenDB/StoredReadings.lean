/-!
# What a device read, kept with its stored view

What a device reads of its edits (the Rust `Readings`: each creation's header and its index by type, each write's tags,
proof and cap group, and a schema or lens entry's content) it reads off the bodies of the writes it opened, a body at a
time, in any order (`read`, a fold of `readBody`): so reading on from what it read of some bodies, with more bodies,
reads what reading them all reads (`read_append`, the Rust `ReadNew`). Each body is read only through what it says in
the clear once opened, its metadata (`metaOf`), never its content but a lane's.

Until 2026-10-28 a device opened every body again at each unlock to read them: 27.2 s of an iPhone's unlock of 113k
edits, every time, as each body is opened (decrypted) on its own. Now its stored view (`StoredView.lean`) also holds
what its replay's bodies said, their metadata (`Sealed`), sealed under the number of the read rules, `readRules`. Like
the view itself it is what the device's edits make (P6, `EntryState.lean`), dropped and rebuilt with it, no cache
beside it.

- RR1: where the view sealed the metadata of the bodies it opened under these rules, a device that opens it and reads
  on with the bodies it opened since reads what reading every body anew reads (`RR1_opens_read`).
- RR2: what was sealed under other rules never opens, and the device reads every body anew (`RR2_other_rules_read`).
- RR3: a body is opened when first asked for (`Bodies::get`), not at unlock: it is the body opened then, as opening is
  of the edit's sealed bytes under its entry's key alone, and a device's keys only grow while it holds the body
  (`RR3_late_open`).

`readRules` names what `readBody` takes of a body's metadata. Bump it in the same change as any edit to `read_body` or
to what a body's metadata holds that changes what it reads (the Rust core's pinned readings, `tests/read_rules.rs`,
fail until it is bumped). The engine reads the number from this file as it builds (`crates/avendb/build.rs`).
-/

namespace AvenDB.StoredReadings

variable {B M R K C : Type}

/-- The number of the read rules. -/
def readRules : Nat := 1

/-- What a device reads of bodies `bs`, from `r0`, a body's metadata at a time. -/
def read (readBody : R → M → R) (metaOf : B → M) (r0 : R) (bs : List B) : R :=
  (bs.map metaOf).foldl readBody r0

/-- Reading on from what it read of `xs` with `ys` reads what reading `xs` and `ys` reads. -/
theorem read_append (readBody : R → M → R) (metaOf : B → M) (r0 : R) (xs ys : List B) :
    read readBody metaOf (read readBody metaOf r0 xs) ys = read readBody metaOf r0 (xs ++ ys) := by
  simp [read, List.foldl_append]

/-- What a stored view seals of what its device read: the rules it read under, and the metadata of the bodies it
    opened, in the order it read them. -/
structure Sealed (M : Type) where
  rules : Nat
  metas : List M

/-- What a device reads as it opens its view and reads on with the bodies `since` it opened since: from the metadata
    sealed where it was sealed under these rules, else every body anew, those `held` it opened before and those since. -/
def opensRead (readBody : R → M → R) (metaOf : B → M) (r0 : R) (s : Sealed M) (held since : List B) : R :=
  if s.rules = readRules then read readBody metaOf (s.metas.foldl readBody r0) since
  else read readBody metaOf r0 (held ++ since)

/-- RR1: a view that sealed the metadata of the very bodies its device opened, under these rules, reads on to what
    reading every body anew reads. -/
theorem RR1_opens_read (readBody : R → M → R) (metaOf : B → M) (r0 : R) (held since : List B)
    (s : Sealed M) (hr : s.rules = readRules) (hm : s.metas = held.map metaOf) :
    opensRead readBody metaOf r0 s held since = read readBody metaOf r0 (held ++ since) := by
  simp only [opensRead, hr, ite_true, hm]
  exact read_append readBody metaOf r0 held since

/-- RR2: what was sealed under other rules never opens: the device reads every body anew. -/
theorem RR2_other_rules_read (readBody : R → M → R) (metaOf : B → M) (r0 : R) (held since : List B)
    (s : Sealed M) (hr : s.rules ≠ readRules) :
    opensRead readBody metaOf r0 s held since = read readBody metaOf r0 (held ++ since) := by
  simp [opensRead, hr]

/-- Opening an edit's sealed bytes `c` under the keys `ks` a device holds, where they hold its key: what opens with
    fewer keys opens the same with more (`Mono`). -/
def Mono (opens : List K → C → Option B) : Prop :=
  ∀ ks ks' c b, opens ks c = some b → (∀ k, k ∈ ks → k ∈ ks') → opens ks' c = some b

/-- RR3: a body that opened under the keys `ks` a device held as it read opens the same when first asked for, under
    the keys `ks'` it holds then, which only grew. -/
theorem RR3_late_open (opens : List K → C → Option B) (hm : Mono opens) (ks ks' : List K) (c : C) (b : B)
    (hb : opens ks c = some b) (grew : ∀ k, k ∈ ks → k ∈ ks') : opens ks' c = some b :=
  hm ks ks' c b hb grew

end AvenDB.StoredReadings

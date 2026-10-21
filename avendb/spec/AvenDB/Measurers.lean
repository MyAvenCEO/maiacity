import AvenDB.Gate
import AvenDB.Objective

/-!
# Who measures an AIP

`avendb/docs/ARCHITECTURE.md` §8, "AIPs", N2: an AIP's objective (`AvenDB.Objective`) counts a reading as measured
(`measured "x"`) only where a Measurer of the AIP's vault wrote it. Those who accept the vault's AIPs measure them, on
their own devices, with nothing between them and the vault: the vault itself, as its owners' devices act for it, and
each vault that owns it. Beside them, a vault holding a share of the vault's cap group named Measurer
(`measurerName`), which only those who may share the vault hand out. Never the AIP's author: no author measures its own
AIP, whatever it holds or owns (M1, `measures_not_author`). `reading "x"` still counts every reading, the author's too.

Who wrote a reading is never a typed field: the engine reads, of each write the AIP's main line counts, in the order
every device replays them, its actor and the readings it added, as written then; the model takes that list
(`measuredBy`), so a later write changes no measured reading, and only a Measurer's writes add one (M2,
`measuredBy_author`). M3: a vault that neither is nor owns the vault, nor holds its Measurer group, measures nothing of
it (`measuredBy_holds`). M4: the vault measures every AIP it didn't start itself (`measures_vault`).
-/

namespace AvenDB

/-- The name of the cap group of a vault whose holders measure its AIPs. -/
def measurerName : String := "Measurer"

/-- Vault `u` measures the AIPs of vault `v` that `author` started: it accepts them, as `v` itself or a vault that owns
    `v`, or it holds `v`'s Measurer group; and it isn't `author`. -/
def measures (st : State) (v author u : VaultId) : Bool :=
  u != author && (u == v || owns st u v || holdsGroup st v u measurerName)

/-- What the Measurers of vault `v` added to an AIP `author` started: of each write, its actor and what it added, in
    order, what the writes of a vault that `measures` added. -/
def measuredBy {α : Type} (st : State) (v author : VaultId) (added : List (VaultId × List α)) : List α :=
  (added.filter fun p => measures st v author p.1).flatMap (·.2)

/-- M1: no author measures its own AIP. -/
theorem measures_not_author (st : State) (v a : VaultId) : measures st v a a = false := by
  simp [measures]

/-- M2: what the AIP's author wrote alone is measured by nobody. -/
theorem measuredBy_author {α : Type} (st : State) (v a : VaultId) (added : List (VaultId × List α))
    (h : ∀ p ∈ added, p.1 = a) : measuredBy st v a added = [] := by
  have : added.filter (fun p => measures st v a p.1) = [] := by
    rw [List.filter_eq_nil_iff]
    intro p hp
    simp [h p hp, measures_not_author]
  simp [measuredBy, this]

/-- M3: a vault that is not `v`, owns no `v` and holds no Measurer group of `v` measures nothing of it. -/
theorem measuredBy_holds {α : Type} (st : State) (v a : VaultId) (added : List (VaultId × List α))
    (h : ∀ p ∈ added, p.1 ≠ v ∧ owns st p.1 v = false ∧ holdsGroup st v p.1 measurerName = false) :
    measuredBy st v a added = [] := by
  have : added.filter (fun p => measures st v a p.1) = [] := by
    rw [List.filter_eq_nil_iff]
    intro p hp
    obtain ⟨hv, ho, hg⟩ := h p hp
    simp [measures, hv, ho, hg]
  simp [measuredBy, this]

/-- M4: the vault measures every AIP of its own that it didn't start itself, whatever it holds: those who accept its
    AIPs need no share to measure them. -/
theorem measures_vault (st : State) (v a : VaultId) (h : v ≠ a) : measures st v a v = true := by
  simp [measures, h]

/-! ## A Lean verdict (N3)

Real Lean checks an objective's file on a Measurer's own device (The OS on a Mac: `avendb-device`'s `leanCheck`, the
pinned toolchain in a locked-down process), which records what it found as a reading of its own: named `lean:` and the
objective's key (a hash of its Lean, `objective::key`), one where Lean accepted the file, zero where it didn't, the
engine and where it failed in its note. An AIP's verdict is the newest such reading a Measurer wrote for the objective
the AIP holds now (`leanVerdict`, over `measuredBy`'s readings): none until one does, none for another objective (L1),
the newest standing (L2), and never one an author wrote alone (L3, from M2). -/

/-- The name of a Lean verdict's reading on the objective keyed `key`. -/
def verdictName (key : String) : String := "lean:" ++ key

/-- Of the readings a vault's Measurers wrote, oldest first, each its name and value (`measuredBy`): the verdict on
    the objective keyed `key`, the newest reading named for it (`verdictName`), whether it is one. -/
def leanVerdict (measured : List (String × Objective.Dec)) (key : String) : Option Bool :=
  (measured.reverse.find? (·.1 == verdictName key)).map (·.2 == Objective.one)

/-- L1: no reading named for the objective, no verdict. -/
theorem leanVerdict_none (measured : List (String × Objective.Dec)) (key : String)
    (h : ∀ p ∈ measured, p.1 ≠ verdictName key) : leanVerdict measured key = none := by
  have : measured.reverse.find? (·.1 == verdictName key) = none := by
    rw [List.find?_eq_none]
    intro p hp
    simpa using h p (List.mem_reverse.mp hp)
  simp [leanVerdict, this]

/-- L2: the newest reading for the objective stands. -/
theorem leanVerdict_newest (measured : List (String × Objective.Dec)) (key : String) (x : Objective.Dec) :
    leanVerdict (measured ++ [(verdictName key, x)]) key = some (x == Objective.one) := by
  simp [leanVerdict]

/-- L3: what an AIP's author wrote alone gives it no verdict. -/
theorem leanVerdict_author (st : State) (v a : VaultId) (added : List (VaultId × List (String × Objective.Dec)))
    (key : String) (h : ∀ p ∈ added, p.1 = a) : leanVerdict (measuredBy st v a added) key = none := by
  rw [measuredBy_author st v a added h]
  rfl

end AvenDB

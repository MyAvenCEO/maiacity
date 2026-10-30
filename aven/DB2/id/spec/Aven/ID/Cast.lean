import Aven.ID.Correct
import Aven.ID.Check
import Aven.ID.Ask

/-! # The cast's tree

avenSANDBOX's fixed tree (`sandbox/cast.json`), checked here by the kernel: it is well formed, and what each vault
governs, sees and acts through is what SANDBOX.md writes out by hand. These examples are the only place those answers
are written: `lake exe vectors` exports them (`vectors/trees.json`), and aven-id's tests, its wasm and avenOS's check
load them from there (README, rule 10). -/

namespace Aven.ID

def cast : Tree where
  keys := ["alice-owner", "bob-owner", "aven-peer", "alice-peer", "alice-peer-light", "bob-peer-light"]
  vaults := [
    ⟨"alice", "Alice's vault", .person, [.key "alice-owner"]⟩,
    ⟨"bob", "Bob's vault", .person, [.key "bob-owner"]⟩,
    ⟨"maia-city", "Maia City", .coop, [.vault "alice"]⟩,
    ⟨"aven", "Aven", .network, [.vault "maia-city"]⟩,
    ⟨"aven-peer", "Aven Peer", .device, [.vault "aven"]⟩,
    ⟨"alice-peer", "Alice Peer", .device, [.vault "alice"]⟩,
    ⟨"alice-peer-light", "Alice Peer-Light", .device, [.vault "alice"]⟩,
    ⟨"bob-peer-light", "Bob's Peer-Light", .device, [.vault "bob"]⟩]

theorem cast_wf : cast.WF := by decide

/-- Questions about the cast, each with its answer written out by hand from the tree of PRODUCTION.md's Part C:
Alice's vault owns Maia City, the admin coop, which owns Aven; Bob's vault stays a person's. -/
def castExamples : List (Query × Answer) := [
  (.kind "alice", .id "person"), (.kind "bob", .id "person"), (.kind "maia-city", .id "coop"),
  (.kind "aven", .id "network"), (.kind "aven-peer", .id "device"), (.kind "alice-peer", .id "device"),
  (.kind "alice-peer-light", .id "device"), (.kind "bob-peer-light", .id "device"), (.kind "nobody", .id none),
  (.name "alice", .id "Alice's vault"), (.name "maia-city", .id "Maia City"), (.name "aven", .id "Aven"),
  (.name "bob-peer-light", .id "Bob's Peer-Light"), (.name "nobody", .id none),
  (.owners "maia-city", .ids ["vault:alice"]), (.owners "aven", .ids ["vault:maia-city"]),
  (.owners "alice", .ids ["key:alice-owner"]), (.owners "aven-peer", .ids ["vault:aven"]),
  (.owned "alice", .ids ["maia-city", "alice-peer", "alice-peer-light"]), (.owned "maia-city", .ids ["aven"]),
  (.owned "aven", .ids ["aven-peer"]), (.owned "bob", .ids ["bob-peer-light"]), (.owned "aven-peer", .ids []),
  (.owned "alice-peer", .ids []), (.owned "alice-peer-light", .ids []), (.owned "bob-peer-light", .ids []),
  (.owned "nobody", .ids []),
  (.governs "alice", .ids ["maia-city", "aven", "aven-peer", "alice-peer", "alice-peer-light"]),
  (.governs "maia-city", .ids ["aven", "aven-peer"]), (.governs "aven", .ids ["aven-peer"]),
  (.governs "bob", .ids ["bob-peer-light"]),
  -- a device governs nothing
  (.governs "aven-peer", .ids []), (.governs "alice-peer", .ids []), (.governs "alice-peer-light", .ids []),
  (.governs "bob-peer-light", .ids []),
  (.chain "aven-peer", .ids ["aven", "maia-city", "alice"]), (.chain "aven", .ids ["maia-city", "alice"]),
  (.chain "maia-city", .ids ["alice"]), (.chain "alice-peer-light", .ids ["alice"]),
  (.chain "bob-peer-light", .ids ["bob"]), (.chain "alice", .ids []), (.chain "bob", .ids []),
  (.actsFor "aven-peer", .id "aven"), (.actsFor "alice-peer", .id "alice"),
  (.actsFor "alice-peer-light", .id "alice"), (.actsFor "bob-peer-light", .id "bob"),
  (.actsFor "alice", .id none), (.actsFor "bob", .id none), (.actsFor "maia-city", .id none),
  (.actsFor "aven", .id none), (.actsFor "nobody", .id none),
  (.actsThrough "alice", .ids ["alice-peer", "alice-peer-light"]), (.actsThrough "aven", .ids ["aven-peer"]),
  (.actsThrough "bob", .ids ["bob-peer-light"]),
  -- a coop holds no devices: its people act for it through their own
  (.actsThrough "maia-city", .ids []),
  (.accounts none, .ids ["alice", "bob"]), (.accounts "alice-peer-light", .ids ["alice"]),
  (.accounts "alice-peer", .ids ["alice"]), (.accounts "bob-peer-light", .ids ["bob"]),
  -- the Aven Peer serves Aven, which is no account; nor is the coop
  (.accounts "aven-peer", .ids []), (.accounts "alice", .ids []), (.accounts "maia-city", .ids []),
  (.sees "alice", .ids ["aven-peer", "alice-peer", "alice-peer-light"]), (.sees "bob", .ids ["bob-peer-light"]),
  (.sees "maia-city", .ids ["aven-peer"]), (.sees "aven", .ids ["aven-peer"])]

/-- Each device and the vaults it may act on; every other vault of the cast is refused, and a vault that is no device
acts on nothing. -/
def mayActOnTable : List (String × List String) := [
  ("aven-peer", ["aven", "aven-peer"]),
  ("alice-peer", ["alice", "maia-city", "aven", "aven-peer", "alice-peer", "alice-peer-light"]),
  ("alice-peer-light", ["alice", "maia-city", "aven", "aven-peer", "alice-peer", "alice-peer-light"]),
  ("bob-peer-light", ["bob", "bob-peer-light"]),
  ("alice", []), ("bob", []), ("maia-city", []), ("aven", [])]

def mayActOnExamples : List (Query × Answer) :=
  mayActOnTable.flatMap fun (d, allowed) => cast.ids.map fun v => (.mayActOn d v, .yes (allowed.contains v))

theorem cast_examples : (castExamples ++ mayActOnExamples).all (fun (q, a) => decide (cast.ask q = a)) = true := by
  decide

/-- Trees that break a rule, and the rule `check` names, written out by hand. `k` and `d` are keys; a device's key
has the device's id. -/
def invalidExamples : List (String × Tree × Option Invalid) :=
  let a : Vault := ⟨"a", "A", .person, [.key "k"]⟩
  let tree (vaults : List Vault) : Tree := ⟨["k", "d"], vaults⟩
  [("a person owned by a key", tree [a], none),
   ("no owner", tree [⟨"a", "A", .person, []⟩], some (.unowned "a")),
   ("an unknown key", tree [⟨"a", "A", .person, [.key "x"]⟩], some (.unknown "a" (.key "x"))),
   ("an unknown vault", tree [⟨"a", "A", .person, [.vault "x"]⟩], some (.unknown "a" (.vault "x"))),
   ("two vaults, one id", tree [a, ⟨"a", "A", .network, [.key "k"]⟩], some (.duplicate "a")),
   ("a device owned by a key", tree [a, ⟨"d", "D", .device, [.key "k"]⟩], some (.deviceOwners "d")),
   ("a device owned twice", tree [a, ⟨"d", "D", .device, [.vault "a", .vault "a"]⟩], some (.deviceOwners "d")),
   ("a device that owns", tree [a, ⟨"d", "D", .device, [.vault "a"]⟩, ⟨"e", "E", .network, [.vault "d"]⟩],
     some (.deviceOwns "d" "e")),
   ("a cycle of two", tree [⟨"a", "A", .person, [.vault "b"]⟩, ⟨"b", "B", .network, [.vault "a"]⟩], some .cycle),
   ("a vault that owns itself", tree [⟨"a", "A", .person, [.vault "a"]⟩], some .cycle),
   ("a device without its key", tree [a, ⟨"e", "E", .device, [.vault "a"]⟩], some (.deviceKeyless "e")),
   ("a device's key that owns", tree [a, ⟨"d", "D", .device, [.vault "a"]⟩, ⟨"b", "B", .person, [.key "d"]⟩],
     some (.deviceKeyOwns "d" "b")),
   ("a device with its key", tree [a, ⟨"d", "D", .device, [.vault "a"]⟩], none),
   ("a vault without a name", tree [⟨"a", "", .person, [.key "k"]⟩], some (.name "a")),
   ("a name of two lines", tree [a, ⟨"b", "B\nB", .person, [.key "k"]⟩], some (.name "b")),
   ("a name of 65 characters", tree [⟨"a", "".pushn 'x' 65, .person, [.key "k"]⟩], some (.name "a")),
   ("a name comes before an owner", tree [⟨"a", "", .person, []⟩], some (.name "a")),
   ("a coop owned by a person", tree [a, ⟨"c", "C", .coop, [.vault "a"]⟩], none),
   ("a coop owned by a coop and a person", tree [a, ⟨"c", "C", .coop, [.vault "a"]⟩,
     ⟨"e", "E", .coop, [.vault "c", .vault "a"]⟩], none),
   ("a coop owned by a key", tree [⟨"c", "C", .coop, [.key "k"]⟩], some (.coopOwner "c" (.key "k"))),
   ("a coop owned by a person and a key", tree [a, ⟨"c", "C", .coop, [.vault "a", .key "k"]⟩],
     some (.coopOwner "c" (.key "k"))),
   ("a coop owned by a network", tree [a, ⟨"n", "N", .network, [.vault "a"]⟩, ⟨"c", "C", .coop, [.vault "n"]⟩],
     some (.coopOwner "c" (.vault "n"))),
   ("a coop without an owner", tree [⟨"c", "C", .coop, []⟩], some (.unowned "c")),
   ("a coop that holds a device", tree [a, ⟨"c", "C", .coop, [.vault "a"]⟩, ⟨"d", "D", .device, [.vault "c"]⟩],
     some (.coopDevice "c" "d")),
   ("a coop that owns a network", tree [a, ⟨"c", "C", .coop, [.vault "a"]⟩, ⟨"n", "N", .network, [.vault "c"]⟩],
     none),
   ("the cast", cast, none),
   ("the Aven Peer's key as an owner",
     { cast with vaults := cast.vaults ++ [⟨"x", "X", .person, [.key "aven-peer"]⟩] },
     some (.deviceKeyOwns "aven-peer" "x")),
   ("the cast without Bob's Peer-Light's key", { cast with keys := cast.keys.erase "bob-peer-light" },
     some (.deviceKeyless "bob-peer-light"))]

theorem invalid_examples : invalidExamples.all (fun (_, t, why) => decide (t.check = why)) = true := by decide

/-- Aven is never an account, on any host; nor is Maia City. -/
theorem aven_not_account (d : Option String) : "aven" ∉ cast.accounts d :=
  Tree.not_account (.inl (by decide))

theorem coop_not_account (d : Option String) : "maia-city" ∉ cast.accounts d :=
  Tree.not_account (.inr (.inl (by decide)))

/-- No device's key governs anything in the cast: not Aven, not Alice's vault. -/
theorem cast_device_keys (x : String) : ∀ d ∈ ["aven-peer", "alice-peer", "alice-peer-light", "bob-peer-light"],
    ¬ cast.KeyGoverns d x := by
  intro d m
  exact Tree.device_key_governs_nothing cast_wf (by simp at m; rcases m with rfl | rfl | rfl | rfl <;> decide)

/-- Bob's devices never act on Aven, nor on anything of Alice's. -/
theorem bob_not_on_aven : ∀ d ∈ cast.actsThrough "bob", ∀ v ∈ ["maia-city", "aven", "aven-peer", "alice", "alice-peer"],
    cast.mayActOn d v = false := by decide

/-- The Aven Peer acts on Aven and on itself, never on Alice's vault above it. -/
example : cast.mayActOn "aven-peer" "aven" = true ∧ cast.mayActOn "aven-peer" "aven-peer" = true ∧
    cast.mayActOn "aven-peer" "alice" = false := by decide

end Aven.ID

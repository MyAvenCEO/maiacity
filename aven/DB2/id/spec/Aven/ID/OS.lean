import Aven.ID.Cast

/-! # What avenOS shows

The rules avenOS's pages follow on top of the queries (SANDBOX.md, "avenOS in the browser"), and what they show for
the cast. `sandbox/check.mjs` walks the pages and holds them to these answers, which `lake exe vectors` exports
(`vectors/avenos.json`).

- **A host** is a device, the box's own view (`localhost`, which holds every test key) or a visitor's.
- **The Vault app** at `#/<account>/vault/<target>` opens the target when the account governs it and the account's
  own vault otherwise, and shows that vault followed by everything it governs, depth first. -/

namespace Aven.ID

inductive Host where
  | box
  | device (id : String)
  | visitor
  deriving DecidableEq, Repr

namespace Tree

variable {t : Tree}

/-- Whom a host may act as: a device the person it serves, the box every person, a visitor no one. -/
def hostAccounts (t : Tree) : Host → List String
  | .box => t.accounts none
  | .device d => t.accounts (some d)
  | .visitor => []

/-- The vault the Vault app opens for `account` at `target`. -/
def opens (t : Tree) (account target : String) : String :=
  if (t.governs account).contains target then target else account

/-- The Vault app's tree: the vault it opens, then all it governs. -/
def vaultView (t : Tree) (account target : String) : List String :=
  let shown := t.opens account target
  shown :: t.governs shown

/-- Whatever the Vault app opens, the account is that vault or governs it. -/
theorem opens_governed (w : t.WF) (account target : String) :
    t.opens account target = account ∨ t.Governs account (t.opens account target) := by
  unfold opens
  split
  · next h => exact .inr ((mem_governs w).mp (by simpa using h))
  · exact .inl rfl

/-- No host may act as a network or a device. -/
theorem hostAccounts_people {h : Host} {x : String} (m : x ∈ t.hostAccounts h) :
    t.kind? x = some .person := by
  cases h with
  | box => exact mem_accounts (by simpa [hostAccounts] using m)
  | device d => exact mem_accounts (by simpa [hostAccounts] using m)
  | visitor => simp [hostAccounts] at m

end Tree

/-- The box's hosts: its own view, each Peer-Light's origin (`sandbox/cast.json`'s `peers`), and any other. -/
def hosts : List (String × Host) :=
  [("localhost", .box), ("alice.localhost", .device "alice-peer-light"),
   ("bob.localhost", .device "bob-peer-light"), ("os.localhost", .visitor)]

/-- Whom each host may act as, written out by hand. No person switches into Aven: it acts only through its own
device, the Aven Peer. Nor into Maia City: its people act for it as themselves. -/
def accountsExamples : List (String × List String) :=
  [("localhost", ["alice", "bob"]), ("alice.localhost", ["alice"]), ("bob.localhost", ["bob"]),
   ("os.localhost", [])]

theorem accounts_examples :
    accountsExamples.all (fun (host, want) => (hosts.lookup host).map cast.hostAccounts == some want) = true := by
  decide

/-- The Vault app's tree for an account and a target (`none`: its own vault): a vault one governs opens, any other
doesn't. -/
def vaultExamples : List ((String × Option String) × List String) :=
  [(("alice", none), ["alice", "maia-city", "aven", "aven-peer", "alice-peer", "alice-peer-light"]),
   (("alice", "maia-city"), ["maia-city", "aven", "aven-peer"]),
   (("alice", "aven"), ["aven", "aven-peer"]),
   (("bob", none), ["bob", "bob-peer-light"]),
   (("bob", "maia-city"), ["bob", "bob-peer-light"]),
   (("bob", "aven"), ["bob", "bob-peer-light"])]

theorem vault_examples :
    vaultExamples.all (fun ((a, target), want) => cast.vaultView a (target.getD a) == want) = true := by decide

end Aven.ID

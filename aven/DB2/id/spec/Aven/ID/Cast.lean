import Aven.ID.Correct

/-! # The cast's tree

avenSANDBOX's fixed tree (`sandbox/cast.json`), checked here by the kernel: it is well formed, and what each vault
governs, sees and acts through is what SANDBOX.md writes out by hand. -/

namespace Aven.ID

def cast : Tree where
  keys := ["alice-owner", "bob-owner", "aven-peer", "alice-peer", "alice-peer-light", "bob-peer-light"]
  vaults := [
    ⟨"alice", .person, [.key "alice-owner"]⟩,
    ⟨"bob", .person, [.key "bob-owner"]⟩,
    ⟨"aven", .network, [.vault "alice"]⟩,
    ⟨"aven-peer", .device, [.vault "aven"]⟩,
    ⟨"alice-peer", .device, [.vault "alice"]⟩,
    ⟨"alice-peer-light", .device, [.vault "alice"]⟩,
    ⟨"bob-peer-light", .device, [.vault "bob"]⟩]

theorem cast_wf : cast.WF := by decide

example : cast.governs "alice" = ["aven", "aven-peer", "alice-peer", "alice-peer-light"] := by decide
example : cast.governs "aven" = ["aven-peer"] := by decide
example : cast.governs "bob" = ["bob-peer-light"] := by decide
example : cast.chain "aven-peer" = ["aven", "alice"] := by decide
example : cast.sees "alice" = ["aven-peer", "alice-peer", "alice-peer-light"] := by decide
example : cast.sees "bob" = ["bob-peer-light"] := by decide
example : cast.actsThrough "alice" = ["alice-peer", "alice-peer-light"] := by decide
example : cast.actsThrough "aven" = ["aven-peer"] := by decide
example : cast.actsFor "aven-peer" = some "aven" := by decide
example : cast.accounts none = ["alice", "bob"] := by decide
example : cast.accounts (some "alice-peer-light") = ["alice"] := by decide
example : cast.accounts (some "aven-peer") = [] := by decide

/-- Aven is never an account, on any host. -/
theorem aven_not_account (d : Option String) : "aven" ∉ cast.accounts d :=
  Tree.not_account (.inl (by decide))

/-- Bob's devices never act on Aven, nor on anything of Alice's. -/
theorem bob_not_on_aven : ∀ d ∈ cast.actsThrough "bob", ∀ v ∈ ["aven", "aven-peer", "alice", "alice-peer"],
    cast.mayActOn d v = false := by decide

/-- The Aven Peer acts on Aven and on itself, never on Alice's vault above it. -/
example : cast.mayActOn "aven-peer" "aven" = true ∧ cast.mayActOn "aven-peer" "aven-peer" = true ∧
    cast.mayActOn "aven-peer" "alice" = false := by decide

end Aven.ID

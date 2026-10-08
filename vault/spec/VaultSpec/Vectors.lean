import VaultSpec.Step

/-!
# Test vectors for the Rust core

The same cases run here and in `vault-db/tests/vectors.rs`. A case is a list of ops applied one after the other from
the empty state, as every peer applies them once they are in replay order; the model's answer is whether each op is
accepted, and the vaults at the end. The Rust core must give the same answer for every case.

`lake build` checks that `vectors/vaults.json` holds exactly what the model says, and fails when it doesn't
(`VectorsCheck.lean`); `lake exe vectors` writes the file again after a change to the rules.

The Rust core names a vault by the hash of its genesis, where the model picks a number: the Rust side maps each
number to the vault its genesis created.
-/

namespace VaultSpec.Vectors

structure Case where
  name : String
  ops  : List (SignerId × List SignerId × Action)

/-- Apply the ops one after the other: whether each was accepted, and the state at the end. -/
def run (ops : List (SignerId × List SignerId × Action)) : List Bool × State :=
  let (accepted, st) := ops.zipIdx.foldl (fun (acc : List Bool × State) ((author, co, a), i) =>
    let op : Op := { id := i, depth := i, author, cosigners := co, action := a }
    match step acc.2 op with
    | some st' => (acc.1 ++ [true], st')
    | none     => (acc.1 ++ [false], acc.2)) ([], {})
  (accepted, st)

/-! ## The cases

Signers: Samuel's passkey 1, his Mac 2, his iPhone 3, Bob's passkey 4 and Mac 5, Carol's passkey 6, Dave's passkey 8,
a recovery code's signer 9, a new device 77. Vaults: Samuel 100, Bob 101, Carol 102, Dave 103, coops from 200. -/

def humans : List (SignerId × List SignerId × Action) := [
  (1, [], .genesis 100 .human [.signer 1] 1),
  (1, [2], .addDevice 100 2),
  (4, [], .genesis 101 .human [.signer 4] 1),
  (4, [5], .addDevice 101 5),
  (6, [], .genesis 102 .human [.signer 6] 1),
  (8, [], .genesis 103 .human [.signer 8] 1)]

def cases : List Case := [
  { name := "a human vault, its devices and a recovery signer", ops := [
    (1, [], .genesis 100 .human [.signer 1] 1),
    (1, [2], .addDevice 100 2),
    (1, [3], .addDevice 100 3),
    -- a device doesn't govern, even with the newcomer's signature
    (2, [77], .addDevice 100 77),
    -- the newcomer must sign
    (1, [], .addDevice 100 77),
    (1, [2], .addDevice 100 2),
    (2, [], .removeDevice 100 3 []),
    (2, [], .setThreshold 100 1),
    (1, [], .setThreshold 100 2),
    (1, [], .setThreshold 100 0),
    -- a device leaves on its own
    (3, [], .removeDevice 100 3 []),
    (1, [], .removeDevice 100 3 []),
    (1, [], .removeOwner 100 (.signer 1) []),
    -- a human vault is owned by signers
    (1, [], .addOwner 100 (.vault 100)),
    -- a recovery code's signer joins as a second owner, and later replaces the lost passkey
    (1, [9], .addOwner 100 (.signer 9)),
    (9, [], .removeOwner 100 (.signer 1) []),
    (9, [77], .addDevice 100 77),
    (1, [], .addDevice 100 3)] },
  { name := "geneses", ops := [
    (4, [], .genesis 101 .human [] 1),
    (4, [], .genesis 101 .human [.signer 4, .signer 4] 1),
    (4, [], .genesis 101 .human [.signer 4] 2),
    (5, [], .genesis 101 .human [.signer 4] 1),
    (4, [], .genesis 101 .coop [.signer 4] 1),
    (4, [], .genesis 101 .human [.signer 4] 1),
    (4, [], .genesis 101 .human [.signer 4] 1),
    (4, [], .genesis 200 .coop [.vault 101, .vault 999] 1),
    (4, [], .genesis 200 .coop [.vault 101] 0)] },
  { name := "a coop's governance", ops := humans ++ [
    -- Bob has to consent to becoming an owner
    (1, [], .genesis 200 .coop [.vault 100, .vault 101] 2),
    (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 3),
    (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 2),
    -- Samuel's vault alone is below the threshold; Dave has to consent; devices don't count
    (1, [8], .addOwner 200 (.vault 103)),
    (1, [4], .addOwner 200 (.vault 103)),
    (2, [5, 8], .addOwner 200 (.vault 103)),
    (1, [4, 6], .addOwner 200 (.signer 6)),
    (1, [4, 8], .addOwner 200 (.vault 103)),
    -- Dave leaves on his own
    (8, [], .removeOwner 200 (.vault 103) []),
    (1, [], .setThreshold 200 1),
    (1, [4], .setThreshold 200 1),
    (1, [], .removeOwner 200 (.vault 101) []),
    (1, [], .removeOwner 200 (.vault 100) []),
    -- devices belong to human vaults
    (1, [2], .addDevice 200 2)] },
  { name := "no ownership cycles", ops := humans ++ [
    (1, [], .genesis 200 .coop [.vault 100] 1),
    (1, [], .genesis 201 .coop [.vault 200] 1),
    (1, [], .genesis 202 .coop [.vault 201] 1),
    (1, [], .addOwner 200 (.vault 200)),
    (1, [], .addOwner 200 (.vault 201)),
    (1, [], .addOwner 200 (.vault 202)),
    (1, [4], .addOwner 201 (.vault 101)),
    -- two paths to the same coop are no cycle
    (1, [], .addOwner 202 (.vault 200))] },
  { name := "concurrent changes, in replay order", ops := humans ++ [
    -- two owners remove each other: the first stands, the second would remove the last owner
    (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    (1, [], .removeOwner 200 (.vault 101) []),
    (4, [], .removeOwner 200 (.vault 100) []),
    -- two adds that each are fine alone close a cycle together: the second is refused
    (1, [], .genesis 201 .coop [.vault 100] 1),
    (1, [], .genesis 202 .coop [.vault 100] 1),
    (1, [], .addOwner 201 (.vault 202)),
    (1, [], .addOwner 202 (.vault 201)),
    -- removals replay first: without Dave, his co-signature on an add no longer counts
    (1, [4, 8], .genesis 203 .coop [.vault 100, .vault 101, .vault 103] 2),
    (1, [4], .removeOwner 203 (.vault 103) []),
    (8, [1, 6], .addOwner 203 (.vault 102))] }]

/-! ## JSON -/

def str (s : String) : String := "\"" ++ s ++ "\""
def arr (xs : List String) : String := "[" ++ ", ".intercalate xs ++ "]"
def obj (kvs : List (String × String)) : String := "{" ++ ", ".intercalate (kvs.map fun (k, v) => str k ++ ": " ++ v) ++ "}"
def nat (n : Nat) : String := toString n
def bool (b : Bool) : String := if b then "true" else "false"

def principal : Principal → String
  | .signer s => obj [("signer", nat s)]
  | .vault v  => obj [("vault", nat v)]

def kind : Kind → String
  | .human => str "human"
  | .coop  => str "coop"

def action : Action → String
  | .genesis v k owners t => obj [("genesis", obj [("vault", nat v), ("kind", kind k),
      ("owners", arr (owners.map principal)), ("threshold", nat t)])]
  | .addOwner v p => obj [("addOwner", obj [("vault", nat v), ("owner", principal p)])]
  | .removeOwner v p _ => obj [("removeOwner", obj [("vault", nat v), ("owner", principal p)])]
  | .setThreshold v n => obj [("setThreshold", obj [("vault", nat v), ("threshold", nat n)])]
  | .addDevice v d => obj [("addDevice", obj [("vault", nat v), ("device", nat d)])]
  | .removeDevice v d _ => obj [("removeDevice", obj [("vault", nat v), ("device", nat d)])]
  | _ => "null"

def vault (vt : Vault) : String :=
  obj [("id", nat vt.id), ("kind", kind vt.kind), ("owners", arr (vt.owners.map principal)),
       ("threshold", nat vt.threshold), ("devices", arr (vt.devices.map nat))]

def case (c : Case) : String :=
  let (accepted, st) := run c.ops
  let ops := c.ops.map fun (author, co, a) => obj [("author", nat author), ("cosigners", arr (co.map nat)), ("action", action a)]
  "{" ++ str "name" ++ ": " ++ str c.name ++ ",\n " ++ str "ops" ++ ": [\n  " ++ ",\n  ".intercalate ops ++ "],\n " ++
    str "accepted" ++ ": " ++ arr (accepted.map bool) ++ ",\n " ++ str "vaults" ++ ": " ++ arr (st.vaults.map vault) ++ "}"

def render : String := "{\"cases\": [\n" ++ ",\n".intercalate (cases.map case) ++ "\n]}\n"

-- every case refuses some ops and accepts others, so neither side can pass by always saying the same thing
#guard cases.all fun c => let (acc, _) := run c.ops; acc.any id && acc.any (!·)

end VaultSpec.Vectors

import VaultSpec.Step

/-!
# Test vectors for the Rust core

The same cases run here and in `vault-db/tests/vectors.rs`. A step case is a list of ops applied one after the other
from the empty state, as every peer applies them once they are in replay order; the model's answer is whether each op
is accepted, and the state at the end. A view case gives each op the depth it claims, as ops made on different
devices do, and the answer is which ops stand in the view (`standing`) and the view itself: that is where removals
cut what they hadn't seen. The Rust core must give the same answer for every case.

`lake build` checks that `vectors/vaults.json` holds exactly what the model says, and fails when it doesn't
(`VectorsCheck.lean`); `lake exe vectors` writes the file again after a change to the rules.

The Rust core names what an op creates (a vault, a space, a grant) by the hash of that op, and orders ops of the same
depth and rank by that hash, where the model picks numbers: the Rust side maps each number to what its op created, so
every number is used once per case and no two ops of a view case share a depth and a rank. Keys come in P3: until
then the Rust core keeps every key at epoch 0, so the cases write under epoch 0 except to show that a later epoch is
refused.
-/

namespace VaultSpec.Vectors

structure Case where
  name : String
  ops  : List (SignerId × List SignerId × Action)

/-- A view case: each op with the depth it claims. -/
structure ViewCase where
  name : String
  ops  : List (Nat × SignerId × List SignerId × Action)

/-- Apply the ops one after the other: whether each was accepted, and the state at the end. An op's id is its
    position. -/
def run (ops : List (SignerId × List SignerId × Action)) : List Bool × State :=
  let (accepted, st) := ops.zipIdx.foldl (fun (acc : List Bool × State) ((author, co, a), i) =>
    let op : Op := { id := i, depth := i, author, cosigners := co, action := a }
    match step acc.2 op with
    | some st' => (acc.1 ++ [true], st')
    | none     => (acc.1 ++ [false], acc.2)) ([], {})
  (accepted, st)

def ViewCase.toOps (c : ViewCase) : List Op :=
  c.ops.zipIdx.map fun ((depth, author, co, a), i) => { id := i, depth, author, cosigners := co, action := a }

/-- Which ops stand in the view, in the order given, and the view. -/
def runView (c : ViewCase) : List Bool × State :=
  let ops := c.toOps
  let stood := standing ops
  (ops.map fun o => stood.any (·.id == o.id), view ops)

/-! ## The cases

Signers: Samuel's passkey 1, his Mac 2, his iPhone 3, Bob's passkey 4 and Mac 5, Carol's passkey 6 and Mac 7, Dave's
passkey 8, a second passkey or recovery code's signer 9, a new device 77, a stranger 555. Vaults: Samuel 100, Bob
101, Carol 102, Dave 103, coops from 200. Spaces: Handbook 10, Notes 11, Todos 12. Entries: Welcome 1, Charter 2,
the door todo 21. -/

def humans : List (SignerId × List SignerId × Action) := [
  (1, [], .genesis 100 .human [.signer 1] 1),
  (1, [2], .addDevice 100 2),
  (4, [], .genesis 101 .human [.signer 4] 1),
  (4, [5], .addDevice 101 5),
  (6, [], .genesis 102 .human [.signer 6] 1),
  (8, [], .genesis 103 .human [.signer 8] 1)]

def g (id : GrantId) (sc : Scope) (r : Role) (to : Grantee) (issuer : VaultId) (parent : Option GrantId := none) :
    Action := .grant { id, scope := sc, role := r, grantee := to, issuer, parent }

def toVault (v : VaultId) : Grantee := .principal (.vault v)

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
    (8, [1, 6], .addOwner 203 (.vault 102))] },
  { name := "the passkey as root", ops := [
    (1, [], .genesis 100 .human [.signer 1] 1 (some 1)),
    -- the root signs the genesis that names it, and a coop has no root
    (4, [], .genesis 101 .human [.signer 4] 1 (some 5)),
    (1, [], .genesis 200 .coop [.vault 100] 1 (some 1)),
    -- a second passkey joins, and the threshold goes up to 2
    (1, [9], .addOwner 100 (.signer 9)),
    (1, [], .setThreshold 100 2),
    -- the second passkey alone is below the threshold; the root approves alone
    (9, [2], .addDevice 100 2),
    (1, [2], .addDevice 100 2),
    -- only the root hands the root on, and the new root signs
    (9, [], .setRoot 100 (some 9) []),
    (1, [], .setRoot 100 (some 9) []),
    (1, [9], .setRoot 100 (some 9) []),
    (1, [3], .addDevice 100 3),
    (9, [3], .addDevice 100 3),
    -- the root steps down: the threshold rules again
    (9, [], .setRoot 100 none []),
    (9, [77], .addDevice 100 77),
    (9, [], .setRoot 100 (some 9) [])] },
  { name := "spaces, grants and Public", ops := humans ++ [
    (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 2),
    -- Samuel's Mac founds the Handbook for the coop; Carol's passkey can't found a space for Samuel
    (2, [], .foundSpace 10 200),
    (6, [], .foundSpace 11 100),
    (2, [], .write 10 1 200 0),
    (2, [], .write 11 1 100 0),
    -- read for Carol's vault, never for a signer; Public only reads
    (2, [], g 1 (.entry 10 1) .read (toVault 102) 200),
    (2, [], g 2 (.entry 10 1) .read (.principal (.signer 6)) 200),
    (2, [], g 3 (.entry 10 2) .write .«public» 200),
    (2, [], g 4 (.entry 10 2) .read .«public» 200),
    -- making Dave owner of the Handbook is governance: both passkeys of the threshold-2 coop
    (2, [], g 5 (.space 10) .owner (toVault 103) 200),
    (1, [4], g 6 (.space 10) .owner (toVault 103) 200),
    -- Dave shares on through his owner grant; without naming it, he isn't the founder
    (8, [], g 7 (.entry 10 1) .write (toVault 102) 103 (some 6)),
    (8, [], g 8 (.entry 10 1) .read (toVault 101) 103),
    -- Bob writes for the coop, not for himself; each edit builds on what was there
    (5, [], .write 10 1 101 0),
    (5, [], .write 10 1 200 0 [9]),
    (6, [], .write 10 1 102 0 [20]),
    (6, [], .write 10 1 102 0 [99]),
    (6, [], .write 10 1 102 1 [21]),
    (6, [], .write 10 2 102 0)] },
  { name := "revocation, cascades and keep lists", ops := humans ++ [
    (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    (2, [], .foundSpace 12 100),
    (2, [], .write 12 21 100 0),
    (2, [], g 10 (.entry 12 21) .write (toVault 101) 100),
    (1, [], g 12 (.entry 12 21) .owner (toVault 200) 100),
    -- acting for the coop, Bob's Mac gives Dave read
    (5, [], g 14 (.entry 12 21) .read (toVault 103) 200 (some 12)),
    (5, [], .write 12 21 101 0 [8]),
    -- Samuel takes Bob's own write away, keeping the edit he had seen
    (2, [], .revoke 10 100 [12]),
    (5, [], .write 12 21 101 0 [12]),
    (5, [], .write 12 21 200 0 [12]),
    (2, [], .write 12 21 100 0 [15]),
    -- taking the coop's owner grant away is governance; it ends Dave's read and the coop's edit, which it hadn't
    -- seen, and Samuel's edit that builds on it
    (2, [], .revoke 12 100 []),
    (1, [], .revoke 12 100 []),
    (5, [], .write 12 21 200 0 [8]),
    (2, [], .revoke 99 100 []),
    (2, [], .revoke 14 100 [])] }]

/-- Samuel's, Bob's, Carol's and Dave's vaults, one op per depth. -/
def humansV : List (Nat × SignerId × List SignerId × Action) := humans.zipIdx.map fun ((a, co, act), i) => (i, a, co, act)

def views : List ViewCase := [
  { name := "a removed owner can't back-date governance", ops := humansV ++ [
    (6, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    -- Bob, offline since the coop began, adds Dave
    (7, 4, [8], .addOwner 200 (.vault 103)),
    (8, 1, [], .setThreshold 200 1),
    -- Samuel removes Bob, not having seen the add
    (9, 1, [], .removeOwner 200 (.vault 101) [])] },
  { name := "a removal keeps what it had seen", ops := humansV ++ [
    (6, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    (7, 4, [8], .addOwner 200 (.vault 103)),
    (8, 1, [], .setThreshold 200 1),
    (9, 1, [], .removeOwner 200 (.vault 101) [7]),
    -- Bob no longer governs
    (10, 4, [], .setThreshold 200 1)] },
  { name := "the senior owner wins a clash", ops := humansV ++ [
    (6, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    -- Bob's removal of Samuel sorts first, Samuel's of Bob stands
    (7, 4, [], .removeOwner 200 (.vault 100) []),
    (8, 1, [], .removeOwner 200 (.vault 101) [])] },
  { name := "removals that don't clash both stand", ops := humansV ++ [
    (6, 1, [4, 8], .genesis 200 .coop [.vault 100, .vault 101, .vault 103] 1),
    (7, 1, [], .removeOwner 200 (.vault 101) []),
    -- Dave leaves at the same time
    (8, 8, [], .removeOwner 200 (.vault 103) []),
    (9, 8, [], .setThreshold 200 1)] },
  { name := "the root outranks a stolen second passkey", ops := [
    (0, 1, [], .genesis 100 .human [.signer 1] 1 (some 1)),
    (1, 1, [9], .addOwner 100 (.signer 9)),
    -- the thief, holding the second passkey: removes the root's passkey from the owners, adds a device of their own
    (2, 9, [], .removeOwner 100 (.signer 1) []),
    (3, 9, [555], .addDevice 100 555),
    -- the root removes the second passkey, having seen neither
    (4, 1, [], .removeOwner 100 (.signer 9) [])] },
  { name := "a revoked writer's unseen edits are cut, with what builds on them", ops := humansV ++ [
    (6, 2, [], .foundSpace 12 100),
    (7, 2, [], .write 12 21 100 0),
    (8, 2, [], g 10 (.entry 12 21) .write (toVault 101) 100),
    (9, 2, [], g 11 (.entry 12 21) .write (toVault 102) 100),
    -- Bob's edit Samuel saw, and one he didn't, which Carol builds on
    (10, 5, [], .write 12 21 101 0 [7]),
    (11, 5, [], .write 12 21 101 0 [10]),
    (12, 6, [], .write 12 21 102 0 [11]),
    (13, 2, [], .revoke 10 100 [10]),
    (14, 6, [], .write 12 21 102 0 [10])] },
  { name := "a lost device's back-dated edits are cut", ops := humansV ++ [
    (6, 1, [3], .addDevice 100 3),
    (7, 2, [], .foundSpace 11 100),
    -- an edit from the iPhone the Mac had seen, and one the thief made on an old copy
    (8, 3, [], .write 11 1 100 0),
    (9, 3, [], .write 11 2 100 0),
    (10, 1, [], .removeDevice 100 3 [8])] },
  { name := "handing the root on cuts the old passkey's back-dated ops", ops := [
    (0, 1, [], .genesis 100 .human [.signer 1] 1 (some 1)),
    (1, 1, [9], .addOwner 100 (.signer 9)),
    -- the old passkey, stolen later, adds a device on an old copy
    (2, 1, [555], .addDevice 100 555),
    (3, 1, [9], .setRoot 100 (some 9) [1]),
    (4, 9, [], .removeOwner 100 (.signer 1) [1])] }]

/-! ## JSON -/

def str (s : String) : String := "\"" ++ s ++ "\""
def arr (xs : List String) : String := "[" ++ ", ".intercalate xs ++ "]"
def obj (kvs : List (String × String)) : String := "{" ++ ", ".intercalate (kvs.map fun (k, v) => str k ++ ": " ++ v) ++ "}"
def nat (n : Nat) : String := toString n
def bool (b : Bool) : String := if b then "true" else "false"

def opt (f : α → String) : Option α → String
  | some x => f x
  | none => "null"

def principal : Principal → String
  | .signer s => obj [("signer", nat s)]
  | .vault v  => obj [("vault", nat v)]

def kind : Kind → String
  | .human => str "human"
  | .coop  => str "coop"

def role : Role → String
  | .relay => str "relay"
  | .read  => str "read"
  | .write => str "write"
  | .owner => str "owner"

def scope : Scope → String
  | .space sp   => obj [("space", nat sp)]
  | .entry sp e => obj [("space", nat sp), ("entry", nat e)]

def grantee : Grantee → String
  | .principal p => principal p
  | .«public»    => str "public"

def grant (x : Grant) : String :=
  obj [("id", nat x.id), ("scope", scope x.scope), ("role", role x.role), ("grantee", grantee x.grantee),
       ("issuer", nat x.issuer), ("parent", opt nat x.parent)]

def ids (xs : List Nat) : String := arr (xs.map nat)

def action : Action → String
  | .genesis v k owners t root => obj [("genesis", obj [("vault", nat v), ("kind", kind k),
      ("owners", arr (owners.map principal)), ("threshold", nat t), ("root", opt nat root)])]
  | .addOwner v p => obj [("addOwner", obj [("vault", nat v), ("owner", principal p)])]
  | .removeOwner v p keep => obj [("removeOwner", obj [("vault", nat v), ("owner", principal p), ("keep", ids keep)])]
  | .setThreshold v n => obj [("setThreshold", obj [("vault", nat v), ("threshold", nat n)])]
  | .addDevice v d => obj [("addDevice", obj [("vault", nat v), ("device", nat d)])]
  | .removeDevice v d keep => obj [("removeDevice", obj [("vault", nat v), ("device", nat d), ("keep", ids keep)])]
  | .setRoot v r keep => obj [("setRoot", obj [("vault", nat v), ("root", opt nat r), ("keep", ids keep)])]
  | .foundSpace sp a => obj [("foundSpace", obj [("space", nat sp), ("actor", nat a)])]
  | .grant x => obj [("grant", grant x)]
  | .revoke x a keep => obj [("revoke", obj [("grant", nat x), ("actor", nat a), ("keep", ids keep)])]
  | .write sp e a epoch deps => obj [("write", obj [("space", nat sp), ("entry", nat e), ("actor", nat a),
      ("epoch", nat epoch), ("deps", ids deps)])]

def vault (vt : Vault) : String :=
  obj [("id", nat vt.id), ("kind", kind vt.kind), ("owners", arr (vt.owners.map principal)),
       ("threshold", nat vt.threshold), ("devices", arr (vt.devices.map nat)), ("root", opt nat vt.root)]

def space (x : Space) : String :=
  obj [("id", nat x.id), ("founder", nat x.founder), ("entries", ids x.entries)]

def write (w : Write) : String :=
  obj [("op", nat w.op), ("author", nat w.author), ("actor", nat w.actor), ("space", nat w.space),
       ("entry", nat w.entry), ("epoch", nat w.epoch), ("deps", ids w.deps)]

def state (st : State) : String :=
  str "vaults" ++ ": " ++ arr (st.vaults.map vault) ++ ",\n " ++ str "spaces" ++ ": " ++ arr (st.spaces.map space) ++
    ",\n " ++ str "grants" ++ ": " ++ arr (st.grants.map grant) ++ ",\n " ++ str "writes" ++ ": " ++
    arr (st.writes.map write)

def case (c : Case) : String :=
  let (accepted, st) := run c.ops
  let ops := c.ops.map fun (author, co, a) => obj [("author", nat author), ("cosigners", arr (co.map nat)), ("action", action a)]
  "{" ++ str "name" ++ ": " ++ str c.name ++ ",\n " ++ str "ops" ++ ": [\n  " ++ ",\n  ".intercalate ops ++ "],\n " ++
    str "accepted" ++ ": " ++ arr (accepted.map bool) ++ ",\n " ++ state st ++ "}"

def viewCase (c : ViewCase) : String :=
  let (stood, st) := runView c
  let ops := c.ops.map fun (depth, author, co, a) =>
    obj [("depth", nat depth), ("author", nat author), ("cosigners", arr (co.map nat)), ("action", action a)]
  "{" ++ str "name" ++ ": " ++ str c.name ++ ",\n " ++ str "ops" ++ ": [\n  " ++ ",\n  ".intercalate ops ++ "],\n " ++
    str "standing" ++ ": " ++ arr (stood.map bool) ++ ",\n " ++ state st ++ "}"

def render : String :=
  "{\"cases\": [\n" ++ ",\n".intercalate (cases.map case) ++ "\n],\n\"views\": [\n" ++
    ",\n".intercalate (views.map viewCase) ++ "\n]}\n"

/-- What an op creates, by the model's number: a vault, a space or a grant. -/
def created : Action → Option (Nat × Nat)
  | .genesis v .. => some (0, v)
  | .foundSpace sp _ => some (1, sp)
  | .grant x => some (2, x.id)
  | _ => none

-- every case refuses some ops and accepts others, so neither side can pass by always saying the same thing
#guard cases.all fun c => let (acc, _) := run c.ops; acc.any id && acc.any (!·)
#guard views.all fun c => let (stood, _) := runView c; stood.any id && stood.any (!·)
-- in a view case, every vault, space and grant number is created once, and no two ops share a depth and a rank,
-- so the hashes the Rust core orders by never decide
#guard views.all fun c => nodup (c.ops.filterMap fun (_, _, _, a) => created a)
#guard views.all fun c => nodup (c.toOps.map fun o => (o.depth, o.rank))
-- in a step case, spaces and grants too
#guard cases.all fun c => nodup (c.ops.filterMap fun (_, _, a) => (created a).filter (·.1 != 0))

end VaultSpec.Vectors

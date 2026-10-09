import AvenDB.Step
import AvenDB.Logs
import AvenDB.Lens
import AvenDB.Branches

/-!
# Test vectors for the Rust core

The same cases run here and in `crates/avendb/tests/vectors.rs`. A step case is a list of ops applied one after the other
from the empty state, as every peer applies them once they are in replay order; the model's answer is whether each op
is accepted, and the state at the end. A view case gives each op the depth it claims, as ops made on different
devices do, and the answer is which ops stand in the view (`standing`) and the view itself: that is where removals
cut what they hadn't seen. The Rust core must give the same answer for every case.

`lake build` checks that `vectors/vaults.json` holds exactly what the model says, and fails when it doesn't
(`VectorsCheck.lean`); `lake exe vectors` writes the file again after a change to the rules.

The Rust core names what an op creates (a vault, a space, a grant) by the hash of that op, and orders ops of the same
depth and rank by that hash, where the model picks numbers: the Rust side maps each number to what its op created, so
every number is used once per case and no two ops of a view case share a depth and a rank. A blob is named by the hash
of its bytes: the Rust side maps blob number `b` to the bytes `blob b`. The state includes the key schedule (each
family's epoch where it isn't 0, every seal, and every published key), the schema lane, and each line of each entry's
history: its writes and its heads, the main line first and then each branch in the order it started.

`vectors/lenses.json` holds the lens cases: stored blocks and todos in every shape the lens tells apart, what each app
reads from them (`v1`, `v2`), and what each of a few edits through each app's view stores (`putV1`, `putV2`). The Rust
core must read and write exactly the same.
-/

namespace AvenDB.Vectors

structure Case where
  name : String
  ops  : List (SignerId × List SignerId × Action)

/-- A view case: each op with the depth it claims. A post-quantum case (`pq`) is the view of a peer that no longer
    trusts the curves, which counts only the ops `checkpointed` keeps. -/
structure ViewCase where
  name : String
  ops  : List (Nat × SignerId × List SignerId × Action)
  pq   : Bool := false

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
  let held := if c.pq then checkpointed ops else ops
  let stood := standing held
  (ops.map fun o => stood.any (·.id == o.id), view held)

/-! ## The cases

Signers: Alice's passkey 1, her Mac 2, her iPhone 3, Bob's passkey 4 and Mac 5, Carol's passkey 6 and Mac 7, Dave's
passkey 8, a second passkey 9 (Alice's backup) and a third 10, a new device 77, a stranger 555, the relay server 600.
Vaults: Alice 100, Bob 101, Carol 102, Dave 103 (human vaults), coops from 200, aven vaults from 300 (avenCEO 300).
Spaces: Handbook 10, Notes 11, Todos 12. Entries: Welcome 1, Charter 2, the door todo 21. Blobs (schemas and lenses):
from 1. An act for the coop names the human vault it goes through: Alice's Mac (2) and passkey (1) through `[100]`,
Bob's Mac (5) through `[101]`. -/

def humans : List (SignerId × List SignerId × Action) := [
  (1, [], .genesis 100 .human [.signer 1] 1),
  (1, [2], .addDevice 100 2),
  (4, [], .genesis 101 .human [.signer 4] 1),
  (4, [5], .addDevice 101 5),
  (6, [], .genesis 102 .human [.signer 6] 1),
  (8, [], .genesis 103 .human [.signer 8] 1)]

def g (id : GrantId) (sc : Scope) (r : Role) (to : Grantee) (issuer : VaultId) (parent : Option GrantId := none)
    (via : List VaultId := []) : Action := .grant { id, scope := sc, role := r, grantee := to, issuer, parent } via

def toVault (v : VaultId) : Grantee := .principal (.vault v)

def cases : List Case := [
  { name := "a human vault, its devices and a backup passkey", ops := [
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
    -- a backup passkey joins as a second owner, and later replaces the lost passkey
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
    -- Alice's vault alone is below the threshold; Dave has to consent; devices don't count
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
  { name := "three kinds of vault, and acts that name their chain", ops := humans ++ [
    -- avenCEO, the relay server's aven vault, owned by Alice's human vault; the server joins as its device
    (1, [], .genesis 300 .aven [.vault 100] 1),
    (1, [600], .addDevice 300 600),
    -- the server acts for avenCEO but doesn't govern it; Alice's Mac acts for it through Alice's vault, Bob's Mac not
    (600, [77], .addDevice 300 77),
    (600, [], .foundSpace 13 300),
    (2, [], .foundSpace 14 300 [100]),
    (5, [], .foundSpace 15 300 [101]),
    -- signers own human vaults only, and a human vault no vault
    (1, [], .genesis 301 .aven [.signer 1] 1),
    (1, [4], .genesis 201 .coop [.signer 1, .vault 101] 1),
    (1, [4], .addOwner 100 (.vault 101)),
    -- an aven vault owns no vault, and has no root
    (1, [], .genesis 202 .coop [.vault 300] 1),
    (1, [], .genesis 302 .aven [.vault 300] 1),
    (1, [], .genesis 303 .aven [.vault 100] 1 (some 1)),
    -- the coop: an aven vault can't join its owners, nor a signer, and it has no devices
    (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    (1, [4], .addOwner 200 (.vault 300)),
    (1, [9], .addOwner 200 (.signer 9)),
    (1, [77], .addDevice 200 77),
    -- avenCEO gains Bob's vault as an owner, and an aven vault may be owned by a coop
    (1, [9], .addOwner 300 (.signer 9)),
    (1, [4], .addOwner 300 (.vault 101)),
    (1, [], .genesis 304 .aven [.vault 100, .vault 200] 1),
    -- acts for the coop name the human vault they go through: none, or another person's, is refused
    (2, [], .foundSpace 16 200 [100]),
    (2, [], .foundSpace 17 200),
    (2, [], .foundSpace 18 200 [101]),
    -- a coop of the coop: Bob's Mac acts for it through the coop and Bob's vault, and may skip neither
    (1, [], .genesis 205 .coop [.vault 200] 1),
    (5, [], .foundSpace 19 205 [200, 101]),
    (5, [], .foundSpace 20 205 [101]),
    (5, [], .foundSpace 21 205 [200])] },
  { name := "spaces, grants and Public", ops := humans ++ [
    (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 2),
    -- Alice's Mac founds the Handbook for the coop; Carol's passkey can't found a space for Alice
    (2, [], .foundSpace 10 200 [100]),
    (6, [], .foundSpace 11 100),
    (2, [], .write 10 1 200 0 (via := [100])),
    (2, [], .write 11 1 100 0),
    -- read for Carol's vault, never for a signer; Public only reads
    (2, [], g 1 (.entry 10 1) .read (toVault 102) 200 (via := [100])),
    (2, [], g 2 (.entry 10 1) .read (.principal (.signer 6)) 200 (via := [100])),
    (2, [], g 3 (.entry 10 2) .write .«public» 200 (via := [100])),
    (2, [], g 4 (.entry 10 2) .read .«public» 200 (via := [100])),
    -- making Dave owner of the Handbook is governance: both passkeys of the threshold-2 coop
    (2, [], g 5 (.space 10) .owner (toVault 103) 200 (via := [100])),
    (1, [4], g 6 (.space 10) .owner (toVault 103) 200 (via := [100])),
    -- Dave shares on through his owner grant; without naming it, he isn't the founder
    (8, [], g 7 (.entry 10 1) .write (toVault 102) 103 (some 6)),
    (8, [], g 8 (.entry 10 1) .read (toVault 101) 103),
    -- Bob writes for the coop, not for himself; each edit builds on what was there
    (5, [], .write 10 1 101 0),
    (5, [], .write 10 1 200 0 [9] (via := [101])),
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
    (5, [], g 14 (.entry 12 21) .read (toVault 103) 200 (some 12) [101]),
    (5, [], .write 12 21 101 0 [8]),
    -- Alice takes Bob's own write away, keeping the edit she had seen
    (2, [], .revoke 10 100 [12]),
    (5, [], .write 12 21 101 0 [12]),
    (5, [], .write 12 21 200 0 [12] (via := [101])),
    (2, [], .write 12 21 100 0 [15]),
    -- taking the coop's owner grant away is governance; it ends Dave's read and the coop's edit, which it hadn't
    -- seen, and Alice's edit that builds on it
    (2, [], .revoke 12 100 []),
    (1, [], .revoke 12 100 []),
    (5, [], .write 12 21 200 0 [8] (via := [101])),
    (2, [], .revoke 99 100 []),
    (2, [], .revoke 14 100 [])] },
  { name := "keys go only where the schedule seals them", ops := humans ++ [
    (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 2),
    (2, [], .foundSpace 10 200 [100]),
    (2, [], .write 10 1 200 0 (via := [100])),
    -- Alice's Mac boxes each key to what the schedule seals it to: Welcome's to the Handbook's, the Handbook's to
    -- the coop's, the coop's to its owners', and her vault's to her passkey and her Mac
    (2, [], .keys (.entry 10 1) 0 [.scoped (.space 10) 0]),
    (2, [], .keys (.space 10) 0 [.scoped (.vault 200) 0]),
    (2, [], .keys (.vault 200) 0 [.scoped (.vault 100) 0, .scoped (.vault 101) 0]),
    (2, [], .keys (.vault 100) 0 [.signer 1, .signer 2]),
    -- and nowhere else: not to a device directly, not to Bob's Mac
    (2, [], .keys (.entry 10 1) 0 [.signer 2]),
    (2, [], .keys (.vault 100) 0 [.signer 5]),
    -- only a signer that may open a key boxes it
    (5, [], .keys (.vault 100) 0 []),
    (6, [], .keys (.entry 10 1) 0 []),
    -- no key of an epoch or a family that doesn't exist, and nothing published that isn't public
    (2, [], .keys (.entry 10 1) 1 []),
    (2, [], .keys (.entry 10 9) 0 []),
    (2, [], .keys (.entry 10 1) 0 [] true),
    -- Carol may read Welcome: it is boxed to her vault's key, by Alice's Mac or by Carol's own passkey
    (2, [], g 1 (.entry 10 1) .read (toVault 102) 200 (via := [100])),
    (2, [], .keys (.entry 10 1) 0 [.scoped (.vault 102) 0]),
    (6, [], .keys (.entry 10 1) 0 [.scoped (.vault 102) 0]),
    -- Welcome goes public: its key is published
    (2, [], g 2 (.entry 10 1) .read .«public» 200 (via := [100])),
    (2, [], .keys (.entry 10 1) 0 [] true),
    -- revoking Carol rotates nothing while Welcome is public; making it private again does
    (2, [], .revoke 1 200 [] [100]),
    (2, [], .revoke 2 200 [] [100]),
    (2, [], .keys (.entry 10 1) 1 [.scoped (.space 10) 0]),
    (2, [], .keys (.entry 10 1) 0 [.scoped (.entry 10 1) 1]),
    (6, [], .keys (.entry 10 1) 1 []),
    (2, [], .keys (.entry 10 1) 1 [.scoped (.vault 102) 0])] },
  { name := "the schema lane", ops := humans ++ [
    (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 2),
    (2, [], .foundSpace 10 200 [100]),
    (2, [], .foundSpace 11 100),
    (2, [], g 1 (.space 10) .write (toVault 102) 200 (via := [100])),
    -- Alice's Mac, acting for the coop that founded the Handbook, publishes a schema and a lens into its lane
    (2, [], .publish 10 200 1 [100]),
    (2, [], .publish 10 200 2 [100]),
    -- the same blob again is refused; in another space's lane it is that space's own
    (5, [], .publish 10 200 1 [101]),
    (2, [], .publish 11 100 1),
    -- Carol may write in the Handbook but not publish into its lane, for herself or for the coop, whose owner her vault
    -- isn't; nor may a stranger, and nothing goes into the lane of a space that doesn't exist
    (6, [], .publish 10 102 3),
    (6, [], .publish 10 200 3 [102]),
    (555, [], .publish 10 200 3),
    (2, [], .publish 12 200 3 [100]),
    -- Dave, made owner of the Handbook by both passkeys of the coop, publishes; so does Bob's Mac, for the coop
    (1, [4], g 2 (.space 10) .owner (toVault 103) 200 (via := [100])),
    (8, [], .publish 10 103 3),
    (5, [], .publish 10 200 4 [101])] },
  { name := "a device vouches only for its own writes", ops := humans ++ [
    (2, [], .foundSpace 11 100),
    (1, [3], .addDevice 100 3),
    (2, [], .write 11 1 100 0),
    (2, [], .write 11 2 100 0),
    (3, [], .write 11 1 100 0 [8]),
    -- Alice's Mac vouches for its edit of Welcome, her iPhone for its own
    (2, [], .checkpoint 11 1 [8]),
    (3, [], .checkpoint 11 1 [10]),
    -- not for the other device's edit, nor for an edit of another entry, nor for none at all
    (2, [], .checkpoint 11 1 [8, 10]),
    (3, [], .checkpoint 11 1 [8]),
    (2, [], .checkpoint 11 1 [9]),
    (2, [], .checkpoint 11 2 [9, 99]),
    (2, [], .checkpoint 11 2 []),
    (2, [], .checkpoint 10 2 [9]),
    -- Bob's Mac, a stranger to Notes, can't vouch for Alice's edits
    (5, [], .checkpoint 11 2 [9]),
    (2, [], .checkpoint 11 2 [9])] },
  { name := "branches of an entry", ops := humans ++ [
    (2, [], .foundSpace 10 100),
    (2, [], .write 10 1 100 0),
    (2, [], g 1 (.entry 10 1) .write (toVault 101) 100),
    (2, [], g 2 (.entry 10 1) .read (toVault 102) 100),
    -- Bob's Mac starts a draft of Welcome from its first version and writes on it
    (5, [], .write 10 1 101 0 [7] .new),
    (5, [], .write 10 1 101 0 [10] (.on 10)),
    -- a reader can't start a branch, nor can a stranger
    (6, [], .write 10 1 102 0 [7] .new),
    (555, [], .write 10 1 101 0 [7] .new),
    -- a write on a branch builds on it: not on main alone, not on a write that didn't start one, not on a branch that
    -- doesn't exist or is another entry's
    (2, [], .write 10 1 100 0 [7] (.on 10)),
    (2, [], .write 10 1 100 0 [11] (.on 11)),
    (2, [], .write 10 1 100 0 [7] (.on 99)),
    (2, [], .write 10 2 100 0),
    (2, [], .write 10 2 100 0 [17] (.on 10)),
    -- Alice merges the draft: a write on main that builds on both heads
    (2, [], .write 10 1 100 0 [7, 11]),
    -- Bob carries on with the draft and brings main into it
    (5, [], .write 10 1 101 0 [11] (.on 10)),
    (5, [], .write 10 1 101 0 [19, 20] (.on 10)),
    -- Alice's Mac starts a branch of its own from the merge, and Bob writes on it
    (2, [], .write 10 1 100 0 [19] .new),
    (5, [], .write 10 1 101 0 [22] (.on 22))] }]

/-- Alice's, Bob's, Carol's and Dave's vaults, one op per depth. -/
def humansV : List (Nat × SignerId × List SignerId × Action) := humans.zipIdx.map fun ((a, co, act), i) => (i, a, co, act)

def views : List ViewCase := [
  { name := "a removed owner can't back-date governance", ops := humansV ++ [
    (6, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    -- Bob, offline since the coop began, adds Dave
    (7, 4, [8], .addOwner 200 (.vault 103)),
    (8, 1, [], .setThreshold 200 1),
    -- Alice removes Bob, not having seen the add
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
    -- Bob's removal of Alice sorts first, Alice's of Bob stands
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
    -- Bob's edit Alice saw, and one she didn't, which Carol builds on
    (10, 5, [], .write 12 21 101 0 [7]),
    (11, 5, [], .write 12 21 101 0 [10]),
    (12, 6, [], .write 12 21 102 0 [11]),
    (13, 2, [], .revoke 10 100 [10]),
    (14, 6, [], .write 12 21 102 0 [10])] },
  { name := "a revocation cuts a branch it hadn't seen, with every write on it", ops := humansV ++ [
    (6, 2, [], .foundSpace 12 100),
    (7, 2, [], .write 12 21 100 0),
    (8, 2, [], g 10 (.entry 12 21) .write (toVault 101) 100),
    (9, 2, [], g 11 (.entry 12 21) .write (toVault 102) 100),
    -- Bob's Mac starts a draft Alice sees, and another on an old copy, which she doesn't; Carol writes on the second
    (10, 5, [], .write 12 21 101 0 [7] .new),
    (11, 5, [], .write 12 21 101 0 [10] (.on 10)),
    (12, 5, [], .write 12 21 101 0 [7] .new),
    (13, 6, [], .write 12 21 102 0 [12] (.on 12)),
    (14, 2, [], .revoke 10 100 [10, 11]),
    -- Alice merges the draft she saw; Carol's merge of the other goes with it
    (15, 2, [], .write 12 21 100 0 [7, 11]),
    (16, 6, [], .write 12 21 102 0 [15, 13])] },
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
    (4, 9, [], .removeOwner 100 (.signer 1) [1])] },
  { name := "a revoked reader's back-dated keys are cut", ops := humansV ++ [
    (6, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    (7, 2, [], .foundSpace 10 200 [100]),
    (8, 2, [], .write 10 1 200 0 (via := [100])),
    (9, 2, [], g 1 (.entry 10 1) .read (toVault 102) 200 (via := [100])),
    -- Carol's passkey boxes Welcome's key twice; Alice revokes Carol's read having seen only the first
    (10, 6, [], .keys (.entry 10 1) 0 [.scoped (.vault 102) 0]),
    (11, 6, [], .keys (.entry 10 1) 0 [.scoped (.space 10) 0]),
    (12, 2, [], .revoke 1 200 [10] [100])] },
  { name := "a removed owner's back-dated publish is cut", ops := humansV ++ [
    (6, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    (7, 2, [], .foundSpace 10 200 [100]),
    -- Bob's Mac publishes a schema for the coop, which Alice sees, and a lens on an old copy, which she doesn't
    (8, 5, [], .publish 10 200 1 [101]),
    (9, 5, [], .publish 10 200 2 [101]),
    (10, 1, [], .removeOwner 200 (.vault 101) [8]),
    -- Alice's Mac publishes the lens itself; Bob's Mac no longer can
    (11, 2, [], .publish 10 200 2 [100]),
    (12, 5, [], .publish 10 200 3 [101])] },
  { name := "a removed owner's back-dated writes for the coop are cut", ops := humansV ++ [
    (6, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    (7, 2, [], .foundSpace 10 200 [100]),
    -- Bob's Mac writes for the coop through Bob's vault: an edit Alice sees, and one on an old copy, which she doesn't
    (8, 5, [], .write 10 1 200 0 (via := [101])),
    (9, 5, [], .write 10 2 200 0 (via := [101])),
    (10, 1, [], .removeOwner 200 (.vault 101) [8]),
    -- Alice's Mac writes on; Bob's Mac no longer can
    (11, 2, [], .write 10 1 200 0 [8] (via := [100])),
    (12, 5, [], .write 10 1 200 0 [11] (via := [101]))] },
  { name := "once the curves fall, only vouched writes count", pq := true, ops := humansV ++ [
    (6, 2, [], .foundSpace 11 100),
    (7, 1, [3], .addDevice 100 3),
    -- Alice's Mac edits Welcome and vouches for it; it vouches for its second edit of the Charter but not the
    -- first, which the second builds on, so neither counts
    (8, 2, [], .write 11 1 100 0),
    (9, 2, [], .write 11 2 100 0),
    (10, 2, [], .write 11 2 100 0 [9]),
    (11, 2, [], .checkpoint 11 1 [8]),
    (12, 2, [], .checkpoint 11 2 [10]),
    -- the iPhone's edit is vouched for by the iPhone; a forger who broke the Mac's curve signs an edit as the Mac,
    -- and can't vouch for it; nor can the iPhone vouch for it
    (13, 3, [], .write 11 1 100 0 [8]),
    (14, 3, [], .checkpoint 11 1 [13]),
    (15, 2, [], .write 11 1 100 0 [13]),
    (16, 3, [], .checkpoint 11 1 [15])] },
  { name := "the senior revoker ranks first", ops := humansV ++ [
    (6, 2, [], .foundSpace 11 100),
    (7, 1, [], g 30 (.space 11) .owner (toVault 103) 100),
    (8, 8, [], g 31 (.space 11) .read (toVault 102) 103 (some 30)),
    (9, 2, [], .write 11 1 100 0),
    -- Alice revokes Dave's owner grant; Dave revokes the read he gave Carol on a copy that hadn't seen it, so his
    -- revocation sorts first, and falls with the grant it rested on
    (11, 1, [], .revoke 30 100 [6, 7, 8, 9]),
    (10, 8, [], .revoke 31 103 [])] },
  { name := "a vault settles before the coops it owns", ops := humansV ++ [
    (6, 1, [9], .addOwner 100 (.signer 9)),
    (7, 1, [10], .addOwner 100 (.signer 10)),
    (8, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    -- the second passkey removes Bob from the coop on a copy that hadn't seen the third remove it from Alice's vault
    (9, 9, [], .removeOwner 200 (.vault 101) []),
    (10, 10, [], .removeOwner 100 (.signer 9) [6, 7, 8])] }]

/-! ## Sync cases

A sync case is a list of ops a peer holds, each building on the frontier of its own log among the ops before it, as a
device holding them all would build, unless it names other parents or claims another depth. The model's answers:
which ops stand; each log's closed part and frontier; the forks; and for each device that asks, holding some of the
ops, a peer holding all of them or some: the device's frontier of each log it holds, what it sends of it when it asks
and its loose ops (`asks`), what the peer would send it whole (`respond`), and what it sends given what the device
sent (`respondSince`). A parent no op of the case has (999) stands for an op nobody holds. -/

/-- An op of a sync case. -/
structure SyncOp where
  author    : SignerId
  cosigners : List SignerId := []
  action    : Action
  /-- The ops of its log it builds on, by place; `none` for the frontier of its log among the ops before it. -/
  parents   : Option (List Nat) := none
  /-- The depth it claims; `none` for its place. -/
  depth     : Option Nat := none

structure SyncCase where
  name : String
  ops  : List SyncOp
  /-- Who asks: a device, the places of the ops it holds, and those of the ops the peer holds (`none`: all). -/
  asks : List (SignerId × List Nat × Option (List Nat))
  /-- The passkeys that prove themselves to a peer holding every op, to link a new device (`linkCard`). -/
  links : List SignerId := []

def SyncCase.toOps (c : SyncCase) : List Op :=
  c.ops.zipIdx.foldl (fun acc (o, i) =>
    let op : Op :=
      { id := i, depth := o.depth.getD i, author := o.author, cosigners := o.cosigners, action := o.action }
    let parents := o.parents.getD (match op.log? acc with
      | some l => frontiers acc l
      | none => [])
    acc ++ [{ op with parents }]) []

def plain (ops : List (SignerId × List SignerId × Action)) : List SyncOp :=
  ops.map fun (author, cosigners, action) => { author, cosigners, action }

/-- The ops of a case at the places `held`. -/
def heldOps (ops : List Op) (held : List Nat) : List Op := ops.filter (held.contains ·.id)

/-- The ops the peer holds: those at the places `peer`, or all of them. -/
def peerOps (ops : List Op) : Option (List Nat) → List Op
  | some ps => heldOps ops ps
  | none => ops

def syncs : List SyncCase := [
  { name := "an item by caps, by frontiers", ops := plain (humans ++ [
      (6, [7], .addDevice 102 7),
      (1, [3], .addDevice 100 3),
      (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
      -- the coop's Handbook: Welcome and the Charter, Carol reads Welcome, Bob edits it
      (2, [], .foundSpace 10 200 [100]),
      (2, [], .write 10 1 200 0 (via := [100])),
      (2, [], .write 10 2 200 0 (via := [100])),
      (2, [], g 30 (.entry 10 1) .read (toVault 102) 200 (via := [100])),
      (5, [], .write 10 1 200 0 [10] (via := [101])),
      (2, [], .checkpoint 10 1 [10]),
      (2, [], .write 10 2 200 0 [11] (via := [100])),
      (2, [], .publish 10 200 1 [100]),
      -- Alice's own Notes
      (2, [], .foundSpace 11 100),
      (2, [], .write 11 1 100 0)]),
    asks := [
      -- Carol's Mac holding nothing yet, then after a sync before Bob's edit, then holding Bob's edit without its past
      (7, [], none),
      (7, [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 12], none),
      (7, [4, 6, 13], none),
      -- Bob's Mac before most of the Handbook, a stranger, and Alice's iPhone holding everything
      (5, [0, 1, 2, 3, 4, 5, 8, 9, 10], none),
      (555, [], none),
      (3, List.range 19, none)] },
  { name := "forks", ops := plain (humans ++ [
      (1, [3], .addDevice 100 3),
      (2, [], .foundSpace 11 100),
      (2, [], .write 11 1 100 0),
      (2, [], .write 11 1 100 0 [8])]) ++ [
      -- Alice's Mac again from the same past, as a copy restored from an old backup would: a fork
      { author := 2, action := .write 11 1 100 0 [8], parents := some [8] },
      -- her iPhone at the same moment: another device, no fork
      { author := 3, action := .write 11 1 100 0 [8], parents := some [8] },
      -- her passkey on two devices at once: a passkey isn't checked
      { author := 1, cosigners := [77], action := .addDevice 100 77 },
      { author := 1, action := .setThreshold 100 1, parents := some [6] },
      -- the Mac building on an op nobody holds: outside the closed part, so neither in the frontier nor a fork
      { author := 2, action := .write 11 1 100 0 [8], parents := some [999] },
      -- the iPhone claiming to be no deeper than the op it builds on: malformed, so it never stands
      { author := 3, action := .write 11 1 100 0 [11], parents := some [11], depth := some 11 }],
    asks := [(3, [0, 1, 2, 3, 4, 5, 6, 7, 8, 11], none), (2, [], none)] },
  { name := "a revocation joins its grant's log", ops := plain (humans ++ [
      (6, [7], .addDevice 102 7),
      (2, [], .foundSpace 12 100),
      (2, [], .write 12 21 100 0),
      (2, [], g 30 (.entry 12 21) .read (toVault 102) 100),
      (2, [], .write 12 22 100 0),
      -- Alice revokes Carol's read: Carol hears of it, and of nothing else about the todo
      (2, [], .revoke 30 100 [8, 9]),
      (2, [], .write 12 21 100 0 [8])]),
    asks := [(7, [0, 1, 4, 6, 7, 8, 9], none), (7, [], none), (5, [2, 3], none),
      -- Carol holding the revocation but not the grant it revokes: it is loose, and isn't sent again
      (7, [0, 1, 4, 6, 7, 8, 11], none)] },
  { name := "a device ahead of its peer", ops := plain (humans ++ [
      (1, [3], .addDevice 100 3),
      (2, [], .foundSpace 11 100)] ++
      -- Alice's Mac edits her note seventeen times
      List.replicate 17 (2, [], .write 11 1 100 0)) ++ [
      -- her iPhone edits it once, having seen the first twelve
      { author := 3, action := .write 11 1 100 0, parents := some [19] }],
    asks := [
      -- the Mac asks the iPhone: each lacks some of the other's edits; then an iPhone holding none of its own
      (2, List.range 25, some (List.range 20 ++ [25])),
      (2, List.range 25, some (List.range 20)),
      -- the iPhone, behind, asks a peer holding all of them
      (3, List.range 13, none)] },
  { name := "linking a device by its passkey", ops := plain (humans ++ [
      (1, [3], .addDevice 100 3),
      -- Alice's backup passkey, a second owner of her vault
      (1, [9], .addOwner 100 (.signer 9)),
      (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
      (2, [], .foundSpace 10 200 [100]),
      (2, [], .write 10 1 200 0 (via := [100])),
      (2, [], g 30 (.space 10) .read (toVault 102) 200 (via := [100]))]),
    asks := [(3, [], none)],
    -- Alice's passkey, her backup passkey, Bob's and Carol's, Alice's Mac (a device, no passkey), and a stranger's
    links := [1, 9, 4, 6, 2, 555] }]

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
  | .aven  => str "aven"

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

def keyScope : KeyScope → String
  | .vault v    => obj [("vault", nat v)]
  | .space sp   => obj [("space", nat sp)]
  | .entry sp e => obj [("space", nat sp), ("entry", nat e)]

def keyName : KeyName → String
  | .signer s   => obj [("signer", nat s)]
  | .scoped k e => obj [("key", keyScope k), ("epoch", nat e)]

def branch : Branch → String
  | .main => str "main"
  | .new  => str "new"
  | .on b => obj [("on", nat b)]

def action : Action → String
  | .genesis v k owners t root => obj [("genesis", obj [("vault", nat v), ("kind", kind k),
      ("owners", arr (owners.map principal)), ("threshold", nat t), ("root", opt nat root)])]
  | .addOwner v p => obj [("addOwner", obj [("vault", nat v), ("owner", principal p)])]
  | .removeOwner v p keep => obj [("removeOwner", obj [("vault", nat v), ("owner", principal p), ("keep", ids keep)])]
  | .setThreshold v n => obj [("setThreshold", obj [("vault", nat v), ("threshold", nat n)])]
  | .addDevice v d => obj [("addDevice", obj [("vault", nat v), ("device", nat d)])]
  | .removeDevice v d keep => obj [("removeDevice", obj [("vault", nat v), ("device", nat d), ("keep", ids keep)])]
  | .setRoot v r keep => obj [("setRoot", obj [("vault", nat v), ("root", opt nat r), ("keep", ids keep)])]
  | .foundSpace sp a via => obj [("foundSpace", obj [("space", nat sp), ("actor", nat a), ("via", ids via)])]
  | .grant x via => obj [("grant", obj [("grant", grant x), ("via", ids via)])]
  | .revoke x a keep via => obj [("revoke", obj [("grant", nat x), ("actor", nat a), ("keep", ids keep),
      ("via", ids via)])]
  | .write sp e a epoch deps b via => obj [("write", obj [("space", nat sp), ("entry", nat e), ("actor", nat a),
      ("epoch", nat epoch), ("deps", ids deps), ("branch", branch b), ("via", ids via)])]
  | .keys k epoch to pub => obj [("keys", obj [("key", keyScope k), ("epoch", nat epoch),
      ("to", arr (to.map keyName)), ("public", bool pub)])]
  | .publish sp a b via => obj [("publish", obj [("space", nat sp), ("actor", nat a), ("blob", nat b),
      ("via", ids via)])]
  | .checkpoint sp e covers => obj [("checkpoint", obj [("space", nat sp), ("entry", nat e), ("covers", ids covers)])]

def vault (vt : Vault) : String :=
  obj [("id", nat vt.id), ("kind", kind vt.kind), ("owners", arr (vt.owners.map principal)),
       ("threshold", nat vt.threshold), ("devices", arr (vt.devices.map nat)), ("root", opt nat vt.root)]

def space (x : Space) : String :=
  obj [("id", nat x.id), ("founder", nat x.founder), ("entries", ids x.entries)]

def write (w : Write) : String :=
  obj [("op", nat w.op), ("author", nat w.author), ("actor", nat w.actor), ("space", nat w.space),
       ("entry", nat w.entry), ("epoch", nat w.epoch), ("deps", ids w.deps), ("branch", branch w.branch),
       ("via", ids w.via)]

/-- Each family's epoch, where it isn't 0, in the order the families came to be. -/
def epochs (st : State) : String :=
  arr ((keyScopes st).filterMap fun k =>
    if st.epochOf k == 0 then none else some (obj [("key", keyScope k), ("epoch", nat (st.epochOf k))]))

def sealed (x : Seal) : String := obj [("secret", keyName x.secret), ("to", keyName x.to)]

/-- Each line of each entry, the main line first and then each branch in the order it started: its history and its
    heads. -/
def lines (st : State) : String :=
  arr (st.spaces.flatMap fun x => x.entries.flatMap fun e =>
    let starts := st.writes.filterMap fun w =>
      if w.space == x.id && w.entry == e && w.branch == .new then some w.op else none
    (none :: starts.map some).map fun l =>
      obj [("space", nat x.id), ("entry", nat e), ("line", opt nat l),
           ("history", ids ((history st.writes x.id e l).map (·.op))), ("heads", ids (heads st.writes x.id e l))])

def state (st : State) : String :=
  str "vaults" ++ ": " ++ arr (st.vaults.map vault) ++ ",\n " ++ str "spaces" ++ ": " ++ arr (st.spaces.map space) ++
    ",\n " ++ str "grants" ++ ": " ++ arr (st.grants.map grant) ++ ",\n " ++ str "writes" ++ ": " ++
    arr (st.writes.map write) ++ ",\n " ++ str "epochs" ++ ": " ++ epochs st ++ ",\n " ++ str "seals" ++ ": " ++
    arr (st.seals.map sealed) ++ ",\n " ++ str "published" ++ ": " ++ arr (st.published.map keyName) ++ ",\n " ++
    str "lane" ++ ": " ++ arr (st.lane.map fun (sp, b) => obj [("space", nat sp), ("blob", nat b)]) ++ ",\n " ++
    str "lines" ++ ": " ++ lines st

def case (c : Case) : String :=
  let (accepted, st) := run c.ops
  let ops := c.ops.map fun (author, co, a) => obj [("author", nat author), ("cosigners", arr (co.map nat)), ("action", action a)]
  "{" ++ str "name" ++ ": " ++ str c.name ++ ",\n " ++ str "ops" ++ ": [\n  " ++ ",\n  ".intercalate ops ++ "],\n " ++
    str "accepted" ++ ": " ++ arr (accepted.map bool) ++ ",\n " ++ state st ++ "}"

def viewCase (c : ViewCase) : String :=
  let (stood, st) := runView c
  let ops := c.ops.map fun (depth, author, co, a) =>
    obj [("depth", nat depth), ("author", nat author), ("cosigners", arr (co.map nat)), ("action", action a)]
  "{" ++ str "name" ++ ": " ++ str c.name ++ ",\n " ++ str "pq" ++ ": " ++ bool c.pq ++ ",\n " ++ str "ops" ++ ": [\n  " ++
    ",\n  ".intercalate ops ++ "],\n " ++ str "standing" ++ ": " ++ arr (stood.map bool) ++ ",\n " ++ state st ++ "}"

def logId : LogId → String
  | .vault v    => obj [("vault", nat v)]
  | .space sp   => obj [("space", nat sp)]
  | .entry sp e => obj [("space", nat sp), ("entry", nat e)]

def syncCase (c : SyncCase) : String :=
  let ops := c.toOps
  let stood := standing ops
  let opJson := ops.map fun o => obj [("depth", nat o.depth), ("author", nat o.author),
    ("cosigners", arr (o.cosigners.map nat)), ("action", action o.action), ("parents", ids o.parents)]
  let logs := (logsOf ops).map fun l => obj [("log", logId l),
    ("closed", ids ((closedPart (Op.log? ops) ops l).map (·.id))), ("frontier", ids (frontiers ops l))]
  let asks := c.asks.map fun (d, held, peer) =>
    let (h, p) := (heldOps ops held, peerOps ops peer)
    let sent := (logsOf h).map fun l => obj [("log", logId l), ("frontier", ids (frontiers h l)),
      ("haves", ids ((asks h).haves l))]
    obj [("device", nat d), ("held", ids held), ("peer", opt ids peer), ("logs", arr sent), ("loose", ids (loose h)),
         ("respond", ids ((respond p d).map (·.id))), ("since", ids ((respondSince p d (asks h)).map (·.id)))]
  let links := c.links.map fun p => obj [("passkey", nat p), ("card", ids ((linkCard ops p).map (·.id)))]
  "{" ++ str "name" ++ ": " ++ str c.name ++ ",\n " ++ str "ops" ++ ": [\n  " ++ ",\n  ".intercalate opJson ++
    "],\n " ++ str "standing" ++ ": " ++ arr (ops.map fun o => bool (stood.any (·.id == o.id))) ++ ",\n " ++
    str "logs" ++ ": [\n  " ++ ",\n  ".intercalate logs ++ "],\n " ++ str "forks" ++ ": " ++
    arr ((allForks ops).map fun (a, b) => ids [a, b]) ++ ",\n " ++ str "asks" ++ ": [\n  " ++
    ",\n  ".intercalate asks ++ "],\n " ++ str "links" ++ ": " ++ arr links ++ "}"

def render : String :=
  "{\"cases\": [\n" ++ ",\n".intercalate (cases.map case) ++ "\n],\n\"views\": [\n" ++
    ",\n".intercalate (views.map viewCase) ++ "\n],\n\"syncs\": [\n" ++ ",\n".intercalate (syncs.map syncCase) ++
    "\n]}\n"

/-- What an op creates, by the model's number: a vault, a space or a grant. -/
def created : Action → Option (Nat × Nat)
  | .genesis v .. => some (0, v)
  | .foundSpace sp _ _ => some (1, sp)
  | .grant x _ => some (2, x.id)
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
-- a post-quantum case drops some writes that would stand in the full view, so the Rust core must drop them too
#guard views.all fun c => !c.pq || (runView c).1 != (runView { c with pq := false }).1
-- in a sync case, every vault, space and grant number is created once, an op builds only on ops before it or on one
-- nobody holds, and no two ops in the replay order share a depth and a rank
#guard syncs.all fun c => nodup (c.ops.filterMap fun o => created o.action)
#guard syncs.all fun c => c.toOps.all fun o => o.parents.all fun p => p < o.id || p ≥ c.ops.length
#guard syncs.all fun c => nodup ((order c.toOps).map fun o => (o.depth, o.rank))
-- what a device is sent when it asks is part of what it would be sent whole, and with what it held covers all of it
-- (T12, T19)
#guard syncs.all fun c => let ops := c.toOps; c.asks.all fun (d, held, peer) =>
  let (h, p) := (heldOps ops held, peerOps ops peer)
  let s := respondSince p d (asks h)
  s.all (respond p d).contains && (respond p d).all fun o => h.contains o || s.contains o
-- asking leaves something out, the ops further back leave out more than the frontiers alone and the loose ops more
-- than without them, some device is sent nothing new, some op is outside its log's closed part, some op is malformed,
-- and there is a fork
#guard syncs.any fun c => let ops := c.toOps; c.asks.any fun (d, held, peer) =>
  let p := peerOps ops peer
  (respondSince p d (asks (heldOps ops held))).length < (respond p d).length
#guard syncs.any fun c => let ops := c.toOps; c.asks.any fun (d, held, peer) =>
  let (h, p) := (heldOps ops held, peerOps ops peer)
  (respondSince p d (asks h)).length < (respondSince p d ⟨frontiers h, loose h⟩).length
#guard syncs.any fun c => let ops := c.toOps; c.asks.any fun (d, held, peer) =>
  let (h, p) := (heldOps ops held, peerOps ops peer)
  (respondSince p d (asks h)).length < (respondSince p d ⟨(asks h).haves, []⟩).length
#guard syncs.any fun c => let ops := c.toOps; c.asks.any fun (d, held, peer) =>
  let p := peerOps ops peer
  (respondSince p d (asks (heldOps ops held))).isEmpty && !(respond p d).isEmpty
#guard syncs.any fun c => let ops := c.toOps; (logsOf ops).any fun l =>
  (closedPart (Op.log? ops) ops l).length < (inLog (Op.log? ops) ops l).length
#guard syncs.any fun c => (order c.toOps).length < c.ops.length
#guard syncs.any fun c => !(allForks c.toOps).isEmpty
-- a passkey that owns a vault is handed its log, one that owns none nothing, and the card holds no write (T20)
#guard syncs.any fun c => c.links.any fun p => !(linkCard c.toOps p).isEmpty
#guard syncs.any fun c => c.links.any fun p => (linkCard c.toOps p).isEmpty
#guard syncs.all fun c => c.links.all fun p => (linkCard c.toOps p).all fun o => o.item?.isNone

/-! ## The lens cases

Stored blocks in every shape the lens tells apart: v1's kind or none; v2's type and level or none, among them a
heading of a level v1 can't say and a level without a type, which neither app can read; checked or not; a language or
not. A v1 app edits each to every kind and to a new text, keeping the kind it reads (a paragraph when it reads none).
A v2 app edits each to every type, keeping the `checked` and `lang` it reads (none when it reads no block), and flips
`checked` and sets a new language, keeping the type it reads (a paragraph when it reads none). Todos have `done`,
`status` and a due date, each stored or not; a v1 app sets `done` either way and edits the notes, a v2 app sets each
status and edits the title. -/

open Lens

def kindV1 : KindV1 → String
  | .h1 => str "h1"
  | .h2 => str "h2"
  | .h3 => str "h3"
  | .p => str "p"
  | .li => str "li"
  | .code => str "code"

def typeV2 : TypeV2 → String
  | .heading => str "heading"
  | .paragraph => str "paragraph"
  | .item => str "item"
  | .code => str "code"

def status : Status → String
  | .«open» => str "open"
  | .doing => str "doing"
  | .done => str "done"

def storedBlock (b : StoredBlock) : String :=
  obj [("id", nat b.id), ("text", str b.text), ("kind", opt kindV1 b.kind), ("type", opt typeV2 b.type),
       ("level", opt nat b.level), ("checked", opt bool b.checked), ("lang", opt str b.lang)]

def blockV1 (b : BlockV1) : String := obj [("id", nat b.id), ("kind", kindV1 b.kind), ("text", str b.text)]

def blockV2 (b : BlockV2) : String :=
  obj [("id", nat b.id), ("type", typeV2 b.type), ("level", opt nat b.level), ("checked", opt bool b.checked),
       ("lang", opt str b.lang), ("text", str b.text)]

def storedTodo (t : StoredTodo) : String :=
  obj [("title", str t.title), ("notes", str t.notes), ("due", opt str t.due), ("done", opt bool t.done),
       ("status", opt status t.status)]

def todoV1 (t : TodoV1) : String :=
  obj [("title", str t.title), ("done", bool t.done), ("notes", str t.notes), ("due", opt str t.due)]

def todoV2 (t : TodoV2) : String :=
  obj [("title", str t.title), ("status", status t.status), ("notes", str t.notes), ("due", opt str t.due)]

def kinds : List KindV1 := [.h1, .h2, .h3, .p, .li, .code]

/-- Each type with the level v1's kinds give it. -/
def types : List (TypeV2 × Option Nat) :=
  [(.heading, some 1), (.heading, some 2), (.heading, some 3), (.paragraph, none), (.item, none), (.code, none)]

def storedBlocks : List StoredBlock :=
  let reps : List (Option TypeV2 × Option Nat) := [(none, none), (some .heading, some 1), (some .heading, some 2),
    (some .heading, some 3), (some .heading, some 4), (some .paragraph, none), (some .item, none),
    (some .code, none), (none, some 2)]
  let shapes := (none :: kinds.map some).flatMap fun k => reps.flatMap fun (t, l) =>
    [none, some true].flatMap fun c => [none, some "sh"].map fun lang => (k, t, l, c, lang)
  (shapes.zipIdx 1).map fun ((k, t, l, c, lang), i) =>
    { id := i, text := "Seeds", kind := k, type := t, level := l, checked := c, lang := lang }

def v1Views (b : StoredBlock) : List BlockV1 :=
  kinds.map (fun k => ⟨b.id, k, b.text⟩) ++ [⟨b.id, (b.v1.map (·.kind)).getD .p, "Seeds, sown"⟩]

def v2Views (b : StoredBlock) : List BlockV2 :=
  let old := b.v2.getD ⟨b.id, .paragraph, none, none, none, b.text⟩
  types.map (fun (t, l) => { old with type := t, level := l }) ++
    [{ old with checked := some !(old.checked.getD false), lang := some "py" }]

def storedTodos : List StoredTodo :=
  [none, some false, some true].flatMap fun done =>
    [none, some .«open», some .doing, some .done].flatMap fun status =>
      [none, some "2026-10-10"].map fun due =>
        { title := "Fix the door", notes := "The hinge squeaks", due, done, status }

def todoV1Views (t : StoredTodo) : List TodoV1 :=
  [{ t.v1 with done := false }, { t.v1 with done := true }, { t.v1 with notes := "Oil the hinge" }]

def todoV2Views (t : StoredTodo) : List TodoV2 :=
  [Status.«open», .doing, .done].map (fun s => { t.v2 with status := s }) ++
    [{ t.v2 with title := "Fix the shed door" }]

def puts (views : List String) : String := "[\n  " ++ ",\n  ".intercalate views ++ "]"

def blockCase (b : StoredBlock) : String :=
  let p1 := (v1Views b).map fun v => obj [("view", blockV1 v), ("stored", storedBlock (b.putV1 v))]
  let p2 := (v2Views b).map fun v => obj [("view", blockV2 v), ("stored", storedBlock (b.putV2 v))]
  "{" ++ str "stored" ++ ": " ++ storedBlock b ++ ",\n " ++ str "v1" ++ ": " ++ opt blockV1 b.v1 ++ ", " ++
    str "v2" ++ ": " ++ opt blockV2 b.v2 ++ ",\n " ++ str "putV1" ++ ": " ++ puts p1 ++ ",\n " ++ str "putV2" ++
    ": " ++ puts p2 ++ "}"

def todoCase (t : StoredTodo) : String :=
  let p1 := (todoV1Views t).map fun v => obj [("view", todoV1 v), ("stored", storedTodo (t.putV1 v))]
  let p2 := (todoV2Views t).map fun v => obj [("view", todoV2 v), ("stored", storedTodo (t.putV2 v))]
  "{" ++ str "stored" ++ ": " ++ storedTodo t ++ ",\n " ++ str "v1" ++ ": " ++ todoV1 t.v1 ++ ", " ++ str "v2" ++
    ": " ++ todoV2 t.v2 ++ ",\n " ++ str "putV1" ++ ": " ++ puts p1 ++ ",\n " ++ str "putV2" ++ ": " ++ puts p2 ++
    "}"

def renderLenses : String :=
  "{\"blocks\": [\n" ++ ",\n".intercalate (storedBlocks.map blockCase) ++ "\n],\n\"todos\": [\n" ++
    ",\n".intercalate (storedTodos.map todoCase) ++ "\n]}\n"

-- every way a put writes is taken by some case, so neither side can pass while skipping one: a v1 edit's new kind as
-- v2's fields and as `kind`, a v2 edit's new type dropping `kind`, a v1 edit's `done` as the status and as `done`, a
-- v2 edit's status dropping `done`; and some edits write nothing at all
#guard storedBlocks.any fun b => (v1Views b).any fun v => (b.putV1 v).type != b.type && (b.putV1 v).kind == b.kind
#guard storedBlocks.any fun b => (v1Views b).any fun v => (b.putV1 v).kind != b.kind
#guard storedBlocks.any fun b => (v2Views b).any fun v => (b.putV2 v).kind != b.kind
#guard storedTodos.any fun t => (todoV1Views t).any fun v => (t.putV1 v).status != t.status
#guard storedTodos.any fun t => (todoV1Views t).any fun v => (t.putV1 v).done != t.done
#guard storedTodos.any fun t => (todoV2Views t).any fun v => (t.putV2 v).done != t.done
#guard storedBlocks.any (fun b => (v1Views b).any (b.putV1 · == b) && (v2Views b).any (b.putV2 · == b)) &&
  storedTodos.any fun t => (todoV1Views t).any (t.putV1 · == t) && (todoV2Views t).any (t.putV2 · == t)

end AvenDB.Vectors

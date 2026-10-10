import AvenDB.Step
import AvenDB.Logs
import AvenDB.Lens
import AvenDB.Proposals

/-!
# Test vectors for the Rust core

The same cases run here and in `crates/avendb/tests/vectors.rs`. A step case is a list of edits applied one after the
other from the empty state, as every peer applies them once they are in replay order; the model's answer is whether each
edit is accepted, and the state at the end. A view case gives each edit the depth it claims, as edits made on different
devices do, and the answer is which edits stand in the view (`standing`) and the view itself: that is where removals
cut what they hadn't seen. The Rust core must give the same answer for every case.

`lake build` checks that `vectors/vaults.json` holds exactly what the model says, and fails when it doesn't
(`VectorsCheck.lean`); `lake exe vectors` writes the file again after a change to the rules.

The Rust core names a vault and a cap by the hash of the edit that created it, and orders edits of the same depth and
rank by their hashes, where the model picks numbers: the Rust side maps each number to what its edit created, so every
cap number is used once per case, every vault number once per view and sync case, and no two edits of a view case share
a depth and a rank. An entry's id is random bytes its creator draws: the Rust side maps entry number `e` to fixed bytes.
A cell is a set of caps, which the model keeps sorted by number and the Rust core by id, so every cell a case names is in
the model's order (a cell in another order is refused by the model and could be taken by the Rust core), and the Rust
side compares the cells of the state as sets. A blob is named by the hash of its bytes: the Rust side maps blob number
`b` to the bytes `blob b`. The state includes each entry's stays and, as its readers see it, its attributes, whether its
creation was let in, its semantic cell and where a steward would move it; the key schedule (each family's epoch where it
isn't 0, every seal and every published key, all three compared as sets); the schema lane; and each line of each entry's
history: its writes and its heads, the main line first and then each proposal in the order it started.

`vectors/lenses.json` holds the lens cases: stored blocks and todos in every shape the lens tells apart, what each app
reads from them (`v1`, `v2`), and what each of a few edits through each app's view stores (`putV1`, `putV2`). The Rust
core must read and write exactly the same.
-/

namespace AvenDB.Vectors

structure Case where
  name  : String
  edits : List (SignerId × List SignerId × Action)

/-- A view case: each edit with the depth it claims. A post-quantum case (`pq`) is the view of a peer that no longer
    trusts the curves, which counts only the edits `checkpointed` keeps. -/
structure ViewCase where
  name  : String
  edits : List (Nat × SignerId × List SignerId × Action)
  pq    : Bool := false

/-- Apply the edits one after the other: whether each was accepted, and the state at the end. An edit's id is its
    position. -/
def run (edits : List (SignerId × List SignerId × Action)) : List Bool × State :=
  let (accepted, st) := edits.zipIdx.foldl (fun (acc : List Bool × State) ((author, co, a), i) =>
    let edit : Edit := { id := i, depth := i, author, cosigners := co, action := a }
    match step acc.2 edit with
    | some st' => (acc.1 ++ [true], st')
    | none     => (acc.1 ++ [false], acc.2)) ([], {})
  (accepted, st)

def ViewCase.toEdits (c : ViewCase) : List Edit :=
  c.edits.zipIdx.map fun ((depth, author, co, a), i) => { id := i, depth, author, cosigners := co, action := a }

/-- Which edits stand in the view, in the order given, and the view. -/
def runView (c : ViewCase) : List Bool × State :=
  let edits := c.toEdits
  let held := if c.pq then checkpointed edits else edits
  let stood := standing held
  (edits.map fun o => stood.any (·.id == o.id), view held)

/-! ## The cases

Signers: Alice's passkey 1, her Mac 2, her iPhone 3, Bob's passkey 4 and Mac 5, Carol's passkey 6 and Mac 7, Dave's
passkey 8, a second passkey 9 (Alice's backup) and a third 10, a new device 77, a stranger 555, the relay server 600.
Vaults: Alice 100, Bob 101, Carol 102, Dave 103 (human vaults), coops from 200, aven vaults from 300 (avenCEO 300).
Caps from 30. Entries: Welcome 1, the Charter 2, notes from 3, todos from 21. Types: a note 1, a todo 2; tags: work 7,
home 8. Blobs (schemas and lenses): from 1. An act for the coop names the human vault it goes through: Alice's Mac (2)
and passkey (1) through `[100]`, Bob's Mac (5) through `[101]`. An entry's stays are named by the moves that began them:
a write names the stay whose key it is encrypted under, `none` for the one its entry's creation began. -/

def note : Sym := 1
def todo : Sym := 2
def work : Sym := 7
def home : Sym := 8

def notes : Selector := .anyOf [[.typeIn [note]]]
def todos : Selector := .anyOf [[.typeIn [todo]]]
def workTodos : Selector := .anyOf [[.typeIn [todo], .tagHas work]]
def only (e : EntryId) : Selector := .anyOf [[.entryIn [e]]]

def humans : List (SignerId × List SignerId × Action) := [
  (1, [], .genesis 100 .human [.signer 1] 1),
  (1, [2], .addDevice 100 2),
  (4, [], .genesis 101 .human [.signer 4] 1),
  (4, [5], .addDevice 101 5),
  (6, [], .genesis 102 .human [.signer 6] 1),
  (8, [], .genesis 103 .human [.signer 8] 1)]

def toVault (v : VaultId) : Grantee := .principal (.vault v)

/-- Cap `id` over vault `over`, issued by `issuer`. -/
def newCap (id over : Nat) (to : Grantee) (r : Role) (issuer : VaultId) (select : Selector := .all)
    (wide : Bool := false) (parent : Option CapId := none) (relabel : List Sym := []) (via : List VaultId := []) :
    Action :=
  .cap { id, over, grantee := to, role := r, wide, select, relabel, parent, issuer } via

/-- A write that creates entry `e` of vault `v` in cell `x`. -/
def newEntry (v e : Nat) (actor : VaultId) (x : Cell) (type : Sym) (created : Nat := 0) (tags : List Sym := [])
    (via : List VaultId := []) (gen : Nat := 0) : Action :=
  .write v e actor none gen (via := via) (create := some (x, ⟨type, created⟩)) (tags := { add := tags })

/-- A write of entry `e`, in its stay `stay` at generation `gen` of that stay's cell. -/
def wr (v e : Nat) (actor : VaultId) (deps : List EditId := []) (stay : Option EditId := none) (gen : Nat := 0)
    (proposal : Proposal := .main) (via : List VaultId := []) (add : List Sym := []) (remove : List Sym := []) :
    Action :=
  .write v e actor stay gen deps proposal via (tags := { add, remove })

def seedKey (v ε : Nat) : KeyName := .scoped (.seed v) ε
def capKey (v c ε : Nat) : KeyName := .scoped (.cap v c) ε
def cellKey (v : Nat) (x : Cell) (ε : Nat) : KeyName := .scoped (.cell v x) ε

def cases : List Case := [
  { name := "a human vault, its devices and a backup passkey", edits := [
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
  { name := "geneses", edits := [
    (4, [], .genesis 101 .human [] 1),
    (4, [], .genesis 101 .human [.signer 4, .signer 4] 1),
    (4, [], .genesis 101 .human [.signer 4] 2),
    (5, [], .genesis 101 .human [.signer 4] 1),
    (4, [], .genesis 101 .coop [.signer 4] 1),
    (4, [], .genesis 101 .human [.signer 4] 1),
    (4, [], .genesis 101 .human [.signer 4] 1),
    (4, [], .genesis 200 .coop [.vault 101, .vault 999] 1),
    (4, [], .genesis 200 .coop [.vault 101] 0)] },
  { name := "a coop's governance", edits := humans ++ [
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
  { name := "no ownership cycles", edits := humans ++ [
    (1, [], .genesis 200 .coop [.vault 100] 1),
    (1, [], .genesis 201 .coop [.vault 200] 1),
    (1, [], .genesis 202 .coop [.vault 201] 1),
    (1, [], .addOwner 200 (.vault 200)),
    (1, [], .addOwner 200 (.vault 201)),
    (1, [], .addOwner 200 (.vault 202)),
    (1, [4], .addOwner 201 (.vault 101)),
    -- two paths to the same coop are no cycle
    (1, [], .addOwner 202 (.vault 200))] },
  { name := "concurrent changes, in replay order", edits := humans ++ [
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
  { name := "the passkey as root", edits := [
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
  { name := "three kinds of vault, and acts that name their chain", edits := humans ++ [
    -- avenCEO, the relay server's aven vault, owned by Alice's human vault; the server joins as its device
    (1, [], .genesis 300 .aven [.vault 100] 1),
    (1, [600], .addDevice 300 600),
    -- the server acts for avenCEO but doesn't govern it; Alice's Mac acts for it through Alice's vault, Bob's Mac not
    (600, [77], .addDevice 300 77),
    (600, [], newEntry 300 13 300 [] note),
    (2, [], newEntry 300 14 300 [] note (via := [100])),
    (5, [], newEntry 300 15 300 [] note (via := [101])),
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
    (2, [], newEntry 200 16 200 [] note (via := [100])),
    (2, [], newEntry 200 17 200 [] note),
    (2, [], newEntry 200 18 200 [] note (via := [101])),
    -- a coop of the coop: Bob's Mac acts for it through the coop and Bob's vault, and may skip neither
    (1, [], .genesis 205 .coop [.vault 200] 1),
    (5, [], newEntry 205 19 205 [] note (via := [200, 101])),
    (5, [], newEntry 205 20 205 [] note (via := [101])),
    (5, [], newEntry 205 21 205 [] note (via := [200]))] },
  { name := "caps and Public", edits := humans ++ [
    (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 2),
    -- Alice's Mac creates the coop's Welcome note in no cap's cell, where only the coop reads it; Carol's passkey
    -- can't create for Alice
    (2, [], newEntry 200 1 200 [] note (via := [100])),
    (6, [], newEntry 100 3 100 [] note),
    -- read for Carol's vault, never for a signer or for the vault itself; Public only reads
    (2, [], newCap 30 200 (toVault 102) .read 200 (only 1) (via := [100])),
    (2, [], newCap 31 200 (.principal (.signer 6)) .read 200 (only 1) (via := [100])),
    (2, [], newCap 32 200 (toVault 200) .read 200 (only 1) (via := [100])),
    (2, [], newCap 33 200 .«public» .write 200 (only 1) (via := [100])),
    (2, [], newCap 34 200 .«public» .read 200 (only 1) (via := [100])),
    -- a steward moves Welcome to the cell of the caps that select it, whose key is then published
    (2, [], .move 200 1 [30, 34] [] [100]),
    -- making Dave owner of the coop's notes is governance: both passkeys of the threshold-2 coop
    (2, [], newCap 35 200 (toVault 103) .owner 200 notes (via := [100])),
    (1, [4], newCap 36 200 (toVault 103) .owner 200 notes (via := [100])),
    -- Dave shares on through his owner cap; naming none, he would have to be the coop
    (8, [], newCap 37 200 (toVault 102) .write 103 (only 1) (parent := some 36)),
    (8, [], newCap 38 200 (toVault 101) .read 103 (only 1)),
    -- a cap that rests on another is no wider than it, and none rests on a read cap
    (8, [], newCap 39 200 (toVault 101) .read 103 (wide := true) (parent := some 36)),
    (6, [], newCap 40 200 (toVault 101) .read 102 (only 1) (parent := some 30)),
    -- Bob writes for the coop, not for himself
    (5, [], wr 200 1 101 [7] (stay := some 14)),
    (5, [], wr 200 1 200 [7] (stay := some 14) (via := [101])),
    -- Carol's cap reaches Welcome only once a steward moves it into its cell
    (6, [], wr 200 1 102 [22] (stay := some 14)),
    (5, [], .move 200 1 [30, 34, 36, 37] [] [101]),
    (6, [], wr 200 1 102 [22] (stay := some 24)),
    -- each write builds on writes that were accepted, in a stay of its entry, at a generation that stay's cell reached
    (6, [], wr 200 1 102 [99] (stay := some 24)),
    (6, [], wr 200 1 102 [25] (stay := some 99)),
    (6, [], wr 200 1 102 [25] (stay := some 24) (gen := 1)),
    -- a device that hasn't seen the move writes in the stay before it, and a stranger not at all
    (6, [], wr 200 1 102 [25] (stay := some 14)),
    (555, [], wr 200 1 200 [25] (stay := some 24))] },
  { name := "tags, moves and stewards", edits := humans ++ [
    -- Alice's work todo, her home todo and a note; Bob may write her work todos and ask for the work and home tags,
    -- Carol reads every todo
    (2, [], newEntry 100 21 100 [] todo (tags := [work])),
    (2, [], newEntry 100 22 100 [] todo (tags := [home])),
    (2, [], newEntry 100 1 100 [] note),
    (2, [], newCap 30 100 (toVault 101) .write 100 workTodos (relabel := [work, home])),
    (2, [], newCap 31 100 (toVault 102) .read 100 todos),
    -- the stewards move each todo to the cell of the caps that select it; the note is where it belongs
    (2, [], .move 100 21 [30, 31] []),
    (2, [], .move 100 22 [31] []),
    (2, [], .move 100 1 [] []),
    -- a move goes only to a cell of the vault's own caps, and only a steward moves
    (2, [], .move 100 22 [31, 77] []),
    (5, [], .move 100 22 [30, 31] [] [101]),
    -- Bob writes the work todo, not the home one
    (5, [], wr 100 21 101 [6] (stay := some 11)),
    (5, [], wr 100 22 101 [7] (stay := some 12)),
    -- Bob asks for the home tag: his tags count for nothing until a device of Alice's vault makes the change
    (5, [], wr 100 21 101 [16] (stay := some 11) (add := [home]) (remove := [work])),
    (2, [], wr 100 21 100 [18] (stay := some 11) (add := [home]) (remove := [work])),
    -- Bob writes again; a steward that hadn't seen it moves the todo out of his slice, and his write goes
    (5, [], wr 100 21 101 [19] (stay := some 11)),
    (2, [], .move 100 21 [31] [16, 18]),
    (5, [], wr 100 21 101 [19] (stay := some 21)),
    -- Bob creates through his cap, in its intake cell only: a work todo, inside his slice, and a note, outside it
    (5, [], newEntry 100 23 101 [30] todo (tags := [work])),
    (5, [], newEntry 100 2 101 [30] note),
    (5, [], newEntry 100 24 101 [30, 31] todo (tags := [work])),
    -- Carol only reads, and creates nothing
    (6, [], newEntry 100 25 102 [31] todo),
    -- the stewards move the work todo to the cell of the caps that select it, and the note to no cap's cell, keeping
    -- what Bob made; he can't write the note any more
    (2, [], .move 100 23 [30, 31] [23]),
    (2, [], .move 100 2 [] [24]),
    (5, [], wr 100 2 101 [24] (stay := some 28)),
    -- Alice tags the home todo for work too: its readers see it belongs in Bob's slice, but until a steward moves it,
    -- Bob's cap doesn't reach it
    (2, [], wr 100 22 100 [7] (stay := some 12) (add := [work])),
    (5, [], wr 100 22 101 [30] (stay := some 12))] },
  { name := "selectors pick by type, author, entry, time and tags", edits := humans ++ [
    (2, [], newEntry 100 1 100 [] note (created := 5)),
    (2, [], newEntry 100 21 100 [] todo (created := 7) (tags := [work])),
    (2, [], newEntry 100 22 100 [] todo (created := 12) (tags := [work, home])),
    (2, [], newEntry 100 23 100 [] todo (created := 3) (tags := [home, 9])),
    -- Bob reads the todos made before 10 with no tags but work and home; Carol Welcome, the second todo and every todo
    -- not tagged work; Dave what Bob makes; and Bob writes every todo
    (2, [], newCap 30 100 (toVault 101) .read 100 (.anyOf [[.typeIn [todo], .tagsWithin [work, home], .createdIn 0 10]])),
    (2, [], newCap 31 100 (toVault 102) .read 100 (.anyOf [[.entryIn [1, 22]], [.typeIn [todo], .tagNone [work]]])),
    (2, [], newCap 32 100 (toVault 103) .read 100 (.anyOf [[.authorIn [101]]])),
    (2, [], newCap 33 100 (toVault 101) .write 100 todos),
    -- no cap over a vault that doesn't exist; Bob creates a todo through his write cap
    (2, [], newCap 34 999 (toVault 101) .read 100),
    (5, [], newEntry 100 24 101 [33] todo),
    -- the stewards move each entry to the cell of the caps that select it
    (2, [], .move 100 1 [31] []),
    (2, [], .move 100 21 [30, 33] []),
    (2, [], .move 100 22 [31, 33] []),
    (2, [], .move 100 23 [31, 33] []),
    (2, [], .move 100 24 [30, 31, 32, 33] [])] },
  { name := "revocation, cascades and keep lists", edits := humans ++ [
    (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    (2, [], newEntry 100 21 100 [] todo (tags := [work])),
    (2, [], newCap 30 100 (toVault 101) .write 100 workTodos),
    (1, [], newCap 31 100 (toVault 200) .owner 100 todos),
    (2, [], newCap 33 100 (toVault 102) .read 100 todos),
    -- acting for the coop, Bob's Mac gives Dave read through the coop's owner cap
    (5, [], newCap 32 100 (toVault 103) .read 200 todos (parent := some 31) (via := [101])),
    (2, [], .move 100 21 [30, 31, 32, 33] []),
    (5, [], wr 100 21 101 [7] (stay := some 12)),
    -- Alice takes Bob's own write away, keeping the write she had seen
    (2, [], .revoke 30 100 [13]),
    (5, [], wr 100 21 101 [13] (stay := some 12)),
    -- Bob still writes for the coop, whose owner cap reaches the todo, and creates one for it in that cap's intake cell
    (5, [], wr 100 21 200 [13] (stay := some 12) (via := [101])),
    (2, [], wr 100 21 100 [16] (stay := some 12)),
    (5, [], newEntry 100 22 200 [31] todo (via := [101])),
    -- a grantee gives its cap up; nobody but its issuer, its vault and those above them in its chain may end it
    (8, [], .revoke 33 103 []),
    (6, [], .revoke 33 102 []),
    -- taking the coop's owner cap away is governance; it ends Dave's read with it, and the coop's write and todo,
    -- which it hadn't seen, and Alice's write that builds on the coop's
    (2, [], .revoke 31 100 [13]),
    (1, [], .revoke 31 100 [13]),
    (5, [], wr 100 21 200 [13] (stay := some 12) (via := [101])),
    -- an id is created once, even after its entry fell; a cap is revoked once, and only a cap that was issued
    (2, [], newEntry 100 22 100 [] todo),
    (2, [], .revoke 32 100 []),
    (2, [], .revoke 99 100 [])] },
  { name := "keys go only where the schedule seals them", edits := humans ++ [
    (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 2),
    (2, [], newEntry 200 1 200 [] note (via := [100])),
    -- Alice's Mac boxes each key to what the schedule seals it to: Welcome's to its cell's, the cell's to the coop's
    -- seed, the coop's seed to its owners' seeds, and her vault's seed to her passkey and her Mac
    (2, [], .keys (.entry 1 none 0) [cellKey 200 [] 0]),
    (2, [], .keys (cellKey 200 [] 0) [seedKey 200 0]),
    (2, [], .keys (seedKey 200 0) [seedKey 100 0, seedKey 101 0]),
    (2, [], .keys (seedKey 100 0) [.signer 1, .signer 2]),
    -- and nowhere else: not to a device directly, not to Bob's Mac
    (2, [], .keys (.entry 1 none 0) [.signer 2]),
    (2, [], .keys (seedKey 100 0) [.signer 5]),
    -- only a signer that may open a key boxes it
    (5, [], .keys (seedKey 100 0) []),
    (6, [], .keys (.entry 1 none 0) []),
    -- no key of a generation, a stay or a family that doesn't exist, and nothing published that isn't public
    (2, [], .keys (cellKey 200 [] 1) []),
    (2, [], .keys (.entry 1 (some 99) 0) []),
    (2, [], .keys (cellKey 200 [30] 0) []),
    (2, [], .keys (cellKey 200 [] 0) [] true),
    -- Carol may read Welcome: a cap names her, a steward moves Welcome into its cell, the cell's key is wrapped under
    -- the cap's key, and that is sealed to her vault's seed
    (2, [], newCap 30 200 (toVault 102) .read 200 (only 1) (via := [100])),
    (2, [], .move 200 1 [30] [] [100]),
    (2, [], .keys (capKey 200 30 0) [seedKey 200 0, seedKey 102 0]),
    (6, [], .keys (cellKey 200 [30] 0) [capKey 200 30 0]),
    (6, [], .keys (.entry 1 (some 21) 0) [cellKey 200 [30] 0]),
    -- the key of Welcome's first write is wrapped under Welcome's key now, a link: Carol reads its whole history, and
    -- no key of the cell it left
    (6, [], .keys (.entry 1 none 0) [.entry 1 (some 21) 0]),
    (6, [], .keys (cellKey 200 [] 0) []),
    -- Welcome goes public: its cell's key is published
    (2, [], newCap 31 200 .«public» .read 200 (only 1) (via := [100])),
    (2, [], .move 200 1 [30, 31] [] [100]),
    (2, [], .keys (cellKey 200 [30, 31] 0) [] true),
    -- revoking Carol rotates nothing while Welcome is public; making it private again does
    (2, [], .revoke 30 200 [] [100]),
    (2, [], .revoke 31 200 [] [100]),
    (2, [], .keys (cellKey 200 [30, 31] 1) [seedKey 200 0]),
    (2, [], .keys (cellKey 200 [30, 31] 0) [cellKey 200 [30, 31] 1]),
    (6, [], .keys (cellKey 200 [30, 31] 1) []),
    (2, [], .keys (cellKey 200 [30, 31] 1) [seedKey 102 0])] },
  { name := "a removed device's vault keys all move on", edits := humans ++ [
    (1, [3], .addDevice 100 3),
    (2, [], newEntry 100 1 100 [] note),
    (2, [], newCap 30 100 (toVault 102) .read 100 notes),
    (2, [], .move 100 1 [30] []),
    -- the iPhone writes Welcome twice, and is lost; Alice removes it, keeping the write she had seen
    (3, [], wr 100 1 100 [7] (stay := some 9)),
    (3, [], wr 100 1 100 [10] (stay := some 9)),
    (1, [], .removeDevice 100 3 [10]),
    -- the iPhone could open Alice's seed, so her seed, her caps' keys and her cells' keys all start a new
    -- generation, which it can't box
    (3, [], .keys (seedKey 100 0) []),
    (2, [], .keys (seedKey 100 1) [.signer 1, .signer 2]),
    (2, [], .keys (seedKey 100 0) [seedKey 100 1]),
    (2, [], .keys (capKey 100 30 1) [seedKey 100 1, seedKey 102 0]),
    (2, [], .keys (cellKey 100 [30] 1) [seedKey 100 1, capKey 100 30 1]),
    (2, [], .keys (cellKey 100 [30] 1) [capKey 100 30 0])] },
  { name := "a cell an entry comes back into moves on", edits := humans ++ [
    -- Bob's and Carol's coop reads Alice's work todos
    (4, [6], .genesis 200 .coop [.vault 101, .vault 102] 1),
    (2, [], newEntry 100 21 100 [] todo (tags := [work])),
    (2, [], newCap 30 100 (toVault 200) .read 100 workTodos),
    (2, [], .move 100 21 [30] []),
    -- the todo loses its tag and leaves the cell, which goes out of use; Carol leaves the coop meanwhile, and the
    -- cell's key doesn't move on, since no entry is in it
    (2, [], wr 100 21 100 [7] (stay := some 9) (remove := [work])),
    (2, [], .move 100 21 [] [10]),
    (6, [], .removeOwner 200 (.vault 102) []),
    -- the todo gets its tag back and returns: the cell's key starts a new generation, which Carol can't open
    (2, [], wr 100 21 100 [10] (stay := some 11) (add := [work])),
    (2, [], .move 100 21 [30] [13]),
    (2, [], .keys (cellKey 100 [30] 1) [seedKey 100 0, capKey 100 30 1]),
    (6, [], .keys (cellKey 100 [30] 1) []),
    (6, [], .keys (cellKey 100 [30] 0) [])] },
  { name := "a new entry brings an empty cell back into use at the generation it moves to", edits := humans ++ [
    (4, [6], .genesis 200 .coop [.vault 101, .vault 102] 1),
    (2, [], newEntry 100 21 100 [] todo (tags := [work])),
    (2, [], newCap 30 100 (toVault 200) .read 100 workTodos),
    (2, [], .move 100 21 [30] []),
    (2, [], wr 100 21 100 [7] (stay := some 9) (remove := [work])),
    (2, [], .move 100 21 [] [10]),
    (6, [], .removeOwner 200 (.vault 102) []),
    -- a new work todo, created straight into the empty cell, may name the generation the cell moves to as it comes
    -- back into use, which Carol can't open, and no later one; so may the next, the cell in use by then
    (2, [], newEntry 100 22 100 [30] todo (tags := [work]) (gen := 2)),
    (2, [], newEntry 100 22 100 [30] todo (tags := [work]) (gen := 1)),
    (2, [], newEntry 100 23 100 [30] todo (tags := [work]) (gen := 2)),
    (2, [], newEntry 100 23 100 [30] todo (tags := [work]) (gen := 1)),
    (5, [], .keys (cellKey 100 [30] 1) [capKey 100 30 1]),
    (6, [], .keys (cellKey 100 [30] 1) []),
    (6, [], .keys (cellKey 100 [30] 0) [])] },
  { name := "the schema lane", edits := humans ++ [
    (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 2),
    (2, [], newCap 30 200 (toVault 102) .write 200 (wide := true) (via := [100])),
    -- Alice's Mac, acting for the coop, publishes a schema and a lens into its lane
    (2, [], .publish 200 200 1 [100]),
    (2, [], .publish 200 200 2 [100]),
    -- the same blob again is refused; in another vault's lane it is that vault's own
    (5, [], .publish 200 200 1 [101]),
    (2, [], .publish 100 100 1),
    -- Carol may write the whole coop but not publish into its lane, for herself or for the coop, whose owner her vault
    -- isn't; nor may a stranger, and nothing goes into the lane of a vault that doesn't exist
    (6, [], .publish 200 102 3),
    (6, [], .publish 200 200 3 [102]),
    (555, [], .publish 200 200 3),
    (2, [], .publish 299 200 3 [100]),
    -- Dave, made owner of the whole coop by both passkeys, publishes; Carol, owner of its notes, doesn't
    (1, [4], newCap 31 200 (toVault 103) .owner 200 (wide := true) (via := [100])),
    (8, [], .publish 200 103 3),
    (1, [4], newCap 32 200 (toVault 102) .owner 200 notes (via := [100])),
    (6, [], .publish 200 102 4),
    (5, [], .publish 200 200 4 [101])] },
  { name := "a device vouches only for its own writes", edits := humans ++ [
    (1, [3], .addDevice 100 3),
    (2, [], newEntry 100 1 100 [] note),
    (2, [], newEntry 100 2 100 [] note),
    (3, [], wr 100 1 100 [7]),
    -- Alice's Mac vouches for its creation of Welcome, her iPhone for its own write
    (2, [], .checkpoint 1 [7]),
    (3, [], .checkpoint 1 [9]),
    -- not for the other device's write, nor for a write of another entry, nor for none at all
    (2, [], .checkpoint 1 [7, 9]),
    (3, [], .checkpoint 1 [7]),
    (2, [], .checkpoint 1 [8]),
    (2, [], .checkpoint 2 [8, 99]),
    (2, [], .checkpoint 2 []),
    (2, [], .checkpoint 3 [8]),
    -- Bob's Mac, a stranger to Alice's notes, can't vouch for her writes
    (5, [], .checkpoint 2 [8]),
    (2, [], .checkpoint 2 [8])] },
  { name := "proposals of an entry", edits := humans ++ [
    (2, [], newEntry 100 1 100 [] note),
    (2, [], newCap 30 100 (toVault 101) .write 100 (only 1)),
    (2, [], newCap 31 100 (toVault 102) .read 100 (only 1)),
    (2, [], .move 100 1 [30, 31] []),
    -- Bob's Mac starts a draft of Welcome from its first version and writes on it
    (5, [], wr 100 1 101 [6] (stay := some 9) (proposal := .new)),
    (5, [], wr 100 1 101 [10] (stay := some 9) (proposal := .on 10)),
    -- a reader can't start a proposal, nor can a stranger
    (6, [], wr 100 1 102 [6] (stay := some 9) (proposal := .new)),
    (555, [], wr 100 1 101 [6] (stay := some 9) (proposal := .new)),
    -- a write on a proposal builds on it: not on main alone, not on a write that didn't start one, not on a proposal
    -- that doesn't exist or is another entry's
    (2, [], wr 100 1 100 [6] (stay := some 9) (proposal := .on 10)),
    (2, [], wr 100 1 100 [11] (stay := some 9) (proposal := .on 11)),
    (2, [], wr 100 1 100 [6] (stay := some 9) (proposal := .on 99)),
    (2, [], newEntry 100 2 100 [] note),
    (2, [], wr 100 2 100 [17] (proposal := .on 10)),
    -- Alice merges the draft: a write on main that builds on both heads
    (2, [], wr 100 1 100 [6, 11] (stay := some 9)),
    -- Bob carries on with the draft and brings main into it
    (5, [], wr 100 1 101 [11] (stay := some 9) (proposal := .on 10)),
    (5, [], wr 100 1 101 [19, 20] (stay := some 9) (proposal := .on 10)),
    -- Alice's Mac starts a proposal of its own from the merge, and Bob writes on it
    (2, [], wr 100 1 100 [19] (stay := some 9) (proposal := .new)),
    (5, [], wr 100 1 101 [22] (stay := some 9) (proposal := .on 22))] }]

/-- Alice's, Bob's, Carol's and Dave's vaults, one edit per depth. -/
def humansV : List (Nat × SignerId × List SignerId × Action) := humans.zipIdx.map fun ((a, co, act), i) => (i, a, co, act)

def views : List ViewCase := [
  { name := "a removed owner can't back-date governance", edits := humansV ++ [
    (6, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    -- Bob, offline since the coop began, adds Dave
    (7, 4, [8], .addOwner 200 (.vault 103)),
    (8, 1, [], .setThreshold 200 1),
    -- Alice removes Bob, not having seen the add
    (9, 1, [], .removeOwner 200 (.vault 101) [])] },
  { name := "a removal keeps what it had seen", edits := humansV ++ [
    (6, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    (7, 4, [8], .addOwner 200 (.vault 103)),
    (8, 1, [], .setThreshold 200 1),
    (9, 1, [], .removeOwner 200 (.vault 101) [7]),
    -- Bob no longer governs
    (10, 4, [], .setThreshold 200 1)] },
  { name := "the senior owner wins a clash", edits := humansV ++ [
    (6, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    -- Bob's removal of Alice sorts first, Alice's of Bob stands
    (7, 4, [], .removeOwner 200 (.vault 100) []),
    (8, 1, [], .removeOwner 200 (.vault 101) [])] },
  { name := "removals that don't clash both stand", edits := humansV ++ [
    (6, 1, [4, 8], .genesis 200 .coop [.vault 100, .vault 101, .vault 103] 1),
    (7, 1, [], .removeOwner 200 (.vault 101) []),
    -- Dave leaves at the same time
    (8, 8, [], .removeOwner 200 (.vault 103) []),
    (9, 8, [], .setThreshold 200 1)] },
  { name := "the root outranks a stolen second passkey", edits := [
    (0, 1, [], .genesis 100 .human [.signer 1] 1 (some 1)),
    (1, 1, [9], .addOwner 100 (.signer 9)),
    -- the thief, holding the second passkey: removes the root's passkey from the owners, adds a device of their own
    (2, 9, [], .removeOwner 100 (.signer 1) []),
    (3, 9, [555], .addDevice 100 555),
    -- the root removes the second passkey, having seen neither
    (4, 1, [], .removeOwner 100 (.signer 9) [])] },
  { name := "a revoked writer's unseen edits are cut, with what builds on them", edits := humansV ++ [
    (6, 2, [], newEntry 100 21 100 [] todo),
    (7, 2, [], newCap 30 100 (toVault 101) .write 100 todos),
    (8, 2, [], newCap 31 100 (toVault 102) .write 100 todos),
    (9, 2, [], .move 100 21 [30, 31] []),
    -- Bob's write Alice saw, and one she didn't, which Carol builds on
    (10, 5, [], wr 100 21 101 [6] (stay := some 9)),
    (11, 5, [], wr 100 21 101 [10] (stay := some 9)),
    (12, 6, [], wr 100 21 102 [11] (stay := some 9)),
    (13, 2, [], .revoke 30 100 [10]),
    (14, 6, [], wr 100 21 102 [10] (stay := some 9))] },
  { name := "a revocation cuts a proposal it hadn't seen, with every write on it", edits := humansV ++ [
    (6, 2, [], newEntry 100 21 100 [] todo),
    (7, 2, [], newCap 30 100 (toVault 101) .write 100 todos),
    (8, 2, [], newCap 31 100 (toVault 102) .write 100 todos),
    (9, 2, [], .move 100 21 [30, 31] []),
    -- Bob's Mac starts a draft Alice sees, and another on an old copy, which she doesn't; Carol writes on the second
    (10, 5, [], wr 100 21 101 [6] (stay := some 9) (proposal := .new)),
    (11, 5, [], wr 100 21 101 [10] (stay := some 9) (proposal := .on 10)),
    (12, 5, [], wr 100 21 101 [6] (stay := some 9) (proposal := .new)),
    (13, 6, [], wr 100 21 102 [12] (stay := some 9) (proposal := .on 12)),
    (14, 2, [], .revoke 30 100 [10, 11]),
    -- Alice merges the draft she saw; Carol's merge of the other goes with it
    (15, 2, [], wr 100 21 100 [6, 11] (stay := some 9)),
    (16, 6, [], wr 100 21 102 [15, 13] (stay := some 9))] },
  { name := "a revocation cuts a creation it hadn't seen", edits := humansV ++ [
    (6, 2, [], newCap 30 100 (toVault 101) .write 100 workTodos),
    -- Bob creates two work todos through his cap; Alice revokes it having seen only the first
    (7, 5, [], newEntry 100 21 101 [30] todo (tags := [work])),
    (8, 5, [], newEntry 100 22 101 [30] todo (tags := [work])),
    (9, 2, [], .revoke 30 100 [7]),
    -- Alice writes the todo she kept; the other never was
    (10, 2, [], wr 100 21 100 [7]),
    (11, 2, [], wr 100 22 100 [8])] },
  { name := "a move cuts a write it hadn't seen into the cell it left", edits := humansV ++ [
    (6, 2, [], newEntry 100 21 100 [] todo (tags := [work])),
    (7, 2, [], newCap 30 100 (toVault 101) .write 100 workTodos),
    (8, 2, [], .move 100 21 [30] []),
    (9, 5, [], wr 100 21 101 [6] (stay := some 8)),
    -- Alice takes the work tag off and a steward moves the todo out of Bob's slice, having seen Bob's first write but
    -- not his second
    (10, 5, [], wr 100 21 101 [9] (stay := some 8)),
    (11, 2, [], wr 100 21 100 [9] (stay := some 8) (remove := [work])),
    (12, 2, [], .move 100 21 [] [9, 11]),
    -- Bob writes on, not having seen it either
    (13, 5, [], wr 100 21 101 [10] (stay := some 8))] },
  { name := "a lost device's back-dated edits are cut", edits := humansV ++ [
    (6, 1, [3], .addDevice 100 3),
    (7, 2, [], newEntry 100 1 100 [] note),
    -- a write from the iPhone the Mac had seen, and a note the thief made on an old copy
    (8, 3, [], wr 100 1 100 [7]),
    (9, 3, [], newEntry 100 2 100 [] note),
    (10, 1, [], .removeDevice 100 3 [8])] },
  { name := "handing the root on cuts the old passkey's back-dated edits", edits := [
    (0, 1, [], .genesis 100 .human [.signer 1] 1 (some 1)),
    (1, 1, [9], .addOwner 100 (.signer 9)),
    -- the old passkey, stolen later, adds a device on an old copy
    (2, 1, [555], .addDevice 100 555),
    (3, 1, [9], .setRoot 100 (some 9) [1]),
    (4, 9, [], .removeOwner 100 (.signer 1) [1])] },
  { name := "a revoked reader's back-dated keys are cut", edits := humansV ++ [
    (6, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    (7, 2, [], newEntry 200 1 200 [] note (via := [100])),
    (8, 2, [], newCap 30 200 (toVault 102) .read 200 (only 1) (via := [100])),
    (9, 2, [], .move 200 1 [30] [] [100]),
    -- Carol's passkey boxes the cell's key twice; Alice revokes Carol's read having seen only the first
    (10, 6, [], .keys (cellKey 200 [30] 0) [capKey 200 30 0]),
    (11, 6, [], .keys (cellKey 200 [30] 0) [seedKey 200 0]),
    (12, 2, [], .revoke 30 200 [10] [100])] },
  { name := "a removed owner's back-dated publish is cut", edits := humansV ++ [
    (6, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    -- Bob's Mac publishes a schema for the coop, which Alice sees, and a lens on an old copy, which she doesn't
    (7, 5, [], .publish 200 200 1 [101]),
    (8, 5, [], .publish 200 200 2 [101]),
    (9, 1, [], .removeOwner 200 (.vault 101) [7]),
    -- Alice's Mac publishes the lens itself; Bob's Mac no longer can
    (10, 2, [], .publish 200 200 2 [100]),
    (11, 5, [], .publish 200 200 3 [101])] },
  { name := "a removed owner's back-dated writes for the coop are cut", edits := humansV ++ [
    (6, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    (7, 2, [], newEntry 200 1 200 [] note (via := [100])),
    -- Bob's Mac writes for the coop through Bob's vault: a write Alice sees, and a note on an old copy, which she
    -- doesn't
    (8, 5, [], wr 200 1 200 [7] (via := [101])),
    (9, 5, [], newEntry 200 2 200 [] note (via := [101])),
    (10, 1, [], .removeOwner 200 (.vault 101) [8]),
    -- Alice's Mac writes on; Bob's Mac no longer can
    (11, 2, [], wr 200 1 200 [8] (via := [100])),
    (12, 5, [], wr 200 1 200 [11] (via := [101]))] },
  { name := "once the curves fall, only vouched writes count", pq := true, edits := humansV ++ [
    (6, 1, [3], .addDevice 100 3),
    (7, 2, [], newEntry 100 1 100 [] note),
    (8, 2, [], newEntry 100 2 100 [] note),
    (9, 2, [], wr 100 2 100 [8]),
    -- Alice's Mac vouches for Welcome's creation; for its write of the Charter but not the Charter's creation, which
    -- the write builds on, so neither counts
    (10, 2, [], .checkpoint 1 [7]),
    (11, 2, [], .checkpoint 2 [9]),
    -- the iPhone's write is vouched for by the iPhone; a forger who broke the Mac's curve signs a write as the Mac,
    -- and can't vouch for it; nor can the iPhone vouch for it
    (12, 3, [], wr 100 1 100 [7]),
    (13, 3, [], .checkpoint 1 [12]),
    (14, 2, [], wr 100 1 100 [12]),
    (15, 3, [], .checkpoint 1 [14])] },
  { name := "the senior revoker ranks first", edits := humansV ++ [
    (6, 2, [], newEntry 100 1 100 [] note),
    (7, 1, [], newCap 30 100 (toVault 103) .owner 100 notes),
    (8, 8, [], newCap 31 100 (toVault 102) .read 103 notes (parent := some 30)),
    (9, 2, [], .move 100 1 [30, 31] []),
    -- Alice revokes Dave's owner cap; Dave revokes the read he gave Carol on a copy that hadn't seen it, so his
    -- revocation sorts first, and falls with the cap it rested on
    (11, 1, [], .revoke 30 100 [6, 7, 8, 9]),
    (10, 8, [], .revoke 31 103 [])] },
  { name := "a vault settles before the coops it owns", edits := humansV ++ [
    (6, 1, [9], .addOwner 100 (.signer 9)),
    (7, 1, [10], .addOwner 100 (.signer 10)),
    (8, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    -- the second passkey removes Bob from the coop on a copy that hadn't seen the third remove it from Alice's vault
    (9, 9, [], .removeOwner 200 (.vault 101) []),
    (10, 10, [], .removeOwner 100 (.signer 9) [6, 7, 8])] }]

/-! ## Sync cases

A sync case is a list of edits a peer holds, each building on the frontier of its own log among the edits before it, as
a device holding them all would build, unless it names other parents or claims another depth. The model's answers:
which edits stand; each log's closed part and frontier; the forks; and for each device that asks, holding some of the
edits, a peer holding all of them or some: the device's frontier of each log it holds, what it sends of it when it asks
and its loose edits (`asks`), what the peer would send it whole (`respond`), and what it sends given what the device
sent (`respondSince`). A parent no edit of the case has (999) stands for an edit nobody holds. -/

/-- An edit of a sync case. -/
structure SyncEdit where
  author    : SignerId
  cosigners : List SignerId := []
  action    : Action
  /-- The edits of its log it builds on, by place; `none` for the frontier of its log among the edits before it. -/
  parents   : Option (List Nat) := none
  /-- The depth it claims; `none` for its place. -/
  depth     : Option Nat := none

structure SyncCase where
  name  : String
  edits : List SyncEdit
  /-- Who asks: a device, the places of the edits it holds, and those of the edits the peer holds (`none`: all). -/
  asks  : List (SignerId × List Nat × Option (List Nat))
  /-- The passkeys that prove themselves to a peer holding every edit, to link a new device (`linkCard`). -/
  links : List SignerId := []

def SyncCase.toEdits (c : SyncCase) : List Edit :=
  c.edits.zipIdx.foldl (fun acc (o, i) =>
    let edit : Edit :=
      { id := i, depth := o.depth.getD i, author := o.author, cosigners := o.cosigners, action := o.action }
    let parents := o.parents.getD (match edit.log? with
      | some l => frontiers acc l
      | none => [])
    acc ++ [{ edit with parents }]) []

def plain (edits : List (SignerId × List SignerId × Action)) : List SyncEdit :=
  edits.map fun (author, cosigners, action) => { author, cosigners, action }

/-- The edits of a case at the places `held`. -/
def heldEdits (edits : List Edit) (held : List Nat) : List Edit := edits.filter (held.contains ·.id)

/-- The edits the peer holds: those at the places `peer`, or all of them. -/
def peerEdits (edits : List Edit) : Option (List Nat) → List Edit
  | some ps => heldEdits edits ps
  | none => edits

def syncs : List SyncCase := [
  { name := "an entry by caps, by frontiers", edits := plain (humans ++ [
      (6, [7], .addDevice 102 7),
      (1, [3], .addDevice 100 3),
      (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
      -- the coop's Welcome and Charter: Carol reads Welcome, Bob edits it
      (2, [], newEntry 200 1 200 [] note (via := [100])),
      (2, [], newEntry 200 2 200 [] note (via := [100])),
      (2, [], newCap 30 200 (toVault 102) .read 200 (only 1) (via := [100])),
      (2, [], .move 200 1 [30] [] [100]),
      (5, [], wr 200 1 200 [9] (stay := some 12) (via := [101])),
      (2, [], .checkpoint 1 [9]),
      (2, [], wr 200 2 200 [10] (via := [100])),
      (2, [], .publish 200 200 1 [100]),
      -- Alice's own note
      (2, [], newEntry 100 3 100 [] note)]),
    asks := [
      -- Carol's Mac holding nothing yet, then after a sync before Bob's write, then holding Bob's write without its past
      (7, [], none),
      (7, [0, 1, 2, 3, 4, 6, 7, 8, 9, 11, 12], none),
      (7, [4, 6, 13], none),
      -- Bob's Mac before most of the coop's notes, a stranger, and Alice's iPhone holding everything
      (5, [0, 1, 2, 3, 4, 5, 8, 9, 10], none),
      (555, [], none),
      (3, List.range 18, none)] },
  { name := "forks", edits := plain (humans ++ [
      (1, [3], .addDevice 100 3),
      (2, [], newEntry 100 1 100 [] note),
      (2, [], wr 100 1 100 [7])]) ++ [
      -- Alice's Mac again from the same past, as a copy restored from an old backup would: a fork
      { author := 2, action := wr 100 1 100 [7], parents := some [7] },
      -- her iPhone at the same moment: another device, no fork
      { author := 3, action := wr 100 1 100 [7], parents := some [7] },
      -- her passkey on two devices at once: a passkey isn't checked
      { author := 1, cosigners := [77], action := .addDevice 100 77 },
      { author := 1, action := .setThreshold 100 1, parents := some [6] },
      -- the Mac building on an edit nobody holds: outside the closed part, so neither in the frontier nor a fork
      { author := 2, action := wr 100 1 100 [7], parents := some [999] },
      -- the iPhone claiming to be no deeper than the edit it builds on: malformed, so it never stands
      { author := 3, action := wr 100 1 100 [10], parents := some [10], depth := some 10 }],
    asks := [(3, [0, 1, 2, 3, 4, 5, 6, 7, 10], none), (2, [], none)] },
  { name := "a revocation joins its cap's log", edits := plain (humans ++ [
      (6, [7], .addDevice 102 7),
      (2, [], newEntry 100 21 100 [] todo),
      (2, [], newCap 30 100 (toVault 102) .read 100 (only 21)),
      (2, [], .move 100 21 [30] []),
      (2, [], newEntry 100 22 100 [] todo),
      -- Alice revokes Carol's read: Carol hears of it, and of nothing else about the todo
      (2, [], .revoke 30 100 [7, 8, 9]),
      (2, [], wr 100 21 100 [7] (stay := some 9))]),
    asks := [(7, [0, 1, 4, 6, 7, 8, 9], none), (7, [], none), (5, [2, 3], none),
      -- Carol holding the revocation but not the cap it revokes: it is loose, and isn't sent again
      (7, [0, 1, 4, 6, 7, 9, 11], none)] },
  { name := "a relay holds the cells it may relay, and no key", edits := plain (humans ++ [
      (1, [], .genesis 300 .aven [.vault 100] 1),
      (1, [600], .addDevice 300 600),
      -- Alice's note and her todo; avenCEO may hold her notes, and read none
      (2, [], newEntry 100 1 100 [] note),
      (2, [], newEntry 100 21 100 [] todo),
      (2, [], newCap 30 100 (toVault 300) .backup 100 notes),
      (2, [], .move 100 1 [30] []),
      (2, [], wr 100 1 100 [8] (stay := some 11)),
      (2, [], .keys (cellKey 100 [30] 0) [seedKey 100 0])]),
    asks := [(600, [], none), (600, [0, 1, 6, 7, 10], none), (5, [], none)] },
  { name := "a device ahead of its peer", edits := plain (humans ++ [
      (1, [3], .addDevice 100 3),
      (2, [], newEntry 100 1 100 [] note)] ++
      -- Alice's Mac writes her note seventeen times
      List.replicate 17 (2, [], wr 100 1 100)) ++ [
      -- her iPhone writes it once, having seen the first twelve
      { author := 3, action := wr 100 1 100, parents := some [19] }],
    asks := [
      -- the Mac asks the iPhone: each lacks some of the other's edits; then an iPhone holding none of its own
      (2, List.range 25, some (List.range 20 ++ [25])),
      (2, List.range 25, some (List.range 20)),
      -- the iPhone, behind, asks a peer holding all of them
      (3, List.range 13, none)] },
  { name := "linking a device by its passkey", edits := plain (humans ++ [
      (1, [3], .addDevice 100 3),
      -- Alice's backup passkey, a second owner of her vault
      (1, [9], .addOwner 100 (.signer 9)),
      (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
      (2, [], newEntry 200 1 200 [] note (via := [100])),
      (2, [], newCap 30 200 (toVault 102) .read 200 (wide := true) (via := [100]))]),
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

def ids (xs : List Nat) : String := arr (xs.map nat)

def principal : Principal → String
  | .signer s => obj [("signer", nat s)]
  | .vault v  => obj [("vault", nat v)]

def kind : Kind → String
  | .human => str "human"
  | .coop  => str "coop"
  | .aven  => str "aven"

def role : Role → String
  | .relay => str "relay"
  | .backup => str "backup"
  | .read  => str "read"
  | .write => str "write"
  | .owner => str "owner"

def grantee : Grantee → String
  | .principal p => principal p
  | .«public»    => str "public"

def atom : Atom → String
  | .typeIn ts       => obj [("typeIn", ids ts)]
  | .authorIn vs     => obj [("authorIn", ids vs)]
  | .entryIn es      => obj [("entryIn", ids es)]
  | .createdIn lo hi => obj [("createdIn", obj [("from", nat lo), ("to", nat hi)])]
  | .tagHas t        => obj [("tagHas", nat t)]
  | .tagNone ts      => obj [("tagNone", ids ts)]
  | .tagsWithin ts   => obj [("tagsWithin", ids ts)]

def selector : Selector → String
  | .all      => str "all"
  | .anyOf ds => obj [("anyOf", arr (ds.map fun d => arr (d.map atom)))]

def capJson (c : Cap) : String :=
  obj [("id", nat c.id), ("over", nat c.over), ("grantee", grantee c.grantee), ("role", role c.role),
       ("wide", bool c.wide), ("select", selector c.select), ("relabel", ids c.relabel), ("parent", opt nat c.parent),
       ("issuer", nat c.issuer)]

def keyFam : KeyFam → String
  | .seed v   => obj [("seed", nat v)]
  | .cap v c  => obj [("cap", obj [("vault", nat v), ("cap", nat c)])]
  | .cell v x => obj [("cell", obj [("vault", nat v), ("caps", ids x)])]

def keyName : KeyName → String
  | .signer s    => obj [("signer", nat s)]
  | .scoped k ε  => obj [("key", keyFam k), ("epoch", nat ε)]
  | .entry e s g => obj [("entry", nat e), ("stay", opt nat s), ("gen", nat g)]

def proposal : Proposal → String
  | .main => str "main"
  | .new  => str "new"
  | .on b => obj [("on", nat b)]

def header (h : Header) : String := obj [("type", nat h.type), ("created", nat h.created)]

def tagDelta (d : TagDelta) : String := obj [("add", ids d.add), ("remove", ids d.remove)]

def action : Action → String
  | .genesis v k owners t root => obj [("genesis", obj [("vault", nat v), ("kind", kind k),
      ("owners", arr (owners.map principal)), ("threshold", nat t), ("root", opt nat root)])]
  | .addOwner v p => obj [("addOwner", obj [("vault", nat v), ("owner", principal p)])]
  | .removeOwner v p keep => obj [("removeOwner", obj [("vault", nat v), ("owner", principal p), ("keep", ids keep)])]
  | .setThreshold v n => obj [("setThreshold", obj [("vault", nat v), ("threshold", nat n)])]
  | .addDevice v d => obj [("addDevice", obj [("vault", nat v), ("device", nat d)])]
  | .removeDevice v d keep => obj [("removeDevice", obj [("vault", nat v), ("device", nat d), ("keep", ids keep)])]
  | .setRoot v r keep => obj [("setRoot", obj [("vault", nat v), ("root", opt nat r), ("keep", ids keep)])]
  | .cap c via => obj [("cap", obj [("cap", capJson c), ("via", ids via)])]
  | .revoke c a keep via => obj [("revoke", obj [("cap", nat c), ("actor", nat a), ("keep", ids keep),
      ("via", ids via)])]
  | .write v e a s g deps p via create tags => obj [("write", obj [("vault", nat v), ("entry", nat e),
      ("actor", nat a), ("stay", opt nat s), ("gen", nat g), ("deps", ids deps), ("proposal", proposal p),
      ("via", ids via), ("create", opt (fun (x, h) => obj [("cell", ids x), ("header", header h)]) create),
      ("tags", tagDelta tags)])]
  | .move v e to keep via => obj [("move", obj [("vault", nat v), ("entry", nat e), ("to", ids to),
      ("keep", ids keep), ("via", ids via)])]
  | .keys secret to pub => obj [("keys", obj [("secret", keyName secret), ("to", arr (to.map keyName)),
      ("public", bool pub)])]
  | .publish v a b via => obj [("publish", obj [("vault", nat v), ("actor", nat a), ("blob", nat b),
      ("via", ids via)])]
  | .checkpoint e covers => obj [("checkpoint", obj [("entry", nat e), ("covers", ids covers)])]

def vault (vt : Vault) : String :=
  obj [("id", nat vt.id), ("kind", kind vt.kind), ("owners", arr (vt.owners.map principal)),
       ("threshold", nat vt.threshold), ("devices", arr (vt.devices.map nat)), ("root", opt nat vt.root)]

def attrs (a : Attrs) : String :=
  obj [("type", nat a.type), ("author", nat a.author), ("entry", nat a.entry), ("created", nat a.created),
       ("tags", ids a.tags)]

/-- An entry: its stays, the current one first, and what only its readers see. -/
def entryJson (st : State) (en : Entry) : String :=
  obj [("id", nat en.id), ("vault", nat en.vault),
       ("stays", arr (en.stays.map fun (s, x) => obj [("stay", opt nat s), ("cell", ids x)])),
       ("attrs", attrs en.attrs), ("admitted", bool en.admitted), ("semCell", ids (semCell st en)),
       ("desired", opt ids (desired st en))]

def write (w : Write) : String :=
  obj [("edit", nat w.edit), ("author", nat w.author), ("actor", nat w.actor), ("entry", nat w.entry),
       ("stay", opt nat w.stay), ("gen", nat w.gen), ("deps", ids w.deps), ("proposal", proposal w.proposal),
       ("via", ids w.via), ("first", bool w.first), ("cell", ids w.cell)]

def sealed (x : Seal) : String := obj [("secret", keyName x.secret), ("to", keyName x.to)]

/-- Each line of each entry, the main line first and then each proposal in the order it started: its history and its
    heads. -/
def lines (st : State) : String :=
  arr (st.entries.flatMap fun en =>
    let starts := st.writes.filterMap fun w =>
      if w.entry == en.id && w.proposal == .new then some w.edit else none
    (none :: starts.map some).map fun l =>
      obj [("entry", nat en.id), ("line", opt nat l), ("history", ids ((history st.writes en.id l).map (·.edit))),
           ("heads", ids (heads st.writes en.id l))])

def state (st : State) : String :=
  ",\n ".intercalate [
    str "vaults" ++ ": " ++ arr (st.vaults.map vault),
    str "caps" ++ ": " ++ arr (st.caps.map capJson),
    str "revoked" ++ ": " ++ ids st.revoked,
    str "entries" ++ ": " ++ arr (st.entries.map (entryJson st)),
    str "born" ++ ": " ++ ids st.born,
    str "writes" ++ ": " ++ arr (st.writes.map write),
    str "epochs" ++ ": " ++ arr (st.epochs.map fun (k, ε) => obj [("key", keyFam k), ("epoch", nat ε)]),
    str "seals" ++ ": " ++ arr (st.seals.map sealed),
    str "published" ++ ": " ++ arr (st.published.map keyName),
    str "lane" ++ ": " ++ arr (st.lane.map fun (v, b) => obj [("vault", nat v), ("blob", nat b)]),
    str "lines" ++ ": " ++ lines st]

def case (c : Case) : String :=
  let (accepted, st) := run c.edits
  let edits := c.edits.map fun (author, co, a) =>
    obj [("author", nat author), ("cosigners", arr (co.map nat)), ("action", action a)]
  "{" ++ str "name" ++ ": " ++ str c.name ++ ",\n " ++ str "edits" ++ ": [\n  " ++ ",\n  ".intercalate edits ++
    "],\n " ++ str "accepted" ++ ": " ++ arr (accepted.map bool) ++ ",\n " ++ state st ++ "}"

def viewCase (c : ViewCase) : String :=
  let (stood, st) := runView c
  let edits := c.edits.map fun (depth, author, co, a) =>
    obj [("depth", nat depth), ("author", nat author), ("cosigners", arr (co.map nat)), ("action", action a)]
  "{" ++ str "name" ++ ": " ++ str c.name ++ ",\n " ++ str "pq" ++ ": " ++ bool c.pq ++ ",\n " ++ str "edits" ++
    ": [\n  " ++ ",\n  ".intercalate edits ++ "],\n " ++ str "standing" ++ ": " ++ arr (stood.map bool) ++ ",\n " ++
    state st ++ "}"

def logId : LogId → String
  | .vault v  => obj [("vault", nat v)]
  | .cap c    => obj [("cap", nat c)]
  | .cell v x => obj [("cell", obj [("vault", nat v), ("caps", ids x)])]
  | .entry e  => obj [("entry", nat e)]

def syncCase (c : SyncCase) : String :=
  let edits := c.toEdits
  let stood := standing edits
  let editJson := edits.map fun o => obj [("depth", nat o.depth), ("author", nat o.author),
    ("cosigners", arr (o.cosigners.map nat)), ("action", action o.action), ("parents", ids o.parents)]
  let logs := (logsOf edits).map fun l => obj [("log", logId l),
    ("closed", ids ((closedPart Edit.log? edits l).map (·.id))), ("frontier", ids (frontiers edits l))]
  let asks := c.asks.map fun (d, held, peer) =>
    let (h, p) := (heldEdits edits held, peerEdits edits peer)
    let sent := (logsOf h).map fun l => obj [("log", logId l), ("frontier", ids (frontiers h l)),
      ("haves", ids ((asks h).haves l))]
    obj [("device", nat d), ("held", ids held), ("peer", opt ids peer), ("logs", arr sent), ("loose", ids (loose h)),
         ("respond", ids ((respond p d).map (·.id))), ("since", ids ((respondSince p d (asks h)).map (·.id)))]
  let links := c.links.map fun p => obj [("passkey", nat p), ("card", ids ((linkCard edits p).map (·.id)))]
  "{" ++ str "name" ++ ": " ++ str c.name ++ ",\n " ++ str "edits" ++ ": [\n  " ++ ",\n  ".intercalate editJson ++
    "],\n " ++ str "standing" ++ ": " ++ arr (edits.map fun o => bool (stood.any (·.id == o.id))) ++ ",\n " ++
    str "logs" ++ ": [\n  " ++ ",\n  ".intercalate logs ++ "],\n " ++ str "forks" ++ ": " ++
    arr ((allForks edits).map fun (a, b) => ids [a, b]) ++ ",\n " ++ str "asks" ++ ": [\n  " ++
    ",\n  ".intercalate asks ++ "],\n " ++ str "links" ++ ": " ++ arr links ++ "}"

def render : String :=
  "{\"cases\": [\n" ++ ",\n".intercalate (cases.map case) ++ "\n],\n\"views\": [\n" ++
    ",\n".intercalate (views.map viewCase) ++ "\n],\n\"syncs\": [\n" ++ ",\n".intercalate (syncs.map syncCase) ++
    "\n]}\n"

/-- What an edit creates, by the model's number: a vault or a cap. -/
def created : Action → Option (Nat × Nat)
  | .genesis v .. => some (0, v)
  | .cap c _ => some (1, c.id)
  | _ => none

/-- The cells an edit names. -/
def cellsOf : Action → List Cell :=
  let named : KeyName → List Cell
    | .scoped (.cell _ x) _ => [x]
    | _ => []
  fun
  | .write _ _ _ _ _ _ _ _ (some (x, _)) _ => [x]
  | .move _ _ to _ _ => [to]
  | .keys s to _ => named s ++ to.flatMap named
  | _ => []

/-- Every action of every case. -/
def allActions : List Action :=
  cases.flatMap (·.edits.map (·.2.2)) ++ views.flatMap (·.edits.map (·.2.2.2)) ++
    syncs.flatMap (·.edits.map (·.action))

-- every case refuses some edits and accepts others, so neither side can pass by always saying the same thing
#guard cases.all fun c => let (acc, _) := run c.edits; acc.any id && acc.any (!·)
#guard views.all fun c => let (stood, _) := runView c; stood.any id && stood.any (!·)
-- in a view case, every vault and cap number is created once, and no two edits share a depth and a rank, so the
-- hashes the Rust core orders by never decide
#guard views.all fun c => nodup (c.edits.filterMap fun (_, _, _, a) => created a)
#guard views.all fun c => nodup (c.toEdits.map fun o => (o.depth, o.rank))
-- in a step case, caps too
#guard cases.all fun c => nodup (c.edits.filterMap fun (_, _, a) => (created a).filter (·.1 != 0))
-- every cell a case names is in the model's order, so it names one set of caps whatever order the Rust core keeps
#guard allActions.all fun a => (cellsOf a).all fun x => x == mkCell x
-- a post-quantum case drops some writes that would stand in the full view, so the Rust core must drop them too
#guard views.all fun c => !c.pq || (runView c).1 != (runView { c with pq := false }).1
-- some entry's creation is let in and another's isn't, some entry is where its readers say it belongs and another
-- isn't yet, some write is on an earlier stay, and some entry fell: the Rust core must say the same of each
#guard cases.any fun c => (run c.edits).2.entries.any (·.admitted) && (run c.edits).2.entries.any (!·.admitted)
#guard cases.any fun c => let st := (run c.edits).2; st.entries.any (desired st · == none) &&
  st.entries.any (desired st · != none)
#guard cases.any fun c => let st := (run c.edits).2; st.writes.any fun w => match st.entry? w.entry with
  | some en => w.stay != en.stay && !w.first
  | none => false
#guard cases.any fun c => let st := (run c.edits).2; st.born.any fun e => (st.entry? e).isNone
-- in a sync case, every vault and cap number is created once, an edit builds only on edits before it or on one nobody
-- holds, and no two edits in the replay order share a depth and a rank
#guard syncs.all fun c => nodup (c.edits.filterMap fun o => created o.action)
#guard syncs.all fun c => c.toEdits.all fun o => o.parents.all fun p => p < o.id || p ≥ c.edits.length
#guard syncs.all fun c => nodup ((order c.toEdits).map fun o => (o.depth, o.rank))
-- what a device is sent when it asks is part of what it would be sent whole, and with what it held covers all of it
-- (T12, T19)
#guard syncs.all fun c => let edits := c.toEdits; c.asks.all fun (d, held, peer) =>
  let (h, p) := (heldEdits edits held, peerEdits edits peer)
  let s := respondSince p d (asks h)
  s.all (respond p d).contains && (respond p d).all fun o => h.contains o || s.contains o
-- asking leaves something out, the edits further back leave out more than the frontiers alone and the loose edits more
-- than without them, some device is sent nothing new, some edit is outside its log's closed part, some edit is
-- malformed, and there is a fork
#guard syncs.any fun c => let edits := c.toEdits; c.asks.any fun (d, held, peer) =>
  let p := peerEdits edits peer
  (respondSince p d (asks (heldEdits edits held))).length < (respond p d).length
#guard syncs.any fun c => let edits := c.toEdits; c.asks.any fun (d, held, peer) =>
  let (h, p) := (heldEdits edits held, peerEdits edits peer)
  (respondSince p d (asks h)).length < (respondSince p d ⟨frontiers h, loose h⟩).length
#guard syncs.any fun c => let edits := c.toEdits; c.asks.any fun (d, held, peer) =>
  let (h, p) := (heldEdits edits held, peerEdits edits peer)
  (respondSince p d (asks h)).length < (respondSince p d ⟨(asks h).haves, []⟩).length
#guard syncs.any fun c => let edits := c.toEdits; c.asks.any fun (d, held, peer) =>
  let p := peerEdits edits peer
  (respondSince p d (asks (heldEdits edits held))).isEmpty && !(respond p d).isEmpty
#guard syncs.any fun c => let edits := c.toEdits; (logsOf edits).any fun l =>
  (closedPart Edit.log? edits l).length < (inLog Edit.log? edits l).length
#guard syncs.any fun c => (order c.toEdits).length < c.edits.length
#guard syncs.any fun c => !(allForks c.toEdits).isEmpty
-- a relay is sent an entry it may relay and not one it may not, and a cell's log
#guard syncs.any fun c => let edits := c.toEdits; c.asks.any fun (d, _, peer) =>
  let sent := respond (peerEdits edits peer) d
  sent.any (fun o => o.log? == some (.entry 1)) && !sent.any (fun o => o.log? == some (.entry 21)) &&
    sent.any fun o => match o.log? with
      | some (.cell ..) => true
      | _ => false
-- some device is sent the log of a cell whose key it can't open: a relay
#guard syncs.any fun c => let edits := c.toEdits; let st := view edits; c.asks.any fun (d, _, peer) =>
  (respond (peerEdits edits peer) d).any fun o => match o.log? with
    | some (.cell v x) => !knows st [.signer d] (st.curKey (.cell v x))
    | _ => false
-- a passkey that owns a vault is handed its log, one that owns none nothing, and the card holds only vault logs (T20)
#guard syncs.any fun c => c.links.any fun p => !(linkCard c.toEdits p).isEmpty
#guard syncs.any fun c => c.links.any fun p => (linkCard c.toEdits p).isEmpty
#guard syncs.all fun c => c.links.all fun p => (linkCard c.toEdits p).all fun o => match o.log? with
  | some (.vault _) => true
  | _ => false

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

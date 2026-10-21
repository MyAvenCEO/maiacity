import AvenDB.Step
import AvenDB.Logs
import AvenDB.Lens
import AvenDB.Proposals
import AvenDB.Gate
import AvenDB.Admission
import AvenDB.Quota
import AvenDB.Writes

/-!
# Test vectors for the Rust core

The same cases run here and in `crates/avendb/tests/vectors.rs`. A step case is a list of edits applied one after the
other from the empty state, as every peer applies them once they are in replay order; the model's answer is whether each
edit is accepted, and the state at the end. A view case gives each edit the depth it claims, as edits made on different
devices do, and the answer is which edits stand in the view (`standing`) and the view itself: that is where removals
cut what they hadn't seen. The Rust core must give the same answer for every case.

`lake build` checks that `vectors/vaults.json` holds exactly what the model says, and fails when it doesn't
(`VectorsCheck.lean`); `lake exe vectors` writes the file again after a change to the rules.

The Rust core names a vault and a share by the hash of the edit that created it, and orders edits of the same depth and
rank by their hashes, where the model picks numbers: the Rust side maps each number to what its edit created, so every
share number is used once per case, every vault number once per view and sync case, and no two edits of a view case
share a depth and a rank. An entry's id is random bytes its creator draws: the Rust side maps entry number `e` to fixed
bytes. An audience is a set of shares, which the model keeps sorted by number and the Rust core by id, so every audience
a case names is in the model's order (an audience in another order is refused by the model and could be taken by the
Rust core), and the Rust side compares the audiences of the state as sets. A blob is named by the hash of its bytes: the
Rust side maps blob number `b` to the bytes `blob b`. The state includes each entry's stays and wants and, as its
readers see it, its attributes, whether its creation was let in, whether it has landed (a draft, a creation that starts
a line of its own, lands once main's counted history holds its creation), its semantic audience and wants, and what a
steward would mark it with, and for each device a keep share over its vault names, whether the device wants the entry
and keeps its files whole; the key schedule (each family's epoch where it isn't 0, every seal and every published key,
all three compared as sets); each vault's schema lane, as its readers read it off the vault's schema and lens entries
(`laneOf`), vault by vault in the order the vaults came; the writes its readers don't count (`uncounted`); the writes
they read as the vault's accepts of a proposal (`accepts`); and each line of each entry's history, of the writes they
count: its writes and its heads, the main line first and then each proposal in the order it started, a draft's own
line among them. A write carries its proof
and its touches, as its readers read them off its body, and a share its ops.
The file starts with the built-in groups (`groups`), which the Rust core offers as they are, and ends with the
version cases (`versions`): how many writes a version of an entry holds at the end of a step case, by its heads, some
writes left out (T10l, `writesAt`).

`vectors/lenses.json` holds the lens cases: stored blocks and todos in every shape the lens tells apart, what each app
reads from them (`v0`, `v1`), and what each of a few edits through each app's view stores (`putV0`, `putV1`). The Rust
core must read and write exactly the same.
-/

namespace AvenDB.Vectors

structure Case where
  name  : String
  edits : List (SignerId × List SignerId × Action)

/-- A view case: each edit with the depth it claims. -/
structure ViewCase where
  name  : String
  edits : List (Nat × SignerId × List SignerId × Action)

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
  let stood := standing edits
  (edits.map fun o => stood.any (·.id == o.id), view edits)

/-! ## The cases

Signers: Alice's passkey 1, her Mac 2, her iPhone 3, Bob's passkey 4 and Mac 5, Carol's passkey 6 and Mac 7, Dave's
passkey 8, a second passkey 9 (Alice's backup) and a third 10, a new device 77 (a worker's device in the sub cap case), 78
(an aven's server), a stranger 555, the relay server 600. Vaults: Alice 100, Bob 101, Carol 102, Dave 103 (human
vaults), coops from 200, avens and device vaults from 300 (the relay server's vault 300).
Shares from 30, keep shares from 40. Entries: Welcome 1, the Charter 2, notes from 3, todos from 21. Types: a note 1, a
todo 2, a schema 900 (`schemaType`) and a lens 901 (`lensType`); tags: work 7, home 8. Blobs, the content a schema or a
lens entry's creation holds (`Header.blob`): from 1, and 0 for every other entry. An act for the coop names
the human vault it goes through: Alice's Mac (2) and passkey (1) through `[100]`, Bob's Mac (5) through `[101]`. An
entry's stays are named by the moves that began them: a write names the stay whose key it is encrypted under, `none`
for the one its entry's creation began. A mark of the audience alone is written `.move`, and a mark of the wants alone
`.pick`. -/

def note : Sym := 1
def todo : Sym := 2
def work : Sym := 7
def home : Sym := 8

def notes : Selector := .anyOf [[.typeIn [note]]]
def todos : Selector := .anyOf [[.typeIn [todo]]]
def workTodos : Selector := .anyOf [[.typeIn [todo], .tagHas work]]
def only (e : EntryId) : Selector := .anyOf [[.entryIn [e]]]
/-- What a vault's share to everyone of its schemas and lenses selects. -/
def schemas : Selector := .anyOf [[.typeIn schemaTypes]]

def humans : List (SignerId × List SignerId × Action) := [
  (1, [], .genesis 100 .human [.signer 1] 1),
  (1, [2], .share (.device 100 2)),
  (4, [], .genesis 101 .human [.signer 4] 1),
  (4, [5], .share (.device 101 5)),
  (6, [], .genesis 102 .human [.signer 6] 1),
  (8, [], .genesis 103 .human [.signer 8] 1)]

def toVault (v : VaultId) : Who := .vault v

/-- Share `id` over vault `over` with level `r`, issued by `issuer`: the ops of its level's group (`Level.ops`), unless
    it names its own. -/
def newShare (id over : Nat) (to : Who) (r : Level) (issuer : VaultId) (select : Selector := .all)
    (wide : Bool := false) (parent : Option ShareId := none) (via : List VaultId := [])
    (ops : Option (List Op) := none) : Action :=
  .share (.grant { id, over, who := to, level := r, wide, select, ops := ops.getD r.ops, parent, issuer } via)

/-- Share `id` over vault `over` with level `r`, issued by it, of its cap group `g`: no ops of its own, and a selector
    that holds every entry, so what it grants is what the group's caps hold. -/
def groupShare (id over : Nat) (to : Who) (r : Level) (g : EntryId) (via : List VaultId := []) : Action :=
  let c : Share := { id, over, who := to, level := r, wide := false, select := .anyOf [[]], ops := [], parent := none,
                     issuer := over, group := some g }
  .share (.grant c via)

/-- Keep share `id` over vault `over`: device `d` of vault `issuer` syncs what `select` picks, or all of `over`
    (`wide`), as mode `m` says. -/
def keepShare (id over : Nat) (d : SignerId) (m : KeepMode) (issuer : VaultId) (select : Selector := .all)
    (wide : Bool := false) (via : List VaultId := []) : Action :=
  newShare id over (.device d) (.keep m) issuer select wide (via := via)

/-- A write that creates entry `e` of vault `v` in audience `x`, holding the content `blob`, with the proof `proof`,
    whose record fits its schemas or not (`fits`), on the main line or, as a draft, starting a line of its own
    (`proposal`); of a cap group entry, the cap group its record says (`defines`). -/
def newEntry (v e : Nat) (actor : VaultId) (x : Audience) (type : Sym) (created : Nat := 0) (tags : List Sym := [])
    (via : List VaultId := []) (epoch : Nat := 0) (proof : Option ShareId := none) (fits : Bool := true)
    (blob : BlobId := 0) (proposal : Proposal := .main) (defines : Option CapGroup := none) : Action :=
  .write v e actor none epoch (proposal := proposal) (via := via) (create := some (x, ⟨type, created, blob⟩))
    (tags := { add := tags }) (proof := proof) (fits := fits) (defines := defines)

/-- A write of entry `e`, in its stay `stay` at epoch `epoch` of that stay's audience, with the proof `proof`, touching
    `touches`, whose result fits the entry's schemas or not (`fits`); of a cap group entry, the cap group its record
    says after it (`defines`); adding the rows `adds`. -/
def wr (v e : Nat) (actor : VaultId) (deps : List EditId := []) (stay : Option EditId := none) (epoch : Nat := 0)
    (proposal : Proposal := .main) (via : List VaultId := []) (add : List Sym := []) (remove : List Sym := [])
    (proof : Option ShareId := none) (touches : List Touch := []) (fits : Bool := true)
    (defines : Option CapGroup := none) (adds : List Ops.Loc := []) : Action :=
  .write v e actor stay epoch deps proposal via (tags := { add, remove }) (proof := proof) (touches := touches)
    (fits := fits) (defines := defines) (adds := adds)

/-- Setting a todo's field `f` to the text `x`. -/
def sets (f x : String) : Touch := .set [.field f] (some (.str x))

/-- Setting a todo's status, to open or done only. -/
def statusOp : Op := .set [.field "status"] (some [.str "open", .str "done"]) none

/-- The default of a code entry's param 1. -/
def paramDefault : Ops.Loc := [.field "params", .row 1, .field "default"]

/-- A Suggester's ops, as the built-in group names them: read, create drafts, write on proposals, start them and merge
    into them. -/
def suggester : List Op := [.read, .create (some .proposals), .set [] none (some .proposals), .propose,
  .merge (some .proposals) []]

/-- A Suggester's ops as they were before drafts: no `create` at all. -/
def oldSuggester : List Op := [.read, .set [] none (some .proposals), .propose, .merge (some .proposals) []]

/-- A tuner's ops: write on proposals, start them, and merge into main what changes the defaults of params alone. -/
def tuner : List Op :=
  [.read, .set [] none (some .proposals), .propose, .merge (some .main) [.field "params", .any, .field "default"]]

/-- Traveler: reads the todos. Citizen: sets their status besides, to open or done, including Traveler. -/
def travelerG : CapGroup := { name := "Traveler", caps := [⟨.read, todos⟩] }
def citizenG : CapGroup := { name := "Citizen", caps := [⟨statusOp, todos⟩], includes := [50] }

def seedKey (v ε : Nat) : KeyName := .scoped (.seed v) ε
def shareKey (v c ε : Nat) : KeyName := .scoped (.share v c) ε
def audienceKey (v : Nat) (x : Audience) (ε : Nat) : KeyName := .scoped (.audience v x) ε

def cases : List Case := [
  { name := "a human vault, its devices and a backup passkey", edits := [
    (1, [], .genesis 100 .human [.signer 1] 1),
    (1, [2], .share (.device 100 2)),
    (1, [3], .share (.device 100 3)),
    -- a device doesn't govern, even with the newcomer's signature
    (2, [77], .share (.device 100 77)),
    -- the newcomer must sign
    (1, [], .share (.device 100 77)),
    (1, [2], .share (.device 100 2)),
    (2, [], .revoke (.device 100 3 [])),
    (2, [], .settings 100 (.threshold 1)),
    (1, [], .settings 100 (.threshold 2)),
    (1, [], .settings 100 (.threshold 0)),
    -- a device leaves on its own
    (3, [], .revoke (.device 100 3 [])),
    (1, [], .revoke (.device 100 3 [])),
    (1, [], .revoke (.owner 100 (.signer 1) [])),
    -- a human vault is owned by signers
    (1, [], .share (.owner 100 (.vault 100))),
    -- a backup passkey joins as a second owner, and later replaces the lost passkey
    (1, [9], .share (.owner 100 (.signer 9))),
    (9, [], .revoke (.owner 100 (.signer 1) [])),
    (9, [77], .share (.device 100 77)),
    (1, [], .share (.device 100 3))] },
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
    (1, [8], .share (.owner 200 (.vault 103))),
    (1, [4], .share (.owner 200 (.vault 103))),
    (2, [5, 8], .share (.owner 200 (.vault 103))),
    (1, [4, 6], .share (.owner 200 (.signer 6))),
    (1, [4, 8], .share (.owner 200 (.vault 103))),
    -- Dave leaves on his own
    (8, [], .revoke (.owner 200 (.vault 103) [])),
    (1, [], .settings 200 (.threshold 1)),
    (1, [4], .settings 200 (.threshold 1)),
    (1, [], .revoke (.owner 200 (.vault 101) [])),
    (1, [], .revoke (.owner 200 (.vault 100) [])),
    -- devices belong to human vaults
    (1, [2], .share (.device 200 2))] },
  { name := "no ownership cycles", edits := humans ++ [
    (1, [], .genesis 200 .coop [.vault 100] 1),
    (1, [], .genesis 201 .coop [.vault 200] 1),
    (1, [], .genesis 202 .coop [.vault 201] 1),
    (1, [], .share (.owner 200 (.vault 200))),
    (1, [], .share (.owner 200 (.vault 201))),
    (1, [], .share (.owner 200 (.vault 202))),
    (1, [4], .share (.owner 201 (.vault 101))),
    -- two paths to the same coop are no cycle
    (1, [], .share (.owner 202 (.vault 200)))] },
  { name := "concurrent changes, in replay order", edits := humans ++ [
    -- two owners remove each other: the first stands, the second would remove the last owner
    (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    (1, [], .revoke (.owner 200 (.vault 101) [])),
    (4, [], .revoke (.owner 200 (.vault 100) [])),
    -- two adds that each are fine alone close a cycle together: the second is refused
    (1, [], .genesis 201 .coop [.vault 100] 1),
    (1, [], .genesis 202 .coop [.vault 100] 1),
    (1, [], .share (.owner 201 (.vault 202))),
    (1, [], .share (.owner 202 (.vault 201))),
    -- removals replay first: without Dave, his co-signature on an add no longer counts
    (1, [4, 8], .genesis 203 .coop [.vault 100, .vault 101, .vault 103] 2),
    (1, [4], .revoke (.owner 203 (.vault 103) [])),
    (8, [1, 6], .share (.owner 203 (.vault 102)))] },
  { name := "the passkey as root", edits := [
    (1, [], .genesis 100 .human [.signer 1] 1 (some 1)),
    -- the root signs the genesis that names it, and a coop has no root
    (4, [], .genesis 101 .human [.signer 4] 1 (some 5)),
    (1, [], .genesis 200 .coop [.vault 100] 1 (some 1)),
    -- a second passkey joins, and the threshold goes up to 2
    (1, [9], .share (.owner 100 (.signer 9))),
    (1, [], .settings 100 (.threshold 2)),
    -- the second passkey alone is below the threshold; the root approves alone
    (9, [2], .share (.device 100 2)),
    (1, [2], .share (.device 100 2)),
    -- the owners hand the root on by the threshold, and the new root signs: the second passkey alone is below it
    (9, [], .settings 100 (.root (some 9) [])),
    (1, [], .settings 100 (.root (some 9) [])),
    (1, [9], .settings 100 (.root (some 9) [])),
    (1, [3], .share (.device 100 3)),
    (9, [3], .share (.device 100 3)),
    -- the root steps down: the threshold rules again
    (9, [], .settings 100 (.root none [])),
    (9, [77], .share (.device 100 77)),
    (9, [], .settings 100 (.root (some 9) []))] },
  { name := "a Mac's Touch ID key as a second owner at threshold 1", edits := [
    (1, [], .genesis 100 .human [.signer 1] 1 (some 1)),
    (1, [2], .share (.device 100 2)),
    -- the key joins only with its own signature, and only by the vault: not by the Mac's device, nor on its own
    (1, [], .share (.owner 100 (.signer 79))),
    (2, [79], .share (.owner 100 (.signer 79))),
    (79, [], .share (.owner 100 (.signer 79))),
    (1, [79], .share (.owner 100 (.signer 79))),
    -- Touch ID alone adds a device and removes it; the Mac's device alone does neither
    (2, [3], .share (.device 100 3)),
    (79, [3], .share (.device 100 3)),
    (2, [], .revoke (.device 100 3 [])),
    (79, [], .revoke (.device 100 3 [])),
    -- an owner like the passkey, it takes the root, and hands it back, the new root signing (every owner equal)
    (79, [], .settings 100 (.root (some 79) [])),
    (79, [1], .settings 100 (.root (some 1) [])),
    -- it takes the passkey off the owners; the passkey stays the root and approves alone
    (79, [], .revoke (.owner 100 (.signer 1) [])),
    (1, [77], .share (.device 100 77)),
    -- the passkey removes the key once it is an owner again, never the last owner
    (1, [], .revoke (.owner 100 (.signer 79) [])),
    (1, [], .share (.owner 100 (.signer 1))),
    (1, [], .revoke (.owner 100 (.signer 79) []))] },
  { name := "a key move: the passkey and the Mac to their ML-DSA-65 keys", edits := [
    (1, [], .genesis 100 .human [.signer 1] 1 (some 1)),
    (1, [2], .share (.device 100 2)),
    -- the passkey's new key joins as an owner, only with its own signature
    (1, [], .share (.owner 100 (.signer 81))),
    (1, [81], .share (.owner 100 (.signer 81))),
    -- every owner being equal, it may take the root itself; no one hands it the root without its signature
    (81, [], .settings 100 (.root (some 81) [])),
    (1, [], .settings 100 (.root (some 81) [])),
    (1, [81], .settings 100 (.root (some 81) [])),
    -- it takes the old key off the owners; the old key approves nothing more
    (81, [], .revoke (.owner 100 (.signer 1) [])),
    (1, [82], .share (.device 100 82)),
    -- the Mac's new key joins, and the old one goes
    (81, [82], .share (.device 100 82)),
    (81, [], .revoke (.device 100 2 [])),
    -- the old Mac is no device of the vault any more: it can't even leave
    (2, [], .revoke (.device 100 2 []))] },
  { name := "four kinds of vault, and acts that name their chain", edits := humans ++ [
    -- the relay server's device vault, owned by Alice's human vault; the server joins as its device
    (1, [], .genesis 300 .deviceVault [.vault 100] 1),
    (1, [600], .share (.device 300 600)),
    -- the server acts for its vault but doesn't govern it; Alice's Mac acts for it through Alice's vault, Bob's Mac not
    (600, [77], .share (.device 300 77)),
    (600, [], newEntry 300 13 300 [] note),
    (2, [], newEntry 300 14 300 [] note (via := [100])),
    (5, [], newEntry 300 15 300 [] note (via := [101])),
    -- signers own human vaults only, and a human vault no vault
    (1, [], .genesis 301 .deviceVault [.signer 1] 1),
    (1, [4], .genesis 201 .coop [.signer 1, .vault 101] 1),
    (1, [4], .share (.owner 100 (.vault 101))),
    -- a device vault owns no vault, and has no root
    (1, [], .genesis 202 .coop [.vault 300] 1),
    (1, [], .genesis 302 .deviceVault [.vault 300] 1),
    (1, [], .genesis 303 .deviceVault [.vault 100] 1 (some 1)),
    -- the coop: a device vault can't join its owners, nor a signer, and it has no devices
    (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    (1, [4], .share (.owner 200 (.vault 300))),
    (1, [9], .share (.owner 200 (.signer 9))),
    (1, [77], .share (.device 200 77)),
    -- a device vault has one owner: no signer joins, nor a second vault; a coop may own one
    (1, [9], .share (.owner 300 (.signer 9))),
    (1, [4], .share (.owner 300 (.vault 101))),
    (1, [], .genesis 304 .deviceVault [.vault 100, .vault 200] 1),
    (1, [], .genesis 305 .deviceVault [.vault 200] 1),
    -- acts for the coop name the human vault they go through: none, or another person's, is refused
    (2, [], newEntry 200 16 200 [] note (via := [100])),
    (2, [], newEntry 200 17 200 [] note),
    (2, [], newEntry 200 18 200 [] note (via := [101])),
    -- a coop of the coop: Bob's Mac acts for it through the coop and Bob's vault, and may skip neither
    (1, [], .genesis 205 .coop [.vault 200] 1),
    (5, [], newEntry 205 19 205 [] note (via := [200, 101])),
    (5, [], newEntry 205 20 205 [] note (via := [101])),
    (5, [], newEntry 205 21 205 [] note (via := [200]))] },
  { name := "an aven: one coop owner, one per coop, its server its device, owning nothing", edits := humans ++ [
    (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    -- the coop's aven, owned by the coop alone; it holds devices, its server 78
    (1, [], .genesis 300 .aven [.vault 200] 1),
    (1, [78], .share (.device 300 78)),
    -- one aven per coop: the coop's second is refused; Bob's own coop founds its
    (1, [], .genesis 301 .aven [.vault 200] 1),
    (4, [], .genesis 201 .coop [.vault 101] 1),
    (4, [], .genesis 302 .aven [.vault 201] 1),
    -- a coop owns an aven, and nothing else does: no human, no two coops, no signer
    (1, [], .genesis 303 .aven [.vault 100] 1),
    (1, [4], .genesis 304 .aven [.vault 200, .vault 201] 1),
    (1, [], .genesis 305 .aven [.signer 1] 1),
    -- an aven has one owner, so Carol doesn't join the coop's
    (1, [6], .share (.owner 300 (.vault 102))),
    -- the aven owns nothing: no agent's device vault, no coop, no aven
    (1, [], .genesis 310 .deviceVault [.vault 300] 1),
    (1, [], .genesis 210 .coop [.vault 300] 1),
    (1, [], .genesis 311 .aven [.vault 300] 1),
    -- Alice's Mac acts for the coop's aven through the coop and her vault; its server acts for it directly, and for
    -- nothing else
    (2, [], newEntry 300 1 300 [] note (via := [200, 100])),
    (78, [], newEntry 300 2 300 [] note),
    (78, [], newEntry 200 3 200 [] note)] },
  { name := "sub caps: a coop passes on to its worker what another coop gave it", edits := humans ++ [
    -- Bob's coop, his second coop and its worker's device vault, whose device is 77
    (4, [], .genesis 200 .coop [.vault 101] 1),
    (4, [], .genesis 300 .coop [.vault 101] 1),
    (4, [], .genesis 310 .deviceVault [.vault 300] 1),
    (4, [77], .share (.device 310 77)),
    -- the coop's two todos, one tagged work, and its write share on its todos for the second coop
    (5, [], newEntry 200 21 200 [] todo (tags := [work]) (via := [101])),
    (5, [], newEntry 200 22 200 [] todo (via := [101])),
    (5, [], newShare 30 200 (toVault 300) .write 200 todos (via := [101])),
    -- the second coop passes the work todos on to its worker's vault, which it owns: a write share resting on 30
    (5, [], newShare 31 200 (toVault 310) .write 300 workTodos (parent := some 30) (via := [101])),
    -- no higher than 30, no wider, to no vault the second coop doesn't own, and the worker's vault passes nothing on
    (4, [], newShare 32 200 (toVault 310) .owner 300 workTodos (parent := some 30) (via := [101])),
    (5, [], newShare 33 200 (toVault 310) .read 300 (wide := true) (parent := some 30) (via := [101])),
    (5, [], newShare 34 200 (toVault 102) .read 300 workTodos (parent := some 30) (via := [101])),
    (77, [], newShare 35 200 (toVault 103) .read 310 workTodos (parent := some 31)),
    -- a steward moves the work todo to the audience of 30 and 31, the other to that of 30
    (5, [], .move 200 21 [30, 31] [] [101]),
    (5, [], .move 200 22 [30] [] [101]),
    -- the worker writes the work todo, not the other one; the second coop writes that one
    (77, [], wr 200 21 310 [10] (stay := some 18) (proof := some 31)),
    (77, [], wr 200 22 310 [11] (stay := some 19) (proof := some 31)),
    (5, [], wr 200 22 300 [11] (stay := some 19) (via := [101]) (proof := some 30)),
    -- the coop revokes the second coop's share, and the worker's share resting on it ends too
    (5, [], .revoke (.grant 30 200 [20, 22] [101])),
    (77, [], wr 200 21 310 [20] (stay := some 18) (proof := some 31)),
    -- a wide read for the second coop, passed on wide to its worker; a wide write can't rest on it
    (5, [], newShare 36 200 (toVault 300) .read 200 (wide := true) (via := [101])),
    (5, [], newShare 37 200 (toVault 310) .read 300 (wide := true) (parent := some 36) (via := [101])),
    (5, [], newShare 38 200 (toVault 310) .write 300 (wide := true) (parent := some 36) (via := [101]))] },
  { name := "shares and everyone", edits := humans ++ [
    (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 2),
    -- Alice's Mac creates the coop's Welcome note in no share's audience, where only the coop reads it; Carol's passkey
    -- can't create for Alice
    (2, [], newEntry 200 1 200 [] note (via := [100])),
    (6, [], newEntry 100 3 100 [] note),
    -- read for Carol's vault, never for a device (DeviceOnlyKeeps) or for the vault itself; everyone only reads
    (2, [], newShare 30 200 (toVault 102) .read 200 (only 1) (via := [100])),
    (2, [], newShare 31 200 (.device 6) .read 200 (only 1) (via := [100])),
    (2, [], newShare 32 200 (toVault 200) .read 200 (only 1) (via := [100])),
    (2, [], newShare 33 200 .everyone .write 200 (only 1) (via := [100])),
    (2, [], newShare 34 200 .everyone .read 200 (only 1) (via := [100])),
    -- a steward moves Welcome to the audience of the shares that select it, whose key is then published
    (2, [], .move 200 1 [30, 34] [] [100]),
    -- making Dave owner of the coop's notes is governance: both passkeys of the threshold-2 coop
    (2, [], newShare 35 200 (toVault 103) .owner 200 notes (via := [100])),
    (1, [4], newShare 36 200 (toVault 103) .owner 200 notes (via := [100])),
    -- Dave shares on through his owner share; naming none, he would have to be the coop
    (8, [], newShare 37 200 (toVault 102) .write 103 (only 1) (parent := some 36)),
    (8, [], newShare 38 200 (toVault 101) .read 103 (only 1)),
    -- a share that rests on another is no wider than it, and none rests on a read share
    (8, [], newShare 39 200 (toVault 101) .read 103 (wide := true) (parent := some 36)),
    (6, [], newShare 40 200 (toVault 101) .read 102 (only 1) (parent := some 30)),
    -- Bob writes for the coop, not for himself
    (5, [], wr 200 1 101 [7] (stay := some 14)),
    (5, [], wr 200 1 200 [7] (stay := some 14) (via := [101])),
    -- Carol's share reaches Welcome only once a steward moves it into its audience
    (6, [], wr 200 1 102 [22] (stay := some 14)),
    (5, [], .move 200 1 [30, 34, 36, 37] [] [101]),
    (6, [], wr 200 1 102 [22] (stay := some 24) (proof := some 37)),
    -- each write builds on writes that were accepted, in a stay of its entry, under the epoch it names: one that
    -- stay's audience hasn't reached too, which nobody opens until the audience does
    (6, [], wr 200 1 102 [99] (stay := some 24) (proof := some 37)),
    (6, [], wr 200 1 102 [25] (stay := some 99) (proof := some 37)),
    (6, [], wr 200 1 102 [25] (stay := some 24) (epoch := 1) (proof := some 37)),
    -- a device that hasn't seen the move writes in the stay before it, and a stranger not at all
    (6, [], wr 200 1 102 [25] (stay := some 14) (proof := some 37)),
    (555, [], wr 200 1 200 [25] (stay := some 24))] },
  { name := "settings, shares and revocations, kind by kind", edits := humans ++ [
    -- settings: a device sets no threshold, and none above the number of owners
    (2, [], .settings 100 (.threshold 1)),
    (1, [], .settings 100 (.threshold 2)),
    -- an owner: a second passkey joins only with its own signature; then two of two approve
    (1, [], .share (.owner 100 (.signer 9))),
    (1, [9], .share (.owner 100 (.signer 9))),
    (1, [], .settings 100 (.threshold 2)),
    (1, [10], .share (.owner 100 (.signer 10))),
    (1, [9, 10], .share (.owner 100 (.signer 10))),
    -- a device: the vault approves, and the device signs
    (1, [9], .share (.device 100 77)),
    (1, [9, 77], .share (.device 100 77)),
    -- revocations: a device or an owner leaves on its own; else the vault approves; never the last owner
    (77, [], .revoke (.device 100 77 [])),
    (10, [], .revoke (.owner 100 (.signer 10) [])),
    (1, [], .revoke (.owner 100 (.signer 9) [])),
    (1, [9], .revoke (.owner 100 (.signer 9) [])),
    (1, [], .revoke (.owner 100 (.signer 1) [])),
    -- Alice's vault has no root; its owner, alone of one now, gives it one, as owners may (every owner equal)
    (1, [], .settings 100 (.root (some 1) [])),
    -- grants: to a vault, not to a device (DeviceOnlyKeeps); owner of a slice is governance; owner of the whole vault
    -- is an owner of it, which no grant makes, even with the vault's approval (WideOwner); a wide read is a grant
    (2, [], newShare 30 100 (toVault 102) .read 100 notes),
    (2, [], newShare 31 100 (.device 7) .read 100 notes),
    (2, [], newShare 32 100 (toVault 103) .owner 100 notes),
    (1, [], newShare 33 100 (toVault 103) .owner 100 notes),
    (1, [], newShare 34 100 (toVault 103) .owner 100 (wide := true)),
    (2, [], newShare 35 100 (toVault 103) .read 100 (wide := true)),
    -- a revoked grant: by a vault that may revoke it, once; an owner grant with the vault's approval
    (8, [], .revoke (.grant 30 103 [])),
    (2, [], .revoke (.grant 30 100 [])),
    (2, [], .revoke (.grant 30 100 [])),
    (2, [], .revoke (.grant 33 100 [])),
    (1, [], .revoke (.grant 33 100 []))] },
  { name := "tags, marks and stewards", edits := humans ++ [
    -- Alice's work todo, her home todo and a note; Bob may write her work todos and ask for the work and home tags,
    -- Carol reads every todo
    (2, [], newEntry 100 21 100 [] todo (tags := [work])),
    (2, [], newEntry 100 22 100 [] todo (tags := [home])),
    (2, [], newEntry 100 1 100 [] note),
    (2, [], newShare 30 100 (toVault 101) .write 100 workTodos
      (ops := some [.read, .create none, .set [] none none, .tag (some [work, home]), .propose, .merge none []])),
    (2, [], newShare 31 100 (toVault 102) .read 100 todos),
    -- the stewards mark each todo with the audience of the shares that select it; the note is where it belongs
    (2, [], .move 100 21 [30, 31] []),
    (2, [], .move 100 22 [31] []),
    (2, [], .move 100 1 [] []),
    -- a mark names only an audience of the vault's own shares, and only a steward marks
    (2, [], .move 100 22 [31, 77] []),
    (5, [], .move 100 22 [30, 31] [] [101]),
    -- Bob writes the work todo, not the home one
    (5, [], wr 100 21 101 [6] (stay := some 11) (proof := some 30)),
    (5, [], wr 100 22 101 [7] (stay := some 12) (proof := some 30)),
    -- Bob asks for the home tag: his tags count for nothing until a device of Alice's vault makes the change
    (5, [], wr 100 21 101 [16] (stay := some 11) (add := [home]) (remove := [work]) (proof := some 30)),
    (2, [], wr 100 21 100 [18] (stay := some 11) (add := [home]) (remove := [work])),
    -- Bob writes again; a steward that hadn't seen it marks the todo out of his slice, and his write goes
    (5, [], wr 100 21 101 [19] (stay := some 11) (proof := some 30)),
    (2, [], .move 100 21 [31] [16, 18]),
    (5, [], wr 100 21 101 [19] (stay := some 21) (proof := some 30)),
    -- Bob creates through his share, in its intake audience only: a work todo, inside his slice, and a note, outside it
    (5, [], newEntry 100 23 101 [30] todo (tags := [work]) (proof := some 30)),
    (5, [], newEntry 100 2 101 [30] note (proof := some 30)),
    (5, [], newEntry 100 24 101 [30, 31] todo (tags := [work]) (proof := some 30)),
    -- Carol only reads, and creates nothing
    (6, [], newEntry 100 25 102 [31] todo),
    -- the stewards mark the work todo with the audience of the shares that select it, and the note with no share's
    -- audience, keeping what Bob made; he can't write the note any more
    (2, [], .move 100 23 [30, 31] [23]),
    (2, [], .move 100 2 [] [24]),
    (5, [], wr 100 2 101 [24] (stay := some 28) (proof := some 30)),
    -- Bob asks for a tag his share doesn't name: whatever else it does, his write counts for no reader
    (5, [], wr 100 23 101 [23] (stay := some 27) (add := [9]) (proof := some 30)),
    -- Alice tags the home todo for work too: its readers see it belongs in Bob's slice, but until a steward marks it,
    -- Bob's share doesn't reach it
    (2, [], wr 100 22 100 [7] (stay := some 12) (add := [work])),
    (5, [], wr 100 22 101 [31] (stay := some 12) (proof := some 30))] },
  { name := "selectors pick by type, author, entry, time and tags", edits := humans ++ [
    (2, [], newEntry 100 1 100 [] note (created := 5)),
    (2, [], newEntry 100 21 100 [] todo (created := 7) (tags := [work])),
    (2, [], newEntry 100 22 100 [] todo (created := 12) (tags := [work, home])),
    (2, [], newEntry 100 23 100 [] todo (created := 3) (tags := [home, 9])),
    -- Bob reads the todos made before 10 with no tags but work and home; Carol Welcome, the second todo and every todo
    -- not tagged work; Dave what Bob makes; and Bob writes every todo
    (2, [], newShare 30 100 (toVault 101) .read 100
      (.anyOf [[.typeIn [todo], .tagsWithin [work, home], .createdIn 0 10]])),
    (2, [], newShare 31 100 (toVault 102) .read 100 (.anyOf [[.entryIn [1, 22]], [.typeIn [todo], .tagNone [work]]])),
    (2, [], newShare 32 100 (toVault 103) .read 100 (.anyOf [[.authorIn [101]]])),
    (2, [], newShare 33 100 (toVault 101) .write 100 todos),
    -- no share over a vault that doesn't exist; Bob creates a todo through his write share
    (2, [], newShare 34 999 (toVault 101) .read 100),
    (5, [], newEntry 100 24 101 [33] todo (proof := some 33)),
    -- the stewards move each entry to the audience of the shares that select it
    (2, [], .move 100 1 [31] []),
    (2, [], .move 100 21 [30, 33] []),
    (2, [], .move 100 22 [31, 33] []),
    (2, [], .move 100 23 [31, 33] []),
    (2, [], .move 100 24 [30, 31, 32, 33] [])] },
  { name := "revocation, cascades and keep lists", edits := humans ++ [
    (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    (2, [], newEntry 100 21 100 [] todo (tags := [work])),
    (2, [], newShare 30 100 (toVault 101) .write 100 workTodos),
    (1, [], newShare 31 100 (toVault 200) .owner 100 todos),
    (2, [], newShare 33 100 (toVault 102) .read 100 todos),
    -- acting for the coop, Bob's Mac gives Dave read through the coop's owner share
    (5, [], newShare 32 100 (toVault 103) .read 200 todos (parent := some 31) (via := [101])),
    (2, [], .move 100 21 [30, 31, 32, 33] []),
    (5, [], wr 100 21 101 [7] (stay := some 12) (proof := some 30)),
    -- Alice takes Bob's own write away, keeping the write she had seen
    (2, [], .revoke (.grant 30 100 [13])),
    (5, [], wr 100 21 101 [13] (stay := some 12) (proof := some 30)),
    -- Bob still writes for the coop, whose owner share reaches the todo, and creates one for it in that share's intake
    -- audience
    (5, [], wr 100 21 200 [13] (stay := some 12) (via := [101]) (proof := some 31)),
    (2, [], wr 100 21 100 [16] (stay := some 12)),
    (5, [], newEntry 100 22 200 [31] todo (via := [101]) (proof := some 31)),
    -- a grantee gives its share up; nobody but its issuer, its vault and those above them in its chain may end it
    (8, [], .revoke (.grant 33 103 [])),
    (6, [], .revoke (.grant 33 102 [])),
    -- taking the coop's owner share away is governance; it ends Dave's read with it, and the coop's write and todo,
    -- which it hadn't seen, and Alice's write that builds on the coop's
    (2, [], .revoke (.grant 31 100 [13])),
    (1, [], .revoke (.grant 31 100 [13])),
    (5, [], wr 100 21 200 [13] (stay := some 12) (via := [101]) (proof := some 31)),
    -- an id is created once, even after its entry fell; a share is revoked once, and only a share that was issued
    (2, [], newEntry 100 22 100 [] todo),
    (2, [], .revoke (.grant 32 100 [])),
    (2, [], .revoke (.grant 99 100 []))] },
  { name := "keys go only where the schedule seals them", edits := humans ++ [
    (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 2),
    (2, [], newEntry 200 1 200 [] note (via := [100])),
    -- Alice's Mac boxes each key to what the schedule seals it to: Welcome's to its audience's, the audience's to the
    -- coop's seed, the coop's seed to its owners' seeds, and her vault's seed to her passkey and her Mac
    (2, [], .keys (.entry 1 none 0) [audienceKey 200 [] 0]),
    (2, [], .keys (audienceKey 200 [] 0) [seedKey 200 0]),
    (2, [], .keys (seedKey 200 0) [seedKey 100 0, seedKey 101 0]),
    (2, [], .keys (seedKey 100 0) [.signer 1, .signer 2]),
    -- and nowhere else: not to a device directly, not to Bob's Mac
    (2, [], .keys (.entry 1 none 0) [.signer 2]),
    (2, [], .keys (seedKey 100 0) [.signer 5]),
    -- only a signer that may open a key boxes it
    (5, [], .keys (seedKey 100 0) []),
    (6, [], .keys (.entry 1 none 0) []),
    -- no key of an epoch, a stay or a family that doesn't exist, and nothing published that isn't public
    (2, [], .keys (audienceKey 200 [] 1) []),
    (2, [], .keys (.entry 1 (some 99) 0) []),
    (2, [], .keys (audienceKey 200 [30] 0) []),
    (2, [], .keys (audienceKey 200 [] 0) [] true),
    -- Carol may read Welcome: a share names her, a steward moves Welcome into its audience, the audience's key is
    -- wrapped under the share's key, and that is sealed to her vault's seed
    (2, [], newShare 30 200 (toVault 102) .read 200 (only 1) (via := [100])),
    (2, [], .move 200 1 [30] [] [100]),
    (2, [], .keys (shareKey 200 30 0) [seedKey 200 0, seedKey 102 0]),
    (6, [], .keys (audienceKey 200 [30] 0) [shareKey 200 30 0]),
    (6, [], .keys (.entry 1 (some 21) 0) [audienceKey 200 [30] 0]),
    -- the key of Welcome's first write is wrapped under Welcome's key now, a link: Carol reads its whole history, and
    -- no key of the audience it left
    (6, [], .keys (.entry 1 none 0) [.entry 1 (some 21) 0]),
    (6, [], .keys (audienceKey 200 [] 0) []),
    -- a move's wraps in one edit (`Wraps.lean`): accepted where each would be as a keys edit; not empty, not another
    -- entry's, not where the schedule doesn't seal it, and one wrap it may not make refuses all of it
    (6, [], .wraps 1 [(.entry 1 none 0, .entry 1 (some 21) 0)]),
    (6, [], .wraps 1 []),
    (6, [], .wraps 3 [(.entry 1 none 0, .entry 1 (some 21) 0)]),
    (6, [], .wraps 1 [(.entry 1 none 0, .entry 1 (some 21) 0), (.entry 1 none 0, .signer 6)]),
    -- a checkpoint (`Checkpoint.lean`) only by the vault's approval: Alice's passkey for her vault, not her Mac; the
    -- threshold-2 coop with both passkeys, not one
    (2, [], .checkpoint 100 [0, 1, 2]),
    (1, [], .checkpoint 100 [0, 1, 2]),
    (1, [], .checkpoint 200 [3, 4]),
    (1, [4], .checkpoint 200 [3, 4]),
    -- a snapshot (`Snapshot.lean`) likewise: only by the vault's approval, and it changes nothing
    (2, [], .snapshot 100 [{ entry := 1, basis := [2], slice := {} }]),
    (1, [], .snapshot 100 [{ entry := 1, basis := [2], slice := {} }]),
    (1, [], .snapshot 200 [{ entry := 1, basis := [2], slice := {} }]),
    (1, [4], .snapshot 200 [{ entry := 1, basis := [2], slice := {} }]),
    -- Welcome goes public: its audience's key is published
    (2, [], newShare 31 200 .everyone .read 200 (only 1) (via := [100])),
    (2, [], .move 200 1 [30, 31] [] [100]),
    (2, [], .keys (audienceKey 200 [30, 31] 0) [] true),
    -- revoking Carol rotates nothing while Welcome is public; making it private again does
    (2, [], .revoke (.grant 30 200 [] [100])),
    (2, [], .revoke (.grant 31 200 [] [100])),
    (2, [], .keys (audienceKey 200 [30, 31] 1) [seedKey 200 0]),
    (2, [], .keys (audienceKey 200 [30, 31] 0) [audienceKey 200 [30, 31] 1]),
    (6, [], .keys (audienceKey 200 [30, 31] 1) []),
    (2, [], .keys (audienceKey 200 [30, 31] 1) [seedKey 102 0])] },
  { name := "a removed device's vault keys all move on", edits := humans ++ [
    (1, [3], .share (.device 100 3)),
    (2, [], newEntry 100 1 100 [] note),
    (2, [], newShare 30 100 (toVault 102) .read 100 notes),
    (2, [], .move 100 1 [30] []),
    -- the iPhone writes Welcome twice, and is lost; Alice removes it, keeping the write she had seen
    (3, [], wr 100 1 100 [7] (stay := some 9)),
    (3, [], wr 100 1 100 [10] (stay := some 9)),
    (1, [], .revoke (.device 100 3 [10])),
    -- the iPhone could open Alice's seed, so her seed, her shares' keys and her audiences' keys all start a new
    -- epoch, which it can't box
    (3, [], .keys (seedKey 100 0) []),
    (2, [], .keys (seedKey 100 1) [.signer 1, .signer 2]),
    (2, [], .keys (seedKey 100 0) [seedKey 100 1]),
    (2, [], .keys (shareKey 100 30 1) [seedKey 100 1, seedKey 102 0]),
    (2, [], .keys (audienceKey 100 [30] 1) [seedKey 100 1, shareKey 100 30 1]),
    (2, [], .keys (audienceKey 100 [30] 1) [shareKey 100 30 0])] },
  { name := "an audience an entry comes back into moves on", edits := humans ++ [
    -- Bob's and Carol's coop reads Alice's work todos
    (4, [6], .genesis 200 .coop [.vault 101, .vault 102] 1),
    (2, [], newEntry 100 21 100 [] todo (tags := [work])),
    (2, [], newShare 30 100 (toVault 200) .read 100 workTodos),
    (2, [], .move 100 21 [30] []),
    -- the todo loses its tag and leaves the audience, which goes out of use; Carol leaves the coop meanwhile, and the
    -- audience's key doesn't move on, since no entry is in it
    (2, [], wr 100 21 100 [7] (stay := some 9) (remove := [work])),
    (2, [], .move 100 21 [] [10]),
    (6, [], .revoke (.owner 200 (.vault 102) [])),
    -- the todo gets its tag back and returns: the audience's key starts a new epoch, which Carol can't open
    (2, [], wr 100 21 100 [10] (stay := some 11) (add := [work])),
    (2, [], .move 100 21 [30] [13]),
    (2, [], .keys (audienceKey 100 [30] 1) [seedKey 100 0, shareKey 100 30 1]),
    (6, [], .keys (audienceKey 100 [30] 1) []),
    (6, [], .keys (audienceKey 100 [30] 0) [])] },
  { name := "a new entry brings an empty audience back into use at the epoch it moves to", edits := humans ++ [
    (4, [6], .genesis 200 .coop [.vault 101, .vault 102] 1),
    (2, [], newEntry 100 21 100 [] todo (tags := [work])),
    (2, [], newShare 30 100 (toVault 200) .read 100 workTodos),
    (2, [], .move 100 21 [30] []),
    (2, [], wr 100 21 100 [7] (stay := some 9) (remove := [work])),
    (2, [], .move 100 21 [] [10]),
    (6, [], .revoke (.owner 200 (.vault 102) [])),
    -- a new work todo, created straight into the empty audience, names the epoch the audience moves to as it comes
    -- back into use, which Carol can't open; so does the next, the audience in use by then. One under a later epoch is
    -- taken too, as no peer checks a write's epoch, and nobody opens it
    (2, [], newEntry 100 22 100 [30] todo (tags := [work]) (epoch := 1)),
    (2, [], newEntry 100 23 100 [30] todo (tags := [work]) (epoch := 1)),
    (2, [], newEntry 100 24 100 [30] todo (tags := [work]) (epoch := 3)),
    (5, [], .keys (audienceKey 100 [30] 1) [shareKey 100 30 1]),
    (6, [], .keys (audienceKey 100 [30] 1) []),
    (6, [], .keys (audienceKey 100 [30] 0) [])] },
  { name := "an entry shared later reaches a copy that never held the audience it was written in", edits := humans ++ [
    -- Carol's copy of what Alice's Mac sends her: Alice wrote her note under epoch 1 of her audience of no shares,
    -- which another note had emptied by going to Bob, and shared it with Carol, by its id. The other note's edits never
    -- reach Carol, so in her copy that audience never had a key and is at epoch 0: she takes the note's writes under
    -- the epoch they name all the same, and Alice's link of their key to the note's key now
    (2, [], newEntry 100 3 100 [] note (epoch := 1)),
    (2, [], wr 100 3 100 [6] (epoch := 1)),
    (2, [], newShare 30 100 (toVault 102) .read 100 (only 3)),
    (2, [], .move 100 3 [30] [6, 7]),
    (2, [], .keys (.entry 3 none 1) [.entry 3 (some 9) 0]),
    (2, [], .keys (audienceKey 100 [30] 0) [seedKey 100 0, shareKey 100 30 0]),
    -- a link under an epoch no write of that stay names is sealed nowhere
    (2, [], .keys (.entry 3 none 2) [.entry 3 (some 9) 0])] },
  { name := "the schema lane", edits := humans ++ [
    (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 2),
    -- Carol may write the whole coop; with its first schema, the coop shares its schemas and lenses with everyone
    (2, [], newShare 30 200 (toVault 102) .write 200 (wide := true) (via := [100])),
    (2, [], newShare 31 200 .everyone .read 200 schemas (via := [100])),
    -- a note, and a write to it that its readers can't tell fits, as before they hold the schema it was written under
    (2, [], newEntry 200 1 200 [] note (via := [100])),
    (2, [], wr 200 1 200 [9] (via := [100]) (fits := false)),
    -- Alice's Mac, acting for the coop, creates a schema entry and a lens entry: their blobs are the coop's lane
    (2, [], newEntry 200 2 200 [31] schemaType (via := [100]) (blob := 1)),
    (2, [], newEntry 200 3 200 [31] lensType (via := [100]) (blob := 2)),
    -- now its readers hold the schema, a write that fits it counts
    (2, [], wr 200 1 200 [9] (via := [100])),
    -- a later write to the schema entry, tags and all, changes nothing in the lane
    (2, [], wr 200 2 200 [11] (via := [100]) (add := [work])),
    -- Bob's Mac acts for the coop too: the same blob again adds nothing, a new lens adds itself
    (5, [], newEntry 200 4 200 [31] schemaType (via := [101]) (blob := 1)),
    (5, [], newEntry 200 5 200 [31] lensType (via := [101]) (blob := 3)),
    -- Carol creates a schema entry through her share, which every peer accepts, but it acts for her and puts nothing in
    -- the coop's lane; she may not act for the coop, whose owner her vault isn't; nor may a stranger, and no vault
    -- that doesn't exist has an entry
    (6, [], newEntry 200 6 102 [] schemaType (proof := some 30) (blob := 4)),
    (6, [], newEntry 200 7 200 [31] schemaType (via := [102]) (blob := 4)),
    (555, [], newEntry 200 7 200 [31] schemaType (blob := 4)),
    (2, [], newEntry 299 7 200 [31] schemaType (via := [100]) (blob := 4)),
    -- owner of the whole coop is an owner of it, which no grant makes, even with both passkeys (WideOwner), so Dave
    -- creates nothing there; Carol, owner of the coop's notes, creates in her share's intake audience, for herself
    (1, [4], newShare 32 200 (toVault 103) .owner 200 (wide := true) (via := [100])),
    (8, [], newEntry 200 7 103 [] schemaType (blob := 4)),
    (1, [4], newShare 33 200 (toVault 102) .owner 200 notes (via := [100])),
    (6, [], newEntry 200 7 102 [33] schemaType (proof := some 33) (blob := 5)),
    -- Alice's own vault, with its own share to everyone, holds the same blob as a schema of its own
    (2, [], newShare 34 100 .everyone .read 100 schemas),
    (2, [], newEntry 100 8 100 [34] schemaType (blob := 1)),
    -- a schema entry its readers don't count puts nothing in the lane
    (2, [], newEntry 200 9 200 [31] schemaType (via := [100]) (fits := false) (blob := 6))] },
  { name := "proposals of an entry", edits := humans ++ [
    (2, [], newEntry 100 1 100 [] note),
    (2, [], newShare 30 100 (toVault 101) .write 100 (only 1)),
    (2, [], newShare 31 100 (toVault 102) .read 100 (only 1)),
    (2, [], .move 100 1 [30, 31] []),
    -- Bob's Mac starts a draft of Welcome from its first version and writes on it
    (5, [], wr 100 1 101 [6] (stay := some 9) (proposal := .new) (proof := some 30) (touches := [.propose])),
    (5, [], wr 100 1 101 [10] (stay := some 9) (proposal := .on 10) (proof := some 30)),
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
    (5, [], wr 100 1 101 [11] (stay := some 9) (proposal := .on 10) (proof := some 30)),
    (5, [], wr 100 1 101 [19, 20] (stay := some 9) (proposal := .on 10) (proof := some 30) (touches := [.merge])),
    -- Alice's Mac starts a proposal of its own from the merge, and Bob writes on it
    (2, [], wr 100 1 100 [19] (stay := some 9) (proposal := .new)),
    (5, [], wr 100 1 101 [22] (stay := some 9) (proposal := .on 22) (proof := some 30))] },
  { name := "ops: a write share that may only set a todo's status", edits := humans ++ [
    -- Alice's todo; Bob may set its status, to open or done, and Carol reads it
    (2, [], newEntry 100 21 100 [] todo),
    (2, [], newShare 30 100 (toVault 101) .write 100 todos (ops := some [.read, statusOp])),
    (2, [], newShare 31 100 (toVault 102) .read 100 todos),
    (2, [], .move 100 21 [30, 31] []),
    -- every write below is accepted, as relays see it; its readers count only what the ops allow, with the proof that
    -- names Bob's share
    (5, [], wr 100 21 101 [6] (stay := some 9) (proof := some 30) (touches := [sets "status" "done"])),
    (5, [], wr 100 21 101 [10] (stay := some 9) (proof := some 30) (touches := [sets "title" "Lamp"])),
    -- what builds on a write they don't count, they don't count either
    (5, [], wr 100 21 101 [11] (stay := some 9) (proof := some 30) (touches := [sets "status" "open"])),
    -- a write through a share needs a proof that names a share its actor holds, and the values the op lists
    (5, [], wr 100 21 101 [10] (stay := some 9) (touches := [sets "status" "open"])),
    (5, [], wr 100 21 101 [10] (stay := some 9) (proof := some 31) (touches := [sets "status" "open"])),
    (5, [], wr 100 21 101 [10] (stay := some 9) (proof := some 30) (touches := [sets "status" "lost"])),
    -- the vault itself writes anything
    (2, [], wr 100 21 100 [10] (stay := some 9) (touches := [sets "title" "Lamp"])),
    -- Bob's share has no op to create: his todo is accepted, but not counted, and not let into his slice
    (5, [], newEntry 100 22 101 [30] todo (proof := some 30)),
    -- a second share lets him create todos, add their items and set their status; not edit an item or remove one
    (2, [], newShare 32 100 (toVault 101) .write 100 todos (ops := some [.read, .create none, statusOp,
      .insert [.field "items"] none])),
    (5, [], newEntry 100 23 101 [32] todo (proof := some 32)),
    (5, [], wr 100 23 101 [19] (proof := some 32) (touches := [.insert [.field "items"]])),
    (5, [], wr 100 23 101 [20] (proof := some 32) (touches := [.set [.field "items", .row 1, .field "text"] (some (.str "milk"))])),
    (5, [], wr 100 23 101 [20] (proof := some 32) (touches := [.remove [.field "items"]])),
    -- ops never widen a share: Carol reads, and writes nothing, whatever proof she names
    (6, [], wr 100 21 102 [10] (stay := some 9) (proof := some 31) (touches := [sets "status" "done"])),
    -- at any depth: adding items reaches the lists of records in an item, but no other change in them
    (5, [], wr 100 23 101 [20] (proof := some 32) (touches := [.insert [.field "items", .row 1, .field "steps"]])),
    (5, [], wr 100 23 101 [24] (proof := some 32)
      (touches := [.set [.field "items", .row 1, .field "steps", .row 2, .field "text"] (some (.str "rinse"))])),
    (5, [], wr 100 23 101 [24] (proof := some 32) (touches := [.move [.field "items", .row 1, .field "steps"]]))] },
  { name := "ops: a chain narrows the shares resting on it, and a suggester writes on proposals",
    edits := humans ++ [
    (2, [], newEntry 100 21 100 [] todo),
    -- Alice's passkey makes Dave owner of her todos, narrowed: he may set their status, create them and share
    (1, [], newShare 30 100 (toVault 103) .owner 100 todos
      (ops := some [.read, .create none, .set [.field "status"] none none, .share])),
    -- Dave lets Carol set anything, which his own ops still narrow, and Bob edit, as his level's group says
    (8, [], newShare 31 100 (toVault 102) .write 103 todos (parent := some 30)
      (ops := some [.read, .set [] none none])),
    (8, [], newShare 32 100 (toVault 101) .write 103 todos (parent := some 30)),
    -- Alice lets Carol suggest: start proposals and write on them
    (2, [], newShare 33 100 (toVault 102) .write 100 todos
      (ops := some [.read, .set [] none (some .proposals), .propose])),
    (2, [], .move 100 21 [30, 31, 32, 33] []),
    (6, [], wr 100 21 102 [6] (stay := some 11) (proof := some 31) (touches := [sets "status" "done"])),
    (6, [], wr 100 21 102 [12] (stay := some 11) (proof := some 31) (touches := [sets "title" "Lamp"])),
    (5, [], wr 100 21 101 [12] (stay := some 11) (proof := some 32) (touches := [sets "status" "open"])),
    (5, [], wr 100 21 101 [14] (stay := some 11) (touches := [sets "status" "done"])),
    -- Carol's suggestion counts on its proposal, not on the main line
    (6, [], wr 100 21 102 [14] (stay := some 11) (proposal := .new) (proof := some 33) (touches := [.propose])),
    (6, [], wr 100 21 102 [16] (stay := some 11) (proposal := .on 16) (proof := some 33)
      (touches := [sets "title" "Desk lamp"])),
    (6, [], wr 100 21 102 [14] (stay := some 11) (proof := some 33) (touches := [sets "title" "Desk lamp"])),
    -- Alice merges it
    (2, [], wr 100 21 100 [14, 17] (stay := some 11) (touches := [.merge, sets "title" "Desk lamp"])),
    -- Dave creates through his share; Carol's chain doesn't let her
    (8, [], newEntry 100 22 103 [30] todo (proof := some 30)),
    (6, [], newEntry 100 24 102 [30, 31] todo (proof := some 31)),
    -- a share rests only on an owner share, so Bob can't pass his own on to Carol, even narrowed
    (5, [], newShare 34 100 (toVault 102) .write 101 todos (parent := some 32) (ops := some [.read, statusOp])),
    -- a share whose level isn't the class of its ops lets nothing through, nor does any share resting on it: a write
    -- share for Bob that names an owner's ops, and an owner share for Carol that names an editor's
    (2, [], newShare 35 100 (toVault 101) .write 100 todos (ops := some Level.owner.ops)),
    (1, [], newShare 36 100 (toVault 102) .owner 100 todos (ops := some Level.write.ops)),
    (6, [], newShare 37 100 (toVault 101) .write 102 todos (parent := some 36)),
    (2, [], .move 100 21 [30, 31, 32, 33, 35, 36, 37] []),
    (5, [], wr 100 21 101 [19] (stay := some 26) (proof := some 35) (touches := [sets "status" "open"])),
    (5, [], wr 100 21 101 [19] (stay := some 26) (proof := some 37) (touches := [sets "status" "open"])),
    (6, [], wr 100 21 102 [19] (stay := some 26) (proof := some 36) (touches := [sets "status" "open"]))] },
  { name := "ops: a tuner merges new defaults of its params into main, and nothing else", edits := humans ++ [
    (2, [], newEntry 100 1 100 [] note),
    -- Bob tunes Alice's note: he may write on proposals and merge into main what changes the defaults of its params
    (2, [], newShare 30 100 (toVault 101) .write 100 (only 1) (ops := some tuner)),
    (2, [], .move 100 1 [30] []),
    -- he proposes a new default, Alice accepts it, and he merges it: all it brings in is under his merge's path
    (5, [], wr 100 1 101 [6] (stay := some 8) (proposal := .new) (proof := some 30) (touches := [.propose])),
    (5, [], wr 100 1 101 [9] (stay := some 8) (proposal := .on 9) (proof := some 30)
      (touches := [.set paramDefault (some (.int 3))])),
    (2, [], wr 100 1 100 [10] (stay := some 8) (proposal := .on 9)),
    (5, [], wr 100 1 101 [6, 11] (stay := some 8) (proof := some 30) (touches := [.merge, .merged paramDefault])),
    -- a proposal that changes the source too he writes, and Alice accepts, but his merge of it counts for no reader
    (5, [], wr 100 1 101 [12] (stay := some 8) (proposal := .new) (proof := some 30) (touches := [.propose])),
    (5, [], wr 100 1 101 [13] (stay := some 8) (proposal := .on 13) (proof := some 30)
      (touches := [.set paramDefault (some (.int 4)), sets "source" "fn main"])),
    (2, [], wr 100 1 100 [14] (stay := some 8) (proposal := .on 13)),
    (5, [], wr 100 1 101 [12, 15] (stay := some 8) (proof := some 30)
      (touches := [.merge, .merged paramDefault, .merged [.field "source"]])),
    -- nor does a merge of the first into a proposal, which his merge's line doesn't name
    (5, [], wr 100 1 101 [12] (stay := some 8) (proposal := .new) (proof := some 30) (touches := [.propose])),
    (5, [], wr 100 1 101 [17, 11] (stay := some 8) (proposal := .on 17) (proof := some 30)
      (touches := [.merge, .merged paramDefault])),
    -- Alice merges anything; nobody merges what the entry doesn't hold, which every peer refuses
    (2, [], wr 100 1 100 [12, 15] (stay := some 8)
      (touches := [.merge, .merged paramDefault, .merged [.field "source"]])),
    (5, [], wr 100 1 101 [12, 99] (stay := some 8) (proof := some 30) (touches := [.merge, .merged paramDefault]))] },
  { name := "merges by policy: one of the vault's owners accepts what anyone else merges into main",
    edits := humans ++ [
    (2, [], newEntry 100 1 100 [] note),
    -- Bob edits Alice's note: his share lets him merge, on any line
    (2, [], newShare 30 100 (toVault 101) .write 100 (only 1)),
    (2, [], .move 100 1 [30] []),
    -- he proposes a title and merges it, which counts for no reader until Alice accepts it, by a write on it that
    -- changes nothing; then his merge on top of her accept counts
    (5, [], wr 100 1 101 [6] (stay := some 8) (proposal := .new) (proof := some 30) (touches := [.propose])),
    (5, [], wr 100 1 101 [9] (stay := some 8) (proposal := .on 9) (proof := some 30)
      (touches := [sets "title" "Lamp"])),
    (5, [], wr 100 1 101 [6, 10] (stay := some 8) (proof := some 30) (touches := [.merge])),
    (2, [], wr 100 1 100 [10] (stay := some 8) (proposal := .on 9)),
    (5, [], wr 100 1 101 [6, 12] (stay := some 8) (proof := some 30) (touches := [.merge])),
    -- his own write that changes nothing accepts nothing, nor does a write of Alice's that changes the proposal
    (5, [], wr 100 1 101 [13] (stay := some 8) (proposal := .new) (proof := some 30) (touches := [.propose])),
    (5, [], wr 100 1 101 [14] (stay := some 8) (proposal := .on 14) (proof := some 30)),
    (5, [], wr 100 1 101 [13, 15] (stay := some 8) (proof := some 30) (touches := [.merge])),
    (2, [], wr 100 1 100 [15] (stay := some 8) (proposal := .on 14) (touches := [sets "title" "Desk lamp"])),
    (5, [], wr 100 1 101 [13, 17] (stay := some 8) (proof := some 30) (touches := [.merge])),
    -- Alice accepts it; what Bob writes on it after her accept, his merge can't bring in
    (2, [], wr 100 1 100 [17] (stay := some 8) (proposal := .on 14)),
    (5, [], wr 100 1 101 [19] (stay := some 8) (proposal := .on 14) (proof := some 30)
      (touches := [sets "title" "Desk"])),
    (5, [], wr 100 1 101 [13, 20] (stay := some 8) (proof := some 30) (touches := [.merge])),
    (5, [], wr 100 1 101 [13, 19] (stay := some 8) (proof := some 30) (touches := [.merge])),
    -- a merge into a proposal needs no accept; Alice's own merge of what came after needs none either
    (5, [], wr 100 1 101 [20, 22] (stay := some 8) (proposal := .on 14) (proof := some 30) (touches := [.merge])),
    (2, [], wr 100 1 100 [22, 23] (stay := some 8) (touches := [.merge])),
    -- a write of Alice's on main that changes nothing accepts nothing; a stranger's merge every peer refuses
    (2, [], wr 100 1 100 [24] (stay := some 8)),
    (5, [], wr 100 1 101 [25, 23] (stay := some 8) (proof := some 30) (touches := [.merge])),
    (555, [], wr 100 1 103 [24, 23] (stay := some 8) (touches := [.merge]))] },
  { name := "drafts: a suggester proposes a new entry on a line of its own, and only the vault lands it",
    edits := humans ++ [
    -- Bob suggests on Alice's notes, Carol edits them, everyone reads them, and Dave holds a Suggester share made
    -- before drafts, with no create
    (2, [], newShare 30 100 (toVault 101) .write 100 notes (ops := some suggester)),
    (2, [], newShare 31 100 (toVault 102) .write 100 notes),
    (2, [], newShare 32 100 .everyone .read 100 notes),
    (2, [], newShare 33 100 (toVault 103) .write 100 notes (ops := some oldSuggester)),
    -- Bob drafts a note: one write that creates the entry and starts its own line, in his share's intake audience,
    -- which every reader counts; a creation on a line that already is, every peer refuses
    (5, [], newEntry 100 1 101 [30] note (proof := some 30) (proposal := .new)),
    (5, [], newEntry 100 2 101 [30] note (proof := some 30) (proposal := .on 10)),
    -- his creation on main, and Dave's draft through the old share, are accepted but counted by no reader
    (5, [], newEntry 100 2 101 [30] note (proof := some 30)),
    (8, [], newEntry 100 3 103 [33] note (proof := some 33) (proposal := .new)),
    -- Bob writes on his draft's line
    (5, [], wr 100 1 101 [10] (proposal := .on 10) (proof := some 30) (touches := [sets "title" "Harvest rules"])),
    -- a steward marks the draft into the audience its shares select, the share to everyone left out until it lands
    (2, [], .move 100 1 [30, 31, 33] [10, 14]),
    -- before it lands, no share's write on its main line counts: Bob's merge, Carol's own write building on nothing,
    -- nor Carol's merge on top of Alice's accept
    (5, [], wr 100 1 101 [14] (stay := some 15) (proof := some 30) (touches := [.merge])),
    (6, [], wr 100 1 102 [] (stay := some 15) (proof := some 31) (touches := [sets "title" "Mine"])),
    (2, [], wr 100 1 100 [14] (stay := some 15) (proposal := .on 10)),
    (6, [], wr 100 1 102 [18] (stay := some 15) (proof := some 31) (touches := [.merge])),
    -- Alice's merge on top of her accept lands it: main's history now holds its creation
    (2, [], wr 100 1 100 [18] (stay := some 15) (touches := [.merge])),
    -- a steward marks it into its whole audience, everyone's share too, and Carol's writes on main count again
    (2, [], .move 100 1 [30, 31, 32, 33] [10, 14, 16, 17, 18, 19, 20]),
    (6, [], wr 100 1 102 [20] (stay := some 21) (proof := some 31) (touches := [sets "title" "Harvest"])),
    -- Alice shares her schemas with everyone; a draft of a schema, even once her own merge lands it, joins no lane,
    -- where a schema created on main does
    (2, [], newShare 34 100 .everyone .read 100 schemas),
    (2, [], newEntry 100 4 100 [34] schemaType (blob := 1) (proposal := .new)),
    (2, [], wr 100 4 100 [24] (touches := [.merge])),
    (2, [], newEntry 100 5 100 [34] schemaType (blob := 2)),
    -- a draft of Bob's and one of Alice's that never land: their semantic audiences leave everyone out
    (5, [], newEntry 100 6 101 [30] note (proof := some 30) (proposal := .new)),
    (2, [], newEntry 100 7 100 [34] schemaType (blob := 3) (proposal := .new))] },
  { name := "schemas: a write whose result doesn't fit its schemas counts for no reader", edits := humans ++ [
    -- Alice's todo, which Bob may write
    (2, [], newEntry 100 21 100 [] todo),
    (2, [], newShare 30 100 (toVault 101) .write 100 todos),
    (2, [], .move 100 21 [30] []),
    -- every write below is accepted, as relays see it; its readers count only what fits, and what builds on it
    (5, [], wr 100 21 101 [6] (stay := some 8) (proof := some 30)),
    (5, [], wr 100 21 101 [9] (stay := some 8) (fits := false) (proof := some 30)),
    (5, [], wr 100 21 101 [10] (stay := some 8) (proof := some 30)),
    -- the vault itself writes nothing that doesn't fit either
    (2, [], wr 100 21 100 [9] (stay := some 8) (fits := false)),
    (2, [], wr 100 21 100 [9] (stay := some 8)),
    -- nor creates: a todo that doesn't fit counts for no reader, nor a write on it
    (2, [], newEntry 100 22 100 [] todo (fits := false)),
    (2, [], wr 100 22 100 [14]),
    -- fitting is no share: Carol holds none, and writes nothing
    (6, [], wr 100 21 102 [9] (stay := some 8))] },
  { name := "keep shares: each device syncs what its keep shares pick", edits := humans ++ [
    (1, [3], .share (.device 100 3)),
    (6, [7], .share (.device 102 7)),
    -- Alice's note and her work todo; Carol reads her notes
    (2, [], newEntry 100 1 100 [] note),
    (2, [], newEntry 100 21 100 [] todo (tags := [work])),
    (2, [], newShare 30 100 (toVault 102) .read 100 notes),
    -- Alice's iPhone syncs her notes and keeps their files whole, her Mac all of her vault, fetching what it opens
    (2, [], keepShare 40 100 3 .whole 100 notes),
    (2, [], keepShare 41 100 2 .opened 100 (wide := true)),
    -- a vault keeps entries on its own devices only (NotDevice), acting for itself (NotActing), over a vault whose
    -- entries it may hold (NoCap)
    (2, [], keepShare 42 100 5 .opened 100 (wide := true)),
    (5, [], keepShare 44 100 3 .opened 100 (wide := true)),
    (2, [], keepShare 45 101 3 .opened 100 (wide := true)),
    -- Carol, who holds a share over Alice's vault, keeps some of it on her Mac
    (7, [], keepShare 43 100 7 .opened 102 (.anyOf [[.typeIn [note]], [.tagHas work]])),
    -- Alice's Mac marks the keep shares that pick each entry; a wide one picks it without marks
    (2, [], .pick 100 1 [40, 43]),
    (2, [], .pick 100 21 [43]),
    (2, [], .pick 100 21 [41]),
    (2, [], .pick 100 1 [43, 40]),
    (2, [], .pick 100 1 [40, 43]),
    -- only a steward marks
    (5, [], .pick 100 1 [40]),
    (7, [], .pick 100 1 [43]),
    -- only the vault that issued a keep share revokes it, once: Carol can't revoke Alice's, nor can Alice's vault,
    -- which Carol's is over, revoke Carol's
    (7, [], .revoke (.grant 40 102 [])),
    (2, [], .revoke (.grant 40 100 [])),
    (2, [], .revoke (.grant 40 100 [])),
    (2, [], .revoke (.grant 43 102 [])),
    (2, [], .revoke (.grant 43 100 [])),
    -- a mark may name a revoked keep share, which readers leave out: no revocation refuses a mark that sorts after it
    (2, [], .pick 100 1 [40]),
    (2, [], .pick 100 1 [43]),
    (2, [], .pick 100 999 [43])] },
  { name := "marks, part by part", edits := humans ++ [
    (1, [3], .share (.device 100 3)),
    -- Alice's work todo; Bob writes her todos, Carol reads her work todos; her iPhone syncs her todos, her Mac all
    (2, [], newEntry 100 21 100 [] todo (tags := [work])),
    (2, [], newShare 30 100 (toVault 101) .write 100 todos),
    (2, [], newShare 31 100 (toVault 102) .read 100 workTodos),
    (2, [], keepShare 40 100 3 .whole 100 todos),
    (2, [], keepShare 41 100 2 .opened 100 (wide := true)),
    -- a mark names an audience, the keep shares that pick the entry, or both; and keeps what it had seen only where it
    -- takes the entry to a new audience (BadMark)
    (2, [], .mark 100 21 none none [] []),
    (2, [], .mark 100 21 none (some [40]) [7] []),
    -- one mark takes the todo to the audience of the shares that select it, and marks the keep share that picks it
    (2, [], .mark 100 21 (some [30, 31]) (some [40]) [7] []),
    -- the same audience again (SameAudience), the same wants alone (SameWants)
    (2, [], .move 100 21 [30, 31] []),
    (2, [], .pick 100 21 [40]),
    -- an audience naming a share that isn't one of the vault's (BadAudience), a wide keep share among the wants, an
    -- entry of another vault (WrongVault), and a mark by a device that doesn't act for the vault (NotActing)
    (2, [], .move 100 21 [30, 77] []),
    (2, [], .pick 100 21 [41]),
    (5, [], .pick 101 21 []),
    (5, [], .pick 100 21 [] [101]),
    -- Carol's share ends: a new audience with the same wants takes the todo out of it, and leaves the wants as they are
    (2, [], .revoke (.grant 31 100 [])),
    (2, [], .mark 100 21 (some [30]) (some [40]) [7] []),
    -- the iPhone's keep share is revoked; a mark may still name both revoked shares, which readers leave out
    (2, [], .revoke (.grant 40 100 [])),
    (2, [], .mark 100 21 (some [30, 31]) (some [40]) [7] []),
    -- the wants alone, which leave the audience as it is
    (2, [], .pick 100 21 []),
    -- Dave's share and a new keep share of the iPhone select the todo: a steward has one mark to make, with both
    (2, [], newShare 32 100 (toVault 103) .read 100 todos),
    (2, [], keepShare 42 100 3 .opened 100 workTodos)] },
  { name := "keep shares: modes, refusals and a device that leaves", edits := humans ++ [
    (1, [3], .share (.device 100 3)),
    (1, [77], .share (.device 100 77)),
    (6, [7], .share (.device 102 7)),
    -- Alice's note, her todo, her work todo and her vault's schema; Carol reads her notes
    (2, [], newEntry 100 1 100 [] note),
    (2, [], newEntry 100 21 100 [] todo),
    (2, [], newEntry 100 22 100 [] todo (tags := [work])),
    (2, [], newEntry 100 2 100 [] schemaType),
    (2, [], newShare 30 100 (toVault 102) .read 100 notes),
    -- a keep share names a device (KeepNeedsDevice), a share naming a device is a keep share (DeviceOnlyKeeps), and a
    -- keep share rests on no share
    (2, [], newShare 46 100 (toVault 102) (.keep .whole) 100 notes),
    (2, [], newShare 47 100 .everyone (.keep .whole) 100 notes),
    (2, [], newShare 48 100 (.device 3) .backup 100 notes),
    (2, [], newShare 49 100 (.device 3) (.keep .whole) 100 notes (parent := some 30)),
    -- the iPhone keeps notes whole, fetches todos as it opens them, and never syncs work todos
    (2, [], keepShare 40 100 3 .whole 100 notes),
    (2, [], keepShare 41 100 3 .opened 100 todos),
    (2, [], keepShare 42 100 3 .never 100 workTodos),
    -- the tablet never syncs notes, and so syncs the rest
    (2, [], keepShare 43 100 77 .never 100 notes),
    -- Carol keeps on her Mac all of Alice's vault she may receive
    (7, [], keepShare 44 100 7 .opened 102 (wide := true)),
    -- the Mac marks each entry with the keep shares that pick it: a whole or opened one picks the schema too, a never
    -- one never does
    (2, [], .pick 100 1 [40, 43]),
    (2, [], .pick 100 21 [41]),
    (2, [], .pick 100 22 [41, 42]),
    (2, [], .pick 100 2 [40, 41]),
    -- the wants name no wide keep share (BadWants)
    (2, [], .pick 100 1 [40, 43, 44]),
    -- the vault Carol's keep share is over can't revoke it; her Mac can
    (2, [], .revoke (.grant 44 100 [])),
    (7, [], .revoke (.grant 44 102 [])),
    -- the tablet leaves Alice's vault: its keep share, still live, no longer applies, and it gets no new one
    (77, [], .revoke (.device 100 77 [])),
    (2, [], keepShare 45 100 77 .whole 100 todos),
    -- Carol's Mac keeps a full copy: a wide whole keep share over her own vault, its copy setting, stands for every
    -- vault where it has no keep share of its own, so it keeps Alice's notes whole now that hers there is revoked
    (7, [], keepShare 50 102 7 .whole 102 (wide := true))] },
  { name := "cap groups: a share names a group, which its vault versions", edits := humans ++ [
    -- Alice's cap groups, entries of her own: Traveler reads the todos, Citizen sets their status besides
    (2, [], newEntry 100 50 100 [] capGroupType (defines := some travelerG)),
    (2, [], newEntry 100 51 100 [] capGroupType (defines := some citizenG)),
    -- Bob holds Citizen with write, Carol with read, which bounds it to reading
    (2, [], groupShare 30 100 (toVault 101) .write 51),
    (2, [], groupShare 31 100 (toVault 102) .read 51),
    (2, [], newEntry 100 21 100 [30, 31] todo),
    (2, [], newEntry 100 3 100 [] note),
    -- every share selects the vault's cap groups: a steward marks them into both audiences
    (2, [], .move 100 50 [30, 31] [6]),
    (2, [], .move 100 51 [30, 31] [7]),
    -- Bob's status counts; a title, or a status Citizen doesn't list, is accepted and counted by no reader
    (5, [], wr 100 21 101 [10] (proof := some 30) (touches := [sets "status" "done"])),
    (5, [], wr 100 21 101 [10] (proof := some 30) (touches := [sets "title" "Lamp"])),
    (5, [], wr 100 21 101 [10] (proof := some 30) (touches := [sets "status" "lost"])),
    -- Carol's share is read: no peer takes her write
    (6, [], wr 100 21 102 [10] (proof := some 31) (touches := [sets "status" "done"])),
    -- Bob reaches Citizen's entry, but a version he writes counts nowhere and makes no new version
    (5, [], wr 100 51 101 [7] (stay := some 13) (proof := some 30) (touches := [.set [] none])
      (defines := some { citizenG with caps := [⟨.set [] none none, .all⟩] })),
    -- Alice narrows Citizen to Traveler alone, and Bob's next status counts no more
    (2, [], wr 100 51 100 [7] (stay := some 13) (touches := [sets "caps" "none"]) (defines := some { citizenG with caps := [] })),
    (5, [], wr 100 21 101 [14] (proof := some 30) (touches := [sets "status" "open"])),
    -- a version on a proposal changes nothing until it lands on main
    (2, [], wr 100 51 100 [19] (stay := some 13) (proposal := .new) (touches := [.propose]) (defines := some citizenG)),
    (5, [], wr 100 21 101 [14] (proof := some 30) (touches := [sets "status" "done"])),
    -- an entry of the cap group type Bob creates is no cap group of Alice's, and Citizen lets him create nothing
    (5, [], newEntry 100 52 101 [30] capGroupType (proof := some 30)
      (defines := some { name := "Mine", caps := [⟨.set [] none none, .all⟩] }))] },
  { name := "invites: a share to a one-time key, claimed once by the vault it invites", edits := humans ++ [
    (2, [], newEntry 100 50 100 [] capGroupType (defines := some travelerG)),
    -- Alice invites with Traveler; an invite makes no owner
    (2, [], groupShare 31 100 (.invite 700) .read 50),
    (2, [], groupShare 32 100 (.invite 701) .owner 50),
    (2, [], newEntry 100 21 100 [31] todo),
    (2, [], .move 100 50 [31] [6]),
    -- a claim takes the invite key's signature and a member of the vault that claims; nor does Alice claim her own
    (6, [], .claim 31 102),
    (4, [700], .claim 31 102),
    (2, [700], .claim 31 100),
    -- Carol claims it: the share names her vault from now on, and nobody claims it again
    (6, [700], .claim 31 102),
    (8, [700], .claim 31 103),
    -- a share that names a vault is no invite, and a revoked invite is claimed by nobody
    (2, [], newShare 33 100 (toVault 103) .read 100 todos),
    (6, [700], .claim 33 102),
    (2, [], groupShare 34 100 (.invite 702) .read 50),
    (2, [], .revoke (.grant 34 100 [])),
    (8, [702], .claim 34 103)] },
  { name := "rooms: Member adds rows and changes only its own", edits := humans ++ [
    -- Alice's room, shared with Bob and Carol in Member
    (2, [], newShare 30 100 (toVault 101) .write 100 (.anyOf [[.entryIn [81]]]) (ops := some memberOps)),
    (2, [], newShare 31 100 (toVault 102) .write 100 (.anyOf [[.entryIn [81]]]) (ops := some memberOps)),
    (2, [], newEntry 100 81 100 [30, 31] 41),
    -- Bob posts message 1, Carol reacts to it with reaction 2
    (5, [], wr 100 81 101 [8] (proof := some 30) (touches := [.insert [.field "messages"]])
      (adds := [[.field "messages", .row 1]])),
    (6, [], wr 100 81 102 [9] (proof := some 31) (touches := [.insert [.field "messages", .row 1, .field "reactions"]])
      (adds := [[.field "messages", .row 1, .field "reactions", .row 2]])),
    -- Bob edits his message; Carol's edit of it counts nowhere, even where it claims to be her own
    (5, [], wr 100 81 101 [9] (proof := some 30) (touches := [.set [.field "messages", .row 1, .field "text"] (some (.str "hi!"))])),
    (6, [], wr 100 81 102 [9] (proof := some 31) (touches := [.set [.field "messages", .row 1, .field "text"] (some (.str "mine"))])),
    (6, [], wr 100 81 102 [9] (proof := some 31) (touches := [.own [.field "messages", .row 1, .field "text"] (some (.str "mine"))])),
    -- Carol takes back her reaction; Bob can't
    (6, [], wr 100 81 102 [10] (proof := some 31)
      (touches := [.set [.field "messages", .row 1, .field "reactions", .row 2, .field "deleted"] (some (.bool true))])),
    (5, [], wr 100 81 101 [10] (proof := some 30)
      (touches := [.set [.field "messages", .row 1, .field "reactions", .row 2, .field "deleted"] (some (.bool true))])),
    -- no Member names the room; Alice does
    (5, [], wr 100 81 101 [9] (proof := some 30) (touches := [sets "name" "Bob's"])),
    (2, [], wr 100 81 100 [9] (touches := [sets "name" "Garden"])),
    -- Carol adds a row with Bob's id: from then on it is neither's
    (6, [], wr 100 81 102 [9] (proof := some 31) (touches := [.insert [.field "messages"]])
      (adds := [[.field "messages", .row 1]])),
    (5, [], wr 100 81 101 [9] (proof := some 30) (touches := [.set [.field "messages", .row 1, .field "text"] (some (.str "again"))])),
    -- Dave is in no room of Alice's: no peer takes his message
    (8, [], wr 100 81 103 [9] (touches := [.insert [.field "messages"]]) (adds := [[.field "messages", .row 3]]))] }]

/-- Alice's, Bob's, Carol's and Dave's vaults, one edit per depth. -/
def humansV : List (Nat × SignerId × List SignerId × Action) := humans.zipIdx.map fun ((a, co, act), i) => (i, a, co, act)

def views : List ViewCase := [
  { name := "a removed owner can't back-date governance", edits := humansV ++ [
    (6, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    -- Bob, offline since the coop began, adds Dave
    (7, 4, [8], .share (.owner 200 (.vault 103))),
    (8, 1, [], .settings 200 (.threshold 1)),
    -- Alice removes Bob, not having seen the add
    (9, 1, [], .revoke (.owner 200 (.vault 101) []))] },
  { name := "a removal keeps what it had seen", edits := humansV ++ [
    (6, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    (7, 4, [8], .share (.owner 200 (.vault 103))),
    (8, 1, [], .settings 200 (.threshold 1)),
    (9, 1, [], .revoke (.owner 200 (.vault 101) [7])),
    -- Bob no longer governs
    (10, 4, [], .settings 200 (.threshold 1))] },
  { name := "the senior owner wins a clash", edits := humansV ++ [
    (6, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    -- Bob's removal of Alice sorts first, Alice's of Bob stands
    (7, 4, [], .revoke (.owner 200 (.vault 100) [])),
    (8, 1, [], .revoke (.owner 200 (.vault 101) []))] },
  { name := "removals that don't clash both stand", edits := humansV ++ [
    (6, 1, [4, 8], .genesis 200 .coop [.vault 100, .vault 101, .vault 103] 1),
    (7, 1, [], .revoke (.owner 200 (.vault 101) [])),
    -- Dave leaves at the same time
    (8, 8, [], .revoke (.owner 200 (.vault 103) [])),
    (9, 8, [], .settings 200 (.threshold 1))] },
  { name := "the first owner outranks a stolen second passkey", edits := [
    (0, 1, [], .genesis 100 .human [.signer 1] 1 (some 1)),
    (1, 1, [9], .share (.owner 100 (.signer 9))),
    -- the thief, holding the second passkey: removes the first passkey from the owners, adds a device of their own
    (2, 9, [], .revoke (.owner 100 (.signer 1) [])),
    (3, 9, [555], .share (.device 100 555)),
    -- the first passkey, which joined first, removes the second, having seen neither
    (4, 1, [], .revoke (.owner 100 (.signer 9) []))] },
  { name := "a revoked writer's unseen edits are cut, with what builds on them", edits := humansV ++ [
    (6, 2, [], newEntry 100 21 100 [] todo),
    (7, 2, [], newShare 30 100 (toVault 101) .write 100 todos),
    (8, 2, [], newShare 31 100 (toVault 102) .write 100 todos),
    (9, 2, [], .move 100 21 [30, 31] []),
    -- Bob's write Alice saw, and one she didn't, which Carol builds on
    (10, 5, [], wr 100 21 101 [6] (stay := some 9) (proof := some 30)),
    (11, 5, [], wr 100 21 101 [10] (stay := some 9) (proof := some 30)),
    (12, 6, [], wr 100 21 102 [11] (stay := some 9) (proof := some 31)),
    (13, 2, [], .revoke (.grant 30 100 [10])),
    (14, 6, [], wr 100 21 102 [10] (stay := some 9) (proof := some 31))] },
  { name := "a revocation cuts a proposal it hadn't seen, with every write on it", edits := humansV ++ [
    (6, 2, [], newEntry 100 21 100 [] todo),
    (7, 2, [], newShare 30 100 (toVault 101) .write 100 todos),
    (8, 2, [], newShare 31 100 (toVault 102) .write 100 todos),
    (9, 2, [], .move 100 21 [30, 31] []),
    -- Bob's Mac starts a draft Alice sees, and another on an old copy, which she doesn't; Carol writes on the second
    (10, 5, [], wr 100 21 101 [6] (stay := some 9) (proposal := .new) (proof := some 30)),
    (11, 5, [], wr 100 21 101 [10] (stay := some 9) (proposal := .on 10) (proof := some 30)),
    (12, 5, [], wr 100 21 101 [6] (stay := some 9) (proposal := .new) (proof := some 30)),
    (13, 6, [], wr 100 21 102 [12] (stay := some 9) (proposal := .on 12) (proof := some 31)),
    (14, 2, [], .revoke (.grant 30 100 [10, 11])),
    -- Alice merges the draft she saw; Carol's merge of the other goes with it
    (15, 2, [], wr 100 21 100 [6, 11] (stay := some 9)),
    (16, 6, [], wr 100 21 102 [15, 13] (stay := some 9) (proof := some 31))] },
  { name := "a revocation cuts a creation it hadn't seen", edits := humansV ++ [
    (6, 2, [], newShare 30 100 (toVault 101) .write 100 workTodos),
    -- Bob creates two work todos through his share; Alice revokes it having seen only the first
    (7, 5, [], newEntry 100 21 101 [30] todo (tags := [work]) (proof := some 30)),
    (8, 5, [], newEntry 100 22 101 [30] todo (tags := [work]) (proof := some 30)),
    (9, 2, [], .revoke (.grant 30 100 [7])),
    -- Alice writes the todo she kept; the other never was
    (10, 2, [], wr 100 21 100 [7]),
    (11, 2, [], wr 100 22 100 [8])] },
  { name := "a mark cuts a write it hadn't seen into the audience it left", edits := humansV ++ [
    (6, 2, [], newEntry 100 21 100 [] todo (tags := [work])),
    (7, 2, [], newShare 30 100 (toVault 101) .write 100 workTodos),
    (8, 2, [], .move 100 21 [30] []),
    (9, 5, [], wr 100 21 101 [6] (stay := some 8) (proof := some 30)),
    -- Alice takes the work tag off and a steward marks the todo out of Bob's slice, having seen Bob's first write but
    -- not his second
    (10, 5, [], wr 100 21 101 [9] (stay := some 8) (proof := some 30)),
    (11, 2, [], wr 100 21 100 [9] (stay := some 8) (remove := [work])),
    (12, 2, [], .move 100 21 [] [9, 11]),
    -- Bob writes on, not having seen it either
    (13, 5, [], wr 100 21 101 [10] (stay := some 8) (proof := some 30))] },
  { name := "a lost device's back-dated edits are cut", edits := humansV ++ [
    (6, 1, [3], .share (.device 100 3)),
    (7, 2, [], newEntry 100 1 100 [] note),
    -- a write from the iPhone the Mac had seen, and a note the thief made on an old copy
    (8, 3, [], wr 100 1 100 [7]),
    (9, 3, [], newEntry 100 2 100 [] note),
    (10, 1, [], .revoke (.device 100 3 [8]))] },
  { name := "handing the root on cuts the old passkey's back-dated edits", edits := [
    (0, 1, [], .genesis 100 .human [.signer 1] 1 (some 1)),
    (1, 1, [9], .share (.owner 100 (.signer 9))),
    -- the old passkey, stolen later, adds a device on an old copy
    (2, 1, [555], .share (.device 100 555)),
    (3, 1, [9], .settings 100 (.root (some 9) [1])),
    (4, 9, [], .revoke (.owner 100 (.signer 1) [1]))] },
  { name := "a revoked reader's back-dated keys are cut", edits := humansV ++ [
    (6, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    (7, 2, [], newEntry 200 1 200 [] note (via := [100])),
    (8, 2, [], newShare 30 200 (toVault 102) .read 200 (only 1) (via := [100])),
    (9, 2, [], .move 200 1 [30] [] [100]),
    -- Carol's passkey boxes the audience's key twice; Alice revokes Carol's read having seen only the first
    (10, 6, [], .keys (audienceKey 200 [30] 0) [shareKey 200 30 0]),
    (11, 6, [], .keys (audienceKey 200 [30] 0) [seedKey 200 0]),
    (12, 2, [], .revoke (.grant 30 200 [10] [100]))] },
  { name := "a removed owner's back-dated schema entry is cut", edits := humansV ++ [
    (6, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    (7, 2, [], newShare 30 200 .everyone .read 200 schemas (via := [100])),
    -- Bob's Mac creates a schema entry for the coop, which Alice sees, and a lens entry on an old copy, which she
    -- doesn't
    (8, 5, [], newEntry 200 1 200 [30] schemaType (via := [101]) (blob := 1)),
    (9, 5, [], newEntry 200 2 200 [30] lensType (via := [101]) (blob := 2)),
    (10, 1, [], .revoke (.owner 200 (.vault 101) [8])),
    -- Alice's Mac creates the lens entry itself; Bob's Mac no longer can
    (11, 2, [], newEntry 200 3 200 [30] lensType (via := [100]) (blob := 2)),
    (12, 5, [], newEntry 200 4 200 [30] schemaType (via := [101]) (blob := 3))] },
  { name := "a removed owner's back-dated writes for the coop are cut", edits := humansV ++ [
    (6, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    (7, 2, [], newEntry 200 1 200 [] note (via := [100])),
    -- Bob's Mac writes for the coop through Bob's vault: a write Alice sees, and a note on an old copy, which she
    -- doesn't
    (8, 5, [], wr 200 1 200 [7] (via := [101])),
    (9, 5, [], newEntry 200 2 200 [] note (via := [101])),
    (10, 1, [], .revoke (.owner 200 (.vault 101) [8])),
    -- Alice's Mac writes on; Bob's Mac no longer can
    (11, 2, [], wr 200 1 200 [8] (via := [100])),
    (12, 5, [], wr 200 1 200 [11] (via := [101]))] },
  { name := "the senior revoker ranks first", edits := humansV ++ [
    (6, 2, [], newEntry 100 1 100 [] note),
    (7, 1, [], newShare 30 100 (toVault 103) .owner 100 notes),
    (8, 8, [], newShare 31 100 (toVault 102) .read 103 notes (parent := some 30)),
    (9, 2, [], .move 100 1 [30, 31] []),
    -- Alice revokes Dave's owner share; Dave revokes the read he gave Carol on a copy that hadn't seen it, so his
    -- revocation sorts first, and falls with the share it rested on
    (11, 1, [], .revoke (.grant 30 100 [6, 7, 8, 9])),
    (10, 8, [], .revoke (.grant 31 103 []))] },
  { name := "a vault settles before the coops it owns", edits := humansV ++ [
    (6, 1, [9], .share (.owner 100 (.signer 9))),
    (7, 1, [10], .share (.owner 100 (.signer 10))),
    (8, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    -- the second passkey removes Bob from the coop on a copy that hadn't seen the third remove it from Alice's vault
    (9, 9, [], .revoke (.owner 200 (.vault 101) [])),
    (10, 10, [], .revoke (.owner 100 (.signer 9) [6, 7, 8]))] },
  { name := "a vault's removals outrank a revoked grant", edits := humansV ++ [
    (6, 1, [3], .share (.device 100 3)),
    (7, 1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
    (8, 2, [], newShare 30 100 (toVault 102) .read 100 notes),
    (9, 2, [], newShare 31 200 (toVault 102) .read 200 notes (via := [100])),
    -- the iPhone revokes Carol's read of Alice's notes, and Bob's Mac her read of the coop's, each on a copy that
    -- hadn't seen its own removal: each sorts first, the removals rank above them and stand, and the revocations fall
    (10, 3, [], .revoke (.grant 30 100 [])),
    (11, 5, [], .revoke (.grant 31 200 [] [101])),
    (12, 1, [], .revoke (.device 100 3 [6, 7, 8, 9])),
    (13, 1, [], .revoke (.owner 200 (.vault 101) [6, 7, 8, 9]))] },
  { name := "handing the root on outranks a revoked grant", edits := [
    (0, 1, [], .genesis 100 .human [.signer 1] 1 (some 1)),
    (1, 8, [], .genesis 103 .human [.signer 8] 1),
    (2, 1, [9], .share (.owner 100 (.signer 9))),
    (3, 1, [], .settings 100 (.threshold 2)),
    -- the root alone makes Dave owner of Alice's notes
    (4, 1, [], newShare 30 100 (toVault 103) .owner 100 notes),
    -- the old passkey, stolen later, revokes Dave's owner share on a copy that hadn't seen the root handed on: it
    -- sorts first and falls, as the hand-on ranks above it and the old passkey alone no longer approves
    (5, 1, [], .revoke (.grant 30 100 [])),
    (6, 1, [9], .settings 100 (.root (some 9) [0, 1, 2, 3, 4]))] },
  { name := "a mark of the wants alone puts back no audience", edits := humansV ++ [
    (6, 1, [3], .share (.device 100 3)),
    (7, 2, [], newEntry 100 1 100 [] note),
    (8, 2, [], newEntry 100 21 100 [] todo),
    (9, 2, [], newShare 30 100 (toVault 102) .read 100 (.anyOf [[.typeIn [note]], [.typeIn [todo]]])),
    (10, 2, [], keepShare 40 100 3 .whole 100 (.anyOf [[.typeIn [note]], [.typeIn [todo]]])),
    -- the Mac marks the note with Carol's audience while the iPhone, which hasn't seen it, marks only the note's wants:
    -- the wants come after and leave the audience the Mac set
    (11, 2, [], .move 100 1 [30] [7]),
    (11, 3, [], .pick 100 1 [40]),
    -- the other way round for the todo: the wants come first, and the Mac's mark, which hadn't seen them, cuts nothing
    -- of them, as they don't rest on the audience it takes the todo out of
    (12, 3, [], .pick 100 21 [40]),
    (13, 2, [], .move 100 21 [30] [8]),
    -- the same wants again are refused
    (14, 3, [], .pick 100 1 [40])] },
  { name := "a mark stands after what it names is revoked", edits := humansV ++ [
    (6, 1, [3], .share (.device 100 3)),
    (7, 2, [], newEntry 100 21 100 [] todo (tags := [work])),
    (8, 2, [], newShare 30 100 (toVault 101) .write 100 todos),
    (9, 2, [], newShare 31 100 (toVault 102) .read 100 workTodos),
    (10, 2, [], keepShare 40 100 3 .whole 100 todos),
    -- Alice's passkey revokes Carol's share and the iPhone's keep share while her Mac, which has seen neither, marks
    -- the todo with both: the mark sorts after them and stands, and readers leave out what isn't live
    (11, 1, [], .revoke (.grant 31 100 [])),
    (12, 1, [], .revoke (.grant 40 100 [])),
    (13, 2, [], .mark 100 21 (some [30, 31]) (some [40]) [7] []),
    -- only a steward marks
    (14, 555, [], .pick 100 21 [])] },
  { name := "revoking a keep share cuts nothing", edits := humansV ++ [
    (6, 1, [3], .share (.device 100 3)),
    (7, 2, [], newEntry 100 21 100 [] todo),
    (8, 2, [], newShare 30 100 (toVault 101) .write 100 todos),
    (9, 2, [], keepShare 40 100 3 .whole 100 todos),
    -- on copies that haven't seen the revocation below: the Mac marks the todo with Bob's audience and the iPhone's
    -- keep share, the iPhone and Bob write it, and the iPhone gets a second keep share
    (10, 2, [], .mark 100 21 (some [30]) (some [40]) [7] []),
    (11, 3, [], wr 100 21 100 [7] (stay := some 10)),
    (12, 5, [], wr 100 21 101 [11] (stay := some 10) (proof := some 30)),
    (13, 2, [], keepShare 41 100 3 .opened 100 (wide := true)),
    -- the passkey revokes the iPhone's first keep share, having seen none of that: it takes nothing away, so all of it
    -- stands; revoking it again falls
    (14, 1, [], .revoke (.grant 40 100 [])),
    (15, 1, [], .revoke (.grant 40 100 []))] }]

/-! ## Sync cases

A sync case is a list of edits a peer holds, each building on the frontier of its own log among the edits before it, as
a device holding them all would build, unless it names other parents or claims another depth. The model's answers:
which edits stand; each log's closed part and frontier; the forks; and for each device that asks, holding some of the
edits and following some vaults, a peer holding all of them or some: the device's frontier of each log it holds, what
it sends of it when it asks, the vaults it follows, and its loose edits (`asks`), what the peer would send it whole
(`respond`), and what it sends given what the device sent (`respondSince`). A parent no edit of the case has (999)
stands for an edit nobody holds. -/

/-- An edit of a sync case. -/
structure SyncEdit where
  author    : SignerId
  cosigners : List SignerId := []
  action    : Action
  /-- The edits of its log it builds on, by place; `none` for the frontier of its log among the edits before it. -/
  parents   : Option (List Nat) := none
  /-- The depth it claims; `none` for its place. -/
  depth     : Option Nat := none
  /-- The files it brings, a write. -/
  files     : List FileId := []

structure SyncCase where
  name  : String
  edits : List SyncEdit
  /-- Who asks: a device, the places of the edits it holds, those of the edits the peer holds (`none`: all), and the
      vaults it follows. -/
  asks  : List (SignerId × List Nat × Option (List Nat) × List VaultId)
  /-- The passkeys that prove themselves to a peer holding every edit, to link a new device (`linkCard`). -/
  links : List SignerId := []

def SyncCase.toEdits (c : SyncCase) : List Edit :=
  c.edits.zipIdx.foldl (fun acc (o, i) =>
    let edit : Edit :=
      { id := i, depth := o.depth.getD i, author := o.author, cosigners := o.cosigners, action := o.action,
        files := o.files }
    let parents := o.parents.getD (match edit.log? with
      | some l => frontiers acc l
      | none => [])
    acc ++ [{ edit with parents }]) []

/-- Every file the edits of a case bring, each once. -/
def SyncCase.files (c : SyncCase) : List FileId := (c.edits.flatMap (·.files)).eraseDups

def plain (edits : List (SignerId × List SignerId × Action)) : List SyncEdit :=
  edits.map fun (author, cosigners, action) => { author, cosigners, action }

/-- The edits of a case at the places `held`. -/
def heldEdits (edits : List Edit) (held : List Nat) : List Edit := edits.filter (held.contains ·.id)

/-- The edits the peer holds: those at the places `peer`, or all of them. -/
def peerEdits (edits : List Edit) : Option (List Nat) → List Edit
  | some ps => heldEdits edits ps
  | none => edits

def syncs : List SyncCase := [
  { name := "an entry by shares, by frontiers", edits := plain (humans ++ [
      (6, [7], .share (.device 102 7)),
      (1, [3], .share (.device 100 3)),
      (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
      -- the coop's Welcome and Charter: Carol reads Welcome, Bob edits it
      (2, [], newEntry 200 1 200 [] note (via := [100])),
      (2, [], newEntry 200 2 200 [] note (via := [100])),
      (2, [], newShare 30 200 (toVault 102) .read 200 (only 1) (via := [100])),
      (2, [], .move 200 1 [30] [] [100]),
      (5, [], wr 200 1 200 [9] (stay := some 12) (via := [101])),
      (2, [], wr 200 2 200 [10] (via := [100])),
      -- the coop's schema, which it shares with everyone
      (2, [], newShare 31 200 .everyone .read 200 schemas (via := [100])),
      (2, [], newEntry 200 4 200 [31] schemaType (via := [100]) (blob := 1)),
      -- Alice's own note
      (2, [], newEntry 100 3 100 [] note)]),
    asks := [
      -- Carol's Mac holding nothing yet, then after a sync before Bob's write, then holding Bob's write without its past
      (7, [], none, []),
      (7, [0, 1, 2, 3, 4, 6, 7, 8, 9, 11, 12], none, []),
      (7, [4, 6, 13], none, []),
      -- Bob's Mac before most of the coop's notes, a stranger, the stranger following the coop, and Alice's iPhone
      -- holding everything
      (5, [0, 1, 2, 3, 4, 5, 8, 9, 10], none, []),
      (555, [], none, []),
      (555, [], none, [200]),
      (3, List.range 18, none, [])] },
  { name := "forks", edits := plain (humans ++ [
      (1, [3], .share (.device 100 3)),
      (2, [], newEntry 100 1 100 [] note),
      (2, [], wr 100 1 100 [7])]) ++ [
      -- Alice's Mac again from the same past, as a copy restored from an old backup would: a fork
      { author := 2, action := wr 100 1 100 [7], parents := some [7] },
      -- her iPhone at the same moment: another device, no fork
      { author := 3, action := wr 100 1 100 [7], parents := some [7] },
      -- her passkey on two devices at once: a passkey isn't checked
      { author := 1, cosigners := [77], action := .share (.device 100 77) },
      { author := 1, action := .settings 100 (.threshold 1), parents := some [6] },
      -- the Mac building on an edit nobody holds: outside the closed part, so neither in the frontier nor a fork
      { author := 2, action := wr 100 1 100 [7], parents := some [999] },
      -- the iPhone claiming to be no deeper than the edit it builds on: malformed, so it never stands
      { author := 3, action := wr 100 1 100 [10], parents := some [10], depth := some 10 }],
    asks := [(3, [0, 1, 2, 3, 4, 5, 6, 7, 10], none, []), (2, [], none, [])] },
  { name := "a revocation joins its share's log", edits := plain (humans ++ [
      (6, [7], .share (.device 102 7)),
      (2, [], newEntry 100 21 100 [] todo),
      (2, [], newShare 30 100 (toVault 102) .read 100 (only 21)),
      (2, [], .move 100 21 [30] []),
      (2, [], newEntry 100 22 100 [] todo),
      -- Alice revokes Carol's read: Carol hears of it, and of nothing else about the todo
      (2, [], .revoke (.grant 30 100 [7, 8, 9])),
      (2, [], wr 100 21 100 [7] (stay := some 9))]),
    asks := [(7, [0, 1, 4, 6, 7, 8, 9], none, []), (7, [], none, []), (5, [2, 3], none, []),
      -- Carol holding the revocation but not the share it revokes: it is loose, and isn't sent again
      (7, [0, 1, 4, 6, 7, 9, 11], none, [])] },
  { name := "a relay holds the audiences it may relay, and no key", edits := plain (humans ++ [
      (1, [], .genesis 300 .deviceVault [.vault 100] 1),
      (1, [600], .share (.device 300 600)),
      -- Alice's note and her todo; the server's vault may hold her notes, and read none
      (2, [], newEntry 100 1 100 [] note),
      (2, [], newEntry 100 21 100 [] todo),
      (2, [], newShare 30 100 (toVault 300) .backup 100 notes),
      (2, [], .move 100 1 [30] []),
      (2, [], wr 100 1 100 [8] (stay := some 11)),
      (2, [], .keys (audienceKey 100 [30] 0) [seedKey 100 0])]),
    asks := [(600, [], none, []), (600, [0, 1, 6, 7, 10], none, []), (5, [], none, [])] },
  { name := "a device ahead of its peer", edits := plain (humans ++ [
      (1, [3], .share (.device 100 3)),
      (2, [], newEntry 100 1 100 [] note)] ++
      -- Alice's Mac writes her note seventeen times
      List.replicate 17 (2, [], wr 100 1 100)) ++ [
      -- her iPhone writes it once, having seen the first twelve
      { author := 3, action := wr 100 1 100, parents := some [19] }],
    asks := [
      -- the Mac asks the iPhone: each lacks some of the other's edits; then an iPhone holding none of its own
      (2, List.range 25, some (List.range 20 ++ [25]), []),
      (2, List.range 25, some (List.range 20), []),
      -- the iPhone, behind, asks a peer holding all of them
      (3, List.range 13, none, [])] },
  { name := "linking a device by its passkey", edits := plain (humans ++ [
      (1, [3], .share (.device 100 3)),
      -- Alice's backup passkey, a second owner of her vault
      (1, [9], .share (.owner 100 (.signer 9))),
      (1, [4], .genesis 200 .coop [.vault 100, .vault 101] 1),
      (2, [], newEntry 200 1 200 [] note (via := [100])),
      (2, [], newShare 30 200 (toVault 102) .read 200 (wide := true) (via := [100]))]),
    asks := [(3, [], none, [])],
    -- Alice's passkey, her backup passkey, Bob's and Carol's, Alice's Mac (a device, no passkey), and a stranger's
    links := [1, 9, 4, 6, 2, 555] },
  { name := "files follow their edits", edits := plain (humans ++ [
      (6, [7], .share (.device 102 7)),
      (1, [], .genesis 300 .deviceVault [.vault 100] 1),
      (1, [600], .share (.device 300 600))]) ++ [
      -- Alice's note brings a photo, her todo a scan
      { author := 2, action := newEntry 100 1 100 [] note, files := [1] },
      { author := 2, action := newEntry 100 21 100 [] todo, files := [2] }] ++ plain [
      -- Carol reads her notes, the server's vault backs them up, Dan only relays her vault
      (2, [], newShare 30 100 (toVault 102) .read 100 notes),
      (2, [], newShare 31 100 (toVault 300) .backup 100 notes),
      (2, [], newShare 32 100 (toVault 103) .relay 100),
      (2, [], .move 100 1 [30, 31] [])] ++ [
      -- then a film, into the note
      { author := 2, action := wr 100 1 100 [9] (stay := some 14), files := [3] }],
    -- Carol's Mac, the server, Alice's Mac, Bob's Mac and Dan's passkey, each holding nothing yet; then Carol's
    -- Mac from a peer that lacks the film's write
    asks := [(7, [], none, []), (600, [], none, []), (2, [], none, []), (5, [], none, []), (8, [], none, []),
      (7, [], some (List.range 15), [])] },
  { name := "keep shares choose what a device syncs", edits := plain (humans ++ [
      (1, [3], .share (.device 100 3)),
      (6, [7], .share (.device 102 7)),
      (1, [], .genesis 300 .deviceVault [.vault 100] 1),
      (1, [600], .share (.device 300 600))]) ++ [
      -- Alice's note brings a photo, her todo a scan
      { author := 2, action := newEntry 100 1 100 [] note, files := [1] },
      { author := 2, action := newEntry 100 21 100 [] todo, files := [2] }] ++ plain [
      -- the server's vault backs up all of her vault, Carol reads all of it
      (2, [], newShare 30 100 (toVault 300) .backup 100 (wide := true)),
      (2, [], newShare 31 100 (toVault 102) .read 100 (wide := true)),
      -- her iPhone syncs her notes and keeps their files whole; Carol's Mac never syncs her vault
      (2, [], keepShare 40 100 3 .whole 100 notes),
      (7, [], keepShare 41 100 7 .never 102 (wide := true)),
      (2, [], .pick 100 1 [40])],
    -- Alice's iPhone, her Mac, the server (no keep share: all it may) and Carol's Mac, each holding nothing yet;
    -- then the iPhone from a peer that hasn't seen the mark
    asks := [(3, [], none, []), (2, [], none, []), (600, [], none, []), (7, [], none, []),
      (3, [], some (List.range 15), [])] },
  { name := "what everyone may read goes to whoever has an interest", edits := plain (humans ++ [
      (6, [7], .share (.device 102 7)),
      -- Alice shares her schemas and lenses with everyone, with her first schema
      (2, [], newShare 30 100 .everyone .read 100 schemas),
      (2, [], newEntry 100 1 100 [30] schemaType (blob := 1)),
      -- her note, which Bob reads
      (2, [], newEntry 100 2 100 [] note),
      (2, [], newShare 31 100 (toVault 101) .read 100 notes),
      (2, [], .move 100 2 [31] [])]),
    -- Bob's Mac, which has an interest in Alice's vault through his share; Carol's Mac, which has none, then following
    -- Alice's vault; a stranger, then following Alice's vault and Bob's
    asks := [(5, [], none, []), (7, [], none, []), (7, [], none, [100]), (555, [], none, []),
      (555, [], none, [100, 101])] }]

/-! ## Gate cases

What the server of a vault (`home`) takes of a batch of edits, holding others (`takes`, `Gate.lean`): the batch without
the geneses of new vaults it doesn't welcome, or nothing where a vault it would take stays unwelcome. Each edit claims a
depth, as in a view case; ids count through the held edits and then the batch. The model's answer is the positions in
the batch of the edits it takes, or `null`. Maia City is coop 200, which Alice's vault owns; its Traveler group is entry
50 and its Admin group entry 52, which Bob holds; invite keys from 700; Eve's passkey 12 founds vault 104. -/

structure GateCase where
  name  : String
  home  : VaultId
  held  : List (Nat × SignerId × List SignerId × Action)
  batch : List (Nat × SignerId × List SignerId × Action)

def GateCase.edits (c : GateCase) : List Edit × List Edit :=
  let mk := fun (i : Nat) ((depth, author, co, a) : Nat × SignerId × List SignerId × Action) =>
    ({ id := i, depth, author, cosigners := co, action := a } : Edit)
  (c.held.zipIdx.map fun (x, i) => mk i x, c.batch.zipIdx.map fun (x, i) => mk (c.held.length + i) x)

/-- The positions in the batch of what the server takes of it, or none. -/
def GateCase.takes (c : GateCase) : Option (List Nat) :=
  let (held, batch) := c.edits
  (AvenDB.takes c.home held batch).map fun b => (batch.zipIdx.filter fun (o, _) => b.any (·.id == o.id)).map (·.2)

/-- Each step at the depth after the one before, from `start`. -/
def deep (start : Nat) (steps : List (SignerId × List SignerId × Action)) : List (Nat × SignerId × List SignerId × Action) :=
  steps.zipIdx.map fun ((a, co, act), i) => (start + i, a, co, act)

/-- What the server of Maia City holds: the four people's vaults, Maia City, its Traveler group with an invite to it,
    its Admin group, which Bob holds, and an invite to Alice's own vault. -/
def gateHeld : List (Nat × SignerId × List SignerId × Action) := deep 0 (humans ++ [
  (1, [], .genesis 200 .coop [.vault 100] 1),
  (2, [], newEntry 200 50 200 [] capGroupType (via := [100]) (defines := some travelerG)),
  (2, [], groupShare 31 200 (.invite 700) .read 50 (via := [100])),
  (2, [], newEntry 200 52 200 [] capGroupType (via := [100]) (defines := some { name := "Admin" })),
  (2, [], groupShare 32 200 (toVault 101) .read 52 (via := [100])),
  (2, [], newShare 33 100 (.invite 703) .read 100 todos)])

def eveFounds : SignerId × List SignerId × Action := (12, [], .genesis 104 .human [.signer 12] 1 (some 12))

def gates : List GateCase := [
  { name := "a new human vault comes with the invite it claims", home := 200, held := gateHeld,
    batch := deep 100 [eveFounds, (12, [700], .claim 31 104)] },
  { name := "without a claim, the server leaves a new human vault out", home := 200, held := gateHeld,
    batch := deep 100 [eveFounds] },
  { name := "an invite to another vault lets no human vault in", home := 200, held := gateHeld,
    batch := deep 100 [eveFounds, (12, [703], .claim 33 104)] },
  { name := "a coop founded by a citizen who is no admin stays out", home := 200, held := gateHeld,
    batch := deep 100 [(6, [], .genesis 210 .coop [.vault 102] 1)] },
  { name := "a holder of the Admin group founds a coop and its aven", home := 200, held := gateHeld,
    batch := deep 100 [(4, [], .genesis 210 .coop [.vault 101] 1), (4, [], .genesis 310 .aven [.vault 210] 1)] },
  { name := "Maia City's owner founds a coop", home := 200, held := gateHeld,
    batch := deep 100 [(1, [], .genesis 211 .coop [.vault 100] 1)] },
  { name := "a held genesis the batch lets stand, unwelcome, refuses the whole batch", home := 200,
    held := gateHeld ++ [(200, 12, [], .genesis 220 .coop [.vault 104] 1)],
    batch := deep 100 [eveFounds, (12, [700], .claim 31 104)] }]

-- the gate takes a whole batch, part of one, none of one, and refuses one
#guard gates.any (fun c => c.takes == some (List.range c.batch.length))
#guard gates.any (fun c => c.takes == some [])
#guard gates.any (fun c => (c.takes.map fun t => !t.isEmpty && t.length < c.batch.length) == some true)
#guard gates.any (·.takes == none)

/-! ## Standing cases

What the server of a vault (`home`), holding some edits, says of a device whose pass a service brings
(`deviceStanding`, `Gate.lean`): the vault it is a device of and whether that vault is an admin of `home`, or nothing
for a signer that is no vault's device. Each edit claims a depth, as in a gate case. The pass itself, its signature,
service and freshness, is the core's to check (`sign::ApiPass`), as the model abstracts signatures. The model's
answer is `{vault, admin}`, or `null`. The held edits are a gate case's: Maia City is coop 200, which Alice's vault
owns; its Admin group is entry 52, which Bob holds. -/

structure StandingCase where
  name   : String
  home   : VaultId
  held   : List (Nat × SignerId × List SignerId × Action)
  device : SignerId

def StandingCase.edits (c : StandingCase) : List Edit :=
  c.held.zipIdx.map fun ((depth, author, co, a), i) => ({ id := i, depth, author, cosigners := co, action := a } : Edit)

def StandingCase.answer (c : StandingCase) : Option (VaultId × Bool) := deviceStanding (view c.edits) c.home c.device

/-- What the server of Maia City holds besides: Carol's Mac a device of her vault, and her vault a Traveler. -/
def carolTravels : List (Nat × SignerId × List SignerId × Action) := [
  (20, 6, [7], .share (.device 102 7)),
  (21, 2, [], groupShare 34 200 (toVault 102) .read 50 (via := [100]))]

def standings : List StandingCase := [
  { name := "Maia City's owner's Mac is an admin's", home := 200, held := gateHeld, device := 2 },
  { name := "the Mac of a holder of the Admin group is an admin's", home := 200, held := gateHeld, device := 5 },
  { name := "a Traveler's Mac is no admin's", home := 200, held := gateHeld ++ carolTravels, device := 7 },
  { name := "once the Admin share is revoked, its holder's Mac is no admin's", home := 200,
    held := gateHeld ++ [(20, 2, [], .revoke (.grant 32 200 [] [100]))], device := 5 },
  { name := "a removed device is nobody's", home := 200, held := gateHeld ++ [(20, 4, [], .revoke (.device 101 5 []))],
    device := 5 },
  { name := "a passkey is no device", home := 200, held := gateHeld, device := 4 },
  { name := "a stranger's key is nobody's device", home := 200, held := gateHeld, device := 555 }]

-- an admin's device, a device that is no admin's, and a signer that is no device
#guard standings.any (·.answer.any (·.2))
#guard standings.any (·.answer.any (!·.2))
#guard standings.any (·.answer.isNone)
#guard (standings.map (·.answer)) ==
  [some (100, true), some (101, true), some (102, false), some (101, false), none, none, none]

/-! ## Quota cases

What the server of a vault (`home`), holding some edits, keeps of a run of items its peers bring, each an edit or a file
of some bytes signed by a device (`keepAll`, `Quota.lean`), by limits named after `home`'s cap groups: an edit always,
a file only where its person's backup stays within their limit. Each held edit claims a depth, as in a gate case. The
model's answer is whether it keeps each item, and each item's person with their limit, `null` for none. The held edits
are a standing case's: Maia City is coop 200, which Alice's vault owns; its Traveler group is entry 50, which Carol holds,
its Admin group entry 52, which Bob holds, and its Citizen group entry 51, which Dave holds; Carol's agent device 11 acts
for her device vault 320, and Dave's Mac is 9. -/

structure QuotaCase where
  name   : String
  home   : VaultId
  held   : List (Nat × SignerId × List SignerId × Action)
  limits : Limits
  items  : List Brought

def QuotaCase.edits (c : QuotaCase) : List Edit :=
  c.held.zipIdx.map fun ((depth, author, co, a), i) => ({ id := i, depth, author, cosigners := co, action := a } : Edit)

/-- Whether the server keeps each item, in order. -/
def QuotaCase.kept (c : QuotaCase) : List Bool :=
  let ks := keepAll (view c.edits) c.home c.limits [] c.items
  -- each item comes once in a case, so whether it is kept is whether it is among what the server holds
  c.items.map fun i => ks.contains i

/-- Each item's person, and their limit. -/
def QuotaCase.persons (c : QuotaCase) : List (Option (VaultId × Option Nat)) :=
  let st := view c.edits
  c.items.map fun i => (payerOf st i.signer).map fun p => (p, limitOf st c.home p c.limits)

/-- What the server of Maia City holds besides Carol's: Dave's Mac a device of his vault, Maia City's Citizen group,
    which Dave holds, and Carol's device vault, with her agent's device in it. -/
def daveCites : List (Nat × SignerId × List SignerId × Action) := carolTravels ++ [
  (22, 8, [9], .share (.device 103 9)),
  (23, 2, [], newEntry 200 51 200 [] capGroupType (via := [100]) (defines := some { name := "Citizen" })),
  (24, 2, [], groupShare 35 200 (toVault 103) .read 51 (via := [100])),
  (25, 6, [], .genesis 320 .deviceVault [.vault 102] 1),
  (26, 6, [11], .share (.device 320 11))]

def quotaLimits : Limits := [("Traveler", 100), ("Citizen", 500)]

def quotas : List QuotaCase := [
  { name := "a Traveler's files fill their limit and no more, and every edit is kept", home := 200,
    held := gateHeld ++ daveCites, limits := quotaLimits,
    items := [⟨7, 60, true⟩, ⟨7, 30, false⟩, ⟨7, 20, true⟩, ⟨7, 10, true⟩, ⟨7, 50, false⟩, ⟨7, 1, true⟩] },
  { name := "a Citizen's limit is the Citizen group's", home := 200, held := gateHeld ++ daveCites,
    limits := quotaLimits, items := [⟨9, 300, true⟩, ⟨9, 250, true⟩, ⟨9, 200, true⟩] },
  { name := "Maia City's owner and a holder of its Admin group have no limit", home := 200,
    held := gateHeld ++ daveCites, limits := quotaLimits, items := [⟨2, 1000, true⟩, ⟨5, 2000, true⟩] },
  { name := "once their Citizen share is revoked, a person takes the least limit", home := 200,
    held := gateHeld ++ daveCites ++ [(30, 2, [], .revoke (.grant 35 200 [] [100]))], limits := quotaLimits,
    items := [⟨9, 300, true⟩, ⟨9, 100, true⟩] },
  { name := "a person's agent counts against their backup", home := 200, held := gateHeld ++ daveCites,
    limits := quotaLimits, items := [⟨7, 60, true⟩, ⟨11, 50, true⟩, ⟨11, 40, true⟩, ⟨11, 5, false⟩] },
  { name := "with no limits said, nothing is limited", home := 200, held := gateHeld ++ daveCites, limits := [],
    items := [⟨7, 1000, true⟩, ⟨9, 1000, true⟩] },
  { name := "a stranger's key counts against nobody", home := 200, held := gateHeld ++ daveCites,
    limits := quotaLimits, items := [⟨555, 1000, true⟩, ⟨4, 1000, true⟩] }]

-- a file kept and one refused, an edit kept whatever the limit, and items of nobody's
#guard quotas.any fun c => (c.kept.zip c.items).any fun (k, i) => k && i.file
#guard quotas.any fun c => (c.kept.zip c.items).any fun (k, i) => !k && i.file
#guard quotas.all fun c => (c.kept.zip c.items).all fun (k, i) => k || i.file
#guard quotas.any fun c => c.persons.any (·.isNone)
#guard (quotas.map (·.kept)) == [[true, true, false, true, true, false], [true, false, true], [true, true],
  [false, true], [true, false, true, true], [true, true], [true, true]]
#guard (quotas.map (·.persons)) == [
  List.replicate 6 (some (102, some 100)), List.replicate 3 (some (103, some 500)),
  [some (100, none), some (101, none)], List.replicate 2 (some (103, some 100)),
  List.replicate 4 (some (102, some 100)), [some (102, none), some (103, none)],
  [none, none]]

/-! ## Admission cases

Whom the relay of the server of a vault (`home`), holding some edits, lets in by a pass (`honours`, `Admission.lean`):
the passkey that signed it, and the invite it is shown with, if any, as the server signs people up (`anyone`,
`invited` or `known`). The model's answer is whether it honours the pass. The held edits are a gate case's, and Eve's
claim of invite 31 where a case says so. -/

structure AdmissionCase where
  name      : String
  home      : VaultId
  held      : List (Nat × SignerId × List SignerId × Action)
  signup    : Signup
  claimable : Bool
  passkey   : SignerId
  invite    : Option ShareId

def AdmissionCase.edits (c : AdmissionCase) : List Edit :=
  c.held.zipIdx.map fun ((depth, author, co, a), i) => ({ id := i, depth, author, cosigners := co, action := a } : Edit)

def AdmissionCase.honours (c : AdmissionCase) : Bool :=
  AvenDB.honours (view c.edits) c.home c.signup c.claimable c.passkey c.invite

/-- Eve founds her vault and claims invite 31 with it. -/
def eveClaims : List (Nat × SignerId × List SignerId × Action) :=
  deep 100 [eveFounds, (12, [700], .claim 31 104)]

def admissions : List AdmissionCase := [
  { name := "a stranger's passkey with no invite, by invite", home := 200, held := gateHeld, signup := .invited,
    claimable := false, passkey := 12, invite := none },
  { name := "a stranger's passkey with an open invite of Maia City", home := 200, held := gateHeld,
    signup := .invited, claimable := false, passkey := 12, invite := some 31 },
  { name := "a stranger's passkey with an invite to another vault", home := 200, held := gateHeld,
    signup := .invited, claimable := false, passkey := 12, invite := some 33 },
  { name := "a stranger's passkey with a share that is no invite", home := 200, held := gateHeld,
    signup := .invited, claimable := false, passkey := 12, invite := some 32 },
  { name := "a stranger's passkey with an invite already claimed", home := 200, held := gateHeld ++ eveClaims,
    signup := .invited, claimable := false, passkey := 13, invite := some 31 },
  { name := "once claimed, the newcomer's own passkey is known", home := 200, held := gateHeld ++ eveClaims,
    signup := .invited, claimable := false, passkey := 12, invite := none },
  { name := "a stranger's passkey with an open invite, sign-up closed", home := 200, held := gateHeld,
    signup := .known, claimable := false, passkey := 12, invite := some 31 },
  { name := "a stranger's passkey, sign-up open to anyone", home := 200, held := gateHeld, signup := .anyone,
    claimable := false, passkey := 12, invite := none },
  { name := "a stranger's passkey while nobody has claimed the server", home := 200, held := [], signup := .known,
    claimable := true, passkey := 12, invite := none }]

#guard (admissions.map (·.honours)) == [false, true, false, false, false, true, false, true, true]

/-! ## A version's writes (T10l)

How many writes a version of an entry holds (`writesAt`), of the writes its readers count at the end of a step case,
by the heads that name the version: a later version holds more (`T10_writes_grow`). With writes left out (`left`), as a
server that hands out only some of them leaves them out, a version holds no more than the full one (`T10_writes_left_out`):
what it names that was left out, it holds nothing of. The history is that of "proposals of an entry": Welcome created
(6), a draft started from it (10) and written on (11), merged into main (19), the draft written on again (20) and
bringing main in (21), a proposal started from the merge (22) and written on (23). -/

structure VersionCase where
  case  : String
  entry : EntryId
  heads : List EditId
  left  : List EditId := []
  deriving Inhabited

def VersionCase.writes (c : VersionCase) : Nat :=
  match cases.find? (fun (k : Case) => k.name == c.case) with
  | none => 0
  | some k => writesAt ((run k.edits).2.counted.filter fun w => !c.left.contains w.edit) c.entry c.heads

def proposalsCase := "proposals of an entry"

def versionCases : List VersionCase := [
  -- each version holds its heads and all before them, and a later one more
  { case := proposalsCase, entry := 1, heads := [6] },
  { case := proposalsCase, entry := 1, heads := [11] },
  { case := proposalsCase, entry := 1, heads := [19] },
  { case := proposalsCase, entry := 1, heads := [6, 20] },
  { case := proposalsCase, entry := 1, heads := [21] },
  { case := proposalsCase, entry := 1, heads := [23] },
  { case := proposalsCase, entry := 1, heads := [21, 23] },
  -- the merge and all after it left out, as a server holding main back at its creation would: main's heads there are
  -- the creation alone, the draft's its last write before; and what names a write left out holds nothing
  { case := proposalsCase, entry := 1, heads := [6], left := [19, 21, 22, 23] },
  { case := proposalsCase, entry := 1, heads := [20], left := [19, 21, 22, 23] },
  { case := proposalsCase, entry := 1, heads := [21], left := [19, 21, 22, 23] },
  -- the newest write alone left out: one less
  { case := proposalsCase, entry := 1, heads := [21, 22], left := [23] }]

#guard versionCases.map (·.writes) == [1, 3, 4, 4, 6, 6, 8, 1, 4, 0, 7]
-- later versions hold more (T10l), and a version with writes left out no more than the full one with the same heads
#guard versionCases[0]!.writes < versionCases[1]!.writes && versionCases[1]!.writes < versionCases[2]!.writes &&
  versionCases[2]!.writes < versionCases[4]!.writes && versionCases[4]!.writes < versionCases[6]!.writes
#guard versionCases[8]!.writes ≤ ({ versionCases[8]! with left := [] } : VersionCase).writes &&
  versionCases[10]!.writes < versionCases[6]!.writes

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
  | .human       => str "human"
  | .coop        => str "coop"
  | .aven        => str "aven"
  | .deviceVault => str "device"

/-- Every kind of vault, in the order the Rust core numbers them. -/
def allKinds : List Kind := [.human, .coop, .aven, .deviceVault]

/-- A kind's row of the kind table (`Kind.rules`): who may own a vault of it, how many owners it has at most, whether it
    holds devices, and how many vaults of it one owner may own. -/
def kindRules (k : Kind) : String :=
  let r := k.rules
  obj [("kind", kind k),
    ("ownedBy", match r.ownedBy with
      | .signers => str "signers"
      | .vaults ks => arr (ks.map kind)),
    ("most", opt nat r.most), ("devices", bool r.devices), ("each", opt nat r.each)]

def keepMode : KeepMode → String
  | .whole  => str "whole"
  | .opened => str "opened"
  | .never  => str "never"

/-- A level: its name, or for a keep share `{"keep": mode}`. -/
def level : Level → String
  | .keep m => obj [("keep", keepMode m)]
  | .relay => str "relay"
  | .backup => str "backup"
  | .read  => str "read"
  | .write => str "write"
  | .owner => str "owner"

def who : Who → String
  | .vault v  => obj [("vault", nat v)]
  | .everyone => str "everyone"
  | .device d => obj [("device", nat d)]
  | .invite k => obj [("invite", nat k)]

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

def jsonVal : Ops.Val → String
  | .null   => "null"
  | .bool x => bool x
  | .int n  => toString n
  | .str x  => str x

def step : Step → String
  | .field f => str f
  | .row i   => obj [("id", toString i)]
  | .any     => str "*"

def path (ps : List Step) : String := arr (ps.map step)

def onJson : Option On → List (String × String)
  | none => []
  | some .main => [("on", str "main")]
  | some .proposals => [("on", str "proposals")]

/-- An op as the docs write it (`avendb/docs/ARCHITECTURE.md` §8): a tag, a number here, by its digits, as the core
    names it. -/
def opJson : Op → String
  | .relay => obj [("op", str "relay")]
  | .backup => obj [("op", str "backup")]
  | .read => obj [("op", str "read")]
  | .tag none => obj [("op", str "tag")]
  | .tag (some ts) => obj [("op", str "tag"), ("tags", arr (ts.map fun t => str (toString t)))]
  | .share => obj [("op", str "share")]
  | .set p to o => obj ([("op", str "set"), ("path", path p)] ++
      (match to with
        | some vs => [("to", arr (vs.map jsonVal))]
        | none => []) ++ onJson o)
  | .setOwn p to o => obj ([("op", str "set"), ("path", path p), ("own", bool true)] ++
      (match to with
        | some vs => [("to", arr (vs.map jsonVal))]
        | none => []) ++ onJson o)
  | .insert p o => obj ([("op", str "insert"), ("path", path p)] ++ onJson o)
  | .remove p o => obj ([("op", str "remove"), ("path", path p)] ++ onJson o)
  | .move p o => obj ([("op", str "move"), ("path", path p)] ++ onJson o)
  | .merge o p => obj ([("op", str "merge")] ++ onJson o ++ if p.isEmpty then [] else [("path", path p)])
  | .propose => obj [("op", str "propose")]
  | .create o => obj ([("op", str "create")] ++ onJson o)

/-- A list of records a touch names: a field of the record by its name, one in a row by its path. -/
def list : Ops.Loc → String
  | [.field f] => str f
  | l => path l.steps

/-- What a write touches: `{"set": path, "to": v}` (no `to` where no one value was set), `{"insert": list}`, ... -/
def touch : Touch → String
  | .set l to => obj ([("set", path l.steps)] ++ match to with
      | some v => [("to", jsonVal v)]
      | none => [])
  | .own l to => obj ([("set", path l.steps), ("own", bool true)] ++ match to with
      | some v => [("to", jsonVal v)]
      | none => [])
  | .insert l => obj [("insert", list l)]
  | .remove l => obj [("remove", list l)]
  | .move l => obj [("move", list l)]
  | .create => str "create"
  | .tag t => obj [("tag", nat t)]
  | .propose => str "propose"
  | .merge => str "merge"
  | .merged l => obj [("merged", path l.steps)]

/-- A share, with its ops. -/
def shareJson (c : Share) : String :=
  obj ([("id", nat c.id), ("over", nat c.over), ("who", who c.who), ("level", level c.level),
       ("wide", bool c.wide), ("select", selector c.select), ("ops", arr (c.ops.map opJson)),
       ("parent", opt nat c.parent), ("issuer", nat c.issuer)] ++ match c.group with
         | some g => [("group", nat g)]
         | none => [])

/-- A cap: an op over a slice. -/
def capJson (c : Cap) : String := obj [("op", opJson c.op), ("slice", selector c.slice)]

/-- A cap group, as a cap group entry's record says it. -/
def capGroupJson (g : CapGroup) : String :=
  obj [("name", str g.name), ("caps", arr (g.caps.map capJson)), ("includes", ids g.includes)]

/-- A built-in group. -/
def group (g : Group) : String :=
  obj [("name", str g.name), ("ops", arr (g.ops.map opJson)), ("everyone", bool g.everyone)]

def keyFam : KeyFam → String
  | .seed v       => obj [("seed", nat v)]
  | .share v c    => obj [("share", obj [("vault", nat v), ("share", nat c)])]
  | .audience v x => obj [("audience", obj [("vault", nat v), ("shares", ids x)])]

def keyName : KeyName → String
  | .signer s    => obj [("signer", nat s)]
  | .scoped k ε  => obj [("key", keyFam k), ("epoch", nat ε)]
  | .entry e s g => obj [("entry", nat e), ("stay", opt nat s), ("epoch", nat g)]

def proposal : Proposal → String
  | .main => str "main"
  | .new  => str "new"
  | .on b => obj [("on", nat b)]

def header (h : Header) : String := obj [("type", nat h.type), ("created", nat h.created), ("blob", nat h.blob)]

def tagDelta (d : TagDelta) : String := obj [("add", ids d.add), ("remove", ids d.remove)]

/-- What a mark carries: an audience and wants, either left out (`null`). -/
def markJson (caps : Option Audience) (wants : Option (List ShareId)) : List (String × String) :=
  [("caps", opt ids caps), ("wants", opt ids wants)]

def action : Action → String
  | .genesis v k owners t root => obj [("genesis", obj [("vault", nat v), ("kind", kind k),
      ("owners", arr (owners.map principal)), ("threshold", nat t), ("root", opt nat root)])]
  | .settings v (.threshold n) => obj [("settings", obj [("threshold", obj [("vault", nat v), ("threshold", nat n)])])]
  | .settings v (.root r keep) => obj [("settings", obj [("root", obj [("vault", nat v), ("root", opt nat r),
      ("keep", ids keep)])])]
  | .share (.grant c via) => obj [("share", obj [("grant", obj [("share", shareJson c), ("via", ids via)])])]
  | .share (.owner v p) => obj [("share", obj [("owner", obj [("vault", nat v), ("owner", principal p)])])]
  | .share (.device v d) => obj [("share", obj [("device", obj [("vault", nat v), ("device", nat d)])])]
  | .revoke (.grant c a keep via) => obj [("revoke", obj [("grant", obj [("share", nat c), ("actor", nat a),
      ("keep", ids keep), ("via", ids via)])])]
  | .revoke (.owner v p keep) => obj [("revoke", obj [("owner", obj [("vault", nat v), ("owner", principal p),
      ("keep", ids keep)])])]
  | .revoke (.device v d keep) => obj [("revoke", obj [("device", obj [("vault", nat v), ("device", nat d),
      ("keep", ids keep)])])]
  | .write v e a s g deps p via create tags pr ts ft df ad => obj [("write", obj ([("vault", nat v), ("entry", nat e),
      ("actor", nat a), ("stay", opt nat s), ("epoch", nat g), ("deps", ids deps), ("proposal", proposal p),
      ("via", ids via), ("create", opt (fun (x, h) => obj [("audience", ids x), ("header", header h)]) create),
      ("tags", tagDelta tags)] ++ (match pr with
        | some c => [("proof", nat c)]
        | none => []) ++ (if ts.isEmpty then [] else [("touches", arr (ts.map touch))]) ++
        (if ft then [] else [("fits", bool false)]) ++ (if ad.isEmpty then [] else
          [("adds", arr (ad.map fun l => path l.steps))]) ++ match df with
          | some g => [("defines", capGroupJson g)]
          | none => []))]
  | .mark v e caps wants keep via => obj [("mark", obj ([("vault", nat v), ("entry", nat e)] ++ markJson caps wants ++
      [("keep", ids keep), ("via", ids via)]))]
  | .keys secret to pub => obj [("keys", obj [("secret", keyName secret), ("to", arr (to.map keyName)),
      ("public", bool pub)])]
  | .claim c v via => obj [("claim", obj [("share", nat c), ("vault", nat v), ("via", ids via)])]
  | .checkpoint v covers => obj [("checkpoint", obj [("vault", nat v), ("covers", ids covers)])]
  -- a state's slice travels as a sealed file the edit names by its root, so its JSON leaves the slice out
  | .snapshot v states => obj [("snapshot", obj [("vault", nat v),
      ("states", arr (states.map fun x => obj [("entry", nat x.entry), ("basis", ids x.basis)]))])]
  | .wraps e ws => obj [("wraps", obj [("entry", nat e),
      ("wraps", arr (ws.map fun (s, t) => obj [("secret", keyName s), ("to", keyName t)]))])]

def vault (vt : Vault) : String :=
  obj [("id", nat vt.id), ("kind", kind vt.kind), ("owners", arr (vt.owners.map principal)),
       ("threshold", nat vt.threshold), ("devices", arr (vt.devices.map nat)), ("root", opt nat vt.root)]

def attrs (a : Attrs) : String :=
  obj [("type", nat a.type), ("author", nat a.author), ("entry", nat a.entry), ("created", nat a.created),
       ("tags", ids a.tags)]

/-- The devices some keep share over vault `v` names, live or not, each once, in the order of their first. -/
def keepDevices (st : State) (v : VaultId) : List SignerId :=
  (st.shares.filterMap fun k => if k.level.isKeep && k.over == v then k.who.device? else none).eraseDups

/-- An entry: its stays, the current one first, and its wants; what only its readers see; and whether each device a
    keep share over its vault names wants it and keeps its files whole. -/
def entryJson (st : State) (en : Entry) : String :=
  obj [("id", nat en.id), ("vault", nat en.vault),
       ("stays", arr (en.stays.map fun (s, x) => obj [("stay", opt nat s), ("audience", ids x)])),
       ("wants", ids (st.wantsOf en.id)), ("attrs", attrs en.attrs), ("admitted", bool en.admitted),
       ("landed", bool (landed st en)),
       ("semAudience", ids (semAudience st en)), ("semWants", ids (semWants st en)),
       ("desiredMark", opt (fun (caps, wants) => obj (markJson caps wants)) (desiredMark st en)),
       ("devices", arr ((keepDevices st en.vault).map fun d =>
         obj [("device", nat d), ("wants", bool (wants st d en)), ("keeps", bool (keeps st d en))]))]

def write (w : Write) : String :=
  obj [("edit", nat w.edit), ("author", nat w.author), ("actor", nat w.actor), ("entry", nat w.entry),
       ("stay", opt nat w.stay), ("epoch", nat w.epoch), ("deps", ids w.deps), ("proposal", proposal w.proposal),
       ("via", ids w.via), ("first", bool w.first), ("audience", ids w.audience)]

def sealed (x : Seal) : String := obj [("secret", keyName x.secret), ("to", keyName x.to)]

/-- Each line of each entry, the main line first and then each proposal in the order it started: its history and its
    heads, of the writes the entry's readers count. -/
def lines (st : State) : String :=
  arr (st.entries.flatMap fun en =>
    let starts := st.counted.filterMap fun w =>
      if w.entry == en.id && w.proposal == .new then some w.edit else none
    (none :: starts.map some).map fun l =>
      obj [("entry", nat en.id), ("line", opt nat l), ("history", ids ((history st.counted en.id l).map (·.edit))),
           ("heads", ids (heads st.counted en.id l))])

/-- The cap groups in force, each cap group entry with what its readers read it says now (`groupAt`); left out of a
    state that has none. -/
def capGroups (st : State) : String :=
  match st.entries.filter fun en => isCapGroup en.vault en with
  | [] => ""
  | gs => ",\n " ++ str "capGroups" ++ ": " ++ arr (gs.map fun en =>
    obj [("vault", nat en.vault), ("entry", nat en.id), ("group", opt capGroupJson (groupAt st en.vault en.id))])

def state (st : State) : String :=
  ",\n ".intercalate [
    str "vaults" ++ ": " ++ arr (st.vaults.map vault),
    str "shares" ++ ": " ++ arr (st.shares.map shareJson),
    str "revoked" ++ ": " ++ ids st.revoked,
    str "entries" ++ ": " ++ arr (st.entries.map (entryJson st)),
    str "born" ++ ": " ++ ids st.born,
    str "writes" ++ ": " ++ arr (st.writes.map write),
    str "epochs" ++ ": " ++ arr (st.epochs.map fun (k, ε) => obj [("key", keyFam k), ("epoch", nat ε)]),
    str "seals" ++ ": " ++ arr (st.seals.map sealed),
    str "published" ++ ": " ++ arr (st.published.map keyName),
    str "lane" ++ ": " ++ arr (st.vaults.flatMap fun vt => (laneOf st vt.id).map fun b =>
      obj [("vault", nat vt.id), ("blob", nat b)]),
    str "uncounted" ++ ": " ++ ids st.uncounted,
    str "accepts" ++ ": " ++ ids st.accepts,
    str "lines" ++ ": " ++ lines st] ++ capGroups st

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
  "{" ++ str "name" ++ ": " ++ str c.name ++ ",\n " ++ str "edits" ++
    ": [\n  " ++ ",\n  ".intercalate edits ++ "],\n " ++ str "standing" ++ ": " ++ arr (stood.map bool) ++ ",\n " ++
    state st ++ "}"

def logId : LogId → String
  | .vault v      => obj [("vault", nat v)]
  | .share c      => obj [("share", nat c)]
  | .audience v x => obj [("audience", obj [("vault", nat v), ("shares", ids x)])]
  | .entry e      => obj [("entry", nat e)]

def syncCase (c : SyncCase) : String :=
  let edits := c.toEdits
  let stood := standing edits
  let editJson := edits.map fun o => obj [("depth", nat o.depth), ("author", nat o.author),
    ("cosigners", arr (o.cosigners.map nat)), ("action", action o.action), ("parents", ids o.parents),
    ("files", ids o.files)]
  let logs := (logsOf edits).map fun l => obj [("log", logId l),
    ("closed", ids ((closedPart Edit.log? edits l).map (·.id))), ("frontier", ids (frontiers edits l))]
  let asks := c.asks.map fun (d, held, peer, fl) =>
    let (h, p) := (heldEdits edits held, peerEdits edits peer)
    let sent := (logsOf h).map fun l => obj [("log", logId l), ("frontier", ids (frontiers h l)),
      ("haves", ids ((asks h fl).haves l))]
    obj [("device", nat d), ("held", ids held), ("peer", opt ids peer), ("follow", ids fl), ("logs", arr sent),
         ("loose", ids (loose h)), ("respond", ids ((respond p d fl).map (·.id))),
         ("since", ids ((respondSince p d (asks h fl)).map (·.id))),
         ("fetch", ids (c.files.filter (mayFetch p d · fl)))]
  let links := c.links.map fun p => obj [("passkey", nat p), ("card", ids ((linkCard edits p).map (·.id)))]
  "{" ++ str "name" ++ ": " ++ str c.name ++ ",\n " ++ str "edits" ++ ": [\n  " ++ ",\n  ".intercalate editJson ++
    "],\n " ++ str "standing" ++ ": " ++ arr (edits.map fun o => bool (stood.any (·.id == o.id))) ++ ",\n " ++
    str "logs" ++ ": [\n  " ++ ",\n  ".intercalate logs ++ "],\n " ++ str "forks" ++ ": " ++
    arr ((allForks edits).map fun (a, b) => ids [a, b]) ++ ",\n " ++ str "asks" ++ ": [\n  " ++
    ",\n  ".intercalate asks ++ "],\n " ++ str "links" ++ ": " ++ arr links ++ "}"

def gateCase (c : GateCase) : String :=
  let (held, batch) := c.edits
  let editJson := fun (o : Edit) =>
    obj [("depth", nat o.depth), ("author", nat o.author), ("cosigners", arr (o.cosigners.map nat)),
      ("action", action o.action)]
  "{" ++ str "name" ++ ": " ++ str c.name ++ ",\n " ++ str "home" ++ ": " ++ nat c.home ++ ",\n " ++ str "held" ++
    ": [\n  " ++ ",\n  ".intercalate (held.map editJson) ++ "],\n " ++ str "batch" ++ ": [\n  " ++
    ",\n  ".intercalate (batch.map editJson) ++ "],\n " ++ str "takes" ++ ": " ++ opt ids c.takes ++ "}"

def standingCase (c : StandingCase) : String :=
  let editJson := fun (o : Edit) =>
    obj [("depth", nat o.depth), ("author", nat o.author), ("cosigners", arr (o.cosigners.map nat)),
      ("action", action o.action)]
  "{" ++ str "name" ++ ": " ++ str c.name ++ ",\n " ++ str "home" ++ ": " ++ nat c.home ++ ",\n " ++ str "held" ++
    ": [\n  " ++ ",\n  ".intercalate (c.edits.map editJson) ++ "],\n " ++ str "device" ++ ": " ++ nat c.device ++
    ",\n " ++ str "standing" ++ ": " ++ opt (fun (v, a) => obj [("vault", nat v), ("admin", bool a)]) c.answer ++ "}"

def heldJson (held : List Edit) : String :=
  let editJson := fun (o : Edit) =>
    obj [("depth", nat o.depth), ("author", nat o.author), ("cosigners", arr (o.cosigners.map nat)),
      ("action", action o.action)]
  "[\n  " ++ ",\n  ".intercalate (held.map editJson) ++ "]"

def quotaCase (c : QuotaCase) : String :=
  let item := fun (i : Brought) => obj [("signer", nat i.signer), ("size", nat i.size), ("file", bool i.file)]
  let person := opt fun ((p, l) : VaultId × Option Nat) => obj [("vault", nat p), ("limit", opt nat l)]
  "{" ++ str "name" ++ ": " ++ str c.name ++ ",\n " ++ str "home" ++ ": " ++ nat c.home ++ ",\n " ++ str "held" ++
    ": " ++ heldJson c.edits ++ ",\n " ++ str "limits" ++ ": " ++
    arr (c.limits.map fun (n, b) => obj [("group", str n), ("bytes", nat b)]) ++ ",\n " ++ str "items" ++ ": " ++
    arr (c.items.map item) ++ ",\n " ++ str "kept" ++ ": " ++ arr (c.kept.map bool) ++ ",\n " ++ str "persons" ++
    ": " ++ arr (c.persons.map person) ++ "}"

def admissionCase (c : AdmissionCase) : String :=
  let signup := match c.signup with | .anyone => "anyone" | .invited => "invited" | .known => "known"
  "{" ++ str "name" ++ ": " ++ str c.name ++ ",\n " ++ str "home" ++ ": " ++ nat c.home ++ ",\n " ++ str "held" ++
    ": " ++ heldJson c.edits ++ ",\n " ++ str "signup" ++ ": " ++ str signup ++ ", " ++ str "claimable" ++ ": " ++
    bool c.claimable ++ ", " ++ str "passkey" ++ ": " ++ nat c.passkey ++ ", " ++ str "invite" ++ ": " ++
    opt nat c.invite ++ ",\n " ++ str "honours" ++ ": " ++ bool c.honours ++ "}"

/-- A version case: the step case and entry it reads, the version's heads, the writes left out, and how many writes
    the version holds. -/
def versionCase (c : VersionCase) : String :=
  obj [("case", str c.case), ("entry", nat c.entry), ("heads", ids c.heads), ("left", ids c.left),
       ("writes", nat c.writes)]

def render : String :=
  "{\"groups\": [\n" ++ ",\n".intercalate (groups.map group) ++ "\n],\n\"kinds\": [\n" ++
    ",\n".intercalate (allKinds.map kindRules) ++ "\n],\n\"cases\": [\n" ++
    ",\n".intercalate (cases.map case) ++ "\n],\n\"views\": [\n" ++ ",\n".intercalate (views.map viewCase) ++
    "\n],\n\"syncs\": [\n" ++ ",\n".intercalate (syncs.map syncCase) ++
    "\n],\n\"gates\": [\n" ++ ",\n".intercalate (gates.map gateCase) ++
    "\n],\n\"standings\": [\n" ++ ",\n".intercalate (standings.map standingCase) ++
    "\n],\n\"quotas\": [\n" ++ ",\n".intercalate (quotas.map quotaCase) ++
    "\n],\n\"admissions\": [\n" ++ ",\n".intercalate (admissions.map admissionCase) ++
    "\n],\n\"versions\": [\n" ++ ",\n".intercalate (versionCases.map versionCase) ++ "\n]}\n"

/-- What an edit creates, by the model's number: a vault or a grant. -/
def created : Action → Option (Nat × Nat)
  | .genesis v .. => some (0, v)
  | .share (.grant c _) => some (1, c.id)
  | _ => none

/-- The audiences an edit names. -/
def audiencesOf : Action → List Audience :=
  let named : KeyName → List Audience
    | .scoped (.audience _ x) _ => [x]
    | _ => []
  fun
  | .write _ _ _ _ _ _ _ _ (some (x, _)) _ _ _ => [x]
  | .mark _ _ (some to) _ _ _ => [to]
  | .keys s to _ => named s ++ to.flatMap named
  | .wraps _ ws => ws.flatMap fun (s, t) => named s ++ named t
  | _ => []

/-- Every action of every case. -/
def allActions : List Action :=
  cases.flatMap (·.edits.map (·.2.2)) ++ views.flatMap (·.edits.map (·.2.2.2)) ++
    syncs.flatMap (·.edits.map (·.action)) ++ gates.flatMap (fun c => (c.held ++ c.batch).map (·.2.2.2)) ++
    standings.flatMap (fun c => c.held.map (·.2.2.2)) ++ quotas.flatMap (fun c => c.held.map (·.2.2.2)) ++
    admissions.flatMap fun c => c.held.map (·.2.2.2)

-- every case refuses some edits and accepts others, so neither side can pass by always saying the same thing
#guard cases.all fun c => let (acc, _) := run c.edits; acc.any id && acc.any (!·)
#guard views.all fun c => let (stood, _) := runView c; stood.any id && stood.any (!·)
-- in a view case, every vault and share number is created once, and no two edits share a depth and a rank, so the
-- hashes the Rust core orders by never decide
#guard views.all fun c => nodup (c.edits.filterMap fun (_, _, _, a) => created a)
#guard views.all fun c => nodup (c.toEdits.map fun o => (o.depth, o.rank))
-- in a step case, shares too
#guard cases.all fun c => nodup (c.edits.filterMap fun (_, _, a) => (created a).filter (·.1 != 0))
-- in a gate case, every vault and share number is created once, and no two edits share a depth and a rank
#guard gates.all fun c => let (h, b) := c.edits; nodup ((h ++ b).filterMap fun o => created o.action)
#guard gates.all fun c => let (h, b) := c.edits; nodup ((h ++ b).map fun o => (o.depth, o.rank))
-- in a standing case too
#guard standings.all fun c => nodup (c.edits.filterMap fun o => created o.action)
#guard standings.all fun c => nodup (c.edits.map fun o => (o.depth, o.rank))
-- in a quota case and an admission case too
#guard quotas.all fun c => nodup (c.edits.filterMap fun o => created o.action)
#guard quotas.all fun c => c.items.eraseDups.length == c.items.length
#guard quotas.all fun c => nodup (c.edits.map fun o => (o.depth, o.rank))
#guard admissions.all fun c => nodup (c.edits.filterMap fun o => created o.action)
#guard admissions.all fun c => nodup (c.edits.map fun o => (o.depth, o.rank))
-- every audience a case names is in the model's order, so it names one set of shares whatever order the Rust core keeps
#guard allActions.all fun a => (audiencesOf a).all fun x => x == mkAudience x
-- each kind of settings, share and revocation is accepted or refused as its comment says, wide owner grants and
-- grants to a device among the refused
#guard (cases.find? (·.name == "settings, shares and revocations, kind by kind")).all fun c =>
  (run c.edits).1.drop humans.length == [false, false, false, true, true, false, true, false, true, true, true, false,
    true, false, true, true, false, false, true, false, true, false, true, false, false, true]
-- the four kinds of vault: who may own each, how many owners it has, whether it holds devices, and who acts for it
#guard (cases.find? (·.name == "four kinds of vault, and acts that name their chain")).all fun c =>
  (run c.edits).1.drop humans.length == [true, true, false, true, true, false, false, false, false, false, false, false,
    true, false, false, false, false, false, false, true, true, false, false, true, true, false, false]
-- an aven: one owner, a coop, which owns one aven; it holds devices, its server, and owns nothing
#guard (cases.find? (·.name == "an aven: one coop owner, one per coop, its server its device, owning nothing")).all fun c =>
  (run c.edits).1.drop humans.length == [true, true, true, false, true, true, false, false, false, false, false, false,
    false, true, true, false]
-- a sub cap: the agent writes what every share of its chain allows, and nothing once the coop revokes the aven's
-- share, which ends the agent's too
#guard (cases.find? (·.name == "sub caps: a coop passes on to its worker what another coop gave it")).all fun c =>
  let (acc, st) := run c.edits
  acc.drop humans.length == [true, true, true, true, true, true, true, true, false, false, false, false, true, true,
    true, false, true, true, false, true, true, false] && st.revoked == [30, 31]
-- a vault's removals (a device or an owner revoked, the root handed on) rank above a revoked grant, so the revoked
-- grant that sorts first falls: a Rust core that ranked them the other way round would keep it and drop the removals
#guard (views.find? (·.name == "a vault's removals outrank a revoked grant")).all fun c =>
  (runView c).1.drop humansV.length == [true, true, true, true, false, false, true, true]
#guard (views.find? (·.name == "handing the root on outranks a revoked grant")).all fun c =>
  (runView c).1 == [true, true, true, true, true, false, true]
-- a mark names an audience, wants or both, asks nothing of what they name being live, and is refused only as its
-- comment says; at the end a steward's one mark carries both
#guard (cases.find? (·.name == "marks, part by part")).all fun c =>
  let (acc, st) := run c.edits
  acc.drop humans.length == [true, true, true, true, true, true, false, false, true, false, false, false, false, false,
    false, true, true, true, true, true, true, true] &&
    (st.entry? 21).any fun en => desiredMark st en == some (some [30, 32], some [42])
-- a mark of the wants alone leaves the audience a concurrent mark set, and the mark that sets it cuts nothing of it
#guard (views.find? (·.name == "a mark of the wants alone puts back no audience")).all fun c =>
  let (stood, st) := runView c
  stood.drop humansV.length == [true, true, true, true, true, true, true, true, true, false] &&
    [1, 21].all fun e => (st.entry? e).any fun en => en.audience == [30] && st.wantsOf e == [40]
-- a mark naming a share and a keep share revoked before it stands; readers leave both out, so a steward has nothing
-- left to do
#guard (views.find? (·.name == "a mark stands after what it names is revoked")).all fun c =>
  let (stood, st) := runView c
  stood.drop humansV.length == [true, true, true, true, true, true, true, true, false] &&
    (st.entry? 21).any fun en => en.audience == [30, 31] && st.wantsOf 21 == [40] && desiredMark st en == none
-- only the vault that issued a keep share revokes it, and a mark may name it revoked
#guard (cases.find? (·.name == "keep shares: each device syncs what its keep shares pick")).all fun c =>
  (run c.edits).1.drop humans.length == [true, true, true, true, true, true, true, false, false, false, true, true,
    true, false, false, false, false, false, false, true, false, false, false, true, true, false]
-- each mode, each refusal, a device that left (its keep share, still live, no longer applies), and a copy setting
#guard (cases.find? (·.name == "keep shares: modes, refusals and a device that leaves")).all fun c =>
  let (acc, st) := run c.edits
  let wk (d : SignerId) (e : EntryId) := (st.entry? e).map fun en => (wants st d en, keeps st d en)
  acc.drop humans.length == [true, true, true, true, true, true, true, true, false, false, false, false, true, true,
    true, true, true, true, true, true, true, false, false, true, true, false, true] &&
    [1, 21, 22, 2].map (wk 3) == [some (true, true), some (true, false), some (false, false), some (true, true)] &&
    [1, 21, 2].map (wk 77) == [some (true, false), some (true, false), some (true, false)] &&
    -- Carol's Mac, its keep share over Alice's vault revoked, keeps her notes whole by its copy setting
    wk 7 1 == some (true, true) &&
    st.live 43 && (st.entry? 1).any fun en => semWants st en == [40, 43] && st.wantsOf 1 == [40, 43]
-- revoking a keep share cuts nothing it hadn't seen: no write, no mark and no share falls with it
#guard (views.find? (·.name == "revoking a keep share cuts nothing")).all fun c =>
  let (stood, st) := runView c
  stood.drop humansV.length == [true, true, true, true, true, true, true, true, true, false] &&
    st.revoked == [40] && st.writes.length == 3 && st.wantsOf 21 == [40]
-- a vault's lane holds what its own schema and lens entries that its readers count hold, each blob once: not what
-- Carol creates through a share, nor what a later write makes of an entry, nor a schema its readers don't count; and a
-- write its readers can't tell fits, as before they hold its schema, counts for none of them (T17)
#guard (cases.find? (·.name == "the schema lane")).all fun c =>
  let (acc, st) := run c.edits
  acc.drop humans.length == [true, true, true, true, true, true, true, true, true, true, true, true, false, false,
    false, false, false, true, true, true, true, true] &&
    [100, 200, 102].map (laneOf st) == [[1], [1, 2, 3], []] && st.uncounted == [10, 27]
-- a tuner's merge counts on top of Alice's accept and under its path alone (M1, M2); a merge into a proposal his
-- merge op's line doesn't name counts for no reader either
#guard (cases.find? (·.name == "ops: a tuner merges new defaults of its params into main, and nothing else")).all
  fun c =>
  let (acc, st) := run c.edits
  acc.drop humans.length == [true, true, true, true, true, true, true, true, true, true, true, true, true, true,
    false] &&
    st.accepts == [11, 15] && st.uncounted == [16, 18]
-- Bob's merges into main count only on top of Alice's accept, and bring in nothing written after it (M2); his own
-- write that changes nothing, hers that changes the proposal, and hers on main accept nothing; her own merge and his
-- merge into a proposal need no accept
#guard (cases.find? (·.name ==
    "merges by policy: one of the vault's owners accepts what anyone else merges into main")).all fun c =>
  let (acc, st) := run c.edits
  acc.drop humans.length == [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true,
    true, true, true, true, true, true, false] &&
    st.accepts == [12, 19] && st.uncounted == [11, 16, 18, 21, 26]
-- a draft: Bob's is accepted and counted, a creation on a line that already is refused, his creation on main and
-- Dave's draft through a Suggester share made before drafts counted by no reader; no share's write on the main line of
-- the draft counts before it lands, Carol's merge on top of Alice's accept neither, and Alice's merge lands it, after
-- which Carol's writes on main count; until then its semantic audience leaves everyone out, and no draft of a schema,
-- landed or not, joins the lane
#guard (cases.find? (·.name ==
    "drafts: a suggester proposes a new entry on a line of its own, and only the vault lands it")).all fun c =>
  let (acc, st) := run c.edits
  acc.drop humans.length == [true, true, true, true, true, false, true, true, true, true, true, true, true, true, true,
    true, true, true, true, true, true, true, true] &&
    st.uncounted == [12, 13, 16, 17, 19] && st.accepts == [18] &&
    [1, 2, 3, 4, 5, 6, 7].map (fun e => (st.entry? e).map (landed st)) ==
      [true, true, false, true, true, false, false].map some &&
    (history st.counted 1 none).map (·.edit) == [10, 14, 18, 20, 22] &&
    [1, 6, 4, 7].map (fun e => (st.entry? e).map (semAudience st)) ==
      [[30, 31, 32, 33], [30, 31, 33], [34], []].map some &&
    (st.entry? 1).any (desired st · == none) &&
    laneOf st 100 == [2] && st.writes.any (fun w => w.edit == 10 && w.first && w.proposal == .new)
-- a removed owner's back-dated schema entry falls, and what it held leaves the lane
#guard (views.find? (·.name == "a removed owner's back-dated schema entry is cut")).all fun c =>
  let (stood, st) := runView c
  stood.drop humansV.length == [true, true, true, false, true, true, false] && laneOf st 200 == [1, 2]
-- some entry's creation is let in and another's isn't, some entry is where its readers say it belongs and another
-- isn't yet, some write is on an earlier stay, and some entry fell: the Rust core must say the same of each
#guard cases.any fun c => (run c.edits).2.entries.any (·.admitted) && (run c.edits).2.entries.any (!·.admitted)
#guard cases.any fun c => let st := (run c.edits).2; st.entries.any (desired st · == none) &&
  st.entries.any (desired st · != none)
#guard cases.any fun c => let st := (run c.edits).2; st.writes.any fun w => match st.entry? w.entry with
  | some en => w.stay != en.stay && !w.first
  | none => false
#guard cases.any fun c => let st := (run c.edits).2; st.born.any fun e => (st.entry? e).isNone
-- in a sync case, every vault and share number is created once, an edit builds only on edits before it or on one nobody
-- holds, and no two edits in the replay order share a depth and a rank
#guard syncs.all fun c => nodup (c.edits.filterMap fun o => created o.action)
#guard syncs.all fun c => c.toEdits.all fun o => o.parents.all fun p => p < o.id || p ≥ c.edits.length
#guard syncs.all fun c => nodup ((order c.toEdits).map fun o => (o.depth, o.rank))
-- what a device is sent when it asks is part of what it would be sent whole, and with what it held covers all of it
-- (T12, T19)
#guard syncs.all fun c => let edits := c.toEdits; c.asks.all fun (d, held, peer, fl) =>
  let (h, p) := (heldEdits edits held, peerEdits edits peer)
  let s := respondSince p d (asks h fl)
  s.all (respond p d fl).contains && (respond p d fl).all fun o => h.contains o || s.contains o
-- asking leaves something out, the edits further back leave out more than the frontiers alone and the loose edits more
-- than without them, some device is sent nothing new, some edit is outside its log's closed part, some edit is
-- malformed, and there is a fork
#guard syncs.any fun c => let edits := c.toEdits; c.asks.any fun (d, held, peer, fl) =>
  let p := peerEdits edits peer
  (respondSince p d (asks (heldEdits edits held) fl)).length < (respond p d fl).length
#guard syncs.any fun c => let edits := c.toEdits; c.asks.any fun (d, held, peer, fl) =>
  let (h, p) := (heldEdits edits held, peerEdits edits peer)
  (respondSince p d (asks h fl)).length < (respondSince p d ⟨frontiers h, loose h, fl⟩).length
#guard syncs.any fun c => let edits := c.toEdits; c.asks.any fun (d, held, peer, fl) =>
  let (h, p) := (heldEdits edits held, peerEdits edits peer)
  (respondSince p d (asks h fl)).length < (respondSince p d ⟨(asks h).haves, [], fl⟩).length
#guard syncs.any fun c => let edits := c.toEdits; c.asks.any fun (d, held, peer, fl) =>
  let p := peerEdits edits peer
  (respondSince p d (asks (heldEdits edits held) fl)).isEmpty && !(respond p d fl).isEmpty
#guard syncs.any fun c => let edits := c.toEdits; (logsOf edits).any fun l =>
  (closedPart Edit.log? edits l).length < (inLog Edit.log? edits l).length
#guard syncs.any fun c => (order c.toEdits).length < c.edits.length
-- only writes bring files; files follow their edits (T27): some device fetches every file it may, the one whose write
-- its peer lacks it doesn't, and one that relays fetches none
#guard syncs.all fun c => c.toEdits.all fun o => o.filesOf == o.files
#guard syncs.any fun c => let edits := c.toEdits; c.asks.any fun (d, _, peer, fl) =>
  let p := peerEdits edits peer
  c.files.any (mayFetch p d · fl) && c.files.any (!mayFetch p d · fl)
#guard syncs.any fun c => c.files.all fun f => (c.toEdits.filter (·.files.contains f)).all fun o =>
  standing c.toEdits |>.contains o
#guard syncs.any fun c => !(allForks c.toEdits).isEmpty
-- a relay is sent an entry it may relay and not one it may not, and an audience's log
#guard syncs.any fun c => let edits := c.toEdits; c.asks.any fun (d, _, peer, fl) =>
  let sent := respond (peerEdits edits peer) d fl
  sent.any (fun o => o.log? == some (.entry 1)) && !sent.any (fun o => o.log? == some (.entry 21)) &&
    sent.any fun o => match o.log? with
      | some (.audience ..) => true
      | _ => false
-- some device is sent the log of an audience whose key it can't open: a relay
#guard syncs.any fun c => let edits := c.toEdits; let st := view edits; c.asks.any fun (d, _, peer, fl) =>
  (respond (peerEdits edits peer) d fl).any fun o => match o.log? with
    | some (.audience v x) => !knows st [.signer d] (st.curKey (.audience v x))
    | _ => false
-- what everyone may read goes only to whoever has an interest in its vault or follows it, and following brings
-- nothing else (T12): Carol's Mac, with no interest in Alice's vault, is sent its own vault's log alone, and following
-- it Alice's schema, the share it is in and her vault's log, but not her note; a stranger is sent nothing, and
-- following Alice's vault and Bob's, what Carol's Mac is sent of Alice's and nothing of Bob's
#guard (syncs.find? (·.name == "what everyone may read goes to whoever has an interest")).all fun c =>
  let edits := c.toEdits
  c.asks.map (fun (d, _, _, fl) => (respond edits d fl).map (·.id)) ==
    [[7, 8, 9, 10, 11, 0, 1, 2, 3], [4, 6], [7, 8, 0, 1, 4, 6], [], [7, 8, 0, 1]]
-- a passkey that owns a vault is handed its log, one that owns none nothing, and the card holds only vault logs (T20)
#guard syncs.any fun c => c.links.any fun p => !(linkCard c.toEdits p).isEmpty
#guard syncs.any fun c => c.links.any fun p => (linkCard c.toEdits p).isEmpty
#guard syncs.all fun c => c.links.all fun p => (linkCard c.toEdits p).all fun o => match o.log? with
  | some (.vault _) => true
  | _ => false

/-! ## The lens cases

Stored blocks in every shape the lens tells apart: v0's kind or none; v1's type and level or none, among them a
heading of a level v0 can't say and a level without a type, which neither app can read; checked or not; a language or
not. A v0 app edits each to every kind and to a new text, keeping the kind it reads (a paragraph when it reads none).
A v1 app edits each to every type, keeping the `checked` and `lang` it reads (none when it reads no block), and flips
`checked` and sets a new language, keeping the type it reads (a paragraph when it reads none). Todos have `done`,
`status` and a due date, each stored or not; a v0 app sets `done` either way and edits the notes, a v1 app sets each
status and edits the title. -/

open Lens

def kindV0 : KindV0 → String
  | .h1 => str "h1"
  | .h2 => str "h2"
  | .h3 => str "h3"
  | .p => str "p"
  | .li => str "li"
  | .code => str "code"

def typeV1 : TypeV1 → String
  | .heading => str "heading"
  | .paragraph => str "paragraph"
  | .item => str "item"
  | .code => str "code"

def status : Status → String
  | .«open» => str "open"
  | .doing => str "doing"
  | .done => str "done"

def storedBlock (b : StoredBlock) : String :=
  obj [("id", nat b.id), ("text", str b.text), ("kind", opt kindV0 b.kind), ("type", opt typeV1 b.type),
       ("level", opt nat b.level), ("checked", opt bool b.checked), ("lang", opt str b.lang)]

def blockV0 (b : BlockV0) : String := obj [("id", nat b.id), ("kind", kindV0 b.kind), ("text", str b.text)]

def blockV1 (b : BlockV1) : String :=
  obj [("id", nat b.id), ("type", typeV1 b.type), ("level", opt nat b.level), ("checked", opt bool b.checked),
       ("lang", opt str b.lang), ("text", str b.text)]

def storedTodo (t : StoredTodo) : String :=
  obj [("title", str t.title), ("notes", str t.notes), ("due", opt str t.due), ("done", opt bool t.done),
       ("status", opt status t.status)]

def todoV0 (t : TodoV0) : String :=
  obj [("title", str t.title), ("done", bool t.done), ("notes", str t.notes), ("due", opt str t.due)]

def todoV1 (t : TodoV1) : String :=
  obj [("title", str t.title), ("status", status t.status), ("notes", str t.notes), ("due", opt str t.due)]

def kinds : List KindV0 := [.h1, .h2, .h3, .p, .li, .code]

/-- Each type with the level v0's kinds give it. -/
def types : List (TypeV1 × Option Nat) :=
  [(.heading, some 1), (.heading, some 2), (.heading, some 3), (.paragraph, none), (.item, none), (.code, none)]

def storedBlocks : List StoredBlock :=
  let reps : List (Option TypeV1 × Option Nat) := [(none, none), (some .heading, some 1), (some .heading, some 2),
    (some .heading, some 3), (some .heading, some 4), (some .paragraph, none), (some .item, none),
    (some .code, none), (none, some 2)]
  let shapes := (none :: kinds.map some).flatMap fun k => reps.flatMap fun (t, l) =>
    [none, some true].flatMap fun c => [none, some "sh"].map fun lang => (k, t, l, c, lang)
  (shapes.zipIdx 1).map fun ((k, t, l, c, lang), i) =>
    { id := i, text := "Seeds", kind := k, type := t, level := l, checked := c, lang := lang }

def v0Views (b : StoredBlock) : List BlockV0 :=
  kinds.map (fun k => ⟨b.id, k, b.text⟩) ++ [⟨b.id, (b.v0.map (·.kind)).getD .p, "Seeds, sown"⟩]

def v1Views (b : StoredBlock) : List BlockV1 :=
  let old := b.v1.getD ⟨b.id, .paragraph, none, none, none, b.text⟩
  types.map (fun (t, l) => { old with type := t, level := l }) ++
    [{ old with checked := some !(old.checked.getD false), lang := some "py" }]

def storedTodos : List StoredTodo :=
  [none, some false, some true].flatMap fun done =>
    [none, some .«open», some .doing, some .done].flatMap fun status =>
      [none, some "2026-10-10"].map fun due =>
        { title := "Fix the door", notes := "The hinge squeaks", due, done, status }

def todoV0Views (t : StoredTodo) : List TodoV0 :=
  [{ t.v0 with done := false }, { t.v0 with done := true }, { t.v0 with notes := "Oil the hinge" }]

def todoV1Views (t : StoredTodo) : List TodoV1 :=
  [Status.«open», .doing, .done].map (fun s => { t.v1 with status := s }) ++
    [{ t.v1 with title := "Fix the shed door" }]

def puts (views : List String) : String := "[\n  " ++ ",\n  ".intercalate views ++ "]"

def blockCase (b : StoredBlock) : String :=
  let p1 := (v0Views b).map fun v => obj [("view", blockV0 v), ("stored", storedBlock (b.putV0 v))]
  let p2 := (v1Views b).map fun v => obj [("view", blockV1 v), ("stored", storedBlock (b.putV1 v))]
  "{" ++ str "stored" ++ ": " ++ storedBlock b ++ ",\n " ++ str "v0" ++ ": " ++ opt blockV0 b.v0 ++ ", " ++
    str "v1" ++ ": " ++ opt blockV1 b.v1 ++ ",\n " ++ str "putV0" ++ ": " ++ puts p1 ++ ",\n " ++ str "putV1" ++
    ": " ++ puts p2 ++ "}"

def todoCase (t : StoredTodo) : String :=
  let p1 := (todoV0Views t).map fun v => obj [("view", todoV0 v), ("stored", storedTodo (t.putV0 v))]
  let p2 := (todoV1Views t).map fun v => obj [("view", todoV1 v), ("stored", storedTodo (t.putV1 v))]
  "{" ++ str "stored" ++ ": " ++ storedTodo t ++ ",\n " ++ str "v0" ++ ": " ++ todoV0 t.v0 ++ ", " ++ str "v1" ++
    ": " ++ todoV1 t.v1 ++ ",\n " ++ str "putV0" ++ ": " ++ puts p1 ++ ",\n " ++ str "putV1" ++ ": " ++ puts p2 ++
    "}"

def renderLenses : String :=
  "{\"blocks\": [\n" ++ ",\n".intercalate (storedBlocks.map blockCase) ++ "\n],\n\"todos\": [\n" ++
    ",\n".intercalate (storedTodos.map todoCase) ++ "\n]}\n"

-- every way a put writes is taken by some case, so neither side can pass while skipping one: a v0 edit's new kind as
-- v1's fields and as `kind`, a v1 edit's new type dropping `kind`, a v0 edit's `done` as the status and as `done`, a
-- v1 edit's status dropping `done`; and some edits write nothing at all
#guard storedBlocks.any fun b => (v0Views b).any fun v => (b.putV0 v).type != b.type && (b.putV0 v).kind == b.kind
#guard storedBlocks.any fun b => (v0Views b).any fun v => (b.putV0 v).kind != b.kind
#guard storedBlocks.any fun b => (v1Views b).any fun v => (b.putV1 v).kind != b.kind
#guard storedTodos.any fun t => (todoV0Views t).any fun v => (t.putV0 v).status != t.status
#guard storedTodos.any fun t => (todoV0Views t).any fun v => (t.putV0 v).done != t.done
#guard storedTodos.any fun t => (todoV1Views t).any fun v => (t.putV1 v).done != t.done
#guard storedBlocks.any (fun b => (v0Views b).any (b.putV0 · == b) && (v1Views b).any (b.putV1 · == b)) &&
  storedTodos.any fun t => (todoV0Views t).any (t.putV0 · == t) && (todoV1Views t).any (t.putV1 · == t)

end AvenDB.Vectors

import AvenDB.Props
import AvenDB.Lens
import AvenDB.Gate

/-!
# The plan's scenarios, run on the model

Each `#guard` replays part of an acceptance scenario from the plan and checks what the model says. They run on
every `lake build`, so a change to the model that breaks a scenario fails the build. The Rust scenario tests check
the same things against the real code.

A vault holds its entries directly. A share selects a slice of them by type, author, entry id, creation time and tags,
and the audiences, the sets of shares that select an entry alike, carry the keys. The model never moves an entry on its
own: a steward, a device acting for the vault, moves each entry to the audience its shares select (`desired`) with a
`mark` edit (here `.move`, a mark of the audience alone), so a scenario includes the marks a steward would make, and
checks that it has nothing left to do.
-/

namespace AvenDB.Examples

-- Signers: passkeys and device keys.
def passkeyA := 1
def macA := 2
def phoneA := 3
def passkeyB := 4
def macB := 5
def passkeyC := 6
def macC := 7
def passkeyD := 8
def macD := 9
def stranger := 555

-- Vaults.
def alice := 100
def bob := 101
def carol := 102
def dave := 103
def coop := 200

-- Types and tags.
def doc : Sym := 1
def note : Sym := 2
def todo : Sym := 3
def work : Sym := 11
def home : Sym := 12
def urgent : Sym := 13

-- Entries: the coop's documents, Alice's todos and notes, a todo Bob creates, the server's status page, and two of
-- the coop's todos that an agent of Alice's aven works on.
def welcome := 1
def charter := 2
def onboarding := 3
def door := 21
def seeds := 22
def solar := 23
def plan := 24
def diary := 25
def lamp := 26
def status := 27
def task := 28
def chore := 29

-- Selectors.
def docs : Selector := .anyOf [[.typeIn [doc]]]
def notes : Selector := .anyOf [[.typeIn [note]]]
def todos : Selector := .anyOf [[.typeIn [todo]]]
def workTodos : Selector := .anyOf [[.typeIn [todo], .tagHas work]]
def homeTodos : Selector := .anyOf [[.typeIn [todo], .tagHas home]]
def urgentTodos : Selector := .anyOf [[.typeIn [todo], .tagHas urgent]]
def byId (e : EntryId) : Selector := .anyOf [[.entryIn [e]]]

/-- Share `id` over vault `over`: vault `who` holds `level` on what `sel` selects, the whole vault (a wide share) for
    `all`. A root share, issued by the vault it is over, unless it rests on the owner share `parent`, whose grantee
    `issuer` issues it. -/
def shareOf (id : ShareId) (over who : VaultId) (level : Level) (sel : Selector) (parent : Option ShareId := none)
    (issuer : VaultId := over) : Share :=
  { id, over, who := .vault who, level, wide := sel == .all, select := sel, ops := level.ops, parent,
    issuer }

/-- Keep share `id` over vault `over`: device `d` of vault `issuer` syncs what `sel` selects, all of `over` for `all`,
    as mode `m` says. It grants nothing. -/
def keepShare (id : ShareId) (over issuer : VaultId) (d : SignerId) (m : KeepMode) (sel : Selector) : Share :=
  { id, over, who := .device d, level := .keep m, wide := sel == .all, select := sel, ops := [], parent := none,
    issuer }

/-- Share `id` over vault `over`: everyone reads what `sel` selects. -/
def publicShare (id : ShareId) (over : VaultId) (sel : Selector) : Share :=
  { shareOf id over over .read sel with who := .everyone }

/-- Vault `actor` creates entry `e` of vault `v`, of type `t` with tags `tags`, in audience `x`, through the share
    `proof` names, if it isn't the vault, holding the content `blob` (for a schema or a lens entry, the schema or the
    lens), whose record fits its schemas or not (`fits`), on the main line or, as a draft, on a line of its own
    (`proposal`); for a cap group entry, the cap group its record says (`defines`). -/
def create (v : VaultId) (e : EntryId) (actor : VaultId) (x : Audience) (t : Sym) (tags : List Sym := [])
    (via : List VaultId := []) (proof : Option ShareId := none) (blob : BlobId := 0) (fits : Bool := true)
    (proposal : Proposal := .main) (defines : Option CapGroup := none) : Action :=
  .write v e actor none 0 (proposal := proposal) (via := via) (create := some (x, ⟨t, 0, blob⟩))
    (tags := { add := tags }) (proof := proof) (fits := fits) (defines := defines)

/-- Edits in sequence: each builds on the one before, ids count from `start`. -/
def chain (start : Nat) (steps : List (SignerId × List SignerId × Action)) : List Edit :=
  (steps.zipIdx start).map fun ((author, co, a), i) => { id := i, depth := i, author, cosigners := co, action := a }

/-- The edit a scenario tries next, to see whether it would be accepted. -/
def attempt (author : SignerId) (co : List SignerId) (a : Action) : Edit :=
  { id := 9999, depth := 9999, author, cosigners := co, action := a }

def accepted (edits : List Edit) (edit : Edit) : Bool := (step (view edits) edit).isSome

/-- The edit a scenario tries next is accepted, and its readers count it. -/
def counted (edits : List Edit) (edit : Edit) : Bool :=
  (step (view edits) edit).any fun st => !st.uncounted.contains edit.id

/-- Device `d` opens the current key of family `k`, in what a peer holding `edits` knows. -/
def opens' (edits : List Edit) (d : SignerId) (k : KeyFam) : Bool :=
  let st := view edits
  knows st [.signer d] (st.curKey k)

/-- The entries device `d` reads now, in what a peer holding `edits` knows: it opens the current key of the entry's
    audience, and the entry's key in its current stay at that audience's epoch. -/
def readable (edits : List Edit) (d : SignerId) : List EntryId :=
  let st := view edits
  (st.entries.filter fun en =>
    knows st [.signer d] (st.curKey (.audience en.vault en.audience)) &&
      knows st [.signer d] (entryKey st en)).map (·.id)

def reads (edits : List Edit) (d : SignerId) (e : EntryId) : Bool := (readable edits d).contains e

/-- The entries vault `a` may write, by the rule every peer checks. -/
def writable (edits : List Edit) (a : VaultId) : List EntryId :=
  let st := view edits
  (st.entries.filter (mayWrite st a)).map (·.id)

/-- The audience entry `e` is in. -/
def audienceOf (edits : List Edit) (e : EntryId) : Audience := ((view edits).entry? e).elim [] (·.audience)

/-- What a steward does with entry `e`: nothing (`none`), or mark it into the audience its shares select. -/
def upkeep (edits : List Edit) (e : EntryId) : Option Audience := let st := view edits; (st.entry? e).bind (desired st)

/-- Every entry is in the audience its shares select: a steward has nothing left to do. -/
def tidy (edits : List Edit) : Bool := let st := view edits; st.entries.all (desired st · == none)

/-- The entry whose log an edit belongs to. -/
def entryLog? (o : Edit) : Option EntryId :=
  match o.log? with
  | some (.entry e) => some e
  | _ => none

/-- The edits of a scenario that don't stand, in the order every peer replays them. Replay skips a refused edit without
    a word, so every scenario checks which ones it expects. -/
def refused (edits : List Edit) : List EditId :=
  let stood := standing edits
  (order edits).filterMap fun o => if stood.any (·.id == o.id) then none else some o.id

/-- Edits made on a device that had seen the log only up to depth `d`, each building on the one before, ids counting
    from `start`: they sort before whatever was made elsewhere since. -/
def offline (start d : Nat) (steps : List (SignerId × List SignerId × Action)) : List Edit :=
  (steps.zipIdx).map fun ((author, co, a), i) =>
    { id := start + i, depth := d + 1 + i, author, cosigners := co, action := a }

/-! ## Scenarios 1 and 2: vaults and devices

Each person's passkey is their vault's root, as in the app. -/

def s1 : List Edit := chain 1 [
  (passkeyA, [], .genesis alice .human [.signer passkeyA] 1 (some passkeyA)),
  (passkeyA, [macA], .share (.device alice macA)),
  (passkeyA, [phoneA], .share (.device alice phoneA))]
#guard refused s1 == []

#guard ((view s1).vault? alice).map (·.devices) == some [macA, phoneA]
-- the vault key opens on both devices, and with the key derived from the passkey alone
#guard opens' s1 macA (.seed alice) && opens' s1 phoneA (.seed alice) && opens' s1 passkeyA (.seed alice)
-- the Mac acts for Alice's vault but can't add a device on its own
#guard actsFor (view s1) macA alice
#guard !accepted s1 (attempt macA [77] (.share (.device alice 77)))
#guard accepted s1 (attempt passkeyA [77] (.share (.device alice 77)))
-- a device can't be added without its own signature
#guard !accepted s1 (attempt passkeyA [] (.share (.device alice 77)))
-- the vault's owners hand the root on, as any change, and the new root signs; a device governs nothing
#guard accepted s1 (attempt passkeyA [77] (.settings alice (.root (some 77) [])))
#guard !accepted s1 (attempt passkeyA [] (.settings alice (.root (some 77) [])))
#guard !accepted s1 (attempt macA [77] (.settings alice (.root (some 77) [])))
-- the root signs the genesis that names it
#guard !accepted [] (attempt passkeyA [] (.genesis alice .human [.signer passkeyA] 1 (some 77)))

def s2 : List Edit := s1 ++ chain 10 [
  (passkeyB, [], .genesis bob .human [.signer passkeyB] 1 (some passkeyB)),
  (passkeyB, [macB], .share (.device bob macB)),
  (passkeyC, [], .genesis carol .human [.signer passkeyC] 1 (some passkeyC)),
  (passkeyC, [macC], .share (.device carol macC)),
  (passkeyD, [], .genesis dave .human [.signer passkeyD] 1 (some passkeyD)),
  (passkeyD, [macD], .share (.device dave macD))]
#guard refused s2 == []

-- a second passkey joins Alice's vault at threshold 2; the root still approves alone, the other passkey doesn't
def twoKeys : List Edit := s1 ++ chain 140 [
  (passkeyA, [77], .share (.owner alice (.signer 77))),
  (passkeyA, [], .settings alice (.threshold 2))]
#guard refused twoKeys == []
#guard accepted twoKeys (attempt passkeyA [78] (.share (.device alice 78)))
#guard !accepted twoKeys (attempt 77 [78] (.share (.device alice 78)))
-- a coop has no root
#guard !accepted s2 (attempt passkeyA [passkeyB] (.genesis coop .coop [.vault alice, .vault bob] 2 (some passkeyA)))

/-! ## A Touch ID key: a second owner on one Mac

A Mac's Secure Enclave holds a key behind Touch ID that never leaves the chip (Samuel, 2026-10-19). Alice's passkey
adds it once as an owner of her vault, with its own signature; from then on her finger on that Mac approves for her
vault as her passkey does at threshold 1, with no passkey at all: a new device, a device revoked. It is an owner like a
second passkey (`twoKeys`), so no rule changes; what changes is only how it signs, which the model abstracts. Every
owner is equal (Samuel, 2026-10-19): the key may hand the root on or give it up, as the passkey may; where their
removals clash the owner who joined first stands, here the passkey, so a lost Mac's key goes with one revocation. The
Mac's device itself still governs nothing. -/

def touchA := 79

def touch : List Edit := s1 ++ chain 150 [(passkeyA, [touchA], .share (.owner alice (.signer touchA)))]
#guard refused touch == []
#guard ((view touch).vault? alice).map (·.owners) == some [.signer passkeyA, .signer touchA]
-- it joins only with its own signature, and only the vault adds it: not the Mac's device, nor the key on its own
#guard !accepted s1 (attempt passkeyA [] (.share (.owner alice (.signer touchA))))
#guard !accepted s1 (attempt macA [touchA] (.share (.owner alice (.signer touchA))))
#guard !accepted s1 (attempt touchA [] (.share (.owner alice (.signer touchA))))
-- Touch ID alone approves for the vault: a new device joins, a device goes; and the vault's key opens with it
#guard accepted touch (attempt touchA [78] (.share (.device alice 78)))
#guard accepted touch (attempt touchA [] (.revoke (.device alice phoneA [])))
#guard opens' touch touchA (.seed alice)
-- the Mac's device still governs nothing, Touch ID key or not
#guard !accepted touch (attempt macA [78] (.share (.device alice 78)))
-- an owner like the passkey, the key hands the root on, takes it, or gives it up; the new root signs
#guard accepted touch (attempt touchA [78] (.settings alice (.root (some 78) [])))
#guard accepted touch (attempt touchA [] (.settings alice (.root (some touchA) [])))
#guard accepted touch (attempt touchA [] (.settings alice (.root none [])))
#guard !accepted touch (attempt touchA [] (.settings alice (.root (some 78) [])))

-- the key may take the passkey off the owners; the passkey stays the root until an owner changes that, so it still
-- approves alone, and it comes back as an owner and removes the key (never the last owner, so in that order)
def keyAlone : List Edit := touch ++ chain 151 [(touchA, [], .revoke (.owner alice (.signer passkeyA) [150]))]
#guard refused keyAlone == []
#guard ((view keyAlone).vault? alice).map (·.owners) == some [.signer touchA]
#guard ((view keyAlone).vault? alice).map (·.root) == some (some passkeyA)
#guard accepted keyAlone (attempt passkeyA [78] (.share (.device alice 78)))
#guard !accepted keyAlone (attempt passkeyA [] (.revoke (.owner alice (.signer touchA) [151])))
def rootBack : List Edit := keyAlone ++ chain 152 [
  (passkeyA, [], .share (.owner alice (.signer passkeyA))),
  (passkeyA, [], .revoke (.owner alice (.signer touchA) [150, 151, 152]))]
#guard refused rootBack == []
#guard ((view rootBack).vault? alice).map (·.owners) == some [.signer passkeyA]

-- the Mac is lost: the passkey revokes its key, and the key, on a copy that hadn't seen that, takes the passkey off the
-- owners. The passkey joined first, so its removal stands and the key's falls; the key approves nothing more
def lostMac : List Edit := touch ++ chain 151 [(passkeyA, [], .revoke (.owner alice (.signer touchA) [150]))] ++
  offline 170 150 [(touchA, [], .revoke (.owner alice (.signer passkeyA) []))]
#guard refused lostMac == [170]
#guard ((view lostMac).vault? alice).map (·.owners) == some [.signer passkeyA]
#guard !accepted lostMac (attempt touchA [78] (.share (.device alice 78)))
#guard !opens' lostMac touchA (.seed alice)

/-! ## Scenario 3: a coop of two vaults, threshold 2 -/

def s3 : List Edit := s2 ++ chain 20 [
  (passkeyA, [passkeyB], .genesis coop .coop [.vault alice, .vault bob] 2)]
#guard refused s3 == []

-- Bob has to consent to becoming an owner
#guard !accepted s2 (attempt passkeyA [] (.genesis coop .coop [.vault alice, .vault bob] 2))
#guard (view s3).vault? coop |>.isSome
-- the coop key opens on Bob's Mac and on both of Alice's devices, and nowhere else
#guard opens' s3 macB (.seed coop) && opens' s3 macA (.seed coop) && opens' s3 phoneA (.seed coop)
#guard !opens' s3 macC (.seed coop) && !opens' s3 stranger (.seed coop)
-- a coop can't own itself, and Alice's vault alone can't add an owner to a threshold-2 coop
#guard !accepted s3 (attempt passkeyA [passkeyB] (.share (.owner coop (.vault coop))))
#guard !accepted s3 (attempt passkeyA [passkeyD] (.share (.owner coop (.vault dave))))
#guard accepted s3 (attempt passkeyA [passkeyB, passkeyD] (.share (.owner coop (.vault dave))))
-- with nothing shared yet, Alice's Mac sends Bob's Mac the coop's log, Carol's Mac nothing of it, a stranger nothing
#guard (respond s3 macB).any (·.log? == some (.vault coop))
#guard (respond s3 macC).all (·.log? != some (.vault coop)) && (respond s3 stranger).isEmpty

/-! ## Four kinds of vault

The vault is the identity. A human vault is owned by its person's passkeys, and its devices act for it. A coop vault
is owned by human and coop vaults. An aven, a coop's own agent, is owned by that coop alone, one aven to a coop and
none to a person; it lives on its server: the server is its device, which acts for it but never governs it. The seed
Alice's vault founds as it claims the server is Maia City, a coop her vault owns alone, and avenMAIA, its aven, with
the server as its device. A device vault is owned by one human, coop or aven vault, and its devices, an agent's
harness or a studio worker, act for it but never govern it: an aven's agents run in device vaults it owns. No signer
owns any vault but a human vault. Each kind's rules are one row of the kind table, `Kind.rules`. -/

def city := 210
def serverVault := 300
def server := 600

/-- The seed Alice's vault founds as it claims the server, from edit `n` on: Maia City and its aven, avenMAIA, with
the server added to the aven as its device. -/
def seed (n : Nat) : List Edit := chain n [
  (passkeyA, [], .genesis city .coop [.vault alice] 1),
  (passkeyA, [], .genesis serverVault .aven [.vault city] 1),
  (passkeyA, [server], .share (.device serverVault server))]

def sServer : List Edit := s3 ++ seed 400
#guard refused sServer == []

-- the server acts for its aven, and so do Alice's devices, through Alice's vault and Maia City; Bob's don't
#guard actsFor (view sServer) server serverVault && actsFor (view sServer) macA serverVault &&
  !actsFor (view sServer) macB serverVault
#guard actsFor (view sServer) macA city && !actsFor (view sServer) server city
-- the aven's key opens on the server and on Alice's devices; neither Alice's vault's key nor Maia City's opens on
-- the server
#guard opens' sServer server (.seed serverVault) && opens' sServer phoneA (.seed serverVault)
#guard !opens' sServer server (.seed alice) && !opens' sServer macB (.seed serverVault)
#guard !opens' sServer server (.seed city)
-- the server doesn't govern its aven: it adds no device; Alice's passkey does, through Alice's vault
#guard !accepted sServer (attempt server [77] (.share (.device serverVault 77)))
#guard accepted sServer (attempt passkeyA [77] (.share (.device serverVault 77)))
-- an aven has one owner: Bob's vault doesn't join it; nor is a device vault founded with two
#guard !accepted sServer (attempt passkeyA [passkeyB] (.share (.owner serverVault (.vault bob))))
#guard !accepted s3 (attempt passkeyA [passkeyB] (.genesis serverVault .deviceVault [.vault alice, .vault coop] 1))
-- signers own human vaults only, and a human vault no vault
#guard !accepted s2 (attempt passkeyA [] (.genesis serverVault .deviceVault [.signer passkeyA] 1))
#guard !accepted s2 (attempt passkeyA [passkeyB] (.genesis coop .coop [.signer passkeyA, .vault bob] 1))
#guard !accepted sServer (attempt passkeyA [77] (.share (.owner serverVault (.signer 77))))
#guard !accepted s3 (attempt passkeyA [passkeyB] (.share (.owner alice (.vault bob))))
-- a device vault owns no vault, and has no root; a coop has no devices, and may own a device vault
#guard !accepted sServer (attempt passkeyA [passkeyB] (.share (.owner coop (.vault serverVault))))
#guard !accepted sServer (attempt passkeyA [] (.genesis 301 .coop [.vault serverVault] 1))
#guard !accepted s2 (attempt passkeyA [] (.genesis serverVault .deviceVault [.vault alice] 1 (some passkeyA)))
#guard !accepted s3 (attempt passkeyA [passkeyB, 77] (.share (.device coop 77)))
#guard accepted s3 (attempt passkeyA [passkeyB] (.genesis serverVault .deviceVault [.vault coop] 1))

-- Alice's coop, its aven with its server, the device `avenServer`, and a studio worker of the coop, a device vault
-- whose device is `worker`
def coopA := 212
def avenA := 310
def workerVault := 311
def worker := 77
def avenServer := 78

def sAven : List Edit := s3 ++ chain 400 [
  (passkeyA, [], .genesis coopA .coop [.vault alice] 1),
  (passkeyA, [], .genesis avenA .aven [.vault coopA] 1),
  (passkeyA, [avenServer], .share (.device avenA avenServer)),
  (passkeyA, [], .genesis workerVault .deviceVault [.vault coopA] 1),
  (passkeyA, [worker], .share (.device workerVault worker))]
#guard refused sAven == []

-- the aven's server acts for the aven, and Alice's devices do through the coop and her vault; the server acts for
-- nothing else, and the worker for its device vault alone
#guard actsFor (view sAven) avenServer avenA && actsFor (view sAven) macA avenA && !actsFor (view sAven) avenServer coopA
#guard actsFor (view sAven) worker workerVault && !actsFor (view sAven) worker avenA
-- one owner, a coop, which has one aven: Alice's coop has no second, the two people's coop founds its own, and no
-- person, no two coops and no signer found one; nobody joins Alice's coop's as a second owner
#guard !accepted sAven (attempt passkeyA [] (.genesis 312 .aven [.vault coopA] 1))
#guard accepted sAven (attempt passkeyA [passkeyB] (.genesis 312 .aven [.vault coop] 1))
#guard !accepted sAven (attempt passkeyB [] (.genesis 312 .aven [.vault bob] 1))
#guard !accepted sAven (attempt passkeyA [passkeyB] (.genesis 312 .aven [.vault coopA, .vault coop] 1))
#guard !accepted sAven (attempt passkeyA [] (.genesis 312 .aven [.signer passkeyA] 1))
#guard !accepted sAven (attempt passkeyA [passkeyC] (.share (.owner avenA (.vault carol))))
-- an aven owns nothing: no agent's device vault, no coop, no aven; its server governs it in nothing
#guard !accepted sAven (attempt passkeyA [] (.genesis 312 .deviceVault [.vault avenA] 1))
#guard !accepted sAven (attempt passkeyA [] (.genesis 312 .coop [.vault avenA] 1))
#guard !accepted sAven (attempt passkeyA [] (.genesis 313 .aven [.vault avenA] 1))
#guard !accepted sAven (attempt avenServer [79] (.share (.device avenA 79)))

-- who wrote an entry of Alice's coop: its aven and Alice, whose Mac signed its write, never the coop itself
def sAuthored : List Edit := sAven ++ chain 405 [(macA, [], create coopA welcome coopA [] doc (via := [alice]))]
#guard refused sAuthored == []
#guard authors (view sAuthored) welcome ((view sAuthored).writes.map (·.edit)) == [avenA, alice]

/-! ## Acts name their chain

An edit that acts for a vault names the owners it goes through, down to the vault its device belongs to: Alice's Mac
writes for the coop through Alice's vault. A chain that skips a link, or runs through a vault the device doesn't
belong to, is refused. -/

-- Alice's Mac creates the coop's Welcome through Alice's vault; with no chain, or through Bob's vault, it can't
#guard accepted s3 (attempt macA [] (create coop welcome coop [] doc (via := [alice])))
#guard !accepted s3 (attempt macA [] (create coop welcome coop [] doc))
#guard !accepted s3 (attempt macA [] (create coop welcome coop [] doc (via := [bob])))
-- nor through Carol's vault, which doesn't own the coop
#guard !accepted s3 (attempt macC [] (create coop welcome coop [] doc (via := [carol])))
-- the server creates an entry for its aven directly, Alice's Mac through Maia City and Alice's vault
#guard accepted sServer (attempt server [] (create serverVault status serverVault [] note))
#guard accepted sServer
  (attempt macA [] (create serverVault status serverVault [] note (via := [city, alice])))
#guard !accepted sServer (attempt macA [] (create serverVault status serverVault [] note (via := [alice])))
#guard !accepted sServer (attempt macA [] (create serverVault status serverVault [] note))

-- a coop of the coop: Bob's Mac acts for it through the coop and Bob's vault, and may skip neither
def guild := 203
def sGuild : List Edit := s3 ++ chain 410 [(passkeyA, [passkeyB], .genesis guild .coop [.vault coop] 1)]
#guard refused sGuild == []
#guard accepted sGuild (attempt macB [] (create guild welcome guild [] doc (via := [coop, bob])))
#guard !accepted sGuild (attempt macB [] (create guild welcome guild [] doc (via := [bob])))
#guard !accepted sGuild (attempt macB [] (create guild welcome guild [] doc (via := [coop])))

/-! ## Sub caps

A vault holding a share passes part of it on to a vault it owns, by the rule every share that rests on another follows
(`shareParentOk`): Alice's coop, given the two people's coop's todos to write, passes the work todos on to its studio
worker's device vault. The worker's share rests on the coop's, no higher and no wider; its keys reach the worker as any
share's reach its grantee, the worker writes only what both shares select, and its share ends when the two people's
coop revokes Alice's coop's. -/

def subCaps : List Edit := sAven ++ chain 420 [
  (macA, [], create coop task coop [] todo [work] (via := [alice])),
  (macA, [], create coop chore coop [] todo (via := [alice])),
  (macA, [], .share (.grant (shareOf 60 coop coopA .write todos) [alice])),
  (macA, [], .share (.grant
    (shareOf 61 coop workerVault .write workTodos (parent := some 60) (issuer := coopA)) [alice])),
  (macA, [], .move coop task [60, 61] [] [alice]),
  (macA, [], .move coop chore [60] [] [alice])]
#guard refused subCaps == [] && tidy subCaps
-- the worker writes and reads the work todo, and not the chore; Alice's coop writes both
#guard writable subCaps workerVault == [task] && writable subCaps coopA == [task, chore]
#guard readable subCaps worker == [task]
-- the worker's share is no higher than the coop's and no wider, and goes to no vault the coop doesn't own; the
-- worker's vault, which owns nothing and was given no share op, passes nothing on
#guard !accepted subCaps (attempt passkeyA [] (.share (.grant
  (shareOf 62 coop workerVault .owner workTodos (parent := some 60) (issuer := coopA)) [alice])))
#guard !accepted subCaps (attempt macA [] (.share (.grant
  (shareOf 62 coop workerVault .read .all (parent := some 60) (issuer := coopA)) [alice])))
#guard !accepted subCaps (attempt macA [] (.share (.grant
  (shareOf 62 coop carol .read workTodos (parent := some 60) (issuer := coopA)) [alice])))
#guard !accepted subCaps (attempt worker [] (.share (.grant
  (shareOf 62 coop dave .read workTodos (parent := some 61) (issuer := workerVault)))))
-- the two people's coop revokes Alice's coop's share, and the worker's ends with it
def subRevoked : List Edit := subCaps ++ chain 430 [
  (macA, [], .revoke (.grant 60 coop [420, 421, 422, 423, 424, 425] [alice]))]
#guard refused subRevoked == [] && [60, 61].all (!(view subRevoked).live ·)
#guard writable subRevoked workerVault == [] && writable subRevoked coopA == []

/-! ## Scenario 28: an access request is a record and a share

No new kind of edit asks for access. Alice's vault shares one new entry, its request to Bob's vault, by a share whose
ops read it and set its `answer` to granted or denied and its `part` (`answering`), and creates the entry straight in
that share's audience: Bob's Mac reads it, Carol's doesn't. Bob's vault writes the answer through the share, which its readers
count; a write through it that touches anything else counts for none. Granting is then a share of Bob's vault to
Alice's, as any share. -/

def accessRequest := 30
def requestType : Sym := 4
def asking : List Edit := s2 ++ chain 800 [
  (macA, [], .share (.grant { shareOf 63 alice bob .write (byId accessRequest) with ops := answering })),
  (macA, [], create alice accessRequest alice [63] requestType)]
def answered (touch : Touch) : List Edit := asking ++ chain 810 [
  (macB, [], .write alice accessRequest bob none 0 [801] (proof := some 63) (touches := [touch]))]
#guard refused asking == [] && tidy asking
#guard readable asking macB == [accessRequest] && readable asking macC == []
-- Bob's answer counts; a write of its why, or of another answer, stands and counts for no reader
#guard let st := view (answered (.set [.field "answer"] (some (.str "granted")))); st.counted.any (·.edit == 810)
#guard let st := view (answered (.set [.field "why"] (some (.str "because")))); !st.counted.any (·.edit == 810)
#guard let st := view (answered (.set [.field "answer"] (some (.str "maybe")))); !st.counted.any (·.edit == 810)
-- and its part of an owner add it grants, which counts too
#guard let st := view (answered (.set [.field "part"] (some (.str "AQID"))))
  st.counted.any (·.edit == 810)

/-! ## Scenarios 4 to 7: entries, writes, one document via a share, public

The coop's Handbook is the coop's documents, in its vault. An entry no share selects is in the audience of no shares,
which only the vault reads. A share moves nothing by itself: a steward, a device acting for the coop, moves each entry
to the audience its shares select, and creates a new one straight there. -/

def s4 : List Edit := s3 ++ chain 30 [
  (macA, [], create coop welcome coop [] doc (via := [alice])),
  (macA, [], create coop onboarding coop [] doc (via := [alice]))]
#guard refused s4 == [] && tidy s4

-- both are in the audience of no shares: Bob's Mac reads them through the coop; Carol and a stranger can't
#guard audienceOf s4 welcome == [] && readable s4 macB == [welcome, onboarding]
#guard readable s4 macC == [] && readable s4 stranger == []
-- Bob's Mac receives Welcome's log, Carol's Mac doesn't
#guard (respond s4 macB).any (entryLog? · == some welcome) && !(respond s4 macC).any (entryLog? · == some welcome)

def s5 : List Edit := s4 ++ chain 40 [
  (macB, [], .write coop welcome coop none 0 [30] (via := [bob]))]
#guard refused s5 == []

-- a write names a stay its entry has been in, under the epoch its writer names: under one its stay's audience hasn't
-- reached, it stands, and nobody opens it until the audience does
#guard !accepted s5 (attempt macB [] (.write coop welcome coop (some 77) 0 [40] (via := [bob])))
#guard ((step (view s5) (attempt macB [] (.write coop welcome coop none 1 [40] (via := [bob])))).map fun st =>
  !knows st [.signer macB] (.entry welcome none 1)) == some true
-- and builds only on writes of its own entry
#guard !accepted s5 (attempt macB [] (.write coop onboarding coop none 0 [40] (via := [bob])))

def s6 : List Edit := s5 ++ chain 50 [
  (macA, [], .share (.grant (shareOf 1 coop carol .read (byId welcome)) [alice])),
  -- a steward, acting for the coop, moves Welcome to the audience of that share
  (macA, [], .move coop welcome [1] [30, 40] [alice])]
#guard refused s6 == [] && tidy s6

-- the share alone moves nothing: Carol reads Welcome only once a steward has moved it
#guard upkeep s6.dropLast welcome == some [1] && !reads s6.dropLast macC welcome
#guard readable s6 macC == [welcome] && audienceOf s6 welcome == [1]
-- she reads its whole history, written before her share: the move linked its old key to the new one
#guard knows (view s6) [.signer macC] (.entry welcome none 0)
-- she can't edit it, and Bob's Mac still reads both documents
#guard !accepted s6 (attempt macC [] (.write coop welcome carol (some 51) 0 [40]))
#guard readable s6 macB == [welcome, onboarding]
-- a share names a device only as a keep share, of a device of its issuer (T4): Carol keeps Welcome whole on her Mac,
-- which lets her read nothing more; the coop has no device to keep its entries on, and Carol keeps nothing on Alice's
#guard !accepted s6 (attempt macA [] (.share (.grant { shareOf 2 coop carol .read (byId welcome) with
                                                      who := .device macC } [alice])))
#guard accepted s6 (attempt macC [] (.share (.grant (keepShare 2 coop carol macC .whole (byId welcome)))))
#guard !accepted s6 (attempt macA [] (.share (.grant (keepShare 2 coop coop macC .whole (byId welcome)) [alice])))
#guard !accepted s6 (attempt macC [] (.share (.grant (keepShare 2 coop carol macA .whole (byId welcome)))))
-- Carol's Mac keeps a full copy: a wide whole keep share over her own vault, its copy setting, stands for every vault
-- where it has no keep share of its own (`keepsFor`), so it keeps Welcome's files whole; Bob's Mac, with neither, syncs
-- Welcome and keeps none of its files
def s6copy : List Edit := s6 ++ chain 55 [(macC, [], .share (.grant (keepShare 2 carol carol macC .whole .all)))]
#guard refused s6copy == []
#guard ((view s6copy).entry? welcome).any fun en => wants (view s6copy) macC en && keeps (view s6copy) macC en
#guard ((view s6copy).entry? welcome).any fun en => wants (view s6copy) macB en && !keeps (view s6copy) macB en

def s7 : List Edit := s6 ++ chain 60 [
  (macA, [], .share (.grant (publicShare 3 coop (byId charter)) [alice])),
  -- a steward creates Charter straight in the audience its share selects
  (macA, [], create coop charter coop [3] doc (via := [alice]))]
#guard refused s7 == [] && tidy s7

-- anyone opens Charter, and nothing else; everyone can't be given write (T8)
#guard readable s7 stranger == [charter]
#guard !accepted s7
  (attempt macA [] (.share (.grant { publicShare 4 coop (byId charter) with level := .write } [alice])))

/-! ## Slices: shares select entries, audiences carry the keys

Alice's vault holds her todos and her notes directly, each made in the audience of no shares. She shares with Bob all
her todos, or only those tagged work, or one note by its id. Her Mac, a steward, then moves each entry to the audience
its shares select, and Bob reads exactly what his share selects, and writes only where it has write. -/

def lib : List Edit := s2 ++ chain 500 [
  (macA, [], create alice door alice [] todo [work]),
  (macA, [], create alice seeds alice [] todo [home]),
  (macA, [], create alice solar alice [] todo [work]),
  (macA, [], create alice plan alice [] note [work]),
  (macA, [], create alice diary alice [] note)]
-- no share selects them yet: they are in the audience of no shares, and Bob reads none of them
#guard refused lib == [] && tidy lib && readable lib macB == []

-- all of Alice's todos, read: the share alone moves nothing, a steward has three todos to move into its audience
def allTodos : List Edit := lib ++ chain 510 [(macA, [], .share (.grant (shareOf 31 alice bob .read todos)))]
#guard [door, seeds, solar, plan, diary].map (upkeep allTodos) == [some [31], some [31], some [31], none, none]
#guard readable allTodos macB == []
def allTodos' : List Edit := allTodos ++ chain 511 [
  (macA, [], .move alice door [31] [500]),
  (macA, [], .move alice seeds [31] [501]),
  (macA, [], .move alice solar [31] [502])]
-- moved, Bob reads the three todos and neither note, and writes none of them
#guard refused allTodos' == [] && tidy allTodos'
#guard readable allTodos' macB == [door, seeds, solar] && writable allTodos' bob == []
#guard !accepted allTodos' (attempt macB [] (.write alice door bob (some 511) 0 [500]))

-- only the todos tagged work, write
def workShare : List Edit := lib ++ chain 510 [
  (macA, [], .share (.grant (shareOf 32 alice bob .write workTodos))),
  (macA, [], .move alice door [32] [500]),
  (macA, [], .move alice solar [32] [502])]
-- moved, Bob reads and writes the two todos tagged work, not the one tagged home nor the note tagged work
#guard refused workShare == [] && tidy workShare
#guard readable workShare macB == [door, solar] && writable workShare bob == [door, solar]
#guard accepted workShare (attempt macB [] (.write alice door bob (some 511) 0 [500]))
#guard !accepted workShare (attempt macB [] (.write alice seeds bob none 0 [501]))

-- one note, by its id, write
def onePlan : List Edit := lib ++ chain 510 [
  (macA, [], .share (.grant (shareOf 33 alice bob .write (byId plan)))),
  (macA, [], .move alice plan [33] [503])]
-- moved, Bob reads and writes that note alone
#guard refused onePlan == [] && tidy onePlan
#guard readable onePlan macB == [plan] && writable onePlan bob == [plan]
#guard accepted onePlan (attempt macB [] (.write alice plan bob (some 511) 0 [503]))
#guard !accepted onePlan (attempt macB [] (.write alice diary bob none 0 [504]))

-- an audience is the set of shares that select its entries alike: Carol writes all of Alice's todos and Bob the ones
-- tagged work, so the two work todos share an audience of both shares, and the other todo is in Carol's alone
def shared : List Edit := lib ++ chain 510 [
  (macA, [], .share (.grant (shareOf 31 alice carol .write todos))),
  (macA, [], .share (.grant (shareOf 32 alice bob .write workTodos))),
  (macA, [], .move alice door [31, 32] [500]),
  (macA, [], .move alice seeds [31] [501]),
  (macA, [], .move alice solar [31, 32] [502])]
-- moved, Bob reads and writes the two work todos, Carol all three
#guard refused shared == [] && tidy shared
#guard [door, seeds, solar, plan, diary].map (audienceOf shared) == [[31, 32], [31], [31, 32], [], []]
#guard readable shared macB == [door, solar] && writable shared bob == [door, solar]
#guard readable shared macC == [door, seeds, solar] && writable shared carol == [door, seeds, solar]

/-! ## Retagging moves an entry out of a slice

Only the vault's own devices change tags. Alice takes the work tag off the solar todo: Bob's share no longer selects it,
and her Mac moves it to the audience of no shares. From the move on, Bob writes it no more, nor opens its new key, while
he keeps what he could read up to the move. -/

def retag : List Edit := workShare ++ chain 520 [
  (macA, [], .write alice solar alice (some 512) 0 [502] (tags := { remove := [work] }))]
-- Alice's tag counts: the todo leaves Bob's slice, and a steward has it to move to the audience of no shares
#guard refused retag == []
#guard upkeep retag solar == some [] && ((view retag).entry? solar).map (·.attrs.tags) == some []
-- Bob can only ask for a tag to change: a tag in his write changes nothing
#guard upkeep (workShare ++ chain 520 [(macB, [], .write alice door bob (some 511) 0 [500]
                                               (tags := { remove := [work] }))]) door == none
def retag' : List Edit := retag ++ chain 521 [(macA, [], .move alice solar [] [502, 520])]
-- moved, Bob reads and writes the door todo alone
#guard refused retag' == [] && tidy retag'
#guard readable retag' macB == [door] && writable retag' bob == [door]
#guard !accepted retag' (attempt macB [] (.write alice solar bob (some 521) 0 [520]))
-- Bob opens neither the key solar has now nor its audience's, but still the key of its stay before the move, and so
-- everything written up to the move
#guard !opens' retag' macB (.audience alice [])
#guard ((view retag').entry? solar).any fun en => !knows (view retag') [.signer macB] (entryKey (view retag') en)
#guard knows (view retag') [.signer macB] (.entry solar (some 512) 0)
#guard knows (view retag') [.signer macB] (.entry solar none 0)

/-! ## Creating through a share

A writer that isn't a steward sees no other share, so it can't work out where a new entry belongs: it creates it in its
share's intake audience, the audience of its share's chain, which only those shares' grantees and the vault read. Every
peer checks only that; whether the entry lies in the writer's slice (`admits`, the entry's `admitted`) only the stewards
can tell, and one moves it on to its semantic audience. -/

-- Bob creates the lamp todo, tagged work, in his share's intake audience, and nowhere else
def intake : List Edit := shared ++ chain 520 [(macB, [], create alice lamp bob [32] todo [work] (proof := some 32))]
#guard refused intake == []
#guard !accepted shared (attempt macB [] (create alice lamp bob [] todo [work]))
#guard !accepted shared (attempt macB [] (create alice lamp bob [31, 32] todo [work]))
-- it lies in his slice; Carol's share selects it too, but she reads it only once a steward has moved it
#guard admits (view shared) bob alice [32] ⟨todo, bob, lamp, 0, [work]⟩ (some 32) true
#guard ((view intake).entry? lamp).map (·.admitted) == some true
#guard upkeep intake lamp == some [31, 32] && !reads intake macC lamp && reads intake macB lamp
def intake' : List Edit := intake ++ chain 521 [(macA, [], .move alice lamp [31, 32] [520])]
-- moved, Carol reads it too, and Bob still reads and writes it
#guard refused intake' == [] && tidy intake'
#guard reads intake' macC lamp && reads intake' macB lamp && (writable intake' bob).contains lamp

-- a note Bob makes in the same audience is accepted too, but lies outside his slice: a steward moves it to the audience
-- of no shares, where only Alice reads it, keeping what Bob wrote
def outside : List Edit := shared ++ chain 520 [(macB, [], create alice lamp bob [32] note [work] (proof := some 32))]
#guard refused outside == []
#guard !admits (view shared) bob alice [32] ⟨note, bob, lamp, 0, [work]⟩ (some 32) true
#guard ((view outside).entry? lamp).map (·.admitted) == some false && upkeep outside lamp == some []
def outside' : List Edit := outside ++ chain 521 [(macA, [], .move alice lamp [] [520])]
-- moved, Bob neither reads nor writes it, and it stays
#guard refused outside' == [] && tidy outside'
#guard !reads outside' macB lamp && reads outside' macA lamp && !(writable outside' bob).contains lamp
#guard ((view outside').entry? lamp).isSome

/-! ## A share resting on a share

An owner may share its slice on: a share resting on an owner share is issued by that share's grantee, and grants only
what every share of its chain selects (T22). Alice makes Carol owner of her todos, a governance act, and Carol gives
Dave the home todos and, claiming more than she holds, the notes. Revoking Carol's share ends both. -/

def resting : List Edit := lib ++ chain 540 [
  (passkeyA, [], .share (.grant (shareOf 41 alice carol .owner todos))),
  (macC, [], .share (.grant (shareOf 42 alice dave .read homeTodos (parent := some 41) (issuer := carol)))),
  (macC, [], .share (.grant (shareOf 43 alice dave .read notes (parent := some 41) (issuer := carol))))]
#guard refused resting == []

-- a device alone can't make anyone owner, and only the grantee of an owner share issues on it
#guard !accepted lib (attempt macA [] (.share (.grant (shareOf 41 alice carol .owner todos))))
#guard !accepted resting (attempt macB []
  (.share (.grant (shareOf 44 alice bob .read todos (parent := some 41) (issuer := bob)))))
#guard !accepted resting (attempt macD []
  (.share (.grant (shareOf 44 alice bob .read todos (parent := some 42) (issuer := dave)))))
-- a wide share rests only on a wide one; an owner share resting on Carol's takes her own approval
#guard !accepted resting (attempt macC []
  (.share (.grant (shareOf 44 alice dave .read .all (parent := some 41) (issuer := carol)))))
#guard !accepted resting (attempt macC [] (.share (.grant (shareOf 44 alice dave .owner homeTodos (some 41) carol))))
#guard accepted resting (attempt passkeyC [] (.share (.grant (shareOf 44 alice dave .owner homeTodos (some 41) carol))))
-- Dave's slices are what every share of their chain selects: the todo tagged home, and no note at all
#guard ((view resting).share? 42).any fun c =>
  (view resting).entries.map (effSelects (view resting) c ·.attrs) == [false, true, false, false, false]
#guard ((view resting).share? 43).any fun c => !(view resting).entries.any (effSelects (view resting) c ·.attrs)
#guard [door, seeds, solar, plan, diary].map (upkeep resting) == [some [41], some [41, 42], some [41], none, none]
def resting' : List Edit := resting ++ chain 550 [
  (macA, [], .move alice door [41] [500]),
  (macA, [], .move alice seeds [41, 42] [501]),
  (macA, [], .move alice solar [41] [502])]
-- moved, Carol reads the todos, and Dave only the one tagged home
#guard refused resting' == [] && tidy resting'
#guard readable resting' macC == [door, seeds, solar] && readable resting' macD == [seeds]
-- Carol, who issued Dave's share, and Dave, giving it up, may revoke it; Bob may not
#guard accepted resting' (attempt macC [] (.revoke (.grant 42 carol [])))
#guard accepted resting' (attempt macD [] (.revoke (.grant 42 dave [])))
#guard !accepted resting' (attempt macB [] (.revoke (.grant 42 bob [])))
-- revoking Carol's owner share is governance, and ends Dave's shares with it; no entry needs to move
def carolRevoked : List Edit := resting' ++ chain 560 [
  (passkeyA, [], .revoke (.grant 41 alice [540, 541, 542, 550, 551, 552]))]
#guard refused carolRevoked == [] && tidy carolRevoked
#guard [41, 42, 43].all (!(view carolRevoked).live ·)
#guard readable carolRevoked macC == [] && readable carolRevoked macD == []

/-! ## Wide shares, everyone, relays

A wide share selects the whole vault, in the clear: it reaches every audience, and splits none, so issuing it moves
nothing. Alice gives Dave, her backup, a wide read share, and everyone her plan; the server's device vault gets a
wide backup share: its server holds and passes on every entry of Alice's, and opens no key of hers. -/

def wideShares : List Edit := shared ++ seed 540 ++ chain 544 [
  (macA, [], .share (.grant (shareOf 50 alice dave .read .all))),
  (macA, [], .share (.grant (shareOf 51 alice serverVault .backup .all)))]
-- a wide share splits no audience: there is nothing to move
#guard refused wideShares == [] && tidy wideShares
-- Dave reads every entry, in every audience
#guard readable wideShares macD == [door, seeds, solar, plan, diary]
-- the server receives every entry of Alice's, and Alice's Mac sends it their logs, but it reads none
#guard (view wideShares).entries.all fun en => mayReceive (view wideShares) server en.id
#guard [door, seeds, solar, plan, diary].all fun e => (respond wideShares server).any (entryLog? · == some e)
#guard readable wideShares server == []
-- everyone reads the plan, the server too, once a steward has moved it to the public share's audience
def withPublic : List Edit := wideShares ++ chain 548 [
  (macA, [], .share (.grant (publicShare 52 alice (byId plan)))),
  (macA, [], .move alice plan [52] [503])]
#guard refused withPublic == [] && tidy withPublic
#guard readable withPublic stranger == [plan] && readable withPublic server == [plan]
-- a relay, which reads no selector, type or tag, has the same edits stand and the entries in the same audiences (T25)
#guard (standing (withPublic.map Edit.blind)).map (·.id) == (standing withPublic).map (·.id)
#guard (view (withPublic.map Edit.blind)).entries.map (·.audience) == (view withPublic).entries.map (·.audience)

/-! ## Scenario 8: proposals

Welcome's main line is its first write (30) and Bob's edit (40). Bob starts a proposal, draft, from it and edits there;
main stays as it was until Alice merges draft with a write on main that builds on both lines' heads. A second proposal,
rewrite, is merged the same way while main moved on: its update brings main to the three-way merge of the base, main
and rewrite, which keeps main's own edits (`Proposals.lean`, T10h). -/

def ops8 : List (SignerId × List SignerId × Action) := [
  (macB, [], .write coop welcome coop (some 51) 0 [40] .new [bob]),          -- 300: Bob starts draft from main
  (macB, [], .write coop welcome coop (some 51) 0 [300] (.on 300) [bob]),    -- 301: Bob's edit on draft
  (macA, [], .write coop welcome coop (some 51) 0 [40, 301] .main [alice]),  -- 302: Alice merges draft into main
  (macA, [], .write coop welcome coop (some 51) 0 [302] .new [alice]),       -- 303: Alice starts rewrite from main
  (macA, [], .write coop welcome coop (some 51) 0 [303] (.on 303) [alice]),  -- 304: an edit on rewrite
  (macB, [], .write coop welcome coop (some 51) 0 [302] .main [bob]),        -- 305: main moves on meanwhile
  (macA, [], .write coop welcome coop (some 51) 0 [305, 304] .main [alice])] -- 306: Alice merges rewrite
def s8 (n : Nat := ops8.length) : List Edit := s7 ++ chain 300 (ops8.take n)
#guard refused (s8) == []

def lineEdits (edits : List Edit) (l : Option EditId) : List EditId :=
  (history (view edits).writes welcome l).map (·.edit)
def headsOf (edits : List Edit) (l : Option EditId) : List EditId := heads (view edits).writes welcome l

-- Bob's draft holds Welcome as it was and his edit; main stays as it was (T10f)
#guard lineEdits (s8 2) (some 300) == [30, 40, 300, 301] && headsOf (s8 2) (some 300) == [301]
#guard lineEdits (s8 2) none == [30, 40] && headsOf (s8 2) none == [40]
-- the merge brings all of draft into main (T10g)
#guard lineEdits (s8 3) none == [30, 40, 300, 301, 302] && headsOf (s8 3) none == [302]
-- rewrite starts from the merged main; main moves on without it until the merge
#guard lineEdits (s8 6) (some 303) == [30, 40, 300, 301, 302, 303, 304]
#guard lineEdits (s8 6) none == [30, 40, 300, 301, 302, 305]
#guard lineEdits (s8) none == [30, 40, 300, 301, 302, 303, 304, 305, 306] && headsOf (s8) none == [306]
-- draft is left as it was, and Onboarding has a main line only
#guard lineEdits (s8) (some 300) == [30, 40, 300, 301]
#guard (history (view (s8)).writes onboarding none).map (·.edit) == [31]
-- Carol reads Welcome, proposals included, but can't start a proposal
#guard (respond (s8) macC).any (·.id == 301) && reads (s8) macC welcome
#guard !accepted (s8) (attempt macC [] (.write coop welcome carol (some 51) 0 [40] .new))
-- a write on a proposal builds on its start or on a write on it, of its own entry; merging main into draft is fine
#guard accepted (s8) (attempt macB [] (.write coop welcome coop (some 51) 0 [301, 306] (.on 300) [bob]))
#guard !accepted (s8) (attempt macB [] (.write coop welcome coop (some 51) 0 [306] (.on 300) [bob]))
#guard !accepted (s8) (attempt macA [] (.write coop welcome coop (some 51) 0 [306] (.on 302) [alice]))
#guard !accepted (s8) (attempt macA [] (.write coop onboarding coop none 0 [31] (.on 300) [alice]))
#guard !accepted (s8) (attempt macA [] (.write coop welcome coop (some 51) 0 [] (.on 999) [alice]))

/-! ## Scenario 8, numbered: version numbers

Welcome's main line counts its releases (`Proposals.lean`): its creation (30) is v1, Bob's edit (40) is no release, and
each merge is the next release, one more than the highest of main's releases in its past (T10i). Then Bob edits draft
again (307), and Alice merges it into main as she saw it at 305 (308), apart from her merge of rewrite (306): both are
v3, and release 3 is the two together. Alice starts a proposal, tidy, from both merges (309), edits it (310) and merges
it (311): v4, which counts past both. Bob edits main (312). -/

def ops8v : List (SignerId × List SignerId × Action) := [
  (macB, [], .write coop welcome coop (some 51) 0 [301] (.on 300) [bob]),          -- 307: Bob edits draft again
  (macA, [], .write coop welcome coop (some 51) 0 [305, 307] .main [alice]),       -- 308: Alice merges it, main at 305
  (macA, [], .write coop welcome coop (some 51) 0 [306, 308] .new [alice]),        -- 309: tidy, from both merges
  (macA, [], .write coop welcome coop (some 51) 0 [309] (.on 309) [alice]),        -- 310: an edit on tidy
  (macA, [], .write coop welcome coop (some 51) 0 [306, 308, 310] .main [alice]),  -- 311: Alice merges tidy
  (macB, [], .write coop welcome coop (some 51) 0 [311] .main [bob])]              -- 312: Bob edits main
def s8v (n : Nat := ops8v.length) : List Edit := s8 ++ chain 307 (ops8v.take n)
#guard refused (s8v) == []

def releasesOf (edits : List Edit) (l : Option EditId) : List (EditId × Nat) := releases (view edits).counted welcome l
def describeAt (edits : List Edit) (v : List EditId) : Described := describe (view edits).counted welcome none v

-- the creation is v1 and Bob's edit no release: main reads v1 and 1 edit
#guard releasesOf (s8 2) none == [(30, 1)] && describeAt (s8 2) [40] == ⟨some 1, 1⟩
-- the merge of draft is v2, and draft's start its own v1; draft's writes are no edits of main's
#guard releasesOf (s8 3) none == [(30, 1), (302, 2)] && releasesOf (s8 3) (some 300) == [(300, 1)]
#guard describeAt (s8 3) [302] == ⟨some 2, 0⟩ && describeAt (s8 3) [301] == ⟨some 1, 1⟩
-- an older version still reads as what it was, and main moving on reads v2 and 1 edit
#guard describeAt (s8 3) (release (view (s8 3)).counted welcome none 1) == ⟨some 1, 0⟩
#guard describeAt (s8 6) [305] == ⟨some 2, 1⟩
-- the merge of rewrite is v3
#guard releasesOf (s8) none == [(30, 1), (302, 2), (306, 3)]
-- the merge made apart is v3 too, and release 3 is both together, which reads v3; the next merge counts past both
#guard releasesOf (s8v) none == [(30, 1), (302, 2), (306, 3), (308, 3), (311, 4)]
#guard release (view (s8v)).counted welcome none 3 == [306, 308] && describeAt (s8v) [306, 308] == ⟨some 3, 0⟩
#guard describeAt (s8v) [311] == ⟨some 4, 0⟩ && describeAt (s8v) [312] == ⟨some 4, 1⟩
#guard releasesOf (s8v) (some 300) == [(300, 1)] && releasesOf (s8v) (some 309) == [(309, 1)]
-- a number never changes as more writes come, and is the same in another order of the same writes (T10j)
#guard releasesOf (s8v 2) none == [(30, 1), (302, 2), (306, 3), (308, 3)]
def replayed : List Write := [30, 40, 300, 301, 302, 305, 307, 308, 303, 304, 306, 309, 310, 311, 312].filterMap
  fun i => (view (s8v)).counted.find? (·.edit == i)
#guard releases replayed welcome none == [(30, 1), (302, 2), (308, 3), (306, 3), (311, 4)]

/-! ## Drafts: a new entry proposed on a line of its own

Bob may only suggest on Alice's notes (the Suggester group): read them, create drafts, write on proposals, start them
and merge into them. Carol edits Alice's notes, and everyone reads them. Bob drafts the harvest rules: one write that
creates the entry and starts its own line, so its main line holds nothing. A steward marks it into the audience its
shares select, but for the share to everyone, until it lands; no write on its main line counts but the vault's own.
Alice accepts the line and merges it into main, which lands it: the steward then marks it public, and Carol writes on
main as on any note. -/

def harvest := 40
def idea := 41
def suggests : List Op := ((groups.find? (·.name == "Suggester")).map (·.ops)).getD []

def notesShared : List Edit := lib ++ chain 900 [
  (macA, [], .share (.grant { shareOf 60 alice bob .write notes with ops := suggests })),
  (macA, [], .share (.grant (shareOf 61 alice carol .write notes))),
  (macA, [], .share (.grant (publicShare 62 alice notes))),
  (macA, [], .move alice plan [60, 61, 62] [503]),
  (macA, [], .move alice diary [60, 61, 62] [504])]
#guard refused notesShared == [] && tidy notesShared

-- Bob drafts the harvest rules, in his share's intake audience, and writes on its line; a creation on a line that
-- already is, nobody takes, and his creation on main is taken but counted by no reader, as he may only suggest
def drafted : List Edit := notesShared ++ chain 905 [
  (macB, [], create alice harvest bob [60] note (proof := some 60) (proposal := .new)),
  (macB, [], .write alice harvest bob none 0 [905] (.on 905) (proof := some 60)
    (touches := [.set [.field "title"] (some (.str "Harvest rules"))]))]
#guard refused drafted == [] && counted notesShared (attempt macB [] (create alice harvest bob [60] note
  (proof := some 60) (proposal := .new)))
#guard !accepted drafted (attempt macB [] (create alice idea bob [60] note (proof := some 60) (proposal := .on 905)))
#guard accepted drafted (attempt macB [] (create alice idea bob [60] note (proof := some 60))) &&
  !counted drafted (attempt macB [] (create alice idea bob [60] note (proof := some 60)))
-- its creation starts its own line; its main line holds nothing, and it hasn't landed
#guard (history (view drafted).counted harvest (some 905)).map (·.edit) == [905, 906]
#guard (history (view drafted).counted harvest none).isEmpty
#guard ((view drafted).entry? harvest).any fun en => isDraft (view drafted) en && !landed (view drafted) en
-- a steward marks it into the audience its shares select, the share to everyone left out: Carol reads it, a stranger
-- doesn't, while he reads every other note of Alice's
#guard upkeep drafted harvest == some [60, 61] && !reads drafted macC harvest
def drafted' : List Edit := drafted ++ chain 907 [(macA, [], .move alice harvest [60, 61] [905, 906])]
#guard refused drafted' == [] && tidy drafted'
#guard reads drafted' macC harvest && reads drafted' macB harvest && !reads drafted' stranger harvest
#guard reads drafted' stranger plan && !publicKey (view drafted') (.audience alice [60, 61])
-- before it lands, no write on its main line counts but the vault's own: not Bob's merge, nor Carol's write building
-- on nothing; the vault's own such write counts, but doesn't build on its creation, so lands nothing
#guard !counted drafted' (attempt macB [] (.write alice harvest bob (some 907) 0 [906] (proof := some 60)
  (touches := [.merge])))
#guard !counted drafted' (attempt macC [] (.write alice harvest carol (some 907) 0 [] (proof := some 61)
  (touches := [.set [.field "title"] (some (.str "Mine"))])))
#guard (step (view drafted') (attempt macA [] (.write alice harvest alice (some 907) 0 []
  (touches := [.set [.field "title"] (some (.str "Ours"))])))).any fun st =>
    !st.uncounted.contains 9999 && (st.entry? harvest).any (!landed st ·)

-- Alice accepts the line; Carol's merge on top of the accept counts for no reader, as only the vault lands a draft
def acceptedDraft : List Edit := drafted' ++ chain 908 [
  (macA, [], .write alice harvest alice (some 907) 0 [906] (.on 905))]
#guard refused acceptedDraft == [] && (view acceptedDraft).accepts == [908]
#guard !counted acceptedDraft (attempt macC [] (.write alice harvest carol (some 907) 0 [908] (proof := some 61)
  (touches := [.merge])))
-- Alice's merge lands it: main's history holds its creation, and the steward marks it public
def landedDraft : List Edit := acceptedDraft ++ chain 909 [
  (macA, [], .write alice harvest alice (some 907) 0 [908] (touches := [.merge]))]
#guard refused landedDraft == []
#guard (history (view landedDraft).counted harvest none).map (·.edit) == [905, 906, 908, 909]
#guard ((view landedDraft).entry? harvest).any (landed (view landedDraft))
-- a draft is v1 of its own line, and its main line has no release until the vault's merge lands it, as main's v1
#guard releases (view drafted).counted harvest none == [] &&
  releases (view drafted).counted harvest (some 905) == [(905, 1)]
#guard describe (view drafted).counted harvest none (heads (view drafted).counted harvest none) == ⟨none, 0⟩
#guard releases (view landedDraft).counted harvest none == [(909, 1)]
#guard upkeep landedDraft harvest == some [60, 61, 62]
def landedDraft' : List Edit := landedDraft ++ chain 910 [
  (macA, [], .move alice harvest [60, 61, 62] [905, 906, 907, 908, 909])]
#guard refused landedDraft' == [] && tidy landedDraft' && reads landedDraft' stranger harvest
-- once landed it is an ordinary note: Carol's writes on main count, and a relay has the same edits stand (T25)
#guard counted landedDraft' (attempt macC [] (.write alice harvest carol (some 910) 0 [909] (proof := some 61)
  (touches := [.set [.field "title"] (some (.str "Harvest"))])))
#guard (standing (landedDraft'.map Edit.blind)).map (·.id) == (standing landedDraft').map (·.id)
-- a draft of a schema joins no lane, even once the vault lands it
#guard (step (view landedDraft') (attempt macA [] (create alice idea alice [] schemaType (blob := 9)
  (proposal := .new)))).map (laneOf · alice) == some []

/-! ## Scenario 9: schema v1

The coop moves its documents to schema v1. A vault's schemas and lenses are entries of the built-in types schema and
lens, which it shares with everyone through a share of its own, made with its first schema, that selects those types.
Alice's Mac, acting for the coop, creates the v1 schema and the lens from v0 as entries of the coop, and their readers
read the coop's lane off them (T17). Carol may write Onboarding, and create through her share, but puts nothing in the
coop's lane. -/

def schemaV1 : BlobId := 1
def lensV0V1 : BlobId := 2
def coopSchema := 4
def coopLens := 5
def daveSchema := 6
def schemas : Selector := .anyOf [[.typeIn schemaTypes]]

def s9 : List Edit := s7 ++ chain 65 [
  (macA, [], .share (.grant (shareOf 5 coop carol .write (byId onboarding)) [alice])),
  (macA, [], .move coop onboarding [5] [31] [alice]),
  -- with its first schema, the coop shares its schemas and lenses with everyone
  (macA, [], .share (.grant (publicShare 7 coop schemas) [alice])),
  (macA, [], create coop coopSchema coop [7] schemaType (via := [alice]) (blob := schemaV1)),
  (macA, [], create coop coopLens coop [7] lensType (via := [alice]) (blob := lensV0V1)),
  -- Dave's own vault moves to v1 too: the same blob, in another vault's lane
  (macD, [], .share (.grant (publicShare 8 dave schemas))),
  (macD, [], create dave daveSchema dave [8] schemaType (blob := schemaV1))]
#guard refused s9 == [] && tidy s9

#guard laneOf (view s9) coop == [schemaV1, lensV0V1] && laneOf (view s9) dave == [schemaV1]
/-- The coop's lane after an edit tried on `edits`, if it is accepted. -/
def laneAfter (edits : List Edit) (edit : Edit) : Option (List BlobId) := (step (view edits) edit).map (laneOf · coop)
-- the same blob again adds nothing; Bob's Mac acts for the coop too, through Bob's vault, and adds another
#guard laneAfter s9 (attempt macA [] (create coop 9 coop [7] schemaType (via := [alice]) (blob := schemaV1))) ==
  some [schemaV1, lensV0V1]
#guard laneAfter s9 (attempt macB [] (create coop 9 coop [7] lensType (via := [bob]) (blob := 3))) ==
  some [schemaV1, lensV0V1, 3]
-- a schema its readers don't count, as it doesn't fit, adds nothing either
#guard laneAfter s9 (attempt macA [] (create coop 9 coop [7] schemaType (via := [alice]) (blob := 3) (fits := false)))
  == some [schemaV1, lensV0V1]
-- a later write to the coop's schema, its tags too, leaves the lane as it was: only the creation is read
#guard laneAfter s9 (attempt macA [] (.write coop coopSchema coop none 0 [68] (via := [alice])
  (tags := { add := [urgent] }))) == some [schemaV1, lensV0V1]
-- Carol writes Onboarding, and creates a schema through her share, which every peer accepts; but it acts for her, so
-- it puts nothing in the coop's lane; for the coop she acts not at all, as her vault isn't its owner; nor does a
-- stranger
#guard accepted s9 (attempt macC [] (.write coop onboarding carol (some 66) 0 [31]))
#guard laneAfter s9 (attempt macC [] (create coop 9 carol [5] schemaType (proof := some 5) (blob := 3))) ==
  some [schemaV1, lensV0V1]
#guard !accepted s9 (attempt macC [] (create coop 9 coop [7] schemaType (via := [carol]) (blob := 3)))
#guard !accepted s9 (attempt stranger [] (create coop 9 coop [7] schemaType (blob := 3)))
-- owner of the whole coop is an owner of it, which no grant makes, even with the coop's approval (WideOwner); an owner
-- share on a slice of the coop creates through itself, for Dave, and puts nothing in the coop's lane either: only the
-- coop's own owners do
def daveOwns (sel : Selector) : List Edit := s9 ++ chain 80 [
  (passkeyA, [passkeyB], .share (.grant (shareOf 6 coop dave .owner sel) [alice]))]
#guard refused (daveOwns .all) == [80] && refused (daveOwns docs) == []
#guard !accepted (daveOwns .all) (attempt macD [] (create coop 9 dave [] schemaType (blob := 3)))
#guard laneAfter (daveOwns docs) (attempt macD [] (create coop 9 dave [6] schemaType (proof := some 6) (blob := 3))) ==
  some [schemaV1, lensV0V1]
-- what everyone may read goes to whoever has an interest in the vault (T12): Carol's Mac receives the coop's schema,
-- through her shares, and a stranger nothing at all, unless it follows the coop; then it receives what is public of
-- the coop, its schema and lens and the Charter, and none of its other entries
#guard (respond s9 macC).any (entryLog? · == some coopSchema) && respond s9 stranger == []
#guard ((respond s9 stranger [coop]).filterMap entryLog?).eraseDups == [charter, coopSchema, coopLens]
-- Dave's schema goes to his own devices, and to Carol's Mac only once it follows his vault
#guard (respond s9 macD).any (entryLog? · == some daveSchema)
#guard !(respond s9 macC).any (entryLog? · == some daveSchema)
#guard (respond s9 macC [dave]).any (entryLog? · == some daveSchema)
-- a relay, which reads no type and no blob, has the same edits stand (T25)
#guard (standing (s9.map Edit.blind)).map (·.id) == (standing s9).map (·.id)

/-- Welcome as an app still on v0 wrote it: v0's fields only. -/
def welcomeV0 : Lens.StoredDoc := { title := "Welcome", blocks := [
  { id := 1, text := "Welcome", kind := some .h1 },
  { id := 2, text := "The greenhouse opens at eight.", kind := some .p },
  { id := 3, text := "Water the seedlings", kind := some .li }] }

/-- A v1 app makes the second block a heading and tags the document. -/
def welcomeV1 : Lens.StoredDoc :=
  let v := welcomeV0.v1
  welcomeV0.putV1 { v with
    blocks := v.blocks.map fun b => if b.id == 2 then { b with type := .heading, level := some 2 } else b,
    tags := ["greenhouse"] }

-- a v0 app reads every other block exactly as before, and the heading through the lens
#guard welcomeV1.v0.blocks.filter (·.id != 2) == welcomeV0.v0.blocks.filter (·.id != 2)
#guard welcomeV1.v0.blocks.find? (·.id == 2) ==
  some { id := 2, kind := .h2, text := "The greenhouse opens at eight." }
-- nothing was written to the other blocks: none of them gained `checked`, `lang`, `type` or `level`
#guard welcomeV1.blocks.filter (·.id != 2) == welcomeV0.blocks.filter (·.id != 2)
#guard (welcomeV1.blocks.filter (·.id != 2)).all fun b =>
  b.checked.isNone && b.lang.isNone && b.type.isNone && b.level.isNone
-- the heading holds v1's representation now, and the document its tag, which a v0 app's edit keeps
#guard (welcomeV1.blocks.find? (·.id == 2)).map (fun b => (b.kind, b.type, b.level)) ==
  some (none, some .heading, some 2)
#guard welcomeV1.v1.tags == ["greenhouse"]
#guard (welcomeV1.putV0 { welcomeV1.v0 with title := "Welcome!" }).tags == ["greenhouse"]

/-! ## Scenario 10: revoking a share rotates the audiences it was in

The audiences the revoked share was in move to a new epoch, whose key only their remaining shares get. The revoked share
stays in the audience: only the live part of an audience has to be its semantic audience, so a revocation moves no
entry. -/

def s10 : List Edit := s7 ++ chain 80 [(macA, [], .revoke (.grant 1 coop [] [alice]))]
#guard refused s10 == []

-- Welcome's audience moves on: Carol doesn't open its new epoch, Bob does, and Welcome stays where it is
#guard (view s10).epochOf (.audience coop [1]) == (view s7).epochOf (.audience coop [1]) + 1
#guard !reads s10 macC welcome && reads s10 macB welcome
#guard audienceOf s10 welcome == [1] && upkeep s10 welcome == none
-- Carol keeps what she could read before
#guard knows (view s10) [.signer macC] (.scoped (.audience coop [1]) 0)

-- Alice revokes Bob's write on her work todos: their audience moves on, the others' don't, and Bob opens nothing new,
-- though no entry moves
def unshared : List Edit := shared ++ chain 530 [
  (macA, [], .revoke (.grant 32 alice [500, 501, 502, 510, 511, 512, 513, 514]))]
#guard refused unshared == [] && tidy unshared && audienceOf unshared door == [31, 32]
#guard (keyFams (view unshared)).all fun k =>
  (view unshared).epochOf k == (view shared).epochOf k + if k == .audience alice [31, 32] then 1 else 0
#guard readable unshared macB == [] && readable unshared macC == [door, seeds, solar]
#guard knows (view unshared) [.signer macB] (.scoped (.audience alice [31, 32]) 0)

/-! ## Scenario 11: a lost iPhone rotates everything it could reach

A vault's share and audience keys derive from its seed, so when the seed moves on they all do. -/

def s11 : List Edit := s7 ++ chain 90 [(passkeyA, [], .revoke (.device alice phoneA []))]
#guard refused s11 == []

-- the iPhone opens neither vault key nor Welcome any more, which Alice's Mac and Bob's still read; nor does it write
#guard !opens' s11 phoneA (.seed alice) && !opens' s11 phoneA (.seed coop)
#guard !reads s11 phoneA welcome && reads s11 macA welcome && reads s11 macB welcome
#guard !accepted s11 (attempt phoneA [] (.write coop welcome coop (some 51) 1 [40] (via := [alice])))
-- Alice's seed and the coop's, which it reached through Alice's, move on, and every share and audience key of both
-- vaults
#guard (keyFams (view s11)).all fun k =>
  (view s11).epochOf k == (view s7).epochOf k + if k.vault == alice || k.vault == coop then 1 else 0

-- the same in Alice's own vault, where Bob and Carol hold shares: every key of hers moves on, theirs don't
def lostPhone : List Edit := shared ++ chain 530 [(passkeyA, [], .revoke (.device alice phoneA []))]
#guard refused lostPhone == []
#guard (keyFams (view lostPhone)).all fun k =>
  (view lostPhone).epochOf k == (view shared).epochOf k + if k.vault == alice then 1 else 0
#guard readable lostPhone phoneA == [] && readable lostPhone macB == [door, solar]

/-! ## Scenario 12: Bob leaves the coop on his own -/

def s12 : List Edit := s7 ++ chain 95 [(passkeyB, [], .revoke (.owner coop (.vault bob) [40]))]
#guard refused s12 == []

#guard ((view s12).vault? coop).map (·.threshold) == some 1
#guard !opens' s12 macB (.seed coop) && !reads s12 macB welcome
-- Bob's earlier edit stays, as his leaving names it
#guard (view s12).writes.length == (view s7).writes.length
-- what Bob's Mac wrote for the coop through Bob's vault on a copy that hadn't seen him leave is cut
def bobLeft : List Edit := s12 ++ offline 98 61 [(macB, [], .write coop welcome coop (some 51) 0 [40] (via := [bob]))]
#guard refused bobLeft == [98]
#guard !accepted s12 (attempt macB [] (.write coop welcome coop (some 51) 0 [40] (via := [bob])))

/-! ## Scenarios 15 and 16: one todo, many vaults, changing levels -/

def s15 : List Edit := s3 ++ chain 100 [
  (macA, [], create alice door alice [] todo [work]),
  (macA, [], create alice seeds alice [] todo [home]),
  (macA, [], create alice solar alice [] todo [work]),
  (macA, [], .share (.grant (shareOf 10 alice bob .write (byId door)))),
  (macA, [], .share (.grant (shareOf 11 alice carol .read (byId door)))),
  -- making the coop owner of the todo is governance: Alice's passkey
  (passkeyA, [], .share (.grant (shareOf 12 alice coop .owner (byId door)))),
  (macA, [], .move alice door [10, 11, 12] [100])]
#guard refused s15 == [] && tidy s15

-- a device alone can't make anyone owner
#guard !accepted s15 (attempt macA [] (.share (.grant (shareOf 13 alice coop .owner (byId door)))))
#guard accepted s15 (attempt macB [] (.write alice door bob (some 106) 0 [100]))
#guard !accepted s15 (attempt macC [] (.write alice door carol (some 106) 0 [100]))
#guard reads s15 macC door && !reads s15 macC seeds
#guard !reads s15 macB solar

def s16a : List Edit := s15 ++ chain 110 [
  -- acting for the coop, through Bob's vault, Bob gives Dave read
  (macB, [], .share (.grant (shareOf 14 alice dave .read (byId door) (parent := some 12) (issuer := coop)) [bob])),
  -- Alice raises Carol to write and takes Bob's own write away
  (macA, [], .share (.grant (shareOf 15 alice carol .write (byId door)))),
  (macA, [], .revoke (.grant 10 alice [100, 106]))]
#guard refused s16a == []

-- Bob still reaches the todo through the coop, so its audience's key didn't rotate
#guard entitled (view s16a) macB (.audience alice [10, 11, 12])
#guard (view s16a).epochOf (.audience alice [10, 11, 12]) == (view s15).epochOf (.audience alice [10, 11, 12])
-- the new shares reach the todo once a steward has moved it, which drops the revoked share from its audience
#guard upkeep s16a door == some [11, 12, 14, 15] && !reads s16a macD door
def s16b : List Edit := s16a ++ chain 113 [(macA, [], .move alice door [11, 12, 14, 15] [100])]
#guard refused s16b == [] && tidy s16b
-- moved, Dave reads the todo and Carol writes it; Bob writes it only for the coop
#guard reads s16b macD door && accepted s16b (attempt macC [] (.write alice door carol (some 113) 0 [100]))
#guard !accepted s16b (attempt macB [] (.write alice door bob (some 113) 0 [100]))
#guard accepted s16b (attempt macB [] (.write alice door coop (some 113) 0 [100] (via := [bob])))

def s16 : List Edit := s16b ++ chain 120 [
  -- taking the coop's owner share away is governance, and ends the read Bob gave Dave, which Alice had seen
  (passkeyA, [], .revoke (.grant 12 alice [110]))]
#guard refused s16 == [] && tidy s16

-- Dave's share ended with the coop's; neither Bob nor Dave may open the todo's audience, which moves on
#guard !(view s16).live 14
#guard [macB, macD].all fun d => !entitled (view s16) d (.audience alice [11, 12, 14, 15])
#guard (view s16).epochOf (.audience alice [11, 12, 14, 15]) ==
  (view s16b).epochOf (.audience alice [11, 12, 14, 15]) + 1
-- Bob and Dave read the todo no more, Carol and Alice still do; Bob no longer writes it for the coop
#guard !reads s16 macB door && !reads s16 macD door
#guard reads s16 macC door && reads s16 macA door
#guard !accepted s16 (attempt macB [] (.write alice door coop (some 113) 1 [100] (via := [bob])))

/-! ## Keys edits carry only the boxes the schedule seals -/

-- Alice's Mac boxes Welcome's key to its audience's key, and Carol's share key to Carol's vault key; Dave's Mac, which
-- can't open Welcome's key, can't box it
#guard accepted s6 (attempt macA [] (.keys (.entry welcome (some 51) 0) [.scoped (.audience coop [1]) 0]))
#guard accepted s6 (attempt macA [] (.keys (.scoped (.share coop 1) 0) [.scoped (.seed carol) 0]))
#guard !accepted s6 (attempt macD [] (.keys (.entry welcome (some 51) 0) []))
-- Carol may pass on the boxes of what she reads
#guard accepted s6 (attempt macC [] (.keys (.scoped (.audience coop [1]) 0) [.scoped (.share coop 1) 0]))
-- a box the schedule doesn't seal is refused, as is a family's key of an epoch the family hasn't reached; an entry's
-- key under an epoch no write names is sealed nowhere, so no box of it goes anywhere
#guard !accepted s6 (attempt macA [] (.keys (.entry welcome (some 51) 0) [.signer macD]))
#guard !accepted s6 (attempt macA [] (.keys (.entry welcome (some 51) 1) [.scoped (.audience coop [1]) 1]))
#guard !accepted s6 (attempt macA [] (.keys (.scoped (.audience coop [1]) 1) []))
-- only a public key is published
#guard !accepted s6 (attempt macA [] (.keys (.scoped (.audience coop [1]) 0) [] true))
#guard accepted s7 (attempt macA [] (.keys (.scoped (.audience coop [3]) 0) [] true))

/-! ## A coop that stops reading rotates the key, though its members still read

Alice's second coop reads her notes, then stops. Alice still reads them as their vault, but the coop's key would carry
the notes' audience key to whoever joins the coop later, so the audience moves on. Bob joins and opens only the old
epoch: a vault's newcomers inherit what it could read. -/

def coop2 := 202
def gap : List Edit := s3 ++ chain 190 [
  (passkeyA, [], .genesis coop2 .coop [.vault alice] 1),
  (macA, [], create alice plan alice [] note),
  (macA, [], .share (.grant (shareOf 20 alice coop2 .read notes))),
  (macA, [], .move alice plan [20] [191]),
  (macA, [], .revoke (.grant 20 alice [])),
  (passkeyA, [passkeyB], .share (.owner coop2 (.vault bob)))]
#guard refused gap == [] && tidy gap

-- the notes' audience moves on: Alice opens its new epoch, Bob, now in the coop, only the one before
#guard (view gap).epochOf (.audience alice [20]) == 1
#guard !opens' gap macB (.audience alice [20]) && opens' gap macA (.audience alice [20])
#guard knows (view gap) [.signer macB] (.scoped (.audience alice [20]) 0)

/-! ## An audience that comes back into use moves on

Bob reads Alice's urgent todos. The seeds todo is urgent for a while, then not, and Bob loses his Mac while no entry is
in that audience, so its key doesn't move on with his seed's. When the seeds todo is urgent again, the audience moves to
a new epoch, which the lost Mac doesn't open. -/

def comeback (n : Nat := 8) : List Edit := lib ++ chain 600 ([
  (macA, [], .share (.grant (shareOf 34 alice bob .read urgentTodos))),
  (macA, [], .write alice seeds alice none 0 [501] (tags := { add := [urgent] })),
  (macA, [], .move alice seeds [34] [501, 601]),
  (macA, [], .write alice seeds alice (some 602) 0 [601] (tags := { remove := [urgent] })),
  (macA, [], .move alice seeds [] [501, 601, 603]),
  (passkeyB, [], .revoke (.device bob macB [])),
  (macA, [], .write alice seeds alice (some 604) 0 [603] (tags := { add := [urgent] })),
  (macA, [], .move alice seeds [34] [501, 601, 603, 606])].take n)
#guard refused (comeback) == [] && tidy (comeback)

-- Bob reads the seeds todo while it is urgent, and not after
#guard reads (comeback 3) macB seeds && !reads (comeback 5) macB seeds
-- while the audience was empty, Bob's seed and his share's key moved on, the audience's key didn't
#guard (view (comeback 6)).epochOf (.share alice 34) == 1 && (view (comeback 6)).epochOf (.audience alice [34]) == 0
#guard knows (view (comeback 6)) [.signer macB] (.scoped (.audience alice [34]) 0)
-- the seeds todo back in it, the audience moves on: Bob's passkey reads it, his lost Mac doesn't
#guard (view (comeback)).epochOf (.audience alice [34]) == 1
#guard reads (comeback) passkeyB seeds && !reads (comeback) macB seeds

-- an entry created in the empty audience brings it back into use too: a device names for its first write the epoch the
-- audience moves to, which the lost Mac doesn't open; one under a later epoch stands too, and opens for nobody until the
-- audience reaches it
def lampTodo (g : Nat) : Edit := attempt macA [] (.write alice lamp alice none g (create := some ([34], ⟨todo, 0, 0⟩))
  (tags := { add := [urgent] }))
#guard reenters (view (comeback 6)) alice [34]
#guard ((step (view (comeback 6)) (lampTodo 1)).map fun st =>
  st.epochOf (.audience alice [34]) == 1 && !knows st [.signer macB] (.entry lamp none 1) &&
    knows st [.signer passkeyB] (.entry lamp none 1)) == some true
#guard ((step (view (comeback 6)) (lampTodo 2)).map fun st =>
  st.epochOf (.audience alice [34]) == 1 && !knows st [.signer passkeyB] (.entry lamp none 2)) == some true
-- an audience in use, or one whose key was never sealed, moves to no new epoch
#guard !reenters (view (comeback 3)) alice [34] && !reenters (view (comeback 6)) alice [34, 99]

/-! ## Scenario 17: each todo syncs on its own -/

-- Carol's Mac may receive the door todo and no other, and Alice's Mac answers it with that todo only
#guard [door, seeds, solar].map (mayReceive (view s15) macC) == [true, false, false]
#guard (respond s15 macC).any (entryLog? · == some door)
#guard (respond s15 macC).all fun o => (entryLog? o).all (· == door)
-- a device with no share on it gets none of it
#guard (respond s15 stranger).all (entryLog? · == none)
-- after the coop lost the todo, Dave's Mac gets none of its edits, only the revocation that ended its read, as Bob's
-- Mac does for the coop's owner share
#guard (respond s16 macD).all (entryLog? · == none)
#guard [macD, macB].all fun d => (respond s16 d).any (·.id == 120)
#guard !(respond s16 stranger).any (·.id == 120)

-- Each Mac starts with its own vault and what Alice's Mac sent it. Then the server and Alice go offline, Bob
-- edits the door todo, and Bob's Mac and Carol's Mac sync directly.
def ownVault (v : VaultId) : List Edit := s2.filter (·.log? == some (.vault v))
def bobMac : List Edit :=
  receive (ownVault bob) (respond s15 macB) ++ chain 130 [(macB, [], .write alice door bob (some 106) 0 [100])]
def carolMac : List Edit := receive (ownVault carol) (respond s15 macC)

#guard refused bobMac == [] && refused carolMac == []
#guard (entryWrites (view carolMac) door).length == 1
-- each answers the other once
def bobMac' := receive bobMac (respond carolMac macB)
def carolMac' := receive carolMac (respond bobMac macC)

-- both now hold Alice's and Bob's edits of the door todo, and Carol's Mac accepts Bob's
#guard (entryWrites (view carolMac') door).length == 2
#guard entryWrites (view carolMac') door == entryWrites (view bobMac') door
-- and neither learned anything about the other todos
#guard entryWrites (view carolMac') seeds == [] && entryWrites (view bobMac') solar == []

/-! ## A later entry shared by its id reaches a newcomer

Alice shares her plan with Bob by its id, which empties her audience of no shares, and takes the share back. Her diary
brings that audience back into use, at a new epoch, and she shares the diary with Carol by its id. Carol's Mac is sent
the diary's log and the share's, never the plan's, whose edits moved the audience on: so it can't tell which epoch that
audience reached, and takes the diary's first write under the epoch Alice's Mac named, and reads it. -/

def later : List Edit := s2 ++ chain 700 [
  (macA, [], create alice plan alice [] note),
  (macA, [], .share (.grant (shareOf 40 alice bob .read (byId plan)))),
  (macA, [], .move alice plan [40] [700]),
  (macA, [], .revoke (.grant 40 alice [700, 702])),
  (macA, [], .write alice diary alice none 1 (create := some ([], ⟨note, 0, 0⟩))),
  (macA, [], .share (.grant (shareOf 41 alice carol .read (byId diary)))),
  (macA, [], .move alice diary [41] [704])]
#guard refused later == [] && tidy later
#guard (view later).epochOf (.audience alice []) == 1 && reads later macC diary

-- Carol's Mac holds its own vault and what Alice's Mac sent it, none of the plan's edits; there the audience of no
-- shares never had a key, yet it takes the diary and reads it, its first write too, as Bob's Mac reads neither
def carolsCopy : List Edit := receive (ownVault carol) (respond later macC)
#guard !carolsCopy.any (entryLog? · == some plan) && (view carolsCopy).epochOf (.audience alice []) == 0
#guard refused carolsCopy == [] && reads carolsCopy macC diary
#guard knows (view carolsCopy) [.signer macC] (.entry diary none 1)
#guard !reads later macB diary && !reads later macB plan

/-! ## Linking a new device

A new device whose passkey proves itself on a connection is handed the logs of the vaults that passkey owns, as it
needs them to add itself to its vault, and nothing about any share, audience or entry (T20). -/

-- Alice's passkey is handed her vault's log, Bob's his, a device key or a stranger's passkey nothing
#guard (linkCard s15 passkeyA).map (·.id) == [1, 2, 3]
#guard (linkCard s15 passkeyB).map (·.id) == [10, 11]
#guard linkCard s15 macA == [] && linkCard s15 stranger == []
-- with the card alone, Alice's passkey adds the new device
#guard accepted (linkCard s15 passkeyA) (attempt passkeyA [77] (.share (.device alice 77)))

/-! ## Strong removal: a removal cuts what it hadn't seen

A device that was offline makes edits on its old copy of the log, so they sort before a removal made elsewhere in the
meantime. Each such edit stands only if it stands without what the removal took away. -/

-- a coop of Alice and Bob where either may act alone
def pair := 201
def sPair : List Edit := s2 ++ chain 140 [(passkeyA, [passkeyB], .genesis pair .coop [.vault alice, .vault bob] 1)]

-- Alice goes on, then removes Bob; Bob, offline since the coop began, adds Dave
def backdated (keep : List EditId) : List Edit := sPair ++ chain 141 [
  (passkeyA, [], .settings pair (.threshold 1)),
  (passkeyA, [], .settings pair (.threshold 1)),
  (passkeyA, [], .revoke (.owner pair (.vault bob) keep))] ++ offline 150 140 [
  (passkeyB, [passkeyD], .share (.owner pair (.vault dave)))]

-- the removal hadn't seen Bob's add, so it is cut; had it seen it, the add would stand
#guard refused (backdated []) == [150]
#guard ((view (backdated [])).vault? pair).map (·.owners) == some [.vault alice]
#guard refused (backdated [150]) == []
#guard ((view (backdated [150])).vault? pair).map (·.owners) == some [.vault alice, .vault dave]

-- the two remove each other at once, and Bob's sorts first: the senior owner stands
def clash : List Edit := sPair ++ [
  { id := 161, depth := 141, author := passkeyA, cosigners := [], action := .revoke (.owner pair (.vault bob) []) },
  { id := 160, depth := 141, author := passkeyB, cosigners := [], action := .revoke (.owner pair (.vault alice) []) }]
#guard ((order clash).map (·.id)).reverse.take 2 == [161, 160]
#guard refused clash == [160]
#guard ((view clash).vault? pair).map (·.owners) == some [.vault alice]

-- a thief holding Alice's second passkey removes her first passkey from the owners and adds a device; the first
-- passkey, having seen neither, removes the second, and stands: it joined first. It keeps the threshold it had set, which counted that passkey.
def stolen : List Edit :=
  twoKeys ++ chain 142 [(passkeyA, [], .revoke (.owner alice (.signer 77) [141]))] ++ offline 170 141 [
    (77, [passkeyA], .revoke (.owner alice (.signer passkeyA) [])),
    (77, [stranger], .share (.device alice stranger))]
#guard refused stolen == [170, 171]
#guard ((view stolen).vault? alice).map (·.owners) == some [.signer passkeyA]
#guard !actsFor (view stolen) stranger alice

-- Alice revokes Bob's write on the door todo, keeping the edits she had seen; Bob's other edit, made offline, is cut,
-- and so is Carol's, which builds on it, though Carol may write
def revokedWriter : List Edit := s16b ++ offline 180 106 [
  (macB, [], .write alice door bob (some 106) 0 [100])] ++ offline 182 114 [
  (macC, [], .write alice door carol (some 113) 0 [180])]
#guard refused revokedWriter == [180, 182]
#guard (entryWrites (view revokedWriter) door).map (·.edit) == [100]
-- a proposal Bob starts for himself on a copy that hadn't seen the revocation is cut, and so is every write on it,
-- even one he makes for the coop, which may still write
def revokedProposal : List Edit := s16b ++ offline 190 106 [
  (macB, [], .write alice door bob (some 106) 0 [100] .new),
  (macB, [], .write alice door coop (some 106) 0 [190] (.on 190) [bob])]
#guard refused revokedProposal == [190, 191]
#guard accepted s16b (attempt macB [] (.write alice door coop (some 113) 0 [100] .new [bob]))
-- revoking Bob's write after his edit arrived keeps it: the revocation names it
def keptWriter : List Edit := s15 ++ chain 113 [(macB, [], .write alice door bob (some 106) 0 [100])] ++ chain 114 [
  (macA, [], .revoke (.grant 10 alice [113])),
  (macC, [], .write alice door carol (some 106) 0 [113])]
#guard refused keptWriter == [115]
#guard (entryWrites (view keptWriter) door).map (·.edit) == [100, 113]

-- handing the root on to a new passkey, then retiring the old one, cuts what the old passkey signs on an old copy;
-- both keep what the old passkey approved before them, as every honest device's draft does
def handover : List Edit := s1 ++ chain 140 [
  (passkeyA, [77], .share (.owner alice (.signer 77))),
  (passkeyA, [77], .settings alice (.root (some 77) [2, 3, 140])),
  (77, [], .revoke (.owner alice (.signer passkeyA) [2, 3, 140]))] ++ offline 150 140 [
  (passkeyA, [stranger], .share (.device alice stranger))]
#guard refused handover == [150]
#guard ((view handover).vault? alice).map (fun v => (v.owners, v.root)) == some ([.signer 77], some 77)
#guard !actsFor (view handover) stranger alice

/-! ## Moves are removals too

A move takes its entry out of every share it leaves behind: a write the move hadn't seen stands only if its writer could
write in the audience the move took the entry to. Alice takes the work tag off the solar todo and her Mac moves it to
Carol's audience, while Bob and Carol, on copies that had seen neither, each write it. -/

def movedOver (keep : List EditId) : List Edit := shared ++ chain 520 [
  (macA, [], .write alice solar alice (some 514) 0 [502] (tags := { remove := [work] })),
  (macA, [], .move alice solar [31] ([502, 520] ++ keep))] ++ offline 530 514 [
  (macB, [], .write alice solar bob (some 514) 0 [502]),
  (macC, [], .write alice solar carol (some 514) 0 [502])]
-- Bob's write is cut, Carol's stands; had the move seen Bob's, his would stand too
#guard refused (movedOver []) == [530]
#guard (entryWrites (view (movedOver [])) solar).map (·.edit) == [502, 531, 520]
#guard refused (movedOver [530]) == [] && tidy (movedOver [530])
-- a relay, which reads no tag, cuts the same write (T25)
#guard (standing ((movedOver []).map Edit.blind)).map (·.id) == (standing (movedOver [])).map (·.id)

/-! ## A move hands a removal nothing

Bob writes Alice's work todos and her urgent ones. He creates the lamp todo, tagged work. Alice makes it urgent rather
than work, and her Mac moves it to the audience of Bob's urgent share. Meanwhile her passkey, on a device that never
received the lamp, revokes that share. Bob made the lamp through his work share, which still holds, and every write is
judged in the audience it was written in, so the revocation takes nothing from the lamp: it stays, with Alice's write,
and Bob writes it no more. -/

def kept : List Edit := workShare ++ chain 520 [
  (macA, [], .share (.grant (shareOf 34 alice bob .write urgentTodos))),
  (macB, [], create alice lamp bob [32] todo [work] (proof := some 32)),
  (macA, [], .write alice lamp alice none 0 [521] (tags := { add := [urgent], remove := [work] })),
  (macA, [], .move alice lamp [34] [521, 522])] ++ offline 530 524 [
  (passkeyA, [], .revoke (.grant 34 alice [520]))]
#guard refused kept == []
#guard (entryWrites (view kept) lamp).map (·.edit) == [521, 522] && audienceOf kept lamp == [34]
#guard !(writable kept bob).contains lamp && !accepted kept (attempt macB [] (.write alice lamp bob none 0 [522]))

/-! ## An entry id is created once

In step order, where a removal's keep list alone says what it had seen, Bob creates the lamp through his work share and
Alice's passkey revokes that share without having seen it: the lamp falls with its writes. Its id stays used even so:
nobody creates it again, so an entry key's name never names two keys. -/

def fallen : List Edit := workShare ++ chain 520 [
  (macB, [], create alice lamp bob [32] todo [work] (proof := some 32)),
  (passkeyA, [], .revoke (.grant 32 alice []))]
#guard let st := replay {} fallen; st.entry? lamp == none && entryWrites st lamp == [] && st.born.contains lamp
#guard (step (replay {} fallen) (attempt macA [] (create alice lamp alice [] todo))).isNone
#guard ((replay {} fallen.dropLast).entry? lamp).isSome

/-! ## Removals settle from the top down

A removal is only ever kept out by one that ranks above it, so what ranks above a removal must never rest on what it
takes away: a vault's removals come before those of the coops it owns, and a senior revoker's before those of whoever
holds a share beneath the one revoked. -/

-- Alice gives Dave owner on her notes, and Dave gives Carol read beneath it. Dave revokes Carol's read on a copy that
-- hadn't seen Alice, the vault the shares are over, revoke Dave's share, so Dave's revocation sorts first. Alice ranks
-- first all the same: Dave's share goes, Carol's with it, and Dave's revocation falls with the share it rested on.
def seniorRevoke : List Edit := s2 ++ chain 700 [
  (macA, [], create alice plan alice [] note),
  (passkeyA, [], .share (.grant (shareOf 701 alice dave .owner notes))),
  (macD, [], .share (.grant (shareOf 702 alice carol .read notes (parent := some 701) (issuer := dave)))),
  (macA, [], create alice diary alice [] note),
  (macA, [], .write alice plan alice none 0 [700]),
  (passkeyA, [], .revoke (.grant 701 alice [700, 701, 702, 703, 704]))] ++ offline 720 702 [
  (macD, [], .revoke (.grant 702 dave []))]
#guard (((order seniorRevoke).map (·.id)).drop (s2.length + 3)).take 1 == [720]
#guard refused seniorRevoke == [720]
#guard !(view seniorRevoke).live 701 && !(view seniorRevoke).live 702

-- Alice's vault gains two more passkeys, either of which approves for it alone, and Alice and Bob found a coop
-- where either acts alone. One passkey removes Bob from the coop on a copy that hadn't seen the other passkey remove it
-- from Alice's vault. Alice's vault settles first, so the coop's removal falls, exactly as on a peer that never held
-- the coop's log.
def tiers : List Edit := s2 ++ chain 740 [
  (passkeyA, [77], .share (.owner alice (.signer 77))),
  (passkeyA, [78], .share (.owner alice (.signer 78))),
  (passkeyA, [passkeyB], .genesis pair .coop [.vault alice, .vault bob] 1),
  (passkeyA, [], .settings pair (.threshold 1)),
  (78, [], .revoke (.owner alice (.signer 77) [740, 741, 742, 743]))] ++ offline 760 742 [
  (77, [], .revoke (.owner pair (.vault bob) []))]
#guard refused tiers == [760]
#guard ((view tiers).vault? alice).map (·.owners) == some [.signer passkeyA, .signer 78]
#guard ((view tiers).vault? pair).map (·.owners) == some [.vault alice, .vault bob]
#guard ((view (tiers.filter fun o => o.id != 742 && o.id != 760)).vault? alice).map (·.owners) ==
  ((view tiers).vault? alice).map (·.owners)

/-! ## Holdings: they come from their own connection, and authorize nothing

Alice's Mac holds the coop's Handbook, where her line in Welcome brings a photo and Bob's Mac wrote a line after it.
Each device tells it, on the connection whose hello proved that device, what it holds for good, and it tells each its
own holdings (H1). Carol's Mac and Dave's, outside the coop, claim Welcome and the photo: Alice's Mac keeps each claim
as that device's word alone, and lists as "Synced to" only devices that may hold what they claim by its view. It names
to each device only the logs it may know and the files it may fetch, and hands the photo to Bob's Mac while its
connection is open, to nobody else, whatever they claim (T27). -/

def photo : FileId := 1

/-- `edits` as their devices make them: each building on the frontier of its own log among the edits before it. -/
def built (edits : List Edit) : List Edit :=
  edits.foldl (fun acc o => acc ++ [{ o with parents := match o.log? with
    | some l => frontiers acc l
    | none => [] }]) []

/-- Write `id` to Welcome by device `d`, for the coop through vault `via`, building on `deps` and bringing `files`. -/
def welcomeLine (id : EditId) (d : SignerId) (via : VaultId) (deps : List EditId) (files : List FileId := []) : Edit :=
  { id, depth := id, author := d, cosigners := [], files,
    action := .write coop welcome coop none 0 deps (via := [via]) }

def sH : List Edit := built (s4 ++ [welcomeLine 40 macA alice [30] [photo], welcomeLine 41 macB bob [40]])
#guard refused sH == [] && (frontiers sH (.entry welcome)) == [41]

-- the sync connections of Alice's Mac, each from an endpoint, to the device its hello proved
def toBob : Conn := ⟨50, macB⟩
def toCarol : Conn := ⟨70, macC⟩
def toDave : Conn := ⟨90, macD⟩

/-- Bob's Mac, which holds all of it for good and the photo whole, and what it tells Alice's Mac on their new
    connection. -/
def bobsMac : Node := { edits := sH, held := sH.length, files := [(photo, .whole)] }
def bobSays : Announce := (bobsMac.announce ⟨20, macA⟩ none).getD {}

/-- Carol's Mac by hand: it claims Welcome as Alice's Mac holds it and the photo whole. Dave's: the photo whole. -/
def carolClaims : Announce :=
  { full := true, logs := [(.entry welcome, holdOf sH (.entry welcome))], files := [(photo, some .whole)] }
def daveClaims : Announce := { full := true, files := [(photo, some .whole)] }

def alicesMac : Node :=
  { edits := sH, held := sH.length, files := [(photo, .whole)], conns := [toBob, toCarol, toDave],
    heard := [(toBob, bobSays), (toCarol, carolClaims), (toDave, daveClaims)] }

-- Bob's Mac tells all it holds that Alice's Mac may know, Welcome's log and the photo among it, and Alice's Mac keeps
-- exactly that as Bob's Mac's holdings
#guard bobSays.full && bobSays.logs.contains (.entry welcome, holdOf sH (.entry welcome)) &&
  bobSays.files.contains (photo, some .whole)
#guard alicesMac.record macB == bobsMac.tells macA
-- it keeps Carol's claims as hers alone and Dave's as his, and nothing of a device that told it nothing
#guard (alicesMac.record macC).log? (.entry welcome) == some (holdOf sH (.entry welcome))
#guard (alicesMac.record macD).file? photo == some .whole && alicesMac.record macA == ({} : Holdings)
-- Synced to lists Alice's Mac and Bob's, never Carol's or Dave's, which may not hold Welcome or fetch the photo: one
-- list for the entry and the file, each device with whether it holds all of it
#guard alicesMac.syncedTo macA (.entry welcome) == [(macA, true), (macB, true)] &&
  alicesMac.syncedTo macA (.file photo) == [(macA, true), (macB, true)]
#guard { alicesMac with heard := alicesMac.heard.drop 1 }.syncedTo macA (.entry welcome) == [(macA, true)]
-- Bob's Mac holding one piece of the photo is listed with some of it
#guard { alicesMac with heard := [(toBob, { full := true, files := [(photo, some (.pieces [0]))] })] }.syncedTo macA
  (.file photo) == [(macA, true), (macB, false)]
-- what Carol's Mac says on its own connection changes nothing of Bob's Mac's record, and a full announcement of nothing
-- stands in for all it said before
#guard let more := alicesMac.heard ++ [(toCarol, { full := true })]
  { alicesMac with heard := more }.record macB == alicesMac.record macB &&
    { alicesMac with heard := more }.record macC == ({} : Holdings)
-- Alice's Mac names to Carol's Mac and Dave's no file and nothing of Welcome, all of it on their new connections
#guard [toCarol, toDave].all fun c => (alicesMac.announce c none).all fun a =>
  a.full && a.files.isEmpty && !a.logs.any (·.1 == .entry welcome)
#guard (alicesMac.tells macB).file? photo == some .whole
-- its gate hands the photo, its root or a piece, to Bob's Mac, never to Carol's or Dave's whatever they claim, nor to
-- an endpoint with no sync connection, and not to Bob's Mac once its connection is closed
#guard alicesMac.hands 50 (.root photo) && alicesMac.hands 50 (.piece photo 0)
#guard [70, 90, 99].all fun ep => !alicesMac.hands ep (.root photo) && !alicesMac.hands ep (.piece photo 0)
#guard !{ alicesMac with conns := [toCarol, toDave] }.hands 50 (.root photo)

-- nothing changed, nothing to tell; once Alice's Mac takes a new line of Welcome, it tells Welcome's log alone
def sH2 : List Edit := built (s4 ++ [welcomeLine 40 macA alice [30] [photo], welcomeLine 41 macB bob [40],
  welcomeLine 42 macA alice [41]])
#guard (alicesMac.tells macB).since (some (alicesMac.tells macB)) == none
#guard (({ alicesMac with edits := sH2, held := sH2.length }.tells macB).since (some (alicesMac.tells macB))).map
  (fun a : Announce => (a.full, a.logs.map Prod.fst, a.files)) == some (false, [LogId.entry welcome], [])

-- the bucket first: with nothing on its shelf yet Bob's Mac states no log; before its shelf took Welcome's lines, it
-- states Welcome's creation alone and no photo, which doesn't cover Welcome as Alice's Mac holds it, so it is listed
-- with some of it; once its shelf holds them, it tells what changed, and Alice's Mac lists it with all of it
def bobsShelfBehind : Node := { bobsMac with held := s4.length, files := [] }
#guard ({ bobsMac with held := 0 }.tells macA).logs == []
#guard (bobsShelfBehind.tells macA).log? (.entry welcome) == some ⟨[30], []⟩ && (bobsShelfBehind.tells macA).files == []
#guard let first := (bobsShelfBehind.announce ⟨20, macA⟩ none).getD {}
  let next := (bobsMac.announce ⟨20, macA⟩ (some (bobsShelfBehind.tells macA))).getD {}
  !next.full && { alicesMac with heard := [(toBob, first)] }.syncedTo macA (.entry welcome) ==
    [(macA, true), (macB, false)] &&
    { alicesMac with heard := [(toBob, first), (toBob, next)] }.syncedTo macA (.entry welcome) ==
      [(macA, true), (macB, true)]

-- an edit waiting for its past: Bob's Mac holding Welcome's last line without the one before states it waiting, which
-- covers Welcome as a peer with the same gap holds it, not as Alice's Mac holds it
#guard let gap := sH.filter (·.id != 40)
  let says := ({ bobsMac with edits := gap, held := gap.length }.announce ⟨20, macA⟩ none).getD {}
  holdOf gap (.entry welcome) == ⟨[30], [41]⟩ &&
    { alicesMac with heard := [(toBob, says)] }.syncedTo macA (.entry welcome) == [(macA, true), (macB, false)] &&
    { alicesMac with edits := gap, held := gap.length, heard := [(toBob, says)] }.syncedTo macA (.entry welcome) ==
      [(macA, true), (macB, true)]

-- a peer ahead: Bob's Mac holds a line of Welcome Alice's Mac lacks, so its frontier names a head she can't walk back
-- from, so not with all of it (the Rust node leaves it out, holding none of it as far as her edits show); it is
-- listed with all of it once she holds that line too
def sAhead : List Edit := built (s4 ++ [welcomeLine 40 macA alice [30] [photo], welcomeLine 41 macB bob [40],
  welcomeLine 42 macB bob [41]])
#guard let ahead := ({ bobsMac with edits := sAhead, held := sAhead.length }.announce ⟨20, macA⟩ none).getD {}
  { alicesMac with heard := [(toBob, ahead)] }.syncedTo macA (.entry welcome) == [(macA, true), (macB, false)] &&
    { alicesMac with edits := sAhead, held := sAhead.length, heard := [(toBob, ahead)] }.syncedTo macA
      (.entry welcome) == [(macA, true), (macB, true)]

/-! ## Signed holdings: a device's word outlives its connection

Bob's Mac signs what it tells Alice's Mac it holds, checked at 100, and again at 200. Alice's Mac keeps the newest,
whichever connection brought it, and ignores a newer one Carol's Mac signed in Bob's Mac's name. It passes Bob's Mac's
statement to Alice's iPhone, which may know all of it, and not to Carol's Mac or Dave's, which may not. While Bob's Mac
is on no live connection, "Synced to" lists it by that statement, with when it checked; on a live one, by what it
announced there, with no time (H2). -/

def bobAt100 : Statement := bobsMac.states macB macA 100
def bobAt200 : Statement := bobsMac.states macB macA 200
/-- Carol's Mac's signature on a statement in Bob's Mac's name, saying it holds nothing. -/
def forged : Statement := { bobAt200 with checked := 300, holdings := {}, signer := some macC }
/-- Carol's Mac's own statement, claiming Welcome. -/
def carolStates : Statement :=
  { device := macC, checked := 150, holdings := { logs := [(.entry welcome, holdOf sH (.entry welcome))] },
    signer := some macC }

def alicesMacLater : Node := { alicesMac with heard := [], stated := [bobAt100, forged, bobAt200, carolStates] }

-- Bob's Mac signs what it tells Alice's Mac; Alice's Mac keeps the newest it signed, whatever order they came in, and
-- nothing of Carol's in its name
#guard bobAt100.signed && bobAt100.holdings == bobsMac.tells macA && !forged.signed
#guard alicesMacLater.statement macB == some bobAt200
#guard { alicesMacLater with stated := [bobAt200, forged, bobAt100] }.statement macB == some bobAt200
#guard { alicesMacLater with stated := [forged] }.statement macB == none
-- it passes Bob's Mac's statement to Alice's iPhone, and nothing to Carol's Mac or Dave's
#guard (alicesMacLater.passes phoneA).contains bobAt200
#guard !(alicesMacLater.passes macC).contains bobAt200 && !(alicesMacLater.passes macD).contains bobAt200
-- Synced to: Bob's Mac by its statement, checked at 200, the entry and the file alike; never Carol's Mac, whatever
-- she signs of herself
#guard alicesMacLater.syncedToAt macA [] (.entry welcome) == [(macA, true, none), (macB, true, some 200)]
#guard alicesMacLater.syncedToAt macA [] (.file photo) == [(macA, true, none), (macB, true, some 200)]
-- on a live connection, by what it announced there; with no statement, by what it last announced
#guard { alicesMacLater with heard := [(toBob, bobSays)] }.syncedToAt macA [macB] (.entry welcome) ==
  [(macA, true, none), (macB, true, none)]
#guard { alicesMac with stated := [] }.syncedToAt macA [] (.entry welcome) == [(macA, true, none), (macB, true, none)]
-- a statement of an older shelf: Bob's Mac before its shelf took Welcome's lines states some of it
#guard { alicesMacLater with stated := [bobsShelfBehind.states macB macA 400] }.syncedToAt macA []
  (.entry welcome) == [(macA, true, none), (macB, false, some 400)]

/-! ## Cap groups: a share names a group, which its vault versions

Maia City defines its cap groups as entries of its own: Traveler reads the game entries, and Citizen sets the `move` of
a game entry besides, including Traveler. A share names a group and copies none of its ops; its level bounds what the
group grants it. Every share selects the vault's cap groups, so whoever reads anything of Maia City reads them and judges
each write alike. Only Maia City's own writes on the main line make a new version: narrowing Citizen narrows every share
that names it at once. -/

def game : Sym := 31
def games : Selector := .anyOf [[.typeIn [game]]]
def traveler := 50
def citizen := 51
def adminG := 52
def gameMap := 60
def memo := 61

def travelerG : CapGroup := { name := "Traveler", caps := [⟨.read, games⟩] }
def citizenG : CapGroup := { name := "Citizen", caps := [⟨.set [.field "move"] none none, games⟩], includes := [traveler] }

/-- Share `id` over vault `over`: vault `who` holds cap group `g` of `over`, bounded by `level`, on whatever the group's
    caps hold. -/
def groupShare (id : ShareId) (over who : VaultId) (level : Level) (g : EntryId) : Share :=
  { shareOf id over who level (.anyOf [[]]) with ops := [], group := some g }

def sCaps : List Edit := sServer ++ chain 600 [
  (macA, [], create city traveler city [] capGroupType (via := [alice]) (defines := some travelerG)),
  (macA, [], create city citizen city [] capGroupType (via := [alice]) (defines := some citizenG)),
  (macA, [], .share (.grant (groupShare 30 city bob .write citizen) [alice])),
  -- a steward creates the map straight in the audience Bob's share selects, and a memo, which no share selects
  (macA, [], create city gameMap city [30] game (via := [alice])),
  (macA, [], create city memo city [] doc (via := [alice]))]
#guard refused sCaps == []

-- every share selects the vault's cap groups: a steward moves them to Bob's share's audience too
#guard upkeep sCaps traveler == some [30] && upkeep sCaps citizen == some [30] && upkeep sCaps memo == none
def sCaps' : List Edit := sCaps ++ chain 605 [
  (macA, [], .move city traveler [30] [600] [alice]),
  (macA, [], .move city citizen [30] [601] [alice])]
#guard refused sCaps' == [] && tidy sCaps'
#guard reads sCaps' macB gameMap && reads sCaps' macB citizen && !reads sCaps' macB memo

-- Citizen grants its own cap and Traveler's on a game entry, nothing on the memo; a read share naming it, only read
#guard ((view sCaps').entry? gameMap).map (fun en => opsOn (view sCaps') (groupShare 30 city bob .write citizen) en.attrs)
  == some [.set [.field "move"] none none, .read]
#guard ((view sCaps').entry? memo).map (fun en => opsOn (view sCaps') (groupShare 30 city bob .write citizen) en.attrs)
  == some []
#guard ((view sCaps').entry? gameMap).map (fun en => opsOn (view sCaps') (groupShare 30 city bob .read citizen) en.attrs)
  == some [.read]

def bobMoves (n : Nat) (deps : List EditId) : Action :=
  .write city gameMap bob none 0 deps (proof := some 30) (touches := [.set [.field "move"] (some (.int n))])

-- Bob's move counts; a title he sets is accepted, as his share reaches the map, but nobody counts it
#guard counted sCaps' (attempt macB [] (bobMoves 4 [603]))
#guard accepted sCaps' (attempt macB [] (.write city gameMap bob none 0 [603] (proof := some 30)
  (touches := [.set [.field "title"] (some (.str "Mine"))])))
#guard !counted sCaps' (attempt macB [] (.write city gameMap bob none 0 [603] (proof := some 30)
  (touches := [.set [.field "title"] (some (.str "Mine"))])))

-- Bob reaches Citizen's entry too, but a version he writes widening it counts nowhere and changes nothing
def bobWidens : Action :=
  .write city citizen bob (some 606) 0 [601] (proof := some 30) (touches := [.set [] none])
    (defines := some { citizenG with caps := [⟨.set [] none none, .all⟩] })
#guard accepted sCaps' (attempt macB [] bobWidens) && !counted sCaps' (attempt macB [] bobWidens)
#guard ((step (view sCaps') (attempt macB [] bobWidens)).map fun st => groupAt st city citizen) == some (some citizenG)

-- Maia City narrows Citizen to Traveler alone, a new version of its entry: Bob's next move counts no more, and he
-- still reads the map
def sNarrow : List Edit := sCaps' ++ chain 607 [
  (macA, [], .write city citizen city (some 606) 0 [601] (via := [alice]) (touches := [.set [.field "caps"] none])
    (defines := some { citizenG with caps := [] }))]
#guard refused sNarrow == []
#guard groupAt (view sNarrow) city citizen == some { citizenG with caps := [] }
#guard !counted sNarrow (attempt macB [] (bobMoves 5 [603])) && reads sNarrow macB gameMap
-- a version written on a proposal, or by anyone but Maia City, changes nothing until it lands on main
#guard ((step (view sCaps') (attempt macA [] (.write city citizen city (some 606) 0 [601] (proposal := .new)
  (via := [alice]) (touches := [.propose]) (defines := some { citizenG with caps := [] })))).map fun st =>
  groupAt st city citizen) == some (some citizenG)

/-! ## Invite shares: one key, claimed once

Maia City signs a share of Traveler to an invite key, a one-time key it hands the newcomer with the invite. Nobody holds
the share until a vault claims it, signed by that key and by a member of the vault: then it names that vault, which reads
what Traveler holds, with no tap of Maia City's. An invite makes no owner, and a share is claimed once. -/

def inviteKey := 700
def inviteShare (id : ShareId) (over : VaultId) (k : SignerId) (level : Level) (g : EntryId) : Share :=
  { groupShare id over over level g with who := .invite k }

def sInvite : List Edit := sCaps' ++ chain 610 [
  (macA, [], .share (.grant (inviteShare 31 city inviteKey .read traveler) [alice])),
  -- a steward moves the map and the groups into the invite's audience too
  (macA, [], .move city gameMap [30, 31] [603] [alice]),
  (macA, [], .move city traveler [30, 31] [600] [alice]),
  (macA, [], .move city citizen [30, 31] [601] [alice])]
#guard refused sInvite == [] && tidy sInvite
-- before the claim, Carol reads nothing of it
#guard !reads sInvite macC gameMap

-- an invite makes no owner
#guard !accepted sCaps' (attempt passkeyA [] (.share (.grant (inviteShare 32 city inviteKey .owner traveler) [alice])))
-- a claim takes the invite key's signature and a member of the claiming vault
#guard !accepted sInvite (attempt passkeyC [] (.claim 31 carol))
#guard !accepted sInvite (attempt passkeyB [inviteKey] (.claim 31 carol))
-- nor does Maia City claim its own invite
#guard !accepted sInvite (attempt passkeyA [inviteKey] (.claim 31 city))

def sClaimed : List Edit := sInvite ++ chain 614 [(passkeyC, [inviteKey], .claim 31 carol)]
#guard refused sClaimed == []
#guard ((view sClaimed).share? 31).map (·.who) == some (.vault carol)
-- Carol reads the map and the groups, and nothing more; Traveler sets nothing
#guard reads sClaimed macC gameMap && reads sClaimed macC traveler && !reads sClaimed macC memo
#guard !counted sClaimed (attempt macC [] (.write city gameMap carol none 0 [603] (proof := some 31)
  (touches := [.set [.field "move"] (some (.int 1))])))
-- the invite is used up: no second claim, by anyone
#guard !accepted sClaimed (attempt passkeyD [inviteKey] (.claim 31 dave))
#guard !accepted sClaimed (attempt passkeyC [inviteKey] (.claim 31 carol))

/-! ## The server takes a new vault only by invite or from an admin

Anyone can sign a genesis, but the server of Maia City takes a new human vault onto what it holds only with the invite it
claims in the same batch, and a new coop or aven only where an admin owns it: Maia City, its owner Alice, or a holder of
its Admin cap group, which only admins get. -/

def eve := 104
def passkeyE := 41
def eveJoins : List Edit := chain 700 [
  (passkeyE, [], .genesis eve .human [.signer passkeyE] 1 (some passkeyE)),
  (passkeyE, [inviteKey], .claim 31 eve)]

-- Eve's vault comes with the invite it claims: the server takes the batch whole
#guard takes city sInvite eveJoins == some eveJoins
-- without the claim, the server leaves her genesis out
#guard takes city sInvite eveJoins.dropLast == some []
-- and once the invite is used up, her claim stands no more, so her genesis stays out too
#guard (takes city sClaimed eveJoins).map (·.length) == some 1

-- a coop Bob founds alone, a citizen but no admin, the server leaves out; one Alice founds, it takes
def bobsCoop : List Edit := chain 710 [(passkeyB, [], .genesis 220 .coop [.vault bob] 1)]
#guard takes city sInvite bobsCoop == some []
#guard takes city sInvite (chain 710 [(passkeyA, [], .genesis 220 .coop [.vault alice] 1)]) ==
  some (chain 710 [(passkeyA, [], .genesis 220 .coop [.vault alice] 1)])

-- Maia City's Admin group, granted to Bob: now the server takes his coop
def sAdmin : List Edit := sInvite ++ chain 620 [
  (macA, [], create city adminG city [30, 31] capGroupType (via := [alice]) (defines := some { name := "Admin" })),
  (macA, [], .share (.grant (groupShare 32 city bob .read adminG) [alice]))]
#guard refused sAdmin == []
#guard isAdmin (view sAdmin) city bob && !isAdmin (view sInvite) city bob
#guard takes city sAdmin bobsCoop == some bobsCoop

-- a pass Bob's Mac signs for maiaCITY's API: the server answers his vault, an admin once he holds the Admin group
def bobsPass : ApiPass := { device := macB, audience := "maiaCITY API", made := 1000, signer := some macB }
#guard passStanding (view sAdmin) city "maiaCITY API" 1000 bobsPass == some (bob, true)
#guard passStanding (view sInvite) city "maiaCITY API" 1000 bobsPass == some (bob, false)
-- Alice's Mac: her vault owns Maia City
#guard passStanding (view sAdmin) city "maiaCITY API" 1000 { bobsPass with device := macA, signer := some macA } ==
  some (alice, true)
-- signed by another key, for another service, too old or made too far ahead: it counts for nothing
#guard passStanding (view sAdmin) city "maiaCITY API" 1000 { bobsPass with signer := some macA } == none
#guard passStanding (view sAdmin) city "another service" 1000 bobsPass == none
#guard passStanding (view sAdmin) city "maiaCITY API" (1000 + passLife) bobsPass == none
#guard passStanding (view sAdmin) city "maiaCITY API" (1000 + passLife - 1) bobsPass == some (bob, true)
#guard passStanding (view sAdmin) city "maiaCITY API" (1000 - passSkew) bobsPass == some (bob, true)
#guard passStanding (view sAdmin) city "maiaCITY API" (1000 - passSkew - 1) bobsPass == none
-- a passkey or a stranger's key is no vault's device: nothing, whoever signs
#guard passStanding (view sAdmin) city "maiaCITY API" 1000 { bobsPass with device := passkeyB, signer := some passkeyB } ==
  none
#guard passStanding (view sAdmin) city "maiaCITY API" 1000 { bobsPass with device := stranger, signer := some stranger } ==
  none

/-! ## A key move: every signer to ML-DSA-65

avenDB signs with ML-DSA-65 where it signed with SLH-DSA (Samuel, 2026-10-19). A signer's id hashes its keys, so a
signer's new key is a new signer, and a vault moves to it with the edits it already has: the old key adds the new one,
which signs too, hands the root on to it where it is the root (the new key signing), and the new key removes the old. Alice moves her passkey
and her Mac, Bob his after her; Alice's iPhone stays as it is for now. No rule changes, as the model abstracts how each
signer signs: every edit the old keys made still stands and counts, the new keys read and approve all the old ones did,
and the old keys approve and open nothing more. -/

def passkeyA' := 81
def macA' := 82
def passkeyB' := 84
def macB' := 85

/-- Every edit of `edits`: what a removal names as seen and kept by a device that had seen them all. -/
def seen (edits : List Edit) : List EditId := edits.map (·.id)

def keyMove : List Edit := allTodos' ++ chain 720 [
  (passkeyA, [passkeyA'], .share (.owner alice (.signer passkeyA'))),
  (passkeyA, [passkeyA'], .settings alice (.root (some passkeyA') (seen allTodos' ++ [720]))),
  (passkeyA', [], .revoke (.owner alice (.signer passkeyA) (seen allTodos' ++ [720, 721]))),
  (passkeyA', [macA'], .share (.device alice macA')),
  (passkeyA', [], .revoke (.device alice macA (seen allTodos' ++ [720, 721, 722, 723]))),
  (passkeyB, [passkeyB'], .share (.owner bob (.signer passkeyB'))),
  (passkeyB, [passkeyB'], .settings bob (.root (some passkeyB') (seen allTodos' ++ [725]))),
  (passkeyB', [], .revoke (.owner bob (.signer passkeyB) (seen allTodos' ++ [725, 726]))),
  (passkeyB', [macB'], .share (.device bob macB')),
  (passkeyB', [], .revoke (.device bob macB (seen allTodos' ++ [725, 726, 727, 728])))]
#guard refused keyMove == []
#guard ((view keyMove).vault? alice).map (fun v => (v.owners, v.root, v.devices)) ==
  some ([.signer passkeyA'], some passkeyA', [phoneA, macA'])
#guard ((view keyMove).vault? bob).map (fun v => (v.owners, v.root, v.devices)) ==
  some ([.signer passkeyB'], some passkeyB', [macB'])
-- the old keys' writes still count, and the new keys read what the old ones read, Bob's through Alice's share
#guard (view keyMove).uncounted == (view allTodos').uncounted
#guard readable keyMove macA' == readable allTodos' macA && readable keyMove passkeyA' == readable allTodos' macA
#guard readable keyMove macB' == [door, seeds, solar]
-- the old keys read nothing more, open nothing and approve nothing; the new ones do
#guard readable keyMove macA == [] && readable keyMove macB == []
#guard !opens' keyMove passkeyA (.seed alice) && !opens' keyMove macA (.seed alice) && opens' keyMove macA' (.seed alice)
#guard !actsFor (view keyMove) macA alice && actsFor (view keyMove) macA' alice
#guard accepted keyMove (attempt passkeyA' [78] (.share (.device alice 78)))
#guard !accepted keyMove (attempt passkeyA [78] (.share (.device alice 78)))
#guard accepted keyMove (attempt macA' [] (create alice 30 alice [] todo))
#guard !accepted keyMove (attempt macA [] (create alice 30 alice [] todo))
-- the new key joins only with its own signature, and the root goes to it only with its signature; every owner being
-- equal, it may as well take the root itself once it is an owner
#guard !accepted allTodos' (attempt passkeyA [] (.share (.owner alice (.signer passkeyA'))))
#guard !accepted (keyMove.take (allTodos'.length + 1))
  (attempt passkeyA [] (.settings alice (.root (some passkeyA') [])))
#guard accepted (keyMove.take (allTodos'.length + 1))
  (attempt passkeyA' [] (.settings alice (.root (some passkeyA') [])))

/-! ## Chat rooms: a room is an entry, its messages rows, and Member edits only its own

Alice's vault holds a room, an entry of type `room`, which it shares with Bob and Carol in Member. Each of them posts,
replies and reacts by adding rows under `messages`, and changes only what is their own: a message, a reply or a
reaction is its adder's, by the room's counted writes, which every reader holds alike. Nobody but Alice's vault changes
the room's own fields; Alice's vault changes anything. -/

def roomType : Sym := 41
def room := 81
def bobMember : Share := { shareOf 72 alice bob .write (byId room) with ops := memberOps }
def carolMember : Share := { shareOf 73 alice carol .write (byId room) with ops := memberOps }

def msg (i : Int) : Ops.Loc := [.field "messages", .row i]
def at' (l : Ops.Loc) (f : String) : Ops.Loc := l ++ [.field f]
def reaction (i j : Int) : Ops.Loc := at' (msg i) "reactions" ++ [.row j]

/-- Vault `a` writes the room through share `c`, building on `deps`, with the touches `ts` and the rows `adds`. -/
def roomWrite (a : VaultId) (c : ShareId) (deps : List EditId) (ts : List Touch) (adds : List Ops.Loc := []) :
    Action :=
  .write alice room a none 0 deps (proof := some c) (touches := ts) (adds := adds)

def sRoom : List Edit := s2 ++ chain 650 [
  (macA, [], .share (.grant bobMember)),
  (macA, [], .share (.grant carolMember)),
  -- a steward creates the room straight in the audience its shares select
  (macA, [], create alice room alice [72, 73] roomType),
  -- Bob posts message 1, Carol reacts to it with reaction 2 and replies in its thread with reply 3
  (macB, [], roomWrite bob 72 [652] [.insert [.field "messages"]] [msg 1]),
  (macC, [], roomWrite carol 73 [653] [.insert (at' (msg 1) "reactions")] [reaction 1 2]),
  (macC, [], roomWrite carol 73 [654] [.insert (at' (msg 1) "thread")] [at' (msg 1) "thread" ++ [.row 3]])]
#guard refused sRoom == [] && tidy sRoom
#guard (view sRoom).uncounted == []
#guard reads sRoom macB room && reads sRoom macC room && !reads sRoom macD room

-- Bob edits his message, and deletes it; Carol takes back her reaction and edits her reply, inside Bob's message
#guard counted sRoom (attempt macB [] (roomWrite bob 72 [655] [.set (at' (msg 1) "text") (some (.str "hi!"))]))
#guard counted sRoom (attempt macB [] (roomWrite bob 72 [655] [.set (at' (msg 1) "deleted") (some (.bool true)),
  .set (at' (msg 1) "text") (some (.str ""))]))
#guard counted sRoom (attempt macC [] (roomWrite carol 73 [655] [.set (at' (reaction 1 2) "deleted") (some (.bool true))]))
#guard counted sRoom (attempt macC [] (roomWrite carol 73 [655]
  [.set (at' (at' (msg 1) "thread" ++ [.row 3]) "text") (some (.str "yes"))]))
-- Carol's edit of Bob's message is accepted, as her share reaches the room, but nobody counts it, even where her write
-- claims it is her own; nor Bob's of Carol's reaction or reply
#guard accepted sRoom (attempt macC [] (roomWrite carol 73 [655] [.set (at' (msg 1) "text") (some (.str "mine"))]))
#guard !counted sRoom (attempt macC [] (roomWrite carol 73 [655] [.set (at' (msg 1) "text") (some (.str "mine"))]))
#guard !counted sRoom (attempt macC [] (roomWrite carol 73 [655] [.own (at' (msg 1) "text") (some (.str "mine"))]))
#guard !counted sRoom (attempt macB [] (roomWrite bob 72 [655] [.set (at' (reaction 1 2) "deleted") (some (.bool true))]))
#guard !counted sRoom (attempt macB [] (roomWrite bob 72 [655]
  [.set (at' (at' (msg 1) "thread" ++ [.row 3]) "deleted") (some (.bool true))]))
-- no Member names the room, removes or moves a row, nor writes on a proposal; Alice's vault changes anything
#guard !counted sRoom (attempt macB [] (roomWrite bob 72 [655] [.set [.field "name"] (some (.str "Bob's"))]))
#guard !counted sRoom (attempt macB [] (roomWrite bob 72 [655] [.remove [.field "messages"]]))
#guard !counted sRoom (attempt macB [] (roomWrite bob 72 [655] [.move [.field "messages"]]))
#guard counted sRoom (attempt macA [] (.write alice room alice none 0 [655]
  (touches := [.set [.field "name"] (some (.str "Garden")), .set (at' (msg 1) "deleted") (some (.bool true))])))

-- a row is its adder's by the counted writes alone: a row Bob added through a write nobody counts is nobody's, and a
-- row two vaults added with one id is neither's
def sRoomTwice : List Edit := sRoom ++ chain 656 [
  (macC, [], roomWrite carol 73 [655] [.insert [.field "messages"]] [msg 1])]
#guard refused sRoomTwice == [] && (view sRoomTwice).uncounted == []
#guard !counted sRoomTwice (attempt macB [] (roomWrite bob 72 [656] [.set (at' (msg 1) "text") (some (.str "hi!"))]))
#guard !counted sRoomTwice (attempt macC [] (roomWrite carol 73 [656] [.set (at' (msg 1) "text") (some (.str "hi!"))]))
def sRoomUncounted : List Edit := sRoom ++ chain 656 [
  (macB, [], roomWrite bob 72 [655] [.insert [.field "messages"], .set [.field "name"] none] [msg 4])]
#guard refused sRoomUncounted == [] && (view sRoomUncounted).uncounted == [656]
#guard !counted sRoomUncounted (attempt macB [] (roomWrite bob 72 [655] [.set (at' (msg 4) "text") (some (.str "x"))]))

-- a newcomer reads the room's history: Alice adds Dave, and a steward moves the room to the audience with his share
def sRoomDave : List Edit := sRoom ++ chain 656 [
  (macA, [], .share (.grant { shareOf 74 alice dave .write (byId room) with ops := memberOps })),
  (macA, [], .move alice room [72, 73, 74] [655])]
#guard refused sRoomDave == [] && tidy sRoomDave && reads sRoomDave macD room
#guard counted sRoomDave (attempt macD [] (.write alice room dave (some 657) 0 [655] (proof := some 74)
  (touches := [.insert [.field "messages"]]) (adds := [msg 5])))

end AvenDB.Examples

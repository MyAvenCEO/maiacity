import AvenDB.Props
import AvenDB.Lens

/-!
# The plan's scenarios, run on the model

Each `#guard` replays part of an acceptance scenario from the plan and checks what the model says. They run on
every `lake build`, so a change to the model that breaks a scenario fails the build. The Rust scenario tests check
the same things against the real code.

A vault holds its entries directly. A cap selects a slice of them by type, author, entry id, creation time and tags,
and the cells, the sets of caps that select an entry alike, carry the keys. The model never moves an entry on its own:
a steward, a device acting for the vault, moves each entry to the cell its caps select (`desired`) with a `move` edit,
so a scenario includes the moves a steward would make, and checks that it has nothing left to do.
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

-- Entries: the coop's documents, Alice's todos and notes, a todo Bob creates, and avenCEO's status page.
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

-- Selectors.
def docs : Selector := .anyOf [[.typeIn [doc]]]
def notes : Selector := .anyOf [[.typeIn [note]]]
def todos : Selector := .anyOf [[.typeIn [todo]]]
def workTodos : Selector := .anyOf [[.typeIn [todo], .tagHas work]]
def homeTodos : Selector := .anyOf [[.typeIn [todo], .tagHas home]]
def urgentTodos : Selector := .anyOf [[.typeIn [todo], .tagHas urgent]]
def byId (e : EntryId) : Selector := .anyOf [[.entryIn [e]]]

/-- Cap `id` over vault `over`: vault `grantee` holds `role` on what `sel` selects, the whole vault (a wide cap) for
    `all`. A root cap, issued by the vault it is over, unless it rests on the owner cap `parent`, whose grantee
    `issuer` issues it. -/
def capOf (id : CapId) (over grantee : VaultId) (role : Role) (sel : Selector) (parent : Option CapId := none)
    (issuer : VaultId := over) : Cap :=
  { id, over, grantee := .principal (.vault grantee), role, wide := sel == .all, select := sel, ops := role.ops, parent,
    issuer }

/-- Cap `id` over vault `over`: everyone reads what `sel` selects. -/
def publicCap (id : CapId) (over : VaultId) (sel : Selector) : Cap :=
  { capOf id over over .read sel with grantee := .«public» }

/-- Vault `actor` creates entry `e` of vault `v`, of type `t` with tags `tags`, in cell `x`, through the cap `proof`
    names, if it isn't the vault. -/
def create (v : VaultId) (e : EntryId) (actor : VaultId) (x : Cell) (t : Sym) (tags : List Sym := [])
    (via : List VaultId := []) (proof : Option CapId := none) : Action :=
  .write v e actor none 0 (via := via) (create := some (x, ⟨t, 0⟩)) (tags := { add := tags }) (proof := proof)

/-- Edits in sequence: each builds on the one before, ids count from `start`. -/
def chain (start : Nat) (steps : List (SignerId × List SignerId × Action)) : List Edit :=
  (steps.zipIdx start).map fun ((author, co, a), i) => { id := i, depth := i, author, cosigners := co, action := a }

/-- The edit a scenario tries next, to see whether it would be accepted. -/
def attempt (author : SignerId) (co : List SignerId) (a : Action) : Edit :=
  { id := 9999, depth := 9999, author, cosigners := co, action := a }

def accepted (edits : List Edit) (edit : Edit) : Bool := (step (view edits) edit).isSome

/-- Device `d` opens the current key of family `k`, in what a peer holding `edits` knows. -/
def opens' (edits : List Edit) (d : SignerId) (k : KeyFam) : Bool :=
  let st := view edits
  knows st [.signer d] (st.curKey k)

/-- The entries device `d` reads now, in what a peer holding `edits` knows: it opens the current key of the entry's
    cell, and the entry's key in its current stay at that cell's generation. -/
def readable (edits : List Edit) (d : SignerId) : List EntryId :=
  let st := view edits
  (st.entries.filter fun en =>
    knows st [.signer d] (st.curKey (.cell en.vault en.cell)) && knows st [.signer d] (entryKey st en)).map (·.id)

def reads (edits : List Edit) (d : SignerId) (e : EntryId) : Bool := (readable edits d).contains e

/-- The entries vault `a` may write, by the rule every peer checks. -/
def writable (edits : List Edit) (a : VaultId) : List EntryId :=
  let st := view edits
  (st.entries.filter (mayWrite st a)).map (·.id)

/-- The cell entry `e` is in. -/
def cellOf (edits : List Edit) (e : EntryId) : Cell := ((view edits).entry? e).elim [] (·.cell)

/-- What a steward does with entry `e`: nothing (`none`), or move it to the cell its caps select. -/
def upkeep (edits : List Edit) (e : EntryId) : Option Cell := let st := view edits; (st.entry? e).bind (desired st)

/-- Every entry is in the cell its caps select: a steward has nothing left to do. -/
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
  (passkeyA, [macA], .addDevice alice macA),
  (passkeyA, [phoneA], .addDevice alice phoneA)]
#guard refused s1 == []

#guard ((view s1).vault? alice).map (·.devices) == some [macA, phoneA]
-- the vault key opens on both devices, and with the key derived from the passkey alone
#guard opens' s1 macA (.seed alice) && opens' s1 phoneA (.seed alice) && opens' s1 passkeyA (.seed alice)
-- the Mac acts for Alice's vault but can't add a device on its own
#guard actsFor (view s1) macA alice
#guard !accepted s1 (attempt macA [77] (.addDevice alice 77))
#guard accepted s1 (attempt passkeyA [77] (.addDevice alice 77))
-- a device can't be added without its own signature
#guard !accepted s1 (attempt passkeyA [] (.addDevice alice 77))
-- only the root hands the root on, and the new root signs
#guard accepted s1 (attempt passkeyA [77] (.setRoot alice (some 77) []))
#guard !accepted s1 (attempt passkeyA [] (.setRoot alice (some 77) []))
#guard !accepted s1 (attempt macA [77] (.setRoot alice (some 77) []))
-- the root signs the genesis that names it
#guard !accepted [] (attempt passkeyA [] (.genesis alice .human [.signer passkeyA] 1 (some 77)))

def s2 : List Edit := s1 ++ chain 10 [
  (passkeyB, [], .genesis bob .human [.signer passkeyB] 1 (some passkeyB)),
  (passkeyB, [macB], .addDevice bob macB),
  (passkeyC, [], .genesis carol .human [.signer passkeyC] 1 (some passkeyC)),
  (passkeyC, [macC], .addDevice carol macC),
  (passkeyD, [], .genesis dave .human [.signer passkeyD] 1 (some passkeyD)),
  (passkeyD, [macD], .addDevice dave macD)]
#guard refused s2 == []

-- a second passkey joins Alice's vault at threshold 2; the root still approves alone, the other passkey doesn't
def twoKeys : List Edit := s1 ++ chain 140 [
  (passkeyA, [77], .addOwner alice (.signer 77)),
  (passkeyA, [], .setThreshold alice 2)]
#guard refused twoKeys == []
#guard accepted twoKeys (attempt passkeyA [78] (.addDevice alice 78))
#guard !accepted twoKeys (attempt 77 [78] (.addDevice alice 78))
-- a coop has no root
#guard !accepted s2 (attempt passkeyA [passkeyB] (.genesis coop .coop [.vault alice, .vault bob] 2 (some passkeyA)))

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
#guard !accepted s3 (attempt passkeyA [passkeyB] (.addOwner coop (.vault coop)))
#guard !accepted s3 (attempt passkeyA [passkeyD] (.addOwner coop (.vault dave)))
#guard accepted s3 (attempt passkeyA [passkeyB, passkeyD] (.addOwner coop (.vault dave)))
-- with nothing shared yet, Alice's Mac sends Bob's Mac the coop's log, Carol's Mac nothing of it, a stranger nothing
#guard (respond s3 macB).any (·.log? == some (.vault coop))
#guard (respond s3 macC).all (·.log? != some (.vault coop)) && (respond s3 stranger).isEmpty

/-! ## Three kinds of vault

The vault is the identity. A human vault is owned by its person's passkeys, and its devices act for it. A coop vault
is owned by human and coop vaults. avenCEO, the relay server's vault, is an aven vault: owned by human and coop vaults
like a coop, with devices of its own, its servers, which act for it but never govern it. No signer owns a coop or an
aven vault directly. -/

def avenCEO := 300
def server := 600

def sAven : List Edit := s3 ++ chain 400 [
  (passkeyA, [], .genesis avenCEO .aven [.vault alice] 1),
  (passkeyA, [server], .addDevice avenCEO server)]
#guard refused sAven == []

-- the server acts for avenCEO, and so do Alice's devices, through Alice's vault; Bob's don't
#guard actsFor (view sAven) server avenCEO && actsFor (view sAven) macA avenCEO && !actsFor (view sAven) macB avenCEO
-- avenCEO's key opens on the server and on Alice's devices; Alice's vault's key doesn't open on the server
#guard opens' sAven server (.seed avenCEO) && opens' sAven phoneA (.seed avenCEO)
#guard !opens' sAven server (.seed alice) && !opens' sAven macB (.seed avenCEO)
-- the server doesn't govern avenCEO: it adds no device and no owner; Alice's passkey does, through Alice's vault
#guard !accepted sAven (attempt server [77] (.addDevice avenCEO 77))
#guard !accepted sAven (attempt server [passkeyB] (.addOwner avenCEO (.vault bob)))
#guard accepted sAven (attempt passkeyA [77] (.addDevice avenCEO 77))
#guard accepted sAven (attempt passkeyA [passkeyB] (.addOwner avenCEO (.vault bob)))
-- signers own human vaults only, and a human vault no vault
#guard !accepted s2 (attempt passkeyA [] (.genesis avenCEO .aven [.signer passkeyA] 1))
#guard !accepted s2 (attempt passkeyA [passkeyB] (.genesis coop .coop [.signer passkeyA, .vault bob] 1))
#guard !accepted sAven (attempt passkeyA [77] (.addOwner avenCEO (.signer 77)))
#guard !accepted s3 (attempt passkeyA [passkeyB] (.addOwner alice (.vault bob)))
-- an aven vault owns no vault yet, and has no root; a coop has no devices
#guard !accepted sAven (attempt passkeyA [passkeyB] (.addOwner coop (.vault avenCEO)))
#guard !accepted sAven (attempt passkeyA [] (.genesis 301 .coop [.vault avenCEO] 1))
#guard !accepted s2 (attempt passkeyA [] (.genesis avenCEO .aven [.vault alice] 1 (some passkeyA)))
#guard !accepted s3 (attempt passkeyA [passkeyB, 77] (.addDevice coop 77))

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
-- the server creates an entry for avenCEO directly, Alice's Mac through Alice's vault
#guard accepted sAven (attempt server [] (create avenCEO status avenCEO [] note))
#guard accepted sAven (attempt macA [] (create avenCEO status avenCEO [] note (via := [alice])))
#guard !accepted sAven (attempt macA [] (create avenCEO status avenCEO [] note))

-- a coop of the coop: Bob's Mac acts for it through the coop and Bob's vault, and may skip neither
def guild := 203
def sGuild : List Edit := s3 ++ chain 410 [(passkeyA, [passkeyB], .genesis guild .coop [.vault coop] 1)]
#guard refused sGuild == []
#guard accepted sGuild (attempt macB [] (create guild welcome guild [] doc (via := [coop, bob])))
#guard !accepted sGuild (attempt macB [] (create guild welcome guild [] doc (via := [bob])))
#guard !accepted sGuild (attempt macB [] (create guild welcome guild [] doc (via := [coop])))

/-! ## Scenarios 4 to 7: entries, writes, one document via a cap, public

The coop's Handbook is the coop's documents, in its vault. An entry no cap selects is in the cell of no caps, which
only the vault reads. A cap moves nothing by itself: a steward, a device acting for the coop, moves each entry to the
cell its caps select, and creates a new one straight there. -/

def s4 : List Edit := s3 ++ chain 30 [
  (macA, [], create coop welcome coop [] doc (via := [alice])),
  (macA, [], create coop onboarding coop [] doc (via := [alice]))]
#guard refused s4 == [] && tidy s4

-- both are in the cell of no caps: Bob's Mac reads them through the coop; Carol and a stranger can't
#guard cellOf s4 welcome == [] && readable s4 macB == [welcome, onboarding]
#guard readable s4 macC == [] && readable s4 stranger == []
-- Bob's Mac receives Welcome's log, Carol's Mac doesn't
#guard (respond s4 macB).any (entryLog? · == some welcome) && !(respond s4 macC).any (entryLog? · == some welcome)

def s5 : List Edit := s4 ++ chain 40 [
  (macB, [], .write coop welcome coop none 0 [30] (via := [bob]))]
#guard refused s5 == []

-- a write names a stay its entry has been in, at a generation that stay's cell has reached
#guard !accepted s5 (attempt macB [] (.write coop welcome coop (some 77) 0 [40] (via := [bob])))
#guard !accepted s5 (attempt macB [] (.write coop welcome coop none 1 [40] (via := [bob])))
-- and builds only on writes of its own entry
#guard !accepted s5 (attempt macB [] (.write coop onboarding coop none 0 [40] (via := [bob])))

def s6 : List Edit := s5 ++ chain 50 [
  (macA, [], .cap (capOf 1 coop carol .read (byId welcome)) [alice]),
  -- a steward, acting for the coop, moves Welcome to the cell of that cap
  (macA, [], .move coop welcome [1] [30, 40] [alice])]
#guard refused s6 == [] && tidy s6

-- the cap alone moves nothing: Carol reads Welcome only once a steward has moved it
#guard upkeep s6.dropLast welcome == some [1] && !reads s6.dropLast macC welcome
#guard readable s6 macC == [welcome] && cellOf s6 welcome == [1]
-- she reads its whole history, written before her cap: the move linked its old key to the new one
#guard knows (view s6) [.signer macC] (.entry welcome none 0)
-- she can't edit it, and Bob's Mac still reads both documents
#guard !accepted s6 (attempt macC [] (.write coop welcome carol (some 51) 0 [40]))
#guard readable s6 macB == [welcome, onboarding]
-- a cap naming a device is refused (T4)
#guard !accepted s6 (attempt macA [] (.cap { capOf 2 coop carol .read (byId welcome) with
                                              grantee := .principal (.signer macC) } [alice]))

def s7 : List Edit := s6 ++ chain 60 [
  (macA, [], .cap (publicCap 3 coop (byId charter)) [alice]),
  -- a steward creates Charter straight in the cell its cap selects
  (macA, [], create coop charter coop [3] doc (via := [alice]))]
#guard refused s7 == [] && tidy s7

-- anyone opens Charter, and nothing else; Public can't be given write (T8)
#guard readable s7 stranger == [charter]
#guard !accepted s7 (attempt macA [] (.cap { publicCap 4 coop (byId charter) with role := .write } [alice]))

/-! ## Slices: caps select entries, cells carry the keys

Alice's vault holds her todos and her notes directly, each made in the cell of no caps. She shares with Bob all her
todos, or only those tagged work, or one note by its id. Her Mac, a steward, then moves each entry to the cell its caps
select, and Bob reads exactly what his cap selects, and writes only where it has write. -/

def lib : List Edit := s2 ++ chain 500 [
  (macA, [], create alice door alice [] todo [work]),
  (macA, [], create alice seeds alice [] todo [home]),
  (macA, [], create alice solar alice [] todo [work]),
  (macA, [], create alice plan alice [] note [work]),
  (macA, [], create alice diary alice [] note)]
-- no cap selects them yet: they are in the cell of no caps, and Bob reads none of them
#guard refused lib == [] && tidy lib && readable lib macB == []

-- all of Alice's todos, read: the cap alone moves nothing, a steward has three todos to move into its cell
def allTodos : List Edit := lib ++ chain 510 [(macA, [], .cap (capOf 31 alice bob .read todos))]
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
  (macA, [], .cap (capOf 32 alice bob .write workTodos)),
  (macA, [], .move alice door [32] [500]),
  (macA, [], .move alice solar [32] [502])]
-- moved, Bob reads and writes the two todos tagged work, not the one tagged home nor the note tagged work
#guard refused workShare == [] && tidy workShare
#guard readable workShare macB == [door, solar] && writable workShare bob == [door, solar]
#guard accepted workShare (attempt macB [] (.write alice door bob (some 511) 0 [500]))
#guard !accepted workShare (attempt macB [] (.write alice seeds bob none 0 [501]))

-- one note, by its id, write
def onePlan : List Edit := lib ++ chain 510 [
  (macA, [], .cap (capOf 33 alice bob .write (byId plan))),
  (macA, [], .move alice plan [33] [503])]
-- moved, Bob reads and writes that note alone
#guard refused onePlan == [] && tidy onePlan
#guard readable onePlan macB == [plan] && writable onePlan bob == [plan]
#guard accepted onePlan (attempt macB [] (.write alice plan bob (some 511) 0 [503]))
#guard !accepted onePlan (attempt macB [] (.write alice diary bob none 0 [504]))

-- a cell is the set of caps that select its entries alike: Carol writes all of Alice's todos and Bob the ones tagged
-- work, so the two work todos share a cell of both caps, and the other todo is in Carol's alone
def shared : List Edit := lib ++ chain 510 [
  (macA, [], .cap (capOf 31 alice carol .write todos)),
  (macA, [], .cap (capOf 32 alice bob .write workTodos)),
  (macA, [], .move alice door [31, 32] [500]),
  (macA, [], .move alice seeds [31] [501]),
  (macA, [], .move alice solar [31, 32] [502])]
-- moved, Bob reads and writes the two work todos, Carol all three
#guard refused shared == [] && tidy shared
#guard [door, seeds, solar, plan, diary].map (cellOf shared) == [[31, 32], [31], [31, 32], [], []]
#guard readable shared macB == [door, solar] && writable shared bob == [door, solar]
#guard readable shared macC == [door, seeds, solar] && writable shared carol == [door, seeds, solar]

/-! ## Retagging moves an entry out of a slice

Only the vault's own devices change tags. Alice takes the work tag off the solar todo: Bob's cap no longer selects it,
and her Mac moves it to the cell of no caps. From the move on, Bob writes it no more, nor opens its new key, while he
keeps what he could read up to the move. -/

def retag : List Edit := workShare ++ chain 520 [
  (macA, [], .write alice solar alice (some 512) 0 [502] (tags := { remove := [work] }))]
-- Alice's tag counts: the todo leaves Bob's slice, and a steward has it to move to the cell of no caps
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
-- Bob opens neither the key solar has now nor its cell's, but still the key of its stay before the move, and so
-- everything written up to the move
#guard !opens' retag' macB (.cell alice [])
#guard ((view retag').entry? solar).any fun en => !knows (view retag') [.signer macB] (entryKey (view retag') en)
#guard knows (view retag') [.signer macB] (.entry solar (some 512) 0)
#guard knows (view retag') [.signer macB] (.entry solar none 0)

/-! ## Creating through a cap

A writer that isn't a steward sees no other cap, so it can't work out where a new entry belongs: it creates it in its
cap's intake cell, the cell of its cap's chain, which only those caps' grantees and the vault read. Every peer checks
only that; whether the entry lies in the writer's slice (`admits`, the entry's `admitted`) only the stewards can tell,
and one moves it on to its semantic cell. -/

-- Bob creates the lamp todo, tagged work, in his cap's intake cell, and nowhere else
def intake : List Edit := shared ++ chain 520 [(macB, [], create alice lamp bob [32] todo [work] (proof := some 32))]
#guard refused intake == []
#guard !accepted shared (attempt macB [] (create alice lamp bob [] todo [work]))
#guard !accepted shared (attempt macB [] (create alice lamp bob [31, 32] todo [work]))
-- it lies in his slice; Carol's cap selects it too, but she reads it only once a steward has moved it
#guard admits (view shared) bob alice [32] ⟨todo, bob, lamp, 0, [work]⟩ (some 32)
#guard ((view intake).entry? lamp).map (·.admitted) == some true
#guard upkeep intake lamp == some [31, 32] && !reads intake macC lamp && reads intake macB lamp
def intake' : List Edit := intake ++ chain 521 [(macA, [], .move alice lamp [31, 32] [520])]
-- moved, Carol reads it too, and Bob still reads and writes it
#guard refused intake' == [] && tidy intake'
#guard reads intake' macC lamp && reads intake' macB lamp && (writable intake' bob).contains lamp

-- a note Bob makes in the same cell is accepted too, but lies outside his slice: a steward moves it to the cell of no
-- caps, where only Alice reads it, keeping what Bob wrote
def outside : List Edit := shared ++ chain 520 [(macB, [], create alice lamp bob [32] note [work] (proof := some 32))]
#guard refused outside == []
#guard !admits (view shared) bob alice [32] ⟨note, bob, lamp, 0, [work]⟩ (some 32)
#guard ((view outside).entry? lamp).map (·.admitted) == some false && upkeep outside lamp == some []
def outside' : List Edit := outside ++ chain 521 [(macA, [], .move alice lamp [] [520])]
-- moved, Bob neither reads nor writes it, and it stays
#guard refused outside' == [] && tidy outside'
#guard !reads outside' macB lamp && reads outside' macA lamp && !(writable outside' bob).contains lamp
#guard ((view outside').entry? lamp).isSome

/-! ## A cap resting on a cap

An owner may share its slice on: a cap resting on an owner cap is issued by that cap's grantee, and grants only what
every cap of its chain selects (T22). Alice makes Carol owner of her todos, a governance act, and Carol gives Dave the
home todos and, claiming more than she holds, the notes. Revoking Carol's cap ends both. -/

def resting : List Edit := lib ++ chain 540 [
  (passkeyA, [], .cap (capOf 41 alice carol .owner todos)),
  (macC, [], .cap (capOf 42 alice dave .read homeTodos (parent := some 41) (issuer := carol))),
  (macC, [], .cap (capOf 43 alice dave .read notes (parent := some 41) (issuer := carol)))]
#guard refused resting == []

-- a device alone can't make anyone owner, and only the grantee of an owner cap issues on it
#guard !accepted lib (attempt macA [] (.cap (capOf 41 alice carol .owner todos)))
#guard !accepted resting (attempt macB [] (.cap (capOf 44 alice bob .read todos (parent := some 41) (issuer := bob))))
#guard !accepted resting (attempt macD [] (.cap (capOf 44 alice bob .read todos (parent := some 42) (issuer := dave))))
-- a wide cap rests only on a wide one; an owner cap resting on Carol's takes her own approval
#guard !accepted resting (attempt macC [] (.cap (capOf 44 alice dave .read .all (parent := some 41) (issuer := carol))))
#guard !accepted resting (attempt macC [] (.cap (capOf 44 alice dave .owner homeTodos (some 41) carol)))
#guard accepted resting (attempt passkeyC [] (.cap (capOf 44 alice dave .owner homeTodos (some 41) carol)))
-- Dave's slices are what every cap of their chain selects: the todo tagged home, and no note at all
#guard ((view resting).cap? 42).any fun c =>
  (view resting).entries.map (effSelects (view resting) c ·.attrs) == [false, true, false, false, false]
#guard ((view resting).cap? 43).any fun c => !(view resting).entries.any (effSelects (view resting) c ·.attrs)
#guard [door, seeds, solar, plan, diary].map (upkeep resting) == [some [41], some [41, 42], some [41], none, none]
def resting' : List Edit := resting ++ chain 550 [
  (macA, [], .move alice door [41] [500]),
  (macA, [], .move alice seeds [41, 42] [501]),
  (macA, [], .move alice solar [41] [502])]
-- moved, Carol reads the todos, and Dave only the one tagged home
#guard refused resting' == [] && tidy resting'
#guard readable resting' macC == [door, seeds, solar] && readable resting' macD == [seeds]
-- Carol, who issued Dave's cap, and Dave, giving it up, may revoke it; Bob may not
#guard accepted resting' (attempt macC [] (.revoke 42 carol []))
#guard accepted resting' (attempt macD [] (.revoke 42 dave []))
#guard !accepted resting' (attempt macB [] (.revoke 42 bob []))
-- revoking Carol's owner cap is governance, and ends Dave's caps with it; no entry needs to move
def carolRevoked : List Edit := resting' ++ chain 560 [(passkeyA, [], .revoke 41 alice [540, 541, 542, 550, 551, 552])]
#guard refused carolRevoked == [] && tidy carolRevoked
#guard [41, 42, 43].all (!(view carolRevoked).live ·)
#guard readable carolRevoked macC == [] && readable carolRevoked macD == []

/-! ## Wide caps, Public, relays

A wide cap selects the whole vault, in the clear: it reaches every cell, and splits none, so issuing it moves
nothing. Alice gives Dave, her backup, a wide read cap, and everyone her plan; avenCEO, the server's vault, gets a wide
relay cap: its servers hold and pass on every entry of Alice's, and open no key of hers. -/

def wideCaps : List Edit := shared ++ chain 540 [
  (passkeyA, [], .genesis avenCEO .aven [.vault alice] 1),
  (passkeyA, [server], .addDevice avenCEO server),
  (macA, [], .cap (capOf 50 alice dave .read .all)),
  (macA, [], .cap (capOf 51 alice avenCEO .backup .all))]
-- a wide cap splits no cell: there is nothing to move
#guard refused wideCaps == [] && tidy wideCaps
-- Dave reads every entry, in every cell
#guard readable wideCaps macD == [door, seeds, solar, plan, diary]
-- the server receives every entry of Alice's, and Alice's Mac sends it their logs, but it reads none
#guard (view wideCaps).entries.all fun en => mayReceive (view wideCaps) server en.id
#guard [door, seeds, solar, plan, diary].all fun e => (respond wideCaps server).any (entryLog? · == some e)
#guard readable wideCaps server == []
-- everyone reads the plan, the server too, once a steward has moved it to the public cap's cell
def withPublic : List Edit := wideCaps ++ chain 544 [
  (macA, [], .cap (publicCap 52 alice (byId plan))),
  (macA, [], .move alice plan [52] [503])]
#guard refused withPublic == [] && tidy withPublic
#guard readable withPublic stranger == [plan] && readable withPublic server == [plan]
-- a relay, which reads no selector, type or tag, has the same edits stand and the entries in the same cells (T25)
#guard (standing (withPublic.map Edit.blind)).map (·.id) == (standing withPublic).map (·.id)
#guard (view (withPublic.map Edit.blind)).entries.map (·.cell) == (view withPublic).entries.map (·.cell)

/-! ## Scenario 8: proposals

Welcome's main line is its first write (30) and Bob's edit (40). Bob starts a proposal, draft, from it and edits there;
main stays as it was until Alice merges draft with a write on main that builds on both lines' heads. A second proposal,
rewrite, is promoted the same way while main moved on: what the promote's update holds is Loro's (`Proposals.lean`,
T10h). -/

def ops8 : List (SignerId × List SignerId × Action) := [
  (macB, [], .write coop welcome coop (some 51) 0 [40] .new [bob]),          -- 300: Bob starts draft from main
  (macB, [], .write coop welcome coop (some 51) 0 [300] (.on 300) [bob]),    -- 301: Bob's edit on draft
  (macA, [], .write coop welcome coop (some 51) 0 [40, 301] .main [alice]),  -- 302: Alice merges draft into main
  (macA, [], .write coop welcome coop (some 51) 0 [302] .new [alice]),       -- 303: Alice starts rewrite from main
  (macA, [], .write coop welcome coop (some 51) 0 [303] (.on 303) [alice]),  -- 304: an edit on rewrite
  (macB, [], .write coop welcome coop (some 51) 0 [302] .main [bob]),        -- 305: main moves on meanwhile
  (macA, [], .write coop welcome coop (some 51) 0 [305, 304] .main [alice])] -- 306: Alice promotes rewrite
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
-- rewrite starts from the merged main; main moves on without it until the promote
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

/-! ## Scenario 9: schema v2

The coop moves its documents to schema v2. Alice's Mac, acting for the coop, publishes the v2 schema and the lens from
v1 into the coop's schema lane, one per vault. Carol may write Onboarding but not publish there. -/

def schemaV2 : BlobId := 1
def lensV1V2 : BlobId := 2

def s9 : List Edit := s7 ++ chain 65 [
  (macA, [], .cap (capOf 5 coop carol .write (byId onboarding)) [alice]),
  (macA, [], .move coop onboarding [5] [31] [alice]),
  (macA, [], .publish coop coop schemaV2 [alice]),
  (macA, [], .publish coop coop lensV1V2 [alice]),
  -- Dave's own vault moves to v2 too: the same blob, in another vault's lane
  (macD, [], .publish dave dave schemaV2)]
#guard refused s9 == []

#guard (view s9).lane == [(coop, schemaV2), (coop, lensV1V2), (dave, schemaV2)]
-- the same blob again is refused; Bob's Mac acts for the coop too, through Bob's vault, and may publish another
#guard !accepted s9 (attempt macA [] (.publish coop coop schemaV2 [alice]))
#guard accepted s9 (attempt macB [] (.publish coop coop 3 [bob]))
-- Carol writes Onboarding, but publishes into the coop's lane neither for herself nor for the coop, whose owner her
-- vault isn't; nor does a stranger
#guard accepted s9 (attempt macC [] (.write coop onboarding carol (some 66) 0 [31]))
#guard !accepted s9 (attempt macC [] (.publish coop carol 3))
#guard !accepted s9 (attempt macC [] (.publish coop coop 3 [carol]))
#guard !accepted s9 (attempt stranger [] (.publish coop coop 3))
-- a vault holding a wide owner cap over the coop publishes into its lane; an owner cap on a slice doesn't
def daveOwns (sel : Selector) : List Edit := s9 ++ chain 70 [
  (passkeyA, [passkeyB], .cap (capOf 6 coop dave .owner sel) [alice])]
#guard refused (daveOwns .all) == [] && refused (daveOwns docs) == []
#guard ownsLane (view (daveOwns .all)) dave coop && !ownsLane (view (daveOwns docs)) dave coop
#guard accepted (daveOwns .all) (attempt macD [] (.publish coop dave 3))
#guard !accepted (daveOwns docs) (attempt macD [] (.publish coop dave 3))
-- a vault's lane travels with its log: Carol's Mac receives the coop's, through her caps, and so does anyone, through
-- the public Charter; Dave's goes to his own devices, and not to Carol's Mac, as nothing she receives names his vault
#guard [macC, stranger].all fun d => (respond s9 d).any (·.action == .publish coop coop schemaV2 [alice])
#guard (respond s9 macD).any (·.action == .publish dave dave schemaV2)
#guard !(respond s9 macC).any (·.action == .publish dave dave schemaV2)

/-- Welcome as an app still on v1 wrote it: v1's fields only. -/
def welcomeV1 : Lens.StoredDoc := { title := "Welcome", blocks := [
  { id := 1, text := "Welcome", kind := some .h1 },
  { id := 2, text := "The greenhouse opens at eight.", kind := some .p },
  { id := 3, text := "Water the seedlings", kind := some .li }] }

/-- A v2 app makes the second block a heading and tags the document. -/
def welcomeV2 : Lens.StoredDoc :=
  let v := welcomeV1.v2
  welcomeV1.putV2 { v with
    blocks := v.blocks.map fun b => if b.id == 2 then { b with type := .heading, level := some 2 } else b,
    tags := ["greenhouse"] }

-- a v1 app reads every other block exactly as before, and the heading through the lens
#guard welcomeV2.v1.blocks.filter (·.id != 2) == welcomeV1.v1.blocks.filter (·.id != 2)
#guard welcomeV2.v1.blocks.find? (·.id == 2) ==
  some { id := 2, kind := .h2, text := "The greenhouse opens at eight." }
-- nothing was written to the other blocks: none of them gained `checked`, `lang`, `type` or `level`
#guard welcomeV2.blocks.filter (·.id != 2) == welcomeV1.blocks.filter (·.id != 2)
#guard (welcomeV2.blocks.filter (·.id != 2)).all fun b =>
  b.checked.isNone && b.lang.isNone && b.type.isNone && b.level.isNone
-- the heading holds v2's representation now, and the document its tag, which a v1 app's edit keeps
#guard (welcomeV2.blocks.find? (·.id == 2)).map (fun b => (b.kind, b.type, b.level)) ==
  some (none, some .heading, some 2)
#guard welcomeV2.v2.tags == ["greenhouse"]
#guard (welcomeV2.putV1 { welcomeV2.v1 with title := "Welcome!" }).tags == ["greenhouse"]

/-! ## Scenario 10: revoking a cap rotates the cells it was in

The cells the revoked cap was in move to a new generation, whose key only their remaining caps get. The revoked cap
stays in the cell: only the live part of a cell has to be its semantic cell, so a revocation moves no entry. -/

def s10 : List Edit := s7 ++ chain 80 [(macA, [], .revoke 1 coop [] [alice])]
#guard refused s10 == []

-- Welcome's cell moves on: Carol doesn't open its new generation, Bob does, and Welcome stays where it is
#guard (view s10).epochOf (.cell coop [1]) == (view s7).epochOf (.cell coop [1]) + 1
#guard !reads s10 macC welcome && reads s10 macB welcome
#guard cellOf s10 welcome == [1] && upkeep s10 welcome == none
-- Carol keeps what she could read before
#guard knows (view s10) [.signer macC] (.scoped (.cell coop [1]) 0)

-- Alice revokes Bob's write on her work todos: their cell moves on, the others' don't, and Bob opens nothing new,
-- though no entry moves
def unshared : List Edit := shared ++ chain 530 [(macA, [], .revoke 32 alice [500, 501, 502, 510, 511, 512, 513, 514])]
#guard refused unshared == [] && tidy unshared && cellOf unshared door == [31, 32]
#guard (keyFams (view unshared)).all fun k =>
  (view unshared).epochOf k == (view shared).epochOf k + if k == .cell alice [31, 32] then 1 else 0
#guard readable unshared macB == [] && readable unshared macC == [door, seeds, solar]
#guard knows (view unshared) [.signer macB] (.scoped (.cell alice [31, 32]) 0)

/-! ## Scenario 11: a lost iPhone rotates everything it could reach

A vault's cap and cell keys derive from its seed, so when the seed moves on they all do. -/

def s11 : List Edit := s7 ++ chain 90 [(passkeyA, [], .removeDevice alice phoneA [])]
#guard refused s11 == []

-- the iPhone opens neither vault key nor Welcome any more, which Alice's Mac and Bob's still read; nor does it write
#guard !opens' s11 phoneA (.seed alice) && !opens' s11 phoneA (.seed coop)
#guard !reads s11 phoneA welcome && reads s11 macA welcome && reads s11 macB welcome
#guard !accepted s11 (attempt phoneA [] (.write coop welcome coop (some 51) 1 [40] (via := [alice])))
-- Alice's seed and the coop's, which it reached through Alice's, move on, and every cap and cell key of both vaults
#guard (keyFams (view s11)).all fun k =>
  (view s11).epochOf k == (view s7).epochOf k + if k.vault == alice || k.vault == coop then 1 else 0

-- the same in Alice's own vault, where Bob and Carol hold caps: every key of hers moves on, theirs don't
def lostPhone : List Edit := shared ++ chain 530 [(passkeyA, [], .removeDevice alice phoneA [])]
#guard refused lostPhone == []
#guard (keyFams (view lostPhone)).all fun k =>
  (view lostPhone).epochOf k == (view shared).epochOf k + if k.vault == alice then 1 else 0
#guard readable lostPhone phoneA == [] && readable lostPhone macB == [door, solar]

/-! ## Scenario 12: Bob leaves the coop on his own -/

def s12 : List Edit := s7 ++ chain 95 [(passkeyB, [], .removeOwner coop (.vault bob) [40])]
#guard refused s12 == []

#guard ((view s12).vault? coop).map (·.threshold) == some 1
#guard !opens' s12 macB (.seed coop) && !reads s12 macB welcome
-- Bob's earlier edit stays, as his leaving names it
#guard (view s12).writes.length == (view s7).writes.length
-- what Bob's Mac wrote for the coop through Bob's vault on a copy that hadn't seen him leave is cut
def bobLeft : List Edit := s12 ++ offline 98 61 [(macB, [], .write coop welcome coop (some 51) 0 [40] (via := [bob]))]
#guard refused bobLeft == [98]
#guard !accepted s12 (attempt macB [] (.write coop welcome coop (some 51) 0 [40] (via := [bob])))

/-! ## Scenarios 15 and 16: one todo, many vaults, changing roles -/

def s15 : List Edit := s3 ++ chain 100 [
  (macA, [], create alice door alice [] todo [work]),
  (macA, [], create alice seeds alice [] todo [home]),
  (macA, [], create alice solar alice [] todo [work]),
  (macA, [], .cap (capOf 10 alice bob .write (byId door))),
  (macA, [], .cap (capOf 11 alice carol .read (byId door))),
  -- making the coop owner of the todo is governance: Alice's passkey
  (passkeyA, [], .cap (capOf 12 alice coop .owner (byId door))),
  (macA, [], .move alice door [10, 11, 12] [100])]
#guard refused s15 == [] && tidy s15

-- a device alone can't make anyone owner
#guard !accepted s15 (attempt macA [] (.cap (capOf 13 alice coop .owner (byId door))))
#guard accepted s15 (attempt macB [] (.write alice door bob (some 106) 0 [100]))
#guard !accepted s15 (attempt macC [] (.write alice door carol (some 106) 0 [100]))
#guard reads s15 macC door && !reads s15 macC seeds
#guard !reads s15 macB solar

def s16a : List Edit := s15 ++ chain 110 [
  -- acting for the coop, through Bob's vault, Bob gives Dave read
  (macB, [], .cap (capOf 14 alice dave .read (byId door) (parent := some 12) (issuer := coop)) [bob]),
  -- Alice raises Carol to write and takes Bob's own write away
  (macA, [], .cap (capOf 15 alice carol .write (byId door))),
  (macA, [], .revoke 10 alice [100, 106])]
#guard refused s16a == []

-- Bob still reaches the todo through the coop, so its cell's key didn't rotate
#guard entitled (view s16a) macB (.cell alice [10, 11, 12])
#guard (view s16a).epochOf (.cell alice [10, 11, 12]) == (view s15).epochOf (.cell alice [10, 11, 12])
-- the new caps reach the todo once a steward has moved it, which drops the revoked cap from its cell
#guard upkeep s16a door == some [11, 12, 14, 15] && !reads s16a macD door
def s16b : List Edit := s16a ++ chain 113 [(macA, [], .move alice door [11, 12, 14, 15] [100])]
#guard refused s16b == [] && tidy s16b
-- moved, Dave reads the todo and Carol writes it; Bob writes it only for the coop
#guard reads s16b macD door && accepted s16b (attempt macC [] (.write alice door carol (some 113) 0 [100]))
#guard !accepted s16b (attempt macB [] (.write alice door bob (some 113) 0 [100]))
#guard accepted s16b (attempt macB [] (.write alice door coop (some 113) 0 [100] (via := [bob])))

def s16 : List Edit := s16b ++ chain 120 [
  -- taking the coop's owner cap away is governance, and ends the read Bob gave Dave, which Alice had seen
  (passkeyA, [], .revoke 12 alice [110])]
#guard refused s16 == [] && tidy s16

-- Dave's cap ended with the coop's; neither Bob nor Dave may open the todo's cell, which moves on
#guard !(view s16).live 14
#guard [macB, macD].all fun d => !entitled (view s16) d (.cell alice [11, 12, 14, 15])
#guard (view s16).epochOf (.cell alice [11, 12, 14, 15]) == (view s16b).epochOf (.cell alice [11, 12, 14, 15]) + 1
-- Bob and Dave read the todo no more, Carol and Alice still do; Bob no longer writes it for the coop
#guard !reads s16 macB door && !reads s16 macD door
#guard reads s16 macC door && reads s16 macA door
#guard !accepted s16 (attempt macB [] (.write alice door coop (some 113) 1 [100] (via := [bob])))

/-! ## Keys edits carry only the boxes the schedule seals -/

-- Alice's Mac boxes Welcome's key to its cell's key, and Carol's cap key to Carol's vault key; Dave's Mac, which can't
-- open Welcome's key, can't box it
#guard accepted s6 (attempt macA [] (.keys (.entry welcome (some 51) 0) [.scoped (.cell coop [1]) 0]))
#guard accepted s6 (attempt macA [] (.keys (.scoped (.cap coop 1) 0) [.scoped (.seed carol) 0]))
#guard !accepted s6 (attempt macD [] (.keys (.entry welcome (some 51) 0) []))
-- Carol may pass on the boxes of what she reads
#guard accepted s6 (attempt macC [] (.keys (.scoped (.cell coop [1]) 0) [.scoped (.cap coop 1) 0]))
-- a box the schedule doesn't seal is refused, and so is a key of a generation that doesn't exist yet
#guard !accepted s6 (attempt macA [] (.keys (.entry welcome (some 51) 0) [.signer macD]))
#guard !accepted s6 (attempt macA [] (.keys (.entry welcome (some 51) 1) []))
#guard !accepted s6 (attempt macA [] (.keys (.scoped (.cell coop [1]) 1) []))
-- only a public key is published
#guard !accepted s6 (attempt macA [] (.keys (.scoped (.cell coop [1]) 0) [] true))
#guard accepted s7 (attempt macA [] (.keys (.scoped (.cell coop [3]) 0) [] true))

/-! ## A coop that stops reading rotates the key, though its members still read

Alice's second coop reads her notes, then stops. Alice still reads them as their vault, but the coop's key would carry
the notes' cell key to whoever joins the coop later, so the cell moves on. Bob joins and opens only the old generation:
a vault's newcomers inherit what it could read. -/

def coop2 := 202
def gap : List Edit := s3 ++ chain 190 [
  (passkeyA, [], .genesis coop2 .coop [.vault alice] 1),
  (macA, [], create alice plan alice [] note),
  (macA, [], .cap (capOf 20 alice coop2 .read notes)),
  (macA, [], .move alice plan [20] [191]),
  (macA, [], .revoke 20 alice []),
  (passkeyA, [passkeyB], .addOwner coop2 (.vault bob))]
#guard refused gap == [] && tidy gap

-- the notes' cell moves on: Alice opens its new generation, Bob, now in the coop, only the one before
#guard (view gap).epochOf (.cell alice [20]) == 1
#guard !opens' gap macB (.cell alice [20]) && opens' gap macA (.cell alice [20])
#guard knows (view gap) [.signer macB] (.scoped (.cell alice [20]) 0)

/-! ## A cell that comes back into use moves on

Bob reads Alice's urgent todos. The seeds todo is urgent for a while, then not, and Bob loses his Mac while no entry is
in that cell, so its key doesn't move on with his seed's. When the seeds todo is urgent again, the cell moves to a new
generation, which the lost Mac doesn't open. -/

def comeback (n : Nat := 8) : List Edit := lib ++ chain 600 ([
  (macA, [], .cap (capOf 34 alice bob .read urgentTodos)),
  (macA, [], .write alice seeds alice none 0 [501] (tags := { add := [urgent] })),
  (macA, [], .move alice seeds [34] [501, 601]),
  (macA, [], .write alice seeds alice (some 602) 0 [601] (tags := { remove := [urgent] })),
  (macA, [], .move alice seeds [] [501, 601, 603]),
  (passkeyB, [], .removeDevice bob macB []),
  (macA, [], .write alice seeds alice (some 604) 0 [603] (tags := { add := [urgent] })),
  (macA, [], .move alice seeds [34] [501, 601, 603, 606])].take n)
#guard refused (comeback) == [] && tidy (comeback)

-- Bob reads the seeds todo while it is urgent, and not after
#guard reads (comeback 3) macB seeds && !reads (comeback 5) macB seeds
-- while the cell was empty, Bob's seed and his cap's key moved on, the cell's key didn't
#guard (view (comeback 6)).epochOf (.cap alice 34) == 1 && (view (comeback 6)).epochOf (.cell alice [34]) == 0
#guard knows (view (comeback 6)) [.signer macB] (.scoped (.cell alice [34]) 0)
-- the seeds todo back in it, the cell moves on: Bob's passkey reads it, his lost Mac doesn't
#guard (view (comeback)).epochOf (.cell alice [34]) == 1
#guard reads (comeback) passkeyB seeds && !reads (comeback) macB seeds

-- an entry created in the empty cell brings it back into use too: its first write may name the generation the cell
-- moves to, which the lost Mac doesn't open, and no later one
def lampTodo (g : Nat) : Edit := attempt macA [] (.write alice lamp alice none g (create := some ([34], ⟨todo, 0⟩))
  (tags := { add := [urgent] }))
#guard reenters (view (comeback 6)) alice [34]
#guard accepted (comeback 6) (lampTodo 1) && !accepted (comeback 6) (lampTodo 2)
#guard ((step (view (comeback 6)) (lampTodo 1)).map fun st =>
  st.epochOf (.cell alice [34]) == 1 && !knows st [.signer macB] (.entry lamp none 1) &&
    knows st [.signer passkeyB] (.entry lamp none 1)) == some true
-- a cell in use, or one whose key was never sealed, has no generation ahead to name
#guard !reenters (view (comeback 3)) alice [34] && !reenters (view (comeback 6)) alice [34, 99]

/-! ## Scenario 17: each todo syncs on its own -/

-- Carol's Mac may receive the door todo and no other, and Alice's Mac answers it with that todo only
#guard [door, seeds, solar].map (mayReceive (view s15) macC) == [true, false, false]
#guard (respond s15 macC).any (entryLog? · == some door)
#guard (respond s15 macC).all fun o => (entryLog? o).all (· == door)
-- a device with no cap on it gets none of it
#guard (respond s15 stranger).all (entryLog? · == none)
-- after the coop lost the todo, Dave's Mac gets none of its edits, only the revocation that ended its read, as Bob's
-- Mac does for the coop's owner cap
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

/-! ## Linking a new device

A new device whose passkey proves itself on a connection is handed the logs of the vaults that passkey owns, as it
needs them to add itself to its vault, and nothing about any cap, cell or entry (T20). -/

-- Alice's passkey is handed her vault's log, Bob's his, a device key or a stranger's passkey nothing
#guard (linkCard s15 passkeyA).map (·.id) == [1, 2, 3]
#guard (linkCard s15 passkeyB).map (·.id) == [10, 11]
#guard linkCard s15 macA == [] && linkCard s15 stranger == []
-- with the card alone, Alice's passkey adds the new device
#guard accepted (linkCard s15 passkeyA) (attempt passkeyA [77] (.addDevice alice 77))

/-! ## Strong removal: a removal cuts what it hadn't seen

A device that was offline makes edits on its old copy of the log, so they sort before a removal made elsewhere in the
meantime. Each such edit stands only if it stands without what the removal took away. -/

-- a coop of Alice and Bob where either may act alone
def pair := 201
def sPair : List Edit := s2 ++ chain 140 [(passkeyA, [passkeyB], .genesis pair .coop [.vault alice, .vault bob] 1)]

-- Alice goes on, then removes Bob; Bob, offline since the coop began, adds Dave
def backdated (keep : List EditId) : List Edit := sPair ++ chain 141 [
  (passkeyA, [], .setThreshold pair 1),
  (passkeyA, [], .setThreshold pair 1),
  (passkeyA, [], .removeOwner pair (.vault bob) keep)] ++ offline 150 140 [
  (passkeyB, [passkeyD], .addOwner pair (.vault dave))]

-- the removal hadn't seen Bob's add, so it is cut; had it seen it, the add would stand
#guard refused (backdated []) == [150]
#guard ((view (backdated [])).vault? pair).map (·.owners) == some [.vault alice]
#guard refused (backdated [150]) == []
#guard ((view (backdated [150])).vault? pair).map (·.owners) == some [.vault alice, .vault dave]

-- the two remove each other at once, and Bob's sorts first: the senior owner stands
def clash : List Edit := sPair ++ [
  { id := 161, depth := 141, author := passkeyA, cosigners := [], action := .removeOwner pair (.vault bob) [] },
  { id := 160, depth := 141, author := passkeyB, cosigners := [], action := .removeOwner pair (.vault alice) [] }]
#guard ((order clash).map (·.id)).reverse.take 2 == [161, 160]
#guard refused clash == [160]
#guard ((view clash).vault? pair).map (·.owners) == some [.vault alice]

-- a thief holding Alice's second passkey removes the root's passkey from the owners and adds a device; the root,
-- having seen neither, removes the second passkey. It keeps the threshold it had set, which counted that passkey.
def stolen : List Edit :=
  twoKeys ++ chain 142 [(passkeyA, [], .removeOwner alice (.signer 77) [141])] ++ offline 170 141 [
    (77, [passkeyA], .removeOwner alice (.signer passkeyA) []),
    (77, [stranger], .addDevice alice stranger)]
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
  (macA, [], .revoke 10 alice [113]),
  (macC, [], .write alice door carol (some 106) 0 [113])]
#guard refused keptWriter == [115]
#guard (entryWrites (view keptWriter) door).map (·.edit) == [100, 113]

-- handing the root on to a new passkey, then retiring the old one, cuts what the old passkey signs on an old copy;
-- both keep what the old passkey approved before them, as every honest device's draft does
def handover : List Edit := s1 ++ chain 140 [
  (passkeyA, [77], .addOwner alice (.signer 77)),
  (passkeyA, [77], .setRoot alice (some 77) [2, 3, 140]),
  (77, [], .removeOwner alice (.signer passkeyA) [2, 3, 140])] ++ offline 150 140 [
  (passkeyA, [stranger], .addDevice alice stranger)]
#guard refused handover == [150]
#guard ((view handover).vault? alice).map (fun v => (v.owners, v.root)) == some ([.signer 77], some 77)
#guard !actsFor (view handover) stranger alice

/-! ## Moves are removals too

A move takes its entry out of every cap it leaves behind: a write the move hadn't seen stands only if its writer could
write in the cell the move took the entry to. Alice takes the work tag off the solar todo and her Mac moves it to
Carol's cell, while Bob and Carol, on copies that had seen neither, each write it. -/

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
than work, and her Mac moves it to the cell of Bob's urgent cap. Meanwhile her passkey, on a device that never received
the lamp, revokes that cap. Bob made the lamp through his work cap, which still holds, and every write is judged in the
cell it was written in, so the revocation takes nothing from the lamp: it stays, with Alice's write, and Bob writes it
no more. -/

def kept : List Edit := workShare ++ chain 520 [
  (macA, [], .cap (capOf 34 alice bob .write urgentTodos)),
  (macB, [], create alice lamp bob [32] todo [work] (proof := some 32)),
  (macA, [], .write alice lamp alice none 0 [521] (tags := { add := [urgent], remove := [work] })),
  (macA, [], .move alice lamp [34] [521, 522])] ++ offline 530 524 [
  (passkeyA, [], .revoke 34 alice [520])]
#guard refused kept == []
#guard (entryWrites (view kept) lamp).map (·.edit) == [521, 522] && cellOf kept lamp == [34]
#guard !(writable kept bob).contains lamp && !accepted kept (attempt macB [] (.write alice lamp bob none 0 [522]))

/-! ## An entry id is created once

In step order, where a removal's keep list alone says what it had seen, Bob creates the lamp through his work cap and
Alice's passkey revokes that cap without having seen it: the lamp falls with its writes. Its id stays used even so:
nobody creates it again, so an entry key's name never names two keys. -/

def fallen : List Edit := workShare ++ chain 520 [
  (macB, [], create alice lamp bob [32] todo [work] (proof := some 32)),
  (passkeyA, [], .revoke 32 alice [])]
#guard let st := replay {} fallen; st.entry? lamp == none && entryWrites st lamp == [] && st.born.contains lamp
#guard (step (replay {} fallen) (attempt macA [] (create alice lamp alice [] todo))).isNone
#guard ((replay {} fallen.dropLast).entry? lamp).isSome

/-! ## Removals settle from the top down

A removal is only ever kept out by one that ranks above it, so what ranks above a removal must never rest on what it
takes away: a vault's removals come before those of the coops it owns, and a senior revoker's before those of whoever
holds a cap beneath the one revoked. -/

-- Alice gives Dave owner on her notes, and Dave gives Carol read beneath it. Dave revokes Carol's read on a copy that
-- hadn't seen Alice, the vault the caps are over, revoke Dave's cap, so Dave's revocation sorts first. Alice ranks
-- first all the same: Dave's cap goes, Carol's with it, and Dave's revocation falls with the cap it rested on.
def seniorRevoke : List Edit := s2 ++ chain 700 [
  (macA, [], create alice plan alice [] note),
  (passkeyA, [], .cap (capOf 701 alice dave .owner notes)),
  (macD, [], .cap (capOf 702 alice carol .read notes (parent := some 701) (issuer := dave))),
  (macA, [], create alice diary alice [] note),
  (macA, [], .write alice plan alice none 0 [700]),
  (passkeyA, [], .revoke 701 alice [700, 701, 702, 703, 704])] ++ offline 720 702 [
  (macD, [], .revoke 702 dave [])]
#guard (((order seniorRevoke).map (·.id)).drop (s2.length + 3)).take 1 == [720]
#guard refused seniorRevoke == [720]
#guard !(view seniorRevoke).live 701 && !(view seniorRevoke).live 702

-- Alice's vault gains two more passkeys, either of which approves for it alone, and Alice and Bob found a coop
-- where either acts alone. One passkey removes Bob from the coop on a copy that hadn't seen the other passkey remove it
-- from Alice's vault. Alice's vault settles first, so the coop's removal falls, exactly as on a peer that never held
-- the coop's log.
def tiers : List Edit := s2 ++ chain 740 [
  (passkeyA, [77], .addOwner alice (.signer 77)),
  (passkeyA, [78], .addOwner alice (.signer 78)),
  (passkeyA, [passkeyB], .genesis pair .coop [.vault alice, .vault bob] 1),
  (passkeyA, [], .setThreshold pair 1),
  (78, [], .removeOwner alice (.signer 77) [740, 741, 742, 743])] ++ offline 760 742 [
  (77, [], .removeOwner pair (.vault bob) [])]
#guard refused tiers == [760]
#guard ((view tiers).vault? alice).map (·.owners) == some [.signer passkeyA, .signer 78]
#guard ((view tiers).vault? pair).map (·.owners) == some [.vault alice, .vault bob]
#guard ((view (tiers.filter fun o => o.id != 742 && o.id != 760)).vault? alice).map (·.owners) ==
  ((view tiers).vault? alice).map (·.owners)

/-! ## Once the curves fall: checkpoints

A write carries only the classical half of its device's signature. Whoever breaks the curves can sign a write as
Alice's Mac, but not a checkpoint, which carries the hash-based half too: a peer that no longer trusts the curves
counts only the writes that a checkpoint by their own device covers. -/

-- Alice's Mac vouches for its edit of the door todo; a forger who broke its classical key then writes as the Mac
def vouched : List Edit := s15 ++ chain 200 [
  (macA, [], .checkpoint door [100]),
  (macA, [], .write alice door alice (some 106) 0 [100])]
#guard refused vouched == []
-- every peer counts the forged edit while it trusts the curves; once it doesn't, only the vouched one
#guard (entryWrites (view vouched) door).map (·.edit) == [100, 201]
#guard (entryWrites (view (checkpointed vouched)) door).map (·.edit) == [100]
-- no checkpoint covers the other todos' edits, so they don't count either; every edit but a write still does
#guard entryWrites (view (checkpointed vouched)) seeds == []
#guard (view (checkpointed vouched)).caps == (view vouched).caps
-- a device vouches only for its own accepted writes of the entry, and for at least one
#guard accepted s15 (attempt macA [] (.checkpoint door [100]))
#guard !accepted s15 (attempt macB [] (.checkpoint door [100]))
#guard !accepted s15 (attempt macA [] (.checkpoint seeds [100]))
#guard !accepted s15 (attempt macA [] (.checkpoint door [100, 999]))
#guard !accepted s15 (attempt macA [] (.checkpoint door []))
-- the checkpoint travels with its entry: Carol's Mac gets it with the door todo, a stranger gets no entry at all
#guard (respond vouched macC).any (·.action == .checkpoint door [100])
#guard (respond vouched stranger).all (entryLog? · == none)

end AvenDB.Examples

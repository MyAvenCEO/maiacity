import VaultSpec.Sync
import VaultSpec.Lens

/-!
# The plan's scenarios, run on the model

Each `#guard` replays part of an acceptance scenario from the plan and checks what the model says. They run on
every `lake build`, so a change to the model that breaks a scenario fails the build. The Rust scenario tests check
the same things against the real code.
-/

namespace VaultSpec.Examples

-- Signers: passkeys and device keys.
def passkeyS := 1
def macS := 2
def phoneS := 3
def passkeyB := 4
def macB := 5
def passkeyC := 6
def macC := 7
def passkeyD := 8
def macD := 9
def stranger := 555

-- Vaults, spaces and entries.
def samuel := 100
def bob := 101
def carol := 102
def dave := 103
def coop := 200
def handbook := 10
def notes := 11
def todos := 12
def welcome := 1
def charter := 2
def onboarding := 3
def door := 21
def seeds := 22
def solar := 23

/-- Ops in sequence: each builds on the one before, ids count from `start`. -/
def chain (start : Nat) (steps : List (SignerId × List SignerId × Action)) : List Op :=
  (steps.zipIdx start).map fun ((author, co, a), i) => { id := i, depth := i, author, cosigners := co, action := a }

/-- The op a scenario tries next, to see whether it would be accepted. -/
def attempt (author : SignerId) (co : List SignerId) (a : Action) : Op :=
  { id := 9999, depth := 9999, author, cosigners := co, action := a }

def accepted (ops : List Op) (op : Op) : Bool := (step (view ops) op).isSome

def opens' (ops : List Op) (d : SignerId) (k : KeyScope) : Bool :=
  let st := view ops
  knows st [.signer d] (st.curKey k)

/-- The ops of a scenario that don't stand, in the order every peer replays them. Replay skips a refused op without
    a word, so every scenario checks which ones it expects. -/
def refused (ops : List Op) : List OpId :=
  let stood := standing ops
  (order ops).filterMap fun o => if stood.any (·.id == o.id) then none else some o.id

/-- Ops made on a device that had seen the log only up to depth `d`, each building on the one before, ids counting
    from `start`: they sort before whatever was made elsewhere since. -/
def offline (start d : Nat) (steps : List (SignerId × List SignerId × Action)) : List Op :=
  (steps.zipIdx).map fun ((author, co, a), i) => { id := start + i, depth := d + 1 + i, author, cosigners := co, action := a }

/-! ## Scenarios 1 and 2: vaults and devices

Each person's passkey is their vault's root, as in the app. -/

def s1 : List Op := chain 1 [
  (passkeyS, [], .genesis samuel .human [.signer passkeyS] 1 (some passkeyS)),
  (passkeyS, [macS], .addDevice samuel macS),
  (passkeyS, [phoneS], .addDevice samuel phoneS)]
#guard refused s1 == []

#guard ((view s1).vault? samuel).map (·.devices) == some [macS, phoneS]
-- the vault key opens on both devices, and with the key derived from the passkey alone
#guard opens' s1 macS (.vault samuel) && opens' s1 phoneS (.vault samuel) && opens' s1 passkeyS (.vault samuel)
-- the Mac acts for Samuel's vault but can't add a device on its own
#guard actsFor (view s1) macS samuel
#guard !accepted s1 (attempt macS [77] (.addDevice samuel 77))
#guard accepted s1 (attempt passkeyS [77] (.addDevice samuel 77))
-- a device can't be added without its own signature
#guard !accepted s1 (attempt passkeyS [] (.addDevice samuel 77))
-- only the root hands the root on, and the new root signs
#guard accepted s1 (attempt passkeyS [77] (.setRoot samuel (some 77) []))
#guard !accepted s1 (attempt passkeyS [] (.setRoot samuel (some 77) []))
#guard !accepted s1 (attempt macS [77] (.setRoot samuel (some 77) []))
-- the root signs the genesis that names it
#guard !accepted [] (attempt passkeyS [] (.genesis samuel .human [.signer passkeyS] 1 (some 77)))

def s2 : List Op := s1 ++ chain 10 [
  (passkeyB, [], .genesis bob .human [.signer passkeyB] 1 (some passkeyB)),
  (passkeyB, [macB], .addDevice bob macB),
  (passkeyC, [], .genesis carol .human [.signer passkeyC] 1 (some passkeyC)),
  (passkeyC, [macC], .addDevice carol macC),
  (passkeyD, [], .genesis dave .human [.signer passkeyD] 1 (some passkeyD)),
  (passkeyD, [macD], .addDevice dave macD)]
#guard refused s2 == []

-- a second passkey joins Samuel's vault at threshold 2; the root still approves alone, the other passkey doesn't
def twoKeys : List Op := s1 ++ chain 140 [
  (passkeyS, [77], .addOwner samuel (.signer 77)),
  (passkeyS, [], .setThreshold samuel 2)]
#guard refused twoKeys == []
#guard accepted twoKeys (attempt passkeyS [78] (.addDevice samuel 78))
#guard !accepted twoKeys (attempt 77 [78] (.addDevice samuel 78))
-- a coop has no root
#guard !accepted s2 (attempt passkeyS [passkeyB] (.genesis coop .coop [.vault samuel, .vault bob] 2 (some passkeyS)))

/-! ## Scenario 3: a coop of two vaults, threshold 2 -/

def s3 : List Op := s2 ++ chain 20 [
  (passkeyS, [passkeyB], .genesis coop .coop [.vault samuel, .vault bob] 2)]
#guard refused s3 == []

-- Bob has to consent to becoming an owner
#guard !accepted s2 (attempt passkeyS [] (.genesis coop .coop [.vault samuel, .vault bob] 2))
#guard (view s3).vault? coop |>.isSome
-- the coop key opens on Bob's Mac and on both of Samuel's devices, and nowhere else
#guard opens' s3 macB (.vault coop) && opens' s3 macS (.vault coop) && opens' s3 phoneS (.vault coop)
#guard !opens' s3 macC (.vault coop) && !opens' s3 stranger (.vault coop)
-- a coop can't own itself, and Samuel's vault alone can't add an owner to a threshold-2 coop
#guard !accepted s3 (attempt passkeyS [passkeyB] (.addOwner coop (.vault coop)))
#guard !accepted s3 (attempt passkeyS [passkeyD] (.addOwner coop (.vault dave)))
#guard accepted s3 (attempt passkeyS [passkeyB, passkeyD] (.addOwner coop (.vault dave)))
-- with nothing shared yet, Samuel's Mac sends Bob's Mac the coop's log, Carol's Mac nothing of it, a stranger nothing
#guard (respond s3 macB).any (·.vaultOf? == some coop)
#guard (respond s3 macC).all (·.vaultOf? != some coop) && (respond s3 stranger).isEmpty

/-! ## Scenarios 4 to 7: spaces, writes, one document via caps, public -/

def s4 : List Op := s3 ++ chain 30 [
  (macS, [], .foundSpace handbook coop),
  (macS, [], .foundSpace notes samuel),
  (macS, [], .foundSpace todos samuel)]
#guard refused s4 == []

-- Bob's Mac learns of the coop's Handbook before anything is written in it, but not of Samuel's Notes
#guard (respond s4 macB).any (·.authScope? s4 == some (.space handbook))
#guard !(respond s4 macB).any (·.authScope? s4 == some (.space notes))

def s5 : List Op := s4 ++ chain 40 [
  (macS, [], .write handbook welcome coop 0),
  (macS, [], .write handbook onboarding coop 0)]
#guard refused s5 == []

-- Bob's Mac opens Welcome through the coop; Carol, a stranger and the server can't
#guard opens' s5 macB (.entry handbook welcome)
#guard !opens' s5 macC (.entry handbook welcome) && !opens' s5 stranger (.entry handbook welcome)

def s6 : List Op := s5 ++ chain 50 [
  (macS, [], .grant { id := 1, scope := .entry handbook welcome, role := .read, grantee := .principal (.vault carol),
                       issuer := coop, parent := none })]
#guard refused s6 == []

-- Carol reads Welcome only, and can't edit it
#guard opens' s6 macC (.entry handbook welcome)
#guard !opens' s6 macC (.entry handbook onboarding) && !opens' s6 macC (.space handbook)
#guard !accepted s6 (attempt macC [] (.write handbook welcome carol 0))
-- a grant naming a device is refused (T4)
#guard !accepted s6 (attempt macS [] (.grant { id := 2, scope := .entry handbook welcome, role := .read,
                                               grantee := .principal (.signer macC), issuer := coop, parent := none }))

def s7 : List Op := s6 ++ chain 60 [
  (macS, [], .write handbook charter coop 0),
  (macS, [], .grant { id := 3, scope := .entry handbook charter, role := .read, grantee := .«public»,
                       issuer := coop, parent := none })]
#guard refused s7 == []

-- anyone opens Charter; Public can't be given write (T8)
#guard opens' s7 stranger (.entry handbook charter) && !opens' s7 stranger (.entry handbook welcome)
#guard !accepted s7 (attempt macS [] (.grant { id := 4, scope := .entry handbook charter, role := .write,
                                               grantee := .«public», issuer := coop, parent := none }))

/-! ## Scenario 9: schema v2

The coop moves the Handbook to schema v2. Samuel's Mac, acting for the coop that founded it, publishes the v2 schema
and the lens from v1 into the Handbook's schema lane. Carol may write in the Handbook but not publish there. -/

def schemaV2 : BlobId := 1
def lensV1V2 : BlobId := 2

def s9 : List Op := s7 ++ chain 65 [
  (macS, [], .grant { id := 5, scope := .space handbook, role := .write, grantee := .principal (.vault carol),
                       issuer := coop, parent := none }),
  (macS, [], .publish handbook coop schemaV2),
  (macS, [], .publish handbook coop lensV1V2),
  -- Samuel's Notes move to v2 too: the same blob, in another space's lane
  (macS, [], .publish notes samuel schemaV2)]
#guard refused s9 == []

#guard (view s9).lane == [(handbook, schemaV2), (handbook, lensV1V2), (notes, schemaV2)]
-- the same blob again is refused; Bob's Mac acts for the coop too, and may publish another
#guard !accepted s9 (attempt macS [] (.publish handbook coop schemaV2))
#guard accepted s9 (attempt macB [] (.publish handbook coop 3))
-- Carol writes in the Handbook, but publishes into its lane neither for herself nor for the coop; nor does a stranger
#guard accepted s9 (attempt macC [] (.write handbook onboarding carol 0))
#guard !accepted s9 (attempt macC [] (.publish handbook carol 3))
#guard !accepted s9 (attempt macC [] (.publish handbook coop 3))
#guard !accepted s9 (attempt stranger [] (.publish handbook coop 3))
-- whoever may receive an item of a space receives its schemas and lenses: Carol's Mac those of the Handbook, and so
-- does anyone, through the public Charter; Bob's Mac doesn't receive those of Samuel's Notes
#guard [macC, stranger].all fun d => (respond s9 d).any (·.action == .publish handbook coop schemaV2)
#guard (respond s9 phoneS).any (·.action == .publish notes samuel schemaV2)
#guard !(respond s9 macB).any (·.action == .publish notes samuel schemaV2)

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

/-! ## Scenario 10: revoking Carol rotates Welcome's key -/

def s10 : List Op := s7 ++ chain 70 [(macS, [], .revoke 1 coop [])]
#guard refused s10 == []

#guard (view s10).epochOf (.entry handbook welcome) == (view s7).epochOf (.entry handbook welcome) + 1
#guard !opens' s10 macC (.entry handbook welcome) && opens' s10 macB (.entry handbook welcome)

/-! ## Scenario 11: a lost iPhone rotates everything it could reach -/

def s11 : List Op := s7 ++ chain 80 [(passkeyS, [], .removeDevice samuel phoneS [])]
#guard refused s11 == []

#guard !opens' s11 phoneS (.vault samuel) && !opens' s11 phoneS (.vault coop)
#guard !opens' s11 phoneS (.entry handbook welcome) && opens' s11 macS (.entry handbook welcome)
#guard opens' s11 macB (.entry handbook welcome)
#guard !accepted s11 (attempt phoneS [] (.write handbook welcome coop 1))

/-! ## Scenario 12: Bob leaves the coop on his own -/

def s12 : List Op := s7 ++ chain 90 [(passkeyB, [], .removeOwner coop (.vault bob) [])]
#guard refused s12 == []

#guard ((view s12).vault? coop).map (·.threshold) == some 1
#guard !opens' s12 macB (.vault coop) && !opens' s12 macB (.entry handbook welcome)
-- Bob's earlier edits stay: none were his, and Samuel's are untouched
#guard (view s12).writes.length == (view s7).writes.length

/-! ## Scenarios 15 and 16: one todo, many vaults, changing roles -/

def s15 : List Op := s4 ++ chain 100 [
  (macS, [], .write todos door samuel 0),
  (macS, [], .write todos seeds samuel 0),
  (macS, [], .write todos solar samuel 0),
  (macS, [], .grant { id := 10, scope := .entry todos door, role := .write, grantee := .principal (.vault bob),
                       issuer := samuel, parent := none }),
  (macS, [], .grant { id := 11, scope := .entry todos door, role := .read, grantee := .principal (.vault carol),
                       issuer := samuel, parent := none }),
  -- making the coop owner of the todo is governance: Samuel's passkey
  (passkeyS, [], .grant { id := 12, scope := .entry todos door, role := .owner, grantee := .principal (.vault coop),
                           issuer := samuel, parent := none })]
#guard refused s15 == []

-- a device alone can't make anyone owner
#guard !accepted s4 (attempt macS [] (.grant { id := 13, scope := .entry todos door, role := .owner,
                                               grantee := .principal (.vault coop), issuer := samuel, parent := none }))
#guard accepted s15 (attempt macB [] (.write todos door bob 0))
#guard !accepted s15 (attempt macC [] (.write todos door carol 0))
#guard opens' s15 macC (.entry todos door) && !opens' s15 macC (.entry todos seeds)
#guard !opens' s15 macB (.entry todos solar)

def s16a : List Op := s15 ++ chain 110 [
  -- acting for the coop, Bob gives Dave read
  (macB, [], .grant { id := 14, scope := .entry todos door, role := .read, grantee := .principal (.vault dave),
                       issuer := coop, parent := some 12 }),
  -- Samuel raises Carol to write and takes Bob's own write away
  (macS, [], .grant { id := 15, scope := .entry todos door, role := .write, grantee := .principal (.vault carol),
                       issuer := samuel, parent := none }),
  (macS, [], .revoke 10 samuel [100, 101, 102])]
#guard refused s16a == []

-- Bob still reaches the todo through the coop, so its key didn't rotate
#guard entitled (view s16a) macB (.entry todos door)
#guard (view s16a).epochOf (.entry todos door) == (view s15).epochOf (.entry todos door)
#guard opens' s16a macD (.entry todos door) && accepted s16a (attempt macC [] (.write todos door carol 0))

def s16 : List Op := s16a ++ chain 120 [
  -- taking the coop's owner cap away is governance, and ends the read Bob gave Dave, which Samuel had seen
  (passkeyS, [], .revoke 12 samuel [110])]
#guard refused s16 == []

#guard !entitled (view s16) macB (.entry todos door) && !entitled (view s16) macD (.entry todos door)
#guard (view s16).epochOf (.entry todos door) == (view s16a).epochOf (.entry todos door) + 1
#guard !opens' s16 macB (.entry todos door) && !opens' s16 macD (.entry todos door)
#guard opens' s16 macC (.entry todos door) && opens' s16 macS (.entry todos door)
#guard !accepted s16 (attempt macB [] (.write todos door coop 1))

/-! ## Keys ops carry only the boxes the schedule seals -/

-- Samuel's Mac boxes Welcome's key to the Handbook key; Carol's Mac, which can't open it, can't box it
#guard accepted s5 (attempt macS [] (.keys (.entry handbook welcome) 0 [.scoped (.space handbook) 0]))
#guard !accepted s5 (attempt macC [] (.keys (.entry handbook welcome) 0 []))
-- a box the schedule doesn't seal is refused, and so is a key of an epoch that doesn't exist yet
#guard !accepted s5 (attempt macS [] (.keys (.entry handbook welcome) 0 [.signer macC]))
#guard !accepted s5 (attempt macS [] (.keys (.entry handbook welcome) 1 []))
-- only a public key is published
#guard !accepted s5 (attempt macS [] (.keys (.entry handbook welcome) 0 [] true))
#guard accepted s7 (attempt macS [] (.keys (.entry handbook charter) 0 [] true))

/-! ## A coop that stops reading rotates the key, though its members still read

Samuel's second coop reads his Notes, then stops. Samuel still reads Notes as its founder, but the coop's key would
carry the Notes key to whoever joins the coop later, so the key rotates. Bob joins and opens only the old key: a
vault's newcomers inherit what it could read. -/

def coop2 := 202
def gap : List Op := s4 ++ chain 190 [
  (passkeyS, [], .genesis coop2 .coop [.vault samuel] 1),
  (macS, [], .grant { id := 20, scope := .space notes, role := .read, grantee := .principal (.vault coop2),
                       issuer := samuel, parent := none }),
  (macS, [], .revoke 20 samuel []),
  (passkeyS, [passkeyB], .addOwner coop2 (.vault bob))]
#guard refused gap == []

#guard (view gap).epochOf (.space notes) == (view s4).epochOf (.space notes) + 1
#guard !opens' gap macB (.space notes) && opens' gap macS (.space notes)
#guard knows (view gap) [.signer macB] (.scoped (.space notes) 0)

/-! ## Scenario 17: each todo syncs on its own -/

-- Samuel's Mac answers Carol's Mac with the door todo only
#guard (respond s15 macC).any (·.writeTarget? == some (todos, door))
#guard (respond s15 macC).all fun o => o.writeTarget? == none || o.writeTarget? == some (todos, door)
-- a device with no cap on it gets none of it
#guard (respond s15 stranger).all (·.writeTarget? == none)
-- after the coop lost the todo, Dave's Mac gets none of its edits, only the revocation that ended its read, as Bob's
-- Mac does for the coop's owner cap
#guard (respond s16 macD).all (·.writeTarget? == none)
#guard [macD, macB].all fun d => (respond s16 d).any (·.takesFrom (view s16) s16 d)
#guard !(respond s16 stranger).any (·.takesFrom (view s16) s16 stranger)

-- Each Mac starts with its own vault and what Samuel's Mac sent it. Then the server and Samuel go offline, Bob
-- edits the door todo, and Bob's Mac and Carol's Mac sync directly.
def ownVault (v : VaultId) : List Op := s2.filter (·.vaultOf? == some v)
def bobMac : List Op := receive (ownVault bob) (respond s15 macB) ++ chain 130 [(macB, [], .write todos door bob 0 [100])]
def carolMac : List Op := receive (ownVault carol) (respond s15 macC)

#guard refused bobMac == [] && refused carolMac == []
#guard (itemWrites (view carolMac) todos door).length == 1
-- each answers the other once
def bobMac' := receive bobMac (respond carolMac macB)
def carolMac' := receive carolMac (respond bobMac macC)

-- both now hold Samuel's and Bob's edits of the door todo, and Carol's Mac accepts Bob's
#guard (itemWrites (view carolMac') todos door).length == 2
#guard itemWrites (view carolMac') todos door == itemWrites (view bobMac') todos door
-- and neither learned anything about the other todos
#guard itemWrites (view carolMac') todos seeds == [] && itemWrites (view bobMac') todos solar == []

/-! ## Strong removal: a removal cuts what it hadn't seen

A device that was offline makes ops on its old copy of the log, so they sort before a removal made elsewhere in the
meantime. Each such op stands only if it stands without what the removal took away. -/

-- a coop of Samuel and Bob where either may act alone
def pair := 201
def sPair : List Op := s2 ++ chain 140 [(passkeyS, [passkeyB], .genesis pair .coop [.vault samuel, .vault bob] 1)]

-- Samuel goes on, then removes Bob; Bob, offline since the coop began, adds Dave
def backdated (keep : List OpId) : List Op := sPair ++ chain 141 [
  (passkeyS, [], .setThreshold pair 1),
  (passkeyS, [], .setThreshold pair 1),
  (passkeyS, [], .removeOwner pair (.vault bob) keep)] ++ offline 150 140 [
  (passkeyB, [passkeyD], .addOwner pair (.vault dave))]

-- the removal hadn't seen Bob's add, so it is cut; had it seen it, the add would stand
#guard refused (backdated []) == [150]
#guard ((view (backdated [])).vault? pair).map (·.owners) == some [.vault samuel]
#guard refused (backdated [150]) == []
#guard ((view (backdated [150])).vault? pair).map (·.owners) == some [.vault samuel, .vault dave]

-- the two remove each other at once, and Bob's sorts first: the senior owner stands
def clash : List Op := sPair ++ [
  { id := 161, depth := 141, author := passkeyS, cosigners := [], action := .removeOwner pair (.vault bob) [] },
  { id := 160, depth := 141, author := passkeyB, cosigners := [], action := .removeOwner pair (.vault samuel) [] }]
#guard ((order clash).map (·.id)).reverse.take 2 == [161, 160]
#guard refused clash == [160]
#guard ((view clash).vault? pair).map (·.owners) == some [.vault samuel]

-- a thief holding Samuel's second passkey removes the root's passkey from the owners and adds a device; the root,
-- having seen neither, removes the second passkey. It keeps the threshold it had set, which counted that passkey.
def stolen : List Op := twoKeys ++ chain 142 [(passkeyS, [], .removeOwner samuel (.signer 77) [141])] ++ offline 170 141 [
  (77, [passkeyS], .removeOwner samuel (.signer passkeyS) []),
  (77, [stranger], .addDevice samuel stranger)]
#guard refused stolen == [170, 171]
#guard ((view stolen).vault? samuel).map (·.owners) == some [.signer passkeyS]
#guard !actsFor (view stolen) stranger samuel

-- Samuel revokes Bob's write on the door todo, keeping the edit he had seen; Bob's other edit, made offline, is cut,
-- and so is Carol's, which builds on it, though Carol may write
def revokedWriter : List Op := s16a ++ offline 180 113 [
  (macB, [], .write todos door bob 0 [100])] ++ offline 182 115 [
  (macC, [], .write todos door carol 0 [180])]
#guard refused revokedWriter == [180, 182]
#guard (itemWrites (view revokedWriter) todos door).map (·.op) == [100]
-- revoking Bob's write after his edit arrived keeps it: the revocation names it
def keptWriter : List Op := s15 ++ chain 113 [(macB, [], .write todos door bob 0 [100])] ++ chain 114 [
  (macS, [], .revoke 10 samuel [113]),
  (macC, [], .write todos door carol 0 [113])]
#guard refused keptWriter == [115]
#guard (itemWrites (view keptWriter) todos door).map (·.op) == [100, 113]

-- handing the root on to a new passkey, then retiring the old one, cuts what the old passkey signs on an old copy;
-- both keep what the old passkey approved before them, as every honest device's draft does
def handover : List Op := s1 ++ chain 140 [
  (passkeyS, [77], .addOwner samuel (.signer 77)),
  (passkeyS, [77], .setRoot samuel (some 77) [2, 3, 140]),
  (77, [], .removeOwner samuel (.signer passkeyS) [2, 3, 140])] ++ offline 150 140 [
  (passkeyS, [stranger], .addDevice samuel stranger)]
#guard refused handover == [150]
#guard ((view handover).vault? samuel).map (fun v => (v.owners, v.root)) == some ([.signer 77], some 77)
#guard !actsFor (view handover) stranger samuel

end VaultSpec.Examples

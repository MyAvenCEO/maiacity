import AvenDB.Sync
import AvenDB.Lens
import AvenDB.Branches

/-!
# The plan's scenarios, run on the model

Each `#guard` replays part of an acceptance scenario from the plan and checks what the model says. They run on
every `lake build`, so a change to the model that breaks a scenario fails the build. The Rust scenario tests check
the same things against the real code.
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

-- Vaults, spaces and entries.
def alice := 100
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
  (passkeyA, [], .genesis alice .human [.signer passkeyA] 1 (some passkeyA)),
  (passkeyA, [macA], .addDevice alice macA),
  (passkeyA, [phoneA], .addDevice alice phoneA)]
#guard refused s1 == []

#guard ((view s1).vault? alice).map (·.devices) == some [macA, phoneA]
-- the vault key opens on both devices, and with the key derived from the passkey alone
#guard opens' s1 macA (.vault alice) && opens' s1 phoneA (.vault alice) && opens' s1 passkeyA (.vault alice)
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

def s2 : List Op := s1 ++ chain 10 [
  (passkeyB, [], .genesis bob .human [.signer passkeyB] 1 (some passkeyB)),
  (passkeyB, [macB], .addDevice bob macB),
  (passkeyC, [], .genesis carol .human [.signer passkeyC] 1 (some passkeyC)),
  (passkeyC, [macC], .addDevice carol macC),
  (passkeyD, [], .genesis dave .human [.signer passkeyD] 1 (some passkeyD)),
  (passkeyD, [macD], .addDevice dave macD)]
#guard refused s2 == []

-- a second passkey joins Alice's vault at threshold 2; the root still approves alone, the other passkey doesn't
def twoKeys : List Op := s1 ++ chain 140 [
  (passkeyA, [77], .addOwner alice (.signer 77)),
  (passkeyA, [], .setThreshold alice 2)]
#guard refused twoKeys == []
#guard accepted twoKeys (attempt passkeyA [78] (.addDevice alice 78))
#guard !accepted twoKeys (attempt 77 [78] (.addDevice alice 78))
-- a coop has no root
#guard !accepted s2 (attempt passkeyA [passkeyB] (.genesis coop .coop [.vault alice, .vault bob] 2 (some passkeyA)))

/-! ## Scenario 3: a coop of two vaults, threshold 2 -/

def s3 : List Op := s2 ++ chain 20 [
  (passkeyA, [passkeyB], .genesis coop .coop [.vault alice, .vault bob] 2)]
#guard refused s3 == []

-- Bob has to consent to becoming an owner
#guard !accepted s2 (attempt passkeyA [] (.genesis coop .coop [.vault alice, .vault bob] 2))
#guard (view s3).vault? coop |>.isSome
-- the coop key opens on Bob's Mac and on both of Alice's devices, and nowhere else
#guard opens' s3 macB (.vault coop) && opens' s3 macA (.vault coop) && opens' s3 phoneA (.vault coop)
#guard !opens' s3 macC (.vault coop) && !opens' s3 stranger (.vault coop)
-- a coop can't own itself, and Alice's vault alone can't add an owner to a threshold-2 coop
#guard !accepted s3 (attempt passkeyA [passkeyB] (.addOwner coop (.vault coop)))
#guard !accepted s3 (attempt passkeyA [passkeyD] (.addOwner coop (.vault dave)))
#guard accepted s3 (attempt passkeyA [passkeyB, passkeyD] (.addOwner coop (.vault dave)))
-- with nothing shared yet, Alice's Mac sends Bob's Mac the coop's log, Carol's Mac nothing of it, a stranger nothing
#guard (respond s3 macB).any (·.vaultOf? == some coop)
#guard (respond s3 macC).all (·.vaultOf? != some coop) && (respond s3 stranger).isEmpty

/-! ## Three kinds of vault

The vault is the identity. A human vault is owned by its person's passkeys, and its devices act for it. A coop vault
is owned by human and coop vaults. avenCEO, the relay server's vault, is an aven vault: owned by human and coop vaults
like a coop, with devices of its own, its servers, which act for it but never govern it. No signer owns a coop or an
aven vault directly. -/

def avenCEO := 300
def server := 600

def sAven : List Op := s3 ++ chain 400 [
  (passkeyA, [], .genesis avenCEO .aven [.vault alice] 1),
  (passkeyA, [server], .addDevice avenCEO server)]
#guard refused sAven == []

-- the server acts for avenCEO, and so do Alice's devices, through Alice's vault; Bob's don't
#guard actsFor (view sAven) server avenCEO && actsFor (view sAven) macA avenCEO && !actsFor (view sAven) macB avenCEO
-- avenCEO's key opens on the server and on Alice's devices; Alice's vault's key doesn't open on the server
#guard opens' sAven server (.vault avenCEO) && opens' sAven phoneA (.vault avenCEO)
#guard !opens' sAven server (.vault alice) && !opens' sAven macB (.vault avenCEO)
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

An op that acts for a vault names the owners it goes through, down to the vault its device belongs to: Alice's Mac
writes for the coop through Alice's vault. A chain that skips a link, or runs through a vault the device doesn't
belong to, is refused. -/

-- Alice's Mac founds the coop's Handbook through Alice's vault; with no chain, or through Bob's vault, it can't
#guard accepted s3 (attempt macA [] (.foundSpace handbook coop [alice]))
#guard !accepted s3 (attempt macA [] (.foundSpace handbook coop))
#guard !accepted s3 (attempt macA [] (.foundSpace handbook coop [bob]))
-- nor through Carol's vault, which doesn't own the coop
#guard !accepted s3 (attempt macC [] (.foundSpace handbook coop [carol]))
-- the server founds a space for avenCEO directly, Alice's Mac through Alice's vault
#guard accepted sAven (attempt server [] (.foundSpace notes avenCEO))
#guard accepted sAven (attempt macA [] (.foundSpace notes avenCEO [alice]))
#guard !accepted sAven (attempt macA [] (.foundSpace notes avenCEO))

-- a coop of the coop: Bob's Mac acts for it through the coop and Bob's vault, and may skip neither
def guild := 203
def sGuild : List Op := s3 ++ chain 410 [(passkeyA, [passkeyB], .genesis guild .coop [.vault coop] 1)]
#guard refused sGuild == []
#guard accepted sGuild (attempt macB [] (.foundSpace handbook guild [coop, bob]))
#guard !accepted sGuild (attempt macB [] (.foundSpace handbook guild [bob]))
#guard !accepted sGuild (attempt macB [] (.foundSpace handbook guild [coop]))

/-! ## Scenarios 4 to 7: spaces, writes, one document via caps, public -/

def s4 : List Op := s3 ++ chain 30 [
  (macA, [], .foundSpace handbook coop [alice]),
  (macA, [], .foundSpace notes alice),
  (macA, [], .foundSpace todos alice)]
#guard refused s4 == []

-- Bob's Mac learns of the coop's Handbook before anything is written in it, but not of Alice's Notes
#guard (respond s4 macB).any (·.authScope? s4 == some (.space handbook))
#guard !(respond s4 macB).any (·.authScope? s4 == some (.space notes))

def s5 : List Op := s4 ++ chain 40 [
  (macA, [], .write handbook welcome coop 0 (via := [alice])),
  (macA, [], .write handbook onboarding coop 0 (via := [alice]))]
#guard refused s5 == []

-- Bob's Mac opens Welcome through the coop; Carol, a stranger and the server can't
#guard opens' s5 macB (.entry handbook welcome)
#guard !opens' s5 macC (.entry handbook welcome) && !opens' s5 stranger (.entry handbook welcome)

def s6 : List Op := s5 ++ chain 50 [
  (macA, [], .grant { id := 1, scope := .entry handbook welcome, role := .read, grantee := .principal (.vault carol),
                       issuer := coop, parent := none } [alice])]
#guard refused s6 == []

-- Carol reads Welcome only, and can't edit it
#guard opens' s6 macC (.entry handbook welcome)
#guard !opens' s6 macC (.entry handbook onboarding) && !opens' s6 macC (.space handbook)
#guard !accepted s6 (attempt macC [] (.write handbook welcome carol 0))
-- a grant naming a device is refused (T4)
#guard !accepted s6 (attempt macA [] (.grant { id := 2, scope := .entry handbook welcome, role := .read,
                                               grantee := .principal (.signer macC), issuer := coop, parent := none }
                                     [alice]))

def s7 : List Op := s6 ++ chain 60 [
  (macA, [], .write handbook charter coop 0 (via := [alice])),
  (macA, [], .grant { id := 3, scope := .entry handbook charter, role := .read, grantee := .«public»,
                       issuer := coop, parent := none } [alice])]
#guard refused s7 == []

-- anyone opens Charter; Public can't be given write (T8)
#guard opens' s7 stranger (.entry handbook charter) && !opens' s7 stranger (.entry handbook welcome)
#guard !accepted s7 (attempt macA [] (.grant { id := 4, scope := .entry handbook charter, role := .write,
                                               grantee := .«public», issuer := coop, parent := none } [alice]))

/-! ## Scenario 8: branches

Welcome's first write (40) is on its main line. Bob starts a branch, draft, from it and edits there; main stays as it
was until Alice merges draft with a write on main that builds on both lines' heads. A second branch, rewrite, is
promoted the same way while main moved on: what the promote's update holds is Loro's (`Branches.lean`, T10h). -/

def ops8 : List (SignerId × List SignerId × Action) := [
  (macB, [], .write handbook welcome coop 0 [40] .new [bob]),            -- 300: Bob starts draft from Welcome's first write
  (macB, [], .write handbook welcome coop 0 [300] (.on 300) [bob]),      -- 301: Bob's edit on draft
  (macA, [], .write handbook welcome coop 0 [40, 301] .main [alice]),    -- 302: Alice merges draft into main
  (macA, [], .write handbook welcome coop 0 [302] .new [alice]),         -- 303: Alice starts rewrite from main
  (macA, [], .write handbook welcome coop 0 [303] (.on 303) [alice]),    -- 304: an edit on rewrite
  (macB, [], .write handbook welcome coop 0 [302] .main [bob]),          -- 305: main moves on meanwhile
  (macA, [], .write handbook welcome coop 0 [305, 304] .main [alice])]   -- 306: Alice promotes rewrite into main
def s8 (n : Nat := ops8.length) : List Op := s7 ++ chain 300 (ops8.take n)
#guard refused (s8) == []

def lineOps (ops : List Op) (l : Option OpId) : List OpId :=
  (history (view ops).writes handbook welcome l).map (·.op)
def headsOf (ops : List Op) (l : Option OpId) : List OpId := heads (view ops).writes handbook welcome l

-- Bob's draft holds Welcome as it was and his edit; main stays as it was (T10f)
#guard lineOps (s8 2) (some 300) == [40, 300, 301] && headsOf (s8 2) (some 300) == [301]
#guard lineOps (s8 2) none == [40] && headsOf (s8 2) none == [40]
-- the merge brings all of draft into main (T10g)
#guard lineOps (s8 3) none == [40, 300, 301, 302] && headsOf (s8 3) none == [302]
-- rewrite starts from the merged main; main moves on without it until the promote
#guard lineOps (s8 6) (some 303) == [40, 300, 301, 302, 303, 304] && lineOps (s8 6) none == [40, 300, 301, 302, 305]
#guard lineOps (s8) none == [40, 300, 301, 302, 303, 304, 305, 306] && headsOf (s8) none == [306]
-- draft is left as it was, and Onboarding has a main line only
#guard lineOps (s8) (some 300) == [40, 300, 301]
#guard (history (view (s8)).writes handbook onboarding none).map (·.op) == [41]
-- Carol reads Welcome, branches included, but can't start a branch
#guard (respond (s8) macC).any (·.id == 301)
#guard !accepted (s8) (attempt macC [] (.write handbook welcome carol 0 [40] .new))
-- a write on a branch builds on its start or on a write on it, of its own entry; merging main into draft is fine
#guard accepted (s8) (attempt macB [] (.write handbook welcome coop 0 [301, 306] (.on 300) [bob]))
#guard !accepted (s8) (attempt macB [] (.write handbook welcome coop 0 [306] (.on 300) [bob]))
#guard !accepted (s8) (attempt macA [] (.write handbook welcome coop 0 [306] (.on 302) [alice]))
#guard !accepted (s8) (attempt macA [] (.write handbook onboarding coop 0 [41] (.on 300) [alice]))
#guard !accepted (s8) (attempt macA [] (.write handbook welcome coop 0 [] (.on 999) [alice]))

/-! ## Scenario 9: schema v2

The coop moves the Handbook to schema v2. Alice's Mac, acting for the coop that founded it, publishes the v2 schema
and the lens from v1 into the Handbook's schema lane. Carol may write in the Handbook but not publish there. -/

def schemaV2 : BlobId := 1
def lensV1V2 : BlobId := 2

def s9 : List Op := s7 ++ chain 65 [
  (macA, [], .grant { id := 5, scope := .space handbook, role := .write, grantee := .principal (.vault carol),
                       issuer := coop, parent := none } [alice]),
  (macA, [], .publish handbook coop schemaV2 [alice]),
  (macA, [], .publish handbook coop lensV1V2 [alice]),
  -- Alice's Notes move to v2 too: the same blob, in another space's lane
  (macA, [], .publish notes alice schemaV2)]
#guard refused s9 == []

#guard (view s9).lane == [(handbook, schemaV2), (handbook, lensV1V2), (notes, schemaV2)]
-- the same blob again is refused; Bob's Mac acts for the coop too, through Bob's vault, and may publish another
#guard !accepted s9 (attempt macA [] (.publish handbook coop schemaV2 [alice]))
#guard accepted s9 (attempt macB [] (.publish handbook coop 3 [bob]))
-- Carol writes in the Handbook, but publishes into its lane neither for herself nor for the coop, whose owner her
-- vault isn't; nor does a stranger
#guard accepted s9 (attempt macC [] (.write handbook onboarding carol 0))
#guard !accepted s9 (attempt macC [] (.publish handbook carol 3))
#guard !accepted s9 (attempt macC [] (.publish handbook coop 3 [carol]))
#guard !accepted s9 (attempt stranger [] (.publish handbook coop 3))
-- whoever may receive an item of a space receives its schemas and lenses: Carol's Mac those of the Handbook, and so
-- does anyone, through the public Charter; Bob's Mac doesn't receive those of Alice's Notes
#guard [macC, stranger].all fun d => (respond s9 d).any (·.action == .publish handbook coop schemaV2 [alice])
#guard (respond s9 phoneA).any (·.action == .publish notes alice schemaV2)
#guard !(respond s9 macB).any (·.action == .publish notes alice schemaV2)

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

def s10 : List Op := s7 ++ chain 70 [(macA, [], .revoke 1 coop [] [alice])]
#guard refused s10 == []

#guard (view s10).epochOf (.entry handbook welcome) == (view s7).epochOf (.entry handbook welcome) + 1
#guard !opens' s10 macC (.entry handbook welcome) && opens' s10 macB (.entry handbook welcome)

/-! ## Scenario 11: a lost iPhone rotates everything it could reach -/

def s11 : List Op := s7 ++ chain 80 [(passkeyA, [], .removeDevice alice phoneA [])]
#guard refused s11 == []

#guard !opens' s11 phoneA (.vault alice) && !opens' s11 phoneA (.vault coop)
#guard !opens' s11 phoneA (.entry handbook welcome) && opens' s11 macA (.entry handbook welcome)
#guard opens' s11 macB (.entry handbook welcome)
#guard !accepted s11 (attempt phoneA [] (.write handbook welcome coop 1 (via := [alice])))

/-! ## Scenario 12: Bob leaves the coop on his own -/

def s12 : List Op := s7 ++ chain 90 [(passkeyB, [], .removeOwner coop (.vault bob) [])]
#guard refused s12 == []

#guard ((view s12).vault? coop).map (·.threshold) == some 1
#guard !opens' s12 macB (.vault coop) && !opens' s12 macB (.entry handbook welcome)
-- Bob's earlier edits stay: none were his, and Alice's are untouched
#guard (view s12).writes.length == (view s7).writes.length
-- what Bob's Mac wrote for the coop through Bob's vault on a copy that hadn't seen him leave is cut
def bobLeft : List Op := s12 ++ offline 95 61 [(macB, [], .write handbook welcome coop 0 [40] (via := [bob]))]
#guard refused bobLeft == [95]
#guard !accepted s12 (attempt macB [] (.write handbook welcome coop 0 [40] (via := [bob])))

/-! ## Scenarios 15 and 16: one todo, many vaults, changing roles -/

def s15 : List Op := s4 ++ chain 100 [
  (macA, [], .write todos door alice 0),
  (macA, [], .write todos seeds alice 0),
  (macA, [], .write todos solar alice 0),
  (macA, [], .grant { id := 10, scope := .entry todos door, role := .write, grantee := .principal (.vault bob),
                       issuer := alice, parent := none }),
  (macA, [], .grant { id := 11, scope := .entry todos door, role := .read, grantee := .principal (.vault carol),
                       issuer := alice, parent := none }),
  -- making the coop owner of the todo is governance: Alice's passkey
  (passkeyA, [], .grant { id := 12, scope := .entry todos door, role := .owner, grantee := .principal (.vault coop),
                           issuer := alice, parent := none })]
#guard refused s15 == []

-- a device alone can't make anyone owner
#guard !accepted s4 (attempt macA [] (.grant { id := 13, scope := .entry todos door, role := .owner,
                                               grantee := .principal (.vault coop), issuer := alice, parent := none }))
#guard accepted s15 (attempt macB [] (.write todos door bob 0))
#guard !accepted s15 (attempt macC [] (.write todos door carol 0))
#guard opens' s15 macC (.entry todos door) && !opens' s15 macC (.entry todos seeds)
#guard !opens' s15 macB (.entry todos solar)

def s16a : List Op := s15 ++ chain 110 [
  -- acting for the coop, through Bob's vault, Bob gives Dave read
  (macB, [], .grant { id := 14, scope := .entry todos door, role := .read, grantee := .principal (.vault dave),
                       issuer := coop, parent := some 12 } [bob]),
  -- Alice raises Carol to write and takes Bob's own write away
  (macA, [], .grant { id := 15, scope := .entry todos door, role := .write, grantee := .principal (.vault carol),
                       issuer := alice, parent := none }),
  (macA, [], .revoke 10 alice [100, 101, 102])]
#guard refused s16a == []

-- Bob still reaches the todo through the coop, so its key didn't rotate
#guard entitled (view s16a) macB (.entry todos door)
#guard (view s16a).epochOf (.entry todos door) == (view s15).epochOf (.entry todos door)
#guard opens' s16a macD (.entry todos door) && accepted s16a (attempt macC [] (.write todos door carol 0))

def s16 : List Op := s16a ++ chain 120 [
  -- taking the coop's owner cap away is governance, and ends the read Bob gave Dave, which Alice had seen
  (passkeyA, [], .revoke 12 alice [110])]
#guard refused s16 == []

#guard !entitled (view s16) macB (.entry todos door) && !entitled (view s16) macD (.entry todos door)
#guard (view s16).epochOf (.entry todos door) == (view s16a).epochOf (.entry todos door) + 1
#guard !opens' s16 macB (.entry todos door) && !opens' s16 macD (.entry todos door)
#guard opens' s16 macC (.entry todos door) && opens' s16 macA (.entry todos door)
#guard !accepted s16 (attempt macB [] (.write todos door coop 1 (via := [bob])))

/-! ## Keys ops carry only the boxes the schedule seals -/

-- Alice's Mac boxes Welcome's key to the Handbook key; Carol's Mac, which can't open it, can't box it
#guard accepted s5 (attempt macA [] (.keys (.entry handbook welcome) 0 [.scoped (.space handbook) 0]))
#guard !accepted s5 (attempt macC [] (.keys (.entry handbook welcome) 0 []))
-- a box the schedule doesn't seal is refused, and so is a key of an epoch that doesn't exist yet
#guard !accepted s5 (attempt macA [] (.keys (.entry handbook welcome) 0 [.signer macC]))
#guard !accepted s5 (attempt macA [] (.keys (.entry handbook welcome) 1 []))
-- only a public key is published
#guard !accepted s5 (attempt macA [] (.keys (.entry handbook welcome) 0 [] true))
#guard accepted s7 (attempt macA [] (.keys (.entry handbook charter) 0 [] true))

/-! ## A coop that stops reading rotates the key, though its members still read

Alice's second coop reads her Notes, then stops. Alice still reads Notes as its founder, but the coop's key would
carry the Notes key to whoever joins the coop later, so the key rotates. Bob joins and opens only the old key: a
vault's newcomers inherit what it could read. -/

def coop2 := 202
def gap : List Op := s4 ++ chain 190 [
  (passkeyA, [], .genesis coop2 .coop [.vault alice] 1),
  (macA, [], .grant { id := 20, scope := .space notes, role := .read, grantee := .principal (.vault coop2),
                       issuer := alice, parent := none }),
  (macA, [], .revoke 20 alice []),
  (passkeyA, [passkeyB], .addOwner coop2 (.vault bob))]
#guard refused gap == []

#guard (view gap).epochOf (.space notes) == (view s4).epochOf (.space notes) + 1
#guard !opens' gap macB (.space notes) && opens' gap macA (.space notes)
#guard knows (view gap) [.signer macB] (.scoped (.space notes) 0)

/-! ## Scenario 17: each todo syncs on its own -/

-- Alice's Mac answers Carol's Mac with the door todo only
#guard (respond s15 macC).any (·.writeTarget? == some (todos, door))
#guard (respond s15 macC).all fun o => o.writeTarget? == none || o.writeTarget? == some (todos, door)
-- a device with no cap on it gets none of it
#guard (respond s15 stranger).all (·.writeTarget? == none)
-- after the coop lost the todo, Dave's Mac gets none of its edits, only the revocation that ended its read, as Bob's
-- Mac does for the coop's owner cap
#guard (respond s16 macD).all (·.writeTarget? == none)
#guard [macD, macB].all fun d => (respond s16 d).any (·.takesFrom (view s16) s16 d)
#guard !(respond s16 stranger).any (·.takesFrom (view s16) s16 stranger)

-- Each Mac starts with its own vault and what Alice's Mac sent it. Then the server and Alice go offline, Bob
-- edits the door todo, and Bob's Mac and Carol's Mac sync directly.
def ownVault (v : VaultId) : List Op := s2.filter (·.vaultOf? == some v)
def bobMac : List Op := receive (ownVault bob) (respond s15 macB) ++ chain 130 [(macB, [], .write todos door bob 0 [100])]
def carolMac : List Op := receive (ownVault carol) (respond s15 macC)

#guard refused bobMac == [] && refused carolMac == []
#guard (itemWrites (view carolMac) todos door).length == 1
-- each answers the other once
def bobMac' := receive bobMac (respond carolMac macB)
def carolMac' := receive carolMac (respond bobMac macC)

-- both now hold Alice's and Bob's edits of the door todo, and Carol's Mac accepts Bob's
#guard (itemWrites (view carolMac') todos door).length == 2
#guard itemWrites (view carolMac') todos door == itemWrites (view bobMac') todos door
-- and neither learned anything about the other todos
#guard itemWrites (view carolMac') todos seeds == [] && itemWrites (view bobMac') todos solar == []

/-! ## Strong removal: a removal cuts what it hadn't seen

A device that was offline makes ops on its old copy of the log, so they sort before a removal made elsewhere in the
meantime. Each such op stands only if it stands without what the removal took away. -/

-- a coop of Alice and Bob where either may act alone
def pair := 201
def sPair : List Op := s2 ++ chain 140 [(passkeyA, [passkeyB], .genesis pair .coop [.vault alice, .vault bob] 1)]

-- Alice goes on, then removes Bob; Bob, offline since the coop began, adds Dave
def backdated (keep : List OpId) : List Op := sPair ++ chain 141 [
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
def clash : List Op := sPair ++ [
  { id := 161, depth := 141, author := passkeyA, cosigners := [], action := .removeOwner pair (.vault bob) [] },
  { id := 160, depth := 141, author := passkeyB, cosigners := [], action := .removeOwner pair (.vault alice) [] }]
#guard ((order clash).map (·.id)).reverse.take 2 == [161, 160]
#guard refused clash == [160]
#guard ((view clash).vault? pair).map (·.owners) == some [.vault alice]

-- a thief holding Alice's second passkey removes the root's passkey from the owners and adds a device; the root,
-- having seen neither, removes the second passkey. It keeps the threshold it had set, which counted that passkey.
def stolen : List Op := twoKeys ++ chain 142 [(passkeyA, [], .removeOwner alice (.signer 77) [141])] ++ offline 170 141 [
  (77, [passkeyA], .removeOwner alice (.signer passkeyA) []),
  (77, [stranger], .addDevice alice stranger)]
#guard refused stolen == [170, 171]
#guard ((view stolen).vault? alice).map (·.owners) == some [.signer passkeyA]
#guard !actsFor (view stolen) stranger alice

-- Alice revokes Bob's write on the door todo, keeping the edit she had seen; Bob's other edit, made offline, is cut,
-- and so is Carol's, which builds on it, though Carol may write
def revokedWriter : List Op := s16a ++ offline 180 113 [
  (macB, [], .write todos door bob 0 [100])] ++ offline 182 115 [
  (macC, [], .write todos door carol 0 [180])]
#guard refused revokedWriter == [180, 182]
#guard (itemWrites (view revokedWriter) todos door).map (·.op) == [100]
-- a branch Bob starts for himself after the revocation is refused, and so is every write on it, even one he makes
-- for the coop, which may still write
def revokedBranch : List Op := s16a ++ offline 190 113 [
  (macB, [], .write todos door bob 0 [100] .new),
  (macB, [], .write todos door coop 0 [190] (.on 190) [bob])]
#guard refused revokedBranch == [190, 191]
#guard accepted s16a (attempt macB [] (.write todos door coop 0 [100] .new [bob]))
-- revoking Bob's write after his edit arrived keeps it: the revocation names it
def keptWriter : List Op := s15 ++ chain 113 [(macB, [], .write todos door bob 0 [100])] ++ chain 114 [
  (macA, [], .revoke 10 alice [113]),
  (macC, [], .write todos door carol 0 [113])]
#guard refused keptWriter == [115]
#guard (itemWrites (view keptWriter) todos door).map (·.op) == [100, 113]

-- handing the root on to a new passkey, then retiring the old one, cuts what the old passkey signs on an old copy;
-- both keep what the old passkey approved before them, as every honest device's draft does
def handover : List Op := s1 ++ chain 140 [
  (passkeyA, [77], .addOwner alice (.signer 77)),
  (passkeyA, [77], .setRoot alice (some 77) [2, 3, 140]),
  (77, [], .removeOwner alice (.signer passkeyA) [2, 3, 140])] ++ offline 150 140 [
  (passkeyA, [stranger], .addDevice alice stranger)]
#guard refused handover == [150]
#guard ((view handover).vault? alice).map (fun v => (v.owners, v.root)) == some ([.signer 77], some 77)
#guard !actsFor (view handover) stranger alice

/-! ## Removals settle from the top down

A removal is only ever kept out by one that ranks above it, so what ranks above a removal must never rest on what it
takes away: a vault's removals come before those of the coops it owns, and a senior revoker's before those of whoever
holds a grant beneath the one revoked. -/

-- Alice gives Dave owner on her Notes, and Dave gives Carol read beneath it. Dave revokes Carol's read on a copy that
-- hadn't seen Alice, the founder, revoke Dave's grant, so Dave's revocation sorts first. The founder ranks first all
-- the same: Dave's grant goes, Carol's with it, and Dave's revocation falls with the grant it rested on.
def seniorRevoke : List Op := s2 ++ chain 700 [
  (macA, [], .foundSpace notes alice),
  (passkeyA, [], .grant ⟨701, .space notes, .owner, .principal (.vault dave), alice, none⟩),
  (macD, [], .grant ⟨702, .space notes, .read, .principal (.vault carol), dave, some 701⟩),
  (macA, [], .write notes welcome alice 0),
  (macA, [], .write notes charter alice 0),
  (passkeyA, [], .revoke 701 alice [700, 701, 702, 703, 704])] ++ offline 720 702 [
  (macD, [], .revoke 702 dave [])]
#guard (((order seniorRevoke).map (·.id)).drop (s2.length + 3)).take 1 == [720]
#guard refused seniorRevoke == [720]
#guard ((view seniorRevoke).grant? 701).isNone && ((view seniorRevoke).grant? 702).isNone

-- Alice's vault gains two more passkeys, either of which approves for it alone, and Alice and Bob found a coop
-- where either acts alone. One passkey removes Bob from the coop on a copy that hadn't seen the other passkey remove it
-- from Alice's vault. Alice's vault settles first, so the coop's removal falls, exactly as on a peer that never held
-- the coop's log.
def tiers : List Op := s2 ++ chain 740 [
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
def vouched : List Op := s15 ++ chain 200 [
  (macA, [], .checkpoint todos door [100]),
  (macA, [], .write todos door alice 0 [100])]
#guard refused vouched == []
-- every peer counts the forged edit while it trusts the curves; once it doesn't, only the vouched one
#guard (itemWrites (view vouched) todos door).map (·.op) == [100, 201]
#guard (itemWrites (view (checkpointed vouched)) todos door).map (·.op) == [100]
-- no checkpoint covers the other todos' edits, so they don't count either; every op but a write still does
#guard itemWrites (view (checkpointed vouched)) todos seeds == []
#guard (view (checkpointed vouched)).grants == (view vouched).grants
-- a device vouches only for its own accepted writes of the entry, and for at least one
#guard accepted s15 (attempt macA [] (.checkpoint todos door [100]))
#guard !accepted s15 (attempt macB [] (.checkpoint todos door [100]))
#guard !accepted s15 (attempt macA [] (.checkpoint todos seeds [100]))
#guard !accepted s15 (attempt macA [] (.checkpoint todos door [100, 999]))
#guard !accepted s15 (attempt macA [] (.checkpoint todos door []))
-- the checkpoint travels with its item: Carol's Mac gets it with the door todo, a stranger gets no item at all
#guard (respond vouched macC).any (·.action == .checkpoint todos door [100])
#guard (respond vouched stranger).all (·.item? == none)

end AvenDB.Examples

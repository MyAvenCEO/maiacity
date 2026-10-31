import Aven.ID.Json
import Aven.ID.Gen
import Aven.ID.Keys
import Aven.ID.SafeJson
import Aven.ID.ClaimJson
import Aven.ID.InviteJson
import Aven.ID.Before
import Aven.ID.CapsJson
import Aven.ID.AuthorizedExamples
import Aven.ID.SettleJson
import Aven.ID.FailJson
import Aven.ID.Expiry
import Aven.ID.Collections
import Aven.ID.KeyFormatsJson
import Aven.ID.SealJson

/-! # The test vectors (README, rule 10)

`lake exe vectors [DIR]` writes the examples and generated cases as JSON, one vector per line, into `DIR`
(`vectors/` by default), where they are committed. Every vector is `{"name", "input", "expected"}`:

- `trees.json`: a tree and its queries as input, the model's result as expected: the cast's examples, the trees that
  break a rule, input that is not a tree, every query on the cast, and generated trees. aven-id's tests and its wasm
  check load it.
- `statements.json`: the cast's devices signing (`Aven.ID.Sign`): who signs what with which key, what is changed
  before verifying, and the answers. aven-id's tests sign and verify with real keys and compare.
- `keys.json`: each cast key's seed and public half (`Aven.ID.Keys`). aven-id's tests derive them with Ed25519 and
  compare, and hold `sandbox/cast.json`'s public halves to them.
- `avenos.json`: what avenOS shows on the cast (`Aven.ID.OS`) and the names it shows vaults by, for
  `sandbox/check.mjs`.
- `passkeys.json`: the test passkeys' P-256 keys (`Aven.ID.P256`), challenges of statements' texts, and assertions
  with what each check says (`Aven.ID.Passkey`). aven-id's tests sign each with the passkey's real key and compare.
- `claims.json`: claim and sign-in traces with every answer and every resulting tree (`Aven.ID.ClaimTrace`), the
  examples and generated ones. aven-id's tests replay them with real keys, a restart reading the tree back.
- `invites.json`: invite, withdrawal and join traces (`Aven.ID.InviteTrace`), with every answer, the tree, the
  members, the invites' states and what the door says of each key after every step. aven-id's tests replay them.
- `caps.json`: cap chains on the cast, each cap with its lines of ops (A32), its CBOR bytes and its hash, with the first
  rule each chain breaks or none (`Aven.ID.Caps`); who keeps a Doc (`Aven.ID.Keeping`); how avenOS shows a cap for a
  passkey tap; and generated chains (`Aven.ID.CapsJson`).
- `authorized.json`: an envelope's signer, Doc and branch, the calls it makes (a merge into main's whole calls), the
  chain it names, and what the reader knows: its context, each signing key's vault, each device's cap and the
  network's members; with each check's verdict, the path, own or chain, and the first check that refuses it
  (`Aven.ID.Authorized`, `Aven.ID.AuthorizedExamples`).
- `collections.json`: a collection's envelopes, the Docs a reader knows, who signs for and governs which vault, and
  whether the collection lists a Doc (`Aven.ID.Collections`, A32): removals, strangers' listings, a Doc out of reach,
  nesting, and the depth.
- `revocations.json`: Docs of Core envelopes, each with its name and what caps reads of it, the revocations a reader
  holds, and each envelope's verdict (`Aven.ID.Revoke`), hand-written and generated; and a Doc its vault deleted, with
  whether each envelope survives the delete (`survives`; a delete Record carries `delete: true` in its body).
- `epochs.json`: who learns which key after a removal, after a heal, and holding a `below` group (`Aven.ID.Epochs`).
- `approvals.json`: signatures, thresholds and digests on the cast, and whether each approval holds; then approvals
  where an owner is a vault, which approves by its own quorum, with a coop of two vaults added (`Aven.ID.Approve`).
- `expiry.json`: writes under a cap that expires, with each envelope's signed time, and whether each counts for the
  clock (`Aven.ID.Expiry`, R12).
- `network.json`: tickets claimed in two orders (A12), removals that clash and MaiaCityGuardian's exit
  (`Aven.ID.Network`, `Aven.ID.Recover`).
- `keep.json`: a keeper's fetch-key links in the order they came, with the keys it takes, its current fetch key and
  its flags; the proofs it serves; what each vault pays; what it keeps under the keep caps it holds, after withdrawals
  and deletes (`Aven.ID.Keep`, A22). Hand-written and generated.
- `safe.json`: requests to a vault's safe from its agent and from Mallory, on a Mac and on a host that keeps Doc keys
  inside, with what each request gives back (`Aven.ID.Safe`, R13).
- `settled.json`: sets of tree statements, each in several orders, and the tree `settle` gives (`Aven.ID.Network`,
  PEERS.md §5): `TreeExamples`, the races one by one, generated sets, and production's store migrated from every
  invite trace (`Aven.ID.Restore`). `tree-ops.json`: `tree/1`'s op ids and a call of each (A32). `records.json`:
  signed records and the newest of each (`Aven.ID.Records`, §6).
  `node.json`: networks losing each peer in turn, with every home relay, who reaches whom and who can fetch the chat
  (`Aven.ID.Node`, R7). `catchup.json`: sources offered against a signed log tip, the one chosen and the ones caught,
  and presence from signed beats (`Aven.ID.CatchUp`). `failures.json`: the nine checks the box runs with the Aven Peer
  stopped, each with what the models say it must see (`Aven.ID.FailJson`, PEERS.md).

- `derivations.json` and `stanzas.json`: avenID's key formats (`Aven.ID.KeyFormats`, A43): BLAKE3's keyed and
  extendable modes, the PRF step's input, salt and seeds, a stanza's AAD, keys and commitment, an epoch's subkeys and
  tags; and the bytes of stanzas, keyring and Doc epochs with their names, and hybrid keys and signatures. aven-id
  derives and encodes each and compares.
- `seals.json`: the one seal for loose envelopes, segments and checkpoints (`Aven.ID.Seal`): each kind's cipher and
  commitment keys, the AAD, the commitment, the padded plaintext and the outside's bytes; Padmé's lengths; paddings a
  reader refuses. aven-db-docs checks each, and seals and opens through XChaCha20-Poly1305 itself.

`bun run up --check` runs it again and fails when the files differ from what is committed. -/

open Lean Aven.ID

def vector (name : String) (input expected : Json) : Json :=
  Json.mkObj [("name", name), ("input", input), ("expected", expected)]

def treeVector (name : String) (t : Tree) (qs : List Query) : Json :=
  vector name (Json.mkObj [("keys", toJson t.keys), ("vaults", (t.json.getObjValD "vaults")),
    ("queries", Json.arr (qs.map Query.json).toArray)]) (t.result qs)

/-- Input that is not a tree: an unknown kind, an owner without its prefix. -/
def formatVectors : List Json :=
  let input (kind owner : String) := Json.mkObj [("keys", toJson ["k"]), ("vaults", Json.arr #[Json.mkObj
    [("id", "a"), ("kind", kind), ("owners", toJson [owner])]]), ("queries", Json.arr #[])]
  -- a tree written before 30 Oct 2026, when the agent's kind was called network (`Aven.ID.Before`)
  let before := Json.mkObj [("keys", toJson ["k"]), ("vaults", Json.arr #[
    Json.mkObj [("id", "a"), ("name", "A's vault"), ("kind", "person"), ("owners", toJson ["key:k"])],
    Json.mkObj [("id", "n"), ("name", "Aven"), ("kind", Kind.agent.before), ("owners", toJson ["vault:a"])]]),
    ("queries", Json.arr #[toJson ["kind", "n"], toJson ["owners", "n"]])]
  [("an unknown kind", input "ghost" "key:k"), ("an owner that is neither key: nor vault:", input "person" "k"),
   ("the agent's kind by its old name, network", before)].map
    fun (name, i) => vector name i (match answerCase i with | .ok j => j | .error e => toJson e)

def generated : Nat := 80

def trees : List Json :=
  [treeVector "the cast: SANDBOX.md's examples" cast ((castExamples ++ mayActOnExamples).map (·.1))] ++
  invalidExamples.map (fun (name, t, _) => treeVector name t (if t.check.isNone then t.everyQuery else [])) ++
  formatVectors ++
  [treeVector "the cast: every query" cast cast.everyQuery] ++
  (List.range generated).map fun i =>
    let t := randomTree (i + 1)
    treeVector s!"generated tree, seed {i + 1}" t t.everyQuery

def avenos : List Json :=
  let people := cast.accounts none
  (hosts.map fun (host, h) => vector s!"{host} may act as" (Json.mkObj [("accounts", host)])
    (toJson (cast.hostAccounts h))) ++
  (people.map fun (p : String) => vector s!"{p}'s Control Room" (Json.mkObj [("sees", p)]) (toJson (cast.sees p))) ++
  (vaultExamples.map fun ((a, target), _) =>
    let shown := cast.opens a (target.getD a)
    vector s!"{a}'s Vault at {target.getD a}" (Json.mkObj [("vault", a), ("target", toJson target)])
      (Json.mkObj [("opens", shown), ("tree", toJson (cast.vaultView a (target.getD a))),
        ("actsThrough", toJson (cast.actsThrough shown))])) ++
  [vector "the cast's names" (Json.mkObj [("names", Json.null)])
    (Json.mkObj (cast.vaults.map fun v => (v.id, toJson v.name)))] ++
  (hosts.filterMap fun (_, h) => match h with
    | .device d => some (vector s!"{d} serves" (Json.mkObj [("serves", d)]) (toJson (cast.actsFor d)))
    | _ => none)

def statements : List Json :=
  signExamples.map fun e =>
    let (input, expected) := e.vector
    vector e.name input expected

def keys : List Json :=
  cast.keys.map fun id =>
    let seed := Keys.seed id
    vector s!"{id}'s test key" (Json.mkObj [("id", id)])
      (Json.mkObj [("seed", Keys.hex seed), ("public", Keys.hex (Keys.publicKey seed))])

def passkeys : List Json :=
  (["a", "b", "c"].map fun p =>
    vector s!"{passkeyId p}'s test key" (Json.mkObj [("id", passkeyId p)])
      (Json.mkObj [("scalar", Keys.hex (Keys.be 32 (P256.scalar (passkeyId p)))), ("spki", passkeyKey p)])) ++
  (([("nothing", ""), ("a statement", "a statement"), ("passkey-a's claim from device-1", (Op.claimOf "a" "1" {}).1.text),
      ("device-2's sign-in", (Op.signInOf "a" "2" {}).1.text)] : List (String × String)).map fun (name, text) =>
    vector s!"the challenge of {name}" (Json.mkObj [("text", text)]) (toJson (challengeOf text))) ++
  ((passkeyExamples.map (boxRelying, ·)) ++ (twoOriginExamples.map (twoOrigins, ·))).map fun (rp, name, m, _) =>
    let a := m.make
    let challenge := challengeOf "a statement"
    vector name (Json.mkObj [("rpId", rp.rpId), ("origins", toJson rp.origins), ("challenge", challenge),
        ("key", "passkey-a"), ("assertion", a.json)])
      (match a.check rp challenge "passkey-a" with
        | .ok () => Json.mkObj [("holds", true)]
        | .error why => Json.mkObj [("error", why.name)])

def generatedTraces : Nat := 40

def claims : List Json :=
  (claimExamples.map fun (name, founding, ops, _) => let (i, e) := traceVector founding ops; vector name i e) ++
  (List.range generatedTraces).map fun n =>
    let (i, e) := traceVector boxFounding (randomTrace n)
    vector s!"generated trace, seed {n}" i e

def generatedMemberTraces : Nat := 40

def invites : List Json :=
  (memberExamples.map fun (name, ops, _) => let (i, e) := memberVector boxMembers ops; vector name i e) ++
  (List.range generatedMemberTraces).map fun n =>
    let (i, e) := memberVector boxMembers (randomMemberTrace n)
    vector s!"generated member trace, seed {n}" i e

def capsVectors : List Json :=
  let chain (cs : List Cap) := Json.mkObj [("context", castCtxJson), ("chain", Json.arr (cs.map Cap.json).toArray)]
  (chainExamples.map fun (name, cs, _) => vector name (chain cs) (chainResult cs)) ++
  (keepingExamples.map fun (name, caps, f, _) =>
    vector s!"who keeps it? {name}"
      (Json.mkObj [("context", castCtxJson), ("caps", Json.arr (caps.map Cap.json).toArray), ("doc", factsJson f)])
      (Json.mkObj [("keepers", toJson (keepersOf noGov noSpawn noLists castCtx.roles caps f))])) ++
  ([capA, capB, capPublic, attRead].map fun c =>
    vector s!"how avenOS shows {c.id}" (Json.mkObj [("show", c.json)]) (Json.mkObj [("text", c.text castCtx.roles)])) ++
  (branchExamples.map fun (b, br, _) =>
    vector s!"does a cap for branches {b.json.compress} write on {br}?"
      (Json.mkObj [("branches", b.json), ("branch", br)])
      (Json.mkObj [("allows", b.allows br.toUTF8.toList)])) ++
  (List.range generatedChains).map fun i =>
    let cs := genChain (i + 1)
    vector s!"generated chain, seed {i + 1}" (chain cs) (chainResult cs)

open AuthorizedExamples in
/-- The reader's verdict on each case of the cast: the envelope, its calls and chain, and what the reader knows. -/
def authorizedVectors : List Json :=
  let call (c : Aven.Core.Call) := Json.mkObj [("op", c.op.text),
    ("params", Json.mkObj (c.params.map fun (p, v) => (Aven.Core.utf8Text p, v.json)))]
  let deviceCap (k : Aven.Core.Bytes) (dc : DeviceCap) := Json.mkObj [("key", Aven.Core.hex k),
    ("device", dc.device), ("vault", dc.vault), ("grants", match dc.grants with
      | none => Json.null
      | some g => Json.arr (g.map Line.json).toArray), ("branches", dc.branches.json), ("host", toJson dc.host)]
  cases.map fun c =>
    let e := c.envelope
    vector c.name
      (Json.mkObj [("context", castCtxJson),
        ("envelope", Json.mkObj [("doc", e.doc.text), ("branch", Aven.Core.utf8Text e.branch),
          ("signer", Aven.Core.hex e.signer)]),
        ("calls", Json.arr (c.calls.map call).toArray), ("chain", Json.arr (c.chain.map Cap.json).toArray),
        ("keys", Json.arr (castKeys.map fun (k, v) => Json.mkObj [("key", Aven.Core.hex k), ("vault", v)]).toArray),
        ("deviceCaps", Json.arr (castDeviceCaps.map fun (k, dc) => deviceCap k dc).toArray),
        ("members", toJson castMembers), ("actor", toJson (c.actor.map (·.text)))])
      (readerVerdictJson c.answer)

open CollectionExamples in
/-- Whether collection `c` lists `d` among envelopes `S`, with everything a reader needs to decide it. -/
def collectionVector (name : String) (S : List Aven.Core.Envelope) (c d : Aven.Core.Facts) : Json :=
  vector name
    (Json.mkObj [("known", Json.arr (known.map factsJson).toArray),
      ("signs", Json.arr #[Json.mkObj [("key", Aven.Core.hex mac), ("vault", Aven.Core.utf8Text samuel)]]),
      ("governs",
        Json.arr #[Json.mkObj [("vault", Aven.Core.utf8Text samuel), ("governed", Aven.Core.utf8Text garden)]]),
      ("depth", toJson collectionDepth),
      ("envelopes", Json.arr (S.map fun e => Json.mkObj [("name", (nm e).text), ("doc", e.doc.text),
        ("branch", Aven.Core.utf8Text e.branch), ("writer", toJson e.writer), ("seq", toJson e.seq),
        ("body", e.body.json), ("signer", Aven.Core.hex e.signer)]).toArray),
      ("collection", c.id.text), ("doc", d.id.text)])
    (Json.mkObj [("lists", toJson (listed S c d))])

open CollectionExamples in
/-- Whether a write to `d` counts under a cap through collection `c`: `d` listed in the write's own past (A42). -/
def writeVector (name : String) (S : List Aven.Core.Envelope) (w : Aven.Core.Envelope) (c d : Aven.Core.Facts) :
    Json :=
  vector name
    (Json.mkObj [("known", Json.arr (known.map factsJson).toArray),
      ("signs", Json.arr #[Json.mkObj [("key", Aven.Core.hex mac), ("vault", Aven.Core.utf8Text samuel)]]),
      ("depth", toJson collectionDepth),
      ("envelopes", Json.arr (S.map fun e => Json.mkObj [("name", (nm e).text), ("doc", e.doc.text),
        ("seq", toJson e.seq), ("prev", toJson (e.prev.map (·.text))), ("deps", toJson (e.deps.map (·.text))),
        ("body", e.body.json), ("signer", Aven.Core.hex e.signer)]).toArray),
      ("write", (nm w).text), ("collection", c.id.text), ("doc", d.id.text)])
    (Json.mkObj [("listedInItsPast", toJson (listedAt S w c d))])

open CollectionExamples in
def collectionVectors : List Json := [
  collectionVector "Samuel's Mac lists p1 in the beach album" beachLog beach p1,
  collectionVector "an entry Samuel's Mac removed leaves the list" beachLog beach p2,
  collectionVector "p2 before its removal" [a1, a2] beach p2,
  collectionVector "Mallory's phone signs for no vault of Samuel's" beachLog beach p3,
  collectionVector "a photo of Ana's vault, which Samuel's doesn't govern" beachLog beach q1,
  collectionVector "a photo of the garden, which Samuel's vault governs" beachLog beach g1,
  collectionVector "trips lists the album, so what the album lists" beachLog trips p1,
  collectionVector "and not what the album no longer lists" beachLog trips p2,
  collectionVector "trips lists the album itself" beachLog trips beach,
  collectionVector "eight collections deep" (chain 7) (link 0) p1,
  collectionVector "nine collections deep: past the depth" (chain 8) (link 0) p1,
  writeVector "Bob's write built on p2's entry counts, whatever the reader caught up on" (beachLog ++ [w1, w2]) w1
    beach p2,
  writeVector "Bob's write built on p2's removal doesn't" (beachLog ++ [w1, w2]) w2 beach p2]

open RevokeExamples in
def revocationVectors : List Json :=
  (revocationExamples.map fun (name, doc, rs, e, _) =>
    vector name (Json.mkObj (docJson doc rs ++ [("envelope", Json.str (nm e).text)]))
      (verdict nm reads doc rs e).json) ++
  (deleteExamples.map fun (name, doc, e, _) =>
    vector s!"a delete: {name}"
      (Json.mkObj (docJson doc [] ++ [("owner", Json.str "alice"), ("envelope", Json.str (nm e).text)]))
      (Json.mkObj [("survives", survives nm isDelete byAlice doc e)])) ++
  (List.range generatedDocs).map fun i =>
    let (doc, rs) := genDoc (i + 1)
    vector s!"generated Doc, seed {i + 1}" (Json.mkObj (docJson doc rs))
      (Json.mkObj (doc.map fun e => ((nm e).text, (verdict nm reads doc rs e).json)))

def epochVectors : List Json :=
  let ask (w : World) (parties : List String) (story p k : String) :=
    vector s!"{story}: does {p} learn {k}?" (Json.mkObj [("world", worldJson w parties), ("party", p), ("key", k)])
      (Json.mkObj [("learns", w.learns p k)])
  (removalExamples.map fun (p, k, _) => ask removalWorld ["alice-peer", "bob-peer-light"] "after Bob's removal" p k) ++
  (healExamples.map fun (p, k, _) => ask healWorld ["alice-peer", "alice-peer-light"] "after Alice's heal" p k) ++
  belowExamples.map fun ((kind, v), _) =>
    let key := kind ++ ":" ++ v
    vector s!"holding Maia City's below group: does bob learn {key}?"
      (Json.mkObj [("world", worldJson (belowWorld.map fun k => k.1 ++ ":" ++ k.2) ["bob"]), ("party", "bob"),
        ("key", key)])
      (Json.mkObj [("learns", belowWorld.learns "bob" (kind, v))])

def approvalVectors : List Json :=
  (approvalExamples.map fun (name, sigs, k, v, d, _) =>
    vector name (Json.mkObj [("tree", "cast"), ("sigs", Json.arr (sigs.map Sig.json).toArray), ("threshold", toJson k),
        ("vault", v), ("digest", d)])
      (Json.mkObj [("approved", cast.approved k v d sigs)])) ++
  quorumExamples.map fun (name, sigs, v, d, _) =>
    vector name (Json.mkObj [("tree", "cast"), ("plus", Json.arr #[garden.json]),
        ("thresholds", Json.mkObj [("garden", toJson (2 : Nat))]), ("sigs", Json.arr (sigs.map Sig.json).toArray),
        ("vault", v), ("digest", d)])
      (Json.mkObj [("approves", gardenCast.approves gardenThreshold v d sigs)])

open RevokeExamples ExpiryExamples in
/-- A write under a cap that expires: the Doc with each envelope's signed time, the cap, its expiry and the write,
and whether it counts for the clock (`Aven.ID.Expiry`, R12). -/
def expiryVectors : List Json :=
  let ask (name : String) (doc : List Aven.Core.Envelope) (e : Aven.Core.Envelope) :=
    vector name (Json.mkObj [("doc", Json.arr (doc.map envelopeJson).toArray), ("expiry", Json.str expiryA.text),
        ("expires", toJson (100 : Nat)), ("write", Json.str (nm e).text)])
      (Json.mkObj [("inTime", inTime nm reads time doc expiryA 100 e)])
  [ask "a write before the expiry, which the ack had seen" expiryDoc bob90,
   ask "a write backdated after an ack of the expiry, which it hadn't seen" expiryDoc bobBackdated,
   ask "a write claiming a time past the expiry" expiryDoc bob105,
   ask "a backdated write before any ack: judged by the time it claims" [bob90, bobBackdated] bobBackdated]

def networkVectors : List Json :=
  let ticket (name : String) (cs : List TicketClaim) :=
    vector name (Json.mkObj [("claims", Json.arr (cs.map TicketClaim.json).toArray)])
      (Json.mkObj [("winner", (winner cs).elim Json.null TicketClaim.json)])
  let settle (owners removed : List String) :=
    vector s!"owners {owners} remove {removed} at once"
      (Json.mkObj [("owners", toJson owners), ("removed", toJson removed)])
      (Json.mkObj [("owners", toJson (settleRemovals owners removed))])
  let keyring : Keyring := ⟨["alice-peer-kem"], ["alice-passkey-seal", "guardian"]⟩
  [ticket "a ticket's claims" claims, ticket "the same claims in another order" claims.reverse,
   settle ["alice-owner", "guardian"] ["guardian"], settle ["alice-owner", "guardian"] ["alice-owner", "guardian"],
   vector "MaiaCityGuardian's exit from Alice's vault"
     (Json.mkObj [("devices", toJson keyring.devices), ("sealers", toJson keyring.sealers), ("guardian", "guardian")])
     (Json.mkObj [("rotate", toJson (keyring.exit "guardian").rotate)])]

open KeepExamples in
def keepVectors : List Json :=
  (bookCases.map fun (name, b, _) =>
    vector s!"what the Aven Peer keeps: {name}"
      (Json.mkObj [("books", b.json), ("docs", toJson (bookDocs.map (·.text)))])
      (Json.mkObj [("kept", toJson ((bookDocs.filter b.keeps).map (·.text)))])) ++
  (keepCases.map fun (name, s, _, _) => vector name (Json.mkObj [("keep", s.json)]) (keepResult s)) ++
  (proofCases.map fun (name, s, e, p, _) =>
    vector s!"proof: {name}" (Json.mkObj [("keep", s.json), ("exporter", e), ("proof", p.json)])
      (Json.mkObj [("served", s.serves e p)])) ++
  (billCases.map fun (v, _) =>
    vector s!"what {v} pays" (Json.mkObj [("keep", keepD1.json), ("uploads", Json.arr (uploads.map (·.json)).toArray),
        ("vault", v)])
      (Json.mkObj [("bill", toJson (keepD1.bill uploads v))])) ++
  [vector "a vault's quota: what the keeper takes, in the order the uploads came"
    (Json.mkObj [("keep", keepD1.json), ("quota", Json.arr #[Json.mkObj [("vault", "alice"),
        ("bytes", toJson (aliceQuota "alice"))]]), ("uploads", Json.arr (quotaUploads.map (·.json)).toArray)])
    (Json.mkObj [("taken", Json.arr ((keepD1.admit aliceQuota [] quotaUploads).map (·.json)).toArray),
      ("spent", Json.mkObj [("alice", toJson (Keep.spent (keepD1.admit aliceQuota [] quotaUploads) "alice"))])])] ++
  (List.range generatedKeeps).map fun i =>
    let s := genKeep (i + 1)
    vector s!"generated keeper, seed {i + 1}" (Json.mkObj [("keep", s.json)]) (keepResult s)

/-- One vector per line, so a change reads as a diff of lines. -/
def render (vs : List Json) : String :=
  "[\n" ++ ",\n".intercalate (vs.map Json.compress) ++ "\n]\n"

def main (args : List String) : IO Unit := do
  let dir : System.FilePath := args.headD "vectors"
  IO.FS.createDirAll dir
  IO.FS.writeFile (dir / "trees.json") (render trees)
  IO.FS.writeFile (dir / "statements.json") (render statements)
  IO.FS.writeFile (dir / "keys.json") (render keys)
  IO.FS.writeFile (dir / "avenos.json") (render avenos)
  IO.FS.writeFile (dir / "passkeys.json") (render passkeys)
  IO.FS.writeFile (dir / "claims.json") (render claims)
  IO.FS.writeFile (dir / "invites.json") (render invites)
  IO.FS.writeFile (dir / "caps.json") (render capsVectors)
  IO.FS.writeFile (dir / "authorized.json") (render authorizedVectors)
  IO.FS.writeFile (dir / "collections.json") (render collectionVectors)
  IO.FS.writeFile (dir / "revocations.json") (render revocationVectors)
  IO.FS.writeFile (dir / "epochs.json") (render epochVectors)
  IO.FS.writeFile (dir / "approvals.json") (render approvalVectors)
  IO.FS.writeFile (dir / "network.json") (render networkVectors)
  IO.FS.writeFile (dir / "expiry.json") (render expiryVectors)
  IO.FS.writeFile (dir / "keep.json") (render keepVectors)
  IO.FS.writeFile (dir / "safe.json") (render Safe.safeVectors)
  IO.FS.writeFile (dir / "settled.json") (render SettleJson.settledVectors)
  IO.FS.writeFile (dir / "records.json") (render SettleJson.recordVectors)
  IO.FS.writeFile (dir / "tree-ops.json") (render SettleJson.treeOpVectors)
  IO.FS.writeFile (dir / "node.json") (render SettleJson.nodeVectors)
  IO.FS.writeFile (dir / "catchup.json") (render SettleJson.catchUpVectors)
  IO.FS.writeFile (dir / "failures.json") (render FailJson.failureVectors)
  IO.FS.writeFile (dir / "derivations.json") (render KeyFormats.derivationVectors)
  IO.FS.writeFile (dir / "stanzas.json") (render KeyFormats.stanzaVectors)
  IO.FS.writeFile (dir / "seals.json") (render Seal.sealVectors)

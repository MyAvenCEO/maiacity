import Lean.Data.Json
import Aven.ID.VaultName

/-! # Vault names' vectors (`vaults.json`)

Each of the cast's vaults: its genesis (kind, nonce) and its name. Then geneses read back: one that reads, and those
that don't (an unknown kind, the old `network`, a nonce cut short, a key the genesis doesn't name). Bytes are hex. -/

open Lean Aven.Core

namespace Aven.ID.VaultName

def vaultVectors : List Json :=
  let vec (name : String) (input expected : Json) :=
    Json.mkObj [("name", name), ("input", input), ("expected", expected)]
  let names := castVaults.map fun (id, k) =>
    let g := castGenesis k id
    vec s!"the name of the cast's {id}" (Json.mkObj [("kind", String.fromUTF8! ⟨(kindBytes k).toArray⟩),
        ("nonce", hex g.nonce)])
      (Json.mkObj [("genesis", hex (encode g.value)), ("name", hex (vaultName g).bytes)])
  let alice := castGenesis .person "alice"
  let reads : List (String × Value) :=
    [("a genesis", alice.value),
     ("an unknown kind", .map [(keyKind, .text (t "planet")), (keyNonce, .bytes alice.nonce)]),
     ("the old network kind", .map [(keyKind, .text (t "network")), (keyNonce, .bytes alice.nonce)]),
     ("a nonce cut short", .map [(keyKind, .text (kindBytes .person)), (keyNonce, .bytes (alice.nonce.take 31))]),
     ("a key the genesis doesn't name", .map [(keyKind, .text (kindBytes .person)), (keyNonce, .bytes alice.nonce),
        (t "owner", .text (t "x"))])]
  names ++ reads.map fun (name, v) =>
    vec s!"read back: {name}" (Json.mkObj [("bytes", hex (encode v))])
      (Json.mkObj [("reads", toJson (Genesis.ofValue? v).isSome)])

end Aven.ID.VaultName

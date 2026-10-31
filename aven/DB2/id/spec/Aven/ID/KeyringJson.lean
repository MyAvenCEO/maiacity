import Lean.Data.Json
import Aven.ID.Keyring
import Aven.ID.KeyFormatsJson

/-! # The keyring Doc's vectors (`keyring.json`)

Alice's keyring as Records: its genesis, a reseal of it and its second epoch, each Record's bytes and name, whether it
is a genesis, and then, over the three, how many stanzas each epoch has and which is current (`Aven.ID.Keyring`). -/

open Lean Aven.Core Aven.ID.KeyFormats

namespace Aven.ID.Keyring

def keyringVectors : List Json :=
  let rs : List (String × Epoch) := [("genesis", aliceGenesis), ("reseal", aliceReseal), ("second", aliceSecond)]
  let records := rs.map fun (name, e) =>
    vec s!"Alice's keyring Record: {name}" (Epoch.json e)
      (Json.mkObj [("bytes", h e.bytes), ("name", h e.name.bytes), ("genesis", toJson (Genesis.ok e))])
  let all := rs.map (·.2)
  let over := vec "Alice's keyring: the three Records"
    (Json.mkObj [("records", Json.arr (rs.map fun (_, e) => h e.bytes).toArray)])
    (Json.mkObj [("stanzas", Json.mkObj (rs.map fun (name, e) => (name, toJson (stanzasOf blake3 all e.name).length))),
      ("current", h ((current blake3 all).map (·.name.bytes) |>.getD []))])
  records ++ [over]

end Aven.ID.Keyring

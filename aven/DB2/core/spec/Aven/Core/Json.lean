import Aven.Core.Cbor
import Lean.Data.Json

/-!
# The readable form

JSON is only how people and test vectors read a Value (A2); the bytes are always its CBOR. Integers are numbers, text
is a string, arrays are arrays, maps are objects, `true`, `false` and `null` are themselves, and a byte string is
`{"bytes": hex}`. Every spec's vectors import this one form.
-/

namespace Aven.Core

open Lean

/-- UTF-8 bytes as a string. -/
def utf8Text (b : Bytes) : String := String.fromUTF8! ⟨b.toArray⟩

partial def Value.json : Value → Json
  | .uint n => toJson n
  | .nint n => toJson (-(n : Int) - 1)
  | .bytes b => Json.mkObj [("bytes", hex b)]
  | .text b => utf8Text b
  | .array xs => Json.arr (xs.map Value.json).toArray
  | .map kvs => Json.mkObj (kvs.map fun (k, v) => (utf8Text k, v.json))
  | .bool b => toJson b
  | .null => Json.null

end Aven.Core

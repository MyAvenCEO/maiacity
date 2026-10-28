/-!
# JSON for the vectors

The few writers every vector file needs, once. Strings are written as given: every string the vectors hold is a name
or a hex id, with no quote or backslash in it.
-/

namespace AvenDB.Json

def str (s : String) : String := "\"" ++ s ++ "\""
def arr (xs : List String) : String := "[" ++ ", ".intercalate xs ++ "]"
def obj (kvs : List (String × String)) : String := "{" ++ ", ".intercalate (kvs.map fun (k, v) => str k ++ ": " ++ v) ++ "}"
def nat (n : Nat) : String := toString n
def bool (b : Bool) : String := if b then "true" else "false"
/-- One item a line: the form every vector file takes, so a diff of the file shows the cases that changed. -/
def lines (xs : List String) : String := "[\n" ++ ",\n".intercalate xs ++ "\n]"

end AvenDB.Json

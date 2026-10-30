/-! # Names

Every vault has a name (PRODUCTION.md, Part C): 1 to 64 characters, none of them a control character. A character is
a Unicode scalar value, as Lean's `String.length` and Rust's `chars()` count them; the control characters are
Unicode's category Cc, U+0000 to U+001F and U+007F to U+009F, which Rust's `char::is_control` names. A name is shown,
never parsed: two vaults may share one, and the id is what tells them apart. -/

namespace Aven.ID

/-- Unicode's category Cc. -/
def isControl (c : Char) : Bool := c.toNat < 0x20 || (0x7f ≤ c.toNat && c.toNat < 0xa0)

def maxName : Nat := 64

/-- A vault's name: 1 to 64 characters, no control characters. -/
def validName (s : String) : Bool := 0 < s.length && s.length ≤ maxName && !s.toList.any isControl

/-- The name a person gives at signup: a name of at most 48 characters, so that every vault named after it fits,
`<name>'s vault` and `<name>'s browser 99999` alike. -/
def maxPersonName : Nat := 48

def validPersonName (s : String) : Bool := validName s && s.length ≤ maxPersonName

/-- Names and whether each is one, written out by hand. -/
def nameExamples : List (String × Bool) :=
  [("Alice's vault", true), ("Maia City", true), ("a", true), ("", false), (" ", true),
   ("Zoë's vault", true), ("名前", true), ("two\nlines", false), ("a\ttab", false), ("\x7f", false),
   ("\u0085next line", false), (" no-break space", true), ("".pushn 'x' 64, true), ("".pushn 'x' 65, false),
   ("".pushn 'é' 64, true)]

set_option maxRecDepth 8000 in
theorem name_examples : nameExamples.all (fun (s, ok) => validName s == ok) = true := by decide

set_option maxRecDepth 8000 in
theorem person_name_examples : ([("Alice", true), ("".pushn 'x' 48, true), ("".pushn 'x' 49, false), ("", false),
    ("a\nb", false)] : List (String × Bool)).all (fun (s, ok) => validPersonName s == ok) = true := by decide

end Aven.ID

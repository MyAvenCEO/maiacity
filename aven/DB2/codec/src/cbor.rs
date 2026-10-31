//! A Value and the one codec (`Aven.Core.Cbor`): deterministic CBOR, RFC 8949's core deterministic encoding, in a
//! strict profile:
//!
//! - unsigned and negative integers below 2⁶⁴, byte strings, text, arrays, maps, `true`, `false`, `null`;
//! - no floats, no tags, no other simple values, no indefinite lengths;
//! - every length and number in its shortest form;
//! - map keys are text, sorted by their encodings (shorter first, then bytewise), with no duplicates;
//! - text is valid UTF-8 (RFC 3629).
//!
//! `decode` accepts exactly the encodings of Values, so bytes that don't encode back to themselves are refused, as
//! Lean proves of its decoder (`encode_decode`). Nothing nests deeper than [`MAX_DEPTH`], as Lean's `maxDepth`, so a
//! hostile input can't exhaust the stack (ARCHITECTURE.md rule 10).

use alloc::string::String;
use alloc::vec::Vec;

/// A Value in the strict profile. `Nint(n)` is the integer `-1 - n`. A map's entries may be held in any order;
/// `encode` writes them in the codec's, and `decode` gives them in it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Value {
    Uint(u64),
    Nint(u64),
    Bytes(Vec<u8>),
    Text(String),
    Array(Vec<Value>),
    Map(Vec<(String, Value)>),
    Bool(bool),
    Null,
}

/// The deepest Value `decode` accepts (`Aven.Core.maxDepth`): a scalar or an empty array or map is 1 deep, and each
/// array or map around it one more.
pub const MAX_DEPTH: usize = 512;

/// A data item's head: its major type and its argument, in the shortest form (`Aven.Core.head`).
fn head(major: u8, n: u64, out: &mut Vec<u8>) {
    let m = major << 5;
    if n < 24 {
        out.push(m | n as u8);
    } else if n < 256 {
        out.extend_from_slice(&[m | 24, n as u8]);
    } else if n < 65_536 {
        out.push(m | 25);
        out.extend_from_slice(&(n as u16).to_be_bytes());
    } else if n < 4_294_967_296 {
        out.push(m | 26);
        out.extend_from_slice(&(n as u32).to_be_bytes());
    } else {
        out.push(m | 27);
        out.extend_from_slice(&n.to_be_bytes());
    }
}

/// The codec's order of map keys (`keyBytes` under `lexLt`): a key's encoding starts with its length, so shorter keys
/// come first, then bytewise.
fn key_order(a: &str, b: &str) -> core::cmp::Ordering {
    a.len()
        .cmp(&b.len())
        .then_with(|| a.as_bytes().cmp(b.as_bytes()))
}

/// A Value's one encoding (`Aven.Core.encode`). A map is written in the codec's key order, whatever order it is held
/// in; a map with a key twice has no encoding the decoder accepts.
pub fn encode(v: &Value) -> Vec<u8> {
    let mut out = Vec::new();
    write(v, &mut out);
    out
}

fn write(v: &Value, out: &mut Vec<u8>) {
    match v {
        Value::Uint(n) => head(0, *n, out),
        Value::Nint(n) => head(1, *n, out),
        Value::Bytes(b) => {
            head(2, b.len() as u64, out);
            out.extend_from_slice(b);
        }
        Value::Text(s) => {
            head(3, s.len() as u64, out);
            out.extend_from_slice(s.as_bytes());
        }
        Value::Array(xs) => {
            head(4, xs.len() as u64, out);
            for x in xs {
                write(x, out);
            }
        }
        Value::Map(kvs) => {
            head(5, kvs.len() as u64, out);
            let mut sorted: Vec<&(String, Value)> = kvs.iter().collect();
            sorted.sort_by(|a, b| key_order(&a.0, &b.0));
            for (k, x) in sorted {
                head(3, k.len() as u64, out);
                out.extend_from_slice(k.as_bytes());
                write(x, out);
            }
        }
        Value::Bool(false) => out.push(0xF4),
        Value::Bool(true) => out.push(0xF5),
        Value::Null => out.push(0xF6),
    }
}

/// A whole byte string as one Value (`Aven.Core.decodeAll`): nothing may follow it. `None` for anything that isn't
/// the one encoding of a Value, or that nests deeper than [`MAX_DEPTH`].
pub fn decode(bytes: &[u8]) -> Option<Value> {
    let mut r = Reader { bytes, at: 0 };
    let v = r.item(0)?;
    (r.at == bytes.len()).then_some(v)
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn take(&mut self, n: usize) -> Option<&[u8]> {
        let end = self.at.checked_add(n)?;
        let s = self.bytes.get(self.at..end)?;
        self.at = end;
        Some(s)
    }

    /// A head (`readHead`): refused unless its argument is in its shortest form; indefinite lengths and reserved forms
    /// are refused.
    fn head(&mut self) -> Option<(u8, u64)> {
        let b = *self.take(1)?.first()?;
        let (major, ai) = (b >> 5, b & 31);
        let (k, lo) = match ai {
            0..=23 => return Some((major, ai as u64)),
            24 => (1, 24),
            25 => (2, 256),
            26 => (4, 65_536),
            27 => (8, 4_294_967_296),
            _ => return None,
        };
        let n = self.take(k)?.iter().fold(0u64, |n, &b| (n << 8) | b as u64);
        (n >= lo).then_some((major, n))
    }

    /// A length that the bytes left could hold, as a `usize`.
    fn len(&self, n: u64) -> Option<usize> {
        let n = usize::try_from(n).ok()?;
        (n <= self.bytes.len() - self.at).then_some(n)
    }

    fn text(&mut self, n: u64) -> Option<String> {
        let n = self.len(n)?;
        let s = core::str::from_utf8(self.take(n)?).ok()?;
        Some(String::from(s))
    }

    /// One item inside `depth` arrays and maps: it is at least `depth + 1` deep.
    fn item(&mut self, depth: usize) -> Option<Value> {
        if depth >= MAX_DEPTH {
            return None;
        }
        let (major, n) = self.head()?;
        match major {
            0 => Some(Value::Uint(n)),
            1 => Some(Value::Nint(n)),
            2 => {
                let n = self.len(n)?;
                Some(Value::Bytes(self.take(n)?.to_vec()))
            }
            3 => Some(Value::Text(self.text(n)?)),
            4 => {
                // every item takes at least one byte, so the bytes left bound the count
                let mut xs = Vec::with_capacity(self.len(n)?);
                for _ in 0..n {
                    xs.push(self.item(depth + 1)?);
                }
                Some(Value::Array(xs))
            }
            5 => {
                let mut kvs: Vec<(String, Value)> = Vec::with_capacity(self.len(n)? / 2);
                for _ in 0..n {
                    let (km, kn) = self.head()?;
                    if km != 3 {
                        return None;
                    }
                    let k = self.text(kn)?;
                    // sorted strictly: in the codec's order, and no key twice
                    if let Some((last, _)) = kvs.last()
                        && key_order(last, &k) != core::cmp::Ordering::Less
                    {
                        return None;
                    }
                    let v = self.item(depth + 1)?;
                    kvs.push((k, v));
                }
                Some(Value::Map(kvs))
            }
            7 => match n {
                20 => Some(Value::Bool(false)),
                21 => Some(Value::Bool(true)),
                22 => Some(Value::Null),
                _ => None,
            },
            _ => None,
        }
    }
}

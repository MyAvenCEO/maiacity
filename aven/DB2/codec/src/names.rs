//! Hashes, Doc ids and type ids (`Aven.Core.Names`). A Value is named by the BLAKE3 hash of its one encoding; a Doc
//! by its unsigned genesis's name (A30); a type id names a version of a type, `<type Doc>/<schema hash>`. In CBOR a hash
//! is a byte string of its 32 bytes; `b3:<hex>` and `d:<hex>` are only the readable form.

use alloc::string::String;
use alloc::vec;

use crate::cbor::{Value, encode};

/// BLAKE3's 32 bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Hash(pub [u8; 32]);

/// A Doc's name: its genesis's name, the hash of its label and body, unsigned (A30).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct DocId(pub Hash);

/// A version of a type: its type Doc and its schema's hash.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct TypeId {
    pub r#type: DocId,
    pub schema: Hash,
}

fn hex(bytes: &[u8], out: &mut String) {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    for b in bytes {
        out.push(DIGITS[(b >> 4) as usize] as char);
        out.push(DIGITS[(b & 15) as usize] as char);
    }
}

fn unhex(s: &str) -> Option<[u8; 32]> {
    let s = s.as_bytes();
    if s.len() != 64 {
        return None;
    }
    let digit = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        _ => None,
    };
    let mut out = [0u8; 32];
    for (i, o) in out.iter_mut().enumerate() {
        *o = (digit(s[2 * i])? << 4) | digit(s[2 * i + 1])?;
    }
    Some(out)
}

impl Hash {
    /// A hash read back from its CBOR (`Hash.ofValue?`): a byte string of exactly 32 bytes; anything else is no hash.
    /// The one reader of a hash in CBOR (A45).
    pub fn of_value(v: &Value) -> Option<Hash> {
        match v {
            Value::Bytes(b) => b.as_slice().try_into().ok().map(Hash),
            _ => None,
        }
    }

    /// `b3:<hex>`.
    pub fn text(&self) -> String {
        let mut s = String::from("b3:");
        hex(&self.0, &mut s);
        s
    }

    /// `b3:<64 lowercase hex>`, and nothing else.
    pub fn parse(s: &str) -> Option<Hash> {
        unhex(s.strip_prefix("b3:")?).map(Hash)
    }

    pub fn value(&self) -> Value {
        Value::Bytes(self.0.to_vec())
    }
}

impl DocId {
    /// `d:<hex>`.
    pub fn text(&self) -> String {
        let mut s = String::from("d:");
        hex(&self.0.0, &mut s);
        s
    }

    pub fn parse(s: &str) -> Option<DocId> {
        unhex(s.strip_prefix("d:")?).map(|b| DocId(Hash(b)))
    }
}

impl TypeId {
    /// `<type Doc>/<schema hash>`: `d:<hex>/b3:<hex>`.
    pub fn text(&self) -> String {
        let mut s = self.r#type.text();
        s.push('/');
        s.push_str(&self.schema.text());
        s
    }

    /// `[type Doc's hash, schema hash]`, two byte strings.
    pub fn value(&self) -> Value {
        Value::Array(vec![self.r#type.0.value(), self.schema.value()])
    }

    pub fn of_value(v: &Value) -> Option<TypeId> {
        match v {
            Value::Array(xs) => match xs.as_slice() {
                [t, s] => Some(TypeId {
                    r#type: DocId(Hash::of_value(t)?),
                    schema: Hash::of_value(s)?,
                }),
                _ => None,
            },
            _ => None,
        }
    }
}

/// BLAKE3 itself, the hash every example and vector uses.
pub fn blake3(bytes: &[u8]) -> Hash {
    Hash(*::blake3::hash(bytes).as_bytes())
}

/// A Value's name: the hash of its one encoding (`nameOf`).
pub fn name_of(v: &Value) -> Hash {
    blake3(&encode(v))
}

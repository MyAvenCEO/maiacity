//! Reading the Values avenID's key formats are made of (`Aven.ID.KeyFormats`, `Aven.Core.Hybrid`): a map with exactly
//! the keys a format names, and byte strings of exactly their lengths.

use aven_core::Value;

pub(crate) fn text(s: &str) -> Value {
    Value::Text(s.to_string())
}

pub(crate) fn bytes(b: &[u8]) -> Value {
    Value::Bytes(b.to_vec())
}

/// A map's entries, when it has exactly the `required` keys and at most the `optional` ones.
pub(crate) fn fields<'a>(v: &'a Value, required: &[&str], optional: &[&str]) -> Option<Fields<'a>> {
    let Value::Map(kvs) = v else { return None };
    let known = |k: &str| required.contains(&k) || optional.contains(&k);
    if !kvs.iter().all(|(k, _)| known(k))
        || !required.iter().all(|r| kvs.iter().any(|(k, _)| k == r))
    {
        return None;
    }
    Some(Fields(kvs))
}

pub(crate) struct Fields<'a>(&'a [(String, Value)]);

impl<'a> Fields<'a> {
    pub(crate) fn get(&self, key: &str) -> Option<&'a Value> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub(crate) fn bytes(&self, key: &str) -> Option<&'a [u8]> {
        match self.get(key)? {
            Value::Bytes(b) => Some(b),
            _ => None,
        }
    }

    pub(crate) fn array<const N: usize>(&self, key: &str) -> Option<[u8; N]> {
        self.bytes(key)?.try_into().ok()
    }

    pub(crate) fn uint(&self, key: &str) -> Option<u64> {
        match self.get(key)? {
            Value::Uint(n) => Some(*n),
            _ => None,
        }
    }

    pub(crate) fn text(&self, key: &str) -> Option<&'a str> {
        match self.get(key)? {
            Value::Text(s) => Some(s),
            _ => None,
        }
    }
}

//! avenID's Records in a Doc (`Aven.ID.AccessRecords`, A39, A30): a Doc's access map holds Records of avenID's
//! built-in types `cap`, `revoke` and `epoch`. Each is its body with its signatures beside it under `sigs`, each
//! signature `{"sig", "signer"}` over the Record's one name, the label implied by its type and never stored.
//!
//! Each reader keeps a Value only if writing the Record back gives the very same Value, so a Record has one form
//! (`CapRecord.ofValue?_value` and the others). [`id_builtin_fit`] is the check the docs layer asks for each of the
//! three types, and none for any other.

use aven_core::{DocId, Hash, Value, encode, name_of};

use super::chain::Cap;
use super::revoke::Revocation;
use super::types::builtin_type;
use crate::epoch::Epoch;

/// One signature beside a Record (A30): the key that made it, and the signature, both as bytes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SigEntry {
    pub signer: Vec<u8>,
    pub sig: Vec<u8>,
}

impl SigEntry {
    pub fn value(&self) -> Value {
        Value::Map(vec![
            ("sig".into(), Value::Bytes(self.sig.clone())),
            ("signer".into(), Value::Bytes(self.signer.clone())),
        ])
    }

    pub fn of_value(v: &Value) -> Option<SigEntry> {
        match v {
            Value::Map(kvs) => match kvs.as_slice() {
                [(a, Value::Bytes(sig)), (b, Value::Bytes(signer))] if a == "sig" && b == "signer" => {
                    Some(SigEntry {
                        signer: signer.clone(),
                        sig: sig.clone(),
                    })
                }
                _ => None,
            },
            _ => None,
        }
    }
}

/// A body with its signatures beside it, under `sigs` (`withSigs`).
fn with_sigs(body: Value, sigs: &[SigEntry]) -> Value {
    match body {
        Value::Map(mut kvs) => {
            kvs.push((
                "sigs".into(),
                Value::Array(sigs.iter().map(SigEntry::value).collect()),
            ));
            Value::Map(kvs)
        }
        v => v,
    }
}

/// A Record's fields without its signatures, and its signatures (`splitSigs`).
fn split_sigs(v: &Value) -> Option<(Value, Vec<SigEntry>)> {
    let Value::Map(kvs) = v else { return None };
    let sigs = match kvs.iter().find(|(k, _)| k == "sigs")? {
        (_, Value::Array(ss)) => ss.iter().map(SigEntry::of_value).collect::<Option<_>>()?,
        _ => return None,
    };
    let body = kvs.iter().filter(|(k, _)| k != "sigs").cloned().collect();
    Some((Value::Map(body), sigs))
}

/// Writing it back gives the same Value: the codec writes maps in its own order, so the same encoding.
fn same(a: &Value, b: &Value) -> bool {
    encode(a) == encode(b)
}

/// A cap Record: a cap and its signatures.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CapRecord {
    pub cap: Cap,
    pub sigs: Vec<SigEntry>,
}

impl CapRecord {
    pub fn value(&self) -> Value {
        with_sigs(self.cap.body(), &self.sigs)
    }

    /// Only a cap Record's one form; the cap's id is its digest (`CapRecord.ofValue?`).
    pub fn of_value(v: &Value) -> Option<CapRecord> {
        let (body, sigs) = split_sigs(v)?;
        let mut cap = Cap::of_body(&body, String::new(), String::new(), vec![])?;
        cap.id = cap.digest().text();
        let r = CapRecord { cap, sigs };
        same(&r.value(), v).then_some(r)
    }
}

fn opt_hash(h: &Option<Hash>) -> Value {
    h.map_or(Value::Null, |h| Value::Bytes(h.0.to_vec()))
}

fn hash_of(v: &Value) -> Option<Hash> {
    match v {
        Value::Bytes(b) => Some(Hash(b.as_slice().try_into().ok()?)),
        _ => None,
    }
}

impl Revocation {
    /// What a revocation says: the cap it ends, the envelope it lives as in the Doc, or the names it keeps there when
    /// it lives elsewhere (`Revocation.body`). Its id is this body's name.
    pub fn body(&self) -> Value {
        Value::Map(vec![
            ("cap".into(), Value::Bytes(self.cap.0.to_vec())),
            (
                "kept".into(),
                self.kept.as_ref().map_or(Value::Null, |ks| {
                    Value::Array(ks.iter().map(|k| Value::Bytes(k.0.to_vec())).collect())
                }),
            ),
            ("envelope".into(), opt_hash(&self.envelope)),
        ])
    }

    /// Its id: the name of its body (`Revocation.digest`).
    pub fn digest(&self) -> Hash {
        name_of(&self.body())
    }

    fn of_body(body: &Value) -> Option<Revocation> {
        let Value::Map(kvs) = body else { return None };
        let get = |k: &str| kvs.iter().find(|(x, _)| x == k).map(|(_, v)| v);
        let envelope = match get("envelope")? {
            Value::Null => None,
            v => Some(hash_of(v)?),
        };
        let kept = match get("kept")? {
            Value::Null => None,
            Value::Array(ks) => Some(ks.iter().map(hash_of).collect::<Option<_>>()?),
            _ => return None,
        };
        let mut r = Revocation {
            id: Hash([0; 32]),
            cap: hash_of(get("cap")?)?,
            envelope,
            kept,
        };
        r.id = r.digest();
        Some(r)
    }
}

/// A revoke Record: a revocation and its signatures.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RevokeRecord {
    pub revocation: Revocation,
    pub sigs: Vec<SigEntry>,
}

impl RevokeRecord {
    pub fn value(&self) -> Value {
        with_sigs(self.revocation.body(), &self.sigs)
    }

    /// Only a revoke Record's one form; the revocation's id is its digest (`RevokeRecord.ofValue?`).
    pub fn of_value(v: &Value) -> Option<RevokeRecord> {
        let (body, sigs) = split_sigs(v)?;
        let r = RevokeRecord {
            revocation: Revocation::of_body(&body)?,
            sigs,
        };
        same(&r.value(), v).then_some(r)
    }
}

/// An epoch Record: an epoch's key blob and its signatures.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EpochRecord {
    pub epoch: Epoch,
    pub sigs: Vec<SigEntry>,
}

impl EpochRecord {
    pub fn value(&self) -> Value {
        with_sigs(self.epoch.value(), &self.sigs)
    }

    /// Only an epoch Record's one form: the blob as [`Epoch::from_bytes`] reads it (`EpochRecord.ofValue?`).
    pub fn of_value(v: &Value) -> Option<EpochRecord> {
        let (body, sigs) = split_sigs(v)?;
        let r = EpochRecord {
            epoch: Epoch::from_bytes(&encode(&body))?,
            sigs,
        };
        same(&r.value(), v).then_some(r)
    }
}

/// A Record of one of avenID's built-in types, read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IdRecord {
    Cap(CapRecord),
    Revoke(RevokeRecord),
    Epoch(EpochRecord),
}

/// How a Record of each of avenID's built-in types must look in a Doc, by its type (`idBuiltinFit`): `None` for a type
/// that isn't avenID's, else whether the Value reads as a Record of it, and the Record.
pub fn id_builtin_fit(t: &DocId, v: &Value) -> Option<Option<IdRecord>> {
    if *t == builtin_type("cap") {
        Some(CapRecord::of_value(v).map(IdRecord::Cap))
    } else if *t == builtin_type("revoke") {
        Some(RevokeRecord::of_value(v).map(IdRecord::Revoke))
    } else if *t == builtin_type("epoch") {
        Some(EpochRecord::of_value(v).map(IdRecord::Epoch))
    } else {
        None
    }
}

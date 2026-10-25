//! Optimistic local read assumptions. These restrict ordinary mutations; they
//! grant no permission and are rechecked after any delayed owner ceremony.
use serde_json::{Value, json};
use crate::{id::{BlobId, SignerId}, lab::Lab};
use super::{Refused, bad};

const MAX_CHECKS: usize = 16;
const MAX_QUERY: usize = 65_536;
const MAX_RESULT: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct ReadGuard {
    pub(crate) device: SignerId,
    pub(crate) query: Value,
    pub(crate) digest: String,
    pub(crate) approval_challenge: Option<[u8;32]>,
}

struct Hasher { hash: blake3::Hasher, remaining: usize }
impl std::io::Write for Hasher {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > self.remaining { return Err(std::io::Error::other("read guard encoding exceeds its bound")); }
        self.remaining -= bytes.len(); self.hash.update(bytes); Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
}
fn digest(value: &Value, limit: usize) -> Result<String, Refused> {
    let mut writer = Hasher { hash: blake3::Hasher::new(), remaining: limit };
    writer.hash.update(b"avendb-local-read-guard-v1");
    serde_json::to_writer(&mut writer,value).map_err(|_|bad("read guard encoding exceeds its bound"))?;
    Ok(writer.hash.finalize().to_hex().to_string())
}
fn query_ok(query: &Value) -> Result<(), Refused> {
    digest(query,MAX_QUERY)?;
    match super::name(query) {
        Some("entry_views") if query.get("entries").is_some() || query.get("tag").is_some() || query.get("types").is_some() || query.get("kind").is_some() => Ok(()),
        Some("schemas" | "world_summary") => Ok(()),
        _ => Err(bad("read guard requires a deterministic scoped local inventory, schemas or navigation summary")),
    }
}
fn read(lab: &Lab, me: SignerId, query: &Value) -> Result<Value, Refused> {
    query_ok(query)?;
    let out=super::read(lab,me,query);
    if out.get("ok").is_none_or(Value::is_null) { return Err(bad("read guard dependency is unavailable")); }
    Ok(out)
}
pub(super) fn capture(lab:&Lab,me:SignerId,query:&Value)->Result<Value,Refused> {
    let out=read(lab,me,query)?;
    let hash=digest(&out,MAX_RESULT)?;
    Ok(json!({"value":out["ok"],"guard":{"query":query,"digest":hash}}))
}
pub(super) fn parse(me:SignerId,checks:&Value)->Result<Vec<ReadGuard>,Refused> {
    let checks=checks.as_array().ok_or_else(||bad("guarded change requires checks array"))?;
    if checks.is_empty() || checks.len()>MAX_CHECKS { return Err(bad("guarded change requires 1 to 16 checks")); }
    checks.iter().map(|check| {
        let object=check.as_object().ok_or_else(||bad("read guard is an object"))?;
        if object.keys().any(|key|key!="query"&&key!="digest") { return Err(bad("unknown read guard field")); }
        let query=object.get("query").ok_or_else(||bad("read guard requires query"))?;
        query_ok(query)?;
        let hash=object.get("digest").and_then(Value::as_str).ok_or_else(||bad("read guard requires digest"))?;
        BlobId::from_hex(hash).ok_or_else(||bad("read guard digest must be 32 bytes of hex"))?;
        Ok(ReadGuard{device:me,query:query.clone(),digest:hash.to_owned(),approval_challenge:None})
    }).collect()
}
pub(super) fn validate(lab:&Lab,me:SignerId,checks:&[ReadGuard])->Result<(),Refused> {
    // Bound the total encoded dependency bytes as well as each read; no buffer copies.
    let mut remaining=MAX_RESULT;
    for guard in checks {
        if guard.device!=me { return Err(bad("read guard belongs to another device")); }
        let out=read(lab,me,&guard.query)?;
        let mut writer=Hasher{hash:blake3::Hasher::new(),remaining};
        writer.hash.update(b"avendb-local-read-guard-v1");
        serde_json::to_writer(&mut writer,&out).map_err(|_|bad("combined read guard results exceed their bound"))?;
        remaining=writer.remaining;
        if writer.hash.finalize().to_hex().as_str()!=guard.digest { return Err(bad("read guard is stale; read dependencies and plan again")); }
    }
    Ok(())
}

//! The one small record every peer keeps through its store (SANDBOX.md, "Storage"): when it first started, as a blob
//! and the ref `first-start` pointing at it. A restart finds it again; a wiped store is empty, and the next start
//! writes a new one. The same code runs in every peer, over whichever backend it was configured with.

use aven_db_store::{Error, Hash, RefName, Result, Store};
use aven_gen1::timeline;
use bytes::Bytes;
use serde_json::json;

pub const REF: &str = "first-start";

#[derive(Clone, Debug, PartialEq)]
pub struct Record {
    /// when the peer first started on this store, in milliseconds since the epoch
    pub first: u64,
    pub blob: Hash,
    /// whether the store already held it: a restart, not a first start
    pub kept: bool,
}

/// The store's record of the peer's first start, written now if the store has none.
pub async fn first_start<S: Store + ?Sized>(store: &S, me: &str, now: u64) -> Result<Record> {
    let name = RefName::new(REF)?;
    if let Some(blob) = store.get_ref(&name).await? {
        let bytes = store
            .get(&blob)
            .await?
            .ok_or_else(|| Error::Corrupt(format!("{REF} points at a missing blob")))?;
        let first = serde_json::from_slice::<serde_json::Value>(&bytes)
            .ok()
            .and_then(|v| v["first"].as_u64())
            .ok_or_else(|| Error::Corrupt(format!("{REF}'s blob has no first start")))?;
        return Ok(Record {
            first,
            blob,
            kept: true,
        });
    }
    let blob = store
        .put(Bytes::from(json!({ "peer": me, "first": now }).to_string()))
        .await?;
    store.set_ref(&name, None, blob).await?;
    Ok(Record {
        first: now,
        blob,
        kept: false,
    })
}

/// The timeline's line for it: `stored`, with the backend's name.
pub fn line(t: u64, me: &str, store: &str, record: &Record) -> String {
    timeline::line(
        t,
        me,
        "stored",
        json!({ "store": store, "first": record.first, "blob": record.blob.to_hex(), "kept": record.kept }),
    )
}

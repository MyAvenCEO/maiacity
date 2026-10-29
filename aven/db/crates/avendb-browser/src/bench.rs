//! The phone-class row of avenDB's bench (`bench` feature, never in a build that ships): what a page's device does
//! with a peer's signed edits, in WebAssembly in a browser, as an iPhone's page does. `aven/ops/ci/avendb-bench-phone.mjs`
//! loads a fixture of signed edits (`aven/db/crates/avendb/tests/all/phone_fixture.rs`: synthetic, the scenarios' cast) and
//! times each call with the page's clock: `benchVerify` checks every edit's signatures alone, and `benchIntake` has a
//! new device take them, a page at a time, as a pull's pages come, its signatures checked as it takes each.
//! `benchUnlock` opens a device again from its shelf (`aven/ops/ci/avendb-bench-unlock.mjs`).

use avendb::lab::Lab;
use avendb::sign::Signed;
use avendb::wire::Wire;
use wasm_bindgen::prelude::*;

/// The signed edits of a fixture: each its length in 4 bytes, big-endian, then its wire bytes.
fn edits(fixture: &[u8]) -> Result<Vec<Signed>, JsError> {
    let (mut out, mut at) = (vec![], 0);
    while at < fixture.len() {
        let len = fixture.get(at..at + 4).ok_or_else(|| JsError::new("a fixture cut short"))?;
        let len = u32::from_be_bytes(len.try_into().expect("4 bytes")) as usize;
        let bytes = fixture.get(at + 4..at + 4 + len).ok_or_else(|| JsError::new("a fixture cut short"))?;
        out.push(Signed::from_wire(bytes).map_err(|e| JsError::new(&format!("no signed edit: {e:?}")))?);
        at += 4 + len;
    }
    Ok(out)
}

/// How many of the fixture's edits there are.
#[wasm_bindgen(js_name = benchCount)]
pub fn bench_count(fixture: &[u8]) -> Result<usize, JsError> {
    Ok(edits(fixture)?.len())
}

/// Checks the signatures of every edit of the fixture: how many check out.
#[wasm_bindgen(js_name = benchVerify)]
pub fn bench_verify(fixture: &[u8]) -> Result<usize, JsError> {
    Ok(edits(fixture)?.iter().filter(|s| s.verify().is_ok()).count())
}

/// A new device takes the fixture's edits `page` at a time, as it takes a peer's pages: how many it holds after.
#[wasm_bindgen(js_name = benchIntake)]
pub fn bench_intake(fixture: &[u8], page: usize) -> Result<usize, JsError> {
    let signed = edits(fixture)?;
    let mut lab = Lab::new();
    let me = lab.device("phone");
    for chunk in signed.chunks(page.max(1)) {
        lab.receive(me, chunk.to_vec(), vec![]);
    }
    Ok(lab.size(me).0)
}

/// What a fixture of `aven/db/crates/avendb/tests/all/unlock_phone.rs` holds, read in its order: each list a count in 4 bytes,
/// big-endian, each item its length in 4 bytes, then its bytes.
struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], JsError> {
        let (head, rest) = self.0.split_at_checked(n).ok_or_else(|| JsError::new("a fixture cut short"))?;
        self.0 = rest;
        Ok(head)
    }

    fn count(&mut self) -> Result<usize, JsError> {
        Ok(u32::from_be_bytes(self.take(4)?.try_into().expect("4 bytes")) as usize)
    }

    fn list(&mut self) -> Result<Vec<&'a [u8]>, JsError> {
        (0..self.count()?).map(|_| { let n = self.count()?; self.take(n) }).collect()
    }
}

/// The iPhone of `unlock_phone.rs` opening again from what its shelf holds (`Lab::restore_warm`), as its page does at
/// unlock: the timers and counts of its device after, as JSON.
#[wasm_bindgen(js_name = benchUnlock)]
pub fn bench_unlock(fixture: &[u8]) -> Result<String, JsError> {
    use avendb::lab::{Backup, Warm};
    use std::sync::Arc;
    let mut r = Reader(fixture);
    let secret: [u8; 32] = r.take(32)?.try_into().expect("32 bytes");
    let checked: [u8; 40] = r.take(40)?.try_into().expect("40 bytes");
    let held = r.count()?;
    let signed = r.list()?.into_iter().map(Signed::from_wire).collect::<Result<Vec<_>, _>>()
        .map_err(|e| JsError::new(&format!("no signed edit: {e:?}")))?;
    let blobs: Vec<Arc<[u8]>> = r.list()?.into_iter().map(Arc::from).collect();
    let owned = |l: Vec<&[u8]>| l.into_iter().map(<[u8]>::to_vec).collect();
    let warm = Warm { keys: owned(r.list()?), views: owned(r.list()?), shown: r.list()?.into_iter().map(|p| p.to_vec().into()).collect(), queries: vec![] };
    let mut lab = Lab::new();
    let me = lab.device_with("Alice's iPhone", secret);
    lab.restore_warm(me, Backup::new(signed, blobs), Some((checked, held)), &warm);
    Ok(lab.perf(me).to_string())
}

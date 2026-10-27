//! The phone-class row of avenDB's bench (`bench` feature, never in a build that ships): what a page's device does
//! with a peer's signed edits, in WebAssembly in a browser, as an iPhone's page does. `scripts/ci/avendb-bench-phone.mjs`
//! loads a fixture of signed edits (`avendb/crates/avendb/tests/phone_fixture.rs`: synthetic, the scenarios' cast) and
//! times each call with the page's clock: `benchVerify` checks every edit's signatures alone, and `benchIntake` has a
//! new device take them, a page at a time, as a pull's pages come, its signatures checked as it takes each.

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

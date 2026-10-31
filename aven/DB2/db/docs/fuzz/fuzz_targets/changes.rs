//! Any bytes as the Loro update inside a member's signed first envelope, its log place and genesis right, so they pass
//! every check before Loro and reach Loro's decoding: refused or judged, never a panic, never an unfit state.
#![no_main]

#[path = "common.rs"]
mod common;

use aven_core::Envelope;
use aven_db_docs::Body;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let w = common::world();
    let mut doc = common::doc();
    let to = 1 + u64::from(data.first().copied().unwrap_or(0));
    let body = Body {
        acks: vec![],
        at: String::new(),
        calls: vec![],
        cap: None,
        changes: data.to_vec(),
        generation: 0,
        from: 0,
        to,
        records: vec![("r".into(), w.version)],
        genesis: Some(w.genesis.clone()),
    };
    let mut e = Envelope {
        doc: w.genesis.id(),
        branch: "main".into(),
        writer: doc.writer_of(&w.device, 0),
        seq: 1,
        prev: None,
        deps: vec![],
        body: body.value(),
        signer: vec![],
        sig: vec![],
    };
    w.device.sign_envelope(&mut e);
    let _ = doc.import(&e.encode(), &common::Allow);
    common::only_counted(&doc);
});

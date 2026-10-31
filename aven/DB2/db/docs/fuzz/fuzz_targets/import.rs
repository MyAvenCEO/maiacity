//! Import under libFuzzer: whatever bytes arrive, a Doc refuses or takes them and never panics, and its live state is
//! only ever what counts. The first byte picks where the rest goes:
//! - 0: as an envelope's bytes, straight to `import`;
//! - 1: as the Loro update inside an envelope a member signed, with its log place right, so it reaches Loro;
//! - 2: as a sealed segment under the Doc's epoch.
#![no_main]

use std::sync::OnceLock;

use aven_core::{DocId, Envelope, Value, blake3};
use aven_db_docs::{Authorize, Body, Device, Doc, EpochKey, Genesis, Limits, Version};
use aven_id::{Secret, TestEntropy};
use libfuzzer_sys::fuzz_target;

struct Allow;

impl Authorize for Allow {
    fn reaches(&self, _: &Genesis, _: &[u8]) -> bool {
        true
    }

    fn authorized(&self, _: &Genesis, _: &Envelope, _: &Body) -> bool {
        true
    }
}

struct World {
    device: Device,
    genesis: Genesis,
    version: Version,
    epoch: EpochKey,
}

fn world() -> &'static World {
    static W: OnceLock<World> = OnceLock::new();
    W.get_or_init(|| {
        let mut e = TestEntropy::new("fuzz");
        let device = Device::from_seeds(&Secret::generate(&mut e), &Secret::generate(&mut e));
        let t = DocId(blake3(b"a fuzzed type"));
        let version = Version { r#type: t, schema: Some(blake3(b"unknown schema")) };
        let genesis = Genesis::new(b"vault", t, &[], [1; 32]);
        let epoch = EpochKey { name: blake3(b"epoch"), key: Secret::generate(&mut e) };
        World { device, genesis, version, epoch }
    })
}

fuzz_target!(|data: &[u8]| {
    let Some((&mode, rest)) = data.split_first() else { return };
    let w = world();
    let mut doc = Doc::open(w.genesis.clone(), &[], Limits::DEFAULTS).expect("opens");
    match mode % 3 {
        0 => {
            let _ = doc.import(rest, &Allow);
        }
        1 => {
            let writer = doc.writer_of(&w.device, 0);
            let to = 1 + u64::from(rest.first().copied().unwrap_or(0));
            let body = Body {
                acks: vec![],
                at: String::new(),
                calls: vec![],
                cap: None,
                changes: rest.to_vec(),
                generation: 0,
                from: 0,
                to,
                records: vec![("r".into(), w.version)],
                genesis: None,
            };
            let mut e = Envelope {
                doc: w.genesis.id(),
                branch: "main".into(),
                writer,
                seq: 1,
                prev: None,
                deps: vec![],
                body: body.value(),
                signer: vec![],
                sig: vec![],
            };
            w.device.sign_envelope(&mut e);
            let _ = doc.import(&e.encode(), &Allow);
        }
        _ => {
            let _ = doc.import_segment(rest, &w.epoch, &Allow);
        }
    }
    // whatever happened, the live state holds only what counts
    let snap = doc.snapshot();
    assert!(snap.version.iter().all(|n| doc.counts(n)));
    let _ = Value::Null;
});

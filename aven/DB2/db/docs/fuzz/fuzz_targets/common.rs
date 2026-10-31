//! What the three fuzz targets share: a member device, a Doc's genesis, its epoch, and the one property every input
//! keeps: the live state holds only envelopes that count.

#![allow(dead_code)]

use std::sync::OnceLock;

use aven_core::{DocId, Envelope, blake3};
use aven_db_docs::{Authorize, Body, Device, Doc, EpochKey, Genesis, Limits, Version};
use aven_id::{Secret, TestEntropy};

pub struct Allow;

impl Authorize for Allow {
    fn reaches(&self, _: &Genesis, _: &[u8]) -> bool {
        true
    }

    fn authorized(&self, _: &Genesis, _: &Envelope, _: &Body, _: &aven_db_docs::Past<'_>) -> bool {
        true
    }
}

pub struct World {
    pub device: Device,
    pub genesis: Genesis,
    pub version: Version,
    pub epoch: EpochKey,
}

pub fn world() -> &'static World {
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

pub fn doc() -> Doc {
    Doc::open(world().genesis.clone(), |_| None, Limits::DEFAULTS).expect("opens")
}

/// Whatever happened, the live state holds only what counts.
pub fn only_counted(doc: &Doc) {
    assert!(doc.snapshot().version.iter().all(|n| doc.counts(n)));
}

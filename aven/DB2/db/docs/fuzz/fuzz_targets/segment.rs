//! Any bytes as a sealed segment under the Doc's epoch: refused or imported, never a panic.
#![no_main]

#[path = "common.rs"]
mod common;

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let mut doc = common::doc();
    let _ = doc.import_segment(data, &common::world().epoch, &common::Allow);
    common::only_counted(&doc);
});

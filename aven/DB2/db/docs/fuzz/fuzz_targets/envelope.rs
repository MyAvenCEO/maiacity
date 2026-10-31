//! Any bytes as an envelope, straight to `import`: refused or taken, never a panic.
#![no_main]

#[path = "common.rs"]
mod common;

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let mut doc = common::doc();
    let _ = doc.import(data, &common::Allow);
    common::only_counted(&doc);
});

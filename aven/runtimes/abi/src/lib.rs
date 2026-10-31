//! The module ABI (README, "The runtime contract"): what a runtime's WebAssembly module exports, written in safe Rust.
//! A module crate (`modules/<name>`) exports two functions that call these, and nothing else:
//!
//! - `alloc(len) → ptr`: `len` zeroed bytes the host writes the part or the input into;
//! - `run(part_ptr, part_len, input_ptr, input_len) → ptr`: the part and the input decoded from the one codec, the
//!   runtime's `eval`, and its result as the Value the host hands on (`result`: `{"ok": output}` or
//!   `{"failure": name}`), encoded; `ptr` is to eight bytes, the result's pointer and length, little-endian `u32`s.
//!
//! A part or input that isn't the one codec's encoding of a Value is `badInput`; a pointer that `alloc` didn't give is
//! `refused`. The buffers live here, so the module needs no `unsafe` beyond the exports' `no_mangle`. A run frees the
//! buffers it was handed and the result before it; one run at a time, as the host calls it.

use std::sync::Mutex;

use aven_codec::{Value, decode, encode};
use aven_runtimes_contract::{Failure, result};

/// What a runtime is: `eval(part, input)`.
pub type Eval = fn(&Value, &Value) -> Result<Value, Failure>;

/// The buffers `alloc` gave, and the last result and its header.
static HELD: Mutex<Held> = Mutex::new(Held {
    given: Vec::new(),
    out: Vec::new(),
    header: Vec::new(),
});

struct Held {
    given: Vec<Vec<u8>>,
    out: Vec<u8>,
    header: Vec<u8>,
}

fn addr(b: &[u8]) -> u32 {
    b.as_ptr() as usize as u32
}

/// `alloc(len)`: `len` zeroed bytes, kept until a run takes them.
pub fn alloc(len: u32) -> u32 {
    let mut held = HELD.lock().unwrap_or_else(|e| e.into_inner());
    let b = vec![0u8; len as usize];
    let p = addr(&b);
    held.given.push(b);
    p
}

/// The buffer `alloc` gave at `ptr`, if it is `len` long; taken, so it is freed after the run.
fn take(held: &mut Held, ptr: u32, len: u32) -> Option<Vec<u8>> {
    let i = held
        .given
        .iter()
        .position(|b| addr(b) == ptr && b.len() == len as usize)?;
    Some(held.given.swap_remove(i))
}

/// `run(part_ptr, part_len, input_ptr, input_len)`: the result's header, eight bytes.
pub fn run(eval: Eval, part_ptr: u32, part_len: u32, input_ptr: u32, input_len: u32) -> u32 {
    let mut held = HELD.lock().unwrap_or_else(|e| e.into_inner());
    let part = take(&mut held, part_ptr, part_len);
    let input = take(&mut held, input_ptr, input_len);
    held.given.clear();
    let r = match (part, input) {
        (Some(p), Some(i)) => match (decode(&p), decode(&i)) {
            (Some(p), Some(i)) => eval(&p, &i),
            _ => Err(Failure::BadInput),
        },
        _ => Err(Failure::Refused),
    };
    held.out = encode(&result(&r));
    let (p, n) = (addr(&held.out), held.out.len() as u32);
    held.header = [p.to_le_bytes(), n.to_le_bytes()].concat();
    addr(&held.header)
}

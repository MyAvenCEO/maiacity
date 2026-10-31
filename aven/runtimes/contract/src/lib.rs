//! The runtime contract (`Aven.Runtime.Contract`, README, "The runtime contract"): what every runtime answers with.
//!
//! A runtime is `run(part, input) → output | failure` over Values. The failures, the limits a run is held to, the
//! result as the Value the host hands on (`{"ok": output}` or `{"failure": name}`) and a render's cache key are the
//! model's, and the tests replay its vectors (`spec/vectors/contract.json`).

#![no_std]
#![forbid(unsafe_code)]

extern crate alloc;

use alloc::string::String;
use alloc::vec;

use aven_core::{Hash, Value, name_of};

/// Why a run failed. A failure is a Value too, the same on every device.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    BadInput,
    OutOfFuel,
    OutOfMemory,
    Refused,
    OutputTooLarge,
    BadOutput,
}

impl Failure {
    pub fn name(self) -> &'static str {
        match self {
            Failure::BadInput => "badInput",
            Failure::OutOfFuel => "outOfFuel",
            Failure::OutOfMemory => "outOfMemory",
            Failure::Refused => "refused",
            Failure::OutputTooLarge => "outputTooLarge",
            Failure::BadOutput => "badOutput",
        }
    }
}

/// The limits a run is held to: fuel (instructions), memory (bytes) and output (bytes of its encoding).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    pub fuel: u64,
    pub memory: u64,
    pub output: u64,
}

/// A run's result as the Value the host hands on (`result`): `{"ok": output}` or `{"failure": name}`.
pub fn result(r: &Result<Value, Failure>) -> Value {
    match r {
        Ok(o) => Value::Map(vec![(String::from("ok"), o.clone())]),
        Err(f) => Value::Map(vec![(
            String::from("failure"),
            Value::Text(String::from(f.name())),
        )]),
    }
}

/// What a render is cached by: the runtime's hash, the file's hash and the render's params (`RenderKey`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RenderKey {
    pub runtime: Hash,
    pub file: Hash,
    pub params: Value,
}

impl RenderKey {
    /// `[runtime hash, file hash, params]`.
    pub fn value(&self) -> Value {
        Value::Array(vec![
            self.runtime.value(),
            self.file.value(),
            self.params.clone(),
        ])
    }

    /// The key's name: the hash of its Value's one encoding.
    pub fn name(&self) -> Hash {
        name_of(&self.value())
    }
}

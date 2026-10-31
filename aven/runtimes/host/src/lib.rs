//! The runtime host (`Aven.Runtime.Contract`; README, "The runtime contract"): loads a runtime's module only by a hash
//! the manifest lists and only when the bytes have that hash (`loads`), admits it only when it imports nothing at all,
//! declares a maximum memory within the limit and exports the ABI (`admit`), and runs it under fuel, memory and output
//! limits (`run`), in wasmi, an interpreter with no JIT, whose fuel is the same on every device.
//!
//! A run is `run(part, input) → output | failure` over Values: the part and the input cross into the module in the one
//! codec, the module's `run` answers its result (`{"ok": output}` or `{"failure": name}`), and the host holds it to the
//! limits: fuel used up is `outOfFuel`, memory grown past the limit `outOfMemory`, an encoded output past the limit
//! `outputTooLarge`, an answer that isn't a result `badOutput`, and a module that traps otherwise `refused`.

pub mod json;

use aven_core::{Hash, Value, blake3, decode, encode};
use aven_runtimes_contract::{Failure, Limits};
use wasmi::{
    Config, Engine, ExternType, Instance, Linker, Memory, Module, Store, StoreLimits,
    StoreLimitsBuilder, TrapCode, TypedFunc,
};

/// One frozen runtime in the manifest: its name and version, its module's hash, the limits its runs are held to, and
/// who may load it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Frozen {
    pub name: String,
    pub version: u64,
    pub hash: Hash,
    pub limits: Limits,
    pub users: Vec<String>,
}

/// An entry of the manifest (`ManifestEntry`): a module frozen, or a frozen module withdrawn, appended, never an
/// edit. There are no floors.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Entry {
    Frozen(Frozen),
    Withdrawn(Hash),
}

impl Entry {
    pub fn hash(&self) -> Hash {
        match self {
            Entry::Frozen(f) => f.hash,
            Entry::Withdrawn(h) => *h,
        }
    }
}

/// The manifest's entries, as `manifest.json` has them under `runtimes`: `{name, version, hash, limits, users}` frozen,
/// or `{"withdrawn": hash}`; `None` when an entry is neither.
pub fn manifest(text: &str) -> Option<Vec<Entry>> {
    let j: serde_json::Value = serde_json::from_str(text).ok()?;
    j.get("runtimes")?
        .as_array()?
        .iter()
        .map(|e| {
            if let Some(h) = e.get("withdrawn") {
                return Some(Entry::Withdrawn(Hash::parse(h.as_str()?)?));
            }
            let l = e.get("limits")?;
            Some(Entry::Frozen(Frozen {
                name: e.get("name")?.as_str()?.into(),
                version: e.get("version")?.as_u64()?,
                hash: Hash::parse(e.get("hash")?.as_str()?)?,
                limits: Limits {
                    fuel: l.get("fuel")?.as_u64()?,
                    memory: l.get("memory")?.as_u64()?,
                    output: l.get("output")?.as_u64()?,
                },
                users: e
                    .get("users")?
                    .as_array()?
                    .iter()
                    .map(|u| u.as_str().map(String::from))
                    .collect::<Option<_>>()?,
            }))
        })
        .collect()
}

/// A runtime's newest frozen module that the manifest still lists.
pub fn latest(manifest: &[Entry], name: &str) -> Option<Frozen> {
    manifest
        .iter()
        .filter_map(|e| match e {
            Entry::Frozen(f) if f.name == name && listed(manifest, &f.hash) => Some(f.clone()),
            _ => None,
        })
        .max_by_key(|f| f.version)
}

/// Whether the manifest lists `h` now: the last entry for it froze it, no withdrawal came after (`listed`).
pub fn listed(manifest: &[Entry], h: &Hash) -> bool {
    matches!(
        manifest.iter().rev().find(|e| e.hash() == *h),
        Some(Entry::Frozen(_))
    )
}

/// The most memory a module may declare: 1,024 pages of 64 KiB, 64 MiB.
pub const MAX_PAGES: u64 = 1024;

/// Why a module wasn't loaded.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LoadError {
    /// The manifest doesn't list the hash, or withdrew it.
    NotListed,
    /// The bytes don't have the hash they were asked for by.
    WrongBytes,
    /// The bytes aren't a valid module.
    Invalid,
    /// The module imports something, declares no maximum memory or too much, or doesn't export the ABI.
    NotAdmitted(&'static str),
}

/// A module the host loaded and admitted, by its hash.
pub struct Loaded {
    engine: Engine,
    module: Module,
    pub hash: Hash,
}

/// Loads the module `want` names: only when the manifest lists it and the bytes have that hash (`loads`), and only
/// when the module is admitted (`admit`).
pub fn load(manifest: &[Entry], want: &Hash, bytes: &[u8]) -> Result<Loaded, LoadError> {
    if !listed(manifest, want) {
        return Err(LoadError::NotListed);
    }
    if blake3(bytes) != *want {
        return Err(LoadError::WrongBytes);
    }
    let engine = Engine::new(&deterministic());
    let module = Module::new(&engine, bytes).map_err(|_| LoadError::Invalid)?;
    admit(&module)?;
    Ok(Loaded {
        engine,
        module,
        hash: *want,
    })
}

/// The engine every host runs, so two hosts always agree (README, "Determinism"): fuel metered per instruction, and
/// no instruction whose result may differ between machines. Floats are refused outright (a runtime's numbers are
/// integers: Style's are hundredths), and so is a second memory. SIMD, relaxed SIMD and 64-bit memories can't be read
/// at all (wasmi is built without its `simd` and `memory64` features), nor threads (wasmi has none). NaNs would be canonicalised (`deterministic`) were floats ever let in.
pub fn deterministic() -> Config {
    let mut config = Config::default();
    config
        .consume_fuel(true)
        .floats(false)
        .wasm_multi_memory(false);
    config
}

/// A module is admitted when it imports nothing at all, exports one memory with a declared maximum within the limit,
/// and exports the ABI's `alloc` and `run`.
fn admit(module: &Module) -> Result<(), LoadError> {
    if module.imports().next().is_some() {
        return Err(LoadError::NotAdmitted("it imports something"));
    }
    let mut memories = 0;
    let (mut alloc, mut run) = (false, false);
    for e in module.exports() {
        match (e.name(), e.ty()) {
            (_, ExternType::Memory(m)) => {
                memories += 1;
                match m.maximum() {
                    Some(p) if p <= MAX_PAGES => {}
                    Some(_) => {
                        return Err(LoadError::NotAdmitted(
                            "it declares more memory than the limit",
                        ));
                    }
                    None => return Err(LoadError::NotAdmitted("it declares no maximum memory")),
                }
            }
            ("alloc", ExternType::Func(_)) => alloc = true,
            ("run", ExternType::Func(_)) => run = true,
            _ => {}
        }
    }
    if memories != 1 || !alloc || !run {
        return Err(LoadError::NotAdmitted(
            "it doesn't export one memory, alloc and run",
        ));
    }
    Ok(())
}

/// What a trap means for the run.
fn failure(e: &wasmi::Error) -> Failure {
    match e.as_trap_code() {
        Some(TrapCode::OutOfFuel) => Failure::OutOfFuel,
        Some(TrapCode::GrowthOperationLimited | TrapCode::OutOfSystemMemory) => {
            Failure::OutOfMemory
        }
        _ => Failure::Refused,
    }
}

struct Run {
    store: Store<StoreLimits>,
    memory: Memory,
    alloc: TypedFunc<u32, u32>,
    run: TypedFunc<(u32, u32, u32, u32), u32>,
}

impl Run {
    fn start(m: &Loaded, l: Limits) -> Result<Run, Failure> {
        let limits = StoreLimitsBuilder::new()
            .memory_size(usize::try_from(l.memory).unwrap_or(usize::MAX))
            .trap_on_grow_failure(true)
            .build();
        let mut store = Store::new(&m.engine, limits);
        store.limiter(|s| s);
        store.set_fuel(l.fuel).map_err(|_| Failure::Refused)?;
        let instance: Instance = Linker::new(&m.engine)
            .instantiate_and_start(&mut store, &m.module)
            .map_err(|e| match failure(&e) {
                Failure::Refused => Failure::OutOfMemory,
                f => f,
            })?;
        let memory = instance
            .get_memory(&store, "memory")
            .ok_or(Failure::Refused)?;
        // the limiter holds growth; the memory a module starts with is held here
        if memory.data_size(&store) as u64 > l.memory {
            return Err(Failure::OutOfMemory);
        }
        let alloc = instance
            .get_typed_func(&store, "alloc")
            .map_err(|_| Failure::Refused)?;
        let run = instance
            .get_typed_func(&store, "run")
            .map_err(|_| Failure::Refused)?;
        Ok(Run {
            store,
            memory,
            alloc,
            run,
        })
    }

    /// The bytes into the module's memory, where its `alloc` says.
    fn put(&mut self, bytes: &[u8]) -> Result<(u32, u32), Failure> {
        let n = u32::try_from(bytes.len()).map_err(|_| Failure::OutOfMemory)?;
        let p = self
            .alloc
            .call(&mut self.store, n)
            .map_err(|e| failure(&e))?;
        self.memory
            .write(&mut self.store, p as usize, bytes)
            .map_err(|_| Failure::Refused)?;
        Ok((p, n))
    }

    fn read(&self, at: u32, len: u32) -> Result<Vec<u8>, Failure> {
        let mut out = vec![0u8; len as usize];
        self.memory
            .read(&self.store, at as usize, &mut out)
            .map_err(|_| Failure::BadOutput)?;
        Ok(out)
    }
}

/// The failure a result names.
fn named(name: &str) -> Option<Failure> {
    [
        Failure::BadInput,
        Failure::OutOfFuel,
        Failure::OutOfMemory,
        Failure::Refused,
        Failure::OutputTooLarge,
        Failure::BadOutput,
    ]
    .into_iter()
    .find(|f| f.name() == name)
}

/// Runs a loaded module on a part and an input under limits (`run`): its output, or why it failed.
pub fn run(m: &Loaded, l: Limits, part: &Value, input: &Value) -> Result<Value, Failure> {
    let mut r = Run::start(m, l)?;
    let (pp, pn) = r.put(&encode(part))?;
    let (ip, in_) = r.put(&encode(input))?;
    let header = r
        .run
        .call(&mut r.store, (pp, pn, ip, in_))
        .map_err(|e| failure(&e))?;
    let h = r.read(header, 8)?;
    let at = u32::from_le_bytes([h[0], h[1], h[2], h[3]]);
    let len = u32::from_le_bytes([h[4], h[5], h[6], h[7]]);
    // the result wraps the output in a few bytes; more than that past the limit is too large without reading it
    if u64::from(len) > l.output.saturating_add(64) {
        return Err(Failure::OutputTooLarge);
    }
    let answer = decode(&r.read(at, len)?).ok_or(Failure::BadOutput)?;
    match answer {
        Value::Map(kvs) => match kvs.as_slice() {
            [(k, o)] if k == "ok" => {
                if encode(o).len() as u64 > l.output {
                    Err(Failure::OutputTooLarge)
                } else {
                    Ok(o.clone())
                }
            }
            [(k, Value::Text(f))] if k == "failure" => Err(named(f).ok_or(Failure::BadOutput)?),
            _ => Err(Failure::BadOutput),
        },
        _ => Err(Failure::BadOutput),
    }
}

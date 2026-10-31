//! The host against the frozen modules (`modules/`, built for wasm32 by `freeze.sh` before these run): every module
//! has the hash the manifest froze, loads only by it, and answers as its crate does natively and as the model's vectors
//! say; and the host refuses what it must (an unlisted hash, bytes that aren't the hash's, a module that imports or
//! declares no maximum memory) and holds every run to its fuel, memory and output.

use aven_core::{Hash, Value, blake3, decode, encode};
use aven_runtimes_contract::{Failure, Limits, result};
use aven_runtimes_host::{Entry, Frozen, LoadError, Loaded, listed, load, run};
use serde_json::Value as Json;

fn here(rel: &str) -> String {
    format!("{}/../{rel}", env!("CARGO_MANIFEST_DIR"))
}

/// The manifest's entries: `{name, version, hash, limits, users}` frozen, or `{"withdrawn": hash}`.
fn manifest() -> Vec<Entry> {
    let text = std::fs::read_to_string(here("manifest.json")).unwrap();
    let j: Json = serde_json::from_str(&text).unwrap();
    j["runtimes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| match e.get("withdrawn") {
            Some(h) => Entry::Withdrawn(Hash::parse(h.as_str().unwrap()).unwrap()),
            None => Entry::Frozen(Frozen {
                name: e["name"].as_str().unwrap().into(),
                version: e["version"].as_u64().unwrap(),
                hash: Hash::parse(e["hash"].as_str().unwrap()).unwrap(),
                users: e["users"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|u| u.as_str().unwrap().into())
                    .collect(),
            }),
        })
        .collect()
}

fn listed_hash(m: &[Entry], runtime: &str) -> Hash {
    latest(m, runtime).hash
}

/// A runtime's newest frozen module.
fn latest(m: &[Entry], runtime: &str) -> Frozen {
    m.iter()
        .filter_map(|e| match e {
            Entry::Frozen(f) if f.name == runtime => Some(f.clone()),
            _ => None,
        })
        .max_by_key(|f| f.version)
        .unwrap()
}

/// A module as `freeze.sh` built it.
fn built(name: &str) -> Vec<u8> {
    let target = std::env::var("CARGO_TARGET_DIR").unwrap_or_else(|_| here("target"));
    let path = format!("{target}/wasm32-unknown-unknown/release/aven_runtimes_module_{name}.wasm");
    std::fs::read(&path)
        .unwrap_or_else(|e| panic!("{path}: {e}; build the modules first (freeze.sh)"))
}

fn module(runtime: &str, crate_name: &str) -> Loaded {
    let m = manifest();
    let e = latest(&m, runtime);
    load(&m, &e.hash, &built(crate_name)).unwrap_or_else(|err| panic!("{runtime}: {err:?}"))
}

const ROOMY: Limits = Limits {
    fuel: 2_000_000_000,
    memory: 64 << 20,
    output: 8 << 20,
};

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

/// Every module in the manifest is what the source builds today, byte for byte: a frozen entry never changes.
#[test]
fn frozen() {
    for (runtime, crate_name) in [("markdown-runtime", "markdown"), ("face-runtime", "face")] {
        let m = manifest();
        let e = latest(&m, runtime);
        assert_eq!(
            blake3(&built(crate_name)),
            e.hash,
            "{runtime}@{}: the build isn't the frozen module",
            e.version
        );
    }
}

/// face-runtime's vectors through its module: the result, byte for byte, as the model has it.
#[test]
fn face_runtime_vectors() {
    let m = module("face-runtime", "face");
    let vs: Vec<Json> = serde_json::from_str(
        &std::fs::read_to_string(here("spec/vectors/face-runtime.json")).unwrap(),
    )
    .unwrap();
    assert!(vs.len() >= 8);
    for v in vs {
        let name = v["name"].as_str().unwrap();
        let part = decode(&unhex(v["input"]["part"].as_str().unwrap())).unwrap();
        let data = decode(&unhex(v["input"]["data"].as_str().unwrap())).unwrap();
        let got = run(&m, ROOMY, &part, &data);
        let hex: String = encode(&result(&got))
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(hex, v["expected"]["result"].as_str().unwrap(), "{name}");
    }
}

/// markdown-runtime's module answers as the crate does natively, this package's own README among the documents.
#[test]
fn markdown_as_native() {
    let m = module("markdown-runtime", "markdown");
    let rules = Value::Map(vec![(
        "links".into(),
        Value::Array(vec![Value::Array(vec![
            Value::Text("glossary:".into()),
            Value::Text("#/brain/glossary/".into()),
        ])]),
    )]);
    let readme = std::fs::read(here("README.md")).unwrap();
    let docs: Vec<Vec<u8>> = vec![
        b"# Hi\n\nA [vault](glossary:vault), *a* **b** `c`.\n".to_vec(),
        b"| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] not\n".to_vec(),
        b"<script>alert(1)</script>\n\n[x](javascript:alert(1))".to_vec(),
        vec![0xC3, 0x28],
        readme,
    ];
    for d in docs {
        let part = Value::Bytes(d);
        for input in [&Value::Map(vec![]), &rules, &Value::Null] {
            assert_eq!(
                run(&m, ROOMY, &part, input),
                aven_runtimes_markdown::eval(&part, input)
            );
        }
    }
}

/// The limits hold: too little fuel, too little memory, too little room for the output.
#[test]
fn limits() {
    let m = module("markdown-runtime", "markdown");
    let part = Value::Bytes("# A heading\n\nSome text.\n".repeat(200).into_bytes());
    let input = Value::Map(vec![]);
    assert!(run(&m, ROOMY, &part, &input).is_ok());
    assert_eq!(
        run(
            &m,
            Limits {
                fuel: 1_000,
                ..ROOMY
            },
            &part,
            &input
        ),
        Err(Failure::OutOfFuel)
    );
    assert_eq!(
        run(
            &m,
            Limits {
                memory: 64 << 10,
                ..ROOMY
            },
            &part,
            &input
        ),
        Err(Failure::OutOfMemory)
    );
    assert_eq!(
        run(
            &m,
            Limits {
                output: 100,
                ..ROOMY
            },
            &part,
            &input
        ),
        Err(Failure::OutputTooLarge)
    );
    // more room never changes an answer (`run_more_room`)
    let ok = run(&m, ROOMY, &part, &input);
    assert_eq!(
        run(
            &m,
            Limits {
                fuel: u64::MAX / 4,
                memory: 64 << 20,
                output: 64 << 20
            },
            &part,
            &input
        ),
        ok
    );
}

/// A minimal module: a type section, then `extra` sections.
fn wasm(extra: &[u8]) -> Vec<u8> {
    [
        &b"\0asm\x01\0\0\0"[..],
        &[0x01, 0x04, 0x01, 0x60, 0x00, 0x00],
        extra,
    ]
    .concat()
}

/// The host loads nothing it shouldn't.
#[test]
fn refusals() {
    let face = built("face");
    let m = manifest();
    let face_hash = latest(&m, "face-runtime").hash;
    // a hash the manifest doesn't list, even for good bytes
    assert_eq!(
        load(&m, &blake3(b"something else"), &face).err(),
        Some(LoadError::NotListed)
    );
    // bytes that aren't the hash's
    assert_eq!(
        load(&m, &face_hash, &built("markdown")).err(),
        Some(LoadError::WrongBytes)
    );
    let mut flipped = face.clone();
    let mid = flipped.len() / 2;
    flipped[mid] ^= 1;
    assert_eq!(
        load(&m, &face_hash, &flipped).err(),
        Some(LoadError::WrongBytes)
    );
    // listed, but not admitted: it imports a function, or its memory has no maximum
    let imports = wasm(&[
        0x02, 0x09, 0x01, 0x03, b'e', b'n', b'v', 0x01, b'f', 0x00, 0x00,
    ]);
    let unbounded = wasm(&[
        0x05, 0x03, 0x01, 0x00, 0x01, 0x07, 0x0a, 0x01, 0x06, b'm', b'e', b'm', b'o', b'r', b'y',
        0x02, 0x00,
    ]);
    let not_wasm = b"not a module".to_vec();
    let entry = |b: &[u8]| {
        Entry::Frozen(Frozen {
            name: "x".into(),
            version: 1,
            hash: blake3(b),
            users: vec![],
        })
    };
    let them = vec![entry(&imports), entry(&unbounded), entry(&not_wasm)];
    assert!(matches!(
        load(&them, &blake3(&imports), &imports).err(),
        Some(LoadError::NotAdmitted(_))
    ));
    assert!(matches!(
        load(&them, &blake3(&unbounded), &unbounded).err(),
        Some(LoadError::NotAdmitted(_))
    ));
    assert_eq!(
        load(&them, &blake3(&not_wasm), &not_wasm).err(),
        Some(LoadError::Invalid)
    );
    // a float instruction (`f32.const 0; drop`): a module with one is no module of ours
    let floats = wasm(&[
        0x03, 0x02, 0x01, 0x00, 0x0a, 0x0a, 0x01, 0x08, 0x00, 0x43, 0x00, 0x00, 0x00, 0x00, 0x1a,
        0x0b,
    ]);
    let them = vec![entry(&floats)];
    assert_eq!(
        load(&them, &blake3(&floats), &floats).err(),
        Some(LoadError::Invalid)
    );
    // a withdrawal, appended, unlists the module, and it is never loaded again
    let mut withdrawn = m.clone();
    withdrawn.push(Entry::Withdrawn(listed_hash(&m, "face-runtime")));
    assert!(!listed(&withdrawn, &listed_hash(&m, "face-runtime")));
    assert_eq!(
        load(&withdrawn, &listed_hash(&m, "face-runtime"), &face).err(),
        Some(LoadError::NotListed)
    );
    assert!(load(&m, &listed_hash(&m, "face-runtime"), &face).is_ok());
}

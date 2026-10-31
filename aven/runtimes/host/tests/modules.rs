//! The host against the frozen modules (`modules/`, built for wasm32 by `freeze.sh` before these run): every module
//! has the hash the manifest froze, loads only by it, and answers as its crate does natively and as the model's vectors
//! say; and the host refuses what it must (an unlisted hash, bytes that aren't the hash's, a module that imports or
//! declares no maximum memory) and holds every run to its fuel, memory and output. avenBRAIN's slides are faces in
//! use: each one's part (`brain/*/slides/<id>.part.json`) is accepted by the frozen face-runtime, as natively.

use aven_core::{Hash, Value, blake3, decode, encode};
use aven_runtimes_contract::{Failure, Limits, result};
use aven_runtimes_host::json::{of_json, to_json};
use aven_runtimes_host::{Entry, Frozen, LoadError, Loaded, listed, load, run};
use serde_json::Value as Json;

fn here(rel: &str) -> String {
    format!("{}/../{rel}", env!("CARGO_MANIFEST_DIR"))
}

/// The manifest as the host reads it.
fn manifest() -> Vec<Entry> {
    aven_runtimes_host::manifest(&std::fs::read_to_string(here("manifest.json")).unwrap()).unwrap()
}

fn listed_hash(m: &[Entry], runtime: &str) -> Hash {
    latest(m, runtime).hash
}

/// A runtime's newest frozen module.
fn latest(m: &[Entry], runtime: &str) -> Frozen {
    aven_runtimes_host::latest(m, runtime).unwrap()
}

/// A module as `freeze.sh` built it.
fn built(name: &str) -> Vec<u8> {
    let target = std::env::var("CARGO_TARGET_DIR").unwrap_or_else(|_| here("target"));
    let path = format!("{target}/wasm32-unknown-unknown/release/aven_runtimes_module_{name}.wasm");
    std::fs::read(&path)
        .unwrap_or_else(|e| panic!("{path}: {e}; build the modules first (freeze.sh)"))
}

/// A frozen module's bytes, as `frozen/` keeps them by their hash.
fn kept(h: &Hash) -> Vec<u8> {
    let path = here(&format!("frozen/{}.wasm", &h.text()[3..]));
    std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
}

/// A runtime's newest frozen module, loaded from its kept bytes by its hash.
fn module(runtime: &str) -> Loaded {
    let m = manifest();
    let e = latest(&m, runtime);
    load(&m, &e.hash, &kept(&e.hash)).unwrap_or_else(|err| panic!("{runtime}: {err:?}"))
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

/// Every frozen module's bytes are kept in `frozen/`, under their hash, and nothing else is: a frozen version stays
/// loadable after its source moves on. Each runtime's newest version is what the source builds today, byte for byte,
/// so a change to a runtime is its next version, appended.
#[test]
fn frozen() {
    let m = manifest();
    for e in &m {
        if let Entry::Frozen(f) = e {
            assert_eq!(
                blake3(&kept(&f.hash)),
                f.hash,
                "{}@{}: frozen/ keeps other bytes",
                f.name,
                f.version
            );
        }
    }
    let mut files: Vec<String> = std::fs::read_dir(here("frozen"))
        .unwrap()
        .map(|f| f.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    files.sort();
    let mut named: Vec<String> = m
        .iter()
        .map(|e| format!("{}.wasm", &e.hash().text()[3..]))
        .collect();
    named.sort();
    named.dedup();
    assert_eq!(files, named, "frozen/ keeps exactly the manifest's modules");
    for (runtime, crate_name) in [("markdown-runtime", "markdown"), ("face-runtime", "face")] {
        let e = latest(&m, runtime);
        assert_eq!(
            blake3(&built(crate_name)),
            e.hash,
            "{runtime}@{}: the build isn't the newest frozen module",
            e.version
        );
    }
}

/// face-runtime's vectors through its module: the result, byte for byte, as the model has it.
#[test]
fn face_runtime_vectors() {
    let m = module("face-runtime");
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
    let m = module("markdown-runtime");
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
    let m = module("markdown-runtime");
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
            limits: ROOMY,
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

/// Every slide avenBRAIN draws is a face the frozen face-runtime accepts, with the answer the crate gives natively.
#[test]
fn slides() {
    let m = module("face-runtime");
    let brain = here("../DB2/brain");
    let mut parts: Vec<String> = std::fs::read_dir(&brain)
        .unwrap_or_else(|e| panic!("{brain}: {e}"))
        .filter_map(|pkg| std::fs::read_dir(pkg.ok()?.path().join("slides")).ok())
        .flatten()
        .filter_map(|f| {
            let p = f.ok()?.path();
            p.to_str()?
                .ends_with(".part.json")
                .then(|| p.to_string_lossy().into_owned())
        })
        .collect();
    parts.sort();
    assert!(parts.len() >= 9, "avenBRAIN's slides: {parts:?}");
    let data = Value::Map(vec![]);
    for path in parts {
        let j: Json = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let part = of_json(&j).unwrap();
        assert_eq!(
            to_json(&part).as_ref(),
            Some(&j),
            "{path}: the JSON form reads back"
        );
        let native = aven_runtimes_face::eval(&part, &data);
        assert!(native.is_ok(), "{path}: refused natively: {native:?}");
        assert_eq!(run(&m, ROOMY, &part, &data), native, "{path}");
    }
}

/// Every document avenBRAIN shows is Markdown the frozen markdown-runtime draws, under params as the brain gives them
/// (its links resolved against the document's own path, the glossary's ids under `g-`), with the answer the crate
/// gives natively; and the glossary's headings are there to name its terms.
#[test]
fn brain_documents() {
    let m = module("markdown-runtime");
    let brain = here("../DB2/brain");
    let mut docs = Vec::new();
    let mut walk = vec![std::path::PathBuf::from(&brain)];
    while let Some(dir) = walk.pop() {
        for f in std::fs::read_dir(&dir).unwrap() {
            let p = f.unwrap().path();
            if p.is_dir() {
                walk.push(p);
            } else if p.extension().is_some_and(|e| e == "md") {
                docs.push(p);
            }
        }
    }
    docs.sort();
    assert!(docs.len() >= 14, "avenBRAIN's documents: {docs:?}");
    let text = |s: &str| Value::Text(s.into());
    let rules = Value::Array(
        [
            ("glossary:", "#/brain/glossary/"),
            ("aven/", "https://github.com/myavenceo/maiacity/blob/main/aven/"),
        ]
        .iter()
        .map(|(a, b)| Value::Array(vec![text(a), text(b)]))
        .collect(),
    );
    for doc in docs {
        let rel = doc.strip_prefix(&brain).unwrap().to_string_lossy().into_owned();
        let pre = if rel == "GLOSSARY.md" { "g-" } else { "" };
        let params = Value::Map(vec![
            ("base".into(), text(&format!("aven/DB2/brain/{rel}"))),
            ("idPrefix".into(), text(pre)),
            ("links".into(), rules.clone()),
        ]);
        let part = Value::Bytes(std::fs::read(&doc).unwrap());
        let native = aven_runtimes_markdown::eval(&part, &params);
        assert!(native.is_ok(), "{rel}: refused natively: {native:?}");
        assert_eq!(run(&m, ROOMY, &part, &params), native, "{rel}");
        if rel == "GLOSSARY.md" {
            let Ok(Value::Array(root)) = native else { panic!("{rel}: not a tree") };
            let Value::Array(kids) = &root[2] else { panic!("{rel}: no children") };
            let h2 = kids.iter().filter(|k| matches!(k, Value::Array(n) if n[0] == text("h2"))).count();
            assert!(h2 > 5, "{rel}: {h2} sections");
        }
    }
}

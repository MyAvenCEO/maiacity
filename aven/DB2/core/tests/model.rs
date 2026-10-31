//! aven-core against the running Lean model (README rule 10): random worlds of envelopes go to `aven-core-model`
//! (`core/spec`), and every answer it gives must be this crate's: names, the past, splits, what is discounted, what
//! counts and what a version holds; and for random bytes, what a reader accepts as an envelope or a signed thing. The
//! theorems `split_final`, `counts_past` and `Version.holds_mono` are checked of the crate on the same worlds. Set
//! `AVEN_CORE_MODEL` to a built model to skip `lake`.

mod common;

use std::cell::RefCell;
use std::collections::BTreeSet;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::OnceLock;

use aven_core::limits::{MAX_DEPS, MAX_SIG_BYTES};
use aven_core::past::in_past;
use aven_core::{DocId, Envelope, Hash, Held, Signed, Value, blake3, split};
use common::{bools, hex, names};
use proptest::prelude::*;
use serde_json::{Value as Json, json};

static EXE: OnceLock<PathBuf> = OnceLock::new();

struct Model {
    _child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Model {
    fn start() -> Model {
        let exe = EXE.get_or_init(|| match std::env::var("AVEN_CORE_MODEL") {
            Ok(exe) => PathBuf::from(exe),
            Err(_) => {
                let spec = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("spec");
                let built = Command::new("lake")
                    .arg("build")
                    .arg("aven-core-model")
                    .current_dir(&spec)
                    .status();
                assert!(
                    built.is_ok_and(|s| s.success()),
                    "lake build aven-core-model failed in {}",
                    spec.display()
                );
                spec.join(".lake/build/bin/aven-core-model")
            }
        });
        let mut child = Command::new(exe)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap_or_else(|e| panic!("can't run {}: {e}", exe.display()));
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Model {
            _child: child,
            stdin,
            stdout,
        }
    }

    fn ask(&mut self, case: &Json) -> Json {
        writeln!(self.stdin, "{case}").unwrap();
        self.stdin.flush().unwrap();
        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        let answer: Json =
            serde_json::from_str(&line).unwrap_or_else(|e| panic!("model said {line:?}: {e}"));
        assert!(
            answer.get("error").is_none(),
            "model refused {case}: {answer}"
        );
        answer
    }
}

thread_local! {
    static MODEL: RefCell<Option<Model>> = const { RefCell::new(None) };
}

fn ask(case: &Json) -> Json {
    MODEL.with(|m| m.borrow_mut().get_or_insert_with(Model::start).ask(case))
}

// ---- random worlds ----

/// A small world where splits and shared parents are common: two Docs, two writers, three places, bodies from four.
/// Each envelope names earlier ones (or a name nobody holds) as its prev and deps.
#[derive(Clone, Debug)]
struct Draw {
    doc: u8,
    writer: u64,
    seq: u64,
    prev: Option<u8>,
    deps: Vec<u8>,
    body: u64,
}

fn draw() -> impl Strategy<Value = Draw> {
    (
        0u8..2,
        0u64..2,
        1u64..4,
        proptest::option::of(any::<u8>()),
        proptest::collection::vec(any::<u8>(), 0..3),
        0u64..4,
    )
        .prop_map(|(doc, writer, seq, prev, deps, body)| Draw {
            doc,
            writer,
            seq,
            prev,
            deps,
            body,
        })
}

fn build(draws: &[Draw]) -> Vec<Envelope> {
    let mut out: Vec<Envelope> = vec![];
    let pick = |out: &Vec<Envelope>, i: u8| {
        let j = i as usize % (out.len() + 1);
        if j == out.len() {
            blake3(&[i, 0xFF])
        } else {
            out[j].name()
        }
    };
    for d in draws {
        let e = Envelope {
            doc: DocId(blake3(&[d.doc])),
            branch: "main".into(),
            writer: d.writer,
            seq: d.seq,
            prev: d.prev.map(|i| pick(&out, i)),
            deps: d.deps.iter().map(|&i| pick(&out, i)).collect(),
            body: Value::Uint(d.body),
            signer: vec![7; 32],
            sig: vec![9; 64],
        };
        out.push(e);
    }
    out
}

#[derive(Clone, Debug)]
struct World {
    all: Vec<Envelope>,
    held: Vec<bool>,
    bad: Vec<usize>,
    tips: Vec<usize>,
}

fn world() -> impl Strategy<Value = World> {
    (
        proptest::collection::vec((draw(), any::<bool>()), 1..14),
        proptest::collection::vec(any::<prop::sample::Index>(), 0..3),
        proptest::collection::vec(any::<prop::sample::Index>(), 0..3),
    )
        .prop_map(|(ds, bad, tips)| {
            let (draws, held): (Vec<Draw>, Vec<bool>) = ds.into_iter().unzip();
            let n = draws.len();
            World {
                all: build(&draws),
                held,
                bad: bad.iter().map(|i| i.index(n)).collect(),
                tips: tips.iter().map(|i| i.index(n)).collect(),
            }
        })
}

impl World {
    fn s(&self) -> Vec<Envelope> {
        self.all
            .iter()
            .zip(&self.held)
            .filter(|(_, h)| **h)
            .map(|(e, _)| e.clone())
            .collect()
    }

    fn case(&self) -> Json {
        json!({
            "envelopes": self.all.iter().map(|e| hex(&e.encode())).collect::<Vec<_>>(),
            "held": self.held, "bad": self.bad, "tips": self.tips,
        })
    }
}

fn any_bytes_case() -> impl Strategy<Value = Vec<u8>> {
    let envelope = (world(), any::<prop::sample::Index>())
        .prop_map(|(w, i)| w.all[i.index(w.all.len())].encode());
    let signed = (
        ".{0,8}",
        any::<u64>(),
        proptest::collection::vec(any::<u8>(), 0..40),
    )
        .prop_map(|(label, n, sig)| {
            Signed {
                label,
                body: Value::Uint(n),
                signer: vec![7; 32],
                sig,
            }
            .encode()
        });
    let wide = (0usize..3).prop_map(|k| {
        let e = Envelope {
            doc: DocId(blake3(b"d")),
            branch: "main".into(),
            writer: 1,
            seq: 1,
            prev: None,
            deps: vec![blake3(b"x"); MAX_DEPS + k - 1],
            body: Value::Null,
            signer: vec![7; 32],
            sig: vec![9; MAX_SIG_BYTES + k - 1],
        };
        e.encode()
    });
    let base = prop_oneof![4 => envelope, 4 => signed, 1 => wide];
    // now and then broken: a byte changed, cut short, or a byte added
    (base, 0u8..4, any::<prop::sample::Index>(), any::<u8>()).prop_map(|(mut bs, how, at, b)| {
        let i = at.index(bs.len());
        match how {
            0 => bs[i] ^= b | 1,
            1 => bs.truncate(i),
            2 => bs.push(b),
            _ => {}
        }
        bs
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// Every answer of the model's on a world is the crate's (`found_iff`, `inPast_iff`, `splitB_iff`,
    /// `discountedB_iff`, `countsB_iff`, `holdsB_iff`).
    #[test]
    fn worlds_are_leans(w in world()) {
        let a = ask(&w.case());
        let s = w.s();
        let held = Held::new(&s);
        let bad: Vec<Hash> = w.bad.iter().map(|&i| w.all[i].name()).collect();
        let tips: Vec<Hash> = w.tips.iter().map(|&i| w.all[i].name()).collect();
        let ok = |x: &Envelope| !bad.contains(&x.name());
        prop_assert_eq!(w.all.iter().map(Envelope::name).collect::<Vec<_>>(), names(&a["names"]));
        for (k, e) in w.all.iter().enumerate() {
            let want: BTreeSet<Hash> = names(&a["past"][k]).into_iter().collect();
            prop_assert_eq!(held.past(e), want, "past of {}", k);
            let before: Vec<bool> = s.iter().map(|b| in_past(Envelope::name, &s, e, b)).collect();
            prop_assert_eq!(before, bools(&a["inPast"][k]), "inPast of {}", k);
            let splits: Vec<bool> = w.all.iter().map(|b| split(e, b)).collect();
            prop_assert_eq!(splits, bools(&a["split"][k]), "split of {}", k);
        }
        let got = |f: &dyn Fn(&Envelope) -> bool| w.all.iter().map(f).collect::<Vec<bool>>();
        prop_assert_eq!(got(&|e| held.discounted(e)), bools(&a["discounted"]));
        prop_assert_eq!(got(&|e| held.counts(e, ok)), bools(&a["counts"]));
        prop_assert_eq!(got(&|e| held.holds(&tips, e)), bools(&a["holds"]));
    }

    /// Splits are final: what is discounted among `S` never counts among all of it, which holds more
    /// (`split_final`). What counts builds on what counts (`counts_past`). A version holds more as more arrives
    /// (`Version.holds_mono`).
    #[test]
    fn splits_are_final(w in world()) {
        let s = w.s();
        let (h, h_all) = (Held::new(&s), Held::new(&w.all));
        let bad: Vec<Hash> = w.bad.iter().map(|&i| w.all[i].name()).collect();
        let tips: Vec<Hash> = w.tips.iter().map(|&i| w.all[i].name()).collect();
        let ok = |x: &Envelope| !bad.contains(&x.name());
        for e in &w.all {
            if h.discounted(e) {
                prop_assert!(h_all.discounted(e));
                prop_assert!(!h_all.counts(e, |_| true));
            }
            if h.counts(e, ok) {
                let past = h.past(e);
                for x in s.iter().filter(|x| past.contains(&x.name())) {
                    prop_assert!(h.counts(x, ok));
                }
            }
            if h.holds(&tips, e) {
                prop_assert!(h_all.holds(&tips, e));
            }
        }
    }

    /// What a reader accepts from bytes, as an envelope or a signed thing, is the model's (`Envelope.accept`,
    /// `Signed.accept`), and what it accepts encodes back to exactly those bytes (`accept_encode`).
    #[test]
    fn accept_is_leans(bs in any_bytes_case()) {
        let a = ask(&json!({ "accept": hex(&bs) }));
        let e = Envelope::decode(&bs).map(|e| e.encode());
        let s = Signed::decode(&bs).map(|s| s.encode());
        prop_assert_eq!(e.as_ref().map(|b| hex(b)), a["envelope"].as_str().map(String::from));
        prop_assert_eq!(s.as_ref().map(|b| hex(b)), a["signed"].as_str().map(String::from));
        prop_assert!(e.is_none_or(|e| e == bs) && s.is_none_or(|s| s == bs));
    }
}

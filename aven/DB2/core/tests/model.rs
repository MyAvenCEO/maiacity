//! aven-core against the running Lean model (README rule 10): random worlds of envelopes go to `aven-core-model`
//! (`core/spec`), and every answer it gives must be this crate's: names, the past, splits, what is discounted, what
//! counts and what a version holds; for random targets, facts and bounds, coverage, narrowing and what a bound
//! allows; and for random bytes, what a reader accepts as an envelope, a signed thing or a target. The
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
use aven_core::{
    Bound, DocId, Envelope, Facts, Hash, Held, Reach, Signed, Target, Value, blake3, decode,
    encode, split,
};
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

// ---- random targets, facts and bounds ----

const VAULTS: [&str; 3] = ["v:alice", "v:bob", "v:maia-city"];

fn any_doc() -> impl Strategy<Value = DocId> {
    (0u8..4).prop_map(|i| DocId(blake3(&[i, 0xD0])))
}

fn any_vault() -> impl Strategy<Value = String> {
    (0usize..3).prop_map(|i| VAULTS[i].to_string())
}

fn any_target() -> impl Strategy<Value = Target> {
    prop_oneof![
        (any_doc(), 0u8..3).prop_map(|(doc, r)| Target::Doc {
            doc,
            reach: [Reach::Itself, Reach::Spawned, Reach::Lists][r as usize],
        }),
        (any_vault(), any::<bool>()).prop_map(|(vault, below)| Target::Vault { vault, below }),
        (any_vault(), any_doc(), any::<bool>()).prop_map(|(vault, r#type, below)| {
            Target::VaultType {
                vault,
                r#type,
                below,
            }
        }),
    ]
}

fn any_facts() -> impl Strategy<Value = Facts> {
    (any_doc(), any_vault(), any_doc()).prop_map(|(id, vault, r#type)| Facts { id, vault, r#type })
}

#[derive(Clone, Debug)]
struct Coverage {
    targets: Vec<Target>,
    facts: Vec<Facts>,
    gov: Vec<(String, String)>,
    spawned: Vec<(DocId, DocId)>,
    lists: Vec<(DocId, DocId)>,
}

fn coverage() -> impl Strategy<Value = Coverage> {
    use proptest::collection::vec;
    (
        vec(any_target(), 1..6),
        vec(any_facts(), 1..6),
        vec((any_vault(), any_vault()), 0..4),
        vec((any_doc(), any_doc()), 0..4),
        vec((any_doc(), any_doc()), 0..4),
    )
        .prop_map(|(targets, facts, gov, spawned, lists)| Coverage {
            targets,
            facts,
            gov,
            spawned,
            lists,
        })
}

impl Coverage {
    fn case(&self) -> Json {
        let pairs = |ps: &[(DocId, DocId)]| {
            ps.iter()
                .map(|(a, b)| [a.text(), b.text()])
                .collect::<Vec<_>>()
        };
        json!({
            "targets": self.targets.iter().map(|t| hex(&encode(&t.value()))).collect::<Vec<_>>(),
            "facts": self.facts.iter()
                .map(|f| json!({"id": f.id.text(), "vault": f.vault, "type": f.r#type.text()}))
                .collect::<Vec<_>>(),
            "gov": self.gov.iter().map(|(a, b)| [a, b]).collect::<Vec<_>>(),
            "spawned": pairs(&self.spawned),
            "lists": pairs(&self.lists),
        })
    }
}

/// Parameter values from a small set, so bounds often allow them: text, a number, and lists of them.
fn any_param() -> impl Strategy<Value = Value> {
    let leaf = prop_oneof![
        Just(Value::Text("status".into())),
        Just(Value::Text("total".into())),
        Just(Value::Text("title".into())),
        Just(Value::Uint(1)),
    ];
    prop_oneof![3 => leaf.clone(), 1 => proptest::collection::vec(leaf, 0..3).prop_map(Value::Array)]
}

fn any_bound() -> impl Strategy<Value = Bound> {
    prop_oneof![
        1 => Just(Bound::Any),
        4 => proptest::collection::vec(any_param(), 0..4).prop_map(Bound::OneOf),
    ]
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
    let target = any_target().prop_map(|t| encode(&t.value()));
    let base = prop_oneof![4 => envelope, 4 => signed, 1 => wide, 3 => target];
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
        let t = decode(&bs).and_then(Target::of_value).map(|t| encode(&t.value()));
        prop_assert_eq!(t.as_ref().map(|b| hex(b)), a["target"].as_str().map(String::from));
    }

    /// Coverage and narrowing are the model's (`Target.coversB`, `Target.le`), and a narrower target covers only
    /// what the wider one does (`Target.le_sound`).
    #[test]
    fn coverage_is_leans(c in coverage()) {
        let a = ask(&c.case());
        let gov = |v: &str, w: &str| c.gov.iter().any(|(x, y)| x == v && y == w);
        let spawned = |x: &DocId, y: &DocId| c.spawned.contains(&(*x, *y));
        let lists = |x: &DocId, y: &DocId| c.lists.contains(&(*x, *y));
        let covers: Vec<Vec<bool>> = c.targets.iter()
            .map(|t| c.facts.iter().map(|f| t.covers(gov, spawned, lists, f)).collect()).collect();
        let le: Vec<Vec<bool>> = c.targets.iter().map(|x| c.targets.iter().map(|y| x.le(y)).collect()).collect();
        prop_assert_eq!(&covers, &a["covers"].as_array().unwrap().iter().map(bools).collect::<Vec<_>>());
        prop_assert_eq!(&le, &a["le"].as_array().unwrap().iter().map(bools).collect::<Vec<_>>());
        for (i, _) in c.targets.iter().enumerate() {
            for (j, _) in c.targets.iter().enumerate() {
                if le[i][j] {
                    for k in 0..c.facts.len() {
                        prop_assert!(!covers[i][k] || covers[j][k]);
                    }
                }
            }
        }
    }

    /// Bounds are the model's (`Bound.allows`, `Bound.within`), and a narrower bound allows no value a wider one
    /// doesn't (`Bound.within_allows`).
    #[test]
    fn bounds_are_leans(bounds in proptest::collection::vec(any_bound(), 1..5),
        values in proptest::collection::vec(any_param(), 1..6)) {
        let a = ask(&json!({
            "bounds": bounds.iter().map(|b| hex(&encode(&b.value()))).collect::<Vec<_>>(),
            "values": values.iter().map(|v| hex(&encode(v))).collect::<Vec<_>>(),
        }));
        let allows: Vec<Vec<bool>> = bounds.iter().map(|b| values.iter().map(|v| b.allows(v)).collect()).collect();
        let within: Vec<Vec<bool>> = bounds.iter().map(|x| bounds.iter().map(|y| x.within(y)).collect()).collect();
        prop_assert_eq!(&allows, &a["allows"].as_array().unwrap().iter().map(bools).collect::<Vec<_>>());
        prop_assert_eq!(&within, &a["within"].as_array().unwrap().iter().map(bools).collect::<Vec<_>>());
        for (i, _) in bounds.iter().enumerate() {
            for (j, _) in bounds.iter().enumerate() {
                for (k, _) in values.iter().enumerate() {
                    prop_assert!(!(within[i][j] && allows[i][k]) || allows[j][k]);
                }
            }
        }
    }
}

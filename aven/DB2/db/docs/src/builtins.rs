//! Built-in types' fit, by whoever defines them (`Aven.DB.Docs.Builtins`), held to `db/spec/vectors/builtins.json`.
//!
//! A built-in type is versioned by its label and has no schema: its shape is its definer's. Fit takes the checks as a
//! parameter, [`BuiltinFit`]: the docs layer supplies its own five ([`DocsBuiltins`]: branch, closed, version,
//! schema, split), avenID supplies `cap`, `revoke` and `epoch`, and a type nobody supplies is no built-in, so its
//! Records don't fit.
//! A built-in Record is written whole at its birth and must pass its check; it is never edited, and may be removed.

use aven_core::{DocId, Value};

use crate::schema::builtin_type;

/// Who checks a built-in type's Records: `None` when it doesn't define `t`, else whether a Record's fields, as a map,
/// take its shape (`BuiltinFit`).
pub trait BuiltinFit {
    fn check(&self, t: &DocId, record: &Value) -> Option<bool>;
}

/// The docs layer's five built-in types (`docsBuiltinFit`).
#[derive(Clone, Copy, Debug, Default)]
pub struct DocsBuiltins;

/// Two definers, the first's check where both define a type (`BuiltinFit.or`).
pub struct Either<A, B>(pub A, pub B);

impl<A: BuiltinFit, B: BuiltinFit> BuiltinFit for Either<A, B> {
    fn check(&self, t: &DocId, record: &Value) -> Option<bool> {
        self.0.check(t, record).or_else(|| self.1.check(t, record))
    }
}

fn is_hash(v: &Value) -> bool {
    matches!(v, Value::Bytes(b) if b.len() == 32)
}

/// A schema's one form (`isSchema`): a type Doc's version, a `schema` Record, names its schema by its hash (A39, A207).
fn is_schema(v: &Value) -> bool {
    crate::schema::Schema::of_value(v).is_some()
}

fn is_hashes(v: &Value) -> bool {
    matches!(v, Value::Array(xs) if xs.iter().all(is_hash))
}

fn is_text(v: &Value) -> bool {
    matches!(v, Value::Text(_))
}

fn is_uint(v: &Value) -> bool {
    matches!(v, Value::Uint(_))
}

type Spec<'a> = &'a [(&'a str, fn(&Value) -> bool, bool)];

/// `shape`: a map of exactly the given fields, each passing its check, the required ones present, none twice.
fn shape(spec: Spec, v: &Value) -> bool {
    let Value::Map(fs) = v else { return false };
    let mut names: Vec<&str> = fs.iter().map(|f| f.0.as_str()).collect();
    names.sort_unstable();
    names.windows(2).all(|w| w[0] != w[1])
        && fs
            .iter()
            .all(|(f, x)| spec.iter().any(|(n, ok, _)| n == f && ok(x)))
        && spec
            .iter()
            .all(|(n, _, required)| !required || fs.iter().any(|f| f.0 == *n))
}

impl BuiltinFit for DocsBuiltins {
    fn check(&self, t: &DocId, record: &Value) -> Option<bool> {
        let spec: Spec = if *t == builtin_type("branch") {
            &[
                ("name", is_text, true),
                ("base", is_hashes, true),
                ("nonce", is_hash, true),
                ("follows", is_text, false),
            ]
        } else if *t == builtin_type("closed") {
            &[("at", is_hashes, false)]
        } else if *t == builtin_type("version") {
            &[("name", is_text, true), ("at", is_hashes, true)]
        } else if *t == builtin_type("schema") {
            &[
                ("name", is_text, true),
                ("at", is_hashes, true),
                ("schema", is_schema, true),
            ]
        } else if *t == builtin_type("split") {
            &[("writer", is_uint, true), ("after", is_hash, true)]
        } else {
            return None;
        };
        Some(shape(spec, record))
    }
}

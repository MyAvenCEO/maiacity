//! Where avenDOCS meets avenCAPS (brain/peers, "The Doc host"): the docs layer defines the traits, caps gives pure
//! verdicts over Core's types, and these thin adapters in aven-peer join them, so neither package depends on the other.
//!
//! - [`IdBuiltins`]: avenID's built-in types (`cap`, `revoke`, `epoch`), checked by `aven_id::caps::id_builtin_fit`, as
//!   the docs layer's `BuiltinFit`; [`builtins`] joins them to the docs layer's own.

use aven_core::{DocId, Value};
use aven_db_docs::{BuiltinFit, DocsBuiltins, Either};

/// avenID's built-in types as the docs layer asks for them: `None` for a type that isn't avenID's, else whether the
/// Record reads as one of it.
#[derive(Clone, Copy, Debug, Default)]
pub struct IdBuiltins;

impl BuiltinFit for IdBuiltins {
    fn check(&self, t: &DocId, record: &Value) -> Option<bool> {
        aven_id::caps::id_builtin_fit(t, record).map(|r| r.is_some())
    }
}

/// Every built-in type a peer's Docs hold: the docs layer's, then avenID's.
pub fn builtins() -> Box<dyn BuiltinFit + Send + Sync> {
    Box::new(Either(DocsBuiltins, IdBuiltins))
}

//! Where avenDOCS meets avenCAPS (brain/peers, "The Doc host"): the docs layer defines the traits, caps gives pure
//! verdicts over Core's types, and these thin adapters in aven-peer join them, so neither package depends on the other.
//!
//! - [`IdBuiltins`]: avenID's built-in types (`cap`, `revoke`, `epoch`), checked by `aven_id::caps::id_builtin_fit`, as
//!   the docs layer's `BuiltinFit`; [`builtins`] joins them to the docs layer's own.
//! - [`Caps`]: caps' verdict as the docs layer's `Authorize`: step 4 is `Reader::reaches`, step 7 is
//!   `caps::authorized` over the envelope, the key that placed it and its body's calls and authority. A revocation is
//!   not judged here: Core's counting discounts it, as it does a split (A182).

use aven_core::{DocId, Envelope, Hash, Value};
use aven_db_docs::{Authorize, Body, BuiltinFit, DocsBuiltins, Either, Genesis, Past, writer};
use aven_id::caps::{self, Authority, Cap, Reader};

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

/// What a peer holds that caps judges by: its reader (its view of the tree, the groups, the Docs and its devices'
/// caps) and the cap Records it holds. The reader borrows the peer's state, so it is lent for one verdict.
pub trait Holding {
    fn judge<R>(&self, f: impl FnOnce(&Reader, &[Cap]) -> R) -> R;
}

/// Caps' verdict as the docs layer's `Authorize`.
pub struct Caps<H>(pub H);

/// The key that placed `e` in its log: the signer whose writer for the envelope's Doc, branch and generation is the
/// envelope's, found as the docs layer finds it.
pub fn placing_signer<'e>(e: &'e Envelope, body: &Body) -> Option<&'e [u8]> {
    e.sigs
        .iter()
        .map(|s| s.signer.as_slice())
        .find(|k| e.writer == writer(k, &e.doc, &e.branch, body.generation))
}

/// The envelope's authority as caps reads it. The body names one cap and no actor until its A45 form, which carries
/// the authority opaque (`{acks, caps}` or `{acks, caps, actor}`, A188) and Core's calls; this reading goes then.
fn authority(body: &Body) -> Authority {
    Authority {
        caps: body.cap.into_iter().collect(),
        acks: body.acks.clone(),
        actor: None,
    }
}

fn calls(body: &Body) -> Vec<aven_core::Call> {
    body.calls
        .iter()
        .map(|c| aven_core::Call {
            op: c.op,
            params: c.params.clone(),
        })
        .collect()
}

impl<H: Holding> Caps<H> {
    /// Caps' verdict on `e`, with why it refuses.
    pub fn verdict(&self, e: &Envelope, body: &Body) -> Result<caps::Path, Option<caps::Refused>> {
        let signer = placing_signer(e, body).ok_or(None)?;
        let authority = authority(body);
        let calls = calls(body);
        self.0.judge(|reader, held| {
            let cap = |n: &Hash| held.iter().find(|c| c.digest() == *n).cloned();
            let written = caps::Written {
                envelope: e,
                signer,
                calls: &calls,
                authority: &authority,
            };
            caps::authorized(reader, &cap, &written).map_err(Some)
        })
    }
}

impl<H: Holding> Authorize for Caps<H> {
    fn reaches(&self, genesis: &Genesis, signer: &[u8]) -> bool {
        let doc: DocId = genesis.id();
        self.0
            .judge(|reader, held| reader.reaches(held, &doc, signer))
    }

    fn authorized(&self, _genesis: &Genesis, e: &Envelope, body: &Body, _past: &Past<'_>) -> bool {
        self.verdict(e, body).is_ok()
    }
}

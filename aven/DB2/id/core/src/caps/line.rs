//! A cap's form (A32): a grant is a list of **lines**, each an op by its id, the Docs it may act on as a target in
//! Core's grammar (A8), and bounds on the op's parameters; a parameter it doesn't bound is free. A line names no step:
//! the steps a call writes are its op's lowering, which every reader computes. So caps judge calls, never steps.

use aven_core::{Bound, Call, DocId, Facts, Hash, OpId, Target};

/// One line of a grant.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Line {
    pub op: OpId,
    pub doc: Target,
    pub params: Vec<(String, Bound)>,
}

/// A grant: its lines.
pub type Grant = [Line];

/// What a target's cover reads besides a Doc's facts: who governs whom (vaults by their 32-byte names, as Core names them),
/// which actor spawned which, and what a collection lists. They are avenID's, the actors' and the collections', so
/// they are given, as in Core's `Target::covers`.
pub struct World<'a> {
    pub gov: &'a dyn Fn(&Hash, &Hash) -> bool,
    pub spawned: &'a dyn Fn(&DocId, &DocId) -> bool,
    pub lists: &'a dyn Fn(&DocId, &DocId) -> bool,
}

impl World<'_> {
    pub fn covers(&self, t: &Target, f: &Facts) -> bool {
        t.covers(self.gov, self.spawned, self.lists, f)
    }
}

/// Free: any value.
const FREE: Bound = Bound::Any;

impl Line {
    /// The bound a line puts on parameter `p`: the first it names for it, else any value (`Line.bound`).
    pub fn bound(&self, p: &str) -> &Bound {
        self.params
            .iter()
            .find(|(q, _)| q == p)
            .map_or(&FREE, |(_, b)| b)
    }

    /// Within another: the same op, a narrower target, and each parameter the other bounds bounded at least as
    /// tightly (`Line.within`).
    pub fn within(&self, m: &Line) -> bool {
        self.op == m.op
            && self.doc.le(&m.doc)
            && m.params.iter().all(|(p, b)| self.bound(p).within(b))
    }

    /// Its bounds hold for a call's parameters (`Line.admits`).
    pub fn admits(&self, c: &Call) -> bool {
        self.params.iter().all(|(p, b)| b.allows(&c.param(p)))
    }
}

/// `g` lies within `h`: each of its lines within one of `h`'s (`Grant.within`).
pub fn grant_within(g: &Grant, h: &Grant) -> bool {
    g.iter().all(|l| h.iter().any(|m| l.within(m)))
}

/// A grant lets op `o` reach the Doc `f`: one of its lines names the op and covers the Doc (`Grant.reaches`).
pub fn grant_reaches(w: &World, g: &Grant, f: &Facts, o: &OpId) -> bool {
    g.iter().any(|l| l.op == *o && w.covers(&l.doc, f))
}

/// A grant allows a call on the Doc `f`: one of its lines names the call's op, covers the Doc, and its bounds hold for
/// the call's parameters (`Grant.allows`).
pub fn grant_allows(w: &World, g: &Grant, f: &Facts, c: &Call) -> bool {
    g.iter()
        .any(|l| l.op == c.op && w.covers(&l.doc, f) && l.admits(c))
}

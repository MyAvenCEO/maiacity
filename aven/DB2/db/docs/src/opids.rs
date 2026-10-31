//! Rule 7: an envelope's Loro dependencies are exactly the last op ids of the envelopes it names by hash
//! (`Aven.DB.Docs.OpIds`). Names are injective and Loro refuses a reused op id, so the two names of the past agree
//! (`same_past`); a reader runs the check as [`ops_agree`] (`opsAgreeB`, with `usedOk` and `resolveAll`).
//!
//! **In Loro's terms** (`carriedDeps`, `loroAgrees`; `loro.json`): a Loro change's `deps` leave out its writer's own
//! previous op when another op builds on it, since a writer's counters are contiguous. An envelope's Loro dependencies
//! are therefore read as [`carried_deps`]: its writer's previous op first, when it has one, then the change's other
//! deps sorted by op id. A writer names `prev` first and its `deps` in that same order.

use aven_core::Hash;

/// A Loro op id: the writer id and the counter.
pub type OpId = (u64, u64);

/// What a reader decides of an envelope's two names of its past.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpsVerdict {
    /// Its Loro dependencies are the last ops of what it names.
    Agrees,
    /// It names an envelope the reader doesn't hold.
    Waits,
    /// Its op ids and hashes disagree.
    Disagree,
    /// Two envelopes held with one last op id (`usedOk` fails).
    UsedTwice,
}

impl OpsVerdict {
    /// The vectors' words.
    pub fn text(self) -> &'static str {
        match self {
            OpsVerdict::Agrees => "agrees",
            OpsVerdict::Waits => "waits: names what isn't held",
            OpsVerdict::Disagree => "refused: op ids and hashes disagree",
            OpsVerdict::UsedTwice => "refused: an op id used twice",
        }
    }
}

/// Rule 7's check: `held` is what the reader holds, each envelope's name and last op id; `last` is the envelope's own
/// last op id, `named` what it names by hash (`prev`, then `deps`), and `carried` its Loro dependencies.
pub fn ops_agree(
    held: &[(Hash, OpId)],
    last: OpId,
    named: &[Hash],
    carried: &[OpId],
) -> OpsVerdict {
    let mut lasts: Vec<OpId> = held.iter().map(|h| h.1).chain([last]).collect();
    lasts.sort();
    if lasts.windows(2).any(|w| w[0] == w[1]) {
        return OpsVerdict::UsedTwice;
    }
    let Some(past) = named
        .iter()
        .map(|n| held.iter().find(|h| h.0 == *n).map(|h| h.1))
        .collect::<Option<Vec<OpId>>>()
    else {
        return OpsVerdict::Waits;
    };
    if past == carried {
        OpsVerdict::Agrees
    } else {
        OpsVerdict::Disagree
    }
}

/// An envelope's Loro dependencies from its change's `deps` (`frontier`), for a commit of `writer` starting at
/// counter `from`: the writer's previous op first, then the others by op id. `None` when the change names an op of
/// its own writer other than the one just before it.
pub fn carried_deps(frontier: &[OpId], writer: u64, from: u64) -> Option<Vec<OpId>> {
    let own = from.checked_sub(1).map(|c| (writer, c));
    let mut others = Vec::new();
    for &d in frontier {
        if d.0 == writer {
            if Some(d) != own {
                return None;
            }
        } else {
            others.push(d);
        }
    }
    others.sort();
    others.dedup();
    Some(own.into_iter().chain(others).collect())
}

/// What a reader decides of a Loro commit's deps against what its envelope names (`LoroVerdict`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoroVerdict {
    Agrees,
    Waits,
    Disagrees,
    /// The change names an older op of its own writer.
    OwnOp,
}

impl LoroVerdict {
    /// The vectors' words.
    pub fn text(self) -> &'static str {
        match self {
            LoroVerdict::Agrees => "agrees",
            LoroVerdict::Waits => "waits: names what isn't held",
            LoroVerdict::Disagrees => "refused: op ids and hashes disagree",
            LoroVerdict::OwnOp => "refused: names an older op of its own writer",
        }
    }
}

/// Rule 7 on a Loro commit (`loroAgrees`): the deps it carries, read by [`carried_deps`] from its change's deps
/// (`frontier`) for `writer` starting at `start`, are the last op ids of what it names by hash, `prev` first; `held`
/// gives each held envelope's name and last op id.
pub fn loro_agrees(
    held: &[(Hash, OpId)],
    writer: u64,
    start: u64,
    named: &[Hash],
    frontier: &[OpId],
) -> LoroVerdict {
    let Some(carried) = carried_deps(frontier, writer, start) else {
        return LoroVerdict::OwnOp;
    };
    let Some(past) = named
        .iter()
        .map(|n| held.iter().find(|h| h.0 == *n).map(|h| h.1))
        .collect::<Option<Vec<OpId>>>()
    else {
        return LoroVerdict::Waits;
    };
    if past == carried {
        LoroVerdict::Agrees
    } else {
        LoroVerdict::Disagrees
    }
}

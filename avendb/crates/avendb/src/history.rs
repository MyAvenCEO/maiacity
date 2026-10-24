//! History and proposals of one entry (T10; `avendb/spec/AvenDB/Proposals.lean` and `Doc.lean`). Every write is an
//! edit, named by its edit id: it extends one line of the entry's history, the main line or a proposal
//! (`policy::Proposal`), and a line's history is its own writes and every write they build on (`policy::history`). What
//! a device shows on a line is the Loro content of the updates in that history. A version is any set of the entry's
//! writes, and holds what they build on: a device opens one read-only on a scratch item made from those updates, never
//! by checking out the item it edits, which would stop it taking imports.
//!
//! On each line a device edits as a Loro peer of that line (`doc`), so its edits on one line never wait for its edits
//! on another. A proposal starts from any version with a write that holds the proposal's name. A merge is a write on
//! the target that builds on the heads of both lines: its history is the union of both (T10g), which Loro merges, and
//! it carries the change that brings Loro's merged item to the three-way merge of the two lines' records from their
//! base, the version both histories hold in common, as git merges a file (`merge::merge`): so nothing the target
//! changed since the base is lost, all the other line changed alone lands, and where both changed one place
//! differently the target keeps its own unless the person merging takes the other's there (T10h). Where the merged
//! item already shows it, the write carries no change. The merged item imports first and changes after; Loro's own
//! revert is not used, as it isn't atomic in Loro 1.16.
//!
//! Only a line's latest edit is reverted as it is: its line goes back to the record of the version it built on
//! (`restore`, which puts back any version's record). An older edit is undone by a three-way merge of records
//! (`undo`), which keeps every change made since. A fork copies an item's record into a new entry, with no history
//! (`doc::Item::copy`).
//!
//! A **variant** is a line that stays open beside main, as a breed of an animal does: its start is a proposal's start
//! whose name holds `VARIANT_START` first (`History::variant`), sealed as every name is. It follows main by merges of
//! main into it, which keep its own value wherever both changed one place, so it goes on with main and never asks. A
//! device stores full Loro snapshots (`doc::Item::bytes`), never shallow ones: a shallow snapshot refuses the updates
//! of a proposal that starts before it.
//!
//! A line's history is made of the writes the entry's readers count (`Change::counted`, C1 to C4, S1 to S4): a write
//! counts where it fits the schemas its entry was written under, through a share only where the ops of the shares of
//! its chain allow what it touches and the tags it asks for, and only if what it builds on counts too. Both are read
//! off what it carries, on the history before it (`History::reading`). So a write that breaks its schema, or that no op
//! of its shares allows, changes no line anyone shows, and nothing a device writes builds on it.
//!
//! A **draft** is an entry whose creation starts its own line (`Proposal::New`), as a Suggester proposes a new entry:
//! its main line holds nothing until it **lands**, when a write its readers count on main builds on its creation, in
//! practice its vault's merge of that line (`History::landed`). Only the entry's vault lands it: a write on main of an
//! unlanded draft through a share counts for no reader (`History::lands`, `policy::State::uncounted`), so a device
//! shows the entry on no main read until its vault takes it in.
//!
//! `History` is what a device holds of one entry, every accepted write with what it could open; the Lab builds one
//! for each entry it shows. `Repo` keeps one locally, with no keys and no shares, for the tests and the property
//! checks.

use std::collections::{BTreeSet, HashMap, HashSet};

use serde_json::{Map, Value};

use crate::doc::{Item, Peer};
use crate::id::{AudienceId, BlobId, EditId, EntryId, SignerId, VaultId};
use crate::lens::Lane;
use crate::merge::{self, Merged, Place};
use crate::ops::Loc;
use crate::policy::{self, Line, Proposal, Refusal, Write};
use crate::rules::{self, Touch};

/// The main line.
pub const MAIN: Line = None;

/// The byte a variant's start holds before its name (`History::variant`): never a byte of UTF-8 text, so no
/// proposal's name begins with it.
pub const VARIANT_START: u8 = 0xFF;

/// One accepted write of an entry as a device holds it: the write, what it carries if the device could open it (a
/// Loro update, nothing for a merge Loro's merged item already shows, or for a write that starts a proposal, the
/// proposal's name), whether it fits the
/// schemas its entry was written under as far as the entry's readers judged it (`History::reading`, which they read
/// only where what it builds on counts), what it touches and the tags it asks for as they read them (`None` where they
/// couldn't, or didn't, as what it builds on doesn't count), and whether they count it (`policy::State::lets`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Change {
    pub write: Write,
    pub body: Option<Vec<u8>>,
    pub fits: bool,
    pub touches: Option<Vec<Touch>>,
    pub counted: bool,
    /// The rows it added, as its readers read them off it (`Reading::adds`): whose each row is (`History::mine`).
    pub adds: Vec<crate::ops::Loc>,
}

impl AsRef<Write> for Change {
    fn as_ref(&self) -> &Write {
        &self.write
    }
}

impl Change {
    /// It is its entry's vault accepting the proposal it is on, as its readers read it (`policy::is_accept`, M2): the
    /// touches it was read with hold the tags it asks for.
    pub fn accept(&self) -> bool {
        policy::is_accept(&self.write, self.touches.as_deref(), &Default::default())
    }
}

/// A write a device is about to make on an entry: the line it extends, what it builds on, and what it carries.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Draft {
    pub proposal: Proposal,
    pub deps: Vec<EditId>,
    pub body: Vec<u8>,
}

/// The proposal a write extending `line` names.
fn on(line: Line) -> Proposal {
    line.map_or(Proposal::Main, Proposal::On)
}

/// One entry's history as one device holds it: every accepted write, in replay order.
#[derive(Clone, Debug, Default)]
pub struct History {
    changes: Vec<Change>,
}

/// A scratch item of an entry, the writes it holds and the schemas they were written under, which
/// `History::reading_on` grows from one write's version to the next's where it holds no write outside it: so reading a
/// run of writes imports each once.
pub struct Scratch {
    item: Item,
    holds: HashSet<EditId>,
    authored: BTreeSet<BlobId>,
    /// The write it was last grown by: it holds that write's version and that write, and nothing else.
    tip: Option<EditId>,
}

/// The exact scratch state attested by an entry's owners, never an authorization kernel.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ScratchImage {
    pub snapshot: Vec<u8>,
    pub holds: BTreeSet<EditId>,
    pub authored: BTreeSet<BlobId>,
    pub tip: Option<EditId>,
}

impl Scratch {
    pub(crate) fn from_attested_item(item: Item, changes: &[&Change]) -> Option<Self> {
        if item.has_parked_updates() || changes.iter().any(|c|!c.counted) {return None;}
        let authored=item.authored();
        Some(Self {item,holds:changes.iter().map(|c|c.write.edit).collect(),authored,tip:None})
    }
    pub(crate) fn within_version(&self, history:&History, deps:&[EditId])->bool {
        let ids:HashSet<_>=history.version(deps).iter().map(|c|c.write.edit).collect();
        self.holds.is_subset(&ids)
    }
    pub(crate) fn image(&self) -> Option<ScratchImage> {
        if self.item.has_parked_updates() { return None; }
        Some(ScratchImage { snapshot: self.item.bytes(), holds: self.holds.iter().copied().collect(),
            authored: self.authored.clone(), tip: self.tip })
    }
    pub(crate) fn from_owner_image(image: ScratchImage, signer: SignerId, line: Line) -> Option<Self> {
        if image.tip.is_some_and(|id| !image.holds.contains(&id)) { return None; }
        let item = Item::from_owner_snapshot(&image.snapshot, signer, line)?;
        if item.authored() != image.authored { return None; }
        Some(Self { item, holds: image.holds.into_iter().collect(), authored: image.authored, tip: image.tip })
    }

    /// The schemas the writes it read were written under: those `Lane::fits` looked up for them.
    pub fn authored(&self) -> &BTreeSet<BlobId> {
        &self.authored
    }

    fn new(signer: SignerId, line: Line) -> Scratch {
        Scratch { item: Item::new_on(signer, line), holds: HashSet::new(), authored: BTreeSet::new(), tip: None }
    }

    /// A copy to read a write on without changing this one: its item forked, as the same device.
    pub fn fork(&self) -> Scratch {
        let (holds, authored) = (self.holds.clone(), self.authored.clone());
        Scratch { item: self.item.clone(), holds, authored, tip: self.tip }
    }

    /// Fork a fully imported scratch only if it holds exactly the selected counted line history.
    /// Canonical selection stays with History; extra/absent/unjudged writes force normal rebuilding.
    pub(crate) fn shown_for(&self, changes: &[&Change], signer: SignerId, line: Line) -> Option<Item> {
        if self.item.has_parked_updates() || self.holds.len() != changes.len()
            || !changes.iter().all(|c| c.counted && self.holds.contains(&c.write.edit))
            || !changes.iter().any(|c| updates(&c.write) && c.body.as_ref().is_some_and(|b| !b.is_empty()))
        {
            return None;
        }
        Some(self.item.fork_on(signer, line))
    }

    /// Import the update change `c` carries, noting the schemas it was written under.
    fn import(&mut self, c: &Change) {
        let since = self.item.version();
        if import(&mut self.item, c) {
            self.authored.extend(self.item.authored_since(&since));
        }
    }
}

/// What a write's readers read off what it carries (`History::reading`): what it touches (`rules::Touch`), `None` where
/// they can't read it; the rows its update added, each by its place (`doc::Footprint::adds`), which are its writer's
/// own once they count it (`policy::Mine`); and whether it fits the schemas its entry was written under
/// (`lens::Lane::fits`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reading {
    pub touches: Option<Vec<Touch>>,
    pub adds: Vec<Loc>,
    pub fits: bool,
}

/// A release of a line (`History::releases`): the write, and its version number on that line.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Release {
    pub edit: EditId,
    pub version: u64,
}

/// A version of a line by its releases (`History::describe`): the highest release of the line it holds, `None` before
/// the line's first (a draft not yet landed, for the main line), and how many of the line's writes it holds after it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Described {
    pub version: Option<u64>,
    pub edits: usize,
}

impl History {

    /// Exact dependency-cut bodies that must be imported beyond the eligible scratch.
    /// IDs identify signed edits with inline authenticated ciphertext, not blob roots.
    pub(crate) fn missing_dependency_bodies(&self, deps: &[EditId], scratch: Option<&Scratch>) -> Vec<EditId> {
        let scratch = scratch.filter(|s| s.within_version(self, deps));
        self.version(deps).iter().filter(|c| c.counted && c.body.is_none()
            && scratch.is_none_or(|s| !s.holds.contains(&c.write.edit)))
            .map(|c| c.write.edit).collect()
    }

    /// Hydrate omitted bodies only from locally authenticated opened edits.
    pub(crate) fn restore_held_bodies(&mut self, bodies: &HashMap<EditId, crate::slice::Body>) {
        for change in &mut self.changes {
            if change.body.is_none() {
                if let Some(body) = bodies.get(&change.write.edit) {
                    change.body = Some(body.content.clone());
                }
            }
        }
    }
    /// Add the next accepted write. Refused, as the rules refuse it, if it builds on a write the history doesn't
    /// hold or, on a proposal, on neither the proposal's start nor another write on it.
    pub fn push(&mut self, c: Change) -> Result<(), Refusal> {
        policy::builds_on(&self.changes, &c.write)?;
        self.changes.push(c);
        Ok(())
    }

    /// Restore already counted metadata in one pass without repeatedly scanning
    /// its entire prefix for dependencies. This is not authorization: every write
    /// still passes the same canonical builds-on gate before entering the index.
    pub(crate) fn from_changes(changes: Vec<Change>) -> Result<Self, Refusal> {
        let mut preceding: HashMap<EditId, Vec<&Write>> = HashMap::new();
        for change in &changes {
            policy::builds_on_lookup(&change.write, |id| {
                preceding.get(&id).into_iter().flatten().copied()
            })?;
            preceding.entry(change.write.edit).or_default().push(&change.write);
        }
        Ok(Self { changes })
    }

    /// One ordinary admission gate for local authoring and remote counting. The caller
    /// derives authorization from the current policy, proof and row ownership. This
    /// does not authenticate a Write or make missing history trustworthy.
    pub(crate) fn admit<T>(
        &self, w: &Write, read: &Reading,
        authorize: impl FnOnce() -> Result<T, Refusal>,
    ) -> Result<T, Refusal> {
        policy::builds_on(&self.changes, w)?;
        if !w.deps.iter().all(|id| self.get(*id).is_some_and(|c| c.counted)) {
            return Err(Refusal::NotAccepted);
        }
        if !self.lands(w) { return Err(Refusal::NotLanded); }
        let proof = authorize()?;
        if !read.fits { return Err(Refusal::NotAView); }
        if !self.passes(w, read.touches.as_deref()) { return Err(Refusal::NotAccepted); }
        Ok(proof)
    }

    /// Verify a proposed full CRDT base against independently counted, readable history.
    /// Equal JSON/version vectors alone are insufficient: compare every snapshot byte.
    /// A conservative encoding mismatch rejects reuse, never weakens admission. The
    /// returned scratch contains the canonical reconstructed Item, not unchecked input.
    pub(crate) fn snapshot_scratch(
        &self, basis: &[EditId], snapshot: &[u8], signer: SignerId, line: Line,
    ) -> Option<Scratch> {
        if basis.is_empty() || !basis.iter().all(|id| self.get(*id).is_some()) { return None; }
        let changes = self.version(basis);
        if changes.iter().any(|c| !c.counted || c.body.is_none()) { return None; }
        let holds: HashSet<_> = changes.iter().map(|c| c.write.edit).collect();
        if changes.iter().any(|c| !c.write.deps.iter().all(|id| holds.contains(id))) { return None; }
        let item = build(&changes, signer, line)?;
        if item.has_parked_updates() || item.bytes() != snapshot { return None; }
        let authored = item.authored();
        Some(Scratch { item, holds, authored, tip: None })
    }

    pub fn changes(&self) -> &[Change] {
        &self.changes
    }

    /// Whose each row of the entry is, by the writes it counts (`policy::Mine`): what a write on top of them is judged
    /// by, as its readers will judge it.
    pub fn mine(&self) -> policy::Mine {
        let mut mine = policy::Mine::default();
        for c in &self.changes {
            mine.note(&c.write, &c.adds, c.counted);
        }
        mine
    }

    /// The writes the entry's readers count, in replay order.
    fn counted(&self) -> impl DoubleEndedIterator<Item = &Change> {
        self.changes.iter().filter(|c| c.counted)
    }

    /// Write `w`, read with the touches `touches`, passes its entry's merge policy on this history (`policy::passes`,
    /// M2): a merge into the main line through a share builds on the vault's accept (`Change::accept`), and on nothing
    /// but accepts and writes on the main line.
    pub fn passes(&self, w: &Write, touches: Option<&[Touch]>) -> bool {
        let accept = |d: &EditId| self.get(*d).is_some_and(Change::accept);
        let main = |d: &EditId| self.get(*d).is_some_and(|c| c.write.proposal == Proposal::Main);
        policy::passes(w, touches, accept, main)
    }

    pub fn get(&self, edit: EditId) -> Option<&Change> {
        self.changes.iter().find(|c| c.write.edit == edit)
    }

    /// The lines: the main line, then each proposal and variant in the order it started, of those whose start counts.
    pub fn lines(&self) -> Vec<Line> {
        let starts = self.counted().filter(|c| c.write.proposal == Proposal::New).map(|c| Some(c.write.edit));
        std::iter::once(MAIN).chain(starts).collect()
    }

    /// The name of the proposal or variant `b` started, if the device could open it: none for a draft's line, whose
    /// start holds the entry's first content, not a name.
    pub fn name(&self, b: EditId) -> Option<String> {
        let c = self.get(b).filter(|c| c.write.proposal == Proposal::New && !c.write.first)?;
        let body = c.body.as_deref()?;
        String::from_utf8(body.strip_prefix(&[VARIANT_START]).unwrap_or(body).to_vec()).ok()
    }

    /// Line `b` is a variant: its start, as the device opens it, holds `VARIANT_START` before its name.
    pub fn is_variant(&self, b: EditId) -> bool {
        let start = self.get(b).filter(|c| c.write.proposal == Proposal::New && !c.write.first);
        start.and_then(|c| c.body.as_ref()).is_some_and(|body| body.first() == Some(&VARIANT_START))
    }

    /// The variants, in the order they started, of those whose start counts.
    pub fn variants(&self) -> Vec<EditId> {
        self.lines().into_iter().flatten().filter(|&b| self.is_variant(b)).collect()
    }

    /// Line `line` lacks writes of line `of`: a head of `of` is outside its history, as a variant is behind main once a
    /// release lands there that it hasn't followed.
    pub fn behind(&self, line: Line, of: Line) -> bool {
        let held: HashSet<EditId> = self.history(line).iter().map(|c| c.write.edit).collect();
        self.heads(of).iter().any(|h| !held.contains(h))
    }

    /// The entry is a draft: its creation, which every peer reads in the clear, started its own line.
    pub fn draft(&self) -> bool {
        self.changes.iter().any(|c| c.write.first && c.write.proposal == Proposal::New)
    }

    /// The entry has landed (`State.lean`'s `landed`): it is no draft, or its creation is in the history of its main
    /// line, of the writes its readers count. Every entry created on main has, from its creation on; a draft once a
    /// counted write on main builds on its creation, in practice its vault's merge of its line.
    pub fn landed(&self) -> bool {
        landed_among(&self.changes)
    }

    /// Write `w` passes the landing rule on this history, which holds the writes before it (`State.lean`'s `counts`):
    /// it acts for the entry's vault, so relies on no share, or is on a proposal, or the entry has landed. A write on
    /// main of a draft not yet landed through a share counts for no reader: only the vault lands a draft.
    pub fn lands(&self, w: &Write) -> bool {
        w.shares.is_empty() || w.proposal != Proposal::Main || self.landed()
    }

    /// `lands`, of write `edit` this history holds, on the writes before it.
    pub fn landed_for(&self, edit: EditId) -> bool {
        let Some(at) = self.changes.iter().position(|c| c.write.edit == edit) else { return true };
        let w = &self.changes[at].write;
        w.shares.is_empty() || w.proposal != Proposal::Main || landed_among(&self.changes[..at])
    }

    /// The history of `line`: its own writes and everything they build on, oldest first, of the writes that count.
    pub fn history(&self, line: Line) -> Vec<&Change> {
        policy::history(self.counted(), line)
    }

    /// What the next write on `line` builds on.
    pub fn heads(&self, line: Line) -> Vec<EditId> {
        policy::tips(&self.history(line))
    }

    /// The writes of `version` and everything they build on, oldest first: what that version holds.
    pub fn version(&self, version: &[EditId]) -> Vec<&Change> {
        let mut needed: HashSet<EditId> = version.iter().copied().collect();
        let mut out = vec![];
        for c in self.changes.iter().rev() {
            if needed.contains(&c.write.edit) {
                needed.extend(c.write.deps.iter().copied());
                out.push(c);
            }
        }
        out.reverse();
        out
    }

    /// The item the device shows on `line`, as `signer` edits it there: the updates of the line's history. `None` if
    /// it opens none of them.
    pub fn item(&self, line: Line, signer: SignerId) -> Option<Item> {
        build(&self.history(line), signer, line)
    }

    /// The item at `version`, made from scratch from the updates it holds, as `signer` would edit it on `line`: how a
    /// device opens any version read-only, and makes the change a merge carries.
    pub fn item_at(&self, version: &[EditId], signer: SignerId, line: Line) -> Item {
        build(&self.version(version), signer, line).unwrap_or_else(|| Item::new_on(signer, line))
    }

    /// The schemas the update of write `edit` was written under, imported on the version it builds on: none for a write
    /// the device can't open, a proposal's start, a merge, a restore or an undo, which name none.
    pub fn written_under(&self, edit: EditId, signer: SignerId) -> BTreeSet<BlobId> {
        let Some(c) = self.get(edit) else { return BTreeSet::new() };
        let w = &c.write;
        let Some(update) = c.body.as_ref().filter(|u| updates(w) && !u.is_empty()) else {
            return BTreeSet::new();
        };
        let mut item = self.item_at(&w.deps, signer, w.line());
        let since = item.version();
        match item.import_as(update, Peer::of(w)) {
            Ok(()) => item.authored_since(&since),
            Err(_) => BTreeSet::new(),
        }
    }

    /// What write `w`'s readers read off what it carries, `body` (`None`: they can't open it), on this history, which
    /// holds the writes before it, judging it by the schemas `lane` holds.
    ///
    /// What it touches: its creation; a proposal's start; another line merged in, where it builds on a write its line's
    /// history doesn't hold, and each place the writes it brings in changed (`brought`); and what its update's ops
    /// touch, imported on the version it builds on (`doc::Item::footprint`). `None` where it carries an update they
    /// can't open or that doesn't import there whole: no rule allows what they can't read.
    ///
    /// Whether it fits (`lens::Lane::fits`): what its update changes, from the record of that version (nothing, for a
    /// creation) to the record after it, under the schemas the entry was written under once it is in. A proposal's
    /// start, a merge and a write of tags alone change no record, and fit; a write they can't open, or whose update
    /// doesn't import there whole, they can't judge, and it doesn't.
    pub fn reading(&self, w: &Write, body: Option<&[u8]>, signer: SignerId, lane: &Lane) -> Reading {
        self.reading_on(&mut None, w, body, signer, lane)
    }

    /// `reading`, on the scratch item `at` holds, made anew where it holds a write outside the version `w` builds on.
    pub fn reading_on(
        &self,
        at: &mut Option<Scratch>,
        w: &Write,
        body: Option<&[u8]>,
        signer: SignerId,
        lane: &Lane,
    ) -> Reading {
        if w.proposal == Proposal::New && !w.first {
            return Reading { touches: Some(vec![Touch::Propose]), adds: vec![], fits: true };
        }
        let mut out = vec![];
        if w.first {
            out.push(Touch::Create);
        } else if !self.on_its_line(w) {
            out.push(Touch::Merge);
            out.extend(self.brought(w));
        }
        // a creation touches its creation alone, whatever it holds
        let unread = |out: Vec<Touch>| Reading { touches: w.first.then_some(out), adds: vec![], fits: false };
        let Some(update) = body else { return unread(out) };
        if update.is_empty() {
            return Reading { touches: Some(out), adds: vec![], fits: true };
        }
        let s = match at.take() {
            // it holds the version `w` builds on, and nothing else
            Some(s) if s.tip.is_some() && w.deps == s.tip.as_slice() => at.insert(s),
            s => {
                let version = self.version(&w.deps);
                let within: HashSet<EditId> = version.iter().map(|c| c.write.edit).collect();
                let s = match s {
                    Some(s) if s.holds.is_subset(&within) => at.insert(s),
                    _ => at.insert(Scratch::new(signer, w.line())),
                };
                for c in version {
                    if s.holds.insert(c.write.edit) {
                        s.import(c);
                    }
                }
                s
            }
        };
        s.holds.insert(w.edit);
        s.tip = Some(w.edit);
        let since = s.item.version();
        let Some(footprint) = s.item.footprint_as(update, Peer::of(w)) else {
            // it may hold part of the update: made anew next time
            *at = None;
            return unread(out);
        };
        s.authored.extend(s.item.authored_since(&since));
        let fits = lane.fits(&s.authored, &footprint.before, &footprint.after);
        if !w.first {
            out.extend(footprint.touches);
        }
        Reading { touches: Some(rules::dedup(out)), adds: footprint.adds, fits }
    }

    /// What merge `w` brings in, place by place (`Touch::Merged`), each place once: every place a write it builds on,
    /// that its line's history doesn't hold, changed, by what its readers read it touched (`Change::touches`), the
    /// place it set or the list whose rows it changed; the whole record for a write they couldn't read. A proposal's
    /// start, a merge itself and a tag change no place, and a creation on main is on every line; a draft's creation,
    /// on its own line alone, brings the whole record, so a merge op limited to a path never carries a draft into
    /// another line (M1). So a merge's touches name every place the line it merges in changed since their base, and a
    /// merge op's path judges them.
    fn brought(&self, w: &Write) -> Vec<Touch> {
        let held: HashSet<EditId> = self.history(w.line()).iter().map(|c| c.write.edit).collect();
        let mut out = vec![];
        for c in self.version(&w.deps).into_iter().filter(|c| !held.contains(&c.write.edit)) {
            let Some(ts) = &c.touches else {
                out.push(Touch::Merged(Loc::root()));
                continue;
            };
            let draft = c.write.proposal == Proposal::New;
            out.extend(ts.iter().filter_map(|t| match t {
                Touch::Set(l, _) | Touch::Own(l, _) | Touch::Insert(l) | Touch::Remove(l) | Touch::Move(l) => {
                    Some(Touch::Merged(l.clone()))
                }
                Touch::Create if draft => Some(Touch::Merged(Loc::root())),
                Touch::Merged(_) | Touch::Merge | Touch::Propose | Touch::Tag(_) | Touch::Create => None,
            }));
        }
        rules::dedup(out)
    }

    /// Write `w` builds only on writes its line's history holds: no other line's writes come in with it.
    fn on_its_line(&self, w: &Write) -> bool {
        // what it builds on on its own line, and counts, is in that history
        let same = |d: &EditId| self.get(*d).is_some_and(|c| c.counted && c.write.line() == w.line());
        if w.deps.iter().all(same) {
            return true;
        }
        let held: HashSet<EditId> = self.history(w.line()).iter().map(|c| c.write.edit).collect();
        w.deps.iter().all(|d| held.contains(d))
    }

    /// The record `signer` shows on `line`: `{}` before any update.
    pub fn record(&self, line: Line, signer: SignerId) -> Value {
        self.item(line, signer).map_or_else(|| Value::Object(Map::new()), |i| i.record())
    }

    /// An edit on `line`: `change` edits the item `signer` shows there, and the write carries what changed.
    pub fn edit(&self, line: Line, signer: SignerId, change: impl FnOnce(&mut Item)) -> Draft {
        self.edit_on(None, line, signer, change)
    }

    /// `edit`, on `shown`, a copy of the item `signer` shows on `line` where it holds one: the same item, made without
    /// importing the line's history again.
    pub fn edit_on(&self, shown: Option<Item>, line: Line, signer: SignerId, change: impl FnOnce(&mut Item)) -> Draft {
        let mut item = shown.or_else(|| self.item(line, signer)).unwrap_or_else(|| Item::new_on(signer, line));
        let since = item.version();
        change(&mut item);
        Draft { proposal: on(line), deps: self.heads(line), body: item.export(&since) }
    }

    /// A new proposal named `name`, starting from `version`.
    pub fn propose(&self, version: &[EditId], name: &str) -> Draft {
        Draft { proposal: Proposal::New, deps: version.to_vec(), body: name.as_bytes().to_vec() }
    }

    /// A new variant named `name`, starting from `version`: a proposal's start whose name holds `VARIANT_START` first.
    pub fn variant(&self, version: &[EditId], name: &str) -> Draft {
        let body = std::iter::once(VARIANT_START).chain(name.bytes()).collect();
        Draft { proposal: Proposal::New, deps: version.to_vec(), body }
    }

    /// The base of a merge of `from` into `into`: the version both lines' histories hold in common, the writes of it
    /// no write of it builds on, as git takes a merge base.
    pub fn base(&self, from: Line, into: Line) -> Vec<EditId> {
        let theirs: HashSet<EditId> = self.history(from).iter().map(|c| c.write.edit).collect();
        let common: Vec<&Change> = self.history(into).into_iter().filter(|c| theirs.contains(&c.write.edit)).collect();
        policy::tips(&common)
    }

    /// What a merge of `from` into `into` shows, as `signer` reads them, and its conflicts (`merge::merge`): the
    /// three-way merge of the record of their base, what `into` shows and what `from` shows, taking `from`'s value at
    /// the conflicts `take` names.
    pub fn merged(&self, from: Line, into: Line, signer: SignerId, take: &BTreeSet<Place>) -> Merged {
        let record = |v: Value| match v {
            Value::Object(r) => r,
            _ => Map::new(),
        };
        let base = record(self.item_at(&self.base(from, into), signer, into).record());
        merge::merge(&base, &record(self.record(into, signer)), &record(self.record(from, signer)), take)
    }

    /// A merge of `from` into `into`: a write on `into` that builds on the heads of both, so the history of `into` is
    /// then the union of both (T10g), carrying the change that brings Loro's merged item to what the merge shows
    /// (`merged`), none where it shows that already (T10h).
    pub fn merge(&self, from: Line, into: Line, signer: SignerId, take: &BTreeSet<Place>) -> Draft {
        let deps = self.both(from, into);
        let mut item = self.item_at(&deps, signer, into);
        let want = Value::Object(self.merged(from, into, signer, take).record);
        if item.record() == want {
            return Draft { proposal: on(into), deps, body: vec![] };
        }
        let since = item.version();
        item.put_record(&want);
        Draft { proposal: on(into), deps, body: item.export(&since) }
    }

    /// Put the record of `version` back on `line`: a restore, or, to the version it built on, the revert of the
    /// line's latest edit.
    pub fn restore(&self, line: Line, version: &[EditId], signer: SignerId) -> Draft {
        let record = self.item_at(version, signer, line).record();
        self.put(line, signer, &record)
    }

    /// Undo the edit `edit` on `line`, keeping every change made since (`undo`). `None` if the history doesn't hold
    /// it. Undoing a merge takes back only the change it carried on Loro's merged item: restoring the version before it
    /// takes back the merge.
    pub fn undo(&self, line: Line, edit: EditId, signer: SignerId) -> Option<Draft> {
        let c = self.get(edit)?;
        let after = self.item_at(&[edit], signer, line).record();
        let before = self.item_at(&c.write.deps, signer, line).record();
        Some(self.put(line, signer, &undo(&self.record(line, signer), &after, &before)))
    }

    /// A write on `line` that brings its record to exactly `record`.
    fn put(&self, line: Line, signer: SignerId, record: &Value) -> Draft {
        let mut item = self.item(line, signer).unwrap_or_else(|| Item::new_on(signer, line));
        let since = item.version();
        item.put_record(record);
        Draft { proposal: on(line), deps: self.heads(line), body: item.export(&since) }
    }

    /// The releases of `line`, in replay order, each with its version number (`Proposals.lean`'s `releases`): the
    /// line's start (an entry's creation for the main line, a draft's for its own, a proposal's or a variant's start
    /// for theirs) and each write on it that brings in writes the line's history held nowhere in its own past, a
    /// merge of another line. A release's number is one more than the highest of the line's releases it builds on, so
    /// it is the same on every device that counts it, and never changes as more writes come: two merges made apart
    /// share their number, and the next release counts past both. Direct edits of a line make no release.
    pub fn releases(&self, line: Line) -> Vec<Release> {
        let writes: HashMap<EditId, &Write> = self.counted().map(|c| (c.write.edit, &c.write)).collect();
        let mut level: HashMap<EditId, u64> = HashMap::new();
        let mut out = vec![];
        for c in self.counted() {
            let w = &c.write;
            let below = w.deps.iter().filter_map(|d| level.get(d)).max().copied().unwrap_or(0);
            let release = w.line() == line && (w.first || w.proposal == Proposal::New || brings(&writes, w));
            let version = below + u64::from(release);
            level.insert(w.edit, version);
            if release {
                out.push(Release { edit: w.edit, version });
            }
        }
        out
    }

    /// Which release of `line` the version `heads` is, and how many of the line's writes it holds after it
    /// (`Described`): the highest number among the line's releases it holds, as `git describe` names a commit by
    /// its tag and the commits since.
    pub fn describe(&self, line: Line, heads: &[EditId]) -> Described {
        let held: HashSet<EditId> = self.version(heads).iter().filter(|c| c.counted).map(|c| c.write.edit).collect();
        let releases: Vec<Release> = self.releases(line).into_iter().filter(|r| held.contains(&r.edit)).collect();
        let Some(version) = releases.iter().map(|r| r.version).max() else {
            let edits = self.counted().filter(|c| held.contains(&c.write.edit) && c.write.line() == line).count();
            return Described { version: None, edits };
        };
        let at: Vec<EditId> = releases.iter().filter(|r| r.version == version).map(|r| r.edit).collect();
        let released: HashSet<EditId> = self.version(&at).iter().map(|c| c.write.edit).collect();
        let since = |c: &&Change| held.contains(&c.write.edit) && c.write.line() == line;
        let edits = self.counted().filter(since).filter(|c| !released.contains(&c.write.edit)).count();
        Described { version: Some(version), edits }
    }

    /// The version that is release `version` of `line`: the releases of that number, together (two merges made apart
    /// share one, and their union is the version that holds both). Empty if the line has none of that number.
    pub fn release(&self, line: Line, version: u64) -> Vec<EditId> {
        self.releases(line).into_iter().filter(|r| r.version == version).map(|r| r.edit).collect()
    }

    /// The heads of `into`, then those of `from` it doesn't share.
    fn both(&self, from: Line, into: Line) -> Vec<EditId> {
        let mut deps = self.heads(into);
        for h in self.heads(from) {
            if !deps.contains(&h) {
                deps.push(h);
            }
        }
        deps
    }
}

/// An item, as `signer` edits it on `line`, holding the updates of `changes` it can open, each checked against the
/// Loro peer of its author on its own line. `None` if none imports.
/// The item `changes` make, as `signer` edits it on `line`: `None` if it opens none of their updates.
pub fn build_from(changes: &[&Change], signer: SignerId, line: Line) -> Option<Item> {
    build(changes, signer, line)
}

/// Import the update change `c` carries into `item`: whether it took it.
pub fn import_change(item: &mut Item, c: &Change) -> bool {
    import(item, c)
}

fn build(changes: &[&Change], signer: SignerId, line: Line) -> Option<Item> {
    let mut item = Item::new_on(signer, line);
    let mut shown = false;
    for c in changes {
        shown |= import(&mut item, c);
    }
    shown.then_some(item)
}

/// Write `w`, of the counted writes `writes`, brings in writes its line's history held nowhere in its own past: some
/// write it builds on is neither on its line nor built on by a write of its line it builds on. Judged on `w`'s own
/// past alone, never on what came beside it, so every device that counts it judges it alike.
fn brings(writes: &HashMap<EditId, &Write>, w: &Write) -> bool {
    let line = w.line();
    let on_line = |d: &EditId| writes.get(d).is_some_and(|x| x.line() == line);
    if w.deps.iter().all(on_line) {
        return false;
    }
    // its past, and the history of its line in that past: the line's writes there and all they build on
    let closure = |from: Vec<EditId>| {
        let (mut seen, mut todo) = (HashSet::new(), from);
        while let Some(e) = todo.pop() {
            if seen.insert(e) {
                todo.extend(writes.get(&e).map_or(&[][..], |x| &x.deps[..]));
            }
        }
        seen
    };
    let past = closure(w.deps.clone());
    let held = closure(past.iter().copied().filter(on_line).collect());
    w.deps.iter().any(|d| !held.contains(d))
}

/// Import the update change `c` carries into `item`, checked against the Loro peer its write's ops carry
/// (`doc::Peer::of`): whether it did. A proposal's name, and a merge, change nothing.
fn import(item: &mut Item, c: &Change) -> bool {
    let w = &c.write;
    match &c.body {
        Some(update) if updates(w) && !update.is_empty() => item.import_as(update, Peer::of(w)).is_ok(),
        _ => false,
    }
}

/// What write `w` carries is an update of the record: anything but a proposal's start, whose body is its name; a
/// draft's creation, which starts its own line, holds the entry's first content as every creation does.
fn updates(w: &Write) -> bool {
    w.proposal != Proposal::New || w.first
}

/// Whether the entry of `changes`, one entry's writes in replay order, has landed (`History::landed`): it is no draft,
/// or a counted write on main holds its creation, the writes it builds on all counted as well.
fn landed_among(changes: &[Change]) -> bool {
    let Some(creation) = changes.iter().find(|c| c.write.first) else { return true };
    if creation.write.proposal != Proposal::New {
        return true;
    }
    policy::history(changes.iter().filter(|c| c.counted), MAIN).iter().any(|c| c.write.first)
}

/// The record `now` with the change from `before` to `after` taken back, and every change made since kept. Where `now`
/// is still `after`, `before` comes back; where the change changed nothing, `now` stays. Records go field by field,
/// and lists element by element, a record by its `id` and a value by itself: what the change added goes, what it
/// deleted comes back after what came before it, what it changed is undone inside, and the order it made goes back
/// unless the list changed since. A text or value that changed again since stays as it is now.
pub fn undo(now: &Value, after: &Value, before: &Value) -> Value {
    if now == after {
        return before.clone();
    }
    if after == before {
        return now.clone();
    }
    match (now, after, before) {
        (Value::Object(n), Value::Object(a), Value::Object(b)) => {
            let mut out = Map::new();
            let keys: Vec<&String> = {
                let mut seen = HashSet::new();
                n.keys().chain(a.keys()).chain(b.keys()).filter(|k| seen.insert(*k)).collect()
            };
            for k in keys {
                let field = |m: &Map<String, Value>| m.get(k).cloned().unwrap_or(Value::Null);
                let v = undo(&field(n), &field(a), &field(b));
                if !v.is_null() {
                    out.insert(k.clone(), v);
                }
            }
            Value::Object(out)
        }
        (Value::Array(n), Value::Array(a), Value::Array(b)) => Value::Array(undo_list(n, a, b)),
        _ => now.clone(),
    }
}

/// An element's key in a list: a record by its `id`, anything else by itself, and how many before it share that.
type Key = (Value, usize);

fn keys(list: &[Value]) -> Vec<Key> {
    let mut seen: HashMap<Value, usize> = HashMap::new();
    list.iter()
        .map(|e| {
            let id = match e.get("id") {
                Some(id) if e.is_object() => serde_json::json!({ "id": id }),
                _ => e.clone(),
            };
            let n = seen.entry(id.clone()).or_default();
            *n += 1;
            (id, *n - 1)
        })
        .collect()
}

fn undo_list(now: &[Value], after: &[Value], before: &[Value]) -> Vec<Value> {
    let (nk, ak, bk) = (keys(now), keys(after), keys(before));
    let a: HashMap<&Key, &Value> = ak.iter().zip(after).collect();
    let b: HashMap<&Key, &Value> = bk.iter().zip(before).collect();
    // what the change added goes; what it changed is undone where `now` still has it
    let mut out: Vec<(Key, Value)> = vec![];
    for (k, v) in nk.iter().zip(now) {
        match (a.get(k), b.get(k)) {
            (Some(_), None) => {}
            (Some(av), Some(bv)) => out.push((k.clone(), undo(v, av, bv))),
            _ => out.push((k.clone(), v.clone())),
        }
    }
    // what it deleted comes back, after the nearest element before it that is still there
    for (i, k) in bk.iter().enumerate() {
        if a.contains_key(k) || out.iter().any(|(x, _)| x == k) {
            continue;
        }
        let at = bk[..i].iter().rev().find_map(|p| out.iter().position(|(x, _)| x == p)).map_or(0, |p| p + 1);
        out.insert(at, (k.clone(), before[i].clone()));
    }
    // the order it made goes back, if the list hasn't changed since
    if nk == ak {
        let place: HashMap<&Key, usize> = bk.iter().enumerate().map(|(i, k)| (k, i)).collect();
        out.sort_by_key(|(k, _)| place.get(k).copied().unwrap_or(usize::MAX));
    }
    out.into_iter().map(|(_, v)| v).collect()
}

/// One entry's history kept locally, with no keys, shares or signatures: what proposals do to an item, for the tests
/// and the property checks of T10. Writes are numbered from 1; the first holds the item the repo starts from.
#[derive(Clone)]
pub struct Repo {
    history: History,
}

impl Repo {
    /// An entry whose first write, on the main line, holds `item`'s updates; `author` made it.
    pub fn new(item: &Item, author: SignerId) -> Repo {
        let mut repo = Repo { history: History::default() };
        let body = item.export(&Default::default());
        repo.make(author, Draft { proposal: Proposal::Main, deps: vec![], body }).expect("the first write");
        repo
    }

    pub fn history(&self) -> &History {
        &self.history
    }

    /// The item shown on `line`, as `signer` edits it there.
    pub fn item(&self, line: Line, signer: SignerId) -> Option<Item> {
        self.history.item(line, signer)
    }

    /// The writes on `line` and what they build on, oldest first.
    pub fn log(&self, line: Line) -> Vec<EditId> {
        self.history.history(line).iter().map(|c| c.write.edit).collect()
    }

    pub fn heads(&self, line: Line) -> Vec<EditId> {
        self.history.heads(line)
    }

    /// `author` edits the item on `line`.
    pub fn edit(&mut self, author: SignerId, line: Line, change: impl FnOnce(&mut Item)) -> EditId {
        let d = self.history.edit(line, author, change);
        self.make(author, d).expect("an edit on a line the repo holds")
    }

    /// `author` starts a proposal named `name` from `version`; its id names it.
    pub fn propose(&mut self, author: SignerId, version: &[EditId], name: &str) -> Result<EditId, Refusal> {
        let d = self.history.propose(version, name);
        self.make(author, d)
    }

    /// `author` merges `from` into `into`, `into` keeping its own value at every conflict.
    pub fn merge(&mut self, author: SignerId, from: Line, into: Line) -> EditId {
        self.merge_taking(author, from, into, &BTreeSet::new())
    }

    /// `author` merges `from` into `into`, taking `from`'s value at the conflicts `take` names.
    pub fn merge_taking(&mut self, author: SignerId, from: Line, into: Line, take: &BTreeSet<Place>) -> EditId {
        let d = self.history.merge(from, into, author, take);
        self.make(author, d).expect("a merge of lines the repo holds")
    }

    pub fn restore(&mut self, author: SignerId, line: Line, version: &[EditId]) -> EditId {
        let d = self.history.restore(line, version, author);
        self.make(author, d).expect("a restore on a line the repo holds")
    }

    pub fn undo(&mut self, author: SignerId, line: Line, edit: EditId) -> Option<EditId> {
        let d = self.history.undo(line, edit, author)?;
        Some(self.make(author, d).expect("an undo on a line the repo holds"))
    }

    /// Accept `d` as the next write, by `author`.
    pub fn make(&mut self, author: SignerId, d: Draft) -> Result<EditId, Refusal> {
        let edit = EditId::from_u64(self.history.changes.len() as u64 + 1);
        let (entry, actor) = (EntryId::from_u64(0), VaultId::from_u64(0));
        let (stay, epoch, audience, first) = (None, 0, AudienceId::of(actor, &[]), self.history.changes.is_empty());
        let (deps, proposal, via, shares) = (d.deps, d.proposal, vec![], vec![]);
        let write = Write { edit, author, actor, entry, stay, epoch, deps, proposal, via, first, audience, shares };
        self.history.push(Change { write, body: Some(d.body), fits: true, touches: None, counted: true, adds: vec![] })?;
        Ok(edit)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn indexed_history_restore_matches_sequential_admission() {
        let signer = SignerId::from_u64(2);
        let mut repo = Repo::new(&Item::document("Start", signer), signer);
        for n in 0..32 {
            repo.edit(signer, MAIN, |i| { i.edit_document(|d| d.title = format!("Edit {n}")); });
        }
        let branch = repo.propose(signer, &repo.heads(MAIN), "Proposal").unwrap();
        repo.edit(signer, Some(branch), |i| { i.edit_document(|d| d.title = "Branch".into()); });
        let canonical = repo.history().changes().to_vec();
        let check = |changes: Vec<Change>| {
            let mut sequential = History::default();
            let expected = changes.iter().cloned().try_for_each(|c| sequential.push(c));
            let actual = History::from_changes(changes.clone());
            assert_eq!(actual.as_ref().err(), expected.as_ref().err());
            if let Ok(actual) = actual {
                assert_eq!(actual.changes().iter().map(|c| &c.write).collect::<Vec<_>>(),
                    sequential.changes().iter().map(|c| &c.write).collect::<Vec<_>>());
                assert_eq!(actual.changes().iter().map(|c| &c.body).collect::<Vec<_>>(),
                    sequential.changes().iter().map(|c| &c.body).collect::<Vec<_>>());
            }
        };
        check(canonical.clone());
        let mut missing = canonical.clone(); missing.remove(0); check(missing);
        let mut future = canonical.clone(); future.swap(0, 1); check(future);
        let mut wrong_entry = canonical.clone(); wrong_entry[1].write.entry = EntryId::from_u64(99); check(wrong_entry);
        let mut wrong_branch = canonical.clone(); wrong_branch.last_mut().unwrap().write.proposal = Proposal::On(EditId::from_u64(999)); check(wrong_branch);
        let mut duplicate = canonical.clone(); duplicate.insert(1, canonical[0].clone()); check(duplicate);
    }

    #[test]
    fn undo_takes_back_one_change_and_keeps_the_rest() {
        let blocks = json!([{"id": 1, "text": "one"}, {"id": 2, "text": "two"}]);
        let before = json!({"title": "Welcome", "tags": ["a"], "blocks": blocks});
        // the change: a new title, a tag, block 2 deleted, block 3 added, block 1's text changed
        let blocks = json!([{"id": 1, "text": "uno"}, {"id": 3, "text": "three"}]);
        let after = json!({"title": "Hello", "tags": ["a", "b"], "blocks": blocks});
        assert_eq!(undo(&after, &after, &before), before);
        // since: a tag, block 4 at the start, and block 3's text
        let now = json!({"title": "Hello", "tags": ["a", "b", "c"],
            "blocks": [{"id": 4, "text": "four"}, {"id": 1, "text": "uno"}, {"id": 3, "text": "THREE"}]});
        let undone = json!({"title": "Welcome", "tags": ["a", "c"],
            "blocks": [{"id": 4, "text": "four"}, {"id": 1, "text": "one"}, {"id": 2, "text": "two"}]});
        assert_eq!(undo(&now, &after, &before), undone);
        // a field the change set and that changed again since stays
        let now = json!({"title": "Hi there", "tags": ["a", "b"], "blocks": []});
        assert_eq!(undo(&now, &after, &before)["title"], "Hi there");
        // nothing changed: nothing to undo
        assert_eq!(undo(&now, &before, &before), now);
    }

    #[test]
    fn undo_puts_back_an_order_unless_the_list_changed_since() {
        let before = json!([{"id": 1}, {"id": 2}, {"id": 3}]);
        let after = json!([{"id": 3}, {"id": 1}, {"id": 2}]);
        let now = json!([{"id": 3, "x": 1}, {"id": 1}, {"id": 2}]);
        assert_eq!(undo(&now, &after, &before), json!([{"id": 1}, {"id": 2}, {"id": 3, "x": 1}]));
        let now = json!([{"id": 3}, {"id": 1}, {"id": 2}, {"id": 4}]);
        assert_eq!(undo(&now, &after, &before), now);
    }

    #[test]
    fn each_merge_into_a_line_is_its_next_release() {
        let s = SignerId::from_u64(2);
        let mut repo = Repo::new(&Item::document("Welcome", s), s);
        let retitle = |title: &'static str| move |i: &mut Item| {
            i.edit_document(|d| d.title = title.into());
        };
        let releases = |repo: &Repo, line| repo.history().releases(line).iter().map(|r| r.version).collect::<Vec<_>>();
        assert_eq!(releases(&repo, MAIN), [1]);
        // a direct edit is no release: the version reads "v1 + 1 edit"
        repo.edit(s, MAIN, retitle("Hello"));
        assert_eq!(releases(&repo, MAIN), [1]);
        assert_eq!(repo.history().describe(MAIN, &repo.heads(MAIN)), Described { version: Some(1), edits: 1 });
        // a proposal merged in is v2, and the proposal's own start is its v1
        let p = repo.propose(s, &repo.heads(MAIN), "intro").unwrap();
        repo.edit(s, Some(p), retitle("Intro"));
        assert_eq!(releases(&repo, Some(p)), [1]);
        let v2 = repo.merge(s, Some(p), MAIN);
        assert_eq!(releases(&repo, MAIN), [1, 2]);
        assert_eq!(repo.history().release(MAIN, 2), [v2]);
        assert_eq!(repo.history().describe(MAIN, &[v2]), Described { version: Some(2), edits: 0 });
        // an older version still reads as what it was
        let v1 = repo.history().release(MAIN, 1);
        assert_eq!(repo.history().describe(MAIN, &v1), Described { version: Some(1), edits: 0 });
        // the proposal's writes, on another line, are no edits of main's
        assert_eq!(repo.history().describe(MAIN, &repo.heads(MAIN)), Described { version: Some(2), edits: 0 });
    }

    #[test]
    fn merges_made_apart_share_a_number_and_the_next_counts_past_both() {
        let s = SignerId::from_u64(2);
        let retitle = |title: &'static str| move |i: &mut Item| {
            i.edit_document(|d| d.title = title.into());
        };
        let mut repo = Repo::new(&Item::document("Welcome", s), s);
        let base = repo.heads(MAIN);
        let (a, b) = (repo.propose(s, &base, "a").unwrap(), repo.propose(s, &base, "b").unwrap());
        repo.edit(s, Some(a), retitle("A"));
        repo.edit(s, Some(b), retitle("B"));
        // two devices merge at once, each on the main line it saw, one of them merging `a` twice over
        let merge_of = |repo: &Repo, p: EditId| {
            let mut deps = base.clone();
            deps.extend(repo.heads(Some(p)));
            Draft { proposal: Proposal::Main, deps, body: vec![] }
        };
        let (ma, mb) = (merge_of(&repo, a), merge_of(&repo, b));
        let (ma, ma2, mb) = (repo.make(s, ma.clone()).unwrap(), repo.make(s, ma).unwrap(), repo.make(s, mb).unwrap());
        let numbered: Vec<(EditId, u64)> = repo.history().releases(MAIN).iter().map(|r| (r.edit, r.version)).collect();
        assert_eq!(numbered[1..], [(ma, 2), (ma2, 2), (mb, 2)]);
        assert_eq!(repo.history().release(MAIN, 2), [ma, ma2, mb]);
        // the next merge builds on all three, and is v3
        let c = repo.propose(s, &repo.heads(MAIN), "c").unwrap();
        repo.edit(s, Some(c), retitle("C"));
        let v3 = repo.merge(s, Some(c), MAIN);
        assert_eq!(repo.history().releases(MAIN).last(), Some(&Release { edit: v3, version: 3 }));
    }

    #[test]
    fn a_draft_is_v1_once_its_vault_lands_it() {
        let s = SignerId::from_u64(2);
        let mut repo = Repo { history: History::default() };
        let body = Item::document("Draft", s).export(&Default::default());
        let draft = repo.make(s, Draft { proposal: Proposal::New, deps: vec![], body }).unwrap();
        assert_eq!(repo.history().releases(MAIN), []);
        assert_eq!(repo.history().describe(MAIN, &repo.heads(MAIN)), Described { version: None, edits: 0 });
        assert_eq!(repo.history().releases(Some(draft)).iter().map(|r| r.version).collect::<Vec<_>>(), [1]);
        let landed = repo.merge(s, Some(draft), MAIN);
        assert_eq!(repo.history().releases(MAIN), [Release { edit: landed, version: 1 }]);
    }

    #[test]
    fn a_write_on_a_proposal_builds_on_it() {
        let item = Item::document("Welcome", SignerId::from_u64(2));
        let mut repo = Repo::new(&item, SignerId::from_u64(2));
        let first = repo.heads(MAIN);
        assert_eq!(first, [EditId::from_u64(1)]);
        let draft = repo.propose(SignerId::from_u64(2), &first, "draft").unwrap();
        // not on main's head alone, not on a write that started no proposal, not on one it doesn't hold
        let bad = |deps: Vec<EditId>, b: EditId| Draft { proposal: Proposal::On(b), deps, body: vec![] };
        assert_eq!(repo.make(SignerId::from_u64(2), bad(first.clone(), draft)), Err(Refusal::NotOnProposal));
        assert_eq!(repo.make(SignerId::from_u64(2), bad(first.clone(), first[0])), Err(Refusal::NotOnProposal));
        assert_eq!(repo.make(SignerId::from_u64(2), bad(vec![EditId::from_u64(9)], draft)), Err(Refusal::UnknownDep));
        assert!(repo.make(SignerId::from_u64(2), bad(vec![draft], draft)).is_ok());
        assert_eq!(repo.history().name(draft).as_deref(), Some("draft"));
        assert_eq!(repo.history().lines(), [MAIN, Some(draft)]);
    }
}

//! AIPs, Aven Improvement Proposals (`docs/ARCHITECTURE.md` §8, "AIPs"), as ops: the one proposal standard of every
//! vault and every type of entry, a layer read off what avenDB already holds. An AIP is a record of the shipped schema
//! "AIP, v1" (`lens::blobs::AIP_V1`) in one vault, which names proposal lines of entries of that vault, of any types,
//! with the text a person reads. Its readers count its writes, its lines' and its reviews' as they count any: nothing
//! here is a rule of the edits, and nothing is on the wire that wasn't.
//!
//! - **Stages.** `aip_open` makes an idea, named by a random key (`aip::key`); `aip_objective` writes what it must
//!   deliver, metrics in Lean (`crate::objective`), which makes an idea one at the objective stage, derived as archived
//!   is; `aip_measure` records a reading on it, which the metrics are checked against, so whoever works on it reads its
//!   progress in every `aip` read; `aip_promote` proposes it, once it holds an objective, and gives it
//!   the vault's next number, AIP-n, where it has none yet; `aip_withdraw` takes it back; `aip_review`, the vault's
//!   answer, accepts, declines or sends it back to revise, an idea again that keeps its number. Archived is never
//!   typed: an AIP is applied once every line's heads are on main, rejected once withdrawn or declined.
//! - **One review over every line.** The vault's acceptance writes its accept on each line at its heads, then merges
//!   it into main as the vault, taking the proposal's side wherever both lines changed one place, and then one review
//!   (`lens::blobs::REVIEW_V1`) whose `heads` are every accept: so nobody but the vault merges any line before it, as
//!   each line needs its accept (M2). The writes are each the device's own, signed as any write is, so the review
//!   asks for no passkey; they are tried dry first, so a review that would be refused makes nothing.
//! - **Numbers count per vault**, from what the device holds: two devices that promote apart may give one number
//!   twice. Every reader then labels them alike, by the write that set each number in the one order every device
//!   replays edits in (`aip::labels`): `AIP-n` first, then `AIP-n.2`.
//! - **What it changes is derived** (`aip::diff`): each line's record, read through its entry's own schema, against
//!   main's, as the vault's acceptance would merge it; once merged, against the version the proposal started from.
//! - **New entries** are drafts (`Lab::create_draft`): a line that is an entry's own creation, `new`, whose main line
//!   holds nothing until the vault's acceptance merges it, which lands it. Its diff adds every field; its summary
//!   reads `New <what>: <title> (+N fields)`; `public` says whether a share to everyone picks it once it lands, as
//!   the stewards then mark it into that audience.
//! - **An answer pins what it answers**: `aip_review` may name the heads of the lines as the person saw them, and is
//!   refused where any line moved since, so nothing written after the card was drawn is accepted unseen.
//!
//! The honest limit: each line's merge still counts on its own. One review accepts every line and merges them in one
//! go, but a reader that holds only some of the merges reads only those; all or none for every reader would need the
//! merge writes to name their bundle, a change on the wire left for the next reset.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use serde_json::{Map, Value, json};

use super::{Named, Refused, Step, bad, edits, entry_of, lane, own, see, step, vault_of};
use crate::aip;
use crate::history::MAIN;
use crate::id::{EditId, EntryId, SignerId, VaultId};
use crate::lab::Lab;
use crate::lens::{self, Lane};
use crate::objective::{self, Dec};
use crate::ops::{self, FieldOp, Link, Record, RecordOp};
use crate::policy::Refusal;
use crate::world;
use crate::slice::Attrs;

/// The type of an AIP entry, and its record's kind.
pub const AIP: &str = "aip";

/// The type of a review entry, and its record's kind.
const REVIEW: &str = "review";

/// The AIP schema, by its id: every op reads and writes an AIP through it, v2, an AIP v1 read through its lens.
fn schema() -> Named {
    Named::Id(lens::AIP_V2.id())
}

/// The most readings one AIP records.
const MAX_READINGS: usize = 2000;

fn set(field: &str, value: impl Into<Value>) -> RecordOp {
    RecordOp::top(field, FieldOp::Set(value.into()))
}

fn hexes(edits: impl IntoIterator<Item = EditId>) -> Vec<String> {
    let mut out: Vec<String> = edits.into_iter().map(|e| e.to_hex()).collect();
    out.sort();
    out.dedup();
    out
}

/// The lane device `me` reads vault `v` through, read once.
fn lane_of<'l>(lanes: &'l mut HashMap<VaultId, Lane>, lab: &Lab, me: SignerId, v: VaultId) -> &'l Lane {
    lanes.entry(v).or_insert_with(|| lane(lab, me, v))
}

/// An AIP as device `me` reads it: its entry, its vault, its labels, its record through AIP v2, and its lines, each a
/// proposal of an entry of its vault (a line that links another vault's is no line of it).
struct Aip {
    entry: EntryId,
    vault: VaultId,
    attrs: Attrs,
    record: Record,
    lines: Vec<(EntryId, EditId)>,
}

impl Aip {
    fn text(&self, field: &str) -> Option<&str> {
        self.record.get(field).and_then(Value::as_str)
    }

    fn number(&self) -> Option<u64> {
        self.record.get("number").and_then(Value::as_u64)
    }

    /// The stage its author or its vault typed: an idea, proposed or withdrawn.
    fn typed(&self) -> &str {
        self.text("stage").unwrap_or("idea")
    }

    /// Its objective's Lean, `""` where it has none.
    fn lean(&self) -> &str {
        self.text("objective").unwrap_or("")
    }

    /// Its readings, each a name and a value in millionths, in the order recorded: a row whose value is no number
    /// within the bound is none.
    fn readings(&self) -> Vec<(String, Dec)> {
        let rows = self.record.get("readings").and_then(ops::rows).unwrap_or_default();
        let one = |r: &Value| Some((r.get("name")?.as_str()?.to_string(), objective::dec_of(r.get("value")?)?));
        rows.iter().filter_map(one).collect()
    }

    /// Whether it holds an objective that reads: at least one metric.
    fn has_objective(&self) -> bool {
        !self.lean().trim().is_empty() && objective::parse(self.lean()).is_ok()
    }

    /// Its objective as people and agents read it: the Lean, and where it reads, each metric checked against the
    /// readings (`objective::summary_json`), else the error; then every reading. `null` where it has none.
    fn objective_json(&self) -> Value {
        let lean = self.lean();
        if lean.trim().is_empty() {
            return Value::Null;
        }
        let rows = self.record.get("readings").and_then(ops::rows).unwrap_or_default();
        let mut out = match objective::parse(lean) {
            Ok(ms) => objective::summary_json(&ms, &self.readings()),
            Err(e) => json!({ "error": e.to_string(), "metrics": [], "met": 0, "total": 0, "progress": 0 }),
        };
        out["lean"] = lean.into();
        out["readings"] = rows.to_vec().into();
        out
    }
}

/// Entry `entry` as an AIP, if device `me` reads it as one.
fn read(lab: &Lab, me: SignerId, lanes: &mut HashMap<VaultId, Lane>, entry: EntryId) -> Option<Aip> {
    let m = lab.meaning(me, entry).filter(|m| m.attrs.ty.as_str() == AIP)?;
    let vault = lab.vault_of_entry(me, entry)?;
    let seen = see(lane_of(lanes, lab, me, vault), lab.item(me, entry)?, &schema())?;
    let line = |row: &Value| {
        let link = Link::of_json(row.get("entry")?).filter(|l| l.vault == vault)?;
        Some((link.entry, EditId::from_hex(row.get("line")?.as_str()?)?))
    };
    let lines = seen.record.get("proposals").and_then(ops::rows).map(|rows| rows.iter().filter_map(line).collect());
    Some(Aip { entry, vault, attrs: m.attrs, record: seen.record, lines: lines.unwrap_or_default() })
}

/// Entry `entry` as an AIP: `NoEntry` where device `me` shows no such entry, `BadOp` where it is no AIP.
fn aip_of(lab: &Lab, me: SignerId, lanes: &mut HashMap<VaultId, Lane>, entry: EntryId) -> Result<Aip, Refused> {
    let m = lab.meaning(me, entry).filter(|_| lab.item(me, entry).is_some()).ok_or(Refused::NoEntry)?;
    if m.attrs.ty.as_str() != AIP {
        return Err(bad(format!("entry {} is no AIP: it is a {}", entry.to_hex(), m.attrs.ty.as_str())));
    }
    read(lab, me, lanes, entry).ok_or_else(|| Refused::NoSchema("the record isn't one of AIP, v1".into()))
}

/// A review as the AIPs read it: a record of Review, v1 its vault wrote itself, in the vault (one anyone else writes
/// there through a share is no answer of the vault's), with the place of the write that made it in the one order every
/// device replays edits in (`order`: its depth, then its id), which says which is newest.
#[derive(Clone)]
struct Review {
    id: EntryId,
    heads: Vec<String>,
    /// Who started what it answers, as its record names them: the AIP's author, not who answered.
    by: Value,
    /// Who answered: the vaults the writes of the review were signed in, as bylines read them (`world::authors`), the
    /// human whose device signed it after the coop's aven, in `world::authors_json`'s shape.
    authors: Value,
    verdict: String,
    text: String,
    at: u64,
    order: (u64, EditId),
}

impl Review {
    /// Whether its heads cover every line's heads now: it answers the AIP as it stands.
    fn covers(&self, lines: &[Line]) -> bool {
        !lines.is_empty() && lines.iter().all(|l| l.heads.iter().all(|h| self.heads.contains(&h.to_hex())))
    }

    fn to_json(&self, lines: &[Line]) -> Value {
        json!({
            "review": self.id.to_hex(),
            "verdict": self.verdict,
            "text": self.text,
            "heads": self.heads,
            "by": self.by,
            "authors": self.authors,
            "at": self.at,
            "current": self.covers(lines),
        })
    }
}

/// Where a write stands in the one order every device replays edits in: its depth, then its id.
fn order_of(lab: &Lab, me: SignerId, edit: EditId) -> (u64, EditId) {
    (lab.signed_edit(me, edit).map_or(0, |s| s.edit.depth), edit)
}

/// One proposal line as device `me` holds it: its entry's type and tags, its title on the line and its name, its
/// heads, and whether they are all on main (`merged`); `known` once the device shows the proposal; `new` where it is
/// a new entry, a draft whose creation started the line, and `public` where a share to everyone picks that entry once
/// it lands (`Lab::public_once_landed`).
struct Line {
    entry: EntryId,
    line: EditId,
    ty: Option<String>,
    tags: Vec<String>,
    title: Option<String>,
    name: Option<String>,
    heads: Vec<EditId>,
    merged: bool,
    known: bool,
    new: bool,
    public: bool,
}

impl Line {
    fn of(lab: &Lab, me: SignerId, lanes: &mut HashMap<VaultId, Lane>, (entry, line): (EntryId, EditId)) -> Line {
        let m = lab.meaning(me, entry);
        let ty = m.as_ref().map(|m| m.attrs.ty.as_str().to_string());
        let tags = m.iter().flat_map(|m| m.attrs.tags.iter().map(|t| t.as_str().to_string())).collect();
        let (title, name, heads) = (None, None, vec![]);
        let mut out =
            Line { entry, line, ty, tags, title, name, heads, merged: false, known: false, new: false, public: false };
        let Some(h) = lab.history(me, entry).filter(|h| h.lines().contains(&Some(line))) else { return out };
        let main: HashSet<EditId> = h.history(MAIN).iter().map(|c| c.write.edit).collect();
        out.heads = h.heads(Some(line));
        out.merged = !out.heads.is_empty() && out.heads.iter().all(|e| main.contains(e));
        out.known = true;
        out.new = h.get(line).is_some_and(|c| c.write.first);
        out.public = out.new && lab.public_once_landed(me, entry);
        out.name = h.name(line).filter(|n| !n.trim().is_empty());
        let vault = lab.vault_of_entry(me, entry);
        let item = lab.item_on(me, entry, Some(line));
        let seen = vault.zip(item).and_then(|(v, item)| see(lane_of(lanes, lab, me, v), item, &Named::Own));
        out.title = seen.and_then(|s| s.record.get("title")?.as_str().map(str::to_string)).filter(|t| !t.is_empty());
        out
    }

    fn to_json(&self) -> Value {
        json!({
            "entry": self.entry.to_hex(),
            "line": self.line.to_hex(),
            "type": self.ty,
            "title": self.title,
            "name": self.name,
            "heads": hexes(self.heads.iter().copied()),
            "merged": self.merged,
            "new": self.new,
            "tags": self.tags,
            "public": self.public,
        })
    }

    /// Its summary, of the parts of its diff of a schema whose title names it by `what` (`aip::summary`): a new
    /// entry's by its title and how many fields it holds (`aip::summary_new`).
    fn summary(&self, what: &str, parts: &[aip::Part]) -> String {
        match self.new {
            true => aip::summary_new(what, self.title.as_deref().unwrap_or("untitled"), parts),
            false => aip::summary(what, parts),
        }
    }
}

/// What line `l` changes, by its entry's own schema (`aip::diff`): what the schema's title names it by, and the parts.
/// Open, main's record against what main would read once the vault's acceptance merged it, the proposal's side taken
/// wherever both lines changed one place; merged, the version the proposal started from against what it reads now.
fn parts_of(lab: &Lab, me: SignerId, lanes: &mut HashMap<VaultId, Lane>, l: &Line) -> Option<(String, Vec<aip::Part>)> {
    let h = lab.history(me, l.entry).filter(|_| l.known)?;
    let vault = lab.vault_of_entry(me, l.entry)?;
    let item = lab.item_on(me, l.entry, Some(l.line))?;
    let main = lab.item(me, l.entry);
    let (old, new) = if l.merged {
        (h.item_at(&h.get(l.line)?.write.deps, me, MAIN).record(), item.record())
    } else {
        let conflicts = h.merged(Some(l.line), MAIN, me, &BTreeSet::new()).conflicts;
        let take = conflicts.into_iter().map(|c| c.place).collect();
        let merged = Value::Object(h.merged(Some(l.line), MAIN, me, &take).record);
        (main.map_or_else(|| json!({}), |m| m.record()), merged)
    };
    let lane = lane_of(lanes, lab, me, vault);
    let app = own(lane, &new).or_else(|| own(lane, &old));
    let mut authored = item.authored();
    authored.extend(main.map(|m| m.authored()).unwrap_or_default());
    let read = |stored: &Value| -> Record {
        let seen = match &app {
            Some(app) => lane.view(app, &authored).0.get(stored),
            None => Some(stored.clone()),
        };
        seen.and_then(|v| v.as_object().cloned()).unwrap_or_default()
    };
    let json = app.as_ref().and_then(|s| serde_json::from_slice::<Value>(s.bytes()).ok());
    let parts = aip::diff(json.as_ref(), &read(&old), &read(&new));
    let what = match &app {
        Some(s) => aip::what(s.title()).to_string(),
        None => l.ty.clone().unwrap_or_else(|| "entry".into()),
    };
    Some((what, parts))
}

/// An AIP's stage and outcome, read off its lines and its reviews: applied once every line's heads are on main;
/// rejected once withdrawn, or where its newest review declines it; archived either way, else as typed.
struct Derived {
    lines: Vec<Line>,
    outcome: Option<&'static str>,
    stage: &'static str,
}

fn derive(lab: &Lab, me: SignerId, lanes: &mut HashMap<VaultId, Lane>, a: &Aip, reviews: &[Review]) -> Derived {
    let lines: Vec<Line> = a.lines.iter().map(|&l| Line::of(lab, me, lanes, l)).collect();
    let outcome = match () {
        _ if !lines.is_empty() && lines.iter().all(|l| l.merged) => Some("applied"),
        _ if a.typed() == "withdrawn" => Some("rejected"),
        _ if reviews.first().is_some_and(|r| r.verdict == "declined") => Some("rejected"),
        _ => None,
    };
    let stage = match (outcome, a.typed()) {
        (Some(_), _) => "archived",
        (None, "proposed") => "proposed",
        _ if a.has_objective() => "objective",
        _ => "idea",
    };
    Derived { lines, outcome, stage }
}

/// What every AIP op reads from: the AIPs device `me` holds, the reviews of their vaults by what they answer (an
/// entry and a line, `""` for an AIP's), newest first, and each vault's lane, each read once.
struct Book<'a> {
    lab: &'a Lab,
    me: SignerId,
    lanes: HashMap<VaultId, Lane>,
    aips: Vec<Aip>,
    reviews: HashMap<(String, String), Vec<Review>>,
}

impl<'a> Book<'a> {
    fn new(lab: &'a Lab, me: SignerId) -> Book<'a> {
        let mut book = Book { lab, me, lanes: HashMap::new(), aips: vec![], reviews: HashMap::new() };
        for entry in lab.entries(me) {
            let Some(m) = lab.meaning(me, entry) else { continue };
            match m.attrs.ty.as_str() {
                AIP => book.aips.extend(read(lab, me, &mut book.lanes, entry)),
                REVIEW => {
                    if let Some((key, r)) = book.review(entry, m.attrs.author) {
                        book.reviews.entry(key).or_default().push(r);
                    }
                }
                _ => {}
            }
        }
        for rs in book.reviews.values_mut() {
            rs.sort_by(|a, b| (b.order.0, b.at, b.order.1).cmp(&(a.order.0, a.at, a.order.1)));
        }
        book
    }

    /// Review entry `entry`, made by vault `author`, if its vault wrote it itself: what it answers, and the review.
    fn review(&mut self, entry: EntryId, author: VaultId) -> Option<((String, String), Review)> {
        let (lab, me) = (self.lab, self.me);
        let vault = lab.vault_of_entry(me, entry).filter(|v| *v == author)?;
        let review = Named::Id(lens::REVIEW_V1.id());
        let r = see(lane_of(&mut self.lanes, lab, me, vault), lab.item(me, entry)?, &review)?.record;
        let text = |f: &str| r.get(f).and_then(Value::as_str).map(str::to_string);
        let history = lab.history(me, entry)?;
        let made = history.changes().first()?.write.edit;
        let authors = world::authors_json(lab, me, &world::authors(lab, me, entry, &history.heads(MAIN)));
        let heads = r.get("heads").and_then(Value::as_array).into_iter().flatten();
        let review = Review {
            id: entry,
            heads: heads.filter_map(|h| h.as_str().map(str::to_string)).collect(),
            by: r.get("by").cloned().unwrap_or(Value::Null),
            authors,
            verdict: text("verdict")?,
            text: text("text").unwrap_or_default(),
            at: r.get("at").and_then(Value::as_u64).unwrap_or(0),
            order: order_of(lab, me, made),
        };
        Some(((text("entry")?, text("line")?), review))
    }

    /// The reviews of entry `entry`'s line `line` (`""`: of an AIP), newest first.
    fn reviews_of(&self, entry: EntryId, line: &str) -> &[Review] {
        self.reviews.get(&(entry.to_hex(), line.to_string())).map_or(&[], Vec::as_slice)
    }

    fn derive(&mut self, i: usize) -> Derived {
        let a = &self.aips[i];
        let reviews = self.reviews.get(&(a.entry.to_hex(), String::new())).map_or(&[][..], Vec::as_slice);
        derive(self.lab, self.me, &mut self.lanes, a, reviews)
    }

    /// The labels of the AIPs with a number: `AIP-n`, and where several of one vault hold one number, `AIP-n.2` and
    /// on, by the write that set each (`aip::labels`).
    fn labels(&self) -> HashMap<EntryId, String> {
        let mut by: BTreeMap<(VaultId, u64), Vec<EntryId>> = BTreeMap::new();
        for a in &self.aips {
            if let Some(n) = a.number() {
                by.entry((a.vault, n)).or_default().push(a.entry);
            }
        }
        let mut out = HashMap::new();
        for ((_, n), entries) in by {
            if let [one] = entries[..] {
                out.insert(one, format!("AIP-{n}"));
                continue;
            }
            let order: Vec<Option<(u64, EditId)>> = entries.iter().map(|e| self.numbered(*e, n)).collect();
            out.extend(entries.into_iter().zip(aip::labels(n, &order)));
        }
        out
    }

    /// Where the write that set AIP `entry`'s number to `n` stands in the one order: the first of its main line that
    /// shows `n` where what it builds on doesn't.
    fn numbered(&self, entry: EntryId, n: u64) -> Option<(u64, EditId)> {
        let (lab, me) = (self.lab, self.me);
        let h = lab.history(me, entry)?;
        let holds = |version: &[EditId]| h.item_at(version, me, MAIN).record().get("number").and_then(Value::as_u64);
        let first =
            h.history(MAIN).into_iter().find(|c| holds(&[c.write.edit]) == Some(n) && holds(&c.write.deps) != Some(n));
        first.map(|c| order_of(lab, me, c.write.edit))
    }

    /// AIP `i` as `aips` lists it, with each line's diff where `diff` (`aip`).
    fn item(&mut self, i: usize, label: Option<&String>, diff: bool) -> Value {
        let d = self.derive(i);
        let (lab, me) = (self.lab, self.me);
        let a = &self.aips[i];
        let reviews = self.reviews.get(&(a.entry.to_hex(), String::new())).cloned().unwrap_or_default();
        let have = reviews.iter().filter(|r| r.verdict == "accepted" && r.covers(&d.lines)).count();
        let mut lines = vec![];
        let mut summary = vec![];
        for l in &d.lines {
            let mut line = l.to_json();
            match parts_of(lab, me, &mut self.lanes, l) {
                Some((what, parts)) => {
                    summary.push(l.summary(&what, &parts));
                    if diff {
                        line["diff"] = parts.iter().map(aip::Part::to_json).collect();
                    }
                }
                None => summary.push(format!("{}: unread", l.ty.as_deref().unwrap_or("entry"))),
            }
            lines.push(line);
        }
        let a = &self.aips[i];
        let text = |f: &str| a.text(f).map_or(Value::Null, Value::from);
        json!({
            "bare": false,
            "entry": a.entry.to_hex(),
            "vault": a.vault.to_hex(),
            "key": text("key"),
            "number": a.number(),
            "label": label.filter(|_| d.stage != "idea" && d.stage != "objective"),
            "title": text("title"),
            "note": a.text("note").unwrap_or_default(),
            "stage": d.stage,
            "outcome": d.outcome,
            "why": text("why"),
            "was": text("was"),
            "tags": a.attrs.tags.iter().map(|t| t.as_str()).collect::<Vec<_>>(),
            "author": a.attrs.author.to_hex(),
            "intent": a.record.get("intent").cloned().unwrap_or(Value::Null),
            "links": a.record.get("links").cloned().unwrap_or_else(|| json!([])),
            "objective": a.objective_json(),
            "lines": lines,
            "reviews": reviews.iter().map(|r| r.to_json(&d.lines)).collect::<Vec<_>>(),
            "signatures": { "have": have, "need": 1, "of": "owners" },
            "summary": summary,
        })
    }

    /// Every open proposal line of an entry device `me` reads that no AIP names, as an idea of its own: its title the
    /// line's name, or the entry's title on it, so nothing written before AIPs is left out. A variant is no idea: it
    /// stays open beside main by design, and merging it would put the variant over main. Of vault `vault` alone, if
    /// named.
    fn bare(&mut self, vault: Option<VaultId>) -> Vec<Value> {
        let (lab, me) = (self.lab, self.me);
        let named: HashSet<(EntryId, EditId)> = self.aips.iter().flat_map(|a| a.lines.iter().copied()).collect();
        let mut out = vec![];
        for entry in lab.entries(me) {
            let Some(v) = lab.vault_of_entry(me, entry).filter(|v| vault.is_none_or(|x| x == *v)) else { continue };
            let (Some(h), Some(m)) = (lab.history(me, entry), lab.meaning(me, entry)) else { continue };
            for line in h.lines().into_iter().flatten() {
                if named.contains(&(entry, line)) || h.is_variant(line) {
                    continue;
                }
                let l = Line::of(lab, me, &mut self.lanes, (entry, line));
                if l.merged || !l.known {
                    continue;
                }
                let lines = std::slice::from_ref(&l);
                let reviews = self.reviews_of(entry, &line.to_hex()).to_vec();
                let have = reviews.iter().filter(|r| r.verdict == "accepted" && r.covers(lines)).count();
                let summary = match parts_of(lab, me, &mut self.lanes, &l) {
                    Some((what, parts)) => l.summary(&what, &parts),
                    None => format!("{}: unread", l.ty.as_deref().unwrap_or("entry")),
                };
                let by = h.get(line).map(|c| c.write.actor.to_hex());
                let ty = l.ty.clone().unwrap_or_else(|| "entry".into());
                let title = l.name.clone().or_else(|| l.title.clone()).unwrap_or_else(|| format!("A {ty} proposal"));
                out.push(json!({
                    "bare": true,
                    "entry": null,
                    "vault": v.to_hex(),
                    "key": null,
                    "number": null,
                    "label": null,
                    "title": title,
                    "note": "",
                    "stage": "idea",
                    "outcome": null,
                    "why": null,
                    "was": null,
                    "tags": m.attrs.tags.iter().map(|t| t.as_str()).collect::<Vec<_>>(),
                    "author": by,
                    "intent": null,
                    "links": [],
                    "objective": null,
                    "lines": [l.to_json()],
                    "reviews": reviews.iter().map(|r| r.to_json(lines)).collect::<Vec<_>>(),
                    "signatures": { "have": have, "need": 1, "of": "owners" },
                    "summary": [summary],
                }));
            }
        }
        out
    }
}

/// `{"op": "aips", "vault"?}`: every AIP device `me` holds, of vault `vault` alone if it names one, as people read it:
/// its entry, vault, key, number and label (`AIP-n`, `AIP-n.2` where two of one vault hold one number, `null` for an
/// idea), title, note, stage (`idea`, `objective`, `proposed` or `archived`), outcome (`applied`, `rejected` or `null`), why, was,
/// entry tags, author, intent and links; its objective, `null` or `{lean, metrics, met, total, progress, readings}`, or
/// `error` where its Lean doesn't read (each metric `{id, name, note, goal, readings, value, baseline, targets, met,
/// progress}`, progress from 0 to 1, `objective::summary_json`); its lines, each `{entry, line, type, title, name, heads, merged, new, tags,
/// public}`, `new` for a new entry, a draft, `tags` its entry's tags and `public` whether a share to everyone picks a
/// new entry once it lands (advice: only the vault's stewards read every selector); its
/// reviews, newest first, each `{review, verdict, text, heads, by, authors, at, current}`, `by` who started what it
/// answers (the AIP's author), `authors` who answered (`world::authors`: the vault's aven, then the human whose device
/// signed it), `current` where it answers every line's heads now; its signatures against the default policy, `{have, need: 1, of: "owners"}`, the accepted reviews
/// that are current (no policy entry is read); and its summary, a line per part. Then each open proposal line no AIP
/// names, `bare`, an idea of its own. The numbered first, by vault and number, then the ideas by key, then the bare.
pub(super) fn aips(lab: &Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let vault = o.get("vault").filter(|v| !v.is_null()).map(|_| vault_of(o, "vault")).transpose()?;
    let mut book = Book::new(lab, me);
    let labels = book.labels();
    let mut order: Vec<usize> =
        (0..book.aips.len()).filter(|&i| vault.is_none_or(|v| book.aips[i].vault == v)).collect();
    order.sort_by_key(|&i| {
        let a = &book.aips[i];
        (a.vault, a.number().is_none(), a.number(), labels.get(&a.entry).cloned(), a.text("key").map(str::to_string))
    });
    let mut out = vec![];
    for i in order {
        let entry = book.aips[i].entry;
        out.push(book.item(i, labels.get(&entry), false));
    }
    out.extend(book.bare(vault));
    Ok(out.into())
}

/// `{"op": "aip", "entry"}`: AIP `entry` as `aips` lists it, and each line with its `diff`, each part `{path, label,
/// kind, old, new}` (`aip::diff`). `NoEntry` where the device shows no such entry, `BadOp` where it is no AIP.
pub(super) fn one(lab: &Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let entry = entry_of(o)?;
    let mut book = Book::new(lab, me);
    let Some(i) = book.aips.iter().position(|a| a.entry == entry) else {
        return aip_of(lab, me, &mut HashMap::new(), entry).map(|_| Value::Null);
    };
    let labels = book.labels();
    Ok(book.item(i, labels.get(&entry), true))
}

/// `{"op": "aip_open", "vault", "title", "note"?, "proposals"?: [{entry, line}], "tags"?, "objective"?, "as"?}`: a
/// new AIP in
/// vault `vault`, an idea, acting for `actor`: its key eight random letters and digits of the device's own randomness,
/// none another AIP of the vault the device holds has; its title and note; its lines, each a proposal of an entry of
/// `vault` (`BadOp` for another vault's: one vault per AIP, so one policy decides it; `NoEntry` where the device shows
/// no such proposal); its entry tags, a game's among them (`game:<id>`); its objective, a file of Lean, as
/// `aip_objective` writes it. Answers `{entry, key}`.
pub(super) fn open(
    lab: &mut Lab,
    me: SignerId,
    actor: VaultId,
    vault: VaultId,
    (title, note): (String, String),
    proposals: &[(EntryId, EditId)],
    tags: Vec<String>,
    lean: Option<String>,
) -> Result<Value, Refused> {
    if let Some(lean) = &lean {
        read_lean(lean)?;
    }
    for &(e, line) in proposals {
        let h = lab.history(me, e).ok_or(Refused::NoEntry)?;
        if lab.vault_of_entry(me, e) != Some(vault) {
            let why = format!("entry {} is in another vault: one vault per AIP, so one policy decides it", e.to_hex());
            return Err(bad(why));
        }
        if !h.lines().contains(&Some(line)) {
            return Err(Refused::NoEntry);
        }
    }
    let taken: HashSet<String> = {
        let book = Book::new(lab, me);
        book.aips.iter().filter(|a| a.vault == vault).filter_map(|a| a.text("key").map(str::to_string)).collect()
    };
    let key = loop {
        let key = aip::key(lab.nonce());
        if !taken.contains(&key) {
            break key;
        }
    };
    let link = |e: &EntryId| json!({ "vault": vault.to_hex(), "entry": e.to_hex() });
    let rows: Vec<Value> = (proposals.iter().enumerate())
        .map(|(i, (e, line))| json!({ "id": i + 1, "entry": link(e), "line": line.to_hex() }))
        .collect();
    let mut value = json!({ "kind": AIP, "key": key, "title": title, "note": note, "proposals": rows, "stage": "idea" });
    if let Some(lean) = lean {
        value["objective"] = lean.into();
    }
    let create = Step::Create { vault, ty: AIP.into(), tags, schema: schema(), value, draft: false, file: None };
    let made = step(lab, me, actor, create)?;
    Ok(json!({ "entry": made["entry"], "key": key }))
}

/// Whether `actor` may move AIP `a` on: its author, or its vault (`NoCap` for anyone else).
fn author_or_vault(a: &Aip, actor: VaultId) -> Result<(), Refused> {
    match actor == a.attrs.author || actor == a.vault {
        true => Ok(()),
        false => Err(Refusal::NoCap.into()),
    }
}

/// `{"op": "aip_promote", "entry", "as"?}`: AIP `entry` proposed, acting for `actor`, its author or its vault: its
/// stage `proposed`, and where it has no number yet, the vault's next, one more than the highest of the vault's AIPs
/// the device holds; a revised AIP keeps its own. `BadOp` for an AIP with no lines, with no objective that reads (the
/// objective stage comes first), or one archived. Answers
/// `{entry, number, edit}`, `edit` `null` where it was proposed already.
pub(super) fn promote(lab: &mut Lab, me: SignerId, actor: VaultId, entry: EntryId) -> Result<Value, Refused> {
    let (number, typed) = {
        let mut book = Book::new(lab, me);
        let i = book.aips.iter().position(|a| a.entry == entry);
        let i = match i {
            Some(i) => i,
            None => return aip_of(lab, me, &mut HashMap::new(), entry).and(Err(Refused::NoEntry)),
        };
        author_or_vault(&book.aips[i], actor)?;
        let d = book.derive(i);
        if let Some(outcome) = d.outcome {
            return Err(bad(format!("the AIP is archived, {outcome}: an archived AIP is promoted no more")));
        }
        let a = &book.aips[i];
        if a.lines.is_empty() {
            return Err(bad("the AIP names no proposal line: it proposes nothing yet"));
        }
        if !a.has_objective() {
            let why = "the AIP has no objective yet: write what it must deliver first (aip_objective), metrics in Lean";
            return Err(bad(why));
        }
        let highest = book.aips.iter().filter(|b| b.vault == a.vault).filter_map(Aip::number).max();
        (a.number().unwrap_or(highest.unwrap_or(0) + 1), a.typed().to_string())
    };
    let mut ops = vec![set("number", number)];
    if typed != "proposed" {
        ops.push(set("stage", "proposed"));
    }
    let made = edits(lab, me, actor, (entry, MAIN), &schema(), &ops)?;
    Ok(json!({ "entry": entry.to_hex(), "number": number, "edit": made["edit"] }))
}

/// `{"op": "aip_withdraw", "entry", "why"?, "as"?}`: AIP `entry` withdrawn by `actor`, its author or its vault, with
/// the reason `why`, at most 2,000 characters: archived, rejected. `BadOp` for one archived already. Answers
/// `{entry, edit}`.
pub(super) fn withdraw(
    lab: &mut Lab,
    me: SignerId,
    actor: VaultId,
    entry: EntryId,
    why: Option<String>,
) -> Result<Value, Refused> {
    {
        let mut lanes = HashMap::new();
        let a = aip_of(lab, me, &mut lanes, entry)?;
        author_or_vault(&a, actor)?;
        let book = Book::new(lab, me);
        if let Some(outcome) = derive(lab, me, &mut lanes, &a, book.reviews_of(entry, "")).outcome {
            return Err(bad(format!("the AIP is archived, {outcome}, already")));
        }
    }
    let mut ops = vec![set("stage", "withdrawn")];
    ops.extend(why.map(|why| set("why", why)));
    let made = edits(lab, me, actor, (entry, MAIN), &schema(), &ops)?;
    Ok(json!({ "entry": entry.to_hex(), "edit": made["edit"] }))
}

/// `{"op": "aip_review", "entry", "verdict", "text"?, "heads"?, "as"?}`: the answer of AIP `entry`'s vault, `actor`,
/// to it as it stands, over every line at once (`NoCap` acting for anyone else; `BadOp` unless it is proposed). With
/// `heads`, the heads of its lines as whoever answers saw them, every line's in one list as `aips` lists them: `BadOp`
/// where they aren't the heads its lines have now, as a line moved since, so nothing written after a card was drawn is
/// accepted unseen; the page always names them. `accepted`: for each line, the vault's accept at its heads
/// (`Lab::accept`, M2), then its merge into main as the vault, taking the proposal's side wherever both lines changed
/// one place, which lands a draft (`History::landed`); then one review (`lens::blobs::REVIEW_V1`) of the AIP, `line`
/// `""`, whose `heads` are every accept, sorted, `by` the AIP's author. `declined`: the review alone, its heads every
/// line's heads. `revise`: the review, and the AIP an idea again, keeping its number. Every write is the device's own,
/// as any write is, so no passkey is asked; all are tried dry first, so one that would be refused makes nothing.
/// Answers `{entry, review, verdict, accepts, merges}`.
pub(super) fn review(
    lab: &mut Lab,
    me: SignerId,
    actor: VaultId,
    entry: EntryId,
    verdict: &str,
    text: String,
    heads: Option<&[EditId]>,
) -> Result<Value, Refused> {
    let (a, lines) = {
        let mut lanes = HashMap::new();
        let a = aip_of(lab, me, &mut lanes, entry)?;
        if actor != a.vault {
            return Err(Refusal::NoCap.into());
        }
        let book = Book::new(lab, me);
        let d = derive(lab, me, &mut lanes, &a, book.reviews_of(entry, ""));
        if d.stage != "proposed" {
            return Err(bad(format!("only a proposed AIP is reviewed: this one is {}", d.outcome.unwrap_or(d.stage))));
        }
        if d.lines.is_empty() {
            return Err(bad("the AIP names no proposal line: there is nothing to review"));
        }
        if d.lines.iter().any(|l| !l.known) {
            return Err(Refused::NoEntry);
        }
        let lines: Vec<(EntryId, EditId, Vec<EditId>)> =
            d.lines.into_iter().map(|l| (l.entry, l.line, l.heads)).collect();
        if let Some(seen) = heads {
            pinned(&lines, seen)?;
        }
        (a, lines)
    };
    if !lab.is_dry() {
        lab.dry(|lab| answer(lab, me, actor, &a, &lines, verdict, &text))?;
    }
    answer(lab, me, actor, &a, &lines, verdict, &text)
}

/// The heads of the lines `lines` are those `seen` names, every line's, and no others: else `BadOp`, naming each line
/// that moved since it was seen.
fn pinned(lines: &[(EntryId, EditId, Vec<EditId>)], seen: &[EditId]) -> Result<(), Refused> {
    let seen: BTreeSet<EditId> = seen.iter().copied().collect();
    let now: BTreeSet<EditId> = lines.iter().flat_map(|(_, _, heads)| heads.iter().copied()).collect();
    if seen == now {
        return Ok(());
    }
    let short = |hex: String| hex[..8].to_string();
    let moved: Vec<String> = (lines.iter())
        .filter(|(_, _, heads)| !heads.iter().all(|h| seen.contains(h)))
        .map(|(e, line, _)| format!("line {} of entry {}", short(line.to_hex()), short(e.to_hex())))
        .collect();
    let which = match moved.is_empty() {
        true => "a line".to_string(),
        false => moved.join(", "),
    };
    Err(bad(format!(
        "the AIP moved since it was shown: {which} has another version now; read it again and answer what it shows"
    )))
}

/// The writes of `review`, in order.
fn answer(
    lab: &mut Lab,
    me: SignerId,
    actor: VaultId,
    a: &Aip,
    lines: &[(EntryId, EditId, Vec<EditId>)],
    verdict: &str,
    text: &str,
) -> Result<Value, Refused> {
    let (mut accepts, mut merges) = (vec![], vec![]);
    if verdict == "accepted" {
        for &(e, line, _) in lines {
            accepts.push(lab.accept(me, actor, e, line)?);
            let h = lab.history(me, e).ok_or(Refused::NoEntry)?;
            let take =
                h.merged(Some(line), MAIN, me, &BTreeSet::new()).conflicts.into_iter().map(|c| c.place).collect();
            merges.push(lab.merge(me, actor, e, Some(line), MAIN, &take)?);
        }
    }
    let heads = match verdict {
        "accepted" => hexes(accepts.iter().copied()),
        _ => hexes(lines.iter().flat_map(|(_, _, heads)| heads.iter().copied())),
    };
    let value = json!({
        "kind": REVIEW,
        "entry": a.entry.to_hex(),
        "line": "",
        "heads": heads,
        "by": a.attrs.author.to_hex(),
        "verdict": verdict,
        "text": text,
        "at": lab.now(),
    });
    let (vault, ty, tags) = (a.vault, REVIEW.into(), vec![]);
    let create = Step::Create { vault, ty, tags, schema: Named::Own, value, draft: false, file: None };
    let made = step(lab, me, actor, create)?;
    if verdict == "revise" {
        edits(lab, me, actor, (a.entry, MAIN), &schema(), &[set("stage", "idea")])?;
    }
    Ok(json!({
        "entry": a.entry.to_hex(),
        "review": made["entry"],
        "verdict": verdict,
        "accepts": accepts.iter().map(EditId::to_hex).collect::<Vec<_>>(),
        "merges": merges.iter().map(EditId::to_hex).collect::<Vec<_>>(),
    }))
}

/// Lean `lean` as an objective: its metrics, or `BadOp` with where and why it doesn't read.
fn read_lean(lean: &str) -> Result<Vec<objective::Metric>, Refused> {
    objective::parse(lean).map_err(|e| bad(format!("the objective doesn't read: {e}")))
}

/// AIP `entry`, for `actor` to write on before it is proposed or archived: its author or its vault (`NoCap` else),
/// `BadOp` once archived, or once proposed unless `proposed` lets it.
fn open_for(lab: &Lab, me: SignerId, actor: VaultId, entry: EntryId, proposed: bool) -> Result<Aip, Refused> {
    let mut lanes = HashMap::new();
    let a = aip_of(lab, me, &mut lanes, entry)?;
    author_or_vault(&a, actor)?;
    let book = Book::new(lab, me);
    let d = derive(lab, me, &mut lanes, &a, book.reviews_of(entry, ""));
    if let Some(outcome) = d.outcome {
        return Err(bad(format!("the AIP is archived, {outcome}: it changes no more")));
    }
    if d.stage == "proposed" && !proposed {
        return Err(bad("the AIP is proposed: its objective is what its reviewers judge, so it changes only once they ask for a revision"));
    }
    Ok(a)
}

/// `{"op": "aip_objective", "entry", "lean", "as"?}`: AIP `entry`'s objective, what it must deliver, written by
/// `actor`, its author or its vault: `lean`, a file of Lean against `AvenDB.Objective`, one or more metrics
/// (`crate::objective`), read first, so a file that doesn't read is refused (`BadOp`, where and why) and none is ever
/// stored. An idea then stands at the objective stage. `BadOp` once proposed (a revision opens it again) or archived.
/// Answers `{entry, edit, metrics}`, `metrics` each `{id, name}`.
pub(super) fn objective(lab: &mut Lab, me: SignerId, actor: VaultId, entry: EntryId, lean: String) -> Result<Value, Refused> {
    let metrics = read_lean(&lean)?;
    open_for(lab, me, actor, entry, false)?;
    let made = edits(lab, me, actor, (entry, MAIN), &schema(), &[set("objective", lean)])?;
    let names: Vec<Value> = metrics.iter().map(|m| json!({ "id": m.id, "name": m.name })).collect();
    Ok(json!({ "entry": entry.to_hex(), "edit": made["edit"], "metrics": names }))
}

/// `{"op": "aip_measure", "entry", "name", "value", "note"?, "as"?}`: a reading recorded on AIP `entry` by `actor`,
/// its author or its vault, while it is worked on or proposed: `name` (at most 160 characters), the number it read,
/// `value`, within 10^24, and a note (at most 2,000 characters); `at`, the device's clock. Its metrics read the first
/// reading of each name as their baseline and the newest as where they stand. `BadOp` once archived, or past
/// `MAX_READINGS`. Answers `{entry, edit, objective}`, the objective as `aip` reads it now.
pub(super) fn measure(
    lab: &mut Lab,
    me: SignerId,
    actor: VaultId,
    entry: EntryId,
    name: String,
    value: &Value,
    note: Option<String>,
) -> Result<Value, Refused> {
    let (name, note) = (name.trim().to_string(), note.filter(|n| !n.trim().is_empty()));
    if name.is_empty() || name.chars().count() > 160 {
        return Err(bad("a reading's name is 1 to 160 characters"));
    }
    if note.as_ref().is_some_and(|n| n.chars().count() > 2000) {
        return Err(bad("a reading's note is at most 2,000 characters"));
    }
    if objective::dec_of(value).is_none() {
        return Err(bad("a reading's value is a finite number within 10^24"));
    }
    let a = open_for(lab, me, actor, entry, true)?;
    let rows = a.record.get("readings").and_then(ops::rows).unwrap_or_default();
    if rows.len() >= MAX_READINGS {
        return Err(bad(format!("an AIP records at most {MAX_READINGS} readings")));
    }
    let id = rows.iter().filter_map(|r| r.get("id")?.as_i64()).max().unwrap_or(0) + 1;
    let mut row = json!({ "id": id, "name": name, "value": value, "at": lab.now() });
    if let Some(note) = note {
        row["note"] = note.into();
    }
    let row = row.as_object().cloned().expect("a row is an object");
    let made = edits(lab, me, actor, (entry, MAIN), &schema(), &[RecordOp::top("readings", FieldOp::Insert(row, None))])?;
    let objective = aip_of(lab, me, &mut HashMap::new(), entry).map(|a| a.objective_json()).unwrap_or(Value::Null);
    Ok(json!({ "entry": entry.to_hex(), "edit": made["edit"], "objective": objective }))
}

/// `{"op": "objective_check", "lean", "readings"?}`: Lean `lean` read as an objective, as `aip_objective` would, and
/// checked against `readings`, each `{name, value}` in the order recorded: `{ok: true, metrics, met, total, progress}`
/// as `aip` reads an objective, or `{ok: false, error, line, col}`. Reads nothing the device holds: an editor checks a
/// file as it is typed.
pub(super) fn objective_check(o: &Map<String, Value>) -> Result<Value, Refused> {
    let lean = o.get("lean").and_then(Value::as_str).ok_or_else(|| bad("objective_check takes the Lean: lean"))?;
    let rows = o.get("readings").and_then(Value::as_array).cloned().unwrap_or_default();
    let one = |r: &Value| Some((r.get("name")?.as_str()?.to_string(), objective::dec_of(r.get("value")?)?));
    let readings: Vec<(String, Dec)> = rows.iter().filter_map(one).collect();
    Ok(match objective::parse(lean) {
        Ok(ms) => {
            let mut out = objective::summary_json(&ms, &readings);
            out["ok"] = true.into();
            out
        }
        Err(e) => json!({ "ok": false, "error": e.why, "line": e.line, "col": e.col }),
    })
}

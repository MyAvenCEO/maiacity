//! Coverage (sync v2, P1, `spec/AvenDB/Coverage.lean`): the one answer a read gives to "is this complete?", and the
//! cursor a query pages by.
//!
//! `complete` when no candidate the device holds waits; `partial` with what is shown (`have`), what is known
//! (`known`: `have` and the candidates that wait), which wait and on what (`waiting`, at most `MOST_WAITING`), and the
//! logs a reachable peer announced that the device lacks and that may match (`logs`, which the node adds, `with_logs`);
//! `denied` where the device has no standing. No clock: the same state answers the same.
//!
//! Freshness (`spec/AvenDB/Freshness.lean`) is the one value a page shows and acts by, beside every read: `current`
//! (a live peer, every live peer heard, the read complete), `offline` as of the stamp of the device's last current
//! read (no live peer), or `behind` (a live peer holds newer data for the read's scope, candidates wait, or a live peer
//! has not told what it holds yet). An action goes only on `current`, waits while `behind`, and on `offline` asks the
//! person to confirm it acts on data as of then (`Act`).

use serde_json::{json, Value};

use super::{bad, compare, By, Ordering};
use crate::id::EntryId;
use super::Refused;

/// The most waiting candidates an answer names; `known` still counts them all.
pub const MOST_WAITING: usize = 32;

/// What a candidate waits on (`Coverage.Waiting`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum On {
    /// Its header or the cap groups its meaning rests on.
    Semantics,
    /// Its record: the device opened none of its writes yet.
    Record,
    /// Its history: it shows from a snapshot or an owner's base, read-only, until the edits behind it arrive.
    History,
}

impl On {
    fn name(self) -> &'static str {
        match self {
            On::Semantics => "semantics",
            On::Record => "record",
            On::History => "history",
        }
    }

    /// A row that waits on this still shows (read-only), and counts among what is shown.
    fn shows(self) -> bool {
        matches!(self, On::History)
    }
}

/// The candidates of one read that wait, as the read classifies them.
#[derive(Default)]
pub struct Waits {
    named: Vec<(EntryId, On)>,
    rows: usize,
    others: usize,
}

impl Waits {
    pub fn add(&mut self, entry: EntryId, on: On) {
        if on.shows() { self.rows += 1 } else { self.others += 1 }
        if self.named.len() < MOST_WAITING { self.named.push((entry, on)); }
    }

    /// The read's coverage, `count` its matching rows, those that wait and show among them.
    pub fn coverage(self, count: usize) -> Coverage {
        if self.rows + self.others == 0 { return Coverage::Complete; }
        let have = count.saturating_sub(self.rows);
        Coverage::Partial { have, known: count + self.others, waiting: self.named, logs: 0 }
    }
}

/// `Coverage.Coverage`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Coverage {
    Complete,
    Partial { have: usize, known: usize, waiting: Vec<(EntryId, On)>, logs: usize },
    Denied(String),
}

impl Coverage {
    /// With `logs` announced logs the device lacks that may match: complete only while there are none.
    pub fn with_logs(self, logs: usize) -> Coverage {
        match self {
            Coverage::Complete if logs == 0 => Coverage::Complete,
            Coverage::Complete => Coverage::Partial { have: 0, known: 0, waiting: vec![], logs },
            Coverage::Partial { have, known, waiting, .. } => Coverage::Partial { have, known, waiting, logs },
            denied => denied,
        }
    }

    pub fn to_json(&self) -> Value {
        match self {
            Coverage::Complete => json!({ "state": "complete" }),
            Coverage::Partial { have, known, waiting, logs } => json!({ "state": "partial", "have": have, "known": known,
                "waiting": waiting.iter().map(|(e, on)| json!({ "entry": e.to_hex(), "on": on.name() })).collect::<Vec<_>>(),
                "logs": logs }),
            Coverage::Denied(why) => json!({ "state": "denied", "why": why }),
        }
    }
}

/// Where a page ended: the sort keys of its last row and the row's entry. The next page starts right after that row,
/// or, if it is gone, at the first row whose keys sort after them (`Coverage.after_page`).
#[derive(Clone, Debug, PartialEq)]
pub struct Cursor {
    keys: Vec<Value>,
    entry: EntryId,
}

impl Cursor {
    pub fn at(entry: EntryId, keys: Vec<Value>) -> Cursor {
        Cursor { keys, entry }
    }

    /// The text a query answers as `next` and takes back as `after`.
    pub fn to_text(&self) -> String {
        json!([self.keys, self.entry.to_hex()]).to_string()
    }

    pub fn of_json(v: &Value) -> Result<Cursor, Refused> {
        let wrong = || bad("after is the next of an earlier page of the same query");
        let parsed: Value = serde_json::from_str(v.as_str().ok_or_else(wrong)?).map_err(|_| wrong())?;
        let [Value::Array(keys), Value::String(entry)] = parsed.as_array().map(Vec::as_slice).ok_or_else(wrong)? else {
            return Err(wrong());
        };
        Ok(Cursor { keys: keys.clone(), entry: EntryId::from_hex(entry).ok_or_else(wrong)? })
    }

    /// The index of the first of `rows` after this cursor, sorted by `order`.
    pub(super) fn start<T>(&self, rows: &[T], keyed: impl Fn(&T) -> Cursor, order: &[(By, bool)]) -> usize {
        if let Some(i) = rows.iter().position(|r| keyed(r).entry == self.entry) { return i + 1; }
        let later = |c: &Cursor| order.iter().zip(c.keys.iter().zip(&self.keys)).map(|((_, down), (a, b))| {
            let o = compare(Some(a), Some(b));
            if *down { o.reverse() } else { o }
        }).find(|o| o.is_ne()) == Some(Ordering::Greater);
        rows.iter().position(|r| later(&keyed(r))).unwrap_or(rows.len())
    }
}

/// Read answer `answer` (`{"ok": {.., "count", "coverage"}}`) with `logs` announced logs the device lacks that may
/// match it (`Coverage::with_logs`): what the node adds, which knows its peers' announcements. A refused or denied
/// answer stays as it is.
pub fn add_logs(answer: &mut Value, logs: usize) {
    let Some(ok) = answer.get_mut("ok") else { return };
    let count = ok["count"].as_u64().unwrap_or(0);
    let coverage = &mut ok["coverage"];
    match coverage["state"].as_str() {
        Some("complete") if logs > 0 => {
            *coverage = json!({ "state": "partial", "have": count, "known": count, "waiting": [], "logs": logs });
        }
        Some("partial") => coverage["logs"] = logs.into(),
        _ => {}
    }
}

/// Answer `answer` is a read the device may make, complete or partial: the logs it lacks may still change it.
pub fn reads_open(answer: &Value) -> bool {
    matches!(answer["ok"]["coverage"]["state"].as_str(), Some("complete" | "partial"))
}

/// What the device hears now (`Freshness.Heard`): its live peers, how many of them have not told what they hold yet,
/// and the stamp of its last current read (Unix ms, 0 for never).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Heard {
    pub live: usize,
    pub unheard: usize,
    pub as_of: u64,
}

/// `Freshness.Freshness`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Freshness {
    Current,
    Offline { as_of: u64 },
    Behind { logs: usize, waits: usize, unheard: usize },
}

/// `Freshness.Act`: what an action (approve, accept, decline, delete) does with a read's freshness.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Act {
    Go,
    Wait,
    Confirm { as_of: u64 },
}

/// What a read's coverage (its JSON, as `Coverage::to_json` writes it) still lacks (`Freshness.pending`): the
/// candidates that wait (`known - have`) and the announced logs it lacks that may match. A read that names no coverage
/// counts as complete for what the device holds, so it lacks only the logs the node counted for its scope
/// (`Coverage::with_logs`); a denied read lacks nothing.
pub fn pending(coverage: &Value, logs: usize) -> (usize, usize) {
    match coverage["state"].as_str() {
        Some("denied") => return (0, 0),
        Some("partial") => {}
        _ => return (0, logs),
    }
    let n = |k: &str| coverage[k].as_u64().unwrap_or(0) as usize;
    (n("known").saturating_sub(n("have")), n("logs").max(logs))
}

impl Freshness {
    /// `Freshness.of`, from what a read still lacks (`pending`).
    pub fn of(heard: Heard, (waits, logs): (usize, usize)) -> Freshness {
        if heard.live == 0 { return Freshness::Offline { as_of: heard.as_of } }
        if waits == 0 && logs == 0 && heard.unheard == 0 { return Freshness::Current }
        Freshness::Behind { logs, waits, unheard: heard.unheard }
    }

    /// `Freshness.act`.
    pub fn act(self) -> Act {
        match self {
            Freshness::Current => Act::Go,
            Freshness::Behind { .. } => Act::Wait,
            Freshness::Offline { as_of } => Act::Confirm { as_of },
        }
    }

    /// `Freshness.opens`: whether an action's sheet opens, by itself (`asked` false) or because the person asked.
    pub fn opens(self, asked: bool) -> bool {
        match self.act() {
            Act::Go => true,
            Act::Wait => false,
            Act::Confirm { .. } => asked,
        }
    }

    pub fn to_json(self) -> Value {
        match self {
            Freshness::Current => json!({ "state": "current" }),
            Freshness::Offline { as_of } => json!({ "state": "offline", "asOf": as_of }),
            Freshness::Behind { logs, waits, unheard } =>
                json!({ "state": "behind", "logs": logs, "waits": waits, "unheard": unheard }),
        }
    }
}

impl Act {
    pub fn name(self) -> &'static str {
        match self {
            Act::Go => "go",
            Act::Wait => "wait",
            Act::Confirm { .. } => "confirm",
        }
    }
}

/// Stamps read answer `answer` with its freshness (`fresh`, beside `ok`), `logs` the announced logs its device lacks
/// that may hold what it reads: every read, whatever it reads, the same way. A refused answer stays as it is. What it
/// stamped, if anything.
pub fn add_freshness(answer: &mut Value, heard: Heard, logs: usize) -> Option<Freshness> {
    let ok = answer.get("ok")?;
    let fresh = Freshness::of(heard, pending(&ok["coverage"], logs));
    answer["fresh"] = fresh.to_json();
    Some(fresh)
}

//! Coverage (sync v2, P1, `spec/AvenDB/Coverage.lean`): the one answer a read gives to "is this complete?", and the
//! cursor a query pages by.
//!
//! `complete` when no candidate the device holds waits; `partial` with what is shown (`have`), what is known
//! (`known`: `have` and the candidates that wait), which wait and on what (`waiting`, at most `MOST_WAITING`), and the
//! logs a reachable peer announced that the device lacks and that may match (`logs`, which the node adds, `with_logs`);
//! `denied` where the device has no standing. No clock: the same state answers the same.

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

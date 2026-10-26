//! The diagnostics reports a person's devices send (`POST /feed/diagnostics`, `feed::DIAGNOSTICS`), kept for that
//! person alone (Samuel 2026-10-26: "I don't want to copy paste anything", so whoever looks into a device reads its
//! report without asking for it). A device posts a pass it made for `AUDIENCE` and its report, `{"pass", "report"}`;
//! the server keeps the newest `PER_DEVICE` of each device, under the person of the vault the device is a device of
//! (`quota::payer`), so a phone's and a Mac's land together. A device posts its pass alone, `{"pass"}`, to read them
//! back: that person's, every device's, the newest first, never another person's. A report is the page's own
//! (timings, counts, short ids: `src/lib/avendb/diagnostics-report.js`), taken as JSON and never read by the server.
//!
//! They are kept in the server's folder (`FILE`), so a restart forgets none, and each person's take at most
//! `PER_PERSON` bytes and the server's at most `PERSONS` people: past that, the oldest go first.

use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

/// The service a device names in the pass it sends a report with.
pub const AUDIENCE: &str = "avenDB diagnostics";

/// The file in the server's folder the reports are kept in.
const FILE: &str = "diagnostics.json";

/// The most reports kept of one device: the newest.
pub const PER_DEVICE: usize = 20;

/// The most bytes one report may take.
pub const MOST_REPORT: usize = 256 << 10;

/// The most bytes the reports of one person take, all their devices': past that, the oldest go.
const PER_PERSON: usize = 8 << 20;

/// The most people the server keeps reports of: past that, those who sent none for longest go.
const PERSONS: usize = 64;

/// One report as kept: the device that sent it, when (seconds since 1970, by the server's clock), and the report.
#[derive(Clone)]
struct Kept {
    device: String,
    at: u64,
    report: Value,
    bytes: usize,
}

/// The reports, by person (a vault id in hex), each person's in the order they came.
pub struct Reports {
    file: PathBuf,
    by: Mutex<BTreeMap<String, VecDeque<Kept>>>,
}

impl Reports {
    /// The reports kept in folder `data`, as the server left them there.
    pub fn open(data: &Path) -> Arc<Reports> {
        let file = data.join(FILE);
        let left: Value = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        let mut by = BTreeMap::new();
        for (person, rows) in left.as_object().into_iter().flatten() {
            let rows: VecDeque<Kept> = rows.as_array().into_iter().flatten().filter_map(kept_of).collect();
            if !rows.is_empty() {
                by.insert(person.clone(), rows);
            }
        }
        Arc::new(Reports { file, by: Mutex::new(by) })
    }

    /// Keeps `report` of device `device`, a device of person `person`, at `at`; then writes them all to its file.
    pub fn put(&self, person: &str, device: &str, at: u64, report: Value) {
        let bytes = serde_json::to_vec(&report).map_or(0, |b| b.len());
        let mut by = self.by.lock().expect("reports");
        let rows = by.entry(person.to_string()).or_default();
        rows.push_back(Kept { device: device.to_string(), at, report, bytes });
        // the newest PER_DEVICE of each device, then the newest that fit in PER_PERSON
        let mut seen: BTreeMap<String, usize> = BTreeMap::new();
        let mut room = PER_PERSON;
        let mut keep: Vec<Kept> = Vec::new();
        for row in rows.iter().rev() {
            let n = seen.entry(row.device.clone()).or_default();
            if *n < PER_DEVICE && row.bytes <= room {
                *n += 1;
                room -= row.bytes;
                keep.push(row.clone());
            }
        }
        *rows = keep.into_iter().rev().collect();
        // the people who sent none for longest go first, past PERSONS
        while by.len() > PERSONS {
            let Some(oldest) = by.iter().min_by_key(|(_, rows)| rows.back().map_or(0, |r| r.at)).map(|(p, _)| p.clone()) else {
                break;
            };
            by.remove(&oldest);
        }
        let state: serde_json::Map<String, Value> =
            by.iter().map(|(p, rows)| (p.clone(), Value::Array(rows.iter().map(json_of).collect()))).collect();
        drop(by);
        self.write(&Value::Object(state));
    }

    /// Person `person`'s reports, every device's, the newest first.
    pub fn of(&self, person: &str) -> Vec<Value> {
        let by = self.by.lock().expect("reports");
        by.get(person).map_or_else(Vec::new, |rows| rows.iter().rev().map(json_of).collect())
    }

    fn write(&self, state: &Value) {
        let new = self.file.with_extension("json.new");
        let written = serde_json::to_vec(state).map_err(std::io::Error::from).and_then(|bytes| std::fs::write(&new, bytes));
        if let Err(e) = written.and_then(|()| std::fs::rename(&new, &self.file)) {
            tracing::warn!("avenDB diagnostics reports: {e}");
        }
    }
}

fn json_of(k: &Kept) -> Value {
    json!({ "device": k.device, "at": k.at, "report": k.report })
}

fn kept_of(v: &Value) -> Option<Kept> {
    let report = v.get("report")?.clone();
    let bytes = serde_json::to_vec(&report).map_or(0, |b| b.len());
    Some(Kept { device: v.get("device")?.as_str()?.to_string(), at: v.get("at")?.as_u64()?, report, bytes })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("avendb-reports-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("a folder");
        dir
    }

    #[test]
    fn a_person_reads_their_devices_reports_the_newest_first_and_no_one_elses() {
        let dir = folder("people");
        let reports = Reports::open(&dir);
        reports.put("p1", "phone", 1, json!({ "n": 1 }));
        reports.put("p1", "mac", 2, json!({ "n": 2 }));
        reports.put("p2", "theirs", 3, json!({ "n": 3 }));
        let mine: Vec<_> = reports.of("p1").iter().map(|r| r["report"]["n"].clone()).collect();
        assert_eq!(mine, [json!(2), json!(1)]);
        assert_eq!(reports.of("p2").len(), 1);
        assert!(reports.of("p3").is_empty());
    }

    #[test]
    fn it_keeps_the_newest_of_each_device_and_forgets_none_on_a_restart() {
        let dir = folder("restart");
        let reports = Reports::open(&dir);
        for at in 0..(PER_DEVICE as u64 + 5) {
            reports.put("p", "phone", at, json!({ "at": at }));
        }
        reports.put("p", "mac", 100, json!({ "at": 100 }));
        let again = Reports::open(&dir);
        let rows = again.of("p");
        assert_eq!(rows.len(), PER_DEVICE + 1);
        assert_eq!(rows[0]["device"], "mac");
        assert_eq!(rows.last().expect("one")["at"], json!(5), "the oldest five of the phone went");
    }
}

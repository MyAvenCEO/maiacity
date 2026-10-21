//! The app's activity, as its log says it, for avenDB's Activity view (src/lib/avendb/Activity.svelte, Samuel
//! 2026-10-21): each line the app logs goes to its stderr as before (the log file theOS's launcher keeps) and into a
//! ring of the last `KEPT` lines here, each with its number, which the page reads from where it read last
//! (`activity_log`). Nothing leaves the Mac: the page reads it, and it lives only while the app runs.

use std::collections::VecDeque;
use std::io::{self, Write};
use std::sync::Mutex;

/// How many lines the ring keeps, the newest.
const KEPT: usize = 5000;

/// The ring: the number the next line takes, and the lines kept, each with its number.
static RING: Mutex<(u64, VecDeque<(u64, String)>)> = Mutex::new((0, VecDeque::new()));

/// One log line's writer: what the log writes goes to stderr at once and into the ring, a line at a time, once the
/// line is whole (the formatter writes one event, then drops the writer).
#[derive(Default)]
pub struct Tee(Vec<u8>);

impl Write for Tee {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.extend_from_slice(bytes);
        io::stderr().write(bytes)
    }

    fn flush(&mut self) -> io::Result<()> {
        io::stderr().flush()
    }
}

impl Drop for Tee {
    fn drop(&mut self) {
        if self.0.is_empty() {
            return;
        }
        let text = String::from_utf8_lossy(&self.0);
        let Ok(mut ring) = RING.lock() else { return };
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            let n = ring.0;
            ring.0 += 1;
            ring.1.push_back((n, line.to_string()));
            if ring.1.len() > KEPT {
                ring.1.pop_front();
            }
        }
    }
}

/// The lines the ring keeps from number `after` on (all it keeps where it names none), at most `limit` of the newest:
/// `{ lines: [[n, text], ...], next }`, `next` the number to ask from the next time.
#[tauri::command]
pub fn activity_log(after: Option<u64>, limit: Option<usize>) -> serde_json::Value {
    let ring = RING.lock().expect("the activity ring");
    let from = after.unwrap_or(0);
    let lines: Vec<&(u64, String)> = ring.1.iter().filter(|(n, _)| *n >= from).collect();
    let take = limit.unwrap_or(KEPT).min(KEPT);
    let lines = &lines[lines.len().saturating_sub(take)..];
    serde_json::json!({ "lines": lines, "next": ring.0 })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_go_into_the_ring_in_order_and_are_read_from_where_the_page_read_last() {
        let start = activity_log(None, None)["next"].as_u64().unwrap();
        {
            let mut t = Tee::default();
            t.write_all(b"one\ntwo\n").unwrap();
        }
        {
            let mut t = Tee::default();
            t.write_all(b"three\n").unwrap();
        }
        let got = activity_log(Some(start), None);
        let texts: Vec<&str> = got["lines"].as_array().unwrap().iter().map(|l| l[1].as_str().unwrap()).collect();
        assert_eq!(texts, ["one", "two", "three"]);
        assert_eq!(got["next"].as_u64().unwrap(), start + 3);
        let last = activity_log(Some(start), Some(1));
        assert_eq!(last["lines"][0][1], "three");
    }
}

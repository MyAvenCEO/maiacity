//! Per-query stored views (B3 of the one-query-engine plan, `spec/AvenDB/QueryView.lean`): a device keeps, for each
//! query a page asks with its parameters, the answer it gave, stamped with the head it was worked out at, and answers
//! the same query from it again while that answer is still the query on what the device holds now. Opening a view
//! that is current reads no entry and no edit of the log.
//!
//! A view is current where the device took no change since its stamp (`Stamp::revision`: nothing took the store
//! mutably since). Where it took one, the view is kept by the delta rule (`QV4_untouched`, `QF1_untouched`,
//! `answer_untouched`): it stays where the change was entry edits alone (`Lab::touched`, never `all`), none of them
//! named an entry the answer read (its rows, its waiting entries, what its links led to: `Reads::entries`), none of
//! them is an entry the query's selector may now pick (`Reads::plan`) or a schema or lens its answer read through, and
//! nothing beside the log that a read depends on moved (`Stamp::aux`: shares, cap groups, lanes, keys, depth, a
//! showing left half done). Anything else works the answer out again. So the answer served is always the query's
//! answer on the device's state; with `AVENDB_VIEW_ORACLE` set (and in this crate's own tests) every served view is
//! checked against a run of the query, and a difference is a bug that panics.
//!
//! The views of a device live in its store, within a byte budget (`BUDGET`, `MOST`): past it, the least recently read
//! view goes first (LRU); a view let go is worked out again on its next read, which gives the same answer. A store
//! made anew (restore, unlock) starts with none.

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use serde_json::{json, Map, Value};

use crate::id::{EntryId, SignerId, VaultId};
use crate::lab::Lab;
use crate::slice::Selector;

/// The most bytes a device's query views hold.
pub const BUDGET: usize = 8 << 20;
/// The most query views a device keeps.
pub const MOST: usize = 256;

/// The head a view was worked out at: the store's revision (how many times it was taken mutably), the log's size and
/// removals as `Lab::touched` reads them, a digest of what a read depends on beside the log, and whether the device's
/// items were all shown then.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Stamp {
    pub revision: u64,
    pub size: (usize, usize),
    pub gone: u64,
    pub aux: u64,
    pub settled: bool,
}

/// What a query's answer read: the entries it showed or counted, waited on or followed a link to; the vaults whose
/// lanes it read records through; the vault it asked of and its selector, which say which entries it may pick.
#[derive(Clone, Debug, Default)]
pub struct Reads {
    pub entries: HashSet<EntryId>,
    pub lanes: HashSet<VaultId>,
    pub vault: Option<VaultId>,
    pub plan: Option<Selector>,
    /// It read through no index the delta rule covers (a refusal, a read of no plan): never kept past its stamp.
    pub opaque: bool,
}

struct View {
    stamp: Stamp,
    reads: Reads,
    answer: Value,
    bytes: usize,
    used: u64,
    /// When its answer last became another (a tick of its device's views): what a page that read it says it saw.
    version: u64,
}

/// How a device's views answered: from a view at its stamp, from one the delta rule kept, by working the answer out
/// (none held, or one the change touched), and how many views the budget let go.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Stats {
    pub current: u64,
    pub kept: u64,
    pub worked: u64,
    pub let_go: u64,
}

impl Stats {
    pub fn to_json(&self) -> Value {
        json!({ "current": self.current, "kept": self.kept, "worked": self.worked, "let_go": self.let_go })
    }
}

/// A device's query views, by the query as the page asked it.
#[derive(Default)]
pub struct QueryViews {
    views: HashMap<String, View>,
    bytes: usize,
    tick: u64,
    stats: Stats,
}

impl QueryViews {
    pub fn stats(&self) -> Stats {
        self.stats
    }

    pub fn len(&self) -> usize {
        self.views.len()
    }

    pub fn is_empty(&self) -> bool {
        self.views.is_empty()
    }

    pub fn bytes(&self) -> usize {
        self.bytes
    }

    /// Keeps `answer` for `key`, then lets the least recently read views go until the budget holds.
    fn put(&mut self, key: String, stamp: Stamp, reads: Reads, answer: Value) {
        let bytes = key.len() + answer.to_string().len() + reads.entries.len() * 32 + reads.lanes.len() * 32;
        if bytes > BUDGET { return; }
        self.tick += 1;
        let version = self.views.get(&key).filter(|old| old.answer == answer).map_or(self.tick, |old| old.version);
        if let Some(old) = self.views.insert(key, View { stamp, reads, answer, bytes, used: self.tick, version }) {
            self.bytes -= old.bytes;
        }
        self.bytes += bytes;
        while self.bytes > BUDGET || self.views.len() > MOST {
            let Some(oldest) = self.views.iter().min_by_key(|(_, v)| v.used).map(|(k, _)| k.clone()) else { break };
            let gone = self.views.remove(&oldest).expect("the oldest view");
            self.bytes -= gone.bytes;
            self.stats.let_go += 1;
        }
    }
}

fn oracle() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    cfg!(test) || *ON.get_or_init(|| std::env::var_os("AVENDB_VIEW_ORACLE").is_some())
}

/// Whether a change since `view`'s stamp, to `now`, leaves its answer as it was (`answer_untouched`).
fn kept(lab: &Lab, me: SignerId, view: &View, now: &Stamp) -> bool {
    let was = &view.stamp;
    if view.reads.opaque || !was.settled || !now.settled || was.aux != now.aux || was.gone != now.gone { return false; }
    let t = lab.touched(me, was.size.0, was.size.1, Some(was.gone));
    if t.all { return false; }
    let reads = &view.reads;
    !t.entries.iter().any(|e| {
        if reads.entries.contains(e) { return true; }
        if !reads.lanes.is_empty() && lab.lane_entry(me, *e).is_some() { return true; }
        if reads.vault.is_some_and(|v| lab.vault_of_entry(me, *e).is_some_and(|x| x != v)) { return false; }
        match lab.meaning(me, *e) {
            None => true,
            Some(m) => reads.plan.as_ref().is_none_or(|p| p.matches(&m.attrs)),
        }
    })
}

/// What device `me`'s view of query `o` gives now: its answer where it is current or the delta rule kept it, with
/// whether it is the one the view held; else none.
fn held(lab: &Lab, me: SignerId, key: &str, now: &Stamp) -> Option<(Value, u64)> {
    let mut views = lab.query_views(me).lock().unwrap_or_else(|p| p.into_inner());
    views.tick += 1;
    let tick = views.tick;
    let found = views.views.get(key).and_then(|v| if v.stamp == *now { Some(true) } else if kept(lab, me, v, now) {
        Some(false) } else { None });
    let Some(current) = found else {
        views.stats.worked += 1;
        return None;
    };
    if current { views.stats.current += 1 } else { views.stats.kept += 1 }
    let v = views.views.get_mut(key).expect("the view found");
    v.stamp = *now;
    v.used = tick;
    Some((v.answer.clone(), v.version))
}

/// Works query `o`'s answer out by `run` and keeps it as device `me`'s view of it: with the view's version, where the
/// budget kept it.
fn work<E>(lab: &Lab, me: SignerId, key: String, now: Stamp, run: impl Fn(&mut Reads) -> Result<Value, E>)
    -> Result<(Value, Option<u64>), E> {
    let mut reads = Reads::default();
    let answer = run(&mut reads)?;
    let mut views = lab.query_views(me).lock().unwrap_or_else(|p| p.into_inner());
    views.put(key.clone(), now, reads, answer.clone());
    let version = views.views.get(&key).map(|v| v.version);
    Ok((answer, version))
}

fn checked<E>(key: &str, answer: &Value, run: impl Fn(&mut Reads) -> Result<Value, E>) {
    if oracle() && let Ok(fresh) = run(&mut Reads::default()) {
        assert_eq!(*answer, fresh, "query view {key} is not the query's answer at its head");
    }
}

/// The answer to query `o` on device `me`: from its stored view where that is still the query's answer, else worked
/// out by `run`, which says what it read, and kept. A refusal is never kept.
pub fn read<E>(lab: &Lab, me: SignerId, o: &Map<String, Value>, run: impl Fn(&mut Reads) -> Result<Value, E>)
    -> Result<Value, E> {
    let key = serde_json::to_string(o).expect("a query is JSON");
    let now = lab.query_view_stamp(me);
    if let Some((answer, _)) = held(lab, me, &key, &now) {
        checked(&key, &answer, &run);
        return Ok(answer);
    }
    work(lab, me, key, now, run).map(|(answer, _)| answer)
}

/// The version of query `o`'s answer on device `me` (B4, `LiveQuery.lean` over query views), and whether it is
/// another than `seen`, the version the page last read: the view's where it is current or the delta rule kept it;
/// else the answer is worked out again and kept, so the page's read of it next answers from the view at once, its
/// version staying where the answer is the same. A refusal, or a view the budget let go at once, is always another.
/// A page re-runs only the reads it is told changed, and keeps the versions it was told.
pub fn changed<E>(lab: &Lab, me: SignerId, o: &Map<String, Value>, seen: Option<u64>,
    run: impl Fn(&mut Reads) -> Result<Value, E>) -> (bool, Option<u64>) {
    let key = serde_json::to_string(o).expect("a query is JSON");
    let now = lab.query_view_stamp(me);
    let version = match held(lab, me, &key, &now) {
        Some((answer, version)) => {
            checked(&key, &answer, &run);
            Some(version)
        }
        None => work(lab, me, key, now, run).ok().and_then(|(_, version)| version),
    };
    (version.is_none() || version != seen, version)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cast::document;
    use crate::keys::SeededRng;
    use rand_core::Rng as _;

    fn read(lab: &Lab, d: SignerId, q: &Value) -> Value {
        crate::engine::read(lab, d, q)
    }

    /// `QueryView.lean` (view == query on the full log): random edits on two devices of one person and a device of
    /// another, synced now and then, and after every step each query read from the device's views answers exactly
    /// what the query run on every entry answers; and the views were kept by the delta rule, not worked out again each
    /// time.
    #[test]
    fn a_query_view_is_the_query_at_every_head() {
        let mut w = crate::cast::world();
        let mut rng = SeededRng::new("query views", b"parity");
        let (vault, devices) = (w.alice, [w.mac_a, w.phone_a, w.mac_b]);
        let mut entries: Vec<EntryId> = vec![];
        let queries = |vault: VaultId| [
            json!({"op":"query","vault":vault.to_hex(),"where":{"type":["note"]},"order":[["created","desc"]],"limit":3}),
            json!({"op":"query","vault":vault.to_hex(),"where":{"all":[{"type":["todo"]},{"tag":"work"}]}}),
            json!({"op":"query","vault":vault.to_hex(),"where":{"path":["title"],"eq":"Note 3"},"select":["title"]}),
            json!({"op":"query","vault":vault.to_hex(),"where":{"noTag":["home"]},"limit":2,"offset":1}),
            json!({"op":"query","where":{"type":["note","todo"]},"order":[[["title"],"asc"]],"limit":4}),
            json!({"op":"query","vault":vault.to_hex(),"where":{"type":["unrelated"]}}),
        ];
        for step in 0..120u32 {
            let me = devices[(rng.next_u32() % 2) as usize];
            match rng.next_u32() % 7 {
                0 | 1 => {
                    let ty = ["note", "todo", "unrelated"][(rng.next_u32() % 3) as usize];
                    let title = format!("Note {}", rng.next_u32() % 6);
                    if let Ok(e) = w.lab.create(me, vault, vault, ty, &[], document(&title, "body", me)) { entries.push(e); }
                }
                2 if !entries.is_empty() => {
                    let e = entries[(rng.next_u32() as usize) % entries.len()];
                    let title = format!("Note {}", rng.next_u32() % 6);
                    let _ = w.lab.edit(me, vault, e, |item| { item.edit_document(|d| d.title = title.clone()); });
                }
                3 if !entries.is_empty() => {
                    let e = entries[(rng.next_u32() as usize) % entries.len()];
                    let (add, remove) = if rng.next_u32() % 2 == 0 { (&["work"][..], &["home"][..]) } else { (&["home"][..], &["work"][..]) };
                    let _ = w.lab.tag(me, vault, e, add, remove);
                }
                4 => { w.lab.sync_all(u64::from(step)); }
                5 if step % 3 == 0 => { w.lab.set_query_depth(me, 1 + (rng.next_u32() % 3) as usize); }
                _ => {}
            }
            for d in devices {
                for q in queries(vault) {
                    assert_eq!(read(&w.lab, d, &q), crate::engine::full_query_oracle(&w.lab, d, &q), "step {step}, {q}");
                }
            }
        }
        for d in devices { eprintln!("query views of {d:?}: {:?}", w.lab.query_views(d).lock().unwrap().stats()); }
        let stats = w.lab.query_views(w.mac_b).lock().unwrap().stats();
        assert!(stats.current > 0, "{stats:?}");
        let kept: u64 = devices.iter().map(|d| w.lab.query_views(*d).lock().unwrap().stats().kept).sum();
        assert!(kept > 0, "the delta rule kept views: {:?}", devices.map(|d| w.lab.query_views(d).lock().unwrap().stats()));
    }

    /// A view stays out of what its device holds beyond the budget: the least recently read goes, and its query answers
    /// the same when asked again.
    #[test]
    fn the_least_recently_read_view_goes_first() {
        let mut w = crate::cast::world();
        let (me, vault) = (w.mac_a, w.alice);
        w.lab.create(me, vault, vault, "note", &[], document("Note", "body", me)).unwrap();
        let q = |n: usize| json!({"op":"query","vault":vault.to_hex(),"where":{"type":["note"]},"limit":n + 1});
        let first = read(&w.lab, me, &q(0));
        for n in 1..=MOST { read(&w.lab, me, &q(n)); }
        let views = w.lab.query_views(me).lock().unwrap();
        assert_eq!(views.len(), MOST);
        assert!(views.bytes() <= BUDGET);
        assert_eq!(views.stats().let_go, 1);
        drop(views);
        assert_eq!(read(&w.lab, me, &q(0)), first);
        assert_eq!(w.lab.query_views(me).lock().unwrap().stats().let_go, 2, "the next oldest went for it");
    }

    /// B4: a page passes the queries it shows to `touched` with the versions it read, and is told which changed: a
    /// change to another type's entry changes none, a new note changes the notes; another page that read the same query
    /// in between is still told its own version moved.
    #[test]
    fn touched_says_which_shown_queries_changed() {
        let mut w = crate::cast::world();
        let (me, vault) = (w.mac_a, w.alice);
        let notes = json!({"op":"query","vault":vault.to_hex(),"where":{"type":["note"]},"order":[["created","desc"]],"limit":2});
        let todos = json!({"op":"query","vault":vault.to_hex(),"where":{"type":["todo"]}});
        let since = read(&w.lab, me, &json!({"op":"touched","since":[0, 0]}))["ok"]["since"].clone();
        let first = read(&w.lab, me, &json!({"op":"touched","since":since,"reads":[notes, todos]}))["ok"].clone();
        assert_eq!(first["changed"], json!([0, 1]), "a page that saw no version re-runs");
        let (v_notes, v_todos) = (first["versions"][0].clone(), first["versions"][1].clone());
        let since = first["since"].clone();
        w.lab.create(me, vault, vault, "unrelated", &[], document("Noise", "body", me)).unwrap();
        let quiet = read(&w.lab, me, &json!({"op":"touched","since":since,"reads":[[notes, v_notes], [todos, v_todos]]}))["ok"].clone();
        assert_eq!(quiet["changed"], json!([]), "{quiet}");
        let since = quiet["since"].clone();
        w.lab.create(me, vault, vault, "note", &[], document("Note", "body", me)).unwrap();
        let other = read(&w.lab, me, &json!({"op":"touched","since":since,"reads":[notes]}))["ok"].clone();
        assert_eq!(other["changed"], json!([0]));
        let mine = read(&w.lab, me, &json!({"op":"touched","since":since,"reads":[[notes, v_notes], [todos, v_todos]]}))["ok"].clone();
        assert_eq!(mine["changed"], json!([0]), "the notes moved since this page read them, the todos didn't: {mine}");
        assert_eq!(read(&w.lab, me, &notes), crate::engine::full_query_oracle(&w.lab, me, &notes));
        let hits = w.lab.query_views(me).lock().unwrap().stats().current;
        read(&w.lab, me, &notes);
        assert_eq!(w.lab.query_views(me).lock().unwrap().stats().current, hits + 1, "the re-run reads the view");
    }

    /// A window (`engine::query`, `window`) is the newest `n` rows by creation alone: `count` the rows it shows and no
    /// `next`; a page cursor beside it is refused; its answer stays through edits to entries older than its rows and
    /// to other types, and moves where a new entry comes in; the engine over just the entries a shared index lists
    /// (`engine::query_among`) answers the same.
    #[test]
    fn a_window_is_the_newest_rows_by_creation() {
        let mut w = crate::cast::world();
        let (me, vault) = (w.mac_a, w.alice);
        let made: Vec<_> = (0..8).map(|i| w.lab.create(me, vault, vault, "note", &[], document(&format!("N{i}"), "b", me)).unwrap()).collect();
        let win = json!({"op":"query","vault":vault.to_hex(),"where":{"type":["note"]},"select":[],"window":3});
        let got = read(&w.lab, me, &win)["ok"].clone();
        let rows: Vec<_> = got["rows"].as_array().unwrap().iter().map(|r| r["entry"].clone()).collect();
        assert_eq!(rows, made[5..].iter().rev().map(|e| json!(e.to_hex())).collect::<Vec<_>>());
        assert_eq!((got["count"].clone(), got["next"].clone()), (json!(3), Value::Null));
        let paged = json!({"op":"query","vault":vault.to_hex(),"where":{"type":["note"]},"window":3,"limit":3});
        assert!(read(&w.lab, me, &paged).get("refused").is_some(), "a window takes no limit beside it");
        let among = crate::engine::query_among(&w.lab, me, &win, made[5..].to_vec());
        assert_eq!((json!({"ok": got.clone()}), 3), among, "the newest three alone answer it");
        w.lab.create(me, vault, vault, "todo", &[], document("T", "b", me)).unwrap();
        w.lab.edit(me, vault, made[0], |item| item.set_text(2, "older")).unwrap();
        assert_eq!(read(&w.lab, me, &win)["ok"], got, "an older note and another type change nothing it shows");
        let newer = w.lab.create(me, vault, vault, "note", &[], document("N8", "b", me)).unwrap();
        assert_eq!(read(&w.lab, me, &win)["ok"]["rows"][0]["entry"], json!(newer.to_hex()));
    }
}

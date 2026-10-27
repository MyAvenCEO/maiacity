//! A query view's window off the shelf (B3, `spec/AvenDB/QueryView.lean`): the newest `w` entries of a vault with one
//! of some labels (a type, a tag, a link), read from the shared index (`shared_index`, B1) and the tail of edits after
//! its stamp, never from the log of what came before.
//!
//! The index is as current as the device's last settled save; the edits after it are of some entries alone
//! (`Lab::shared_touched`). So the window is the window rule twice: the entries the tail names are taken out of what
//! the index lists and put back as their rows say now (`QW2_refill`: the index is read for `w` more than the entries the
//! tail names, at most, as each may have left the window), and new entries come in by their creation (`QW1_append`).
//! What it lists is what a scan of the rows every entry has now gives (`tests`). Where the tail is of another log (a
//! key, a share) or the stamp is of no prefix of the log (a withdrawal), the index can't say: `None`, and the caller
//! asks the engine.

use std::cmp::Reverse;
use std::collections::BTreeSet;
use std::io;
use std::sync::Mutex;

use avendb::id::{EntryId, SignerId, VaultId};
use avendb::lab::Lab;

use crate::shared_index::{SharedIndex, head};

/// A window: its entries, the newest first, each with its creation; how many edits the index was of, how many edits
/// the log held when the tail after them was read, how many entries that tail named, and how many index rows it read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Window {
    pub entries: Vec<(u64, EntryId)>,
    pub index_at: u64,
    pub log_at: usize,
    pub tail: usize,
    pub rows_read: usize,
}

/// The newest `w` entries of vault `vault` with one of `labels` on device `me` of `lab`, created before `before` where
/// it names a cursor (`QueryView.lean` `page`), off index `ix` and the tail after it; `None` where the index can't say.
pub(crate) async fn window(
    ix: &SharedIndex,
    lab: &Mutex<Lab>,
    me: SignerId,
    vault: VaultId,
    labels: &[String],
    before: Option<(u64, EntryId)>,
    w: usize,
) -> io::Result<Option<Window>> {
    let locked = || lab.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    for _ in 0..4 {
        let stamp = ix.stamp().await;
        // the tail after the index, and the rows its entries have now, under one hold of the Lab
        let (tokens, tail, log_at) = {
            let lab = locked();
            let ids = lab.log(me).ids();
            if stamp.at as usize > ids.len() || head(&ids[..stamp.at as usize]) != stamp {
                return Ok(None);
            }
            let Some(touched) = lab.shared_touched(me, stamp.at as usize) else { return Ok(None) };
            let tokens: BTreeSet<_> = lab.find_tokens(me, vault, labels).into_iter().collect();
            let tail: Vec<(EntryId, Option<avendb::index::shared::Of>)> =
                touched.into_iter().map(|e| (e, lab.shared_of(me, e))).collect();
            (tokens, tail, ids.len())
        };
        let listed = ix.find(lab, me, vault, labels, before, w + tail.len()).await?;
        if ix.stamp().await != stamp {
            // a save stepped the index on meanwhile: read again
            continue;
        }
        let named: BTreeSet<EntryId> = tail.iter().map(|(e, _)| *e).collect();
        let mut found: BTreeSet<Reverse<(u64, EntryId)>> =
            listed.iter().filter(|(_, e)| !named.contains(e)).map(|r| Reverse(*r)).collect();
        for (e, of) in &tail {
            let older = |of: &&avendb::index::shared::Of| before.is_none_or(|c| (of.created, *e) < c);
            if let Some(of) = of.as_ref().filter(|of| of.tokens.iter().any(|t| tokens.contains(t))).filter(older) {
                found.insert(Reverse((of.created, *e)));
            }
        }
        return Ok(Some(Window {
            entries: found.into_iter().take(w).map(|r| r.0).collect(),
            index_at: stamp.at,
            log_at,
            tail: tail.len(),
            rows_read: listed.len(),
        }));
    }
    Ok(None)
}

/// What a window query `op` (`engine::window_of`) of device `me` answers, read off index `ix` and the tail after it:
/// the engine's query over the newest entries with one of its labels, of its vault or of every vault its view knows
/// (each vault's window, merged by creation: one cursor orders them all), and those whose header the device hasn't
/// read (`engine::query_among`); a window of `n` first and four times more while fewer than `n` rows show and some
/// vault's index lists more; with the window it read last. `None` where the index can't say (`window`, or a vault it
/// holds no index key of), or the log took edits between the windows and the query, and the caller asks the engine.
pub(crate) async fn answer(
    ix: &SharedIndex,
    lab: &Mutex<Lab>,
    me: SignerId,
    op: &serde_json::Value,
) -> io::Result<Option<(serde_json::Value, Window)>> {
    let Some((vault, n, before, labels)) = avendb::engine::window_of(op) else { return Ok(None) };
    let vaults = {
        let held = lab.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let keyed: BTreeSet<VaultId> = held.index_vaults(me).into_iter().collect();
        // of every vault: those it holds no key of it opens nothing of, and an audience's alone the index can't find
        let any = held.key_vaults(me);
        let vaults = vault.map_or_else(|| held.view_vaults(me).into_iter().filter(|v| any.contains(v)).collect(), |v| vec![v]);
        if !vaults.iter().all(|v| keyed.contains(v)) { return Ok(None) }
        vaults
    };
    let mut k = n.max(1);
    for _ in 0..8 {
        let mut win = Window { entries: vec![], index_at: 0, log_at: 0, tail: 0, rows_read: 0 };
        let mut more = false;
        for (i, v) in vaults.iter().enumerate() {
            let Some(one) = window(ix, lab, me, *v, &labels, before, k).await? else { return Ok(None) };
            if i > 0 && (one.log_at, one.index_at) != (win.log_at, win.index_at) { return Ok(None) }
            more |= one.entries.len() >= k;
            win.entries.extend(one.entries);
            (win.log_at, win.index_at, win.tail) = (one.log_at, one.index_at, one.tail);
            win.rows_read += one.rows_read;
        }
        win.entries.sort_by(|a, b| b.cmp(a));
        win.entries.truncate(k);
        let held = lab.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if held.log(me).ids().len() != win.log_at { return Ok(None) }
        let mut among: Vec<EntryId> = win.entries.iter().map(|(_, e)| *e).collect();
        among.extend(held.untyped_of(me, vault));
        let (got, shown) = avendb::engine::query_among(&held, me, op, among);
        drop(held);
        if shown >= n || !more { return Ok(Some((got, win))) }
        k = k.saturating_mul(4);
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shelf_index::tests::Memory;
    use avendb::cast::{document, world};
    use avendb::index::{tag_label, type_label};

    /// What a scan of every entry's rows now gives: the newest `w` of vault `vault` with one of `labels`.
    fn scanned(lab: &Lab, me: SignerId, vault: VaultId, labels: &[String], w: usize) -> Vec<(u64, EntryId)> {
        let tokens: BTreeSet<_> = lab.find_tokens(me, vault, labels).into_iter().collect();
        let mut all: Vec<(u64, EntryId)> = lab.shared_entries(me).into_iter()
            .filter_map(|e| lab.shared_of(me, e))
            .filter(|of| of.tokens.iter().any(|t| tokens.contains(t)))
            .map(|of| (of.created, of.entry))
            .collect();
        all.sort_by(|a, b| b.cmp(a));
        all.truncate(w);
        all
    }

    /// `QueryView.lean` QW1/QW2 over the shared index: with saves now and then, so that a tail of edits after the
    /// index's stamp is mostly there, the window off the index and the tail is the scan's at every step, for a type, a
    /// tag and both, and it reads at most `w` and the tail's entries of index rows.
    #[tokio::test]
    async fn the_window_off_the_index_and_its_tail_is_the_scans() {
        let mut w = world();
        let (mac, alice) = (w.mac_a, w.alice);
        let ix = SharedIndex::open(Memory::new().shelf()).await.unwrap();
        let mut seed = 0x2545_f491_4f6c_dd1du64;
        let mut next = |n: u64| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed % n
        };
        let queries = [
            (vec![type_label("note")], 3),
            (vec![tag_label("work")], 2),
            (vec![type_label("todo"), tag_label("work")], 4),
            (vec![type_label("room")], 1),
        ];
        let mut made: Vec<EntryId> = vec![];
        let (mut answered, mut with_tail) = (0, 0);
        for step in 0..60u64 {
            match next(5) {
                0 | 1 => {
                    let ty = ["note", "todo", "room"][next(3) as usize];
                    made.push(w.lab.create(mac, alice, alice, ty, &[], document("N", "x", mac)).unwrap());
                }
                2 if !made.is_empty() => {
                    let e = made[next(made.len() as u64) as usize];
                    if next(2) == 0 {
                        w.lab.tag(mac, alice, e, &["work"], &[]).unwrap();
                    } else {
                        w.lab.tag(mac, alice, e, &[], &["work"]).unwrap();
                    }
                }
                3 if !made.is_empty() => {
                    let e = made[next(made.len() as u64) as usize];
                    w.lab.edit(mac, alice, e, |item| item.set_text(2, &format!("edit {step}"))).ok();
                }
                _ => {}
            }
            let lab = Mutex::new(std::mem::replace(&mut w.lab, Lab::new()));
            if next(3) == 0 {
                let held = lab.lock().unwrap().log(mac).ids().len();
                ix.step(&lab, mac, held).await.unwrap();
            }
            for (labels, n) in &queries {
                let got = window(&ix, &lab, mac, alice, labels, None, *n).await.unwrap();
                if let Some(got) = got {
                    answered += 1;
                    if got.tail > 0 { with_tail += 1; }
                    assert_eq!(got.entries, scanned(&lab.lock().unwrap(), mac, alice, labels, *n), "step {step}, {labels:?}");
                    assert!(got.rows_read <= n + got.tail, "{got:?}");
                }
            }
            w.lab = lab.into_inner().unwrap();
        }
        eprintln!("windows answered off the index: {answered} of 240, {with_tail} with a tail");
        assert!(answered > 100, "the index answered most windows: {answered}");
        assert!(with_tail > 20, "and many with a tail after its stamp: {with_tail}");
    }

    /// Chat's rooms as a window (`engine::query`, `window`): opened right after a save, the newest `w` rooms come off
    /// the index alone, no edit of the log read and at most `w` index rows; after edits the index hasn't saved, off
    /// the index and the tail, at most `w` and the tail's entries per window it reads. Every answer is the engine's.
    #[tokio::test]
    async fn chats_rooms_open_off_the_index() {
        let mut w = world();
        let (mac, alice) = (w.mac_a, w.alice);
        let ix = SharedIndex::open(Memory::new().shelf()).await.unwrap();
        let rooms_of = |n: usize| serde_json::json!({"op": "query", "vault": alice.to_hex(),
            "where": {"all": [{"type": ["room"]}, {"not": {"tag": "gone"}}]}, "select": [], "window": n});
        let mut made = vec![];
        for i in 0..60 {
            let ty = if i % 3 == 2 { "note" } else { "room" };
            made.push(w.lab.create(mac, alice, alice, ty, &[], document("R", "x", mac)).unwrap());
        }
        // rooms left long ago are the oldest
        for e in &made[..6] { w.lab.tag(mac, alice, *e, &["gone"], &[]).unwrap(); }
        let lab = Mutex::new(std::mem::replace(&mut w.lab, Lab::new()));
        let held = lab.lock().unwrap().log(mac).ids().len();
        ix.step(&lab, mac, held).await.unwrap();
        for n in [1, 5, 20, 50] {
            let op = rooms_of(n);
            let (got, win) = answer(&ix, &lab, mac, &op).await.unwrap().expect("the index says");
            let full = avendb::engine::read(&lab.lock().unwrap(), mac, &op);
            assert_eq!(got, full, "window {n}");
            assert_eq!(got["ok"]["rows"].as_array().unwrap().len(), n.min(36), "window {n}");
            let log_read = win.log_at - win.index_at as usize;
            eprintln!("open window {n}: {log_read} log edits, {} index rows, tail {}", win.rows_read, win.tail);
            assert_eq!((log_read, win.tail), (0, 0), "opened right after a save");
            if n <= 20 { assert!(win.rows_read <= n, "{win:?}"); }
        }
        // older pages by the cursor of the page before (QW3_pages): 36 rooms in pages of 10, each the engine's, each
        // read off the index alone, and together the newest 36
        let paged = |n: usize, before: &serde_json::Value| { let mut op = rooms_of(0);
            op["window"] = serde_json::json!({"newest": n, "before": before}); op };
        let (mut before, mut all, mut pages) = (serde_json::Value::Null, vec![], 0);
        loop {
            let op = paged(10, &before);
            let (got, win) = answer(&ix, &lab, mac, &op).await.unwrap().expect("the index says");
            assert_eq!(got, avendb::engine::read(&lab.lock().unwrap(), mac, &op), "page {pages}");
            assert!(win.rows_read <= 10 && win.log_at == win.index_at as usize, "{win:?}");
            all.extend(got["ok"]["rows"].as_array().unwrap().iter().map(|r| r["entry"].clone()));
            pages += 1;
            before = got["ok"]["next"].clone();
            if before.is_null() { break; }
        }
        let whole = avendb::engine::read(&lab.lock().unwrap(), mac, &rooms_of(50));
        assert_eq!(all, whole["ok"]["rows"].as_array().unwrap().iter().map(|r| r["entry"].clone()).collect::<Vec<_>>());
        assert_eq!(pages, 4);
        // a room made since leaves an older page as it was (QW3_older_page)
        let first = avendb::engine::read(&lab.lock().unwrap(), mac, &rooms_of(10));
        let second = paged(10, &first["ok"]["next"]);
        let was = answer(&ix, &lab, mac, &second).await.unwrap().unwrap().0;
        lab.lock().unwrap().create(mac, alice, alice, "room", &[], document("R", "new", mac)).unwrap();
        let (now, win) = answer(&ix, &lab, mac, &second).await.unwrap().unwrap();
        assert_eq!(now["ok"]["rows"], was["ok"]["rows"]);
        assert_eq!(win.tail, 1);
        // every vault the device holds (no `vault`): each vault's window merged by creation, one cursor across them
        let coop = w.avenceo;
        let in_coop = lab.lock().unwrap().create(mac, coop, coop, "room", &[], document("C", "coop", mac)).is_ok();
        let held = lab.lock().unwrap().log(mac).ids().len();
        ix.step(&lab, mac, held).await.unwrap();
        let mut every = rooms_of(0);
        every.as_object_mut().unwrap().remove("vault");
        let (mut before, mut pages, mut off_index) = (serde_json::Value::Null, 0, 0);
        loop {
            every["window"] = serde_json::json!({"newest": 7, "before": before});
            let full = avendb::engine::read(&lab.lock().unwrap(), mac, &every);
            if let Some((got, _)) = answer(&ix, &lab, mac, &every).await.unwrap() {
                assert_eq!(got, full, "every vault, page {pages}");
                off_index += 1;
            }
            pages += 1;
            before = full["ok"]["next"].clone();
            if before.is_null() { break; }
        }
        eprintln!("every vault (a coop room: {in_coop}): {off_index} of {pages} pages off the index");
        assert!(off_index > 0 && pages >= 6, "{off_index} of {pages}");
        // edits the index hasn't saved: the tail after its stamp
        let mut w2 = lab.into_inner().unwrap();
        let mut seed = 0x9e37_79b9_7f4a_7c15u64;
        let mut next = |n: u64| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed % n
        };
        let (mut answered, mut most_over) = (0, 0usize);
        for step in 0..40u64 {
            match next(4) {
                0 => made.push(w2.create(mac, alice, alice, "room", &[], document("R", "y", mac)).unwrap()),
                1 => { let e = made[next(made.len() as u64) as usize]; w2.tag(mac, alice, e, &["gone"], &[]).unwrap(); }
                2 => { let e = made[next(made.len() as u64) as usize]; w2.tag(mac, alice, e, &[], &["gone"]).unwrap(); }
                _ => { let e = made[next(made.len() as u64) as usize]; w2.edit(mac, alice, e, |item| item.set_text(2, &format!("e {step}"))).ok(); }
            }
            let lab = Mutex::new(w2);
            if next(4) == 0 {
                let held = lab.lock().unwrap().log(mac).ids().len();
                ix.step(&lab, mac, held).await.unwrap();
            }
            for n in [3, 10] {
                let op = rooms_of(n);
                if let Some((got, win)) = answer(&ix, &lab, mac, &op).await.unwrap() {
                    answered += 1;
                    assert_eq!(got, avendb::engine::read(&lab.lock().unwrap(), mac, &op), "step {step}, window {n}");
                    most_over = most_over.max(win.rows_read.saturating_sub(n + win.tail));
                }
            }
            w2 = lab.into_inner().unwrap();
        }
        eprintln!("windows off the index after edits: {answered} of 80, at most {most_over} rows past w + tail");
        assert!(answered > 40, "{answered}");
    }
}

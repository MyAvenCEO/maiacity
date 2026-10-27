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

/// A window: its entries, the newest first, each with its creation; how many edits the index was of, how many
/// entries the tail after them named, and how many index rows it read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Window {
    pub entries: Vec<(u64, EntryId)>,
    pub index_at: u64,
    pub tail: usize,
    pub rows_read: usize,
}

/// The newest `w` entries of vault `vault` with one of `labels` on device `me` of `lab`, off index `ix` and the tail
/// after it; `None` where the index can't say.
pub(crate) async fn window(
    ix: &SharedIndex,
    lab: &Mutex<Lab>,
    me: SignerId,
    vault: VaultId,
    labels: &[String],
    w: usize,
) -> io::Result<Option<Window>> {
    let locked = || lab.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    for _ in 0..4 {
        let stamp = ix.stamp().await;
        // the tail after the index, and the rows its entries have now, under one hold of the Lab
        let (tokens, tail) = {
            let lab = locked();
            let ids = lab.log(me).ids();
            if stamp.at as usize > ids.len() || head(&ids[..stamp.at as usize]) != stamp {
                return Ok(None);
            }
            let Some(touched) = lab.shared_touched(me, stamp.at as usize) else { return Ok(None) };
            let tokens: BTreeSet<_> = lab.find_tokens(me, vault, labels).into_iter().collect();
            let tail: Vec<(EntryId, Option<avendb::index::shared::Of>)> =
                touched.into_iter().map(|e| (e, lab.shared_of(me, e))).collect();
            (tokens, tail)
        };
        let listed = ix.find(lab, me, vault, labels, None, w + tail.len()).await?;
        if ix.stamp().await != stamp {
            // a save stepped the index on meanwhile: read again
            continue;
        }
        let named: BTreeSet<EntryId> = tail.iter().map(|(e, _)| *e).collect();
        let mut found: BTreeSet<Reverse<(u64, EntryId)>> =
            listed.iter().filter(|(_, e)| !named.contains(e)).map(|r| Reverse(*r)).collect();
        for (e, of) in &tail {
            if let Some(of) = of.as_ref().filter(|of| of.tokens.iter().any(|t| tokens.contains(t))) {
                found.insert(Reverse((of.created, *e)));
            }
        }
        return Ok(Some(Window {
            entries: found.into_iter().take(w).map(|r| r.0).collect(),
            index_at: stamp.at,
            tail: tail.len(),
            rows_read: listed.len(),
        }));
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
                let got = window(&ix, &lab, mac, alice, labels, *n).await.unwrap();
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
}

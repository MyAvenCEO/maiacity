//! A page of posts off the shelf (`spec/AvenDB/PostsPage.lean`, gate G1): the `posts` op, and a call of a query entry
//! whose `read` runs it (`query-posts`), answered from each vault's rows in the shared index (`shared_index`, B1) and
//! the tail of edits after its stamp, never from a walk of every entry the device holds.
//!
//! Each vault the device holds an index key of gives its newest posts older than the cursor, at most a page and one
//! more (`P1_parts`: a post on the page of all is on the page of its own vault); the entries the tail names are taken
//! out of what the index lists and put back as the device holds them now, as a query view's window is
//! (`query_window`). Of those candidates, the newest first, `engine::posts_among` reads in full only the posts it
//! shows and one more, each checked again (landed, public, of type post, not deleted); a vault's profile and its files
//! everyone may read, which a post's name and pictures read, come off the index too. Where a candidate isn't shown
//! (a post of the owners alone) and a vault may hold more, it reads that vault further. Where the index can't say (no
//! shelf, a tail of another log, a stamp of no prefix of the log), `None`: the caller asks the engine.

use std::collections::{BTreeMap, BTreeSet};
use std::io;
use std::sync::Mutex;

use avendb::engine;
use avendb::id::{EntryId, SignerId, VaultId};
use avendb::index::{Token, type_label};
use avendb::lab::Lab;
use avendb::world;
use serde_json::{Value, json};

use crate::shared_index::SharedIndex;

/// The labels a page reads: the posts, the files their pictures are of, and the profiles that name their vaults.
const POST: &str = "post";
const FILE: &str = "file";
const PROFILE: &str = "profile";

/// The most files and profiles of one vault a page reads off the index.
const MOST_ROWS: usize = 4096;

/// What a page of `limit` posts after post `after` reads under one hold of the Lab: each vault's tokens of its posts,
/// files and profiles, the cursor's key, and the entries the tail after the index names, with their keys and types.
struct Plan {
    vaults: Vec<(VaultId, [Vec<Token>; 3])>,
    cursor: Option<(u64, EntryId)>,
    named: BTreeSet<EntryId>,
    tail: Vec<(u64, EntryId, String)>,
}

/// A page of `limit` posts older than post `after`, the newest first, `{"ok": {"posts", "more"}}` as the `posts` op
/// answers, off index `ix` and the tail after it on device `me` of `lab`; `None` where the index can't say.
pub(crate) async fn page(
    ix: &SharedIndex,
    lab: &Mutex<Lab>,
    me: SignerId,
    limit: usize,
    after: Option<EntryId>,
) -> io::Result<Option<Value>> {
    let locked = || lab.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut want = limit + 1;
    for _ in 0..8 {
        let stamp = ix.stamp().await;
        let plan = {
            let lab = locked();
            if !lab.log(me).of_log(stamp.into()) {
                return Ok(None);
            }
            let Some(named) = lab.shared_touched(me, stamp.at as usize) else { return Ok(None) };
            let cursor = match after {
                None => None,
                Some(a) => match world::post_key(&lab, me, a) {
                    Some(k) => Some(k),
                    None => return Ok(Some(json!({ "ok": { "posts": [], "more": false } }))),
                },
            };
            let tokens = |v: VaultId, ty: &str| lab.held_tokens(me, v, &[type_label(ty)]);
            let vaults = lab.index_vaults(me).into_iter().map(|v| (v, [tokens(v, POST), tokens(v, FILE), tokens(v, PROFILE)])).collect();
            let tail = named
                .iter()
                .filter_map(|e| lab.creation_of(me, *e).map(|(ty, at)| (at, *e, ty.as_str().to_string())))
                .collect();
            Plan { vaults, cursor, named, tail }
        };
        // each vault's newest `want` posts after the cursor, its own entries the tail names put back as they are now
        let mut keys: BTreeSet<std::cmp::Reverse<(u64, EntryId)>> = BTreeSet::new();
        let mut cut = false;
        for (_, [posts, _, _]) in &plan.vaults {
            let listed = ix.find_by(posts, plan.cursor, want).await?;
            cut |= listed.len() == want;
            keys.extend(listed.into_iter().filter(|(_, e)| !plan.named.contains(e)).map(std::cmp::Reverse));
        }
        let older = |k: &(u64, EntryId)| plan.cursor.is_none_or(|c| *k < c);
        let tail = &plan.tail;
        let typed = move |ty: &'static str| tail.iter().filter(move |(_, _, t)| t == ty).map(|(at, e, _)| (*at, *e));
        keys.extend(typed(POST).filter(older).map(std::cmp::Reverse));
        let keys: Vec<(u64, EntryId)> = keys.into_iter().map(|r| r.0).collect();
        // the files and profiles of the vaults the candidates are of
        let of: BTreeSet<VaultId> = {
            let lab = locked();
            keys.iter().take(want).filter_map(|(_, e)| lab.vault_of_entry(me, *e)).collect()
        };
        let mut rows: BTreeMap<VaultId, [Vec<(u64, EntryId)>; 2]> = BTreeMap::new();
        for (v, [_, files, profiles]) in plan.vaults.iter().filter(|(v, _)| of.contains(v)) {
            let fresh = |listed: Vec<(u64, EntryId)>| -> Vec<(u64, EntryId)> {
                listed.into_iter().filter(|(_, e)| !plan.named.contains(e)).collect()
            };
            let files = fresh(ix.find_by(files, None, MOST_ROWS).await?);
            let profiles = fresh(ix.find_by(profiles, None, MOST_ROWS).await?);
            rows.insert(*v, [files, profiles]);
        }
        if ix.stamp().await != stamp {
            // a save stepped the index on meanwhile: read again
            continue;
        }
        let answer = {
            let lab = locked();
            let tail_of = |v: VaultId, ty: &'static str| -> Vec<(u64, EntryId)> {
                typed(ty).filter(|(_, e)| lab.vault_of_entry(me, *e) == Some(v)).collect()
            };
            let mut files = |v: VaultId| {
                let mut entries: Vec<EntryId> = rows.get(&v).map(|r| r[0].iter().map(|(_, e)| *e).collect()).unwrap_or_default();
                entries.extend(tail_of(v, FILE).into_iter().map(|(_, e)| e));
                world::public_file_names(&lab, me, &entries)
            };
            let mut named = |v: VaultId| {
                let mut entries: Vec<(u64, EntryId)> = rows.get(&v).map(|r| r[1].clone()).unwrap_or_default();
                entries.extend(tail_of(v, PROFILE));
                world::profile_among(&lab, me, v, &entries)
            };
            engine::posts_among(&lab, me, keys.clone(), limit, &mut files, &mut named)
        };
        let shown = answer["ok"]["posts"].as_array().map_or(0, Vec::len);
        let more = answer["ok"]["more"] == json!(true);
        // a vault may hold more than it gave: where the candidates left the page short (one not shown, a post of the
        // owners alone) or can't say whether one more comes after it, read on
        if cut && !more && shown <= limit {
            want = want.saturating_mul(4);
            continue;
        }
        return Ok(Some(answer));
    }
    Ok(None)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::shelf_index::tests::Memory;
    use avendb::cast::{World, world};

    pub(crate) const TAG: &str = "content:published";

    fn run(w: &mut World, d: SignerId, op: Value) -> Value {
        let out = engine::run(&mut w.lab, d, &op);
        out.get("ok").cloned().unwrap_or_else(|| panic!("{op}: {out}"))
    }

    /// A published post of Alice's (`published`), or one of hers alone; its entry.
    pub(crate) fn post(w: &mut World, title: &str, published: bool) -> EntryId {
        let (mac, alice) = (w.mac_a, w.alice.to_hex());
        let value = json!({ "kind": "post", "title": title, "text": "Out now.", "channel": "Devlog" });
        let tags: Vec<&str> = if published { vec![TAG] } else { vec![] };
        let made = run(w, mac, json!({ "op": "create", "vault": alice, "type": "post", "tags": tags, "value": value }));
        EntryId::from_hex(made["entry"].as_str().unwrap()).unwrap()
    }

    /// Alice's vault with her profile, its posts public by a tag, as Bob's Mac follows it.
    pub(crate) fn followed() -> World {
        let mut w = world();
        let (mac, mac_b, alice) = (w.mac_a, w.mac_b, w.alice.to_hex());
        run(&mut w, mac, json!({ "op": "profile", "vault": alice, "name": "Alice" }));
        for what in [json!({ "tag": TAG }), json!({ "type": ["profile"] })] {
            run(&mut w, mac, json!({ "op": "share", "over": alice, "who": "everyone", "level": "Public", "what": what }));
        }
        run(&mut w, mac_b, json!({ "op": "follow", "vault": alice, "on": true }));
        w
    }

    /// Every page the engine gives on device `me`, `n` posts each, following the cursor from the newest.
    fn pages_of_engine(lab: &mut Lab, me: SignerId, n: usize) -> Vec<Value> {
        let mut out = vec![];
        let mut after = Value::Null;
        loop {
            let got = engine::run(lab, me, &json!({ "op": "posts", "limit": n, "after": after }));
            out.push(got.clone());
            let posts = got["ok"]["posts"].as_array().cloned().unwrap_or_default();
            if got["ok"]["more"] != json!(true) || posts.is_empty() {
                return out;
            }
            after = posts.last().unwrap()["entry"].clone();
        }
    }

    /// `PostsPage.lean` over the shared index: with saves now and then, so a tail of edits after the index's stamp is
    /// mostly there, every page off the index and its tail is the engine's, cursor after cursor, for posts published,
    /// posts of the owners alone among them, edits and posts taken off (untagged).
    #[tokio::test]
    async fn a_page_off_the_index_and_its_tail_is_the_engines() {
        let mut w = followed();
        let (mac, mac_b, alice) = (w.mac_a, w.mac_b, w.alice);
        let ix = SharedIndex::open(Memory::new().shelf()).await.unwrap();
        let mut seed = 0x2545_f491_4f6c_dd1du64;
        let mut next = |n: u64| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed % n
        };
        let mut made: Vec<EntryId> = vec![];
        let (mut answered, mut with_tail) = (0, 0);
        for step in 0..50u64 {
            match next(6) {
                0..=2 => made.push(post(&mut w, &format!("Post {step}"), next(4) != 0)),
                3 if !made.is_empty() => {
                    let e = made[next(made.len() as u64) as usize];
                    w.lab.edit(mac, alice, e, |item| item.set_text(2, &format!("edit {step}"))).ok();
                }
                4 if !made.is_empty() => {
                    let e = made[next(made.len() as u64) as usize];
                    let (add, remove): (&[&str], &[&str]) = if next(2) == 0 { (&[TAG], &[]) } else { (&[], &[TAG]) };
                    w.lab.tag(mac, alice, e, add, remove).unwrap();
                }
                _ => {}
            }
            w.lab.sync_all(0);
            let lab = Mutex::new(std::mem::replace(&mut w.lab, Lab::new()));
            if next(3) == 0 {
                let held = lab.lock().unwrap().log(mac_b).ids().len();
                ix.step(&lab, mac_b, held).await.unwrap();
            }
            for n in [1usize, 3, 7] {
                let want = pages_of_engine(&mut lab.lock().unwrap(), mac_b, n);
                let mut after: Option<EntryId> = None;
                for (i, page_want) in want.iter().enumerate() {
                    let Some(got) = page(&ix, &lab, mac_b, n, after).await.unwrap() else { break };
                    answered += 1;
                    let tail = lab.lock().unwrap().log(mac_b).ids().len() as u64 > ix.stamp().await.at;
                    with_tail += usize::from(tail);
                    assert_eq!(&got, page_want, "step {step}, page {i} of {n}");
                    after = got["ok"]["posts"].as_array().and_then(|p| p.last()).and_then(|p| p["entry"].as_str()).and_then(EntryId::from_hex);
                }
            }
            w.lab = lab.into_inner().unwrap();
        }
        let posts = engine::run(&mut w.lab, mac_b, &json!({ "op": "posts" }));
        assert!(posts["ok"]["posts"].as_array().unwrap().iter().all(|p| p["name"] == "Alice"), "named by her profile");
        eprintln!("pages answered off the index: {answered}, {with_tail} with a tail");
        assert!(answered > 200, "the index answered most pages: {answered}");
        assert!(with_tail > 50, "and many with a tail after its stamp: {with_tail}");
    }
}

#[cfg(test)]
#[path = "posts_page_bench.rs"]
mod bench;

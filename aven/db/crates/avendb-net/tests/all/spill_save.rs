//! What a fresh page's save lane costs as its spilled store grows (Goal 8, 2026-10-29: a fresh browser's worker answered
//! nothing for ~4 min twice in fresh8 with 285 to 350 MB spilled, while every timed Lab call added up to ~10 s, and a
//! native catch-up of the same vault, unspilled, had no op over 760 ms). A device whose edits spill as a page's do, into
//! one space with a page's 48 MiB at hand (`Spill::in_space`, as `avendb-browser` spills into OPFS), takes a vault's
//! edits a sync page at a time; after each page, its saver puts it on its shelf in a folder. A `SPILL_SAVE {...}` line
//! per page: the store's spilled MB, how long the page took to take, and each Lab call and save step's hold since the
//! last page. What grows with the store, not with the page, is what held the worker.
//!
//!   SPILL_SAVE_EDITS=45000 cargo test -p avendb-net --features test-fixtures --test all spill_save:: -- --ignored --nocapture

use crate::common;

use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;
use std::time::Instant;

use avendb::cast::{document, paragraph};
use avendb::id::{EntryId, VaultId};
use avendb::lab::{Lab, Spill};
use avendb::pages::{MemorySpace, Space};
use std::sync::atomic::{AtomicU64, Ordering};
use avendb::policy::{Action, Kind, Principal, Sharing};
use avendb_net::{Node, Options, disk};
use avendb_testkit::until;
use common::Folder;
use serde_json::{Value, json};

fn env(name: &str, default: usize) -> usize {
    std::env::var(name).ok().and_then(|n| n.parse().ok()).unwrap_or(default)
}

/// Each call's hold since `before`, of the turn book `now` (`Node::served`'s `lab`), in ms: those that held at all.
fn since(before: &Value, now: &Value) -> BTreeMap<String, (u64, u64, u64)> {
    let field = |v: &Value, k: &str, f: &str| v["by"][k][f].as_u64().unwrap_or(0);
    let mut out = BTreeMap::new();
    for (k, v) in now["by"].as_object().into_iter().flatten() {
        let (count, hold) = (v["count"].as_u64().unwrap_or(0), v["hold_ms"].as_u64().unwrap_or(0));
        let (count, hold) = (count - field(before, k, "count"), hold - field(before, k, "hold_ms"));
        if count > 0 && hold > 0 {
            out.insert(k.clone(), (count, hold, v["max_hold_ms"].as_u64().unwrap_or(0)));
        }
    }
    out
}

/// A page's OPFS spill, in memory, counting what it is asked: its reads and their bytes, and its appends. A read of
/// OPFS costs a page's worker far more than a read of memory does a native test, so what a page asks of it per sync
/// page is what to weigh.
#[derive(Debug, Default)]
struct Counted {
    space: MemorySpace,
    reads: AtomicU64,
    read_bytes: AtomicU64,
    appends: AtomicU64,
}

impl Space for Counted {
    fn append(&self, bytes: &[u8]) -> std::io::Result<u64> {
        self.appends.fetch_add(1, Ordering::Relaxed);
        self.space.append(bytes)
    }
    fn read_at(&self, at: u64, bytes: &mut [u8]) -> std::io::Result<()> {
        self.reads.fetch_add(1, Ordering::Relaxed);
        self.read_bytes.fetch_add(bytes.len() as u64, Ordering::Relaxed);
        self.space.read_at(at, bytes)
    }
    fn len(&self) -> u64 {
        self.space.len()
    }
}

impl Counted {
    fn taken(&self) -> (u64, u64, u64) {
        let t = |a: &AtomicU64| a.swap(0, Ordering::Relaxed);
        (t(&self.reads), t(&self.read_bytes), t(&self.appends))
    }
}

#[test]
#[ignore]
fn measure_a_spilled_page_saves() {
    let (edits, text, entries) = (env("SPILL_SAVE_EDITS", 6000), env("SPILL_SAVE_TEXT", 6000), env("SPILL_SAVE_ENTRIES", 256));
    let page = env("SPILL_SAVE_PAGE", 2048);
    let began = Instant::now();
    // Alice's vault, her Mac, and a fresh browser of hers that holds its genesis and shares alone
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let fresh = lab.device_of(passkey, "Alice's fresh browser");
    let genesis = Action::Genesis { kind: Kind::Human, owners: vec![Principal::Signer(passkey)], threshold: 1, root: Some(passkey), nonce: 0, seal_to: vec![] };
    let alice = VaultId::from(lab.submit(mac, &[passkey], genesis).expect("a vault"));
    for d in [mac, fresh] {
        lab.submit(mac, &[passkey, d], Action::Share(Sharing::Device { vault: alice, device: d, seal_to: None })).expect("a device added");
    }
    lab.sync(mac, fresh);
    let mut browser = lab.split(fresh, &[passkey], [1; 32]);
    // the Mac's bulk: documents of fat paragraphs
    let filler: String = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".chars().cycle().take(text).collect();
    let docs: Vec<EntryId> = (0..entries)
        .map(|e| lab.create(mac, alice, alice, "doc", &[], document(&format!("Doc {e}"), "Written by Alice's Mac.", mac)).expect("a document"))
        .collect();
    for k in 0..edits.saturating_sub(entries) {
        let entry = docs[k % entries];
        let body = format!("{k} {filler}");
        lab.edit(mac, alice, entry, |item| item.push_block(paragraph(100 + k as u64, &body))).expect("an edit");
    }
    let held: HashSet<_> = browser.log(fresh).ids().iter().copied().collect();
    let bulk: Vec<_> = lab.log(mac).ids().iter().filter(|id| !held.contains(id)).map(|id| lab.signed_edit(mac, *id).expect("an edit it holds")).collect();
    let blobs: Vec<Arc<[u8]>> = lab.blob_ids(mac).into_iter().filter_map(|b| lab.blob(mac, b)).collect();
    let wire: usize = bulk.iter().map(|s| avendb::wire::Wire::to_wire(s).len()).sum();
    eprintln!("SPILL_SAVE fixture: {} edits, {:.1} MB on the wire, in {:.1?}", bulk.len(), wire as f64 / 1e6, began.elapsed());

    let space = Arc::new(Counted::default());
    let spill = Spill::in_space(space.clone(), 48 << 20);
    browser.spill(fresh, &spill).expect("spilled");
    let dir = Folder::new("spill-save");
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(4).enable_all().build().expect("a runtime");
    rt.block_on(async {
        let opts = Options { shelf: Some(disk::open(dir.path()).expect("the shelf")), ..Options::local() };
        let node = Node::spawn(browser, fresh, opts).await.expect("a node");
        let mut book = node.served()["lab"].clone();
        let mut first = Some(blobs);
        for (n, chunk) in bulk.chunks(page).enumerate() {
            let (chunk, keys) = (chunk.to_vec(), first.take().unwrap_or_default());
            let at = Instant::now();
            let took = node.act(move |lab, me| lab.receive(me, chunk, keys)).await;
            let take_ms = at.elapsed().as_millis();
            let taking = space.taken();
            let at = Instant::now();
            until("the shelf holds it", || async { !node.behind().await }).await;
            until("what it worked out, put", || async { !node.read(|lab, me| lab.warm_due(me)).await }).await;
            let save_ms = at.elapsed().as_millis();
            let saving = space.taken();
            let (spilled, memory) = node.read(|lab, me| {
                let perf = lab.perf(me);
                (perf["held"]["memory"]["spilled"].as_u64().unwrap_or(0), perf["held"]["memory"].clone())
            }).await;
            let now = node.served()["lab"].clone();
            let calls: serde_json::Map<String, Value> =
                since(&book, &now).into_iter().map(|(k, (c, h, m))| (k, json!([c, h, m]))).collect();
            book = now;
            println!("SPILL_SAVE {}", json!({
                "page": n, "took": took, "spilled_mb": spilled / 1_000_000, "take_ms": take_ms, "save_ms": save_ms,
                "memory": memory, "calls_count_hold_max_ms": calls,
                "spill_take_reads_mb_appends": [taking.0, taking.1 / 1_000_000, taking.2],
                "spill_save_reads_mb_appends": [saving.0, saving.1 / 1_000_000, saving.2],
            }));
        }
        node.shutdown().await.expect("it stops");
    });
}

/// `measure_a_spilled_page_saves`' device, catching up over a sync from Alice's Mac as a page does, not given its
/// edits: every sync step its node takes (its asks, the index it is told, its catch-up steps, its replies) on a spilled
/// store. A `SPILL_SYNC {...}` line every `SPILL_SYNC_EVERY_S` (5): how many edits it holds, its spilled MB, its spill's
/// reads since the last line, and each call's hold since then. Each fat edit is a document of its own, so the Mac's
/// writes cost what one edit does.
///
///   SPILL_SYNC_EDITS=8000 cargo test -p avendb-net --features test-fixtures --test all spill_save::measure_a_spilled_page_catches_up -- --ignored --nocapture
#[test]
#[ignore]
fn measure_a_spilled_page_catches_up() {
    let (edits, text) = (env("SPILL_SYNC_EDITS", 4000), env("SPILL_SYNC_TEXT", 20000));
    let every = std::time::Duration::from_secs(env("SPILL_SYNC_EVERY_S", 5) as u64);
    let began = Instant::now();
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let fresh = lab.device_of(passkey, "Alice's fresh browser");
    let genesis = Action::Genesis { kind: Kind::Human, owners: vec![Principal::Signer(passkey)], threshold: 1, root: Some(passkey), nonce: 0, seal_to: vec![] };
    let alice = VaultId::from(lab.submit(mac, &[passkey], genesis).expect("a vault"));
    for d in [mac, fresh] {
        lab.submit(mac, &[passkey, d], Action::Share(Sharing::Device { vault: alice, device: d, seal_to: None })).expect("a device added");
    }
    lab.sync(mac, fresh);
    let mut browser = lab.split(fresh, &[], [1; 32]);
    for k in 0..edits {
        // letters at random, so that no layer squeezes them
        let body: String = (0..text).map(|i| (b'a' + ((k * 7919 + i * 104_729) % 9973 % 26) as u8) as char).collect();
        lab.create(mac, alice, alice, "doc", &[], document(&format!("Doc {k}"), &body, mac)).expect("a document");
    }
    let total = lab.log(mac).ids().len();
    eprintln!("SPILL_SYNC fixture: {total} edits on the Mac in {:.1?}", began.elapsed());
    let space = Arc::new(Counted::default());
    browser.spill(fresh, &Spill::in_space(space.clone(), 48 << 20)).expect("spilled");
    let dir = Folder::new("spill-sync");
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(4).enable_all().build().expect("a runtime");
    rt.block_on(async {
        let mac = Arc::new(Node::spawn(lab.split(mac, &[passkey], [2; 32]), mac, Options::local()).await.expect("the Mac"));
        let opts = Options { shelf: Some(disk::open(dir.path()).expect("the shelf")), ..Options::local() };
        let page = Arc::new(Node::spawn(browser, fresh, opts).await.expect("the page"));
        mac.know(page.addr());
        page.know(mac.addr());
        let asking = {
            let (page, mac) = (page.clone(), mac.id());
            tokio::spawn(async move {
                loop {
                    page.sync_with(mac).await.ok();
                }
            })
        };
        let at = Instant::now();
        let mut book = page.served()["lab"].clone();
        loop {
            tokio::time::sleep(every).await;
            let (held, spilled) = page.read(|lab, me| {
                (lab.log(me).ids().len(), lab.perf(me)["held"]["memory"]["spilled"].as_u64().unwrap_or(0))
            }).await;
            let now = page.served()["lab"].clone();
            let mut calls: Vec<_> = since(&book, &now).into_iter().collect();
            calls.sort_by_key(|(_, (_, hold, _))| std::cmp::Reverse(*hold));
            let calls: serde_json::Map<String, Value> = calls.into_iter().take(8).map(|(k, (c, h, m))| (k, json!([c, h, m]))).collect();
            book = now;
            let (reads, read_bytes, appends) = space.taken();
            println!("SPILL_SYNC {}", json!({
                "s": at.elapsed().as_secs(), "held": held, "of": total, "spilled_mb": spilled / 1_000_000,
                "spill_reads_mb_appends": [reads, read_bytes / 1_000_000, appends], "calls_count_hold_max_ms": calls,
            }));
            if held >= total || at.elapsed().as_secs() > 1800 {
                break;
            }
        }
        asking.abort();
        until("the shelf holds it", || async { !page.behind().await }).await;
        page.shutdown().await.expect("it stops");
        mac.shutdown().await.expect("it stops");
    });
}

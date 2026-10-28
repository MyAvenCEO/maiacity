//! Simulation (P7, `avendb_net::sim`): the real nodes on a simulated network that loses, duplicates, delays and
//! reorders packets and cuts links at each seed's own moments, and every scenario must still end where a calm one
//! does. Each runs `AVENDB_SIM_SEEDS` seeds (a few by default, a thousand in a soak run); `AVENDB_SIM_SEED=n` replays
//! one. A scenario that waits forever fails as one that errs, with its seed and the network's last events.
//!
//! The scenarios are the seams #1277's red tests sat on: a person's first device founding their vault through the
//! server alone, a lazy device (a cloud agent's) that reaches nothing but the server, and a group Chat whose
//! participant writes while the owner's devices are cut off from each other.
#![cfg(debug_assertions)]

use std::collections::BTreeSet;
use std::future::Future;
use std::time::Duration;

use anyhow::{Context as _, Result, ensure};
use avendb::cast::*;
use avendb::id::{EntryId, SignerId};
use avendb::lab::Lab;
use avendb::policy::Level;
use avendb::slice::Selector;
use avendb::sync::LogId;
use avendb_net::bucket::{self, Sealed};
use avendb_net::sim::{Net, Rng, ShelfFaults, faulty, replay, seeds};
use avendb_net::{Node, Options};

/// Each scenario's seeds by default: enough for CI to see a fault of each kind, few enough for its time.
const SEEDS: u64 = 4;
/// The most one seed's run takes, faults and all, before it counts as a hang.
const LIMIT: Duration = Duration::from_secs(150);
/// How long a scenario waits for what it expects once the storm is over.
const SETTLE: Duration = Duration::from_secs(60);

async fn node(w: &mut World, net: &Net, d: SignerId, with: &[SignerId], seed: u8, opts: Options) -> Result<Node> {
    let node = Node::spawn(w.lab.split(d, with, [seed; 32]), d, opts).await?;
    net.name(node.id(), &format!("{}", d.to_hex().get(..6).unwrap_or("device")));
    Ok(node)
}

/// Waits until `check` holds, `SETTLE` at most, never by a fixed sleep longer than a tick.
async fn until<F: Future<Output = bool>>(what: &str, check: impl FnMut() -> F) -> Result<()> {
    within(SETTLE, what, check).await
}

/// `until`, with a bound of its own: a step a regression test holds to a time.
async fn within<F: Future<Output = bool>>(bound: Duration, what: &str, mut check: impl FnMut() -> F) -> Result<()> {
    let began = tokio::time::Instant::now();
    let end = began + bound;
    while !check().await {
        ensure!(tokio::time::Instant::now() < end, "{what}, within {bound:?}");
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    // a slow step is named, for a soak's tail to be read
    if began.elapsed() > Duration::from_secs(10) {
        eprintln!("SIM slow: {what} took {:?}", began.elapsed());
    }
    Ok(())
}

async fn holds(n: &Node, e: EntryId) -> bool {
    n.read(move |lab: &Lab, me| lab.item(me, e).is_some()).await
}

/// Whether the node keeps entry `e`'s log, readable to it or sealed, as a server keeps what it relays.
async fn keeps(n: &Node, e: EntryId) -> bool {
    n.holdings().await.logs.contains_key(&LogId::Entry(e))
}

async fn stop(nodes: Vec<Node>) -> Result<()> {
    for n in nodes {
        n.shutdown().await?;
    }
    Ok(())
}

/// Alice's Mac and iPhone write while the link between them is cut and healed and packets are lost: once the storm
/// is over, each holds every entry either wrote.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn two_devices_converge_after_a_storm() {
    seeds("two devices", SEEDS, LIMIT, |net| async move {
        let mut w = world();
        let coop = handbook_ready(&mut w);
        let (mac_a, phone_a) = (w.mac_a, w.phone_a);
        let mac = node(&mut w, &net, mac_a, &[], 1, Options::simulated(&net)).await?;
        let phone = node(&mut w, &net, phone_a, &[], 2, Options::simulated(&net)).await?;
        mac.know(phone.addr());
        phone.know(mac.addr());
        let storm = tokio::spawn({
            let (net, ids) = (net.clone(), [mac.id(), phone.id()]);
            async move { net.storm(&ids, Duration::from_secs(3)).await }
        });
        let mut written = Vec::new();
        for i in 0..6 {
            let (by, who) = if i % 2 == 0 { (&mac, "Mac") } else { (&phone, "iPhone") };
            let title = format!("{who} note {i}");
            let made = by.act(move |lab, me| lab.create(me, coop, coop, "doc", &[], document(&title, "b", me))).await;
            written.push(made.map_err(|e| anyhow::anyhow!("{who}'s note: {e:?}"))?);
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
        storm.await?;
        for e in written.clone() {
            until("the iPhone holds every entry", || holds(&phone, e)).await?;
            until("the Mac holds every entry", || holds(&mac, e)).await?;
        }
        ensure!(net.counts().sent > 0, "packets went through the simulated network");
        stop(vec![mac, phone]).await
    })
    .await;
}

/// Eve's first device, a browser that reaches the server alone, founds her vault, takes the server's card and gives
/// it relay on all of it: the server ends up keeping her vault and the share, whatever the network lost on the way
/// (the net part of the relay test that hung on #1277; the relay's admission itself is not simulated).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_first_device_founds_its_vault_through_the_server_alone() {
    seeds("first device", SEEDS, LIMIT, |net| async move {
        let mut w = world();
        let eve_key = w.lab.passkey("Eve");
        let eves = w.lab.device_of(eve_key, "Eve's browser");
        let (server_d, avenceo) = (w.server, w.avenceo);
        let server = node(&mut w, &net, server_d, &[], 2, Options { card: true, ..Options::simulated(&net) }).await?;
        let browser = node(&mut w, &net, eves, &[eve_key], 8, Options::simulated(&net)).await?;
        net.only(browser.id(), &[server.id()]);
        browser.know(server.addr());
        let eve = browser.act(move |lab, me| human_on(lab, eve_key, &[me])).await;
        let card = move |lab: &Lab, me| lab.state(me).vault(avenceo).is_some();
        until("the browser takes the server's card", || async {
            let _ = browser.contact(server.id()).await;
            browser.read(card).await
        })
        .await?;
        let relay_on = move |lab: &mut Lab, me| lab.issue(me, &[me], share(eve, vault(avenceo), Level::Backup, Selector::All));
        let relayed = browser.act(relay_on).await.map_err(|e| anyhow::anyhow!("relay on her vault: {e:?}"))?;
        let keeps = move |lab: &Lab, me| lab.state(me).vault(eve).is_some() && lab.state(me).share(relayed).is_some();
        until("the server keeps her vault's log", || server.read(keeps)).await?;
        stop(vec![server, browser]).await
    })
    .await;
}

/// An agent's device asks for nothing on its own (`Options::lazy`) and reaches the server alone. Alice's Mac writes a
/// note and gives the server relay over her vault; through the server, the agent brings her vault and reads the note,
/// and what the agent writes reaches her Mac: under a storm between the Mac and the server.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_lazy_agent_works_through_the_server_alone() {
    seeds("lazy agent", SEEDS, LIMIT, |net| lazy_agent(net, SETTLE)).await;
}

/// The seeds the 1,000-seed soak found slowest (30-68 s, 2026-10-26): the server's pull of her note's log waited
/// behind another log's six McEliece keys (~6 MB on a link losing ~14%). With keys brought after the last log, the
/// server keeps the note in a few seconds.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_new_humans_keys_hold_no_log_back() {
    replay("lazy agent tail", &[889, 550, 133], LIMIT, |net| lazy_agent(net, Duration::from_secs(20))).await;
}

/// Alice's Mac writes a note while it and the server weather a storm; the server must keep it within `keep`.
async fn lazy_agent(net: Net, keep: Duration) -> Result<()> {
    let mut w = world();
    let (mac_a, phone_a, server_d, alice) = (w.mac_a, w.phone_a, w.server, w.alice);
    relay_on(&mut w, alice);
    w.lab.sync_all(1);
    let mac = node(&mut w, &net, mac_a, &[], 1, Options::simulated(&net)).await?;
    let server = node(&mut w, &net, server_d, &[], 2, Options { card: true, ..Options::simulated(&net) }).await?;
    let agent = node(&mut w, &net, phone_a, &[], 3, Options { lazy: true, ..Options::simulated(&net) }).await?;
    net.only(agent.id(), &[server.id()]);
    mac.know(server.addr());
    server.know(mac.addr());
    agent.know(server.addr());
    let beans = move |lab: &mut Lab, me| lab.create(me, alice, alice, "note", &[], document("Beans", "In May.", me));
    let note = mac.act(beans).await.map_err(|e| anyhow::anyhow!("her note: {e:?}"))?;
    let storm = tokio::spawn({
        let (net, ids) = (net.clone(), [mac.id(), server.id()]);
        async move { net.storm(&ids, Duration::from_secs(3)).await }
    });
    within(keep, "the server keeps her note, sealed", || keeps(&server, note)).await?;
    let vaults = BTreeSet::from([alice]);
    until("the agent brings her vault through the server", || {
        let (agent, server, vaults) = (&agent, server.id(), vaults.clone());
        async move { agent.bring(server, vaults).await.is_ok() && holds(agent, note).await }
    })
    .await?;
    let shade = move |lab: &mut Lab, me| lab.create(me, alice, alice, "note", &[], document("Shade", "East beds.", me));
    let draft = agent.act(shade).await.map_err(|e| anyhow::anyhow!("the agent's note: {e:?}"))?;
    storm.await?;
    until("the agent's note reaches the Mac through the server", || holds(&mac, draft)).await?;
    stop(vec![agent, mac, server]).await
}

/// Whether the node reads message `id` in room `room`.
async fn reads_message(n: &Node, room: EntryId, id: u64) -> bool {
    n.read(move |lab: &Lab, me| {
        lab.item(me, room).is_some_and(|i| i.record()["messages"].as_array().is_some_and(|ms| ms.iter().any(|m| m["id"] == id)))
    })
    .await
}

/// A group Chat: Alice's vault owns the room, Bob writes in it through a cap group whose history matters (the root
/// group once included the writer group, then took its caps itself). While Alice's Mac, her iPhone and Bob's Mac are
/// cut apart and packets are lost, Bob writes and her iPhone writes; after the storm, every device reads every
/// message, the iPhone through the Mac (the seam `grouped_participant_chat_preserves_historical_includes_before_
/// unrelated_history` failed on, under #1277).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_group_chat_converges_after_a_storm() {
    use avendb::cast::by_id;
    use avendb::lab::GroupShare;
    use avendb::policy::Who;
    use avendb::rules::{Cap, CapGroup, member};
    seeds("group chat", SEEDS, LIMIT, |net| async move {
        let mut w = world();
        let (mac_a, phone_a, mac_b, alice, bob) = (w.mac_a, w.phone_a, w.mac_b, w.alice, w.bob);
        let run = |lab: &mut Lab, d, op: serde_json::Value| {
            let out = avendb::engine::run(lab, d, &op);
            out.get("ok").cloned().ok_or_else(|| anyhow::anyhow!("{op}: {out}"))
        };
        let created = run(&mut w.lab, mac_a, serde_json::json!({ "op": "create", "vault": alice.to_hex(),
            "as": alice.to_hex(), "type": "room", "tags": [],
            "value": { "kind": "room", "name": "Shared Chat", "look": "group", "topic": "" } }))?;
        let room = EntryId::from_hex(created["entry"].as_str().unwrap_or_default()).ok_or_else(|| anyhow::anyhow!("the room: {created}"))?;
        let say = move |vault: avendb::id::VaultId, id: u64, text: &str| serde_json::json!({ "op": "insert",
            "entry": room.to_hex(), "as": vault.to_hex(), "path": ["messages"],
            "value": { "id": id, "text": text, "at": id, "mentions": [] } });
        run(&mut w.lab, mac_a, say(alice, 1, "owner first"))?;
        let caps = || member().into_iter().map(|op| Cap { op, slice: by_id(room) }).collect::<Vec<_>>();
        let writer = CapGroup { name: "Historical writer".into(), caps: caps(), includes: vec![] };
        let child = w.lab.define_group(mac_a, alice, writer).map_err(|e| anyhow::anyhow!("{e:?}"))?;
        let root = CapGroup { name: "Participants".into(), caps: vec![], includes: vec![child] };
        let root = w.lab.define_group(mac_a, alice, root).map_err(|e| anyhow::anyhow!("{e:?}"))?;
        let grant = GroupShare { over: alice, who: Who::Vault(bob), name: "Participants".into(), select: by_id(room),
            group: root, level: Level::Write, parent: None, issuer: alice };
        w.lab.issue_group(mac_a, &[mac_a], grant).map_err(|e| anyhow::anyhow!("{e:?}"))?;
        w.lab.sync_all(0);
        run(&mut w.lab, mac_b, say(bob, 2, "participant second"))?;
        w.lab.sync(mac_b, mac_a);
        let again = CapGroup { name: "Participants".into(), caps: caps(), includes: vec![] };
        w.lab.redefine_group(mac_a, alice, root, again).map_err(|e| anyhow::anyhow!("{e:?}"))?;
        w.lab.sync(mac_a, mac_b);
        let mac = node(&mut w, &net, mac_a, &[], 1, Options::simulated(&net)).await?;
        let phone = node(&mut w, &net, phone_a, &[], 2, Options::simulated(&net)).await?;
        let bobs = node(&mut w, &net, mac_b, &[], 3, Options::simulated(&net)).await?;
        // her iPhone reaches her Mac alone; Bob's Mac reaches hers
        net.only(phone.id(), &[mac.id()]);
        for (a, b) in [(&phone, &mac), (&bobs, &mac)] {
            a.know(b.addr());
            b.know(a.addr());
        }
        let storm = tokio::spawn({
            let (net, ids) = (net.clone(), [mac.id(), phone.id(), bobs.id()]);
            async move { net.storm(&ids, Duration::from_secs(3)).await }
        });
        let said = bobs.op(say(bob, 3, "participant live")).await?;
        ensure!(said.get("ok").is_some(), "Bob's live message: {said}");
        let said = phone.op(say(alice, 4, "owner live from the iPhone")).await?;
        ensure!(said.get("ok").is_some(), "her iPhone's message: {said}");
        storm.await?;
        for (n, who) in [(&mac, "her Mac"), (&phone, "her iPhone"), (&bobs, "Bob's Mac")] {
            for id in 1..=4 {
                until(&format!("{who} reads message {id}"), || reads_message(n, room, id)).await?;
            }
        }
        stop(vec![bobs, phone, mac]).await
    })
    .await;
}

/// How many lives a node lives on its failing shelf in one seed's run.
const LIVES: u64 = 5;

/// Fleet cycles (storage series item 1, after the harness behind Fly's block device): a node on a bucket, as the
/// server is, whose shelf fails calls, loses their answers and tears slots as its seed says, and is killed at the
/// seed's moment while it writes, then started again from its bucket, its folder lost now and then. Each life it
/// opens, and holds every entry its shelf held before it was killed: a failed call is tried again, nothing names
/// bytes the bucket lacks, and a torn or lost write leaves nothing it can't start from.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_node_killed_on_a_failing_shelf_starts_again_whole() {
    seeds("shelf lives", SEEDS, LIMIT, |net| async move {
        let seed = net.seed();
        let mut rng = Rng::new(seed);
        let dir = std::env::temp_dir().join(format!("avendb-lives-{}-{seed}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        let sealed = Sealed::new(bucket::Folder::new(dir.join("objects")), &[7; 32]);
        let folder = dir.join("folder");
        let (mut held, mut faults): (Vec<EntryId>, u64) = (Vec::new(), 0);
        for life in 0..LIVES {
            if life > 0 && rng.chance(250) {
                std::fs::remove_dir_all(&folder).ok();
            }
            let mut w = world();
            let coop = handbook_ready(&mut w);
            let (mac_a, passkey_a) = (w.mac_a, w.passkey_a);
            let inner = bucket::shelf(sealed.clone(), &folder, 64 << 20).await?;
            let (shelf, switch) = faulty(inner, seed * 1000 + life);
            // entropy of its own each life, as a device's: new entries' ids draw on it
            let lab = w.lab.split(mac_a, &[passkey_a], [life as u8 + 1; 32]);
            let opts = Options { shelf: Some(shelf), ..Options::local() };
            let mac = Node::spawn(lab, mac_a, opts).await.with_context(|| format!("life {life}: it opens"))?;
            for &e in &held {
                ensure!(holds(&mac, e).await, "life {life}: an entry its shelf held before is back");
            }
            let write = |n: u64| {
                let title = format!("life {life} note {n}");
                move |lab: &mut Lab, me| lab.create(me, coop, coop, "doc", &[], document(&title, "b", me))
            };
            // it writes as its shelf fails, then catches up once the shelf is calm again
            switch.set(ShelfFaults::of(seed));
            let mut written = Vec::new();
            for n in 0..6 {
                written.push(mac.act(write(n)).await.map_err(|e| anyhow::anyhow!("life {life}: note {n}: {e:?}"))?);
                tokio::time::sleep(Duration::from_millis(rng.below(50))).await;
            }
            switch.set(ShelfFaults::CALM);
            until("its shelf holds all it wrote", || async { !mac.behind().await })
                .await
                .with_context(|| format!("life {life}, {} faults", switch.faults()))?;
            held.extend(written);
            // and writes more as its shelf fails, until it is killed
            switch.set(ShelfFaults::of(seed));
            for n in 6..6 + rng.below(4) {
                mac.act(write(n)).await.ok();
            }
            tokio::time::sleep(Duration::from_millis(rng.below(200))).await;
            faults += switch.faults();
            switch.kill();
            tokio::time::timeout(Duration::from_secs(20), mac.shutdown()).await.ok();
            drop(mac);
        }
        std::fs::remove_dir_all(dir).ok();
        ensure!(faults > 0 || ShelfFaults::of(seed) == ShelfFaults::CALM, "its shelf failed it at least once");
        eprintln!("SIM shelf lives seed {seed}: {} entries held through {LIVES} lives, {faults} faults", held.len());
        Ok(())
    })
    .await;
}

/// A fresh iPad of Alice's asks for its first sync with the boxes held back (`Lab::set_lazy_boxes`, `session::STUBS`,
/// `spec/AvenDB/LazyBoxes.lean`): its first pull takes stubs of the boxes it needs not now and every edit but those,
/// and it reads the handbook; the pull after fetches their bodies, each checked against its stub, and it ends holding
/// exactly what a device that synced whole holds, every stub gone and none caught lying. Under a storm.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_fresh_device_syncs_its_boxes_later_and_converges() {
    seeds("box stubs", SEEDS, LIMIT, |net| async move {
        let mut w = world();
        let h = handbook(&mut w);
        let add = |w: &mut World, name: &str| {
            let ipad = w.lab.device_of(w.passkey_a, name);
            let share = avendb::policy::Action::Share(avendb::policy::Sharing::Device { vault: w.alice, device: ipad, seal_to: None });
            w.lab.submit(w.mac_a, &[w.passkey_a, ipad], share).expect("Alice adds an iPad");
            w.lab.set_online(ipad, false);
            ipad
        };
        let (lazy, whole) = (add(&mut w, "Alice's iPad"), add(&mut w, "Alice's other iPad"));
        w.lab.sync_all(7);
        w.lab.set_online(whole, true);
        w.lab.sync(w.mac_a, whole);
        let all: BTreeSet<_> = w.lab.log(whole).ids().iter().copied().collect();
        w.lab.set_online(lazy, true);
        w.lab.set_lazy_boxes(lazy, true);
        let (mac_a, welcome) = (w.mac_a, h.welcome);
        let mac = node(&mut w, &net, mac_a, &[], 1, Options::simulated(&net)).await?;
        let ipad = node(&mut w, &net, lazy, &[], 2, Options::simulated(&net)).await?;
        ipad.know(mac.addr());
        let storm = tokio::spawn({
            let (net, ids) = (net.clone(), [mac.id(), ipad.id()]);
            async move { net.storm(&ids, Duration::from_secs(2)).await }
        });
        until("the iPad reads Welcome", || async {
            let _ = ipad.sync_with(mac.id()).await;
            ipad.read(move |lab: &Lab, me| lab.reads(me, welcome)).await
        })
        .await?;
        storm.await?;
        let converged = {
            let all = all.clone();
            move |lab: &Lab, me| {
                let held: BTreeSet<_> = lab.log(me).ids().iter().copied().collect();
                held == all && lab.stubs(me).is_empty()
            }
        };
        until("the iPad fetches its boxes and holds what a whole sync holds", || async {
            let _ = ipad.sync_with(mac.id()).await;
            ipad.read(converged.clone()).await
        })
        .await?;
        let (taken, liars) = ipad.read(|lab: &Lab, me| (lab.stubs_taken(me), lab.stub_liars(me))).await;
        ensure!(taken > 0, "the first sync held boxes back");
        ensure!(liars.is_empty(), "an honest peer's stubs: {liars:?}");
        stop(vec![mac, ipad]).await
    })
    .await;
}

/// Alice's iPhone, a browser that reaches only the server and, through a slow relay, her Mac, has been offline while
/// her Mac wrote notes and while it wrote one of its own. It meets the Mac first, whose asking crawls at 20 KB/s, then
/// the server, which holds every note too: it must take what it lacks from whichever peer brings it, not wait out the
/// slow one past the handover, and its own note must reach the server and the Mac (S1, 2026-10-28: Samuel's iPhone advertised-to by the
/// always-on peer and his Mac held 240-350 of 3,025 logs and never grew, its own writes never left it).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_browser_takes_what_it_lacks_from_the_fast_peer_and_pushes_its_writes() {
    seeds("browser beside a slow peer", SEEDS, LIMIT, |net| async move {
        let mut w = world();
        let (mac_a, phone_a, server_d, alice) = (w.mac_a, w.phone_a, w.server, w.alice);
        relay_on(&mut w, alice);
        w.lab.sync_all(1);
        w.lab.set_online(phone_a, false);
        let body = "a garden bed's notes, long enough to weigh on a slow link. ".repeat(300);
        let mut notes = Vec::new();
        for i in 0..40 {
            let note = w.lab.create(mac_a, alice, alice, "note", &[], document(&format!("Bed {i}"), &body, mac_a));
            notes.push(note.map_err(|e| anyhow::anyhow!("the Mac's note {i}: {e:?}"))?);
        }
        let mine = w.lab.create(phone_a, alice, alice, "note", &[], document("From the iPhone", "Shade.", phone_a));
        let mine = mine.map_err(|e| anyhow::anyhow!("the iPhone's note: {e:?}"))?;
        w.lab.sync_all(2);
        w.lab.set_online(phone_a, true);
        let mac = node(&mut w, &net, mac_a, &[], 1, Options::simulated(&net)).await?;
        let server = node(&mut w, &net, server_d, &[], 2, Options { card: true, ..Options::simulated(&net) }).await?;
        let phone = node(&mut w, &net, phone_a, &[], 3, Options::simulated(&net)).await?;
        net.only(phone.id(), &[mac.id(), server.id()]);
        net.rate(phone.id(), mac.id(), 20_000);
        mac.know(server.addr());
        server.know(mac.addr());
        phone.know(mac.addr());
        // the slow peer's asking under way first, as the Mac's was over the relay
        let told = || async { phone.live_peers().await.get(&mac_a).is_some_and(|lacks| lacks.is_some_and(|n| n > 0)) };
        within(Duration::from_secs(20), "the Mac tells the iPhone what it holds", told).await?;
        tokio::time::sleep(Duration::from_secs(1)).await;
        phone.know(server.addr());
        for &note in &notes {
            within(Duration::from_secs(30), "the iPhone holds every note, from the server", || holds(&phone, note)).await?;
        }
        within(Duration::from_secs(20), "the server keeps the iPhone's note", || keeps(&server, mine)).await?;
        within(Duration::from_secs(20), "the Mac holds the iPhone's note", || holds(&mac, mine)).await?;
        stop(vec![phone, mac, server]).await
    })
    .await;
}

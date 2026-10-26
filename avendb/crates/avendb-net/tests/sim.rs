//! Simulation (P7, `avendb_net::sim`): the real nodes on a simulated network that loses, duplicates, delays and
//! reorders packets and cuts links at each seed's own moments, and every scenario must still end where a calm one
//! does. Each runs `AVENDB_SIM_SEEDS` seeds (a few by default, a thousand in a soak run); `AVENDB_SIM_SEED=n` replays
//! one. A scenario that waits forever fails as one that errs, with its seed and the network's last events.
//!
//! The scenarios are the seams #1277's red tests sat on: a person's first device founding their vault through the
//! server alone, a lazy device (a cloud agent's) that reaches nothing but the server, and a group Chat whose
//! participant writes while the owner's devices are cut off from each other.

use std::collections::BTreeSet;
use std::future::Future;
use std::time::Duration;

use anyhow::{Result, ensure};
use avendb::cast::*;
use avendb::id::{EntryId, SignerId};
use avendb::lab::Lab;
use avendb::policy::Level;
use avendb::slice::Selector;
use avendb::sync::LogId;
use avendb_net::sim::{Net, seeds};
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
async fn until<F: Future<Output = bool>>(what: &str, mut check: impl FnMut() -> F) -> Result<()> {
    let end = tokio::time::Instant::now() + SETTLE;
    while !check().await {
        ensure!(tokio::time::Instant::now() < end, "{what}, within {SETTLE:?}");
        tokio::time::sleep(Duration::from_millis(25)).await;
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
    seeds("lazy agent", SEEDS, LIMIT, |net| async move {
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
        until("the server keeps her note, sealed", || keeps(&server, note)).await?;
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
    })
    .await;
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

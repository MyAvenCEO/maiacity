//! Opt-in diagnostic policy observations over the existing authenticated peer connection.
//! No data is written. Ordinary sync does all delivery and replay; probes only observe.
use crate::{
    Peer, Shared,
    receipt_tracker::{Outcome, Tracker},
    session,
};
use anyhow::{Context, Result, ensure};
use avendb::id::EditId;
use n0_future::{
    task,
    time::{self, Duration, Instant},
};
use serde_json::{Value, json};
use std::{
    collections::{BTreeSet, VecDeque},
    sync::{Arc, Mutex},
};

pub(crate) const KIND: u8 = 18;
pub(crate) const UI_KIND: u8 = 20;
pub(crate) const REQUEST_LIMIT: usize = 65;
const RESPONSE_LIMIT: usize = 66;
const SESSION: Duration = Duration::from_secs(120);
const DEADLINE: Duration = Duration::from_secs(30);
struct Book {
    tracker: Tracker,
    epoch: Instant,
    until: Option<Instant>,
    unsupported: BTreeSet<usize>,
    emitted: VecDeque<(EditId, Instant)>,
}
pub(crate) struct Receipts {
    book: Mutex<Book>,
    ui: bool,
    active: Arc<tokio::sync::Semaphore>,
    serving: Arc<tokio::sync::Semaphore>,
}
impl Default for Receipts {
    fn default() -> Self {
        Self {
            ui: false,
            book: Mutex::new(Book {
                tracker: Tracker::default(),
                epoch: Instant::now(),
                until: None,
                unsupported: BTreeSet::new(),
                emitted: VecDeque::new(),
            }),
            active: Arc::new(tokio::sync::Semaphore::new(3)),
            serving: Arc::new(tokio::sync::Semaphore::new(1)),
        }
    }
}
impl Receipts {
    pub(crate) fn for_ui() -> Self { Self { ui: true, ..Self::default() } }
    /// Only the local opted-in query consumer registers these verified main heads.
    pub(crate) fn emitted(&self, ids: Vec<EditId>) -> usize {
        let mut b = self.book.lock().expect("receipts");
        let now = Instant::now();
        if !b.until.is_some_and(|until| now < until) { return 0; }
        b.emitted.retain(|(_, at)| now.duration_since(*at) < DEADLINE);
        for id in ids.into_iter().take(64) {
            b.emitted.retain(|(held, _)| *held != id);
            b.emitted.push_back((id, now));
            if b.emitted.len() > 64 { b.emitted.pop_front(); }
        }
        b.emitted.len()
    }
    fn has_emitted(&self, id: EditId) -> bool {
        let b = self.book.lock().expect("receipts");
        let now = Instant::now();
        b.until.is_some_and(|until| now < until) && b.emitted.iter().any(|(held, at)| *held == id && now.duration_since(*at) < DEADLINE)
    }
    pub(crate) fn enabled(&self) -> bool {
        self.book
            .lock()
            .expect("receipts")
            .until
            .is_some_and(|until| Instant::now() < until)
    }
    pub(crate) fn arm(&self) -> Value {
        self.book.lock().expect("receipts").until = Some(Instant::now() + SESSION);
        self.json()
    }
    pub(crate) fn json(&self) -> Value {
        let b = self.book.lock().expect("receipts");
        let samples: Vec<_> = b.tracker.samples().map(|s| json!({"ms": s.elapsed_ms,
            "outcome": match s.outcome { Outcome::Standing => "standing", Outcome::NotStanding => "not-standing" }})).collect();
        json!({"enabled": b.until.is_some_and(|until| Instant::now() < until), "session_ms": SESSION.as_millis() as u64,
            "stage": if self.ui { "local-completion-to-peer-reactive-consumer" } else { "local-completion-to-peer-policy-observation" }, "samples": samples})
    }
}

fn request(body: &[u8]) -> Result<([u8; 32], EditId)> {
    ensure!(
        body.len() == REQUEST_LIMIT && body[0] == 1,
        "invalid receipt request"
    );
    Ok((
        body[1..33].try_into().expect("nonce"),
        EditId(body[33..65].try_into().expect("edit")),
    ))
}
fn receipts(shared: &Shared, ui: bool) -> &Receipts {
    if ui { &shared.ui_receipts } else { &shared.receipts }
}
pub(crate) async fn answer(shared: &Arc<Shared>, peer: &Peer, body: &[u8]) -> Result<Vec<u8>> {
    answer_kind(shared, peer, body, false).await
}
pub(crate) async fn answer_ui(shared: &Arc<Shared>, peer: &Peer, body: &[u8]) -> Result<Vec<u8>> {
    answer_kind(shared, peer, body, true).await
}
async fn answer_kind(shared: &Arc<Shared>, peer: &Peer, body: &[u8], ui: bool) -> Result<Vec<u8>> {
    let (nonce, id) = request(body)?;
    let permit = receipts(shared, ui)
        .serving
        .clone()
        .try_acquire_owned()
        .context("receipt observer busy")?;
    let who = peer.device;
    let held = shared.clone();
    // Permission and policy outcome are captured under the same current Lab lock.
    // No full catch-up is forced by the diagnostic, including during bootstrap.
    Ok(shared
        .read(move |lab, me| {
            let _permit = permit;
            let result = match lab.peer_edit_outcome(me, who, id) {
                None => 0,
                Some(true) if !ui || held.ui_receipts.has_emitted(id) => 1,
                Some(true) => 0,
                Some(false) => if ui { 0 } else { 2 },
            };
            let mut out = vec![1];
            out.extend(nonce);
            out.extend(id.0);
            out.push(result);
            out
        })
        .await)
}
impl Shared {
    pub(crate) fn observe_edit(self: &Arc<Self>, id: EditId, completed: Instant) {
        self.observe_edit_kind(id, completed, false);
        self.observe_edit_kind(id, completed, true);
    }
    fn observe_edit_kind(self: &Arc<Self>, id: EditId, completed: Instant, ui: bool) {
        if !receipts(self, ui).enabled() {
            return;
        }
        let peers: Vec<_> = self
            .peers
            .lock()
            .expect("peers")
            .values()
            .filter(|p| p.conn.close_reason().is_none())
            .take(3)
            .cloned()
            .collect();
        for peer in peers {
            let on = peer.conn.stable_id();
            {
                let b = receipts(self, ui).book.lock().expect("receipts");
                if b.unsupported.len() >= 64 || b.unsupported.contains(&on) {
                    continue;
                }
            }
            let Ok(permit) = receipts(self, ui).active.clone().try_acquire_owned() else {
                break;
            };
            let Ok(activity) = self.admit() else { break };
            let mut nonce = [0; 32];
            if getrandom::fill(&mut nonce).is_err() {
                continue;
            }
            let began = {
                let b = receipts(self, ui).book.lock().expect("receipts");
                completed.duration_since(b.epoch).as_millis() as u64
            };
            if !receipts(self, ui).book.lock().expect("receipts").tracker.begin(
                nonce,
                peer.device.0,
                on,
                id.0,
                began,
            ) {
                continue;
            }
            let shared = self.clone();
            task::spawn(async move {
                let (_permit, _activity) = (permit, activity);
                let mut body = vec![1];
                body.extend(nonce);
                body.extend(id.0);
                let result = time::timeout(DEADLINE, async {
                    loop {
                        if !receipts(&shared, ui).enabled() {
                            return Ok::<(), anyhow::Error>(());
                        }
                        // Opaque edit IDs remain scoped data. Recheck current disclosure
                        // permission on every probe, including revocation during polling.
                        let who = peer.device;
                        if !shared
                            .try_lab(move |lab, me| lab.peer_edit_outcome(me, who, id).is_some())
                            .await?
                        {
                            return Ok(());
                        }
                        let got =
                            session::exchange(&peer.conn, if ui { UI_KIND } else { KIND }, &body, RESPONSE_LIMIT).await?;
                        ensure!(
                            got.len() == RESPONSE_LIMIT && got[..65] == body,
                            "receipt correlation mismatch"
                        );
                        match got[65] {
                            0 => time::sleep(Duration::from_millis(500)).await,
                            code @ (1 | 2) => {
                                let mut b = receipts(&shared, ui).book.lock().expect("receipts");
                                let now = b.epoch.elapsed().as_millis() as u64;
                                b.tracker.complete(
                                    nonce,
                                    peer.device.0,
                                    on,
                                    id.0,
                                    if code == 1 {
                                        Outcome::Standing
                                    } else {
                                        Outcome::NotStanding
                                    },
                                    now,
                                );
                                return Ok(());
                            }
                            _ => anyhow::bail!("unknown receipt outcome"),
                        }
                    }
                })
                .await;
                let mut b = receipts(&shared, ui).book.lock().expect("receipts");
                b.tracker.cancel(nonce);
                // Old peers reset the unknown stream. Probe this connection at most once on any error.
                if !matches!(result, Ok(Ok(()))) && b.unsupported.len() < 64 {
                    b.unsupported.insert(on);
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Node, Options};
    use avendb::cast::{document, handbook_ready, world};
    #[test]
    fn request_is_fixed_version_and_length() {
        let mut wire = vec![1];
        wire.extend([4; 32]);
        wire.extend([5; 32]);
        assert_eq!(request(&wire).unwrap(), ([4; 32], EditId([5; 32])));
        wire.push(0);
        assert!(request(&wire).is_err());
        wire.pop();
        wire[0] = 2;
        assert!(request(&wire).is_err());
        assert!(request(&[]).is_err());
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn generic_entry_policy_observation_uses_real_authenticated_peer() {
        let mut w = world();
        let vault = handbook_ready(&mut w);
        let (sender, receiver) = (w.mac_a, w.phone_a);
        let mac = Node::spawn(w.lab.split(sender, &[], [61; 32]), sender, Options::local())
            .await
            .unwrap();
        let phone = Node::spawn(
            w.lab.split(receiver, &[], [62; 32]),
            receiver,
            Options::local(),
        )
        .await
        .unwrap();
        phone.know(mac.addr());
        mac.know(phone.addr());
        phone.sync_with(mac.id()).await.unwrap();
        assert!(!mac.shared.receipts.enabled());
        let armed = mac.op(serde_json::json!({"op":"measure_peer_policy"})).await.unwrap();
        assert!(armed.get("ok").is_some(), "{armed}");
        assert!(mac.shared.receipts.enabled());
        mac.act(move |lab, me| {
            lab.create(
                me,
                vault,
                vault,
                "doc",
                &[],
                document("Receipt", "ordinary entry", me),
            )
            .unwrap()
        })
        .await;
        time::timeout(Duration::from_secs(20), async {
            loop {
                if !mac.shared.receipts.json()["samples"]
                    .as_array()
                    .unwrap()
                    .is_empty()
                {
                    break;
                }
                time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            mac.shared.receipts.json()["samples"][0]["outcome"],
            "standing"
        );
        mac.shutdown().await.unwrap();
        phone.shutdown().await.unwrap();
    }
    #[test]
    fn reactive_emissions_require_opt_in_and_are_bounded_and_expire() {
        let receipts = Receipts::for_ui();
        let id = EditId([42; 32]);
        assert_eq!(receipts.emitted(vec![id]), 0);
        assert!(!receipts.has_emitted(id));
        receipts.arm();
        receipts.emitted((0..100).map(|n| EditId([n; 32])).collect());
        assert_eq!(receipts.book.lock().unwrap().emitted.len(), 64);
        receipts.emitted(vec![id]);
        assert!(receipts.has_emitted(id));
        receipts.book.lock().unwrap().until = Some(Instant::now() - SESSION);
        assert!(!receipts.has_emitted(id));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn reactive_receipt_waits_for_explicit_consumer_frontier() {
        let mut w = world();
        let vault = handbook_ready(&mut w);
        let (sender, receiver) = (w.mac_a, w.phone_a);
        let mac = Node::spawn(w.lab.split(sender, &[], [63; 32]), sender, Options::local()).await.unwrap();
        let phone = Node::spawn(w.lab.split(receiver, &[], [64; 32]), receiver, Options::local()).await.unwrap();
        phone.know(mac.addr()); mac.know(phone.addr());
        phone.sync_with(mac.id()).await.unwrap();
        mac.shared.ui_receipts.arm(); phone.shared.ui_receipts.arm();
        let entry = mac.act(move |lab, me| lab.create(me, vault, vault, "doc", &[], document("Reactive receipt", "ordinary entry", me)).unwrap()).await;
        phone.sync_with(mac.id()).await.unwrap();
        // Policy convergence alone must never become a UI acknowledgement.
        time::sleep(Duration::from_millis(600)).await;
        assert!(mac.shared.ui_receipts.json()["samples"].as_array().unwrap().is_empty());
        let answer = phone.op(json!({"op":"query","observeRevision":true})).await.unwrap();
        let row = answer["ok"]["rows"].as_array().unwrap().iter().find(|r| r["entry"] == entry.to_hex()).unwrap();
        let revision = &row["observedRevision"];
        let emission = json!({"entry":row["entry"], "kind":revision["kind"], "heads":revision["heads"], "frontierComplete":revision["frontierComplete"], "readOnly":row["readOnly"]});
        let mut mismatched = emission.clone();
        mismatched["heads"] = json!([EditId([0; 32]).to_hex()]);
        let rejected = phone.op(json!({"op":"observe_query_emission","rows":[mismatched]})).await.unwrap();
        assert_eq!(rejected["ok"]["registered"], 0);
        let registered = phone.op(json!({"op":"observe_query_emission","rows":[emission]})).await.unwrap();
        assert!(registered["ok"]["registered"].as_u64().unwrap() > 0);
        time::timeout(Duration::from_secs(20), async {
            while mac.shared.ui_receipts.json()["samples"].as_array().unwrap().is_empty() {
                time::sleep(Duration::from_millis(50)).await;
            }
        }).await.unwrap();
        assert_eq!(mac.shared.ui_receipts.json()["stage"], "local-completion-to-peer-reactive-consumer");
        assert_eq!(mac.shared.ui_receipts.json()["samples"][0]["outcome"], "standing");
        mac.shutdown().await.unwrap(); phone.shutdown().await.unwrap();
    }

}

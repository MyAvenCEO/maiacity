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
    collections::BTreeSet,
    sync::{Arc, Mutex},
};

pub(crate) const KIND: u8 = 18;
pub(crate) const REQUEST_LIMIT: usize = 65;
const RESPONSE_LIMIT: usize = 66;
const SESSION: Duration = Duration::from_secs(120);
const DEADLINE: Duration = Duration::from_secs(30);
struct Book {
    tracker: Tracker,
    epoch: Instant,
    until: Option<Instant>,
    unsupported: BTreeSet<usize>,
}
pub(crate) struct Receipts {
    book: Mutex<Book>,
    active: Arc<tokio::sync::Semaphore>,
    serving: Arc<tokio::sync::Semaphore>,
}
impl Default for Receipts {
    fn default() -> Self {
        Self {
            book: Mutex::new(Book {
                tracker: Tracker::default(),
                epoch: Instant::now(),
                until: None,
                unsupported: BTreeSet::new(),
            }),
            active: Arc::new(tokio::sync::Semaphore::new(3)),
            serving: Arc::new(tokio::sync::Semaphore::new(1)),
        }
    }
}
impl Receipts {
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
            "stage": "local-completion-to-peer-policy-observation", "samples": samples})
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
pub(crate) async fn answer(shared: &Arc<Shared>, peer: &Peer, body: &[u8]) -> Result<Vec<u8>> {
    let (nonce, id) = request(body)?;
    let permit = shared
        .receipts
        .serving
        .clone()
        .try_acquire_owned()
        .context("receipt observer busy")?;
    let who = peer.device;
    // Permission and policy outcome are captured under the same current Lab lock.
    // No full catch-up is forced by the diagnostic, including during bootstrap.
    Ok(shared
        .read(move |lab, me| {
            let _permit = permit;
            let result = match lab.peer_edit_outcome(me, who, id) {
                None => 0,
                Some(true) => 1,
                Some(false) => 2,
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
        if !self.receipts.enabled() {
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
                let b = self.receipts.book.lock().expect("receipts");
                if b.unsupported.len() >= 64 || b.unsupported.contains(&on) {
                    continue;
                }
            }
            let Ok(permit) = self.receipts.active.clone().try_acquire_owned() else {
                break;
            };
            let Ok(activity) = self.admit() else { break };
            let mut nonce = [0; 32];
            if getrandom::fill(&mut nonce).is_err() {
                continue;
            }
            let began = {
                let b = self.receipts.book.lock().expect("receipts");
                completed.duration_since(b.epoch).as_millis() as u64
            };
            if !self.receipts.book.lock().expect("receipts").tracker.begin(
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
                        if !shared.receipts.enabled() {
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
                            session::exchange(&peer.conn, KIND, &body, RESPONSE_LIMIT).await?;
                        ensure!(
                            got.len() == RESPONSE_LIMIT && got[..65] == body,
                            "receipt correlation mismatch"
                        );
                        match got[65] {
                            0 => time::sleep(Duration::from_millis(500)).await,
                            code @ (1 | 2) => {
                                let mut b = shared.receipts.book.lock().expect("receipts");
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
                let mut b = shared.receipts.book.lock().expect("receipts");
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
}

//! Bounded positive-type discovery. IDs are scheduling hints, never authority or completeness.
use std::sync::Arc;
use anyhow::{Context, Result, ensure};
use avendb::{id::{EntryId, VaultId}, sync::LogId};
use n0_future::{task, time::{self, Duration, Instant}};
use serde_json::{Value, json};
use crate::{Shared, Peer, session};

pub(crate) const KIND: u8 = 17;
pub(crate) const REQUEST_LIMIT: usize = 4096;
pub(crate) const RESPONSE_LIMIT: usize = 8192;
pub(crate) const HINTS: usize = 64;

// Reserve a share of the remaining total budget for each untried peer. This
// changes scheduling only; requests and signed receive keep their existing gates.
fn peer_deadline(now: Instant, overall: Instant, remaining_peers: usize) -> Instant {
    now + overall.saturating_duration_since(now) / remaining_peers.max(1) as u32
}

async fn queued_before_checkpoint<T>(queue: impl FnOnce(), checkpoint: impl std::future::Future<Output = T>) -> T {
    queue();
    checkpoint.await
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Query {
    pub types: Vec<String>,
    pub vault: Option<String>,
}
impl Query {
    pub(crate) fn parse(value: &Value) -> Option<Self> {
        let map = value.as_object()?;
        if map.keys().any(|key| !["types", "vault"].contains(&key.as_str())) { return None; }
        let types = map.get("types")?.as_array()?.iter().map(|v| v.as_str().map(str::to_owned)).collect::<Option<Vec<_>>>()?;
        let vault = match map.get("vault") { None => None, Some(v) => Some(v.as_str()?.to_owned()) };
        let query = Self { types, vault };
        query.valid().then_some(query)
    }
    fn json(&self) -> Value {
        let mut value = json!({"types": self.types});
        if let Some(vault) = &self.vault { value["vault"] = json!(vault); }
        value
    }

    pub fn valid(&self) -> bool {
        !self.types.is_empty() && self.types.len() <= 8
            && self.types.iter().all(|t| !t.is_empty() && t.len() <= 64)
            && self.vault.as_ref().is_none_or(|v| VaultId::from_hex(v).is_some())
    }
}
fn request(bytes: &[u8]) -> Result<Query> {
    ensure!(bytes.len() <= REQUEST_LIMIT, "discovery request too large");
    let value: Value = serde_json::from_slice(bytes)?;
    let map = value.as_object().context("discovery request object")?;
    ensure!(map.len() == 2 && value["version"].as_u64() == Some(1), "unsupported discovery version");
    Query::parse(&value["query"]).context("invalid discovery query")
}
fn response(bytes: &[u8]) -> Result<Vec<LogId>> {
    ensure!(bytes.len() <= RESPONSE_LIMIT, "discovery response too large");
    let value: Value = serde_json::from_slice(bytes)?;
    ensure!(value.as_object().is_some_and(|m| m.len() == 3)
        && value["version"].as_u64() == Some(1) && value["complete"].as_bool() == Some(false), "unsupported discovery response");
    let rows = value["entries"].as_array().context("discovery entries")?;
    ensure!(rows.len() <= HINTS, "too many discovery hints");
    rows.iter().map(|v| v.as_str().and_then(EntryId::from_hex).map(LogId::Entry).context("invalid discovery ID")).collect()
}

pub(crate) async fn answer(shared: &Arc<Shared>, peer: &Peer, bytes: &[u8]) -> Result<Vec<u8>> {
    let query = request(bytes)?;
    let permit = shared.discovery_answer.clone().try_acquire_owned().context("discovery busy")?;
    let requester = peer.device;
    let (revision, entries, permit) = shared.read(move |lab, me| {
        (lab.log(me).revision(), hints(lab, me, requester, &query), permit)
    }).await;
    let body = serde_json::to_vec(&json!({"version": 1, "complete": false, "entries": entries}))?;
    // Recheck after preparation/encoding. Equal-count restore and revocation both change this identity.
    shared.read(move |lab, me| {
        let _permit = permit;
        finish(lab, me, revision, body)
    }).await
}

fn finish(lab: &avendb::lab::Lab, me: avendb::id::SignerId, revision: avendb::policy::LogRevision, body: Vec<u8>) -> Result<Vec<u8>> {
    ensure!(lab.log(me).revision() == revision, "discovery authorization changed during preparation");
    Ok(body)
}

fn hints(lab: &avendb::lab::Lab, me: avendb::id::SignerId, requester: avendb::id::SignerId, query: &Query) -> Vec<String> {
    lab.discover_types(me, requester, query.vault.as_deref().and_then(VaultId::from_hex), &query.types)
        .into_iter().map(|id| id.to_hex()).collect()
}

/// Bounded vault-local dependencies; never a global schema query or an access grant.
fn lane_queries(entries: &[LogId], waits: &[(EntryId,VaultId)]) -> Vec<Query> {
    let mut vaults=std::collections::BTreeSet::new();
    for (entry,vault) in waits {
        if entries.contains(&LogId::Entry(*entry)) { vaults.insert(*vault); }
    }
    vaults.into_iter().take(4).map(|vault| Query {
        types: vec![avendb::slice::SCHEMA_TYPE.into(),avendb::slice::LENS_TYPE.into()],
        vault: Some(vault.to_hex()),
    }).collect()
}
impl Shared {
    pub(crate) async fn prioritize_owner_lanes(self: &Arc<Self>) -> bool {
        let waits=self.read(|lab,me|lab.owner_base_lane_waits(me)).await;
        if waits.is_empty() { return false; }
        let scopes=self.demands.lock().expect("demands").query_scopes(Instant::now());
        let mut pending=false;
        for scope in scopes {
            let sources={
                let mut demands=self.demands.lock().expect("demands");
                demands.working_set(&scope,Instant::now()).map(|(revision,_,_)|
                    demands.dependency_entries(&scope,revision,Instant::now())).unwrap_or_default()
            };
            if !lane_queries(&sources,&waits).is_empty() { pending=true; self.schedule_discovery(scope); }
        }
        pending
    }
    pub(crate) fn schedule_discoveries(self: &Arc<Self>) {
        let scopes = self.demands.lock().expect("demands").query_scopes(Instant::now());
        for scope in scopes { self.schedule_discovery(scope); }
    }
    pub(crate) fn schedule_discovery(self: &Arc<Self>, scope: String) {
        {
            let mut running = self.discovery_running.lock().expect("discovery");
            if let Some(again) = running.get_mut(&scope) { *again = true; return; }
            running.insert(scope.clone(), false);
        }
        let Ok(activity) = self.admit() else {
            self.discovery_running.lock().expect("discovery").remove(&scope); return;
        };
        let shared = self.clone();
        task::spawn(async move {
            let _activity = activity;
            loop {
                let active = { shared.demands.lock().expect("demands").working_set(&scope, Instant::now()) };
                if let Some((revision, entries, mut queries)) = active {
                    let sources=shared.demands.lock().expect("demands").dependency_entries(&scope,revision,Instant::now());
                    let waits=shared.read(|lab,me|lab.owner_base_lane_waits(me)).await;
                    let mut dependencies=lane_queries(&sources,&waits);
                    let dependency_count=dependencies.len();
                    dependencies.append(&mut queries);
                    let queries=dependencies;
                    // Restore persisted view projections before any peer work. Local query
                    // discovery uses the same authorized selector; it never claims completeness.
                    let requested = entries.clone();
                    let selectors = queries.clone();
                    let local = shared.read(move |lab, me| {
                        let mut local = requested;
                        for query in selectors {
                            for id in lab.discover_types(me, me, query.vault.as_deref().and_then(VaultId::from_hex), &query.types) {
                                let id = LogId::Entry(id);
                                if !local.contains(&id) { local.push(id); }
                                if local.len() >= 8 { break; }
                            }
                            if local.len() >= 8 { break; }
                        }
                        local
                    }).await;
                    for id in local.iter().take(8) {
                        if !shared.discovery_current(&scope, revision) { break; }
                        if let LogId::Entry(entry) = id {
                            let _ = time::timeout(crate::checkpoint_delivery::DEADLINE,
                                shared.restore_view_checkpoint(*entry, &scope, revision)).await;
                        }
                    }
                    // Snapshot values before awaiting; no demand/peer mutex spans I/O.
                    let peers: Vec<_> = shared.peers.lock().expect("peers").values()
                        .filter(|p| p.conn.close_reason().is_none()).take(4).cloned().collect();
                    let overall = Instant::now() + Duration::from_secs(10);
                    let peer_count = peers.len();
                    for (peer_index, peer) in peers.into_iter().enumerate() {
                        let deadline = peer_deadline(Instant::now(), overall, peer_count - peer_index);
                        // Discover every active selector before optional checkpoint I/O.
                        // In particular, a kernel checkpoint must not consume the budget
                        // before the room/game selector has even been sent.
                        let mut checkpoint_ids = Vec::new();
                        for (query_index,query) in queries.iter().enumerate() {
                            if Instant::now() >= deadline || !shared.discovery_current(&scope, revision) { break; }
                            let request = serde_json::to_vec(&json!({"version": 1, "query": query.json()})).expect("discovery JSON");
                            let reply = time::timeout(Duration::from_secs(3).min(deadline.saturating_duration_since(Instant::now())), session::exchange(&peer.conn, KIND, &request, RESPONSE_LIMIT)).await;
                            let Ok(Ok(bytes)) = reply else { break }; // legacy/refusing peers remain incomplete
                            let Ok(ids) = response(&bytes) else { break };
                            if !shared.demands.lock().expect("demands").discovered(&scope, revision, &ids, Instant::now()) { break; }
                            shared.size.send_modify(|_| {});
                            shared.bootstrap_due.notify_one();
                            // Queue ordinary authorized reconciliation before optional checkpoint I/O.
                            // A slow/absent checkpoint must not hold discovered entry IDs hostage.
                            // Live pulls still wait for authority readiness; hints grant no access.
                            queued_before_checkpoint(|| {
                                for chunk in ids.chunks(crate::pulls::LIVE_LOGS) {
                                    if !shared.discovery_current(&scope, revision) { break; }
                                    shared.live_announced(peer.device, false, chunk);
                                }
                            }, async {
                                if query_index >= dependency_count {
                                    for &id in &ids {
                                        if checkpoint_ids.len() >= 8 { break; }
                                        if !checkpoint_ids.contains(&id) { checkpoint_ids.push(id); }
                                    }
                                }
                            }).await;
                        }
                        for id in entries.iter().take(if dependency_count > 0 { 0 } else { 8 }) {
                            if checkpoint_ids.len() >= 8 { break; }
                            if !checkpoint_ids.contains(id) { checkpoint_ids.push(*id); }
                        }
                        for id in checkpoint_ids {
                            if Instant::now() >= deadline || !shared.discovery_current(&scope, revision) { break; }
                            if let LogId::Entry(entry) = id {
                                if shared.fetch_view_checkpoint(&peer, entry, &scope, revision, deadline).await.is_err() { break; }
                            }
                        }
                    }
                }
                let mut running = shared.discovery_running.lock().expect("discovery");
                if running.get(&scope) == Some(&true) { running.insert(scope.clone(), false); }
                else { running.remove(&scope); break; }
            }
        });
    }
    pub(crate) fn discovery_current(self: &Arc<Self>, scope: &str, revision: u64) -> bool {
        if self.admit().is_err() { return false; }
        self.demands.lock().expect("demands").current(scope, revision, Instant::now())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use avendb::cast::{world, document};
    #[tokio::test]
    async fn discovered_ids_queue_while_checkpoint_never_completes() {
        let queued = std::sync::atomic::AtomicBool::new(false);
        let work = queued_before_checkpoint(
            || queued.store(true, std::sync::atomic::Ordering::SeqCst),
            std::future::pending::<()>(),
        );
        assert!(time::timeout(Duration::from_millis(10), work).await.is_err());
        assert!(queued.load(std::sync::atomic::Ordering::SeqCst));
    }

    #[test]
    fn slow_first_peer_leaves_budget_for_other_peers() {
        let now = Instant::now();
        let overall = now + Duration::from_secs(10);
        let first = peer_deadline(now, overall, 4);
        assert_eq!(first - now, Duration::from_millis(2500));
        let second = peer_deadline(first, overall, 3);
        assert_eq!(second - first, Duration::from_millis(2500));
        assert!(second < overall);
        assert_eq!(peer_deadline(second, overall, 1), overall);
    }

    #[test]
    fn positive_selectors_are_bounded_and_cannot_choose_an_identity() {
        assert!(request(br#"{"version":1,"query":{"types":["note"]},"requester":"forged"}"#).is_err());
        assert!(!Query { types: vec![], vault: None }.valid());
        assert!(!Query { types: vec!["x".repeat(65)], vault: None }.valid());
        assert!(!Query { types: vec!["note".into(); 9], vault: None }.valid());
        assert!(!Query { types: vec!["note".into()], vault: Some("bad".into()) }.valid());
        assert!(Query::parse(&json!({"types":["note"],"where":{"any":[]}})).is_none());
    }
    #[test]
    fn unsupported_or_empty_discovery_never_claims_completeness() {
        assert!(response(b"unsupported").is_err());
        assert!(response(br#"{"version":2,"complete":false,"entries":[]}"#).is_err());
        assert!(response(br#"{"version":1,"complete":true,"entries":[]}"#).is_err());
        assert_eq!(response(br#"{"version":1,"complete":false,"entries":[]}"#).unwrap(), vec![]);
        let too_many = json!({"version":1,"complete":false,"entries":vec!["ab".repeat(32); HINTS + 1]});
        assert!(response(&serde_json::to_vec(&too_many).unwrap()).is_err());
    }
    #[test]
    fn private_type_discovery_checks_recipient_before_matching_and_caps_hints() {
        let mut w = world();
        let target = w.lab.create(w.mac_a, w.alice, w.alice, "private-note", &[],
            document("Private", "Never disclose to Bob", w.mac_a)).unwrap();
        let query = Query { types: vec!["private-note".into()], vault: None };
        assert!(hints(&w.lab, w.mac_a, w.mac_b, &query).is_empty());
        assert!(hints(&w.lab, w.mac_a, w.stranger, &query).is_empty());
        // A backup-only peer may retain ciphertext, but may not discover plaintext type metadata.
        let alice = w.alice;
        avendb::cast::relay_on(&mut w, alice);
        assert!(hints(&w.lab, w.mac_a, w.server, &query).is_empty());
        assert_eq!(hints(&w.lab, w.mac_a, w.phone_a, &query), vec![target.to_hex()]);
        let narrow = Query { vault: Some(w.bob.to_hex()), ..query.clone() };
        assert!(hints(&w.lab, w.mac_a, w.phone_a, &narrow).is_empty());
        for _ in 0..HINTS {
            w.lab.create(w.mac_a, w.alice, w.alice, "private-note", &[], document("Private", "More", w.mac_a)).unwrap();
        }
        assert_eq!(hints(&w.lab, w.mac_a, w.phone_a, &query).len(), HINTS);
    }
    #[test]
    fn pending_revocation_invalidates_prepared_hints_before_materialization() {
        use avendb::policy::{Action, Revoking};
        let mut w = world();
        let target = w.lab.create(w.mac_a, w.alice, w.alice, "private-note", &[],
            document("Private", "Current permission", w.mac_a)).unwrap();
        let query = Query { types: vec!["private-note".into()], vault: None };
        // split moves the device store, so author the future governance batch while it is
        // still held here, then restore only the provider's earlier state for the race.
        let before_revocation = w.lab.backup(w.mac_a);
        w.lab.submit(w.mac_a, &[w.passkey_a], Action::Revoke(Revoking::Device {
            vault: w.alice, device: w.phone_a, keep: vec![],
        })).unwrap();
        let revoked = w.lab.backup(w.mac_a).signed().to_vec();
        let mut provider = w.lab.split(w.mac_a, &[], [123; 32]);
        provider.restore_from(w.mac_a, before_revocation);
        let prepared_revision = provider.log(w.mac_a).revision();
        assert_eq!(hints(&provider, w.mac_a, w.phone_a, &query), vec![target.to_hex()]);
        let body = serde_json::to_vec(&json!({"version":1,"complete":false,"entries":[target.to_hex()]})).unwrap();
        assert!(finish(&provider, w.mac_a, prepared_revision.clone(), body.clone()).is_ok());
        provider.receive_whose_now(w.mac_a, revoked, vec![], false);
        assert_ne!(provider.log(w.mac_a).revision(), prepared_revision,
            "prepared response fails the transmission fence");
        assert!(finish(&provider, w.mac_a, prepared_revision, body).is_err(),
            "actual prepared-response fence must withhold already encoded IDs");
        assert!(hints(&provider, w.mac_a, w.phone_a, &query).is_empty(),
            "current policy rejects even before background materialization");
    }

}

#[cfg(test)]
mod lane_dependency_tests {
    use super::*;
    #[test]
    fn lane_discovery_stays_vault_scoped_and_follows_lease_revision() {
        let now=Instant::now(); let entry=EntryId([1;32]); let other=EntryId([2;32]); let vault=VaultId([3;32]);
        let mut demands=crate::demand::Demands::default();
        demands.replace("view".into(),1,vec![LogId::Entry(entry)],now).unwrap();
        let queries=lane_queries(&demands.dependency_entries("view",1,now),&[(entry,vault),(other,VaultId([4;32]))]);
        assert_eq!(queries.len(),1); assert_eq!(queries[0].vault,Some(vault.to_hex()));
        assert_eq!(queries[0].types,vec![avendb::slice::SCHEMA_TYPE.to_string(),avendb::slice::LENS_TYPE.to_string()]);
        assert!(demands.discovered("view",1,&[LogId::Entry(other)],now));
        assert!(demands.entries(now).contains(&LogId::Entry(other)));
        demands.replace("view".into(),2,vec![],now).unwrap();
        assert!(demands.dependency_entries("view",1,now).is_empty());
        assert!(lane_queries(&demands.dependency_entries("view",2,now),&[(entry,vault)]).is_empty());
        assert!(!demands.discovered("view",1,&[LogId::Entry(other)],now));
    }
}

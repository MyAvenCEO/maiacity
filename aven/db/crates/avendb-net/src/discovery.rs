//! A view's positive-type selectors, found through the blind index (`blind`, P4 of sync v2): any peer answers, the
//! server too. Found IDs are scheduling hints, never authority or completeness.
use std::sync::Arc;
use std::sync::atomic::Ordering;
use avendb::{id::{EntryId, VaultId}, sync::LogId};
use n0_future::{task, time::{self, Duration, Instant}};
use serde_json::Value;
use crate::Shared;

/// A view's type selector, in one vault or any, and its window: every entry it picks, or the newest `n` by creation
/// (Lean `Interest.lean`'s `Window`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Query {
    pub types: Vec<String>,
    pub vault: Option<String>,
    pub newest: Option<u16>,
}
impl Query {
    pub(crate) fn parse(value: &Value) -> Option<Self> {
        let map = value.as_object()?;
        if map.keys().any(|key| !["types", "vault", "newest"].contains(&key.as_str())) { return None; }
        let types = map.get("types")?.as_array()?.iter().map(|v| v.as_str().map(str::to_owned)).collect::<Option<Vec<_>>>()?;
        let vault = match map.get("vault") { None => None, Some(v) => Some(v.as_str()?.to_owned()) };
        let newest = match map.get("newest") { None => None, Some(n) => Some(u16::try_from(n.as_u64()?).ok()?) };
        let query = Self { types, vault, newest };
        query.valid().then_some(query)
    }
    pub fn valid(&self) -> bool {
        !self.types.is_empty() && self.types.len() <= 8
            && self.types.iter().all(|t| !t.is_empty() && t.len() <= 64)
            && self.vault.as_ref().is_none_or(|v| VaultId::from_hex(v).is_some())
            && self.newest.is_none_or(|n| n > 0 && n as usize <= avendb::index::FIND_PAGE)
    }
}
/// The most `find` requests one selector takes of a peer: its tokens `FIND_TOKENS` at a time.
const FIND_REQUESTS: usize = 8;

/// The `find` requests for a selector's `tokens` in `vault` (any vault the device finds in, for none): every token,
/// `FIND_TOKENS` a request, at most `FIND_REQUESTS` of them. A selector's tokens are each label's in every audience of
/// every vault under each index key, so a vault of many audiences (a person's, each room's and share's) holds more than
/// one request takes; the first `FIND_TOKENS` alone, sorted by their bytes, left a room's audience out at random: of
/// Chat's `room` over every vault, the coop's channel or the note to self.
fn finds_of(vault: Option<VaultId>, tokens: Vec<avendb::index::Token>, newest: Option<u16>) -> Vec<crate::blind::Find> {
    tokens.chunks(avendb::index::FIND_TOKENS).take(FIND_REQUESTS)
        .map(|c| crate::blind::Find { vault, after: None, follow: vec![], tokens: c.to_vec(), newest })
        .collect()
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
        newest: None,
    }).collect()
}
impl Shared {
    /// The scopes whose entries wait for their vault's schemas and lenses (`waits`) find them (`lane_queries`), as
    /// those entries come to wait (`Shared::ask_waits`).
    pub(crate) fn find_lanes(self: &Arc<Self>, waits: &[(EntryId, VaultId)]) {
        let scopes = {
            let interests = self.interests.lock().expect("interests");
            interests.query_scopes().into_iter().filter(|scope| {
                let sources = interests.working_set(scope)
                    .map(|(revision, _, _)| interests.dependency_entries(scope, revision)).unwrap_or_default();
                !lane_queries(&sources, waits).is_empty()
            }).collect::<Vec<_>>()
        };
        for scope in scopes { self.schedule_discovery(scope); }
    }
    /// A new device asks `find` before its vaults' keys came: once keys or audiences it finds under change, every
    /// live view's selectors find again under the new tokens, without waiting for the whole catch-up.
    pub(crate) async fn find_again_on_new_keys(self: &Arc<Self>) {
        if self.interests.lock().expect("interests").query_scopes().is_empty() { return; }
        let mark = self.read(|lab, me| lab.index_mark(me)).await;
        let changed = {
            let mut held = self.discovery_mark.lock().expect("discovery mark");
            let changed = *held != mark;
            *held = mark;
            changed
        };
        if changed { self.schedule_discoveries(); }
    }
    pub(crate) fn schedule_discoveries(self: &Arc<Self>) {
        let scopes = self.interests.lock().expect("interests").query_scopes();
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
                let active = { shared.interests.lock().expect("interests").working_set(&scope) };
                if let Some((revision, entries, mut queries)) = active {
                    let sources=shared.interests.lock().expect("interests").dependency_entries(&scope,revision);
                    let waits=shared.read(|lab,me|lab.owner_base_lane_waits(me)).await;
                    let mut dependencies=lane_queries(&sources,&waits);
                    let dependency_count=dependencies.len();
                    dependencies.append(&mut queries);
                    let queries=dependencies;
                    // Restore persisted view projections before any peer work. Local query
                    // discovery uses the same authorized selector; it never claims completeness.
                    let requested = entries.clone();
                    let selectors = queries.clone();
                    let mut tokens = Vec::new();
                    for query in &selectors {
                        let labels = query.types.iter().map(|t| avendb::index::type_label(t)).collect();
                        tokens.push(shared.find_tokens(query.vault.as_deref().and_then(VaultId::from_hex), labels).await);
                    }
                    let (local, finds) = shared.read(move |lab, me| {
                        let mut local = requested;
                        let mut finds = Vec::new();
                        for (query, tokens) in selectors.into_iter().zip(tokens) {
                            let vault = query.vault.as_deref().and_then(VaultId::from_hex);
                            if tokens.is_empty() { finds.push(None); continue; }
                            // a window restores its newest first, as it shows them
                            let named = match query.newest {
                                Some(n) => lab.find_newest(me, me, &[], vault, &tokens, vec![], n as usize).into_iter().map(|(id, _)| id).collect(),
                                None => lab.find_local(me, me, &[], vault, &tokens, None).0,
                            };
                            for id in named {
                                if local.len() >= 8 { break; }
                                let id = LogId::Entry(id);
                                if !local.contains(&id) { local.push(id); }
                            }
                            finds.push(Some(finds_of(vault, tokens, query.newest)));
                        }
                        (local, finds)
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
                    let deadline = Instant::now() + Duration::from_secs(10);
                    let round = if peers.is_empty() { 0 } else { shared.discovery_rounds.fetch_add(1, Ordering::AcqRel) + 1 };
                    // of each windowed selector, the newest its peers named so far, each with its creation's depth
                    let mut newest: Vec<Vec<(EntryId, u64)>> = vec![Vec::new(); finds.len()];
                    for peer in peers {
                        let mut checkpoints_supported = true;
                        // Explicit active-view IDs also bootstrap without waiting for collection discovery.
                        for id in entries.iter().take(if dependency_count > 0 { 0 } else { 8 }) {
                            if Instant::now() >= deadline || !shared.discovery_current(&scope, revision) { break; }
                            if let LogId::Entry(entry) = id {
                                if shared.fetch_view_checkpoint(&peer, *entry, &scope, revision, deadline).await.is_err() { checkpoints_supported = false; break; }
                            }
                        }
                        'finds: for (query_index,find) in finds.iter().enumerate() {
                          let Some(find) = find else { continue }; // no key of the vault: nothing to find by
                          let query = &queries[query_index];
                          let manifests = query.types.iter().any(|t| t == crate::interest::MANIFEST_TYPE);
                          for find in find {
                            if Instant::now() >= deadline || !shared.discovery_current(&scope, revision) { break 'finds; }
                            let wait = Duration::from_secs(3).min(deadline.saturating_duration_since(Instant::now()));
                            // what peers named joins the scope's Interest, whose change asks its now tier at once
                            let (ids, current) = match query.newest {
                                // a window: this peer's newest, ranked with what the other peers named by creation,
                                // and the newest n of them all are the selector's entries (Lean `Window.keep`)
                                Some(n) => {
                                    let Ok(Ok(found)) = time::timeout(wait, crate::blind::find_newest(&peer, find.clone())).await else { break 'finds };
                                    let ranked = &mut newest[query_index];
                                    ranked.extend(found);
                                    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
                                    let mut seen = std::collections::BTreeSet::new();
                                    ranked.retain(|(e, _)| seen.insert(*e));
                                    ranked.truncate(n as usize);
                                    let ids: Vec<LogId> = ranked.iter().map(|(e, _)| LogId::Entry(*e)).collect();
                                    let current = shared.change_interests(|interests| interests.found_newest(&scope, revision, query, ids.clone()));
                                    (ids, current)
                                }
                                None => {
                                    let Ok(Ok(ids)) = time::timeout(wait, crate::blind::find_all(&peer, find.clone())).await else { break 'finds }; // legacy/refusing peers remain incomplete
                                    let ids: Vec<LogId> = ids.into_iter().take(avendb::index::FIND_PAGE).map(LogId::Entry).collect();
                                    let current = shared.change_interests(|interests| {
                                        let current = interests.discovered(&scope, revision, &ids);
                                        if current && manifests { interests.found_manifests(&ids); }
                                        current
                                    });
                                    (ids, current)
                                }
                            };
                            if !current { break 'finds; }
                            if !ids.is_empty() {
                                let _ = shared.discovery_first_found.compare_exchange(0, round, Ordering::AcqRel, Ordering::Acquire);
                            }
                            shared.size.send_modify(|_| {});
                            shared.bootstrap_due.notify_one();
                            // A bounded working-set checkpoint precedes ordinary history for this view.
                            // Unsupported/unauthorized/oversized offers fall through to signed-log sync.
                            for id in ids.iter().take(if checkpoints_supported && query_index >= dependency_count { 8 } else { 0 }) {
                                if Instant::now() >= deadline || !shared.discovery_current(&scope, revision) { break; }
                                if let LogId::Entry(entry) = id {
                                    if shared.fetch_view_checkpoint(&peer, *entry, &scope, revision, deadline).await.is_err() { checkpoints_supported = false; break; }
                                }
                            }
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
        self.interests.lock().expect("interests").current(scope, revision)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn positive_selectors_are_bounded() {
        assert!(!Query { types: vec![], vault: None, newest: None }.valid());
        assert!(!Query { types: vec!["x".repeat(65)], vault: None, newest: None }.valid());
        assert!(!Query { types: vec!["note".into(); 9], vault: None, newest: None }.valid());
        assert!(!Query { types: vec!["note".into()], vault: Some("bad".into()), newest: None }.valid());
        assert!(Query::parse(&serde_json::json!({"types":["note"],"where":{"any":[]}})).is_none());
        assert!(Query::parse(&serde_json::json!({"types":["note"]})).is_some());
    }
}

#[cfg(test)]
mod lane_dependency_tests {
    use super::*;
    #[test]
    fn lane_discovery_stays_vault_scoped_and_follows_lease_revision() {
        let entry=EntryId([1;32]); let other=EntryId([2;32]); let vault=VaultId([3;32]);
        let mut demands=crate::interest::Interests::default();
        demands.replace("view".into(),1,vec![crate::interest::Want::now(vec![LogId::Entry(entry)])]).unwrap();
        let queries=lane_queries(&demands.dependency_entries("view",1),&[(entry,vault),(other,VaultId([4;32]))]);
        assert_eq!(queries.len(),1); assert_eq!(queries[0].vault,Some(vault.to_hex()));
        assert_eq!(queries[0].types,vec![avendb::slice::SCHEMA_TYPE.to_string(),avendb::slice::LENS_TYPE.to_string()]);
        assert!(demands.discovered("view",1,&[LogId::Entry(other)]));
        assert!(demands.entries().contains(&LogId::Entry(other)));
        demands.replace("view".into(),2,vec![]).unwrap();
        assert!(demands.dependency_entries("view",1).is_empty());
        assert!(lane_queries(&demands.dependency_entries("view",2),&[(entry,vault)]).is_empty());
        assert!(!demands.discovered("view",1,&[LogId::Entry(other)]));
    }
}

#[cfg(test)]
mod find_tests {
    use super::*;
    #[test]
    fn every_token_of_a_selector_is_asked_a_request_at_a_time() {
        let tokens: Vec<avendb::index::Token> = (0..1300u32).map(|i| { let mut t = [0u8; 16]; t[..4].copy_from_slice(&i.to_be_bytes()); t }).collect();
        let finds = finds_of(None, tokens.clone(), None);
        assert_eq!(finds.len(), 3);
        assert!(finds.iter().all(|f| f.tokens.len() <= avendb::index::FIND_TOKENS && f.vault.is_none() && f.after.is_none()));
        let asked: Vec<_> = finds.iter().flat_map(|f| f.tokens.iter().copied()).collect();
        assert_eq!(asked, tokens, "none left out");
        assert!(finds_of(None, vec![], None).is_empty());
        let many: Vec<avendb::index::Token> = (0..(FIND_REQUESTS * avendb::index::FIND_TOKENS + 9) as u32).map(|i| { let mut t = [0u8; 16]; t[..4].copy_from_slice(&i.to_be_bytes()); t }).collect();
        assert_eq!(finds_of(None, many, None).len(), FIND_REQUESTS, "bounded");
    }
}

//! Content-authenticated grant classification for scoped authority discovery.
//! This index is not authority: it identifies which log might affect a scope.
//! Unknown, invalid and over-budget descriptors remain unresolved. Ordinary
//! replay and the current-frontier fence still decide acceptance.
use std::collections::{BTreeMap, BTreeSet};
use avendb::{id::{EntryId, ShareId, VaultId}, policy::{Action, Level, Sharing, Who}, sign::Signed};

pub(crate) const MAX_CLASSES: usize = 128;
const MAX_VIA: usize = 32;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct GrantClass {
    pub over: VaultId,
    pub issuer: VaultId,
    pub who: Who,
    pub level: Level,
    pub wide: bool,
    pub parent: Option<ShareId>,
    pub group: Option<EntryId>,
    pub via: Vec<VaultId>,
}

impl GrantClass {
    /// Must run outside the database lock: signature validation can be costly.
    /// The requested ID comes from authenticated holdings, not a reply label.
    pub(crate) fn verify(id: ShareId, signed: &Signed) -> Option<Self> {
        signed.verify().ok()?;
        Self::from_verified(id, &signed.edit)
    }

    fn from_verified(id: ShareId, edit: &avendb::policy::Edit) -> Option<Self> {
        if ShareId::from(edit.id()) != id { return None; }
        let Action::Share(Sharing::Grant(grant, via)) = &edit.action else { return None };
        if via.len() > MAX_VIA || !edit.parents.is_empty() { return None; }
        Some(Self { over: grant.over, issuer: grant.issuer, who: grant.who, level: grant.level, wide: grant.wide,
            parent: grant.parent, group: grant.group, via: via.clone() })
    }
}

#[derive(Default)]
pub(crate) struct GrantClasses(BTreeMap<ShareId, GrantClass>);
impl GrantClasses {
    /// Only verified classes can enter; callers cannot insert a raw peer label.
    pub(crate) fn insert(&mut self, id: ShareId, signed: &Signed) -> bool {
        if !self.0.contains_key(&id) && self.0.len() >= MAX_CLASSES { return false; }
        let Some(class) = GrantClass::verify(id, signed) else { return false };
        self.0.insert(id, class);
        true
    }

    pub(crate) fn retain_inventory(&mut self, announced: &BTreeSet<ShareId>) {
        self.0.retain(|id, _| announced.contains(id));
    }

    /// `None` means the negative scope query cannot be answered, including when
    /// an announced grant has not arrived. An empty result is meaningful only
    /// after every announced share ID has been classified at this receipt.
    pub(crate) fn over(&self, announced: &BTreeSet<ShareId>, vault: VaultId) -> Option<Vec<ShareId>> {
        if announced.len() > MAX_CLASSES || announced.iter().any(|id| !self.0.contains_key(id)) { return None; }
        Some(announced.iter().filter(|id| self.0[id].over == vault).copied().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use avendb::{cast::{world, share}, id::EditId, policy::Level, slice::Selector};

    #[test]
    fn classification_requires_the_requested_creation_and_its_real_signatures() {
        let mut w = world();
        let id = w.lab.issue(w.mac_a, &[w.mac_a], share(w.alice, Who::Vault(w.bob), Level::Read, Selector::All)).unwrap();
        let signed = w.lab.signed_edit(w.mac_a, EditId(id.0)).unwrap().clone();
        let class = GrantClass::verify(id, &signed).expect("verified grant creation");
        assert_eq!(class.over, w.alice);
        assert_eq!(class.who, Who::Vault(w.bob));
        assert!(GrantClass::verify(ShareId([47; 32]), &signed).is_none());
        let mut bare = signed.clone();
        bare.sigs.clear();
        assert!(GrantClass::verify(id, &bare).is_none(), "checkpoint-covered bare bodies cannot classify authority");
        let mut tampered = signed;
        if let Action::Share(Sharing::Grant(grant, _)) = &mut tampered.edit.action { grant.over = w.carol; }
        let tampered_id = ShareId::from(tampered.edit.id());
        assert!(GrantClass::verify(tampered_id, &tampered).is_none(), "hash alone is not a signature");
    }

    #[test]
    fn owner_scope_omits_unrelated_authority_but_keeps_wide_reader_authority() {
        use avendb::{cast::document, sync::{log_of, LogId}};
        let mut w = world();
        let entry = w.lab.create(w.mac_a, w.alice, w.alice, "room", &[], document("Scoped", "body", w.mac_a)).unwrap();
        let grant = w.lab.issue(w.mac_a, &[w.mac_a], share(w.alice, Who::Vault(w.bob), Level::Read, Selector::All)).unwrap();
        let log = w.lab.log(w.mac_a);
        let all = log.edits();
        let mut local = crate::holdings::Logs::of(all, log.ids(), w.lab.size(w.mac_a));
        let announced = crate::Holdings { logs: local.frontiers(), files: Default::default() };
        let target: Vec<_> = all.iter().filter(|e| log_of(e,e.id()) == Some(LogId::Entry(entry)))
            .map(|e| w.lab.signed_edit(w.mac_a,e.id()).unwrap().clone()).collect();
        let shape = OwnerEntry::complete(entry, &target, &announced.logs[&LogId::Entry(entry)]).expect("owner-only complete cut");
        let mut classes = GrantClasses::default();
        for id in announced.logs.keys().filter_map(|log| match log { LogId::Share(id) => Some(*id), _ => None }) {
            assert!(classes.insert(id, w.lab.signed_edit(w.mac_a, EditId(id.0)).unwrap()));
        }
        local.of.remove(&LogId::Vault(w.carol));
        let scope = classes.owner_scope(&shape, all, log.ids(), &local, &announced, |id| w.lab.independently_verified_edit(w.mac_a, id)).expect("unrelated Carol authority may be absent");
        assert!(scope.contains(&LogId::Vault(w.alice)));
        assert!(scope.contains(&LogId::Vault(w.bob)), "wide reader devices affect the target key epoch");
        assert!(scope.contains(&LogId::Share(grant)));
        assert!(!scope.contains(&LogId::Vault(w.carol)));
        assert!(classes.owner_scope(&shape, all, log.ids(), &local, &announced, |_| false).is_none(),
            "matching frontiers do not replace independent authority provenance");
        local.of.remove(&LogId::Vault(w.bob));
        assert!(classes.owner_scope(&shape, all, log.ids(), &local, &announced, |id| w.lab.independently_verified_edit(w.mac_a, id)).is_none());
        let missing = classes.owner_dependencies(&shape, all, log.ids(), &local, &announced,
            |id| w.lab.independently_verified_edit(w.mac_a, id)).expect("known missing dependency yields a transfer hint");
        assert!(missing.missing.contains(&LogId::Vault(w.bob)));
        assert!(!missing.missing.contains(&LogId::Vault(w.carol)), "unrelated history is not scheduled");
        local.of.remove(&LogId::Share(grant));
        let missing = classes.owner_dependencies(&shape, all, log.ids(), &local, &announced,
            |id| w.lab.independently_verified_edit(w.mac_a, id)).unwrap();
        assert!(missing.missing.contains(&LogId::Share(grant)), "a classified creation still requires its current revocation frontier");
        assert!(classes.owner_scope(&shape, all, log.ids(), &local, &announced, |_| true).is_none());
    }

    #[test]
    fn known_grant_creation_cannot_hide_a_new_revocation_frontier() {
        use avendb::{cast::document, policy::Revoking, sync::{log_of, LogId}};
        let mut w = world();
        let entry = w.lab.create(w.mac_a, w.alice, w.alice, "room", &[], document("Scoped", "body", w.mac_a)).unwrap();
        let grant = w.lab.issue(w.mac_a, &[w.mac_a], share(w.alice, Who::Vault(w.bob), Level::Read, Selector::All)).unwrap();
        let log = w.lab.log(w.mac_a);
        let edits = log.edits().to_vec();
        let ids = log.ids().to_vec();
        let local = crate::holdings::Logs::of(&edits, &ids, w.lab.size(w.mac_a));
        let before = crate::Holdings { logs: local.frontiers(), files: Default::default() };
        let target: Vec<_> = edits.iter().filter(|e| log_of(e,e.id()) == Some(LogId::Entry(entry)))
            .map(|e| w.lab.signed_edit(w.mac_a,e.id()).unwrap().clone()).collect();
        let owner = OwnerEntry::complete(entry, &target, &before.logs[&LogId::Entry(entry)]).unwrap();
        let mut classes = GrantClasses::default();
        for id in before.logs.keys().filter_map(|log| match log { LogId::Share(id) => Some(*id), _ => None }) {
            assert!(classes.insert(id, w.lab.signed_edit(w.mac_a, EditId(id.0)).unwrap()));
        }
        assert!(classes.owner_scope(&owner, &edits, &ids, &local, &before, |_| true).is_some());
        w.lab.submit(w.mac_a, &[w.mac_a], Action::Revoke(Revoking::Grant {
            share: grant, actor: w.alice, keep: vec![], via: vec![],
        })).unwrap();
        let current = w.lab.log(w.mac_a);
        let announced = crate::Holdings { logs: crate::holdings::Logs::of(current.edits(), current.ids(), w.lab.size(w.mac_a)).frontiers(), files: Default::default() };
        assert_ne!(before.logs[&LogId::Share(grant)], announced.logs[&LogId::Share(grant)]);
        assert!(classes.owner_scope(&owner, &edits, &ids, &local, &announced, |_| true).is_none(),
            "a known immutable grant classifier does not establish current revocation state");
    }

    #[test]
    fn unknown_inventory_members_never_become_an_empty_scope_result() {
        let mut w = world();
        let id = w.lab.issue(w.mac_a, &[w.mac_a], share(w.alice, Who::Vault(w.bob), Level::Read, Selector::All)).unwrap();
        let signed = w.lab.signed_edit(w.mac_a, EditId(id.0)).unwrap();
        let mut classes = GrantClasses::default();
        let known = BTreeSet::from([id]);
        assert_eq!(classes.over(&known, w.carol), None);
        assert!(classes.insert(id, signed));
        assert_eq!(classes.over(&known, w.carol), Some(vec![]));
        assert_eq!(classes.over(&known, w.alice), Some(vec![id]));
        let changed = BTreeSet::from([id, ShareId([48; 32])]);
        assert_eq!(classes.over(&changed, w.carol), None);
        classes.retain_inventory(&BTreeSet::new());
        assert_eq!(classes.over(&known, w.alice), None);
    }
}

/// A bounded, complete entry whose policy writes all act for its owning vault,
/// without audience moves. This is a deliberately narrower case than shared
/// writes: those need cap-group/readings dependency tracing before release.
pub(crate) struct OwnerEntry {
    pub vault: VaultId,
    pub via: BTreeSet<VaultId>,
}
impl OwnerEntry {
    pub(crate) fn complete(entry: EntryId, edits: &[Signed], frontier: &avendb::wire::Frontier) -> Option<Self> {
        Self::from_parts(entry, edits.iter().map(|signed| (signed.edit.id(), &signed.edit)), frontier)
    }

    pub(crate) fn from_parts<'a>(entry: EntryId, edits: impl IntoIterator<Item = (avendb::id::EditId, &'a avendb::policy::Edit)>, frontier: &avendb::wire::Frontier) -> Option<Self> {
        use avendb::policy::Proposal;
        if !frontier.waiting.is_empty() { return None; }
        let mut vault = None;
        let mut via = BTreeSet::new();
        let mut creation = false;
        let mut graph = BTreeMap::new();
        let mut dependencies = BTreeSet::new();
        let mut links = 0usize;
        for (id, edit) in edits {
            if graph.contains_key(&id) { continue; }
            if graph.len() >= 64 { return None; }
            let Action::Write { vault: v, entry: e, actor, stay, via: path, create, proposal, deps, .. } = &edit.action else { return None };
            if *e != entry || actor != v || stay.is_some() || *proposal != Proposal::Main || path.len() > MAX_VIA { return None; }
            if vault.replace(*v).is_some_and(|old| old != *v) { return None; }
            via.extend(path.iter().copied());
            if via.len() > MAX_CLASSES { return None; }
            if let Some(create) = create {
                if creation || !create.audience.is_empty() || !deps.is_empty() { return None; }
                creation = true;
            }
            links = links.checked_add(edit.parents.len())?.checked_add(deps.len())?;
            if links > 1024 { return None; }
            dependencies.extend(deps.iter().copied());
            graph.insert(id, edit.parents.clone());
        }
        if !creation { return None; }
        let ids: BTreeSet<_> = graph.keys().copied().collect();
        let parents: BTreeSet<_> = graph.values().flatten().copied().collect();
        if !parents.is_subset(&ids) || !dependencies.is_subset(&ids) { return None; }
        let mut closed = BTreeSet::new();
        while let Some(id) = graph.iter().find(|(id, parents)| !closed.contains(*id) && parents.iter().all(|p| closed.contains(p))).map(|(id,_)| *id) {
            closed.insert(id);
        }
        if closed != ids { return None; }
        let heads: Vec<_> = ids.difference(&parents).copied().collect();
        if heads != frontier.heads { return None; }
        Some(Self { vault: vault?, via })
    }

}

pub(crate) struct OwnerDependencies {
    pub required: BTreeSet<avendb::sync::LogId>,
    pub missing: BTreeSet<avendb::sync::LogId>,
}

impl GrantClasses {
    /// Close a direct-owner/unchanged-audience entry's authority reads against
    /// an already classified authenticated inventory. No policy checks are
    /// skipped: the result only replaces unrelated log waits at the admission
    /// fence. Shared-write and moved-audience shapes never reach this function.
    pub(crate) fn owner_scope(
        &self,
        owner: &OwnerEntry,
        edits: &[avendb::policy::Edit],
        ids: &[avendb::id::EditId],
        logs: &crate::holdings::Logs,
        announced: &crate::Holdings,
        independent: impl Fn(avendb::id::EditId) -> bool,
    ) -> Option<BTreeSet<avendb::sync::LogId>> {
        let dependencies = self.owner_dependencies(owner, edits, ids, logs, announced, independent)?;
        dependencies.missing.is_empty().then_some(dependencies.required)
    }

    /// Missing current frontiers are transfer hints only. Their contents must be
    /// received normally before we can walk any deeper dependencies or admit.
    pub(crate) fn owner_dependencies(
        &self, owner: &OwnerEntry, edits: &[avendb::policy::Edit], ids: &[avendb::id::EditId],
        logs: &crate::holdings::Logs, announced: &crate::Holdings,
        independent: impl Fn(avendb::id::EditId) -> bool,
    ) -> Option<OwnerDependencies> {
        use avendb::{id::AudienceId, policy::{Kind, Principal, Revoking}, sync::LogId};
        let inventory: BTreeSet<_> = announced.logs.keys().filter_map(|log| match log { LogId::Share(id) => Some(*id), _ => None }).collect();
        // This complete negative lookup is essential: unknown ShareIds cannot
        // be silently classified as unrelated to the owning vault.
        self.over(&inventory, owner.vault)?;
        let mut shares: BTreeSet<_> = inventory.iter().filter(|id| {
            let c = &self.0[id];
            c.over == owner.vault && c.wide && c.level.allows(Level::Read)
        }).copied().collect();
        let mut vaults = owner.via.clone();
        vaults.insert(owner.vault);
        let mut required = BTreeSet::new();
        let mut missing = BTreeSet::new();
        let mut seen_shares = BTreeSet::new();
        let mut seen_vaults = BTreeSet::new();
        let mut inspected = 0usize;
        let held = |id: LogId| -> Option<Option<&crate::holdings::Log>> {
            let remote = announced.logs.get(&id)?;
            if !remote.waiting.is_empty() { return None; }
            Some(logs.of.get(&id).filter(|local| local.frontier == *remote))
        };
        loop {
            if required.len() > MAX_CLASSES || vaults.len() > MAX_CLASSES || shares.len() > MAX_CLASSES { return None; }
            if let Some(id) = shares.difference(&seen_shares).next().copied() {
                seen_shares.insert(id);
                let class = self.0.get(&id)?;
                // Real parent chains stay over one vault. A malformed or unknown
                // cross-vault parent goes through conservative reconciliation.
                if class.over != owner.vault { return None; }
                vaults.insert(class.issuer);
                vaults.extend(class.via.iter().copied());
                if let Who::Vault(v) = class.who { vaults.insert(v); }
                if let Some(parent) = class.parent { shares.insert(parent); }
                let log = LogId::Share(id);
                required.insert(log);
                let Some(held) = held(log)? else { missing.insert(log); continue; };
                let positions = &held.edits;
                inspected = inspected.checked_add(positions.len())?;
                if inspected > 2048 { return None; }
                for &at in positions {
                    let edit = edits.get(at)?;
                    if !independent(*ids.get(at)?) { return None; }
                    match &edit.action {
                        Action::Share(Sharing::Grant(_, _)) | Action::Keys { .. } => {}
                        Action::Revoke(Revoking::Grant { actor, via, .. }) => {
                            if via.len() > MAX_VIA { return None; }
                            vaults.insert(*actor); vaults.extend(via.iter().copied());
                        }
                        Action::Claim { vault, via, .. } => {
                            if via.len() > MAX_VIA { return None; }
                            vaults.insert(*vault); vaults.extend(via.iter().copied());
                        }
                        _ => return None,
                    }
                }
                required.insert(log);
                continue;
            }
            if let Some(v) = vaults.difference(&seen_vaults).next().copied() {
                seen_vaults.insert(v);
                let log = LogId::Vault(v);
                let mut genesis = false;
                required.insert(log);
                let Some(held) = held(log)? else { missing.insert(log); continue; };
                let positions = &held.edits;
                inspected = inspected.checked_add(positions.len())?;
                if inspected > 2048 { return None; }
                for &at in positions {
                    let edit = edits.get(at)?;
                    if !independent(*ids.get(at)?) { return None; }
                    match &edit.action {
                        Action::Genesis { kind, owners, .. } => {
                            // Aven admission has a global one-aven-per-owner
                            // cardinality read (room_for). Do not pretend an
                            // owner ancestry walk closes that negative query.
                            if !matches!(kind, Kind::Human | Kind::Coop | Kind::DeviceVault) { return None; }
                            genesis = true;
                            if owners.len() > MAX_CLASSES { return None; }
                            vaults.extend(owners.iter().filter_map(|p| match p { Principal::Vault(v) => Some(*v), _ => None }));
                        }
                        Action::Share(Sharing::Owner { owner: Principal::Vault(v), .. })
                        | Action::Revoke(Revoking::Owner { owner: Principal::Vault(v), .. }) => { vaults.insert(*v); }
                        Action::Settings { .. } | Action::Share(Sharing::Owner { .. } | Sharing::Device { .. })
                        | Action::Revoke(Revoking::Owner { .. } | Revoking::Device { .. }) | Action::Keys { .. } => {}
                        // Checkpoint standing/coverage introduces another
                        // dependency surface; leave it conservative for now.
                        _ => return None,
                    }
                }
                if !genesis { return None; }
                required.insert(log);
                continue;
            }
            break;
        }
        let audience = LogId::Audience(owner.vault, AudienceId::of(owner.vault, &[]));
        if announced.logs.contains_key(&audience) {
            required.insert(audience);
            if let Some(held) = held(audience)? {
                let positions = &held.edits;
                inspected = inspected.checked_add(positions.len())?;
                if inspected > 2048 { return None; }
                for &at in positions {
                    if !independent(*ids.get(at)?) { return None; }
                }
            } else { missing.insert(audience); }
        }
        (required.len() <= MAX_CLASSES).then_some(OwnerDependencies { required, missing })
    }
}

impl crate::Shared {
    /// Fetch only missing immutable grant classifiers using ordinary disclosure.
    /// Four bounded requests per stage cap extra work; unknown remainder keeps
    /// conservative authority reconciliation. No returned descriptor is admitted
    /// as policy merely because it classifies an immutable log ID.
    pub(crate) async fn grant_classes(self: &std::sync::Arc<Self>, peer: &crate::Peer, inventory: BTreeSet<ShareId>) -> Option<GrantClasses> {
        use avendb::{id::EditId, sync::LogId, wire::Wire};
        if inventory.len() > MAX_CLASSES { return None; }
        let wanted = inventory.clone();
        let mut classes = self.read(move |lab, me| {
            let mut classes = GrantClasses::default();
            for id in wanted {
                let edit_id = EditId(id.0);
                // Checkpoint-covered bare bodies do not establish a classifier.
                if !lab.independently_verified_edit(me, edit_id) { continue; }
                if let Some(class) = lab.signed_edit(me, edit_id).and_then(|s| GrantClass::from_verified(id, &s.edit)) {
                    classes.0.insert(id, class);
                }
            }
            classes
        }).await;
        let unknown: Vec<_> = inventory.iter().filter(|id| !classes.0.contains_key(id)).copied().take(4).collect();
        for id in unknown {
            let device = peer.device;
            let request = self.read(move |lab, me| {
                let mut request = lab.request(me, device);
                request.ask.haves.clear();
                request.ask.haves.insert(LogId::Share(id), vec![]);
                request.ask.loose.clear();
                request.wants.clear();
                request.after = None;
                request.to_wire()
            }).await;
            if request.len() >= crate::session::MESSAGE_LIMIT { return None; }
            let page = self.pulls.page(false, false).await.ok()?;
            let (reply, _) = self.reply_to(peer, crate::session::ASK_LOGS, &request, crate::authority_stage::MAX_BYTES).await.ok()?;
            let candidate = reply.edits.into_iter().find(|signed| ShareId::from(signed.edit.id()) == id)?;
            let checking = self.receive_checking.clone().lock_owned().await;
            #[cfg(not(target_arch = "wasm32"))]
            let class = tokio::task::spawn_blocking(move || {
                let (_page, _checking) = (page, checking);
                GrantClass::verify(id, &candidate)
            }).await.ok()??;
            #[cfg(target_arch = "wasm32")]
            let class = {
                let class = GrantClass::verify(id, &candidate)?;
                drop(page); drop(checking);
                n0_future::time::sleep(std::time::Duration::ZERO).await;
                class
            };
            classes.0.insert(id, class);
        }
        classes.over(&inventory, VaultId([0; 32]))?;
        Some(classes)
    }
}

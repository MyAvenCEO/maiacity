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
    covered: bool,
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
            parent: grant.parent, group: grant.group, via: via.clone(), covered: false })
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
        // A checkpoint-backed negative classifier must be revalidated on every
        // admission, even when its immutable descriptor says "unrelated".
        classes.0.get_mut(&grant).unwrap().covered=true;
        assert!(classes.owner_scope_provenance(&shape, all, log.ids(), &local, &announced,
            |id| if id==EditId(grant.0) {None} else {Some(vec![])}).is_none());
        let provenance_scope=classes.owner_scope_provenance(&shape, all, log.ids(), &local, &announced,
            |id| Some(if id==EditId(grant.0) {vec![w.bob]} else {vec![]})).unwrap();
        assert!(provenance_scope.contains(&LogId::Vault(w.bob)));
        classes.0.get_mut(&grant).unwrap().covered=false;

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
    fn moved_owner_cut_retains_historical_audiences_and_rejects_missing_stays() {
        use avendb::{cast::{document, by_id}, sync::{log_of, LogId}};
        let mut w = world();
        let entry = w.lab.create(w.mac_a, w.alice, w.alice, "room", &[], document("Shared", "body", w.mac_a)).unwrap();
        let grant = w.lab.issue(w.mac_a, &[w.mac_a], share(w.alice, Who::Vault(w.bob), Level::Read, by_id(entry))).unwrap();
        w.lab.edit(w.mac_a, w.alice, entry, |item| item.set_text(2, "after move")).unwrap();
        let log = w.lab.log(w.mac_a);
        let indexed = crate::holdings::Logs::of(log.edits(), log.ids(), w.lab.size(w.mac_a));
        let frontier = &indexed.frontiers()[&LogId::Entry(entry)];
        let target: Vec<_> = log.edits().iter().filter(|e| log_of(e,e.id()) == Some(LogId::Entry(entry)))
            .map(|e| w.lab.signed_edit(w.mac_a,e.id()).unwrap().clone()).collect();
        let owner = OwnerEntry::complete(entry, &target, frontier).expect("owner writes with authenticated move history");
        assert!(owner.audiences.contains(&vec![]));
        assert!(owner.audiences.contains(&vec![grant]));
        assert!(owner.named_shares.contains(&grant));
        let without_marks: Vec<_> = target.iter().filter(|s| !matches!(s.edit.action, Action::Mark { .. })).cloned().collect();
        assert!(OwnerEntry::complete(entry, &without_marks, frontier).is_none(), "a stay's signed move cannot be omitted");
        let mut foreign = target.clone();
        let write = foreign.iter_mut().find(|s| matches!(s.edit.action, Action::Write { create: None, .. })).unwrap();
        if let Action::Write { actor, .. } = &mut write.edit.action { *actor = w.bob; }
        assert!(OwnerEntry::complete(entry, &foreign, frontier).is_none(), "non-owner writes need their own capability/group closure");
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

/// A bounded complete target cut whose writes act for the owning vault.
/// Historical audience moves and target-only key links retain every named
/// dependency. Non-owner writes still require cap-group/readings tracing.
pub(crate) struct OwnerEntry {
    pub vault: VaultId,
    pub via: BTreeSet<VaultId>,
    pub audiences: BTreeSet<Vec<ShareId>>,
    pub named_shares: BTreeSet<ShareId>,
}
impl OwnerEntry {
    pub(crate) fn from_base(base: &avendb::lab::OwnerBaseScope, entry: EntryId, suffix: &[Signed]) -> Option<Self> {
        let mut via = base.via().clone();
        let mut ids = base.writes().clone();
        ids.extend(suffix.iter().map(|s| s.edit.id()));
        if suffix.len() > 64 { return None; }
        for signed in suffix {
            let Action::Write { vault, entry: e, actor, create, proposal, stay, deps, via: path, .. } = &signed.edit.action else { return None };
            if *e != entry || *vault != base.vault() || actor != vault || create.is_some()
                || *proposal != avendb::policy::Proposal::Main || path.len() > MAX_VIA
                || stay.is_some_and(|stay| !base.stays().contains(&stay))
                || deps.iter().any(|id| !ids.contains(id)) { return None; }
            via.extend(path.iter().copied());
        }
        if via.len() > MAX_CLASSES { return None; }
        Some(Self { vault: base.vault(), via, audiences: base.audiences().clone(), named_shares: base.shares().clone() })
    }
    pub(crate) fn complete(entry: EntryId, edits: &[Signed], frontier: &avendb::wire::Frontier) -> Option<Self> {
        Self::from_parts(entry, edits.iter().map(|signed| (signed.edit.id(), &signed.edit)), frontier)
    }

    pub(crate) fn from_parts<'a>(entry: EntryId, edits: impl IntoIterator<Item = (avendb::id::EditId, &'a avendb::policy::Edit)>, frontier: &avendb::wire::Frontier) -> Option<Self> {
        use avendb::{id::EditId, policy::Proposal, keys::KeyName};
        if !frontier.waiting.is_empty() { return None; }
        let mut vault = None;
        let mut via = BTreeSet::new();
        let mut creation = false;
        let mut audiences = BTreeSet::new();
        let mut named_shares = BTreeSet::new();
        let mut stays = BTreeSet::new();
        let mut used_stays = BTreeSet::new();
        let mut graph = BTreeMap::new();
        let mut dependencies = BTreeSet::new();
        let mut links = 0usize;
        for (id, edit) in edits {
            if graph.contains_key(&id) { continue; }
            if graph.len() >= 64 { return None; }
            let mut path: &[VaultId] = &[];
            let mut deps: &[EditId] = &[];
            let mut declared_vault = None;
            let mut remember_stay = |name: KeyName| -> Option<()> {
                let KeyName::Entry(e, stay, _) = name else { return None };
                if e != entry { return None; }
                if let Some(stay) = stay { used_stays.insert(stay); }
                Some(())
            };
            match &edit.action {
                Action::Write { vault: v, entry: e, actor, stay, via: via_path, create, proposal, deps: dependencies, .. } => {
                    if *e != entry || actor != v || *proposal != Proposal::Main { return None; }
                    declared_vault = Some(*v); path = via_path; deps = dependencies;
                    if let Some(stay) = stay { used_stays.insert(*stay); }
                    if let Some(create) = create {
                        if creation || stay.is_some() || !deps.is_empty() { return None; }
                        if create.audience.len() > MAX_CLASSES || !create.audience.windows(2).all(|w| w[0] < w[1]) { return None; }
                        audiences.insert(create.audience.clone());
                        named_shares.extend(create.audience.iter().copied());
                        creation = true;
                    }
                }
                Action::Mark { vault: v, entry: e, caps, wants, keep, via: via_path } => {
                    if *e != entry { return None; }
                    declared_vault = Some(*v); path = via_path; deps = keep;
                    if let Some(caps) = caps {
                        if caps.len() > MAX_CLASSES || !caps.windows(2).all(|w| w[0] < w[1]) { return None; }
                        audiences.insert(caps.clone()); named_shares.extend(caps.iter().copied()); stays.insert(id);
                    }
                    if let Some(wants) = wants {
                        if wants.len() > MAX_CLASSES { return None; }
                        named_shares.extend(wants.iter().copied());
                    }
                }
                Action::Wraps { entry: e, wraps } => {
                    if *e != entry || wraps.len() > 64 { return None; }
                    for wrap in wraps { remember_stay(wrap.name)?; remember_stay(wrap.boxed.to.name())?; }
                }
                Action::Keys { name, boxes, .. } => {
                    if boxes.len() > 64 { return None; }
                    remember_stay(*name)?;
                    for boxed in boxes { remember_stay(boxed.to.name())?; }
                }
                _ => return None,
            }
            if let Some(v) = declared_vault {
                if vault.replace(v).is_some_and(|old| old != v) { return None; }
            }
            if path.len() > MAX_VIA { return None; }
            via.extend(path.iter().copied());
            if via.len() > MAX_CLASSES || audiences.len() > 64 || named_shares.len() > MAX_CLASSES { return None; }
            links = links.checked_add(edit.parents.len())?.checked_add(deps.len())?;
            if links > 1024 { return None; }
            dependencies.extend(deps.iter().copied());
            graph.insert(id, edit.parents.clone());
        }
        if !creation || !used_stays.is_subset(&stays) { return None; }
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
        Some(Self { vault: vault?, via, audiences, named_shares })
    }

}

pub(crate) struct OwnerDependencies {
    pub required: BTreeSet<avendb::sync::LogId>,
    pub missing: BTreeSet<avendb::sync::LogId>,
}

impl GrantClasses {
    /// Close a direct-owner entry's historical authority reads against
    /// an already classified authenticated inventory. No policy checks are
    /// skipped: the result only replaces unrelated log waits at the admission
    /// fence. Non-owner write and checkpoint shapes never reach this function.
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

    pub(crate) fn owner_scope_provenance(
        &self, owner: &OwnerEntry, edits: &[avendb::policy::Edit], ids: &[avendb::id::EditId],
        logs: &crate::holdings::Logs, announced: &crate::Holdings,
        provenance: impl Fn(avendb::id::EditId) -> Option<Vec<VaultId>>,
    ) -> Option<BTreeSet<avendb::sync::LogId>> {
        let dependencies=self.owner_dependencies_provenance(owner,edits,ids,logs,announced,provenance)?;
        dependencies.missing.is_empty().then_some(dependencies.required)
    }

    /// Missing current frontiers are transfer hints only. Their contents must be
    /// received normally before we can walk any deeper dependencies or admit.
    pub(crate) fn owner_dependencies(
        &self, owner: &OwnerEntry, edits: &[avendb::policy::Edit], ids: &[avendb::id::EditId],
        logs: &crate::holdings::Logs, announced: &crate::Holdings,
        independent: impl Fn(avendb::id::EditId) -> bool,
    ) -> Option<OwnerDependencies> {
        self.owner_dependencies_provenance(owner,edits,ids,logs,announced,
            |id| independent(id).then(Vec::new))
    }

    pub(crate) fn owner_dependencies_provenance(
        &self, owner: &OwnerEntry, edits: &[avendb::policy::Edit], ids: &[avendb::id::EditId],
        logs: &crate::holdings::Logs, announced: &crate::Holdings,
        provenance: impl Fn(avendb::id::EditId) -> Option<Vec<VaultId>>,
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
        shares.extend(owner.named_shares.iter().copied());
        let mut vaults = owner.via.clone();
        vaults.insert(owner.vault);
        // Covered negative classifiers are revalidated, including unrelated IDs.
        for id in &inventory {
            if self.0[id].covered { vaults.extend(provenance(avendb::id::EditId(id.0))?); }
        }
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
        for shares in &owner.audiences {
        let audience = LogId::Audience(owner.vault, AudienceId::of(owner.vault, shares));
        if announced.logs.contains_key(&audience) {
            required.insert(audience);
            if let Some(held) = held(audience)? {
                let positions = &held.edits;
                inspected = inspected.checked_add(positions.len())?;
                if inspected > 2048 { return None; }
                for &at in positions {
                    vaults.extend(provenance(*ids.get(at)?)?);
                }
            } else { missing.insert(audience); }
        }
        }
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
                    vaults.extend(provenance(*ids.get(at)?)?);
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
                    vaults.extend(provenance(*ids.get(at)?)?);
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
                        // A signed Snapshot only checks this vault's approval;
                        // unlike Checkpoint it never substitutes for signatures.
                        Action::Checkpoint { .. } | Action::Snapshot { .. } | Action::Settings { .. } | Action::Share(Sharing::Owner { .. } | Sharing::Device { .. })
                        | Action::Revoke(Revoking::Owner { .. } | Revoking::Device { .. }) | Action::Keys { .. } => {}
                        // Unknown governance shapes remain conservative.
                        _ => return None,
                    }
                }
                if !genesis { return None; }
                required.insert(log);
                continue;
            }
            break;
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
                if lab.authority_edit_dependencies(me, edit_id).is_none() { continue; }
                if let Some(mut class) = lab.signed_edit(me, edit_id).and_then(|s| GrantClass::from_verified(id, &s.edit)) {
                    class.covered = !lab.independently_verified_edit(me, edit_id);
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

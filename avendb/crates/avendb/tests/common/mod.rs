//! The people and vaults of the plan's scenarios, the same cast as `avendb/spec/AvenDB/Examples.lean`: on one log for
//! the rules (`cast`, signers by number), and on the Lab (`avendb::cast`: `world`, real devices and keys). What no rule
//! reads travels sealed or encrypted in the core: a share's selector, a new entry's header, a write's tags. On the
//! rules' log they travel as nothing, and what a reader would open of them goes into the cast's `Readings`.
#![allow(dead_code)]

pub use avendb::cast::*;
use avendb::id::{EditId, EntryId, ShareId, SignerId, VaultId};
use avendb::policy::{mk_audience, Action, Kind, Level, Log, Principal, Proposal, Readings, Refusal, Share, Who};
use avendb::slice::{Header, Selector, Sym, TagDelta};

// Signers on the rules' log: passkeys and device keys.
pub const PASSKEY_A: SignerId = SignerId::from_u64(1);
pub const MAC_A: SignerId = SignerId::from_u64(2);
pub const PHONE_A: SignerId = SignerId::from_u64(3);
pub const PASSKEY_B: SignerId = SignerId::from_u64(4);
pub const MAC_B: SignerId = SignerId::from_u64(5);
pub const PASSKEY_C: SignerId = SignerId::from_u64(6);
pub const MAC_C: SignerId = SignerId::from_u64(7);
pub const PASSKEY_D: SignerId = SignerId::from_u64(8);
pub const MAC_D: SignerId = SignerId::from_u64(9);
pub const NEW_DEVICE: SignerId = SignerId::from_u64(77);
pub const STRANGER: SignerId = SignerId::from_u64(555);

// Entries on the rules' log.
pub const WELCOME: EntryId = EntryId::from_u64(1);
pub const CHARTER: EntryId = EntryId::from_u64(2);
pub const ONBOARDING: EntryId = EntryId::from_u64(3);
pub const DOOR: EntryId = EntryId::from_u64(21);
pub const SEEDS: EntryId = EntryId::from_u64(22);
pub const SOLAR: EntryId = EntryId::from_u64(23);
pub const PLAN: EntryId = EntryId::from_u64(24);
pub const DIARY: EntryId = EntryId::from_u64(25);
pub const LAMP: EntryId = EntryId::from_u64(26);

/// The rules' log after scenarios 1 and 2: Alice with her passkey, Mac and iPhone; Bob, Carol and Dave with a passkey
/// and a Mac each. `readings` holds what the readers of its shares and entries open.
pub struct Cast {
    pub log: Log,
    pub alice: VaultId,
    pub bob: VaultId,
    pub carol: VaultId,
    pub dave: VaultId,
    pub readings: Readings,
}

/// A human vault whose passkey is its only owner and its root, with its devices.
pub fn human(log: &mut Log, passkey: SignerId, devices: &[SignerId]) -> VaultId {
    let (owners, root) = (vec![Principal::Signer(passkey)], Some(passkey));
    let genesis = Action::Genesis { kind: Kind::Human, owners, threshold: 1, root, nonce: 0, seal_to: vec![] };
    let v = VaultId::from(log.append(passkey, &[], genesis).unwrap());
    for &d in devices {
        log.append(passkey, &[d], Action::AddDevice { vault: v, device: d, seal_to: None }).unwrap();
    }
    v
}

pub fn cast() -> Cast {
    let mut log = Log::new();
    let alice = human(&mut log, PASSKEY_A, &[MAC_A, PHONE_A]);
    let bob = human(&mut log, PASSKEY_B, &[MAC_B]);
    let carol = human(&mut log, PASSKEY_C, &[MAC_C]);
    let dave = human(&mut log, PASSKEY_D, &[MAC_D]);
    Cast { log, alice, bob, carol, dave, readings: Readings::default() }
}

/// Scenario 3: Maia Coop, owned by Alice and Bob with threshold 2; Bob's passkey consents.
pub fn with_coop(c: &mut Cast) -> VaultId {
    let owners = vec![Principal::Vault(c.alice), Principal::Vault(c.bob)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 2, root: None, nonce: 0, seal_to: vec![] };
    VaultId::from(c.log.append(PASSKEY_A, &[PASSKEY_B], genesis).unwrap())
}

fn syms(xs: &[&str]) -> Vec<Sym> {
    xs.iter().map(|&x| Sym::new(x)).collect()
}

/// A write that creates entry `entry` of vault `vault` for `actor`, in the audience of the shares `audience`; its
/// header and tags travel in its body, which here is nothing anyone opens.
pub fn creation(vault: VaultId, entry: EntryId, actor: VaultId, audience: &[ShareId]) -> Action {
    let (body, proposal, create) = (vec![0xc1, 0x9e, 0x47], Proposal::Main, Some(mk_audience(audience)));
    let (deps, via, files) = (vec![], vec![], vec![]);
    Action::Write { vault, entry, actor, stay: None, epoch: 0, deps, proposal, via, create, files, body }
}

impl Cast {
    /// `signer` creates entry `entry` of vault `vault` for `actor`, of type `ty` with tags `tags`, in the audience of
    /// the shares `audience`; its readers read the header and tags.
    #[allow(clippy::too_many_arguments)]
    pub fn create(
        &mut self,
        signer: SignerId,
        vault: VaultId,
        entry: EntryId,
        actor: VaultId,
        audience: &[ShareId],
        ty: &str,
        tags: &[&str],
    ) -> Result<EditId, Refusal> {
        let id = self.log.append(signer, &[], creation(vault, entry, actor, audience))?;
        self.readings.headers.insert(id, Header { ty: Sym::new(ty), created: 0 });
        self.readings.tags.insert(id, TagDelta { add: syms(tags), remove: vec![] });
        Ok(id)
    }

    /// `signer`, with `cosigners`, issues a root share over vault `over` to `who` with `level` on what `select`
    /// selects; its readers read the selector.
    pub fn issue(
        &mut self,
        signer: SignerId,
        cosigners: &[SignerId],
        over: VaultId,
        who: Who,
        level: Level,
        select: Selector,
    ) -> Result<ShareId, Refusal> {
        self.issue_on(signer, cosigners, over, who, level, select, None, over, 0)
    }

    /// `issue`, resting on the owner share `parent` that `issuer` holds, if any, with `nonce` to tell it from a share
    /// that says the same.
    #[allow(clippy::too_many_arguments)]
    pub fn issue_on(
        &mut self,
        signer: SignerId,
        cosigners: &[SignerId],
        over: VaultId,
        who: Who,
        level: Level,
        select: Selector,
        parent: Option<ShareId>,
        issuer: VaultId,
        nonce: u64,
    ) -> Result<ShareId, Refusal> {
        let wide = select == Selector::All;
        let share = Share { over, who, level, wide, select: vec![], parent, issuer, nonce };
        let id = ShareId::from(self.log.append(signer, cosigners, Action::Share(share, vec![]))?);
        self.readings.selectors.insert(id, select);
        Ok(id)
    }

    /// `signer`, a steward acting for vault `vault`, moves entry `entry` to the audience of the shares `to`, keeping
    /// every write of it.
    pub fn move_to(
        &mut self,
        signer: SignerId,
        vault: VaultId,
        entry: EntryId,
        to: &[ShareId],
    ) -> Result<EditId, Refusal> {
        let keep = self.log.view().writes(entry);
        let to = mk_audience(to);
        self.log.append(signer, &[], Action::Move { vault, entry, to, keep, via: vec![] })
    }

    /// `signer` writes entry `entry` for `actor`, under its current stay and epoch, adding the tags `add` and
    /// removing `remove`; the tags count only when it acts for the entry's vault.
    pub fn retag(
        &mut self,
        signer: SignerId,
        entry: EntryId,
        actor: VaultId,
        add: &[&str],
        remove: &[&str],
    ) -> Result<EditId, Refusal> {
        let st = self.log.view();
        let en = st.entry(entry).ok_or(Refusal::UnknownEntry)?;
        let epoch = st.epoch(avendb::keys::KeyFam::Audience(en.vault, en.audience()));
        let id = self.log.append(signer, &[], write(en.vault, entry, actor, en.stay(), epoch))?;
        self.readings.tags.insert(id, TagDelta { add: syms(add), remove: syms(remove) });
        Ok(id)
    }

    /// Every entry where a steward would move it, moved there by `signer`, acting for its vault.
    pub fn tidy(&mut self, signer: SignerId) {
        let st = self.log.view();
        let moves: Vec<(VaultId, EntryId, Vec<ShareId>)> = st
            .entries()
            .iter()
            .filter_map(|en| Some((en.vault, en.id, st.meaning(en.id, &self.readings)?.desired?)))
            .collect();
        for (vault, entry, to) in moves {
            self.move_to(signer, vault, entry, &to).unwrap();
        }
    }
}

/// The rules' side of scenario 15: three todos in Alice's vault, the door todo shared with Bob (write), Carol (read)
/// and the coop (owner, which needs Alice's passkey), each by a share on the door todo alone; and Alice's Mac, a
/// steward, has moved the door todo into the audience of the three shares.
pub struct SocialTodo {
    pub c: Cast,
    pub coop: VaultId,
    pub bob_write: ShareId,
    pub carol_read: ShareId,
    pub coop_owner: ShareId,
}

pub fn social_todo() -> SocialTodo {
    let mut c = cast();
    let coop = with_coop(&mut c);
    let alice = c.alice;
    for (e, tag) in [(DOOR, "work"), (SEEDS, "home"), (SOLAR, "work")] {
        c.create(MAC_A, alice, e, alice, &[], "todo", &[tag]).unwrap();
    }
    let door = by_id(DOOR);
    let bob_write = c.issue(MAC_A, &[], alice, vault(c.bob), Level::Write, door.clone()).unwrap();
    let carol_read = c.issue(MAC_A, &[], alice, vault(c.carol), Level::Read, door.clone()).unwrap();
    let coop_owner = c.issue(PASSKEY_A, &[], alice, vault(coop), Level::Owner, door).unwrap();
    c.tidy(MAC_A);
    SocialTodo { c, coop, bob_write, carol_read, coop_owner }
}

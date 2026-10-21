//! What the server backs up for each person (`Quota.lean`). The server of `home` (avenMAIA's device, serving Maia City)
//! keeps every edit the vaults bring it, as they are small and every device needs them, and each person's files only
//! up to a limit, named after the cap group of `home` they hold (`Limits`, `limit_of`): a Traveler's and a Citizen's,
//! as the server is told (avendb-server's `AVENDB_BACKUP_LIMITS`). An admin of `home` (`gate::is_admin`) has no limit,
//! and where no limit is said nobody has one. A person who holds none of the groups that have one takes the least of
//! them, so a share revoked never lifts their limit.
//!
//! A person's backup is what the server keeps that their devices brought (`Brought`): each edit and each file, by the
//! device that signed the edit bringing it, counted against the person of the vault that device acts for (`payer`): a
//! human vault for itself, and any other for the person of its one owner vault, up the chain. A vault of several
//! owners, or a signer that is no device, counts against nobody.
//!
//! The server takes what it is brought in the order it comes (`Ledger`): an edit always, a file where its person has no
//! limit or the bytes it keeps for them, with the file's, are within it (`Ledger::keeps`). It never drops what it kept.

use std::collections::HashMap;

use crate::gate;
use crate::id::{SignerId, VaultId};
use crate::policy::{Groups, Kind, Principal, State};

/// The most bytes the server keeps for a person, by the name of a cap group of `home` they hold (`Limits`).
pub type Limits = Vec<(String, u64)>;

/// The person whose backup vault `v`'s bytes count against (`payer`): `v` itself for a human vault; for any other, the
/// person of its one owner vault, up the chain; none for a vault of several owners or one a signer owns.
pub fn payer(st: &State, v: VaultId) -> Option<VaultId> {
    let mut v = v;
    for _ in 0..st.vaults().len() + 1 {
        let vt = st.vault(v)?;
        match (vt.kind, &vt.owners[..]) {
            (Kind::Human, _) => return Some(v),
            (_, [Principal::Vault(o)]) => v = *o,
            _ => return None,
        }
    }
    None
}

/// The person what device `d` signs counts against (`payerOf`): the person of the vault it is a device of.
pub fn payer_of(st: &State, d: SignerId) -> Option<VaultId> {
    gate::device_vault(st, d).and_then(|v| payer(st, v))
}

/// The limits of `limits` whose groups person `u` holds of `home`, the cap groups in force by `groups`.
fn held<'a>(st: &State, groups: &Groups, home: VaultId, u: VaultId, limits: &'a Limits) -> Vec<&'a (String, u64)> {
    limits.iter().filter(|(name, _)| gate::holds_group(st, groups, home, u, name)).collect()
}

/// The most bytes the server of `home` keeps for person `u` by `limits` (`limitOf`): none where no limit is said and
/// for an admin of `home`; else the largest limit of the groups `u` holds, and holding none of them, the least.
pub fn limit_of(st: &State, groups: &Groups, home: VaultId, u: VaultId, limits: &Limits) -> Option<u64> {
    standing(st, groups, home, u, limits).map(|(bytes, _)| bytes)
}

/// `limit_of`, with the name of the group it is: the strongest `u` holds, or none for the least, as a page says it
/// ("Traveler").
pub fn standing(
    st: &State,
    groups: &Groups,
    home: VaultId,
    u: VaultId,
    limits: &Limits,
) -> Option<(u64, Option<String>)> {
    if limits.is_empty() || gate::is_admin(st, groups, home, u) {
        return None;
    }
    match held(st, groups, home, u, limits).into_iter().max_by_key(|(_, bytes)| *bytes) {
        Some((name, bytes)) => Some((*bytes, Some(name.clone()))),
        None => limits.iter().map(|(_, bytes)| *bytes).min().map(|least| (least, None)),
    }
}

/// What the server keeps, or is offered (`Brought`): an edit or a file (`file`) of `size` bytes, brought by an edit
/// device `signer` signed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Brought {
    pub signer: SignerId,
    pub size: u64,
    pub file: bool,
}

/// What the server of `home` keeps for each person, by `limits`, as it takes what it is brought (`keepAll`): the bytes
/// it keeps for each, and each person's limit, worked out once.
pub struct Ledger<'a> {
    st: &'a State,
    groups: &'a Groups,
    home: VaultId,
    limits: &'a Limits,
    used: HashMap<VaultId, u64>,
    limit: HashMap<VaultId, Option<u64>>,
}

impl<'a> Ledger<'a> {
    /// A ledger of nothing kept yet.
    pub fn new(st: &'a State, groups: &'a Groups, home: VaultId, limits: &'a Limits) -> Ledger<'a> {
        Ledger { st, groups, home, limits, used: HashMap::new(), limit: HashMap::new() }
    }

    /// The person what `signer` signs counts against (`payer_of`).
    pub fn payer(&self, signer: SignerId) -> Option<VaultId> {
        payer_of(self.st, signer)
    }

    /// Person `p`'s limit (`limit_of`).
    pub fn limit(&mut self, p: VaultId) -> Option<u64> {
        let (st, groups, home, limits) = (self.st, self.groups, self.home, self.limits);
        *self.limit.entry(p).or_insert_with(|| limit_of(st, groups, home, p, limits))
    }

    /// The bytes it keeps for person `p` (`used`).
    pub fn used(&self, p: VaultId) -> u64 {
        self.used.get(&p).copied().unwrap_or(0)
    }

    /// It keeps `b` now (`keepsItem`): an edit always; a file where its person has no limit, or the bytes it keeps for
    /// them with the file's are within it.
    pub fn keeps(&mut self, b: &Brought) -> bool {
        if !b.file {
            return true;
        }
        let Some(p) = self.payer(b.signer) else { return true };
        match self.limit(p) {
            None => true,
            Some(limit) => self.used(p).saturating_add(b.size) <= limit,
        }
    }

    /// Counts `b` as kept, whether or not it would keep it now: what it kept before, which it never drops.
    pub fn kept(&mut self, b: &Brought) {
        if let Some(p) = self.payer(b.signer) {
            *self.used.entry(p).or_default() += b.size;
        }
    }

    /// Takes `b` (`keepAll`'s step): counts it if it keeps it. Whether it keeps it.
    pub fn take(&mut self, b: &Brought) -> bool {
        let keeps = self.keeps(b);
        if keeps {
            self.kept(b);
        }
        keeps
    }
}

/// Whether the server of `home` keeps each of `items`, taken in order, holding nothing of them before (`keepAll`).
pub fn keep_all(st: &State, groups: &Groups, home: VaultId, limits: &Limits, items: &[Brought]) -> Vec<bool> {
    let mut ledger = Ledger::new(st, groups, home, limits);
    items.iter().map(|b| ledger.take(b)).collect()
}

/// The service a device's pass names to ask the server about its person's backup (`backupAudience`): a name of its
/// own, so a pass the device made for another service never asks it.
pub const BACKUP_AUDIENCE: &str = "avenDB backup";

/// What the server holds for each person by its limits, as it worked it out once (`book`): the vault it serves, each
/// person's limit with the strongest group they hold, the bytes of the edits it keeps for each, and the person each
/// file counts against, the first edit's that brings it.
#[derive(Clone, Debug, Default)]
pub struct Book {
    pub home: Option<VaultId>,
    pub standing: HashMap<VaultId, Option<(u64, Option<String>)>>,
    pub edits: HashMap<VaultId, u64>,
    pub files: HashMap<crate::sealed::FileRoot, Option<VaultId>>,
}

impl Book {
    /// Person `p`'s limit, none for no limit.
    pub fn limit(&self, p: VaultId) -> Option<u64> {
        self.standing.get(&p).and_then(|s| s.as_ref()).map(|(bytes, _)| *bytes)
    }
}

/// What device `me` of `lab`, the server of the seed's coop, Maia City (`world::seed_of`), holds for each person by
/// `limits`: a book that limits nobody where it serves no coop or no limit is said. It weighs every edit it holds by
/// its bytes on the wire, so it is worked out now and then, not on every edit.
pub fn book(lab: &crate::lab::Lab, me: SignerId, limits: &Limits) -> Book {
    use crate::wire::Wire as _;
    let Some(&home) = crate::world::seed_of(lab, me).first() else { return Book::default() };
    let mut book = Book { home: Some(home), ..Book::default() };
    if limits.is_empty() {
        return book;
    }
    let (st, groups) = (lab.state(me), lab.read_groups(me));
    let mut payers: HashMap<SignerId, Option<VaultId>> = HashMap::new();
    for edit in lab.log(me).edits() {
        let p = *payers.entry(edit.author).or_insert_with(|| payer_of(st, edit.author));
        if let Some(p) = p {
            *book.edits.entry(p).or_default() += edit.to_wire().len() as u64;
            book.standing.entry(p).or_insert_with(|| standing(st, &groups, home, p, limits));
        }
        for f in edit.files() {
            book.files.entry(*f).or_insert(p);
        }
    }
    book
}

/// The person whose backup the device of pass `pass` asks about at `now`, by device `me` of `lab`, the server of Maia
/// City (`backupOf`): the person of the vault its device is a device of, where the pass counts for `BACKUP_AUDIENCE`;
/// none otherwise.
pub fn backup_standing(lab: &crate::lab::Lab, me: SignerId, pass: &crate::sign::ApiPass, now: u64) -> Option<VaultId> {
    let (v, _) = crate::world::pass_standing(lab, me, pass, BACKUP_AUDIENCE, now)?;
    payer(lab.state(me), v)
}

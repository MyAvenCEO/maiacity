//! A network that keeps its members (`Aven.ID.Invite`'s `Members`): its claim and the claimant's sign-ins
//! ([`Network`]), then the admin's invites and withdrawals, the joins and the members' sign-ins, each in the order it
//! came. Every step returns the next state and
//! leaves this one as it was, so the Aven Peer stores a statement first and takes the new state once its ref is set.
//!
//! Members belong to the admin coop, not to the agent (Samuel, 30 Oct 2026): Maia City is the community, and Aven, the
//! agent it owns, runs the network for it. So the coop invites: its passkeys are those that own a vault governing the
//! coop (`admin_key`). The door ([`Members::admits`]) hangs on the coop's membership: it lets in the devices of the
//! coop's members, the devices of the vaults that govern the coop and the agent's own devices; a browser that is no
//! device yet only for a statement the network would take from it now ([`Members::newcomer`]).
//!
//! Every person whose vault the tree holds signs in with their passkey (`Aven.ID.SignIn`): the statement names no
//! passkey, since a browser learns which one signed only from the assertion, so the passkey is found by it, the
//! claimant's or a member's ([`Members::accept_sign_in`]). The new browser is a device of that passkey's own vault,
//! and counters are kept per passkey.

use std::fmt;

use crate::claim::{Claim, SignIn, browser_name};
use crate::invite::{Invite, Join, Withdrawal, invite_id};
use crate::network::{ClaimError, Network};
use crate::passkey::{Assertion, AssertionError, Passkey, challenge};
use crate::tree::{Invalid, Kind, Owner, Tree, Vault, valid_person_name};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MemberError {
    /// A claim or a sign-in refused, as [`Network`] refuses it.
    Claim(ClaimError),
    Unclaimed,
    WrongNetwork,
    /// The person's name is none: 1 to 48 characters, no control characters.
    Name,
    /// The passkey is no admin's.
    NotAdmin,
    Assertion(AssertionError),
    /// An invite with this id exists already.
    KnownInvite,
    /// No invite has this one-time key.
    NoInvite,
    Used,
    Withdrawn,
    /// The one-time key did not sign exactly this join.
    BadInviteSignature,
    /// The join names another browser than the one that sent it.
    NotFromDevice,
    /// The join names a vault, a passkey or a browser the tree has; a sign-in a browser it has.
    Known,
    Invalid(Invalid),
    /// A sign-in by a passkey that owns no vault here.
    Stranger,
    /// A sign-in whose passkey's signature counter did not count up.
    Counter,
}

impl fmt::Display for MemberError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MemberError::Claim(why) => write!(f, "{why}"),
            MemberError::Unclaimed => write!(f, "nobody has claimed this network yet"),
            MemberError::WrongNetwork => write!(f, "the statement is for another network"),
            MemberError::Name => write!(f, "a name is 1 to 48 characters, on one line"),
            MemberError::NotAdmin => write!(f, "only the admin invites"),
            MemberError::Assertion(why) => write!(f, "{why}"),
            MemberError::KnownInvite => write!(f, "this invite exists already"),
            MemberError::NoInvite => write!(f, "there is no such invite"),
            MemberError::Used => write!(f, "this invite has been used"),
            MemberError::Withdrawn => write!(f, "this invite was withdrawn"),
            MemberError::BadInviteSignature => write!(f, "the invite's key did not sign this join"),
            MemberError::NotFromDevice => write!(f, "the join is for another browser"),
            MemberError::Known => write!(f, "this person, passkey or browser is known already"),
            MemberError::Invalid(why) => write!(f, "{why}"),
            MemberError::Stranger => write!(f, "this passkey isn't a member here"),
            MemberError::Counter => write!(
                f,
                "the passkey's counter did not count up: it may be a copy"
            ),
        }
    }
}

impl std::error::Error for MemberError {}

/// What a browser that is no device yet may bring to the door.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Pending {
    Claim(Claim),
    SignIn(SignIn),
    Join(Join),
}

/// A member's sign-in, as the network keeps it: the statement, and the join whose passkey signed it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemberSignIn {
    pub member: Join,
    pub sign_in: SignIn,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Members {
    network: Network,
    invites: Vec<Invite>,
    withdrawn: Vec<Withdrawal>,
    joins: Vec<Join>,
    sign_ins: Vec<MemberSignIn>,
}

impl Members {
    pub fn new(network: Network) -> Members {
        Members {
            network,
            invites: Vec::new(),
            withdrawn: Vec::new(),
            joins: Vec::new(),
            sign_ins: Vec::new(),
        }
    }

    pub fn network(&self) -> &Network {
        &self.network
    }

    pub fn invites(&self) -> &[Invite] {
        &self.invites
    }

    pub fn withdrawn(&self) -> &[Withdrawal] {
        &self.withdrawn
    }

    pub fn joins(&self) -> &[Join] {
        &self.joins
    }

    /// The members' sign-ins, in the order they came.
    pub fn sign_ins(&self) -> &[MemberSignIn] {
        &self.sign_ins
    }

    /// Every sign-in kept: the claimant's, then the members'.
    pub fn all_sign_ins(&self) -> Vec<SignIn> {
        let members = self.sign_ins.iter().map(|s| s.sign_in.clone());
        self.network
            .sign_ins()
            .iter()
            .cloned()
            .chain(members)
            .collect()
    }

    /// Why a statement was refused, as a person reads it: a stranger's passkey is told to ask for an invite.
    pub fn say(&self, e: &MemberError) -> String {
        match e {
            MemberError::Stranger => format!(
                "This passkey isn't a member of {}. Ask the admin for an invite.",
                self.network.coop_name
            ),
            e => e.to_string(),
        }
    }

    pub fn publics(&self) -> Vec<(String, String)> {
        let mut out = self.network.publics();
        for j in &self.joins {
            out.push((j.passkey.clone(), format!("es256:{}", j.passkey_key)));
            out.push((j.device.clone(), j.device_key.clone()));
        }
        for s in &self.sign_ins {
            out.push((s.sign_in.device.clone(), s.sign_in.device_key.clone()));
        }
        out
    }

    /// The tree's vaults: the network's, then each join's person vault and its browser, named after the person, then
    /// each member's browser that signed in, numbered after their join's and those they signed in before.
    pub fn vaults(&self) -> Vec<Vault> {
        let mut out = self.network.vaults();
        for j in &self.joins {
            out.push(Vault {
                id: j.person.clone(),
                name: format!("{}'s vault", j.name),
                kind: Kind::Person,
                owners: self.network.founders(&j.passkey),
                threshold: 1,
                key: None,
            });
            out.push(Vault {
                id: j.device.clone(),
                name: format!("{}'s browser", j.name),
                kind: Kind::Device,
                owners: vec![Owner::Vault(j.person.clone())],
                threshold: 1,
                key: Some(j.device.clone()),
            });
        }
        for (k, s) in self.sign_ins.iter().enumerate() {
            let person = &s.member.person;
            let before = self.sign_ins[..k]
                .iter()
                .filter(|x| &x.member.person == person)
                .count();
            out.push(Vault {
                id: s.sign_in.device.clone(),
                name: browser_name(&s.member.name, before + 2),
                kind: Kind::Device,
                owners: vec![Owner::Vault(person.clone())],
                threshold: 1,
                key: Some(s.sign_in.device.clone()),
            });
        }
        out
    }

    /// The tree once claimed; before, it fails only for the agent's missing owner.
    pub fn tree(&self) -> Result<Tree, Invalid> {
        Tree::new(self.publics(), self.vaults())
    }

    /// The admin coop, whose members the members are.
    pub fn coop(&self) -> &str {
        &self.network.coop
    }

    /// The members: the person vaults joins founded, members of the admin coop.
    pub fn members(&self) -> Vec<String> {
        self.joins.iter().map(|j| j.person.clone()).collect()
    }

    /// Whether `s` is a member of the coop `c`: the admin coop, and a join founded `s`.
    pub fn member_of(&self, s: &str, c: &str) -> bool {
        c == self.coop() && self.joins.iter().any(|j| j.person == s)
    }

    fn is_passkey(&self, k: &str) -> bool {
        self.publics()
            .iter()
            .any(|(id, p)| id == k && p.starts_with("es256:"))
    }

    /// Whether `k` signs for the admin coop: a passkey that owns a vault governing the coop.
    pub fn admin_key(&self, k: &str) -> bool {
        let Ok(tree) = self.tree() else {
            return false;
        };
        self.is_passkey(k)
            && tree.vaults().iter().any(|v| {
                v.owner_keys().any(|o| o == k) && tree.governs(&v.id).contains(&self.coop())
            })
    }

    fn invite(&self, key: &str) -> Option<&Invite> {
        self.invites.iter().find(|i| i.key == key)
    }

    fn used(&self, key: &str) -> bool {
        self.joins.iter().any(|j| j.invite == key)
    }

    fn is_withdrawn(&self, key: &str) -> bool {
        self.withdrawn.iter().any(|w| w.key == key)
    }

    /// What became of an invite: `open`, `used` or `withdrawn`.
    pub fn state(&self, key: &str) -> &'static str {
        if self.used(key) {
            "used"
        } else if self.is_withdrawn(key) {
            "withdrawn"
        } else {
            "open"
        }
    }

    /// Whether the tree has any of these ids, or any of these public halves.
    fn knows(&self, ids: &[&str], keys: &[&str]) -> bool {
        self.vaults().iter().any(|v| ids.contains(&v.id.as_str()))
            || self
                .publics()
                .iter()
                .any(|(id, k)| ids.contains(&id.as_str()) || keys.contains(&k.as_str()))
    }

    /// The admin's act, checked: a claimed network, an admin's passkey, and its assertion over `text`.
    fn admin_act(
        &self,
        network: &str,
        passkey: &str,
        text: &str,
        a: &Assertion,
    ) -> Result<(), MemberError> {
        if self.network.claim().is_none() {
            return Err(MemberError::Unclaimed);
        }
        if network != self.network.network {
            return Err(MemberError::WrongNetwork);
        }
        if !self.admin_key(passkey) {
            return Err(MemberError::NotAdmin);
        }
        check(&self.publics(), &self.network, passkey, text, a)
    }

    pub fn accept_invite(&self, i: Invite) -> Result<Members, MemberError> {
        self.admin_act(&i.network, &i.passkey, &i.text(), &i.assertion)?;
        if self
            .invites
            .iter()
            .any(|x| invite_id(&x.key) == invite_id(&i.key))
        {
            return Err(MemberError::KnownInvite);
        }
        let mut next = self.clone();
        next.invites.push(i);
        Ok(next)
    }

    pub fn accept_withdrawal(&self, w: Withdrawal) -> Result<Members, MemberError> {
        self.admin_act(&w.network, &w.passkey, &w.text(), &w.assertion)?;
        if self.invite(&w.key).is_none() {
            return Err(MemberError::NoInvite);
        }
        if self.used(&w.key) {
            return Err(MemberError::Used);
        }
        if self.is_withdrawn(&w.key) {
            return Err(MemberError::Withdrawn);
        }
        let mut next = self.clone();
        next.withdrawn.push(w);
        Ok(next)
    }

    /// A join's statement, checked: an open invite, its one-time key's signature, the passkey's assertion, nothing
    /// the tree has, and the tree it makes.
    pub fn accept_join(&self, j: Join) -> Result<Members, MemberError> {
        if self.network.claim().is_none() {
            return Err(MemberError::Unclaimed);
        }
        if j.network != self.network.network {
            return Err(MemberError::WrongNetwork);
        }
        if self.invite(&j.invite).is_none() {
            return Err(MemberError::NoInvite);
        }
        if self.used(&j.invite) {
            return Err(MemberError::Used);
        }
        if self.is_withdrawn(&j.invite) {
            return Err(MemberError::Withdrawn);
        }
        if !j.signed_by_invite() {
            return Err(MemberError::BadInviteSignature);
        }
        if !valid_person_name(&j.name) {
            return Err(MemberError::Name);
        }
        let passkey = Passkey::from_spki_hex(&j.passkey_key)
            .ok_or(MemberError::Assertion(AssertionError::BadSignature))?;
        j.assertion
            .check(&self.network.rp, &challenge(&j.text()), &passkey)
            .map_err(MemberError::Assertion)?;
        let es256 = format!("es256:{}", j.passkey_key);
        if self.knows(
            &[&j.person, &j.passkey, &j.device],
            &[&j.device_key, &es256],
        ) {
            return Err(MemberError::Known);
        }
        let mut next = self.clone();
        next.joins.push(j);
        next.tree().map_err(MemberError::Invalid)?;
        Ok(next)
    }

    /// A join as a browser sends it: from the browser it names, or for it on the invite's one-time key.
    pub fn submit_join(&self, from: &str, j: Join) -> Result<Members, MemberError> {
        if self.network.claim().is_none() {
            return Err(MemberError::Unclaimed);
        }
        if from != j.device_key && from != j.invite {
            return Err(MemberError::NotFromDevice);
        }
        self.accept_join(j)
    }

    /// The claim and sign-ins, as [`Network`] takes them, in a tree that holds with the members.
    fn with_network(&self, r: Result<Network, ClaimError>) -> Result<Members, MemberError> {
        let next = Members {
            network: r.map_err(MemberError::Claim)?,
            ..self.clone()
        };
        next.tree().map_err(MemberError::Invalid)?;
        Ok(next)
    }

    pub fn submit_claim(&self, from: &str, c: Claim) -> Result<Members, MemberError> {
        self.with_network(self.network.submit_claim(from, c))
    }

    /// A sign-in's passkey, found by its assertion: the claimant's (`None`), or the member whose join's passkey made
    /// it. An assertion that fails before its signature fails for every passkey alike.
    fn signer_of(&self, c: &Claim, i: &SignIn) -> Result<Option<Join>, MemberError> {
        let challenge = challenge(&i.text());
        let check = |spki: &str| match Passkey::from_spki_hex(spki) {
            Some(p) => i.assertion.check(&self.network.rp, &challenge, &p),
            None => Err(AssertionError::BadSignature),
        };
        match check(&c.passkey_key) {
            Ok(()) => Ok(None),
            Err(AssertionError::BadSignature) => self
                .joins
                .iter()
                .find(|j| check(&j.passkey_key).is_ok())
                .map(|j| Some(j.clone()))
                .ok_or(MemberError::Stranger),
            Err(why) => Err(MemberError::Assertion(why)),
        }
    }

    /// The last signature counter the network kept for the passkey `p`: its claim's or its join's, then each of its
    /// sign-ins'.
    fn last_counter(&self, p: &str) -> u32 {
        if self.network.claim().is_some_and(|c| c.passkey == p) {
            return self.network.last_counter();
        }
        let joined = self.joins.iter().filter(|j| j.passkey == p);
        let signed = self.sign_ins.iter().filter(|s| s.member.passkey == p);
        joined
            .map(|j| j.assertion.counter())
            .chain(signed.map(|s| s.sign_in.assertion.counter()))
            .last()
            .unwrap_or(0)
    }

    /// A passkey that counts must count up; synced ones keep it at 0.
    fn counts_back(&self, p: &str, i: &SignIn) -> bool {
        let (n, last) = (i.assertion.counter(), self.last_counter(p));
        (n != 0 || last != 0) && n <= last
    }

    /// A sign-in's statement, checked: its network, a browser the tree hasn't, the passkey that signed it, which owns
    /// a vault here, and that passkey's counter. The claimant's goes to [`Network`], a member's is kept here.
    pub fn accept_sign_in(&self, i: SignIn) -> Result<Members, MemberError> {
        let c = self.network.claim().ok_or(MemberError::Unclaimed)?;
        if i.network != self.network.network {
            return Err(MemberError::WrongNetwork);
        }
        if self.knows(&[&i.device], &[&i.device_key]) {
            return Err(MemberError::Known);
        }
        match self.signer_of(c, &i)? {
            None => {
                if self.counts_back(&c.passkey, &i) {
                    return Err(MemberError::Counter);
                }
                self.with_network(self.network.accept_sign_in(i))
            }
            Some(j) => {
                if self.counts_back(&j.passkey, &i) {
                    return Err(MemberError::Counter);
                }
                let mut next = self.clone();
                next.sign_ins.push(MemberSignIn {
                    member: j,
                    sign_in: i,
                });
                next.tree().map_err(MemberError::Invalid)?;
                Ok(next)
            }
        }
    }

    /// A sign-in as a browser sends it: from the browser it names.
    pub fn submit_sign_in(&self, from: &str, i: SignIn) -> Result<Members, MemberError> {
        if self.network.claim().is_none() {
            return Err(MemberError::Unclaimed);
        }
        if from != i.device_key {
            return Err(MemberError::NotFromDevice);
        }
        self.accept_sign_in(i)
    }

    /// What a browser brings, from the browser whose key is `from`.
    pub fn take(&self, from: &str, p: Pending) -> Result<Members, MemberError> {
        match p {
            Pending::Claim(c) => self.submit_claim(from, c),
            Pending::SignIn(i) => self.submit_sign_in(from, i),
            Pending::Join(j) => self.submit_join(from, j),
        }
    }

    /// An empty store: the network unclaimed again, without invites or members.
    pub fn wipe(&self) -> Members {
        Members::new(self.network.wipe())
    }

    /// The state read back from its stored statements: the claim, then the invites, withdrawals and joins, each
    /// checked again, in the order a store lists them: by their invite's id; then every sign-in in the order it came,
    /// so a member's finds the member.
    pub fn restore(
        &self,
        claim: Option<Claim>,
        sign_ins: Vec<SignIn>,
        invites: Vec<Invite>,
        withdrawn: Vec<Withdrawal>,
        joins: Vec<Join>,
    ) -> Result<Members, MemberError> {
        let network = self
            .network
            .restore(claim, Vec::new())
            .map_err(MemberError::Claim)?;
        let mut next = Members::new(network);
        // in the order a store lists their refs: by their invite's id
        let (mut invites, mut withdrawn, mut joins) = (invites, withdrawn, joins);
        invites.sort_by_key(|i| invite_id(&i.key));
        withdrawn.sort_by_key(|w| invite_id(&w.key));
        joins.sort_by_key(|j| invite_id(&j.invite));
        for i in invites {
            next = next.accept_invite(i)?;
        }
        for w in withdrawn {
            next = next.accept_withdrawal(w)?;
        }
        for j in joins {
            next = next.accept_join(j)?;
        }
        for i in sign_ins {
            next = next.accept_sign_in(i)?;
        }
        Ok(next)
    }

    /// Whether a device's vault is let in: the agent's own, a member's of the admin coop, or one that governs the coop.
    fn through(&self, tree: Option<&Tree>, s: &str) -> bool {
        s == self.network.network
            || self.member_of(s, self.coop())
            || tree.is_some_and(|t| t.governs(s).contains(&self.coop()))
    }

    /// The door, by key: the key of a device whose vault is let in. Before the claim the tree isn't well formed, for
    /// the agent's missing owner, and there is no coop yet: the agent's own device is let in, and nobody else.
    pub fn admits(&self, key: &str) -> bool {
        let tree = self.tree().ok();
        let vaults = self.vaults();
        let acts_for = |d: &str| {
            let v = vaults.iter().find(|v| v.id == d)?;
            if v.kind != Kind::Device {
                return None;
            }
            v.owner_vaults().next().map(str::to_string)
        };
        self.publics()
            .iter()
            .any(|(d, k)| k == key && acts_for(d).is_some_and(|s| self.through(tree.as_ref(), &s)))
    }

    /// The keys the door admits, in the tree's order.
    pub fn admitted(&self) -> Vec<String> {
        let keys: Vec<String> = self.publics().into_iter().map(|(_, k)| k).collect();
        keys.into_iter().filter(|k| self.admits(k)).collect()
    }

    /// The relay and the hook admit a key the door admits; a newcomer only for a statement the network would take
    /// from it now.
    pub fn newcomer(&self, key: &str, p: &Pending) -> bool {
        self.admits(key) || self.take(key, p.clone()).is_ok()
    }
}

/// A passkey's assertion over `text`, by the passkey the tree knows by `id`.
fn check(
    publics: &[(String, String)],
    network: &Network,
    id: &str,
    text: &str,
    a: &Assertion,
) -> Result<(), MemberError> {
    let spki = publics
        .iter()
        .find(|(k, _)| k == id)
        .and_then(|(_, p)| p.strip_prefix("es256:"));
    let passkey = spki
        .and_then(Passkey::from_spki_hex)
        .ok_or(MemberError::Assertion(AssertionError::BadSignature))?;
    a.check(&network.rp, &challenge(text), &passkey)
        .map_err(MemberError::Assertion)
}

//! A network whose tree is data (`Aven.ID.Claim`'s `Server`): unclaimed, then claimed once, then grown by sign-ins.
//! Every step returns the next network and leaves this one as it was, so the Aven Peer stores a statement first and
//! takes the new network only once its ref is set. The claim is the first signup: there is no code. It founds the
//! claimant's vault, the admin coop it owns (Maia City by default, the Aven Peer's `--admin-coop`) and that owns Aven,
//! the agent that runs the network, and the claiming browser (PRODUCTION.md, Part C). When the Aven Peer is given MaiaCityGuardian's public
//! half, the person's vault a claim founds has it among its owners.

use std::fmt;

use crate::claim::{Claim, SignIn};
use crate::passkey::{AssertionError, Passkey, Relying, challenge};
use crate::tree::{Invalid, Kind, Owner, Tree, Vault, valid_person_name};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ClaimError {
    /// The network is claimed already.
    Taken,
    /// The statement names another device than the browser that sent it.
    NotFromDevice,
    WrongNetwork,
    /// The name given at signup is none: 1 to 48 characters, no control characters.
    Name,
    Assertion(AssertionError),
    /// The tree it would make is not well formed.
    Invalid(Invalid),
    /// A sign-in before any claim.
    Unclaimed,
    /// A sign-in for a device or key the tree has.
    Known,
    /// A sign-in whose passkey's signature counter did not count up.
    Counter,
}

impl fmt::Display for ClaimError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ClaimError::Taken => write!(f, "this network is claimed already"),
            ClaimError::NotFromDevice => write!(f, "the statement is for another browser"),
            ClaimError::WrongNetwork => write!(f, "the statement is for another network"),
            ClaimError::Name => write!(
                f,
                "a name is 1 to {} characters, without control characters",
                crate::tree::MAX_PERSON_NAME
            ),
            ClaimError::Assertion(why) => write!(f, "{why}"),
            ClaimError::Invalid(why) => write!(f, "{why}"),
            ClaimError::Unclaimed => write!(f, "nobody has claimed this network yet"),
            ClaimError::Known => write!(f, "this browser is a device already"),
            ClaimError::Counter => write!(
                f,
                "the passkey's counter did not count up: it may be a copy"
            ),
        }
    }
}

impl std::error::Error for ClaimError {}

/// MaiaCityGuardian's key, by the id trees know it by.
pub const GUARDIAN: &str = "maia-city-guardian";
/// The admin coop's id, and its name unless the Aven Peer is given another.
pub const COOP: &str = "maia-city";
pub const COOP_NAME: &str = "Maia City";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Network {
    pub network: String,
    pub peer: String,
    pub peer_key: String,
    pub rp: Relying,
    /// MaiaCityGuardian's public half, Ed25519 in hex
    pub guardian: Option<String>,
    /// The admin coop's id and name: configuration, read at every start, never signed.
    pub coop: String,
    pub coop_name: String,
    claim: Option<Claim>,
    sign_ins: Vec<SignIn>,
}

impl Network {
    /// An unclaimed network: its agent's vault (`network`, the id the network goes by), without an owner yet, and the Aven Peer, its device with its key. Its admin
    /// coop is Maia City until [`Network::with_coop`] names another.
    pub fn new(
        network: &str,
        peer: &str,
        peer_key: &str,
        rp: Relying,
        guardian: Option<String>,
    ) -> Network {
        Network {
            network: network.into(),
            peer: peer.into(),
            peer_key: peer_key.into(),
            rp,
            guardian,
            coop: COOP.into(),
            coop_name: COOP_NAME.into(),
            claim: None,
            sign_ins: Vec::new(),
        }
    }

    /// The same network with another admin coop.
    pub fn with_coop(self, id: &str, name: &str) -> Network {
        Network {
            coop: id.into(),
            coop_name: name.into(),
            ..self
        }
    }

    pub fn claim(&self) -> Option<&Claim> {
        self.claim.as_ref()
    }

    pub fn sign_ins(&self) -> &[SignIn] {
        &self.sign_ins
    }

    /// The tree's keys with their public halves: a passkey's written `es256:<SPKI>`, the guardian's after it.
    pub fn publics(&self) -> Vec<(String, String)> {
        let Some(c) = &self.claim else {
            return vec![(self.peer.clone(), self.peer_key.clone())];
        };
        let mut out = vec![(c.passkey.clone(), format!("es256:{}", c.passkey_key))];
        out.extend(
            self.guardian
                .iter()
                .map(|g| (GUARDIAN.to_string(), g.clone())),
        );
        out.push((self.peer.clone(), self.peer_key.clone()));
        out.push((c.device.clone(), c.device_key.clone()));
        out.extend(
            self.sign_ins
                .iter()
                .map(|i| (i.device.clone(), i.device_key.clone())),
        );
        out
    }

    /// The tree's vaults, in order, each with its name. Before the claim the agent's vault has no owner.
    pub fn vaults(&self) -> Vec<Vault> {
        // a device's key, here, is its device vault's id (A211)
        let vault = |id: &str, name: String, kind, owners| Vault {
            id: id.into(),
            name,
            kind,
            owners,
            threshold: 1,
            key: (kind == Kind::Device).then(|| id.to_string()),
        };
        let network = vault(&self.network, "Aven".into(), Kind::Agent, vec![]);
        let peer = vault(
            &self.peer,
            "Aven Peer".into(),
            Kind::Device,
            vec![Owner::Vault(self.network.clone())],
        );
        let Some(c) = &self.claim else {
            return vec![network, peer];
        };
        let person = || vec![Owner::Vault(c.person.clone())];
        let mut out = vec![
            vault(
                &c.person,
                c.vault_name(),
                Kind::Person,
                self.founders(&c.passkey),
            ),
            vault(&self.coop, self.coop_name.clone(), Kind::Coop, person()),
            Vault {
                owners: vec![Owner::Vault(self.coop.clone())],
                ..network
            },
            peer,
            vault(&c.device, c.browser(1), Kind::Device, person()),
        ];
        out.extend(
            self.sign_ins
                .iter()
                .enumerate()
                .map(|(k, i)| vault(&i.device, c.browser(k + 2), Kind::Device, person())),
        );
        out
    }

    /// A person's vault's owners when it is founded: its passkey, and the guardian if there is one.
    pub(crate) fn founders(&self, passkey: &str) -> Vec<Owner> {
        let mut out = vec![Owner::Key(passkey.into())];
        out.extend(self.guardian.iter().map(|_| Owner::Key(GUARDIAN.into())));
        out
    }

    /// The tree once claimed; before, the tree fails only for the agent's missing owner.
    pub fn tree(&self) -> Result<Tree, Invalid> {
        Tree::new(self.publics(), self.vaults())
    }

    /// Whether `key` is a device of this tree: only those are told the tree.
    pub fn has_device(&self, key: &str) -> bool {
        let devices: Vec<String> = self
            .vaults()
            .into_iter()
            .filter(|v| v.kind == Kind::Device)
            .map(|v| v.id)
            .collect();
        self.claim.is_some()
            && self
                .publics()
                .iter()
                .any(|(id, k)| k == key && devices.contains(id))
    }

    fn knows(&self, device: &str, key: &str) -> bool {
        self.vaults().iter().any(|v| v.id == device)
            || self
                .publics()
                .iter()
                .any(|(id, k)| id == device || k == key)
    }

    /// A claim's statement, checked: its network, the name given, its passkey's assertion over its text, and the tree
    /// it makes.
    pub fn accept_claim(&self, c: Claim) -> Result<Network, ClaimError> {
        if c.network != self.network {
            return Err(ClaimError::WrongNetwork);
        }
        if !valid_person_name(&c.name) {
            return Err(ClaimError::Name);
        }
        let passkey = Passkey::from_spki_hex(&c.passkey_key)
            .ok_or(ClaimError::Assertion(AssertionError::BadSignature))?;
        c.assertion
            .check(&self.rp, &challenge(&c.text()), &passkey)
            .map_err(ClaimError::Assertion)?;
        let next = Network {
            claim: Some(c),
            ..self.clone()
        };
        next.tree().map_err(ClaimError::Invalid)?;
        Ok(next)
    }

    /// A claim, the first signup, as a browser sends it from the browser whose key is `from`: refused once claimed,
    /// then from another browser than it names.
    pub fn submit_claim(&self, from: &str, c: Claim) -> Result<Network, ClaimError> {
        if self.claim.is_some() {
            return Err(ClaimError::Taken);
        }
        if from != c.device_key {
            return Err(ClaimError::NotFromDevice);
        }
        self.accept_claim(c)
    }

    pub fn accept_sign_in(&self, i: SignIn) -> Result<Network, ClaimError> {
        let c = self.claim.as_ref().ok_or(ClaimError::Unclaimed)?;
        if i.network != self.network {
            return Err(ClaimError::WrongNetwork);
        }
        if self.knows(&i.device, &i.device_key) {
            return Err(ClaimError::Known);
        }
        let passkey = Passkey::from_spki_hex(&c.passkey_key)
            .ok_or(ClaimError::Assertion(AssertionError::BadSignature))?;
        i.assertion
            .check(&self.rp, &challenge(&i.text()), &passkey)
            .map_err(ClaimError::Assertion)?;
        // a passkey that counts must count up; synced ones keep it at 0
        let (n, last) = (i.assertion.counter(), self.last_counter());
        if (n != 0 || last != 0) && n <= last {
            return Err(ClaimError::Counter);
        }
        let mut next = self.clone();
        next.sign_ins.push(i);
        next.tree().map_err(ClaimError::Invalid)?;
        Ok(next)
    }

    pub fn submit_sign_in(&self, from: &str, i: SignIn) -> Result<Network, ClaimError> {
        if self.claim.is_none() {
            return Err(ClaimError::Unclaimed);
        }
        if from != i.device_key {
            return Err(ClaimError::NotFromDevice);
        }
        self.accept_sign_in(i)
    }

    /// The last signature counter the network kept for its passkey: its claim's, then each sign-in's.
    pub(crate) fn last_counter(&self) -> u32 {
        let claimed = self.claim.iter().map(|c| c.assertion.counter());
        claimed
            .chain(self.sign_ins.iter().map(|i| i.assertion.counter()))
            .last()
            .unwrap_or(0)
    }

    /// An empty store: the network unclaimed again.
    pub fn wipe(&self) -> Network {
        Network {
            claim: None,
            sign_ins: Vec::new(),
            ..self.clone()
        }
    }

    /// The network read back from its stored statements, each checked again as when it came.
    pub fn restore(
        &self,
        claim: Option<Claim>,
        sign_ins: Vec<SignIn>,
    ) -> Result<Network, ClaimError> {
        let mut next = match claim {
            Some(c) => self.wipe().accept_claim(c)?,
            None => self.wipe(),
        };
        for i in sign_ins {
            next = next.accept_sign_in(i)?;
        }
        Ok(next)
    }
}

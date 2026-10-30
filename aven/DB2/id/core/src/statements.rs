//! Every statement a network holds, as the Aven Peer tells the devices its door admits (MILESTONE2.md, "the door is
//! checked twice"): its configuration, the claim and every sign-in (the claimant's, then the members'), the invites, withdrawals and joins. A peer reads them
//! back with [`Members::from_statements`], which checks each one again, so it learns who is a member without taking the
//! Aven Peer's word for it.
//!
//! ```text
//! {"network":"aven","peer":"aven-peer","peerKey":"…","rpId":"maia.city","origins":["https://aven.maia.city"],
//!  "guardian":"…"|null,"coop":"maia-city","coopName":"Maia City","claim":{…}|null,"signIns":[…],"invites":[…],"withdrawn":[…],"joins":[…]}
//! ```

use serde_json::{Value, json};

use crate::claim::{Claim, SignIn};
use crate::invite::{Invite, Join, Withdrawal};
use crate::members::Members;
use crate::network::Network;
use crate::passkey::Relying;

fn all<T>(
    v: &Value,
    k: &str,
    read: impl Fn(&Value) -> Result<T, String>,
) -> Result<Vec<T>, String> {
    v[k].as_array()
        .ok_or(format!("no {k}"))?
        .iter()
        .map(read)
        .collect()
}

fn text<'a>(v: &'a Value, k: &str) -> Result<&'a str, String> {
    v[k].as_str().ok_or(format!("no {k}"))
}

impl Members {
    pub fn statements(&self) -> Value {
        let n = self.network();
        json!({
            "network": n.network,
            "peer": n.peer,
            "peerKey": n.peer_key,
            "rpId": n.rp.rp_id,
            "origins": n.rp.origins,
            "guardian": n.guardian,
            "coop": n.coop,
            "coopName": n.coop_name,
            "claim": n.claim().map(Claim::to_json),
            "signIns": self.all_sign_ins().iter().map(SignIn::to_json).collect::<Vec<_>>(),
            "invites": self.invites().iter().map(Invite::to_json).collect::<Vec<_>>(),
            "withdrawn": self.withdrawn().iter().map(Withdrawal::to_json).collect::<Vec<_>>(),
            "joins": self.joins().iter().map(Join::to_json).collect::<Vec<_>>(),
        })
    }

    /// The members read back from what the Aven Peer told: every statement checked again.
    pub fn from_statements(v: &Value) -> Result<Members, String> {
        let origins = v["origins"].as_array().ok_or("no origins")?;
        let rp = Relying {
            rp_id: text(v, "rpId")?.into(),
            origins: origins
                .iter()
                .filter_map(|o| o.as_str().map(str::to_string))
                .collect(),
        };
        let guardian = v["guardian"].as_str().map(str::to_string);
        let network = Network::new(
            text(v, "network")?,
            text(v, "peer")?,
            text(v, "peerKey")?,
            rp,
            guardian,
        )
        .with_coop(text(v, "coop")?, text(v, "coopName")?);
        let claim = match &v["claim"] {
            Value::Null => None,
            c => Some(Claim::from_json(c)?),
        };
        Members::new(network)
            .restore(
                claim,
                all(v, "signIns", SignIn::from_json)?,
                all(v, "invites", Invite::from_json)?,
                all(v, "withdrawn", Withdrawal::from_json)?,
                all(v, "joins", Join::from_json)?,
            )
            .map_err(|e| e.to_string())
    }
}

//! Membership is a cap (`Aven.ID.Member`, A38). Maia City's vault grants each member's vault a member cap, which is
//! what a join is. The confirm op Aven holds under Maia City's confirm cap issues it, for a claim of a ticket Maia City
//! issued: the confirm envelope is the issuance, so a member cap carries no signature of its own.
//!
//! `tree/1`'s ops and what the tree settles (which claim founded which vault) are avenPEER's; here they are named by
//! their ids and given as parameters.

use aven_core::{Call, CoreOp, DocId, Hash, OpId, Target, Value, name_of};

use super::approve::Sig;
use super::authorized::{Reader, Reading};
use super::chain::Cap;
use super::conditions::{Conditions, Form, Holder};
use super::line::Line;

/// A plugin's op, by its id: the name of its stored form `{"op": name, "plugin": plugin}`, as `core/1`'s are named
/// (`pluginOp`).
pub fn plugin_op(plugin: &str, name: &str) -> OpId {
    name_of(&Value::Map(vec![
        ("op".into(), Value::Text(name.into())),
        ("plugin".into(), Value::Text(plugin.into())),
    ]))
}

/// `tree/1`'s confirm (`confirmOp`).
pub fn confirm_op() -> OpId {
    plugin_op("tree/1", "confirm")
}

/// `tree/1`'s sign-in (`signInOp`).
pub fn sign_in_op() -> OpId {
    plugin_op("tree/1", "signIn")
}

/// The parameter a confirm names its claim by (`claimParam`).
pub const CLAIM_PARAM: &str = "claim";

/// A confirm of the claim named `claim`, the call its tree statement makes (`confirmCall`).
pub fn confirm_call(claim: &Hash) -> Call {
    Call {
        op: confirm_op(),
        params: vec![(CLAIM_PARAM.into(), Value::Bytes(claim.0.to_vec()))],
    }
}

/// Maia City's confirm cap to confirmer vault `v`, with its owners' approvals: `tree/1`'s confirm on the tree Doc,
/// for any claim (`confirmCap`). A coop has no devices, so no device signs it (A28).
pub fn confirm_cap(tree: DocId, v: &str, approvals: Vec<Sig>) -> Cap {
    Cap {
        id: format!("confirm-{v}"),
        issuer: "maia-city".into(),
        holder: Holder::Vault(v.into()),
        parent: None,
        form: Form::Grant,
        grant: vec![Line {
            op: confirm_op(),
            doc: Target::Doc {
                doc: tree,
                reach: aven_core::Reach::Itself,
            },
            params: vec![(CLAIM_PARAM.into(), aven_core::Bound::Any)],
        }],
        role: None,
        share: 0,
        conditions: Conditions::default(),
        signer: None,
        approvals,
    }
}

/// What `tree/1`'s confirm grants a member's vault: reading the chat and putting its messages, and signing in its
/// own devices on the tree Doc (`memberLines`).
pub fn member_lines(tree: DocId, chat: DocId, message: DocId) -> Vec<Line> {
    let doc = |d| Target::Doc {
        doc: d,
        reach: aven_core::Reach::Itself,
    };
    vec![
        Line {
            op: CoreOp::Read.id(),
            doc: doc(chat),
            params: vec![],
        },
        Line {
            op: CoreOp::Put.id(),
            doc: doc(chat),
            params: vec![(
                "type".into(),
                aven_core::Bound::OneOf(vec![Value::Bytes(message.0.0.to_vec())]),
            )],
        },
        Line {
            op: sign_in_op(),
            doc: doc(tree),
            params: vec![],
        },
    ]
}

/// The member cap (A38): Maia City's grant to member vault `v` (`memberCap`). The confirm envelope that names `v`'s
/// claim is its issuance, so it carries no signature of its own.
pub fn member_cap(tree: DocId, chat: DocId, message: DocId, v: &str) -> Cap {
    Cap {
        id: format!("member-{v}"),
        issuer: "maia-city".into(),
        holder: Holder::Vault(v.into()),
        parent: None,
        form: Form::Grant,
        grant: member_lines(tree, chat, message),
        role: None,
        share: 0,
        conditions: Conditions::default(),
        signer: None,
        approvals: vec![],
    }
}

impl Reader<'_> {
    /// A confirmation a reader counts (`Reader.Confirms`): an envelope caps authorizes, on the tree Doc, calling
    /// `tree/1`'s confirm for `claim`.
    pub fn confirms(&self, tree: &DocId, e: &Reading, claim: &Hash) -> bool {
        self.authorized(e).is_ok() && e.doc == *tree && e.calls.contains(&confirm_call(claim))
    }

    /// Vault `v` holds the member cap (`Reader.Member`): among the envelopes the reader holds, an authorized confirm on
    /// the tree Doc names a claim that founded `v`, as the tree settles claims (`founded`).
    pub fn member(
        &self,
        tree: &DocId,
        held: &[Reading],
        founded: &dyn Fn(&Hash) -> Option<String>,
        v: &str,
    ) -> bool {
        held.iter().any(|e| {
            e.calls.iter().any(|c| {
                c.op == confirm_op() && c.params.iter().any(|(p, x)| {
                    p == CLAIM_PARAM
                        && matches!(x, Value::Bytes(b) if b.len() == 32 && {
                            let claim = Hash(b.as_slice().try_into().expect("32 bytes"));
                            founded(&claim).as_deref() == Some(v) && self.confirms(tree, e, &claim)
                        })
                })
            })
        })
    }
}

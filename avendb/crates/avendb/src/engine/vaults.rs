//! The ops on vaults themselves (`docs/ARCHITECTURE.md` §8), beside those on entries' records: what a device's
//! page reads of its world (`world`), of the shares over a vault (`shares`), and what a vault may add to another and
//! tag there (`creatable`, `taggable`); and the changes of vaults: shares, keep shares and their revocations, an owner
//! or a device taken out, a vault's settings, new vaults, a file brought, the server's backup, a steward's mark, a
//! device's card and a vault's profile, and the vaults a device follows.
//!
//! A change a vault's owners approve (governance: an owner, a device, a share at owner level or its revocation, a
//! vault's settings, new vaults) a device never signs alone, as devices never approve: it drafts it for its person's
//! passkey (`Lab::draft`, `Lab::drafting`), the root of every vault their vault owns, and the op comes to an
//! `Approval`, the challenge the passkey's ceremony signs. Whoever runs the op with a ceremony at hand (avendb-net's
//! `Node::run`) has the passkey sign it and keeps it (`approve`); without one, the op answers `approve` and makes
//! nothing. A change the device may make alone it makes alone.

use std::collections::BTreeSet;

use serde_json::{Map, Value, json};

use super::{Refused, bad, entry_of, id_of, strs, texts_of, vault_of};
use crate::cast;
use crate::data;
use crate::id::{BlobId, EditId, EntryId, ShareId, SignerId, VaultId};
use crate::keys::KeyFam;
use crate::lab::{Lab, NewShare, Unsigned};
use crate::policy::{Action, Issued, KeepMode, Kind, Level, Principal, Refusal, Revoking, Setting, Sharing, Who};
use crate::rules::{self, Op, Touch};
use crate::sealed::{Brought, FileRoot};
use crate::sign::{self, Ceremony, SignerKeys};
use crate::slice::{Atom, Attrs, Selector, Sym};
use crate::wire::Wire as _;
use crate::words::{self, hex, principal_json, who_json};
use crate::world::{self, CARD, FILE, PROFILE, SyncedTo, World};

/// The changes of this module: each runs alone, never in a batch.
pub(super) const CHANGES: [&str; 11] =
    ["share", "keep", "revoke", "settings", "found", "put_file", "back_up", "mark", "card", "profile", "follow"];

/// What a change op comes to before anything is signed: made, with its answer (`Done`), or drafted for the passkey of
/// its vault's owners to approve (`Approve`).
pub enum Prepared {
    Done(Value),
    Approve(Approval),
}

/// Edits drafted on a device for its person's passkey to approve, all in one ceremony: the passkey, every signer the
/// edits name, the passkey first and then a newcomer that signs too, as the master recovery key by its standing
/// consent; the drafts in the order they are kept; and what the op answers once they are (`Then`).
pub struct Approval {
    pub passkey: SignerId,
    pub signers: Vec<SignerId>,
    pub drafts: Vec<Unsigned>,
    pub then: Then,
}

/// What an approved op answers once its edits are kept: its edit (`{"edit": id}`), the share it issued (`{"share":
/// id}`), or the new vaults, each with a profile of the name it was given (`{"vaults": [id, ...]}`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Then {
    Edit,
    Share,
    Found(Vec<String>),
}

impl Approval {
    /// What the passkey's ceremony signs: the edit's id, or for edits drafted together, their batch's challenge.
    pub fn challenge(&self) -> [u8; 32] {
        self.drafts.first().map_or([0; 32], Unsigned::challenge)
    }

    /// The op's answer without a ceremony at hand: `{"approve": {challenge, signers, draft}}`, the draft its edits on
    /// the wire, each behind its length (four bytes little-endian), in base64url without padding. Nothing is made.
    pub fn to_json(&self) -> Value {
        let mut draft = vec![];
        for d in &self.drafts {
            let wire = d.edit().to_wire();
            draft.extend_from_slice(&(wire.len() as u32).to_le_bytes());
            draft.extend_from_slice(&wire);
        }
        let signers: Vec<String> = self.signers.iter().map(SignerId::to_hex).collect();
        let challenge = BlobId(self.challenge()).to_hex();
        json!({ "approve": { "challenge": challenge, "signers": signers, "draft": sign::base64url(&draft) } })
    }

    /// What `may` answers of it: `{"approve": {signers}}`.
    pub fn verdict(&self) -> Value {
        json!({ "approve": { "signers": self.signers.iter().map(SignerId::to_hex).collect::<Vec<_>>() } })
    }
}

/// Approval `a` signed by the passkey's ceremony `ceremony` over its challenge, and kept on device `me` in order: the
/// op's answer. `BadSignature` if the ceremony isn't the passkey's over that challenge.
pub fn approve(lab: &mut Lab, me: SignerId, a: Approval, ceremony: &Ceremony) -> Result<Value, Refused> {
    let Approval { passkey, drafts, then, .. } = a;
    let mut ids = vec![];
    for draft in drafts {
        ids.push(lab.complete(me, draft, &[(passkey, ceremony)])?);
    }
    approved(lab, me, &then, &ids)
}

/// What an approved op answers once device `me` keeps its edits `ids` (`Then`): new vaults first give avenCEO the share
/// it holds on the person's vault, backup or relay (`world::server_level`), and get their profiles (`profile`).
pub fn approved(lab: &mut Lab, me: SignerId, then: &Then, ids: &[EditId]) -> Result<Value, Refused> {
    let first = ids.first().map(EditId::to_hex);
    Ok(match then {
        Then::Edit => json!({ "edit": first }),
        Then::Share => json!({ "share": first }),
        Then::Found(names) => {
            for (&id, name) in ids.iter().zip(names) {
                written(lab, me, VaultId::from(id), name)?;
            }
            json!({ "vaults": ids.iter().map(|&id| VaultId::from(id).to_hex()).collect::<Vec<_>>() })
        }
    })
}

/// The person's passkey as device `me` holds it: of its vault's owners, the passkeys whose keys it holds, the vault's
/// root first, never the master recovery key. It approves for its vault and every vault that vault owns.
pub fn passkey_of(lab: &Lab, me: SignerId) -> Option<SignerId> {
    let vault = lab.state(me).vault(lab.vault_of(me)?)?;
    let passkey =
        |s: &SignerId| matches!(lab.keys_of(*s), Some(SignerKeys::Passkey { .. })) && Some(*s) != lab.recovery();
    let owners = vault.owners.iter().filter_map(|p| match p {
        Principal::Signer(s) => Some(*s),
        Principal::Vault(_) => None,
    });
    vault.root.filter(passkey).or_else(|| owners.filter(passkey).next())
}

/// Who signs a change of device `me`'s that its vault's owners approve: the passkey, and `newcomer`, the signer it
/// adds, where the device holds its keys, as it must sign too. None while the device holds no passkey.
fn approvers(lab: &Lab, me: SignerId, newcomer: Option<SignerId>) -> Option<(SignerId, Vec<SignerId>)> {
    let passkey = passkey_of(lab, me)?;
    let newcomer = newcomer.filter(|&s| s != passkey && lab.keys_of(s).is_some());
    Some((passkey, [passkey].into_iter().chain(newcomer).collect()))
}

/// The signer action `action` adds, who signs it too: an owner that is a signer, a device, a new root.
fn newcomer(action: &Action) -> Option<SignerId> {
    match action {
        Action::Share(Sharing::Owner { owner: Principal::Signer(s), .. }) => Some(*s),
        Action::Share(Sharing::Device { device, .. }) => Some(*device),
        Action::Settings { set: Setting::Root { root, .. }, .. } => *root,
        _ => None,
    }
}

/// A change device `me` may not make alone, refused so (`refused`): drafted by `draft` for its person's passkey to
/// approve, with its newcomer, where it needs its vault's approval or the consent of someone it names; else that
/// refusal.
fn approval(
    lab: &mut Lab,
    me: SignerId,
    refused: Refusal,
    newcomer: Option<SignerId>,
    then: Then,
    draft: impl FnOnce(&mut Lab, &[SignerId]) -> Result<Unsigned, Refusal>,
) -> Result<Prepared, Refused> {
    if !matches!(refused, Refusal::BelowThreshold | Refusal::NoConsent | Refusal::NotRoot) {
        return Err(refused.into());
    }
    let Some((passkey, signers)) = approvers(lab, me, newcomer) else { return Err(refused.into()) };
    let drafts = vec![draft(lab, &signers)?];
    Ok(Prepared::Approve(Approval { passkey, signers, drafts, then }))
}

/// Governance edit `action` on device `me`: made alone where the device may, as one leaving its vault, else drafted
/// for the passkey to approve (`approval`). Its answer is its edit.
fn governed(lab: &mut Lab, me: SignerId, action: Action) -> Result<Prepared, Refused> {
    match lab.submit(me, &[me], action.clone()) {
        Ok(id) => Ok(Prepared::Done(json!({ "edit": id.to_hex() }))),
        Err(refused) => {
            let newcomer = newcomer(&action);
            approval(lab, me, refused, newcomer, Then::Edit, |lab, signers| lab.draft(me, signers, action))
        }
    }
}

/// Share `new` issued on device `me`: alone, or at owner level, drafted for the passkey to approve. Its answer is the
/// share.
fn issued(lab: &mut Lab, me: SignerId, new: NewShare) -> Result<Prepared, Refused> {
    match lab.issue(me, &[me], new.clone()) {
        Ok(id) => Ok(Prepared::Done(json!({ "share": id.to_hex() }))),
        Err(refused) => approval(lab, me, refused, None, Then::Share, |lab, signers| lab.draft_share(me, signers, new)),
    }
}

/// The vault op `o` acts for: its `as`, else device `me`'s own.
fn actor_of(lab: &Lab, me: SignerId, o: &Map<String, Value>) -> Result<VaultId, Refused> {
    match o.get("as") {
        Some(_) => vault_of(o, "as"),
        None => lab.vault_of(me).ok_or(Refused::Rule(Refusal::NotActing)),
    }
}

/// A text field, trimmed and not blank: a name.
fn name_of(o: &Map<String, Value>, field: &str, what: &str) -> Result<String, Refused> {
    let name = o.get(field).and_then(Value::as_str).map(str::trim).filter(|n| !n.is_empty());
    name.map(str::to_string).ok_or_else(|| bad(format!("{what} has a name: {field}, some text")))
}

fn bool_of(o: &Map<String, Value>, field: &str, op: &str) -> Result<bool, Refused> {
    o.get(field).and_then(Value::as_bool).ok_or_else(|| bad(format!("{op} takes {field}: true or false")))
}

/// A whole number of bytes, or a place in a file.
fn bytes_of(o: &Map<String, Value>, field: &str) -> Result<Option<u64>, Refused> {
    let count = |v: &Value| v.as_u64().ok_or_else(|| bad(format!("{field} is a whole number of bytes")));
    o.get(field).map(count).transpose()
}

/// An owner as the world shows a vault's owners: `{"signer": id}` or `{"vault": id}`.
fn principal_of(v: &Value) -> Result<Principal, Refused> {
    let one = v.as_object().filter(|o| o.len() == 1).and_then(|o| o.iter().next());
    let id = |x: &Value| x.as_str().and_then(BlobId::from_hex).map(|b| b.0);
    match one {
        Some((k, x)) if k == "signer" => id(x).map(|s| Principal::Signer(SignerId(s))),
        Some((k, x)) if k == "vault" => id(x).map(|v| Principal::Vault(VaultId(v))),
        _ => None,
    }
    .ok_or_else(|| bad("an owner is {\"signer\": id} or {\"vault\": id}"))
}

/// Change op `o`, called `name`, one of `CHANGES`, run on device `me`.
pub(super) fn prepare(lab: &mut Lab, me: SignerId, name: &str, o: &Map<String, Value>) -> Result<Prepared, Refused> {
    let done = |v: Result<Value, Refused>| v.map(Prepared::Done);
    match name {
        "share" => share(lab, me, o),
        "keep" => keep(lab, me, o),
        "revoke" => revoke(lab, me, o),
        "settings" => settings(lab, me, o),
        "found" => found(lab, me, o),
        // a dry run checks the entry it would create; else the bytes come beside the op, which a node reads
        "put_file" if lab.is_dry() => done(put_file(lab, me, o, None)),
        "put_file" => Err(bad("put_file brings its bytes beside it: a node runs it (Node::run)")),
        "back_up" => done(back_up(lab, me, o)),
        "mark" => done(mark(lab, me, o)),
        "card" => done(card(lab, me, o)),
        "profile" => done(profile(lab, me, o)),
        "follow" => done(follow(lab, me, o)),
        _ => Err(bad(format!("no op is called {name:?}"))),
    }
}

// Reads.

/// `{"op": "world"}`: device `me`'s world (`world::World::to_json`), each entry and file synced to the devices `synced`
/// says, its answer: `{"ok": null}` while it belongs to no vault.
pub fn world(lab: &Lab, me: SignerId, synced: &SyncedTo) -> Value {
    let world = world::world(lab, me).map(|w| World { synced_to: synced.clone(), ..w });
    json!({ "ok": world.map(|w| w.to_json(me)) })
}

/// `{"op": "database", "vault"}`, `{"op": "note", "entry"}` and `{"op": "log"}` (`data`).
pub(super) fn data(lab: &Lab, me: SignerId, name: &str, o: &Map<String, Value>) -> Result<Value, Refused> {
    Ok(match name {
        "database" => data::database(lab, me, vault_of(o, "vault")?),
        "note" => data::note(lab, me, entry_of(o)?).unwrap_or(Value::Null),
        _ => data::history(lab, me),
    })
}

/// `{"op": "read_file", "root", "size", "from"?, "to"?}`: the file whose root is `root` and whose sealed size is
/// `size`, and the bytes `from` (0, left out) to `to` (its end, left out) of it, for a node to read
/// (`Node::read_file`).
pub fn file_range(o: &Map<String, Value>) -> Result<(FileRoot, std::ops::Range<u64>), Refused> {
    let hash = id_of(o.get("root"), "root", BlobId::from_hex)?.0;
    let size = bytes_of(o, "size")?.ok_or_else(|| bad("read_file takes the file's sealed size: size"))?;
    let (from, to) = (bytes_of(o, "from")?.unwrap_or(0), bytes_of(o, "to")?.unwrap_or(u64::MAX));
    if to < from {
        return Err(bad("read_file reads from before to"));
    }
    Ok((FileRoot { hash, size }, from..to))
}

/// `{"op": "shares", "over", "as"?}`: every share over vault `over` device `me` knows, as the Sharing and Owners
/// screens list them, for vault `as` (the op's, else the world's `acting.as`): its owners, in the order they joined,
/// its devices, then the grants and keep shares in force, the strongest first, then in the order issued, each with
/// whether `as` may revoke it (a dry run of the revocation; a keep share's, as its issuer, who alone revokes it); and
/// whether `as` may share some of it on (a dry run of a read share to everyone it would issue).
pub(super) fn shares(lab: &mut Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let over = vault_of(o, "over")?;
    let mine = lab.vault_of(me).ok_or(Refusal::NotActing)?;
    let st = lab.state(me);
    let vault = st.vault(over).ok_or(Refusal::UnknownVault)?.clone();
    let actor = match o.get("as") {
        Some(_) => vault_of(o, "as")?,
        None => world::acting(st, me, mine, over).actor,
    };
    let all = st.entries().iter().filter(|en| en.vault == over).count();
    let (id, recovery) = (over.to_hex(), lab.recovery());
    // each row, and the revocation that ends it, which `may` judges
    let mut rows: Vec<(Value, Value)> = vec![];
    let member = |kind: &str, who: Value, level: &str, group: Option<&str>, (recovery, root): (bool, bool)| {
        json!({
            "kind": kind, "id": null, "over": id, "who": who, "level": level, "group": group, "name": null,
            "what": "everything", "ops": null, "above": null, "issuer": null, "parent": null, "reaches": all,
            "recovery": recovery, "root": root,
        })
    };
    for &p in &vault.owners {
        let (recovery, root) = match p {
            Principal::Signer(s) => (Some(s) == recovery, Some(s) == vault.root),
            Principal::Vault(_) => (false, false),
        };
        let row = member("owner", principal_json(p), "owner", Some("Owner"), (recovery, root));
        rows.push((row, json!({ "op": "revoke", "vault": id, "owner": principal_json(p) })));
    }
    for &d in &vault.devices {
        let row = member("device", json!({ "device": d.to_hex() }), "actsFor", None, (false, false));
        rows.push((row, json!({ "op": "revoke", "vault": id, "device": d.to_hex() })));
    }
    let mut given: Vec<&Issued> = st.shares_over(over).filter(|cp| st.live(cp.id)).collect();
    given.sort_by_key(|cp| std::cmp::Reverse(cp.share.level.rank()));
    for cp in given {
        let (s, slice) = (&cp.share, lab.slice(me, cp.id));
        let read = slice.map(|x| x.to_json());
        let whole = s.wide || slice.is_some_and(|x| x.select == Selector::All);
        let what = if whole { json!("everything") } else { read.as_ref().map_or(Value::Null, |x| x["where"].clone()) };
        let reached = |en: &&crate::policy::Entry| s.wide || world::in_audience(st, en.audience(), cp.id);
        let reaches = st.entries().iter().filter(|en| en.vault == over).filter(reached).count();
        let keep = s.level.is_keep();
        let row = json!({
            "kind": if keep { "keep" } else { "grant" },
            "id": cp.id.to_hex(),
            "over": id,
            "who": who_json(s.who),
            "level": words::level_name(s.level),
            "group": world::group_of(s, slice),
            "name": slice.map(|x| x.name.clone()),
            "what": what,
            "ops": read.as_ref().map(|x| x["ops"].clone()),
            "above": read.as_ref().map(|x| x["above"].clone()),
            "issuer": s.issuer.to_hex(),
            "parent": s.parent.map(|p| p.to_hex()),
            "reaches": reaches,
            "recovery": false,
            "root": false,
        });
        let by = if keep { s.issuer } else { actor };
        rows.push((row, json!({ "op": "revoke", "share": cp.id.to_hex(), "as": by.to_hex() })));
    }
    // a read share to everyone on what the share it would rest on picks: whether `as` may share some of it on
    let parent = world::parent(st, actor, over, false);
    let select = parent.and_then(|p| lab.slice(me, p)).map_or(Selector::All, |x| x.select.clone());
    let (name, ops) = ("Public".to_string(), vec![Op::Read]);
    let public = NewShare { over, who: Who::Everyone, name, select, ops, parent, issuer: actor, keep: None };
    let share = verdict_of(lab.dry(|lab| issued(lab, me, public)));
    let rows: Vec<Value> = rows
        .into_iter()
        .map(|(mut row, revoke)| {
            row["revoke"] = super::verdict(lab, me, &revoke);
            row
        })
        .collect();
    Ok(json!({ "over": id, "as": actor.to_hex(), "share": share, "rows": rows }))
}

/// What `may` answers of a change, prepared dry.
pub(super) fn verdict_of(prepared: Result<Prepared, Refused>) -> Value {
    match prepared {
        Ok(Prepared::Done(_)) => Value::Bool(true),
        Ok(Prepared::Approve(a)) => a.verdict(),
        Err(why) => why.to_json(),
    }
}

/// The live shares over vault `over` that name vault `actor` with write or more, as device `me` reads them, with
/// their slices.
fn writing<'a>(
    lab: &'a Lab,
    me: SignerId,
    over: VaultId,
    actor: VaultId,
) -> impl Iterator<Item = (&'a Issued, &'a crate::slice::Slice)> {
    let st = lab.state(me);
    let named = move |cp: &&Issued| {
        st.live(cp.id) && cp.share.who == Who::Vault(actor) && cp.share.level.allows(Level::Write)
    };
    st.shares_over(over).filter(named).filter_map(move |cp| Some((cp, lab.slice(me, cp.id)?)))
}

/// `{"op": "creatable", "vault", "type", "tags"?, "as"?}`: whether vault `as` may add an entry of type `type` tagged
/// `tags` to vault `vault`, and with which tags besides: none for the vault itself, or through a share of `as` on the
/// whole vault; else, of the live shares over it naming `as` with write or more whose ops, and those of every share
/// they rest on, add entries, the first whose selector holds the new entry (by `as`, created now) once it carries the
/// tags a `tag` test of one of its conjunctions asks for: those, each once, but those given. `NoCap` where no share
/// lets it. Whether the ops allow the creation itself, `may` answers.
pub(super) fn creatable(lab: &Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let vault = vault_of(o, "vault")?;
    let ty = o.get("type").and_then(Value::as_str).ok_or_else(|| bad("creatable takes the entry's type: type"))?;
    let given: Vec<Sym> = texts_of(o, "tags")?.iter().map(|t| Sym::new(t)).collect();
    let actor = actor_of(lab, me, o)?;
    if actor == vault {
        return Ok(json!({ "tags": [] }));
    }
    let (entry, created) = (EntryId([0; 32]), lab.now());
    let attrs = |tags: Vec<Sym>| Attrs { ty: Sym::new(ty), author: actor, entry, created, tags };
    for (cp, slice) in writing(lab, me, vault, actor) {
        if !slice.grants().iter().all(|g| rules::allows_all(&g.ops, true, &[Touch::Create])) {
            continue;
        }
        let ds = match &slice.select {
            _ if cp.share.wide => return Ok(json!({ "tags": [] })),
            Selector::All => return Ok(json!({ "tags": [] })),
            Selector::AnyOf(ds) => ds,
        };
        for d in ds {
            let mut asked: Vec<Sym> = vec![];
            for a in d {
                if let Atom::TagHas(t) = a
                    && !given.contains(t)
                    && !asked.contains(t)
                {
                    asked.push(t.clone());
                }
            }
            let tagged = attrs([given.clone(), asked.clone()].concat());
            if d.iter().all(|a| a.test(&tagged)) {
                return Ok(json!({ "tags": asked.iter().map(Sym::as_str).collect::<Vec<_>>() }));
            }
        }
    }
    Err(Refusal::NoCap.into())
}

/// `{"op": "taggable", "entry", "as"?}`: the tags vault `as` may add to entry `entry` or take off it: `"any"` for the
/// entry's own vault, whose devices tag its entries at once; else, of the live shares over its vault naming `as` with
/// write or more that reach it and whose slices the device reads, what the `tag` ops of each and of every share it
/// rests on all allow, joined over those shares: `"any"`, or the tags, `[]` for none.
pub(super) fn taggable(lab: &Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let entry = entry_of(o)?;
    let st = lab.state(me);
    let en = st.entry(entry).ok_or(Refused::NoEntry)?;
    let actor = actor_of(lab, me, o)?;
    if actor == en.vault {
        return Ok(json!({ "tags": "any" }));
    }
    let mut tags: BTreeSet<String> = BTreeSet::new();
    let reaches = |cp: &Issued| cp.share.wide || world::in_audience(st, en.audience(), cp.id);
    for (_, slice) in writing(lab, me, en.vault, actor).filter(|(cp, _)| reaches(cp)) {
        // what a grant allows: any tag (`None`), or those it lists
        let allows = |ops: &[Op]| -> Option<BTreeSet<String>> {
            let mut listed = BTreeSet::new();
            for op in ops {
                match op {
                    Op::Tag(None) => return None,
                    Op::Tag(Some(ts)) => listed.extend(ts.iter().map(|t| t.as_str().to_string())),
                    _ => {}
                }
            }
            Some(listed)
        };
        let mut all: Option<BTreeSet<String>> = None;
        for g in slice.grants() {
            all = match (all, allows(&g.ops)) {
                (None, x) | (x, None) => x,
                (Some(a), Some(b)) => Some(a.intersection(&b).cloned().collect()),
            };
        }
        match all {
            None => return Ok(json!({ "tags": "any" })),
            Some(ts) => tags.extend(ts),
        }
    }
    Ok(json!({ "tags": tags.into_iter().collect::<Vec<_>>() }))
}

// Changes.

/// Whom a share op names.
enum Whom {
    Vault(VaultId),
    Everyone,
    Signer(SignerId),
    Device(SignerId),
}

fn whom(o: &Map<String, Value>) -> Result<Whom, Refused> {
    let bad = || bad("who is {\"vault\": id}, \"everyone\", {\"signer\": id} or {\"device\": id}");
    let one = |w: &Map<String, Value>| {
        let (k, v) = w.iter().next().filter(|_| w.len() == 1)?;
        let id = v.as_str().and_then(BlobId::from_hex)?.0;
        Some(match k.as_str() {
            "vault" => Whom::Vault(VaultId(id)),
            "signer" => Whom::Signer(SignerId(id)),
            "device" => Whom::Device(SignerId(id)),
            _ => return None,
        })
    };
    match o.get("who") {
        Some(Value::String(s)) if s == "everyone" => Ok(Whom::Everyone),
        Some(Value::Object(w)) => one(w).ok_or_else(bad),
        _ => Err(bad()),
    }
}

/// What a share op gives: a built-in group (`rules::groups`), a group of its own, a keep level, or a device's place.
enum Giving {
    Group(&'static str, Vec<Op>),
    Own(String, Vec<Op>),
    Keep(KeepMode),
    ActsFor,
}

fn giving(o: &Map<String, Value>) -> Result<Giving, Refused> {
    let level = o.get("level");
    let bad = || bad("level is a group's name, {\"name\", \"ops\"}, a keep level or \"actsFor\"");
    match level {
        Some(Value::String(s)) if s == "actsFor" => Ok(Giving::ActsFor),
        Some(Value::String(s)) => match words::level_of(s).and_then(Level::mode) {
            Some(mode) => Ok(Giving::Keep(mode)),
            None => {
                let group = rules::groups().into_iter().find(|g| g.name == s);
                let group = group.ok_or_else(|| super::bad(format!("no group is called {s:?}")))?;
                Ok(Giving::Group(group.name, group.ops))
            }
        },
        Some(Value::Object(g)) => {
            if let Some(k) = g.keys().find(|k| *k != "name" && *k != "ops") {
                return Err(super::bad(format!("a group of its own is {{name, ops}}: no {k:?}")));
            }
            let name = g.get("name").and_then(Value::as_str).ok_or_else(bad)?;
            let ops = rules::ops_of_json(g.get("ops").ok_or_else(bad)?).map_err(super::bad)?;
            Ok(Giving::Own(name.to_string(), ops))
        }
        _ => Err(bad()),
    }
}

/// What a share op is on: `"everything"` (left out too), or a `where` of labels.
fn what_of(o: &Map<String, Value>) -> Result<Selector, Refused> {
    match o.get("what") {
        None => Ok(Selector::All),
        Some(Value::String(s)) if s == "everything" => Ok(Selector::All),
        Some(w) => Selector::of_json(w).map_err(bad),
    }
}

/// `{"op": "share", "over", "who", "level", "what", "as"?}`: vault `over` shared with `who`, acting for `as`. Owner
/// of everything to a vault or a signer makes a co-owner (`Sharing::Owner`, the master recovery key by its standing
/// consent), a device's place a device of it (`Sharing::Device`), both approved by the vault's owners: `{"edit": id}`.
/// A keep level to a device is a keep share `as` issues; anything else a share of the group named, or of its own, on
/// what `what` picks, resting on the owner share of `as`'s where `as` isn't `over` (`world::parent`), approved by the
/// owners where its level is owner: `{"share": id}`. The rules refuse whatever else.
fn share(lab: &mut Lab, me: SignerId, o: &Map<String, Value>) -> Result<Prepared, Refused> {
    let (over, whom, giving, select) = (vault_of(o, "over")?, whom(o)?, giving(o)?, what_of(o)?);
    let actor = actor_of(lab, me, o)?;
    let everything = select == Selector::All;
    let owner = |p| Action::Share(Sharing::Owner { vault: over, owner: p, seal_to: None });
    let (who, name, ops) = match (whom, giving) {
        (Whom::Vault(v), Giving::Group("Owner", _)) if everything => {
            return governed(lab, me, owner(Principal::Vault(v)));
        }
        (Whom::Signer(s), Giving::Group("Owner", _)) if everything => {
            return governed(lab, me, owner(Principal::Signer(s)));
        }
        (Whom::Device(d), Giving::ActsFor) if everything => {
            return governed(lab, me, Action::Share(Sharing::Device { vault: over, device: d, seal_to: None }));
        }
        (_, Giving::ActsFor) => {
            return Err(bad("a device acts for the whole of a vault: who a device, what everything"));
        }
        (Whom::Signer(_), Giving::Keep(_)) => return Err(Refusal::KeepNeedsDevice.into()),
        (Whom::Signer(_), _) => return Err(Refusal::DeviceOnlyKeeps.into()),
        (whom, Giving::Keep(mode)) => {
            let who = match whom {
                Whom::Device(d) => Who::Device(d),
                Whom::Vault(v) => Who::Vault(v),
                _ => Who::Everyone,
            };
            let name = Level::Keep(mode).group().to_string();
            let keep = NewShare { over, who, name, select, ops: vec![], parent: None, issuer: actor, keep: Some(mode) };
            return issued(lab, me, keep);
        }
        (whom, Giving::Group(name, ops)) => (whom, name.to_string(), ops),
        (whom, Giving::Own(name, ops)) => (whom, name, ops),
    };
    let who = match who {
        Whom::Vault(v) => Who::Vault(v),
        Whom::Device(d) => Who::Device(d),
        _ => Who::Everyone,
    };
    let parent = world::parent(lab.state(me), actor, over, everything);
    issued(lab, me, NewShare { over, who, name, select, ops, parent, issuer: actor, keep: None })
}

/// `{"op": "keep", "over", "mode", "what", "device"?, "as"?}`: a keep share `as` issues over vault `over` to `device`
/// (this one, left out): it keeps what `what` picks `"whole"`, `"opened"` or `"never"`. `{"share": id}`.
fn keep(lab: &mut Lab, me: SignerId, o: &Map<String, Value>) -> Result<Prepared, Refused> {
    let mode = match o.get("mode").and_then(Value::as_str) {
        Some("whole") => KeepMode::Whole,
        Some("opened") => KeepMode::Opened,
        Some("never") => KeepMode::Never,
        _ => return Err(bad("mode is \"whole\", \"opened\" or \"never\"")),
    };
    let device = match o.get("device") {
        None => me,
        d => id_of(d, "device", SignerId::from_hex)?,
    };
    let (over, select, actor) = (vault_of(o, "over")?, what_of(o)?, actor_of(lab, me, o)?);
    issued(lab, me, cast::keep(actor, device, over, mode, select))
}

/// `{"op": "revoke", "share", "as"?}` ends a share and every share resting on it, acting for `as`; `{"op": "revoke",
/// "vault", "owner"}` takes an owner out of a vault, `{"op": "revoke", "vault", "device"}` a device. Approved by the
/// vault's owners where it ends an owner's right, or a device's place but that of a device leaving. `{"edit": id}`.
fn revoke(lab: &mut Lab, me: SignerId, o: &Map<String, Value>) -> Result<Prepared, Refused> {
    let revoking = match (o.get("share"), o.get("vault"), o.get("owner"), o.get("device")) {
        (Some(_), None, None, None) => {
            let share = id_of(o.get("share"), "share", ShareId::from_hex)?;
            Revoking::Grant { share, actor: actor_of(lab, me, o)?, keep: vec![], via: vec![] }
        }
        (None, Some(_), Some(owner), None) => {
            Revoking::Owner { vault: vault_of(o, "vault")?, owner: principal_of(owner)?, keep: vec![] }
        }
        (None, Some(_), None, Some(d)) => {
            let device = id_of(Some(d), "device", SignerId::from_hex)?;
            Revoking::Device { vault: vault_of(o, "vault")?, device, keep: vec![] }
        }
        _ => return Err(bad("revoke ends a share, or takes a vault's owner or device out: {share} or {vault, owner}")),
    };
    governed(lab, me, Action::Revoke(revoking))
}

/// `{"op": "settings", "vault", "threshold"}` or `{"op": "settings", "vault", "root"}`: how many of vault `vault`'s
/// owners approve a change, or its root, a passkey or `null`, which only the root hands on, and only a human vault
/// has; approved by its owners, for a device acting for it. `{"edit": id}`.
fn settings(lab: &mut Lab, me: SignerId, o: &Map<String, Value>) -> Result<Prepared, Refused> {
    let vault = vault_of(o, "vault")?;
    let set = match (o.get("threshold"), o.get("root")) {
        (Some(t), None) => {
            let t = t.as_u64().and_then(|t| u32::try_from(t).ok());
            Setting::Threshold(t.ok_or_else(|| bad("threshold is how many owners approve, a count"))?)
        }
        (None, Some(Value::Null)) => Setting::Root { root: None, keep: vec![] },
        (None, Some(r)) => Setting::Root { root: Some(id_of(Some(r), "root", SignerId::from_hex)?), keep: vec![] },
        _ => return Err(bad("settings sets a vault's threshold or its root, one at a time")),
    };
    let st = lab.state(me);
    if !st.acts_for(me, vault) {
        return Err(Refusal::NotActing.into());
    }
    let human = st.vault(vault).is_none_or(|v| v.kind == Kind::Human);
    if matches!(set, Setting::Root { .. }) && !human {
        return Err(Refusal::NotHuman.into());
    }
    governed(lab, me, Action::Settings { vault, set })
}

/// `{"op": "found", "vaults": [{"kind", "name"}, ...]}`, or `{"op": "found", "kind", "name"}` for one: new vaults
/// device `me`'s own vault founds and owns alone, each `"aven"` or `"coop"` and named, their geneses drafted together
/// for one ceremony of the passkey. Once it signed them, the device acting for each through its vault gives avenCEO the
/// level it holds on the person's vault, backup or relay (`world::server_level`), and writes its profile (`approved`):
/// `{"vaults": [id, ...]}`, in the order named.
fn found(lab: &mut Lab, me: SignerId, o: &Map<String, Value>) -> Result<Prepared, Refused> {
    let one = |v: &Map<String, Value>| -> Result<(Kind, String), Refused> {
        let kind = match v.get("kind").and_then(Value::as_str) {
            Some("aven") => Kind::Aven,
            Some("coop") => Kind::Coop,
            _ => return Err(bad("a vault a vault founds is \"aven\" or \"coop\": kind")),
        };
        Ok((kind, name_of(v, "name", "a new vault")?))
    };
    let new: Vec<(Kind, String)> = match o.get("vaults") {
        Some(_) if o.contains_key("kind") || o.contains_key("name") => {
            return Err(bad("found takes its vaults, or one vault's kind and name"));
        }
        Some(vs) => {
            let vs = vs.as_array().ok_or_else(|| bad("vaults is a list of {kind, name}"))?;
            let each = |v: &Value| v.as_object().ok_or_else(|| bad("vaults is a list of {kind, name}")).and_then(one);
            vs.iter().map(each).collect::<Result<_, _>>()?
        }
        None => vec![one(o)?],
    };
    if new.is_empty() {
        return Err(bad("found names the vaults it founds"));
    }
    let mine = lab.vault_of(me).ok_or(Refusal::NotActing)?;
    let (passkey, signers) = approvers(lab, me, None).ok_or(Refusal::BelowThreshold)?;
    let nonces: Vec<u64> = new.iter().map(|_| lab.nonce()).collect();
    let mut drafting = lab.drafting(me);
    for (&(kind, _), nonce) in new.iter().zip(nonces) {
        let owners = vec![Principal::Vault(mine)];
        let genesis = Action::Genesis { kind, owners, threshold: 1, root: None, nonce, seal_to: vec![] };
        drafting.draft(&signers, genesis)?;
    }
    let (drafts, then) = (drafting.done(), Then::Found(new.into_iter().map(|(_, name)| name).collect()));
    Ok(Prepared::Approve(Approval { passkey, signers, drafts, then }))
}

/// `{"op": "put_file", "vault", "name", "media"?, "tags"?, "len", "as"?}` and the file's bytes, `brought` into the
/// node's store (`Node::store_file`): a new entry of type `file` (`world::FILE`) in vault `vault`, tagged `tags`,
/// acting for `as`, a record of avenDB's own `file` schema with the file's name and media type (`world::file`), whose
/// next write brings the file. Whoever may receive the write may fetch the file's sealed
/// bytes, and who reads the entry opens them (T27). `{"entry", "root", "size"}`, the file's root and sealed size.
/// Without the bytes, as `may` asks, the entry alone: `{"entry"}`.
pub fn put_file(
    lab: &mut Lab,
    me: SignerId,
    o: &Map<String, Value>,
    brought: Option<Brought>,
) -> Result<Value, Refused> {
    let (actor, vault, name) = (actor_of(lab, me, o)?, vault_of(o, "vault")?, name_of(o, "name", "a file")?);
    let media = match o.get("media") {
        None => "application/octet-stream",
        Some(m) => m.as_str().ok_or_else(|| bad("media is the file's media type, some text"))?,
    };
    let tags = texts_of(o, "tags")?;
    file_len(o)?;
    let entry = lab.create(me, actor, vault, FILE, &strs(&tags), world::file(&name, media, me))?;
    let Some(brought) = brought else { return Ok(json!({ "entry": entry.to_hex() })) };
    let root = brought.root;
    lab.bring(me, actor, entry, vec![brought], |_| {})?;
    Ok(json!({ "entry": entry.to_hex(), "root": hex(&root.hash), "size": root.size }))
}

/// How many bytes put_file op `o` brings: its `len`.
pub fn file_len(o: &Map<String, Value>) -> Result<u64, Refused> {
    bytes_of(o, "len")?.ok_or_else(|| bad("put_file takes the file's length in bytes: len"))
}

/// `{"op": "back_up", "on"}`: avenDB's server keeps a backup of the person's vault and of every vault it holds a share
/// on the whole of that device `me` acts for, if `on`, or relays alone, keeping nothing of their entries from then on:
/// the device gives avenCEO the one level on each, then revokes the shares of the other. What the server kept before,
/// it keeps. `{"changed": bool}`.
fn back_up(lab: &mut Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let on = bool_of(o, "on", "back_up")?;
    let (want, other) = if on { (Level::Backup, Level::Relay) } else { (Level::Relay, Level::Backup) };
    let mine = lab.vault_of(me).ok_or(Refusal::NotActing)?;
    let st = lab.state(me);
    let Some(avenceo) = world::avenceo(st, mine) else { return Ok(json!({ "changed": false })) };
    let to = Who::Vault(avenceo);
    let server = |cp: &&Issued| cp.share.wide && cp.share.who == to && st.live(cp.id);
    let mut vaults: Vec<VaultId> = st.shares().iter().filter(server).map(|cp| cp.share.over).collect();
    vaults.sort();
    vaults.dedup();
    vaults.retain(|&v| st.acts_for(me, v));
    let mut plan = vec![];
    for &v in &vaults {
        let has = st.shares_over(v).any(|cp| server(&cp) && cp.share.level == want);
        let ends: Vec<ShareId> =
            st.shares_over(v).filter(|cp| server(cp) && cp.share.level == other).map(|cp| cp.id).collect();
        plan.push((v, has, ends));
    }
    let mut changed = false;
    for (v, has, ends) in plan {
        if !has {
            lab.issue(me, &[me], cast::share(v, cast::vault(avenceo), want, Selector::All))?;
            changed = true;
        }
        for share in ends {
            let revoke = Revoking::Grant { share, actor: v, keep: vec![], via: vec![] };
            lab.submit(me, &[me], Action::Revoke(revoke))?;
            changed = true;
        }
    }
    Ok(json!({ "changed": changed }))
}

/// `{"op": "mark", "entry"}`: the steward's mark of entry `entry` now (`Lab::mark_now`), acting for its vault:
/// `{"edit": id}`, or `{"edit": null}` where the marks say what the shares say already.
fn mark(lab: &mut Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let edit = lab.mark_now(me, entry_of(o)?)?;
    Ok(json!({ "edit": edit.map(|e| e.to_hex()) }))
}

/// `{"op": "card", "name"}`: device `me`'s card reads `name`, written into its vault if it has none yet, its title set
/// if it reads otherwise. `{"wrote": bool}`: not while the device holds no key of its vault's seed yet, as a device
/// just linked until another device of the vault boxes it one, nor if its card reads `name` already.
fn card(lab: &mut Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let name = name_of(o, "name", "a device")?;
    let vault = lab.vault_of(me).ok_or(Refusal::NotActing)?;
    let wrote = |w: bool| Ok(json!({ "wrote": w }));
    if let Some((entry, title)) = world::cards(lab, me, vault).remove(&me) {
        if title == name {
            return wrote(false);
        }
        lab.edit(me, vault, entry, move |item| _ = world::retitle(item, CARD, &name))?;
        return wrote(true);
    }
    if !lab.holds_key(me, lab.state(me).current(KeyFam::Seed(vault))) {
        return wrote(false);
    }
    lab.create(me, vault, vault, CARD, &[], world::card(&name, me))?;
    wrote(true)
}

/// `{"op": "profile", "vault", "name"}`: vault `vault`'s profile reads `name` (`written`), for a device acting for it.
/// `{"wrote": bool}`.
fn profile(lab: &mut Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let (vault, name) = (vault_of(o, "vault")?, name_of(o, "name", "a vault")?);
    if !lab.state(me).acts_for(me, vault) {
        return Err(Refusal::NotActing.into());
    }
    Ok(json!({ "wrote": written(lab, me, vault, &name)? }))
}

/// Vault `vault`'s profile reads `name`, written by device `me` acting for the vault; or, if it has a profile, its
/// title set. A vault that has none yet first gives avenCEO, on the whole of it, the level it holds on the person's
/// vault: backup, so the server keeps its ciphertext, or relay alone (`world::server_level`); unless it is avenCEO
/// itself or avenCEO holds a share on the whole of it already. Whether it wrote: not if the profile reads `name`
/// already.
fn written(lab: &mut Lab, me: SignerId, vault: VaultId, name: &str) -> Result<bool, Refused> {
    if let Some((entry, title)) = world::profile_of(lab, me, vault) {
        if title == name {
            return Ok(false);
        }
        let name = name.to_string();
        lab.edit(me, vault, entry, move |item| _ = world::retitle(item, PROFILE, &name))?;
        return Ok(true);
    }
    let mine = lab.vault_of(me).ok_or(Refusal::NotActing)?;
    let st = lab.state(me);
    if let Some(avenceo) = world::avenceo(st, mine).filter(|&a| a != vault && !world::relays(st, vault, a)) {
        let level = world::server_level(st, mine, avenceo);
        lab.issue(me, &[me], cast::share(vault, cast::vault(avenceo), level, Selector::All))?;
    }
    lab.create(me, vault, vault, PROFILE, &[], world::profile(name, me))?;
    Ok(true)
}

/// `{"op": "follow", "vault", "on"}`: device `me` follows vault `vault` from now on, if `on`, or no longer: it names
/// the vaults it follows in each request it makes, and is sent what everyone reads of them (`Lab::follow`). Any device
/// may follow any vault. `{"follow": [id, ...]}`, every vault it follows, smallest first. A node keeps them, and asks
/// its peers again once they change (avendb-net's `Node::run`).
fn follow(lab: &mut Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let (vault, on) = (vault_of(o, "vault")?, bool_of(o, "on", "follow")?);
    let mut follows: Vec<VaultId> = lab.follows(me).iter().copied().filter(|&v| v != vault).collect();
    if on {
        follows.push(vault);
    }
    follows.sort();
    if !lab.is_dry() {
        lab.follow(me, &follows);
    }
    Ok(json!({ "follow": follows.iter().map(VaultId::to_hex).collect::<Vec<_>>() }))
}

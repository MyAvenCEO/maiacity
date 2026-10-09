//! What the page does: JSON actions, each on the device the page picks, as that device's apps would do them. The
//! rules decide: an action the device's own view refuses comes back refused, with the rule's reason in words.

use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

use avendb::cast;
use avendb::doc::Item;
use avendb::id::{EditId, EntryId, GrantId, SignerId, SpaceId, VaultId};
use avendb::lab::Lab;
use avendb::policy::{Action, Grantee, Kind, Principal, Refusal, Role, Scope, State};

use crate::show::{built_in, edits_at, id_at, ids_at, line_at, read_as};
use crate::tile::{acting, approvers, granting, hex, person_of, revoking, role_named, Tile};

/// Why an action didn't happen: the rules refused it, or the page asked for something that isn't there.
pub(crate) enum Fail {
    Refused(Refusal),
    Bad(String),
}

impl From<Refusal> for Fail {
    fn from(r: Refusal) -> Fail {
        Fail::Refused(r)
    }
}

impl From<String> for Fail {
    fn from(s: String) -> Fail {
        Fail::Bad(s)
    }
}

impl From<&str> for Fail {
    fn from(s: &str) -> Fail {
        Fail::Bad(s.into())
    }
}

#[wasm_bindgen]
impl Tile {
    /// An action, asked for in JSON (`{"do": name, "on": device, …}`) at `now` by the page's clock: `ok` with what it
    /// made and how many edits the devices online sent each other after it (`synced`), or why not: `refused` with the
    /// rule's reason, or an `error`.
    pub fn act(&mut self, action: &str, now: f64) -> String {
        match serde_json::from_str::<Value>(action) {
            Ok(a) => self.act_json(&a, now).to_string(),
            Err(e) => json!({"ok": false, "error": e.to_string()}).to_string(),
        }
    }
}

impl Tile {
    pub fn act_json(&mut self, a: &Value, now: f64) -> Value {
        let done = match self.world_mut() {
            Ok(_) => self.apply(a),
            Err(e) => Err(Fail::Bad(e)),
        };
        // as on the network, every device online hears of a change at once and asks for what it lacks; an offline
        // device waits until it is back online
        let synced = if done.is_ok() { self.sync() } else { 0 };
        self.stamp(now);
        match done {
            Ok(made) => json!({"ok": true, "made": made, "synced": synced}),
            Err(Fail::Refused(r)) => json!({"ok": false, "refused": format!("{r:?}"), "why": why(r)}),
            Err(Fail::Bad(e)) => json!({"ok": false, "error": e}),
        }
    }

    fn lab_mut(&mut self) -> &mut Lab {
        &mut self.world.as_mut().expect("a world made").lab
    }

    /// Every device online syncs with the others until nothing new arrives (`Lab::sync_all`), in another order each
    /// time: how many edits they sent.
    fn sync(&mut self) -> usize {
        self.counter += 1;
        let seed = self.counter;
        self.lab_mut().sync_all(seed)
    }

    fn apply(&mut self, a: &Value) -> Result<Value, Fail> {
        let what = a["do"].as_str().unwrap_or_default();
        match what {
            "online" => {
                let (d, online) = (self.device(a, "on")?, flag(a, "online")?);
                self.lab_mut().set_online(d, online);
                Ok(Value::Null)
            }
            "lock" | "unlock" => {
                let d = self.device(a, "on")?;
                let st = self.lab().state(d);
                if !person_of(st, d).and_then(|v| st.vault(v)).is_some_and(|v| v.root.is_some()) {
                    let only = "Only a human vault's device locks: its keys derive from its passkey as it unlocks.";
                    return Err(only.into());
                }
                if what == "lock" {
                    self.lab_mut().lock(d);
                } else if !self.lab_mut().unlock(d) {
                    return Err("Its passkey isn't at hand.".into());
                }
                Ok(Value::Null)
            }
            "checkpoint" => {
                let d = self.device(a, "on")?;
                self.lab_mut().checkpoint(d);
                Ok(Value::Null)
            }
            "pq_only" => {
                let on = flag(a, "value")?;
                self.lab_mut().set_pq_only(on);
                Ok(Value::Null)
            }
            "backup" => {
                let d = self.device(a, "on")?;
                let backup = self.lab().backup(d);
                self.backups.insert(d, backup);
                Ok(Value::Null)
            }
            "restore_backup" => {
                let d = self.device(a, "on")?;
                let backup = self.backups.get(&d).cloned().ok_or("There is no backup of this device yet.")?;
                self.lab_mut().restore_backup(d, &backup);
                Ok(Value::Null)
            }
            "put" => self.put(a),
            "create" => {
                let (d, sp) = (self.device(a, "on")?, self.space_at(a, "space")?);
                let title = text_at(a, "title")?;
                let actor = acting(self.lab().state(d), d, Scope::Space(sp), Role::Write);
                let item = if a["kind"] == "todo" {
                    Item::todo(title, d)
                } else {
                    let mut item = Item::document(title, d);
                    item.push_block(cast::heading(1, title));
                    item
                };
                let e = self.lab_mut().create(d, actor, sp, item)?;
                Ok(json!({"entry": hex(&e.0)}))
            }
            "propose" | "merge" | "promote" | "restore" | "revert" | "undo" | "variant" => self.history(what, a),
            "grant" => {
                let (d, sp) = (self.device(a, "on")?, self.space_at(a, "space")?);
                let sc = match a["entry"] {
                    Value::Null => Scope::Space(sp),
                    _ => Scope::Entry(sp, EntryId(id_at(a, "entry")?)),
                };
                let role = a["role"].as_str().and_then(role_named).ok_or("role must be relay, read, write or owner.")?;
                let to = match a["to"].as_str() {
                    Some("everyone") => Grantee::Public,
                    _ => cast::vault(VaultId(id_at(a, "to")?)),
                };
                let st = self.lab().state(d);
                let (issuer, parent) = granting(st, d, sc).unwrap_or((acting(st, d, sc, Role::Owner), None));
                // making someone owner is governance: the issuer's passkeys approve
                let mut signers = vec![d];
                if role == Role::Owner {
                    signers.extend(self.signers_for(a, st, &[Principal::Vault(issuer)])?);
                }
                let id = self.lab_mut().submit(d, &signers, cast::grant(sc, role, to, issuer, parent))?;
                Ok(json!({"grant": hex(&id.0), "signed": self.names(&signers)}))
            }
            "revoke" => {
                let d = self.device(a, "on")?;
                let grant = GrantId(id_at(a, "grant")?);
                let st = self.lab().state(d);
                let g = st.grant(grant).ok_or(Refusal::UnknownGrant)?;
                let actor = revoking(st, d, g).unwrap_or(g.issuer);
                let mut signers = vec![d];
                if g.role == Role::Owner {
                    signers.extend(self.signers_for(a, st, &[Principal::Vault(actor)])?);
                }
                self.lab_mut().submit(d, &signers, Action::Revoke { grant, actor, keep: vec![], via: vec![] })?;
                Ok(json!({"signed": self.names(&signers)}))
            }
            "found_space" => {
                let d = self.device(a, "on")?;
                let (actor, name) = (VaultId(id_at(a, "actor")?), text_at(a, "name")?);
                self.counter += 1;
                let (nonce, avenceo) = (self.counter, self.world.as_ref().expect("a world made").avenceo);
                let lab = self.lab_mut();
                let sp = SpaceId::from(lab.submit(d, &[d], Action::FoundSpace { actor, nonce, via: vec![] })?);
                // the founder gives avenCEO relay, so the space syncs through the server, avenCEO's device
                let relay = cast::grant(Scope::Space(sp), Role::Relay, cast::vault(avenceo), actor, None);
                lab.submit(d, &[d], relay)?;
                self.space_names.insert(sp, name.into());
                Ok(json!({"space": hex(&sp.0)}))
            }
            "publish" => {
                let (d, sp) = (self.device(a, "on")?, self.space_at(a, "space")?);
                let wanted = a["blob"].as_str().unwrap_or_default();
                let (_, _, blob) = built_in().into_iter().find(|b| b.0 == wanted).ok_or("No app knows that schema.")?;
                let actor = acting(self.lab().state(d), d, Scope::Space(sp), Role::Owner);
                let publish = Action::Publish { space: sp, actor, via: vec![], blob: blob.to_vec() };
                self.lab_mut().submit(d, &[d], publish)?;
                Ok(Value::Null)
            }
            "add_device" => {
                let d = self.device(a, "on")?;
                let name = text_at(a, "name")?;
                let st = self.lab().state(d);
                let vault = person_of(st, d).ok_or("This device is no human vault's device.")?;
                let root = st.vault(vault).and_then(|v| v.root).filter(|r| self.passkeys.contains(r));
                let passkey = root.ok_or("Its vault's passkey isn't at hand.")?;
                // the new device derives its keys from the passkey, and countersigns
                let device = self.lab_mut().device_of(passkey, name);
                self.signers.push(device);
                let add = Action::AddDevice { vault, device, seal_to: None };
                self.lab_mut().submit(d, &[passkey, device], add)?;
                Ok(json!({"device": hex(&device.0), "signed": self.names(&[passkey, device])}))
            }
            "add_passkey" => {
                let d = self.device(a, "on")?;
                let st = self.lab().state(d);
                let vault = person_of(st, d).ok_or("This device is no human vault's device.")?;
                let signers = self.signers_for(a, st, &[Principal::Vault(vault)])?;
                let name = format!("{}'s backup passkey", self.vault_name(vault));
                let lab = self.lab_mut();
                let passkey = lab.passkey(&name);
                self.passkeys.insert(passkey);
                self.signers.push(passkey);
                let add = Action::AddOwner { vault, owner: Principal::Signer(passkey), seal_to: None };
                let signers = [signers, vec![passkey]].concat();
                self.lab_mut().submit(d, &signers, add)?;
                Ok(json!({"passkey": hex(&passkey.0), "signed": self.names(&signers)}))
            }
            "remove_device" => {
                let d = self.device(a, "on")?;
                let device = SignerId(id_at(a, "device")?);
                let st = self.lab().state(d);
                // a human vault's device, or an aven vault's server
                let vault = st.vaults().iter().find(|v| v.devices.contains(&device)).map(|v| v.id);
                let vault = vault.ok_or("No vault lists that device.")?;
                let signers = self.signers_for(a, st, &[Principal::Vault(vault)])?;
                self.lab_mut().submit(d, &signers, Action::RemoveDevice { vault, device, keep: vec![] })?;
                Ok(json!({"signed": self.names(&signers)}))
            }
            "create_coop" => {
                let d = self.device(a, "on")?;
                let name = text_at(a, "name")?;
                let owners: Vec<Principal> =
                    ids_at(a, "owners")?.into_iter().map(|v| Principal::Vault(VaultId(v))).collect();
                let threshold = a["threshold"].as_u64().map_or(owners.len() as u32, |t| t as u32);
                // every first owner consents
                let signers = self.signers_for(a, self.lab().state(d), &owners)?;
                self.counter += 1;
                let nonce = self.counter;
                let genesis =
                    Action::Genesis { kind: Kind::Coop, owners, threshold, root: None, nonce, seal_to: vec![] };
                let coop = VaultId::from(self.lab_mut().submit(d, &signers, genesis)?);
                self.vault_names.insert(coop, name.into());
                Ok(json!({"vault": hex(&coop.0), "signed": self.names(&signers)}))
            }
            "add_owner" | "remove_owner" | "set_threshold" | "leave" => self.govern(what, a),
            "" => Err("Say what to do.".into()),
            other => Err(format!("There is no action {other:?}.").into()),
        }
    }

    /// An app's edit: its view of an entry on a line is now `value`. Only what changed becomes one encrypted write,
    /// under the app's schema; nothing at all if nothing changed.
    fn put(&mut self, a: &Value) -> Result<Value, Fail> {
        let (d, sp, e) = self.entry_at(a)?;
        let line = line_at(a, "line")?;
        let value = a.get("value").cloned().ok_or("Say what the app's view is now.")?;
        let lab = self.lab();
        let item = lab.item_on(d, sp, e, line).ok_or(Refusal::ReadOnly)?;
        let record = item.record();
        let app = match (record["kind"].as_str(), a["app"].as_str()) {
            (Some("document"), Some("v1")) => &*avendb::lens::DOCUMENT_V1,
            (Some("document"), _) => &*avendb::lens::DOCUMENT_V2,
            (Some("todo"), Some("v1")) => &*avendb::lens::TODO_V1,
            (Some("todo"), _) => &*avendb::lens::TODO_V2,
            _ => return Err(Refusal::ReadOnly.into()),
        };
        let (seen, read_only) = read_as(lab, d, sp, item, app);
        let seen = seen.filter(|_| !read_only).ok_or(Refusal::ReadOnly)?;
        let view = lab.lane(d, sp).view(app, &item.authored()).0;
        if view.put(&record, &value).is_none() {
            return Err(Refusal::NotAView.into());
        }
        if value == seen {
            return Ok(Value::Null);
        }
        let actor = acting(lab.state(d), d, Scope::Entry(sp, e), Role::Write);
        let edit = self.lab_mut().edit_on(d, actor, sp, e, line, |item| {
            item.write(&view, &value);
        })?;
        Ok(json!({"edit": hex(&edit.0)}))
    }

    /// Propose, merge, promote, restore, revert or undo on an entry's history, or make a variant of the entry.
    fn history(&mut self, what: &str, a: &Value) -> Result<Value, Fail> {
        let (d, sp, e) = self.entry_at(a)?;
        let st = self.lab().state(d);
        let actor = acting(st, d, Scope::Entry(sp, e), Role::Write);
        let line = line_at(a, "line")?;
        let item = (sp, e);
        let edit = match what {
            "propose" => {
                let name = text_at(a, "name")?;
                let from = match edits_at(a, "from") {
                    Ok(v) if !v.is_empty() => v,
                    _ => st.heads(sp, e, line),
                };
                // the proposal is named by the write that starts it
                let start = self.lab_mut().propose(d, actor, item, &from, name)?;
                return Ok(json!({"edit": hex(&start.0), "line": hex(&start.0)}));
            }
            "merge" | "promote" => {
                let (from, into) = (line_at(a, "from")?, line_at(a, "into")?);
                if from == into {
                    return Err("A line merges into another line.".into());
                }
                if what == "merge" {
                    self.lab_mut().merge(d, actor, item, from, into)?
                } else {
                    self.lab_mut().promote(d, actor, item, from, into)?
                }
            }
            "restore" => {
                let version = edits_at(a, "version")?;
                self.lab_mut().restore(d, actor, item, line, &version)?
            }
            "revert" => {
                // the line goes back to the version its latest edit built on there: for a merge, the line's own
                // heads before it, as what it merged in is what it reverts
                let history = st.history(sp, e, line);
                let own = |dep: &EditId| history.iter().any(|w| w.edit == *dep && w.line() == line);
                let latest = history.last().map(|w| w.deps.iter().copied().filter(own).collect::<Vec<_>>());
                let built_on = latest.filter(|deps| !deps.is_empty());
                let built_on = built_on.ok_or("There is no earlier version to go back to.")?;
                self.lab_mut().restore(d, actor, item, line, &built_on)?
            }
            "undo" => {
                let edit = EditId(id_at(a, "edit")?);
                self.lab_mut().undo(d, actor, item, line, edit)?
            }
            _ => {
                let into = self.space_at(a, "into")?;
                let actor = acting(st, d, Scope::Space(into), Role::Write);
                let copy = self.lab_mut().variant(d, actor, item, line, into)?;
                return Ok(json!({"entry": hex(&copy.0), "space": hex(&into.0)}));
            }
        };
        Ok(json!({"edit": hex(&edit.0)}))
    }

    /// Change a vault's owners or threshold: by the vault's approval, or an owner leaving on its own, approved by
    /// itself.
    fn govern(&mut self, what: &str, a: &Value) -> Result<Value, Fail> {
        let d = self.device(a, "on")?;
        let vault = VaultId(id_at(a, "vault")?);
        let st = self.lab().state(d);
        let vt = st.vault(vault).ok_or(Refusal::UnknownVault)?;
        let principal = |id: [u8; 32]| match st.vault(VaultId(id)) {
            Some(_) => Principal::Vault(VaultId(id)),
            None => Principal::Signer(SignerId(id)),
        };
        let (action, approve) = match what {
            "add_owner" => {
                // the newcomer consents too
                let owner = principal(id_at(a, "owner")?);
                (Action::AddOwner { vault, owner, seal_to: None }, vec![Principal::Vault(vault), owner])
            }
            "remove_owner" => {
                let owner = principal(id_at(a, "owner")?);
                (Action::RemoveOwner { vault, owner, keep: vec![] }, vec![Principal::Vault(vault)])
            }
            "set_threshold" => {
                let threshold = a["threshold"].as_u64().ok_or("Say the new threshold.")? as u32;
                (Action::SetThreshold { vault, threshold }, vec![Principal::Vault(vault)])
            }
            _ => {
                // the owner this device acts for leaves on its own
                let mine = vt.owners.iter().copied().find(|p| match *p {
                    Principal::Vault(o) => st.acts_for(d, o),
                    Principal::Signer(s) => s == d,
                });
                let owner = mine.ok_or("This device acts for no owner of that vault.")?;
                (Action::RemoveOwner { vault, owner, keep: vec![] }, vec![owner])
            }
        };
        let signers = self.signers_for(a, st, &approve)?;
        self.lab_mut().submit(d, &signers, action)?;
        Ok(json!({"signed": self.names(&signers)}))
    }

    /// The signers of a governance change: the page's own list when it gives one (each a signer the tile made), else
    /// the passkeys that approve for each of `approve`.
    fn signers_for(&self, a: &Value, st: &State, approve: &[Principal]) -> Result<Vec<SignerId>, Fail> {
        let mut signers: Vec<SignerId> = vec![];
        if a["signers"].is_array() {
            for s in ids_at(a, "signers")?.into_iter().map(SignerId) {
                if !self.signers.contains(&s) {
                    return Err("That isn't a signer the Lab holds.".into());
                }
                signers.push(s);
            }
        } else {
            for &p in approve {
                signers.extend(approvers(st, p).into_iter().filter(|s| !signers.contains(s)).collect::<Vec<_>>());
            }
        }
        if signers.is_empty() { Err(Refusal::BelowThreshold.into()) } else { Ok(signers) }
    }

    fn names(&self, signers: &[SignerId]) -> Vec<String> {
        signers.iter().map(|&s| self.signer_name(s)).collect()
    }

    /// The space at `key`, one the device of the action knows.
    fn space_at(&self, a: &Value, key: &str) -> Result<SpaceId, Fail> {
        let (d, sp) = (self.device(a, "on")?, SpaceId(id_at(a, key)?));
        match self.lab().state(d).space(sp) {
            Some(_) => Ok(sp),
            None => Err("This device doesn't know that space.".into()),
        }
    }
}

fn flag(a: &Value, key: &str) -> Result<bool, Fail> {
    a[key].as_bool().ok_or_else(|| format!("{key} must be true or false.").into())
}

fn text_at<'a>(a: &'a Value, key: &str) -> Result<&'a str, Fail> {
    match a[key].as_str().map(str::trim) {
        Some(t) if !t.is_empty() => Ok(t),
        _ => Err(format!("Give it a {key}.").into()),
    }
}

/// A refusal in words, as the page shows it.
pub(crate) fn why(r: Refusal) -> &'static str {
    match r {
        Refusal::BadSignature => "A signature doesn't check out.",
        Refusal::Duplicate => "That was done already.",
        Refusal::UnknownVault => "This device doesn't know that vault.",
        Refusal::UnknownSpace => "This device doesn't know that space.",
        Refusal::UnknownGrant => "This device doesn't know that grant.",
        Refusal::BadOwners => "A vault needs owners, each named once.",
        Refusal::AlreadyMember => "It is there already.",
        Refusal::NotMember => "It isn't there to remove.",
        Refusal::NoConsent => "Whoever joins has to sign too.",
        Refusal::BelowThreshold => "Too few owners approved: the vault's passkey or its threshold of owners must sign.",
        Refusal::BadThreshold => "The threshold must be at least 1 and at most the number of owners.",
        Refusal::WrongOwnerKind => "A human vault is owned by passkeys; a coop or aven vault by human or coop vaults.",
        Refusal::LastOwner => "A vault keeps at least one owner.",
        Refusal::Cycle => "A vault can't own itself, not even through other vaults.",
        Refusal::NotHuman => "Only a human vault has a root passkey.",
        Refusal::NoDevices => "A coop vault has no devices: it acts through the vaults that own it.",
        Refusal::NotRoot => "Only the vault's root passkey hands the root on.",
        Refusal::NotActing => "This device doesn't act for that vault through the vaults it names.",
        Refusal::NoCap => "No vault this device acts for holds the right for that.",
        Refusal::GrantToSigner => "Rights go to vaults, never to a device or a passkey.",
        Refusal::PublicBeyondRead => "Everyone can only ever read.",
        Refusal::BadParent => "The grant it would rest on doesn't cover it.",
        Refusal::FutureEpoch => "It names a key that doesn't exist yet.",
        Refusal::UnknownDep => "It builds on a write this device doesn't hold.",
        Refusal::NotOnProposal => "It isn't on that proposal.",
        Refusal::UnknownKey => "That key doesn't exist.",
        Refusal::NotEntitled => "This device may not open that key.",
        Refusal::Unsealed => "A key would be sealed where the schedule doesn't seal it.",
        Refusal::NotPublic => "That isn't public.",
        Refusal::AlreadyPublished => "That schema is in the lane already.",
        Refusal::NotOwnWrite => "A device vouches only for its own writes.",
        Refusal::Locked => "The device is locked, or a signer's key isn't at hand.",
        Refusal::ReadOnly => "This app opens it read-only: no lens it holds reaches every version it was written in.",
        Refusal::NotAView => "That edit doesn't fit the app's schema.",
        Refusal::NotJoining => "A device joins a vault only by adding itself.",
        Refusal::NotClaiming => "A claim adds the server itself as a device of an aven vault.",
    }
}

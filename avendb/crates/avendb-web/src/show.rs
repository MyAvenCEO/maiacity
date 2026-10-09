//! What the page reads: JSON views of the world as one device holds it, and of every device at once for the Lab.

use std::collections::HashMap;

use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

use avendb::branch::{Commit, History, MAIN};
use avendb::doc::Item;
use avendb::id::{EntryId, GrantId, OpId, SignerId, SpaceId, VaultId};
use avendb::keys::KeyScope;
use avendb::lab::Lab;
use avendb::lens::{Schema, Status, DOCUMENT_V1, DOCUMENT_V2, TODO_V1, TODO_V2};
use avendb::policy::{Action, Branch, Grant, Grantee, Kind, Line, Op, Principal, Role, Scope, State, Vault, Write};

use crate::tile::{approvers, fingerprint, granting, hex, person_of, role_name, role_on, unhex, Tile};

#[wasm_bindgen]
impl Tile {
    /// A view, asked for and answered in JSON: `{"view": name, "on": device, …}`. An `error` says why there is none.
    pub fn view(&self, query: &str) -> String {
        let answer = serde_json::from_str::<Value>(query).map_err(|e| e.to_string()).and_then(|q| self.show(&q));
        answer.unwrap_or_else(|e| json!({"error": e})).to_string()
    }
}

impl Tile {
    /// The view `q` asks for.
    pub fn show(&self, q: &Value) -> Result<Value, String> {
        self.world()?;
        match q["view"].as_str().unwrap_or_default() {
            "overview" => Ok(self.overview()),
            "vaults" => Ok(self.vaults(self.device(q, "on")?)),
            "spaces" => Ok(self.spaces(self.device(q, "on")?)),
            "entry" => {
                let (d, sp, e) = self.entry_at(q)?;
                self.entry(d, sp, e, line_at(q, "line")?, app_at(q))
            }
            "version" => {
                let (d, sp, e) = self.entry_at(q)?;
                self.version(d, sp, e, &ops_at(q, "version")?, line_at(q, "line")?, app_at(q))
            }
            "access" => {
                let d = self.device(q, "on")?;
                let entry = if q["entry"].is_null() { None } else { Some(EntryId(id_at(q, "entry")?)) };
                self.access(d, SpaceId(id_at(q, "space")?), entry)
            }
            "todos" => Ok(self.todos(self.device(q, "on")?)),
            "schemas" => self.schemas(self.device(q, "on")?, SpaceId(id_at(q, "space")?)),
            "lab" => Ok(self.columns(SpaceId(id_at(q, "space")?), EntryId(id_at(q, "entry")?))),
            "approvers" => {
                let d = self.device(q, "on")?;
                let st = self.lab().state(d);
                let mut signers = vec![];
                for v in ids_at(q, "vaults")? {
                    let p = Principal::Vault(avendb::id::VaultId(v));
                    signers.extend(approvers(st, p).into_iter().filter(|s| !signers.contains(s)).collect::<Vec<_>>());
                }
                Ok(json!(signers.into_iter().map(|s| self.signer(s)).collect::<Vec<_>>()))
            }
            other => Err(format!("There is no view {other:?}.")),
        }
    }

    /// Device `key` of the query: one of the Lab's devices.
    pub(crate) fn device(&self, q: &Value, key: &str) -> Result<SignerId, String> {
        let d = SignerId(id_at(q, key)?);
        if self.lab().devices().contains(&d) { Ok(d) } else { Err("That isn't one of the Lab's devices.".into()) }
    }

    /// The device, space and entry of the query, the space one the device knows.
    pub(crate) fn entry_at(&self, q: &Value) -> Result<(SignerId, SpaceId, EntryId), String> {
        let (d, sp, e) = (self.device(q, "on")?, SpaceId(id_at(q, "space")?), EntryId(id_at(q, "entry")?));
        match self.lab().state(d).space(sp) {
            Some(_) => Ok((d, sp, e)),
            None => Err("This device doesn't know that space.".into()),
        }
    }

    /// Every device, with what it holds and whether it is online and unlocked; every signer the tile made, with its
    /// fingerprint; and what the page opens first.
    fn overview(&self) -> Value {
        let w = self.world.as_ref().expect("a world made");
        let lab = &w.lab;
        let devices: Vec<Value> = lab
            .devices()
            .iter()
            .map(|&d| {
                let st = lab.state(d);
                let human = person_of(st, d).map(|v| self.vault_name(v));
                let vault = st.vaults().iter().find(|v| v.devices.contains(&d)).map(|v| self.vault_name(v.id));
                json!({
                    "id": hex(&d.0),
                    "name": self.signer_name(d),
                    "vault": vault,
                    "human": human,
                    "online": lab.online(d),
                    "locked": lab.locked(d),
                    "ops": lab.log(d).ops().len(),
                    "forks": lab.forks(d).len(),
                    "backup": self.backups.contains_key(&d),
                })
            })
            .collect();
        let signers: Vec<Value> = self
            .signers
            .iter()
            .map(|&s| {
                let kind = match () {
                    _ if self.passkeys.contains(&s) => "passkey",
                    _ if lab.devices().contains(&s) => "device",
                    _ => "key",
                };
                json!({"id": hex(&s.0), "name": self.signer_name(s), "kind": kind, "fingerprint": fingerprint(s)})
            })
            .collect();
        let demo = self.demo.as_ref().expect("the tile's spaces");
        json!({
            "devices": devices,
            "signers": signers,
            "pqOnly": lab.pq_only(),
            "start": {
                "device": hex(&w.mac_a.0),
                "coop": hex(&demo.coop.0),
                "space": hex(&demo.handbook.0),
                "entry": hex(&demo.welcome.0),
                "todos": hex(&demo.todos.0),
                "door": hex(&demo.door.0),
            },
        })
    }

    /// Every vault device `d` knows: its owners, threshold, devices and root, whether `d` acts for it, its key's epoch
    /// and whether `d` holds that key, and the signers that would approve a change to it.
    fn vaults(&self, d: SignerId) -> Value {
        let lab = self.lab();
        let st = lab.state(d);
        let vaults: Vec<Value> = st
            .vaults()
            .iter()
            .map(|v| {
                let k = KeyScope::Vault(v.id);
                let epoch = st.epoch(k);
                let approve: Vec<Value> =
                    approvers(st, Principal::Vault(v.id)).into_iter().map(|s| self.signer(s)).collect();
                json!({
                    "id": hex(&v.id.0),
                    "name": self.vault_name(v.id),
                    "kind": kind_name(v),
                    "owners": v.owners.iter().map(|&p| self.principal(p)).collect::<Vec<_>>(),
                    "threshold": v.threshold,
                    "devices": v.devices.iter().map(|&s| self.signer(s)).collect::<Vec<_>>(),
                    "root": v.root.map(|r| self.signer(r)),
                    "mine": st.acts_for(d, v.id),
                    "epoch": epoch,
                    "holdsKey": lab.holds_key(d, k, epoch),
                    "approvers": approve,
                })
            })
            .collect();
        json!({"vaults": vaults, "me": person_of(st, d).map(|v| hex(&v.0))})
    }

    /// Every space device `d` knows, with its founder, `d`'s role there and through which vault, and each entry it
    /// holds; and the vaults `d` acts for, any of which may found a space.
    fn spaces(&self, d: SignerId) -> Value {
        let st = self.lab().state(d);
        let spaces: Vec<Value> = st
            .spaces()
            .iter()
            .map(|s| {
                let sc = Scope::Space(s.id);
                let role = role_on(st, d, sc);
                json!({
                    "id": hex(&s.id.0),
                    "name": self.space_name(s.id),
                    "founder": self.vault(s.founder),
                    "role": role.map(|r| role_name(r.0)),
                    "through": role.map(|r| self.vault(r.1)),
                    "public": st.is_public(sc),
                    "lane": st.lane_of(s.id).count(),
                    "entries": s.entries.iter().map(|&e| self.card(d, st, s.id, e)).collect::<Vec<_>>(),
                })
            })
            .collect();
        let acts: Vec<Value> = st.vaults().iter().filter(|v| st.acts_for(d, v.id)).map(|v| self.vault(v.id)).collect();
        json!({"spaces": spaces, "actsFor": acts})
    }

    /// One entry as device `d` lists it: its title and kind if it opens it, how many writes it holds and their size.
    fn card(&self, d: SignerId, st: &State, sp: SpaceId, e: EntryId) -> Value {
        let lab = self.lab();
        let item = lab.item(d, sp, e);
        let record = item.map_or(Value::Null, Item::record);
        let status = item.and_then(Item::as_todo).map(|t| status_name(t.status));
        let role = role_on(st, d, Scope::Entry(sp, e));
        json!({
            "id": hex(&e.0),
            "title": record["title"],
            "kind": record["kind"],
            "status": status,
            "opens": item.is_some(),
            "writes": st.writes(sp, e).len(),
            "held": lab.fetched(d, sp, e),
            "bytes": sealed_bytes(lab, d, sp, e),
            "lines": st.lines(sp, e).len(),
            "role": role.map(|r| role_name(r.0)),
            "public": st.is_public(Scope::Entry(sp, e)),
        })
    }

    /// An entry on line `line` as device `d` shows it to an app on `app` ("v1" or "v2" of its kind): the app's view
    /// and whether it opens it read-only, the raw record, the schemas it was written under, its lines, and every
    /// commit, with what each did and the schemas it was written under.
    fn entry(&self, d: SignerId, sp: SpaceId, e: EntryId, line: Line, app: &str) -> Result<Value, String> {
        let lab = self.lab();
        let st = lab.state(d);
        let item = lab.item_on(d, sp, e, line);
        let record = item.map(Item::record);
        let schema = record.as_ref().and_then(|r| app_schema(r, app));
        let (value, read_only) = match (item, schema) {
            (Some(i), Some(s)) => read_as(lab, d, sp, i, s),
            _ => (None, true),
        };
        let ops = writes_of(lab, d, sp, e);
        let (lines, commits) = match lab.history(d, sp, e) {
            Some(h) => (self.lines(h), self.commits(d, h, &ops)),
            None => {
                let sealed = st.all_writes().iter().filter(|w| (w.space, w.entry) == (sp, e));
                let commits = sealed.map(|w| self.commit(w, &ops, "sealed", false, vec![], None)).collect();
                (json!([{"id": null, "name": "main", "heads": []}]), commits)
            }
        };
        let authored: Vec<String> = item.map(|i| i.authored().iter().map(|b| b.to_hex()).collect()).unwrap_or_default();
        let role = role_on(st, d, Scope::Entry(sp, e));
        Ok(json!({
            "id": hex(&e.0),
            "space": {"id": hex(&sp.0), "name": self.space_name(sp)},
            "line": line.map(|l| hex(&l.0)),
            "kind": record.as_ref().map(|r| r["kind"].clone()),
            "title": record.as_ref().map(|r| r["title"].clone()),
            "opens": item.is_some(),
            "app": app,
            "schema": schema.map(|s| s.id().to_hex()),
            "value": value,
            "readOnly": read_only,
            "record": record,
            "authored": authored,
            "lines": lines,
            "commits": commits,
            "role": role.map(|r| role_name(r.0)),
            "through": role.map(|r| self.vault(r.1)),
            "held": lab.fetched(d, sp, e),
            "bytes": sealed_bytes(lab, d, sp, e),
        }))
    }

    /// The main line, then each branch: its name where the device reads it, its heads, and the version it started from.
    fn lines(&self, h: &History) -> Value {
        let lines: Vec<Value> = h
            .lines()
            .into_iter()
            .map(|l| {
                let start = l.and_then(|b| h.get(b)).map(|c| hexes(&c.write.deps));
                json!({
                    "id": l.map(|b| hex(&b.0)),
                    "name": l.map_or_else(|| Some("main".to_string()), |b| h.name(b)),
                    "heads": hexes(&h.heads(l)),
                    "from": start,
                })
            })
            .collect();
        json!(lines)
    }

    fn commits(&self, d: SignerId, h: &History, ops: &HashMap<OpId, &Op>) -> Value {
        let commits: Vec<Value> = h
            .commits()
            .iter()
            .map(|c| {
                let schemas: Vec<String> = h.written_under(c.write.op, d).iter().map(|b| b.to_hex()).collect();
                let kind = kind_of(h, c, &schemas);
                let name = if c.write.branch == Branch::New { h.name(c.write.op) } else { None };
                self.commit(&c.write, ops, kind, c.body.is_some(), schemas, name)
            })
            .collect();
        json!(commits)
    }

    fn commit(
        &self,
        w: &Write,
        ops: &HashMap<OpId, &Op>,
        kind: &str,
        opened: bool,
        schemas: Vec<String>,
        name: Option<String>,
    ) -> Value {
        let op = ops.get(&w.op);
        json!({
            "op": hex(&w.op.0),
            "clock": op.map(|o| o.depth),
            "when": self.made_at.get(&w.op),
            "author": self.signer(w.author),
            "actor": self.vault(w.actor),
            "epoch": w.epoch,
            "line": w.line().map(|l| hex(&l.0)),
            "kind": kind,
            "opened": opened,
            "bytes": op.map(|o| body_len(o)),
            "deps": hexes(&w.deps),
            "schemas": schemas,
            "name": name,
        })
    }

    /// The entry at `version` (any of its writes, with what they build on), opened read-only as an app on `app` edits
    /// line `line`.
    fn version(
        &self,
        d: SignerId,
        sp: SpaceId,
        e: EntryId,
        version: &[OpId],
        line: Line,
        app: &str,
    ) -> Result<Value, String> {
        let lab = self.lab();
        let h = lab.history(d, sp, e).ok_or("This device holds no write of that entry it can open.")?;
        if version.iter().any(|&o| h.get(o).is_none()) {
            return Err("That version isn't in this device's history of the entry.".into());
        }
        let item = h.item_at(version, d, line);
        let record = item.record();
        let value = app_schema(&record, app).and_then(|s| read_as(lab, d, sp, &item, s).0);
        Ok(json!({"record": record, "value": value, "commits": h.version(version).len()}))
    }

    /// Vault `v` by its id, its name and its kind (`kind_name`).
    fn vault_of_kind(&self, v: &Vault) -> Value {
        json!({"id": hex(&v.id.0), "name": self.vault_name(v.id), "kind": kind_name(v)})
    }

    /// Who may read, write or own a space or one of its entries by device `d`'s view, and why: the founder, or each
    /// grant with the chain it rests on; every grant there, whether the scope is public, and the scope's key: its
    /// epochs, which vaults' devices hold each, and what the current one is sealed to.
    fn access(&self, d: SignerId, sp: SpaceId, e: Option<EntryId>) -> Result<Value, String> {
        let lab = self.lab();
        let st = lab.state(d);
        let founder = st.founder(sp).ok_or("This device doesn't know that space.")?;
        let sc = e.map_or(Scope::Space(sp), |e| Scope::Entry(sp, e));
        let grants: Vec<(GrantId, Grant)> = st.grants().into_iter().filter(|(_, g)| g.scope.covers(sc)).collect();
        let holders: Vec<Value> = st
            .vaults()
            .iter()
            .filter_map(|v| {
                let roles = [Role::Owner, Role::Write, Role::Read, Role::Relay];
                let role = roles.into_iter().find(|&r| st.holds(v.id, sc, r))?;
                let mut why = vec![];
                if founder == v.id {
                    why.push(json!({"founded": true}));
                }
                let mine = Grantee::Principal(Principal::Vault(v.id));
                why.extend(grants.iter().filter(|(_, g)| g.grantee == mine).map(|(id, g)| self.grant(st, *id, g)));
                Some(json!({
                    "vault": self.vault(v.id),
                    "kind": kind_name(v),
                    "role": role_name(role),
                    "why": why,
                    "mine": st.acts_for(d, v.id),
                }))
            })
            .collect();
        let k = e.map_or(KeyScope::Space(sp), |e| KeyScope::Entry(sp, e));
        let epoch = st.epoch(k);
        let keys: Vec<Value> = (0..=epoch)
            .map(|ep| {
                // by vault: each vault whose devices hold it, and which of them do; a device of none on its own
                let mut held: Vec<(Option<VaultId>, Vec<Value>)> = vec![];
                for &x in lab.devices().iter().filter(|&&x| lab.holds_key(x, k, ep)) {
                    let v = st.vaults().iter().find(|v| v.devices.contains(&x)).map(|v| v.id);
                    match held.iter_mut().find(|(w, _)| *w == v) {
                        Some((_, devices)) => devices.push(self.signer(x)),
                        None => held.push((v, vec![self.signer(x)])),
                    }
                }
                let held: Vec<Value> = held
                    .into_iter()
                    .map(|(v, devices)| json!({"vault": v.map(|v| self.vault(v)), "devices": devices}))
                    .collect();
                json!({"epoch": ep, "holders": held})
            })
            .collect();
        let sealed_to: Vec<String> = st.targets(k).into_iter().map(|t| self.key_name(t)).collect();
        Ok(json!({
            "scope": if e.is_some() { "entry" } else { "space" },
            "founder": self.vault(founder),
            "public": st.is_public(sc),
            "holders": holders,
            "grants": grants.iter().map(|(id, g)| self.grant(st, *id, g)).collect::<Vec<_>>(),
            "epoch": epoch,
            "keys": keys,
            "sealedTo": sealed_to,
            "grantsAs": granting(st, d, sc).map(|(v, _)| self.vault(v)),
            "vaults": st.vaults().iter().map(|v| self.vault_of_kind(v)).collect::<Vec<_>>(),
        }))
    }

    /// A grant: its role, scope, grantee and issuer, and the grants it rests on, up to the founder's.
    fn grant(&self, st: &State, id: GrantId, g: &Grant) -> Value {
        let mut chain = vec![];
        let mut at = g.parent;
        while let Some(p) = at {
            let Some(pg) = st.grant(p).filter(|_| chain.len() < 32) else { break };
            chain.push(json!({"id": hex(&p.0), "role": role_name(pg.role), "issuer": self.vault(pg.issuer)}));
            at = pg.parent;
        }
        let to = match g.grantee {
            Grantee::Public => json!({"kind": "everyone", "name": "everyone"}),
            Grantee::Principal(p) => self.principal(p),
        };
        json!({
            "id": hex(&id.0),
            "role": role_name(g.role),
            "scope": match g.scope { Scope::Space(_) => "space", Scope::Entry(..) => "entry" },
            "to": to,
            "issuer": self.vault(g.issuer),
            "chain": chain,
            "when": self.made_at.get(&OpId(id.0)),
        })
    }

    /// Every todo device `d` opens, each marked shared where a vault it doesn't act for founded its space.
    fn todos(&self, d: SignerId) -> Value {
        let lab = self.lab();
        let st = lab.state(d);
        let mut todos = vec![];
        for s in st.spaces() {
            for &e in &s.entries {
                let Some(t) = lab.item(d, s.id, e).and_then(Item::as_todo) else { continue };
                let role = role_on(st, d, Scope::Entry(s.id, e));
                todos.push(json!({
                    "space": {"id": hex(&s.id.0), "name": self.space_name(s.id)},
                    "id": hex(&e.0),
                    "title": t.title,
                    "status": status_name(t.status),
                    "notes": t.notes,
                    "due": t.due,
                    "shared": !st.acts_for(d, s.founder),
                    "role": role.map(|r| role_name(r.0)),
                }));
            }
        }
        json!({"todos": todos})
    }

    /// A space's schema lane as device `d` holds it: each schema and lens with its JSON, the apps' own schemas, and
    /// for each entry it opens, the schemas each commit was written under.
    fn schemas(&self, d: SignerId, sp: SpaceId) -> Result<Value, String> {
        let lab = self.lab();
        let st = lab.state(d);
        let space = st.space(sp).ok_or("This device doesn't know that space.")?;
        let lane = lab.lane(d, sp);
        let text = |b: &[u8]| String::from_utf8_lossy(b).into_owned();
        let schemas: Vec<Value> = lane
            .schemas()
            .map(|s| json!({"id": s.id().to_hex(), "title": s.title(), "json": text(s.bytes())}))
            .collect();
        let lenses: Vec<Value> = lane
            .lenses()
            .map(|l| {
                let (from, to) = (l.from().to_hex(), l.to().to_hex());
                json!({"id": l.id().to_hex(), "title": l.title(), "from": from, "to": to, "json": text(l.bytes())})
            })
            .collect();
        let written: Vec<Value> = space
            .entries
            .iter()
            .filter_map(|&e| {
                let h = lab.history(d, sp, e)?;
                let title = lab.item(d, sp, e).map(|i| i.record()["title"].clone());
                let commits: Vec<Value> = h
                    .commits()
                    .iter()
                    .map(|c| {
                        let schemas: Vec<String> =
                            h.written_under(c.write.op, d).iter().map(|b| b.to_hex()).collect();
                        let kind = kind_of(h, c, &schemas);
                        let author = self.signer(c.write.author);
                        json!({"op": hex(&c.write.op.0), "kind": kind, "author": author, "schemas": schemas})
                    })
                    .collect();
                Some(json!({"entry": hex(&e.0), "title": title, "commits": commits}))
            })
            .collect();
        let apps: Vec<Value> = built_in()
            .iter()
            .map(|(id, title, bytes)| {
                json!({"id": id, "title": title, "json": text(bytes), "lens": title.contains("lens")})
            })
            .collect();
        let owner = role_on(st, d, Scope::Space(sp)).is_some_and(|(r, _)| r == Role::Owner);
        Ok(json!({
            "space": {"id": hex(&sp.0), "name": self.space_name(sp)},
            "schemas": schemas,
            "lenses": lenses,
            "written": written,
            "apps": apps,
            "mayPublish": owner,
        }))
    }

    /// The Lab: every device's column for one entry, what it holds and what it can open, whether it is online and
    /// unlocked, and the epoch of the entry's key it knows.
    fn columns(&self, sp: SpaceId, e: EntryId) -> Value {
        let lab = self.lab();
        let k = KeyScope::Entry(sp, e);
        let columns: Vec<Value> = lab
            .devices()
            .iter()
            .map(|&d| {
                let st = lab.state(d);
                let epoch = st.epoch(k);
                let item = lab.item(d, sp, e);
                let record = item.map(Item::record);
                let value = match (item, record.as_ref().and_then(|r| app_schema(r, "v2"))) {
                    (Some(i), Some(s)) => read_as(lab, d, sp, i, s).0,
                    _ => None,
                };
                json!({
                    "device": self.signer(d),
                    "online": lab.online(d),
                    "locked": lab.locked(d),
                    "ops": lab.log(d).ops().len(),
                    "forks": lab.forks(d).len(),
                    "knows": st.space(sp).is_some(),
                    "writes": lab.fetched(d, sp, e),
                    "bytes": sealed_bytes(lab, d, sp, e),
                    "opens": item.is_some(),
                    "kind": record.as_ref().map(|r| r["kind"].clone()),
                    "value": value,
                    "epoch": epoch,
                    "holdsKey": lab.holds_key(d, k, epoch),
                    "role": role_on(st, d, Scope::Entry(sp, e)).map(|r| role_name(r.0)),
                    "lines": st.lines(sp, e).len(),
                })
            })
            .collect();
        json!({"columns": columns})
    }
}

/// What a commit did, as far as the device can tell: start the entry or a branch, edit, merge another line in, promote
/// one (a merge that brings this line to it), or put back an earlier version (a restore or an undo, which name no
/// schema); sealed where it can't open it.
fn kind_of(h: &History, c: &Commit, schemas: &[String]) -> &'static str {
    let w = &c.write;
    let line = w.line();
    let merges = w.deps.iter().any(|&dep| h.get(dep).is_some_and(|x| x.write.line() != line));
    match &c.body {
        _ if w.branch == Branch::New => "branch",
        None => "sealed",
        Some(b) if merges && b.is_empty() => "merge",
        Some(_) if merges => "promote",
        Some(_) if w.deps.is_empty() => "create",
        Some(_) if schemas.is_empty() => "restore",
        Some(_) => "edit",
    }
}

/// The schema of an app on `app` ("v1" or "v2") for an item of the record's kind.
fn app_schema(record: &Value, app: &str) -> Option<&'static Schema> {
    match (record["kind"].as_str()?, app) {
        ("document", "v1") => Some(&DOCUMENT_V1),
        ("document", _) => Some(&DOCUMENT_V2),
        ("todo", "v1") => Some(&TODO_V1),
        ("todo", _) => Some(&TODO_V2),
        _ => None,
    }
}

/// The item as an app on `app` reads it through device `d`'s lane of space `sp`, and whether only read-only.
pub(crate) fn read_as(lab: &Lab, d: SignerId, sp: SpaceId, item: &Item, app: &Schema) -> (Option<Value>, bool) {
    let (view, read_only) = lab.lane(d, sp).view(app, &item.authored());
    (item.read(&view), read_only)
}

/// The apps' own schemas and lenses: their id, title and bytes, as a space's owners publish them.
pub(crate) fn built_in() -> Vec<(String, String, &'static [u8])> {
    use avendb::lens::{DOCUMENT_LENS, TODO_LENS};
    let schemas = [&*DOCUMENT_V1, &*DOCUMENT_V2, &*TODO_V1, &*TODO_V2];
    let lenses = [&*DOCUMENT_LENS, &*TODO_LENS];
    let mut out: Vec<(String, String, &'static [u8])> =
        schemas.into_iter().map(|s| (s.id().to_hex(), s.title().to_string(), s.bytes())).collect();
    out.extend(lenses.into_iter().map(|l| (l.id().to_hex(), l.title().to_string(), l.bytes())));
    out
}

/// The writes device `d` holds of one entry, by id.
fn writes_of(lab: &Lab, d: SignerId, sp: SpaceId, e: EntryId) -> HashMap<OpId, &Op> {
    let log = lab.log(d);
    log.ids().iter().zip(log.ops()).filter(|(_, o)| o.write_target() == Some((sp, e))).map(|(&id, o)| (id, o)).collect()
}

/// The bytes of ciphertext device `d` holds of one entry.
fn sealed_bytes(lab: &Lab, d: SignerId, sp: SpaceId, e: EntryId) -> usize {
    lab.log(d).ops().iter().filter(|o| o.write_target() == Some((sp, e))).map(body_len).sum()
}

fn body_len(op: &Op) -> usize {
    match &op.action {
        Action::Write { body, .. } => body.len(),
        _ => 0,
    }
}

fn status_name(s: Status) -> &'static str {
    match s {
        Status::Open => "open",
        Status::Doing => "doing",
        Status::Done => "done",
    }
}

/// What a vault is: a human vault, a person's, owned by their passkeys; a coop vault, owned by human and coop vaults;
/// or an aven vault, an agent's such as avenCEO, owned like a coop, whose devices are its servers.
fn kind_name(v: &Vault) -> &'static str {
    match v.kind {
        Kind::Human => "human",
        Kind::Coop => "coop",
        Kind::Aven => "aven",
    }
}

fn hexes(ops: &[OpId]) -> Vec<String> {
    ops.iter().map(|o| hex(&o.0)).collect()
}

/// The id at `key`: 64 hex digits.
pub(crate) fn id_at(q: &Value, key: &str) -> Result<[u8; 32], String> {
    q[key].as_str().and_then(unhex).ok_or_else(|| format!("{key} must be an id: 64 hex digits."))
}

/// The ids at `key`: a list of 64 hex digits each.
pub(crate) fn ids_at(q: &Value, key: &str) -> Result<Vec<[u8; 32]>, String> {
    let bad = || format!("{key} must be a list of ids.");
    let list = q[key].as_array().ok_or_else(bad)?;
    list.iter().map(|v| v.as_str().and_then(unhex).ok_or_else(bad)).collect()
}

pub(crate) fn ops_at(q: &Value, key: &str) -> Result<Vec<OpId>, String> {
    Ok(ids_at(q, key)?.into_iter().map(OpId).collect())
}

/// The line at `key`: `null` for the main line, else the id of the write that started the branch.
pub(crate) fn line_at(q: &Value, key: &str) -> Result<Line, String> {
    if q[key].is_null() { Ok(MAIN) } else { Ok(Some(OpId(id_at(q, key)?))) }
}

fn app_at(q: &Value) -> &str {
    q["app"].as_str().unwrap_or("v2")
}

#[cfg(test)]
mod tests {
    use avendb::id::SignerId;
    use serde_json::{json, Value};

    use crate::tile::{hex, unhex, Tile};

    /// Every view the page reads: the overview, and for each device its vaults, spaces and todos, and of each space it
    /// lists, the schemas, the access, and each entry with its access and its Lab columns.
    fn every_view(tile: &Tile) -> Vec<Value> {
        let mut views = vec![json!({"view": "overview"})];
        for &d in tile.lab().devices() {
            let on = hex(&d.0);
            for view in ["vaults", "spaces", "todos"] {
                views.push(json!({"view": view, "on": on}));
            }
            let spaces = tile.show(&json!({"view": "spaces", "on": on})).expect("its spaces");
            for s in spaces["spaces"].as_array().into_iter().flatten() {
                let space = &s["id"];
                views.push(json!({"view": "schemas", "on": on, "space": space}));
                views.push(json!({"view": "access", "on": on, "space": space}));
                for e in s["entries"].as_array().into_iter().flatten() {
                    let entry = &e["id"];
                    views.push(json!({"view": "entry", "on": on, "space": space, "entry": entry}));
                    views.push(json!({"view": "access", "on": on, "space": space, "entry": entry}));
                    views.push(json!({"view": "lab", "space": space, "entry": entry}));
                }
            }
        }
        views
    }

    #[test]
    fn no_view_shows_a_secret() {
        let mut tile = Tile::new();
        while tile.build_step(1.0).is_some() {}
        let lab = tile.lab();
        let overview = tile.show(&json!({"view": "overview"})).expect("the overview");
        let signers = overview["signers"].as_array().into_iter().flatten();
        let signers: Vec<SignerId> = signers.filter_map(|s| s["id"].as_str().and_then(unhex)).map(SignerId).collect();
        // every secret of every signer: its own key, a device's endpoint key, and every key a device opened
        let mut secrets: Vec<[u8; 32]> = vec![];
        for &s in &signers {
            secrets.extend(lab.secrets(s).iter().map(|k| k.bytes()));
            secrets.extend(lab.endpoint_secret(s).map(|k| *k));
        }
        assert!(secrets.len() > 2 * signers.len(), "{} secrets of {} signers", secrets.len(), signers.len());
        let views = every_view(&tile);
        assert!(views.len() > 100, "{} views", views.len());
        let show = |q: &Value| tile.show(q).unwrap_or_else(|e| panic!("{q}: {e}")).to_string();
        let shown: String = views.iter().map(show).collect();
        for s in &secrets {
            // in hex, as views show ids, or as a list of numbers, as JSON shows bytes
            let numbers = s[..8].iter().map(u8::to_string).collect::<Vec<_>>().join(",");
            assert!(!shown.contains(&hex(s)) && !shown.contains(&numbers), "a view shows a secret");
        }
    }
}

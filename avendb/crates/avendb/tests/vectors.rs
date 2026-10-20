//! The Lean model's test vectors (`avendb/spec/vectors/vaults.json` and `lenses.json`, written by `lake exe vectors`,
//! checked by every `lake build`). A step case's edits, applied one after the other from the empty state, must be
//! accepted or refused exactly as the model says. A view case's edits, each at the depth it claims, must stand or be
//! cut exactly as in the model's view: that is where removals cut what they hadn't seen. Both must end with the same
//! vaults, shares, entries (their stays and their wants, and as their readers see them their attributes, whether their
//! creation was let in, whether they landed, a draft by its vault's merge, their semantic audience, the keep shares
//! that pick them and what a steward would mark them with, and whether each device a keep share over their vault names
//! wants them and keeps them whole), writes, key schedule (each family's epoch, every seal, every published key),
//! schema lanes, and the writes their readers count, line by line. The lens vectors hold each app's view of many stored
//! blocks and todos, and what each edit through a view stores.
//!
//! A gate case's edits, held and in a batch, each at the depth the model gives it, must be taken by the server of its
//! vault exactly as the model's gate takes them (`gate::takes`), its readings holding what every write says. A
//! standing case's server, holding its edits, must say of its device the vault and whether that vault is an admin
//! exactly as the model says (`gate::device_standing`).
//!
//! A sync case's edits, each with the parents and depth the model gives it, must stand as in the model, fall into the
//! same logs with the same closed parts and frontiers, and fork where the model says; and each device that asks a peer
//! must name the same edits of each log and the same loose edits, and be sent the same edits in the same order, whole
//! (`respond`) and given what it named (`respond_since`); and each passkey that proves itself to link a new device
//! must be handed the same vault logs (`link_card`).
//!
//! The model names what an edit creates (a vault, a share) by a number, and an edit by its place in the case; the core
//! names them by hashes, so each number maps to what its edit created, and each place to that edit's id. An audience is
//! a set of shares: the core keeps its shares sorted by id and names it by the hash of its vault and those shares. What
//! no rule reads travels encrypted or sealed in the core: a share's selector, a write's header and tags. Here a share
//! carries its selector's JSON where its sealed selector goes, and a write its header's and tags' JSON where its
//! ciphertext goes, and the readings (`Readings`) hold what a reader opens of them. A share's selector JSON goes inside
//! a sealed selector, beside the commitment to its ops, salted with its number; a write's proof and touches go into the
//! readings, its proof opening the ops of every share of its share's chain. The core's built-in groups of ops are the
//! model's, and so is its kind table (`Kind::rules`). A keys edit of the model names only where its boxes go; the
//! core's carries the boxes too, which no rule opens, so here they are empty. A creation's header names the blob it
//! holds by a number, which only a schema or lens entry's readers read: here its content is the bytes `blob <number>`,
//! and the lane names it by their hash. A type or a tag is a number in the model, and its digits here, but for the
//! types of schema, lens and cap group entries, which are the core's (`slice::SCHEMA_TYPE`, `slice::LENS_TYPE`,
//! `slice::CAP_GROUP_TYPE`). A write of a cap group says the group it defines in its readings. A keep share is a
//! share like any other, with no ops.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::fmt::Debug;
use std::hash::Hash;

use avendb::gate;
use avendb::history::{Change, History};
use avendb::id::{AudienceId, BlobId, EditId, EntryId, ShareId, SignerId, VaultId};
use avendb::keys::{KeyBox, KeyFam, KeyId, KeyName, Recipient, Seal};
use avendb::lens::{example, View};
use avendb::ops::Loc;
use avendb::policy::{
    history, mk_audience, replay, tips, Action, Creation, Edit, KeepMode, Kind, Level, Line, Principal, Proposal,
    Readings, Refusal, Revoking, Setting, Share, Sharing, State, Vault, Who, Wrap,
};
use avendb::rules::{self, ops_of_json, Cap, CapGroup, Grant, Proof, Touch};
use avendb::slice::{Atom, Attrs, Header, Select, Selector, Sym, TagDelta, CAP_GROUP_TYPE, LENS_TYPE, SCHEMA_TYPE};
use avendb::sealed::FileRoot;
use avendb::sync::{asks, closed_part, forks, frontiers, link_card, may_fetch, respond, respond_since, LogId};
use avendb::wire::Wire;
use serde_json::{json, Map, Value};

const VECTORS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../spec/vectors/vaults.json");
const LENSES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../spec/vectors/lenses.json");

/// The bytes the model's blob number `b` stands for.
fn blob(v: &Value) -> Vec<u8> {
    format!("blob {}", num(v)).into_bytes()
}

fn num(v: &Value) -> u64 {
    v.as_u64().unwrap_or_else(|| panic!("a number, not {v}"))
}

fn list(v: &Value) -> &[Value] {
    v.as_array().unwrap_or_else(|| panic!("a list, not {v}"))
}

/// The model's file `n`: a root of its own, as long as a sealed file of `n` bytes is.
fn file(v: &Value) -> FileRoot {
    let mut hash = [0u8; 32];
    hash[24..].copy_from_slice(&num(v).to_be_bytes());
    FileRoot { hash, size: num(v) }
}

fn signer(v: &Value) -> SignerId {
    SignerId::from_u64(num(v))
}

fn entry(v: &Value) -> EntryId {
    EntryId::from_u64(num(v))
}

/// A type or a tag: the model's schema, lens and cap group types (`schemaType`, `lensType`, `capGroupType`) are the
/// core's.
fn sym(v: &Value) -> Sym {
    match num(v) {
        900 => Sym::new(SCHEMA_TYPE),
        901 => Sym::new(LENS_TYPE),
        902 => Sym::new(CAP_GROUP_TYPE),
        n => Sym(n.to_string()),
    }
}

fn syms(v: &Value) -> Vec<Sym> {
    list(v).iter().map(sym).collect()
}

fn kind(v: &Value) -> Kind {
    match v.as_str() {
        Some("human") => Kind::Human,
        Some("coop") => Kind::Coop,
        Some("aven") => Kind::Aven,
        Some("device") => Kind::DeviceVault,
        _ => panic!("a kind, not {v}"),
    }
}

/// A level: a keep share's is `{"keep": mode}`, any other a name.
fn level(v: &Value) -> Level {
    if let Some(m) = v.get("keep") {
        return Level::Keep(match m.as_str() {
            Some("whole") => KeepMode::Whole,
            Some("opened") => KeepMode::Opened,
            Some("never") => KeepMode::Never,
            _ => panic!("a keep mode, not {m}"),
        });
    }
    match v.as_str() {
        Some("relay") => Level::Relay,
        Some("backup") => Level::Backup,
        Some("read") => Level::Read,
        Some("write") => Level::Write,
        Some("owner") => Level::Owner,
        _ => panic!("a level, not {v}"),
    }
}

/// The one key of an object: an action's or a variant's name, and what it holds.
fn variant(v: &Value) -> (&str, &Value) {
    let (name, x) = v.as_object().and_then(|o| o.iter().next()).unwrap_or_else(|| panic!("a variant, not {v}"));
    (name.as_str(), x)
}

fn tag_delta(v: &Value) -> TagDelta {
    TagDelta { add: syms(&v["add"]), remove: syms(&v["remove"]) }
}

fn header(v: &Value) -> Header {
    Header { ty: sym(&v["type"]), created: num(&v["created"]) }
}

/// A share's ops, salted with its number.
fn grant(share: &Value) -> Grant {
    let ops = ops_of_json(&share["ops"]).expect("the model's ops");
    let mut salt = [0; 32];
    salt[..8].copy_from_slice(&num(&share["id"]).to_le_bytes());
    Grant { ops, salt }
}

/// Two collections hold the same items, whatever their order: what differs is shown.
fn same_set<T: Clone + Debug + Eq + Hash>(ours: impl IntoIterator<Item = T>, want: impl IntoIterator<Item = T>, what: &str) {
    let (ours, want): (HashSet<T>, HashSet<T>) = (ours.into_iter().collect(), want.into_iter().collect());
    let extra: Vec<&T> = ours.difference(&want).collect();
    let missing: Vec<&T> = want.difference(&ours).collect();
    assert!(extra.is_empty() && missing.is_empty(), "{what}: the core has {extra:?} more and lacks {missing:?}");
}

/// The model's numbers and places, as the core names them, and what readers open.
#[derive(Default)]
struct Names {
    vaults: HashMap<u64, VaultId>,
    shares: HashMap<u64, ShareId>,
    /// Each edit's id, by its place in the case.
    edits: Vec<EditId>,
    readings: Readings,
    /// Each share's parent, and its ops: what a proof opens.
    parents: HashMap<ShareId, Option<ShareId>>,
    grants: HashMap<ShareId, Grant>,
}

impl Names {
    fn vault(&self, v: &Value) -> VaultId {
        let n = num(v);
        self.vaults.get(&n).copied().unwrap_or(VaultId::from_u64(n))
    }

    fn share(&self, v: &Value) -> ShareId {
        let n = num(v);
        self.shares.get(&n).copied().unwrap_or(ShareId::from_u64(n))
    }

    fn edit(&self, v: &Value) -> EditId {
        let n = num(v);
        self.edits.get(n as usize).copied().unwrap_or(EditId::from_u64(n))
    }

    fn edits(&self, v: &Value) -> Vec<EditId> {
        list(v).iter().map(|x| self.edit(x)).collect()
    }

    /// Edits by place, smallest id first: the model sorts by place, the core by id.
    fn edit_set(&self, v: &Value) -> Vec<EditId> {
        let mut ids = self.edits(v);
        ids.sort();
        ids
    }

    fn opt_edit(&self, v: &Value) -> Option<EditId> {
        (!v.is_null()).then(|| self.edit(v))
    }

    /// The owners an act goes through.
    fn via(&self, v: &Value) -> Vec<VaultId> {
        list(v).iter().map(|x| self.vault(x)).collect()
    }

    /// An audience's shares, in the core's canonical order.
    fn audience(&self, v: &Value) -> Vec<ShareId> {
        mk_audience(&list(v).iter().map(|c| self.share(c)).collect::<Vec<_>>())
    }

    /// An audience's shares as a set.
    fn audience_set(&self, v: &Value) -> BTreeSet<ShareId> {
        list(v).iter().map(|c| self.share(c)).collect()
    }

    /// A mark's wants: in the core's canonical order where the model's are in its own, and out of it where they
    /// aren't.
    fn wants(&self, v: &Value) -> Vec<ShareId> {
        let ns: Vec<u64> = list(v).iter().map(num).collect();
        let mut ids: Vec<ShareId> = list(v).iter().map(|r| self.share(r)).collect();
        ids.sort();
        if !ns.windows(2).all(|w| w[0] < w[1]) {
            ids.reverse();
        }
        ids
    }

    fn principal(&self, v: &Value) -> Principal {
        match (v.get("signer"), v.get("vault")) {
            (Some(s), None) => Principal::Signer(signer(s)),
            (None, Some(x)) => Principal::Vault(self.vault(x)),
            _ => panic!("a principal, not {v}"),
        }
    }

    fn who(&self, v: &Value) -> Who {
        if v.as_str() == Some("everyone") {
            return Who::Everyone;
        }
        match variant(v) {
            ("vault", x) => Who::Vault(self.vault(x)),
            ("device", d) => Who::Device(signer(d)),
            ("invite", k) => Who::Invite(signer(k)),
            (other, _) => panic!("no grantee {other}"),
        }
    }

    /// A write's line: "main", "new", or the proposal the model's edit number started.
    fn proposal(&self, v: &Value) -> Proposal {
        match v.as_str() {
            Some("main") => Proposal::Main,
            Some("new") => Proposal::New,
            _ => Proposal::On(self.edit(&v["on"])),
        }
    }

    fn atom(&self, v: &Value) -> Atom {
        match variant(v) {
            ("typeIn", ts) => Atom::TypeIn(syms(ts)),
            ("authorIn", vs) => Atom::AuthorIn(list(vs).iter().map(|x| self.vault(x)).collect()),
            ("entryIn", es) => Atom::EntryIn(list(es).iter().map(entry).collect()),
            ("createdIn", r) => Atom::CreatedIn(num(&r["from"]), num(&r["to"])),
            ("tagHas", t) => Atom::TagHas(sym(t)),
            ("tagNone", ts) => Atom::TagNone(syms(ts)),
            ("tagsWithin", ts) => Atom::TagsWithin(syms(ts)),
            (other, _) => panic!("no atom {other}"),
        }
    }

    fn selector(&self, v: &Value) -> Selector {
        match v.as_str() {
            Some("all") => Selector::All,
            _ => Selector::AnyOf(
                list(&v["anyOf"]).iter().map(|d| list(d).iter().map(|t| self.atom(t)).collect()).collect(),
            ),
        }
    }

    /// A share as the core issues it: its selector where its sealed slice goes, beside the commitment to its ops, its
    /// number as its nonce.
    fn share_of(&self, v: &Value) -> Share {
        let slice = serde_json::to_vec(&v["select"]).unwrap();
        let select = Select::Sealed { boxes: vec![], slice, commitment: grant(v).commitment() }.to_wire();
        Share {
            over: self.vault(&v["over"]),
            who: self.who(&v["who"]),
            level: level(&v["level"]),
            wide: v["wide"].as_bool().unwrap(),
            select,
            parent: (!v["parent"].is_null()).then(|| self.share(&v["parent"])),
            issuer: self.vault(&v["issuer"]),
            nonce: num(&v["id"]),
            group: v.get("group").map(entry),
        }
    }

    /// A cap group, each cap an op over a selector.
    fn cap_group(&self, v: &Value) -> CapGroup {
        let cap = |c: &Value| {
            let op = ops_of_json(&json!([c["op"]])).expect("the model's op").remove(0);
            Cap { op, slice: self.selector(&c["slice"]) }
        };
        CapGroup {
            name: v["name"].as_str().expect("a group's name").to_string(),
            caps: list(&v["caps"]).iter().map(cap).collect(),
            includes: list(&v["includes"]).iter().map(entry).collect(),
        }
    }

    fn key_fam(&self, v: &Value) -> KeyFam {
        match variant(v) {
            ("seed", x) => KeyFam::Seed(self.vault(x)),
            ("share", x) => KeyFam::Share(self.vault(&x["vault"]), self.share(&x["share"])),
            ("audience", x) => {
                let vault = self.vault(&x["vault"]);
                KeyFam::Audience(vault, AudienceId::of(vault, &self.audience(&x["shares"])))
            }
            (other, _) => panic!("no key family {other}"),
        }
    }

    fn key_name(&self, v: &Value) -> KeyName {
        if let Some(s) = v.get("signer") {
            KeyName::Signer(signer(s))
        } else if let Some(e) = v.get("entry") {
            KeyName::Entry(entry(e), self.opt_edit(&v["stay"]), num(&v["epoch"]))
        } else {
            KeyName::Scoped(self.key_fam(&v["key"]), num(&v["epoch"]))
        }
    }

    fn log(&self, v: &Value) -> LogId {
        match variant(v) {
            ("vault", x) => LogId::Vault(self.vault(x)),
            ("share", x) => LogId::Share(self.share(x)),
            ("audience", x) => {
                let vault = self.vault(&x["vault"]);
                LogId::Audience(vault, AudienceId::of(vault, &self.audience(&x["shares"])))
            }
            ("entry", x) => LogId::Entry(entry(x)),
            (other, _) => panic!("no log {other}"),
        }
    }

    /// Whom a box goes to; which key of an epoch doesn't matter to the rules.
    fn recipient(&self, v: &Value) -> Recipient {
        match self.key_name(v) {
            KeyName::Signer(s) => Recipient::Signer(s),
            name => Recipient::Key { name, id: KeyId([0; 32]) },
        }
    }

    /// A vault's settings: its threshold, or its root handed on.
    fn settings(&self, v: &Value) -> Action {
        let (sub, x) = variant(v);
        let set = match sub {
            "threshold" => Setting::Threshold(num(&x["threshold"]) as u32),
            "root" => Setting::Root {
                root: (!x["root"].is_null()).then(|| signer(&x["root"])),
                keep: self.edits(&x["keep"]),
            },
            other => panic!("no setting {other}"),
        };
        Action::Settings { vault: self.vault(&x["vault"]), set }
    }

    /// A share: a grant, an owner or a device.
    fn sharing(&self, v: &Value) -> Action {
        let (sub, x) = variant(v);
        let vault = || self.vault(&x["vault"]);
        Action::Share(match sub {
            "grant" => Sharing::Grant(self.share_of(&x["share"]), self.via(&x["via"])),
            "owner" => Sharing::Owner { vault: vault(), owner: self.principal(&x["owner"]), seal_to: None },
            "device" => Sharing::Device { vault: vault(), device: signer(&x["device"]), seal_to: None },
            other => panic!("no share {other}"),
        })
    }

    /// A revocation: of a grant, an owner or a device.
    fn revoking(&self, v: &Value) -> Action {
        let (sub, x) = variant(v);
        let vault = || self.vault(&x["vault"]);
        let keep = self.edits(&x["keep"]);
        Action::Revoke(match sub {
            "grant" => Revoking::Grant {
                share: self.share(&x["share"]),
                actor: self.vault(&x["actor"]),
                keep,
                via: self.via(&x["via"]),
            },
            "owner" => Revoking::Owner { vault: vault(), owner: self.principal(&x["owner"]), keep },
            "device" => Revoking::Device { vault: vault(), device: signer(&x["device"]), keep },
            other => panic!("no revocation {other}"),
        })
    }

    fn action(&self, v: &Value) -> Action {
        let (name, x) = variant(v);
        let vault = || self.vault(&x["vault"]);
        let keep = || self.edits(&x["keep"]);
        match name {
            "genesis" => Action::Genesis {
                kind: kind(&x["kind"]),
                owners: list(&x["owners"]).iter().map(|p| self.principal(p)).collect(),
                threshold: num(&x["threshold"]) as u32,
                root: (!x["root"].is_null()).then(|| signer(&x["root"])),
                // the model's number keeps two geneses with the same owners apart, as a nonce does
                nonce: num(&x["vault"]),
                seal_to: vec![],
            },
            "settings" => self.settings(x),
            "share" => self.sharing(x),
            "revoke" => self.revoking(x),
            "write" => Action::Write {
                vault: vault(),
                entry: entry(&x["entry"]),
                actor: self.vault(&x["actor"]),
                stay: self.opt_edit(&x["stay"]),
                epoch: num(&x["epoch"]),
                deps: self.edits(&x["deps"]),
                proposal: self.proposal(&x["proposal"]),
                via: self.via(&x["via"]),
                create: (!x["create"].is_null())
                    .then(|| Creation { audience: self.audience(&x["create"]["audience"]), nonce: [0; 32] }),
                files: vec![],
                body: serde_json::to_vec(&json!({"create": x["create"], "tags": x["tags"]})).unwrap(),
            },
            // each part there, or `null` where the mark leaves it as it is
            "mark" => Action::Mark {
                vault: vault(),
                entry: entry(&x["entry"]),
                caps: (!x["caps"].is_null()).then(|| self.audience(&x["caps"])),
                wants: (!x["wants"].is_null()).then(|| self.wants(&x["wants"])),
                keep: keep(),
                via: self.via(&x["via"]),
            },
            "claim" => Action::Claim { share: self.share(&x["share"]), vault: vault(), via: self.via(&x["via"]) },
            "keys" => Action::Keys {
                name: self.key_name(&x["secret"]),
                id: KeyId([0; 32]),
                public: None,
                boxes: list(&x["to"]).iter().map(|t| KeyBox { to: self.recipient(t), bytes: vec![] }).collect(),
                clear: x["public"].as_bool().unwrap().then_some([0; 32]),
            },
            "wraps" => Action::Wraps {
                entry: entry(&x["entry"]),
                wraps: list(&x["wraps"])
                    .iter()
                    .map(|w| Wrap {
                        name: self.key_name(&w["secret"]),
                        id: KeyId([0; 32]),
                        boxed: KeyBox { to: self.recipient(&w["to"]), bytes: vec![] },
                    })
                    .collect(),
            },
            "checkpoint" => Action::Checkpoint {
                vault: vault(),
                covers: list(&x["covers"]).iter().map(|c| self.edit(c)).collect(),
            },
            other => panic!("no action {other}"),
        }
    }

    /// The edit at the next place of the case, from its JSON, at `depth`.
    fn edit_of(&self, v: &Value, depth: u64) -> Edit {
        let cosigners = list(&v["cosigners"]).iter().map(signer).collect();
        let mut action = self.action(&v["action"]);
        if let Action::Write { files, .. } = &mut action {
            *files = v.get("files").map_or(&[][..], list).iter().map(file).collect();
            files.sort();
        }
        Edit { parents: vec![], depth, author: signer(&v["author"]), cosigners, action }
    }

    /// Name what `edit`, at the next place, creates, and note what its readers open. A vault's number names the vault
    /// only once its genesis is accepted, as the step cases try one number more than once; a share has a number of its
    /// own.
    fn created(&mut self, v: &Value, edit: &Edit, accepted: bool) {
        let id = edit.id();
        match variant(&v["action"]) {
            ("genesis", x) if accepted => {
                self.vaults.insert(num(&x["vault"]), VaultId::from(id));
            }
            ("share", x) if variant(x).0 == "grant" => {
                let x = &x["grant"]["share"];
                let (share, parent) = (ShareId::from(id), &x["parent"]);
                self.readings.selectors.insert(share, self.selector(&x["select"]));
                self.parents.insert(share, (!parent.is_null()).then(|| self.share(parent)));
                self.grants.insert(share, grant(x));
                self.shares.insert(num(&x["id"]), share);
            }
            ("write", x) => {
                if !x["create"].is_null() {
                    let h = header(&x["create"]["header"]);
                    if h.ty.of_lane() {
                        self.readings.blobs.insert(id, blob(&x["create"]["header"]["blob"]).into());
                    }
                    self.readings.headers.insert(id, h);
                }
                self.readings.tags.insert(id, tag_delta(&x["tags"]));
                if let Some(c) = x.get("proof") {
                    let share = self.share(c);
                    let grants = self.chain(share).iter().filter_map(|c| self.grants.get(c).cloned()).collect();
                    self.readings.proofs.insert(id, Proof { share, grants });
                }
                let touches = x.get("touches").map_or(&[][..], list).iter().map(|t| Touch::of_json(t).unwrap());
                self.readings.touches.insert(id, touches.collect());
                if let Some(xs) = x.get("adds") {
                    self.readings.adds.insert(id, list(xs).iter().map(|l| Loc::of_json(l).unwrap()).collect());
                }
                if x.get("fits") == Some(&Value::Bool(false)) {
                    self.readings.unfit.insert(id);
                }
                if let Some(g) = x.get("defines") {
                    self.readings.defines.insert(id, self.cap_group(g));
                }
            }
            _ => {}
        }
        self.edits.push(id);
    }

    /// The shares share `c` rests on, from its root down to itself.
    fn chain(&self, c: ShareId) -> Vec<ShareId> {
        let mut chain = vec![c];
        while let Some(&Some(p)) = chain.last().and_then(|c| self.parents.get(c)) {
            chain.push(p);
        }
        chain.reverse();
        chain
    }

    fn vault_of(&self, v: &Value) -> Vault {
        Vault {
            id: self.vault(&v["id"]),
            kind: kind(&v["kind"]),
            owners: list(&v["owners"]).iter().map(|p| self.principal(p)).collect(),
            threshold: num(&v["threshold"]) as u32,
            devices: list(&v["devices"]).iter().map(signer).collect(),
            root: (!v["root"].is_null()).then(|| signer(&v["root"])),
        }
    }

    fn attrs(&self, v: &Value) -> Attrs {
        Attrs {
            ty: sym(&v["type"]),
            author: self.vault(&v["author"]),
            entry: entry(&v["entry"]),
            created: num(&v["created"]),
            tags: syms(&v["tags"]),
        }
    }

    /// The state a case ends with must be the model's. The cap groups in force are worked out of what the readers
    /// hold, as a reader does.
    fn check_state(&mut self, name: &str, case: &Value, st: &State) {
        self.readings.groups = st.read_groups(&self.readings);
        let vaults: Vec<Vault> = list(&case["vaults"]).iter().map(|v| self.vault_of(v)).collect();
        assert_eq!(st.vaults(), &vaults[..], "{name}: vaults");
        // every share issued, live or revoked, in the order issued, with the cap group it names
        type ShareRow = (ShareId, VaultId, Who, Level, bool, Option<ShareId>, VaultId, Option<EntryId>);
        let shares: Vec<ShareRow> = list(&case["shares"])
            .iter()
            .map(|v| {
                let c = self.share_of(v);
                (self.share(&v["id"]), c.over, c.who, c.level, c.wide, c.parent, c.issuer, c.group)
            })
            .collect();
        let ours: Vec<ShareRow> = st
            .shares()
            .iter()
            .map(|cp| {
                let x = &cp.share;
                (cp.id, x.over, x.who, x.level, x.wide, x.parent, x.issuer, x.group)
            })
            .collect();
        assert_eq!(ours, shares, "{name}: shares");
        // each cap group as its readers count the writes that say it, now
        let groups = case.get("capGroups").map_or(&[][..], list).iter();
        let groups = groups.map(|v| (self.vault(&v["vault"]), entry(&v["entry"]), self.cap_group(&v["group"])));
        let ours = self.readings.groups.entries().map(|(e, v)| {
            (v, e, st.group(&self.readings, v, e).expect("a group its readers count").clone())
        });
        same_set(ours, groups, &format!("{name}: cap groups"));
        let revoked: Vec<ShareId> = list(&case["revoked"]).iter().map(|c| self.share(c)).collect();
        assert_eq!(st.revoked(), &revoked[..], "{name}: revoked");
        // each entry: its stays, the current one first, and what its readers see
        let want: Vec<&Value> = list(&case["entries"]).iter().collect();
        assert_eq!(st.entries().len(), want.len(), "{name}: entries");
        for (en, v) in st.entries().iter().zip(want) {
            let what = format!("{name}: entry {}", v["id"]);
            assert_eq!((en.id, en.vault), (entry(&v["id"]), self.vault(&v["vault"])), "{what}");
            let stays: Vec<(Option<EditId>, BTreeSet<ShareId>)> = list(&v["stays"])
                .iter()
                .map(|s| (self.opt_edit(&s["stay"]), self.audience_set(&s["audience"])))
                .collect();
            let ours: Vec<(Option<EditId>, BTreeSet<ShareId>)> = en
                .stays
                .iter()
                .rev()
                .map(|(s, x)| (*s, st.audience_shares(*x).expect("an audience's shares").iter().copied().collect()))
                .collect();
            assert_eq!(ours, stays, "{what}: stays");
            let m = st.meaning(en.id, &self.readings).expect("an entry's meaning");
            assert_eq!(m.attrs, self.attrs(&v["attrs"]), "{what}: attributes");
            assert_eq!(m.admitted, v["admitted"].as_bool().unwrap(), "{what}: let in");
            // landed: no draft, or its main line's counted history holds its creation, as only its vault lands it
            assert_eq!(st.landed(en.id, &self.readings), v["landed"].as_bool().unwrap(), "{what}: landed");
            let audience: BTreeSet<ShareId> = m.audience.iter().copied().collect();
            assert_eq!(audience, self.audience_set(&v["semAudience"]), "{what}: semantic audience");
            let marked: BTreeSet<ShareId> = st.wants_of(en.id).iter().copied().collect();
            assert_eq!(marked, self.audience_set(&v["wants"]), "{what}: the wants it is marked with");
            let wants: BTreeSet<ShareId> = m.wants.into_iter().collect();
            assert_eq!(wants, self.audience_set(&v["semWants"]), "{what}: the keep shares that pick it");
            // the steward's one mark, each part a set or left out
            let part = |x: Option<Vec<ShareId>>| x.map(|x| x.into_iter().collect::<BTreeSet<ShareId>>());
            let part_of = |x: &Value| (!x.is_null()).then(|| self.audience_set(x));
            let mark = m.mark.map(|(caps, wants)| (part(caps), part(wants)));
            let want = (!v["desiredMark"].is_null())
                .then(|| (part_of(&v["desiredMark"]["caps"]), part_of(&v["desiredMark"]["wants"])));
            assert_eq!(mark, want, "{what}: what a steward marks it with");
            let desired = want.and_then(|(caps, _)| caps);
            assert_eq!(part(m.desired), desired, "{what}: where a steward's mark takes it");
            // each device a keep share over the vault names, live or not, once, in the order of its first: whether it
            // wants the entry, and keeps its files whole, which with no whole or opened keep share there its own
            // setting says (`None`), and the model's false
            let mut named: Vec<SignerId> = vec![];
            for k in st.shares_over(en.vault).filter(|k| k.share.level.is_keep()) {
                if let Who::Device(d) = k.share.who
                    && !named.contains(&d)
                {
                    named.push(d);
                }
            }
            let rows = list(&v["devices"]);
            assert_eq!(named, rows.iter().map(|r| signer(&r["device"])).collect::<Vec<_>>(), "{what}: devices");
            for r in rows {
                let d = signer(&r["device"]);
                let ours = (st.wants(d, en), st.keeps(d, en).unwrap_or(false));
                let want = (r["wants"].as_bool().unwrap(), r["keeps"].as_bool().unwrap());
                assert_eq!(ours, want, "{what}: device {}, whether it wants the entry and keeps it", r["device"]);
            }
        }
        same_set(st.all_born().iter().copied(), list(&case["born"]).iter().map(entry), &format!("{name}: born"));
        // the writes, each with the audience its entry was in when it was accepted
        type WriteRow = (EditId, SignerId, VaultId, EntryId, Option<EditId>, u64, Vec<EditId>, Proposal);
        type WriteRest = (Vec<VaultId>, bool, BTreeSet<ShareId>);
        let writes: Vec<(WriteRow, WriteRest)> = list(&case["writes"])
            .iter()
            .map(|v| {
                let row = (
                    self.edit(&v["edit"]),
                    signer(&v["author"]),
                    self.vault(&v["actor"]),
                    entry(&v["entry"]),
                    self.opt_edit(&v["stay"]),
                    num(&v["epoch"]),
                    self.edits(&v["deps"]),
                    self.proposal(&v["proposal"]),
                );
                (row, (self.via(&v["via"]), v["first"].as_bool().unwrap(), self.audience_set(&v["audience"])))
            })
            .collect();
        let ours: Vec<(WriteRow, WriteRest)> = st
            .all_writes()
            .iter()
            .map(|w| {
                let audience = st.audience_shares(w.audience).expect("a write's audience").iter().copied().collect();
                let row = (w.edit, w.author, w.actor, w.entry, w.stay, w.epoch, w.deps.clone(), w.proposal);
                (row, (w.via.clone(), w.first, audience))
            })
            .collect();
        assert_eq!(ours, writes, "{name}: writes");
        let epochs = list(&case["epochs"]).iter().map(|v| (self.key_fam(&v["key"]), num(&v["epoch"])));
        same_set(st.epochs(), epochs, &format!("{name}: epochs"));
        let seals =
            list(&case["seals"]).iter().map(|v| Seal { secret: self.key_name(&v["secret"]), to: self.key_name(&v["to"]) });
        same_set(st.seals().iter().copied(), seals, &format!("{name}: seals"));
        let published = list(&case["published"]).iter().map(|v| self.key_name(v));
        same_set(st.published().iter().copied(), published, &format!("{name}: published"));
        let lane: Vec<(VaultId, BlobId)> =
            list(&case["lane"]).iter().map(|v| (self.vault(&v["vault"]), BlobId::of(&blob(&v["blob"])))).collect();
        let lane_of = |v: VaultId| st.lane_of(v, &self.readings).into_iter().map(move |b| (v, BlobId::of(b)));
        let ours: Vec<(VaultId, BlobId)> = st.vaults().iter().flat_map(|v| lane_of(v.id)).collect();
        assert_eq!(ours, lane, "{name}: lane");
        // the writes the entries' readers don't count, of those the state holds
        let uncounted: HashSet<EditId> =
            st.entries().iter().flat_map(|en| st.uncounted(en.id, &self.readings)).collect();
        let held: HashSet<EditId> = st.all_writes().iter().map(|w| w.edit).collect();
        let want = self.edits(&case["uncounted"]).into_iter().filter(|e| held.contains(e));
        same_set(uncounted.iter().copied(), want, &format!("{name}: uncounted"));
        // the writes they read as their vaults' accepts (M2), of those the state holds
        let accepts = st.entries().iter().flat_map(|en| st.accepts_of(en.id, &self.readings)).collect::<Vec<_>>();
        let want = self.edits(&case["accepts"]).into_iter().filter(|e| held.contains(e));
        same_set(accepts.into_iter(), want, &format!("{name}: accepts"));
        // each line of each entry, the main line first: its history and its heads, of the writes they count
        type Lines = Vec<(EntryId, Line, Vec<EditId>, Vec<EditId>)>;
        let lines: Lines = list(&case["lines"])
            .iter()
            .map(|v| (entry(&v["entry"]), self.opt_edit(&v["line"]), self.edits(&v["history"]), self.edits(&v["heads"])))
            .collect();
        let counted: Vec<_> = st.all_writes().iter().filter(|w| !uncounted.contains(&w.edit)).collect();
        let ours: Lines = st
            .entries()
            .iter()
            .flat_map(|en| {
                let ws: Vec<_> = counted.iter().copied().filter(|w| w.entry == en.id).collect();
                let starts = ws.iter().filter(|w| w.proposal == Proposal::New).map(|w| Some(w.edit));
                let lines: Vec<Line> = std::iter::once(None).chain(starts).collect();
                lines.into_iter().map(move |l| {
                    let h = history(ws.iter(), l);
                    (en.id, l, h.iter().map(|w| w.edit).collect(), tips(&h))
                })
            })
            .collect();
        assert_eq!(ours, lines, "{name}: lines");
    }
}

fn vectors() -> Value {
    let file = std::fs::read_to_string(VECTORS).expect("the vectors: run `lake exe vectors` in avendb/spec");
    serde_json::from_str(&file).unwrap()
}

/// The depth a step case gives the edit at place `i`: a genesis 0, so that one tried twice is the same edit, as the
/// model's vault number names one vault; any other edit its place, so that no two are the same edit, as in the model,
/// where an edit is its place. A step reads no depth.
fn step_depth(v: &Value, i: usize) -> u64 {
    if variant(&v["action"]).0 == "genesis" { 0 } else { i as u64 }
}

#[test]
fn the_built_in_groups_are_the_models() {
    let ours: Vec<Value> = rules::groups()
        .iter()
        .map(|g| json!({ "name": g.name, "ops": rules::ops_to_json(&g.ops), "everyone": g.everyone }))
        .collect();
    assert_eq!(Value::Array(ours), vectors()["groups"]);
}

#[test]
fn the_kind_table_is_the_models() {
    assert_eq!(avendb::words::kinds_json(), vectors()["kinds"]);
}

#[test]
fn each_edit_is_accepted_or_refused_as_in_the_lean_model() {
    let vectors = vectors();
    let cases = list(&vectors["cases"]);
    assert!(cases.len() >= 12);
    const KINDS: &str = "settings, shares and revocations, kind by kind";
    const MARKS: &str = "marks, part by part";
    const KEEPS: &str = "keep shares: each device syncs what its keep shares pick";
    const MODES: &str = "keep shares: modes, refusals and a device that leaves";
    const GROUPS: &str = "cap groups: a share names a group, which its vault versions";
    const INVITES: &str = "invites: a share to a one-time key, claimed once by the vault it invites";
    for name in [KINDS, MARKS, KEEPS, MODES, GROUPS, INVITES] {
        assert!(cases.iter().any(|c| c["name"] == name), "the model's case {name:?}");
    }
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let (edits, accepted) = (list(&case["edits"]), list(&case["accepted"]));
        assert_eq!(edits.len(), accepted.len(), "{name}");
        let mut names = Names::default();
        let mut st = State::default();
        let mut why = vec![];
        for (i, (v, want)) in edits.iter().zip(accepted).enumerate() {
            let edit = names.edit_of(v, step_depth(v, i));
            let got = st.step(&edit);
            assert_eq!(
                got.is_ok(),
                want.as_bool().unwrap(),
                "{name}, edit {i}: {v} gave {got:?}",
                got = got.as_ref().err()
            );
            why.push(got.as_ref().err().copied());
            names.created(v, &edit, got.is_ok());
            if let Ok(next) = got {
                st = next;
            }
        }
        names.check_state(name, case, &st);
        // the model only says no; the core says why: a grant to a device (T4), and owner of a whole vault by a grant
        if name == KINDS {
            let grant = |n: u64| edits.iter().position(|v| v["action"]["share"]["grant"]["share"]["id"] == n).unwrap();
            assert_eq!(why[grant(31)], Some(Refusal::DeviceOnlyKeeps), "{name}: a grant to a device");
            assert_eq!(why[grant(34)], Some(Refusal::WideOwner), "{name}: a wide owner grant");
        }
        use Refusal::*;
        let refused: Vec<Refusal> = why.iter().flatten().copied().collect();
        // and each part of a mark: nothing to mark, edits kept where it moves nothing, the audience or the wants the
        // entry has already, a share or a keep share that isn't one, another vault's entry, and a stranger
        if name == MARKS {
            let want = [BadMark, BadMark, SameAudience, SameWants, BadAudience, BadWants, WrongVault, NotActing];
            assert_eq!(refused, want, "{name}: why each mark falls");
        }
        // a keep share on another vault's device, by a device that doesn't act for its issuer, over a vault its issuer
        // may not hold; marks with a wide keep share, out of order, the wants the entry has, by strangers; a revocation
        // by the vault it is over and not its issuer, twice, by a device that doesn't act for it; no such entry
        if name == KEEPS {
            let (keeps, marks) = ([NotDevice, NotActing, NoCap], [BadWants, BadWants, SameWants, NotActing, NotActing]);
            let want = [&keeps[..], &marks, &[NoCap, Revoked, NotActing, NoCap, UnknownEntry]].concat();
            assert_eq!(refused, want, "{name}: why each falls");
        }
        // a keep share to a vault and to everyone, a share to a device that isn't one, a keep share resting on a share,
        // a mark with a wide keep share, a revocation by the vault it is over, a keep share for a device that left
        if name == MODES {
            let want = [KeepNeedsDevice, KeepNeedsDevice, DeviceOnlyKeeps, BadParent, BadWants, NoCap, NotDevice];
            assert_eq!(refused, want, "{name}: why each falls");
        }
        // a write by a reader of the group that would let it write: the group's caps hold only as high as its level
        if name == GROUPS {
            assert_eq!(refused, [NoCap], "{name}: why each falls");
        }
        // an owner invite; a claim the invite key doesn't sign, by a device that doesn't act for the vault, by the
        // vault the share is over, twice, of a share to a vault, of a revoked invite
        if name == INVITES {
            let want = [InviteOwner, NoConsent, NotActing, CapToItself, NotInvite, NotInvite, Revoked];
            assert_eq!(refused, want, "{name}: why each falls");
        }
    }
}

/// A step case's edits applied one after the other from the empty state, as the model applies them: the names they
/// made, and the state at the end.
fn replayed(case: &Value) -> (Names, State) {
    let mut names = Names::default();
    let mut st = State::default();
    for (i, v) in list(&case["edits"]).iter().enumerate() {
        let edit = names.edit_of(v, step_depth(v, i));
        let got = st.step(&edit);
        names.created(v, &edit, got.is_ok());
        if let Ok(next) = got {
            st = next;
        }
    }
    names.readings.groups = st.read_groups(&names.readings);
    (names, st)
}

/// T10l: how many writes a version of an entry holds, its heads and every write they build on (`History::version`,
/// what a public row says as `version.writes`, `world::public_row`), of the writes its readers count at the end of a
/// step case, with some left out as a server that hands out only some of them leaves them out: exactly the model's
/// count (`Writes.lean`'s `writesAt`), a later version more, a version with writes left out no more.
#[test]
fn each_version_holds_as_many_writes_as_in_the_lean_model() {
    let vectors = vectors();
    let (cases, versions) = (list(&vectors["cases"]), list(&vectors["versions"]));
    assert!(versions.len() >= 8, "the model's version cases");
    for v in versions {
        let case = cases.iter().find(|c| c["name"] == v["case"]).expect("the version's case");
        let (names, st) = replayed(case);
        let e = entry(&v["entry"]);
        let uncounted: HashSet<EditId> = st.uncounted(e, &names.readings).into_iter().collect();
        let left: HashSet<EditId> = names.edits(&v["left"]).into_iter().collect();
        let mut history = History::default();
        let kept = st.all_writes().iter().filter(|w| w.entry == e && !uncounted.contains(&w.edit) && !left.contains(&w.edit));
        for w in kept {
            let change = Change { write: w.clone(), body: None, fits: true, touches: None, counted: true, adds: vec![] };
            history.push(change).expect("what is kept builds on what is kept");
        }
        let heads = names.edits(&v["heads"]);
        assert_eq!(history.version(&heads).len() as u64, num(&v["writes"]), "{v}");
    }
}

#[test]
fn each_edit_settles_the_keys_as_the_whole_model_does() {
    // the core settles an edit that removes nothing by what it touched (T6); the model settles every key every time
    let vectors = vectors();
    for case in list(&vectors["cases"]) {
        let name = case["name"].as_str().unwrap();
        let mut names = Names::default();
        let (mut light, mut full) = (State::default(), State::default());
        for (i, v) in list(&case["edits"]).iter().enumerate() {
            let edit = names.edit_of(v, step_depth(v, i));
            let id = edit.id();
            let (a, b) = (light.step_mut(&edit, id), full.step_full(&edit, id));
            assert_eq!(a, b, "{name}, edit {i}");
            let what = format!("{name}, edit {i}: {v}");
            assert_eq!(light.entries(), full.entries(), "{what}: entries");
            assert_eq!(light.all_writes(), full.all_writes(), "{what}: writes");
            same_set(light.epochs(), full.epochs(), &format!("{what}: epochs"));
            let moved = |st: &State| st.epochs().map(|(k, e)| (k, e, st.moved_by(k, e))).collect::<Vec<_>>();
            same_set(moved(&light), moved(&full), &format!("{what}: what moved each family on"));
            same_set(light.seals().iter().copied(), full.seals().iter().copied(), &format!("{what}: seals"));
            same_set(light.published().iter().copied(), full.published().iter().copied(), &format!("{what}: published"));
            names.created(v, &edit, a.is_ok());
        }
    }
}

#[test]
fn each_edit_stands_or_is_cut_as_in_the_lean_models_view() {
    let vectors = vectors();
    let cases = list(&vectors["views"]);
    assert!(cases.len() >= 12);
    // a vault's own removals outrank a revoked grant: a core that ranked them the other way round would keep the
    // revocations these views cut, and drop the removals; a mark of the wants alone leaves the audience as it is, a
    // mark stands though a revocation of a share or of a keep share sorts before it, and revoking a keep share cuts
    // nothing it hadn't seen (K1)
    let views = [
        "a vault's removals outrank a revoked grant",
        "handing the root on outranks a revoked grant",
        "a mark of the wants alone puts back no audience",
        "a mark stands after what it names is revoked",
        "revoking a keep share cuts nothing",
    ];
    for view in views {
        assert!(cases.iter().any(|c| c["name"] == view), "the model's view {view:?}");
    }
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let (edits, standing) = (list(&case["edits"]), list(&case["standing"]));
        assert_eq!(edits.len(), standing.len(), "{name}");
        let mut names = Names::default();
        let mut held = vec![];
        for v in edits {
            let edit = names.edit_of(v, num(&v["depth"]));
            names.created(v, &edit, true);
            held.push(edit);
        }
        let r = replay(&held);
        let stood = r.standing();
        for (i, (edit, want)) in held.iter().zip(standing).enumerate() {
            assert_eq!(stood.contains(&edit.id()), want.as_bool().unwrap(), "{name}, edit {i}: {}", edits[i]);
        }
        names.check_state(name, case, &r.state);
    }
}

#[test]
fn each_device_is_sent_what_the_lean_model_sends_it_by_what_it_holds() {
    let vectors = vectors();
    let cases = list(&vectors["syncs"]);
    assert!(cases.len() >= 6);
    let (mut linked, mut fetched) = (0, 0);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let mut names = Names::default();
        let (mut all, mut files) = (vec![], vec![]);
        for v in list(&case["edits"]) {
            for f in v.get("files").map_or(&[][..], list) {
                if !files.contains(f) {
                    files.push(f.clone());
                }
            }
            let mut edit = names.edit_of(v, num(&v["depth"]));
            edit.parents = names.edits(&v["parents"]);
            names.created(v, &edit, true);
            all.push(edit);
        }
        let stood = replay(&all).standing();
        for (i, want) in list(&case["standing"]).iter().enumerate() {
            assert_eq!(stood.contains(&names.edits[i]), want.as_bool().unwrap(), "{name}: edit {i} stands");
        }
        // every log, its closed part and its frontier
        let fronts = frontiers(&all);
        let logs: Vec<LogId> = list(&case["logs"]).iter().map(|l| names.log(&l["log"])).collect();
        let mut sorted = logs.clone();
        sorted.sort();
        assert_eq!(fronts.keys().copied().collect::<Vec<_>>(), sorted, "{name}: logs");
        for (l, v) in logs.iter().zip(list(&case["logs"])) {
            let mut closed: Vec<EditId> = closed_part(&all, *l).into_iter().collect();
            closed.sort();
            assert_eq!(closed, names.edit_set(&v["closed"]), "{name}: closed part of {l:?}");
            assert_eq!(fronts[l], names.edit_set(&v["frontier"]), "{name}: frontier of {l:?}");
        }
        let mut want: Vec<(EditId, EditId)> = list(&case["forks"])
            .iter()
            .map(|p| {
                let (a, b) = (names.edit(&p[0]), names.edit(&p[1]));
                (a.min(b), a.max(b))
            })
            .collect();
        want.sort();
        assert_eq!(forks(&all), want, "{name}: forks");
        // each device that asks: what it names, and what it is sent
        let at = |places: &Value| -> Vec<Edit> {
            let ids = names.edits(places);
            all.iter().filter(|edit| ids.contains(&edit.id())).cloned().collect()
        };
        for a in list(&case["asks"]) {
            let (d, held) = (signer(&a["device"]), at(&a["held"]));
            let peer = if a["peer"].is_null() { all.clone() } else { at(&a["peer"]) };
            let what = format!("{name}: device {} holding {}", a["device"], a["held"]);
            let follow: Vec<VaultId> = list(&a["follow"]).iter().map(|v| names.vault(v)).collect();
            let asked = asks(&held, &follow);
            let fronts = frontiers(&held);
            let sent: Vec<LogId> = list(&a["logs"]).iter().map(|l| names.log(&l["log"])).collect();
            let mut sorted = sent.clone();
            sorted.sort();
            assert_eq!(asked.haves.keys().copied().collect::<Vec<_>>(), sorted, "{what}: logs");
            for (l, v) in sent.iter().zip(list(&a["logs"])) {
                assert_eq!(fronts[l], names.edit_set(&v["frontier"]), "{what}: frontier of {l:?}");
                assert_eq!(asked.haves[l], names.edit_set(&v["haves"]), "{what}: what it names of {l:?}");
            }
            assert_eq!(asked.loose, names.edit_set(&a["loose"]), "{what}: loose");
            let ids = |edits: Vec<Edit>| edits.iter().map(Edit::id).collect::<Vec<_>>();
            assert_eq!(ids(respond(&peer, d, &follow)), names.edits(&a["respond"]), "{what}: sent whole");
            assert_eq!(ids(respond_since(&peer, d, &asked)), names.edits(&a["since"]), "{what}: sent");
            // the files it may fetch: those an edit it is sent brings (T27)
            let fetch: Vec<&Value> = files.iter().filter(|f| may_fetch(&peer, d, &file(f), &follow)).collect();
            assert_eq!(fetch, list(&a["fetch"]).iter().collect::<Vec<_>>(), "{what}: files it may fetch");
            fetched += fetch.len();
        }
        // each passkey that proves itself to a peer holding every edit, to link a new device: the card it is handed
        for l in list(&case["links"]) {
            let card: Vec<EditId> = link_card(&all, signer(&l["passkey"])).iter().map(Edit::id).collect();
            assert_eq!(card, names.edits(&l["card"]), "{name}: the card for passkey {}", l["passkey"]);
            linked += 1;
        }
    }
    assert!(linked >= 5, "the model links passkeys that own vaults and passkeys that own none: {linked}");
    assert!(fetched >= 7, "the model hands some devices files: {fetched}");
}

#[test]
fn the_server_takes_of_each_batch_what_the_lean_models_gate_takes() {
    let vectors = vectors();
    let cases = list(&vectors["gates"]);
    assert!(cases.len() >= 7);
    let (mut all, mut none, mut some) = (0, 0, 0);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        // a held edit may name a vault the batch founds: named again until every number names what it created
        let mut names = Names::default();
        let (held, batch) = loop {
            let named = (names.vaults.clone(), names.shares.clone());
            names = Names { vaults: named.0.clone(), shares: named.1.clone(), ..Names::default() };
            let mut edits = |key: &str| -> Vec<Edit> {
                let of = |v: &Value| {
                    let edit = names.edit_of(v, num(&v["depth"]));
                    names.created(v, &edit, true);
                    edit
                };
                list(&case[key]).iter().map(of).collect()
            };
            let (held, batch) = (edits("held"), edits("batch"));
            if (&names.vaults, &names.shares) == (&named.0, &named.1) {
                break (held, batch);
            }
        };
        let before = replay(&held).state;
        let taken = gate::takes(names.vault(&case["home"]), &held, &before, batch.clone(), &names.readings);
        let ids = |b: &[Edit]| b.iter().map(Edit::id).collect::<Vec<_>>();
        let want = (!case["takes"].is_null()).then(|| list(&case["takes"]).iter().map(|i| batch[num(i) as usize].id()));
        assert_eq!(taken.as_deref().map(ids), want.map(Iterator::collect), "{name}");
        match taken.map(|b| b.len()) {
            Some(n) if n == batch.len() => all += 1,
            Some(0) | None => none += 1,
            Some(_) => some += 1,
        }
    }
    // a batch taken whole, one of which it takes nothing, and one of which it takes some
    assert!(all > 0 && none > 0 && some > 0, "{all} {none} {some}");
}

#[test]
fn the_server_says_of_each_device_what_the_lean_model_says() {
    let vectors = vectors();
    let cases = list(&vectors["standings"]);
    assert!(cases.len() >= 7);
    let (mut admins, mut others, mut nobodys) = (0, 0, 0);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let mut names = Names::default();
        let held: Vec<Edit> = list(&case["held"])
            .iter()
            .map(|v| {
                let edit = names.edit_of(v, num(&v["depth"]));
                names.created(v, &edit, true);
                edit
            })
            .collect();
        let st = replay(&held).state;
        let groups = st.read_groups(&names.readings);
        let said = gate::device_standing(&st, &groups, names.vault(&case["home"]), signer(&case["device"]));
        let want = &case["standing"];
        let want = (!want.is_null()).then(|| (names.vault(&want["vault"]), want["admin"].as_bool().unwrap()));
        assert_eq!(said, want, "{name}");
        match said {
            Some((_, true)) => admins += 1,
            Some((_, false)) => others += 1,
            None => nobodys += 1,
        }
    }
    // an admin's device, a device that is no admin's, and a signer that is nobody's device
    assert!(admins > 0 && others > 0 && nobodys > 0, "{admins} {others} {nobodys}");
}

/// `v` without its `null` fields: the model writes every field, and absent ones as `null`.
fn present(v: &Value) -> Value {
    let fields = v.as_object().expect("a record").iter().filter(|(_, x)| !x.is_null());
    Value::Object(fields.map(|(k, x)| (k.clone(), x.clone())).collect())
}

/// A stored item of `kind` holding `fields`, as an item stores the model's record.
fn item(kind: &str, fields: &Value) -> Value {
    let mut r: Map<String, Value> = present(fields).as_object().unwrap().clone();
    r.insert("kind".into(), json!(kind));
    Value::Object(r)
}

/// The model's view of a block, as the app's view of a document holding just that block shows it.
fn block_view(view: &View, block: &Value) -> Value {
    let mut doc = view.get(&json!({"kind": "document"})).unwrap();
    doc["blocks"] = json!([present(block)]);
    doc
}

#[test]
fn the_lens_vectors() {
    let file = std::fs::read_to_string(LENSES).expect("the vectors: run `lake exe vectors` in avendb/spec");
    let vectors: Value = serde_json::from_str(&file).unwrap();
    let (blocks, todos) = (list(&vectors["blocks"]), list(&vectors["todos"]));
    assert!(blocks.len() >= 100 && todos.len() >= 10);
    let apps = [("v0", "putV0", example::document_v0()), ("v1", "putV1", example::document_v1())];
    for case in blocks {
        let stored = json!({"kind": "document", "blocks": [present(&case["stored"])]});
        for (seen, puts, view) in apps {
            // the app sees the block as the model does, or not at all
            let shown = view.get(&stored).unwrap();
            let want = if case[seen].is_null() { json!([]) } else { json!([present(&case[seen])]) };
            assert_eq!(shown["blocks"], want, "{seen} of {}", case["stored"]);
            // and each edit through its view stores what the model stores
            for p in list(&case[puts]) {
                let after = view.put(&stored, &block_view(view, &p["view"])).unwrap_or_else(|| panic!("{puts} {p}"));
                let (from, to) = (&case["stored"], &p["view"]);
                assert_eq!(after["blocks"], json!([present(&p["stored"])]), "{puts} of {from} to {to}");
            }
        }
    }
    let apps = [("v0", "putV0", example::todo_v0()), ("v1", "putV1", example::todo_v1())];
    for case in todos {
        let stored = item("todo", &case["stored"]);
        for (seen, puts, view) in apps {
            assert_eq!(view.get(&stored), Some(item("todo", &case[seen])), "{seen} of {}", case["stored"]);
            for p in list(&case[puts]) {
                let after = view.put(&stored, &item("todo", &p["view"]));
                assert_eq!(after, Some(item("todo", &p["stored"])), "{puts} of {} to {}", case["stored"], p["view"]);
            }
        }
    }
}

fn backup_vectors() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../spec/vectors/backups.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("the backup vectors: run `lake exe vectors` in avendb/spec"))
        .unwrap()
}

/// The edits of a sync case, with its names.
fn sync_case(case: &Value) -> (Names, Vec<Edit>) {
    let mut names = Names::default();
    let mut all = vec![];
    for v in list(&case["edits"]) {
        let mut edit = names.edit_of(v, num(&v["depth"]));
        edit.parents = names.edits(&v["parents"]);
        names.created(v, &edit, true);
        all.push(edit);
    }
    (names, all)
}

/// The backup vectors (`spec/vectors/backups.json`, `Backup.lean`): for each sync case and each vault of its view, the
/// vault's snapshot (`backup::snapshot`) is the model's edits, in its order, and brings the model's files (B6, B1).
#[test]
fn each_vault_s_snapshot_is_the_lean_model_s() {
    let (vectors, backups) = (vectors(), backup_vectors());
    let mut checked = 0;
    for case in list(&vectors["syncs"]) {
        let name = case["name"].as_str().unwrap();
        let (names, all) = sync_case(case);
        for s in list(&backups["snapshots"]).iter().filter(|s| s["case"] == name) {
            let v = names.vault(&s["vault"]);
            let snap = avendb::backup::snapshot(&all, v);
            let what = format!("{name}: the snapshot of vault {}", s["vault"]);
            assert_eq!(snap.iter().map(Edit::id).collect::<Vec<_>>(), names.edits(&s["edits"]), "{what}");
            let files: Vec<FileRoot> = list(&s["files"]).iter().map(file).collect();
            assert_eq!(avendb::backup::files(&snap), files, "{what}: its files");
            checked += 1;
        }
    }
    assert!(checked >= 30, "the model takes a snapshot of every vault of every sync case: {checked}");
}

/// A manifest as the replay keeps it: when, the packs it names, its files, and what it asks by.
struct Manifest {
    time: u64,
    packs: Vec<u64>,
    ask: avendb::sync::Ask,
}

/// The backup vectors' runs: a vault's folder through backups and retentions, each backup planned by
/// `backup::plan` from the newest manifest's frontiers and loose edits, as the Lean model's (B1, B2, B4, B7 to B9): the
/// manifest it builds on, the pack it adds, the manifest it writes (its packs, files, frontiers and loose edits), and
/// after each step, the folder's packs and what each manifest restores.
#[test]
fn each_backup_builds_on_its_folder_as_the_lean_model_s() {
    let (vectors, backups) = (vectors(), backup_vectors());
    assert_eq!(num(&backups["runs"][0]["most"]) as usize, avendb::backup::MOST_PACKS, "the most packs a manifest names");
    let mut steps = 0;
    for run in list(&backups["runs"]) {
        let name = run["name"].as_str().unwrap();
        let case = list(&vectors["syncs"]).iter().find(|c| c["name"] == run["case"]).expect("the run's sync case");
        let (names, all) = sync_case(case);
        let (mut packs, mut manifests): (Vec<(u64, Vec<EditId>)>, Vec<Manifest>) = (vec![], vec![]);
        for (n, step) in list(&run["steps"]).iter().enumerate() {
            let what = format!("{name}, step {n}");
            if let Some(b) = step["step"].get("backup") {
                let places: HashSet<u64> = list(&b["held"]).iter().map(num).collect();
                let held: Vec<Edit> =
                    all.iter().enumerate().filter(|(i, _)| places.contains(&(*i as u64))).map(|(_, e)| e.clone()).collect();
                let snap = avendb::backup::snapshot_places(&held, &avendb::policy::view(&held), names.vault(&b["vault"]));
                let snap_edits: Vec<Edit> = snap.iter().map(|&i| held[i].clone()).collect();
                let newest = manifests.last();
                let compact = b["compact"].as_bool().unwrap() || newest.is_some_and(|m| avendb::backup::due(m.packs.len()));
                let plan = avendb::backup::plan(&held, &snap, newest.map(|m| &m.ask), compact);
                let base = plan.base.then(|| newest.expect("a manifest to build on").time);
                assert_eq!(base, step["base"].as_u64(), "{what}: the manifest it builds on");
                let news: Vec<EditId> = plan.news.iter().map(|&i| held[i].id()).collect();
                let mut named: Vec<u64> = match plan.base {
                    true => packs.iter().map(|(id, _)| *id).filter(|id| newest.unwrap().packs.contains(id)).collect(),
                    false => vec![],
                };
                match &step["added"] {
                    Value::Null => assert!(news.is_empty(), "{what}: it adds no pack"),
                    added => {
                        let id = packs.iter().map(|(id, _)| *id).max().unwrap_or(0) + 1;
                        assert_eq!(id, num(&added["id"]), "{what}: the new pack's id");
                        assert_eq!(news, names.edits(&added["edits"]), "{what}: the new pack's edits");
                        packs.push((id, news));
                        named.push(id);
                    }
                }
                let m = &step["manifest"];
                assert_eq!(num(&m["time"]), num(&b["time"]), "{what}");
                assert_eq!(named, list(&m["packs"]).iter().map(num).collect::<Vec<_>>(), "{what}: the packs it names");
                let files: Vec<FileRoot> = list(&m["files"]).iter().map(file).collect();
                assert_eq!(avendb::backup::files(&snap_edits), files, "{what}: its files");
                let ask = avendb::sync::asks_by_frontiers(&snap_edits);
                let fronts = list(&m["fronts"]);
                assert_eq!(ask.haves.len(), fronts.len(), "{what}: the logs it names");
                for f in fronts {
                    let l = names.log(&f["log"]);
                    let ours = ask.haves.get(&l).unwrap_or_else(|| panic!("{what}: no frontier of {l:?}")).clone();
                    same_set(ours, names.edits(&f["frontier"]), &format!("{what}: the frontier of {l:?}"));
                }
                same_set(ask.loose.clone(), names.edits(&m["loose"]), &format!("{what}: its loose edits"));
                manifests.push(Manifest { time: num(&b["time"]), packs: named, ask });
            } else {
                let now = num(&step["step"]["retain"]);
                let times: Vec<u64> = manifests.iter().map(|m| m.time).collect();
                manifests.retain(|m| avendb::backup::keeps(&avendb::backup::Keep::default(), now, &times, m.time));
                packs.retain(|(id, _)| manifests.iter().any(|m| m.packs.contains(id)));
            }
            let want: Vec<(u64, Vec<EditId>)> =
                list(&step["packs"]).iter().map(|p| (num(&p["id"]), names.edits(&p["edits"]))).collect();
            assert_eq!(packs, want, "{what}: the folder's packs");
            let restores = list(&step["restores"]);
            assert_eq!(manifests.len(), restores.len(), "{what}: the manifests kept");
            for (m, r) in manifests.iter().zip(restores) {
                assert_eq!(m.time, num(&r["time"]), "{what}");
                let restored: Vec<EditId> =
                    packs.iter().filter(|(id, _)| m.packs.contains(id)).flat_map(|(_, e)| e.iter().copied()).collect();
                same_set(restored, names.edits(&r["edits"]), &format!("{what}: what the manifest of {} restores", m.time));
            }
            steps += 1;
        }
    }
    assert!(steps >= 15, "the runs' steps: {steps}");
}

/// The backup vectors' retention cases: which snapshots a retention at some moment keeps (`backup::keeps`), by the
/// default policy (B5).
#[test]
fn each_retention_keeps_the_snapshots_the_lean_model_keeps() {
    let backups = backup_vectors();
    let k = &backups["keep"];
    let keep = avendb::backup::Keep::default();
    assert_eq!((keep.recent, keep.days, keep.weeks), (num(&k["recent"]), num(&k["days"]), num(&k["weeks"])));
    use avendb::backup::{DAY, MONTH, WEEK};
    assert_eq!((DAY, WEEK, MONTH), (num(&k["day"]), num(&k["week"]), num(&k["month"])));
    for (n, c) in list(&backups["retention"]).iter().enumerate() {
        let times: Vec<u64> = list(&c["times"]).iter().map(num).collect();
        let kept: Vec<bool> = times.iter().map(|&t| avendb::backup::keeps(&keep, num(&c["now"]), &times, t)).collect();
        let want: Vec<bool> = list(&c["kept"]).iter().map(|b| b.as_bool().unwrap()).collect();
        assert_eq!(kept, want, "retention case {n}");
    }
}

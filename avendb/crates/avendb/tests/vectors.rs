//! The Lean model's test vectors (`avendb/spec/vectors/vaults.json` and `lenses.json`, written by `lake exe vectors`,
//! checked by every `lake build`). A step case's edits, applied one after the other from the empty state, must be
//! accepted or refused exactly as the model says. A view case's edits, each at the depth it claims, must stand or be
//! cut exactly as in the model's view: that is where removals cut what they hadn't seen, and in a post-quantum case
//! where the writes no checkpoint covers drop out (`checkpointed`). Both must end with the same vaults, shares, entries
//! (their stays, and as their readers see them their attributes, whether their creation was let in, their semantic
//! audience and where a steward would move them), writes, key schedule (each family's epoch, every seal, every
//! published key), schema lanes, and the writes their readers count, line by line. The lens vectors hold each app's
//! view of many stored blocks and todos, and what each edit through a view stores.
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
//! model's. A keys edit of the model names only where its boxes go; the core's carries the boxes too, which no rule
//! opens, so here they are empty. A publish names its blob by a number: here the blob is the bytes `blob <number>`. A
//! type or a tag is a number in the model, and its digits here.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::fmt::Debug;
use std::hash::Hash;

use avendb::id::{AudienceId, BlobId, EditId, EntryId, ShareId, SignerId, VaultId};
use avendb::keys::{KeyBox, KeyFam, KeyId, KeyName, Recipient, Seal};
use avendb::lens::View;
use avendb::policy::{
    checkpointed, history, mk_audience, replay, tips, Action, Edit, Kind, Level, Line, Principal, Proposal, Readings,
    Share, State, SyncRule, Vault, Who,
};
use avendb::rules::{self, ops_of_json, Grant, Proof, Touch};
use avendb::slice::{Atom, Attrs, Header, Select, Selector, Sym, TagDelta};
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

/// A type or a tag.
fn sym(v: &Value) -> Sym {
    Sym(num(v).to_string())
}

fn syms(v: &Value) -> Vec<Sym> {
    list(v).iter().map(sym).collect()
}

fn kind(v: &Value) -> Kind {
    match v.as_str() {
        Some("human") => Kind::Human,
        Some("coop") => Kind::Coop,
        Some("aven") => Kind::Aven,
        _ => panic!("a kind, not {v}"),
    }
}

fn level(v: &Value) -> Level {
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

    /// A steward's marks: in the core's canonical order where the model's are in its own, and out of it where they
    /// aren't.
    fn picks(&self, v: &Value) -> Vec<ShareId> {
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
        match v.as_str() {
            Some("everyone") => Who::Everyone,
            _ => Who::Principal(self.principal(v)),
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
        }
    }

    /// A sync rule as the core sets it: its selector where its sealed slice goes, beside the commitment to no op, its
    /// number as its nonce.
    fn rule_of(&self, v: &Value) -> SyncRule {
        let slice = serde_json::to_vec(&v["select"]).unwrap();
        let commitment = Grant { ops: vec![], salt: [0; 32] }.commitment();
        SyncRule {
            issuer: self.vault(&v["issuer"]),
            device: signer(&v["device"]),
            over: self.vault(&v["over"]),
            wide: v["wide"].as_bool().unwrap(),
            select: Select::Sealed { boxes: vec![], slice, commitment }.to_wire(),
            keep: v["keep"].as_bool().unwrap(),
            nonce: num(&v["id"]),
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
            "addOwner" => Action::AddOwner { vault: vault(), owner: self.principal(&x["owner"]), seal_to: None },
            "removeOwner" => Action::RemoveOwner { vault: vault(), owner: self.principal(&x["owner"]), keep: keep() },
            "setThreshold" => Action::SetThreshold { vault: vault(), threshold: num(&x["threshold"]) as u32 },
            "addDevice" => Action::AddDevice { vault: vault(), device: signer(&x["device"]), seal_to: None },
            "removeDevice" => Action::RemoveDevice { vault: vault(), device: signer(&x["device"]), keep: keep() },
            "setRoot" => Action::SetRoot {
                vault: vault(),
                root: (!x["root"].is_null()).then(|| signer(&x["root"])),
                keep: keep(),
            },
            "share" => Action::Share(self.share_of(&x["share"]), self.via(&x["via"])),
            "revoke" => Action::Revoke {
                share: self.share(&x["share"]),
                actor: self.vault(&x["actor"]),
                keep: keep(),
                via: self.via(&x["via"]),
            },
            "write" => Action::Write {
                vault: vault(),
                entry: entry(&x["entry"]),
                actor: self.vault(&x["actor"]),
                stay: self.opt_edit(&x["stay"]),
                epoch: num(&x["epoch"]),
                deps: self.edits(&x["deps"]),
                proposal: self.proposal(&x["proposal"]),
                via: self.via(&x["via"]),
                create: (!x["create"].is_null()).then(|| self.audience(&x["create"]["audience"])),
                files: vec![],
                body: serde_json::to_vec(&json!({"create": x["create"], "tags": x["tags"]})).unwrap(),
            },
            "move" => Action::Move {
                vault: vault(),
                entry: entry(&x["entry"]),
                to: self.audience(&x["to"]),
                keep: keep(),
                via: self.via(&x["via"]),
            },
            "keys" => Action::Keys {
                name: self.key_name(&x["secret"]),
                id: KeyId([0; 32]),
                public: None,
                boxes: list(&x["to"]).iter().map(|t| KeyBox { to: self.recipient(t), bytes: vec![] }).collect(),
                clear: x["public"].as_bool().unwrap().then_some([0; 32]),
            },
            "publish" => Action::Publish {
                vault: vault(),
                actor: self.vault(&x["actor"]),
                via: self.via(&x["via"]),
                blob: blob(&x["blob"]),
            },
            "checkpoint" => Action::Checkpoint { entry: entry(&x["entry"]), covers: self.edits(&x["covers"]) },
            "syncRule" => Action::SyncRule(self.rule_of(&x["rule"]), self.via(&x["via"])),
            "endRule" => Action::EndSyncRule {
                rule: self.share(&x["rule"]),
                issuer: self.vault(&x["issuer"]),
                via: self.via(&x["via"]),
            },
            "pick" => Action::Pick {
                vault: vault(),
                entry: entry(&x["entry"]),
                rules: self.picks(&x["rules"]),
                via: self.via(&x["via"]),
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
            ("share", x) => {
                let (share, parent) = (ShareId::from(id), &x["share"]["parent"]);
                self.readings.selectors.insert(share, self.selector(&x["share"]["select"]));
                self.parents.insert(share, (!parent.is_null()).then(|| self.share(parent)));
                self.grants.insert(share, grant(&x["share"]));
                self.shares.insert(num(&x["share"]["id"]), share);
            }
            ("syncRule", x) => {
                let rule = ShareId::from(id);
                self.readings.selectors.insert(rule, self.selector(&x["rule"]["select"]));
                self.shares.insert(num(&x["rule"]["id"]), rule);
            }
            ("write", x) => {
                if !x["create"].is_null() {
                    self.readings.headers.insert(id, header(&x["create"]["header"]));
                }
                self.readings.tags.insert(id, tag_delta(&x["tags"]));
                if let Some(c) = x.get("proof") {
                    let share = self.share(c);
                    let grants = self.chain(share).iter().filter_map(|c| self.grants.get(c).cloned()).collect();
                    self.readings.proofs.insert(id, Proof { share, grants });
                }
                let touches = x.get("touches").map_or(&[][..], list).iter().map(|t| Touch::of_json(t).unwrap());
                self.readings.touches.insert(id, touches.collect());
                if x.get("fits") == Some(&Value::Bool(false)) {
                    self.readings.unfit.insert(id);
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

    /// The state a case ends with must be the model's.
    fn check_state(&self, name: &str, case: &Value, st: &State) {
        let vaults: Vec<Vault> = list(&case["vaults"]).iter().map(|v| self.vault_of(v)).collect();
        assert_eq!(st.vaults(), &vaults[..], "{name}: vaults");
        // every share issued, live or revoked, in the order issued
        type ShareRow = (ShareId, VaultId, Who, Level, bool, Option<ShareId>, VaultId);
        let shares: Vec<ShareRow> = list(&case["shares"])
            .iter()
            .map(|v| {
                let c = self.share_of(v);
                (self.share(&v["id"]), c.over, c.who, c.level, c.wide, c.parent, c.issuer)
            })
            .collect();
        let ours: Vec<ShareRow> = st
            .shares()
            .iter()
            .map(|cp| {
                (cp.id, cp.share.over, cp.share.who, cp.share.level, cp.share.wide, cp.share.parent, cp.share.issuer)
            })
            .collect();
        assert_eq!(ours, shares, "{name}: shares");
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
            let audience: BTreeSet<ShareId> = m.audience.iter().copied().collect();
            assert_eq!(audience, self.audience_set(&v["semAudience"]), "{what}: semantic audience");
            let desired = m.desired.map(|x| x.into_iter().collect::<BTreeSet<ShareId>>());
            let want = (!v["desired"].is_null()).then(|| self.audience_set(&v["desired"]));
            assert_eq!(desired, want, "{what}: where a steward moves it");
            let marks: BTreeSet<ShareId> = st.picks_of(en.id).iter().copied().collect();
            assert_eq!(marks, self.audience_set(&v["picks"]), "{what}: the rules it is marked with");
            let picks: BTreeSet<ShareId> = m.picks.into_iter().collect();
            assert_eq!(picks, self.audience_set(&v["semPicks"]), "{what}: the rules that pick it");
            let pick = m.pick.map(|x| x.into_iter().collect::<BTreeSet<ShareId>>());
            let want = (!v["desiredPicks"].is_null()).then(|| self.audience_set(&v["desiredPicks"]));
            assert_eq!(pick, want, "{what}: what a steward marks it with");
        }
        // every sync rule set, live or ended, in the order set, and the rules that ended
        type RuleRow = (ShareId, VaultId, SignerId, VaultId, bool, bool);
        let row = |id: ShareId, r: &SyncRule| (id, r.issuer, r.device, r.over, r.wide, r.keep);
        let rules: Vec<RuleRow> =
            list(&case["rules"]).iter().map(|v| row(self.share(&v["id"]), &self.rule_of(v))).collect();
        let ours: Vec<RuleRow> = st.rules().iter().map(|(id, r)| row(*id, r)).collect();
        assert_eq!(ours, rules, "{name}: sync rules");
        let ended: Vec<ShareId> = list(&case["ended"]).iter().map(|r| self.share(r)).collect();
        assert_eq!(st.ended(), &ended[..], "{name}: ended sync rules");
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
        let ours: Vec<(VaultId, BlobId)> = st.lane().iter().map(|p| (p.vault, p.blob)).collect();
        assert_eq!(ours, lane, "{name}: lane");
        // the writes the entries' readers don't count, of those the state holds
        let uncounted: HashSet<EditId> =
            st.entries().iter().flat_map(|en| st.uncounted(en.id, &self.readings)).collect();
        let held: HashSet<EditId> = st.all_writes().iter().map(|w| w.edit).collect();
        let want = self.edits(&case["uncounted"]).into_iter().filter(|e| held.contains(e));
        same_set(uncounted.iter().copied(), want, &format!("{name}: uncounted"));
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
fn each_edit_is_accepted_or_refused_as_in_the_lean_model() {
    let vectors = vectors();
    let cases = list(&vectors["cases"]);
    assert!(cases.len() >= 12);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let (edits, accepted) = (list(&case["edits"]), list(&case["accepted"]));
        assert_eq!(edits.len(), accepted.len(), "{name}");
        let mut names = Names::default();
        let mut st = State::default();
        for (i, (v, want)) in edits.iter().zip(accepted).enumerate() {
            let edit = names.edit_of(v, step_depth(v, i));
            let got = st.step(&edit);
            assert_eq!(
                got.is_ok(),
                want.as_bool().unwrap(),
                "{name}, edit {i}: {v} gave {got:?}",
                got = got.as_ref().err()
            );
            names.created(v, &edit, got.is_ok());
            if let Ok(next) = got {
                st = next;
            }
        }
        names.check_state(name, case, &st);
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
        let r = if case["pq"].as_bool().unwrap() { replay(&checkpointed(&held)) } else { replay(&held) };
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
            let asked = asks(&held);
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
            assert_eq!(ids(respond(&peer, d)), names.edits(&a["respond"]), "{what}: sent whole");
            assert_eq!(ids(respond_since(&peer, d, &asked)), names.edits(&a["since"]), "{what}: sent");
            // the files it may fetch: those an edit it is sent brings (T27)
            let fetch: Vec<&Value> = files.iter().filter(|f| may_fetch(&peer, d, &file(f))).collect();
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
    let apps = [("v1", "putV1", View::document_v1()), ("v2", "putV2", View::document_v2())];
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
    let apps = [("v1", "putV1", View::todo_v1()), ("v2", "putV2", View::todo_v2())];
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

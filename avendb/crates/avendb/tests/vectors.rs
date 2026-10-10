//! The Lean model's test vectors (`avendb/spec/vectors/vaults.json` and `lenses.json`, written by `lake exe vectors`,
//! checked by every `lake build`). A step case's edits, applied one after the other from the empty state, must be
//! accepted or refused exactly as the model says. A view case's edits, each at the depth it claims, must stand or be
//! cut exactly as in the model's view: that is where removals cut what they hadn't seen, and in a post-quantum case
//! where the writes no checkpoint covers drop out (`checkpointed`). Both must end with the same vaults, caps, entries
//! (their stays, and as their readers see them their attributes, whether their creation was let in, their semantic
//! cell and where a steward would move them), writes, key schedule (each family's epoch, every seal, every published
//! key) and schema lanes. The lens vectors hold each app's view of many stored blocks and todos, and what each edit
//! through a view stores.
//!
//! A sync case's edits, each with the parents and depth the model gives it, must stand as in the model, fall into the
//! same logs with the same closed parts and frontiers, and fork where the model says; and each device that asks a peer
//! must name the same edits of each log and the same loose edits, and be sent the same edits in the same order, whole
//! (`respond`) and given what it named (`respond_since`); and each passkey that proves itself to link a new device
//! must be handed the same vault logs (`link_card`).
//!
//! The model names what an edit creates (a vault, a cap) by a number, and an edit by its place in the case; the core
//! names them by hashes, so each number maps to what its edit created, and each place to that edit's id. A cell is a set
//! of caps: the core keeps its caps sorted by id and names it by the hash of its vault and those caps. What no rule
//! reads travels encrypted or sealed in the core: a cap's selector, a write's header and tags. Here a cap carries its
//! selector's JSON where its sealed selector goes, and a write its header's and tags' JSON where its ciphertext goes, and
//! the readings (`Readings`) hold what a reader opens of them. A keys edit of the model names only where its boxes go;
//! the core's carries the boxes too, which no rule opens, so here they are empty. A publish names its blob by a number:
//! here the blob is the bytes `blob <number>`. A type or a tag is a number in the model, and its digits here.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::fmt::Debug;
use std::hash::Hash;

use avendb::id::{BlobId, CapId, CellId, EditId, EntryId, SignerId, VaultId};
use avendb::keys::{KeyBox, KeyFam, KeyId, KeyName, Recipient, Seal};
use avendb::lens::View;
use avendb::policy::{
    checkpointed, mk_cell, replay, Action, Cap, Edit, Grantee, Kind, Line, Principal, Proposal, Readings, Role, State,
    Vault,
};
use avendb::slice::{Atom, Attrs, Header, Selector, Sym, TagDelta};
use avendb::sync::{asks, closed_part, forks, frontiers, link_card, respond, respond_since, LogId};
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

fn role(v: &Value) -> Role {
    match v.as_str() {
        Some("relay") => Role::Relay,
        Some("backup") => Role::Backup,
        Some("read") => Role::Read,
        Some("write") => Role::Write,
        Some("owner") => Role::Owner,
        _ => panic!("a role, not {v}"),
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
    caps: HashMap<u64, CapId>,
    /// Each edit's id, by its place in the case.
    edits: Vec<EditId>,
    readings: Readings,
}

impl Names {
    fn vault(&self, v: &Value) -> VaultId {
        let n = num(v);
        self.vaults.get(&n).copied().unwrap_or(VaultId::from_u64(n))
    }

    fn cap(&self, v: &Value) -> CapId {
        let n = num(v);
        self.caps.get(&n).copied().unwrap_or(CapId::from_u64(n))
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

    /// A cell's caps, in the core's canonical order.
    fn cell(&self, v: &Value) -> Vec<CapId> {
        mk_cell(&list(v).iter().map(|c| self.cap(c)).collect::<Vec<_>>())
    }

    /// A cell's caps as a set.
    fn cell_set(&self, v: &Value) -> BTreeSet<CapId> {
        list(v).iter().map(|c| self.cap(c)).collect()
    }

    fn principal(&self, v: &Value) -> Principal {
        match (v.get("signer"), v.get("vault")) {
            (Some(s), None) => Principal::Signer(signer(s)),
            (None, Some(x)) => Principal::Vault(self.vault(x)),
            _ => panic!("a principal, not {v}"),
        }
    }

    fn grantee(&self, v: &Value) -> Grantee {
        match v.as_str() {
            Some("public") => Grantee::Public,
            _ => Grantee::Principal(self.principal(v)),
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

    /// A cap as the core issues it: its selector and the tags it relabels where its sealed selector goes, its number
    /// as its nonce.
    fn cap_of(&self, v: &Value) -> Cap {
        let select = serde_json::to_vec(&json!({"select": v["select"], "relabel": v["relabel"]})).unwrap();
        Cap {
            over: self.vault(&v["over"]),
            grantee: self.grantee(&v["grantee"]),
            role: role(&v["role"]),
            wide: v["wide"].as_bool().unwrap(),
            select,
            parent: (!v["parent"].is_null()).then(|| self.cap(&v["parent"])),
            issuer: self.vault(&v["issuer"]),
            nonce: num(&v["id"]),
        }
    }

    fn key_fam(&self, v: &Value) -> KeyFam {
        match variant(v) {
            ("seed", x) => KeyFam::Seed(self.vault(x)),
            ("cap", x) => KeyFam::Cap(self.vault(&x["vault"]), self.cap(&x["cap"])),
            ("cell", x) => {
                let vault = self.vault(&x["vault"]);
                KeyFam::Cell(vault, CellId::of(vault, &self.cell(&x["caps"])))
            }
            (other, _) => panic!("no key family {other}"),
        }
    }

    fn key_name(&self, v: &Value) -> KeyName {
        if let Some(s) = v.get("signer") {
            KeyName::Signer(signer(s))
        } else if let Some(e) = v.get("entry") {
            KeyName::Entry(entry(e), self.opt_edit(&v["stay"]), num(&v["gen"]))
        } else {
            KeyName::Scoped(self.key_fam(&v["key"]), num(&v["epoch"]))
        }
    }

    fn log(&self, v: &Value) -> LogId {
        match variant(v) {
            ("vault", x) => LogId::Vault(self.vault(x)),
            ("cap", x) => LogId::Cap(self.cap(x)),
            ("cell", x) => {
                let vault = self.vault(&x["vault"]);
                LogId::Cell(vault, CellId::of(vault, &self.cell(&x["caps"])))
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
            "cap" => Action::Cap(self.cap_of(&x["cap"]), self.via(&x["via"])),
            "revoke" => Action::Revoke {
                cap: self.cap(&x["cap"]),
                actor: self.vault(&x["actor"]),
                keep: keep(),
                via: self.via(&x["via"]),
            },
            "write" => Action::Write {
                vault: vault(),
                entry: entry(&x["entry"]),
                actor: self.vault(&x["actor"]),
                stay: self.opt_edit(&x["stay"]),
                generation: num(&x["gen"]),
                deps: self.edits(&x["deps"]),
                proposal: self.proposal(&x["proposal"]),
                via: self.via(&x["via"]),
                create: (!x["create"].is_null()).then(|| self.cell(&x["create"]["cell"])),
                body: serde_json::to_vec(&json!({"create": x["create"], "tags": x["tags"]})).unwrap(),
            },
            "move" => Action::Move {
                vault: vault(),
                entry: entry(&x["entry"]),
                to: self.cell(&x["to"]),
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
            other => panic!("no action {other}"),
        }
    }

    /// The edit at the next place of the case, from its JSON, at `depth`.
    fn edit_of(&self, v: &Value, depth: u64) -> Edit {
        let cosigners = list(&v["cosigners"]).iter().map(signer).collect();
        Edit { parents: vec![], depth, author: signer(&v["author"]), cosigners, action: self.action(&v["action"]) }
    }

    /// Name what `edit`, at the next place, creates, and note what its readers open. A vault's number names the vault
    /// only once its genesis is accepted, as the step cases try one number more than once; a cap has a number of its
    /// own.
    fn created(&mut self, v: &Value, edit: &Edit, accepted: bool) {
        let id = edit.id();
        match variant(&v["action"]) {
            ("genesis", x) if accepted => {
                self.vaults.insert(num(&x["vault"]), VaultId::from(id));
            }
            ("cap", x) => {
                let selector = self.selector(&x["cap"]["select"]);
                self.caps.insert(num(&x["cap"]["id"]), CapId::from(id));
                self.readings.selectors.insert(CapId::from(id), selector);
            }
            ("write", x) => {
                if !x["create"].is_null() {
                    self.readings.headers.insert(id, header(&x["create"]["header"]));
                }
                self.readings.tags.insert(id, tag_delta(&x["tags"]));
            }
            _ => {}
        }
        self.edits.push(id);
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
        // every cap issued, live or revoked, in the order issued
        type CapRow = (CapId, VaultId, Grantee, Role, bool, Option<CapId>, VaultId);
        let caps: Vec<CapRow> = list(&case["caps"])
            .iter()
            .map(|v| {
                let c = self.cap_of(v);
                (self.cap(&v["id"]), c.over, c.grantee, c.role, c.wide, c.parent, c.issuer)
            })
            .collect();
        let ours: Vec<CapRow> = st
            .caps()
            .iter()
            .map(|cp| (cp.id, cp.cap.over, cp.cap.grantee, cp.cap.role, cp.cap.wide, cp.cap.parent, cp.cap.issuer))
            .collect();
        assert_eq!(ours, caps, "{name}: caps");
        let revoked: Vec<CapId> = list(&case["revoked"]).iter().map(|c| self.cap(c)).collect();
        assert_eq!(st.revoked(), &revoked[..], "{name}: revoked");
        // each entry: its stays, the current one first, and what its readers see
        let want: Vec<&Value> = list(&case["entries"]).iter().collect();
        assert_eq!(st.entries().len(), want.len(), "{name}: entries");
        for (en, v) in st.entries().iter().zip(want) {
            let what = format!("{name}: entry {}", v["id"]);
            assert_eq!((en.id, en.vault), (entry(&v["id"]), self.vault(&v["vault"])), "{what}");
            let stays: Vec<(Option<EditId>, BTreeSet<CapId>)> =
                list(&v["stays"]).iter().map(|s| (self.opt_edit(&s["stay"]), self.cell_set(&s["cell"]))).collect();
            let ours: Vec<(Option<EditId>, BTreeSet<CapId>)> = en
                .stays
                .iter()
                .rev()
                .map(|(s, x)| (*s, st.cell_caps(*x).expect("a cell's caps").iter().copied().collect()))
                .collect();
            assert_eq!(ours, stays, "{what}: stays");
            let m = st.meaning(en.id, &self.readings).expect("an entry's meaning");
            assert_eq!(m.attrs, self.attrs(&v["attrs"]), "{what}: attributes");
            assert_eq!(m.admitted, v["admitted"].as_bool().unwrap(), "{what}: let in");
            let cell: BTreeSet<CapId> = m.cell.iter().copied().collect();
            assert_eq!(cell, self.cell_set(&v["semCell"]), "{what}: semantic cell");
            let desired = m.desired.map(|x| x.into_iter().collect::<BTreeSet<CapId>>());
            let want = (!v["desired"].is_null()).then(|| self.cell_set(&v["desired"]));
            assert_eq!(desired, want, "{what}: where a steward moves it");
        }
        same_set(st.all_born().iter().copied(), list(&case["born"]).iter().map(entry), &format!("{name}: born"));
        // the writes, each with the cell its entry was in when it was accepted
        type WriteRow = (EditId, SignerId, VaultId, EntryId, Option<EditId>, u64, Vec<EditId>, Proposal);
        type WriteRest = (Vec<VaultId>, bool, BTreeSet<CapId>);
        let writes: Vec<(WriteRow, WriteRest)> = list(&case["writes"])
            .iter()
            .map(|v| {
                let row = (
                    self.edit(&v["edit"]),
                    signer(&v["author"]),
                    self.vault(&v["actor"]),
                    entry(&v["entry"]),
                    self.opt_edit(&v["stay"]),
                    num(&v["gen"]),
                    self.edits(&v["deps"]),
                    self.proposal(&v["proposal"]),
                );
                (row, (self.via(&v["via"]), v["first"].as_bool().unwrap(), self.cell_set(&v["cell"])))
            })
            .collect();
        let ours: Vec<(WriteRow, WriteRest)> = st
            .all_writes()
            .iter()
            .map(|w| {
                let cell = st.cell_caps(w.cell).expect("a write's cell").iter().copied().collect();
                let row = (w.edit, w.author, w.actor, w.entry, w.stay, w.generation, w.deps.clone(), w.proposal);
                (row, (w.via.clone(), w.first, cell))
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
        // each line of each entry, the main line first: its history and its heads
        type Lines = Vec<(EntryId, Line, Vec<EditId>, Vec<EditId>)>;
        let lines: Lines = list(&case["lines"])
            .iter()
            .map(|v| (entry(&v["entry"]), self.opt_edit(&v["line"]), self.edits(&v["history"]), self.edits(&v["heads"])))
            .collect();
        let ours: Lines = st
            .entries()
            .iter()
            .flat_map(|en| {
                st.lines(en.id).into_iter().map(move |l| {
                    let history = st.history(en.id, l).iter().map(|w| w.edit).collect();
                    (en.id, l, history, st.heads(en.id, l))
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
    let mut linked = 0;
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let mut names = Names::default();
        let mut all = vec![];
        for v in list(&case["edits"]) {
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
        }
        // each passkey that proves itself to a peer holding every edit, to link a new device: the card it is handed
        for l in list(&case["links"]) {
            let card: Vec<EditId> = link_card(&all, signer(&l["passkey"])).iter().map(Edit::id).collect();
            assert_eq!(card, names.edits(&l["card"]), "{name}: the card for passkey {}", l["passkey"]);
            linked += 1;
        }
    }
    assert!(linked >= 5, "the model links passkeys that own vaults and passkeys that own none: {linked}");
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

//! The engine's ops on addressable actors (`crate::address`, Lean `Address.lean` and `Mutation.lean`):
//!
//! - `{"op": "describe", "entry", "version"?}`: the actor's address and interface, read from its own entry alone, the
//!   same on every device that holds it and offline too. With `version`, refused where the entry's interface is
//!   another version.
//! - `{"op": "call", "to": {vault, entry, version}, "method", "args"?, "against"?, "as"?}`: the call admitted by the
//!   actor's interface against the caps the caller (`as`, else the device's vault) holds over the actor's vault, then
//!   its method's op template run with the args bound: a read answered as a read, a write checked inside the method's
//!   footprint first (a template that writes outside it writes nothing) and then made as any change is, judged by the
//!   rules as ever. `against` is the interface version the caller was written for, `to.version` where left out.

use serde_json::{Map, Value, json};

use super::{Prepared, Refused, bad, entry_of, get, prepare, read_op, reads, vault_of};
use crate::address::{self, Address, Call, Interface, Target, Write};
use crate::id::{SignerId, VaultId};
use crate::lab::Lab;
use crate::policy::{Principal, Refusal, Who};
use crate::rules::Cap;
use crate::selector::Attrs;
use crate::slice::Sym;

/// The record of entry `entry` as device `me` reads it, and its vault.
fn record(lab: &Lab, me: SignerId, entry: &str) -> Result<(Value, VaultId), Refused> {
    let mut o = Map::new();
    o.insert("entry".into(), entry.into());
    let got = get(lab, me, &o)?;
    let vault = got["vault"].as_str().and_then(VaultId::from_hex).ok_or(Refused::NoEntry)?;
    Ok((got["record"].clone(), vault))
}

/// The interface an actor's record holds.
fn interface(record: &Value) -> Result<Interface, Refused> {
    Interface::of_record(record)
        .ok_or_else(|| bad("the entry holds no interface: it is no actor"))?
        .map_err(|why| bad(format!("the entry's interface doesn't read: {why}")))
}

pub(super) fn describe(lab: &Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let entry = entry_of(o)?;
    let (record, vault) = record(lab, me, &entry.to_hex())?;
    let i = interface(&record)?;
    if let Some(v) = o.get("version") {
        let v = v.as_u64().ok_or_else(|| bad("version is a number"))?;
        if v != i.version {
            return Err(bad(format!("the actor's interface is version {}, not {v}", i.version)));
        }
    }
    let address = Address { vault, entry, version: i.version };
    Ok(json!({ "address": address.to_json(), "interface": i.to_json(), "title": record.get("title").cloned() }))
}

/// The caps vault `caller` holds over vault `over`, as device `me` reads the shares: `None` for the vault itself and
/// for its owners, who hold every op; else each op of each live share to `caller` or to everyone whose slice `me`
/// reads, over its slice, and each cap of a cap group such a share names, narrowed to the share's slice. The rules
/// judge every write as ever; this is the bound a call is admitted by.
fn caps_of(lab: &Lab, me: SignerId, caller: VaultId, over: VaultId) -> Option<Vec<Cap>> {
    let st = lab.state(me);
    if caller == over || st.vault(over).is_some_and(|v| v.owners.contains(&Principal::Vault(caller))) {
        return None;
    }
    let mut caps = vec![];
    for cp in st.shares_over(over).filter(|cp| st.live(cp.id)) {
        let s = &cp.share;
        if s.who != Who::Vault(caller) && s.who != Who::Everyone {
            continue;
        }
        let Some(slice) = lab.slice(me, cp.id) else { continue };
        match s.group.and_then(|g| lab.group(me, over, g)) {
            Some(group) => {
                caps.extend(group.caps.iter().map(|c| Cap { op: c.op.clone(), slice: c.slice.both(&slice.select) }))
            }
            None => caps.extend(slice.grant.ops.iter().map(|op| Cap { op: op.clone(), slice: slice.select.clone() })),
        }
    }
    Some(caps)
}

/// The writes a bound template makes, each with the labels of the entry it writes: an entry it creates has the type
/// and tags it names, its vault as its author.
fn writes(lab: &Lab, me: SignerId, op: &Value) -> Result<Vec<Write>, Refused> {
    let mut out = vec![];
    for (target, touches, main) in address::touches_of(op).map_err(bad)? {
        let attrs = match target {
            Target::Entry(e) => lab.meaning(me, e).ok_or(Refused::NoEntry)?.attrs,
            Target::New { vault, ty, tags } => Attrs {
                ty: Sym::new(&ty),
                author: vault,
                entry: crate::id::EntryId([0; 32]),
                created: 0,
                tags: tags.iter().map(|t| Sym::new(t)).collect(),
            },
        };
        out.push(Write { attrs, touches, main });
    }
    Ok(out)
}

pub(super) fn call(lab: &mut Lab, me: SignerId, o: &Map<String, Value>) -> Result<Prepared, Refused> {
    let to = Address::of_json(o.get("to").ok_or_else(|| bad("a call names its actor: to"))?).map_err(bad)?;
    let method = o.get("method").and_then(Value::as_str).ok_or_else(|| bad("a call names its method"))?;
    let empty = Map::new();
    let args = match o.get("args") {
        None => &empty,
        Some(v) => v.as_object().ok_or_else(|| bad("args is an object of the method's params"))?,
    };
    let against = match o.get("against") {
        None => to.version,
        Some(v) => v.as_u64().ok_or_else(|| bad("against is the interface version the caller was written for"))?,
    };
    let caller = match o.get("as") {
        Some(_) => vault_of(o, "as")?,
        None => lab.vault_of(me).ok_or(Refusal::NotActing)?,
    };
    let (record, vault) = record(lab, me, &to.entry.to_hex())?;
    if vault != to.vault {
        return Err(Refused::NoEntry);
    }
    let i = interface(&record)?;
    let c = Call { to, method: method.into(), args: args.keys().cloned().collect(), caller, against };
    let caps = caps_of(lab, me, caller, vault);
    let m = i.admit(caps.as_deref(), &c).map_err(Refused::Call)?.clone();
    let Some(run) = &m.run else { return Ok(Prepared::Done(json!({ "admitted": m.name }))) };
    let mut op = address::bind(run, args).map_err(bad)?;
    if reads(&op) {
        return read_op(lab, me, &op).map(Prepared::Done);
    }
    let ws = writes(lab, me, &op)?;
    if m.run(&ws).is_err() {
        return Err(Refused::Call(address::Verdict::OutsideFootprint));
    }
    if let Some(o) = op.as_object_mut() {
        o.insert("as".into(), caller.to_hex().into());
    }
    prepare(lab, me, &op)
}

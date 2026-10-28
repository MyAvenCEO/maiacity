//! What a device keeps of an entry's showing on its shelf, to take again as it opens rather than judge the entry anew
//! (`ShownView.lean`): its history, each change with what the device read of it, the attributes and the places' owners
//! judging left, and the item of each line as a Loro snapshot. Same bytes for the same showing; a showing that doesn't
//! decode whole is none, and its entry is judged anew.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::Arc;

use crate::doc::Item;
use crate::encode::Encode;
use crate::history::{Change, History};
use crate::id::{BlobId, EditId, EntryId, VaultId};
use crate::ops::{Loc, Seg};
use crate::policy::{Line, Mine, Write};
use crate::rules::{Scalar, Touch};
use crate::selector::Attrs;
use crate::slice::Sym;
use crate::wire::{Decode, Reader, WireError};

impl Encode for Seg {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Seg::Field(f) => {
                out.push(0);
                f.encode(out);
            }
            Seg::Row(r) => {
                out.push(1);
                r.encode(out);
            }
        }
    }
}

impl Decode for Seg {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Seg::Field(String::decode(r)?)),
            1 => Ok(Seg::Row(i64::decode(r)?)),
            _ => Err(WireError::Unknown),
        }
    }
}

impl Encode for Loc {
    fn encode(&self, out: &mut Vec<u8>) {
        self.0.encode(out);
    }
}

impl Decode for Loc {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Loc(r.seq(1)?))
    }
}

impl Encode for Touch {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Touch::Set(l, v) => {
                out.push(0);
                l.encode(out);
                v.encode(out);
            }
            Touch::Own(l, v) => {
                out.push(1);
                l.encode(out);
                v.encode(out);
            }
            Touch::Insert(l) => {
                out.push(2);
                l.encode(out);
            }
            Touch::Remove(l) => {
                out.push(3);
                l.encode(out);
            }
            Touch::Move(l) => {
                out.push(4);
                l.encode(out);
            }
            Touch::Create => out.push(5),
            Touch::Tag(t) => {
                out.push(6);
                t.encode(out);
            }
            Touch::Propose => out.push(7),
            Touch::Merge => out.push(8),
            Touch::Merged(l) => {
                out.push(9);
                l.encode(out);
            }
        }
    }
}

impl Decode for Touch {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(match r.u8()? {
            0 => Touch::Set(Loc::decode(r)?, r.option::<Scalar>()?),
            1 => Touch::Own(Loc::decode(r)?, r.option::<Scalar>()?),
            2 => Touch::Insert(Loc::decode(r)?),
            3 => Touch::Remove(Loc::decode(r)?),
            4 => Touch::Move(Loc::decode(r)?),
            5 => Touch::Create,
            6 => Touch::Tag(Sym::decode(r)?),
            7 => Touch::Propose,
            8 => Touch::Merge,
            9 => Touch::Merged(Loc::decode(r)?),
            _ => return Err(WireError::Unknown),
        })
    }
}

impl Encode for Change {
    fn encode(&self, out: &mut Vec<u8>) {
        self.write.encode(out);
        self.body.encode(out);
        self.fits.encode(out);
        match &self.touches {
            None => out.push(0),
            Some(ts) => {
                out.push(1);
                ts.encode(out);
            }
        }
        self.counted.encode(out);
        self.adds.encode(out);
    }
}

impl Decode for Change {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Change {
            write: Write::decode(r)?,
            body: match r.u8()? {
                0 => None,
                1 => Some(Arc::from(r.bytes()?)),
                _ => return Err(WireError::Unknown),
            },
            fits: bool::decode(r)?,
            touches: match r.u8()? {
                0 => None,
                1 => Some(r.seq(1)?),
                _ => return Err(WireError::Unknown),
            },
            counted: bool::decode(r)?,
            adds: r.seq(4)?,
        })
    }
}

impl Encode for History {
    fn encode(&self, out: &mut Vec<u8>) {
        self.changes().encode(out);
    }
}

impl Decode for History {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(History::of_changes(r.seq(1)?))
    }
}

impl Encode for Attrs {
    fn encode(&self, out: &mut Vec<u8>) {
        self.ty.encode(out);
        self.author.encode(out);
        self.entry.encode(out);
        self.created.encode(out);
        self.tags.encode(out);
    }
}

impl Decode for Attrs {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Attrs {
            ty: Sym::decode(r)?,
            author: VaultId::decode(r)?,
            entry: EntryId::decode(r)?,
            created: u64::decode(r)?,
            tags: r.seq(1)?,
        })
    }
}

impl Encode for Mine {
    fn encode(&self, out: &mut Vec<u8>) {
        let (adders, creator) = self.parts();
        // smallest place first, so one showing has one encoding
        let mut adders: Vec<(Vec<u8>, &Vec<VaultId>)> = adders.iter().map(|(l, vs)| {
            let mut b = vec![];
            l.encode(&mut b);
            (b, vs)
        }).collect();
        adders.sort();
        (adders.len() as u32).encode(out);
        for (l, vs) in adders {
            out.extend_from_slice(&l);
            vs.encode(out);
        }
        creator.encode(out);
    }
}

impl Decode for Mine {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        let n = r.count(5)?;
        let mut adders = HashMap::with_capacity(n.min(1024));
        for _ in 0..n {
            let l = Loc::decode(r)?;
            adders.insert(l, r.seq(32)?);
        }
        Ok(Mine::of_parts(adders, r.option()?))
    }
}

/// A line, as `Line` is: the main line, or a proposal's by the edit that started it.
pub(crate) fn put_line(out: &mut Vec<u8>, line: &Line) {
    line.encode(out);
}

pub(crate) fn line_of(r: &mut Reader<'_>) -> Result<Line, WireError> {
    r.option()
}

/// An item as its Loro snapshot and the peer it edits as. None of one with parked changes, which a snapshot leaves out.
pub(crate) fn put_item(out: &mut Vec<u8>, item: &Item) -> Option<()> {
    if item.has_parked_updates() {
        return None;
    }
    item.peer_id().encode(out);
    item.bytes().encode(out);
    Some(())
}

pub(crate) fn item_of(r: &mut Reader<'_>) -> Result<Item, WireError> {
    let peer = u64::decode(r)?;
    Item::kept(&r.bytes()?, peer).ok_or(WireError::Unknown)
}

/// Each line's ids, smallest first.
pub(crate) fn put_imported(out: &mut Vec<u8>, imported: &BTreeMap<Line, HashSet<EditId>>) {
    (imported.len() as u32).encode(out);
    for (line, ids) in imported {
        put_line(out, line);
        let mut ids: Vec<&EditId> = ids.iter().collect();
        ids.sort();
        ids.encode(out);
    }
}

pub(crate) fn imported_of(r: &mut Reader<'_>) -> Result<BTreeMap<Line, HashSet<EditId>>, WireError> {
    let n = r.count(5)?;
    let mut out = BTreeMap::new();
    for _ in 0..n {
        let line = line_of(r)?;
        let ids: Vec<EditId> = r.seq(32)?;
        out.insert(line, ids.into_iter().collect());
    }
    Ok(out)
}

pub(crate) fn put_asked(out: &mut Vec<u8>, asked: &BTreeSet<BlobId>) {
    let asked: Vec<&BlobId> = asked.iter().collect();
    asked.encode(out);
}

pub(crate) fn asked_of(r: &mut Reader<'_>) -> Result<BTreeSet<BlobId>, WireError> {
    Ok(r.seq::<BlobId>(32)?.into_iter().collect())
}

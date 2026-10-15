//! Schemas and the lenses between their versions, as data: a schema is a JSON Schema and a lens a short list of steps,
//! each a blob named by its BLAKE3 hash (`BlobId`). A vault holds them as entries it creates itself, which it shares
//! with everyone, and their contents make its schema lane (`policy::State::lane_of`, T17), so an app learns a newer
//! version's lens from the lane instead of shipping with it. The model is `avendb/spec/AvenDB/Lens.lean` (T9), and
//! `avendb/spec/vectors/lenses.json` holds this engine to it.
//!
//! Nothing is migrated. Each edit is tagged with the schema it was written under (its Loro commit message, see `doc`),
//! and an item is projected on read into the app's schema through the lens (`View::get`): where both versions stored
//! the same thing, the newer version's fields win, and what neither stored shows its schema's default. An edit made on
//! a view, an older app's too, goes back as the difference between the view before and after it (`View::put`): only
//! what changed is written, in the representation the item already uses, so a default is never written and what the
//! app can't see survives. A migrating edit would do neither: two devices migrating at once can drop each other's
//! new containers, and written defaults race real edits.
//!
//! Every reader judges each write by the schemas its entry was written under once the write is in (`Lane::fits`, S1 to
//! S4 in `avendb/spec/AvenDB/Schemas.lean`), and by what it changed alone: a write that doesn't fit counts for no
//! reader, nor anything built on it (`history::History::reading`). So a patched app that writes a value its schema
//! doesn't allow, drops a field it requires, or tags an item with another kind's schema changes no record anyone
//! shows, and every device keeps the last record that fit.
//!
//! Every schema avenDB ships starts at v1, one version of each kind (`blobs::SHIPPED`). The lens engine's worked
//! example, documents and todos in a v0 with a lens from each to v1, is for the tests and the Lean model alone
//! (`example`): no device ships it or reads through it.
//!
//! Records in a list (a document's blocks) are matched by their `id`, which apps pick at random, so that two devices
//! adding records at once don't pick the same one; where they do, apps see the first.
//!
//! A view follows one lens: an item written under the app's schema and at most one other version, joined to it by a
//! lens in the lane. Anything else opens read-only (`Lane::view`); chains of lenses come with a third version.

use std::collections::hash_map::Entry;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::LazyLock;

use serde_json::Value;

use crate::id::BlobId;
use crate::ops::{self, Change, Flat, Key, Path, Record};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TypeV1 {
    Heading,
    Paragraph,
    Item,
    Code,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlockV1 {
    pub id: u64,
    pub r#type: TypeV1,
    pub level: Option<u64>,
    pub checked: Option<bool>,
    pub lang: Option<String>,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DocV1 {
    pub title: String,
    pub blocks: Vec<BlockV1>,
    pub tags: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Open,
    Doing,
    Done,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TodoV1 {
    pub title: String,
    pub status: Status,
    pub notes: String,
    pub due: Option<String>,
}

/// Each value as the schemas name it.
const TYPES: [(TypeV1, &str); 4] =
    [(TypeV1::Heading, "heading"), (TypeV1::Paragraph, "paragraph"), (TypeV1::Item, "item"), (TypeV1::Code, "code")];
const STATUSES: [(Status, &str); 3] = [(Status::Open, "open"), (Status::Doing, "doing"), (Status::Done, "done")];

fn name<T: PartialEq>(table: &[(T, &'static str)], value: T) -> &'static str {
    table.iter().find(|(v, _)| *v == value).map(|(_, n)| *n).expect("every value has a name")
}

fn named<T: Copy>(table: &[(T, &'static str)], name: &str) -> Option<T> {
    table.iter().find(|(_, n)| *n == name).map(|(v, _)| *v)
}

/// The field `k` of `r`, unless it is absent or `null`.
fn present<'a>(r: &'a Record, k: &str) -> Option<&'a Value> {
    r.get(k).filter(|v| !v.is_null())
}

fn object(pairs: impl IntoIterator<Item = (&'static str, Option<Value>)>) -> Value {
    Value::Object(pairs.into_iter().filter_map(|(k, v)| Some((k.to_string(), v?))).collect())
}

fn text(r: &Record, k: &str) -> Option<String> {
    Some(present(r, k)?.as_str()?.to_string())
}

/// Ids are 64 bits, stored as Loro's integers (an i64 with the same bits).
fn id_value(id: u64) -> Value {
    Value::from(id as i64)
}

fn id_of(r: &Record) -> Option<u64> {
    Some(present(r, "id")?.as_i64()? as u64)
}

impl BlockV1 {
    pub fn to_value(&self) -> Value {
        object([
            ("id", Some(id_value(self.id))),
            ("type", Some(name(&TYPES, self.r#type).into())),
            ("level", self.level.map(Value::from)),
            ("checked", self.checked.map(Value::from)),
            ("lang", self.lang.clone().map(Value::from)),
            ("text", Some(self.text.clone().into())),
        ])
    }

    pub fn from_value(v: &Value) -> Option<BlockV1> {
        let r = v.as_object()?;
        Some(BlockV1 {
            id: id_of(r)?,
            r#type: named(&TYPES, present(r, "type")?.as_str()?)?,
            level: present(r, "level").and_then(Value::as_u64),
            checked: present(r, "checked").and_then(Value::as_bool),
            lang: text(r, "lang"),
            text: text(r, "text")?,
        })
    }
}

impl DocV1 {
    pub fn to_value(&self) -> Value {
        object([
            ("kind", Some("document".into())),
            ("title", Some(self.title.clone().into())),
            ("blocks", Some(self.blocks.iter().map(BlockV1::to_value).collect())),
            ("tags", Some(self.tags.iter().cloned().map(Value::from).collect())),
        ])
    }

    pub fn from_value(v: &Value) -> Option<DocV1> {
        let r = v.as_object()?;
        let blocks = present(r, "blocks")?.as_array()?.iter().map(BlockV1::from_value).collect::<Option<_>>()?;
        let tags = present(r, "tags")?.as_array()?.iter().map(|t| Some(t.as_str()?.to_string())).collect::<Option<_>>()?;
        Some(DocV1 { title: text(r, "title")?, blocks, tags })
    }
}

impl TodoV1 {
    pub fn to_value(&self) -> Value {
        object([
            ("kind", Some("todo".into())),
            ("title", Some(self.title.clone().into())),
            ("status", Some(name(&STATUSES, self.status).into())),
            ("notes", Some(self.notes.clone().into())),
            ("due", self.due.clone().map(Value::from)),
        ])
    }

    pub fn from_value(v: &Value) -> Option<TodoV1> {
        let r = v.as_object()?;
        Some(TodoV1 {
            title: text(r, "title")?,
            status: named(&STATUSES, present(r, "status")?.as_str()?)?,
            notes: text(r, "notes")?,
            due: text(r, "due"),
        })
    }
}

/// A schema: one version of an item's shape, as a JSON Schema, named by the hash of its bytes.
///
/// The subset it reads: an object's `properties` and `required`; each property a `const`, an `enum`, or a `type` of
/// string (with a `maxLength`), integer or number (with a `minimum` and a `maximum`; a number is any finite one),
/// boolean, object or array; a `default` where a field may be absent. An array's `items` are values (a list, with
/// `minItems` and `maxItems`) or records (objects with a required integer `id`, which edits match them by); an array
/// of `prefixItems` is a tuple of so many values (a position `[x, y, z]`). An object (a property whose type is object,
/// or an array's items that are objects with no integer `id`, or anything inside a record's row) is one value, checked
/// by its own `properties`, `required` and `additionalProperties: false`, nested to any depth. `$ref` names a shape of
/// the schema's `$defs`. `"x-loro": "text"` marks free text, which an item stores as a Loro text so concurrent edits
/// merge character by character; a list of values is a Loro list, merged item by item; everything else is one value,
/// where concurrent edits keep one of them. Other keywords are annotations and change nothing.
#[derive(Clone, Debug)]
pub struct Schema {
    id: BlobId,
    bytes: Vec<u8>,
    title: String,
    root: Shape,
}

/// The fields of one record.
#[derive(Clone, Debug, Default)]
struct Shape {
    fields: Vec<Field>,
    required: Vec<String>,
}

#[derive(Clone, Debug)]
struct Field {
    name: String,
    ty: Type,
    default: Option<Value>,
}

/// What a field holds, and so how an item stores it.
#[derive(Clone, Debug)]
enum Type {
    /// Free text: a Loro text.
    Text,
    /// One value.
    Value(Check),
    /// A list of values.
    List(Check),
    /// A movable list of records, each a map with its `id`.
    Records(Shape),
}

/// Which values a field takes.
#[derive(Clone, Debug)]
enum Check {
    String { max_length: Option<usize> },
    Integer { minimum: Option<i64>, maximum: Option<i64> },
    Number { minimum: Option<f64>, maximum: Option<f64> },
    Boolean,
    OneOf(Vec<Value>),
    /// An array of values, one value.
    Array { items: Box<Check>, min: usize, max: Option<usize> },
    /// A tuple: so many values, each its own.
    Tuple(Vec<Check>),
    /// An object, one value: its fields' checks, which it must have, and whether it may have others.
    Object { fields: Vec<(String, Check)>, required: Vec<String>, closed: bool },
}

/// How an item stores a field.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stored {
    Text,
    Value,
    List,
    Records,
}

/// A schema's `$defs`, which a `$ref` names, and how many `$ref`s deep a shape is: a schema whose `$ref`s go round in a
/// circle is not one.
#[derive(Clone, Copy)]
struct Defs<'a> {
    defs: Option<&'a serde_json::Map<String, Value>>,
    depth: u8,
}

impl<'a> Defs<'a> {
    const DEPTH: u8 = 32;

    fn of(root: &'a Value) -> Defs<'a> {
        Defs { defs: root.get("$defs").and_then(Value::as_object), depth: 0 }
    }

    /// `p`, or the shape its `$ref` names, and these defs one step deeper.
    fn resolve(self, p: &'a Value) -> Option<(&'a Value, Defs<'a>)> {
        let deeper = Defs { depth: self.depth.checked_add(1).filter(|d| *d <= Self::DEPTH)?, ..self };
        match p.get("$ref") {
            None => Some((p, deeper)),
            Some(r) => {
                let name = r.as_str()?.strip_prefix("#/$defs/")?;
                deeper.resolve(self.defs?.get(name)?)
            }
        }
    }
}

/// The record objects in an array's `items`, if they make one: objects with a required integer `id`.
fn records_of(items: &Value) -> bool {
    let id_integer = items.get("properties").and_then(|ps| ps.get("id")).and_then(|id| id.get("type")).and_then(Value::as_str)
        == Some("integer");
    let required = items.get("required").and_then(Value::as_array).is_some_and(|r| r.iter().any(|x| x == "id"));
    items.get("type").and_then(Value::as_str) == Some("object") && id_integer && required
}

impl Check {
    fn of(p: &Value, defs: Defs) -> Option<Check> {
        let (p, defs) = defs.resolve(p)?;
        if let Some(c) = p.get("const") {
            return Some(Check::OneOf(vec![c.clone()]));
        }
        if let Some(e) = p.get("enum") {
            return Some(Check::OneOf(e.as_array()?.clone()));
        }
        let int = |k: &str| p.get(k).and_then(Value::as_i64);
        let count = |k: &str| p.get(k).and_then(Value::as_u64).map(|n| n as usize);
        let num = |k: &str| p.get(k).and_then(Value::as_f64);
        match p.get("type")?.as_str()? {
            "string" => Some(Check::String { max_length: count("maxLength") }),
            "integer" => Some(Check::Integer { minimum: int("minimum"), maximum: int("maximum") }),
            "number" => Some(Check::Number { minimum: num("minimum"), maximum: num("maximum") }),
            "boolean" => Some(Check::Boolean),
            "array" => match p.get("prefixItems") {
                Some(t) => Some(Check::Tuple(t.as_array()?.iter().map(|x| Check::of(x, defs)).collect::<Option<_>>()?)),
                None => {
                    let items = Box::new(Check::of(p.get("items")?, defs)?);
                    Some(Check::Array { items, min: count("minItems").unwrap_or(0), max: count("maxItems") })
                }
            },
            "object" => {
                let fields = match p.get("properties") {
                    None => vec![],
                    Some(ps) => ps
                        .as_object()?
                        .iter()
                        .map(|(k, x)| Some((k.clone(), Check::of(x, defs)?)))
                        .collect::<Option<_>>()?,
                };
                let required = match p.get("required") {
                    None => vec![],
                    Some(r) => r.as_array()?.iter().map(|x| Some(x.as_str()?.to_string())).collect::<Option<_>>()?,
                };
                let closed = p.get("additionalProperties") == Some(&Value::Bool(false));
                Some(Check::Object { fields, required, closed })
            }
            _ => None,
        }
    }

    fn holds(&self, v: &Value) -> bool {
        match self {
            Check::String { max_length } => {
                v.as_str().is_some_and(|s| max_length.is_none_or(|m| s.chars().count() <= m))
            }
            Check::Integer { minimum, maximum } => {
                v.as_i64().is_some_and(|n| minimum.is_none_or(|m| n >= m) && maximum.is_none_or(|m| n <= m))
            }
            Check::Number { minimum, maximum } => v
                .as_f64()
                .is_some_and(|n| n.is_finite() && minimum.is_none_or(|m| n >= m) && maximum.is_none_or(|m| n <= m)),
            Check::Boolean => v.is_boolean(),
            Check::OneOf(vs) => vs.contains(v),
            Check::Array { items, min, max } => v
                .as_array()
                .is_some_and(|xs| xs.len() >= *min && max.is_none_or(|m| xs.len() <= m) && xs.iter().all(|x| items.holds(x))),
            Check::Tuple(cs) => {
                v.as_array().is_some_and(|xs| xs.len() == cs.len() && xs.iter().zip(cs).all(|(x, c)| c.holds(x)))
            }
            Check::Object { fields, required, closed } => v.as_object().is_some_and(|o| {
                let known = |k: &String| fields.iter().any(|(f, _)| f == k);
                required.iter().all(|r| present(o, r).is_some())
                    && fields.iter().all(|(f, c)| present(o, f).is_none_or(|x| c.holds(x)))
                    && (!closed || o.keys().all(known))
            }),
        }
    }
}

impl Type {
    /// A property of a schema; `nested` for the fields of a list's records, which hold no records themselves: a list
    /// of records in a row is kept for records inside records, which will merge row by row at every depth, so no
    /// schema stores one as one value meanwhile.
    fn of(p: &Value, nested: bool, defs: Defs) -> Option<Type> {
        let (p, defs) = defs.resolve(p)?;
        if p.get("type").and_then(Value::as_str) == Some("array") && p.get("prefixItems").is_none() {
            let (items, deeper) = defs.resolve(p.get("items")?)?;
            if records_of(items) {
                // records are matched by their id
                return (!nested).then(|| Some(Type::Records(Shape::of(items, true, deeper)?))).flatten();
            }
            if items.get("type").and_then(Value::as_str) != Some("object") {
                let bounded = p.get("minItems").is_some() || p.get("maxItems").is_some();
                if !bounded {
                    return Some(Type::List(Check::of(items, deeper)?));
                }
            }
            // objects that are no records, or a list with bounds: one value
            return Some(Type::Value(Check::of(p, defs)?));
        }
        let string = p.get("type").and_then(Value::as_str) == Some("string");
        if string && p.get("x-loro").and_then(Value::as_str) == Some("text") {
            return Some(Type::Text);
        }
        Some(Type::Value(Check::of(p, defs)?))
    }

    /// The value an app sees for what is stored: the value if it fits, a list's values that fit, a list's records that
    /// read and whose id no record before them in the list has.
    fn read(&self, v: &Value) -> Option<Value> {
        match self {
            Type::Text => v.is_string().then(|| v.clone()),
            Type::Value(c) => c.holds(v).then(|| v.clone()),
            Type::List(c) => Some(v.as_array()?.iter().filter(|x| c.holds(x)).cloned().collect()),
            Type::Records(shape) => {
                let mut ids = HashSet::new();
                let records = v.as_array()?.iter().filter_map(|x| {
                    let r = x.as_object()?;
                    let first = present(r, "id").is_some_and(|id| ids.insert(id.clone()));
                    first.then(|| shape.read(r)).flatten().map(Value::Object)
                });
                Some(records.collect())
            }
        }
    }

    fn stored(&self) -> Stored {
        match self {
            Type::Text => Stored::Text,
            Type::Value(_) => Stored::Value,
            Type::List(_) => Stored::List,
            Type::Records(_) => Stored::Records,
        }
    }

    /// Whether `v` fits here as one value: a text, a value the check holds, a list of values each of which it holds. A
    /// list of records holds rows, never one value.
    fn fits(&self, v: &Value) -> bool {
        match self {
            Type::Text => v.is_string(),
            Type::Value(c) => c.holds(v),
            Type::List(c) => v.as_array().is_some_and(|xs| xs.iter().all(|x| c.holds(x))),
            Type::Records(_) => false,
        }
    }
}

impl Shape {
    fn of(v: &Value, nested: bool, defs: Defs) -> Option<Shape> {
        if v.get("type")?.as_str()? != "object" {
            return None;
        }
        let fields = v.get("properties")?.as_object()?.iter().map(|(name, p)| {
            Some(Field { name: name.clone(), ty: Type::of(p, nested, defs)?, default: p.get("default").cloned() })
        });
        let required = match v.get("required") {
            None => vec![],
            Some(r) => r.as_array()?.iter().map(|x| Some(x.as_str()?.to_string())).collect::<Option<_>>()?,
        };
        Some(Shape { fields: fields.collect::<Option<_>>()?, required })
    }

    fn field(&self, name: &str) -> Option<&Field> {
        self.fields.iter().find(|f| f.name == name)
    }

    fn records(&self, name: &str) -> Option<&Shape> {
        match &self.field(name)?.ty {
            Type::Records(shape) => Some(shape),
            _ => None,
        }
    }

    /// Each field as an app on this schema sees it: the stored value if it fits, else the field's default; a field
    /// with neither is left out.
    fn seen(&self, r: &Record) -> Record {
        let mut out = Record::new();
        for f in &self.fields {
            if let Some(v) = present(r, &f.name).and_then(|v| f.ty.read(v)).or_else(|| f.default.clone()) {
                out.insert(f.name.clone(), v);
            }
        }
        out
    }

    /// The record as an app on this schema sees it, if it has every required field.
    fn read(&self, r: &Record) -> Option<Record> {
        let seen = self.seen(r);
        self.required.iter().all(|f| seen.contains_key(f)).then_some(seen)
    }
}

impl Schema {
    /// A schema blob, if it is a JSON Schema of the subset above.
    pub fn parse(bytes: &[u8]) -> Option<Schema> {
        let v: Value = serde_json::from_slice(bytes).ok()?;
        let root = Shape::of(&v, false, Defs::of(&v))?;
        let title = v.get("title").and_then(Value::as_str).unwrap_or_default().to_string();
        Some(Schema { id: BlobId::of(bytes), bytes: bytes.to_vec(), title, root })
    }

    pub fn id(&self) -> BlobId {
        self.id
    }

    /// The blob, as a lane holds it: the content of a schema or lens entry.
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn title(&self) -> &str {
        &self.title
    }

    /// The kind its records name, where its `kind` field is a constant: `"document"`, `"todo"`.
    pub fn kind(&self) -> Option<&str> {
        match &self.root.field("kind")?.ty {
            Type::Value(Check::OneOf(vs)) if vs.len() == 1 => vs[0].as_str(),
            _ => None,
        }
    }

    /// A record as an app on this schema sees it, with no lens: each field it names that fits, else the field's
    /// default. `None` if it lacks a field the schema requires.
    pub fn read(&self, r: &Value) -> Option<Value> {
        Some(Value::Object(self.root.read(r.as_object()?)?))
    }

    /// How an item stores field `field`, of each record of the list `list` if given.
    fn stored(&self, list: Option<&str>, field: &str) -> Option<Stored> {
        let shape = match list {
            None => &self.root,
            Some(l) => self.root.records(l)?,
        };
        Some(shape.field(field)?.ty.stored())
    }
}

/// A lens between two versions of a schema: the steps that read a record of one version in the other.
#[derive(Clone, Debug)]
pub struct Lens {
    id: BlobId,
    bytes: Vec<u8>,
    title: String,
    from: BlobId,
    to: BlobId,
    steps: Vec<Step>,
}

#[derive(Clone, Debug)]
enum Step {
    /// The older version's fields `older` and the newer's `newer` hold the same thing. `forward` turns older values
    /// into newer ones and `backward` newer into older: rows of (when, then), the first row whose `when` fields all
    /// hold winning, a field `when` doesn't name matching anything.
    Convert { older: Vec<String>, newer: Vec<String>, forward: Vec<Row>, backward: Vec<Row> },
    /// A field only the newer version has.
    Add(String),
    /// Steps for each record of a list.
    In(String, Vec<Step>),
}

#[derive(Clone, Debug)]
struct Row {
    when: Record,
    then: Record,
}

/// Which end of a lens an app is at.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Older,
    Newer,
}

impl Step {
    fn of(v: &Value) -> Option<Step> {
        let (kind, x) = v.as_object().filter(|o| o.len() == 1)?.iter().next()?;
        let names = |v: &Value| v.as_array()?.iter().map(|f| Some(f.as_str()?.to_string())).collect::<Option<Vec<_>>>();
        let rows = |v: &Value| {
            let row = |r: &Value| match r.as_array()?.as_slice() {
                [when, then] => Some(Row { when: when.as_object()?.clone(), then: then.as_object()?.clone() }),
                _ => None,
            };
            v.as_array()?.iter().map(row).collect::<Option<Vec<_>>>()
        };
        match kind.as_str() {
            "convert" => Some(Step::Convert {
                older: names(x.get("from")?)?,
                newer: names(x.get("to")?)?,
                forward: rows(x.get("forward")?)?,
                backward: rows(x.get("backward")?)?,
            }),
            "add" => Some(Step::Add(x.as_str()?.to_string())),
            "in" => Some(Step::In(x.get("field")?.as_str()?.to_string(), steps(x.get("steps")?)?)),
            _ => None,
        }
    }

    /// The fields this step speaks for.
    fn fields(&self) -> Vec<&str> {
        match self {
            Step::Convert { older, newer, .. } => older.iter().chain(newer).map(String::as_str).collect(),
            Step::Add(f) | Step::In(f, _) => vec![f],
        }
    }
}

fn steps(v: &Value) -> Option<Vec<Step>> {
    v.as_array()?.iter().map(Step::of).collect()
}

/// The first row whose `when` holds in `r`.
fn first<'a>(rows: &'a [Row], r: &Record) -> Option<&'a Row> {
    rows.iter().find(|row| row.when.iter().all(|(k, v)| present(r, k) == Some(v)))
}

fn remove(r: &mut Record, fields: &[String]) {
    for f in fields {
        r.remove(f);
    }
}

/// Set each of `fields` in `r` to its value in `from`, removing those `from` doesn't have.
fn set_all(r: &mut Record, fields: &[String], from: &Record) {
    for f in fields {
        set(r, f, present(from, f));
    }
}

fn set(r: &mut Record, f: &str, v: Option<&Value>) {
    match v {
        Some(v) => r.insert(f.to_string(), v.clone()),
        None => r.remove(f),
    };
}

/// `r` in the version at `side` of `steps`: each thing both versions hold from the newer version's fields where any is
/// stored (they were written last), else from the older's; the other version's fields left out.
fn translate(steps: &[Step], side: Side, r: &Record) -> Record {
    let mut out = r.clone();
    for s in steps {
        match s {
            Step::Convert { older, newer, forward, backward } => {
                let newer_stored = newer.iter().any(|f| present(r, f).is_some());
                match (side, newer_stored) {
                    (Side::Newer, true) => remove(&mut out, older),
                    (Side::Newer, false) => {
                        remove(&mut out, older);
                        if let Some(row) = first(forward, r) {
                            out.extend(row.then.clone());
                        }
                    }
                    (Side::Older, true) => {
                        remove(&mut out, older);
                        remove(&mut out, newer);
                        if let Some(row) = first(backward, r) {
                            out.extend(row.then.clone());
                        }
                    }
                    (Side::Older, false) => {}
                }
            }
            Step::Add(f) => {
                if side == Side::Older {
                    out.remove(f);
                }
            }
            Step::In(f, inner) => {
                if let Some(list) = present(r, f).and_then(Value::as_array) {
                    let each = |e: &Value| match e.as_object() {
                        Some(m) => Value::Object(translate(inner, side, m)),
                        None => e.clone(),
                    };
                    out.insert(f.clone(), list.iter().map(each).collect());
                }
            }
        }
    }
    out
}

/// The stored record after an app on `shape`, at `side` of `steps`, edits its view of `r` into `n`: each field whose
/// view changed is written in the representation the record already holds it in, and nothing else is.
fn put(shape: &Shape, steps: &[Step], side: Side, r: &Record, n: &Record) -> Record {
    let seen = shape.seen(&translate(steps, side, r));
    let changed = |f: &str| present(n, f) != seen.get(f);
    let mut out = r.clone();
    for s in steps {
        match s {
            Step::Convert { older, newer, forward, .. } => {
                let mine = if side == Side::Newer { newer } else { older };
                if !mine.iter().any(|f| changed(f)) {
                    continue;
                }
                match side {
                    // the newer version's fields now hold it
                    Side::Newer => {
                        set_all(&mut out, newer, n);
                        remove(&mut out, older);
                    }
                    // an older app writes where the item holds it: in the newer version's fields once any is stored
                    Side::Older => match first(forward, n).filter(|_| newer.iter().any(|f| present(r, f).is_some())) {
                        Some(row) => {
                            remove(&mut out, newer);
                            out.extend(row.then.clone());
                        }
                        None => {
                            set_all(&mut out, older, n);
                            remove(&mut out, newer);
                        }
                    },
                }
            }
            Step::Add(f) => {
                if side == Side::Newer && changed(f) {
                    set(&mut out, f, present(n, f));
                }
            }
            Step::In(f, inner) => {
                if let Some(records) = shape.records(f)
                    && changed(f)
                {
                    let list = |x: Option<&Value>| x.and_then(Value::as_array).cloned().unwrap_or_default();
                    let stored = list(present(r, f));
                    let new = put_list(records, inner, side, &stored, &list(seen.get(f)), &list(present(n, f)));
                    out.insert(f.clone(), new.into());
                }
            }
        }
    }
    let spoken_for: HashSet<&str> = steps.iter().flat_map(Step::fields).collect();
    for f in shape.fields.iter().filter(|f| !spoken_for.contains(f.name.as_str())) {
        if f.ty.stored() == Stored::Records && changed(&f.name) {
            let list = |x: Option<&Value>| x.and_then(Value::as_array).cloned().unwrap_or_default();
            let records = shape.records(&f.name).expect("a list of records");
            let (stored, seen, new) = (list(present(r, &f.name)), list(seen.get(&f.name)), list(present(n, &f.name)));
            let new = put_list(records, &[], side, &stored, &seen, &new);
            out.insert(f.name.clone(), new.into());
        } else if changed(&f.name) {
            set(&mut out, &f.name, present(n, &f.name));
        }
    }
    out
}

/// A list of records after an app edits the records it saw, `seen`, into `new`. A record matches the stored record with
/// its id: records the app saw and dropped are deleted, the others edited in place (`put`) and put in the app's order,
/// new ones added. Records the app didn't see stay as they are, each after the record it followed, or at the start.
/// Where several records have one id (two devices added one each at once), apps see the first; the others, its copies,
/// go wherever it goes, so it stays the one apps see, and are deleted with it.
fn put_list(shape: &Shape, steps: &[Step], side: Side, stored: &[Value], seen: &[Value], new: &[Value]) -> Vec<Value> {
    let id = |v: &Value| v.as_object().and_then(|r| present(r, "id")).cloned();
    let visible: HashSet<Value> = seen.iter().filter_map(id).collect();
    let wanted: HashSet<Value> = new.iter().filter_map(id).collect();
    let mut first: HashMap<Value, usize> = HashMap::new();
    let mut copies: HashMap<Value, Vec<Value>> = HashMap::new();
    for (i, e) in stored.iter().enumerate() {
        if let Some(x) = id(e) {
            match first.entry(x) {
                Entry::Occupied(o) => copies.entry(o.key().clone()).or_default().push(e.clone()),
                Entry::Vacant(v) => drop(v.insert(i)),
            }
        }
    }
    // records the app didn't see, after the last record before them that it keeps
    let mut lead = vec![];
    let mut after: HashMap<Value, Vec<Value>> = HashMap::new();
    let mut anchor: Option<Value> = None;
    for (i, e) in stored.iter().enumerate() {
        let x = id(e);
        match &x {
            Some(x) if first[x] != i => {}
            Some(x) if visible.contains(x) => {
                if wanted.contains(x) {
                    anchor = Some(x.clone());
                }
            }
            // unseen, but the app wrote a record with its id: edited in place
            Some(x) if wanted.contains(x) => {}
            _ => {
                let its_copies = x.as_ref().and_then(|x| copies.remove(x)).unwrap_or_default();
                let kept = std::iter::once(e.clone()).chain(its_copies);
                match &anchor {
                    None => lead.extend(kept),
                    Some(a) => after.entry(a.clone()).or_default().extend(kept),
                }
            }
        }
    }
    let empty = Record::new();
    let mut out = lead;
    for e in new {
        let n = e.as_object().expect("a record of a view");
        let x = id(e).expect("a record of a view has an id");
        let base = first.get(&x).and_then(|&i| stored[i].as_object()).unwrap_or(&empty);
        out.push(Value::Object(put(shape, steps, side, base, n)));
        out.extend(copies.remove(&x).unwrap_or_default());
        out.extend(after.remove(&x).unwrap_or_default());
    }
    out
}

impl Lens {
    /// A lens blob: `{"lens": title, "from": schema id, "to": schema id, "steps": [...]}`, each step one of
    /// `{"convert": {"from": [fields], "to": [fields], "forward": [[when, then], ...], "backward": [...]}}`,
    /// `{"add": field}` and `{"in": {"field": list, "steps": [...]}}`.
    pub fn parse(bytes: &[u8]) -> Option<Lens> {
        let v: Value = serde_json::from_slice(bytes).ok()?;
        Some(Lens {
            id: BlobId::of(bytes),
            bytes: bytes.to_vec(),
            title: v.get("lens")?.as_str()?.to_string(),
            from: BlobId::from_hex(v.get("from")?.as_str()?)?,
            to: BlobId::from_hex(v.get("to")?.as_str()?)?,
            steps: steps(v.get("steps")?)?,
        })
    }

    pub fn id(&self) -> BlobId {
        self.id
    }

    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn title(&self) -> &str {
        &self.title
    }

    /// The older schema's id.
    pub fn from(&self) -> BlobId {
        self.from
    }

    /// The newer schema's id.
    pub fn to(&self) -> BlobId {
        self.to
    }
}

/// How an app reads and edits items: in its own schema, through a lens to the one other version the item was written
/// under, if any.
#[derive(Clone, Debug)]
pub struct View {
    app: Schema,
    /// The lens, the app's side of it, and the schema at the other side.
    lens: Option<(Lens, Side, Schema)>,
}

impl View {
    /// An app reading what its own schema wrote.
    pub fn plain(app: &Schema) -> View {
        View { app: app.clone(), lens: None }
    }

    /// An app on `app` reading through `lens`, whose other end is `other`: `None` if the lens doesn't join the two.
    pub fn through(app: &Schema, lens: &Lens, other: &Schema) -> Option<View> {
        let side = match (lens.from, lens.to) {
            (f, t) if (f, t) == (app.id, other.id) => Side::Older,
            (f, t) if (f, t) == (other.id, app.id) => Side::Newer,
            _ => return None,
        };
        Some(View { app: app.clone(), lens: Some((lens.clone(), side, other.clone())) })
    }

    /// The schema the app reads and writes in: what its edits are tagged with.
    pub fn schema(&self) -> &Schema {
        &self.app
    }

    fn steps(&self) -> (&[Step], Side) {
        match &self.lens {
            Some((lens, side, _)) => (&lens.steps, *side),
            None => (&[], Side::Newer),
        }
    }

    /// The stored record as the app sees it, projected through the lens: `None` if it lacks a field the app's schema
    /// requires (another kind of item, or nothing stored yet).
    pub fn get(&self, stored: &Value) -> Option<Value> {
        let (steps, side) = self.steps();
        Some(Value::Object(self.app.root.read(&translate(steps, side, stored.as_object()?))?))
    }

    /// The stored record after the app edits its view of `stored` into `new`: `None` if `new` isn't a view of the app's
    /// schema (a value that doesn't fit, a missing field, two records with one id). Putting back the view unchanged
    /// gives `stored` unchanged; reading the result gives `new`; and what the app can't see is left as it was, but for
    /// the hidden copies of a record it deletes.
    pub fn put(&self, stored: &Value, new: &Value) -> Option<Value> {
        let empty = Record::new();
        let r = stored.as_object().unwrap_or(&empty);
        let n = new.as_object()?;
        if self.app.root.read(n).as_ref() != Some(n) {
            return None;
        }
        let (steps, side) = self.steps();
        Some(Value::Object(put(&self.app.root, steps, side, r, n)))
    }

    /// How an item stores field `field` (of each record of `list`), by the app's schema or else the other one.
    pub fn stored(&self, list: Option<&str>, field: &str) -> Option<Stored> {
        let other = self.lens.as_ref().and_then(|(_, _, other)| other.stored(list, field));
        self.app.stored(list, field).or(other)
    }

    /// The markdown app, of the shipped document schema alone.
    pub fn document_v1() -> &'static View {
        View::built_in("document").expect("a built-in document app")
    }

    /// The todo app, of the shipped todo schema alone.
    pub fn todo_v1() -> &'static View {
        View::built_in("todo").expect("a built-in todo app")
    }

    /// The app of built-in kind `kind`, of its one shipped schema alone (`blobs::SHIPPED`): a document's, a todo's, an
    /// article's, a flow's, a function's, a post's, a card's, a profile's, a file's or a story's.
    pub fn built_in(kind: &str) -> Option<&'static View> {
        BUILT_IN.iter().find(|(k, _)| *k == kind).map(|(_, v)| v)
    }
}

/// The schemas and lenses a device holds from a vault's lane.
#[derive(Clone, Debug, Default)]
pub struct Lane {
    schemas: BTreeMap<BlobId, Schema>,
    lenses: BTreeMap<BlobId, Lens>,
}

impl Lane {
    /// The lane of these blobs: each a schema or a lens; any other blob is kept by the rules but means nothing here.
    pub fn new<'a>(blobs: impl IntoIterator<Item = &'a [u8]>) -> Lane {
        let mut lane = Lane::default();
        for b in blobs {
            if let Some(l) = Lens::parse(b) {
                lane.lenses.insert(l.id, l);
            } else if let Some(s) = Schema::parse(b) {
                lane.schemas.insert(s.id, s);
            }
        }
        lane
    }

    /// The lane of the blobs `lane` and of the shipped schemas, which apps read through before a vault creates any
    /// schema or lens (`blobs::SHIPPED`): what a device reads and judges a vault's entries by.
    pub fn with_built_ins<'a>(lane: impl IntoIterator<Item = &'a [u8]>) -> Lane {
        Lane::new(blobs::SHIPPED.iter().map(|b| b.as_bytes()).chain(lane))
    }

    pub fn schema(&self, id: BlobId) -> Option<&Schema> {
        self.schemas.get(&id)
    }

    pub fn schemas(&self) -> impl Iterator<Item = &Schema> {
        self.schemas.values()
    }

    pub fn lenses(&self) -> impl Iterator<Item = &Lens> {
        self.lenses.values()
    }

    /// How an app on `app` opens an item written under the schemas `authored`, and whether only read-only. It reads
    /// through the lens joining `app` to the one other schema the item was written under; where the lane holds several,
    /// every device takes the one with the smallest id. Read-only when the item was written under more than one other
    /// schema, or under one the lane holds no lens or no schema for: then it shows what it can.
    pub fn view(&self, app: &Schema, authored: &BTreeSet<BlobId>) -> (View, bool) {
        let joined = |x: BlobId| {
            let other = self.schemas.get(&x)?;
            self.lenses.values().find_map(|l| View::through(app, l, other))
        };
        let others: Vec<BlobId> = authored.iter().copied().filter(|&s| s != app.id).collect();
        match others.as_slice() {
            [] => (View::plain(app), false),
            [x] => match joined(*x) {
                Some(v) => (v, false),
                None => (View::plain(app), true),
            },
            xs => (xs.iter().find_map(|&x| joined(x)).unwrap_or_else(|| View::plain(app)), true),
        }
    }

    /// Whether a write that makes the stored record `before` into `after` fits the schemas `authored` names, those its
    /// entry was written under once it is in (`Schemas.lean`'s `Fit.fits`): each in the lane, and all of one kind, so
    /// that no write tags an item with another kind's schema to write that kind's fields into it. Only what it changed
    /// is judged (S1): each place it changed holds a value one of them lets it hold there; each list of records it
    /// changed is one they name, holding no copy of a row it didn't hold before; each row it added, or one of whose
    /// own fields it changed or whose lists it added or dropped, reads under one of them (the innermost row around
    /// each change, by its own fields); and the record's own fields read under one of them where it changed one of
    /// them, or added or dropped a list. A write that changes nothing fits.
    pub fn fits(&self, authored: &BTreeSet<BlobId>, before: &Value, after: &Value) -> bool {
        let empty = Record::new();
        let (before, after) = (before.as_object().unwrap_or(&empty), after.as_object().unwrap_or(&empty));
        let (r, s) = (Flat::of(before), Flat::of(after));
        let changes = r.diff(&s);
        if changes.is_empty() {
            return true;
        }
        let Some(under) = authored.iter().map(|id| self.schemas.get(id)).collect::<Option<Vec<_>>>() else {
            return false;
        };
        if under.windows(2).any(|w| w[0].kind() != w[1].kind()) {
            return false;
        }
        let fit = Fit(under);
        let top = std::cell::OnceCell::new();
        let top = || *top.get_or_init(|| fit.top(after));
        let row = |f: &Path, k: &Key| fit.row(f, &s.own(f, k));
        // the innermost row around a place reads, where the record after still holds it; the record's own fields, where
        // no row is around it
        let scoped = |p: &Path| match p.scope() {
            None => top(),
            Some((f, k)) => !s.holds(&f, &k) || row(&f, &k),
        };
        changes.iter().all(|c| match c {
            Change::Set(p, v) => v.as_ref().is_none_or(|v| fit.leaf(p, v)) && scoped(p),
            Change::Order(f, None) => scoped(f),
            Change::Order(f, Some(ks)) => {
                let old = r.lists.get(f);
                fit.rows(f, old, ks) && (old.is_some() || scoped(f)) && ks.iter().all(|k| r.holds(f, k) || row(f, k))
            }
        })
    }
}

/// The schemas a write is judged under (`Lane::fits`; `Schemas.lean`'s `Fit`): what they let a record hold.
struct Fit<'a>(Vec<&'a Schema>);

impl Fit<'_> {
    /// The shape schema `x` gives the rows the chain `rows` ends in, each list's in turn: the record's own, for none.
    fn around<'x>(x: &'x Schema, rows: &[(String, Key)]) -> Option<&'x Shape> {
        let mut shape = &x.root;
        for (f, _) in rows {
            shape = shape.records(f)?;
        }
        Some(shape)
    }

    /// What schema `x` names place `p`: the field of the shape around it.
    fn field<'x>(x: &'x Schema, p: &Path) -> Option<&'x Field> {
        Fit::around(x, &p.rows)?.field(&p.field)
    }

    /// One of them lets place `p` hold `v`.
    fn leaf(&self, p: &Path, v: &Value) -> bool {
        self.0.iter().any(|x| Fit::field(x, p).is_some_and(|field| field.ty.fits(v)))
    }

    /// One of them names `f` a list of records, or of values while it holds none (an empty list is either), and `new`
    /// holds no copy of a row `old` doesn't: a write may keep or move the copies two devices adding a row with one id
    /// at once make, never make one.
    fn rows(&self, f: &Path, old: Option<&Vec<Key>>, new: &[Key]) -> bool {
        let named = |x: &&Schema| match Fit::field(x, f).map(|field| &field.ty) {
            Some(Type::Records(_)) => true,
            Some(Type::List(_)) => new.is_empty(),
            // an empty array reads as an empty list of records too: a value it may hold
            Some(Type::Value(c)) => new.is_empty() && c.holds(&Value::Array(vec![])),
            _ => false,
        };
        self.0.iter().any(named) && new.iter().all(|k| k.copy == 0 || old.is_some_and(|ks| ks.contains(k)))
    }

    /// The record's own fields read under one of them: it holds what that schema requires, by its own values and by
    /// which lists it holds, whatever their rows.
    fn top(&self, s: &Record) -> bool {
        let own = |v: &Value| if ops::rows(v).is_some() { Value::Array(vec![]) } else { v.clone() };
        let own: Record = s.iter().map(|(f, v)| (f.clone(), own(v))).collect();
        self.0.iter().any(|x| x.root.read(&own).is_some())
    }

    /// A row of the list at `f` reads under one of them, by its own fields (`Flat::own`): it holds what that schema
    /// requires of a row there.
    fn row(&self, f: &Path, row: &Record) -> bool {
        let shape = |x: &Schema| Fit::around(x, &f.rows)?.records(&f.field).map(|shape| shape.read(row).is_some());
        self.0.iter().any(|x| shape(x) == Some(true))
    }
}

/// The blobs of avenDB's own schemas, exactly as the apps ship them and a vault holds them as entries. Every one starts
/// at v1, avenDB's genesis.
pub mod blobs {
    /// The schema of each kind of record avenDB writes: every record is written under one of them, or under a schema
    /// of its vault's lane. avenCEO GmbH, the seed's company, holds each as a schema entry of its own, shared with
    /// everyone, as their owner (the page's `standard`): the same bytes, so the same ids.
    pub const SHIPPED: [&str; 10] =
        [DOCUMENT_V1, TODO_V1, ARTICLE_V1, FLOW_V1, FUNCTION_V1, POST_V1, CARD_V1, PROFILE_V1, FILE_V1, STORY_V1];

    /// A Markdown document: a title, blocks a heading (with its level), a paragraph, a checklist item or code (with
    /// its language), and tags.
    pub const DOCUMENT_V1: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Markdown document, v1",
  "type": "object",
  "properties": {
    "kind": { "const": "document" },
    "title": { "type": "string", "default": "" },
    "blocks": {
      "type": "array",
      "default": [],
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "integer" },
          "type": { "enum": ["heading", "paragraph", "item", "code"] },
          "level": { "type": "integer", "minimum": 0 },
          "checked": { "type": "boolean" },
          "lang": { "type": "string" },
          "text": { "type": "string", "x-loro": "text", "default": "" }
        },
        "required": ["id", "type"]
      }
    },
    "tags": { "type": "array", "items": { "type": "string" }, "default": [] }
  },
  "required": ["kind"]
}
"#;

    /// A todo: a title, its status (open, doing, done), notes and a due date.
    pub const TODO_V1: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Todo, v1",
  "type": "object",
  "properties": {
    "kind": { "const": "todo" },
    "title": { "type": "string", "default": "" },
    "status": { "enum": ["open", "doing", "done"], "default": "open" },
    "notes": { "type": "string", "x-loro": "text", "default": "" },
    "due": { "type": "string", "format": "date" }
  },
  "required": ["kind"]
}
"#;

    /// An article: a title and one Markdown text, which concurrent edits merge character by character.
    pub const ARTICLE_V1: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Article, v1",
  "type": "object",
  "properties": {
    "kind": { "const": "article" },
    "title": { "type": "string", "default": "" },
    "text": { "type": "string", "x-loro": "text", "default": "" },
    "tags": { "type": "array", "items": { "type": "string" }, "default": [] }
  },
  "required": ["kind"]
}
"#;

    /// A flow: the stages an item of any type moves through, each a node with the stages it leads on to, and whether
    /// an item in it is public. An item is in a stage while it carries the flow's key and the stage's, `content:draft`.
    pub const FLOW_V1: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Flow, v1",
  "type": "object",
  "properties": {
    "kind": { "const": "flow" },
    "key": { "type": "string", "default": "" },
    "name": { "type": "string", "default": "" },
    "about": { "type": "string", "x-loro": "text", "default": "" },
    "types": { "type": "array", "items": { "type": "string" }, "default": [] },
    "stages": {
      "type": "array",
      "default": [],
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "integer" },
          "key": { "type": "string" },
          "name": { "type": "string", "default": "" },
          "public": { "type": "boolean", "default": false },
          "next": { "type": "array", "items": { "type": "string" }, "default": [] },
          "x": { "type": "integer", "default": 0 },
          "y": { "type": "integer", "default": 0 }
        },
        "required": ["id", "key"]
      }
    },
    "tags": { "type": "array", "items": { "type": "string" }, "default": [] }
  },
  "required": ["kind"]
}
"#;

    /// A function: code that runs when an item enters or leaves a stage of a flow, in a sandbox, and answers with the
    /// ops it asks for, which run with the caps of whoever moved the item.
    pub const FUNCTION_V1: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Function, v1",
  "type": "object",
  "properties": {
    "kind": { "const": "function" },
    "name": { "type": "string", "default": "" },
    "about": { "type": "string", "x-loro": "text", "default": "" },
    "on": { "enum": ["enter", "leave"], "default": "enter" },
    "flow": { "type": "string", "default": "" },
    "stage": { "type": "string", "default": "" },
    "code": { "type": "string", "x-loro": "text", "default": "" },
    "enabled": { "type": "boolean", "default": true },
    "tags": { "type": "array", "items": { "type": "string" }, "default": [] }
  },
  "required": ["kind"]
}
"#;

    /// A post of the Maia Universe stream: a title, its text, its channel, and the entry it tells of, if one.
    pub const POST_V1: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Post, v1",
  "type": "object",
  "properties": {
    "kind": { "const": "post" },
    "title": { "type": "string", "default": "" },
    "text": { "type": "string", "x-loro": "text", "default": "" },
    "channel": { "type": "string", "default": "" },
    "about": { "type": "string", "default": "" },
    "tags": { "type": "array", "items": { "type": "string" }, "default": [] }
  },
  "required": ["kind"]
}
"#;

    /// A device's card: the name its vault's other devices show it by.
    pub const CARD_V1: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Card, v1",
  "type": "object",
  "properties": {
    "kind": { "const": "card" },
    "title": { "type": "string", "default": "" },
    "tags": { "type": "array", "items": { "type": "string" }, "default": [] }
  },
  "required": ["kind"]
}
"#;

    /// A vault's profile: the name everyone reads it by.
    pub const PROFILE_V1: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Profile, v1",
  "type": "object",
  "properties": {
    "kind": { "const": "profile" },
    "title": { "type": "string", "default": "" },
    "tags": { "type": "array", "items": { "type": "string" }, "default": [] }
  },
  "required": ["kind"]
}
"#;

    /// A file of a vault's Library: its name and its media type. Its bytes come with the write that brings them.
    pub const FILE_V1: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "File, v1",
  "type": "object",
  "properties": {
    "kind": { "const": "file" },
    "title": { "type": "string", "default": "" },
    "media": { "type": "string", "default": "application/octet-stream" },
    "tags": { "type": "array", "items": { "type": "string" }, "default": [] }
  },
  "required": ["kind"]
}
"#;

    /// A story: one content piece from its first spark to every platform it goes out on, the spine the rest of it
    /// points at (docs/ARCHITECTURE.md §9). Its sparks are entry ids; its journey's beats and its hook variants are
    /// rows, the chosen hook naming its row's id; a beat's tension is 0 to 100. The stage it is in is a flow's tag.
    pub const STORY_V1: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Story, v1",
  "type": "object",
  "properties": {
    "kind": { "const": "story" },
    "title": { "type": "string", "default": "" },
    "format": { "enum": ["film", "reel", "article", "post", "thread", "inspire", "newsletter", "podcast"] },
    "sparks": { "type": "array", "items": { "type": "string" }, "default": [] },
    "from": { "type": "string", "default": "" },
    "to": { "type": "string", "default": "" },
    "question": { "type": "string", "default": "" },
    "beats": {
      "type": "array",
      "default": [],
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "integer" },
          "title": { "type": "string", "default": "" },
          "type": {
            "enum": ["hook", "context", "problem", "intention", "obstacle", "low", "turn", "solution", "vision"]
          },
          "text": { "type": "string", "x-loro": "text", "default": "" },
          "link": { "enum": ["but", "therefore"] },
          "feel": { "type": "string" },
          "tension": { "type": "integer", "minimum": 0 }
        },
        "required": ["id"]
      }
    },
    "hooks": {
      "type": "array",
      "default": [],
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "integer" },
          "text": { "type": "string", "default": "" },
          "subject": { "type": "string" },
          "action": { "type": "string" },
          "end": { "type": "string" },
          "contrast": { "type": "string" },
          "proof": { "type": "string" },
          "time": { "type": "string" },
          "anchor": { "type": "string" },
          "promise": { "type": "string" },
          "objection": { "type": "string" },
          "dial": { "type": "integer", "minimum": 1 },
          "note": { "type": "string" },
          "image_title": { "type": "array", "items": { "type": "string" }, "default": [] }
        },
        "required": ["id"]
      }
    },
    "hook": { "type": "integer", "minimum": 0 },
    "intro": { "type": "string", "x-loro": "text", "default": "" },
    "description": { "type": "string", "x-loro": "text", "default": "" },
    "image_title": { "type": "array", "items": { "type": "string" }, "default": [] },
    "categories": { "type": "array", "items": { "type": "string" }, "default": [] },
    "series": { "type": "string", "default": "" },
    "episode": { "type": "integer", "minimum": 0 },
    "launch": { "type": "string" },
    "tags": { "type": "array", "items": { "type": "string" }, "default": [] }
  },
  "required": ["kind"]
}
"#;
}

fn built_in_schema(blob: &str) -> Schema {
    Schema::parse(blob.as_bytes()).expect("a built-in schema parses")
}

pub static DOCUMENT_V1: LazyLock<Schema> = LazyLock::new(|| built_in_schema(blobs::DOCUMENT_V1));
pub static TODO_V1: LazyLock<Schema> = LazyLock::new(|| built_in_schema(blobs::TODO_V1));
pub static ARTICLE_V1: LazyLock<Schema> = LazyLock::new(|| built_in_schema(blobs::ARTICLE_V1));
pub static FLOW_V1: LazyLock<Schema> = LazyLock::new(|| built_in_schema(blobs::FLOW_V1));
pub static FUNCTION_V1: LazyLock<Schema> = LazyLock::new(|| built_in_schema(blobs::FUNCTION_V1));
pub static POST_V1: LazyLock<Schema> = LazyLock::new(|| built_in_schema(blobs::POST_V1));
pub static CARD_V1: LazyLock<Schema> = LazyLock::new(|| built_in_schema(blobs::CARD_V1));
pub static PROFILE_V1: LazyLock<Schema> = LazyLock::new(|| built_in_schema(blobs::PROFILE_V1));
pub static FILE_V1: LazyLock<Schema> = LazyLock::new(|| built_in_schema(blobs::FILE_V1));
pub static STORY_V1: LazyLock<Schema> = LazyLock::new(|| built_in_schema(blobs::STORY_V1));

/// The app of each kind avenDB ships, of its one schema alone, by its kind.
static BUILT_IN: LazyLock<Vec<(&'static str, View)>> = LazyLock::new(|| {
    let shipped = [
        &*DOCUMENT_V1,
        &*TODO_V1,
        &*ARTICLE_V1,
        &*FLOW_V1,
        &*FUNCTION_V1,
        &*POST_V1,
        &*CARD_V1,
        &*PROFILE_V1,
        &*FILE_V1,
        &*STORY_V1,
    ];
    shipped.map(|s| (s.kind().expect("a shipped schema names its kind"), View::plain(s))).to_vec()
});

/// The lens engine's worked example, for the tests and the Lean model alone (`spec/AvenDB/Lens.lean`, the lens cases
/// of `spec/vectors/lenses.json`): documents and todos in a version before the shipped one, v0, and a lens from each to
/// v1. avenDB ships none of it, seeds none of it and reads nothing through it; a vault that wants it holds it in its
/// lane (`blobs::LANE`), as any other schema or lens.
///
/// - Markdown documents: v0 blocks have a `kind` (h1, h2, h3, p, li, code); v1 blocks have a `type` with a heading
///   `level`, items can be `checked`, code can name its `lang`, and the document gains `tags`.
/// - Todos: v0 has `done`; v1 has `status` (open, doing, done), and a todo in progress reads as not done in v0.
pub mod example {
    use std::sync::LazyLock;

    use serde_json::Value;

    use super::{
        DOCUMENT_V1, DocV1, Lens, Schema, TODO_V1, TodoV1, View, built_in_schema, id_of, id_value, name, named, object,
        present, text,
    };

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum KindV0 {
        H1,
        H2,
        H3,
        P,
        Li,
        Code,
    }

    #[derive(Clone, Debug, PartialEq, Eq)]
    pub struct BlockV0 {
        pub id: u64,
        pub kind: KindV0,
        pub text: String,
    }

    #[derive(Clone, Debug, PartialEq, Eq)]
    pub struct DocV0 {
        pub title: String,
        pub blocks: Vec<BlockV0>,
    }

    #[derive(Clone, Debug, PartialEq, Eq)]
    pub struct TodoV0 {
        pub title: String,
        pub done: bool,
        pub notes: String,
        pub due: Option<String>,
    }

    /// Each kind of block as v0 names it.
    const KINDS: [(KindV0, &str); 6] = [
        (KindV0::H1, "h1"),
        (KindV0::H2, "h2"),
        (KindV0::H3, "h3"),
        (KindV0::P, "p"),
        (KindV0::Li, "li"),
        (KindV0::Code, "code"),
    ];

    impl BlockV0 {
        pub fn to_value(&self) -> Value {
            object([
                ("id", Some(id_value(self.id))),
                ("kind", Some(name(&KINDS, self.kind).into())),
                ("text", Some(self.text.clone().into())),
            ])
        }

        pub fn from_value(v: &Value) -> Option<BlockV0> {
            let r = v.as_object()?;
            let kind = named(&KINDS, present(r, "kind")?.as_str()?)?;
            Some(BlockV0 { id: id_of(r)?, kind, text: text(r, "text")? })
        }
    }

    impl DocV0 {
        pub fn to_value(&self) -> Value {
            object([
                ("kind", Some("document".into())),
                ("title", Some(self.title.clone().into())),
                ("blocks", Some(self.blocks.iter().map(BlockV0::to_value).collect())),
            ])
        }

        pub fn from_value(v: &Value) -> Option<DocV0> {
            let r = v.as_object()?;
            let blocks = present(r, "blocks")?.as_array()?.iter().map(BlockV0::from_value).collect::<Option<_>>()?;
            Some(DocV0 { title: text(r, "title")?, blocks })
        }

        /// The lens forwards: the document as a v1 app reads what a v0 app wrote.
        pub fn fwd(&self) -> DocV1 {
            DocV1::from_value(&document_v1().get(&self.to_value()).expect("a v0 document reads in v1"))
                .expect("a v1 document")
        }
    }

    impl DocV1 {
        /// The lens backwards: the document as a v0 app reads what a v1 app wrote. What v0 can't say (checked, lang,
        /// tags) it doesn't show, and a heading below level 3 reads as h3.
        pub fn bwd(&self) -> DocV0 {
            DocV0::from_value(&document_v0().get(&self.to_value()).expect("a v1 document reads in v0"))
                .expect("a v0 document")
        }
    }

    impl TodoV0 {
        pub fn to_value(&self) -> Value {
            object([
                ("kind", Some("todo".into())),
                ("title", Some(self.title.clone().into())),
                ("done", Some(self.done.into())),
                ("notes", Some(self.notes.clone().into())),
                ("due", self.due.clone().map(Value::from)),
            ])
        }

        pub fn from_value(v: &Value) -> Option<TodoV0> {
            let r = v.as_object()?;
            Some(TodoV0 {
                title: text(r, "title")?,
                done: present(r, "done")?.as_bool()?,
                notes: text(r, "notes")?,
                due: text(r, "due"),
            })
        }

        pub fn fwd(&self) -> TodoV1 {
            TodoV1::from_value(&todo_v1().get(&self.to_value()).expect("a v0 todo reads in v1")).expect("a v1 todo")
        }
    }

    impl TodoV1 {
        /// Going back, a todo in progress shows as not done.
        pub fn bwd(&self) -> TodoV0 {
            TodoV0::from_value(&todo_v0().get(&self.to_value()).expect("a v1 todo reads in v0")).expect("a v0 todo")
        }
    }

    /// The example's blobs: its two v0 schemas and the lenses from them to the shipped v1.
    pub mod blobs {
        /// The lane a vault holds to read through the example, beside the shipped schemas.
        pub const LANE: [&str; 4] = [DOCUMENT_V0, TODO_V0, DOCUMENT_LENS, TODO_LENS];

        pub const DOCUMENT_V0: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Markdown document, v0",
  "type": "object",
  "properties": {
    "kind": { "const": "document" },
    "title": { "type": "string", "default": "" },
    "blocks": {
      "type": "array",
      "default": [],
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "integer" },
          "kind": { "enum": ["h1", "h2", "h3", "p", "li", "code"] },
          "text": { "type": "string", "x-loro": "text", "default": "" }
        },
        "required": ["id", "kind"]
      }
    }
  },
  "required": ["kind"]
}
"#;

        pub const TODO_V0: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Todo, v0",
  "type": "object",
  "properties": {
    "kind": { "const": "todo" },
    "title": { "type": "string", "default": "" },
    "done": { "type": "boolean", "default": false },
    "notes": { "type": "string", "x-loro": "text", "default": "" },
    "due": { "type": "string", "format": "date" }
  },
  "required": ["kind"]
}
"#;

        pub const DOCUMENT_LENS: &str = r#"{
  "lens": "Markdown document, v0 to v1",
  "from": "49c168c604a95269cc5a8b11b436802da0e99979a88ccd83d49e941d5051c33c",
  "to": "02dcdc79ca73a93751c08a27455a7769551b242b1927027bdba955a9f8c4e4dc",
  "steps": [
    { "add": "tags" },
    { "in": { "field": "blocks", "steps": [
      { "convert": {
        "from": ["kind"],
        "to": ["type", "level"],
        "forward": [
          [{ "kind": "h1" }, { "type": "heading", "level": 1 }],
          [{ "kind": "h2" }, { "type": "heading", "level": 2 }],
          [{ "kind": "h3" }, { "type": "heading", "level": 3 }],
          [{ "kind": "p" }, { "type": "paragraph" }],
          [{ "kind": "li" }, { "type": "item" }],
          [{ "kind": "code" }, { "type": "code" }]
        ],
        "backward": [
          [{ "type": "heading", "level": 1 }, { "kind": "h1" }],
          [{ "type": "heading", "level": 2 }, { "kind": "h2" }],
          [{ "type": "heading" }, { "kind": "h3" }],
          [{ "type": "paragraph" }, { "kind": "p" }],
          [{ "type": "item" }, { "kind": "li" }],
          [{ "type": "code" }, { "kind": "code" }]
        ]
      } },
      { "add": "checked" },
      { "add": "lang" }
    ] } }
  ]
}
"#;

        pub const TODO_LENS: &str = r#"{
  "lens": "Todo, v0 to v1",
  "from": "40de6c0ec5c3a9bbd632ec51355747ff2f0b8da31035f95f4f20035ccb35deb4",
  "to": "0d785ad396a9285ab1b4b75a70057d439573622dbc58d5306264ccd3f6262193",
  "steps": [
    { "convert": {
      "from": ["done"],
      "to": ["status"],
      "forward": [
        [{ "done": true }, { "status": "done" }],
        [{ "done": false }, { "status": "open" }]
      ],
      "backward": [
        [{ "status": "done" }, { "done": true }],
        [{ "status": "open" }, { "done": false }],
        [{ "status": "doing" }, { "done": false }]
      ]
    } }
  ]
}
"#;
    }

    fn example_lens(blob: &str) -> Lens {
        Lens::parse(blob.as_bytes()).expect("the example's lens parses")
    }

    pub static DOCUMENT_V0: LazyLock<Schema> = LazyLock::new(|| built_in_schema(blobs::DOCUMENT_V0));
    pub static TODO_V0: LazyLock<Schema> = LazyLock::new(|| built_in_schema(blobs::TODO_V0));
    pub static DOCUMENT_LENS: LazyLock<Lens> = LazyLock::new(|| example_lens(blobs::DOCUMENT_LENS));
    pub static TODO_LENS: LazyLock<Lens> = LazyLock::new(|| example_lens(blobs::TODO_LENS));

    struct Views {
        document_v0: View,
        document_v1: View,
        todo_v0: View,
        todo_v1: View,
    }

    static VIEWS: LazyLock<Views> = LazyLock::new(|| {
        let view = |app: &Schema, lens: &Lens, other: &Schema| View::through(app, lens, other).expect("it joins them");
        Views {
            document_v0: view(&DOCUMENT_V0, &DOCUMENT_LENS, &DOCUMENT_V1),
            document_v1: view(&DOCUMENT_V1, &DOCUMENT_LENS, &DOCUMENT_V0),
            todo_v0: view(&TODO_V0, &TODO_LENS, &TODO_V1),
            todo_v1: view(&TODO_V1, &TODO_LENS, &TODO_V0),
        }
    });

    /// A v0 markdown app, which knows the lens to v1.
    pub fn document_v0() -> &'static View {
        &VIEWS.document_v0
    }

    /// A v1 markdown app that knows the lens from v0, as the shipped one doesn't (`View::document_v1`).
    pub fn document_v1() -> &'static View {
        &VIEWS.document_v1
    }

    /// A v0 todo app, which knows the lens to v1.
    pub fn todo_v0() -> &'static View {
        &VIEWS.todo_v0
    }

    /// A v1 todo app that knows the lens from v0, as the shipped one doesn't (`View::todo_v1`).
    pub fn todo_v1() -> &'static View {
        &VIEWS.todo_v1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_shipped_schema_starts_at_v1() {
        for blob in blobs::SHIPPED {
            let title = serde_json::from_str::<Value>(blob).expect("JSON")["title"].as_str().map(str::to_string);
            assert!(title.as_deref().is_some_and(|t| t.ends_with(", v1")), "{title:?}");
        }
    }

    #[test]
    fn the_examples_lenses_join_its_schemas_to_the_shipped_ones() {
        use example::{DOCUMENT_LENS, DOCUMENT_V0, TODO_LENS, TODO_V0};
        assert_eq!((DOCUMENT_LENS.from(), DOCUMENT_LENS.to()), (DOCUMENT_V0.id(), DOCUMENT_V1.id()));
        assert_eq!((TODO_LENS.from(), TODO_LENS.to()), (TODO_V0.id(), TODO_V1.id()));
    }
}

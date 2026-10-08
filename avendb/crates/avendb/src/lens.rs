//! Schemas and the lenses between their versions, as data: a schema is a JSON Schema and a lens a short list of steps,
//! each a blob named by its BLAKE3 hash (`BlobId`). A space's owners publish them into its schema lane
//! (`Action::Publish`, T17), so an app learns a newer version's lens from the lane instead of shipping with it. The
//! model is `avendb/spec/AvenDB/Lens.lean` (T9), and `avendb/spec/vectors/lenses.json` holds this engine to it.
//!
//! Nothing is migrated. Each edit is tagged with the schema it was written under (its Loro commit message, see `doc`),
//! and an item is projected on read into the app's schema through the lens (`View::get`): where both versions stored
//! the same thing, the newer version's fields win, and what neither stored shows its schema's default. An edit made on
//! a view, an older app's too, goes back as the difference between the view before and after it (`View::put`): only
//! what changed is written, in the representation the item already uses, so a default is never written and what the
//! app can't see survives. A migration commit would do neither: two devices migrating at once can drop each other's
//! new containers, and written defaults race real edits.
//!
//! The two examples, each in two versions, with a lens from v1 to v2:
//! - Markdown documents: v1 blocks have a `kind` (h1, h2, h3, p, li, code); v2 blocks have a `type` with a heading
//!   `level`, items can be `checked`, code can name its `lang`, and the document gains `tags`.
//! - Todos: v1 has `done`; v2 has `status` (open, doing, done), and a todo in progress reads as not done in v1.
//!
//! Records in a list (a document's blocks) are matched by their `id`, which apps pick at random, so that two devices
//! adding records at once don't pick the same one; where they do, apps see the first.
//!
//! A view follows one lens: an item written under the app's schema and at most one other version, joined to it by a
//! lens in the lane. Anything else opens read-only (`Lane::view`); chains of lenses come with a third version.

use std::collections::hash_map::Entry;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::LazyLock;

use serde_json::{Map, Value};

use crate::id::BlobId;

/// A record: a map of fields, as JSON. `null` reads as absent.
pub type Record = Map<String, Value>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KindV1 {
    H1,
    H2,
    H3,
    P,
    Li,
    Code,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlockV1 {
    pub id: u64,
    pub kind: KindV1,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DocV1 {
    pub title: String,
    pub blocks: Vec<BlockV1>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TypeV2 {
    Heading,
    Paragraph,
    Item,
    Code,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlockV2 {
    pub id: u64,
    pub r#type: TypeV2,
    pub level: Option<u64>,
    pub checked: Option<bool>,
    pub lang: Option<String>,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DocV2 {
    pub title: String,
    pub blocks: Vec<BlockV2>,
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
    pub done: bool,
    pub notes: String,
    pub due: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TodoV2 {
    pub title: String,
    pub status: Status,
    pub notes: String,
    pub due: Option<String>,
}

/// Each value as the schemas name it.
const KINDS: [(KindV1, &str); 6] = [
    (KindV1::H1, "h1"),
    (KindV1::H2, "h2"),
    (KindV1::H3, "h3"),
    (KindV1::P, "p"),
    (KindV1::Li, "li"),
    (KindV1::Code, "code"),
];
const TYPES: [(TypeV2, &str); 4] =
    [(TypeV2::Heading, "heading"), (TypeV2::Paragraph, "paragraph"), (TypeV2::Item, "item"), (TypeV2::Code, "code")];
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
            ("kind", Some(name(&KINDS, self.kind).into())),
            ("text", Some(self.text.clone().into())),
        ])
    }

    pub fn from_value(v: &Value) -> Option<BlockV1> {
        let r = v.as_object()?;
        Some(BlockV1 { id: id_of(r)?, kind: named(&KINDS, present(r, "kind")?.as_str()?)?, text: text(r, "text")? })
    }
}

impl BlockV2 {
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

    pub fn from_value(v: &Value) -> Option<BlockV2> {
        let r = v.as_object()?;
        Some(BlockV2 {
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
        ])
    }

    pub fn from_value(v: &Value) -> Option<DocV1> {
        let r = v.as_object()?;
        let blocks = present(r, "blocks")?.as_array()?.iter().map(BlockV1::from_value).collect::<Option<_>>()?;
        Some(DocV1 { title: text(r, "title")?, blocks })
    }

    /// The lens forwards: the document as a v2 app reads what a v1 app wrote.
    pub fn fwd(&self) -> DocV2 {
        DocV2::from_value(&View::document_v2().get(&self.to_value()).expect("a v1 document reads in v2"))
            .expect("a v2 document")
    }
}

impl DocV2 {
    pub fn to_value(&self) -> Value {
        object([
            ("kind", Some("document".into())),
            ("title", Some(self.title.clone().into())),
            ("blocks", Some(self.blocks.iter().map(BlockV2::to_value).collect())),
            ("tags", Some(self.tags.iter().cloned().map(Value::from).collect())),
        ])
    }

    pub fn from_value(v: &Value) -> Option<DocV2> {
        let r = v.as_object()?;
        let blocks = present(r, "blocks")?.as_array()?.iter().map(BlockV2::from_value).collect::<Option<_>>()?;
        let tags = present(r, "tags")?.as_array()?.iter().map(|t| Some(t.as_str()?.to_string())).collect::<Option<_>>()?;
        Some(DocV2 { title: text(r, "title")?, blocks, tags })
    }

    /// The lens backwards: the document as a v1 app reads what a v2 app wrote. What v1 can't say (checked, lang,
    /// tags) it doesn't show, and a heading below level 3 reads as h3.
    pub fn bwd(&self) -> DocV1 {
        DocV1::from_value(&View::document_v1().get(&self.to_value()).expect("a v2 document reads in v1"))
            .expect("a v1 document")
    }
}

impl TodoV1 {
    pub fn to_value(&self) -> Value {
        object([
            ("kind", Some("todo".into())),
            ("title", Some(self.title.clone().into())),
            ("done", Some(self.done.into())),
            ("notes", Some(self.notes.clone().into())),
            ("due", self.due.clone().map(Value::from)),
        ])
    }

    pub fn from_value(v: &Value) -> Option<TodoV1> {
        let r = v.as_object()?;
        Some(TodoV1 {
            title: text(r, "title")?,
            done: present(r, "done")?.as_bool()?,
            notes: text(r, "notes")?,
            due: text(r, "due"),
        })
    }

    pub fn fwd(&self) -> TodoV2 {
        TodoV2::from_value(&View::todo_v2().get(&self.to_value()).expect("a v1 todo reads in v2")).expect("a v2 todo")
    }
}

impl TodoV2 {
    pub fn to_value(&self) -> Value {
        object([
            ("kind", Some("todo".into())),
            ("title", Some(self.title.clone().into())),
            ("status", Some(name(&STATUSES, self.status).into())),
            ("notes", Some(self.notes.clone().into())),
            ("due", self.due.clone().map(Value::from)),
        ])
    }

    pub fn from_value(v: &Value) -> Option<TodoV2> {
        let r = v.as_object()?;
        Some(TodoV2 {
            title: text(r, "title")?,
            status: named(&STATUSES, present(r, "status")?.as_str()?)?,
            notes: text(r, "notes")?,
            due: text(r, "due"),
        })
    }

    /// Going back, a todo in progress shows as not done.
    pub fn bwd(&self) -> TodoV1 {
        TodoV1::from_value(&View::todo_v1().get(&self.to_value()).expect("a v2 todo reads in v1")).expect("a v1 todo")
    }
}

/// A schema: one version of an item's shape, as a JSON Schema, named by the hash of its bytes.
///
/// The subset it reads: an object's `properties` and `required`; each property a `const`, an `enum`, or a `type` of
/// string, integer (with a `minimum`), boolean, or array, whose `items` are values or records (objects with a required
/// integer `id`, which edits match them by); a `default` where a field may be absent. `"x-loro": "text"` marks free
/// text, which an item stores as a Loro text so concurrent edits merge character by character; everything else is one
/// value, where concurrent edits keep one of them. Other keywords are annotations and change nothing.
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
    String,
    Integer { minimum: Option<i64> },
    Boolean,
    OneOf(Vec<Value>),
}

/// How an item stores a field.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stored {
    Text,
    Value,
    List,
    Records,
}

impl Check {
    fn of(p: &Value) -> Option<Check> {
        if let Some(c) = p.get("const") {
            return Some(Check::OneOf(vec![c.clone()]));
        }
        if let Some(e) = p.get("enum") {
            return Some(Check::OneOf(e.as_array()?.clone()));
        }
        match p.get("type")?.as_str()? {
            "string" => Some(Check::String),
            "integer" => Some(Check::Integer { minimum: p.get("minimum").and_then(Value::as_i64) }),
            "boolean" => Some(Check::Boolean),
            _ => None,
        }
    }

    fn holds(&self, v: &Value) -> bool {
        match self {
            Check::String => v.is_string(),
            Check::Integer { minimum } => v.as_i64().is_some_and(|n| minimum.is_none_or(|m| n >= m)),
            Check::Boolean => v.is_boolean(),
            Check::OneOf(vs) => vs.contains(v),
        }
    }
}

impl Type {
    /// A property of a schema; `nested` for the fields of a list's records, which hold no records themselves.
    fn of(p: &Value, nested: bool) -> Option<Type> {
        if p.get("type").and_then(Value::as_str) == Some("array") {
            let items = p.get("items")?;
            if items.get("type").and_then(Value::as_str) == Some("object") {
                let shape = Shape::of(items, true).filter(|_| !nested)?;
                // records are matched by their id
                let id = shape.fields.iter().find(|f| f.name == "id")?;
                let integer = matches!(id.ty, Type::Value(Check::Integer { .. }));
                return (integer && shape.required.iter().any(|r| r == "id")).then_some(Type::Records(shape));
            }
            return Some(Type::List(Check::of(items)?));
        }
        let string = p.get("type").and_then(Value::as_str) == Some("string");
        if string && p.get("x-loro").and_then(Value::as_str) == Some("text") {
            return Some(Type::Text);
        }
        Some(Type::Value(Check::of(p)?))
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
}

impl Shape {
    fn of(v: &Value, nested: bool) -> Option<Shape> {
        if v.get("type")?.as_str()? != "object" {
            return None;
        }
        let fields = v.get("properties")?.as_object()?.iter().map(|(name, p)| {
            Some(Field { name: name.clone(), ty: Type::of(p, nested)?, default: p.get("default").cloned() })
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
        let root = Shape::of(&v, false)?;
        let title = v.get("title").and_then(Value::as_str).unwrap_or_default().to_string();
        Some(Schema { id: BlobId::of(bytes), bytes: bytes.to_vec(), title, root })
    }

    pub fn id(&self) -> BlobId {
        self.id
    }

    /// The blob, as published into a lane.
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn title(&self) -> &str {
        &self.title
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
        let (op, x) = v.as_object().filter(|o| o.len() == 1)?.iter().next()?;
        let names = |v: &Value| v.as_array()?.iter().map(|f| Some(f.as_str()?.to_string())).collect::<Option<Vec<_>>>();
        let rows = |v: &Value| {
            let row = |r: &Value| match r.as_array()?.as_slice() {
                [when, then] => Some(Row { when: when.as_object()?.clone(), then: then.as_object()?.clone() }),
                _ => None,
            };
            v.as_array()?.iter().map(row).collect::<Option<Vec<_>>>()
        };
        match op.as_str() {
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

    /// A v1 markdown app that knows the lens to v2.
    pub fn document_v1() -> &'static View {
        &BUILT_IN.document_v1
    }

    /// A v2 markdown app, which knows the lens from v1.
    pub fn document_v2() -> &'static View {
        &BUILT_IN.document_v2
    }

    pub fn todo_v1() -> &'static View {
        &BUILT_IN.todo_v1
    }

    pub fn todo_v2() -> &'static View {
        &BUILT_IN.todo_v2
    }
}

/// The schemas and lenses a device holds from a space's lane.
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
}

/// The blobs of the two examples' schemas and lenses, exactly as the apps ship and publish them.
pub mod blobs {
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

    pub const DOCUMENT_V2: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Markdown document, v2",
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

    pub const TODO_V1: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Todo, v1",
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

    pub const TODO_V2: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Todo, v2",
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

    pub const DOCUMENT_LENS: &str = r#"{
  "lens": "Markdown document, v1 to v2",
  "from": "008b52fa60c9e62956d8e253f888c14076e8d9f5a0c1810acf4f7eb7f6d8cc29",
  "to": "9f9c781f5894b9262170d86e3958afa21f5beee70a0dd04aa83d3248f6772c65",
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
  "lens": "Todo, v1 to v2",
  "from": "fc36ea1af9ca64d5fcb00ae02c86f490e8c9154295b920d7913099104bf4ae75",
  "to": "e59008d55a8c1b5d57e1f76d53d48376b39a2979c5adfa4ccc81f2fdae17f777",
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

fn built_in_schema(blob: &str) -> Schema {
    Schema::parse(blob.as_bytes()).expect("a built-in schema parses")
}

fn built_in_lens(blob: &str) -> Lens {
    Lens::parse(blob.as_bytes()).expect("a built-in lens parses")
}

pub static DOCUMENT_V1: LazyLock<Schema> = LazyLock::new(|| built_in_schema(blobs::DOCUMENT_V1));
pub static DOCUMENT_V2: LazyLock<Schema> = LazyLock::new(|| built_in_schema(blobs::DOCUMENT_V2));
pub static TODO_V1: LazyLock<Schema> = LazyLock::new(|| built_in_schema(blobs::TODO_V1));
pub static TODO_V2: LazyLock<Schema> = LazyLock::new(|| built_in_schema(blobs::TODO_V2));
pub static DOCUMENT_LENS: LazyLock<Lens> = LazyLock::new(|| built_in_lens(blobs::DOCUMENT_LENS));
pub static TODO_LENS: LazyLock<Lens> = LazyLock::new(|| built_in_lens(blobs::TODO_LENS));

struct BuiltIn {
    document_v1: View,
    document_v2: View,
    todo_v1: View,
    todo_v2: View,
}

static BUILT_IN: LazyLock<BuiltIn> = LazyLock::new(|| {
    let view = |app: &Schema, lens: &Lens, other: &Schema| View::through(app, lens, other).expect("the lens joins them");
    BuiltIn {
        document_v1: view(&DOCUMENT_V1, &DOCUMENT_LENS, &DOCUMENT_V2),
        document_v2: view(&DOCUMENT_V2, &DOCUMENT_LENS, &DOCUMENT_V1),
        todo_v1: view(&TODO_V1, &TODO_LENS, &TODO_V2),
        todo_v2: view(&TODO_V2, &TODO_LENS, &TODO_V1),
    }
});

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_built_in_lenses_join_the_built_in_schemas() {
        assert_eq!((DOCUMENT_LENS.from(), DOCUMENT_LENS.to()), (DOCUMENT_V1.id(), DOCUMENT_V2.id()));
        assert_eq!((TODO_LENS.from(), TODO_LENS.to()), (TODO_V1.id(), TODO_V2.id()));
    }
}

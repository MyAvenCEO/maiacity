//! Schemas and the two-way lenses between their versions, as in `vault/spec/VaultSpec/Lens.lean` (T9).
//!
//! - Markdown documents: v1 blocks have a `kind` (h1, h2, h3, p, li, code); v2 blocks have a `type` with a heading
//!   `level`, items can be `checked`, code can name its `lang`, and the document gains `tags`.
//! - Todos: v1 has `done`; v2 has `status` (open, doing, done).

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
    pub level: Option<u8>,
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

/// A block as stored after concurrent edits: still v1-shaped (written by an offline v1 app) or already v2.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AnyBlock {
    V1(BlockV1),
    V2(BlockV2),
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

impl DocV1 {
    pub fn fwd(&self) -> DocV2 {
        todo!("P4: lenses")
    }
}

impl DocV2 {
    pub fn bwd(&self) -> DocV1 {
        todo!("P4: lenses")
    }
}

/// The migration commit: every block in v2 shape.
pub fn migrate(blocks: &[AnyBlock]) -> Vec<AnyBlock> {
    let _ = blocks;
    todo!("P4: migration")
}

impl TodoV1 {
    pub fn fwd(&self) -> TodoV2 {
        todo!("P4: lenses")
    }
}

impl TodoV2 {
    /// Going back, a todo in progress shows as not done.
    pub fn bwd(&self) -> TodoV1 {
        todo!("P4: lenses")
    }
}

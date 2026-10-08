//! History and branches of one item, on Loro's own version control (T10, `avendb/spec/AvenDB/Doc.lean`): commits,
//! revert, branch, merge and promote. A merge imports the updates the target lacks, so it is the union of both
//! histories. Promote imports the branch and then reverts to the branch's head, which gives exactly the branch's
//! content while keeping both histories (reverting first and importing afterwards does not).

use crate::doc::{Item, Version};

/// One commit: a version of the item and its message. Messages are kept distinct so Loro never merges two commits'
/// changes into one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Commit {
    pub version: Version,
    pub message: String,
}

/// An item with its main line and named branches.
pub struct Repo {
    _filled_in_p5: (),
}

impl Repo {
    pub fn new(item: Item) -> Repo {
        let _ = item;
        todo!("P5: history")
    }

    /// The item on `branch` ("main" is the main line).
    pub fn item(&self, branch: &str) -> &Item {
        let _ = branch;
        todo!("P5: branches")
    }

    pub fn item_mut(&mut self, branch: &str) -> &mut Item {
        let _ = branch;
        todo!("P5: branches")
    }

    pub fn commit(&mut self, branch: &str, message: &str) -> Commit {
        let _ = (branch, message);
        todo!("P5: commits")
    }

    /// Every commit on `branch`, oldest first.
    pub fn log(&self, branch: &str) -> Vec<Commit> {
        let _ = branch;
        todo!("P5: history")
    }

    /// A new branch from the head of `from`.
    pub fn branch(&mut self, name: &str, from: &str) {
        let _ = (name, from);
        todo!("P5: fork")
    }

    /// Bring `from`'s updates into `into`.
    pub fn merge(&mut self, from: &str, into: &str) {
        let _ = (from, into);
        todo!("P5: merge")
    }

    /// Make `into` show exactly `from`'s content, keeping both histories.
    pub fn promote(&mut self, from: &str, into: &str) {
        let _ = (from, into);
        todo!("P5: promote = import, then revert to the branch's head")
    }

    /// Undo one commit on `branch` with a new commit.
    pub fn revert(&mut self, branch: &str, commit: &Commit) -> Commit {
        let _ = (branch, commit);
        todo!("P5: revert")
    }
}

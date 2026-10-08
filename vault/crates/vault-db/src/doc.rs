//! The two example items, each one Loro document: a markdown document (a list of blocks, each block a map) and a todo
//! (a map). An item's Loro updates are what gets encrypted into `Write` ops and synced. Its content depends only on
//! which updates it holds (Loro converges), so devices holding the same writes show the same item (T11, T13).

use crate::id::SignerId;
use crate::lens::{BlockV2, DocV1, DocV2, Status, TodoV2};

/// A version of an item (Loro's version vector), to export what came after it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Version(pub Vec<u8>);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocError {
    /// Not a Loro update, or a crafted one.
    Malformed,
    /// The update's Loro peer ids aren't the ones its signer may use.
    WrongPeer,
}

pub struct Item {
    _loro_in_p4: (),
}

impl Item {
    /// A new markdown document under the v2 schema, made on `signer`'s device: its edits carry that signer's Loro peer.
    pub fn document(title: &str, signer: SignerId) -> Item {
        let _ = (title, signer);
        todo!("P4: Loro documents")
    }

    /// A new todo under the v2 schema, made on `signer`'s device.
    pub fn todo(title: &str, signer: SignerId) -> Item {
        let _ = (title, signer);
        todo!("P4: Loro todos")
    }

    /// A document as an app still on v1 writes it, on `signer`'s device.
    pub fn written_v1(doc: &DocV1, signer: SignerId) -> Item {
        let _ = (doc, signer);
        todo!("P4: v1 documents")
    }

    /// The same item as another device holds it, whose edits from now on are that device's.
    pub fn fork_as(&self, signer: SignerId) -> Item {
        let _ = signer;
        todo!("P4: Loro fork with the device's peer")
    }

    /// The migration commit's change: every block rewritten in v2 shape. Running it again changes nothing.
    pub fn migrate(&mut self) {
        todo!("P4: migration")
    }

    /// The item as a v1 app reads it: through the lens backwards; `None` for a todo.
    pub fn as_document_v1(&self) -> Option<DocV1> {
        todo!("P4: read through the lens")
    }

    /// The item as a v2 document, through the lens if it was written under v1; `None` for a todo.
    pub fn as_document(&self) -> Option<DocV2> {
        todo!("P4: read through the lens")
    }

    /// The item as a v2 todo, through the lens if it was written under v1; `None` for a document.
    pub fn as_todo(&self) -> Option<TodoV2> {
        todo!("P4: read through the lens")
    }

    pub fn push_block(&mut self, block: BlockV2) {
        let _ = block;
        todo!("P4: edit")
    }

    pub fn set_text(&mut self, block: u64, text: &str) {
        let _ = (block, text);
        todo!("P4: edit")
    }

    pub fn set_status(&mut self, status: Status) {
        let _ = status;
        todo!("P4: edit")
    }

    pub fn version(&self) -> Version {
        todo!("P4: versions")
    }

    /// The updates made since `since`, to encrypt into one write.
    pub fn export(&self, since: &Version) -> Vec<u8> {
        let _ = since;
        todo!("P4: export")
    }

    /// Import an update signed by `signer`, after checking its Loro peer ids belong to that signer.
    pub fn import(&mut self, update: &[u8], signer: SignerId) -> Result<(), DocError> {
        let _ = (update, signer);
        todo!("P4: import with decode_import_blob_meta first")
    }
}

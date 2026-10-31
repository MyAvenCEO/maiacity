//! The shelf: where a peer keeps the Docs it holds in its store (A185: the shelf, the head and the held page are
//! avenDOCS'). Any [`Store`] will do: a peer's own, or, in the browser's docs worker, one that asks the Peer-Light's.

use std::sync::Arc;

use aven_core::{DocId, Value};
use aven_db_store::{Error, Hash, RefName, Store};

/// Where a peer keeps its Docs in its store (A185; docs README, "The head", "Catching up", 3): each envelope's own bytes as
/// a blob named by their hash, and per Doc two refs, each a Value's blob moved by compare-and-set: `doc-<id>-held`,
/// the docs layer's held page (every envelope held, by name and blob, in the order held), and `doc-<id>`, its head.
/// What a peer seals is only what leaves the device. The held page moves first: the head is what the held page
/// reopens to, so a crash between the two leaves nothing a reopen can't rebuild. One writer per store (store, rule 1):
/// a ref that moved under it is an error, never retried over.
pub struct Shelf<S: ?Sized> {
    store: Arc<S>,
}

impl<S: ?Sized> Clone for Shelf<S> {
    fn clone(&self) -> Self {
        Shelf {
            store: self.store.clone(),
        }
    }
}

/// Where a Doc's two refs pointed when this peer last read or moved them.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Saved {
    pub held: Option<Hash>,
    pub head: Option<Hash>,
}

/// A Doc's refs, read back: its held page and its head as Values, and where they pointed.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Shelved {
    pub held: Option<Value>,
    pub head: Option<Value>,
    pub saved: Saved,
}

fn refs(doc: &DocId) -> (RefName, RefName) {
    let hex: String = doc.0.0.iter().map(|b| format!("{b:02x}")).collect();
    (
        RefName::new(format!("doc-{hex}-held")).expect("a ref name"),
        RefName::new(format!("doc-{hex}")).expect("a ref name"),
    )
}

impl<S: Store + ?Sized> Shelf<S> {
    pub fn new(store: Arc<S>) -> Shelf<S> {
        Shelf { store }
    }

    /// Keeps an envelope's bytes (or a sealed value fetched for it), named by their hash.
    pub async fn put(&self, bytes: Vec<u8>) -> Result<Hash, String> {
        self.store
            .put(bytes.into())
            .await
            .map_err(|e| e.to_string())
    }

    /// The bytes kept under `hash`, checked against it by the store.
    pub async fn get(&self, hash: &Hash) -> Result<Option<Vec<u8>>, String> {
        Ok(self
            .store
            .get(hash)
            .await
            .map_err(|e| e.to_string())?
            .map(|b| b.to_vec()))
    }

    async fn read(&self, name: &RefName) -> Result<(Option<Value>, Option<Hash>), String> {
        let Some(at) = self.store.get_ref(name).await.map_err(|e| e.to_string())? else {
            return Ok((None, None));
        };
        let bytes = self
            .get(&at)
            .await?
            .ok_or_else(|| format!("{} points at a missing blob", name.as_str()))?;
        let v =
            aven_core::decode(&bytes).ok_or_else(|| format!("{} isn't a Value", name.as_str()))?;
        Ok((Some(v), Some(at)))
    }

    /// What this peer keeps of `doc`: nothing for a Doc it has never held.
    pub async fn load(&self, doc: &DocId) -> Result<Shelved, String> {
        let (held_ref, head_ref) = refs(doc);
        let (held, held_at) = self.read(&held_ref).await?;
        let (head, head_at) = self.read(&head_ref).await?;
        Ok(Shelved {
            held,
            head,
            saved: Saved {
                held: held_at,
                head: head_at,
            },
        })
    }

    /// Moves `doc`'s refs to a new held page and head, the held page first, each from where `saved` says it was; then
    /// `saved` says where they are now.
    pub async fn save(
        &self,
        doc: &DocId,
        saved: &mut Saved,
        held: &Value,
        head: &Value,
    ) -> Result<(), String> {
        let (held_ref, head_ref) = refs(doc);
        saved.held = Some(self.moved(&held_ref, saved.held, held).await?);
        saved.head = Some(self.moved(&head_ref, saved.head, head).await?);
        Ok(())
    }

    async fn moved(
        &self,
        name: &RefName,
        expected: Option<Hash>,
        v: &Value,
    ) -> Result<Hash, String> {
        let at = self.put(aven_core::encode(v)).await?;
        if expected == Some(at) {
            return Ok(at);
        }
        match self.store.set_ref(name, expected, at).await {
            Ok(()) => Ok(at),
            Err(Error::Stale { .. }) => Err(format!(
                "{} moved under this peer: a second writer",
                name.as_str()
            )),
            Err(e) => Err(e.to_string()),
        }
    }
}

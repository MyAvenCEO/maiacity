//! The server peer (P8b): a node on a shelf of its own (`shelf`), its bucket (blobs B3a, `bucket`) or else its folder
//! (`disk`), with its device's secret on the shelf beside its edits (`SECRET`). At its first start on a shelf it makes
//! that secret, and belongs to no vault until the first human vault to claim it does (P8f, `Node::claim`,
//! `Node::found_with`): from then on it is a device of avenMAIA, the aven Maia City owns, of the seed
//! that human vault founds, which it acts as and never governs, and it starts again from what the shelf holds, as the
//! same device, whatever became of its folder beside a bucket. It hands its contact card, avenMAIA's log and its
//! owners', to whoever asks, so that a vault can give avenMAIA relay on its entries; it holds only ciphertext,
//! and opens nothing but what is public and avenMAIA's own. Its relay (the `avendb-server` binary) lets in only
//! the devices it knows (`Admission`).

use std::io::ErrorKind;

use anyhow::{Context as _, Result, anyhow};
use avendb::id::VaultId;
use avendb::lab::Lab;
use bytes::Bytes;
use zeroize::{Zeroize as _, Zeroizing};

use crate::{Node, Options, Shelf};

/// The object on the server's shelf that holds its device's secret: in a folder, a file readable by its owner alone;
/// in a bucket, sealed.
pub const SECRET: &str = "device.key";

/// The server's node on `shelf`, with `opts` for its network: its device's secret read from the shelf, or made at its
/// first start and put there; and its edits beside it, where it keeps whole every file the edits it holds bring
/// (`Options::keep`). It hands its contact card to whoever asks, and the first human vault to claim it owns it.
pub async fn open(shelf: Shelf, opts: Options) -> Result<Node> {
    let secret = secret(&shelf).await?;
    let mut lab = Lab::with_entropy(*random()?);
    let me = lab.device_with("the server", *secret);
    Node::spawn(lab, me, Options { shelf: Some(shelf), keep: true, card: true, ..opts }).await
}

/// An agent device on `shelf`, named `name`, with `opts` for its network: agentClaude on its person's Mac, as
/// the server's is, with its secret on the shelf beside its edits, made at its first start; but keeping no file whole
/// of its own accord (`Options::keep` as `opts` say), so that it reads its person's files from their Mac's one store.
/// It hands its card to whoever asks and answers claims while it belongs to no vault, so that its person's Mac adds it
/// to a device vault under their aven (`Node::add_device_vault_with`); from then on it acts as that device vault by its
/// own key.
pub async fn open_agent(shelf: Shelf, name: &str, opts: Options) -> Result<Node> {
    let secret = secret(&shelf).await?;
    let mut lab = Lab::with_entropy(*random()?);
    let me = lab.device_with(name, *secret);
    Node::spawn(lab, me, Options { shelf: Some(shelf), card: true, ..opts }).await
}

/// The vault the node's device belongs to, as its view has it: avenMAIA, once a device claimed the server; an
/// agent's device vault, once its person's Mac added it.
pub async fn vault(node: &Node) -> Option<VaultId> {
    node.read(|lab, me| lab.vault_of(me)).await
}

/// The device's secret on `shelf`, or a new one put there.
async fn secret(shelf: &Shelf) -> Result<Zeroizing<[u8; 32]>> {
    for _ in 0..2 {
        if let Some(bytes) = shelf.get(SECRET).await.context("the server's secret")? {
            let secret = <[u8; 32]>::try_from(&bytes[..]).map(Zeroizing::new);
            if let Ok(mut bytes) = bytes.try_into_mut() {
                bytes[..].zeroize();
            }
            return secret.map_err(|_| anyhow!("the shelf's {SECRET} holds no 32-byte secret"));
        }
        let secret = random()?;
        match shelf.put(SECRET, Bytes::copy_from_slice(&*secret)).await {
            Ok(()) => return Ok(secret),
            // put meanwhile: that one it is
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e).context("the server's secret"),
        }
    }
    Err(anyhow!("the server's secret is neither on its shelf nor put there"))
}

/// 32 bytes of the machine's own randomness, wiped as they are dropped.
pub(crate) fn random() -> Result<Zeroizing<[u8; 32]>> {
    let mut bytes = Zeroizing::new([0; 32]);
    getrandom::fill(&mut *bytes).map_err(|e| anyhow!("no randomness from the machine: {e}"))?;
    Ok(bytes)
}

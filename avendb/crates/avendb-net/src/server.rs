//! The server peer (P8b): a node on a shelf of its own (`shelf`), its bucket (blobs B3a, `bucket`) or else its folder
//! (`disk`), with its device's secret on the shelf beside its edits (`SECRET`). At its first start on a shelf it makes
//! that secret, in the suite new signers are made in (`sign::kept_secret`), and belongs to no vault until the first
//! human vault to claim it does (P8f, `Node::claim`, `Node::found_with`): from then on it is a device of avenMAIA, the
//! aven Maia City owns, of the seed that human vault founds, which it acts as and never governs, and it starts again
//! from what the shelf holds, as the same device, whatever became of its folder beside a bucket. It hands its contact
//! card, avenMAIA's log and its owners', to whoever asks, so that a vault can give avenMAIA relay on its entries; it
//! holds only ciphertext, and opens nothing but what is public and avenMAIA's own. Its relay (the `avendb-server`
//! binary) lets in only the devices it knows (`Admission`).

use std::io::ErrorKind;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context as _, Result, anyhow};
use avendb::id::{SignerId, VaultId};
use avendb::lab::Lab;
use avendb::sign::{self, Suite};
use bytes::Bytes;
use zeroize::{Zeroize as _, Zeroizing};

use crate::{Node, Options, Shared, Shelf, Writer};

/// The object on the server's shelf that holds its device's secret: in a folder, a file readable by its owner alone;
/// in a bucket, sealed. With its suite where it isn't SLH-DSA (`sign::kept_secret`): a server made before the key move
/// keeps the 32 bytes alone, and opens as itself.
pub const SECRET: &str = "device.key";

/// The object on a device's shelf that names its next key once its key moved (the key move, K3c, `name_next`): that
/// key's id, 32 bytes, which the device opens as from then on, by the same secret (`SECRET`, `Lab::device_as`). The
/// shelf never replaces an object, so it is put once, and the secret stays as it was.
pub const NEXT: &str = "device.next";

/// The server's node on `shelf`, with `opts` for its network: its device's secret read from the shelf, or made at its
/// first start and put there; and its edits beside it, where it keeps whole every file the edits it holds bring
/// (`Options::keep`). It hands its contact card to whoever asks, and the first human vault to claim it owns it. Once
/// its key moved, it opens as its next key (`NEXT`).
pub async fn open(shelf: Shelf, opts: Options) -> Result<Node> {
    open_owned(shelf.writer()?, opts).await
}

/// Continue mutable startup with ownership already acquired, as a restore does.
pub async fn open_owned(writer: Writer, opts: Options) -> Result<Node> {
    let shelf = writer.shelf();
    let (secret, suite) = secret(&shelf).await?;
    open_as(
        Some(shelf.reader()),
        "the server",
        &secret,
        suite,
        Options { keep: true, card: true, ..opts },
        Some(writer),
    )
    .await
}

/// An agent device on `shelf`, named `name`, with `opts` for its network: agentClaude on its person's Mac, as
/// the server's is, with its secret on the shelf beside its edits, made at its first start; but keeping no file whole
/// of its own accord (`Options::keep` as `opts` say), so that it reads its person's files from their Mac's one store.
/// It hands its card to whoever asks and answers claims while it belongs to no vault, so that its person's Mac adds it
/// to a device vault under their aven (`Node::add_device_vault_with`); from then on it acts as that device vault by its
/// own key.
pub async fn open_agent(shelf: Shelf, name: &str, opts: Options) -> Result<Node> {
    let writer = shelf.writer()?;
    let (secret, suite) = secret(&writer.shelf()).await?;
    open_as(Some(shelf), name, &secret, suite, Options { card: true, ..opts }, Some(writer)).await
}

/// An agent device named `name` whose key is `secret`, in suite `suite`, which its person keeps elsewhere, never on
/// `shelf`: a cloud session's agent, whose key is in its environment's secrets, as theOS showed it once
/// (`sign::kept_secret`); or that key as theOS makes it, on no shelf, for the moment it takes its person's Mac to add
/// it under their aven, which it cosigns (`Node::add_device_vault_with`). Else as `open_agent`.
pub async fn open_agent_with(
    shelf: Option<Shelf>,
    name: &str,
    secret: &[u8; 32],
    suite: Suite,
    opts: Options,
) -> Result<Node> {
    open_as(shelf, name, secret, suite, Options { card: true, ..opts }, None).await
}

/// The node of device `name` whose keys come from `secret`, in suite `suite`, on `shelf`, with `opts`: as the next key
/// its shelf names (`NEXT`) once its key moved, else as itself; with its keys in the other suite beside it, its next
/// key before the move and the key it moved from after it (`Lab::device_keys`), so that it hands its next key to the
/// device of its person's that moves it, and signs as it (`Lab::move_key`, `Lab::accept_claim`). A next key its shelf
/// names that isn't a device of a vault yet, as a shelf that lost the move would open, it doesn't open as: as a device
/// of no vault, a server would take any stranger's claim. One whose key moved and whose shelf doesn't name the next
/// key yet, as a move cut short before it could, it names now and opens as.
async fn open_as(
    shelf: Option<Shelf>,
    name: &str,
    secret: &[u8; 32],
    suite: Suite,
    opts: Options,
    writer: Option<Writer>,
) -> Result<Node> {
    let named = match &shelf {
        Some(shelf) => shelf.get(NEXT).await.context("the shelf's next key")?,
        None => None,
    };
    let next = named.map(|b| <[u8; 32]>::try_from(&b[..]).map(SignerId)).transpose();
    let next = next.map_err(|_| anyhow!("the shelf's {NEXT} holds no key's id"))?;
    let spawn = |next: Option<SignerId>, writer: Option<Writer>| {
        let opts = Options { shelf: shelf.clone(), ..opts.clone() };
        async move {
            let mut lab = Lab::with_entropy(*random()?);
            let me = match next {
                Some(next) => {
                    lab.device_as(name, *secret, next).with_context(|| format!("{NEXT} names another's key"))?
                }
                None => lab.device_with_in(name, *secret, suite),
            };
            lab.device_keys(me, *secret);
            match writer {
                Some(writer) => Node::spawn_owned(lab, me, opts, Some(writer)).await,
                None => Node::spawn(lab, me, opts).await,
            }
        }
    };
    let node = spawn(next, writer).await?;
    if next.is_some() && vault(&node).await.is_none() {
        tracing::warn!("avendb: {name}'s next key is a device of no vault on its shelf: it opens as its earlier key");
        node.shutdown().await?;
        return spawn(None, None).await;
    }
    if next.is_some() {
        // the keeps the key it moved from held, carried to its next key where the move's claim didn't carry them
        let earlier = sign::DeviceKey::from_secret_in(*secret, suite).id();
        if let Err(why) = node.try_act(move |lab, me| lab.finish_move(me, &[(earlier, me)])).await? {
            tracing::warn!("avendb: {name}'s keeps aren't carried to its next key: {why:?}");
        }
    }
    match moved(&node).await {
        Some(next) if shelf.is_some() => {
            name_next(node.shared.clone(), next).await;
            node.shutdown().await?;
            spawn(Some(next), None).await
        }
        _ => Ok(node),
    }
}

/// The vault the node's device belongs to, as its view has it: avenMAIA, once a device claimed the server; an
/// agent's device vault, once its person's Mac added it.
pub async fn vault(node: &Node) -> Option<VaultId> {
    node.read(|lab, me| lab.vault_of(me)).await
}

/// The next key of the node's device, once its key moved (the key move, K3c): once that key is a device of the vault
/// the device belongs to, beside it (`Lab::draft_move`). None before, or for a device that signs in that suite.
pub async fn moved(node: &Node) -> Option<SignerId> {
    node.read(|lab, me| {
        let (vault, next) = (lab.vault_of(me)?, lab.next_key(me)?);
        lab.state(me).is_device(next, vault).then_some(next)
    })
    .await
}

/// Names the node's device's next key on its shelf once its key moved (`moved`, `name_next`), as a device learns it
/// from its peers, a cloud session's agent from the server's card: whether it moved, to open again as that key.
pub async fn follow(node: &Node) -> bool {
    let Some(next) = moved(node).await else { return false };
    name_next(node.shared.clone(), next).await;
    true
}

/// How long a device whose key moved waits for its shelf to hold the move before it names its next key there
/// (`name_next`), at most.
const SHELVING: Duration = Duration::from_secs(120);

/// Names `next`, the device's next key, on its shelf (`NEXT`), once its key moved, as it took the move's claim
/// (`Lab::accept_claim`): once its shelf holds the move, so that it opens as that key from its next start, a device of
/// its vault, never one of none. A device with no shelf names nothing, and opens as before.
pub(crate) async fn name_next(shared: Arc<Shared>, next: SignerId) {
    let Ok(_activity) = shared.admit() else { return };
    let Some(shelf) = shared.opts.shelf.clone() else { return };
    let (mut waited, step) = (Duration::ZERO, Duration::from_secs(1));
    loop {
        if shared.admit().is_err() {
            return;
        }
        shared.save().await.ok();
        let on = shared.clone();
        let behind = shared.read(move |lab, me| on.edits.as_ref().is_some_and(|edits| edits.lacks(lab, me))).await;
        if !behind {
            break;
        }
        if waited >= SHELVING {
            tracing::warn!("avendb: its shelf doesn't hold its key move yet: it opens as its next key once it does");
            return;
        }
        n0_future::time::sleep(step).await;
        waited += step;
    }
    match shelf.put(NEXT, Bytes::copy_from_slice(&next.0)).await {
        Ok(()) => tracing::info!("avendb: it opens as its next key {next:?} from its next start"),
        Err(e) if e.kind() == ErrorKind::AlreadyExists => {}
        Err(e) => tracing::warn!("avendb: its next key isn't named on its shelf: {e:#}"),
    }
}

/// The keys an agent's device on `shelf` may be, the one to try first first: its next key, where its shelf names one
/// its secret makes in either suite, then its own key (`open_as`). An agent that never ran gets its secret on its shelf
/// now, its one key in the suite new signers are made in.
pub async fn agent_keys(shelf: &Shelf) -> Result<Vec<sign::DeviceKey>> {
    let (secret, suite) = if shelf.get(SECRET).await?.is_some() {
        secret(shelf).await?
    } else {
        let writer = shelf.writer()?;
        let found = secret(&writer.shelf()).await?;
        writer.shutdown().await?;
        found
    };
    let named = shelf.get(NEXT).await.context("the shelf's next key")?;
    let next = named.and_then(|b| <[u8; 32]>::try_from(&b[..]).ok()).map(SignerId);
    let mut keys = vec![];
    if let Some(next) = next {
        let moved = sign::SUITES.into_iter().map(|s| sign::DeviceKey::from_secret_in(*secret, s));
        keys.extend(moved.filter(|k| k.id() == next));
    }
    let own = sign::DeviceKey::from_secret_in(*secret, suite);
    if keys.iter().all(|k| k.id() != own.id()) {
        keys.push(own);
    }
    Ok(keys)
}

/// The device's secret on `shelf` and its suite, or a new one put there, in the suite new signers are made in.
async fn secret(shelf: &Shelf) -> Result<(Zeroizing<[u8; 32]>, Suite)> {
    for _ in 0..2 {
        if let Some(bytes) = shelf.get(SECRET).await.context("the server's secret")? {
            let secret = sign::kept_secret_of(&bytes);
            if let Ok(mut bytes) = bytes.try_into_mut() {
                bytes[..].zeroize();
            }
            return secret.ok_or_else(|| anyhow!("the shelf's {SECRET} holds no device's secret"));
        }
        let secret = random()?;
        match shelf.put(SECRET, Bytes::copy_from_slice(&sign::kept_secret(&secret, sign::SIGNING))).await {
            Ok(()) => return Ok((secret, sign::SIGNING)),
            // put meanwhile: that one it is
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e).context("the server's secret"),
        }
    }
    Err(anyhow!("the server's secret is neither on its shelf nor put there"))
}

/// 32 bytes of the machine's own randomness, wiped as they are dropped.
pub fn random() -> Result<Zeroizing<[u8; 32]>> {
    let mut bytes = Zeroizing::new([0; 32]);
    getrandom::fill(&mut *bytes).map_err(|e| anyhow!("no randomness from the machine: {e}"))?;
    Ok(bytes)
}

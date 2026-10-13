//! The server peer (P8b): a node in a folder of its own, its device's secret beside its store. At its first start it
//! makes that secret, and belongs to no vault until the first human vault to claim it does (P8f, `Node::claim`,
//! `Node::found_with`): from then on it is a device of avenCEO, an aven vault that human vault owns, which it acts for
//! and never governs, and it starts again from what the folder holds. It hands its contact card, avenCEO's log, to
//! whoever asks, so that a vault can give avenCEO relay on its entries; it holds only ciphertext, and opens nothing but
//! what is public and avenCEO's own. Its relay (the `avendb-server` binary) lets in only the devices it knows
//! (`Admission`). With a bucket (blobs B3a, `bucket`), its store lives there, and so does its device's secret, sealed:
//! a server whose folder is lost starts again from the bucket as the same device.

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write as _};
use std::path::Path;

use anyhow::{Context as _, Result, anyhow};
use avendb::id::VaultId;
use avendb::lab::Lab;
use zeroize::Zeroizing;

use crate::{Node, Options};

/// The file in the server's folder that holds its device's secret.
pub const SECRET: &str = "device.key";

/// The server's node in folder `dir`, made if there is none, with `opts` for its network: its device's secret read
/// from the folder, or made at its first start and written there, readable by its owner alone; and its store beside
/// it, where it keeps whole every file the edits it holds bring (`Options::keep`). With a bucket (`Options::bucket`),
/// the secret is in the bucket too (`kept`). It hands its contact card to whoever asks, and the first human vault to
/// claim it owns it.
pub async fn open(dir: &Path, opts: Options) -> Result<Node> {
    fs::create_dir_all(dir).with_context(|| format!("the server's folder, {}", dir.display()))?;
    #[cfg(not(target_arch = "wasm32"))]
    let secret = match &opts.bucket {
        Some(bucket) => kept(&dir.join(SECRET), bucket).await?,
        None => secret(&dir.join(SECRET))?,
    };
    #[cfg(target_arch = "wasm32")]
    let secret = secret(&dir.join(SECRET))?;
    let mut lab = Lab::with_entropy(*random()?);
    let me = lab.device_with("the server", *secret);
    Node::spawn(lab, me, Options { store: Some(dir.to_path_buf()), keep: true, card: true, ..opts }).await
}

/// The vault the node's device belongs to, as its view has it: avenCEO, once a device claimed the server.
pub async fn vault(node: &Node) -> Option<VaultId> {
    node.read(|lab, me| lab.vault_of(me)).await
}

/// The device's secret as folder and bucket hold it (blobs B3a): the folder's, put in the bucket if the bucket holds
/// none; else the bucket's, written to the folder if the folder holds none, so a server whose folder is lost is the
/// same device again. A folder and a bucket that hold two secrets are two servers': it doesn't start.
#[cfg(not(target_arch = "wasm32"))]
async fn kept(path: &Path, bucket: &crate::bucket::Sealed) -> Result<Zeroizing<[u8; 32]>> {
    let there = bucket.get(SECRET).await?.map(Zeroizing::new);
    let there = there.map(|bytes| sized(&bytes, "the bucket's secret")).transpose()?;
    match (there, path.exists()) {
        (Some(secret), false) => {
            write(path, &secret)?;
            Ok(secret)
        }
        (Some(theirs), true) => {
            let secret = secret(path)?;
            if *secret != *theirs {
                let path = path.display();
                return Err(anyhow!("{path} and the bucket hold two servers' secrets: is the bucket another server's?"));
            }
            Ok(secret)
        }
        (None, _) => {
            let secret = secret(path)?;
            bucket.put(SECRET, &*secret).await?;
            Ok(secret)
        }
    }
}

/// The device's secret in `path`, or a new one written there, readable by its owner alone.
fn secret(path: &Path) -> Result<Zeroizing<[u8; 32]>> {
    match fs::read(path).map(Zeroizing::new) {
        Ok(bytes) => sized(&bytes, &path.display().to_string()),
        Err(e) if e.kind() == ErrorKind::NotFound => {
            let secret = random()?;
            write(path, &secret)?;
            Ok(secret)
        }
        Err(e) => Err(e.into()),
    }
}

/// `bytes` as a 32-byte secret, which `what` must hold.
fn sized(bytes: &[u8], what: &str) -> Result<Zeroizing<[u8; 32]>> {
    let secret = <[u8; 32]>::try_from(bytes).map_err(|_| anyhow!("{what} holds no 32-byte secret"))?;
    Ok(Zeroizing::new(secret))
}

/// Writes `secret` to `path`, where there is none yet, readable by its owner alone.
fn write(path: &Path, secret: &[u8; 32]) -> Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(path).with_context(|| format!("the server's secret, {}", path.display()))?;
    file.write_all(secret)?;
    Ok(file.sync_all()?)
}

/// 32 bytes of the machine's own randomness, wiped as they are dropped.
pub(crate) fn random() -> Result<Zeroizing<[u8; 32]>> {
    let mut bytes = Zeroizing::new([0; 32]);
    getrandom::fill(&mut *bytes).map_err(|e| anyhow!("no randomness from the machine: {e}"))?;
    Ok(bytes)
}

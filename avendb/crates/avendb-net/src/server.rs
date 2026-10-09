//! The server peer (P8b): a node in a folder of its own, its device's secret beside its store. At its first start it
//! makes that secret, and founds its vault with an owner key it then forgets (`Lab::found_server`), so nobody changes
//! the vault after; from then on it starts again from what the folder holds. It hands its contact card, its vault's
//! log, to whoever asks, so that a device can grant it relay on a space; it holds only ciphertext, and opens nothing
//! but what is public. Its relay (the `avendb-server` binary) lets in only the devices it knows (`Admission`).

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
/// from the folder, or made at its first start and written there, readable by its owner alone; its store beside it;
/// and its vault, founded at its first start. It hands its contact card to whoever asks.
pub async fn open(dir: &Path, opts: Options) -> Result<Node> {
    fs::create_dir_all(dir).with_context(|| format!("the server's folder, {}", dir.display()))?;
    let secret = secret(&dir.join(SECRET))?;
    let mut lab = Lab::with_entropy(*random()?);
    let me = lab.device_with("the server", *secret);
    let node = Node::spawn(lab, me, Options { store: Some(dir.to_path_buf()), card: true, ..opts }).await?;
    let owner = random()?;
    let founded = node.act(move |lab, me| lab.vault_of(me).map_or_else(|| lab.found_server(me, *owner), Ok)).await;
    founded.map_err(|why| anyhow!("the server's vault: {why:?}"))?;
    Ok(node)
}

/// The vault the node's device belongs to, as its view has it.
pub async fn vault(node: &Node) -> Option<VaultId> {
    node.read(|lab, me| lab.vault_of(me)).await
}

/// The device's secret in `path`, or a new one written there, readable by its owner alone.
fn secret(path: &Path) -> Result<Zeroizing<[u8; 32]>> {
    match fs::read(path).map(Zeroizing::new) {
        Ok(bytes) => match <[u8; 32]>::try_from(&bytes[..]) {
            Ok(secret) => Ok(Zeroizing::new(secret)),
            Err(_) => Err(anyhow!("{} holds no 32-byte secret", path.display())),
        },
        Err(e) if e.kind() == ErrorKind::NotFound => {
            let secret = random()?;
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
            let mut file = options.open(path).with_context(|| format!("the server's secret, {}", path.display()))?;
            file.write_all(&*secret)?;
            file.sync_all()?;
            Ok(secret)
        }
        Err(e) => Err(e.into()),
    }
}

/// 32 bytes of the machine's own randomness, wiped as they are dropped.
pub(crate) fn random() -> Result<Zeroizing<[u8; 32]>> {
    let mut bytes = Zeroizing::new([0; 32]);
    getrandom::fill(&mut *bytes).map_err(|e| anyhow!("no randomness from the machine: {e}"))?;
    Ok(bytes)
}

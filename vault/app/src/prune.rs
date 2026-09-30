//! Deleting for real, on this Mac: a file whose description says it is deleted (from any device) is let go of here
//! (`Catalog::purge`: this Mac's holding and records gone), and iroh's garbage collection prunes its bytes once no
//! catalog entry references it any more. Every file with a live description is kept (`Keep`) — until this loop has
//! told the store which those are, it prunes nothing.

use std::{collections::HashSet, sync::Arc, time::Duration};

use vault_core::{Vault, catalog::is_deleted};

pub async fn sweep(vault: Arc<Vault>) {
    loop {
        if let Err(e) = once(&vault).await {
            tracing::warn!("prune: {e:#}");
        }
        tokio::time::sleep(Duration::from_secs(60)).await;
    }
}

async fn once(vault: &Vault) -> anyhow::Result<()> {
    let mut keep = HashSet::new();
    for m in vault.catalog.descriptions().await? {
        let Ok(hash) = m.hash.parse::<iroh_blobs::Hash>() else { continue };
        if !is_deleted(&m) {
            keep.insert(hash);
        } else if vault.catalog.holds(hash).await? {
            vault.catalog.purge(hash).await?;
            tracing::info!("let go of {} ({}), deleted", m.original_name, hash.fmt_short());
        }
    }
    vault.keep.set(keep);
    Ok(())
}

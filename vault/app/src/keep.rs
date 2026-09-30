//! What a store keeps — every store the same, the iroh way: this Mac (`avenSSD`) and every drive (drives.rs) are each
//! an iroh node of their own, in the shared catalog, under a store name. Each story's rules name, per class, the
//! stores that keep its files (`Rules`), so a store keeps every file whose story names it for that file's class.
//!
//! One pass (`round`), for any store:
//! - only the catalog's records sync by themselves (download policy: every entry but the files' holdings); a record
//!   whose content never came is fetched from the peers;
//! - a deleted file, and one no story keeps here any more, is let go of (`purge`: its pin, its holding, its records);
//! - every file it keeps that is not here yet is fetched over iroh's blobs protocol from whoever holds it (BLAKE3,
//!   verified as it streams), then pinned (tag `vault/<hash>`) and announced (its own `blobs/<hash>` entry);
//! - then, and only then, garbage collection learns what to keep besides the tags: the records (`Keep`). What no tag
//!   and no record holds — a file let go of — is pruned by iroh.

use std::{
    collections::HashMap,
    sync::{Arc, LazyLock, Mutex},
    time::Duration,
};

use iroh::EndpointId;
use iroh_blobs::api::blobs::BlobStatus;
use serde::Serialize;
use vault_core::{
    Meta, Vault,
    catalog::{Rules, Story, is_deleted},
};

/// This Mac's store name in the stories' rules.
pub const MAC: &str = "avenSSD";

/// How a store stands, for the studio and the agents.
#[derive(Serialize, Clone, Default)]
pub struct StoreState {
    pub name: String,
    pub dir: String,
    pub node: String,
    /// the stories that name it (titles)
    pub stories: Vec<String>,
    pub joined: bool,
    /// files it keeps / holds, and their bytes
    pub wanted: usize,
    pub held: usize,
    pub wanted_bytes: u64,
    pub held_bytes: u64,
    /// what it is doing now, or why it waits
    pub now: String,
    pub errors: Vec<String>,
}

static STATES: LazyLock<Mutex<HashMap<String, StoreState>>> = LazyLock::new(Default::default);

pub fn update(name: &str, f: impl FnOnce(&mut StoreState)) {
    let mut all = STATES.lock().unwrap();
    let s = all.entry(name.to_string()).or_default();
    s.name = name.to_string();
    f(s);
}

/// A store's name, by its node id (what the transfers show as the destination).
pub fn name_of(node: &str) -> Option<String> {
    STATES.lock().unwrap().values().find(|s| s.node == node).map(|s| s.name.clone())
}

/// Every store on this Mac and how it stands.
#[tauri::command]
pub fn stores_status() -> Result<Vec<StoreState>, String> {
    crate::gate()?;
    let mut out: Vec<StoreState> = STATES.lock().unwrap().values().cloned().collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// The stores a rule names for a class.
fn stores<'a>(r: &'a Rules, class: &str) -> &'a [String] {
    match class {
        "original" => &r.original,
        "proxy" => &r.proxy,
        "delivery" => &r.delivery,
        _ => &r.default,
    }
}

/// Does this store keep this file? Its story's rules for its class — a file of the inbox (no story) or of a story not
/// known here yet follows the default rules.
pub fn keeps(name: &str, m: &Meta, stories: &HashMap<&str, &Story>, inbox: &str) -> bool {
    let story = if m.story.is_empty() { inbox } else { m.story.as_str() };
    match stories.get(story) {
        Some(st) => stores(&st.rules, &m.class).iter().any(|s| s == name),
        None => stores(&Rules::default(), &m.class).iter().any(|s| s == name),
    }
}

/// This Mac's pass, every minute: it keeps what its stories name `avenSSD` for, fetched from every peer.
pub async fn sweep(vault: Arc<Vault>) {
    update(MAC, |s| (s.dir, s.node) = (vault.dir.display().to_string(), vault.endpoint.id().to_string()));
    loop {
        let providers = vault.allow.ids();
        update(MAC, |s| s.joined = !providers.is_empty());
        if let Err(e) = round(&vault, MAC, &providers).await {
            update(MAC, |s| s.errors = vec![format!("{e:#}")]);
            tracing::warn!("keep {MAC}: {e:#}");
        }
        tokio::time::sleep(Duration::from_secs(60)).await;
    }
}

/// One pass of a store named `name`, fetching from `providers` (tried in order).
pub async fn round(vault: &Vault, name: &str, providers: &[EndpointId]) -> anyhow::Result<()> {
    use iroh_docs::store::{DownloadPolicy, FilterKind};
    vault.catalog.doc().set_download_policy(DownloadPolicy::EverythingExcept(vec![FilterKind::Prefix("blobs/".into())])).await?;
    let downloader = vault.store.downloader(&vault.endpoint);

    // records whose content never came (their entry came first, from a peer that lacked it)
    let missing = vault.catalog.missing_records().await?;
    if !missing.is_empty() && !providers.is_empty() {
        update(name, |s| s.now = format!("fetching {} records", missing.len()));
        for h in &missing {
            if let Err(e) = downloader.download(*h, providers.to_vec()).await {
                tracing::debug!("{name}: record {}: {e:#}", h.fmt_short());
            }
        }
    }

    let stories = vault.catalog.stories().await?;
    let by_id: HashMap<&str, &Story> = stories.iter().map(|st| (st.id.as_str(), st)).collect();
    let inbox = vault.catalog.inbox_id();
    update(name, |s| {
        s.stories = stories.iter().filter(|st| vault_core::catalog::CLASSES.iter().any(|c| stores(&st.rules, c).iter().any(|x| x == name))).map(|st| st.title.clone()).collect()
    });

    // let go of what is deleted, and of what no story keeps here any more
    let all = vault.catalog.descriptions().await?;
    for m in &all {
        let Ok(hash) = m.hash.parse::<iroh_blobs::Hash>() else { continue };
        if (is_deleted(m) || !keeps(name, m, &by_id, &inbox)) && vault.catalog.holds(hash).await? {
            vault.catalog.purge(hash).await?;
            let why = if is_deleted(m) { "deleted" } else { "its story keeps it elsewhere" };
            tracing::info!("{name}: let go of {} ({why})", m.original_name);
        }
    }

    // fetch, pin and announce what it keeps
    let wanted: Vec<&Meta> = all.iter().filter(|m| !is_deleted(m) && keeps(name, m, &by_id, &inbox)).collect();
    let (wanted_n, wanted_bytes) = (wanted.len(), wanted.iter().map(|m| m.size).sum::<u64>());
    let (mut held, mut held_bytes, mut errors) = (0usize, 0u64, Vec::new());
    for m in wanted {
        let Ok(hash) = m.hash.parse::<iroh_blobs::Hash>() else { continue };
        if !matches!(vault.store.blobs().status(hash).await?, BlobStatus::Complete { .. }) {
            if providers.is_empty() {
                continue;
            }
            update(name, |s| s.now = format!("fetching {} ({:.1} MB)", m.original_name, m.size as f64 / 1e6));
            if let Err(e) = downloader.download(hash, providers.to_vec()).await {
                errors.push(format!("{}: {e:#}", m.original_name));
                continue;
            }
        }
        if !(vault.catalog.pinned(hash).await? && vault.catalog.announced(hash).await?) {
            vault.catalog.hold(hash, m.size).await?;
        }
        held += 1;
        held_bytes += m.size;
        update(name, |s| (s.wanted, s.held, s.wanted_bytes, s.held_bytes) = (wanted_n, held, wanted_bytes, held_bytes));
    }

    // every file it keeps is pinned now: garbage collection may run, keeping the tags and the records
    vault.keep.set(vault.catalog.record_hashes().await?);
    let done = held == wanted_n;
    update(name, |s| {
        (s.wanted, s.held, s.wanted_bytes, s.held_bytes) = (wanted_n, held, wanted_bytes, held_bytes);
        s.now = if done { "complete: every file it keeps is here, verified".into() } else { format!("{} files still to come", wanted_n - held) };
        s.errors = errors.into_iter().take(10).collect();
    });
    tracing::info!("{name}: {held}/{wanted_n} files held ({:.2} GB) · {} files described", held_bytes as f64 / 1e9, all.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn story(id: &str, rules: Rules) -> Story {
        Story { id: id.into(), title: id.into(), rules, ..Default::default() }
    }
    fn meta(story: &str, class: &str) -> Meta {
        serde_json::from_value(serde_json::json!({ "hash": "00", "size": 1, "mime": "video/quicktime", "kind": "video", "story": story, "class": class })).unwrap()
    }

    #[test]
    fn a_store_keeps_what_its_stories_name_it_for() {
        let mut day1 = Rules::default();
        day1.original.push("SDD_A".into());
        let (a, b) = (story("day1", day1), story("inbox", Rules::default()));
        let by_id: HashMap<&str, &Story> = [("day1", &a), ("inbox", &b)].into_iter().collect();
        assert!(keeps("SDD_A", &meta("day1", "original"), &by_id, "inbox"));
        assert!(!keeps("SDD_A", &meta("day1", "proxy"), &by_id, "inbox"));
        assert!(!keeps("SDD_A", &meta("", "original"), &by_id, "inbox"));
        assert!(keeps(MAC, &meta("", "default"), &by_id, "inbox"));
        // a story not known here yet: the default rules
        assert!(keeps(MAC, &meta("elsewhere", "proxy"), &by_id, "inbox"));
        assert!(!keeps("SDD_A", &meta("elsewhere", "proxy"), &by_id, "inbox"));
    }
}

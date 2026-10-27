//! The blind index on the wire (P4 of sync v2, `BlindIndex.lean`, `avendb::index`). It replaces the type discovery
//! hints, which only a peer that reads could answer.
//!
//! A device tells each peer that keeps an index (`Options::index`, the server's) the rows of the entries it reads, vault
//! by vault: it offers a digest of each vault's rows (`OFFER`), and sends all rows of each vault whose digest the peer
//! lacks (`ROWS`), which replace what it told of that vault before. It offers again when a peer connects and when its
//! own entries change, never on a timer. The peer takes a row only of an entry the device syncs by its view, keeps the
//! rows on its shelf (`slots/index/`), and answers `find` from them.
//!
//! `find` (`FIND`) asks for the entries carrying one of some tokens, a page at a time after the last entry it got. Any
//! peer answers: one that reads from its own entries (`Lab::find_local`), one that keeps an index from its rows too,
//! each only with the entries the asking device syncs by the peer's view (`find_within_T12`). So a new device finds its
//! rooms from the server in one round trip, then brings their logs by sync, which alone hands it edits and files (T12,
//! T27).

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use anyhow::{Context as _, Result, ensure};
use avendb::id::{EntryId, VaultId};
use avendb::index::{self, Row, Token};
use avendb::sync::LogId;
use iroh::EndpointId;
use n0_future::time::{self, Duration};

use crate::{Peer, Shared, session};

/// A device offers the digest of its rows of each vault; the answer names the vaults the peer wants rows of.
pub(crate) const OFFER: u8 = 40;
/// A device tells all its rows of one vault; the answer says how many the peer took.
pub(crate) const ROWS: u8 = 41;
/// A device asks which entries carry one of some tokens.
pub(crate) const FIND: u8 = 42;

const VERSION: u8 = 1;
/// The most vaults one offer names.
const OFFER_VAULTS: usize = 1024;
pub(crate) const OFFER_LIMIT: usize = 2 + OFFER_VAULTS * 64 + 8;
/// The most rows one vault's message carries, and its bytes.
const VAULT_ROWS: usize = 1 << 20;
pub(crate) const ROWS_LIMIT: usize = 32 << 20;
/// The most vaults a find request names to follow.
const FIND_FOLLOW: usize = 64;
pub(crate) const FIND_LIMIT: usize = 4 + 32 + 32 + 1 + FIND_FOLLOW * 32 + 2 + index::FIND_TOKENS * 16;
const FIND_REPLY_LIMIT: usize = 4 + index::FIND_PAGE * 32;
/// How long a peer has to answer one message.
const WAIT: Duration = Duration::from_secs(10);
/// The most pages of one find a device asks one peer for.
const FIND_PAGES: usize = 64;
/// Where an older node's shelf kept the rows of each vault, and the list of those vaults: read once, as its told index
/// takes them in (`older_rows`), and left where they are, as everything on a shelf is.
const SHELVED: &str = "slots/index/";
const SHELVED_LIST: &str = "slots/index/vaults";
/// How long a device lets its entries settle before it offers its rows again.
const SETTLE: Duration = Duration::from_secs(2);

fn read_array<const N: usize>(bytes: &[u8], at: &mut usize) -> Result<[u8; N]> {
    let end = at.checked_add(N).context("overflow")?;
    let out = bytes.get(*at..end).context("short message")?.try_into().expect("N bytes");
    *at = end;
    Ok(out)
}

fn done(bytes: &[u8], at: usize) -> Result<()> {
    ensure!(at == bytes.len(), "trailing bytes");
    Ok(())
}

/// The rows an older node kept on `shelf`, one vault a blob (`slots/index/`), for the told index to take in once
/// (`ToldIndex::open`); none where it kept none.
pub(crate) async fn older_rows(shelf: &crate::shelf::Shelf) -> Option<index::Rows> {
    let list = shelf.get(SHELVED_LIST).await.ok()??;
    let Ok(vaults) = vaults_of(&list) else {
        tracing::warn!("avendb: {SHELVED_LIST} on the shelf doesn't read");
        return None;
    };
    let mut rows = index::Rows::default();
    for v in vaults {
        let name = format!("{SHELVED}{}", v.to_hex());
        let Ok(Some(bytes)) = shelf.get(&name).await else { continue };
        if rows.decode_vault(&bytes) != Some(v) {
            tracing::warn!("avendb: {name} on the shelf doesn't read");
        }
    }
    Some(rows)
}

/// An offer: the digest of the device's rows of each vault.
fn offer_wire(vaults: &[(VaultId, [u8; 32])]) -> Vec<u8> {
    let mut out = vec![VERSION];
    out.extend_from_slice(&(vaults.len() as u16).to_be_bytes());
    for (v, d) in vaults {
        out.extend_from_slice(&v.0);
        out.extend_from_slice(d);
    }
    out
}

fn offer_of(bytes: &[u8]) -> Result<Vec<(VaultId, [u8; 32])>> {
    ensure!(bytes.first() == Some(&VERSION), "unsupported index offer");
    let mut at = 1;
    let n = u16::from_be_bytes(read_array(bytes, &mut at)?) as usize;
    ensure!(n <= OFFER_VAULTS, "too many vaults");
    let mut out = Vec::with_capacity(n);
    for _ in 0..n {
        out.push((VaultId(read_array(bytes, &mut at)?), read_array(bytes, &mut at)?));
    }
    done(bytes, at)?;
    Ok(out)
}

fn vaults_wire(vaults: &[VaultId]) -> Vec<u8> {
    let mut out = vec![VERSION];
    out.extend_from_slice(&(vaults.len() as u16).to_be_bytes());
    for v in vaults {
        out.extend_from_slice(&v.0);
    }
    out
}

fn vaults_of(bytes: &[u8]) -> Result<Vec<VaultId>> {
    ensure!(bytes.first() == Some(&VERSION), "unsupported index answer");
    let mut at = 1;
    let n = u16::from_be_bytes(read_array(bytes, &mut at)?) as usize;
    ensure!(n <= OFFER_VAULTS, "too many vaults");
    let out = (0..n).map(|_| read_array(bytes, &mut at).map(VaultId)).collect::<Result<Vec<_>>>()?;
    done(bytes, at)?;
    Ok(out)
}

fn rows_wire(vault: VaultId, rows: &[Row]) -> Vec<u8> {
    let mut out = vec![VERSION];
    out.extend_from_slice(&vault.0);
    out.extend_from_slice(&(rows.len() as u32).to_be_bytes());
    for r in rows {
        out.extend_from_slice(&r.entry.0);
        out.extend_from_slice(&r.epoch.to_be_bytes());
        out.push(r.tokens.len() as u8);
        for t in &r.tokens {
            out.extend_from_slice(t);
        }
    }
    out
}

fn rows_of(bytes: &[u8]) -> Result<(VaultId, Vec<Row>)> {
    ensure!(bytes.first() == Some(&VERSION), "unsupported index rows");
    let mut at = 1;
    let vault = VaultId(read_array(bytes, &mut at)?);
    let n = u32::from_be_bytes(read_array(bytes, &mut at)?) as usize;
    ensure!(n <= VAULT_ROWS, "too many rows");
    let mut rows = Vec::with_capacity(n.min(1 << 16));
    for _ in 0..n {
        let entry = EntryId(read_array(bytes, &mut at)?);
        let epoch = u64::from_be_bytes(read_array(bytes, &mut at)?);
        let k = read_array::<1>(bytes, &mut at)?[0] as usize;
        ensure!(k <= index::ROW_TOKENS, "too many tokens");
        let tokens = (0..k).map(|_| read_array(bytes, &mut at)).collect::<Result<Vec<Token>>>()?;
        rows.push(Row { entry, epoch, tokens });
    }
    done(bytes, at)?;
    Ok((vault, rows))
}

/// A find request: the vault it asks of (all it may receive of, for `None`), after which entry, the vaults the asking
/// device follows, and the tokens.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Find {
    pub vault: Option<VaultId>,
    pub after: Option<EntryId>,
    pub follow: Vec<VaultId>,
    pub tokens: Vec<Token>,
}

impl Find {
    fn wire(&self) -> Vec<u8> {
        let mut out = vec![VERSION, self.vault.is_some() as u8 | (self.after.is_some() as u8) << 1];
        if let Some(v) = self.vault {
            out.extend_from_slice(&v.0);
        }
        if let Some(a) = self.after {
            out.extend_from_slice(&a.0);
        }
        out.push(self.follow.len() as u8);
        for v in &self.follow {
            out.extend_from_slice(&v.0);
        }
        out.extend_from_slice(&(self.tokens.len() as u16).to_be_bytes());
        for t in &self.tokens {
            out.extend_from_slice(t);
        }
        out
    }

    fn of(bytes: &[u8]) -> Result<Find> {
        ensure!(bytes.len() <= FIND_LIMIT, "find request too large");
        ensure!(bytes.first() == Some(&VERSION), "unsupported find");
        let mut at = 1;
        let flags = read_array::<1>(bytes, &mut at)?[0];
        ensure!(flags < 4, "unknown find flags");
        let vault = (flags & 1 != 0).then(|| read_array(bytes, &mut at).map(VaultId)).transpose()?;
        let after = (flags & 2 != 0).then(|| read_array(bytes, &mut at).map(EntryId)).transpose()?;
        let nf = read_array::<1>(bytes, &mut at)?[0] as usize;
        ensure!(nf <= FIND_FOLLOW, "too many followed vaults");
        let follow = (0..nf).map(|_| read_array(bytes, &mut at).map(VaultId)).collect::<Result<Vec<_>>>()?;
        let nt = u16::from_be_bytes(read_array(bytes, &mut at)?) as usize;
        ensure!(nt > 0 && nt <= index::FIND_TOKENS, "a find asks for 1 to {} tokens", index::FIND_TOKENS);
        let tokens = (0..nt).map(|_| read_array(bytes, &mut at)).collect::<Result<Vec<Token>>>()?;
        done(bytes, at)?;
        Ok(Find { vault, after, follow, tokens })
    }
}

fn found_wire(entries: &[EntryId], more: bool) -> Vec<u8> {
    let mut out = vec![VERSION, more as u8];
    out.extend_from_slice(&(entries.len() as u16).to_be_bytes());
    for e in entries {
        out.extend_from_slice(&e.0);
    }
    out
}

fn found_of(bytes: &[u8]) -> Result<(Vec<EntryId>, bool)> {
    ensure!(bytes.first() == Some(&VERSION), "unsupported find answer");
    let mut at = 1;
    let more = read_array::<1>(bytes, &mut at)?[0];
    ensure!(more < 2, "bad find answer");
    let n = u16::from_be_bytes(read_array(bytes, &mut at)?) as usize;
    ensure!(n <= index::FIND_PAGE, "too many entries");
    let entries = (0..n).map(|_| read_array(bytes, &mut at).map(EntryId)).collect::<Result<Vec<_>>>()?;
    done(bytes, at)?;
    Ok((entries, more == 1))
}

/// What a device found by `find`: the entries, each with a peer that named it, and how many peers answered of how many
/// it asked.
#[derive(Clone, Debug, Default)]
pub struct Found {
    pub entries: Vec<(EntryId, Option<EndpointId>)>,
    pub asked: usize,
    pub answered: usize,
}

impl Shared {
    /// The answer to `OFFER` from `peer`: the vaults whose rows it lacks, none where the node keeps no index.
    pub(crate) async fn answer_offer(self: &Arc<Self>, peer: &Peer, bytes: &[u8]) -> Result<Vec<u8>> {
        let offered = offer_of(bytes)?;
        let Some(told) = &self.told_rows else {
            return Ok(vaults_wire(&[]));
        };
        let device = peer.device;
        let mut wanted = Vec::new();
        for (v, d) in offered {
            if told.told(device, v).await? != Some(d) {
                wanted.push(v);
            }
        }
        Ok(vaults_wire(&wanted))
    }

    /// The answer to `ROWS` from `peer`: the rows taken of the entries the device syncs by the node's view, on the
    /// node's told index (`told_index`), on its shelf before it answers.
    pub(crate) async fn answer_rows(self: &Arc<Self>, peer: &Peer, bytes: &[u8]) -> Result<Vec<u8>> {
        let told = self.told_rows.as_ref().context("this node keeps no index")?;
        let (vault, rows) = rows_of(bytes)?;
        let device = peer.device;
        let entries: Vec<EntryId> = rows.iter().map(|r| r.entry).collect();
        let syncs: BTreeSet<EntryId> =
            self.read(move |lab, me| lab.syncs_entries(me, device, &[], &entries)).await.into_iter().collect();
        let taken = told.take(device, vault, rows, |e| syncs.contains(&e)).await?;
        Ok((taken as u32).to_be_bytes().to_vec())
    }

    /// The answer to `FIND` from `peer`: from the node's own entries, and its rows if it keeps an index, only what the
    /// device syncs by its view.
    pub(crate) async fn answer_find(self: &Arc<Self>, peer: &Peer, bytes: &[u8]) -> Result<Vec<u8>> {
        let find = Find::of(bytes)?;
        let device = peer.device;
        // its told rows, the smallest first, a page and one more of those the device syncs, read off the shelf a
        // stretch at a time, each stretch held to the node's view
        let mut rows = Vec::new();
        if let Some(told) = &self.told_rows {
            let mut after = find.after;
            loop {
                let (got, more) = told.candidates(find.vault, &find.tokens, after, 2 * index::FIND_PAGE).await?;
                after = got.last().copied().or(after);
                let follow = find.follow.clone();
                let syncing: Vec<EntryId> = self
                    .read(move |lab, me| {
                        let syncing = lab.syncing(me, device, &follow);
                        got.into_iter().filter(|e| syncing.log(LogId::Entry(*e))).collect()
                    })
                    .await;
                rows.extend(syncing);
                if rows.len() > index::FIND_PAGE || !more {
                    break;
                }
            }
        }
        let (entries, more) = self
            .read(move |lab, me| {
                let (found, more) = lab.find_local(me, device, &find.follow, find.vault, &find.tokens, find.after);
                let rows_more = rows.len() > index::FIND_PAGE;
                let mut all: Vec<EntryId> =
                    found.into_iter().chain(rows).collect::<BTreeSet<EntryId>>().into_iter().collect();
                let more = more || rows_more || all.len() > index::FIND_PAGE;
                all.truncate(index::FIND_PAGE);
                (all, more)
            })
            .await;
        Ok(found_wire(&entries, more))
    }

    /// Tells each live peer that keeps an index the rows it lacks, once a peer connects or the device's entries change
    /// (`size`): never on a timer.
    pub(crate) async fn index_teller(self: Arc<Self>) {
        let mut size = self.size.subscribe();
        // how many times the device's entries changed: each a reason to tell again
        let mut revision = 0u64;
        let mut young;
        loop {
            {
                let Ok(_activity) = self.admit() else { break };
                time::sleep(SETTLE).await;
                if size.has_changed().unwrap_or(false) {
                    size.borrow_and_update();
                    revision += 1;
                }
                let peers: Vec<Peer> = self
                    .peers
                    .lock()
                    .expect("peers")
                    .values()
                    .filter(|p| p.conn.close_reason().is_none())
                    .cloned()
                    .collect();
                // a peer just met hears its announcements first: the index waits until the connection settled
                let settled = |p: &Peer| crate::jobs::now_ms().saturating_sub(p.since) >= SETTLE.as_millis() as u64;
                young = peers.iter().any(|p| !settled(p));
                let due: Vec<Peer> = {
                    let told = self.index_told.lock().expect("index told");
                    peers.into_iter().filter(|p| settled(p) && told.get(&p.endpoint) != Some(&Some(revision))).collect()
                };
                if !due.is_empty() {
                    let offer = self
                        .read(|lab, me| {
                            lab.index_vaults(me)
                                .into_iter()
                                .take(OFFER_VAULTS)
                                .map(|v| {
                                    let rows = lab.index_rows(me, v);
                                    (v, index::digest(v, &rows), rows)
                                })
                                .collect::<Vec<_>>()
                        })
                        .await;
                    for peer in due {
                        let told = self.tell_index(&peer, &offer).await;
                        // a peer that keeps no index, or knows no such message, is told nothing again on this connection
                        self.index_told.lock().expect("index told").insert(peer.endpoint, told.map(|_| revision).ok());
                    }
                }
            }
            tokio::select! {
                changed = size.changed() => match changed {
                    Ok(()) => revision += 1,
                    Err(_) => break,
                },
                _ = self.index_due.notified() => {},
                _ = time::sleep(SETTLE), if young => {},
            }
        }
    }

    /// Offers `peer` the digests of `offer`'s vaults, then sends the rows of each it wants.
    async fn tell_index(&self, peer: &Peer, offer: &[(VaultId, [u8; 32], Vec<Row>)]) -> Result<()> {
        let digests: Vec<(VaultId, [u8; 32])> = offer.iter().map(|(v, d, _)| (*v, *d)).collect();
        let answer = time::timeout(WAIT, session::exchange(&peer.conn, OFFER, &offer_wire(&digests), OFFER_LIMIT))
            .await
            .context("index offer deadline")??;
        let wanted: BTreeSet<VaultId> = vaults_of(&answer)?.into_iter().collect();
        for (v, _, rows) in offer.iter().filter(|(v, _, _)| wanted.contains(v)) {
            let body = rows_wire(*v, rows);
            time::timeout(WAIT, session::exchange(&peer.conn, ROWS, &body, 16)).await.context("index rows deadline")??;
        }
        Ok(())
    }

    /// The tokens the device asks `find` for, for the entries of vault `vault` (of every vault it holds an audience key
    /// of, for `None`) with one of `labels`. Where it holds no key of the vault's audiences yet, as a new device that
    /// took no audience's log, it first brings from each live peer the logs that are no entry's (who may do what, and
    /// the audiences' keys), and opens them.
    pub(crate) async fn find_tokens(self: &Arc<Self>, vault: Option<VaultId>, labels: Vec<String>) -> Vec<Token> {
        let compute = |labels: Vec<String>| {
            self.read(move |lab, me| {
                let vaults = match vault {
                    Some(v) => vec![v],
                    None => lab.index_vaults(me),
                };
                let mut out: Vec<Token> = vaults.into_iter().flat_map(|v| lab.find_tokens(me, v, &labels)).collect();
                out.sort();
                out.dedup();
                out
            })
        };
        let tokens = compute(labels.clone()).await;
        if !tokens.is_empty() {
            return tokens;
        }
        let peers: Vec<EndpointId> = self
            .peers
            .lock()
            .expect("peers")
            .values()
            .filter(|p| p.conn.close_reason().is_none())
            .map(|p| p.endpoint)
            .collect();
        for peer in peers {
            let _ = time::timeout(WAIT, self.asking(peer, crate::Scope::Vaults(BTreeSet::new()))).await;
        }
        let _ = time::timeout(WAIT, self.catch_up_paced_class(true, crate::lab_schedule::Class::Foreground)).await;
        compute(labels).await
    }

    /// Finds the entries of vault `vault` with one of `labels` (`index::type_label`, `index::tag_label`): those the
    /// device reads itself, and those each live peer names, every page of each, asked of all at once. Empty where the
    /// device holds no key of the vault's audiences.
    pub(crate) async fn find(self: &Arc<Self>, vault: VaultId, labels: Vec<String>, follow: Vec<VaultId>) -> Found {
        let tokens = self.find_tokens(Some(vault), labels).await;
        let (tokens, local) = {
            let follow = follow.clone();
            self.read(move |lab, me| {
                let local = if tokens.is_empty() {
                    vec![]
                } else {
                    let mut all = Vec::new();
                    let mut after = None;
                    loop {
                        let (page, more) = lab.find_local(me, me, &follow, Some(vault), &tokens, after);
                        after = page.last().copied();
                        all.extend(page);
                        if !more || after.is_none() {
                            break all;
                        }
                    }
                };
                (tokens, local)
            })
            .await
        };
        let mut found: HashMap<EntryId, Option<EndpointId>> = local.into_iter().map(|e| (e, None)).collect();
        if tokens.is_empty() {
            return Found::default();
        }
        let peers: Vec<Peer> =
            self.peers.lock().expect("peers").values().filter(|p| p.conn.close_reason().is_none()).cloned().collect();
        let asked = peers.len();
        let mut tasks = Vec::new();
        for peer in peers {
            let requests: Vec<Find> = tokens
                .chunks(index::FIND_TOKENS)
                .map(|t| Find { vault: Some(vault), after: None, follow: follow.clone(), tokens: t.to_vec() })
                .collect();
            tasks.push(async move {
                let mut all = Vec::new();
                for request in requests {
                    all.extend(find_all(&peer, request).await?);
                }
                Ok::<_, anyhow::Error>((peer.endpoint, all))
            });
        }
        let mut answered = 0;
        for got in join_all(tasks).await {
            let Ok((endpoint, entries)) = got else { continue };
            answered += 1;
            for e in entries {
                found.entry(e).or_insert(Some(endpoint));
            }
        }
        let mut entries: Vec<(EntryId, Option<EndpointId>)> = found.into_iter().collect();
        entries.sort();
        Found { entries, asked, answered }
    }
}

/// Waits for every one of `tasks`, in order.
pub(crate) async fn join_all<F: std::future::Future>(tasks: Vec<F>) -> Vec<F::Output> {
    use n0_future::StreamExt as _;
    let mut running: n0_future::FuturesOrdered<F> = tasks.into_iter().collect();
    let mut out = Vec::new();
    while let Some(x) = running.next().await {
        out.push(x);
    }
    out
}

/// Every page `peer` answers `request` with.
pub(crate) async fn find_all(peer: &Peer, mut request: Find) -> Result<Vec<EntryId>> {
    let mut all = Vec::new();
    for _ in 0..FIND_PAGES {
        let answer = time::timeout(WAIT, session::exchange(&peer.conn, FIND, &request.wire(), FIND_REPLY_LIMIT))
            .await
            .context("find deadline")??;
        let (page, more) = found_of(&answer)?;
        request.after = page.last().copied();
        all.extend(page);
        if !more || request.after.is_none() {
            return Ok(all);
        }
    }
    Ok(all)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_read_back_and_refuse_what_they_did_not_write() {
        let (v, e) = (VaultId([1; 32]), EntryId([2; 32]));
        let offer = vec![(v, [3; 32])];
        assert_eq!(offer_of(&offer_wire(&offer)).unwrap(), offer);
        assert!(offer_of(&offer_wire(&offer)[..10]).is_err());
        assert_eq!(vaults_of(&vaults_wire(&[v])).unwrap(), vec![v]);
        let rows = vec![Row { entry: e, epoch: 7, tokens: vec![[4; 16], [5; 16]] }];
        assert_eq!(rows_of(&rows_wire(v, &rows)).unwrap(), (v, rows.clone()));
        let mut long = rows_wire(v, &rows);
        long.push(0);
        assert!(rows_of(&long).is_err());
        let find = Find { vault: Some(v), after: Some(e), follow: vec![v], tokens: vec![[6; 16]] };
        assert_eq!(Find::of(&find.wire()).unwrap(), find);
        let bare = Find { vault: None, after: None, follow: vec![], tokens: vec![[6; 16]] };
        assert_eq!(Find::of(&bare.wire()).unwrap(), bare);
        assert!(Find::of(&Find { tokens: vec![], ..bare.clone() }.wire()).is_err(), "a find asks for a token");
        assert_eq!(found_of(&found_wire(&[e], true)).unwrap(), (vec![e], true));
        assert!(found_of(&[VERSION, 2, 0, 0]).is_err());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_phone_finds_a_room_through_the_blind_server_in_one_round_trip_and_brings_it() {
        use crate::{Node, Options};
        use avendb::cast::{document, handbook_ready, world};
        use n0_future::time::Instant;
        let mut w = world();
        let coop = handbook_ready(&mut w);
        // the coop's audience in use, its key on every device of the coop, as a new device has it from the audience's
        // log, which it syncs before any entry's
        w.lab.create(w.mac_a, coop, coop, "note", &[], document("Note", "x", w.mac_a)).unwrap();
        w.lab.sync_all(0);
        // a room the phone hasn't got: the server holds it as ciphertext, and can read neither its type nor its tag
        let room = w.lab.create(w.mac_a, coop, coop, "room", &["chat"], document("Room", "Hi", w.mac_a)).unwrap();
        w.lab.sync(w.mac_a, w.server);
        let (mac_id, phone_id, server_id) = (w.mac_a, w.phone_a, w.server);
        assert!(w.lab.history(phone_id, room).is_none());
        let opts = || Options { lazy: true, ..Options::local() };
        let mac = Node::spawn(w.lab.split(mac_id, &[w.passkey_a], [31; 32]), mac_id, opts()).await.unwrap();
        let server =
            Node::spawn(w.lab.split(server_id, &[], [32; 32]), server_id, Options { index: true, ..opts() }).await.unwrap();
        let phone = Node::spawn(w.lab.split(phone_id, &[], [33; 32]), phone_id, opts()).await.unwrap();
        mac.know(server.addr());
        server.know(mac.addr());
        mac.shared.connection(server.id()).await.unwrap();
        // the Mac tells the server its rows once connected, unasked
        let until = Instant::now() + Duration::from_secs(30);
        while server.shared.told_rows.as_ref().unwrap().size().await.unwrap().1 < 2 {
            assert!(Instant::now() < until, "the Mac tells the server its rows");
            n0_future::time::sleep(Duration::from_millis(20)).await;
        }
        mac.shutdown().await.unwrap();
        // the phone knows only the server
        phone.know(server.addr());
        phone.shared.connection(server.id()).await.unwrap();
        let found = phone
            .op(serde_json::json!({"op": "find", "vault": coop.to_hex(), "types": ["room"]}))
            .await
            .unwrap();
        assert_eq!(found["ok"]["entries"], serde_json::json!([room.to_hex()]), "{found}");
        assert_eq!((found["ok"]["asked"].as_u64(), found["ok"]["answered"].as_u64()), (Some(1), Some(1)));
        let has = phone.shared.read(move |lab, me| lab.history(me, room).is_some()).await;
        assert!(has, "find brought the room's log from the server");
        let tagged = phone
            .op(serde_json::json!({"op": "find", "vault": coop.to_hex(), "tags": ["chat"], "bring": false}))
            .await
            .unwrap();
        assert_eq!(tagged["ok"]["entries"], serde_json::json!([room.to_hex()]));
        // a stranger's tokens find nothing: it holds no key, and syncs nothing of the coop
        let refused = phone.op(serde_json::json!({"op": "find", "vault": coop.to_hex()})).await.unwrap();
        assert!(refused.get("refused").is_some());
        phone.shutdown().await.unwrap();
        server.shutdown().await.unwrap();
    }

    /// The iPhone's case: a new device that holds no key of the coop yet, whose Chat asks for every room (no vault) the
    /// moment its page opens, before it met any peer. The server, which reads none of it, names the room from its rows.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_new_phone_asking_for_rooms_before_it_meets_the_server_gets_them_from_its_rows() {
        use crate::{Node, Options};
        use avendb::cast::{document, handbook_ready, world};
        use n0_future::time::Instant;
        let mut w = world();
        let coop = handbook_ready(&mut w);
        let (mac_id, phone_id, server_id) = (w.mac_a, w.phone_a, w.server);
        // the audience in use on the Mac and the server only: the phone holds no key of it
        w.lab.create(mac_id, coop, coop, "note", &[], document("Note", "x", mac_id)).unwrap();
        let backlog = 40;
        for i in 0..backlog {
            w.lab.create(mac_id, coop, coop, "doc", &[], document(&format!("Doc {i}"), "history", mac_id)).unwrap();
        }
        let room = w.lab.create(mac_id, coop, coop, "room", &["chat"], document("Room", "Hi", mac_id)).unwrap();
        w.lab.sync(mac_id, server_id);
        w.lab.sync(server_id, mac_id);
        assert!(w.lab.history(phone_id, room).is_none());
        let opts = Options::local;
        let mac = Node::spawn(w.lab.split(mac_id, &[w.passkey_a], [41; 32]), mac_id, opts()).await.unwrap();
        let server =
            Node::spawn(w.lab.split(server_id, &[], [42; 32]), server_id, Options { index: true, ..opts() }).await.unwrap();
        let phone = Node::spawn(w.lab.split(phone_id, &[], [43; 32]), phone_id, opts()).await.unwrap();
        mac.know(server.addr());
        server.know(mac.addr());
        mac.shared.connection(server.id()).await.unwrap();
        let until = Instant::now() + Duration::from_secs(30);
        while server.shared.told_rows.as_ref().unwrap().size().await.unwrap().1 < 2 {
            assert!(Instant::now() < until, "the Mac tells the server its rows");
            n0_future::time::sleep(Duration::from_millis(20)).await;
        }
        mac.shutdown().await.unwrap();
        let asked = phone
            .op(serde_json::json!({"op": "interest", "scope": "d".repeat(32), "revision": 1,
                "wants": [{"tier": "now", "queries": [{"types": ["room"]}]}]}))
            .await
            .unwrap();
        assert_eq!(asked["ok"]["accepted"], true, "{asked}");
        let start = Instant::now();
        phone.know(server.addr());
        phone.shared.connection(server.id()).await.unwrap();
        let until = start + Duration::from_secs(20);
        loop {
            if phone.shared.read(move |lab, me| lab.history(me, room).is_some()).await { break; }
            assert!(Instant::now() < until, "the room never came");
            n0_future::time::sleep(Duration::from_millis(20)).await;
        }
        let took = start.elapsed();
        phone.shutdown().await.unwrap();
        server.shutdown().await.unwrap();
        assert!(took < Duration::from_secs(2), "the room came after {took:?}");
    }

}

//! A connection between two nodes: the hellos first, on the first stream, then one message on a stream of its own,
//! its kind in its first byte, and the answer back on the same stream. A message the node refuses gets its stream
//! reset.

use std::collections::{BTreeSet, HashSet};
use std::sync::Arc;

use anyhow::{Context as _, Result, anyhow, bail};
use avendb::id::{EditId, ShareId, SignerId, VaultId};
use avendb::lab::Lab;
use avendb::policy::{Action, Kind};
use avendb::sign::{Hello, RelayPass};
use avendb::sync::{LogId, log_of};
use avendb::wire::{Announce, Claim, Join, Packed, Reply, Request, Statement, Wire};
use iroh::endpoint::{Connection, RecvStream, VarInt};
use iroh::protocol::{AcceptError, ProtocolHandler};

use crate::{ALPN, Peer, Shared, WAIT, unix_now};

/// A request, answered by a reply.
pub(crate) const REQUEST: u8 = 0;
/// An announcement of the sender's holdings (`wire::Announce`), answered by nothing.
pub(crate) const ANNOUNCE: u8 = 1;
/// A request for the node's contact card, answered by its vault logs, if it hands its card out (the server).
pub(crate) const CARD: u8 = 2;
/// A passkey's pass for the peer's device (P8c, `sign::RelayPass`), the device whose hello proved it on this
/// connection, answered by the link card of each passkey the pass may be from: the logs of the vaults it owns
/// (`Lab::link_card`).
pub(crate) const LINK: u8 = 3;
/// A new device's join (P8c), answered by nothing once the node accepts it (`Lab::accept_join`).
pub(crate) const JOIN: u8 = 4;
/// A request for the key to seal to of a device of no vault that answers claims, the server or an agent's (P8f,
/// `Options::card`), answered while it belongs to no vault (`Lab::claim_key`).
pub(crate) const CLAIM_KEY: u8 = 5;
/// A claim of such a device (P8f, `Node::add_device_vault_with`), or of the next key of a device of a vault that
/// answers claims (the key move, K3c, `Node::send_move`), answered by its join once it takes it
/// (`Lab::accept_claim`): the edit that adds it, or its next key, to its device vault, signed by it too, and its
/// McEliece key.
pub(crate) const CLAIM: u8 = 6;
/// A request for the logs it names alone (v8 phase H, `only`), answered by a reply as a request is, of those logs
/// alone: what a node asks a peer whose holdings hold what it lacks there.
pub(crate) const ASK_LOGS: u8 = 7;
/// A device's signed statement of its holdings (H2, `wire::Statement`), its own or another device's passed on,
/// answered by nothing once the node keeps it or finds it older than the one it keeps (`Shared::keep_statement`).
pub(crate) const STATE: u8 = 8;
/// The id of an invite, a share to an invite key, answered by its card if the node holds it and no vault claimed it yet
/// (`Lab::invite_card`): what a newcomer's device needs to claim it, which only the invite's link names.
pub(crate) const INVITE: u8 = 9;
/// A newcomer's sign-up card (`Lab::sign_up_card`): the logs of its vault and the claims of the invites its vaults
/// made, answered by nothing once the node took every new human vault among them, and refused otherwise. The node takes
/// them as one batch, which its gate takes a new human vault from only with the invite it claims (`Lab::gate`).
pub(crate) const SIGN_UP: u8 = 10;
/// A request for the entries of the vaults it names alone (`vaults_body`), answered by a reply as a request is, of
/// those vaults' entries and of every log that is no entry's, the vaults', shares' and audiences' (`vaulted`): what a
/// node that asks only when told (`Options::lazy`), a cloud session's agent, asks for the vaults a call touches.
pub(crate) const ASK_VAULTS: u8 = 11;

/// A request for the next key of a device of a vault that answers claims, the server or an agent's (the key move, K3c),
/// answered by its id while it isn't a device of that vault yet (`Lab::move_key`).
pub(crate) const NEXT_KEY: u8 = 12;

/// The bit a request, an `ASK_LOGS` or an `ASK_VAULTS` sets in its kind to ask for its reply packed, each ML-DSA-65
/// key its signatures carry once (K5, `wire::Packed`). A node from before refuses the kind, and the asking node asks
/// again without it, and from then on on that connection (`Shared::unpacked`).
pub(crate) const PACKED: u8 = 0x80;

/// The most vaults an `ASK_VAULTS` names.
const VAULTS_LIMIT: usize = 4096;

/// The error code a node closes a connection or a stream with when it refuses it.
pub(crate) const REFUSED: VarInt = VarInt::from_u32(1);

/// The most a hello may take: an SLH-DSA-SHA2-128f signature is 17,088 bytes, an ML-DSA-65 one with its key 5,261.
const HELLO_LIMIT: usize = 64 << 10;
/// The most a key to seal to may take: an X-Wing public key and the id of a McEliece one.
pub(crate) const KEY_LIMIT: usize = 64 << 10;
/// The most a request or an announcement may take.
const MESSAGE_LIMIT: usize = 16 << 20;
/// The most a reply may take: a page of edits (`Options::page`), or one edit bigger than that, or a card of a few
/// thousand edits, each with its SLH-DSA signatures.
pub(crate) const REPLY_LIMIT: usize = 256 << 20;

/// The label both ends draw the TLS exporter with.
const HELLO_LABEL: &[u8] = b"avendb hello";

/// The connection's TLS exporter, which each end signs its hello over: 32 bytes both ends derive from its handshake,
/// and nobody else can.
pub fn exporter(conn: &Connection) -> Result<[u8; 32]> {
    let mut exporter = [0; 32];
    let drawn = conn.export_keying_material(&mut exporter, HELLO_LABEL, ALPN);
    drawn.map_err(|e| anyhow!("no keying material: {e:?}"))?;
    Ok(exporter)
}

/// The dialer's side of the hellos: its own first, then the listener's, which must prove the device on the other end
/// of this connection. That device.
pub(crate) async fn dial_hello(shared: &Arc<Shared>, conn: &Connection) -> Result<SignerId> {
    let exporter = exporter(conn)?;
    let hello = shared.lab(move |lab, me| lab.hello(me, &exporter, true)).await.context("the device is locked")?;
    let (mut send, mut recv) = conn.open_bi().await?;
    send.write_all(&hello.to_wire()).await?;
    send.finish()?;
    let theirs = Hello::from_wire(&recv.read_to_end(HELLO_LIMIT).await?)?;
    theirs.verify(&exporter, false, conn.remote_id().as_bytes()).context("the listener's hello proves no device")
}

/// The listener's side: the dialer's hello first, which must prove the device on the other end, then its own. That
/// device. A hello that proves none gets the stream reset: it never ends as if the node had said nothing.
async fn listen_hello(shared: &Arc<Shared>, conn: &Connection) -> Result<SignerId> {
    let exporter = exporter(conn)?;
    let (mut send, mut recv) = conn.accept_bi().await?;
    let device = async {
        let theirs = Hello::from_wire(&recv.read_to_end(HELLO_LIMIT).await?)?;
        theirs.verify(&exporter, true, conn.remote_id().as_bytes()).context("the dialer's hello proves no device")
    };
    let device = match device.await {
        Ok(device) => device,
        Err(e) => {
            send.reset(REFUSED).ok();
            return Err(e);
        }
    };
    let hello = shared.lab(move |lab, me| lab.hello(me, &exporter, false)).await.context("the device is locked")?;
    send.write_all(&hello.to_wire()).await?;
    send.finish()?;
    Ok(device)
}

/// Sends a message of `kind` on a stream of its own, and reads the answer, at most `limit` bytes.
pub(crate) async fn exchange(conn: &Connection, kind: u8, body: &[u8], limit: usize) -> Result<Vec<u8>> {
    let (mut send, mut recv) = conn.open_bi().await?;
    send.write_all(&[kind]).await?;
    send.write_all(body).await?;
    send.finish()?;
    Ok(recv.read_to_end(limit).await?)
}

/// Answers each message the peer sends on the connection, until it closes.
pub(crate) async fn serve(shared: Arc<Shared>, peer: Peer) {
    while let Ok((mut send, recv)) = peer.conn.accept_bi().await {
        let (shared, peer) = (shared.clone(), peer.clone());
        n0_future::task::spawn(async move {
            match answer(&shared, &peer, recv).await {
                Ok(answer) => {
                    if send.write_all(&answer).await.is_ok() {
                        send.finish().ok();
                    }
                }
                Err(_) => {
                    send.reset(REFUSED).ok();
                }
            }
        });
    }
    shared.gone(&peer);
}

/// `request`, what device `me` of `lab` asks a peer (`Lab::request`), cut to the logs `logs`, for the peer to answer
/// of those alone (`ASK_LOGS`): what it names of each, and each it names nothing of named all the same, for the peer
/// to send it whole; and of its loose edits, those of these logs.
pub(crate) fn only(lab: &Lab, me: SignerId, mut request: Request, logs: &BTreeSet<LogId>) -> Request {
    request.ask.haves.retain(|l, _| logs.contains(l));
    logs.iter().for_each(|l| _ = request.ask.haves.entry(*l).or_default());
    let log = lab.log(me);
    let of = |(edit, id): (&avendb::policy::Edit, &EditId)| log_of(edit, *id).is_some_and(|l| logs.contains(&l));
    let theirs: HashSet<EditId> = log.edits().iter().zip(log.ids()).filter(|e| of(*e)).map(|(_, id)| *id).collect();
    request.ask.loose.retain(|id| theirs.contains(id));
    request
}

/// What device `me` of `lab` answers `request` for the logs it names alone (`ASK_LOGS`) with, as a request
/// (`Lab::reply`): every edit it holds of any other log, or of none, counted among those the asker holds.
fn scoped(lab: &Lab, me: SignerId, mut request: Request) -> Request {
    let log = lab.log(me);
    let named = |(edit, id): (&avendb::policy::Edit, &EditId)| {
        log_of(edit, *id).is_some_and(|l| request.ask.haves.contains_key(&l))
    };
    let others: Vec<EditId> = log.edits().iter().zip(log.ids()).filter(|e| !named(*e)).map(|(_, id)| *id).collect();
    request.ask.loose.extend(others);
    request
}

/// `request`, what device `me` of `lab` asks a peer, cut to the vaults `vaults` (`ASK_VAULTS`): of the entries it
/// holds, only what it names of those of these vaults, and of its loose edits, only those of no other vault's entry.
pub(crate) fn of_vaults(lab: &Lab, me: SignerId, mut request: Request, vaults: &BTreeSet<VaultId>) -> Request {
    let elsewhere = |l: &LogId| match *l {
        LogId::Entry(e) => lab.vault_of_entry(me, e).is_none_or(|v| !vaults.contains(&v)),
        _ => false,
    };
    request.ask.haves.retain(|l, _| !elsewhere(l));
    let log = lab.log(me);
    let other = |(edit, id): (&avendb::policy::Edit, &EditId)| log_of(edit, *id).is_some_and(|l| elsewhere(&l));
    let others: HashSet<EditId> = log.edits().iter().zip(log.ids()).filter(|e| other(*e)).map(|(_, id)| *id).collect();
    request.ask.loose.retain(|id| !others.contains(id));
    request
}

/// What device `me` of `lab` answers `request` for the vaults `vaults` alone (`ASK_VAULTS`) with, as a request
/// (`Lab::reply`): every edit it holds of an entry of any other vault, or of an entry it can't place, counted among
/// those the asker holds. What the asker may receive is the same as ever (T12): it only asks for less.
fn vaulted(lab: &Lab, me: SignerId, mut request: Request, vaults: &BTreeSet<VaultId>) -> Request {
    let log = lab.log(me);
    let elsewhere = |(edit, id): (&avendb::policy::Edit, &EditId)| match log_of(edit, *id) {
        Some(LogId::Entry(e)) => lab.vault_of_entry(me, e).is_none_or(|v| !vaults.contains(&v)),
        _ => false,
    };
    let others = log.edits().iter().zip(log.ids()).filter(|e| elsewhere(*e)).map(|(_, id)| *id);
    request.ask.loose.extend(others);
    request
}

/// The body of an `ASK_VAULTS`: how many vaults it names, in two bytes, each vault's id, then the request.
pub(crate) fn vaults_body(vaults: &BTreeSet<VaultId>, request: &Request) -> Vec<u8> {
    let mut body = (vaults.len() as u16).to_be_bytes().to_vec();
    vaults.iter().for_each(|v| body.extend_from_slice(&v.0));
    body.extend(request.to_wire());
    body
}

/// The vaults and the request an `ASK_VAULTS`' body `body` names (`vaults_body`).
fn from_vaults_body(body: &[u8]) -> Result<(BTreeSet<VaultId>, Request)> {
    let (count, rest) = body.split_first_chunk::<2>().context("an ask for vaults names none")?;
    let count = u16::from_be_bytes(*count) as usize;
    anyhow::ensure!(count <= VAULTS_LIMIT, "an ask for {count} vaults");
    anyhow::ensure!(rest.len() >= count * 32, "an ask for vaults cut short");
    let (ids, request) = rest.split_at(count * 32);
    let vaults = ids.chunks_exact(32).map(|c| VaultId(c.try_into().expect("32 bytes"))).collect();
    Ok((vaults, Request::from_wire(request)?))
}

/// The answer to the message on the stream `recv`: a request gets a reply, of the logs it names alone if it asks for
/// those (`ASK_LOGS`); an announcement of the peer's holdings nothing, but the node keeps them, as the device whose
/// hello proved it on this connection holds them, and asks the peer for the logs where it holds what the node lacks;
/// a request for its card gets its vault logs, if it hands its card out. A
/// passkey's pass for the device whose hello proved it on this connection, made in its minutes, gets the link card of
/// each passkey it may be from, and a join the node accepts gets nothing, and the node tells the new device what it
/// holds. A device of no vault that answers claims, the server or an agent's, hands its key to seal to whoever asks,
/// and answers the first claim it takes with its join (P8f). A request of any of the three kinds that sets `PACKED` gets
/// its reply packed, each ML-DSA-65 key once (K5).
async fn answer(shared: &Arc<Shared>, peer: &Peer, mut recv: RecvStream) -> Result<Vec<u8>> {
    let message = recv.read_to_end(MESSAGE_LIMIT).await?;
    let (&kind, body) = message.split_first().context("an empty message")?;
    let device = peer.device;
    // a reply packed where the request asks for it (K5), whole otherwise
    let packed = kind & PACKED != 0 && matches!(kind & !PACKED, REQUEST | ASK_LOGS | ASK_VAULTS);
    let replied = |reply: Reply| if packed { Packed(reply).to_wire() } else { reply.to_wire() };
    let kind = if packed { kind & !PACKED } else { kind };
    // how long a page takes this node to make, from the request read to the reply made (`Traffic::served`)
    let began = n0_future::time::Instant::now();
    let served = |edits: usize, wire: Vec<u8>| {
        shared.traffic.served(edits as u64, wire.len() as u64, began.elapsed().as_millis() as u64);
        wire
    };
    match kind {
        REQUEST => {
            let (request, page) = (Request::from_wire(body)?, shared.opts.page);
            shared.follows(peer, &request);
            let (edits, ids, more) = shared.lab(move |lab, me| lab.reply(me, device, &request, page)).await;
            let blobs = shared.offer(ids).await?;
            let n = edits.len();
            let wire = replied(Reply { edits, blobs, more });
            Ok(served(n, wire))
        }
        ASK_LOGS => {
            let (request, page) = (Request::from_wire(body)?, shared.opts.page);
            shared.follows(peer, &request);
            let reply = move |lab: &mut Lab, me| {
                let request = scoped(lab, me, request);
                lab.reply(me, device, &request, page)
            };
            let (edits, ids, more) = shared.lab(reply).await;
            let blobs = shared.offer(ids).await?;
            let n = edits.len();
            let wire = replied(Reply { edits, blobs, more });
            Ok(served(n, wire))
        }
        ASK_VAULTS => {
            let ((vaults, request), page) = (from_vaults_body(body)?, shared.opts.page);
            shared.follows(peer, &request);
            let reply = move |lab: &mut Lab, me| {
                let request = vaulted(lab, me, request, &vaults);
                lab.reply(me, device, &request, page)
            };
            let (edits, ids, more) = shared.lab(reply).await;
            let blobs = shared.offer(ids).await?;
            let n = edits.len();
            let wire = replied(Reply { edits, blobs, more });
            Ok(served(n, wire))
        }
        ANNOUNCE => {
            // of the device whose hello proved it on this connection, and of no other
            shared.hear(device, Announce::from_wire(body)?);
            shared.ask_soon(peer.endpoint);
            Ok(Vec::new())
        }
        STATE => {
            // of whichever device signed it, on whatever connection it came
            shared.keep_statement(Statement::from_wire(body)?, false).await?;
            Ok(Vec::new())
        }
        CARD if shared.opts.card => {
            let edits = shared.lab(|lab, me| lab.card(me)).await;
            Ok(Reply { edits, ..Reply::default() }.to_wire())
        }
        LINK => {
            let pass = RelayPass::from_wire(body)?;
            // for the device on the other end of this connection alone, whose hello proved it
            if pass.device.id() != device {
                bail!("a pass for another device than the one on this connection");
            }
            let passkeys = pass.passkeys(unix_now());
            if passkeys.is_empty() {
                bail!("the pass is no passkey's for this device now");
            }
            let card = move |lab: &mut avendb::lab::Lab, me| passkeys.iter().flat_map(|&p| lab.link_card(me, p)).collect();
            let edits = shared.lab(card).await;
            Ok(Reply { edits, ..Reply::default() }.to_wire())
        }
        JOIN => {
            let join = Join::from_wire(body)?;
            let accepted = shared.lab(move |lab, me| lab.accept_join(me, device, join)).await;
            accepted.map_err(|why| anyhow!("the join is refused: {why:?}"))?;
            shared.changed.notify_one();
            Ok(Vec::new())
        }
        CLAIM_KEY if shared.opts.card => {
            let key = shared.lab(|lab, me| lab.claim_key(me)).await;
            Ok(key.map_err(|why| anyhow!("no claim: {why:?}"))?.to_wire())
        }
        NEXT_KEY if shared.opts.card => {
            let next = shared.lab(|lab, me| lab.move_key(me)).await;
            Ok(next.map_err(|why| anyhow!("no key move: {why:?}"))?.0.to_vec())
        }
        CLAIM if shared.opts.card => {
            let claim = Claim::from_wire(body)?;
            let accept = move |lab: &mut avendb::lab::Lab, me| -> Result<_, avendb::policy::Refusal> {
                let join = lab.accept_claim(me, claim)?;
                // a key move: its next key takes what it kept, and it opens as that key from its next start
                let next = match &join.edit.edit.action {
                    Action::Share(avendb::policy::Sharing::Device { device: next, .. }) if *next != me => Some(*next),
                    _ => None,
                };
                // the edit is kept: keeps not carried now are carried as it opens as its next key (`server::open_as`)
                let carried = next.map(|next| lab.finish_move(me, &[(me, next)]));
                Ok((join, lab.vault_of(me), next, carried))
            };
            let (join, vault, next, carried) =
                shared.lab(accept).await.map_err(|why| anyhow!("the claim is refused: {why:?}"))?;
            if let Some(Err(why)) = carried {
                tracing::warn!("avendb: its keeps aren't carried to its next key yet: {why:?}");
            }
            match next {
                Some(next) => {
                    tracing::info!("avendb: its key moved to {next:?} by {device:?}, a device of its owner's");
                    n0_future::task::spawn(crate::server::name_next(shared.clone(), next));
                }
                None => {
                    tracing::info!("avendb: claimed by {device:?}, a device of its owner's; its device vault is {vault:?}")
                }
            }
            shared.changed.notify_one();
            Ok(join.to_wire())
        }
        INVITE if shared.opts.card => {
            let share = ShareId(<[u8; 32]>::try_from(body).context("an invite's id")?);
            let card = shared.lab(move |lab, me| lab.invite_card(me, share)).await;
            let edits = card.map_err(|why| anyhow!("no invite: {why:?}"))?;
            Ok(Reply { edits, ..Reply::default() }.to_wire())
        }
        SIGN_UP if shared.opts.card => {
            let Reply { mut edits, .. } = Reply::from_wire(body)?;
            // a sign-up card carries vault logs and claims, and nothing else
            edits.retain(|s| crate::of_a_vault(s) || matches!(s.edit.action, Action::Claim { .. }));
            shared.sized(&mut edits);
            let human = |s: &avendb::sign::Signed| match s.edit.action {
                Action::Genesis { kind: Kind::Human, .. } => Some(VaultId::from(s.edit.id())),
                _ => None,
            };
            let humans: Vec<VaultId> = edits.iter().filter_map(human).collect();
            let take = move |lab: &mut Lab, me| {
                lab.receive(me, edits, Vec::new());
                humans.iter().all(|&v| lab.state(me).vault(v).is_some())
            };
            let took = shared.lab(take).await;
            shared.changed.notify_one();
            if !took {
                bail!("the server takes a new vault only with an invite it claims");
            }
            Ok(Vec::new())
        }
        _ => bail!("no message of kind {kind}"),
    }
}

/// avenDB's sync protocol on a node's router: it serves a connection once the dialer's hello proves its device, and
/// closes it otherwise.
#[derive(Clone)]
pub(crate) struct Protocol(pub(crate) Arc<Shared>);

impl std::fmt::Debug for Protocol {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_tuple("Protocol").field(&self.0.me).finish()
    }
}

impl ProtocolHandler for Protocol {
    async fn accept(&self, conn: Connection) -> Result<(), AcceptError> {
        let shared = self.0.clone();
        match n0_future::time::timeout(WAIT, listen_hello(&shared, &conn)).await {
            Ok(Ok(device)) => {
                let peer = shared.connected(conn, device);
                serve(shared, peer).await;
            }
            _ => conn.close(REFUSED, b"no hello"),
        }
        Ok(())
    }
}

//! A connection between two nodes: the hellos first, on the first stream, then one message on a stream of its own,
//! its kind in its first byte, and the answer back on the same stream. A message the node refuses gets its stream
//! reset.

use std::collections::{BTreeSet, HashSet};
use std::sync::Arc;

use anyhow::{Context as _, Result, anyhow, bail};
use avendb::id::{EditId, ShareId, SignerId, VaultId};
use avendb::lab::{Lab, ReplyScope};
use avendb::policy::{Action, Kind};
use avendb::sign::{Hello, RelayPass};
use avendb::sync::{LogId, log_of};
use avendb::wire::{Announce, Claim, Join, Packed, Reply, Request, Statement, Wire};
use iroh::endpoint::{Connection, RecvStream, VarInt};
use iroh::protocol::{AcceptError, ProtocolHandler};

use crate::{ALPN, Peer, Shared, PAGE_WAIT, WAIT, unix_now};

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
/// A claim of such a device (P8f, `Node::add_device_vault_with`), answered by its join once it takes it
/// (`Lab::accept_claim`): the edit that adds it to its device vault, signed by it too, and its McEliece key.
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

// 12 asked a device for its next key in the key move off SLH-DSA, gone with the fork off it: never used again.

/// Bounded, root-bound reconciliation of the holdings this device may announce to this peer (M4). A peer from
/// before refuses this kind, so the sender falls back to the unchanged `ANNOUNCE` on this connection.
pub(crate) const RANGES: u8 = 13;

/// Where the next pages of a request, an `ASK_LOGS` or an `ASK_VAULTS` would end (`Lab::reply_cuts`), so that a pull
/// asks several pages at once on a slow link instead of each after the last came (S6). Its body is the kind it asks
/// about, how many cuts, then that kind's body; it is answered by the cuts (`cuts_wire`). A hint and no more: each page
/// is still asked as before, checked and taken in order, and one asked at a cut its predecessor didn't end on is
/// dropped unread. A peer from before refuses this kind, and the asking node asks page after page on that connection,
/// as it did (`Shared::uncut`).
pub(crate) const CUTS: u8 = 22;

/// The stubs of the box edits a request, an `ASK_LOGS` or an `ASK_VAULTS` would bring that the asking device needs not
/// now (`Lab::withheld`, `spec/AvenDB/LazyBoxes.lean`): what a fresh device asks once before its first pull, so that
/// it counts them as held and is sent every edit but those. Its body is the kind it asks about, then that kind's body;
/// it is answered by the stubs (`wire::Stubs`), of no edit the same request would not bring. A peer from before
/// refuses this kind, and the device pulls everything, as it did.
pub(crate) const STUBS: u8 = 23;

/// The most a `STUBS` answer takes.
pub(crate) const STUBS_REPLY_LIMIT: usize = 64 << 20;

/// The most cuts one `CUTS` asks for: each costs its peer a page's sizing.
pub(crate) const CUTS_LIMIT: usize = 16;
/// The most a `CUTS` answer takes (`cuts_wire`).
pub(crate) const CUTS_REPLY_LIMIT: usize = 2 + CUTS_LIMIT * 40;

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
pub(crate) const MESSAGE_LIMIT: usize = 16 << 20;
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
    let _activity = shared.admit()?;
    let exporter = exporter(conn)?;
    let hello = shared.try_lab(move |lab, me| lab.hello(me, &exporter, true)).await?.context("the device is locked")?;
    let (mut send, mut recv) = conn.open_bi().await?;
    send.write_all(&hello.to_wire()).await?;
    send.finish()?;
    let theirs = Hello::from_wire(&recv.read_to_end(HELLO_LIMIT).await?)?;
    theirs.verify(&exporter, false, conn.remote_id().as_bytes()).context("the listener's hello proves no device")
}

/// The listener's side: the dialer's hello first, which must prove the device on the other end, then its own. That
/// device. A hello that proves none gets the stream reset: it never ends as if the node had said nothing.
async fn listen_hello(shared: &Arc<Shared>, conn: &Connection) -> Result<SignerId> {
    let _activity = shared.admit()?;
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
    let hello = shared.try_lab(move |lab, me| lab.hello(me, &exporter, false)).await?.context("the device is locked")?;
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

/// Only this typed read error permits a large-page retry; resets, parse errors and connection failures do not.
pub(crate) fn too_long(error: &anyhow::Error) -> bool {
    matches!(error.downcast_ref::<iroh::endpoint::ReadToEndError>(), Some(iroh::endpoint::ReadToEndError::TooLong))
}

/// Answers each message the peer sends on the connection, until it closes.
pub(crate) async fn serve(shared: Arc<Shared>, peer: Peer) {
    // the turn each request was asked in, counted down: of two large answers the one asked first goes first
    let mut turn: i32 = 0;
    while let Ok((mut send, recv)) = peer.conn.accept_bi().await {
        turn = turn.saturating_sub(1);
        let asked = turn;
        let activity = match shared.admit() {
            Ok(activity) => activity,
            Err(_) => { send.reset(REFUSED).ok(); break; }
        };
        let (shared, peer) = (shared.clone(), peer.clone());
        n0_future::task::spawn(async move {
            let _activity = activity;
            match n0_future::time::timeout(PAGE_WAIT, answer(&shared, &peer, recv)).await {
                Ok(Ok(answer)) => {
                    // The envelope retains range response memory admission through write_all, including a stalled
                    // peer. Closing/cancellation releases only after every blocking worker drops its Arc too.
                    let deadline = if answer._range.is_some() { crate::edit_transfer::DEADLINE } else if answer._checkpoint.is_some() { crate::checkpoint_delivery::DEADLINE } else { PAGE_WAIT };
                    // a small answer (a live pull's edit, cuts, a card) goes out ahead of the pages of a catch-up on the
                    // same connection, not behind what is queued of them, and the pages in the order asked
                    // (`LivePriority.lean` `sendPriority`)
                    send.set_priority(priority(answer.bytes.len(), asked)).ok();
                    if matches!(n0_future::time::timeout(deadline, send.write_all(&answer.bytes)).await, Ok(Ok(()))) {
                        send.finish().ok();
                    } else { send.reset(REFUSED).ok(); }
                }
                _ => { send.reset(REFUSED).ok(); }
            }
        });
    }
    shared.gone(&peer);
}

/// Answers up to this many bytes are sent ahead of larger ones on their connection: a live pull's few edits, not a
/// catch-up's page (`pulls::PAGE_BYTES`, `PAGE`).
pub(crate) const SMALL_ANSWER: usize = 64 << 10;

/// The send priority of an answer of `bytes` asked in turn `asked` (-1 for a connection's first request, then down):
/// higher goes first (`SendStream::set_priority`). Small answers all at 1, keeping their round-robin; large ones in the
/// order asked, each sent whole before the next. Shared in turns, a pull's two pages in flight (4 MiB each) ended
/// together, and the link idled while the next two were asked: 0.55 of its rate for 0.5 s at each pair on phone_bulk.
pub(crate) fn priority(bytes: usize, asked: i32) -> i32 {
    if bytes <= SMALL_ANSWER { 1 } else { asked.min(0) }
}

struct Answer {
    bytes: Vec<u8>,
    _range: Option<Arc<crate::edit_transfer::Serving>>,
    _checkpoint: Option<Arc<tokio::sync::OwnedSemaphorePermit>>,
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

/// The three existing request kinds share the same authorization, follow and pagination path.
/// Supplemental proofs wrap this result; they never add an unrestricted edit lookup.
/// An old app reads signatures alone (`spec/AvenDB/WireBatches.lean`, `toOld`): of `edits`, those this node holds
/// every part of as a signature, as a node that asks for signatures is sent them. The server holds no other.
fn to_old(mut edits: Vec<avendb::sign::Signed>) -> Vec<avendb::sign::Signed> {
    edits.retain(|signed| !avendb::batch::held_by_path(signed));
    edits
}

fn authorized_request(kind: u8, body: &[u8]) -> Result<(Request, Option<ReplyScope>)> {
    Ok(match kind {
        REQUEST => (Request::from_wire(body)?, None),
        ASK_LOGS => {
            let request = Request::from_wire(body)?;
            let scope = ReplyScope::Logs(request.ask.haves.keys().copied().collect());
            (request, Some(scope))
        }
        ASK_VAULTS => {
            let (vaults, request) = from_vaults_body(body)?;
            (request, Some(ReplyScope::Vaults(vaults)))
        }
        _ => bail!("unsupported authorized request kind"),
    })
}

/// The body of a `CUTS`: the kind it asks about, how many cuts, then that kind's body.
pub(crate) fn cuts_body(kind: u8, count: usize, body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(body.len() + 2);
    out.push(kind);
    out.push(count.min(CUTS_LIMIT) as u8);
    out.extend_from_slice(body);
    out
}

/// A `CUTS` answer: how many cuts, each a place (its depth in eight bytes, then the edit's id), then 1 if the last
/// ends the asking.
pub(crate) fn cuts_wire(cuts: &[avendb::sync::Place], done: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(2 + cuts.len() * 40);
    out.push(cuts.len() as u8);
    for (depth, id) in cuts {
        out.extend_from_slice(&depth.to_be_bytes());
        out.extend_from_slice(&id.0);
    }
    out.push(u8::from(done));
    out
}

/// The cuts a `CUTS` answer names (`cuts_wire`), each after the one before, or an error.
pub(crate) fn from_cuts_wire(bytes: &[u8]) -> Result<(Vec<avendb::sync::Place>, bool)> {
    let (&n, rest) = bytes.split_first().context("an empty cuts answer")?;
    let n = n as usize;
    anyhow::ensure!(n <= CUTS_LIMIT && rest.len() == n * 40 + 1, "a malformed cuts answer");
    let mut cuts: Vec<avendb::sync::Place> = Vec::with_capacity(n);
    for chunk in rest[..n * 40].chunks_exact(40) {
        let depth = u64::from_be_bytes(chunk[..8].try_into().expect("8 bytes"));
        let place = (depth, EditId(chunk[8..].try_into().expect("32 bytes")));
        anyhow::ensure!(cuts.last().is_none_or(|last| *last < place), "cuts out of order");
        cuts.push(place);
    }
    let done = match rest[n * 40] {
        0 => false,
        1 => true,
        _ => bail!("a malformed cuts answer"),
    };
    Ok((cuts, done))
}

async fn authorized_cuts(shared: &Arc<Shared>, peer: &Peer, body: &[u8]) -> Result<Vec<u8>> {
    let [kind, count, body @ ..] = body else { bail!("a cuts request cut short") };
    let (request, scope) = authorized_request(*kind, body)?;
    let (device, page, count) = (peer.device, shared.opts.page, (*count as usize).min(CUTS_LIMIT));
    let (cuts, done) = shared
        .try_lab(move |lab, me| lab.reply_cuts(me, device, &request, page, &scope.unwrap_or_default(), count))
        .await?;
    Ok(cuts_wire(&cuts, done))
}

async fn authorized_stubs(shared: &Arc<Shared>, peer: &Peer, body: &[u8]) -> Result<Vec<u8>> {
    let [kind, body @ ..] = body else { bail!("a stubs request cut short") };
    let (request, scope) = authorized_request(*kind, body)?;
    let device = peer.device;
    let stubs = shared
        .try_lab(move |lab, me| lab.withheld(me, device, &request, &scope.unwrap_or_default()))
        .await?;
    Ok(avendb::wire::Stubs(stubs).to_wire())
}

async fn authorized_reply(shared: &Arc<Shared>, peer: &Peer, kind: u8, body: &[u8], paths: bool) -> Result<Reply> {
    let (request, scope) = authorized_request(kind, body)?;
    shared.follows(peer, &request);
    let (device, page) = (peer.device, shared.opts.page);
    let (edits, ids, more) = shared.try_lab(move |lab, me| match scope {
        None => lab.reply(me, device, &request, page),
        Some(scope) => lab.reply_in(me, device, &request, page, &scope),
    }).await?;
    let blobs = shared.offer(ids).await?;
    let edits = if paths { edits } else { to_old(edits) };
    Ok(Reply { edits, blobs, more })
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
async fn answer(shared: &Arc<Shared>, peer: &Peer, mut recv: RecvStream) -> Result<Answer> {
    // Read one byte before choosing admission. Range traffic has no queued waiters and cannot allocate its
    // request body or response until a separate incoming-serving permit is held.
    let mut kind = [0u8; 1];
    recv.read_exact(&mut kind).await?;
    let kind = kind[0];
    let range = if kind == crate::edit_ranges::KIND { Some(shared.edit_transfer.serving()?) } else { None };
    // Hold checkpoint response memory admission until write_all completes, including a slow
    // reader. Acquiring before body allocation prevents queued peers retaining response buffers.
    let checkpoint = if matches!(kind,crate::checkpoint_delivery::KIND | crate::bootstrap_dependencies::KIND) {
        Some(Arc::new(shared.discovery_answer.clone().try_acquire_owned().context("checkpoint provider busy")?))
    } else { None };
    let limit = match kind {
        crate::transports::control::KIND => crate::transports::control::LIMIT,
        crate::edit_ranges::KIND => crate::edit_ranges::CONTROL_BYTES,
        crate::blind::OFFER => crate::blind::OFFER_LIMIT,
        crate::blind::ROWS => crate::blind::ROWS_LIMIT,
        crate::blind::FIND => crate::blind::FIND_LIMIT,
        crate::checkpoint_delivery::KIND => crate::checkpoint_delivery::REQUEST_LIMIT,
        crate::bootstrap_dependencies::KIND => crate::bootstrap_dependencies::LIMIT,
        crate::peer_receipts::KIND | crate::peer_receipts::UI_KIND => crate::peer_receipts::REQUEST_LIMIT,
        _ => MESSAGE_LIMIT - 1,
    };
    let deadline = if range.is_some() { crate::edit_transfer::DEADLINE } else if checkpoint.is_some() { crate::checkpoint_delivery::DEADLINE } else { PAGE_WAIT };
    let message = n0_future::time::timeout(deadline, recv.read_to_end(limit)).await.context("request body deadline")??;
    let preparing = answer_body(shared, peer, kind, &message, range.clone(), checkpoint.clone());
    let bytes = if checkpoint.is_some() {
        n0_future::time::timeout(crate::checkpoint_delivery::DEADLINE, preparing).await.context("checkpoint preparation deadline")??
    } else { preparing.await? };
    Ok(Answer { bytes, _range: range, _checkpoint: checkpoint })
}

async fn answer_body(shared: &Arc<Shared>, peer: &Peer, kind: u8, body: &[u8], range: Option<Arc<crate::edit_transfer::Serving>>, checkpoint: Option<Arc<tokio::sync::OwnedSemaphorePermit>>) -> Result<Vec<u8>> {
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
        crate::blind::OFFER => shared.answer_offer(peer, body).await,
        crate::blind::ROWS => shared.answer_rows(peer, body).await,
        crate::blind::FIND => shared.answer_find(peer, body).await,
        crate::checkpoint_delivery::KIND => crate::checkpoint_delivery::answer(shared, peer, body, checkpoint.context("missing checkpoint response admission")?).await,
        crate::bootstrap_dependencies::KIND => crate::bootstrap_dependencies::answer(shared,peer,body,checkpoint.context("missing dependency response admission")?).await,
        crate::peer_receipts::KIND => crate::peer_receipts::answer(shared, peer, body).await,
        crate::peer_receipts::UI_KIND => crate::peer_receipts::answer_ui(shared, peer, body).await,
        CUTS => authorized_cuts(shared, peer, body).await,
        STUBS => authorized_stubs(shared, peer, body).await,
        REQUEST | ASK_LOGS | ASK_VAULTS => {
            let reply = authorized_reply(shared, peer, kind, body, false).await?;
            let n = reply.edits.len();
            Ok(served(n, replied(reply)))
        }
        crate::proofs::KIND => {
            let signers = shared.signers.as_ref().context("supplemental batch roots unavailable")?;
            let request = crate::proofs::Request::decode(body)?;
            // a segment request names every writer its asker holds a root of (S8); the others name this node alone
            anyhow::ensure!(
                request.held.is_some() || request.known.keys().all(|signer| *signer == shared.me),
                "unrelated known signer"
            );
            let reply = authorized_reply(shared, peer, request.kind, &request.request, request.paths).await?;
            let n = reply.edits.len();
            // A persisted signer leaf alone is insufficient: this node must also still hold the
            // complete signed record in its acknowledged legacy prefix. Retain only this reply's IDs.
            let ids: BTreeSet<_> = reply.edits.iter().map(|signed| signed.edit.id()).collect();
            let held_by = shared.clone();
            let durable = shared.read(move |lab, _| {
                let me = held_by.me;
                let held = held_by.edits.as_ref().map_or(0, |edits| edits.held(lab, me));
                lab.log(me).ids().iter().take(held).filter(|id| ids.contains(id)).copied().collect()
            }).await;
            let supplemented = crate::proofs::Supplement::attach(reply, signers, &request, &durable).await;
            let wire = supplemented.encode()?;
            // The original maximum remains unchanged. The client can retry the legacy request if
            // proof overhead would prevent a legitimate near-limit indivisible edit from fitting.
            anyhow::ensure!(wire.len() <= REPLY_LIMIT, "supplement exceeds legacy response ceiling");
            Ok(served(n, wire))
        }
        crate::edit_ranges::KIND => crate::edit_transfer::handle(shared, peer, body, range.context("missing range response admission")?).await,
        crate::transports::control::KIND => crate::transports::control::handle(shared, peer, body).await,
        RANGES => {
            let (answer, complete) = {
                // Same lock order as `Shared::hear`: a legacy update cancels staging before it can publish an
                // older complete claim. Both paths identify the sender solely by the authenticated hello.
                let mut held = shared.held.lock().expect("held");
                let mut ranges = shared.ranges.lock().expect("ranges");
                let (answer, complete) = ranges.receive(peer.conn.stable_id(), device, body)?;
                let done = complete.is_some();
                if let Some(complete) = complete { complete.apply(held.entry(device).or_default()); shared.fresh.moved(); }
                (answer, done)
            };
            if complete { shared.jobs.stir(); shared.ask_soon(peer.endpoint); shared.schedule_discoveries(); }
            Ok(answer)
        }
        ANNOUNCE => {
            // of the device whose hello proved it on this connection, and of no other
            let announce = Announce::from_wire(body)?;
            let full = announce.full;
            shared.hear(device, announce);
            if full { shared.schedule_discoveries(); }
            shared.ask_soon(peer.endpoint);
            Ok(Vec::new())
        }
        STATE => {
            // of whichever device signed it, on whatever connection it came
            shared.keep_statement(Statement::from_wire(body)?, false).await?;
            Ok(Vec::new())
        }
        CARD if shared.opts.card => {
            let edits = to_old(shared.try_lab(|lab, me| lab.card(me)).await?);
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
            let edits = shared.try_lab(card).await?;
            Ok(Reply { edits, ..Reply::default() }.to_wire())
        }
        JOIN => {
            let join = Join::from_wire(body)?;
            let accepted = shared.try_lab(move |lab, me| lab.accept_join(me, device, join)).await?;
            accepted.map_err(|why| anyhow!("the join is refused: {why:?}"))?;
            shared.changed.notify_one();
            Ok(Vec::new())
        }
        CLAIM_KEY if shared.opts.card => {
            let key = shared.try_lab(|lab, me| lab.claim_key(me)).await?;
            Ok(key.map_err(|why| anyhow!("no claim: {why:?}"))?.to_wire())
        }
        CLAIM if shared.opts.card => {
            let claim = Claim::from_wire(body)?;
            let accept = move |lab: &mut avendb::lab::Lab, me| -> Result<_, avendb::policy::Refusal> {
                let join = lab.accept_claim(me, claim)?;
                Ok((join, lab.vault_of(me)))
            };
            let (join, vault) = shared.try_lab(accept).await?.map_err(|why| anyhow!("the claim is refused: {why:?}"))?;
            tracing::info!("avendb: claimed by {device:?}, a device of its owner's; its device vault is {vault:?}");
            shared.changed.notify_one();
            Ok(join.to_wire())
        }
        INVITE if shared.opts.card => {
            let share = ShareId(<[u8; 32]>::try_from(body).context("an invite's id")?);
            let card = shared.try_lab(move |lab, me| lab.invite_card(me, share)).await?;
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
            let took = shared.try_lab(take).await?;
            shared.changed.notify_one();
            if !took {
                bail!("the server takes a new vault only with an invite it claims");
            }
            Ok(Vec::new())
        }
        _ => bail!("no message of kind {kind}"),
    }
}

/// One complete snapshot of the already-redacted holdings, over bounded request/reply batches. Files still use
/// their existing full encoding. The range tree covers log frontiers, including sparse waiting edits; it does not
/// replace signed edit verification. A failed round leaves the receiver's previous complete snapshot untouched.
pub(crate) async fn tell_ranges(shared: &Arc<Shared>, peer: &Peer, device: SignerId, want: &crate::Holdings) -> Result<()> {
    let _activity = shared.admit()?;
    let tree = shared.ranges.lock().expect("ranges").offered(device, want)?;
    let mut body = tree.begin(&want.files)?;
    let mut sent = 0usize;
    for _ in 0..4096 {
        sent = sent.checked_add(body.len()).context("range byte count overflow")?;
        anyhow::ensure!(sent <= 32 << 20, "a range exchange is too large");
        let response = n0_future::time::timeout(WAIT, exchange(&peer.conn, RANGES, &body, 8192)).await.context("no range response in time")??;
        match tree.nodes(&response)? {
            None => return Ok(()),
            Some(next) => body = next,
        }
    }
    bail!("a range exchange took too many rounds")
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
                let Ok(activity) = shared.admit() else { conn.close(REFUSED, b"node is closed"); return Ok(()); };
                let peer = shared.connected(conn, device);
                drop(activity);
                serve(shared, peer).await;
            }
            _ => conn.close(REFUSED, b"no hello"),
        }
        Ok(())
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod batch_session_tests {
    use super::*;
    use crate::{Node, Options, disk, proofs};
    use avendb::cast::{document, handbook_ready, world};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::Duration;

    struct Folder(PathBuf);
    impl Folder {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "avendb-batch-session-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn options(&self) -> Options {
            Options { shelf: Some(disk::open(&self.0).unwrap()), lazy: true, ..Options::local() }
        }
    }
    impl Drop for Folder {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn supplemented_requests_keep_legacy_scope_and_persist_linked_roots() {
        let mut w = world();
        let coop = handbook_ready(&mut w);
        let (sender, receiver, outsider) = (w.mac_a, w.phone_a, w.stranger);
        let (a, b, c) = (Folder::new(), Folder::new(), Folder::new());
        let mac = Node::spawn(w.lab.split(sender, &[], [151; 32]), sender, a.options()).await.unwrap();
        let phone = Node::spawn(w.lab.split(receiver, &[], [152; 32]), receiver, b.options()).await.unwrap();
        let stranger = Node::spawn(w.lab.split(outsider, &[], [153; 32]), outsider, c.options()).await.unwrap();
        let first = mac.act(move |lab, me| {
            lab.create(me, coop, coop, "doc", &[], document("First batch", "kept legacy signatures", me))
        }).await.unwrap();
        mac.shared.save().await.unwrap();
        let first_id = mac.read(move |lab, me| {
            let log = lab.log(me);
            log.edits().iter().zip(log.ids()).find_map(|(edit, id)|
                (log_of(edit, *id) == Some(LogId::Entry(first))).then_some(*id)
            ).unwrap()
        }).await;
        assert!(mac.shared.signers.as_ref().unwrap().proof(first_id).is_some());
        phone.know(mac.addr());
        stranger.know(mac.addr());
        let peer = phone.shared.connection(mac.id()).await.unwrap();
        let request = phone.read(move |lab, me| lab.request(me, sender).to_wire()).await;
        let error = match phone.shared.reply_to(&peer, REQUEST, &request, 1).await {
            Err(error) => error,
            Ok(_) => panic!("a complete supplemented reply cannot fit one byte"),
        };
        assert!(too_long(&error), "supplement overflow retains the typed exclusive-retry signal");
        assert!(!phone.shared.unbatched.lock().unwrap().contains(&peer.conn.stable_id()),
            "size overflow is not evidence against batch-proof support");
        for kind in [REQUEST, ASK_LOGS, ASK_VAULTS] {
            let body = phone.read(move |lab, me| {
                let request = lab.request(me, sender);
                match kind {
                    ASK_LOGS => only(lab, me, request, &[LogId::Entry(first)].into_iter().collect()).to_wire(),
                    ASK_VAULTS => vaults_body(&[coop].into_iter().collect(), &request),
                    _ => request.to_wire(),
                }
            }).await;
            let plain = exchange(&peer.conn, kind | PACKED, &body, REPLY_LIMIT).await.unwrap();
            let plain = Packed::from_wire(&plain).unwrap().0;
            // version 1, as the server asks for one release: the exact authorized legacy reply, every signature in it
            let v1 = proofs::Request { kind, request: body.clone(), known: Default::default(), paths: false, held: None };
            let v1 = exchange(&peer.conn, proofs::KIND, &v1.encode().unwrap(), REPLY_LIMIT).await.unwrap();
            let v1 = proofs::Supplement::decode(&v1).unwrap().verify(phone.shared.signers.as_ref().unwrap()).await.unwrap();
            assert_eq!(v1.to_wire(), plain.to_wire(), "version 1 proofs preserve the exact authorized legacy reply");
            // version 2, as a device asks (P8): the same edits, the sender's own held by their paths in place of
            // their signatures, each checking as its signature does, and fewer bytes on the wire
            let v2 = proofs::Request { kind, request: body.clone(), known: Default::default(), paths: true, held: None };
            let wire = exchange(&peer.conn, proofs::KIND, &v2.encode().unwrap(), REPLY_LIMIT).await.unwrap();
            let v1_wire = proofs::Request { kind, request: body.clone(), known: Default::default(), paths: false, held: None };
            let v1_wire = exchange(&peer.conn, proofs::KIND, &v1_wire.encode().unwrap(), REPLY_LIMIT).await.unwrap();
            assert!(wire.len() < v1_wire.len(), "{} bytes with paths, {} with signatures", wire.len(), v1_wire.len());
            let (batch, _) = phone.shared.reply_to(&peer, kind, &body, REPLY_LIMIT).await.unwrap();
            let ids = |r: &Reply| r.edits.iter().map(|s| s.edit.id()).collect::<Vec<_>>();
            assert_eq!(ids(&batch), ids(&plain), "paths preserve the exact authorized edits");
            assert!(batch.edits.iter().all(|signed| signed.verify().is_ok()));
            let own = batch.edits.iter().find(|signed| signed.edit.id() == first_id).unwrap();
            assert!(avendb::batch::held_by_path(own), "the sender's own edit comes by its path");
            assert!(!phone.shared.unbatched.lock().unwrap().contains(&peer.conn.stable_id()));
            assert!(!phone.shared.unstripped.lock().unwrap().contains(&peer.conn.stable_id()));
        }
        let previous = phone.shared.signers.as_ref().unwrap().known(sender).await.unwrap();
        phone.sync_with(mac.id()).await.unwrap();
        assert!(phone.read(move |lab, me| lab.fetched(me, first) > 0).await);
        let next = mac.act(move |lab, me| {
            lab.create(me, coop, coop, "doc", &[], document("Second batch", "extends the durable root", me))
        }).await.unwrap();
        mac.shared.save().await.unwrap();
        phone.sync_with(mac.id()).await.unwrap();
        assert!(phone.read(move |lab, me| lab.fetched(me, next) > 0).await);
        let latest = phone.shared.signers.as_ref().unwrap().known(sender).await.unwrap();
        assert!(latest > previous, "later root is linked to the exact previously admitted prefix");
        assert!(!phone.shared.unbatched.lock().unwrap().contains(&peer.conn.stable_id()));
        assert_eq!(stranger.sync_with(mac.id()).await.unwrap(), 0);
        assert_eq!(stranger.shared.signers.as_ref().unwrap().known(sender).await, None,
            "a device without access learns no signer root from an empty authorized reply");
        let unrelated = proofs::Request {
            kind: REQUEST,
            request: phone.read(move |lab, me| lab.request(me, sender).to_wire()).await,
            known: [(outsider, 3)].into_iter().collect(),
            paths: true,
            held: None,
        }.encode().unwrap();
        assert!(exchange(&peer.conn, proofs::KIND, &unrelated, REPLY_LIMIT).await.is_err());
        phone.shutdown().await.unwrap();
        let mut restart = world();
        handbook_ready(&mut restart);
        let phone = Node::spawn(restart.lab.split(receiver, &[], [154; 32]), receiver, b.options()).await.unwrap();
        assert_eq!(phone.shared.signers.as_ref().unwrap().known(sender).await, Some(latest));
        for node in [&phone, &mac, &stranger] { node.shutdown().await.unwrap(); }
    }

    /// S8 (`spec/AvenDB/Segments.lean`): a relay that keeps segments takes a writer's ids with its root, checked before
    /// they are held, keeps every signature for old apps, and serves a reader the writer's edits by paths to that root,
    /// one root a reply; the reader then keeps the segment and serves it in its turn. A restart keeps the segment.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_relay_serves_a_writers_edits_by_paths_to_its_segment() {
        let mut w = world();
        let coop = handbook_ready(&mut w);
        let (writer, relay_d, reader) = (w.mac_a, w.server, w.mac_b);
        let (a, b, c) = (Folder::new(), Folder::new(), Folder::new());
        let mac = Node::spawn(w.lab.split(writer, &[], [171; 32]), writer, a.options()).await.unwrap();
        let relay_options = || Options { segments: true, paths: false, ..b.options() };
        let relay = Node::spawn(w.lab.split(relay_d, &[], [172; 32]), relay_d, relay_options()).await.unwrap();
        let bob = Node::spawn(w.lab.split(reader, &[], [173; 32]), reader, Options { segments: true, ..c.options() })
            .await.unwrap();
        let mut written = vec![];
        for n in 0..5 {
            let entry = mac.act(move |lab, me| {
                lab.create(me, coop, coop, "doc", &[], document(&format!("Segment {n}"), "one root for all", me))
            }).await.unwrap();
            written.push(entry);
        }
        mac.shared.save().await.unwrap();
        let ids: Vec<_> = mac.read(|lab, me| lab.log(me).ids().to_vec()).await;
        relay.know(mac.addr());
        relay.sync_with(mac.id()).await.unwrap();
        let held = relay.shared.signers.as_ref().unwrap().held(16).await;
        let (root, segment) = held[&writer];
        assert!(segment > 0 && segment == root, "the relay holds the writer's ids up to its newest root");
        // the relay keeps every signature, so it serves old apps as before
        let mine = ids.clone();
        let kept = relay.read(move |lab, me| {
            ids.iter().filter_map(|id| lab.signed_edit(me, *id)).all(|s| !avendb::batch::held_by_path(&s))
        }).await;
        assert!(kept, "a relay asking without paths holds each signature");
        bob.know(relay.addr());
        bob.sync_with(relay.id()).await.unwrap();
        for entry in &written {
            let entry = *entry;
            assert!(bob.read(move |lab, me| lab.fetched(me, entry) > 0).await, "every edit came through the relay");
        }
        let by_path = bob.read(move |lab, me| {
            mine.iter().filter_map(|id| lab.signed_edit(me, *id)).filter(avendb::batch::held_by_path).count()
        }).await;
        assert!(by_path >= written.len(), "the writer's edits came by paths the relay made: {by_path}");
        let bob_held = bob.shared.signers.as_ref().unwrap().held(16).await;
        assert_eq!(bob_held[&writer], (root, segment), "the reader keeps the segment too, and serves it in its turn");
        // ids that rebuild no signed root are refused, and change nothing
        let signers = relay.shared.signers.as_ref().unwrap();
        let first = signers.segment(writer, 0, 1).await.unwrap()[0];
        let newest = signers.peer_proof(writer, first).await.unwrap();
        assert!(!signers.extend(&newest.root, segment, &[avendb::id::EditId::from_u64(9)]).await.unwrap());
        assert_eq!(signers.held(16).await[&writer], (root, segment));
        relay.shutdown().await.unwrap();
        let mut restart = world();
        handbook_ready(&mut restart);
        let relay = Node::spawn(restart.lab.split(relay_d, &[], [174; 32]), relay_d, relay_options()).await.unwrap();
        assert_eq!(relay.shared.signers.as_ref().unwrap().held(16).await[&writer], (root, segment),
            "a cold start holds the segment it held");
        for node in [&relay, &bob, &mac] { node.shutdown().await.unwrap(); }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn unsupported_or_malformed_supplements_fall_back_without_disabling_packed_replies() {
        use iroh::{Endpoint, SecretKey};
        use iroh::endpoint::presets;
        for mode in 0..3 {
            let mut w = world();
            handbook_ready(&mut w);
            let (sender, receiver) = (w.mac_a, w.phone_a);
            let folder = Folder::new();
            let phone = Node::spawn(w.lab.split(receiver, &[], [160 + mode; 32]), receiver, folder.options()).await.unwrap();
            let raw = Endpoint::builder(presets::Empty)
                .secret_key(SecretKey::from_bytes(&w.lab.endpoint_secret(sender).unwrap()))
                .crypto_provider(crate::pq_provider()).clear_ip_transports()
                .bind_addr("127.0.0.1:0").unwrap().bind().await.unwrap();
            let conn = raw.connect(phone.addr(), ALPN).await.unwrap();
            let drawn = exporter(&conn).unwrap();
            let (mut send, mut recv) = conn.open_bi().await.unwrap();
            send.write_all(&w.lab.hello(sender, &drawn, true).unwrap().to_wire()).await.unwrap();
            send.finish().unwrap();
            let hello = Hello::from_wire(&recv.read_to_end(HELLO_LIMIT).await.unwrap()).unwrap();
            assert_eq!(hello.verify(&drawn, false, phone.id().as_bytes()), Some(receiver));
            let peer = tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    if let Some(peer) = phone.shared.live(raw.id()) { break peer; }
                    tokio::task::yield_now().await;
                }
            }).await.unwrap();
            // The receiver's unrelated root must never appear in a request to this peer.
            let key = avendb::sign::DeviceKey::from_secret([171; 32]);
            let mut ledger = avendb::batch::SignerLog::wrap(key.id(), [EditId::from_u64(171)]);
            let root = ledger.commit(&key).unwrap();
            assert!(phone.shared.signers.as_ref().unwrap().admit((*root).clone(), &[]).await.unwrap());
            let seen = std::sync::Mutex::new(Vec::new());
            // the writers the phone may name to the Mac in a segment request: those of the logs it names to it already
            let shown = phone.read(move |lab, me| lab.writers_shown(me, sender)).await;
            let serving = async {
                loop {
                    let (mut send, mut recv) = conn.accept_bi().await.unwrap();
                    let message = recv.read_to_end(MESSAGE_LIMIT).await.unwrap();
                    let (&kind, body) = message.split_first().unwrap();
                    if matches!(kind, ANNOUNCE | STATE) { send.finish().unwrap(); continue; }
                    if matches!(kind, RANGES | crate::transports::control::KIND) { send.reset(REFUSED).unwrap(); continue; }
                    seen.lock().unwrap().push(kind);
                    if kind == proofs::KIND {
                        let batch = proofs::Request::decode(body).unwrap();
                        if batch.held.is_some() {
                            // version 3 (S8) names the writers of what it shares with this peer, no other
                            assert!(batch.known.keys().all(|id| shown.contains(id)), "a segment request names no stranger");
                        } else {
                            assert!(batch.known.keys().all(|id| *id == sender));
                        }
                        assert!(!batch.known.contains_key(&key.id()));
                        if mode == 1 {
                            send.write_all(b"malformed supplement").await.unwrap();
                            send.finish().unwrap();
                        } else { send.reset(REFUSED).unwrap(); }
                        continue;
                    }
                    assert_eq!(kind & !PACKED, REQUEST);
                    Request::from_wire(body).unwrap();
                    if mode == 2 && kind & PACKED != 0 { send.reset(REFUSED).unwrap(); continue; }
                    let reply = if kind & PACKED != 0 { Packed(Reply::default()).to_wire() } else { Reply::default().to_wire() };
                    send.write_all(&reply).await.unwrap();
                    send.finish().unwrap();
                }
            };
            let asking = async {
                let request = phone.read(move |lab, me| lab.request(me, sender).to_wire()).await;
                for _ in 0..2 {
                    let (reply, _) = phone.shared.reply_to(&peer, REQUEST, &request, REPLY_LIMIT).await.unwrap();
                    assert!(reply.edits.is_empty());
                }
            };
            tokio::time::timeout(Duration::from_secs(10), n0_future::future::or(asking, serving)).await.unwrap();
            // version 3 first (S8), then version 2, then version 1 (P8)
            let expected = if mode == 2 {
                vec![proofs::KIND, proofs::KIND, proofs::KIND, REQUEST | PACKED, REQUEST, REQUEST]
            } else { vec![proofs::KIND, proofs::KIND, proofs::KIND, REQUEST | PACKED, REQUEST | PACKED] };
            assert_eq!(*seen.lock().unwrap(), expected, "only the unsupported format is remembered on this connection");
            assert_eq!(phone.shared.unpacked.lock().unwrap().contains(&peer.conn.stable_id()), mode == 2);
            assert!(phone.shared.unbatched.lock().unwrap().contains(&peer.conn.stable_id()));
            assert!(phone.shared.unsegmented.lock().unwrap().contains(&peer.conn.stable_id()));
            phone.shutdown().await.unwrap();
            raw.close().await;
        }
    }
}

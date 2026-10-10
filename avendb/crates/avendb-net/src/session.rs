//! A connection between two nodes: the hellos first, on the first stream, then one message on a stream of its own,
//! its kind in its first byte, and the answer back on the same stream. A message the node refuses gets its stream
//! reset.

use std::sync::Arc;

use anyhow::{Context as _, Result, anyhow, bail};
use avendb::id::SignerId;
use avendb::sign::{Hello, RelayPass};
use avendb::wire::{Announce, Claim, Join, Reply, Request, Wire};
use iroh::endpoint::{Connection, RecvStream, VarInt};
use iroh::protocol::{AcceptError, ProtocolHandler};

use crate::{ALPN, Peer, Shared, WAIT, unix_now};

/// A request, answered by a reply.
pub(crate) const REQUEST: u8 = 0;
/// An announcement, answered by nothing.
pub(crate) const ANNOUNCE: u8 = 1;
/// A request for the node's contact card, answered by its vault logs, if it hands its card out (the server).
pub(crate) const CARD: u8 = 2;
/// A passkey's pass for the peer's device (P8c, `sign::RelayPass`), the device whose hello proved it on this
/// connection, answered by the link card of each passkey the pass may be from: the logs of the vaults it owns
/// (`Lab::link_card`).
pub(crate) const LINK: u8 = 3;
/// A new device's join (P8c), answered by nothing once the node accepts it (`Lab::accept_join`).
pub(crate) const JOIN: u8 = 4;
/// A request for the server's key to seal to (P8f), answered by it while nobody has claimed the server
/// (`Lab::claim_key`).
pub(crate) const CLAIM_KEY: u8 = 5;
/// A claim of the server (P8f), answered by its join once it takes it (`Lab::accept_claim`): the edit that adds it to
/// avenCEO, signed by it too, and its McEliece key.
pub(crate) const CLAIM: u8 = 6;

/// The error code a node closes a connection or a stream with when it refuses it.
pub(crate) const REFUSED: VarInt = VarInt::from_u32(1);

/// The most a hello may take: an SLH-DSA-SHA2-128f signature is 17,088 bytes.
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
}

/// The answer to the message on the stream `recv`: a request gets a reply, and an announcement nothing, but the
/// node asks the peer if its digests differ; a request for its card gets its vault logs, if it hands its card out. A
/// passkey's pass for the device whose hello proved it on this connection, made in its minutes, gets the link card of
/// each passkey it may be from, and a join the node accepts gets nothing, and the node tells the new device what it
/// holds. A server nobody has claimed
/// yet hands its key to seal to whoever asks, and answers the first claim it takes with its join (P8f).
async fn answer(shared: &Arc<Shared>, peer: &Peer, mut recv: RecvStream) -> Result<Vec<u8>> {
    let message = recv.read_to_end(MESSAGE_LIMIT).await?;
    let (&kind, body) = message.split_first().context("an empty message")?;
    let device = peer.device;
    match kind {
        REQUEST => {
            let (request, page) = (Request::from_wire(body)?, shared.opts.page);
            let (edits, ids, more) = shared.lab(move |lab, me| lab.reply(me, device, &request, page)).await;
            let blobs = shared.offer(ids).await?;
            Ok(Reply { edits, blobs, more }.to_wire())
        }
        ANNOUNCE => {
            let Announce { digests } = Announce::from_wire(body)?;
            if shared.lab(move |lab, me| lab.differs(me, &digests)).await {
                shared.ask_soon(peer.endpoint);
            }
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
        CLAIM if shared.opts.card => {
            let claim = Claim::from_wire(body)?;
            let accept = move |lab: &mut avendb::lab::Lab, me| -> Result<_, avendb::policy::Refusal> {
                let join = lab.accept_claim(me, claim)?;
                Ok((join, lab.vault_of(me)))
            };
            let (join, avenceo) = shared.lab(accept).await.map_err(|why| anyhow!("the claim is refused: {why:?}"))?;
            tracing::info!("avendb: claimed by {device:?}, a device of avenCEO's owner; avenCEO is {avenceo:?}");
            shared.changed.notify_one();
            Ok(join.to_wire())
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

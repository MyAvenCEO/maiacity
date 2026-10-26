//! The simulated network (P7, `docs/AVENDB_SYNC_V2.md`): nodes of one test reach each other through an in-memory
//! carrier that loses, delays, duplicates and reorders their packets, and cuts links between them, each by a seed. A
//! node on it (`Options::sim`) binds no socket and has no relay: every packet of its QUIC connections goes through
//! `Net`, so a scenario runs the real node, its sessions, pulls and blobs, under faults a loopback socket never shows.
//!
//! What a seed fixes: the fault profile (`Faults::of`), and for each link (sender, receiver) the stream of choices
//! made for its packets in the order that link carries them: the third packet from the phone to the server meets the
//! same fate in every run of a seed. What it doesn't fix yet: the order in which a multi-threaded runtime interleaves
//! the nodes' tasks, so a run of a seed replays its faults, not its schedule. Once the node's state is one actor, its
//! steps are a function of the messages it takes in, and a seed comes closer to one whole run.
//!
//! `seeds` runs a scenario for many seeds and names the first that fails, with the last events the network saw;
//! `AVENDB_SIM_SEEDS` sets how many (CI runs a few, a soak run a thousand) and `AVENDB_SIM_SEED` replays one.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fmt::Write as _;
use std::future::Future;
use std::io;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};
use std::time::Duration;

use iroh::EndpointId;
use iroh::endpoint::transports::{CustomEndpoint, CustomSender, CustomTransport, RecvInfo, Transmit};
use iroh_base::CustomAddr;

/// Its transport id, apart from iroh's test transport (0x20) and our carriers (`transports::Carrier`).
const SIM: u64 = 0x6176_656e_5349_0001;
/// The most packets waiting for a node, as a socket's receive buffer: more are lost, as there.
const INBOX: usize = 1024;
/// The events kept for a failure's report.
const TRACE: usize = 64;

/// SplitMix64: small, fast and the same everywhere, which is all a fault schedule needs.
#[derive(Clone, Debug)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed)
    }

    pub fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// A number below `n`, for `n` > 0.
    pub fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }

    /// True `per_mille` times in a thousand.
    pub fn chance(&mut self, per_mille: u32) -> bool {
        self.below(1000) < u64::from(per_mille)
    }
}

/// What the network does to packets: each a share of them in thousandths, and the longest a packet waits.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Faults {
    pub lose: u32,
    pub duplicate: u32,
    /// A delayed packet waits up to this long, so later ones may pass it.
    pub delay: Duration,
    /// The share of packets delayed at all.
    pub delayed: u32,
}

impl Faults {
    /// A calm network: every packet arrives once, at once, in order.
    pub const CALM: Faults = Faults { lose: 0, duplicate: 0, delay: Duration::ZERO, delayed: 0 };

    /// The profile of seed `seed`: up to 15 % lost, 5 % duplicated, and up to half delayed by up to 80 ms. Every
    /// eighth seed is calm, so a failure that needs no fault at all shows as one.
    pub fn of(seed: u64) -> Faults {
        let mut rng = Rng::new(seed ^ 0x5eed_fa17);
        if seed % 8 == 0 {
            return Faults::CALM;
        }
        Faults {
            lose: rng.below(151) as u32,
            duplicate: rng.below(51) as u32,
            delay: Duration::from_millis(rng.below(81)),
            delayed: rng.below(501) as u32,
        }
    }
}

/// The network of one scenario. Cheap to clone: each clone is the same network.
#[derive(Clone, Debug)]
pub struct Net(Arc<Mutex<Hub>>);

#[derive(Debug)]
struct Hub {
    seed: u64,
    faults: Faults,
    inboxes: BTreeMap<EndpointId, Inbox>,
    /// Each link's own choices, in the order it carries packets.
    links: BTreeMap<(EndpointId, EndpointId), Rng>,
    /// Links that carry nothing, both ways.
    cut: BTreeSet<(EndpointId, EndpointId)>,
    /// Nodes that reach only these peers, as a browser reaches only its relay.
    only: BTreeMap<EndpointId, BTreeSet<EndpointId>>,
    names: BTreeMap<EndpointId, String>,
    counts: Counts,
    trace: VecDeque<String>,
}

#[derive(Debug, Default)]
struct Inbox {
    packets: VecDeque<Packet>,
    waker: Option<Waker>,
}

#[derive(Debug)]
struct Packet {
    from: EndpointId,
    bytes: Vec<u8>,
}

/// What the network did, for a scenario to check that its faults happened.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    pub sent: u64,
    pub delivered: u64,
    pub lost: u64,
    pub duplicated: u64,
    pub delayed: u64,
    pub blocked: u64,
}

fn custom(id: EndpointId) -> CustomAddr {
    CustomAddr::from_parts(SIM, id.as_bytes())
}

/// Where endpoint `id` is reached on a simulated network (`Node::addr`).
pub(crate) fn addr(id: EndpointId) -> iroh_base::TransportAddr {
    iroh_base::TransportAddr::Custom(custom(id))
}

fn endpoint(addr: &CustomAddr) -> io::Result<EndpointId> {
    let bytes: &[u8; 32] = addr.data().try_into().map_err(|_| io::Error::other("not a simulated address"))?;
    EndpointId::from_bytes(bytes).map_err(|_| io::Error::other("not a simulated endpoint"))
}

fn link(a: EndpointId, b: EndpointId) -> (EndpointId, EndpointId) {
    if a <= b { (a, b) } else { (b, a) }
}

impl Net {
    /// The network of seed `seed`, with its profile's faults (`Faults::of`).
    pub fn new(seed: u64) -> Net {
        Net::with(seed, Faults::of(seed))
    }

    pub fn with(seed: u64, faults: Faults) -> Net {
        Net(Arc::new(Mutex::new(Hub {
            seed,
            faults,
            inboxes: BTreeMap::new(),
            links: BTreeMap::new(),
            cut: BTreeSet::new(),
            only: BTreeMap::new(),
            names: BTreeMap::new(),
            counts: Counts::default(),
            trace: VecDeque::new(),
        })))
    }

    fn hub(&self) -> std::sync::MutexGuard<'_, Hub> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn seed(&self) -> u64 {
        self.hub().seed
    }

    pub fn faults(&self) -> Faults {
        self.hub().faults
    }

    /// From now on the network does `faults`: `Faults::CALM` once a scenario's faulty part is over.
    pub fn set_faults(&self, faults: Faults) {
        let mut hub = self.hub();
        hub.faults = faults;
        hub.note(format!("faults {faults:?}"));
    }

    /// The carrier for endpoint `id`, which a node binds (`Node::spawn` with `Options::sim`).
    pub(crate) fn transport(&self, id: EndpointId) -> Arc<Transport> {
        let mut hub = self.hub();
        hub.inboxes.entry(id).or_default();
        Arc::new(Transport { net: self.clone(), id, addrs: n0_watcher::Watchable::new(vec![custom(id)]) })
    }

    /// Name endpoint `id` in the trace.
    pub fn name(&self, id: EndpointId, name: &str) {
        self.hub().names.insert(id, name.to_string());
    }

    /// The link between `a` and `b` carries nothing until `heal`.
    pub fn cut(&self, a: EndpointId, b: EndpointId) {
        let mut hub = self.hub();
        hub.cut.insert(link(a, b));
        let note = format!("cut {} | {}", hub.name_of(a), hub.name_of(b));
        hub.note(note);
    }

    pub fn heal(&self, a: EndpointId, b: EndpointId) {
        let mut hub = self.hub();
        hub.cut.remove(&link(a, b));
        let note = format!("heal {} | {}", hub.name_of(a), hub.name_of(b));
        hub.note(note);
    }

    /// Every cut link carries again; packets still meet the seed's faults.
    pub fn heal_all(&self) {
        let mut hub = self.hub();
        hub.cut.clear();
        hub.note("heal all".into());
    }

    /// `a` reaches `peers` alone, and nobody else reaches it: a browser behind its relay, an agent in a cloud session.
    pub fn only(&self, a: EndpointId, peers: &[EndpointId]) {
        let mut hub = self.hub();
        hub.only.insert(a, peers.iter().copied().collect());
        let names: Vec<String> = peers.iter().map(|p| hub.name_of(*p)).collect();
        let note = format!("{} reaches only {}", hub.name_of(a), names.join(", "));
        hub.note(note);
    }

    /// For `length`, cut and heal links between `nodes` at the seed's own moments, each cut lasting up to 600 ms,
    /// while the scenario goes on beside it; then every link carries again (`heal_all`).
    pub async fn storm(&self, nodes: &[EndpointId], length: Duration) {
        let mut rng = Rng::new(self.seed() ^ 0x5707_3a11);
        let end = tokio::time::Instant::now() + length;
        while nodes.len() > 1 && tokio::time::Instant::now() < end {
            let a = nodes[rng.below(nodes.len() as u64) as usize];
            let b = nodes[rng.below(nodes.len() as u64) as usize];
            if a != b {
                self.cut(a, b);
                tokio::time::sleep(Duration::from_millis(50 + rng.below(551))).await;
                self.heal(a, b);
            }
            tokio::time::sleep(Duration::from_millis(rng.below(200))).await;
        }
        self.heal_all();
    }

    pub fn counts(&self) -> Counts {
        self.hub().counts
    }

    /// The seed, its faults, what the network did and its last events: what a failure reports.
    pub fn report(&self) -> String {
        let hub = self.hub();
        let mut out = format!("seed {} {:?}\n{:?}\n", hub.seed, hub.faults, hub.counts);
        for line in &hub.trace {
            let _ = writeln!(out, "  {line}");
        }
        out
    }

    fn send(&self, from: EndpointId, to: EndpointId, contents: &[u8], segment: usize) {
        let mut guard = self.hub();
        let hub = &mut *guard;
        if hub.blocks(from, to) {
            hub.counts.blocked += contents.chunks(segment).count() as u64;
            return;
        }
        let (faults, seed) = (hub.faults, hub.seed);
        for bytes in contents.chunks(segment) {
            hub.counts.sent += 1;
            let rng = hub.links.entry((from, to)).or_insert_with(|| link_rng(seed, from, to));
            let (lose, duplicate, delayed) =
                (rng.chance(faults.lose), rng.chance(faults.duplicate), rng.chance(faults.delayed));
            let wait = if delayed && !faults.delay.is_zero() {
                Duration::from_micros(rng.below(faults.delay.as_micros() as u64 + 1))
            } else {
                Duration::ZERO
            };
            if lose {
                hub.counts.lost += 1;
                continue;
            }
            let copies = if duplicate { 2 } else { 1 };
            hub.counts.duplicated += copies - 1;
            for _ in 0..copies {
                if wait.is_zero() {
                    hub.deliver(to, Packet { from, bytes: bytes.to_vec() });
                } else {
                    hub.counts.delayed += 1;
                    let (net, bytes) = (self.clone(), bytes.to_vec());
                    tokio::spawn(async move {
                        tokio::time::sleep(wait).await;
                        let mut hub = net.hub();
                        // a link cut while the packet was on its way loses it
                        if hub.blocks(from, to) {
                            hub.counts.blocked += 1;
                        } else {
                            hub.deliver(to, Packet { from, bytes });
                        }
                    });
                }
            }
        }
    }
}

fn link_rng(seed: u64, from: EndpointId, to: EndpointId) -> Rng {
    let mut mix = Rng::new(seed);
    let mut state = mix.next();
    for byte in from.as_bytes().iter().chain(to.as_bytes()) {
        state = Rng::new(state ^ u64::from(*byte)).next();
    }
    Rng::new(state)
}

impl Hub {
    fn name_of(&self, id: EndpointId) -> String {
        self.names.get(&id).cloned().unwrap_or_else(|| id.fmt_short().to_string())
    }

    fn note(&mut self, line: String) {
        if self.trace.len() == TRACE {
            self.trace.pop_front();
        }
        let counts = self.counts;
        self.trace.push_back(format!("[sent {} lost {}] {line}", counts.sent, counts.lost));
    }

    fn blocks(&self, from: EndpointId, to: EndpointId) -> bool {
        let fenced = |a: EndpointId, b: EndpointId| self.only.get(&a).is_some_and(|peers| !peers.contains(&b));
        self.cut.contains(&link(from, to)) || fenced(from, to) || fenced(to, from)
    }

    fn deliver(&mut self, to: EndpointId, packet: Packet) {
        let Some(inbox) = self.inboxes.get_mut(&to) else {
            self.counts.lost += 1;
            return;
        };
        if inbox.packets.len() >= INBOX {
            self.counts.lost += 1;
            return;
        }
        inbox.packets.push_back(packet);
        self.counts.delivered += 1;
        if let Some(waker) = inbox.waker.take() {
            waker.wake();
        }
    }
}

/// One node's end of the network.
#[derive(Debug)]
pub(crate) struct Transport {
    net: Net,
    id: EndpointId,
    addrs: n0_watcher::Watchable<Vec<CustomAddr>>,
}

#[derive(Debug)]
struct Bound {
    net: Net,
    id: EndpointId,
    addrs: n0_watcher::Watchable<Vec<CustomAddr>>,
}

impl Drop for Bound {
    fn drop(&mut self) {
        // a node that stops takes its inbox with it: what is sent to it from then on is lost
        self.net.hub().inboxes.remove(&self.id);
    }
}

#[derive(Debug)]
struct Sender {
    net: Net,
    id: EndpointId,
}

impl CustomTransport for Transport {
    fn bind(&self) -> io::Result<Box<dyn CustomEndpoint>> {
        self.net.hub().inboxes.entry(self.id).or_default();
        Ok(Box::new(Bound { net: self.net.clone(), id: self.id, addrs: self.addrs.clone() }))
    }
}

impl CustomSender for Sender {
    fn is_valid_send_addr(&self, addr: &CustomAddr) -> bool {
        addr.id() == SIM && addr.data().len() == 32
    }

    fn poll_send(
        &self,
        _cx: &mut Context,
        dst: &CustomAddr,
        _src: Option<&CustomAddr>,
        transmit: &Transmit<'_>,
    ) -> Poll<io::Result<()>> {
        let to = endpoint(dst)?;
        let segment = transmit.segment_size.unwrap_or(transmit.contents.len()).max(1);
        self.net.send(self.id, to, transmit.contents, segment);
        Poll::Ready(Ok(()))
    }
}

impl CustomEndpoint for Bound {
    fn watch_local_addrs(&self) -> n0_watcher::Direct<Vec<CustomAddr>> {
        self.addrs.watch()
    }

    fn create_sender(&self) -> Arc<dyn CustomSender> {
        Arc::new(Sender { net: self.net.clone(), id: self.id })
    }

    fn poll_recv(
        &mut self,
        cx: &mut Context,
        bufs: &mut [io::IoSliceMut<'_>],
        metas: &mut [noq_udp::RecvMeta],
        infos: &mut [RecvInfo],
    ) -> Poll<io::Result<usize>> {
        assert_eq!(bufs.len(), metas.len());
        assert_eq!(bufs.len(), infos.len());
        let mut hub = self.net.hub();
        let Some(inbox) = hub.inboxes.get_mut(&self.id) else {
            return Poll::Ready(Err(io::Error::other("simulated endpoint closed")));
        };
        let mut count = 0;
        while count < bufs.len() {
            let Some(packet) = inbox.packets.pop_front() else { break };
            // never truncate one QUIC packet into another: one too big for the buffer is lost
            if bufs[count].len() < packet.bytes.len() {
                continue;
            }
            bufs[count][..packet.bytes.len()].copy_from_slice(&packet.bytes);
            metas[count] = noq_udp::RecvMeta::default();
            metas[count].len = packet.bytes.len();
            metas[count].stride = packet.bytes.len();
            infos[count] = RecvInfo::new(custom(packet.from), Some(custom(self.id)));
            count += 1;
        }
        if count > 0 {
            return Poll::Ready(Ok(count));
        }
        inbox.waker = Some(cx.waker().clone());
        Poll::Pending
    }
}

/// How many seeds `seeds` runs: `AVENDB_SIM_SEEDS`, else `default`.
pub fn seed_count(default: u64) -> u64 {
    std::env::var("AVENDB_SIM_SEEDS").ok().and_then(|n| n.parse().ok()).unwrap_or(default)
}

/// Run `scenario` once for each seed (`AVENDB_SIM_SEED` alone, else seeds 1 to `seed_count(default)`), each within
/// `limit`: a scenario that errs, panics or outlasts its limit fails the test, naming its seed and what its network
/// saw. A hang counts as a failure, as a scenario has no other way to say it waits forever.
pub async fn seeds<F, Fut>(name: &str, default: u64, limit: Duration, scenario: F)
where
    F: Fn(Net) -> Fut,
    Fut: Future<Output = anyhow::Result<()>> + Send + 'static,
{
    let only = std::env::var("AVENDB_SIM_SEED").ok().and_then(|n| n.parse::<u64>().ok());
    let list: Vec<u64> = match only {
        Some(seed) => vec![seed],
        None => (1..=seed_count(default)).collect(),
    };
    for seed in list {
        let net = Net::new(seed);
        let began = std::time::Instant::now();
        let run = tokio::spawn(tokio::time::timeout(limit, scenario(net.clone())));
        let failure = match run.await {
            Ok(Ok(Ok(()))) => None,
            Ok(Ok(Err(error))) => Some(format!("{error:#}")),
            Ok(Err(_)) => Some(format!("no end within {limit:?}")),
            Err(panic) => Some(format!("panicked: {panic}")),
        };
        if let Some(why) = failure {
            panic!(
                "simulation {name}, seed {seed}: {why}\nreplay: AVENDB_SIM_SEED={seed}\n{}",
                net.report()
            );
        }
        eprintln!("SIM {name} seed {seed} ok in {:?} {:?}", began.elapsed(), net.counts());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_seed_fixes_its_profile_and_each_links_choices() {
        assert_eq!(Faults::of(8), Faults::CALM);
        assert_eq!(Faults::of(3), Faults::of(3));
        let (a, b) = (iroh::SecretKey::from_bytes(&[1; 32]).public(), iroh::SecretKey::from_bytes(&[2; 32]).public());
        let draw = |seed, x, y| {
            let mut rng = link_rng(seed, x, y);
            (0..16).map(|_| rng.next()).collect::<Vec<_>>()
        };
        assert_eq!(draw(5, a, b), draw(5, a, b));
        assert_ne!(draw(5, a, b), draw(5, b, a), "each direction its own");
        assert_ne!(draw(5, a, b), draw(6, a, b));
    }

    #[test]
    fn a_fenced_node_reaches_only_its_peers_and_a_cut_blocks_both_ways() {
        let key = |n| iroh::SecretKey::from_bytes(&[n; 32]).public();
        let (browser, server, mac) = (key(1), key(2), key(3));
        let net = Net::with(1, Faults::CALM);
        net.only(browser, &[server]);
        let hub = net.hub();
        assert!(!hub.blocks(browser, server) && !hub.blocks(server, browser));
        assert!(hub.blocks(browser, mac) && hub.blocks(mac, browser));
        drop(hub);
        net.cut(server, mac);
        assert!(net.hub().blocks(mac, server));
        net.heal_all();
        assert!(!net.hub().blocks(mac, server));
        assert!(net.hub().blocks(browser, mac), "a fence outlasts a storm");
    }
}

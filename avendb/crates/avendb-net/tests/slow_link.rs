//! A catch-up over a link slower than a page per `PAGE_WAIT` (180 s): Samuel's iPhone on 2026-10-28, every connection
//! over the relay at 66 to 214 KB/s, took one page and then failed each asking for ever ("no page in time"), as a pull
//! keeps pages in flight that its peer sends one after another, so the second ends past any fixed time while bytes come
//! all along. A page's wait is for its link to stop moving (`session::unstalled`), on both ends.
//!
//! The link runs on simulated time: one thread, tokio's clock paused, so time moves as the link's packets and the
//! nodes' timers say (as `sync_bench`'s `_bulk` links), and minutes of the link take seconds.

use std::collections::HashSet;
use std::time::Duration;

use avendb::cast::*;
use avendb::id::EditId;
use avendb_net::sim::{Faults, Net};
use avendb_net::{Node, Options};

/// Bytes a second each way: a page of `Options::page` (4 MiB) in some 170 s, so that the second one in flight ends
/// at some 340 s, past `PAGE_WAIT`.
const RATE: u64 = 25_000;
/// The bulk's edits, each of `FAT` text: some 6 MB, two pages and a part.
const EDITS: usize = 125;
const FAT: usize = 48 << 10;

#[test]
fn a_catch_up_over_a_link_slower_than_a_page_per_page_wait_lands_every_page_and_fails_none() {
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().start_paused(true).build().expect("a runtime");
    rt.block_on(async {
        let mut w = world();
        let coop = handbook_ready(&mut w);
        let (mac_a, passkey_a, mac_b, passkey_b) = (w.mac_a, w.passkey_a, w.mac_b, w.passkey_b);
        let held: HashSet<EditId> = w.lab.backup(mac_b).signed().iter().map(|s| s.edit.id()).collect();
        for k in 0..EDITS {
            // letters at random, so that no layer squeezes them
            let body: String = (0..FAT).map(|i| (b'a' + ((k * 7919 + i * 104_729) % 9973 % 26) as u8) as char).collect();
            w.lab.create(mac_a, coop, coop, "doc", &[], document(&format!("Bulk {k}"), &body, mac_a)).expect("an entry");
        }
        let want: Vec<EditId> =
            w.lab.backup(mac_a).signed().iter().map(|s| s.edit.id()).filter(|id| !held.contains(id)).collect();

        let net = Net::with(1, Faults { rate: RATE, ..Faults::CALM });
        let mac = Node::spawn(w.lab.split(mac_a, &[passkey_a], [1; 32]), mac_a, Options::simulated(&net)).await.expect("Alice's Mac");
        let bob = Node::spawn(w.lab.split(mac_b, &[passkey_b], [3; 32]), mac_b, Options::simulated(&net)).await.expect("Bob's Mac");
        mac.know(bob.addr());
        bob.know(mac.addr());

        let start = tokio::time::Instant::now();
        loop {
            let wanted = want.clone();
            let missing = bob
                .read(move |lab, me| {
                    let ids: HashSet<&EditId> = lab.log(me).ids().iter().collect();
                    wanted.iter().filter(|id| !ids.contains(id)).count()
                })
                .await;
            if missing == 0 {
                break;
            }
            // the link's own time for the bulk is some 250 s; twice that, and a page per asking, is a stall
            assert!(start.elapsed() < Duration::from_secs(900), "Bob's Mac catches up ({missing} of {} missing)", want.len());
            bob.sync_with(mac.id()).await.ok();
        }
        let network = bob.network().await;
        let peers = network["peers"].as_array().cloned().unwrap_or_default();
        let failed: u64 = peers.iter().filter_map(|p| p["pulled"]["failed"].as_u64()).sum();
        let pages: u64 = peers.iter().filter_map(|p| p["pulled"]["pages"].as_u64()).sum();
        assert_eq!(failed, 0, "no asking fails while its link moves ({pages} pages in {:?})", start.elapsed());
    });
}

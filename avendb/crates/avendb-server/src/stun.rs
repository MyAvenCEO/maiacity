//! The server's STUN responder (P8, RFC 8489's Binding alone): a browser's WebRTC carrier asks it for the address its
//! network shows the internet, to offer it to another browser as a candidate (`src/lib/avendb/transports/webrtc.js`),
//! so two browsers behind ordinary NATs reach each other straight, and through the relay only where they can't. No
//! public STUN server learns who syncs with whom. It answers a Binding request with the address it came from and
//! nothing else: no credentials, no TURN, no state kept between packets.

use std::net::{IpAddr, SocketAddr};

use anyhow::{Context, Result};
use tokio::net::UdpSocket;

/// The fixed value every STUN message carries after its type and length.
const COOKIE: [u8; 4] = [0x21, 0x12, 0xa4, 0x42];
const HEADER: usize = 20;
const BINDING_REQUEST: [u8; 2] = [0x00, 0x01];
const BINDING_SUCCESS: [u8; 2] = [0x01, 0x01];
const XOR_MAPPED_ADDRESS: [u8; 2] = [0x00, 0x20];
/// The longest request it reads: a Binding request is its header and a few attributes, it reads them unopened.
const MOST: usize = 548;

/// The answer to `request`, which came from `from`, if it is a Binding request: a Binding success with the same
/// transaction id and `from` as its XOR-MAPPED-ADDRESS.
pub fn answer(request: &[u8], from: SocketAddr) -> Option<Vec<u8>> {
    if request.len() < HEADER || request.len() > MOST || request[0..2] != BINDING_REQUEST || request[4..8] != COOKIE {
        return None;
    }
    let length = u16::from_be_bytes([request[2], request[3]]) as usize;
    if length != request.len() - HEADER || length % 4 != 0 {
        return None;
    }
    let id = &request[8..HEADER];
    let port = from.port() ^ u16::from_be_bytes([COOKIE[0], COOKIE[1]]);
    let (family, address): (u8, Vec<u8>) = match from.ip().to_canonical() {
        IpAddr::V4(ip) => (1, ip.octets().iter().zip(COOKIE).map(|(a, b)| a ^ b).collect()),
        IpAddr::V6(ip) => {
            let key = COOKIE.iter().chain(id).copied();
            (2, ip.octets().iter().zip(key).map(|(a, b)| a ^ b).collect())
        }
    };
    let mut value = vec![0, family];
    value.extend_from_slice(&port.to_be_bytes());
    value.extend_from_slice(&address);
    let mut out = Vec::with_capacity(HEADER + 4 + value.len());
    out.extend_from_slice(&BINDING_SUCCESS);
    out.extend_from_slice(&((4 + value.len()) as u16).to_be_bytes());
    out.extend_from_slice(&COOKIE);
    out.extend_from_slice(id);
    out.extend_from_slice(&XOR_MAPPED_ADDRESS);
    out.extend_from_slice(&(value.len() as u16).to_be_bytes());
    out.extend_from_slice(&value);
    Some(out)
}

/// The responder on `bind` (`AVENDB_STUN_BIND`), answering until its task ends.
pub async fn spawn(bind: SocketAddr) -> Result<tokio::task::JoinHandle<()>> {
    let socket = UdpSocket::bind(bind).await.with_context(|| format!("STUN on {bind}"))?;
    tracing::info!("avenDB server: STUN on {}", socket.local_addr()?);
    Ok(tokio::spawn(async move {
        let mut buf = [0u8; MOST + 1];
        loop {
            let Ok((n, from)) = socket.recv_from(&mut buf).await else { continue };
            if let Some(out) = answer(&buf[..n], from) {
                let _ = socket.send_to(&out, from).await;
            }
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(id: [u8; 12]) -> Vec<u8> {
        let mut r = vec![0x00, 0x01, 0x00, 0x00];
        r.extend_from_slice(&COOKIE);
        r.extend_from_slice(&id);
        r
    }

    /// The address in a Binding success, as a browser reads it.
    fn mapped(answer: &[u8]) -> SocketAddr {
        assert_eq!(answer[0..2], BINDING_SUCCESS);
        assert_eq!(answer[20..22], XOR_MAPPED_ADDRESS);
        let port = u16::from_be_bytes([answer[26], answer[27]]) ^ 0x2112;
        let key: Vec<u8> = COOKIE.iter().chain(&answer[8..20]).copied().collect();
        let ip: IpAddr = match answer[25] {
            1 => {
                let o: [u8; 4] = std::array::from_fn(|i| answer[28 + i] ^ key[i]);
                o.into()
            }
            _ => {
                let o: [u8; 16] = std::array::from_fn(|i| answer[28 + i] ^ key[i]);
                o.into()
            }
        };
        SocketAddr::new(ip, port)
    }

    #[test]
    fn a_binding_request_gets_the_address_it_came_from() {
        for from in ["203.0.113.7:51820", "[2001:db8::42]:3478", "[::ffff:198.51.100.9]:60000"] {
            let from: SocketAddr = from.parse().unwrap();
            let id = [9; 12];
            let out = answer(&request(id), from).expect("an answer");
            assert_eq!(out[8..20], id, "the same transaction");
            assert_eq!(u16::from_be_bytes([out[2], out[3]]) as usize, out.len() - HEADER);
            let canonical = SocketAddr::new(from.ip().to_canonical(), from.port());
            assert_eq!(mapped(&out), canonical);
        }
    }

    #[test]
    fn anything_else_gets_nothing() {
        let from: SocketAddr = "203.0.113.7:1".parse().unwrap();
        let good = request([1; 12]);
        assert!(answer(&good[..19], from).is_none());
        let mut other = good.clone();
        other[1] = 0x11;
        assert!(answer(&other, from).is_none(), "not a Binding request");
        let mut cookie = good.clone();
        cookie[4] ^= 1;
        assert!(answer(&cookie, from).is_none(), "no magic cookie");
        let mut long = good.clone();
        long[3] = 4;
        assert!(answer(&long, from).is_none(), "a length past its end");
        let mut big = good;
        big.resize(MOST + 4, 0);
        let n = (big.len() - HEADER) as u16;
        big[2..4].copy_from_slice(&n.to_be_bytes());
        assert!(answer(&big, from).is_none(), "too long");
    }
}

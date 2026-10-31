//! The PRF step's wasm side (id/caps/README.md, "Passkeys and the PRF step"; rule 13): the page hands the Peer-Light
//! the PRF output, and only the public halves come back, the same aven-id derives; the output is wiped.

use aven_id::{PrfOutput, Secret, prf_input};
use aven_peer_light::acts;

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

#[test]
fn only_public_halves_come_back() {
    let mut output = [7u8; 32];
    let (owner, seal, key) = acts::prf_public(&mut output).unwrap();
    assert_eq!(output, [0u8; 32], "the PRF output is wiped");
    let prf = PrfOutput::new(Secret::take(&mut [7u8; 32]));
    assert_eq!(owner, hex(&prf.owner_key().public().to_bytes()));
    assert_eq!(seal, hex(&prf.seal_key().public().to_bytes()));
    assert_eq!(key.public(), prf.seal_key().public());
    assert_eq!(acts::prf_input("alice", 1), prf_input("alice", 1));
}

#[test]
fn a_wrong_length_is_refused_and_wiped() {
    let mut short = [9u8; 31];
    assert!(acts::prf_public(&mut short).is_err());
    assert_eq!(short, [0u8; 31]);
}

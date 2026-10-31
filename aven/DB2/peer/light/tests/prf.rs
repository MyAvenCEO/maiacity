//! The PRF step's wasm side (id/caps/README.md, "Passkeys and the PRF step"; rule 13): the page hands the Peer-Light
//! the PRF output, and only the public halves come back, the same aven-id derives; the output is wiped.

use aven_id::{PrfOutput, Secret, hybrid_verify, prf_input};
use aven_peer_light::acts;

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

#[test]
fn only_public_halves_come_back() {
    let mut output = [7u8; 32];
    let derived = acts::prf_derive(&mut output).unwrap();
    assert_eq!(output, [0u8; 32], "the PRF output is wiped");
    let prf = PrfOutput::new(Secret::take(&mut [7u8; 32]));
    assert_eq!(derived.owner, hex(&prf.owner_key().public().to_bytes()));
    assert_eq!(derived.seal, hex(&prf.seal_key().public().to_bytes()));
    assert_eq!(derived.seal_key.public(), prf.seal_key().public());
    // what the owner key signs in the wasm holds under the public half that came back
    let signature = derived.owner_key.sign(b"a statement").to_bytes();
    assert!(hybrid_verify(
        &prf.owner_key().public().to_bytes(),
        b"a statement",
        &signature
    ));
    assert_eq!(acts::prf_input(1), hex(&prf_input(1)));
}

#[test]
fn a_wrong_length_is_refused_and_wiped() {
    let mut short = [9u8; 31];
    assert!(acts::prf_derive(&mut short).is_err());
    assert_eq!(short, [0u8; 31]);
}

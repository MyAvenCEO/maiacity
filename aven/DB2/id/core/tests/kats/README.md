# The primitives' known answers

aven-id holds the primitives it seals and signs with to their standards' known answers and to Wycheproof
(id/caps/README.md, "What Lean proves"; `tests/primitives.rs`). Lean fixes every byte around them (`Aven.ID.KeyFormats`);
these fix the primitives themselves. Copied unchanged:

- `xwing.json`: X-Wing's test vectors from draft-connolly-cfrg-xwing-kem, as the `x-wing` crate 0.1.1 ships them
  (`tests/test-vectors.json`; MIT or Apache-2.0).
- `wycheproof/`: from [C2SP/wycheproof](https://github.com/C2SP/wycheproof) `testvectors_v1`, 31 Oct 2026 (Apache-2.0):
  `ed25519_test.json`, `xchacha20_poly1305_test.json`, `mldsa_65_verify_test.json` and `mldsa_65_sign_seed_test.json`.

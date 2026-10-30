// `bun run guardian` (PRODUCTION.md, "MaiaCityGuardian"): makes a MaiaCityGuardian, one Ed25519 key, and prints its
// secret seed and its public half. It writes nothing: the secret is kept offline by whoever holds it, and only the
// public half is ever configured (`--guardian`, AVEN_PEER_GUARDIAN; the environment `production`'s variable).
import { createPublicKey, generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('ed25519');
// PKCS #8 for Ed25519 ends in the 32-byte seed; SubjectPublicKeyInfo in the 32-byte public half
const secret = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('hex');
const pub = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
console.log(`MaiaCityGuardian
  secret  ${secret}   keep it offline; it owns every person's vault founded with it
  public  ${pub}   configure this: --guardian, AVEN_PEER_GUARDIAN`);

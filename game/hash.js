// @ts-nocheck — plain JS, kept loose on purpose
/**
 * THE ONE HASH — every name we give bytes that never change (a frozen engine, a recipe file, a code entry, a build) is
 * the BLAKE3 hash of those bytes, in lower-case hex, and it is made here alone, so the page, the API, the scripts and
 * the tests can never name the same bytes two ways. A text is hashed as its UTF-8 bytes.
 *
 *   hashText('…')        the hash of a text
 *   hashBytes(bytes)     the hash of bytes (a Uint8Array)
 *   holds(bytes, hash)   whether bytes are the ones a hash names
 */
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/** BLAKE3 of bytes, in hex @param {Uint8Array} bytes @returns {string} */
export const hashBytes = (bytes) => bytesToHex(blake3(bytes));

/** BLAKE3 of a text's UTF-8 bytes, in hex @param {string} text @returns {string} */
export const hashText = (text) => hashBytes(utf8ToBytes(text));

/** whether `bytes` are the bytes `hash` names @param {unknown} bytes @param {string} hash */
export const holds = (bytes, hash) => bytes instanceof Uint8Array && hashBytes(bytes) === hash;

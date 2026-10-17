// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * A BUILD BY ITS NAME — what a build is named by wherever its recipe is kept: the recipe's hash, the BLAKE3 hash of its
 * bytes (./recipe.js, ./engines.js), and the values it is built with, `<hash>?seed=maia&stage=9`. Nothing here reads an
 * index: the Maia City vault's recipes, which every page reads (./vault.js), and the repo's, which only the seed and the
 * tests read (./recipes.js), name their builds the same way, so the same bytes are the same build either way.
 */
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { paramsIn, queryOf } from './params.js';
import { VAULT, parseVaultRef, refusal } from './sources/avendb.js';

/** the BLAKE3 hash of a text, in hex @param {string} text */
export const hashText = (text) => bytesToHex(blake3(utf8ToBytes(text)));

/**
 * A build's name as its parts: the recipe's hash and the values, as text. Throws for anything else; a vault's ref with
 * the one error every loader gives it while avenDB storage is not switched on (./sources/avendb.js).
 * @param {string} ref @returns {{ hash: string, params?: Record<string, string> }}
 */
export function parseBuild(ref) {
	if (typeof ref === 'string' && ref.startsWith(VAULT)) throw refusal(parseVaultRef(ref));
	const m = /^([0-9a-f]{64})(?:\?(.*))?$/.exec(ref);
	if (!m) throw new Error(`not a build: ${String(ref).slice(0, 80)} (a recipe's hash, then ?its=values)`);
	const params = paramsIn(m[2]);
	return { hash: m[1], ...(params && { params }) };
}

/** A build's name: a recipe's hash and the values, sorted. @param {string} hash @param {Record<string, unknown>} [values] */
export const buildOf = (hash, values) => {
	const q = queryOf(values);
	return q ? `${hash}?${q}` : hash;
};

/** A recipe handed in as code, checked against its name: the same `{ hash, code }`, or refused. */
export function checked({ hash, code }) {
	const named = hashText(code);
	if (named !== hash) throw new Error(`refused: the recipe named ${hash.slice(0, 12)}… hashes to ${named.slice(0, 12)}…`);
	return { hash, code };
}

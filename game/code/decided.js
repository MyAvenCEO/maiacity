// @ts-nocheck — plain JS, kept loose on purpose
/**
 * WHAT WAS DECIDED, read from the repo: Sandbox 7's configs, version by version, and each accepted MIP as it landed
 * (code/configs/ and code/mips/, bundled as code/decided.js by scripts/code-index.mjs; ./land.js says how they are
 * written). Only the API reads this; the pages ask the API, so their bundle never carries it.
 */
import { DECIDED } from '../../code/decided.js';
import { cardsOfFiles } from './files.js';

let all = DECIDED;
/** read these entries instead of code/'s (tests); none given: code/'s again */
export const useDecided = (entries) => {
	all = entries ?? DECIDED;
};

const read = (e) => {
	const { ref, files, hash, ...entry } = e;
	return { ...entry, cards: cardsOfFiles(files), hash: hash ?? null };
};

/** every version of a game's config, the newest first: { id, version, name, description, mip, at, deleted?, cards } */
export const configVersions = (game, id) =>
	Object.values(all)
		.filter((e) => e.type === 'config' && e.for === game && e.id === id)
		.map(read)
		.sort((a, b) => b.version - a.version);

/** the ids of a game's configs, in the order they were first made */
export function configIds(game) {
	const first = {};
	for (const e of Object.values(all)) if (e.type === 'config' && e.for === game && e.version === 1) first[e.id] = e.at ?? '';
	return Object.keys(first).sort((a, b) => String(first[a]).localeCompare(String(first[b])) || a.localeCompare(b));
}

/** an accepted MIP as it landed in code/, with its cards; null while it has not */
export function landedMip(game, number) {
	const e = Object.values(all).find((x) => x.type === 'mip' && x.for === game && x.number === Number(number));
	return e ? read(e) : null;
}

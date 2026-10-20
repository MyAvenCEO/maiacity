/*
 * A BIOME AS ITS CARD SAYS IT — a biome is an asset of the `biomes` group like any other (./floors.js): built in the box
 * as a patch of its floor (./patch.js), its card made there and kept in the Maia City vault beside its recipe. Its parts
 * are what a floor is made of, each with its numbers as the card's specs:
 *
 *   the ground   each surface it is painted with (`ground-<surface>`) and its weight
 *   the cover    how many plants stand on a square metre inside their colonies (`density`), and each kind
 *                (`cover-<kind>`): the asset it is (its `ref`, the cover's kind at its seed), its share, how big its
 *                colonies are, how much of the ground they take, how full they are and the surface they grow on
 *
 * A world reads a biome from its card alone (`biomeOfCard`), as the vault hands it out, never from the repo's list: the
 * vault's biome at the version a world names is the floor it lays. Every number is checked on the way in.
 */
import { SURFACE, SURFACES } from './surfaces.js';

/** the specs' names, as the card shows them to people and a world reads them back */
const WEIGHT = 'Weight', DENSITY = 'Plants a square metre', SHARE = 'Share', COLONY = 'Colony across', SPREAD = 'Ground its colonies take', FILL = 'How full its colonies are', ON = 'Grows on';

/** a number as a spec writes it: as it is, so it reads back the same @param {number} n */
const num = (n) => String(Number(n));

/**
 * A biome's parts as a card's catalog: its surfaces and its cover, each with its numbers.
 * @param {import('./index.js').Recipe} recipe
 * @param {{ ref: (kind: string, i: number) => string, label: (kind: string) => string }} kinds the asset each kind of its
 *   cover is, and its name
 */
export function biomeCatalog(recipe, kinds) {
	const ground = SURFACES.filter((s) => (recipe.surface[s] ?? 0) > 0).map((s) => ({
		id: `ground-${s}`,
		label: SURFACE[s].label,
		assembly: 'ground',
		what: 'A surface of the ground, painted in patches that run into the others; its weight is how much of the floor it takes against them.',
		specs: [[WEIGHT, num(/** @type {number} */ (recipe.surface[s]))]]
	}));
	const cover = recipe.cover.map((c, i) => ({
		id: `cover-${c.kind}`,
		label: kinds.label(c.kind),
		assembly: 'cover',
		what: 'A kind of the cover, standing in colonies of its own on the surface it belongs on.',
		ref: kinds.ref(c.kind, i),
		specs: [[SHARE, num(c.share)], [COLONY, `${num(c.colony)} m`], [SPREAD, num(c.spread)], ...(c.fill === undefined ? [] : [[FILL, num(c.fill)]]), ...(c.on ? [[ON, c.on]] : [])]
	}));
	return {
		assemblies: [
			{ id: 'ground', label: 'The ground', note: 'The surfaces it is painted with, each in patches of its own size.' },
			{ id: 'cover', label: 'The cover', note: 'What grows and lies on it, kind by kind, each in its colonies.' }
		],
		parts: [
			...ground,
			{ id: 'density', label: 'How dense the cover stands', assembly: 'cover', what: 'How many plants (or things) of the cover stand on a square metre inside their colonies.', specs: [[DENSITY, num(recipe.density)]] },
			...cover
		]
	};
}

export class BiomeCardError extends Error {}

/**
 * The biome a card is: its surfaces, its density and its cover, each kind with the asset it is (`ref`). Throws
 * (BiomeCardError) on a card that isn't a biome's, or whose numbers aren't what a floor can be.
 * @param {any} card a card as the vault holds it (checked against the card's schema already)
 * @returns {import('./index.js').Recipe & { version: number }}
 */
export function biomeOfCard(card) {
	const where = `${card?.ref ?? 'a card'}`;
	const no = (/** @type {string} */ why) => {
		throw new BiomeCardError(`${where} is no biome: ${why}`);
	};
	if (card?.group !== 'biomes' || card.id === 'cover') no('not a biome of the biomes group');
	const parts = /** @type {any[]} */ (card.catalog?.parts ?? []);
	const spec = (/** @type {any} */ p, /** @type {string} */ name) => (p.specs ?? []).find((/** @type {string[]} */ s) => s[0] === name)?.[1];
	const number = (/** @type {any} */ p, /** @type {string} */ name, /** @type {number} */ lo, /** @type {number} */ hi, optional = false) => {
		const v = spec(p, name);
		if (v === undefined && optional) return undefined;
		const n = Number.parseFloat(String(v));
		if (!Number.isFinite(n) || n < lo || n > hi) no(`${p.id}'s ${name} is ${v === undefined ? 'missing' : JSON.stringify(v)}`);
		return n;
	};
	/** @type {Partial<Record<import('./surfaces.js').Surface, number>>} */
	const surface = {};
	for (const p of parts.filter((p) => p.assembly === 'ground')) {
		const s = String(p.id).replace(/^ground-/, '');
		if (!(/** @type {string[]} */ (SURFACES).includes(s))) no(`a surface ${s} no ground has`);
		surface[/** @type {import('./surfaces.js').Surface} */ (s)] = number(p, WEIGHT, 0, 1000);
	}
	if (!Object.values(surface).some((w) => (w ?? 0) > 0)) no('a ground of no surface');
	const dense = parts.find((p) => p.id === 'density');
	if (!dense) no('no density');
	const density = /** @type {number} */ (number(dense, DENSITY, 0.01, 200));
	const cover = parts
		.filter((p) => p.assembly === 'cover' && p.id !== 'density')
		.map((p) => {
			const kind = String(p.id).replace(/^cover-/, '');
			if (!kind || kind === p.id) no(`a cover part ${p.id}`);
			if (typeof p.ref !== 'string') no(`${p.id} names no asset`);
			const on = spec(p, ON);
			if (on !== undefined && !(/** @type {string[]} */ (SURFACES).includes(on))) no(`${p.id} grows on ${on}, which no ground has`);
			const fill = number(p, FILL, 0, 1, true);
			return {
				kind: /** @type {import('./cover.js').Cover} */ (kind),
				ref: /** @type {string} */ (p.ref),
				share: /** @type {number} */ (number(p, SHARE, 0, 1000)),
				colony: /** @type {number} */ (number(p, COLONY, 0.01, 1000)),
				spread: /** @type {number} */ (number(p, SPREAD, 0, 1)),
				...(on === undefined ? {} : { on: /** @type {import('./surfaces.js').Surface} */ (on) }),
				...(fill === undefined ? {} : { fill })
			};
		});
	if (!cover.length) no('no cover');
	return { id: card.id, version: card.version, label: card.label, note: card.note ?? '', from: '', surface, density, cover };
}

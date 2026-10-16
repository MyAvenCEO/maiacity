// @ts-nocheck — plain JS
/**
 * A profile's shape by its kind, the same wherever a profile shows (avenDB's marks, the nav pill, Maia Universe): a
 * circle for a human, a sun of 12 rays for an aven, a hexagon for a coop, a square for a device. Each is a CSS
 * `clip-path` for a square mark, so the mark's initials and colour stay as they are.
 */

/** the 12 rays of an aven's sun: 24 points round the middle, every other one out at the edge */
const SUN = Array.from({ length: 24 }, (_, i) => {
	const a = ((i * 15 - 90) * Math.PI) / 180;
	const r = i % 2 ? 37 : 50;
	const at = (/** @type {number} */ x) => `${+(50 + r * x).toFixed(1)}%`;
	return `${at(Math.cos(a))} ${at(Math.sin(a))}`;
}).join(', ');

/** @type {Record<string, string>} */
export const SHAPES = {
	human: 'circle(50%)',
	aven: `polygon(${SUN})`,
	coop: 'polygon(25% 4%, 75% 4%, 100% 50%, 75% 96%, 25% 96%, 0 50%)',
	device: 'inset(0 round 12%)'
};

/** The `clip-path` of a profile of kind `kind`; a human's circle for any other. @param {string | undefined} kind */
export const shapeOf = (kind) => SHAPES[kind ?? 'human'] ?? SHAPES.human;

/** The inline style that gives a mark the shape of kind `kind`, whatever corners its own style rounds.
 *  @param {string | undefined} kind */
export const shaped = (kind) => `border-radius: 0; clip-path: ${shapeOf(kind)}`;

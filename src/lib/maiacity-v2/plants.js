// @ts-nocheck — plain JS, kept loose on purpose
/*
 * THE FIRST TREES' PLANTS, AS MAIACITY V1 READS THEM — each seed a newcomer may plant (the game's SEEDLINGS, and the
 * seeds it once had): its name, the versions of it the Plants have, and its stages (the day each begins, from the
 * seed, and its name), the same at every version. ./trees.js walks a tree through them; the tree itself is built in
 * the asset box and drawn by the renderer by its ref (`plantRef`), never grown here. ./plants.test.js holds every
 * number to the Plants ($lib/plants).
 */

/** @type {Record<string, { label: string, versions: number[], stages: [number, string][] }>} */
const PLANTS = {
 birch: {label:'Silver birch · Birke',versions:[1],stages:[[0,'Winged seed'],[14,'Germination'],[35,'Seedling'],[365,'Sapling'],[1095,'Young birch'],[1825,'Catkins'],[1840,'Seed set'],[1880,'Green catkins'],[1920,'Golden leaves'],[1950,'Winged seeds']]},
	apple: { label: 'Apple', versions: [1, 2], stages: [[0, 'Pip'], [20, 'Germination'], [35, 'Seedling'], [365, 'Sapling'], [1460, 'Young tree'], [2200, 'Blossom'], [2215, 'Fruit set'], [2260, 'Green apples'], [2300, 'Colouring'], [2320, 'Ripe']] },
	pear: { label: 'Pear', versions: [1], stages: [[0, 'Pip'], [20, 'Germination'], [35, 'Seedling'], [365, 'Sapling'], [1600, 'Young tree'], [2200, 'Blossom'], [2215, 'Fruit set'], [2270, 'Green pears'], [2320, 'Colouring'], [2340, 'Ripe']] },
	cherry: { label: 'Cherry', versions: [1], stages: [[0, 'Stone'], [20, 'Germination'], [40, 'Seedling'], [365, 'Sapling'], [1460, 'Young tree'], [1830, 'Blossom'], [1840, 'Fruit set'], [1860, 'Green cherries'], [1880, 'Colouring'], [1890, 'Ripe']] },
	plum: { label: 'Plum', versions: [1], stages: [[0, 'Stone'], [25, 'Germination'], [45, 'Seedling'], [365, 'Sapling'], [1300, 'Young tree'], [1700, 'Blossom'], [1715, 'Fruit set'], [1780, 'Green plums'], [1830, 'Colouring'], [1850, 'Ripe']] },
	apricot: { label: 'Apricot', versions: [1], stages: [[0, 'Stone'], [25, 'Germination'], [45, 'Seedling'], [365, 'Sapling'], [1100, 'Young tree'], [1300, 'Blossom'], [1315, 'Fruit set'], [1360, 'Green apricots'], [1400, 'Colouring'], [1410, 'Ripe']] },
	quince: { label: 'Quince', versions: [1], stages: [[0, 'Pip'], [25, 'Germination'], [45, 'Seedling'], [1100, 'Sapling'], [1460, 'Young tree'], [1830, 'Blossom'], [1845, 'Fruit set'], [1920, 'Green quinces'], [1980, 'Colouring'], [2000, 'Ripe']] },
	mulberry: { label: 'Mulberry', versions: [1], stages: [[0, 'Seed'], [14, 'Germination'], [30, 'Seedling'], [365, 'Sapling'], [1100, 'Young tree'], [1460, 'Flowering'], [1470, 'Fruit set'], [1495, 'Green berries'], [1510, 'Colouring'], [1525, 'Ripe']] },
	walnut: { label: 'Walnut', versions: [1], stages: [[0, 'Nut'], [170, 'Germination'], [200, 'Seedling'], [730, 'Sapling'], [2200, 'Young tree'], [3050, 'Flowering'], [3075, 'Nut set'], [3140, 'Green walnuts'], [3210, 'Turning'], [3240, 'Ripe']] },
	chestnut: { label: 'Sweet chestnut', versions: [1], stages: [[0, 'Nut'], [150, 'Germination'], [180, 'Seedling'], [730, 'Sapling'], [2200, 'Young tree'], [3080, 'Flowering'], [3100, 'Burr set'], [3170, 'Green burrs'], [3240, 'Turning'], [3270, 'Ripe']] },
	hazel: { label: 'Hazel', versions: [1], stages: [[0, 'Nut'], [150, 'Germination'], [180, 'Seedling'], [730, 'Sapling'], [1800, 'Young stool'], [2190, 'Flowering'], [2280, 'Nut set'], [2380, 'Green nuts'], [2440, 'Turning'], [2460, 'Ripe']] },
	blackcurrant: { label: 'Blackcurrant', versions: [1], stages: [[0, 'Seed'], [30, 'Germination'], [45, 'Seed leaves'], [365, 'Young bush'], [1100, 'Bush'], [1210, 'Flowering'], [1225, 'Fruit set'], [1260, 'Green berries'], [1285, 'Turning'], [1300, 'Ripe']] }
};

/**
 * A plant at a version (its latest if none is given, or if it has no such version): `{ id, version, label, stages }`,
 * each stage `{ day, name }`; undefined for a plant not planted here.
 * @param {string} id @param {number} [v]
 */
export function plantOf(id, v) {
	const p = Object.hasOwn(PLANTS, id) ? PLANTS[id] : null;
	if (!p) return undefined;
	const version = v != null && p.versions.includes(v) ? v : p.versions[p.versions.length - 1];
	return { id, version, label: p.label, stages: p.stages.map(([day, name]) => ({ day, name })) };
}

/** a plant at a stage (0 … 9, between two on the way) grown from a seed, as the asset box builds it @param {{ id: string, version: number }} p @param {number} stage @param {string} seed */
export const plantRef = (p, stage, seed) => `plants/${p.id}@${p.version}?stage=${stage}&seed=${encodeURIComponent(seed)}`;

/** every plant here, by id */
export const PLANT_IDS = Object.keys(PLANTS);

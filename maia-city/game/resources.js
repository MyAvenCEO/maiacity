/**
 * THE BASE RESOURCES of the world: everything it gives before anything is made from it. What lies in the ground, grows
 * on it, lives on it and flows over it; nothing crafted, smelted or cooked yet (that comes with the recipes). Each is
 * real: its name, where it is found, what it is gathered with and, for a block, what one weighs. A block is 1 m on a
 * side, so its weight is the material's density: `density` in kg/m³, typical values. For an ore, `density` is the
 * mineral's, named in `mineral`. Its look is a recipe for pixels.js (`art`), painted from its id.
 */

/** @typedef {{ id: string, name: string, colour: string, note: string }} Group */
/**
 * @typedef {{
 *   id: string, name: string, group: string, form: 'block' | 'item',
 *   found: string, tool: string | null, note: string,
 *   density?: number, mineral?: string, yields?: string, alpha?: number, art: any
 * }} Resource
 */

/** @type {Group[]} the groups, in the order the library shows them */
export const GROUPS = [
	{ id: 'earth', name: 'Earth', colour: '#8a6340', note: 'Soil, sand, snow and ice: the loose ground on top of the stone.' },
	{ id: 'stone', name: 'Stone', colour: '#7d7d84', note: 'The rocks the land is made of, cut with a pickaxe.' },
	{ id: 'ore', name: 'Ores', colour: '#4f7fa8', note: 'Minerals and metals held in the stone.' },
	{ id: 'wood', name: 'Wood', colour: '#9a6b3a', note: 'Logs from felled trees, and their leaves.' },
	{ id: 'plant', name: 'Plants', colour: '#5f8f3a', note: 'Crops, fruit, mushrooms and wild plants.' },
	{ id: 'animal', name: 'Animals', colour: '#c0704a', note: 'What animals give: wool, eggs, hides, meat and more.' },
	{ id: 'fluid', name: 'Fluids', colour: '#3f76c4', note: 'What flows: water, and molten rock.' }
];

/** what a resource is gathered with; null for what an animal gives */
export const TOOLS = {
	hand: 'By hand',
	shovel: 'With a shovel',
	pickaxe: 'With a pickaxe',
	axe: 'With an axe',
	shears: 'With shears',
	bucket: 'With a bucket'
};

// the palettes the recipes share
const DIRT = ['#5d3f28', '#6b4a30', '#79553a', '#866043', '#966c4a'];
const STONE = ['#6a6a6a', '#737373', '#7d7d7d', '#868686', '#909090'];
const GRASS = ['#518a3b', '#5e9a45', '#6aa84f', '#77b65a'];
const STEM = ['#3f8a28', '#4f9a32'];
const BONE = ['#ddd2bc', '#ece4d2', '#f6f0e2'];

/** an ore: the stone with clusters of the mineral in it @param {string[]} flecks */
const ore = (flecks, clusters = 6) => ({ all: ['speckle', STONE, flecks, clusters] });
/** a log: bark round the sides, rings on the cut ends @param {string[]} bark @param {string[]} rings @param {{colour: string, count: number}} [marks] */
const log = (bark, rings, marks) => ({ top: ['rings', rings, bark], side: ['columns', bark, marks] });
/** one layer of an item: its colours and the shapes they fill (pixels.js SHAPES) @param {string[]} fill @param {...any[]} shapes */
const layer = (fill, ...shapes) => ({ fill, shapes });
/** an item's picture @param {...{fill: string[], shapes: any[][]}} layers */
const sprite = (...layers) => ['sprite', ...layers];

/** @type {Resource[]} */
export const RESOURCES = [
	// Earth
	{ id: 'dirt', name: 'Dirt', group: 'earth', form: 'block', found: 'Under the grass, everywhere on land', tool: 'shovel', density: 1300,
		note: 'Loose topsoil: weathered rock, humus and the life in it. Grass grows back over it in the light.',
		art: { all: ['noise', DIRT] } },
	{ id: 'grass', name: 'Grass', group: 'earth', form: 'block', found: 'Meadows, plains and open land', tool: 'shovel', density: 1300,
		note: 'Topsoil held together by the roots of the grass growing on it.',
		art: { top: ['noise', GRASS], side: ['fringe', DIRT, GRASS] } },
	{ id: 'podzol', name: 'Podzol', group: 'earth', form: 'block', found: 'Under old spruce and pine forests', tool: 'shovel', density: 1100,
		note: 'A forest soil of needles and humus over washed-out sand: dark, acid and springy underfoot.',
		art: { top: ['noise', ['#5a3b20', '#6b4a2a', '#7d5832', '#8a6538']], side: ['fringe', DIRT, ['#5a3b20', '#6b4a2a', '#7d5832']] } },
	{ id: 'mud', name: 'Mud', group: 'earth', form: 'block', found: 'Swamps, riverbanks and mangroves', tool: 'shovel', density: 1700,
		note: 'Soil soaked with water until it gives under the foot.',
		art: { all: ['noise', ['#36312f', '#3c3837', '#45403d', '#4e4844']] } },
	{ id: 'clay', name: 'Clay', group: 'earth', form: 'block', found: 'Riverbeds, lake floors and wet hollows', tool: 'shovel', density: 1800,
		note: 'Mineral grains so fine they hold water and keep a shape; fired, they turn to ceramic.',
		art: { all: ['noise', ['#8d93a1', '#959cab', '#a0a7b4', '#aab1bd'], 0.3] } },
	{ id: 'sand', name: 'Sand', group: 'earth', form: 'block', found: 'Beaches, deserts and riverbeds', tool: 'shovel', density: 1600,
		note: 'Grains of quartz, worn small by water and wind.',
		art: { all: ['noise', ['#c9bf88', '#d1c893', '#dbd3a0', '#e3dbaa']] } },
	{ id: 'red-sand', name: 'Red sand', group: 'earth', form: 'block', found: 'Badlands and red deserts', tool: 'shovel', density: 1600,
		note: 'Sand stained red by iron oxide.',
		art: { all: ['noise', ['#a8571f', '#b45f24', '#c06a2a', '#cc7533']] } },
	{ id: 'gravel', name: 'Gravel', group: 'earth', form: 'block', found: 'Riverbeds, beaches and pockets in the stone', tool: 'shovel', density: 1700,
		note: 'Rounded pebbles. Sifting it turns up flint now and then.',
		art: { all: ['pebbles', ['#5d5958', '#6c6867', '#7f7b7a', '#8e8a89', '#9b9796']] } },
	{ id: 'snow', name: 'Snow', group: 'earth', form: 'block', found: 'Mountain tops and the cold north', tool: 'shovel', density: 400,
		note: 'Packed snow. Fresh powder weighs a quarter of this.',
		art: { all: ['noise', ['#e3eaf1', '#edf2f7', '#f6f9fc', '#ffffff'], 0.3] } },
	{ id: 'ice', name: 'Ice', group: 'earth', form: 'block', found: 'Frozen lakes and rivers', tool: 'pickaxe', density: 917,
		note: 'Frozen fresh water, lighter than the water it floats on.', alpha: 0.9,
		art: { all: ['ice', ['#8db7ee', '#9cc3f5', '#a7cbf7', '#b2d1f8'], '#e4f0ff'] } },
	{ id: 'moss', name: 'Moss', group: 'earth', form: 'block', found: 'Damp forests and the mouths of caves', tool: 'hand',
		note: 'A soft green mat of tiny plants that spreads over stone and soil.',
		art: { all: ['noise', ['#445e21', '#4f6c27', '#5b7a2e', '#668a34'], 0.6] } },

	// Stone
	{ id: 'stone', name: 'Stone', group: 'stone', form: 'block', found: 'Under all the land', tool: 'pickaxe', density: 2700,
		note: 'Plain grey rock, the bulk of the ground beneath the soil.',
		art: { all: ['noise', STONE] } },
	{ id: 'granite', name: 'Granite', group: 'stone', form: 'block', found: 'Large bodies inside the stone', tool: 'pickaxe', density: 2700,
		note: 'Coarse rock of feldspar, quartz and mica that cooled slowly deep underground.',
		art: { all: ['speckle', ['#8e6150', '#9a6b58', '#a5735f'], ['#6f4a3c', '#c4927d', '#d6a690'], 14] } },
	{ id: 'diorite', name: 'Diorite', group: 'stone', form: 'block', found: 'Large bodies inside the stone', tool: 'pickaxe', density: 2850,
		note: 'Black and white speckled rock, cooled slowly from magma.',
		art: { all: ['speckle', ['#b0b0b0', '#bcbcbc', '#c8c8c8'], ['#5e5e5e', '#6e6e6e', '#e6e6e6'], 12] } },
	{ id: 'andesite', name: 'Andesite', group: 'stone', form: 'block', found: 'Large bodies inside the stone', tool: 'pickaxe', density: 2650,
		note: 'Fine-grained grey volcanic rock.',
		art: { all: ['speckle', ['#7c7c7c', '#868686', '#8f8f8f'], ['#6c6c6c', '#9d9d9d', '#a8a8a8'], 14] } },
	{ id: 'slate', name: 'Slate', group: 'stone', form: 'block', found: 'The deep layers, far below the surface', tool: 'pickaxe', density: 2750,
		note: 'Dark rock that splits into thin flat sheets.',
		art: { all: ['bands', ['#3e3e44', '#45454c', '#4d4d55', '#56565e']] } },
	{ id: 'tuff', name: 'Tuff', group: 'stone', form: 'block', found: 'Deep underground, where old ash settled', tool: 'pickaxe', density: 1500,
		note: 'Volcanic ash pressed into a light, porous rock.',
		art: { all: ['speckle', ['#62635a', '#6c6d64', '#75766c'], ['#55564f', '#8b8c80', '#9a8f75'], 10] } },
	{ id: 'calcite', name: 'Calcite', group: 'stone', form: 'block', found: 'Lining the inside of geodes', tool: 'pickaxe', density: 2710,
		note: 'White calcium carbonate, the mineral of limestone and marble.',
		art: { all: ['noise', ['#d4d5d0', '#dfe0dc', '#e8e9e5', '#f0f1ee'], 0.35] } },
	{ id: 'basalt', name: 'Basalt', group: 'stone', form: 'block', found: 'Old lava fields and volcanic coasts', tool: 'pickaxe', density: 2900,
		note: 'Dark lava rock that cracks into columns as it cools.',
		art: { top: ['noise', ['#38383c', '#404044', '#4b4b4f']], side: ['columns', ['#404044', '#4b4b4f', '#555559', '#5e5e62']] } },
	{ id: 'sandstone', name: 'Sandstone', group: 'stone', form: 'block', found: 'Under the sand of deserts and beaches', tool: 'pickaxe', density: 2300,
		note: 'Sand grains cemented into rock over a long time.',
		art: { top: ['noise', ['#cfc387', '#d8cd94', '#e0d6a0']], side: ['bands', ['#c5b97c', '#cfc387', '#d8cd94', '#e0d6a0'], 0.6] } },
	{ id: 'obsidian', name: 'Obsidian', group: 'stone', form: 'block', found: 'Where water meets lava', tool: 'pickaxe', density: 2400,
		note: 'Volcanic glass: lava cooled so fast it had no time to grow crystals.',
		art: { all: ['speckle', ['#100c16', '#14101c', '#1b1526'], ['#2c2040', '#3b2a55', '#4c3a6b'], 7] } },
	{ id: 'dripstone', name: 'Dripstone', group: 'stone', form: 'block', found: 'Caves, hanging from the roof and rising from the floor', tool: 'pickaxe', density: 2600,
		note: 'Limestone laid down drop by drop from water seeping through a cave.',
		art: { all: ['columns', ['#7e624e', '#8a6b55', '#94735c', '#a07e66']] } },

	// Ores
	{ id: 'coal-ore', name: 'Coal ore', group: 'ore', form: 'block', found: 'Common, from the surface down', tool: 'pickaxe',
		mineral: 'coal', density: 1350, yields: 'coal',
		note: 'Ancient plant matter pressed into black rock. It burns hot.',
		art: ore(['#1c1c1c', '#2b2b2b', '#3a3a3a'], 7) },
	{ id: 'iron-ore', name: 'Iron ore', group: 'ore', form: 'block', found: 'Throughout the stone, most in mountains and deep down', tool: 'pickaxe',
		mineral: 'hematite, Fe₂O₃', density: 5260, yields: 'raw iron',
		note: 'Rock rich in iron oxide; smelted, it gives iron.',
		art: ore(['#b08870', '#d8af93', '#e8c6ae'], 6) },
	{ id: 'copper-ore', name: 'Copper ore', group: 'ore', form: 'block', found: 'The upper layers of the stone', tool: 'pickaxe',
		mineral: 'chalcopyrite, CuFeS₂', density: 4200, yields: 'raw copper',
		note: 'Copper minerals that turn green where air and water reach them.',
		art: ore(['#5fae8f', '#c45f36', '#e0784a', '#f09a6a'], 7) },
	{ id: 'gold-ore', name: 'Gold ore', group: 'ore', form: 'block', found: 'Deep underground, and in badlands', tool: 'pickaxe',
		mineral: 'native gold', density: 19300, yields: 'raw gold',
		note: 'Specks of pure gold in the rock: heavy, soft and never rusting.',
		art: ore(['#c8a02a', '#f2c833', '#fff3a8'], 5) },
	{ id: 'lapis-ore', name: 'Lapis lazuli ore', group: 'ore', form: 'block', found: 'The deep layers of the stone', tool: 'pickaxe',
		mineral: 'lapis lazuli', density: 2800, yields: 'lapis lazuli',
		note: 'A deep blue stone, ground for the oldest blue pigment there is.',
		art: ore(['#1f3d96', '#2a4fb5', '#3b66d1'], 6) },
	{ id: 'diamond-ore', name: 'Diamond ore', group: 'ore', form: 'block', found: 'The deepest layers, near the bottom of the world', tool: 'pickaxe',
		mineral: 'diamond, C', density: 3510, yields: 'diamonds',
		note: 'Carbon pressed into the hardest natural material known.',
		art: ore(['#3fc4b8', '#7ff0e6', '#c8fffb'], 4) },
	{ id: 'emerald-ore', name: 'Emerald ore', group: 'ore', form: 'block', found: 'Mountains only, and rare there', tool: 'pickaxe',
		mineral: 'beryl', density: 2760, yields: 'emeralds',
		note: 'Green beryl, coloured by traces of chromium.',
		art: ore(['#1ea84d', '#3ad16a', '#8ff2ae'], 3) },
	{ id: 'quartz-ore', name: 'Quartz ore', group: 'ore', form: 'block', found: 'Veins running through the stone', tool: 'pickaxe',
		mineral: 'quartz, SiO₂', density: 2650, yields: 'quartz',
		note: 'Clear crystals of silica, one of the commonest minerals in the crust.',
		art: ore(['#d9d4c9', '#f2efe8', '#ffffff'], 6) },
	{ id: 'amethyst', name: 'Amethyst', group: 'ore', form: 'block', found: 'Inside geodes, deep underground', tool: 'pickaxe',
		mineral: 'amethyst, purple quartz', density: 2650, yields: 'amethyst shards',
		note: 'Quartz turned purple by traces of iron, grown on the inside of hollow stones.',
		art: { all: ['speckle', ['#6b47a3', '#7a54b8', '#8a63c9', '#9d78db'], ['#5a3a8c', '#c8a8f5', '#e2cffd'], 8] } },

	// Wood
	{ id: 'oak-log', name: 'Oak log', group: 'wood', form: 'block', found: 'Forests and plains', tool: 'axe', density: 720,
		note: 'Hard, strong and long-lasting.',
		art: log(['#4f3b22', '#5c4529', '#6b5232', '#7a5e3a'], ['#a6834f', '#b8945f', '#c9a46c']) },
	{ id: 'birch-log', name: 'Birch log', group: 'wood', form: 'block', found: 'Birch woods', tool: 'axe', density: 640,
		note: 'Pale wood under a white bark that peels in thin sheets.',
		art: log(['#d6d2c4', '#e3e0d4', '#eceadf'], ['#cdb98a', '#d9c79a', '#e4d4aa'], { colour: '#2f2a26', count: 7 }) },
	{ id: 'spruce-log', name: 'Spruce log', group: 'wood', form: 'block', found: 'Cold forests and mountain slopes', tool: 'axe', density: 450,
		note: 'Light, straight-grained softwood from tall conifers.',
		art: log(['#36251a', '#3f2c1b', '#4a3420', '#56402a'], ['#7a5c38', '#8a6a43', '#9a774c']) },
	{ id: 'acacia-log', name: 'Acacia log', group: 'wood', form: 'block', found: 'Savannas', tool: 'axe', density: 800,
		note: 'Dense, orange-hearted wood under grey bark, from trees that stand alone in the dry grass.',
		art: log(['#5a554f', '#625c55', '#6d6760', '#7a736b'], ['#ad5c31', '#c0683a', '#cf7646']) },
	{ id: 'mahogany-log', name: 'Mahogany log', group: 'wood', form: 'block', found: 'Rainforests', tool: 'axe', density: 600,
		note: 'A reddish-brown tropical hardwood that keeps its shape.',
		art: log(['#4e4026', '#5a4a2c', '#685632'], ['#985535', '#a8603e', '#b86c48']) },
	{ id: 'walnut-log', name: 'Walnut log', group: 'wood', form: 'block', found: 'Old broadleaf woods', tool: 'axe', density: 650,
		note: 'Dark, fine-grained hardwood.',
		art: log(['#2b2016', '#33261b', '#3c2d20', '#463527'], ['#5f432c', '#6e4e33', '#7d593b']) },
	{ id: 'mangrove-log', name: 'Mangrove log', group: 'wood', form: 'block', found: 'Swamps and tidal coasts', tool: 'axe', density: 900,
		note: 'Heavy red wood from trees that stand in salt water on their roots.',
		art: log(['#4e3427', '#5a3d2e', '#674637'], ['#6b3229', '#7a3b30', '#8a4638']) },
	{ id: 'cherry-log', name: 'Cherry log', group: 'wood', form: 'block', found: 'Cherry groves on mountain meadows', tool: 'axe', density: 620,
		note: 'Smooth, warm fruitwood with a pink heart.',
		art: log(['#331c22', '#3b2128', '#452730'], ['#d49f9b', '#e3b1ad', '#eec2be']) },
	{ id: 'leaves', name: 'Leaves', group: 'wood', form: 'block', found: 'The crown of every tree', tool: 'shears',
		note: 'Cut whole with shears. Otherwise they fall apart, sometimes dropping a sapling.',
		art: { all: ['leaves', ['#2f5320', '#3f6d2a', '#4a7d32', '#56903a']] } },

	// Plants
	{ id: 'wheat', name: 'Wheat', group: 'plant', form: 'item', found: 'Grown on tilled soil', tool: 'hand',
		note: 'Ripe stalks of grain.',
		art: sprite(
			layer(['#b8913a', '#c9a24a'], ['line', 8, 14, 4, 4, 1], ['line', 8, 14, 8, 3, 1], ['line', 8, 14, 12, 4, 1]),
			layer(['#c49a32', '#d9b44a', '#e8c65a'], ['ellipse', 4, 4, 1.3, 2.5], ['ellipse', 8, 3, 1.3, 2.6], ['ellipse', 12, 4, 1.3, 2.5]),
			layer(['#7a5a26'], ['line', 6.5, 10.5, 9.5, 10.5, 1.3])
		) },
	{ id: 'wheat-seeds', name: 'Wheat seeds', group: 'plant', form: 'item', found: 'Shaken out of tall grass', tool: 'hand',
		note: 'The seed of wheat, to sow on tilled soil.',
		art: sprite(layer(['#5a7a28', '#6f8f32', '#86a63e'],
			['ellipse', 5, 6, 1.3, 1.8], ['ellipse', 9.5, 4.5, 1.3, 1.8], ['ellipse', 11.5, 9, 1.3, 1.8], ['ellipse', 6, 10.5, 1.3, 1.8], ['ellipse', 9.5, 12.5, 1.3, 1.8])) },
	{ id: 'carrot', name: 'Carrot', group: 'plant', form: 'item', found: 'Village gardens', tool: 'hand',
		note: 'A sweet orange root.',
		art: sprite(
			layer(STEM, ['line', 10.5, 5.5, 13, 2, 1.3], ['line', 10.5, 5.5, 11, 1.5, 1.3], ['line', 10.5, 5.5, 14, 4.5, 1.3]),
			layer(['#d06614', '#e8781a', '#f28a22'], ['poly', 2.5, 13.5, 4, 10, 9, 5, 11, 4.5, 11.5, 7, 6.5, 12]),
			layer(['#b8560e'], ['line', 5.5, 9.5, 7, 11, 0.9], ['line', 8, 7, 9.5, 8.5, 0.9])
		) },
	{ id: 'potato', name: 'Potato', group: 'plant', form: 'item', found: 'Village gardens', tool: 'hand',
		note: 'A starchy tuber that keeps through the winter.',
		art: sprite(
			layer(['#b08a4e', '#c09a5c', '#cfa96a'], ['ellipse', 8, 8.5, 5.6, 4.4]),
			layer(['#7a5a32'], ['ellipse', 6, 7, 0.6], ['ellipse', 10, 9, 0.6], ['ellipse', 7.5, 11, 0.6])
		) },
	{ id: 'beetroot', name: 'Beetroot', group: 'plant', form: 'item', found: 'Village gardens', tool: 'hand',
		note: 'A deep red root, sweet and earthy.',
		art: sprite(
			layer(['#3f7a2a', '#4f8a34'], ['line', 8, 7, 5.5, 1.5, 1.6], ['line', 8, 7, 11, 2, 1.6]),
			layer(['#741530', '#8a1c38', '#a0244a'], ['ellipse', 8, 10, 4, 3.6], ['line', 8, 12.5, 9, 14.5, 1])
		) },
	{ id: 'pumpkin', name: 'Pumpkin', group: 'plant', form: 'block', found: 'Patches on grassy plains', tool: 'axe',
		note: 'A big ribbed squash with a hard rind.',
		art: { top: ['crown', ['#c8700f', '#e38a1d', '#f09a2c'], '#5f5226'], side: ['ribs', ['#d07a14', '#e38a1d', '#f09a2c'], '#a85a0a'] } },
	{ id: 'melon', name: 'Melon', group: 'plant', form: 'block', found: 'Jungles', tool: 'axe',
		note: 'A heavy round fruit, nine tenths water.',
		art: { top: ['crown', ['#5a8a22', '#6d9e2a', '#8fbb46'], '#6b5a2a'], side: ['ribs', ['#6d9e2a', '#7cae36', '#8fbb46'], '#3f6b1a', { period: 4 }] } },
	{ id: 'sugar-cane', name: 'Sugar cane', group: 'plant', form: 'item', found: 'Beside water', tool: 'hand',
		note: 'A tall jointed grass full of sweet juice.',
		art: sprite(
			layer(['#7ab84a', '#8cc95a', '#9fd86c'], ['line', 4.5, 1.5, 4.5, 14.5, 1.7], ['line', 8, 1.5, 8, 14.5, 1.7], ['line', 11.5, 1.5, 11.5, 14.5, 1.7]),
			layer(['#5f9a3a'], ['line', 3.5, 5.5, 5.5, 5.5, 1], ['line', 7, 9.5, 9, 9.5, 1], ['line', 10.5, 4.5, 12.5, 4.5, 1], ['line', 3.5, 11, 5.5, 11, 1], ['line', 10.5, 10.5, 12.5, 10.5, 1])
		) },
	{ id: 'bamboo', name: 'Bamboo', group: 'plant', form: 'item', found: 'Jungles', tool: 'hand',
		note: 'A grass that grows like a tree, among the fastest-growing plants on earth.',
		art: sprite(
			layer(['#5f9a32', '#6fae3a'], ['line', 9.5, 4, 13.5, 2, 1.4]),
			layer(['#6a9630', '#7aa83a', '#8cbc46'], ['rect', 6, 1, 9, 14.5]),
			layer(['#556f24'], ['line', 6, 5.5, 9.5, 5.5, 1], ['line', 6, 10.5, 9.5, 10.5, 1])
		) },
	{ id: 'cactus', name: 'Cactus', group: 'plant', form: 'block', found: 'Deserts', tool: 'hand',
		note: 'A desert plant that stores water and wears spines.',
		art: { top: ['crown', ['#437a26', '#4f8a2d', '#5e9c38'], '#8fbf5a'], side: ['ribs', ['#437a26', '#4f8a2d', '#5e9c38'], '#2f5a1a', { spines: { colour: '#e9e3b3', count: 10 }, period: 4 }] } },
	{ id: 'cocoa-beans', name: 'Cocoa beans', group: 'plant', form: 'item', found: 'Pods on jungle trees', tool: 'hand',
		note: 'The seeds of the cacao pod.',
		art: sprite(layer(['#5a301a', '#6a3a1c', '#7e4a26'], ['ellipse', 5.5, 6, 2, 2.8], ['ellipse', 10.5, 7, 2, 2.8], ['ellipse', 8, 11.5, 2.5, 2.2])) },
	{ id: 'sweet-berries', name: 'Sweet berries', group: 'plant', form: 'item', found: 'Bushes in cold forests', tool: 'hand',
		note: 'Small red berries on a prickly bush.',
		art: sprite(
			layer(['#5a4a2a', '#6a5a32'], ['line', 2.5, 4, 12, 4.5, 1]),
			layer(STEM, ['line', 12, 4.5, 14, 2.5, 1.3]),
			layer(['#9a1824', '#b81e2c', '#d02e3a'], ['ellipse', 5, 8, 2.2], ['ellipse', 9.5, 7.5, 2.2], ['ellipse', 7, 12, 2.2], ['ellipse', 11.5, 11.5, 2.2])
		) },
	{ id: 'apple', name: 'Apple', group: 'plant', form: 'item', found: 'Apple trees, in orchards and woods', tool: 'hand',
		note: 'The crisp fruit of the apple tree.',
		art: sprite(
			layer(['#b01a1a', '#c81f1f', '#dd3030'], ['ellipse', 8, 9.5, 5.2, 4.8]),
			layer(['#6a4a26'], ['line', 8, 5, 9, 2, 1]),
			layer(['#4f9a32', '#5fae3e'], ['ellipse', 11.5, 3, 1.9, 1.1])
		) },
	{ id: 'brown-mushroom', name: 'Brown mushroom', group: 'plant', form: 'item', found: 'Shady forests, swamps and caves', tool: 'hand',
		note: 'A flat brown cap that grows where the light is low.',
		art: sprite(
			layer(['#d4c6a8', '#e3d6bc'], ['rect', 6.5, 8, 9.5, 14]),
			layer(['#83583e', '#93664a', '#a87656'], ['ellipse', 8, 7.5, 6, 2.8])
		) },
	{ id: 'red-mushroom', name: 'Red mushroom', group: 'plant', form: 'item', found: 'Shady forests, swamps and caves', tool: 'hand',
		note: 'A red cap with white spots: pretty, and poisonous.',
		art: sprite(
			layer(['#d4c6a8', '#e3d6bc'], ['rect', 6.5, 8, 9.5, 14]),
			layer(['#ab1818', '#c41e1e', '#d82c2c'], ['poly', 2.5, 9, 3, 6, 5, 3.5, 8, 2.5, 11, 3.5, 13, 6, 13.5, 9]),
			layer(['#f4efe6'], ['ellipse', 6, 5, 0.8], ['ellipse', 10, 4.5, 0.8], ['ellipse', 8, 7, 0.9], ['ellipse', 11.5, 7, 0.7], ['ellipse', 4.5, 7.5, 0.7])
		) },
	{ id: 'kelp', name: 'Kelp', group: 'plant', form: 'item', found: 'Underwater forests in cool seas', tool: 'hand',
		note: 'A brown seaweed that grows in tall forests under the sea.',
		art: sprite(
			layer(['#3f5c22', '#4e6e2a', '#5f8232'], ['line', 7, 14.5, 9, 11, 1.8], ['line', 9, 11, 7, 7.5, 1.8], ['line', 7, 7.5, 9, 4, 1.8], ['line', 9, 4, 8, 1.5, 1.8],
				['line', 10.5, 14.5, 12, 10, 1.4], ['line', 12, 10, 11, 6.5, 1.4])
		) },
	{ id: 'dandelion', name: 'Dandelion', group: 'plant', form: 'item', found: 'Meadows and plains', tool: 'hand',
		note: 'A yellow wildflower; every part of it can be eaten.',
		art: sprite(
			layer(STEM, ['line', 8, 14.5, 8, 7, 1], ['line', 8, 13, 5, 11, 1.3]),
			layer(['#e0aa10', '#f2c418', '#f8d838'], ['ellipse', 8, 5, 3.2])
		) },
	{ id: 'poppy', name: 'Poppy', group: 'plant', form: 'item', found: 'Meadows, fields and roadsides', tool: 'hand',
		note: 'A red wildflower of fields and roadsides.',
		art: sprite(
			layer(STEM, ['line', 8, 14.5, 8, 7, 1], ['line', 8, 12.5, 11, 10.5, 1.3]),
			layer(['#b81a10', '#d42418', '#e63428'], ['ellipse', 8, 5, 3.5, 3]),
			layer(['#1f1a1a'], ['ellipse', 8, 5, 0.9])
		) },

	// Animals
	{ id: 'wool', name: 'Wool', group: 'animal', form: 'block', found: 'Sheep', tool: 'shears',
		note: 'Shorn from a sheep, which grows it back.',
		art: { all: ['noise', ['#d8d8d8', '#e2e2e2', '#ececec', '#f6f6f6'], 0.6] } },
	{ id: 'cowhide', name: 'Cowhide', group: 'animal', form: 'item', found: 'Cows', tool: null,
		note: 'The skin of a cow, hair and all; tanned, it becomes leather.',
		art: sprite(
			layer(['#6a3e22', '#7a4a2a', '#8e5a34'], ['poly', 3, 4, 6, 3, 8, 4, 10, 3, 13, 4, 12, 8, 13, 12, 10, 13, 8, 12, 6, 13, 3, 12, 4, 8]),
			layer(['#ddd4c6', '#e8e0d4'], ['ellipse', 9, 8, 2.3, 1.8], ['ellipse', 5.5, 5.5, 1.2, 1])
		) },
	{ id: 'feather', name: 'Feather', group: 'animal', form: 'item', found: 'Chickens', tool: 'hand',
		note: 'Light and strong; birds shed them as they go.',
		art: sprite(
			layer(['#d8d2c4', '#e6e1d6', '#f4f1ea'], ['poly', 4, 13, 6, 8, 10, 3, 13, 2, 12, 6, 8, 11]),
			layer(['#bcb4a4'], ['line', 3, 14, 12, 3, 1])
		) },
	{ id: 'egg', name: 'Egg', group: 'animal', form: 'item', found: 'Laid by chickens', tool: 'hand',
		note: 'A good hen lays nearly one a day.',
		art: sprite(layer(['#e2d0ae', '#efe1c4', '#f6ecd8'], ['ellipse', 8, 8.8, 4.4, 5.6])) },
	{ id: 'raw-beef', name: 'Raw beef', group: 'animal', form: 'item', found: 'Cows', tool: null,
		note: 'Red meat, to be cooked before it is eaten.',
		art: sprite(
			layer(['#a42830', '#b8303a', '#c94048'], ['poly', 3, 6, 6, 3, 11, 3, 14, 6, 13, 11, 9, 13, 4, 12, 2, 9]),
			layer(['#f2d0c8'], ['line', 5, 6, 11, 10, 1], ['line', 6, 10.5, 9, 11.5, 0.9])
		) },
	{ id: 'raw-pork', name: 'Raw pork', group: 'animal', form: 'item', found: 'Pigs', tool: null,
		note: 'Pale meat with a rind of fat.',
		art: sprite(
			layer(['#e68e8c', '#f0a3a0', '#f8b6b2'], ['poly', 3, 5, 7, 3, 12, 4, 14, 8, 12, 12, 7, 13, 3, 11]),
			layer(['#fbe6dc'], ['line', 3.5, 5, 7, 3.2, 1.3], ['line', 7, 3.2, 12, 4.2, 1.3])
		) },
	{ id: 'raw-chicken', name: 'Raw chicken', group: 'animal', form: 'item', found: 'Chickens', tool: null,
		note: 'Never to be eaten raw.',
		art: sprite(
			layer(BONE, ['line', 7, 9, 3.5, 12.5, 1.6], ['ellipse', 3, 13, 1.3], ['ellipse', 2.6, 11.6, 1]),
			layer(['#e4b49c', '#f0c4ae', '#f8d4c0'], ['ellipse', 9.5, 6.5, 4.2, 4])
		) },
	{ id: 'raw-mutton', name: 'Raw mutton', group: 'animal', form: 'item', found: 'Sheep', tool: null,
		note: 'The meat of a grown sheep.',
		art: sprite(
			layer(BONE, ['line', 6, 10, 3, 13, 1.6], ['ellipse', 2.8, 13, 1.2]),
			layer(['#bc443e', '#d0504a', '#e0605a'], ['ellipse', 9, 7, 4.8, 4]),
			layer(['#f4e2d4'], ['line', 5, 5, 9, 3, 1.1])
		) },
	{ id: 'raw-rabbit', name: 'Raw rabbit', group: 'animal', form: 'item', found: 'Rabbits', tool: null,
		note: 'Lean meat from a small animal.',
		art: sprite(layer(['#dca494', '#e8b4a4', '#f2c4b4'],
			['ellipse', 8, 8, 5, 3.4], ['line', 4, 9.5, 2.5, 12.5, 1.3], ['line', 12, 9.5, 13.5, 12.5, 1.3], ['line', 4.5, 6.5, 2.5, 4, 1.3], ['line', 11.5, 6.5, 13.5, 4, 1.3])) },
	{ id: 'rabbit-hide', name: 'Rabbit hide', group: 'animal', form: 'item', found: 'Rabbits', tool: null,
		note: 'A small soft pelt.',
		art: sprite(layer(['#977a58', '#a88a68', '#b89a78'], ['poly', 4, 4, 8, 3, 12, 4, 12.5, 9, 11, 13, 8, 12, 5, 13, 3.5, 9])) },
	{ id: 'cod', name: 'Cod', group: 'animal', form: 'item', found: 'Cold oceans', tool: null,
		note: 'A big white-fleshed fish of the cold seas.',
		art: sprite(
			layer(['#a88e60', '#b89e70'], ['poly', 10.5, 8, 14.5, 4.5, 14.5, 11.5]),
			layer(['#b29660', '#c4a874', '#d2b884'], ['ellipse', 7, 8, 5.8, 3.2]),
			layer(['#ebe0c8'], ['line', 3, 9.8, 10, 9.8, 1]),
			layer(['#1a1a1a'], ['ellipse', 3.6, 7.2, 0.6])
		) },
	{ id: 'salmon', name: 'Salmon', group: 'animal', form: 'item', found: 'Rivers and cold oceans', tool: null,
		note: 'Born in rivers, grown at sea, back up the river to spawn.',
		art: sprite(
			layer(['#a84a34', '#b85a40'], ['poly', 10.5, 8, 14.5, 4.5, 14.5, 11.5]),
			layer(['#b84c34', '#c85a40', '#d86a4c'], ['ellipse', 7, 8, 5.8, 3.2]),
			layer(['#e8d8d0'], ['line', 3, 9.8, 10, 9.8, 1]),
			layer(['#1a1a1a'], ['ellipse', 3.6, 7.2, 0.6])
		) },
	{ id: 'bone', name: 'Bone', group: 'animal', form: 'item', found: 'Where animals have died', tool: 'hand',
		note: 'Ground fine, it feeds plants.',
		art: sprite(layer(BONE, ['line', 4.5, 11.5, 11.5, 4.5, 2], ['ellipse', 3, 11.5, 1.4], ['ellipse', 4.5, 13, 1.4], ['ellipse', 11.5, 3, 1.4], ['ellipse', 13, 4.5, 1.4])) },
	{ id: 'spider-silk', name: 'Spider silk', group: 'animal', form: 'item', found: 'Cobwebs and spiders', tool: 'hand',
		note: 'Thread spun by spiders, by weight as strong as steel.',
		art: sprite(layer(['#d4d4d0', '#e4e4e0', '#f4f4f2'], ['ring', 8, 7, 4.5, 1.1], ['line', 10, 11, 13, 14, 1])) },
	{ id: 'ink-sac', name: 'Ink sac', group: 'animal', form: 'item', found: 'Squid', tool: null,
		note: 'The squid’s dark ink, an old source of dye.',
		art: sprite(
			layer(['#201e2a', '#2a2836', '#363444'], ['ellipse', 8, 8, 4.6, 5], ['line', 6, 12, 5, 14.5, 1.2], ['line', 10, 12, 11, 14.5, 1.2]),
			layer(['#5a5870'], ['ellipse', 6.5, 6, 1])
		) },
	{ id: 'honeycomb', name: 'Honeycomb', group: 'animal', form: 'item', found: 'Wild bee nests', tool: 'shears',
		note: 'The wax cells bees build and fill with honey.',
		art: sprite(
			layer(['#d89418', '#e8a428', '#f2b638'], ['ellipse', 8, 8, 6, 5.6]),
			layer(['#a8640c', '#b87410'], ['ellipse', 5, 6, 0.9], ['ellipse', 8, 5, 0.9], ['ellipse', 11, 6, 0.9], ['ellipse', 6.5, 9, 0.9], ['ellipse', 9.5, 9, 0.9], ['ellipse', 8, 12, 0.9], ['ellipse', 5, 11.5, 0.8], ['ellipse', 11, 11.5, 0.8])
		) },

	// Fluids
	{ id: 'water', name: 'Water', group: 'fluid', form: 'block', found: 'Seas, lakes, rivers and springs', tool: 'bucket', density: 1000,
		note: 'Fresh or salt; nothing grows without it.', alpha: 0.85,
		art: { all: ['waves', ['#3462c4', '#3a6cd6', '#3f76e4', '#4a83ef'], '#6a9cf2'] } },
	{ id: 'lava', name: 'Lava', group: 'fluid', form: 'block', found: 'Deep underground and in volcanoes', tool: 'bucket', density: 2700,
		note: 'Molten rock at around 1,100 °C.',
		art: { all: ['waves', ['#cf4708', '#e4580e', '#f07818', '#f8a020'], '#ffd23a'] } }
];

/** a resource by its id @param {string} id */
export const resourceOf = (id) => RESOURCES.find((r) => r.id === id) ?? null;

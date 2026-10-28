// @ts-nocheck — plain JS
// Worlds without back doors (plan C8): a world draws our assets as builds of their recipes, made in the asset box and
// drawn by the universal renderer (./render: createAssets, crowd.js, impostors.js). It never imports the code our
// recipes are made of (a builder module), and never objectAt (./index.js), which runs a builder in the page: either
// is a back door round the box. The few worlds that still go through one are listed below, each import with why and
// whose it is to move; an exception that went comes off the list. (The games are named as they are listed:
// /app/games/sandbox-3 is Sandbox 3, its village of domes; /app/games/sandbox-4 is Sandbox 4, the same grown from our
// plants.)
// Run: bun test maia/content/assets/worlds.test.js
import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { unaliased } from '../../../aven/ops/paths.js';

const ROOT = join(import.meta.dir, '../../..');

/**
 * Builder modules: the asset libraries' own folders; their builders and the kit's outside them, as the index loads
 * them; the index itself (objectAt and assetAt run a builder in the page); and the recipe code of Sandbox 3's domes,
 * which the dome rooms' Things, the mini domes and the playgrounds are built from (their code is in those recipes'
 * libraries, maia/content/models/domerooms.js and index.ts). A path ending in / is a folder.
 */
const BUILDERS = [
	'maia/content/models/',
	'maia/content/machines/',
	'maia/content/actors/',
	'maia/content/plants/',
	'maia/content/biomes/',
	'maia/content/buildings/built.js',
	'maia/content/buildings/tent.js',
	'maia/content/buildings/factory.js',
	'maia/content/buildings/glamp.js',
	'maia/content/assets/kit.js',
	'maia/content/assets/parts.js',
	'maia/content/assets/index.js',
	'maia/content/sandbox-2/interior/interior.ts',
	'maia/content/sandbox-2/interior/spaces.ts',
	'maia/content/sandbox-2/interior/rooms.ts',
	'maia/content/sandbox-2/interior/plants.ts',
	'maia/content/sandbox-2/interior/textures.ts',
	'maia/content/sandbox-2/interior/factory.ts'
];

/** World modules: every world's own code and its pages (a page under /app/games, /games for the film, …) */
const WORLDS = [
	'maia/content/aven-city/',
	'maia/content/sandbox-2/',
	'maia/content/sandbox-5/',
	'maia/content/sandbox-6/',
	'maia/content/maiacity-v1/',
	'maia/content/worlds/',
	'maia/content/factories/',
	'maia/content/buildings/inside.js',
	'maia/content/film/sets.js',
	'maia/site/routes/app/games/',
	'maia/site/routes/games/',
	'maia/site/routes/app/worlds/',
	'maia/site/routes/app/maiacity-v1/',
	'maia/site/routes/app/coops/',
	'maia/site/routes/app/factories/',
	'maia/site/routes/app/buildings/'
];

const ASSET = 'the asset thread';
/** Samuel's calls on Sandbox 3's domes, 2026-10-17 */
const STAND_INS = 'Samuel 2026-10-17: keep the stand-ins';
const LOOKS = 'Samuel 2026-10-17: keep the domes looking as they do';

/** why each of Sandbox 3's domes' parts is still built in the page */
const WHY = {
	shell: "its shell, floors, paths and water in surfaces painted in the page: no Thing of the library is a dome's shell",
	plants: `its stand-in plants (trees, beds, pots, pergolas), built in the page: ${STAND_INS} (Sandbox 4 trades them for our plants, ../sandbox-2/interior/legacy.js)`,
	squares: `its café squares, each built at its own seed where the library's four square Things have one each: ${LOOKS} (a v2 of each with a seed would move their v1 recipes' hashes; Sandbox 4 trades their shrubs, stand-ins, for our plants)`,
	coops: "its timber coops and hutches in the dome's colours, which the library's v1 coops are not (Sandbox 4's are the library's mini domes, ../sandbox-2/interior/things.js)",
	rooms: `its gallery rooms and terraces, furnished per floor at that floor's radii and seed, where the library's private rooms and terrace sets are one each: ${LOOKS}`,
	ground: "the biomes' ground shader (groundMaterial): the surfaces a biome's card in the vault names painted in the page, as a ground is not a build of the box"
};

/**
 * The worlds that still import a builder module: each import (as written) with why, and whose it is to move. Nothing
 * else a world imports may be one. Sandbox 3's master dome draws its workshops from the box (./things.js), and the
 * village its playgrounds and Sandbox 4's coops; the rest of a dome is below.
 * @type {Record<string, { imports: Record<string, string>, owner: string }>}
 */
const ALLOWED = {
	// Sandbox 3's domes (also Sandbox 4's, the Buildings' domes and the film's): raised in
	// the page, by code that is itself recipe code (the dome rooms' Things are built from its furniture)
	'maia/content/sandbox-2/interior/interior.ts': {
		imports: {
			'./textures': WHY.shell,
			'./spaces': `${WHY.squares}; ${WHY.coops}`,
			'./rooms': WHY.rooms,
			'./plants': WHY.plants,
			'$content/biomes': WHY.ground,
			'./factory': "the solar factory dome's five floors of lines, raised in the page at its v1 (Sandbox 3, the Buildings' v1); from its v2 the box builds them (../buildings/factory.js)"
		},
		owner: ASSET
	},
	'maia/content/sandbox-2/interior/village.ts': {
		imports: { './interior': "Sandbox 3 and 4's village: its domes raised in the page, as ./interior.ts is", './spaces': `${WHY.squares}; ${WHY.coops}`, './textures': WHY.shell, './plants': WHY.plants, '$content/biomes': WHY.ground },
		owner: ASSET
	},
	'maia/content/buildings/inside.js': { imports: { '$content/sandbox-2/interior/interior': "the Buildings' domes: Sandbox 3's, raised in the page" }, owner: ASSET },
	'maia/site/routes/games/[world=world]/mounts.js': { imports: { '$content/sandbox-2/interior/interior': "Sandbox 3's domes on film: each raised in the page" }, owner: ASSET },
	'maia/content/sandbox-2/interior/spaces.ts': {
		imports: {
			'$content/models/timber.v1.js': `${WHY.coops}; the unchanged historical builders moved from this module into asset ownership (A12)`,
			'./plants': `the squares' shrubs: ${WHY.plants}`,
			'$content/models/minidomes.js': 'the mini domes for its `mini` coops, which only a test asks for (Sandbox 4 draws them from the box)'
		},
		owner: ASSET
	},
	'maia/content/sandbox-2/interior/rooms.ts': { imports: { './plants': `the rooms' house plants and the terraces' potted plants: ${WHY.plants}` }, owner: ASSET },
	'maia/content/sandbox-2/interior/plants.ts': { imports: { './textures': `the stand-in plants' bark and leaves: ${STAND_INS}` }, owner: ASSET },
	'maia/content/sandbox-2/interior/water.ts': { imports: { './plants': "the domes' streams and ponds: only the stand-in plants' seeded random numbers (seeded)" }, owner: ASSET },
	'maia/content/sandbox-2/interior/animals.ts': { imports: { './plants': "the domes' animals: only the stand-in plants' seeded random numbers (seeded)" }, owner: ASSET },
	'maia/content/sandbox-2/interior/birds.js': { imports: { './plants': "the domes' birds: only the stand-in plants' seeded random numbers (seeded)" }, owner: ASSET },
	'maia/content/sandbox-2/interior/things.js': { imports: { './spaces': "where the coops stand round the squares (coopsAround), which the dome's own coops share" }, owner: ASSET },
	'maia/content/sandbox-2/interior/cover.js': {
		imports: {
			'$content/biomes/built.js': "the floor's cover is drawn from the box: from the biomes it takes each kind's build (coverRef), not a builder",
			'$content/biomes/index.js': "the floor's cover: each kind's seed (coverSeed)",
			'$content/biomes/stream.js': "the floor's cover: how a tile is laid (coverTile)"
		},
		owner: ASSET
	},
	// MaiaCity V1 (phase 8e) and Sandbox 4's page: words and numbers kept beside the builders
	'maia/content/maiacity-v1/Game.svelte': {
		imports: { '$content/models/village.js': "the info cards' texts (VILLAGE_INFO), which the Things' notes share; nothing is built", '$content/models/wayside.js': "the info cards' texts (WAYSIDE_INFO), which the Things' notes share; nothing is built" },
		owner: ASSET
	},
	'maia/site/routes/app/coops/+page.svelte': { imports: { '$content/models/village.js': "MaiaCity V1's coops: their texts (VILLAGE_INFO), which the Things' notes share; nothing is built" }, owner: ASSET },
	'maia/content/maiacity-v1/world.js': { imports: { '$content/models/units.js': 'how fast the people and machines move (SPEED), which the Things share; nothing is built' }, owner: ASSET },
	'maia/site/routes/app/games/sandbox-4/+page.svelte': { imports: { '$content/plants': "the plant card's words (its name, Latin name, layer, stages), read from the plants' list; nothing is built" }, owner: ASSET }
};

const under = (list, f) => list.some((d) => (d.endsWith('/') ? f.startsWith(d) : f === d));
const FILES = /\.(js|mjs|ts|svelte)$/;

function* files(dir) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
		const p = join(dir, e.name);
		if (e.isDirectory()) yield* files(p);
		else if (FILES.test(e.name) && !/\.test\.[jt]s$/.test(e.name)) yield p;
	}
}

/** a module's code without its comments (a JSDoc import('…') names a type, and imports nothing); a component's
 *  markup too, where a page may import in an attribute (`mount={async () => (await import('…')).mount(…)}`) */
function code(file) {
	let s = readFileSync(file, 'utf8');
	if (file.endsWith('.svelte')) s = s.replace(/<!--[\s\S]*?-->/g, '');
	return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** what a module imports, as written: static imports and re-exports (not `import type`) and dynamic imports */
function specifiers(file, types = false) {
	const s = code(file);
	const out = new Set();
	for (const m of s.matchAll(/\b(import|export)\s+(type\s+)?(?:[\w*$\s{},]*?\s+from\s+)?['"]([^'"]+)['"]/g)) if (types || !m[2]) out.add(m[3]);
	for (const m of s.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.add(m[1]);
	return [...out];
}

const EXT = ['', '.js', '.ts', '.svelte', '/index.js', '/index.ts'];
/** a specifier of ours as the file it names, relative to the repo: null for a package; undefined when it names none */
function resolve(from, spec, ext = EXT) {
	let base;
	spec = spec.split('?')[0];
	if (unaliased(spec)) base = join(ROOT, unaliased(spec));
	else if (spec.startsWith('.')) base = join(dirname(from), spec);
	else return null;
	for (const e of ext) if (existsSync(base + e) && statSync(base + e).isFile()) return relative(ROOT, base + e);
	return undefined;
}

/** every world module's imports of a builder module: file -> [specifier, as written] */
function backDoors() {
	const found = {};
	for (const top of ['maia/site/lib', 'maia/site/routes', 'maia/content', 'aven/kernel', 'aven/db/page'])
		for (const file of files(join(ROOT, top))) {
			const path = relative(ROOT, file);
			if (!under(WORLDS, path)) continue;
			for (const spec of specifiers(file)) {
				const to = resolve(file, spec);
				if (to && to !== path && under(BUILDERS, to)) (found[path] ??= []).push(spec);
			}
		}
	return found;
}

test('no world imports a builder module, but those listed with why and whose it is', () => {
	const extra = [];
	for (const [path, specs] of Object.entries(backDoors())) for (const s of specs) if (!ALLOWED[path]?.imports[s]) extra.push(`${path}: ${s}`);
	expect(extra).toEqual([]);
});

test('every listed exception is still there (one that went comes off the list)', () => {
	const found = backDoors();
	for (const [path, { imports, owner }] of Object.entries(ALLOWED)) {
		expect(existsSync(join(ROOT, path)), path).toBe(true);
		expect(owner.length > 0, path).toBe(true);
		for (const [s, why] of Object.entries(imports)) {
			expect(found[path] ?? [], `${path}: ${s}`).toContain(s);
			expect(why.length > 0, `${path}: ${s}`).toBe(true);
		}
	}
});

/** what every page may load, a library too (the engine, the kit, the render core, the app's own helpers) */
const SHARED = ['maia/content/assets/', 'maia/content/render/', 'maia/content/sandbox-kit/', 'maia/site/lib/app/', 'maia/content/film/', 'maia/site/lib/media/', 'aven/kernel/sandbox/', 'maia/site/lib/ids.js', 'maia/site/lib/native.ts', 'maia/content/game/'];

test('what the libraries are built from outside their folders is listed as builder code', () => {
	const roots = BUILDERS.filter((b) => b !== 'maia/content/assets/index.js' && !b.startsWith('maia/content/sandbox-2/'));
	const unlisted = [];
	for (const file of ['maia/site/lib', 'maia/content', 'aven/kernel', 'aven/db/page'].flatMap((top) => [...files(join(ROOT, top))])) {
		const path = relative(ROOT, file);
		if (!under(roots, path)) continue;
		for (const spec of specifiers(file)) {
			const to = resolve(file, spec);
			if (to && !under(BUILDERS, to) && !under(SHARED, to)) unlisted.push(`${path}: ${spec}`);
		}
	}
	expect(unlisted).toEqual([]);
});

test('every import of ours in maia/, the kernel, avenDB\'s page and the scripts names a file that is there (a module moved or deleted leaves none behind)', () => {
	const missing = [];
	for (const top of ['maia', 'aven/kernel', 'aven/db/page', 'aven/db/scripts', 'aven/ops'])
		for (const file of files(join(ROOT, top)))
			for (const spec of specifiers(file, true)) {
				// SvelteKit writes a route's ./$types as it builds
				if (spec === './$types') continue;
				if (resolve(file, spec, [...EXT, '.mjs', '.json']) === undefined) missing.push(`${relative(ROOT, file)}: ${spec}`);
			}
	expect(missing).toEqual([]);
});

test('every builder module listed is there, and the rule finds a back door (so it holds something)', () => {
	for (const b of BUILDERS) expect(existsSync(join(ROOT, b)), b).toBe(true);
	expect(specifiers(join(ROOT, 'maia/content/models/domerooms.js'))).toContain('$content/sandbox-2/interior/spaces');
	expect(resolve(join(ROOT, 'maia/content/buildings/inside.js'), '$content/sandbox-2/interior/interior')).toBe('maia/content/sandbox-2/interior/interior.ts');
	expect(backDoors()['maia/content/buildings/inside.js']).toContain('$content/sandbox-2/interior/interior');
});

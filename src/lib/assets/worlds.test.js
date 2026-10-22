// @ts-nocheck — plain JS
// Worlds without back doors (plan C8): a world draws our assets as builds of their recipes, made in the asset box and
// drawn by the universal renderer (./render: createAssets, crowd.js, impostors.js). It never imports the code our
// recipes are made of (a builder module), and never objectAt (./index.js), which runs a builder in the page: either
// is a back door round the box. The few worlds that still go through one are listed below, each import with why and
// whose it is to move; an exception that went comes off the list. (The games are named as they are listed:
// /app/games/sandbox-3 is Sandbox 3, its village of domes; /app/games/sandbox-4 is Sandbox 4, the same grown from our
// plants.)
// Run: bun test src/lib/assets/worlds.test.js
import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '../../..');

/**
 * Builder modules: the asset libraries' own folders; their builders and the kit's outside them, as the index loads
 * them; the index itself (objectAt and assetAt run a builder in the page); and the recipe code of Sandbox 3's domes,
 * which the dome rooms' Things, the mini domes and the playgrounds are built from (their code is in those recipes'
 * libraries, src/lib/models/domerooms.js and index.ts). A path ending in / is a folder.
 */
const BUILDERS = [
	'src/lib/models/',
	'src/lib/machines/',
	'src/lib/actors/',
	'src/lib/plants/',
	'src/lib/biomes/',
	'src/lib/buildings/built.js',
	'src/lib/buildings/tent.js',
	'src/lib/assets/kit.js',
	'src/lib/assets/parts.js',
	'src/lib/assets/index.js',
	'src/lib/sandbox-2/interior/interior.ts',
	'src/lib/sandbox-2/interior/spaces.ts',
	'src/lib/sandbox-2/interior/rooms.ts',
	'src/lib/sandbox-2/interior/plants.ts',
	'src/lib/sandbox-2/interior/textures.ts'
];

/** World modules: every world's own code and its pages (a page under /app/games, /games for the film, …) */
const WORLDS = [
	'src/lib/aven-city/',
	'src/lib/sandbox-2/',
	'src/lib/sandbox-5/',
	'src/lib/sandbox-6/',
	'src/lib/maiacity-v1/',
	'src/lib/worlds/',
	'src/lib/factories/',
	'src/lib/buildings/inside.js',
	'src/lib/film/sets.js',
	'src/routes/app/games/',
	'src/routes/games/',
	'src/routes/app/worlds/',
	'src/routes/app/maiacity-v1/',
	'src/routes/app/coops/',
	'src/routes/app/factories/',
	'src/routes/app/buildings/'
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
	'src/lib/sandbox-2/interior/interior.ts': {
		imports: { './textures': WHY.shell, './spaces': `${WHY.squares}; ${WHY.coops}`, './rooms': WHY.rooms, './plants': WHY.plants, '$lib/biomes': WHY.ground },
		owner: ASSET
	},
	'src/lib/sandbox-2/interior/village.ts': {
		imports: { './interior': "Sandbox 3 and 4's village: its domes raised in the page, as ./interior.ts is", './spaces': `${WHY.squares}; ${WHY.coops}`, './textures': WHY.shell, './plants': WHY.plants, '$lib/biomes': WHY.ground },
		owner: ASSET
	},
	'src/lib/buildings/inside.js': { imports: { '$lib/sandbox-2/interior/interior': "the Buildings' domes: Sandbox 3's, raised in the page" }, owner: ASSET },
	'src/routes/games/[world=world]/mounts.js': { imports: { '$lib/sandbox-2/interior/interior': "Sandbox 3's domes on film: each raised in the page" }, owner: ASSET },
	'src/lib/sandbox-2/interior/spaces.ts': {
		imports: {
			'./plants': `the squares' shrubs: ${WHY.plants}`,
			'$lib/models/minidomes.js': 'the mini domes for its `mini` coops, which only a test asks for (Sandbox 4 draws them from the box)'
		},
		owner: ASSET
	},
	'src/lib/sandbox-2/interior/rooms.ts': { imports: { './plants': `the rooms' house plants and the terraces' potted plants: ${WHY.plants}` }, owner: ASSET },
	'src/lib/sandbox-2/interior/plants.ts': { imports: { './textures': `the stand-in plants' bark and leaves: ${STAND_INS}` }, owner: ASSET },
	'src/lib/sandbox-2/interior/water.ts': { imports: { './plants': "the domes' streams and ponds: only the stand-in plants' seeded random numbers (seeded)" }, owner: ASSET },
	'src/lib/sandbox-2/interior/animals.ts': { imports: { './plants': "the domes' animals: only the stand-in plants' seeded random numbers (seeded)" }, owner: ASSET },
	'src/lib/sandbox-2/interior/birds.js': { imports: { './plants': "the domes' birds: only the stand-in plants' seeded random numbers (seeded)" }, owner: ASSET },
	'src/lib/sandbox-2/interior/things.js': { imports: { './spaces': "where the coops stand round the squares (coopsAround), which the dome's own coops share" }, owner: ASSET },
	'src/lib/sandbox-2/interior/cover.js': {
		imports: {
			'$lib/biomes/built.js': "the floor's cover is drawn from the box: from the biomes it takes each kind's build (coverRef), not a builder",
			'$lib/biomes/index.js': "the floor's cover: each kind's seed (coverSeed)",
			'$lib/biomes/stream.js': "the floor's cover: how a tile is laid (coverTile)"
		},
		owner: ASSET
	},
	// MaiaCity V1 (phase 8e) and Sandbox 4's page: words and numbers kept beside the builders
	'src/lib/maiacity-v1/Game.svelte': {
		imports: { '$lib/models/village.js': "the info cards' texts (VILLAGE_INFO), which the Things' notes share; nothing is built", '$lib/models/wayside.js': "the info cards' texts (WAYSIDE_INFO), which the Things' notes share; nothing is built" },
		owner: ASSET
	},
	'src/routes/app/coops/+page.svelte': { imports: { '$lib/models/village.js': "MaiaCity V1's coops: their texts (VILLAGE_INFO), which the Things' notes share; nothing is built" }, owner: ASSET },
	'src/lib/maiacity-v1/world.js': { imports: { '$lib/models/units.js': 'how fast the people and machines move (SPEED), which the Things share; nothing is built' }, owner: ASSET },
	'src/routes/app/games/sandbox-4/+page.svelte': { imports: { '$lib/plants': "the plant card's words (its name, Latin name, layer, stages), read from the plants' list; nothing is built" }, owner: ASSET }
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
	if (spec === '$lib' || spec.startsWith('$lib/')) base = join(ROOT, 'src/lib', spec.slice(5));
	else if (spec.startsWith('.')) base = join(dirname(from), spec);
	else return null;
	for (const e of ext) if (existsSync(base + e) && statSync(base + e).isFile()) return relative(ROOT, base + e);
	return undefined;
}

/** every world module's imports of a builder module: file -> [specifier, as written] */
function backDoors() {
	const found = {};
	for (const top of ['src/lib', 'src/routes'])
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
const SHARED = ['src/lib/assets/', 'src/lib/render/', 'src/lib/sandbox-kit/', 'src/lib/app/', 'src/lib/film/', 'src/lib/media/', 'src/lib/sandbox/', 'src/lib/ids.js', 'src/lib/native.ts', 'game/'];

test('what the libraries are built from outside their folders is listed as builder code', () => {
	const roots = BUILDERS.filter((b) => b !== 'src/lib/assets/index.js' && !b.startsWith('src/lib/sandbox-2/'));
	const unlisted = [];
	for (const file of files(join(ROOT, 'src/lib'))) {
		const path = relative(ROOT, file);
		if (!under(roots, path)) continue;
		for (const spec of specifiers(file)) {
			const to = resolve(file, spec);
			if (to && !under(BUILDERS, to) && !under(SHARED, to)) unlisted.push(`${path}: ${spec}`);
		}
	}
	expect(unlisted).toEqual([]);
});

test('every import of ours in src and scripts names a file that is there (a module moved or deleted leaves none behind)', () => {
	const missing = [];
	for (const top of ['src', 'scripts'])
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
	expect(specifiers(join(ROOT, 'src/lib/models/domerooms.js'))).toContain('$lib/sandbox-2/interior/spaces');
	expect(resolve(join(ROOT, 'src/lib/buildings/inside.js'), '$lib/sandbox-2/interior/interior')).toBe('src/lib/sandbox-2/interior/interior.ts');
	expect(backDoors()['src/lib/buildings/inside.js']).toContain('$lib/sandbox-2/interior/interior');
});

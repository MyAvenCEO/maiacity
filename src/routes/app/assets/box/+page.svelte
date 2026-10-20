<!--
	THE ASSET BOX'S LAB (/app/assets/box/) — phases 0 to 3 of the asset pipeline (src/lib/assets): our own assets built
	inside the box, a worker in a frame with no origin running a frozen engine, and shown from the plain data it hands
	back, as an asset no one trusts would be. Every build is named by its recipe's BLAKE3 hash and the values it takes
	(`<hash>?seed=maia&stage=9`); a label such as plants/apple@2 only points at a hash. One button runs every check: each
	frozen engine checked against its hash and engine 1 still building as it did, what the box cannot reach (tried by a recipe), assets built in the box against the
	same built in the page, a recipe that answers another's build, a recipe that crashes its worker and one that never
	stops (each ended alone, the box's other recipes building on), a recipe whose bytes are not
	its name, data and cards out of shape,
	each recipe's parameters, and each asset loaded again from this device's cache the same, with no box started. A
	second button builds every asset of ours (every version and variant, phase 3) in the box and in the page, compares
	the two and times both.
	Laid out as every asset library of the app is ($lib/app/Turntable.svelte): the builds down the left, the asset on its
	turntable, the actions across the top, the build's name, the cache and the checks down the right. Every recipe built
	here is the Maia City vault's ($lib/assets/vault.js), so the page's own build of each (objectAt) holds the vault's
	recipes to the repo's code; the trials, made to do harm, are the box's own (`virtual:box-trials`), never a vault's.
-->
<script>
	// @ts-nocheck — plain JS
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import { disposeObject } from '$lib/render/core.js';
	import { createStageRenderer } from '$lib/render/stage.js';
	import Turntable from '$lib/app/Turntable.svelte';
	import { fit } from '$lib/app/turntable.js';
	import { OBJECT_GROUPS } from '$lib/assets/groups.js';
	import TRIALS from 'virtual:box-trials';
	import { AssetBox, engineCode } from '$lib/assets/box/host.js';
	import { rebuild } from '$lib/assets/box/rebuild.js';
	import { FORMAT } from '$lib/assets/box/serialize.js';
	import * as cache from '$lib/assets/cache.js';
	import { trianglesOf as tris } from '$lib/assets/card.js';
	import { ENGINES, LATEST } from '$lib/assets/engines.js';
	import { boxOf, keyOf, loadAsset } from '$lib/assets/load.js';
	import { base as root } from '$app/paths';
	import { INDEX, buildAt, checked, hashText, pageOf, parseBuild, recipeAt } from '$lib/assets/vault.js';
	import { valuesOf } from '$lib/assets/params.js';
	import { checkCard } from '$lib/assets/schemas/index.js';
	import { hostileCards } from '$lib/assets/schemas/hostile.js';

	// each named by its label and the values it takes (a plant's stage and seed; the others take none), then by hash
	const LABELS = ['plants/apple?seed=maia&stage=9', 'plants/jackfruit?seed=maia&stage=9', 'things/bell-tent', 'machines/powercube@3', 'actors/stand-in'];
	const SAMPLES = LABELS.map((label) => ({ label, name: buildAt(label) }));
	const short = (name) => `${name.slice(0, 10)}…${name.slice(64)}`;
	// a build's own page, on the root by its hash ($lib/assets/AssetPage.svelte), or none for a name of nothing
	const linkOf = (n) => {
		try {
			const { hash, params } = parseBuild(n.trim());
			return INDEX.recipes[hash] ? pageOf(root, hash, params) : null;
		} catch {
			return null;
		}
	};

	// the builds down the left, as a library lists its assets: each by its name and version, its values beside it
	const ITEMS = SAMPLES.map(({ label, name: n }) => {
		const at = INDEX.recipes[n.slice(0, 64)];
		return { id: n, label: `${at.id}@${at.v}${at.variant ? `:${at.variant}` : ''}`, values: n.slice(65).replace(/&/g, ' · '), group: OBJECT_GROUPS[at.group]?.label ?? at.group, note: `${label}, its recipe ${n.slice(0, 12)}…` };
	});

	let box = boxOf();
	let canvasBox = $state();
	let name = $state(SAMPLES[0].name);
	let busy = $state(false);
	let held = $state(null);
	let line = $state('');
	let checks = $state([]);
	// the card of what is on the turntable
	let loaded = $state(null);
	const passed = $derived(checks.filter((c) => c.ok).length);
	// the build in the field, as the list names it (or as typed, when it is none of the list's)
	const chosen = $derived(ITEMS.find((i) => i.id === name.trim()) ?? { id: name, label: 'A build of your own' });
	let probes = $state(null);
	let results = $state(null);
	let renderer, scene, camera, controls, shown, frame;
	// the checks time builds: the view holds still meanwhile, so drawing it takes no time from them
	let still = false;

	onMount(() => {
		// the stage renderer ($lib/render/stage.js): the canvas in the box, the camera (its field of view widened on an
		// upright canvas, $lib/app/turntable.js), the controls, kept to the box's size
		const view = createStageRenderer(canvasBox, { toneMapping: 'aces', fov: 40, near: 0.01, far: 500, turntable: true, fit });
		({ renderer, camera, controls } = view);
		scene = new THREE.Scene();
		scene.background = new THREE.Color('#e9e6e0');
		scene.add(new THREE.HemisphereLight('#ffffff', '#b9b2a6', 1.25));
		const sun = new THREE.DirectionalLight('#fff4e6', 2.3);
		sun.position.set(4, 8, 5);
		scene.add(sun);
		camera.position.set(4, 3, 6);
		view.resize();
		const loop = () => {
			frame = requestAnimationFrame(loop);
			if (still) return;
			controls.update();
			renderer.render(scene, camera);
		};
		loop();
		void count();
		return () => {
			cancelAnimationFrame(frame);
			box.stop();
			view.dispose();
		};
	});

	/** an asset on the turntable, framed, and its card read out under it */
	function show(obj, card) {
		loaded = card ?? null;
		if (shown) scene.remove(shown);
		shown = obj;
		scene.add(obj);
		const b = new THREE.Box3().setFromObject(obj);
		const size = b.getSize(new THREE.Vector3()).length() || 1;
		const mid = b.getCenter(new THREE.Vector3());
		controls.target.copy(mid);
		camera.position.copy(mid).add(new THREE.Vector3(0.6, 0.45, 1).multiplyScalar(size * 1.3));
		camera.near = size / 500;
		camera.far = size * 50;
		camera.updateProjectionMatrix();
	}

	const now = () => performance.now();
	const size = (obj) => new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3()).toArray().map((x) => Math.round(x * 1000) / 1000);

	/** one build in the box (never from the cache), shown from its data, with its times */
	const inBox = (n) => loadAsset(n, { box, cache: false });

	/** what this device's cache holds */
	async function count() {
		const u = await cache.usage();
		held = u.kept ? `${u.count} ${u.count === 1 ? 'build' : 'builds'}, ${(u.bytes / 1048576).toFixed(1)} MB` : 'none in this browser';
	}

	async function loadOne() {
		busy = true;
		line = `Loading ${short(name)}…`;
		try {
			const r = await loadAsset(name.trim(), { box });
			show(r.obj, r.card);
			const where = r.from === 'cache' ? `from this device's cache in ${r.ms.total} ms (read ${r.ms.read} ms, rebuilt ${r.ms.rebuild} ms)` : `built in the box in ${r.ms.build} ms, ${r.ms.total} ms to the page, rebuilt in ${r.ms.rebuild} ms`;
			line = `${r.card.label} (${r.card.ref}): ${r.data.stats.tris.toLocaleString('en')} triangles, ${where}` + (r.data.stats.custom ? `, ${r.data.stats.custom} materials with their own shader drawn plain` : '');
			await r.stored;
			await count();
		} catch (e) {
			line = `${short(name)}: ${e.message}`;
		}
		busy = false;
	}

	async function empty() {
		await cache.clear();
		await count();
		line = 'The cache is empty: every asset builds in the box again.';
	}

	/** data out of shape: every one must be refused */
	const HOSTILE = {
		'a position that is not a number': (d) => (d.geometries[0].attributes.position.array[0] = NaN),
		'an index past its vertices': (d) => (d.geometries[0].index = new Uint32Array([0, 1, 1e6])),
		'nodes in a loop': (d) => d.nodes[d.nodes.length - 1].children.push(0),
		'a node with two parents': (d) => d.nodes[0].children.push(d.nodes[0].children[0]),
		'a material kind we do not know': (d) => (d.materials[0].type = 'ShaderMaterial'),
		'a material that is code': (d) => (d.materials[0].type = 'constructor'),
		'a picture too large': (d) => d.images.push({ pixels: { data: new Uint8Array(4), width: 9000, height: 1 } }),
		'a texture showing a picture it does not have': (d) => d.textures.push({ image: d.images.length + 7 }),
		'a string where an array should be': (d) => (d.geometries[0].attributes.position.array = 'x'.repeat(30)),
		'too many triangles': (d) => {
			const g = d.geometries[0];
			g.index = new Uint32Array(3 * 2_100_000);
			d.nodes.push({ name: 'x', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children: [], mesh: { geometry: 0, material: 0, kind: 'mesh' } });
			d.nodes[0].children.push(d.nodes.length - 1);
		},
		'a matrix that is not numbers': (d) => (d.nodes[0].matrix = Array(16).fill('1')),
		'another format': (d) => (d.format = FORMAT + 1)
	};

	async function runAll() {
		busy = true;
		still = true;
		checks = [];
		const add = (name, ok, note) => (checks = [...checks, { name, ok, note }]);
		const out = { userAgent: navigator.userAgent, engine: null, assets: [], probes: null, kill: null, hostile: {} };
		try {
			let t0 = now();
			out.engines = [];
			for (const e of ENGINES) {
				const code = await engineCode(e.v);
				const row = { v: e.v, blake3: e.blake3, bytes: code.length, hashed: hashText(code) };
				out.engines.push(row);
				add(`Engine ${e.v} is the one frozen`, row.hashed === e.blake3, `its ${(code.length / 1024).toFixed(0)} KB file hashes to ${e.blake3.slice(0, 16)}…, the BLAKE3 hash engines.json froze it under on ${e.date}; three.js ${e.three}, ${e.modules.length} modules lent to recipes${e.v === LATEST.v ? '; our recipes run on it' : ''}`);
			}

			t0 = now();
			await box.start();
			out.start = Math.round(now() - t0);
			add('The box starts', true, `${out.start} ms, engine ${LATEST.v} handed in whole`);

			line = 'A recipe tries every way out of the box…';
			const probed = await box.build(checked(TRIALS.probe));
			probes = Object.fromEntries(probed.data.nodes.slice(1).map((n) => [n.name.split('=')[0], n.name.slice(n.name.indexOf('=') + 1)]));
			out.probes = probes;
			const open = Object.entries(probes).filter(([, v]) => v.startsWith('OPEN'));
			add('Nothing gets out of the box', open.length === 0 && Object.keys(probes).length > 10, open.length ? `open: ${open.map(([k]) => k).join(', ')}` : `${Object.keys(probes).length} ways out, every one refused`);

			const { objectAt } = await import('$lib/assets/index.js');
			for (const { label, name: n } of SAMPLES) {
				line = `Building ${label} in the box and in the page…`;
				try {
					// each built once first, so both are timed warm (their code loaded and compiled)
					await inBox(n);
					await objectAt(label);
					const b = await inBox(n);
					t0 = now();
					const direct = await objectAt(label);
					const pageMs = Math.round(now() - t0);
					// a skinned actor comes out in its rest pose (its bones come with phase 6), so only its triangles compare
					const skinned = b.data.stats.skinned > 0;
					const same = tris(direct) === tris(b.obj) && b.card.triangles === tris(direct) && (skinned || JSON.stringify(size(direct)) === JSON.stringify(size(b.obj)));
					const row = { label, name: n, tris: tris(b.obj), page: pageMs, ...b.ms, size: size(b.obj), same, custom: b.data.stats.custom, skinned: b.data.stats.skinned };
					out.assets.push(row);
					add(`${label} comes out the same`, same, `${short(n)} · ${row.tris.toLocaleString('en')} triangles, its card fits${skinned ? ' (skinned: in its rest pose until phase 6)' : ''} · box ${row.build} ms + ${row.serialize} ms out, ${row.box} ms in all · page ${pageMs} ms · rebuilt in ${row.rebuild} ms`);
					show(b.obj, b.card);
				} catch (e) {
					out.assets.push({ label, name: n, error: e.message });
					add(`${label} comes out the same`, false, e.message);
				}
			}

			// a recipe that answers others' builds with its model, heard or guessed (TRIALS.answer), built first in the box
			// the bell tent is built in next: the tent must come out as the page builds it, never as the trial's model.
			// The page's tent is built before the trial starts, and the trial's room let go once the box's tent is out: the
			// trial floods the page with forged answers for half a minute, and a build in the page meanwhile waited on
			// them (70 s of the lab's 140)
			line = 'A recipe that answers for another…';
			const tentAt = buildAt('things/bell-tent');
			try {
				const page = await objectAt('things/bell-tent');
				const answer = checked(TRIALS.answer);
				const trial = await box.build(answer, { target: tentAt.slice(0, 64) });
				const tent = await inBox(tentAt);
				const trialRoom = box.rooms.find((r) => r.code === answer.code)?.room;
				if (trialRoom) box.leave(trialRoom, 'the trial is over');
				const forged = tent.data.nodes.some((n) => n.name === 'answered for another');
				out.answered = { trial: trial.card.recipe, tent: tent.card.recipe, forged, tris: [tris(tent.obj), tris(page)] };
				const kept = !forged && tent.card.recipe === tentAt.slice(0, 64) && out.answered.tris[0] === out.answered.tris[1];
				add('A recipe can’t answer another’s build', kept, kept ? `a recipe that hears every job of its worker and answers as the bell tent, by every job number it may guess, was built first: the tent still came out as the page builds it (${out.answered.tris[0].toLocaleString('en')} triangles), as each recipe builds in a worker of its own` : `the bell tent came out as ${forged ? 'the trial’s model' : `${out.answered.tris[0]} triangles, not ${out.answered.tris[1]}`}`);
			} catch (e) {
				out.answered = { error: e.message };
				add('A recipe can’t answer another’s build', false, e.message);
			}

			// a recipe dies alone: one that crashes its worker, then one that never stops, each built with the bell tent
			// asked right behind it and a machine running in the same box. Each must be ended, and the box go on: the same
			// frame, the tent out of the room it had, the machine still stepping
			const tentRecipe = await recipeAt(tentAt.slice(0, 64));
			const machineRecipe = await recipeAt(SAMPLES[3].name.slice(0, 64));
			const roomOf = (code) => box.rooms.find((r) => r.code === code)?.room;
			/** a trial built with the tent asked behind it: how it was ended, and what of the box went on */
			async function alone(trial, o) {
				await box.build(tentRecipe);
				const machine = await box.live(machineRecipe, undefined);
				const [frame, room] = [box.frame, roomOf(tentRecipe.code)];
				const t = now();
				let ms = 0;
				const ended = box.build(checked(trial), undefined, o).then(
					() => '',
					(e) => ((ms = Math.round(now() - t)), String(e.message))
				);
				const tent = box.build(tentRecipe).then(
					(b) => b.card,
					(e) => e
				);
				const [stopped, card] = [await ended, await tent];
				const stepped = await box.tick(machine.session, { dt: 0.016 }).then(
					() => true,
					(e) => e.message
				);
				await box.end(machine.session);
				const built = card?.recipe === tentRecipe.hash ? card.triangles : null;
				const went = { frame: box.frame === frame, room: !!room && roomOf(tentRecipe.code) === room, stepped: stepped === true };
				return { stopped, ms, built, ...went, alone: !!stopped && built > 0 && went.frame && went.room && went.stepped, why: built ? stepped : String(card?.message ?? card) };
			}
			const what = (r) => (r.alone ? `the bell tent asked right behind it came out of the room it had (${r.built.toLocaleString('en')} triangles), a machine kept running, all in the same box` : `the box did not go on: ${JSON.stringify(r)}`);

			line = 'A recipe that crashes its worker…';
			try {
				const r = await alone(TRIALS.crash);
				out.crash = r;
				add('One recipe’s crash leaves the others building', r.alone && /crashed/.test(r.stopped), `${r.stopped || 'it never crashed'}; ${what(r)}`);
			} catch (e) {
				out.crash = { error: e.message };
				add('One recipe’s crash leaves the others building', false, e.message);
			}

			line = 'A recipe that never stops…';
			try {
				const r = await alone(TRIALS.spin, { timeout: 2000 });
				out.kill = r;
				add('A recipe that never stops is ended alone', r.alone && /ran longer/.test(r.stopped), `${r.stopped || 'never stopped'} after ${r.ms} ms; ${what(r)}`);
			} catch (e) {
				out.kill = { error: e.message };
				add('A recipe that never stops is ended alone', false, e.message);
			}

			line = 'A recipe whose bytes are not its name…';
			const real = await recipeAt(SAMPLES[2].name);
			const forged = { hash: real.hash, code: real.code.replace('module.exports.recipe(', 'module.exports.recipe(/* one byte more */ ') };
			let forgedSaid = '';
			try {
				checked(forged);
				forgedSaid = 'ACCEPTED';
			} catch (e) {
				forgedSaid = e.message;
			}
			out.forged = forgedSaid;
			const named = hashText(real.code) === real.hash;
			add('A recipe is only what its hash names', named && forgedSaid.startsWith('refused'), named && forgedSaid.startsWith('refused') ? `${Object.keys(INDEX.recipes).length} recipes of ours, each named by the BLAKE3 hash of its bytes; one changed by a comment is refused before the box sees it` : forgedSaid);

			// an engine frozen is never changed: what was made for engine 1 still builds on it, as it did
			if (LATEST.v > 1) {
				line = 'Engine 1, as it was frozen…';
				const old = new AssetBox({ engine: 1 });
				try {
					out.engine1 = [];
					for (const { label, name: n } of [SAMPLES[3], SAMPLES[2]]) {
						const [hash] = n.split('?');
						const recipe = await recipeAt(hash);
						const one = await old.build(recipe);
						const two = await box.build(recipe);
						const pictures = async (d) => {
							const shown = (await cache.pixelsOf(d))[d.format === 0 ? 'textures' : 'images'];
							return [...new Set(shown.map((x) => x?.picture?.rgba ?? x?.pixels?.data).filter(Boolean).map(cache.fingerprint))].sort();
						};
						const [p1, p2] = [await pictures(one.data), await pictures(two.data)];
						out.engine1.push({ label, format: [one.data.format, two.data.format], tris: [tris(rebuild(one.data)), tris(rebuild(two.data))], bytes: [cache.bytesOf(one.data), cache.bytesOf(two.data)], pictures: [p1.length, p2.length], same: JSON.stringify(p1) === JSON.stringify(p2) });
					}
					const ok = out.engine1.every((r) => r.format[0] === 0 && r.tris[0] === r.tris[1] && r.same);
					const mb = (b) => (b / 1048576).toFixed(1);
					add(`Engine 1 still builds as it did`, ok, out.engine1.map((r) => `${r.label}: ${r.tris[0].toLocaleString('en')} triangles on both, the same ${r.pictures[1]} pictures; ${mb(r.bytes[0])} MB out of engine 1, ${mb(r.bytes[1])} MB out of engine ${LATEST.v}`).join(' · '));
				} catch (e) {
					add(`Engine 1 still builds as it did`, false, e.message);
				}
				old.stop();
			}

			line = 'Data out of shape…';
			const base = (await box.build(await recipeAt(SAMPLES[2].name))).data;
			for (const [what, spoil] of Object.entries(HOSTILE)) {
				const d = structuredClone(base);
				spoil(d);
				try {
					rebuild(d);
					out.hostile[what] = 'ACCEPTED';
				} catch (e) {
					out.hostile[what] = e.message;
				}
			}
			const taken = Object.entries(out.hostile).filter(([, v]) => v === 'ACCEPTED');
			add('Data out of shape is refused', taken.length === 0, taken.length ? `accepted: ${taken.map(([k]) => k).join(', ')}` : `${Object.keys(HOSTILE).length} kinds, every one refused`);

			line = 'Cards made to do harm…';
			const evil = hostileCards((await box.build(await recipeAt(SAMPLES[3].name))).card);
			out.cards = Object.fromEntries(Object.entries(evil).map(([what, card]) => [what, checkCard(card).ok ? 'ACCEPTED' : 'refused']));
			const let_in = Object.entries(out.cards).filter(([, v]) => v === 'ACCEPTED');
			add('A card made to do harm is refused', let_in.length === 0, let_in.length ? `accepted: ${let_in.map(([k]) => k).join(', ')}` : `${Object.keys(evil).length} kinds, every one refused`);

			// phase 2: what a recipe takes is its own, and what it made is kept on this device by its hash
			const apple = INDEX.recipes[SAMPLES[0].name.slice(0, 64)];
			const tries = { 'a stage past ripe': { stage: '12' }, 'a stage that is no number': { stage: 'x' }, 'a parameter it does not take': { colour: 'red' }, 'a seed too long': { seed: 'x'.repeat(200) } };
			const wrong = Object.entries(tries).filter(([, given]) => {
				try {
					valuesOf(apple.params, given);
					return true;
				} catch {
					return false;
				}
			});
			const ah = SAMPLES[0].name.slice(0, 64);
			const sorted = keyOf(`${ah}?stage=9&seed=maia`) === keyOf(`${ah}?seed=maia&stage=9`) && keyOf(ah) === keyOf(`${ah}?seed=maia&stage=9`) && keyOf(`${ah}?seed=isar&stage=9`) !== keyOf(`${ah}?seed=maia&stage=9`);
			add('A recipe’s parameters are its own', wrong.length === 0 && sorted, wrong.length ? `taken: ${wrong.map(([k]) => k).join(', ')}` : `the apple takes ${apple.params.map((x) => x.id).join(' and ')}; ${Object.keys(tries).length} wrong ones refused; the same values name the same build in any order or left at its own, another seed another`);

			out.cache = [];
			for (const { label, name: n } of SAMPLES) {
				line = `${label}: built cold, then from the cache…`;
				try {
					await cache.drop(keyOf(n));
					const cold = await loadAsset(n, { box });
					const kept = await cold.stored;
					// a page that never started a box: what it finds in the cache needs none
					const fresh = new AssetBox();
					const warm = await loadAsset(n, { box: fresh });
					const noBox = !fresh.frame && !fresh.ready;
					fresh.stop();
					const a = cache.fingerprint(await cache.pixelsOf(cold.data));
					const b = cache.fingerprint(await cache.pixelsOf(warm.data));
					const same = kept && warm.from === 'cache' && noBox && a === b && JSON.stringify(cold.card) === JSON.stringify(warm.card);
					const row = { label, name: n, cold: cold.ms.total, cached: warm.ms.total, read: warm.ms.read, rebuild: warm.ms.rebuild, kept, from: warm.from, noBox, same, bytes: cache.bytesOf(await cache.storable(cold.data)), raw: cache.bytesOf(cold.data) };
					out.cache.push(row);
					const x = row.cached ? (row.cold / row.cached).toFixed(1) : '∞';
					add(`${label} loads from the cache the same`, same, same ? `cold ${row.cold} ms in the box · cached ${row.cached} ms (read ${row.read} ms, rebuilt ${row.rebuild} ms), ${x}× faster, no box started · ${(row.bytes / 1048576).toFixed(1)} MB kept (${(row.raw / 1048576).toFixed(1)} MB in memory), bit for bit the same` : `kept ${kept}, from ${warm.from}, box started ${!noBox}, same data ${a === b}`);
					show(warm.obj, warm.card);
				} catch (e) {
					out.cache.push({ label, name: n, error: e.message });
					add(`${label} loads from the cache the same`, false, e.message);
				}
			}

			line = 'A spoiled cache entry…';
			const tentName = SAMPLES[2].name;
			const tent = keyOf(tentName);
			const good = await loadAsset(tentName, { box });
			await good.stored;
			const spoilt = await cache.storable(good.data);
			const d = structuredClone(spoilt);
			d.geometries[0].attributes.position.array[0] = NaN;
			await cache.putRaw(tent, { data: d, card: good.card });
			const after1 = await loadAsset(tentName, { box });
			await after1.stored;
			await cache.putRaw(tent, { data: spoilt, card: { ...good.card, ref: 'javascript:alert(1)' } });
			const after2 = await loadAsset(tentName, { box });
			await after2.stored;
			const again = await loadAsset(tentName, { box });
			const refused = after1.from === 'box' && after2.from === 'box' && again.from === 'cache';
			out.spoiled = { data: after1.from, card: after2.from, after: again.from };
			add('A spoiled cache entry is refused and built again', refused, refused ? 'a position that is no number, then a card naming a script: each dropped, built in the box again, and kept right' : `loaded from ${after1.from} and ${after2.from}, then ${again.from}`);
			await count();
		} catch (e) {
			add('The checks ran', false, e.message);
		}
		results = out;
		still = false;
		line = checks.every((c) => c.ok) ? 'Every check passed.' : 'Some checks failed.';
		busy = false;
	}

	/** a built object's geometry, materials and pictures let go, once it has been compared */
	const dispose = (obj) => disposeObject(obj);

	const median = (xs) => {
		const a = xs.filter((x) => typeof x === 'number').sort((x, y) => x - y);
		return a.length ? a[Math.floor(a.length / 2)] : 0;
	};

	// what the box refuses on purpose: frozen versions with a fault their own notes name, refused as any data out of
	// shape is (none now: the stand-in's back teeth, NaN from v6 to v9, are kept black, as the screen drew them)
	/** @type {{ label: RegExp, error: string, why: string }[]} */
	const FAULTY = [];
	const faulty = (r) => FAULTY.find((f) => f.label.test(r.label) && r.error?.includes(f.error));

	// phase 3: every recipe of ours, each version and variant at its own values, built in the box and in the page, the
	// two compared as the samples are, and both timed
	let sweep = $state(null);
	async function everyAsset() {
		busy = true;
		still = true;
		checks = checks.filter((c) => !c.name.startsWith('Every asset'));
		const { objectAt } = await import('$lib/assets/index.js');
		const all = Object.entries(INDEX.recipes).sort(([, a], [, b]) => a.label.localeCompare(b.label));
		const rows = [];
		const t0 = now();
		for (const [hash, at] of all) {
			line = `Every asset: ${rows.length + 1} of ${all.length}, ${at.label}…`;
			try {
				const b = await loadAsset(hash, { box, cache: false });
				const t1 = now();
				const direct = await objectAt(at.label);
				const page = Math.round(now() - t1);
				const skinned = b.data.stats.skinned > 0;
				const same = tris(direct) === tris(b.obj) && b.card.triangles === tris(direct) && (skinned || JSON.stringify(size(direct)) === JSON.stringify(size(b.obj)));
				rows.push({ label: at.label, hash, tris: b.card.triangles, recipe: b.ms.recipe, start: b.ms.start, build: b.ms.build, serialize: b.ms.serialize, box: b.ms.box, rebuild: b.ms.rebuild, page, mb: Math.round(cache.bytesOf(b.data) / 10485.76) / 100, same, skinned, ...(same ? {} : { page_tris: tris(direct), page_size: size(direct), box_size: size(b.obj) }) });
				dispose(direct);
				dispose(b.obj);
			} catch (e) {
				rows.push({ label: at.label, hash, error: String(e.message).slice(0, 200) });
			}
		}
		const refused = rows.filter((r) => !r.same && faulty(r));
		const failed = rows.filter((r) => !r.same && !faulty(r));
		const slowest = rows.filter((r) => r.same).sort((a, b) => b.box - a.box).slice(0, 10);
		sweep = { userAgent: navigator.userAgent, engine: INDEX.engine, ms: Math.round(now() - t0), count: rows.length, failed: failed.length, refused: refused.length, median: { build: median(rows.map((r) => r.build)), box: median(rows.map((r) => r.box)), page: median(rows.map((r) => r.page)), rebuild: median(rows.map((r) => r.rebuild)), mb: median(rows.map((r) => r.mb)) }, slowest, rows };
		checks = [
			...checks,
			{
				name: `Every asset comes out the same`,
				ok: failed.length === 0,
				note: `${rows.length - failed.length - refused.length} of ${rows.length} recipes (every asset, version and variant) built in the box as in the page, in ${(sweep.ms / 1000).toFixed(0)} s${refused.length ? `, and ${refused.length} refused as they should be: ${[...new Set(refused.map((r) => faulty(r).why))].join('; ')}` : ''}; medians: built in ${sweep.median.build} ms, ${sweep.median.box} ms in the box in all, ${sweep.median.page} ms in the page, rebuilt in ${sweep.median.rebuild} ms, ${sweep.median.mb} MB${failed.length ? `; not the same: ${failed.map((r) => r.label).join(', ')}` : ''}`
			}
		];
		still = false;
		line = failed.length ? `${failed.length} of ${rows.length} not the same.` : `Every asset came out the same${refused.length ? `, but ${refused.length} refused for a fault of their own` : ''}.`;
		busy = false;
	}
</script>

<svelte:head><title>Asset box · maiaCITY</title></svelte:head>

<Turntable
	name="box"
	bind:canvas={canvasBox}
	picks={{
		title: 'Asset box',
		lede: 'Our own assets built where an untrusted one would be: a worker in a frame with no origin, no network and no storage, running a frozen engine checked against its hash. Each recipe is named by the BLAKE3 hash of its bytes; the page builds its own objects from the plain data the box hands back, and keeps them on this device by that hash.',
		items: ITEMS,
		chosen,
		where: (item) => item.values,
		onpick: (item) => {
			name = item.id;
			if (!busy) loadOne();
		},
		group: (item) => item.group
	}}
>
	{#snippet bar()}
		<div class="chips">
			<button class="chip run" onclick={runAll} disabled={busy}>Run every check</button>
			<button class="chip" onclick={everyAsset} disabled={busy} title="Build all {Object.keys(INDEX.recipes).length} recipes in the box and in the page, and compare them">Every asset</button>
			<button class="chip" onclick={loadOne} disabled={busy}>Load</button>
			{#if linkOf(name)}<a class="chip" href={linkOf(name)}>Its page</a>{/if}
			<button class="chip" onclick={empty} disabled={busy}>Empty the cache</button>
		</div>
	{/snippet}
	{#snippet panel()}
		<label class="build">
			<span class="label">A build: its recipe's hash, then ?its=values</span>
			<input bind:value={name} list="builds" spellcheck="false" autocomplete="off" />
			<datalist id="builds">{#each SAMPLES as s}<option value={s.name}>{s.label}</option>{/each}</datalist>
		</label>
		{#if held}<p class="held"><span class="label">This device's cache</span>{held}</p>{/if}
		{#if checks.length}
			<span class="label">Checks · {passed} of {checks.length} passed</span>
			<ul class="checks">
				{#each checks as c}
					<li class:bad={!c.ok}><b>{c.ok ? '✓' : '✗'} {c.name}</b><small>{c.note}</small></li>
				{/each}
			</ul>
		{/if}
		{#if sweep}
			<details>
				<summary>Every asset: the slowest in the box{sweep.failed ? ', and those not the same' : ''}</summary>
				<ul class="probes">
					{#each sweep.rows.filter((r) => !r.same) as r}<li><b>{r.label}</b> {faulty(r) ? `refused as it should be: ${r.error}` : (r.error ?? `${r.tris} triangles in the box, ${r.page_tris} in the page`)}</li>{/each}
					{#each sweep.slowest as r}<li><b>{r.label}</b> {r.box} ms in the box ({r.build} ms built), {r.page} ms in the page, {r.tris.toLocaleString('en')} triangles, {r.mb} MB</li>{/each}
				</ul>
			</details>
		{/if}
		{#if probes}
			<details>
				<summary>Every way out, tried from inside the box</summary>
				<ul class="probes">{#each Object.entries(probes) as [k, v]}<li><b>{k}</b> {v}</li>{/each}</ul>
			</details>
		{/if}
	{/snippet}
	{#snippet readout()}
		{#if loaded}<b>{loaded.label} <em>{loaded.ref}</em></b>{/if}
		<small data-line>{line || 'Pick a build to load it, or run every check.'}</small>
		{#if loaded}<span>{loaded.triangles.toLocaleString('en')} triangles · {loaded.size.map((x) => x.toFixed(2)).join(' × ')} m · engine {loaded.engine}</span>{/if}
	{/snippet}
	{#if results}<pre id="results" hidden>{JSON.stringify(results)}</pre>{/if}
	{#if sweep}<pre id="sweep" hidden>{JSON.stringify(sweep)}</pre>{/if}
</Turntable>

<style>
	/* the checks need room: the panel is wider here than a library's */
	:global(.turntable.box .panel) {
		width: 22rem;
	}

	.run {
		background: #3d6b2e;
		border-color: #3d6b2e;
		color: #fff;
	}

	.chip:disabled {
		opacity: 0.45;
		cursor: default;
	}

	a.chip {
		text-decoration: none;
		color: inherit;
	}

	.build {
		display: grid;
		gap: 0.3rem;
	}

	.build input {
		min-width: 0;
		padding: 0.4rem 0.6rem;
		border: 1px solid rgb(0 0 0 / 0.12);
		border-radius: 8px;
		background: #fff;
		color: inherit;
		font: 0.75rem ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	.held {
		display: grid;
		gap: 0.15rem;
		margin: 0.7rem 0;
	}

	.checks {
		display: grid;
		gap: 0.35rem;
		margin: 0.4rem 0 0.7rem;
		padding: 0;
		list-style: none;
	}

	.checks li {
		display: grid;
		gap: 0.1rem;
		padding: 0.45rem 0.55rem;
		border-radius: 8px;
		background: #edf2e6;
	}

	.checks li b {
		font-weight: 600;
		color: #2f5a22;
	}

	.checks li.bad {
		background: #f6e1dc;
	}

	.checks li.bad b {
		color: #a3312a;
	}

	.checks small,
	.probes {
		color: rgb(31 42 35 / 0.7);
		font-size: 0.75rem;
		overflow-wrap: anywhere;
	}

	summary {
		cursor: pointer;
		font-size: 0.8rem;
	}

	.probes {
		padding-left: 1rem;
	}

	em {
		margin-left: 0.3rem;
		font-weight: 400;
		opacity: 0.55;
		overflow-wrap: anywhere;
	}
</style>

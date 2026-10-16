<!--
	ONE VIEWER FOR EVERY ASSET — the Things, the Machines, the Actors and the Plants all show theirs with it, the same
	way: the list to pick from down the left ($lib/app/Turntable.svelte), the asset on the asset stage ($lib/assets/stage.js,
	the paper studio AirSup's lab shows a machine in), and round it the same options for every one, each where it applies:

	  Moves    how it moves, one at a time: Run (its solver at the sliders), its own moves (a drawer out and in), an
	           actor's clips, Assemble (its parts flying in by their build steps, or a tent pitched), Break, Pause;
	           an actor's poses held, any joint turned by hand
	  Views    how it is looked at, any at once: Explode, Cut away, X-ray, Labels, Slow; Lift the roof; Step inside
	  Built    what its recipe is built with (a plant's stage, seed and fruit), changed here and built anew
	  Variants and versions (in the list), its controls (a door, the tailgate, a fire lit), its solver's sliders
	  Parts    every part it is made of, by its assemblies, a part that is a whole asset of its own (a Power Cube in a
	           pickup) under that asset, linked to its own page; tap one, on it or in the list, for its card

	Every build comes from the asset box or this device's cache, checked ($lib/assets/load.js), and is shown from its
	data alone ($lib/assets/hero.js): what moves by itself runs in the box, and only numbers come back. Drag to turn round
	it, scroll to come closer. An admin's.

	The Buildings add three things: every building stands on the same round ground ($lib/buildings/ground.js, `round`)
	and is walked there, the list kept beside it (`inPlace`); and an item that is a world in disguise (a dome: Sandbox
	3's interior, `inside`) is built by that world's own code into a scene of its own on this canvas, not in the box
	($lib/buildings/inside.js), and stepped inside the same way.
-->
<script>
	// @ts-nocheck — plain JS
	import { onDestroy, onMount, untrack } from 'svelte';
	import { base } from '$app/paths';
	import Turntable from '$lib/app/Turntable.svelte';
	import { fit } from '$lib/app/turntable.js';
	import { atOrLatest } from '$lib/app/versions.js';
	import { adaptiveResolution, disposeObject, lowPower, topPixelRatio } from '$lib/render/core.js';
	import TouchStick from '$lib/touch/TouchStick.svelte';
	import WalkHint from '$lib/sandbox-kit/WalkHint.svelte';
	import { walk } from './controls.js';
	import { forStage, heroOf, runner, walkOf } from './hero.js';
	import { boxOf, canonical, liveBoxOf, loadAsset } from './load.js';
	import { INDEX, buildOf, hashOf, pageOf, recipeAt } from './recipes.js';
	import { parseRef, refOf } from './refs.js';
	import { soilOf } from './soil.js';

	/** how many steps a world in disguise reports while it is built ($lib/buildings/inside.js) */
	const STEPS = 5;

	/** the stage's views (how it is looked at, any at once), as the bar names them */
	const VIEWS = /** @type {const} */ ([
		['explode', 'Explode'],
		['cut', 'Cut away'],
		['xray', 'X-ray'],
		['labels', 'Labels'],
		['slow', 'Slow']
	]);
	/** what the bar shows as tabs of a parameter rather than a slider: one with named steps (a plant's stages) */
	const tabbed = (p) => Array.isArray(p.names) && p.names.length > 1 && p.names.length <= 12;

	/**
	 * @type {{ name: string, title: string, lede: string, group: string, items: any[], where?: (item: any) => string, heading?: (item: any) => string, soil?: boolean, round?: boolean, inPlace?: boolean, inside?: { is: (item: any) => boolean, raise: Function } | null }}
	 *   `group` the recipes' group (things, machines, actors, plants, buildings); `items` its list, as the group lists it;
	 *   `heading` the heading an item is listed under; `soil` a plant's earth round its roots; `round` every build on the
	 *   Buildings' round ground, a walk kept to it; `inPlace` a walk keeps the list beside it, never the whole screen;
	 *   `inside` the items that are worlds in disguise (`is`) and how one is raised on this canvas (`raise`,
	 *   $lib/buildings/inside.js)
	 */
	let { name, title, lede, group, items, where = (it) => it.from ?? it.usedIn ?? '', heading, soil = false, round = false, inPlace = false, inside = null } = $props();
	const first = untrack(() => items[0]);

	/** @type {HTMLDivElement | undefined} */
	let canvasBox = $state();
	/** @type {HTMLDivElement | undefined} */
	let viewBox = $state();
	let chosen = $state(first);
	let version = $state(first.version);
	/** the variants its version has (an actor's breeds, a machine's sizes), and the one shown */
	const variants = $derived.by(() => {
		const b = atOrLatest(chosen.versions, version)?.build;
		return Array.isArray(b) ? b : [];
	});
	let variantId = $state(/** @type {string | null} */ (null));
	const variant = $derived(variants.find((v) => v.id === variantId) ?? variants[0] ?? null);
	/** the recipe of what is chosen, by its hash; undefined if only its note was kept */
	const hash = $derived(INDEX.labels[refOf(group, chosen.id, version, variant?.id)]);
	const recipe = $derived(hash ? INDEX.recipes[hash] : null);
	/** what its recipe is built with, as text, beyond its own values (a plant's stage, seed, fruit); detail is the renderer's */
	let given = $state(/** @type {Record<string, string>} */ ({}));
	const params = $derived((recipe?.params ?? []).filter((p) => p.id !== 'detail'));
	const values = $derived.by(() => {
		try {
			return hash ? canonical(buildOf(hash, Object.fromEntries(Object.entries(given).filter(([k]) => params.some((p) => p.id === k))))).values ?? {} : {};
		} catch {
			return {};
		}
	});
	const build = $derived(hash ? buildOf(hash, Object.fromEntries(Object.entries(given).filter(([k]) => params.some((p) => p.id === k)))) : null);

	/** the build shown, ready for the stage ($lib/assets/hero.js) */
	let hero = $state.raw(null);
	let building = $state(false);
	let error = $state('');
	let lost = $state(false);
	/** @type {[number, number, number] | null} */
	let size = $state(null);

	// the stage's modes, its moves and the one playing, its solver's sliders and reading, its labels and scale
	let modes = $state({ run: true, break: false, explode: false, cut: false, xray: false, labels: false, slow: false });
	let moving = $state('run');
	let sliders = $state({});
	let reading = $state.raw({ value: 0, state: '', sub: '', bad: false });
	let tags = $state.raw([]);
	let scale = $state.raw([0, '']);
	let builtNow = $state(1);
	/** whether its build is running in the box yet (a ticking one starts a moment after it shows) */
	let running = $state(false);
	/** its note in full (a long one is cut to a few lines, so the card covers less of it) */
	let more = $state(false);
	/** a plant's height above its soil and its roots' depth below (m), when it stands in soil */
	let rise = $state.raw(null);
	/** a staged asset (a plant) growing: each stage built in turn, held a moment once shown */
	let growing = $state(false);
	/** a rig drawn apart by its own pose (the LifeTrac's `exploded`), and what it did before */
	let drawnApart = $state(false);
	let beforeApart = null;
	/** its controls a hand moves, each one's value */
	let controlValues = $state({});
	/** a part picked (by its id), and whether it is shown alone */
	let picked = $state(null);
	let alone = $state(false);
	/** an actor: what it does (a clip played or a pose held), the joints turned by hand, the joint chosen */
	let doing = $state(null);
	let edits = $state({});
	let joint = $state('');
	let copied = $state(false);
	let roofOff = $state(false);
	let walking = $state(false);
	/** a world in disguise shown (a dome, built by its own world's code, not in the box): its handle, what its build is doing, how far it is, and whether it stands */
	let world = $state.raw(null);
	let step = $state('');
	let steps = $state(0);
	let worldUp = $state(false);
	/** whether what is chosen is a world in disguise */
	const worldly = $derived(!!inside?.is(chosen));

	const catalog = $derived(hero?.catalog?.parts?.length ? hero.catalog : null);
	const card = $derived(catalog && picked ? (catalog.parts.find((p) => p.id === picked) ?? null) : null);
	const lab = $derived(hero?.lab ?? null);
	const clips = $derived(hero?.clips ?? null);
	const holding = $derived(doing?.kind === 'pose' && clips?.held ? { ...clips.held[doing.name], ...edits } : null);
	/** the pose a rig is drawn apart in, which its Explode view holds (a sealed asset draws apart on the stage) */
	const rigApart = $derived(!hero?.explodes && clips?.poses?.includes('exploded') ? 'exploded' : null);
	/** the parameter it grows by, stage by stage (a plant's stage), if it has one */
	const staged = $derived(params.find((p) => p.id === 'stage' && tabbed(p)) ?? null);
	/** the moves it plays: Grow (stage after stage), Run, its own, an actor's clips, Assemble (its build or pitch) */
	const moves = $derived.by(() => {
		if (!hero) return [];
		const out = [];
		if (staged) out.push(['grow', growing ? 'Growing…' : 'Grow']);
		if (lab) out.push(['run', 'Run'], ...Object.entries(lab.moves ?? {}).map(([k, m]) => [k, m.label]));
		// a rig's own assemble is its Assemble; its explode is the Explode view, not a move
		for (const c of clips?.clips ?? []) if (!(rigApart && c === 'explode')) out.push([`clip:${c}`, c === 'assemble' ? 'Assemble' : c]);
		if (hero.buildBy) out.push(['assemble', hero.buildBy.id === 'pitch' ? 'Pitch it' : catalog?.play && catalog.play !== 'Build it' ? catalog.play : 'Assemble']);
		if (!lab && hero.buildBy && !clips?.clips?.length) out.unshift(['run', 'Still']);
		return out;
	});
	/** the views that apply to it */
	const views = $derived(hero ? VIEWS.filter(([k]) => (k === 'explode' ? hero.explodes || !!rigApart : k === 'xray' ? hero.shells.length > 0 : k === 'labels' ? hero.labels.length > 0 : k === 'slow' ? !!hero.view.ticks : true)) : []);
	/**
	 * Its parts tree: its own parts by assembly, then each whole asset it carries (a Power Cube on a pickup's bed, its
	 * `ref`) as one entry of its own, that asset's parts by its assemblies under it, linked to its own page.
	 */
	const tree = $derived.by(() => {
		if (!catalog) return { own: [], units: [] };
		const mine = (p) => !p.ref || p.ref === hero?.card?.ref;
		const byAssembly = (list) => catalog.assemblies.map((a) => ({ a, parts: list.filter((p) => p.assembly === a.id) })).filter((x) => x.parts.length);
		const carried = new Map();
		for (const p of catalog.parts) if (!mine(p)) carried.set(p.ref, [...(carried.get(p.ref) ?? []), p]);
		return {
			own: byAssembly(catalog.parts.filter(mine)),
			units: [...carried].map(([ref, parts]) => {
				const groups = byAssembly(parts);
				// its name as its host's catalog writes it before its assemblies' ("Power Cube: Frame"), else its ref
				const heads = groups.map((g) => (g.a.label.includes(':') ? g.a.label.split(':')[0].trim() : null));
				const name = heads.length && heads.every((h) => h && h === heads[0]) ? heads[0] : ref;
				return { ref, name, parts, groups, href: hrefOf(ref) };
			})
		};
	});
	const stageOf = $derived(chosen.stages && Number.isFinite(values.stage) ? chosen.stages[Math.min(chosen.stages.length - 1, Math.round(values.stage))] : null);

	/** a whole asset's own page, by its ref (`machines/powercube@3`) */
	function hrefOf(ref) {
		try {
			const h = hashOf(ref.split('?')[0]);
			return h ? pageOf(base, h, parseRef(ref).params) : null;
		} catch {
			return null;
		}
	}

	/** the part of the canvas no card covers, so the labels' text stays in view */
	function safeArea(box) {
		const b = box.getBoundingClientRect();
		const safe = { left: 0, right: b.width, top: 0, bottom: b.height };
		for (const el of (box.closest('.view') ?? box.parentElement)?.querySelectorAll('.card') ?? []) {
			const r = el.getBoundingClientRect();
			if (!r.width || !r.height) continue;
			const l = r.left - b.left, t = r.top - b.top;
			if (r.width > b.width * 0.6) safe.top = Math.max(safe.top, t + r.height);
			else if (l > b.width / 2) safe.right = Math.min(safe.right, l);
			else if (t > b.height / 2) safe.bottom = Math.min(safe.bottom, t);
		}
		return safe;
	}

	let stage = null;
	let show = null;
	let raiseWorld = null;
	let lookAt = null;
	let walkIn = null;
	let walkOut = null;
	let stick = null;
	let dispose = null;

	onMount(async () => {
		const THREE = await import('three');
		const { createStageRenderer } = await import('$lib/render/stage.js');
		const { Stage } = await import('./stage.js');
		const { createWalker, PACE } = await import('$lib/sandbox-kit/walker.js');
		const box = canvasBox;
		const low = lowPower();
		// the stage renderer ($lib/render/stage.js): the canvas in the box, the camera (its field of view widened on an
		// upright canvas, $lib/app/turntable.js), the controls; the canvas kept to the box, and the studio with it
		const view = createStageRenderer(box, { pixelRatio: topPixelRatio(low), shadows: 'soft', onLost: () => (lost = true), fov: 40, turntable: true, fit, onResize: (w, h) => stage.resize(w, h) });
		const { renderer, camera, controls } = view;
		stage = new Stage(renderer, camera, { low });
		const earth = soil ? soilOf() : null;
		// the Buildings' round ground, laid under each build as it is shown
		const grounds = round ? await import('$lib/buildings/ground.js') : null;
		/** @type {{ obj: any, r: number } | null} */
		let ground = null;
		// for a test in a browser to read what is shown
		window.__viewer = { stage, get hero() { return hero; }, get building() { return building; }, get error() { return error; }, get world() { return world; } };
		if (earth) stage.scene.add(earth.group);

		let aim = null;
		lookAt = (id) => (aim = stage.partCentre(id));
		/** @type {{ x: number, y: number } | null} */
		let down = null;
		renderer.domElement.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
		renderer.domElement.addEventListener('pointerup', (e) => {
			// a tap, not a drag round it, picks the part under it (or, on nothing, lets go)
			if (!down || walking || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || !catalog) return;
			down = null;
			const r = renderer.domElement.getBoundingClientRect();
			const part = stage.pick(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
			picked = part;
			if (part) lookAt(part);
			else alone = false;
		});

		/** the build shown: let go of, on the stage and on the graphics card */
		const letGo = (h) => {
			if (!h) return;
			h.dispose();
			if (stage.root === h.root) stage.clear();
			disposeObject(h.root, { textures: false });
		};
		let asked = 0;
		let shownHash = null;
		let framed = null;
		// how far the camera has backed off for an asset drawn apart (1: not at all), and how far it wants to
		const apart = { now: 1, want: 1, since: 0 };
		const spread = new THREE.Box3(), spreadSize = new THREE.Vector3(), bonePoint = new THREE.Vector3();
		/** how far it spreads now: its meshes, and a rig's bones where they stand (a skin's own bounds stay as bound) */
		const spreadOf = (root) => {
			spread.setFromObject(root);
			root.traverse((o) => o.isBone && spread.expandByPoint(bonePoint.setFromMatrixPosition(o.matrixWorld)));
			return spread.getSize(spreadSize).length();
		};
		/** the camera gliding to a new framing (a plant grown a stage), from where it was */
		let glide = null;
		/**
		 * The camera on the asset shown, as built: aimed a little under its middle, clear of the readout at the foot;
		 * there at once, or `smooth`ly from where it is.
		 */
		const frame = (smooth = false) => {
			if (!framed) return;
			Object.assign(apart, { now: 1, want: 1, since: 0 });
			const s = framed.size;
			const reach = Math.max(s.x, s.y, s.z, 0.01) * 1.15;
			const at = framed.centre.clone().add(new THREE.Vector3(0, -0.12 * s.y, 0));
			const to = new THREE.Vector3(at.x + reach * 1.5, at.y + reach * 0.7, at.z + reach * 1.9);
			aim = null;
			glide = smooth ? { t: 0, from: [camera.position.clone(), controls.target.clone()], to: [to, at] } : null;
			if (!smooth) {
				controls.target.copy(at);
				camera.position.copy(to);
			}
			// while it glides, near and far hold both framings
			camera.near = smooth ? Math.min(camera.near, reach / 300) : reach / 300;
			camera.far = smooth ? Math.max(camera.far, reach * 80) : reach * 80;
			camera.updateProjectionMatrix();
		};
		/** the round ground under a build of this measure (the Buildings'), as large as it needs, the stage's floor under it @param {THREE.Box3} b */
		const layGround = (b) => {
			if (ground) {
				stage.scene.remove(ground.obj);
				disposeObject(ground.obj, { textures: false });
				ground = null;
			}
			if (!grounds) return;
			const s = b.getSize(new THREE.Vector3()), mid = b.getCenter(new THREE.Vector3());
			const r = grounds.groundRadius(Math.hypot(s.x, s.z) / 2);
			const obj = grounds.roundGround(r);
			obj.position.set(mid.x, 0, mid.z);
			// the stage keeps its studio things out of a part's pick, its x-ray and a walk's floors
			obj.traverse((o) => (o.userData.studio = true));
			stage.scene.add(obj);
			ground = { obj, r };
		};
		/** the world in disguise shown, let go of (another is picked, or a build) */
		const dropWorld = () => {
			if (!world) return;
			walkOut?.();
			world.dispose();
			world = null;
			worldUp = false;
			step = '';
		};
		/** when the world shown was raised, for its clock */
		let raisedAt = 0;
		/**
		 * An item that is a world in disguise (a dome), raised by its own world's code on this canvas: framed where it will
		 * stand at once, its steps told while it is built, measured and walkable once it stands.
		 */
		raiseWorld = (item, v) => {
			const mine = ++asked;
			building = true;
			error = '';
			walkOut?.();
			dropWorld();
			// the build shown before goes: the canvas draws the world now
			letGo(hero);
			hero = null;
			stage.clear();
			picked = null;
			size = null;
			steps = 0;
			step = 'Opening the doors';
			const w = inside.raise(item, v, {
				renderer,
				camera,
				box,
				low,
				onStep: (label, done) => {
					if (mine !== asked) return;
					step = label;
					steps = done;
				},
				onGhost: (b) => {
					if (mine !== asked) return;
					framed = { centre: b.getCenter(new THREE.Vector3()), size: b.getSize(new THREE.Vector3()) };
					frame();
				}
			});
			world = w;
			raisedAt = performance.now();
			w.ready.then(
				(got) => {
					if (mine !== asked || world !== w) return;
					building = false;
					step = '';
					if (!got) return void (error = `The ${item.label} could not be built`);
					const s = got.measured.getSize(new THREE.Vector3());
					size = [s.x, s.y, s.z];
					framed = { centre: got.measured.getCenter(new THREE.Vector3()), size: s };
					frame();
					worldUp = true;
				},
				(e) => {
					if (mine !== asked) return;
					building = false;
					error = String(e?.message ?? e);
				}
			);
		};
		show = async (name, reframe) => {
			const mine = ++asked;
			building = true;
			error = '';
			dropWorld();
			try {
				const got = await loadAsset(name);
				if (mine !== asked) return void letGo(heroOf(got));
				const c = canonical(name);
				const textValues = c.values && Object.fromEntries(Object.entries(c.values).map(([k, v]) => [k, String(v)]));
				const code = await recipeAt(c.hash).catch(() => null);
				forStage(got.obj);
				const h = heroOf(got, { start: code ? runner(liveBoxOf(), code, textValues) : undefined });
				if (mine !== asked) return void letGo(h);
				walkOut?.();
				const was = hero;
				const bounds = new THREE.Box3().setFromObject(got.obj);
				// a plant stands in its soil; its fruit, shown on its own, on the floor
				const soiled = earth && !(c.values?.fruit >= 1);
				// a building on the round ground, the stage's floor a hair under it
				const { centre, size: s } = stage.show(got.obj, { asset: h, ground: soiled ? -earth.fit(bounds) : grounds ? Math.min(bounds.min.y, 0) - 0.01 : undefined });
				if (grounds) layGround(bounds);
				await stage.compile();
				if (mine !== asked) {
					stage.clear();
					return void letGo(h);
				}
				letGo(was);
				hero = h;
				size = [s.x, s.y, s.z];
				if (earth) earth.group.visible = soiled;
				rise = soiled ? [Math.max(0, bounds.max.y), Math.max(0, -bounds.min.y)] : null;
				picked = null;
				alone = false;
				roofOff = false;
				drawnApart = false;
				running = !!h.live;
				if (shownHash !== c.hash) more = false;
				controlValues = Object.fromEntries(h.controls.map((x) => [x.id, h.value(x.id)]));
				doing = h.doing;
				edits = {};
				joint = h.clips?.bones?.includes('head') ? 'head' : (h.clips?.bones?.[0] ?? '');
				readValues();
				readModes();
				// framed on it as built when it is a new asset; the same one built anew keeps the camera where it is,
				// unless it grew or shrank by much (a plant a stage on, its fruit alone): then the camera glides there
				const before = framed?.size, big = (v) => Math.max(v.x, v.y, v.z, 1e-6);
				const grew = before ? big(s) / big(before) : 1;
				framed = { centre, size: s };
				if (reframe || shownHash !== c.hash) frame();
				else if (grew > 1.25 || grew < 0.8) frame(true);
				shownHash = c.hash;
			} catch (e) {
				if (mine === asked) error = String(e?.message ?? e);
			}
			if (mine === asked) building = false;
		};

		// walked in: the sandboxes' walker, on the floors and between the walls its own shape has (a world in disguise: its
		// own floors and walls), on the round ground never off its edge; Escape walks out
		let walker = null;
		const lamps = [];
		walkIn = () => {
			const w = world ? world.walk : hero?.view.walk;
			if (!w || walker) return;
			const floors = world ? world.walk : walkOf(hero.root);
			const g = !world && ground ? ground : null;
			controls.enabled = false;
			walker = createWalker(camera, renderer.domElement, {
				x: w.x,
				z: w.z,
				yaw: w.yaw,
				pitch: -0.05,
				walk: PACE.walk,
				hurry: PACE.hurry,
				canStand: g ? (x, z, here, at, from) => Math.hypot(x - g.obj.position.x, z - g.obj.position.z) < g.r - 0.4 && floors.canStand(x, z, here, at, from) : floors.canStand,
				floorAt: floors.floorAt,
				onKey: (k, isDown) => {
					if (k !== 'escape' || !isDown) return false;
					walkOut?.();
					return true;
				}
			});
			for (const [x, y, z] of w.lamps ?? []) {
				const lamp = new THREE.PointLight('#fff1dc', 2.2, 6, 2);
				lamp.position.set(x, y, z);
				(world ? world.scene : stage.scene).add(lamp);
				lamps.push(lamp);
			}
			camera.userData.fov = 0; // a walk sees as a walker does, upright or not
			camera.fov = 70;
			camera.near = 0.05;
			camera.far = Math.max(400, (ground?.r ?? 0) * 4);
			camera.updateProjectionMatrix();
			stick = { move: (x, y, h) => walker?.move(x, y, h), look: (dx, dy) => walker?.look(dx, dy) };
			walking = true;
		};
		walkOut = () => {
			if (!walker) return;
			walker.dispose();
			walker = null;
			stick = null;
			for (const lamp of lamps.splice(0)) lamp.removeFromParent();
			controls.enabled = true;
			camera.userData.fov = 40;
			resize();
			walking = false;
			frame();
		};

		const resize = view.resize;
		resize();
		const adapt = adaptiveResolution(renderer, { top: topPixelRatio(low), hold: () => building, onChange: resize });
		shown = build ?? '';
		if (build) show(build, true);
		else if (worldly) {
			shownWorld = `${chosen.id}@${version}`;
			raiseWorld(chosen, version);
		}
		let raf = 0, last = performance.now(), slow = 0, grownAt = 0;
		const tick = () => {
			// the stage eases by the wall clock; so do the camera's own eases, however slow the frames
			const now = performance.now(), wall = Math.min(1, (now - last) / 1000), dt = Math.min(0.05, wall);
			last = now;
			adapt(now);
			stage.update(dt);
			world?.frame((now - raisedAt) / 1000);
			if (walker) walker.update(dt);
			else {
				if (glide) {
					const k = Math.min(1, (glide.t += wall) / 0.9), e = k * k * (3 - 2 * k);
					camera.position.lerpVectors(glide.from[0], glide.to[0], e);
					controls.target.lerpVectors(glide.from[1], glide.to[1], e);
					if (k >= 1) glide = null;
				}
				if (aim) {
					controls.target.lerp(aim, 0.12);
					if (controls.target.distanceTo(aim) < 0.002) aim = null;
				}
				// drawn apart, it backs off so every part stays in view, and comes back as they close
				const spreadOut = stage.state.explode > 0.001 || drawnApart;
				if (hero && framed && (spreadOut || apart.now !== 1)) {
					if ((apart.since += wall) > 0.25) {
						apart.since = 0;
						apart.want = spreadOut ? Math.max(1, spreadOf(hero.root) / Math.max(1e-3, framed.size.length())) : 1;
					}
					const next = apart.now + (apart.want - apart.now) * Math.min(1, wall * 3);
					camera.position.sub(controls.target).multiplyScalar(next / apart.now).add(controls.target);
					apart.now = apart.want === 1 && Math.abs(next - 1) < 1e-3 ? 1 : next;
				}
				controls.update();
			}
			if (world) world.draw();
			else stage.render();
			if (stage.state.labels > 0.01 || tags.length) tags = stage.labels(box.clientWidth, box.clientHeight, safeArea(box));
			if ((slow += wall) > 0.12 && (hero || world)) {
				slow = 0;
				scale = stage.scaleBar(box.clientHeight, controls.target);
				if (hero) {
					if (lab) reading = { ...lab.read };
					builtNow = stage.builtNow();
					running = !!hero.live;
					// growing: the next stage once this one has stood a moment
					if (building) grownAt = now;
					else if (growing && now - grownAt > 1400) {
						const at = Math.round(values.stage);
						if (!staged || at >= staged.max) growing = false;
						else setParam('stage', at + 1);
						grownAt = now;
					}
					// the sliders a move sets follow it
					if (stage.move !== 'run') readValues();
				}
			}
			raf = requestAnimationFrame(tick);
		};
		tick();
		dispose = () => {
			cancelAnimationFrame(raf);
			walkOut?.();
			dropWorld();
			letGo(hero);
			hero = null;
			earth?.dispose();
			stage.dispose();
			view.dispose();
			boxOf().stop('the viewer was left');
			liveBoxOf().stop('the viewer was left');
		};
	});
	onDestroy(() => dispose?.());

	// a new build asked for whenever what is chosen or what it is built with changes; a world in disguise raised
	// whenever it or its version is chosen
	let shown = '';
	let shownWorld = '';
	$effect(() => {
		const b = build;
		if (!b || b === shown || !show) return;
		shown = b;
		shownWorld = '';
		untrack(() => show(b));
	});
	$effect(() => {
		const w = worldly ? `${chosen.id}@${version}` : '';
		if (!w || w === shownWorld || !raiseWorld) return;
		shownWorld = w;
		shown = '';
		untrack(() => raiseWorld(chosen, version));
	});
	$effect(() => {
		void [picked, alone, hero];
		untrack(() => stage?.setPick(picked, alone));
	});

	const readModes = () => {
		if (!stage) return;
		modes = Object.fromEntries(['run', 'break', ...VIEWS.map(([k]) => k)].map((k) => [k, stage.on(k)]));
		moving = stage.move === 'run' && doing?.kind === 'clip' ? `clip:${doing.name}` : stage.move;
	};
	const readValues = () => (sliders = Object.fromEntries(Object.entries(lab?.controls ?? {}).map(([k, v]) => [k, v.value])));

	/** @param {any} item */
	const pick = (item) => {
		growing = false;
		chosen = item;
		version = item.version;
		variantId = null;
		given = {};
	};
	const pickVersion = (v) => {
		version = v;
		variantId = null;
	};
	const playMove = (k) => {
		if (!stage) return;
		if (k === 'grow') return grow();
		if (k.startsWith('clip:')) {
			drawnApart = false;
			hero?.play(k.slice(5));
			doing = hero?.doing;
			stage.play('run');
		} else stage.play(k);
		readValues();
		readModes();
	};
	const hold = (pose) => {
		drawnApart = false;
		edits = {};
		hero?.hold(pose, {});
		doing = hero?.doing;
		readModes();
	};
	const setMode = (k) => {
		if (k === 'explode' && rigApart) return void apartRig();
		stage?.toggle(k);
		readModes();
	};
	/** a rig drawn apart in its own pose, or back to what it was doing */
	const apartRig = () => {
		if (!hero) return;
		drawnApart = !drawnApart;
		if (drawnApart) {
			beforeApart = { doing: hero.doing, edits };
			hero.hold(rigApart, {});
		} else if (beforeApart?.doing?.kind === 'pose') hero.hold(beforeApart.doing.name, beforeApart.edits ?? {});
		else hero.play(beforeApart?.doing?.name ?? clips?.first ?? clips?.clips?.[0]);
		doing = hero.doing;
		readModes();
	};
	const slide = (k, v) => {
		if (stage?.drives(k)) playMove('run');
		if (lab) lab.controls[k].value = v;
		sliders = { ...sliders, [k]: v };
	};
	const setControl = (id, v) => {
		hero?.set(id, v);
		controlValues = { ...controlValues, [id]: v };
	};
	const scrub = (u) => {
		stage?.scrubTo(u >= 1 ? null : u);
		builtNow = u;
		readModes();
	};
	const choose = (id) => {
		picked = picked === id ? null : id;
		if (picked) lookAt?.(picked);
	};
	const setParam = (id, v) => (given = { ...given, [id]: String(v) });
	/** grown from its first stage (or on from where it stands) to its last, or stopped */
	const grow = () => {
		if (growing || !staged) return void (growing = false);
		if (Math.round(values.stage) >= staged.max) setParam('stage', staged.min);
		growing = true;
	};
	/** a stage on or back (← →), grown (space): the keys a plant's page has always had */
	const key = (e) => {
		if (!staged || walking || e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
		const at = Math.round(values.stage);
		if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
			growing = false;
			setParam('stage', Math.max(staged.min, Math.min(staged.max, at + (e.key === 'ArrowRight' ? 1 : -1))));
		} else if (e.key === ' ' && !e.target?.closest?.('button')) grow();
		else return;
		e.preventDefault();
	};
	const freshSeed = () => setParam('seed', Math.random().toString(36).slice(2, 7));
	const toggleRoof = () => {
		if (!hero) return;
		roofOff = !roofOff;
		const nodes = walk(hero.root);
		for (const n of hero.view.roof ?? []) nodes[n].visible = !roofOff;
	};
	const turnOf = (bone) => edits[bone] ?? holding?.[bone]?.slice(0, 3) ?? [0, 0, 0];
	const turn = (axis, value) => {
		const t = [...turnOf(joint)];
		t[axis] = value;
		edits = { ...edits, [joint]: t };
		hero?.hold(doing.name, edits);
	};
	const resetJoints = () => {
		edits = {};
		hero?.hold(doing.name, {});
	};
	const copy = async () => {
		if (!holding) return;
		const rounded = Object.fromEntries(Object.entries(holding).map(([k, v]) => [k, v.map((x) => Math.round(x * 1000) / 1000)]));
		await navigator.clipboard.writeText(JSON.stringify(rounded));
		copied = true;
		setTimeout(() => (copied = false), 1500);
	};
	const num = (v, digits = 0) => v.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
	const measure = (v) => (v < 0.01 ? `${Math.round(v * 10000) / 10} mm` : v < 1 ? `${Math.round(v * 1000) / 10} cm` : `${Math.round(v * 100) / 100} m`);
</script>

<svelte:window onkeydown={key} />

<svelte:head>
	<title>{title} · maiaCITY</title>
</svelte:head>

<Turntable
	{name}
	bind:canvas={canvasBox}
	bind:stage={viewBox}
	full={walking && !inPlace}
	picks={{ title, lede, items, chosen, where, onpick: pick, group: heading, version, onversion: pickVersion }}
>
	{#snippet bar()}
		{#if world}
			{#if worldUp && world.walk}
				<div class="chips">
					<button class="chip dark" onclick={() => (walking ? walkOut?.() : walkIn?.())}>{walking ? 'Step outside' : 'Step inside'}</button>
				</div>
			{/if}
		{:else if hero}
			<div class="chips">
				{#each params.filter(tabbed) as p (p.id)}
					<span class="label">{p.label}</span>
					{#each p.names as n, k (k)}
						<button class="chip" class:on={Math.round(values[p.id]) === p.min + k} onclick={() => ((growing = false), setParam(p.id, p.min + k))}>{n}</button>
					{/each}
				{/each}
				{#if moves.length}
					<span class="label">Moves</span>
					{#each moves as [k, label] (k)}
						<button class="chip" class:on={k === 'grow' ? growing : moving === k} title={lab?.moves?.[k]?.note} onclick={() => playMove(k)}>{label}</button>
					{/each}
				{/if}
				{#if clips?.poses?.length}
					<span class="label">Poses</span>
					{#each clips.poses.filter((x) => x !== rigApart) as p (p)}
						<button class="chip" class:on={doing?.kind === 'pose' && doing.name === p} onclick={() => hold(p)}>{p}</button>
					{/each}
				{/if}
				{#if lab?.breakIt}<button class="chip break" class:on={modes.break} onclick={() => setMode('break')}>{modes.break ? 'Take it back' : lab.breakIt.label}</button>{/if}
				{#if hero.view.ticks || hero.buildBy}<button class="chip" class:on={!modes.run} onclick={() => setMode('run')}>{modes.run ? 'Pause' : 'Play'}</button>{/if}
				<span class="label">Views</span>
				{#each views as [k, label] (k)}
					<button class="chip" class:on={k === 'explode' && rigApart ? drawnApart : modes[k]} onclick={() => setMode(k)}>{label}</button>
				{/each}
				{#if hero.view.roof && !walking}<button class="chip" class:on={roofOff} onclick={toggleRoof}>{roofOff ? 'Put the roof on' : 'Lift the roof'}</button>{/if}
				{#if hero.view.walk}<button class="chip dark" onclick={() => (walking ? walkOut?.() : walkIn?.())}>{walking ? 'Step outside' : 'Step inside'}</button>{/if}
			</div>
		{/if}
	{/snippet}
	{#snippet panel()}
		{#if variants.length > 1}
			<nav class="chips variants" aria-label="{chosen.label}: variants">
				<span class="label">{chosen.label}</span>
				{#each variants as v (v.id)}
					<button class="chip" class:on={variant?.id === v.id} aria-current={variant?.id === v.id ? 'true' : undefined} onclick={() => (variantId = v.id)}>{v.label}</button>
				{/each}
			</nav>
		{/if}
		{#if params.some((p) => !tabbed(p))}
			<div class="built">
				<span class="label">Built with</span>
				{#each params.filter((p) => !tabbed(p)) as p (p.id)}
					{#if p.type === 'string'}
						<label class="param">
							<span>{p.label}</span>
							<input value={values[p.id] ?? p.value} maxlength={p.maxLength ?? 80} onchange={(e) => setParam(p.id, e.currentTarget.value.trim() || p.value)} />
							{#if p.id === 'seed'}<button class="chip" onclick={freshSeed}>New seed</button>{/if}
						</label>
					{:else}
						<label class="slider">
							<span>{p.label}</span>
							<output>{values[p.id]}</output>
							<input type="range" min={p.min} max={p.max} step={p.step ?? (p.type === 'integer' ? 1 : 'any')} value={values[p.id] ?? p.value} onchange={(e) => setParam(p.id, e.currentTarget.value)} />
						</label>
					{/if}
				{/each}
			</div>
		{/if}
		{#if hero?.buildBy || hero?.controls.length}
			<div class="lab">
				{#if hero.buildBy}
					<label class="slider">
						<span>{hero.buildBy.label}</span>
						<output>{Math.round(builtNow * 100)} %</output>
						<input type="range" min="0" max="1" step="0.001" value={builtNow} oninput={(e) => scrub(+e.currentTarget.value)} />
					</label>
				{/if}
				{#each hero.controls as c (c.id)}
					{#if c.choice}
						<label class="check"><input type="checkbox" checked={controlValues[c.id] >= 0.5} onchange={(e) => setControl(c.id, e.currentTarget.checked ? c.to : c.from)} /> {c.label}</label>
					{:else}
						<label class="slider">
							<span>{c.label}</span>
							<output>{Math.round(((controlValues[c.id] - c.from) / (c.to - c.from)) * 100)} %</output>
							<input type="range" min={Math.min(c.from, c.to)} max={Math.max(c.from, c.to)} step="any" value={controlValues[c.id]} oninput={(e) => setControl(c.id, +e.currentTarget.value)} />
						</label>
					{/if}
				{/each}
			</div>
		{/if}
		{#if catalog}
			<div class="parts">
				<div class="row head">
					<span class="label">{catalog.parts.length} parts</span>
					<button class="chip" class:on={alone} disabled={!picked} onclick={() => (alone = !alone)}>Alone</button>
				</div>
				{#each tree.own as t (t.a.id)}
					<details open={!!picked && t.parts.some((p) => p.id === picked)}>
						<summary><b>{t.a.label}</b> <small>{t.parts.length}</small></summary>
						{#if t.a.note}<p class="note">{t.a.note}</p>{/if}
						<ul>
							{#each t.parts as p (p.id)}
								<li><button class:on={picked === p.id} onclick={() => choose(p.id)}>{p.label}{#if p.count && p.count > 1}<small> ×{p.count}</small>{/if}{#if p.moves}<i title="moves">↻</i>{/if}</button></li>
							{/each}
						</ul>
					</details>
				{/each}
				{#each tree.units as u (u.ref)}
					<details class="unit" open={!!picked && u.parts.some((p) => p.id === picked)}>
						<summary><b>{u.name}</b> <small>{u.parts.length}</small>{#if u.href}<a href={u.href} title="Its own page: {u.ref}" onclick={(e) => e.stopPropagation()}>Open ↗</a>{/if}</summary>
						<p class="note">A whole asset of its own ({u.ref}), carried here as one part</p>
						{#each u.groups as t (t.a.id)}
							<span class="sub">{t.a.label.replace(/^[^:]*:\s*/, '')}</span>
							<ul>
								{#each t.parts as p (p.id)}
									<li><button class:on={picked === p.id} onclick={() => choose(p.id)}>{p.label}{#if p.count && p.count > 1}<small> ×{p.count}</small>{/if}{#if p.moves}<i title="moves">↻</i>{/if}</button></li>
								{/each}
							</ul>
						{/each}
					</details>
				{/each}
				{#if catalog.sources?.length}
					<details>
						<summary><b>Sources</b> <small>{catalog.sources.length}</small></summary>
						<ul class="sources">
							{#each catalog.sources as s (s.url)}<li><a href={s.url} target="_blank" rel="noreferrer">{s.label} ↗</a></li>{/each}
						</ul>
					</details>
				{/if}
			</div>
		{/if}
		{#if lab}
			<div class="lab">
				{#each Object.entries(lab.controls) as [k, c] (k)}
					<label class="slider">
						<span>{c.label}</span>
						<output>{num(sliders[k] ?? c.value, c.digits ?? 0)} {c.unit ?? ''}</output>
						<input type="range" min={c.min} max={c.max} step={c.step ?? 'any'} value={sliders[k] ?? c.value} oninput={(e) => slide(k, +e.currentTarget.value)} />
						{#if c.ends}<small><span>{c.ends[0]}</span><span>{c.ends[1]}</span></small>{/if}
					</label>
				{/each}
				{#if lab.how}
					<details class="how">
						<summary><b>How it is computed</b></summary>
						<p>{lab.how.text}</p>
						{#each lab.how.eqs ?? [] as q (q)}<code>{q}</code>{/each}
					</details>
				{/if}
			</div>
		{/if}
		{#if holding && clips?.bones?.length}
			<div class="joints">
				<label>
					<span>Joint</span>
					<select bind:value={joint}>
						{#each clips.bones as b (b)}<option value={b}>{b}</option>{/each}
					</select>
				</label>
				{#each ['x', 'y', 'z'] as axis, i (axis)}
					<label>
						<span>{axis}</span>
						<input type="range" min={-Math.PI} max={Math.PI} step="0.01" value={turnOf(joint)[i]} oninput={(e) => turn(i, +e.currentTarget.value)} />
						<output>{Math.round((turnOf(joint)[i] * 180) / Math.PI)}°</output>
					</label>
				{/each}
				<div class="row">
					<button class="chip" onclick={resetJoints}>Reset</button>
					<button class="chip" onclick={copy}>{copied ? 'Copied' : 'Copy pose'}</button>
				</div>
			</div>
		{/if}
	{/snippet}
	{#snippet readout()}
		{#if card && catalog}
			{@const a = catalog.assemblies.find((x) => x.id === card.assembly)}
			<div class="part-card">
				<span class="label">{a?.label}{#if catalog.steps?.length}{` · step ${card.step} of ${catalog.steps.length}`}{/if}</span>
				<b>{card.label}{#if card.count && card.count > 1}<small> ×{card.count}</small>{/if}</b>
				{#if card.what}<p>{card.what}</p>{/if}
				{#if card.moves}<p><span class="tag">Moves</span> {card.moves}</p>{/if}
				{#if card.drive}<p><span class="tag">Driven by</span> {card.drive}</p>{/if}
				{#if card.ref}<p><span class="tag">Part of</span> {#if hrefOf(card.ref)}<a href={hrefOf(card.ref)}>{card.ref} ↗</a>{:else}{card.ref}{/if}</p>{/if}
				{#if card.specs?.length}
					<dl>
						{#each card.specs as [k, v] (k)}<dt>{k}</dt><dd>{v}</dd>{/each}
					</dl>
				{/if}
				{#if catalog.steps?.length}<small>Build step {card.step}: {catalog.steps[card.step - 1]}{#if card.source}{' · source: '}{#each catalog.sources.filter((s) => s.label === card.source) as s (s.url)}<a href={s.url} target="_blank" rel="noreferrer">{s.label} ↗</a>{:else}{card.source}{/each}{/if}</small>{/if}
				<div class="row">
					<button class="chip" onclick={() => lookAt?.(card.id)}>Look at it</button>
					<button class="chip" class:on={alone} onclick={() => (alone = !alone)}>Alone</button>
					<button class="chip" onclick={() => ((picked = null), (alone = false))}>Close</button>
				</div>
			</div>
		{:else}
			{#if lab}
				<div class="hero" class:bad={reading.bad}>
					<span class="label">{lab.hero.label}</span>
					<b>{num(reading.value, lab.hero.digits ?? 0)}<small> {lab.hero.unit}</small></b>
					<i class="meter"><i style:width="{Math.min(100, (Math.max(0, reading.value) / (lab.hero.max || 1)) * 100)}%"></i></i>
					<span class="state">{reading.state}</span>
					<small>{reading.sub}</small>
				</div>
			{/if}
			<b>{variants.length > 1 && variant ? `${chosen.label} · ${variant.label}` : chosen.label}{#if stageOf}{` · ${stageOf.name}`}{/if}{#if chosen.latin}{' '}<em>{chosen.latin}</em>{/if}</b>
			{@const note = hero?.view.note ?? stageOf?.note ?? (variants.length > 1 ? variant?.note : null) ?? atOrLatest(chosen.versions, version)?.note ?? chosen.note ?? ''}
			{#if note.length > 160}
				<button class="note" class:more title={more ? 'Show less' : 'Show all of it'} onclick={() => (more = !more)}>{note}</button>
			{:else}
				<small>{note}</small>
			{/if}
			{#if typeof chosen.size === 'string'}<span>{chosen.size}</span>{/if}
			{#if worldly}
				{#if building}<span class="soft">{step || 'Opening the doors'}…</span>{:else if size}<span>{measure(Math.max(size[0], size[2]))} across · {measure(size[1])} high</span>{/if}
			{:else if !hash}
				<span>Only its note was kept of this version, not how it was built.</span>
			{:else if size}
				<span>{#if rise}{measure(rise[0])} above the soil · {measure(rise[1])} below · {measure(Math.max(size[0], size[2]))} across{:else}{measure(Math.max(size[0], size[2]))} long · {measure(size[1])} high{/if}{#if catalog}{` · ${catalog.parts.length} parts`}{/if}{#if hero && !running && hero.view.ticks}{' · starting its moves…'}{/if}</span>
			{/if}
			{#if scale[0] > 0 && !walking}<span class="scale"><i style:width="{scale[0]}px"></i>{scale[1]}</span>{/if}
			{#if hash && build}<a class="own" href={pageOf(base, hash, values)}>Its own page ↗</a>{/if}
			{#if !walking}<small>Drag to turn round it · pinch or scroll to come closer{catalog ? ' · tap any part for its card' : holding ? ' · turn any joint by hand' : ''}</small>{/if}
		{/if}
	{/snippet}
	{#if tags.length}
		<svg class="tags" aria-hidden="true">
			{#each tags as t, i (i)}
				{@const left = t.side === 'left'}
				<g opacity={t.on}>
					<polyline points="{t.x},{t.y} {t.lx + (left ? 16 : -16)},{t.ly} {t.lx},{t.ly}" />
					<circle cx={t.x} cy={t.y} r="2.6" />
					<text x={t.lx + (left ? -5 : 5)} y={t.ly - 2} text-anchor={left ? 'end' : 'start'} class="name">{t.text}</text>
					{#if t.value}<text x={t.lx + (left ? -5 : 5)} y={t.ly + 12} text-anchor={left ? 'end' : 'start'} class="value">{t.value}</text>{/if}
				</g>
			{/each}
		</svg>
	{/if}
	{#if lost}
		<button class="canvas-note lost" onclick={() => location.reload()}>This device’s graphics ran out of room. Tap to load it again.</button>
	{:else if error}
		<div class="canvas-note error" role="alert">{error}</div>
	{:else if building && world}
		<div class="canvas-note" role="status">{step || 'Opening the doors'}… <i class="steps"><i style:width="{Math.min(100, (steps / STEPS) * 100)}%"></i></i></div>
	{:else if building}
		<div class="canvas-note" role="status">Building the {chosen.label}…</div>
	{/if}
	{#if walking}
		<TouchStick move={(x, y, h) => stick?.move(x, y, h)} look={(dx, dy) => stick?.look(dx, dy)} stage={viewBox} taps=".chips button" />
		<WalkHint keys="Drag to look · WASD to walk · Shift to hurry · Esc to step outside" />
	{/if}
</Turntable>

<style>
	.chip.break.on {
		background: #b3261e;
		border-color: #b3261e;
		color: #fff;
	}

	.lab,
	.built {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	.parts + .lab,
	.lab + .parts,
	.built + .lab,
	.built + .parts,
	.variants + .built,
	.variants + .lab,
	.variants + .parts,
	.variants + .joints {
		border-top: 1px solid rgb(0 0 0 / 0.08);
		margin-top: 0.6rem;
		padding-top: 0.8rem;
	}

	.param {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 0.4rem;
		align-items: center;
	}

	.param input {
		min-width: 0;
		font: inherit;
		padding: 0.2rem 0.4rem;
	}

	.check {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}

	.slider {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.15rem 0.5rem;
		align-items: baseline;
	}

	.slider input {
		grid-column: 1 / -1;
		width: 100%;
		accent-color: #ff7a1a;
	}

	.slider output {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.slider small {
		grid-column: 1 / -1;
		display: flex;
		justify-content: space-between;
		font-size: 0.7rem;
		opacity: 0.55;
	}

	button.note {
		all: unset;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		overflow: hidden;
		font-size: 0.78rem;
		line-height: 1.45;
		opacity: 0.7;
		cursor: pointer;
	}

	button.note.more {
		display: block;
	}

	.how summary {
		cursor: pointer;
	}

	.how p {
		margin: 0.35rem 0;
		font-size: 0.78rem;
		line-height: 1.45;
		opacity: 0.8;
	}

	.how code {
		display: block;
		font-size: 0.72rem;
		padding: 0.12rem 0;
		white-space: pre-wrap;
		opacity: 0.85;
	}

	.hero {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding-bottom: 0.5rem;
		margin-bottom: 0.3rem;
		border-bottom: 1px solid rgb(0 0 0 / 0.08);
	}

	.hero b {
		font-size: 2rem;
		line-height: 1.05;
		font-variant-numeric: tabular-nums;
	}

	.hero b small {
		font-size: 0.9rem;
		font-weight: 500;
		opacity: 0.6;
	}

	.hero .meter {
		display: block;
		height: 4px;
		border-radius: 2px;
		background: rgb(0 0 0 / 0.08);
		overflow: hidden;
	}

	.hero .meter i {
		display: block;
		height: 100%;
		background: #ff7a1a;
		transition: width 0.12s linear;
	}

	.hero .state {
		font-weight: 600;
	}

	.hero.bad .state,
	.hero.bad b {
		color: #b3261e;
	}

	.hero.bad .meter i {
		background: #b3261e;
	}

	.hero small {
		font-variant-numeric: tabular-nums;
		opacity: 0.7;
	}

	.scale {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.72rem;
		opacity: 0.7;
	}

	.scale i {
		display: block;
		height: 6px;
		border: 1.5px solid currentColor;
		border-top: 0;
	}

	.own {
		font-size: 0.78rem;
		color: inherit;
		opacity: 0.75;
	}

	/* while a build is made and its shaders compiled, or when it was refused, or the graphics card gave the canvas up */
	.canvas-note {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		padding: 9px 16px;
		border: 1px solid #d9d4ca;
		border-radius: 999px;
		background: #fbfaf7;
		box-shadow: 0 6px 20px rgb(31 42 35 / 0.12);
		color: #1f2a23;
		font: inherit;
		font-size: 14px;
		white-space: nowrap;
		pointer-events: none;
	}
	/* a world in disguise being built: how far it is */
	.canvas-note .steps {
		display: inline-block;
		width: 4rem;
		height: 3px;
		margin-left: 0.4rem;
		vertical-align: middle;
		border-radius: 2px;
		background: rgb(31 42 35 / 0.12);
		overflow: hidden;
	}
	.canvas-note .steps i {
		display: block;
		height: 100%;
		background: #c8744f;
		transition: width 400ms ease;
	}
	.soft {
		opacity: 0.7;
	}
	.canvas-note.lost,
	.canvas-note.error {
		white-space: normal;
		max-width: min(80%, 360px);
		text-align: center;
		border-radius: 14px;
	}
	.canvas-note.lost {
		pointer-events: auto;
		cursor: pointer;
	}
	.canvas-note.error {
		color: #b3261e;
	}

	.tags {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		overflow: visible;
	}

	.tags polyline {
		fill: none;
		stroke: #1f2a23;
		stroke-width: 1;
		opacity: 0.7;
	}

	.tags circle {
		fill: #ff7a1a;
		stroke: #fff;
		stroke-width: 1.2;
	}

	.tags text {
		font-size: 12px;
		fill: #1f2a23;
		paint-order: stroke;
		stroke: rgb(243 242 238 / 0.9);
		stroke-width: 3px;
	}

	.tags .name {
		font-weight: 600;
	}

	.tags .value {
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		opacity: 0.8;
	}

	.parts details {
		border-top: 1px solid rgb(0 0 0 / 0.08);
		padding: 0.3rem 0;
	}

	.parts summary {
		cursor: pointer;
		display: flex;
		justify-content: space-between;
		gap: 0.4rem;
	}

	.parts summary small,
	.parts li small {
		opacity: 0.55;
	}

	.parts .note {
		margin: 0.25rem 0 0.35rem;
		font-size: 0.75rem;
		opacity: 0.7;
	}

	.parts ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.parts li button {
		display: flex;
		width: 100%;
		gap: 0.3rem;
		align-items: baseline;
		text-align: left;
		padding: 0.18rem 0.4rem;
		border: 0;
		border-radius: 6px;
		background: none;
		font: inherit;
		color: inherit;
	}

	.parts li button:hover {
		background: rgb(0 0 0 / 0.05);
	}

	.parts li button.on {
		background: #ff7a1a;
		color: #fff;
	}

	/* a whole asset carried as a part: its own parts under it by its assemblies, its own page beside its name */
	.parts .unit summary a {
		margin-left: auto;
		font-size: 0.75rem;
		color: inherit;
		opacity: 0.7;
	}

	.parts .unit .sub {
		display: block;
		margin: 0.35rem 0 0.1rem;
		font-size: 0.7rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		opacity: 0.55;
	}

	.parts .sources a {
		display: block;
		padding: 0.3rem 0.4rem;
		font-size: 0.8rem;
		color: inherit;
	}

	.parts li i {
		margin-left: auto;
		font-style: normal;
		opacity: 0.45;
	}

	.parts .head {
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.3rem;
	}

	.parts .chip:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.part-card {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.part-card p {
		margin: 0;
		line-height: 1.4;
	}

	.part-card .tag {
		font-size: 0.68rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		opacity: 0.55;
	}

	.part-card dl {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.1rem 0.8rem;
		margin: 0.15rem 0;
		font-size: 0.8rem;
	}

	.part-card dt {
		opacity: 0.6;
	}

	.part-card dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
	}

	.part-card a {
		color: inherit;
	}

	.part-card .row {
		justify-content: flex-start;
		flex-wrap: wrap;
	}

	.joints {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.joints label {
		display: grid;
		grid-template-columns: 2.6rem minmax(0, 1fr) 2.6rem;
		align-items: center;
		gap: 0.4rem;
	}

	.joints label:first-child {
		grid-template-columns: 2.6rem minmax(0, 1fr);
	}

	.joints select,
	.joints input {
		width: 100%;
		min-width: 0;
	}

	.joints output {
		text-align: right;
		font-variant-numeric: tabular-nums;
		opacity: 0.7;
	}

	.row {
		display: flex;
		gap: 0.4rem;
		justify-content: flex-end;
	}
</style>

<!--
	A turntable of models (src/lib/models): the Things (/app/models/) and the Buildings (/app/buildings/) both show
	theirs with it, one at a time — drag to turn round it, scroll to come closer — on a grid of 10 cm squares, with its
	measure. A model that can be walked (`userData.walk`: the containers) is walked in first person, the sandboxes'
	walker; one with a roof (`userData.roof`) can have it lifted off to look in from above; a rigged machine
	(`userData.tick`: the excavators) plays its work. An item that is a dome (`dome`: the Buildings' tents and domes) is
	built alone, without the forest and land round it, as Sandbox 3's village builds its domes into its own world
	(mountInterior with a host, $lib/sandbox-2/interior), and stepped inside the same way. With `round` (the
	Buildings) every building stands on the same round ground ($lib/buildings/ground.js) instead of the square grid;
	with `enter` picking one steps inside it at once; with `inPlace` (the Buildings) it is walked where it stands, the
	list kept beside it, never full screen. A building being built says how far it is over the canvas. A model in its
	parts (`userData.catalog`: the bell tent, its fire place) has every part to pick, on it or from its list, each with
	its card, shown alone if asked (the rest a ghost round it), as the Machines (/app/machines/) have theirs; it is taken apart
	(`userData.explode`) and put up step by step (`userData.setPitch` or `setBuild`), played or scrubbed.
-->
<script>
	import { onDestroy, onMount, untrack } from 'svelte';
	import Turntable from '$lib/app/Turntable.svelte';
	import { fit } from '$lib/app/turntable.js';
	import TouchStick from '$lib/touch/TouchStick.svelte';
	import WalkHint from '$lib/sandbox-kit/WalkHint.svelte';
	import { atOrLatest } from '$lib/app/versions.js';
	import { WorldBar } from '$lib/sandbox-kit';
	import { roundGround, groundRadius } from '$lib/buildings/ground.js';
	import { wayBack } from '$lib/app/back.svelte';

	/** @typedef {import('$lib/models').Model} Model */
	/** @typedef {import('$lib/models').Variant} Variant */
	/** @typedef {import('$lib/buildings').Dome} Dome */

	/**
	 * @type {{ name: string, title: string, lede: string, items: (Model | Dome)[], group?: (item: any) => string, round?: boolean, enter?: boolean, inPlace?: boolean }}
	 */
	let { name, title, lede, items, group, round = false, enter = false, inPlace = false } = $props();
	/** @param {Model | Dome} m @returns {m is Dome} */
	const isDome = (m) => 'dome' in m;
	/** @param {Model | Dome} m */
	const latest = (m) => m.version;

	/** @type {HTMLDivElement | undefined} */
	let canvasBox = $state();
	/** @type {HTMLDivElement | undefined} */
	let viewBox = $state();
	/** the first of the list, shown first (the list is the page's, and stays) */
	const first = untrack(() => items[0]);
	/** @type {Model | Dome} */
	let chosen = $state(first);
	/** the version of it shown: its latest, or an older one picked from its history */
	let version = $state(latest(first));
	/** which of its variants is shown (a small or a big excavator), when it has them: they are its latest version's */
	/** @type {Variant | null} */
	let variant = $state((!isDome(first) && first.variants?.[0]) || null);
	const variants = $derived(!isDome(chosen) && version === chosen.version ? (chosen.variants ?? []) : []);
	/** stops a building being built (the way back from its loading screen), back to the list */
	/** @type {(() => void) | null} */
	let stopBuilding = null;
	$effect(() => {
		if (enter && !inPlace && building) return wayBack('Back to the list', () => stopBuilding?.());
	});
	// walking inside a model the walk has the whole screen, as a dome's does: the nav pill's way back walks out
	$effect(() => {
		if (walking) return wayBack('Back outside', () => walkOut?.());
	});
	/** a dome being built: what it is doing now (null once it stands) */
	/** @type {string | null} */
	let building = $state(null);
	/** how many of its steps are done, for the loading screen's bar */
	let built = $state(0);
	const STEPS = 5;
	/** @type {[number, number, number] | null} */
	let size = $state(null);
	/** @type {((m: Model | Dome, v: number, kind?: Variant | null) => void) | null} */
	let show = null;
	let walkable = $state(false);
	let roofed = $state(false);
	let roofOff = $state(false);
	let walking = $state(false);
	/** @type {(() => void) | null} */
	let walkIn = null;
	/** @type {(() => void) | null} */
	let walkOut = null;
	/** @type {((off: boolean) => void) | null} */
	let liftRoof = null;
	/** @type {{ move: (x: number, y: number, hurry: boolean) => void, look: (dx: number, dy: number) => void } | null} */
	let stick = null;
	/** @type {(() => void) | null} */
	let dispose = null;
	/**
	 * A model in its parts: its catalog, the part picked (by its id), whether it is shown alone (the rest a ghost) or
	 * taken apart, and how far it is put up (0 … 1), played up to `playTo`
	 * @type {{ assemblies: { id: string, label: string, note: string }[], parts: { id: string, label: string, assembly: string, what: string, moves?: string, specs?: [string, string][], count?: number, step: number }[], steps: string[], ranges: [number, number][], sources: { label: string, url: string }[], play: string, seconds?: number } | null}
	 */
	let catalog = $state(null);
	/** @type {string | null} */
	let picked = $state(null);
	let alone = $state(false);
	let apart = $state(false);
	let stage = $state(1);
	let playing = $state(false);
	let playTo = 1;
	const card = $derived.by(() => (catalog && picked ? (catalog.parts.find((p) => p.id === picked) ?? null) : null));
	const stepNow = $derived.by(() => {
		if (!catalog) return 0;
		const i = catalog.ranges.findIndex(([, b]) => stage < b);
		return i < 0 ? catalog.ranges.length - 1 : i;
	});
	/** @type {((k: number) => void) | null} */
	let putUp = null;
	/** @type {((id: string) => void) | null} */
	let lookAt = null;
	/** @type {() => void} */
	let paint = () => {};
	$effect(() => {
		void [picked, alone, catalog];
		paint();
	});

	onMount(async () => {
		const THREE = await import('three');
		const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
		const { createWalker, PACE } = await import('$lib/sandbox-kit/walker.js');
		const box = /** @type {HTMLDivElement} */ (canvasBox);
		const renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.0;
		box.appendChild(renderer.domElement);
		const scene = new THREE.Scene();
		scene.background = new THREE.Color('#e9e6e0');
		const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
		camera.userData.fov = 40; // widened on an upright canvas ($lib/app/turntable.js)
		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		scene.add(new THREE.HemisphereLight('#ffffff', '#b9b2a6', 1.2));
		const key = new THREE.DirectionalLight('#fff4e6', 2.2);
		key.castShadow = true;
		key.shadow.mapSize.set(2048, 2048);
		scene.add(key, key.target);
		// the floor: a soft shadow catcher, and a grid of 10 cm squares (1 m lines darker)
		const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.22 }));
		floor.rotation.x = -Math.PI / 2;
		floor.receiveShadow = true;
		scene.add(floor);
		/** @type {InstanceType<typeof THREE.Group> | null} */
		let grid = null;
		/** @type {InstanceType<typeof THREE.Object3D> | null} */
		let current = null;

		// a model's parts: lit up when picked, the rest a ghost when it is shown alone (copies of each mesh's own
		// materials, made once)
		/** @type {Map<any, any>} */
		const lits = new Map();
		/** @type {Map<any, any>} */
		const ghosts = new Map();
		/** @param {any} mat */
		const litOf = (mat) => {
			let c = lits.get(mat);
			if (!c) {
				c = mat.clone();
				if (c.emissive) {
					c.emissive.set('#ff7a1a');
					c.emissiveIntensity = 0.55;
				}
				lits.set(mat, c);
			}
			return c;
		};
		/** @param {any} mat */
		const ghostOf = (mat) => {
			let c = ghosts.get(mat);
			if (!c) {
				c = mat.clone();
				c.transparent = true;
				c.opacity = 0.07;
				c.depthWrite = false;
				ghosts.set(mat, c);
			}
			return c;
		};
		/** each mesh's own material, and the part it belongs to */
		const own = new WeakMap();
		const partIds = new WeakMap();
		/** @param {any} o @returns {string | null} */
		const partOf = (o) => {
			if (partIds.has(o)) return partIds.get(o);
			let id = null;
			for (let p = o; p && p !== current; p = p.parent)
				if (p.userData.part) {
					id = p.userData.part;
					break;
				}
			partIds.set(o, id);
			return id;
		};
		paint = () => {
			if (!current || !catalog) return;
			current.traverse((o) => {
				const mesh = /** @type {any} */ (o);
				if (!mesh.isMesh) return;
				if (!own.has(mesh)) own.set(mesh, mesh.material);
				const mine = own.get(mesh);
				const id = partOf(mesh);
				const f = picked && id === picked ? litOf : picked && alone ? ghostOf : null;
				mesh.material = f ? (Array.isArray(mine) ? mine.map(f) : f(mine)) : mine;
			});
		};
		const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
		/** @param {any} o */
		const seen = (o) => {
			for (let p = o; p; p = p.parent) if (!p.visible) return false;
			return true;
		};
		/** the part under a point of the canvas, if any @param {PointerEvent} e */
		const partAt = (e) => {
			if (!current || !catalog) return null;
			const r = renderer.domElement.getBoundingClientRect();
			ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
			ray.setFromCamera(ndc, camera);
			for (const hit of ray.intersectObject(current, true)) {
				if (!seen(hit.object)) continue;
				const id = partOf(hit.object);
				// shown alone, the ghosts are looked through
				if (id && (!alone || !picked || id === picked)) return id;
			}
			return null;
		};
		/** @type {{ x: number, y: number } | null} */
		let down = null;
		renderer.domElement.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
		renderer.domElement.addEventListener('pointerup', (e) => {
			const was = down;
			down = null;
			// a tap, not a drag round it, picks the part under it (or, on nothing, lets go)
			if (!was || walker || !catalog || Math.hypot(e.clientX - was.x, e.clientY - was.y) > 6) return;
			const id = partAt(e);
			picked = id;
			if (id) lookAt?.(id);
			else alone = false;
		});
		/** where the camera's aim is moving over to (a part looked at) @type {InstanceType<typeof THREE.Vector3> | null} */
		let aim = null;
		lookAt = (id) => {
			const p = current?.userData.parts?.[id];
			if (!p) return;
			const b = new THREE.Box3().setFromObject(p);
			if (!b.isEmpty()) aim = b.getCenter(new THREE.Vector3());
		};
		/** how far it is taken apart now, easing to 1 or 0 */
		let apartK = 0;
		putUp = (k) => (current?.userData.setPitch ?? current?.userData.setBuild)?.(k);

		/** @type {ReturnType<typeof createWalker> | null} */
		let walker = null;
		/** @type {InstanceType<typeof THREE.PointLight>[]} */
		const lamps = [];
		/** the dome standing now, built into this scene; and the build under way (a newer pick cancels it) */
		/** @type {import('$lib/sandbox-2/interior/interior').EmbeddedDome | null} */
		let dome = null;
		let build = 0;
		/** the round ground's radius, when the buildings stand on one: a walk keeps to it */
		let groundR = 0;
		const clear = () => {
			walkOut?.();
			if (current) scene.remove(current);
			if (grid) scene.remove(grid);
			dome?.dispose();
			current = grid = dome = null;
			groundR = 0;
			build++;
			building = null;
		};
		stopBuilding = clear;
		show = (m, v, kind) => {
			clear();
			walkable = roofed = roofOff = false;
			size = null;
			catalog = picked = null;
			alone = apart = playing = false;
			apartK = 0;
			aim = null;
			if (isDome(m)) return void raise(m, atOrLatest(m.versions, v).build);
			current = kind && v === m.version ? kind.make() : atOrLatest(m.versions, v).build();
			walkable = !!current.userData.walk;
			roofed = !!current.userData.roof;
			catalog = current.userData.catalog ?? null;
			stage = current.userData.pitch ?? current.userData.built ?? 1;
			current.traverse((o) => {
				if (/** @type {InstanceType<typeof THREE.Mesh>} */ (o).isMesh) o.castShadow = true;
			});
			scene.add(current);
			place(current);
			if (enter && walkable) walkIn?.();
		};
		/**
		 * A tent or a dome alone: built into this scene as Sandbox 3's village builds one into its own (no sky, land
		 * or forest round it), a little at a time while the readout says how far it is; walked on its own floors.
		 * @param {Dome} m @param {import('$lib/sandbox-2/interior/interior').DomeKind} kind
		 */
		const raise = async (m, kind) => {
			const mine = build;
			building = 'Opening the doors';
			built = 0;
			const { mountInterior, DOMES, doorsOf } = await import('$lib/sandbox-2/interior/interior');
			if (mine !== build) return;
			const R = DOMES[kind].diameter / 2;
			// meanwhile the camera already stands where it will see it whole, the ground laid
			const ghost = new THREE.Box3(new THREE.Vector3(-R, 0, -R), new THREE.Vector3(R, R * (kind === 'tent' ? 1.2 : 0.55), R));
			placeGround(ghost);
			frame(ghost);
			// it joins the scene as a scene of its own before its last pieces show: the meadow it lays round itself is
			// hidden as soon as it comes, every few frames while it is built
			landless = (/** @type {InstanceType<typeof THREE.Object3D>} */ o) => o !== scene && /** @type {any} */ (o).isScene && keepToItself(o, R);
			const h = await mountInterior(box, kind, (label) => {
				if (mine !== build || label === 'ready') return;
				building = label;
				built += 1;
			}, {
				host: { scene, camera, renderer, x: 0, z: 0 },
				cancelled: () => mine !== build,
				hurry: () => true,
				// a dome planted with our real plants grows the warm garden Sandbox 4 grows under its glass
				flora: m.flora ? await import('$lib/sandbox-2/interior/sandbox5.js').then(({ SANDBOX_5 }) => ({ garden: SANDBOX_5.flora.inside, seed: SANDBOX_5.flora.seed })) : undefined
			}).catch(() => null);
			landless = null;
			if (!h) return;
			if (mine !== build || !h.embedded) return h.dispose();
			const e = (dome = h.embedded);
			e.setHour(13);
			const root = e.root;
			// in by the north door, or the south where there is none (the large dome's pond is on its north)
			const door = doorsOf(kind).includes(0) ? 0 : Math.PI;
			const out = R + Math.max(2, R * 0.12);
			root.userData.tick = (/** @type {number} */ t) => e.update(t);
			root.userData.walk = {
				x: out * Math.sin(door),
				z: out * Math.cos(door),
				yaw: door,
				floorAt: e.floorAt,
				// in through its door and round on its own floors, or out on the ground round it
				canStand: (/** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ here, /** @type {number} */ ground, /** @type {{ x: number, z: number }} */ from) => {
					const nf = e.floorAt(x, z, ground);
					const outside = nf < 0.5 && here < 0.5 && Math.hypot(x, z) > R + 0.6;
					return (outside || e.inside(x, z, nf)) && !e.blocked(x, z, here) && !e.hits(x, z, nf, from);
				},
				lamps: []
			};
			current = root;
			walkable = true;
			building = null;
			const own = keepToItself(root, R);
			if (!own.isEmpty()) root.userData.measured = own;
			place(root, root.userData.measured);
			if (enter) walkIn?.();
		};
		/** while a dome is built: hides the land it lays round itself, as it comes @type {((o: InstanceType<typeof THREE.Object3D>) => void) | null} */
		let landless = null;
		/**
		 * A dome without the land a village lays round it (a meadow reaching far past it): every piece wider than the
		 * dome's own reach is hidden, so it stands on the round ground alone. Hands back what is left, measured.
		 * @param {InstanceType<typeof THREE.Object3D>} root @param {number} R
		 */
		const keepToItself = (root, R) => {
			const own = new THREE.Box3();
			root.updateMatrixWorld(true);
			root.traverse((o) => {
				if (!(/** @type {InstanceType<typeof THREE.Mesh>} */ (o).isMesh)) return;
				const bb = new THREE.Box3().setFromObject(o);
				if (bb.isEmpty()) return;
				const z = bb.getSize(new THREE.Vector3());
				if (Math.max(z.x, z.z) <= R * 2.6) own.union(bb);
				else o.visible = false;
			});
			return own;
		};
		/** the model or building in its place: measured, on its ground, lit, and seen whole @param {InstanceType<typeof THREE.Object3D>} obj @param {InstanceType<typeof THREE.Box3>} [measured] */
		const place = (obj, measured) => {
			const b = measured ?? new THREE.Box3().setFromObject(obj);
			const s = b.getSize(new THREE.Vector3());
			size = [s.x, s.y, s.z];
			const reach = Math.max(s.x, s.y, s.z);
			placeGround(b);
			const mid = b.getCenter(new THREE.Vector3());
			key.position.set(mid.x + reach * 2, reach * 3, mid.z + reach * 1.5);
			key.target.position.copy(mid);
			frame(b);
			const sh = key.shadow.camera;
			sh.left = sh.bottom = -reach * 1.5;
			sh.right = sh.top = reach * 1.5;
			sh.near = 0.01;
			sh.far = reach * 10;
			sh.updateProjectionMatrix();
			key.shadow.normalBias = reach * 0.004; // a texel or two: no shadow acne on big flat faces
		};
		/** the ground under it: the round ground (the Buildings), or a square grid of 10 cm squares as large as the model @param {InstanceType<typeof THREE.Box3>} b */
		const placeGround = (b) => {
			if (grid) scene.remove(grid);
			const s = b.getSize(new THREE.Vector3());
			const mid = b.getCenter(new THREE.Vector3());
			if (round) {
				groundR = groundRadius(Math.hypot(s.x, s.z) / 2);
				grid = roundGround(groundR);
				grid.position.set(mid.x, 0, mid.z);
				floor.visible = false;
			} else {
				const span = Math.ceil((Math.max(s.x, s.z) + 0.6) * 2) / 2;
				grid = new THREE.Group();
				grid.add(new THREE.GridHelper(span, Math.round(span * 10), '#cfc9bf', '#cfc9bf'));
				grid.add(new THREE.GridHelper(span, Math.max(1, Math.round(span)), '#a59e92', '#a59e92'));
				grid.position.y = 0.001;
			}
			scene.add(grid);
		};
		// the turntable's view of a model: round it, from a little above
		/** @param {InstanceType<typeof THREE.Box3>} b */
		const frame = (b) => {
			const s = b.getSize(new THREE.Vector3());
			const reach = Math.max(s.x, s.y, s.z);
			const mid = b.getCenter(new THREE.Vector3());
			controls.target.copy(mid);
			camera.position.set(mid.x + reach * 1.3, mid.y + reach * 0.8, mid.z + reach * 1.6);
			camera.userData.fov = 40;
			camera.near = reach / 200;
			camera.far = reach * 60;
			fit(camera, box.clientWidth, box.clientHeight);
		};
		liftRoof = (off) => {
			if (current?.userData.roof) current.userData.roof.visible = !off;
		};
		// walk in: the sandboxes' walker, the ceiling lights lit; Escape (or the button) walks out again
		walkIn = () => {
			const w = current?.userData.walk;
			if (!w || walker) return;
			controls.enabled = false;
			walker = createWalker(camera, renderer.domElement, {
				x: w.x,
				z: w.z,
				yaw: w.yaw,
				pitch: -0.05,
				// at the sandboxes' pace, as in every world ($lib/sandbox-kit/walker.js)
				walk: PACE.walk,
				hurry: PACE.hurry,
				// on the round ground, never off its edge
				canStand: groundR
					? (/** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ here, /** @type {number} */ ground, /** @type {any} */ from) =>
							Math.hypot(x - (grid?.position.x ?? 0), z - (grid?.position.z ?? 0)) < groundR - 0.4 && w.canStand(x, z, here, ground, from)
					: w.canStand,
				floorAt: w.floorAt,
				onKey: (/** @type {string} */ k, /** @type {boolean} */ down) => {
					if (k !== 'escape' || !down) return false;
					walkOut?.();
					return true;
				}
			});
			for (const [x, y, z] of /** @type {[number, number, number][]} */ (w.lamps)) {
				const lamp = new THREE.PointLight('#fff1dc', 2.2, 6, 2);
				lamp.position.set(x, y, z);
				scene.add(lamp);
				lamps.push(lamp);
			}
			camera.userData.fov = 0; // a walk sees as a walker does, upright or not
			camera.fov = 70;
			camera.near = 0.05;
			camera.far = Math.max(400, groundR * 4);
			camera.updateProjectionMatrix();
			stick = { move: (x, y, h) => walker?.move(x, y, h), look: (dx, dy) => walker?.look(dx, dy) };
			walking = true;
		};
		walkOut = () => {
			if (!walker) return;
			walker.dispose();
			walker = null;
			stick = null;
			for (const lamp of lamps.splice(0)) scene.remove(lamp);
			controls.enabled = true;
			if (current) frame(current.userData.measured ?? new THREE.Box3().setFromObject(current));
			walking = false;
		};
		const resize = () => {
			const w = box.clientWidth, h = box.clientHeight;
			renderer.setSize(w, h);
			fit(camera, w, h);
		};
		const ro = new ResizeObserver(resize);
		ro.observe(box);
		resize();
		show(chosen, version, variant);
		const start = performance.now();
		let raf = 0;
		let last = performance.now();
		let frames = 0;
		const tick = () => {
			const now = performance.now();
			const dt = Math.min(0.1, (now - last) / 1000);
			// a model in its parts put up as it plays, and taken apart or put back together
			if (playing && catalog) {
				stage = Math.min(playTo, stage + dt / (catalog.seconds ?? 20));
				putUp?.(stage);
				if (stage >= playTo) playing = false;
			}
			const apartTo = apart ? 1 : 0;
			if (current?.userData.explode && apartK !== apartTo) {
				apartK += (apartTo - apartK) * Math.min(1, dt * 5);
				if (Math.abs(apartK - apartTo) < 2e-3) apartK = apartTo;
				current.userData.explode(apartK);
			}
			if (aim && !walker) {
				controls.target.lerp(aim, 0.12);
				if (controls.target.distanceTo(aim) < 0.002) aim = null;
			}
			if (walker) walker.update(dt);
			else controls.update();
			current?.userData.tick?.((now - start) / 1000); // a rigged machine at work
			if (landless && ++frames % 20 === 0) scene.children.forEach(landless);
			last = now;
			renderer.render(scene, camera);
			raf = requestAnimationFrame(tick);
		};
		tick();
		dispose = () => {
			clear();
			cancelAnimationFrame(raf);
			ro.disconnect();
			controls.dispose();
			renderer.dispose();
			renderer.domElement.remove();
		};
	});
	onDestroy(() => dispose?.());

	/** @param {Model | Dome} m */
	const pick = (m) => {
		chosen = m;
		version = latest(m);
		variant = (!isDome(m) && m.variants?.[0]) || null;
		show?.(m, version, variant);
	};
	/** @param {number} v */
	const pickVersion = (v) => {
		version = v;
		show?.(chosen, v, variant);
	};
	/** @param {Variant} k */
	const vary = (k) => {
		variant = k;
		show?.(chosen, version, k);
	};
	/** @param {number} v */
	const cm = (v) => Math.round(v * 100);
	/** a measure as it reads best: centimetres for a model, metres from 10 m up @param {number} v */
	const metres = (v) => (v >= 10 ? `${Math.round(v * 10) / 10} m` : `${cm(v)} cm`);
	const toggleRoof = () => {
		roofOff = !roofOff;
		liftRoof?.(roofOff);
	};
	/** @param {string} id */
	const choose = (id) => {
		picked = picked === id ? null : id;
		if (picked) lookAt?.(picked);
		else alone = false;
	};
	/** put it up from where it is (from the start, once it stands), or stop */
	const play = () => {
		if (playing) return void (playing = false);
		playTo = 1;
		if (stage >= 1) {
			stage = 0;
			putUp?.(0);
		}
		playing = true;
	};
	/** play one step, from its start to its end @param {number} n the step (1 first) */
	const playStep = (n) => {
		const [a, b] = catalog?.ranges[n - 1] ?? [0, 1];
		stage = a;
		putUp?.(a);
		playTo = b;
		playing = true;
	};
	/** @param {number} k */
	const scrub = (k) => {
		playing = false;
		stage = k;
		putUp?.(k);
	};
</script>

<svelte:head>
	<title>{title} · maiaCITY</title>
</svelte:head>

<Turntable
	{name}
	bind:canvas={canvasBox}
	bind:stage={viewBox}
	full={!inPlace && (walking || (enter && !!building))}
	picks={{ title, lede, items, chosen, where: (/** @type {Model | Dome} */ m) => m.usedIn, onpick: pick, group, version, onversion: pickVersion }}
>
	{#snippet bar()}
		{#if walkable || roofed}
			<div class="chips walkbar">
				{#if walkable}<button type="button" class="chip dark" onclick={() => (walking ? walkOut?.() : walkIn?.())}>{walking ? 'Step outside' : 'Step inside'}</button>{/if}
				{#if roofed && !walking}<button type="button" class="chip dark" onclick={toggleRoof}>{roofOff ? 'Put the roof on' : 'Lift the roof'}</button>{/if}
			</div>
		{/if}
	{/snippet}
	{#snippet panel()}
		{#if variants.length > 1}
			<nav class="chips" aria-label="{chosen.label}: variants">
				<span class="label">{chosen.label}</span>
				{#each variants as k (k.id)}
					<button class="chip" class:on={variant?.id === k.id} aria-current={variant?.id === k.id ? 'true' : undefined} onclick={() => vary(k)}>{k.label}</button>
				{/each}
			</nav>
		{/if}
		{#if catalog}
			<div class="parts" class:after={variants.length > 1}>
				<div class="row head">
					<span class="label">{catalog.parts.length} parts</span>
					<span class="row">
						<button class="chip" class:on={alone} disabled={!picked} onclick={() => (alone = !alone)}>Alone</button>
						<button class="chip" class:on={apart} onclick={() => (apart = !apart)}>Explode</button>
					</span>
				</div>
				<div class="row build">
					<button class="chip" class:on={playing} onclick={play}>{playing ? 'Pause' : stage >= 1 ? catalog.play : 'Go on'}</button>
					<input type="range" min="0" max="1" step="0.001" value={stage} oninput={(e) => scrub(+e.currentTarget.value)} aria-label="How far it is put up" />
				</div>
				<p class="note">Step {stepNow + 1} of {catalog.steps.length}: {catalog.steps[stepNow]}</p>
				{#each catalog.assemblies as a (a.id)}
					{@const list = catalog.parts.filter((p) => p.assembly === a.id)}
					<details open={!!picked && list.some((p) => p.id === picked)}>
						<summary><b>{a.label}</b> <small>{list.length}</small></summary>
						<p class="note">{a.note}</p>
						<ul>
							{#each list as p (p.id)}
								<li><button class:on={picked === p.id} onclick={() => choose(p.id)}>{p.label}{#if p.count && p.count > 1}<small> ×{p.count}</small>{/if}{#if p.moves}<i title="moves">↻</i>{/if}</button></li>
							{/each}
						</ul>
					</details>
				{/each}
				<details>
					<summary><b>Sources</b> <small>{catalog.sources.length}</small></summary>
					<ul class="sources">
						{#each catalog.sources as s (s.url)}<li><a href={s.url} target="_blank" rel="noreferrer">{s.label} ↗</a></li>{/each}
					</ul>
				</details>
			</div>
		{/if}
	{/snippet}
	{#snippet readout()}
		{#if card && catalog}
			{@const a = catalog.assemblies.find((x) => x.id === card.assembly)}
			<div class="part-card">
				<span class="label">{a?.label} · step {card.step} of {catalog.steps.length}</span>
				<b>{card.label}{#if card.count && card.count > 1}<small> ×{card.count}</small>{/if}</b>
				<p>{card.what}</p>
				{#if card.moves}<p><span class="tag">Moves</span> {card.moves}</p>{/if}
				{#if card.specs?.length}
					<dl>
						{#each card.specs as [k, v] (k)}<dt>{k}</dt><dd>{v}</dd>{/each}
					</dl>
				{/if}
				<small>Step {card.step}: {catalog.steps[card.step - 1]}</small>
				<div class="row">
					<button class="chip" onclick={() => lookAt?.(card.id)}>Look at it</button>
					<button class="chip" class:on={alone} onclick={() => (alone = !alone)}>Alone</button>
					<button class="chip" onclick={() => playStep(card.step)}>Its step</button>
					<button class="chip" onclick={() => ((picked = null), (alone = false))}>Close</button>
				</div>
			</div>
		{:else}
		<b>{variants.length > 1 && variant ? `${chosen.label} · ${variant.label}` : chosen.label}</b>
		{#if variants.length > 1 && variant}<small>{variant.note}</small>{/if}
		{#if isDome(chosen)}<span>{chosen.size}</span>{/if}
		{#if building}
			<span class="building">{building}…</span>
		{:else if size}
			<span>{metres(size[0])} × {metres(size[2])} × {metres(size[1])} <small>(width × depth × height)</small></span>
		{/if}
		{#if !walking}<small>Drag to turn round it · pinch or scroll to come closer · the grid is {round ? '1 m' : '10 cm'}{catalog ? ' · tap any part for its card' : ''}</small>{/if}
		{/if}
	{/snippet}
	{#if building}
		<div class="loading" role="status" aria-live="polite">
			<p class="eyebrow">{enter ? 'Stepping inside' : 'Building'}</p>
			<strong>{chosen.label}</strong>
			{#if isDome(chosen)}<span class="size">{chosen.size}</span>{/if}
			<div class="progress"><span style:width="{Math.min(100, (built / STEPS) * 100)}%"></span></div>
			<span class="step">{building}…</span>
		</div>
	{/if}
	{#if walking}
		{#if !inPlace}<WorldBar title={chosen.label} subtitle="{title} · {chosen.usedIn}" sky={false} />{/if}
		<TouchStick move={(x, y, h) => stick?.move(x, y, h)} look={(dx, dy) => stick?.look(dx, dy)} stage={viewBox} taps=".walkbar button" />
		<WalkHint keys="Drag to look · WASD to walk · Shift to hurry · Esc to step outside" />
	{/if}
</Turntable>

<style>
	.building {
		opacity: 0.7;
	}
	/* while a building is built, before stepping inside it: its name and how far it is, over the whole screen */
	.loading {
		position: absolute;
		inset: 0;
		z-index: 3;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		background: #f2efe7;
		color: #1f2a23;
		text-align: center;
	}
	.loading .eyebrow {
		margin: 0;
		font-size: 0.75rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #c8744f;
	}
	.loading strong {
		font-family: var(--font-display, serif);
		font-size: 2rem;
		font-weight: 500;
	}
	.loading .size,
	.loading .step {
		font-size: 0.85rem;
		opacity: 0.7;
	}
	.progress {
		width: min(18rem, 70vw);
		height: 4px;
		margin: 0.6rem 0 0.2rem;
		border-radius: 2px;
		background: rgb(31 42 35 / 0.12);
		overflow: hidden;
	}
	.progress span {
		display: block;
		height: 100%;
		background: #c8744f;
		transition: width 400ms ease;
	}
	.parts.after {
		margin-top: 0.8rem;
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
	}
	.parts li button:hover {
		background: rgb(0 0 0 / 0.05);
	}
	.parts li button.on {
		background: #ff7a1a;
		color: #fff;
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
	.parts .row {
		display: flex;
		gap: 0.35rem;
		align-items: center;
	}
	.parts .head {
		justify-content: space-between;
		margin-bottom: 0.3rem;
	}
	.parts .build input {
		flex: 1;
		min-width: 0;
		accent-color: #c8744f;
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
	.part-card .row {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
	}
	.chip.dark {
		padding: 0.5rem 0.9rem;
		border: 0;
		background: rgb(31 42 35 / 0.8);
		color: #f2efe7;
	}
</style>

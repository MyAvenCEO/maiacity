<!--
	A turntable of models (src/lib/models): the Assets (/app/models/) and the Buildings (/app/buildings/) both show
	theirs with it, one at a time — drag to turn round it, scroll to come closer — on a grid of 10 cm squares, with its
	measure. A model that can be walked (`userData.walk`: the containers) is walked in first person, the sandboxes'
	walker; one with a roof (`userData.roof`) can have it lifted off to look in from above; a rigged machine
	(`userData.tick`: the excavators) plays its work. An item that is a dome (`dome`: the Buildings' tents and domes) is
	built alone, without the forest and land round it, as Sandbox 3's village builds its domes into its own world
	(mountInterior with a host, $lib/sandbox-2/interior), and stepped inside the same way. With `round` (the
	Buildings) every building stands on the same round ground ($lib/buildings/ground.js) instead of the square grid.
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
	 * @type {{ name: string, title: string, lede: string, items: (Model | Dome)[], group?: (item: any) => string, round?: boolean }}
	 */
	let { name, title, lede, items, group, round = false } = $props();
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
	// walking inside a model the walk has the whole screen, as a dome's does: the nav pill's way back walks out
	$effect(() => {
		if (walking) return wayBack('Back outside', () => walkOut?.());
	});
	/** a dome being built: what it is doing now (null once it stands) */
	/** @type {string | null} */
	let building = $state(null);
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

	onMount(async () => {
		const THREE = await import('three');
		const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
		const { createWalker } = await import('$lib/sandbox-kit/walker.js');
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
		show = (m, v, kind) => {
			clear();
			walkable = roofed = roofOff = false;
			size = null;
			if (isDome(m)) return void raise(m, atOrLatest(m.versions, v).build);
			current = kind && v === m.version ? kind.make() : atOrLatest(m.versions, v).build();
			walkable = !!current.userData.walk;
			roofed = !!current.userData.roof;
			current.traverse((o) => {
				if (/** @type {InstanceType<typeof THREE.Mesh>} */ (o).isMesh) o.castShadow = true;
			});
			scene.add(current);
			place(current);
		};
		/**
		 * A tent or a dome alone: built into this scene as Sandbox 3's village builds one into its own (no sky, land
		 * or forest round it), a little at a time while the readout says how far it is; walked on its own floors.
		 * @param {Dome} m @param {import('$lib/sandbox-2/interior/interior').DomeKind} kind
		 */
		const raise = async (m, kind) => {
			const mine = build;
			building = 'Starting';
			const { mountInterior, DOMES } = await import('$lib/sandbox-2/interior/interior');
			if (mine !== build) return;
			const R = DOMES[kind].diameter / 2;
			// meanwhile the camera already stands where it will see it whole, the ground laid
			const ghost = new THREE.Box3(new THREE.Vector3(-R, 0, -R), new THREE.Vector3(R, R * (kind === 'tent' ? 1.2 : 0.55), R));
			placeGround(ghost);
			frame(ghost);
			// it joins the scene as a scene of its own before its last pieces show: the meadow it lays round itself is
			// hidden as soon as it comes, every few frames while it is built
			landless = (/** @type {InstanceType<typeof THREE.Object3D>} */ o) => o !== scene && /** @type {any} */ (o).isScene && keepToItself(o, R);
			const h = await mountInterior(box, kind, (label) => mine === build && label !== 'ready' && (building = label), {
				host: { scene, camera, renderer, x: 0, z: 0 },
				cancelled: () => mine !== build,
				hurry: () => true
			}).catch(() => null);
			landless = null;
			if (!h) return;
			if (mine !== build || !h.embedded) return h.dispose();
			const e = (dome = h.embedded);
			e.setHour(13);
			const root = e.root;
			const door = 0;
			const out = R + Math.max(2, R * 0.12);
			root.userData.tick = (/** @type {number} */ t) => e.update(t);
			root.userData.walk = {
				x: out * Math.sin(door),
				z: out * Math.cos(door),
				yaw: door,
				walk: kind === 'tent' || kind === 'glamp' ? 1.4 : 3,
				hurry: kind === 'tent' || kind === 'glamp' ? 3.2 : 8,
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
				walk: w.walk ?? 1.4,
				hurry: w.hurry ?? 3.2,
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
			if (walker) walker.update(Math.min(0.1, (now - last) / 1000));
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
</script>

<svelte:head>
	<title>{title} · maiaCITY</title>
</svelte:head>

<Turntable
	{name}
	bind:canvas={canvasBox}
	bind:stage={viewBox}
	full={walking}
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
	{/snippet}
	{#snippet readout()}
		<b>{variants.length > 1 && variant ? `${chosen.label} · ${variant.label}` : chosen.label}</b>
		{#if variants.length > 1 && variant}<small>{variant.note}</small>{/if}
		{#if isDome(chosen)}<span>{chosen.size}</span>{/if}
		{#if building}
			<span class="building">{building}…</span>
		{:else if size}
			<span>{metres(size[0])} × {metres(size[2])} × {metres(size[1])} <small>(width × depth × height)</small></span>
		{/if}
		<small>Drag to turn round it · pinch or scroll to come closer · the grid is {round ? '1 m' : '10 cm'}</small>
	{/snippet}
	{#if walking}
		<WorldBar title={chosen.label} subtitle="{title} · {chosen.usedIn}" sky={false} />
		<TouchStick move={(x, y, h) => stick?.move(x, y, h)} look={(dx, dy) => stick?.look(dx, dy)} stage={viewBox} taps=".walkbar button" />
		<WalkHint keys="Drag to look · WASD to walk · Shift to hurry · Esc to step outside" />
	{/if}
</Turntable>

<style>
	.building {
		opacity: 0.7;
	}
	.chip.dark {
		padding: 0.5rem 0.9rem;
		border: 0;
		background: rgb(31 42 35 / 0.8);
		color: #f2efe7;
	}
</style>

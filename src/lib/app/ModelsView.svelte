<!--
	A turntable of models (src/lib/models): the Assets (/app/models/) and the Buildings (/app/buildings/) both show
	theirs with it, one at a time — drag to turn round it, scroll to come closer — on a grid of 10 cm squares, with its
	measure. A model that can be walked (`userData.walk`: the containers) is walked in first person, the sandboxes'
	walker; one with a roof (`userData.roof`) can have it lifted off to look in from above; a rigged machine
	(`userData.tick`: the excavators) plays its work. An item that is a dome (`dome`: the Buildings' tents and domes) is
	too big for the turntable: its picture from inside stands there instead, and stepping inside walks it full screen
	($lib/sandbox-2/DomeInterior.svelte, as Sandbox 3 does).
-->
<script>
	import { onDestroy, onMount, untrack } from 'svelte';
	import Turntable from '$lib/app/Turntable.svelte';
	import { fit } from '$lib/app/turntable.js';
	import TouchStick from '$lib/touch/TouchStick.svelte';
	import WalkHint from '$lib/sandbox-kit/WalkHint.svelte';
	import { atOrLatest } from '$lib/app/versions.js';
	import { asset } from '$lib/media/url';
	import DomeInterior from '$lib/sandbox-2/DomeInterior.svelte';

	/** @typedef {import('$lib/models').Model} Model */
	/** @typedef {import('$lib/models').Variant} Variant */
	/** @typedef {import('$lib/buildings').Dome} Dome */

	/**
	 * @type {{ name: string, title: string, lede: string, items: (Model | Dome)[], group?: (item: any) => string }}
	 */
	let { name, title, lede, items, group } = $props();
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
	/** a dome being walked inside, full screen */
	let inside = $state(false);
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
		show = (m, v, kind) => {
			walkOut?.();
			if (current) scene.remove(current);
			if (grid) scene.remove(grid);
			current = grid = null;
			if (isDome(m)) {
				walkable = roofed = roofOff = false;
				size = null;
				return;
			}
			current = kind && v === m.version ? kind.make() : atOrLatest(m.versions, v).build();
			walkable = !!current.userData.walk;
			roofed = !!current.userData.roof;
			roofOff = false;
			current.traverse((o) => {
				if (/** @type {InstanceType<typeof THREE.Mesh>} */ (o).isMesh) o.castShadow = true;
			});
			scene.add(current);
			const b = new THREE.Box3().setFromObject(current);
			const s = b.getSize(new THREE.Vector3());
			size = [s.x, s.y, s.z];
			const reach = Math.max(s.x, s.y, s.z);
			// the grid as large as the model, in 10 cm squares
			const span = Math.ceil((Math.max(s.x, s.z) + 0.6) * 2) / 2;
			grid = new THREE.Group();
			grid.add(new THREE.GridHelper(span, Math.round(span * 10), '#cfc9bf', '#cfc9bf'));
			grid.add(new THREE.GridHelper(span, Math.max(1, Math.round(span)), '#a59e92', '#a59e92'));
			grid.position.y = 0.001;
			scene.add(grid);
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
				walk: 1.4,
				hurry: 3.2,
				canStand: w.canStand,
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
			camera.far = 400;
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
			if (current) frame(new THREE.Box3().setFromObject(current));
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
		const tick = () => {
			const now = performance.now();
			if (walker) walker.update(Math.min(0.1, (now - last) / 1000));
			else controls.update();
			current?.userData.tick?.((now - start) / 1000); // a rigged machine at work
			last = now;
			renderer.render(scene, camera);
			raf = requestAnimationFrame(tick);
		};
		tick();
		dispose = () => {
			walkOut?.();
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
		{#if isDome(chosen)}
			<div class="chips walkbar">
				<button type="button" class="chip dark" onclick={() => (inside = true)}>Step inside</button>
			</div>
		{:else if walkable || roofed}
			<div class="chips walkbar">
				{#if walkable}<button type="button" class="chip dark" onclick={() => (walking ? walkOut?.() : walkIn?.())}>{walking ? 'Walk out' : 'Walk inside'}</button>{/if}
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
		{#if isDome(chosen)}
			<b>{chosen.label}</b>
			<span>{chosen.size}</span>
			<small>Step inside to walk it: drag to look, WASD to walk, Shift to hurry</small>
		{:else}
			<b>{variants.length > 1 && variant ? `${chosen.label} · ${variant.label}` : chosen.label}</b>
			{#if variants.length > 1 && variant}<small>{variant.note}</small>{/if}
			{#if size}<span>{cm(size[0])} × {cm(size[2])} × {cm(size[1])} cm <small>(width × depth × height)</small></span>{/if}
			<small>Drag to turn round it · pinch or scroll to come closer · the grid is 10 cm</small>
		{/if}
	{/snippet}
	{#if isDome(chosen)}
		<img class="poster" src={asset(chosen.image)} alt="Inside the {chosen.label.toLowerCase()}" />
	{/if}
	{#if walking}
		<TouchStick move={(x, y, h) => stick?.move(x, y, h)} look={(dx, dy) => stick?.look(dx, dy)} stage={viewBox} taps=".walkbar button" />
		<WalkHint keys="Drag to look · WASD to walk · Shift to hurry · Esc to walk out" />
	{/if}
</Turntable>

{#if inside && isDome(chosen)}
	<div class="walk"><DomeInterior kind={atOrLatest(chosen.versions, version).build} place={chosen.usedIn} onclose={() => (inside = false)} /></div>
{/if}

<style>
	/* a dome's picture from inside, where the turntable would be */
	.poster {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.walk {
		position: fixed;
		inset: 0;
		z-index: 50;
	}
	.chip.dark {
		padding: 0.5rem 0.9rem;
		border: 0;
		background: rgb(31 42 35 / 0.8);
		color: #f2efe7;
	}
</style>

<!--
	Plants: every plant grown from code (src/lib/plants), from its seed to the plant in fruit, in ten stages to tab
	through across the top — the last four the fruit's own, set to ripe (or ← → and 1 – 0 on the keyboard; Grow plays it on
	from where it is). The soil is cut away, so the roots grow as plainly as the shoot, and the camera keeps the plant
	framed. Each plant grows from a seed id: the same id the same plant every time, New seed a sister plant. Drag to turn round it, scroll to come closer. An admin's.
	Plant | Fruit: the whole plant, or one of its fruit on its own (src/lib/plants/fruit.js), hung by its stalk through the
	fruit's four stages — the seed picks which fruit, and gives it its own small differences of size, shape and colour.
-->
<script>
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { LAYERS, PLANTS, SEEDS, freshSeed, plantAt } from '$lib/plants';
	import Turntable from '$lib/app/Turntable.svelte';
	import { fit } from '$lib/app/turntable.js';
	import { fruitOf, oneFruit } from '$lib/plants/fruit.js';

	/** @typedef {(typeof import('$lib/plants').PLANTS)[number]} Plant */
	/** @typedef {'cutaway' | 'bare' | 'solid'} Soil */
	/** @typedef {'plant' | 'whole'} Frame */
	/** @typedef {'plant' | 'fruit'} View */

	const asked = page.url.searchParams;
	/** @type {HTMLDivElement | undefined} */
	let canvasBox = $state();
	const opened = PLANTS.find((p) => p.id === asked.get('plant')) ?? PLANTS[0];
	/** @type {Plant} */
	let chosen = $state(opened);
	/** where it has grown to: 0 … the last stage, the stages its whole numbers */
	let g = $state(Math.min(opened.stages.length - 1, Math.max(asked.get('view') === 'fruit' ? 6 : 0, Number(asked.get('stage') ?? 1) - 1 || 0)));
	let seed = $state(asked.get('seed') || SEEDS[0]);
	/** the version of it grown: its latest, or one picked from its history (?v=) */
	let version = $state(Number(asked.get('v')) || opened.version);
	/** the plant as it was at that version */
	const grown = $derived(plantAt(chosen.id, version) ?? chosen);
	/** the soil cut away, the plant framed close: the one view (the others are kept in the code below, not offered) */
	/** @type {Soil} */
	const soil = 'cutaway';
	/** @type {Frame} */
	const frame = 'plant';
	let playing = $state(false);
	/** the whole plant, or one of its fruit on its own (?view=fruit) */
	/** @type {View} */
	let view = $state(asked.get('view') === 'fruit' ? 'fruit' : 'plant');
	/** the fruit this plant bears, and the one its seed picks — undefined when it bears none (known once grown) */
	/** @type {{ keys: string[], pick: string } | undefined} */
	let fruit = $state();
	/** the first of the fruit's stages: set */
	const FRUIT = 6;
	/** the fruit shown has not set yet at this stage */
	let unset = $state(false);
	/** @type {{ above: number, below: number, across: number } | null} */
	let size = $state(null);

	const last = $derived(chosen.stages.length - 1);
	const stage = $derived(Math.round(g));
	const day = $derived.by(() => {
		const s = chosen.stages, k = Math.min(s.length - 2, Math.floor(g));
		return Math.round(s[k].day + (s[k + 1].day - s[k].day) * (g - k));
	});

	/** @type {((plant: Plant, g: number, seed: string) => void) | null} */
	let show = null;
	/** @type {((soil: Soil) => void) | null} */
	let showSoil = null;
	/** @type {((frame: Frame) => void) | null} */
	let reframe = null;
	/** @type {(() => void) | null} */
	let dispose = null;

	onMount(async () => {
		const THREE = await import('three');
		const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
		const box = /** @type {HTMLDivElement} */ (canvasBox);
		const renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		box.appendChild(renderer.domElement);
		const scene = new THREE.Scene();
		scene.background = new THREE.Color('#e9e6e0');
		const camera = new THREE.PerspectiveCamera(38, 1, 0.001, 100);
		camera.userData.fov = 38; // widened on an upright canvas ($lib/app/turntable.js)
		camera.position.set(0.3, 0.2, 0.4);
		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		scene.add(new THREE.HemisphereLight('#ffffff', '#b9b2a6', 1.25));
		const key = new THREE.DirectionalLight('#fff4e6', 2.3);
		key.castShadow = true;
		key.shadow.mapSize.set(2048, 2048);
		key.shadow.bias = -0.0004;
		scene.add(key, key.target);

		// the earth: the round floor everything stands on is the soil itself, a disc of earth as deep as the grown
		// plant's roots. Its near side and its top are see-through (we look in through them), its far wall and its
		// floor solid, so the roots show against the earth behind them from whichever side we look.
		const grain = soilTexture(THREE);
		const surfaceGrain = grain.clone();
		const walls = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96, 1, false), new THREE.MeshStandardMaterial({ color: '#c09a74', map: grain, roughness: 1, side: THREE.BackSide }));
		walls.receiveShadow = true;
		const sides = new THREE.Mesh(
			new THREE.CylinderGeometry(1, 1, 1, 96, 1, true),
			new THREE.MeshStandardMaterial({ color: '#a07a56', map: grain, roughness: 1, transparent: true, opacity: 0.1, depthWrite: false })
		);
		const top = new THREE.Mesh(
			new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2).translate(0, 0.5, 0),
			new THREE.MeshStandardMaterial({ color: '#b08860', map: surfaceGrain, roughness: 1, transparent: true, opacity: 0.32, depthWrite: false })
		);
		top.receiveShadow = true;
		const ring = (/** @type {number} */ y) => {
			const pts = [];
			for (let k = 0; k <= 96; k++) pts.push(new THREE.Vector3(Math.cos((k / 96) * Math.PI * 2), y, Math.sin((k / 96) * Math.PI * 2)));
			return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#4a3424', transparent: true, opacity: 0.4 }));
		};
		const earth = new THREE.Group();
		earth.add(walls, sides, top, ring(0.5), ring(-0.5));
		scene.add(earth);
		showSoil = (/** @type {Soil} */ mode) => {
			walls.visible = mode === 'cutaway';
			sides.visible = mode !== 'bare';
			for (const [mesh, see] of /** @type {const} */ ([[sides, 0.1], [top, mode === 'bare' ? 0.12 : 0.32]])) {
				const m = /** @type {import('three').MeshStandardMaterial} */ (mesh.material);
				m.opacity = mode === 'solid' ? 1 : see;
				m.transparent = mode !== 'solid';
				m.depthWrite = mode === 'solid';
				m.needsUpdate = true;
			}
		};
		showSoil(soil);

		/** @type {import('three').Group | null} */
		let current = null;
		/** where the camera is easing to: the plant's middle and how far back to stand */
		const goal = { mid: new THREE.Vector3(), reach: 0.1 };
		let easing = 0;
		let first = true;
		/** the earth for this plant and seed (its radius and depth): sized once, to the plant fully grown */
		let soilFor = '';
		const ground = { r: 0.1, d: 0.1 };
		/** @type {import('three').Box3 | null} */
		let plantBox = null;

		/** a plant's bounds, its stake left out */
		const bounds = (/** @type {import('three').Group} */ group) => {
			const b = new THREE.Box3();
			group.traverse((o) => {
				if (/** @type {import('three').Mesh} */ (o).isMesh && !o.userData.prop) b.expandByObject(o);
			});
			return b;
		};
		const toss = (/** @type {import('three').Group} */ group) => group.traverse((o) => /** @type {import('three').Mesh} */ (o).geometry?.dispose());

		/** the earth the grown plant needs, with room round its roots: the same from seed to fruit */
		const sizeSoil = (/** @type {Plant} */ plant, /** @type {string} */ id) => {
			const grown = plant.grow(plant.stages.length - 1, id);
			const b = bounds(grown);
			toss(grown);
			const below = Math.max(0, -b.min.y);
			const half = Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z));
			// a round floor, wide round the plant and its roots
			ground.r = Math.max(below * 1.1, half * 1.6 + Math.max(below, half) * 0.15) + 0.02;
			ground.d = below * 1.12 + 0.02;
			earth.scale.set(ground.r, ground.d, ground.r);
			earth.position.y = -ground.d / 2;
			grain.repeat.set(Math.max(1, (ground.r * Math.PI * 2) / 0.06), Math.max(1, ground.d / 0.06));
			surfaceGrain.repeat.set(Math.max(1, (ground.r * 2) / 0.06), Math.max(1, (ground.r * 2) / 0.06));
		};

		/** frame the plant as it is now (close in), or the whole earth and the plant over it */
		reframe = (/** @type {Frame} */ mode) => {
			if (!plantBox) return;
			const all = plantBox.clone();
			if (mode === 'whole') all.union(new THREE.Box3(new THREE.Vector3(-ground.r, -ground.d, -ground.r), new THREE.Vector3(ground.r, 0, ground.r)));
			else all.expandByScalar(0.004);
			goal.mid.copy(all.getCenter(new THREE.Vector3()));
			const s = all.getSize(new THREE.Vector3());
			goal.reach = Math.max(0.012, s.x, s.y, s.z);
			easing = 1;
			if (first) {
				first = false;
				controls.target.copy(goal.mid);
				camera.position.copy(goal.mid).add(new THREE.Vector3(0.9, 0.45, 1.25).normalize().multiplyScalar(goal.reach * 2.1));
			}
			// the sun's shadows over what is framed
			key.position.copy(goal.mid).add(new THREE.Vector3(1.2, 2.2, 0.9).multiplyScalar(goal.reach));
			key.target.position.copy(goal.mid);
			const sh = key.shadow.camera;
			sh.left = sh.bottom = -goal.reach * 1.2;
			sh.right = sh.top = goal.reach * 1.2;
			sh.near = goal.reach * 0.1;
			sh.far = goal.reach * 6;
			sh.updateProjectionMatrix();
		};

		/** which fruit it bears, grown ripe: once a plant, version and seed */
		let fruitFor = '';
		show = (plant, at, id) => {
			if (current) {
				scene.remove(current);
				toss(current);
				current = null;
			}
			const whose = `${plant.id}|${plant.version}|${id}`;
			if (fruitFor !== whose) {
				fruitFor = whose;
				fruit = fruitOf(plant.grow, plant.stages.length - 1, id || ' ');
			}
			// a plant (or a version of it) with no fruit is shown whole
			if (view === 'fruit' && !fruit) view = 'plant';
			earth.visible = view === 'plant';
			if (view === 'fruit') {
				const one = fruit && oneFruit(plant.grow, at, id || ' ', fruit.pick);
				unset = !one;
				if (!one) {
					plantBox = null;
					size = null;
					return;
				}
				current = one;
				scene.add(current);
				const b = bounds(current);
				plantBox = b;
				size = { above: b.max.y - b.min.y, below: 0, across: Math.max(b.max.x - b.min.x, b.max.z - b.min.z) };
				reframe?.(frame);
				return;
			}
			unset = false;
			if (soilFor !== `${plant.id}|${id}`) {
				soilFor = `${plant.id}|${id}`;
				sizeSoil(plant, id || ' ');
			}
			current = plant.grow(at, id || ' ');
			scene.add(current);
			const b = bounds(current);
			plantBox = b;
			size = { above: Math.max(0, b.max.y), below: Math.max(0, -b.min.y), across: Math.max(b.max.x - b.min.x, b.max.z - b.min.z) };
			reframe?.(frame);
		};

		const resize = () => {
			const w = box.clientWidth, h = box.clientHeight;
			renderer.setSize(w, h);
			fit(camera, w, h);
		};
		const ro = new ResizeObserver(resize);
		ro.observe(box);
		resize();
		show(grown, g, seed);

		let raf = 0;
		let then = performance.now();
		let built = 0;
		const tick = () => {
			const now = performance.now();
			const dt = Math.min(0.1, (now - then) / 1000);
			then = now;
			// growing on: a little further each frame, the plant regrown a dozen times a second
			if (playing) {
				g = Math.min(last, g + dt * 0.5);
				if (now - built > 80 || g >= last) {
					built = now;
					show?.(grown, g, seed);
				}
				if (g >= last) playing = false;
			}
			// the camera eases to the new framing, keeping the way it looks from
			if (easing > 0.001) {
				const k = 1 - Math.exp(-dt * 5);
				const look = camera.position.clone().sub(controls.target);
				const dist = look.length();
				controls.target.lerp(goal.mid, k);
				const want = goal.reach * 2.1;
				look.setLength(dist + (want - dist) * k);
				camera.position.copy(controls.target).add(look);
				easing = Math.abs(want - dist) / want + controls.target.distanceTo(goal.mid) / want;
			}
			camera.near = Math.max(0.0005, goal.reach / 200);
			camera.far = goal.reach * 80;
			camera.updateProjectionMatrix();
			controls.update();
			renderer.render(scene, camera);
			raf = requestAnimationFrame(tick);
		};
		tick();
		dispose = () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			controls.dispose();
			if (current) current.traverse((o) => /** @type {import('three').Mesh} */ (o).geometry?.dispose());
			renderer.dispose();
			renderer.domElement.remove();
		};
	});
	onDestroy(() => dispose?.());

	/**
	 * Earth: dark crumbs and pale grit on brown, drawn once.
	 * @param {typeof import('three')} THREE
	 */
	function soilTexture(THREE) {
		const c = document.createElement('canvas');
		c.width = c.height = 256;
		const x = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
		x.fillStyle = '#9c7a58';
		x.fillRect(0, 0, 256, 256);
		let s = 7;
		const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
		for (let i = 0; i < 2600; i++) {
			const r = rnd() * 2.6 + 0.4;
			const tone = rnd();
			x.fillStyle = tone < 0.55 ? `rgba(40,26,16,${0.25 + rnd() * 0.4})` : tone < 0.9 ? `rgba(120,92,62,${0.3 + rnd() * 0.4})` : `rgba(214,200,170,${0.35 + rnd() * 0.4})`;
			x.beginPath();
			x.arc(rnd() * 256, rnd() * 256, r, 0, Math.PI * 2);
			x.fill();
		}
		const t = new THREE.CanvasTexture(c);
		t.wrapS = t.wrapT = THREE.RepeatWrapping;
		t.colorSpace = THREE.SRGBColorSpace;
		return t;
	}

	/** keep where we are in the address, to share or come back to */
	const remember = () => {
		const url = new URL(page.url);
		url.searchParams.set('plant', chosen.id);
		url.searchParams.set('stage', String(stage + 1));
		url.searchParams.set('seed', seed);
		if (view === 'fruit') url.searchParams.set('view', 'fruit');
		else url.searchParams.delete('view');
		if (version !== chosen.version) url.searchParams.set('v', String(version));
		else url.searchParams.delete('v');
		try {
			replaceState(url, {});
		} catch {
			// before the router is up: nothing to keep yet
		}
	};
	const regrow = () => {
		show?.(grown, g, seed);
		remember();
	};

	const pick = (/** @type {Plant} */ p) => {
		chosen = p;
		version = p.version;
		playing = false;
		g = Math.min(g, p.stages.length - 1);
		regrow();
	};
	/** the whole plant, or its fruit alone — from the fruit's set on */
	const see = (/** @type {View} */ v) => {
		view = v;
		playing = false;
		if (v === 'fruit' && g < FRUIT) g = last;
		regrow();
	};
	const pickVersion = (/** @type {number} */ v) => {
		version = v;
		regrow();
	};
	const goTo = (/** @type {number} */ k) => {
		playing = false;
		g = Math.min(last, Math.max(view === 'fruit' ? FRUIT : 0, k));
		regrow();
	};
	const grow = () => {
		if (playing) {
			playing = false;
			g = Math.round(g);
			return regrow();
		}
		if (g >= last) g = view === 'fruit' ? FRUIT : 0;
		playing = true;
	};
	const reseed = (/** @type {string} */ id) => {
		seed = id;
		regrow();
	};
	/** ← → step a stage, 1 – 9 and 0 (the tenth) jump to one, space grows — unless typing a seed id */
	const onKey = (/** @type {KeyboardEvent} */ e) => {
		const t = /** @type {HTMLElement | null} */ (e.target);
		if (t?.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.key === 'ArrowRight') goTo(Math.floor(g) + 1);
		else if (e.key === 'ArrowLeft') goTo(Math.ceil(g) - 1);
		else if (/^[0-9]$/.test(e.key)) goTo(e.key === '0' ? 9 : Number(e.key) - 1);
		else if (e.key === ' ' && t?.tagName !== 'BUTTON') grow();
		else return;
		e.preventDefault();
	};

	const measure = (/** @type {number} */ v) => (v < 0.01 ? `${(v * 1000).toFixed(1)} mm` : v < 1 ? `${(v * 100).toFixed(v < 0.1 ? 1 : 0)} cm` : `${v.toFixed(2)} m`);
</script>

<svelte:head>
	<title>Plants · maiaCITY</title>
</svelte:head>

<svelte:window onkeydown={onKey} />

<Turntable
	name="plants"
	bind:canvas={canvasBox}
	picks={{ title: 'Plants', lede: 'Grown from code, seed to fruit, roots and all, in the seven layers of a food forest: tab through the ten stages, change the seed id for a sister plant.', items: PLANTS, chosen, where: (/** @type {Plant} */ p) => p.from, onpick: pick, group: (/** @type {Plant} */ p) => LAYERS.find((l) => l.id === p.layer)?.label ?? '', version, onversion: pickVersion }}
>
	{#snippet bar()}
		<div class="chips stages" role="tablist" aria-label="{chosen.label}: stages">
			<button class="chip grow" class:on={playing} onclick={grow} title="Grow on from here (space)">{playing ? 'Pause' : 'Grow ▸'}</button>
			{#each chosen.stages as s, k (s.name)}
				{#if k === 6}<span class="fruit-mark" aria-hidden="true">Fruit</span>{/if}
				<button role="tab" class="chip" class:fruit={k >= 6} class:on={!playing && stage === k} class:past={k < g} aria-selected={stage === k} disabled={view === 'fruit' && k < FRUIT} onclick={() => goTo(k)}>
					<small>{k + 1}</small>{s.name}
				</button>
			{/each}
		</div>
	{/snippet}
	{#snippet panel()}
		<div class="chips views" role="tablist" aria-label="Show">
			<span class="label">Show</span>
			<button role="tab" class="chip" class:on={view === 'plant'} aria-selected={view === 'plant'} onclick={() => see('plant')}>Plant</button>
			<button role="tab" class="chip" class:on={view === 'fruit'} aria-selected={view === 'fruit'} disabled={!fruit} title={fruit ? 'One fruit on its own, picked and shaped by the seed' : 'This plant bears no fruit'} onclick={() => see('fruit')}>Fruit</button>
		</div>
		<div class="seed">
			<span class="label">Seed</span>
			<code title="The same seed id grows the same plant every time">{seed}</code>
			<button class="dice" onclick={() => reseed(freshSeed())}>New seed</button>
		</div>
	{/snippet}
	{#snippet readout()}
		<b>{chosen.label}{view === 'fruit' ? ' · one fruit' : ''} · {chosen.stages[stage].name} <em>{chosen.latin}</em></b>
		<small>{view === 'fruit' && unset ? 'This fruit has not set yet.' : chosen.stages[stage].note}</small>
		<span>
			Day {day}
			{#if size && view === 'fruit'} · {measure(size.above)} long, stalk and all · {measure(size.across)} across{:else if size} · {measure(size.above)} above the soil · {measure(size.below)} below · {measure(size.across)} across{/if}
		</span>
		<small class="keys">← → or 1 – 0 for the stages · space grows · drag to turn round it · scroll to come closer</small>
	{/snippet}
</Turntable>

<style>
	/* the ten stages, in a row across the top, the fruit's four marked off, Grow first */
	.stages .chip {
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
		flex: none;
	}

	.fruit-mark {
		flex: none;
		margin: 0 0.1rem 0 0.4rem;
		padding-left: 0.6rem;
		border-left: 1px solid rgb(0 0 0 / 0.15);
		font-size: 0.68rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #a3312a;
	}

	.stages .chip.fruit:not(.on) {
		border-color: rgb(163 49 42 / 0.3);
	}

	.stages .chip small {
		font-size: 0.7rem;
		opacity: 0.5;
	}

	.stages .chip.past:not(.on) {
		background: #e3ead9;
	}

	.stages .grow,
	.stages .grow.on {
		background: #3d6b2e;
		border-color: #3d6b2e;
		color: #fff;
	}

	.stages .grow.on {
		background: #8a5a2b;
		border-color: #8a5a2b;
	}

	/* the whole plant or one fruit, before the stages */
	.views {
		margin-bottom: 0.5rem;
	}

	.views .chip:disabled,
	.stages .chip:disabled {
		opacity: 0.35;
		cursor: default;
	}

	/* the seed id it grew from, and a new one at random */
	.seed {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.seed code {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dice {
		flex: none;
		padding: 0.3rem 0.65rem;
		border: 1px solid #3d6b2e;
		border-radius: 999px;
		background: #3d6b2e;
		color: #fff;
	}

	em {
		margin-left: 0.3rem;
		font-weight: 400;
		opacity: 0.55;
	}

	/* no keyboard on a phone */
	@media (hover: none) and (pointer: coarse) {
		.keys {
			display: none;
		}
	}
</style>

<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// Figure 3: the whole family of demurrage curves as one surface, B(t, r) = e^(−r t): time runs to 50 years, the
	// rate from 0 to 15 % a year, the height is what is left of one HEART. The terracotta line is the chosen rate;
	// drag to turn the surface.
	import { onMount } from 'svelte';

	let { rate = 0.07 } = $props();

	const T = 50, RMAX = 0.15, SX = 10, SZ = 6, SY = 4; // world size of the plot box
	let box;
	let ticks = $state([]);
	let setRate = () => {};

	$effect(() => setRate(rate));

	onMount(() => {
		let stage, cancelled = false;
		Promise.all([import('./stage.js'), import('three/examples/jsm/controls/OrbitControls.js')]).then(([{ createStage }, { OrbitControls }]) => {
			if (cancelled) return;
			stage = createStage(box, { fov: 34, position: [15, 10, 17], target: [0, 1.4, 0] });
			const { THREE, scene, camera, renderer } = stage;

			// the surface, coloured by height on one green ramp (light = little left, dark = all of it)
			const NX = 100, NZ = 60;
			const geo = new THREE.PlaneGeometry(SX, SZ, NX, NZ);
			geo.rotateX(-Math.PI / 2);
			const pos = geo.attributes.position, colors = [];
			const lo = new THREE.Color(0xe9eedd), hi = new THREE.Color(0x1f5a3c), c = new THREE.Color();
			for (let i = 0; i < pos.count; i++) {
				const t = ((pos.getX(i) + SX / 2) / SX) * T;
				const r = ((pos.getZ(i) + SZ / 2) / SZ) * RMAX;
				const b = Math.exp(-r * t);
				pos.setY(i, b * SY);
				c.copy(lo).lerp(hi, b);
				colors.push(c.r, c.g, c.b);
			}
			geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
			geo.computeVertexNormals();
			scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 })));

			// the floor and the back walls of the plot box
			const grid = new THREE.GridHelper(SX, 10, 0xc9c0aa, 0xdcd5c4);
			grid.scale.z = SZ / SX;
			scene.add(grid);
			const edges = new THREE.LineSegments(
				new THREE.BufferGeometry().setFromPoints([
					new THREE.Vector3(-SX / 2, 0, -SZ / 2), new THREE.Vector3(-SX / 2, SY, -SZ / 2),
					new THREE.Vector3(-SX / 2, SY, -SZ / 2), new THREE.Vector3(SX / 2, SY, -SZ / 2),
					new THREE.Vector3(-SX / 2, 0, SZ / 2), new THREE.Vector3(-SX / 2, SY, SZ / 2)
				]),
				new THREE.LineBasicMaterial({ color: 0x9a9a88 })
			);
			scene.add(edges);

			// the chosen rate, as a tube lying on the surface
			let line;
			setRate = (r) => {
				if (line) {
					scene.remove(line);
					line.geometry.dispose();
				}
				const z = (r / RMAX) * SZ - SZ / 2;
				const pts = Array.from({ length: 80 }, (_, i) => {
					const t = (i / 79) * T;
					return new THREE.Vector3((t / T) * SX - SX / 2, Math.exp(-r * t) * SY + 0.04, z);
				});
				line = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.06, 8), new THREE.MeshStandardMaterial({ color: 0xc8744f, roughness: 0.4 }));
				scene.add(line);
				stage.redraw();
			};
			setRate(rate);

			const controls = new OrbitControls(camera, renderer.domElement);
			controls.target.set(0, 1.4, 0);
			controls.enableZoom = false;
			controls.enablePan = false;
			controls.enableDamping = true;
			controls.autoRotate = !stage.still;
			controls.autoRotateSpeed = 0.6;
			controls.minPolarAngle = 0.3;
			controls.maxPolarAngle = Math.PI / 2.05;
			controls.addEventListener('change', () => stage.redraw());

			const marks = [
				...[0, 10, 20, 30, 40, 50].map((t) => ({ id: `t${t}`, p: new THREE.Vector3((t / T) * SX - SX / 2, 0, SZ / 2 + 0.5), text: `${t} y` })),
				...[0, 0.05, 0.1, 0.15].map((r) => ({ id: `r${r}`, p: new THREE.Vector3(SX / 2 + 0.6, 0, (r / RMAX) * SZ - SZ / 2), text: `${Math.round(r * 100)} %` })),
				...[0.5, 1].map((b) => ({ id: `b${b}`, p: new THREE.Vector3(-SX / 2 - 0.3, b * SY, -SZ / 2), text: `${b * 100} %` })),
				{ id: 'tl', p: new THREE.Vector3(0, 0, SZ / 2 + 1.3), text: 'time held', axis: true },
				{ id: 'rl', p: new THREE.Vector3(SX / 2 + 1.6, 0, 0), text: 'demurrage rate', axis: true },
				{ id: 'bl', p: new THREE.Vector3(-SX / 2 - 0.3, SY + 0.6, -SZ / 2), text: 'value left', axis: true }
			];
			stage.loop(() => {
				controls.update();
				ticks = marks.map((m) => ({ ...m, ...stage.project(m.p) }));
			});
		});
		return () => {
			cancelled = true;
			stage?.dispose();
		};
	});
</script>

<div class="scene" bind:this={box}>
	{#each ticks as t (t.id)}
		{#if !t.behind}<span class:axis={t.axis} style:left="{t.x}px" style:top="{t.y}px">{t.text}</span>{/if}
	{/each}
</div>

<style>
	.scene {
		position: relative;
		height: clamp(300px, 50vw, 460px);
		border-radius: 14px;
		font-family: var(--font-body);
		background: linear-gradient(180deg, #fbf9f3, #f1ede3);
		overflow: hidden;
		cursor: grab;
	}

	.scene :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
		touch-action: pan-y;
	}

	span {
		position: absolute;
		transform: translate(-50%, -50%);
		font-size: 0.68rem;
		color: var(--muted);
		pointer-events: none;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	span.axis {
		font-size: 0.74rem;
		font-style: italic;
		color: var(--ink-soft);
	}
</style>

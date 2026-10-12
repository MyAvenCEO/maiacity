<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// Figure 1: the loop of theOS, live. People on the outer ring send their daily HEARTS (terracotta) into the
	// cooperatives in the middle; every HEART that lands is invested and creates the COOP's MIND in two halves: one half flies
	// back to its investor (gold), the other sinks into the COOP's treasury (its ring grows). Everything shrinks a
	// little as it travels: demurrage. Every few seconds one COOP turns extractive; the avens notice and route around it.
	import { onMount } from 'svelte';

	const COOPS = [
		{ id: 'SOLAR', color: 0xd99a2b },
		{ id: 'AGRI', color: 0x5f8f4a },
		{ id: 'WATER', color: 0x3f7fb8 },
		{ id: 'COMPUTE', color: 0x7a5aa8 },
		{ id: 'ART', color: 0xc8744f },
		{ id: 'HABITAT', color: 0x8a7a5a }
	];

	let box;
	let labels = $state(COOPS.map((c) => ({ id: c.id, x: 0, y: 0, share: 1 / COOPS.length, bad: false })));

	onMount(() => {
		let stage, cancelled = false;
		import('./stage.js').then(({ createStage }) => {
			if (cancelled) return;
			stage = createStage(box, { fov: 38, position: [0, 12, 21] });
			const { THREE, scene } = stage;

			const R_PEOPLE = 9, R_COOP = 3.6, N_PEOPLE = 54;

			// the ground: a soft disc, and the faint orbit rings
			const ground = new THREE.Mesh(new THREE.CircleGeometry(11, 96), new THREE.MeshStandardMaterial({ color: 0xece6d6, roughness: 1 }));
			ground.rotation.x = -Math.PI / 2;
			ground.position.y = -0.02;
			scene.add(ground);
			for (const r of [R_COOP, R_PEOPLE]) {
				const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.02, r + 0.02, 128), new THREE.MeshBasicMaterial({ color: 0xc9c0aa }));
				ring.rotation.x = -Math.PI / 2;
				scene.add(ring);
			}

			const people = Array.from({ length: N_PEOPLE }, (_, i) => {
				const a = (i / N_PEOPLE) * Math.PI * 2;
				const m = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), new THREE.MeshStandardMaterial({ color: 0x26382c, roughness: 0.6 }));
				m.position.set(Math.cos(a) * R_PEOPLE, 0.17, Math.sin(a) * R_PEOPLE);
				scene.add(m);
				return m;
			});

			const coops = COOPS.map((c, i) => {
				const a = (i / COOPS.length) * Math.PI * 2 + Math.PI / 6;
				const g = new THREE.Group();
				g.position.set(Math.cos(a) * R_COOP, 0, Math.sin(a) * R_COOP);
				const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.45, flatShading: true }));
				core.position.y = 0.75;
				const treasury = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.06, 10, 64), new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.7, transparent: true, opacity: 0.75 }));
				treasury.rotation.x = Math.PI / 2;
				treasury.position.y = 0.08;
				g.add(core, treasury);
				scene.add(g);
				return { ...c, g, core, treasury, pool: 1, efficiency: 1, weight: 1 };
			});

			// the HEARTS and MINDs in flight, one instanced mesh
			const MAX = 900;
			const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 8, 6), new THREE.MeshBasicMaterial(), MAX);
			dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
			scene.add(dots);
			const live = [];
			const HEART = new THREE.Color(0xc8744f), MIND = new THREE.Color(0xd9a520), SINK = new THREE.Color(0x26382c);

			const pick = () => {
				const total = coops.reduce((n, c) => n + c.weight, 0);
				let r = Math.random() * total;
				for (const c of coops) if ((r -= c.weight) <= 0) return c;
				return coops[0];
			};
			const send = (kind, from, to, coop, t0 = 0) => {
				if (live.length < MAX) live.push({ kind, from: from.clone(), to: to.clone(), coop, t: t0, speed: 0.55 + Math.random() * 0.35, size: 1 });
			};
			const spawnHeart = (t0 = 0) => {
				const p = people[(Math.random() * N_PEOPLE) | 0].position;
				const c = pick();
				send('heart', p, c.g.position.clone().setY(0.75), c, t0);
			};
			for (let i = 0; i < 160; i++) spawnHeart(Math.random());

			const m4 = new THREE.Matrix4(), v = new THREE.Vector3(), mid = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
			let clock = 0, emit = 0, regime = 0, badIndex = -1, angle = 0;

			stage.loop((dt) => {
				clock += dt;
				angle += dt * 0.05;
				stage.camera.position.set(Math.sin(angle) * 21, 12, Math.cos(angle) * 21);
				stage.camera.lookAt(0, 0.4, 0);

				// every 9 s one COOP turns extractive for a while: what it gives back for a HEART drops
				regime += dt;
				if (regime > 9) {
					regime = 0;
					badIndex = badIndex === -1 ? (Math.random() * coops.length) | 0 : -1;
					coops.forEach((c, i) => (c.efficiency = i === badIndex ? 0.35 : 1));
				}
				// the avens route towards the value a HEART buys, smoothly
				for (const c of coops) c.weight += (c.efficiency ** 3 - c.weight) * Math.min(1, dt * 0.9);

				emit += dt * 70;
				while (emit > 1) {
					emit--;
					spawnHeart();
				}

				let n = 0;
				for (let i = live.length - 1; i >= 0; i--) {
					const d = live[i];
					d.t += dt * d.speed;
					d.size *= Math.exp(-0.07 * dt * 4); // demurrage, sped up so it can be seen
					if (d.t >= 1) {
						live.splice(i, 1);
						if (d.kind === 'heart') {
							// invested: creates MIND, half to the investor, half to the treasury
							const home = people[(Math.random() * N_PEOPLE) | 0].position;
							if (Math.random() < d.coop.efficiency) send('mind', d.to, home.clone().setY(0.25), d.coop);
							send('sink', d.to, d.coop.g.position.clone().setY(0.08), d.coop);
						} else if (d.kind === 'sink') d.coop.pool += 0.06;
						continue;
					}
					if (n >= MAX) continue;
					mid.addVectors(d.from, d.to).multiplyScalar(0.5);
					mid.y += d.kind === 'sink' ? 0.2 : d.from.distanceTo(d.to) * 0.28;
					const t = d.t, u = 1 - t;
					v.set(0, 0, 0).addScaledVector(d.from, u * u).addScaledVector(mid, 2 * u * t).addScaledVector(d.to, t * t);
					const sc = d.size * (d.kind === 'sink' ? 0.8 : 1);
					m4.compose(v, q, s.set(sc, sc, sc));
					dots.setMatrixAt(n, m4);
					dots.setColorAt(n, d.kind === 'heart' ? HEART : d.kind === 'mind' ? MIND : SINK);
					n++;
				}
				dots.count = n;
				dots.instanceMatrix.needsUpdate = true;
				if (dots.instanceColor) dots.instanceColor.needsUpdate = true;

				// treasuries melt at the same 7 %, sped up, and grow with what sinks in
				const total = coops.reduce((k, c) => k + c.weight, 0);
				coops.forEach((c) => {
					c.pool *= Math.exp(-0.28 * dt);
					const r = 0.55 + Math.min(1.4, Math.sqrt(c.pool) * 0.32);
					c.treasury.scale.set(r, r, 1);
					c.core.rotation.y += dt * 0.6 * c.efficiency;
					c.core.material.emissive?.setHex(c.efficiency < 1 ? 0x3a0f00 : 0x000000);
				});

				labels = coops.map((c) => {
					const p = stage.project(c.g.position.clone().setY(1.55));
					return { id: c.id, x: p.x, y: p.y, share: c.weight / total, bad: c.efficiency < 1 };
				});
			});
		});
		return () => {
			cancelled = true;
			stage?.dispose();
		};
	});
</script>

<div class="scene" bind:this={box}>
	{#each labels as l (l.id)}
		<span class="tag" class:bad={l.bad} style:left="{l.x}px" style:top="{l.y}px">
			{l.id}<small>mind · {Math.round(l.share * 100)}%</small>
		</span>
	{/each}
	<div class="keys" aria-hidden="true">
		<span><i class="h"></i>HEARTS, sent by people</span>
		<span><i class="m"></i>MIND, half back to the investor</span>
		<span><i class="s"></i>MIND, half into the COOP's treasury</span>
	</div>
</div>

<style>
	.scene {
		position: relative;
		height: clamp(320px, 56vw, 520px);
		border-radius: 14px;
		font-family: var(--font-body);
		background: radial-gradient(circle at 50% 40%, #fbf9f3, #ece6d6);
		overflow: hidden;
	}

	.scene :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}

	.tag {
		position: absolute;
		transform: translate(-50%, -100%);
		display: grid;
		justify-items: center;
		padding: 0.15rem 0.45rem;
		border-radius: 6px;
		background: rgb(250 248 242 / 0.88);
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		color: var(--ink);
		pointer-events: none;
		white-space: nowrap;
	}

	.tag small {
		font-weight: 400;
		letter-spacing: 0;
		color: var(--ink-soft);
		font-variant-numeric: tabular-nums;
	}

	.tag.bad {
		background: #f6dcd0;
	}

	.tag.bad small::after {
		content: ' · extractive';
		color: #9a3d1a;
	}

	.keys {
		position: absolute;
		padding: 0.4rem 0.6rem;
		border-radius: 8px;
		background: rgb(250 248 242 / 0.85);
		left: 0.75rem;
		bottom: 0.6rem;
		display: grid;
		gap: 0.1rem;
		font-size: 0.7rem;
		color: var(--ink-soft);
	}

	.keys i {
		display: inline-block;
		width: 8px;
		height: 8px;
		margin-right: 0.4rem;
		border-radius: 50%;
	}

	.h {
		background: #c8744f;
	}

	.m {
		background: #d9a520;
	}

	.s {
		background: #26382c;
	}
</style>

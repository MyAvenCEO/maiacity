<!--
	Factories: every production line we build (src/lib/factories), one at a time as a live 3D miniature on a real
	discrete event simulation — AirSup's factory skill (.claude/skills/factory-skill), its runtime ported into
	$lib/factories. Its HUD is AirSup's (hud.css, scoped to this page): the day's output against the target, every
	station's busy, blocked, down and starved, the bottleneck, an inspector with the sizing rule and the what-ifs
	(machines, cycle time, uptime). What the line builds is our own asset, by its ref (the BatteryPack): the page builds
	it with objectAt and hands it to the world as the token every pack on the belts, in the tester and on the pallets
	is an instance of. `?factory=<id>` picks a line once there are more than one; AirSup's own queries still work
	(`?select=load`, `?assemble=0`, `?film=1`). Full screen, the nav pill over it. An admin's.
-->
<script>
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { FACTORIES } from '$lib/factories/index.js';
	import '$lib/factories/hud.css';

	/** @type {HTMLDivElement} */
	let host;
	let error = $state('');

	const wanted = page.url.searchParams.get('factory');
	const factory = FACTORIES.find((f) => f.id === wanted) ?? FACTORIES[0];

	onMount(() => {
		/** @type {{ dispose: () => void } | undefined} */
		let app;
		let gone = false;
		(async () => {
			try {
				const [{ boot }, { tokenOf }] = await Promise.all([import('$lib/factories/app.js'), import('$lib/factories/assets.js')]);
				const spec = factory.build();
				// every stage drawn as one of our assets: built once, by its ref, before the hall is built
				/** @type {Record<string, import('$lib/factories/assets.js').Token>} */
				const assets = {};
				for (const def of Object.values(spec.stages)) {
					const d = /** @type {{ shape: string, ref?: string }} */ (def);
					if (d.shape === 'asset' && d.ref && !assets[d.ref]) assets[d.ref] = await tokenOf(d.ref);
				}
				if (gone) return;
				app = boot(spec, host, { assets });
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
			}
		})();
		return () => {
			gone = true;
			app?.dispose();
		};
	});
</script>

<svelte:head>
	<title>{factory.label} · Factories · maiaCITY</title>
</svelte:head>

<div class="factory" bind:this={host}></div>
{#if error}<p class="bad">The factory could not be built: {error}</p>{/if}

<style>
	/* the host: the page, under the nav pill; the runtime fills it with its canvas and HUD (.fs-root, hud.css) */
	.factory {
		position: fixed;
		inset: 0;
		background: #ece6da;
	}
	.bad {
		position: fixed;
		left: 50%;
		top: 40%;
		transform: translateX(-50%);
		max-width: 36rem;
		padding: 0.8rem 1.1rem;
		border-radius: 12px;
		background: #fff;
		color: #c23a22;
		font: 500 0.95rem/1.4 var(--font-sans, system-ui, sans-serif);
		z-index: 5;
	}
</style>

<!--
	A sandbox's old address (/games/<sandbox>/, src/routes/games/[world=world]): it passes on to the sandbox in the app — except with ?film, when it is
	the film camera (FilmWorld): the world alone, for the area the address names (&area=…, game/film/worlds.js), under
	the film's clocks, for the studio's world viewer and the plate renderers. Its assets' recipes are the Maia City
	vault's: the world is raised once they are in, and a film says so when they can't be ($lib/assets/VaultRecipes.svelte).
-->
<script>
	import Moved from '$lib/app/Moved.svelte';
	import { onMount } from 'svelte';
	import FilmWorld from './FilmWorld.svelte';
	import VaultRecipes from '$lib/assets/VaultRecipes.svelte';
	import { useView } from '../../../game/code/sources/device.js';
	import { localDevice } from '$lib/avendb/local.js';
	import { watchRecipes } from '$lib/assets/vault.js';
	import { forwardConsole } from '$lib/native';
	import { WORLDS } from '../../../game/film/worlds.js';

	/**
	 * @type {{
	 *   sandbox: import('../../../game/film/worlds.js').Sandbox,
	 *   mount: (stage: HTMLElement, area: string | undefined, onProgress: (label: string) => void) => Promise<{ dispose: () => void }>
	 * }}
	 */
	let { sandbox, mount } = $props();
	/** where the address passes on to: the world's own page in the app (the registry's route) */
	const to = $derived(WORLDS[sandbox]?.route ?? '/app/');

	/** null until the page knows its own address (it is prerendered without one) */
	let film = $state(/** @type {boolean | null} */ (null));
	/** @type {string | undefined} */
	let area = $state();
	onMount(() => {
		const q = new URLSearchParams(location.search);
		area = q.get('area') ?? WORLDS[sandbox]?.areas?.[0];
		if (!q.has('film')) return void (film = false);
		// the person's own avenDB first: the Mac's world renderer is a window of its own (vault/app/src/world.rs), whose
		// page finds the app's device only once it asks
		forwardConsole(window, 'film bootstrap');
		const w = /** @type {any} */ (window);
		w.__filmLoadLabel = 'Connecting to local avenDB…';
		const unwatch = watchRecipes((/** @type {any} */ r) => {
			if (r.phase === 'failed') w.__filmMountError = r.error || 'The asset recipes could not load';
			else if (r.unread.length || r.missed.length) w.__filmMountError = [...r.unread, ...r.missed].join('; ');
			else if (r.phase !== 'ready') w.__filmLoadLabel = r.waiting ? 'Waiting for avenDB to supply the asset recipes…' : 'Reading asset recipes from avenDB…';
		});
		void localDevice().then((device) => {
			if (!device) throw new Error('Local avenDB is not connected. Unlock this device and retry the world.');
			void useView(WORLDS[sandbox]?.route ?? location.pathname);
			film = true;
		}).catch((e) => {
			w.__filmMountError = `Connecting to avenDB failed: ${e.message ?? e}`;
		});
		return unwatch;
	});
	const known = $derived(!area || !!WORLDS[sandbox]?.areas?.includes(area));
</script>

{#if film && known}
	<VaultRecipes><FilmWorld title="{WORLDS[sandbox]?.label ?? sandbox}{area ? ` · ${area}` : ''}" mount={(stage, onProgress) => mount(stage, area, onProgress)} /></VaultRecipes>
{:else if film}
	<p>{sandbox} has no area “{area}”: one of {WORLDS[sandbox]?.areas?.join(', ')}.</p>
{:else if film === false}
	<Moved {to} />
{/if}

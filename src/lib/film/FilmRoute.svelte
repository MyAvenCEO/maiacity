<!--
	A sandbox's old address (/games/<sandbox>/): it passes on to the sandbox in the app — except with ?film, when it is
	the film camera (FilmWorld): the world alone, for the area the address names (&area=…, game/film/worlds.js), under
	the film's clocks, for the studio's world viewer and the plate renderers.
-->
<script>
	import Moved from '$lib/app/Moved.svelte';
	import { onMount } from 'svelte';
	import FilmWorld from './FilmWorld.svelte';
	import { WORLDS } from '../../../game/film/worlds.js';

	/**
	 * @type {{
	 *   sandbox: string,
	 *   to: string,
	 *   mount: (stage: HTMLElement, area: string | undefined, onProgress: (label: string) => void) => Promise<{ dispose: () => void }>
	 * }}
	 */
	let { sandbox, to, mount } = $props();

	/** null until the page knows its own address (it is prerendered without one) */
	let film = $state(/** @type {boolean | null} */ (null));
	/** @type {string | undefined} */
	let area = $state();
	onMount(() => {
		const q = new URLSearchParams(location.search);
		area = q.get('area') ?? WORLDS[sandbox]?.areas?.[0];
		film = q.has('film');
	});
	const known = $derived(!area || !!WORLDS[sandbox]?.areas?.includes(area));
</script>

{#if film && known}
	<FilmWorld title="{WORLDS[sandbox]?.label ?? sandbox}{area ? ` · ${area}` : ''}" mount={(stage, onProgress) => mount(stage, area, onProgress)} />
{:else if film}
	<p>{sandbox} has no area “{area}”: one of {WORLDS[sandbox]?.areas?.join(', ')}.</p>
{:else if film === false}
	<Moved {to} />
{/if}

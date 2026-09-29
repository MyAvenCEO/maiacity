<!--
	The old address of Sandbox 4 passes on to /app/games/sandbox-4/ — except with ?film: then it is the film camera
	(src/lib/film), the world alone under the film's clocks, for the studio's world viewer and the plate renderer.
-->
<script lang="ts">
	import Moved from '$lib/app/Moved.svelte';
	import FilmWorld from '$lib/film/FilmWorld.svelte';
	import { onMount } from 'svelte';

	/** null until the page knows its own address (it is prerendered without one) */
	let film = $state<boolean | null>(null);
	onMount(() => (film = new URLSearchParams(location.search).has('film')));
</script>

{#if film}
	<FilmWorld />
{:else if film === false}
	<Moved to="/app/games/sandbox-4/" />
{/if}

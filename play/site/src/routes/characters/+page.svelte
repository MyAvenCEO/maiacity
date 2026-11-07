<!--
	Characters, the people of Maia City (intent 89f3ad37): one group of the asset library as its own app, apart from the
	animals ($lib/app/AssetLibrary.svelte, group `characters`). Maia City's admins alone: anyone else is sent back home,
	as from /library/.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import AssetLibrary from '$lib/app/AssetLibrary.svelte';
	import { session } from '$lib/session.svelte';

	const admin = $derived(session.me?.level === 'admin');
	onMount(() => {
		if (!admin) void goto('/', { replaceState: true });
	});
</script>

{#if admin}
	<AssetLibrary group="characters" />
{/if}

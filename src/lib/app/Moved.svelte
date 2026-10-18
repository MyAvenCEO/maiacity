<!-- An old address: on to where the page lives now, its query and anchor kept (an invite link, a device code) — unless
     `to` names an anchor of its own (a page of avenDB's, `/app/#stories`), which the old query means nothing to. -->
<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let { to }: { to: string } = $props();
	onMount(() => goto(to.includes('#') ? `${base}${to}` : `${base}${to}${location.search}${location.hash}`, { replaceState: true }));
</script>

<svelte:head>
	<meta name="robots" content="noindex" />
</svelte:head>

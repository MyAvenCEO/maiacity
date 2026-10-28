<!-- An old address: on to where the page lives now, its query kept (an invite link, a device code), and its anchor too
     unless `to` names an anchor of its own (a page of avenDB's, `/app/#stories`) (./redirects.js `landing`). -->
<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { landing } from './redirects.js';

	let { to }: { to: string } = $props();
	onMount(() => goto(`${base}${landing(to, location.search, location.hash)}`, { replaceState: true }));
</script>

<svelte:head>
	<meta name="robots" content="noindex" />
</svelte:head>

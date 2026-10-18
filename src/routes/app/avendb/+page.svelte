<!--
	avenDB has no page of its own any more (Samuel 2026-10-18: one dashboard): an old link to it opens the dashboard,
	at the same place in it (its address after `#`).
-->
<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';

	onMount(() => goto(`${base}/app/${location.hash}`, { replaceState: true }));
</script>

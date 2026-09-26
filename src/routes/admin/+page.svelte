<!-- /admin/ has no page of its own: it opens the notebook. -->
<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	onMount(() => goto(`${base}/admin/ideas/`, { replaceState: true }));
</script>

<svelte:head>
	<title>Admin · maiaCITY</title>
	<meta name="robots" content="noindex" />
</svelte:head>

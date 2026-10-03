<!-- The board is the Stories page now: on to it, and an item it was asked to open (?item=<id>) on to its story's page. -->
<script>
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { storyHref } from '$lib/stories/stories.js';

	onMount(() => {
		const id = new URLSearchParams(location.search).get('item');
		goto(id ? storyHref(id) : `${base}/app/stories/`, { replaceState: true });
	});
</script>

<svelte:head>
	<meta name="robots" content="noindex" />
</svelte:head>

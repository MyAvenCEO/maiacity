<script>
	// The docs live in avenDB alone (Samuel 2026-10-18: "a purely avenDB route, not a public open file reference from the
	// main navbar"): the skills, the theOS paper and the avenDB architecture are drafts of the Maia City vault, read in
	// avenDB's Docs view ($lib/avendb/Docs.svelte). An old address of the Docs page goes there.
	import { onMount } from 'svelte';
	import { base } from '$app/paths';

	const to = `${base}/app/avendb/#docs`;
	onMount(() => location.replace(to));
</script>

<svelte:head>
	<title>Docs · maiaCITY</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="wrap">
	<p>The docs are in avenDB now: <a href={to}>open them there</a>.</p>
</main>

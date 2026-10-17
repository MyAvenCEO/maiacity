<!--
	An address of the journal or of inspire-me from before avenDB (/blog/…, /blog/inspire-me/…, /inspire-me/…): both live
	on the Maia Universe stream now, each day and each report a post of its channel (src/lib/avendb/seed.js). A list goes
	on to the stream on its channel; a day or a report to its post, found in the feed by the address it was brought in
	from (`postFrom`), or to its channel where the feed holds none.
-->
<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { postFrom, postHref } from '$lib/universe/posts.js';
	import { loadFeed, stream } from '$lib/universe/stream.svelte.js';

	/** @type {{ path: string }} the old address, without its leading slash: `blog/day-19-…`, `inspire-me/<slug>` */
	let { path } = $props();

	const parts = $derived(path.replace(/\/+$/, '').split('/').filter(Boolean));
	// /blog/inspire-me/… is inspire-me's, as /inspire-me/… is
	const inspire = $derived(parts[0] === 'inspire-me' || parts[1] === 'inspire-me');
	const rest = $derived(parts.slice(parts[1] === 'inspire-me' ? 2 : 1));
	const channel = $derived(inspire ? 'Inspire me' : 'Journal');
	// one day or one report (an author's page of inspire-me is the channel's)
	const from = $derived(rest.length === 1 && rest[0] !== 'preview' ? `${inspire ? 'inspire-me' : 'blog'}/${rest[0]}` : '');

	onMount(async () => {
		const stay = { replaceState: true };
		const toChannel = `${base}/universe/?c=${encodeURIComponent(channel)}`;
		if (!from) return goto(toChannel, stay);
		await loadFeed();
		const post = postFrom(stream.posts, from);
		goto(post ? postHref(base, post) : toChannel, stay);
	});
</script>

<svelte:head>
	<meta name="robots" content="noindex" />
</svelte:head>

<p class="moving">On to Maia Universe…</p>

<style>
	.moving {
		padding: 4rem 1rem;
		text-align: center;
		color: var(--ink-soft, #666);
	}
</style>

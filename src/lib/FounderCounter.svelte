<!--
	How many founders are building Maia City, live, as a number inside a sentence: the count from the API (the same
	one /join shows), read every half minute and counted up when it changes. Day 01 is one founder, so that is
	what it shows until (and unless) the API answers.
-->
<script>
	// @ts-nocheck — plain JS
	import { onMount } from 'svelte';
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import { founderCount } from '$lib/auth/client';

	let count = $state(1);
	const shown = new Tween(1, { duration: 1400, easing: cubicOut });

	onMount(() => {
		const read = () =>
			founderCount()
				.then((c) => {
					if (typeof c?.count === 'number' && c.count > 0) count = shown.target = c.count;
				})
				.catch(() => {});
		read();
		const timer = setInterval(read, 30_000);
		return () => clearInterval(timer);
	});
</script>

<span class="count" title="{count.toLocaleString('en-US')} {count === 1 ? 'founder' : 'founders'} so far, live"
	>{Math.round(shown.current).toLocaleString('en-US')}</span
>

<style>
	.count {
		font-variant-numeric: tabular-nums;
		color: var(--mustard);
	}
</style>

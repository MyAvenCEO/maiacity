<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	import { refNumbers } from './refs.js';

	let { k } = $props();
	const nums = $derived(refNumbers(k));
</script>

<span class="cite">[{#each nums as n, i (n)}{#if i}, {/if}<a href="#ref-{n}">{n}</a>{/each}]</span>

<style>
	.cite {
		font-size: 0.86em;
		color: var(--ink-soft);
		white-space: nowrap;
	}

	a {
		color: inherit;
		text-decoration: none;
		border-bottom: 1px dotted currentColor;
	}

	a:hover {
		color: var(--terracotta);
	}
</style>

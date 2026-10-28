<!--
	A cap's ops as chips: each in words, its JSON on hover (vaults.js's `opWords`), read plain and every other marked;
	with `ondrop`, each can be taken out.
-->
<script>
	import { opWords } from './vaults.js';

	/** @type {{ ops: import('./vaults.js').Op[], ondrop?: (i: number) => void }} */
	let { ops, ondrop } = $props();
</script>

<span class="ops" role="list" aria-label="Its ops">
	{#each ops as o, i (i)}
		<span class="chip op" class:accent={o.op !== 'read'} role="listitem" title={JSON.stringify(o)}>
			{opWords(o)}
			{#if ondrop}<button class="x" aria-label="Take out: {opWords(o)}" onclick={() => ondrop(i)}>×</button>{/if}
		</span>
	{/each}
</span>

<style>
	.ops {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		max-width: 60ch;
	}

	.op {
		white-space: normal;
	}

	.x {
		padding: 0 0.1rem;
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		cursor: pointer;
		opacity: 0.6;
	}

	.x:hover {
		opacity: 1;
	}
</style>

<script>
	// One node of a checked tree (brain/render/tree.js): text, or an element with its attributes and children. Nothing
	// is parsed as HTML here; the tree was checked against the allowlist before it got this far.
	import Node from './Node.svelte';

	let { node } = $props();
	const attrs = $derived(typeof node === 'string' ? {} : Object.fromEntries(node[1]));
</script>

{#if typeof node === 'string'}{node}{:else}<svelte:element this={node[0]} {...attrs}>{#each node[2] as kid, i (i)}<Node node={kid} />{/each}</svelte:element>{/if}

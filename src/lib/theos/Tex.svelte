<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// KaTeX, rendered while the page is prerendered: the formulas arrive as plain HTML, no script needed to read them
	import katex from 'katex';

	let { tex, display = false } = $props();
	const html = $derived(katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'htmlAndMathml' }));
</script>

{#if display}<div class="eq">{@html html}</div>{:else}{@html html}{/if}

<style>
	.eq {
		margin: 1.4rem 0;
		overflow-x: auto;
		overflow-y: hidden;
		padding: 0.2rem 0;
	}

	/* room on both sides for the equation number, so a long formula never runs into it */
	.eq :global(.katex-display > .katex > .katex-html:has(.tag)) {
		padding: 0 2.6rem;
	}
</style>

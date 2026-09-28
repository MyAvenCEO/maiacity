<!-- A channel as a tiny neutral glyph (no real logos): a page, a play box, "in", an X, a camera square. -->
<script lang="ts">
	import type { Platform } from '$lib/auth/client';
	import { PLATFORM_LABEL } from './board';

	let { platform }: { platform: Platform } = $props();
</script>

<svg viewBox="0 0 16 16" role="img" aria-label={PLATFORM_LABEL[platform]}>
	<title>{PLATFORM_LABEL[platform]}</title>
	{#if platform === 'journal'}
		<path d="M3.5 1.5h6l3 3v10h-9z" />
		<path d="M5.8 7.5h4.4M5.8 10h4.4M5.8 12.5h2.6" />
	{:else if platform === 'youtube'}
		<rect x="1" y="3" width="14" height="10" rx="3" />
		<path class="fill" d="M6.5 5.6v4.8L10.6 8z" />
	{:else if platform === 'linkedin'}
		<rect x="1.5" y="1.5" width="13" height="13" rx="2.5" />
		<path d="M5 7v4.5M5 4.6v.1M8 11.5V7m0 2a2 2 0 0 1 3.5-1.3v3.8" />
	{:else if platform === 'x'}
		<path d="M3 2.5l10 11M13 2.5l-10 11" />
	{:else}
		<rect x="1.5" y="1.5" width="13" height="13" rx="4" />
		<circle cx="8" cy="8" r="3" />
		<path d="M11.8 4.2v.1" />
	{/if}
</svg>

<style>
	svg {
		width: 0.9rem;
		height: 0.9rem;
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
		vertical-align: -0.15em;
	}

	.fill {
		fill: currentColor;
		stroke: none;
	}
</style>

<!--
	Where one file's copies are, at a glance: this Mac's store and the server (Object Storage) — each verified by its
	BLAKE3 hash, or still on its way. Two verified copies make a card safe to format.
-->
<script lang="ts">
	import { gb, verifiedCopies, type Copies } from './vault';

	let { c, wide = false }: { c: Copies; wide?: boolean } = $props();
	const n = $derived(verifiedCopies(c));
</script>

<span class="copies" class:wide title={`${n} verified cop${n === 1 ? 'y' : 'ies'} · ${c.hash}`}>
	<span class="dot {c.here}" title="This Mac ({c.location}): {c.here}{c.here === 'partial' ? ` ${gb(c.here_bytes)} of ${gb(c.size)}` : ''}">Mac</span>
	<span class="dot {c.server}" title="Server · Object Storage: {c.server}">Server</span>
	{#if wide}<span class="n">{n}/2 verified{n >= 2 ? ' · safe to format' : ''}</span>{/if}
</span>

<style>
	.copies { display: inline-flex; gap: 0.3rem; align-items: center; font-size: 0.68rem; }
	.dot { padding: 0.08rem 0.45rem; border-radius: 999px; border: 1px solid var(--edge, #e2dccd); color: var(--dim, #7b857a); }
	.dot.verified, .dot.stored { border-color: var(--ok-line, #9bb58a); background: var(--ok-bg, #eef2e6); color: var(--ok, #3e5a2f); }
	.dot.partial, .dot.syncing { border-color: var(--warn-line, #e2c27a); background: var(--warn-bg, #fbf3df); color: var(--warn, #7a5a14); }
	.dot.missing { border-color: var(--bad-line, #e2a48a); background: var(--bad-bg, #f6e3da); color: var(--bad, #8a2a12); }
	.n { color: var(--dim, #7b857a); }
</style>

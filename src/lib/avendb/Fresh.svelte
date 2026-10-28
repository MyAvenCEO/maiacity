<!--
	A read's freshness as one badge (./fresh.js `freshLine`, avendb/spec/AvenDB/Freshness.lean): "Catching up" while a
	peer holds newer data for what the page shows, "Offline · as of …" with no peer, and nothing while current. The same
	badge on every page, whatever it reads.
-->
<script>
	import { freshLine } from './fresh.js';

	/** @type {{ fresh: ReturnType<import('../../../game/code/sources/coverage.js').freshnessOf> }} */
	let { fresh } = $props();
	const line = $derived(freshLine(fresh));
</script>

{#if line}
	<p class="fresh {fresh.state}" role="status"><span class="dot" aria-hidden="true"></span>{line}</p>
{/if}

<style>
	.fresh {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0.4rem 0;
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		font-size: 0.82rem;
		background: var(--surface-2, rgb(0 0 0 / 0.05));
		color: var(--muted, #555);
	}
	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: currentColor;
	}
	.behind .dot {
		animation: pulse 1.2s ease-in-out infinite;
	}
	.offline .dot {
		background: transparent;
		border: 1.5px solid currentColor;
	}
	@keyframes pulse {
		50% {
			opacity: 0.3;
		}
	}
</style>

<!--
	The one guard every action (approve, accept, decline, delete) stands behind (./fresh.js, aven/db/spec/AvenDB/
	Freshness.lean `act`): on current data nothing shows and the action may run; while the data is behind it says the
	answer waits until the device holds the latest, and the action may not run; offline it says plainly the action
	would act on data as of then, and runs only once the person ticked that they do. `confirmed` is bound by the page.
-->
<script>
	import { actOf, actionLine } from './fresh.js';

	/** @type {{ fresh: ReturnType<import('../../../maia/content/game/code/sources/coverage.js').freshnessOf>, confirmed?: boolean }} */
	let { fresh, confirmed = $bindable(false) } = $props();
	const act = $derived(actOf(fresh));
	$effect(() => {
		if (act !== 'confirm') confirmed = false;
	});
</script>

{#if act !== 'go'}
	<div class="guard {act}" role="status">
		<p>{actionLine(fresh)}</p>
		{#if act === 'confirm'}
			<label><input type="checkbox" bind:checked={confirmed} /> Act on it anyway</label>
		{/if}
	</div>
{/if}

<style>
	.guard {
		margin: 0.5rem 0;
		padding: 0.55rem 0.8rem;
		border-radius: 0.7rem;
		background: var(--surface-2, rgb(0 0 0 / 0.05));
		font-size: 0.85rem;
	}
	.guard p {
		margin: 0;
	}
	label {
		display: inline-flex;
		gap: 0.4rem;
		align-items: center;
		margin-top: 0.4rem;
		font-weight: 600;
	}
</style>

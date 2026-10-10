<!--
	An entry's tags, as chips, to add to and take off where the acting vault may: the entry's own vault tags it at once;
	any other vault asks the vault's devices, who grant what its caps let it ask for, the tags the `tag` ops of each
	cap and of every cap it rests on all allow. A tag can take the entry into a cap's slice or out of it: the vault's
	devices then move it to the cell of the caps that hold it now, and who reads it changes with it.
-->
<script>
	import { nameOf, tagging, tagsIn } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean,
	 *   entry: import('./vaults.js').EntryView }}
	 */
	let { world, actor, api, busy, entry } = $props();

	const may = $derived(tagging(world, entry, actor));
	const tags = $derived(entry.tags ?? []);
	const asks = $derived(entry.vault !== actor);
	let adding = $state(false);
	let text = $state('');

	/** Whether the acting vault may add or take off tag `t`. @param {string} t */
	const free = (t) => may === 'any' || may.includes(t);

	/** Tags `add` added to the entry and `remove` taken off. @param {string[]} add @param {string[]} remove */
	const tag = (add, remove) => api.run('Tagging', { op: 'tag', as: actor, entry: entry.entry, add, remove });

	async function add() {
		const more = tagsIn(text).filter((t) => !tags.includes(t) && free(t));
		if (!more.length) return void (adding = false);
		if (await tag(more, [])) [text, adding] = ['', false];
	}

	/** @param {string} t */
	const untag = (t) => tag([], [t]);

	const hint = $derived(
		asks ? `asks ${nameOf(world.vaults.find((v) => v.id === entry.vault))}’s devices, who grant what its caps let it` : ''
	);
</script>

{#if entry.tags !== null}
	<span class="tags">
		{#each tags as t (t)}
			<span class="chip tag">
				#{t}
				{#if free(t)}
					<button class="x" disabled={busy} title="Take “{t}” off{asks ? `: ${hint}` : ''}" aria-label="Untag {t}" onclick={() => untag(t)}
						>×</button
					>
				{/if}
			</span>
		{/each}
		{#if may === 'any' || may.length}
			{#if adding}
				<input
					class="field add"
					placeholder={may === 'any' ? 'tags' : may.join(', ')}
					list="tags-{entry.entry}"
					bind:value={text}
					aria-label="New tags"
					onkeydown={(e) => (e.key === 'Enter' ? add() : e.key === 'Escape' && (adding = false))}
				/>
				{#if may !== 'any'}<datalist id="tags-{entry.entry}">{#each may as t (t)}<option value={t}></option>{/each}</datalist>{/if}
				<button class="chip more" disabled={busy || !text.trim()} onclick={add}>Tag</button>
			{:else}
				<button class="chip more" disabled={busy} title={asks ? hint : 'Add tags'} onclick={() => (adding = true)}>+ tag</button>
			{/if}
		{/if}
	</span>
{/if}

<style>
	.tags {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
	}

	.tag {
		background: #e4e9f3;
		color: #2b3f63;
	}

	.x {
		padding: 0 0 0 0.1rem;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		line-height: 1;
		cursor: pointer;
	}

	.more {
		border: 1px dashed rgb(0 0 0 / 0.2);
		background: none;
		font: inherit;
		font-size: 0.72rem;
		color: var(--soft);
		cursor: pointer;
	}

	.add {
		width: 8rem;
		padding: 0.1rem 0.4rem;
		font-size: 0.78rem;
	}
</style>

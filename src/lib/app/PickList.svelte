<!--
	The list down the left of a turntable (the 3D models, the actors): a narrow column of one-line rows, each thing's name
	and where it is from, and the chosen one opened to its note. The thing itself, its measure and what it can do, is
	on the turntable beside it.

	On a narrow screen it sits above the turntable instead, a few rows high; either way it scrolls clear of the app's nav
	pill at its foot (--nav-room, src/app.css).
-->
<script>
	/**
	 * Each item has its `id`, `label` and `note`; `where` says where it is from, `onpick` hands back the item itself.
	 * @type {{
	 *   title: string,
	 *   lede: string,
	 *   items: any[],
	 *   chosen: { id: string },
	 *   where: (item: any) => string,
	 *   onpick: (item: any) => void
	 * }}
	 */
	let { title, lede, items, chosen, where, onpick } = $props();
</script>

<aside class="picks">
	<h1>{title} <span>{items.length}</span></h1>
	<p class="lede" title={lede}>{lede}</p>
	<ul>
		{#each items as item (item.id)}
			{@const on = chosen.id === item.id}
			<li>
				<button class:on aria-current={on ? 'true' : undefined} onclick={() => onpick(item)}>
					<span class="row"><b>{item.label}</b><small title={where(item)}>{where(item)}</small></span>
					{#if on}<span class="note">{item.note}</span>{/if}
				</button>
			</li>
		{/each}
	</ul>
</aside>

<style>
	.picks {
		width: 15rem;
		overflow: auto;
		padding: 1rem 0.6rem calc(1rem + var(--nav-room));
		border-right: 1px solid rgb(0 0 0 / 0.08);
	}

	h1 {
		margin: 0.2rem 0.5rem 0.1rem;
		font-size: 1.15rem;
	}

	h1 span {
		margin-left: 0.25rem;
		font-family: var(--font-body);
		font-size: 0.75rem;
		opacity: 0.45;
	}

	.lede {
		margin: 0 0.5rem 0.7rem;
		overflow: hidden;
		font-size: 0.75rem;
		line-height: 1.35;
		opacity: 0.6;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 1px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	button {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		width: 100%;
		padding: 0.4rem 0.5rem;
		border: 1px solid transparent;
		border-radius: 8px;
		background: transparent;
		font: inherit;
		font-size: 0.82rem;
		line-height: 1.3;
		text-align: left;
		color: inherit;
		cursor: pointer;
	}

	button:hover {
		background: rgb(0 0 0 / 0.04);
	}

	button.on {
		border-color: rgb(0 0 0 / 0.12);
		background: #fff;
	}

	/* the name and where it is from on one line; the name gives way first */
	.row {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
	}

	.row b {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row small {
		flex: none;
		max-width: 45%;
		overflow: hidden;
		font-size: 0.7rem;
		text-overflow: ellipsis;
		white-space: nowrap;
		opacity: 0.5;
	}

	.note {
		font-size: 0.74rem;
		line-height: 1.35;
		opacity: 0.7;
	}

	/* a narrow screen: above the turntable, a few rows high */
	@media (max-width: 720px) {
		.picks {
			width: auto;
			max-height: 34vh;
			padding-bottom: 0.6rem;
			border-right: 0;
			border-bottom: 1px solid rgb(0 0 0 / 0.08);
		}
	}
</style>

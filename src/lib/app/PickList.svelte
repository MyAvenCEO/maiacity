<!--
	The list down the left of a turntable (the 3D models, the actors, the plants): a narrow column of one-line rows, each
	thing's name, its version and where it is from, and the chosen one opened to its note and its history (every version,
	newest first: pick one to see it as it was — $lib/app/versions.js); grouped under headings if it is given `group`. The
	thing itself, its measure and what it can do, is on the turntable beside it.

	On a narrow screen it sits above the turntable instead, a few rows high; either way it scrolls clear of the app's nav
	pill at its foot (--nav-room, src/app.css).
-->
<script>
	import { day, tag } from './versions.js';

	/**
	 * Each item has its `id`, `label` and `note`; `where` says where it is from, `onpick` hands back the item itself.
	 * @type {{
	 *   title: string,
	 *   lede: string,
	 *   items: any[],
	 *   chosen: { id: string },
	 *   where: (item: any) => string,
	 *   onpick: (item: any) => void,
	 *   group?: (item: any) => string,
	 *   version?: number,
	 *   onversion?: (v: number) => void
	 * }}
	 */
	let { title, lede, items, chosen, where, onpick, group, version, onversion } = $props();
</script>

<aside class="picks">
	<h1>{title} <span>{items.length}</span></h1>
	<p class="lede" title={lede}>{lede}</p>
	<ul>
		{#each items as item, i (item.id)}
			{@const on = chosen.id === item.id}
			{#if group && (i === 0 || group(items[i - 1]) !== group(item))}<li class="group">{group(item)}</li>{/if}
			<li>
				<button class:on aria-current={on ? 'true' : undefined} onclick={() => onpick(item)}>
					<span class="row"><b>{item.label}</b>{#if item.version}<em class="v">{tag(on && version ? version : item.version)}</em>{/if}<small title={where(item)}>{where(item)}</small></span>
					{#if on}<span class="note">{item.note}</span>{/if}
				</button>
				{#if on && item.versions?.length}
					<ol class="history" aria-label="History">
						{#each [...item.versions].reverse() as ver (ver.v)}
							{@const shown = (version ?? item.version) === ver.v}
							<li>
								<button class="ver" class:shown aria-pressed={shown} onclick={() => onversion?.(ver.v)} disabled={!onversion}>
									<b>{tag(ver.v)}</b><span>{ver.note}</span><small>{day(ver.date)}{ver.v === item.version ? ' · latest' : ''}</small>
								</button>
							</li>
						{/each}
					</ol>
				{/if}
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

	.group {
		margin: 0.7rem 0.5rem 0.15rem;
		font-size: 0.68rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.55;
	}

	.group:first-child {
		margin-top: 0.1rem;
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

	.v {
		flex: none;
		font-size: 0.66rem;
		font-style: normal;
		font-variant-numeric: tabular-nums;
		opacity: 0.55;
	}

	/* the chosen one's history: a short list of its versions under it */
	.history {
		display: flex;
		flex-direction: column;
		gap: 1px;
		margin: 0.15rem 0 0.4rem 0.9rem;
		padding: 0 0 0 0.5rem;
		border-left: 2px solid rgb(0 0 0 / 0.08);
		list-style: none;
	}

	.ver {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0 0.45rem;
		padding: 0.25rem 0.4rem;
		font-size: 0.72rem;
	}

	.ver span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		opacity: 0.75;
	}

	.ver small {
		grid-column: 2;
		font-size: 0.66rem;
		opacity: 0.5;
	}

	.ver.shown {
		background: rgb(0 0 0 / 0.05);
	}

	.ver:disabled {
		cursor: default;
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

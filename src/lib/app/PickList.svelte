<!--
	The list down the left of a turntable (the 3D models, the actors, the plants): a narrow column of one-line rows, each
	thing's name, its version and where it is from, and the chosen one opened to its note and its history (every version,
	newest first: pick one to see it as it was — $lib/app/versions.js); grouped under headings if it is given `group`. The
	thing itself, its measure and what it can do, is on the turntable beside it.

	On a phone upright it is folded to one line above the turntable, the chosen one's name: tap it for the whole list,
	over the turntable, which folds again once one is picked. Either way it scrolls clear of the app's nav pill at its foot
	(--nav-room, src/app.css). Its place in the page is $lib/app/Turntable.svelte's.
-->
<script>
	import { day, tag } from './versions.js';

	/**
	 * Each item has its `id`, `label` and `note`; `where` says where it is from, `onpick` hands back the item itself.
	 * @type {{
	 *   title: string,
	 *   lede: string,
	 *   items: any[],
	 *   chosen: { id: string, label: string, version?: number },
	 *   where: (item: any) => string,
	 *   onpick: (item: any) => void,
	 *   group?: (item: any) => string,
	 *   version?: number,
	 *   onversion?: (v: number) => void
	 * }}
	 */
	let { title, lede, items, chosen, where, onpick, group, version, onversion } = $props();

	/** on a phone: the whole list unfolded over the turntable */
	let open = $state(false);
	/** @param {any} item */
	const pick = (item) => {
		open = false;
		onpick(item);
	};
	/** @param {number} v */
	const pickVersion = (v) => {
		open = false;
		onversion?.(v);
	};
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<aside class="picks" class:open>
	<div class="head">
		<h1>{title} <span>{items.length}</span></h1>
		<button class="fold" onclick={() => (open = !open)} aria-expanded={open} aria-label="{title}: {open ? 'close the list' : 'open the list'}">
			<b>{chosen.label}</b>{#if chosen.version}<em class="v">{tag(version ?? chosen.version)}</em>{/if}
			<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
		</button>
	</div>
	<p class="lede" title={lede}>{lede}</p>
	<ul>
		{#each items as item, i (item.id)}
			{@const on = chosen.id === item.id}
			{#if group && (i === 0 || group(items[i - 1]) !== group(item))}<li class="group">{group(item)}</li>{/if}
			<li>
				<button class:on aria-current={on ? 'true' : undefined} onclick={() => pick(item)}>
					<span class="row"><b>{item.label}</b>{#if item.version}<em class="v">{tag(on && version ? version : item.version)}</em>{/if}<small title={where(item)}>{where(item)}</small></span>
					{#if on}<span class="note">{item.note}</span>{/if}
				</button>
				{#if on && item.versions?.length}
					<ol class="history" aria-label="History">
						{#each [...item.versions].reverse() as ver (ver.v)}
							{@const shown = (version ?? item.version) === ver.v}
							<li>
								<button class="ver" class:shown aria-pressed={shown} onclick={() => pickVersion(ver.v)} disabled={!onversion}>
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
{#if open}<button class="scrim" aria-label="Close the list" onclick={() => (open = false)}></button>{/if}

<style>
	.picks {
		width: 15rem;
		overflow: auto;
		padding: 1rem 0.6rem calc(1rem + var(--nav-room));
		border-right: 1px solid rgb(0 0 0 / 0.08);
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.fold,
	.scrim {
		display: none;
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

	/* a phone upright: one line above the turntable, the chosen one's name to tap for the whole list, unfolded over it */
	@media (max-width: 720px) {
		.picks {
			position: relative;
			z-index: 3;
			width: auto;
			overflow: visible;
			padding: 0.4rem 0.75rem;
			border-right: 0;
			border-bottom: 1px solid rgb(0 0 0 / 0.08);
		}

		.head {
			justify-content: space-between;
		}

		h1 {
			flex: none;
			margin: 0;
		}

		.fold {
			display: flex;
			flex-direction: row;
			align-items: center;
			gap: 0.4rem;
			width: auto;
			min-width: 0;
			min-height: 2.5rem;
			padding: 0.35rem 0.75rem;
			border-color: rgb(0 0 0 / 0.12);
			border-radius: 999px;
			background: #fff;
			font-size: 0.9rem;
		}

		.fold b {
			overflow: hidden;
			font-weight: 600;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.fold svg {
			flex: none;
			width: 0.8rem;
			height: 0.8rem;
			opacity: 0.6;
			transition: transform 0.15s;
		}

		.open .fold svg {
			transform: rotate(180deg);
		}

		.lede,
		ul {
			display: none;
		}

		/* unfolded: the whole list over the turntable, scrolling, clear of the nav pill */
		.open ul {
			display: flex;
			position: absolute;
			top: 100%;
			left: 0;
			right: 0;
			max-height: min(70vh, calc(100dvh - 100% - var(--nav-room) - env(safe-area-inset-top, 0px)));
			overflow: auto;
			overscroll-behavior: contain;
			padding: 0.4rem 0.6rem 0.8rem;
			background: #f4f1eb;
			border-bottom: 1px solid rgb(0 0 0 / 0.08);
			box-shadow: 0 12px 24px rgb(0 0 0 / 0.12);
		}

		.open ul button {
			padding: 0.6rem 0.5rem;
			font-size: 0.9rem;
		}

		.scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 2;
			border: 0;
			border-radius: 0;
			background: rgb(0 0 0 / 0.2);
		}
	}

	/* a phone on its side: down the left still, a little narrower */
	@media (max-height: 500px) and (min-width: 721px) {
		.picks {
			width: 13rem;
		}

		.lede {
			display: none;
		}
	}
</style>

<!--
	The activity feed (Samuel, 2026-10-09): every entry of the valley's feed in one standard shape (economy.js, activity):
	when, who (an aven, or the valley), what kind and who decided, and its changes, each a sentence or a value it set with
	what it was. A brain's decision, a trial, a death, a dry spell, a new world's settings, or an event a card's code
	posted (its `events` hook) all read the same way, so a proposal that adds a decision or an event shows here as it is.
-->
<script>
	import { DAY_S } from './economy.js';

	/** @type {{ entries: any[], names?: Record<string, string>, onselect?: (id: number) => void, who?: boolean, empty?: string }} */
	let { entries, names = {}, onselect, who = true, empty = 'Nothing yet: press Start.' } = $props();

	/** the kinds the feed groups by: a brain's decisions, what its brain learned, and everything else that happened */
	const GROUPS = [
		{ k: 'all', label: 'All' },
		{ k: 'decision', label: 'Decisions' },
		{ k: 'brain', label: 'Brains' },
		{ k: 'event', label: 'Events' }
	];
	const groupOf = (/** @type {any} */ e) => {
		const k = e.kind ?? 'decision'; // an older world's feed held decisions only
		return k === 'decision' ? 'decision' : k === 'trial' || k === 'edit' ? 'brain' : 'event';
	};
	let group = $state('all');
	const shown = $derived(group === 'all' ? entries : entries.filter((e) => groupOf(e) === group));

	/** @param {number} t */
	const clock = (t) => {
		const s = t % DAY_S;
		return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
	};
	/** @param {any} v */
	const num = (v) => (typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v);
	/** the kind as the feed says it: a decision says who decided it */
	const kindOf = (/** @type {any} */ e) => {
		const k = e.kind ?? 'decision';
		if (k === 'decision') return names[e.source] ?? e.source ?? 'decision';
		if (k === 'edit') return 'edit';
		return k;
	};
</script>

<div class="feed">
	<div class="groups" role="tablist" aria-label="Show">
		{#each GROUPS as g (g.k)}<button class:on={group === g.k} onclick={() => (group = g.k)}>{g.label}</button>{/each}
	</div>
	<ul>
		{#each shown as e (e.n)}
			<li class={groupOf(e)} class:life={e.kind === 'life'}>
				<span class="when">d{e.day} {clock(e.t)}</span>
				<span class="what">
					{#if who}
						{#if e.name}<button class="who" onclick={() => onselect?.(e.id)}><i style:background={e.colour}></i>{e.name}</button>{:else}<b class="valley">Valley</b>{/if}
					{/if}
					<small class="kind">{kindOf(e)}</small>
					{#each e.changes ?? [] as c, i (i)}
						{#if typeof c === 'string'}<span class="say">{c}</span>{:else}<span class="set"><em>{c.label}</em> <b>{num(c.to)}</b>{#if c.unit}<u>{c.unit}</u>{/if}{#if c.from != null && c.from !== c.to}<s title="what it was">{num(c.from)}</s>{/if}</span>{/if}
					{/each}
					{#if (e.kind ?? 'decision') === 'decision' && !e.changes?.length}<span class="say quiet">kept every value</span>{/if}
					{#if e.kept?.length}<small class="kept" title={e.kept.map((/** @type {any} */ c) => `${c.label} ${num(c.to)}${c.unit ? ` ${c.unit}` : ''}`).join('\n')}>{e.changes?.length ? 'kept ' : ''}{e.kept.map((/** @type {any} */ c) => `${c.label} ${num(c.to)}`).join(' · ')}</small>{/if}
				</span>
			</li>
		{:else}
			<li class="none">{empty}</li>
		{/each}
	</ul>
</div>

<style>
	.groups {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin: 0.3rem 0;
	}
	.groups button {
		font: inherit;
		font-size: 0.72rem;
		border: 1px solid #1f2a2326;
		background: #fff;
		border-radius: 999px;
		padding: 0.1rem 0.55rem;
		cursor: pointer;
		color: inherit;
	}
	.groups button.on {
		border-color: #24452f;
		box-shadow: inset 0 0 0 1px #24452f;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		font-size: 0.75rem;
	}
	li {
		display: grid;
		grid-template-columns: 4.6rem 1fr;
		gap: 0.4rem;
		padding: 0.22rem 0;
		border-top: 1px solid #1f2a230d;
	}
	.when {
		opacity: 0.55;
		font-variant-numeric: tabular-nums;
	}
	.what {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.15rem 0.45rem;
		min-width: 0;
	}
	.who {
		border: 0;
		background: none;
		padding: 0;
		font: inherit;
		font-weight: 700;
		color: inherit;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
	}
	.who i {
		display: inline-block;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		margin-right: 0.3rem;
	}
	.valley {
		font-weight: 700;
	}
	.kind {
		opacity: 0.55;
	}
	.set {
		white-space: nowrap;
	}
	.set em {
		font-style: normal;
		opacity: 0.8;
	}
	.set b {
		font-variant-numeric: tabular-nums;
	}
	.set u {
		text-decoration: none;
		opacity: 0.7;
		margin-left: 0.15rem;
	}
	.set s {
		opacity: 0.45;
		margin-left: 0.3rem;
		font-variant-numeric: tabular-nums;
	}
	.quiet,
	.kept {
		opacity: 0.5;
	}
	.kept {
		flex-basis: 100%;
	}
	.brain .say {
		color: #7a4bb0;
	}
	.event .say,
	.event .set em {
		color: #8a6d3b;
	}
	.life .say {
		color: #b8483b;
		font-weight: 700;
	}
	.none {
		display: block;
		opacity: 0.5;
	}
</style>

<!--
	One article to read, the whole screen, laid out as the journal lays out every article on the site
	(./ArticleView.svelte): its main line's text. Edit opens the same page in the editor (Note), with its proposals and
	variants on the left and its history on the right. Above it, the stages of its flow (./flows.js), the one it is in
	marked, and for whoever may change it the stages it goes on to: publishing it makes it public and puts a post about
	it on the Maia Universe stream.
-->
<script>
	import ArticleView from './ArticleView.svelte';
	import { flowsFor, moving, stageOf } from './flows.js';
	import Icon from './Icon.svelte';
	import { count, nameOf } from './vaults.js';

	/** @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, entry: string }} */
	let { world, actor, api, entry } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const item = $derived(world.entries.find((e) => e.entry === entry));
	/** whether the acting vault may change it: its own vault, or a cap that lets it write */
	const writes = $derived(!!item && (item.writers ?? []).includes(actor));

	/** its flow, the first its vault and its type have (./flows.js), and the stage of it it is in */
	const flow = $derived(item ? flowsFor(world, item.vault, item.type ?? '')[0] : undefined);
	const stage = $derived(item && flow ? stageOf(item, flow) : null);
	/** the stages it may go on to: those its stage names, or any while it is in none */
	const onward = $derived(
		flow ? (stage ? flow.stages.filter((s) => stage.next.includes(s.key)) : flow.stages) : []
	);
	/** what a function of the flow couldn't ask for, as the last move ran it */
	let problem = $state('');

	/** Moves it to stage `to` of its flow: the ops its flow and its functions take (./flows.js). @param {string} to */
	async function move(to) {
		if (!item || !flow) return;
		const { ops, errors } = await moving(world, actor, item, flow, to);
		problem = errors.join(' · ');
		await api.runAll(`Moving it to ${flow.stages.find((s) => s.key === to)?.name ?? to}`, ops);
	}

	/** What the button that moves it to stage `s` says. @param {import('./flows.js').Stage} s */
	function label(s) {
		if (s.public) return 'Publish';
		const back = stage && flow && flow.stages.indexOf(s) < flow.stages.indexOf(stage);
		return back ? `Back to ${s.name}` : `Move to ${s.name}`;
	}

</script>

{#snippet back()}<a class="back" href="#articles">← All articles</a>{/snippet}

<div class="doc">
	<header class="top">
		<a class="back-arrow" href="#articles" title="All articles" aria-label="All articles"><Icon name="back" size={20} /></a>
		<span class="docicon" aria-hidden="true"><Icon name="article" size={24} /></span>
		<p class="where">{item ? nameOf(byId.get(item.vault)) : ''}{item?.public ? ' · Public' : ''}</p>
		<div class="tools">
			{#if item}
				<a class="btn primary" href="#articles/{entry}/edit">
					{writes ? 'Edit' : 'Its history'}{item.proposals ? ` · ${count(item.proposals, 'proposal')}` : ''}
				</a>
			{/if}
		</div>
	</header>

	{#if item && flow}
		<nav class="flow" aria-label="{flow.name}: its stages">
			{#each flow.stages as s, i (s.id)}
				{#if i}<span class="soft" aria-hidden="true">→</span>{/if}
				<span class="stage" class:on={stage?.key === s.key} title={s.public ? 'Public' : 'Private'}>{s.name}</span>
			{/each}
			{#if writes}
				<span class="moves">
					{#each onward as s (s.id)}
						<button class="btn" class:primary={s.public} onclick={() => move(s.key)}>{label(s)}</button>
					{/each}
				</span>
			{/if}
			{#if writes && onward.some((s) => s.public)}
				<small class="soft hint">
					Publishing makes it public with a post about it on the Maia Universe, and {nameOf(byId.get(item.vault))}’s
					name too, so everyone reads who published it.
				</small>
			{/if}
			{#if problem}<small class="bad hint">A function of {flow.name} asked for nothing: {problem}.</small>{/if}
		</nav>
	{/if}

	<div class="scroll">
		{#if !item}
			<p class="soft none">This device holds no such article, or can’t read it.</p>
		{:else}
			<ArticleView {world} {api} {item} title={item.title ?? ''} text={item.text ?? ''} eyebrow={stage?.name ?? 'Article'} {back} />
		{/if}
	</div>
</div>

<style>
	.doc {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: var(--cream);
	}

	.top {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: calc(0.7rem + env(safe-area-inset-top, 0px)) 1rem 0.7rem;
		border-bottom: 1px solid var(--edge);
		background: #fff;
	}

	.back-arrow {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		color: inherit;
	}

	.back-arrow:hover {
		background: #efece4;
	}

	.docicon {
		color: var(--accent);
	}

	.where {
		flex: 1;
		margin: 0;
		font-size: 0.86rem;
		color: var(--soft);
	}

	.tools .btn {
		text-decoration: none;
	}

	/* its flow: where it stands, and where it goes on to */
	.flow {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem;
		padding: 0.5rem 1rem;
		border-bottom: 1px solid var(--edge);
		background: #faf8f2;
		font-size: 0.84rem;
	}

	.stage {
		padding: 0.2rem 0.65rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
		color: var(--soft);
	}

	.stage.on {
		border-color: var(--accent);
		background: var(--accent);
		color: #fff;
	}

	.moves {
		display: flex;
		gap: 0.4rem;
		margin-left: auto;
	}

	.hint {
		flex-basis: 100%;
		font-size: 0.78rem;
	}

	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.none {
		margin: 2rem 1.5rem;
	}
</style>

<!--
	The HITL queue (./hitl.js): every change waiting for the yes of the vault the page is looked at in, as a stack of
	cards that rises from the foot of the page by itself, as the passkey's sheet does (./Signing.svelte). The top card
	shows the change itself: who proposed it, the title and text before and after with what it took out and put in,
	the record's other fields it changes, and the policy, one owner for now. At its foot, in the middle: Decline, Revise
	and Accept. Revise asks for a few words that go back to whoever proposed. On a touch screen a swipe answers too:
	right accepts, left declines, up revises. Each answer is a review the device signs like any edit; accepting merges
	the proposal too. "Later" puts the stack away until a new change arrives; a pill above the nav brings it back.

	Acting as a vault that proposed (an aven), the cards are the revisions asked of it, each with the words it was sent
	and the note to open.

	It reads the note of every entry with a proposal in the vaults the person acts for as their owner, once per version
	of it, and tells the page how many wait in each (`oncounts`), for the bubbles on the vaults in the nav pill.
-->
<script>
	import { fade, fly } from 'svelte/transition';
	import Icon from './Icon.svelte';
	import Mark from './Mark.svelte';
	import { diff } from './diff.js';
	import { answering, asksOf, proposing, reviews, revisionsOf } from './hitl.js';
	import { nameOf } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, api: any, vault: string, busy: boolean,
	 *   onopen: (entry: string) => void, oncounts?: (counts: Record<string, number>) => void }}
	 */
	let { world, api, vault, busy, onopen, oncounts = () => {} } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	/** the vaults the person answers for: those they act for as the vault itself, as its owner */
	const answers = $derived(world.vaults.filter((v) => v.acting?.as === v.id).map((v) => v.id));

	/** the notes read, by entry, and the version of the entry each was read at */
	let notes = $state(/** @type {Record<string, any>} */ ({}));
	const versions = new Map();

	// read the note of every entry with a proposal, again only once it changed
	$effect(() => {
		const want = answers.flatMap((v) => proposing(world, v));
		const reading = want.filter((e) => versions.get(e.entry) !== `${e.edits}/${e.proposals}`);
		if (!reading.length) return;
		Promise.all(
			reading.map(async (e) => {
				const got = await api.ask({ op: 'note', entry: e.entry });
				versions.set(e.entry, `${e.edits}/${e.proposals}`);
				return [e.entry, got?.ok ?? null];
			})
		).then((got) => (notes = { ...notes, ...Object.fromEntries(got) }));
	});

	const all = $derived(reviews(world));
	const asks = $derived(asksOf(vault, notes, all));
	const revisions = $derived(revisionsOf(vault, notes, all));

	$effect(() => oncounts(Object.fromEntries(answers.map((v) => [v, asksOf(v, notes, all).length]))));

	/** the cards put away for later, by proposal and version */
	let later = $state(/** @type {string[]} */ ([]));
	/** the revisions the person has seen, by review */
	let seen = $state(/** @type {string[]} */ ([]));
	const keyOf = (/** @type {import('./hitl.js').Ask} */ a) => `${a.entry}/${a.line}/${a.heads.join()}`;
	const waiting = $derived(asks.filter((a) => !later.includes(keyOf(a))));
	const told = $derived(revisions.filter((r) => !seen.includes(r.id)));
	let open = $state(true);
	// a change that wasn't there before opens the stack again
	let known = new Set();
	$effect(() => {
		const fresh = [...asks.map(keyOf), ...revisions.map((r) => r.id)].filter((k) => !known.has(k));
		fresh.forEach((k) => known.add(k));
		if (fresh.length) open = true;
	});
	// another vault looked at: its own stack
	$effect(() => {
		vault;
		open = true;
	});

	const top = $derived(waiting[0]);
	let revising = $state(false);
	let words = $state('');
	$effect(() => {
		top;
		[revising, words] = [false, ''];
	});

	/** Answer the top card with `verdict`. @param {import('./hitl.js').Verdict} verdict */
	async function answer(verdict) {
		if (!top || busy) return;
		if (verdict === 'revise' && !revising) return void (revising = true);
		if (verdict === 'revise' && !words.trim()) return;
		const what = { accepted: 'Accepting the change', declined: 'Declining the change', revise: 'Asking for a revision' };
		await api.runAll(what[verdict], answering(world, top, verdict, words.trim(), vault));
	}

	/** The words of the change of `before` to `after`, word by word. @param {string} before @param {string} after */
	const pieces = (before, after) => diff(before, after);

	/** A field's value as a person reads it. @param {any} v */
	const shown = (v) => (v === undefined || v === null || v === '' ? '—' : typeof v === 'string' ? v : JSON.stringify(v));

	// a swipe on a touch screen: right accepts, left declines, up revises
	let start = $state(/** @type {{ x: number, y: number } | null} */ (null));
	let dx = $state(0);
	let dy = $state(0);
	/** @param {PointerEvent} e */
	function down(e) {
		if (e.pointerType === 'mouse' || revising || (e.target instanceof Element && e.target.closest('button, textarea'))) return;
		start = { x: e.clientX, y: e.clientY };
	}
	/** @param {PointerEvent} e */
	function move(e) {
		if (start) [dx, dy] = [e.clientX - start.x, e.clientY - start.y];
	}
	function up() {
		if (!start) return;
		const verdict = dx > 110 ? 'accepted' : dx < -110 ? 'declined' : dy < -110 ? 'revise' : null;
		[start, dx, dy] = [null, 0, 0];
		if (verdict) answer(verdict);
	}
</script>

{#if open && (top || told.length)}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="scrim" transition:fade={{ duration: 180 }} onclick={() => (open = false)}></div>
	<div class="stack" role="dialog" aria-modal="true" aria-labelledby="hitl-title" transition:fly={{ y: 640, duration: 280, opacity: 1 }}>
		{#each waiting.slice(1, 3) as a, i (keyOf(a))}
			<div class="behind" style="--i:{i + 1}" aria-hidden="true"></div>
		{/each}
		{#if top}
			{@const from = byId.get(top.from ?? '')}
			<article
				class="card"
				style="transform: translate({dx}px, {Math.min(dy, 0)}px) rotate({dx / 30}deg)"
				onpointerdown={down}
				onpointermove={move}
				onpointerup={up}
				onpointercancel={up}
			>
				<div class="grip" aria-hidden="true"></div>
				<header>
					<Mark vault={from} size={38} />
					<div>
						<h2 id="hitl-title">{nameOf(from)} proposes a change</h2>
						<p class="soft">
							{top.name ? `“${top.name}”, ` : ''}{top.since} edit{top.since === 1 ? '' : 's'} · for {nameOf(byId.get(vault))}
						</p>
					</div>
					<span class="count">{waiting.length} waiting</span>
				</header>

				<div class="view">
					<h3 class="title">
						{#each pieces(top.before.title, top.after.title) as p, i (i)}<span class={p.kind}>{p.text}</span>{/each}
					</h3>
					{#if top.before.text || top.after.text}
						<p class="text">
							{#each pieces(top.before.text, top.after.text) as p, i (i)}<span class={p.kind}>{p.text}</span>{/each}
						</p>
					{/if}
					{#if top.fields.length}
						<dl class="fields">
							{#each top.fields as f (f.key)}
								<dt>{f.key}</dt>
								<dd><span class="out">{shown(f.before)}</span> → <span class="in">{shown(f.after)}</span></dd>
							{/each}
						</dl>
					{/if}
					<button class="link" onclick={() => ((open = false), onopen(top.entry))}>Open the note</button>
				</div>

				<p class="policy">
					<Icon name="users" size={14} /> One owner's yes merges it. {#if top.again}You answered an earlier version: {top.again.verdict}.{/if}
				</p>

				{#if revising}
					<textarea bind:value={words} rows="3" placeholder="What should {nameOf(from)} change?"></textarea>
				{/if}
				<div class="answers">
					<button class="btn" disabled={busy} onclick={() => answer('declined')}><Icon name="close" size={14} />Decline</button>
					<button class="btn" disabled={busy || (revising && !words.trim())} onclick={() => answer('revise')}>
						<Icon name="proposal" size={14} />{revising ? 'Send' : 'Revise'}
					</button>
					<button class="btn primary" disabled={busy} onclick={() => answer('accepted')}><Icon name="check" size={14} />Accept</button>
				</div>
				<button class="later link" onclick={() => (later = [...later, ...waiting.map(keyOf)])}>Later</button>
			</article>
		{:else}
			{@const r = told[0]}
			<article class="card">
				<div class="grip" aria-hidden="true"></div>
				<header>
					<Mark vault={byId.get(r.vault)} size={38} />
					<div>
						<h2 id="hitl-title">{nameOf(byId.get(r.vault))} asks for a revision</h2>
						<p class="soft">{told.length} waiting</p>
					</div>
				</header>
				<blockquote>{r.text}</blockquote>
				<div class="answers">
					<button class="btn" onclick={() => (seen = [...seen, r.id])}>Done</button>
					<button class="btn primary" onclick={() => ((seen = [...seen, r.id]), (open = false), onopen(r.entry))}>Open the note</button>
				</div>
			</article>
		{/if}
	</div>
{:else if !open && (waiting.length || told.length)}
	<button class="waiting" transition:fade={{ duration: 150 }} onclick={() => ((later = []), (open = true))}>
		{waiting.length + told.length} waiting for you
	</button>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: rgb(20 28 24 / 0.32);
	}

	/* it rises from the foot of the page to just above the app's nav pill, as the passkey's sheet does */
	.stack {
		position: fixed;
		left: 50%;
		bottom: var(--nav-room, 0.5rem);
		z-index: 61;
		box-sizing: border-box;
		width: min(36rem, calc(100% - 1rem));
		transform: translateX(-50%);
	}

	.behind {
		position: absolute;
		inset: 0;
		border-radius: 1.1rem;
		background: var(--card, #fff);
		box-shadow: 0 -6px 20px rgb(0 0 0 / 0.1);
		transform: translateY(calc(var(--i) * -0.7rem)) scale(calc(1 - var(--i) * 0.04));
		opacity: calc(1 - var(--i) * 0.3);
	}

	.card {
		position: relative;
		box-sizing: border-box;
		max-height: min(44rem, calc(100vh - var(--nav-room, 0.5rem) - 2rem));
		overflow-y: auto;
		padding: 0.6rem 1.2rem 1rem;
		border-radius: 1.1rem;
		background: var(--card, #fff);
		box-shadow: 0 -12px 40px rgb(0 0 0 / 0.18);
		touch-action: pan-y;
		transition: transform 0.12s;
	}

	.grip {
		width: 2.6rem;
		height: 0.28rem;
		margin: 0 auto 0.8rem;
		border-radius: 999px;
		background: var(--edge);
	}

	header {
		display: flex;
		gap: 0.7rem;
		align-items: center;
		margin-bottom: 0.8rem;
	}

	header div {
		flex: 1;
		min-width: 0;
	}

	/* in the body's face, which keeps the capitals of names like avenMaia plain */
	h2 {
		margin: 0;
		font-family: var(--font-body);
		font-size: 1.05rem;
		font-weight: 650;
		font-variation-settings: normal;
		letter-spacing: -0.01em;
	}

	header p {
		margin: 0.15rem 0 0;
		font-size: 0.82rem;
	}

	.soft {
		color: var(--soft);
	}

	.count {
		flex: none;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		font-size: 0.8rem;
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		color: var(--accent);
	}

	/* the change itself */
	.view {
		padding: 0.8rem 0.9rem;
		border: 1px solid var(--edge);
		border-radius: 0.8rem;
		background: #faf8f4;
	}

	.title {
		margin: 0 0 0.4rem;
		font-size: 1.1rem;
	}

	.text {
		margin: 0 0 0.6rem;
		font-size: 0.9rem;
		line-height: 1.5;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.out {
		background: color-mix(in srgb, var(--bad) 16%, transparent);
		text-decoration: line-through;
	}

	.in {
		background: color-mix(in srgb, var(--ok) 20%, transparent);
	}

	.fields {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.25rem 0.8rem;
		margin: 0 0 0.6rem;
		font-size: 0.82rem;
	}

	.fields dt {
		color: var(--soft);
	}

	.fields dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.policy {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		margin: 0.7rem 0 0.2rem;
		font-size: 0.8rem;
		color: var(--soft);
	}

	textarea {
		box-sizing: border-box;
		width: 100%;
		margin-top: 0.5rem;
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--edge);
		border-radius: 0.6rem;
		font: inherit;
		font-size: 0.9rem;
	}

	blockquote {
		margin: 0 0 0.8rem;
		padding: 0.6rem 0.8rem;
		border-left: 3px solid var(--accent);
		background: #faf8f4;
		white-space: pre-wrap;
	}

	/* the answers, in the middle at the card's foot */
	.answers {
		display: flex;
		gap: 0.5rem;
		justify-content: center;
		margin-top: 0.8rem;
	}

	.answers .btn {
		min-width: 6.5rem;
	}

	.link {
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.82rem;
		color: var(--accent);
		cursor: pointer;
	}

	.later {
		display: block;
		margin: 0.6rem auto 0;
		color: var(--soft);
	}

	.waiting {
		position: fixed;
		left: 50%;
		bottom: calc(var(--nav-room, 0.5rem) + 0.4rem);
		z-index: 59;
		transform: translateX(-50%);
		padding: 0.4rem 0.9rem;
		border: 0;
		border-radius: 999px;
		background: var(--accent);
		color: #fff;
		font: inherit;
		font-size: 0.85rem;
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.18);
		cursor: pointer;
	}
</style>

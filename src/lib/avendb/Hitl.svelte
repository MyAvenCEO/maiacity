<!--
	The HITL queue (./hitl.js): every AIP waiting for the yes of the vault the page is looked at in, as a stack of cards
	that rises from the foot of the page by itself, as the passkey's sheet does (./Signing.svelte). Only a promoted AIP
	asks; ideas and proposals no AIP names never do. The top card is a summary of it: who proposes it, its label and
	title, the first lines of its note, the top three parts of what it changes ("+2 more"), each in a line its entry's
	schema derives, and the signatures so far against the policy, one owner for now. A part that is a new entry, a draft
	proposed inside the AIP, wears a "New" badge with its type, and says so where it goes public on Accept, with its
	tags: no share to everyone reaches a draft until its vault accepts it. More detail opens the AIP whole in
	the Proposals app. An AIP that proposes assets (its `recipe` lines: a new version of one, or a new one) shows the
	one it proposes in 3D above its note, built from the file on its line, as the vault's own assets are
	(./ProposedAssets.svelte), so the vault sees what it would accept. At its foot, in the middle: Decline, Revise and
	Accept, one review over every part. Revise asks for a few words that go back to whoever proposed. On a touch screen
	a swipe answers too: right accepts, left declines, up revises. Accepting applies every part at once. "Later" puts the stack away until a new AIP arrives; a
	pill above the nav brings it back.

	Acting as a vault that proposed (an aven), the cards are the revisions asked of it, each with the words it was sent
	and the AIP to open.

	It reads the AIPs the device holds with one op, `aips`, again each time the world changes, and tells the page how
	many wait in each vault the person answers for (`oncounts`), for the bubbles on the vaults in the nav pill.
-->
<script>
	import { fade, fly } from 'svelte/transition';
	import Icon from './Icon.svelte';
	import Mark from './Mark.svelte';
	import ProposedAssets from './ProposedAssets.svelte';
	import { answering, asksOf, countsOf, detail, lead, newsOf, revisionsOf, signed, top as topOf } from './hitl.js';
	import { nameOf } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, api: any, vault: string, busy: boolean,
	 *   oncounts?: (counts: Record<string, number>) => void }}
	 */
	let { world, api, vault, busy, oncounts = () => {} } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	/** the vaults the person answers for: those they act for as the vault itself, as its owner */
	const answers = $derived(world.vaults.filter((v) => v.acting?.as === v.id).map((v) => v.id));

	/** the AIPs the device holds (`aips`), read again each time the world changes; the last read asked wins */
	let aips = $state(/** @type {import('./hitl.js').Aip[]} */ ([]));
	let reading = 0;
	$effect(() => {
		world;
		const n = ++reading;
		api.ask({ op: 'aips' }).then(
			(/** @type {any} */ got) => n === reading && Array.isArray(got?.ok) && (aips = got.ok),
			() => {}
		);
	});

	const asks = $derived(asksOf(vault, aips));
	const revisions = $derived(revisionsOf(vault, aips));

	$effect(() => oncounts(countsOf(answers, aips)));

	/** the cards put away for later, by AIP and the version of its lines */
	let later = $state(/** @type {string[]} */ ([]));
	/** the revisions the person has seen, by review */
	let seen = $state(/** @type {string[]} */ ([]));
	const keyOf = (/** @type {import('./hitl.js').Aip} */ a) => `${a.entry}/${a.lines.map((l) => l.heads.join()).join(';')}`;
	const reviewOf = (/** @type {import('./hitl.js').Aip} */ a) => a.reviews[0]?.review ?? '';
	const waiting = $derived(asks.filter((a) => !later.includes(keyOf(a))));
	const told = $derived(revisions.filter((r) => !seen.includes(reviewOf(r))));
	let open = $state(true);
	// an AIP that wasn't there before opens the stack again
	let known = new Set();
	$effect(() => {
		const fresh = [...asks.map(keyOf), ...revisions.map(reviewOf)].filter((k) => !known.has(k));
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

	/** Bytes `from` to `to` of a file, as the device reads them. @type {import('./files.js').Read} */
	const read = (root, size, from, to) => api.readFile(root, size, from, to);

	/** Answer the top card with `verdict`: one review over every part. @param {import('./hitl.js').Verdict} verdict */
	async function answer(verdict) {
		if (!top || busy) return;
		if (verdict === 'revise' && !revising) return void (revising = true);
		if (verdict === 'revise' && !words.trim()) return;
		const what = { accepted: 'Accepting the AIP', declined: 'Declining the AIP', revise: 'Asking for a revision' };
		await api.runAll(what[verdict], answering(top, verdict, words.trim(), vault));
	}

	/** What an AIP is called on a card: its label, else its number, else its title alone. @param {import('./hitl.js').Aip} a */
	const called = (a) => a.label ?? (a.number ? `AIP-${a.number}` : 'An idea');

	// a swipe on a touch screen: right accepts, left declines, up revises
	let start = $state(/** @type {{ x: number, y: number } | null} */ (null));
	let dx = $state(0);
	let dy = $state(0);
	/** @param {PointerEvent} e */
	function down(e) {
		if (e.pointerType === 'mouse' || revising || (e.target instanceof Element && e.target.closest('a, button, textarea, .proposed'))) return;
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
			{@const from = byId.get(top.author ?? '')}
			{@const parts = topOf(top.summary)}
			{@const news = newsOf(top)}
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
						<h2 id="hitl-title">{nameOf(from)} proposes {called(top)}</h2>
						<p class="soft">
							{top.lines.length} part{top.lines.length === 1 ? '' : 's'} · for {nameOf(byId.get(vault))}
						</p>
					</div>
					<span class="count">{waiting.length} waiting</span>
				</header>

				<div class="view">
					<h3 class="title">{top.title}</h3>
					{#if news.length}
						<p class="news">
							{#each news as n, i (i)}<span class="new">{n}</span>{/each}
						</p>
					{/if}
					<ProposedAssets lines={top.lines} ask={(op) => api.ask(op)} {read} key={keyOf(top)} compact />
					{#if top.note}
						<p class="text">{lead(top.note)}</p>
					{/if}
					{#if parts.shown.length}
						<ul class="parts">
							{#each parts.shown as line, i (i)}<li>{line}</li>{/each}
							{#if parts.more}<li class="soft">+{parts.more} more</li>{/if}
						</ul>
					{/if}
					<a class="link" href={detail(top.entry ?? '')}>More detail</a>
				</div>

				<p class="policy">
					<Icon name="users" size={14} />
					{signed(top.signatures)} signed. One owner's yes applies every part.
					{#if top.reviews[0]}You answered an earlier version: {top.reviews[0].verdict}.{/if}
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
						<p class="soft">{called(r)}, “{r.title}” · {told.length} waiting</p>
					</div>
				</header>
				<blockquote>{r.reviews[0]?.text ?? ''}</blockquote>
				<div class="answers">
					<button class="btn" onclick={() => (seen = [...seen, reviewOf(r)])}>Done</button>
					<a class="btn primary" href={detail(r.entry ?? '')} onclick={() => (seen = [...seen, reviewOf(r)])}>More detail</a>
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

	/* the new entries it proposes, its drafts, a badge each */
	.news {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin: 0 0 0.5rem;
	}

	.new {
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		font-size: 0.76rem;
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		color: var(--accent);
	}

	/* what it changes, a line per part, each as its entry's schema derives it */
	.parts {
		margin: 0 0 0.6rem;
		padding-left: 1.1rem;
		font-size: 0.84rem;
		line-height: 1.45;
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
	/* the answers stay in sight at the card's foot while a long card (an asset in 3D) scrolls under them */
	.answers {
		position: sticky;
		/* flush with the card's foot, through its padding */
		bottom: -1rem;
		z-index: 5;
		display: flex;
		gap: 0.5rem;
		justify-content: center;
		margin-top: 0.8rem;
		padding: 0.5rem 0 1rem;
		background: var(--card, #fff);
	}

	.answers .btn {
		min-width: 6.5rem;
	}

	.link {
		display: inline-block;
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

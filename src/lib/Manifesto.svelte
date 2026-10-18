<!--
	The why, set as a magazine manifesto: a headline spread, a chapter with a
	drop cap, a pull quote between rules, the "I see" refrain hung off a gutter,
	a crescendo whose lines grow as they build, and the creed as the close.
-->
<script lang="ts">
	import { asset } from '$lib/media/url';
	import FounderCounter from '$lib/FounderCounter.svelte';
	// the banner (a woman on a mountain top at sunrise) and Samuel's portrait, by hash
	const BANNER = 'a78e789f5d7c92310ebaac44368dd1c3ab6e65efcdee67f148649b3965a03f69.jpg';
	const SAMUEL = 'dad53831fb215f1d6c5fc29c111aba8a2d7b472b43ab076da7537787c2895b8a.jpg';

	// the banner is optional: without the illustration the headline simply
	// stands on the page
	import type { Snippet } from 'svelte';

	let { banner = false, afterHero }: { banner?: boolean; afterHero?: Snippet } = $props();

	const visions = [
		'a million founders uniting behind one vision, and discovering what humans have always been able to do the moment they stop competing for scraps.',
		'a child growing up who never once hears that this is just the way things are.',
		'the elders of a village teaching what they know to the people who will outlive them, and being needed again.',
		'a place built for humans to flourish in. A place where what we build together, we own together, and abundance is no rumour from somewhere else, just what people working in flow naturally produce.',
		'work that feels like purpose, and days that feel like life.'
	];

	const builds = [
		'in the fields, where the soil comes back.',
		'in the workshops, where the machines are ours to repair.',
		'in the kitchens, where fifty people sit down to eat together.',
		'in every person who has felt, for years, that there must be more than this.'
	];
</script>

<article class="manifesto">
	<!-- the banner fills the screen edge to edge, the story told on top of it -->
	{#if banner}
		<header class="banner">
			<img
				src={asset(BANNER)}
				alt="A woman on a mountain top at sunrise, arms wide open over the sea."
			/>
			<!-- set like a magazine cover: a kicker, the headline in two weights, a rule, the deck beside a big number -->
			<div class="story">
				<h1 class="cover">
					<span class="opening">This is the story</span>
					<span class="founders"><span class="light">how</span> <FounderCounter /> <span class="light">of</span> 1,346,269 founders build their own <em>solarpunk</em> city</span>
					<span class="deck">
						<span class="years">in just <span class="number">16</span> years,</span>
						<span class="when">first in game, then in real.</span>
					</span>
				</h1>
			</div>
		</header>
	{/if}

	<!-- the prize: what the game is for, set as a feature spread — a headline, a column of text, the path in numbers -->
	<section class="prize">
		<p class="kicker"><span>The prize</span></p>
		<h2 class="prize-head">
			<span class="light">Not just another city builder game...</span>
			<span>but a <em>civilization scale</em> brick builder for a new generation of sovereign cities.</span>
		</h2>
		<div class="prize-body">
			<div class="prize-text">
				<p class="dropcap">
					Think of maiaCITY as a research laboratory you can play. Every village built in it tests one of
					the building blocks a new civilization needs: how we grow our food, share our energy, own what we
					build and decide together. We try them in the game, long before a single real brick is laid.
				</p>
				<p>
					876 villages will rise in the game, and they will compete. Not for points, but for a place.
					The day we are 1,346,269 founders strong, we build the first real village on the Mediterranean,
					and the village that proved itself in the game moves in as its first settlers.
				</p>
				<p class="milestone">
					That village is our first major milestone: the seed the whole city grows from.
				</p>
			</div>
			<ol class="prize-path">
				<li><strong>876</strong><span>in-game villages compete</span></li>
				<li><strong>1,346,269</strong><span>founders, and the build begins</span></li>
				<li><strong>1</strong><span>real village on the Mediterranean: the first milestone, before the city grows</span></li>
			</ol>
		</div>
	</section>

	<section class="spread">
		<p class="kicker"><span>Manifesto</span></p>
		<svelte:element this={banner ? 'h2' : 'h1'} class="headline">
			<span class="survive">We were never built to survive.</span>
			<span class="thrive">We were built to <mark>thrive.</mark></span>
		</svelte:element>
	</section>

	<!-- whatever the page wants seen before the first chapter — the Day 01 film -->
	{#if afterHero}<div class="after-hero">{@render afterHero()}</div>{/if}

	<section class="chapter">
		<p class="marker">I<span>The old blueprint</span></p>
		<div class="text">
			<p class="dropcap">
				For generations we have been handed a blueprint drawn for scarcity. Get through the month.
				Compete for what is left. Rent our own lives back, one invoice at a time.
			</p>
			<p>
				That blueprint is running out. Not in fire — in the quiet way a thing ends once nobody
				believes in it any more.
			</p>
			<p class="turn">And the next one will not draw itself.</p>
		</div>
	</section>

	<blockquote class="pull">
		<p>We are far more capable than we have ever been allowed to believe.</p>
		<footer>The only ceiling is imagination.</footer>
	</blockquote>

	<section class="chapter">
		<p class="marker">II<span>The vision</span></p>
		<ul class="visions">
			{#each visions as line}
				<li><span class="see">I see</span> {line}</li>
			{/each}
		</ul>
	</section>

	<section class="chapter">
		<p class="marker">III<span>Build it</span></p>
		<ol class="crescendo">
			{#each builds as line, i}
				<li style:--step={i}><span class="verb">{i === 0 ? 'So build it' : 'Build it'}</span> {line}</li>
			{/each}
		</ol>
	</section>

	<p class="contrast">
		<span class="less">Not 100x more stuff.</span>
		<span class="more">100x more life.</span>
	</p>

	<footer class="close">
		<p class="lead-in">
			And on the day a million founders stand inside what they built, they will know what I know
			deep in my heart for sure:
		</p>
		<p class="creed">when we unite in vision, the impossible becomes possible.</p>
		<p class="signature">
			<img src={asset(SAMUEL)} alt="" />
			<span>Samuel Andert</span>
		</p>
	</footer>
</article>

<style>
	.manifesto {
		--gutter: 11rem;
	}

	/* ── the spread ─────────────────────────────────────────── */
	.spread {
		position: relative;
		padding-block: 4rem 3.5rem;
		border-bottom: 1px solid var(--ink);
	}

	.after-hero {
		margin: 2.5rem 0 1rem;
	}

	.after-hero :global(.player) {
		margin: 0;
	}

	/* Full height and full width: the banner breaks out of the page's column
	   and slides up under the nav pill, which floats on it. */
	.banner {
		position: relative;
		display: flex;
		align-items: flex-end;
		width: 100vw;
		height: calc(100svh + 0.4rem);
		min-height: 32rem;
		/* the header's height (its padding, the safe area, the pill), a touch over so no cream shows above */
		margin-top: calc(-1 * (1.25rem + env(safe-area-inset-top, 0px) + 3.6rem));
		margin-left: calc(50% - 50vw);
		overflow: hidden;
	}

	.banner img {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: 40% 40%;
	}

	/* the lower part darkens so the story reads in white over the hills */
	.banner::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			to bottom,
			transparent 35%,
			rgb(16 32 30 / 0.45) 62%,
			rgb(16 32 30 / 0.78) 100%
		);
	}

	.story {
		position: relative;
		z-index: 1;
		width: 100%;
		max-width: 1180px;
		margin: 0 auto;
		padding: 0 1.5rem clamp(2.5rem, 7vh, 4.5rem);
		color: #fffaf0;
	}

	.cover {
		display: grid;
		margin: 0;
	}

	.opening {
		justify-self: start;
		margin-bottom: 1.4rem;
		padding: 0.55rem 1.2rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--paper) 90%, transparent);
		color: var(--ink);
		font-family: var(--font-body);
		font-size: clamp(0.8rem, 1.2vw, 1rem);
		font-weight: 500;
		letter-spacing: 0.22em;
		text-transform: uppercase;
	}

	.founders {
		max-width: 19ch;
		font-size: clamp(2.5rem, 6.6vw, 5.8rem);
		font-weight: 600;
		line-height: 0.98;
		letter-spacing: -0.035em;
		text-wrap: balance;
		text-shadow: 0 2px 30px rgb(0 0 0 / 0.2);
	}

	.founders .light {
		font-weight: 300;
	}

	.founders em {
		/* the italic leans into the next word without a little room */
		padding-right: 0.12em;
		font-style: italic;
		font-weight: 400;
		color: var(--mustard);
	}

	/* the deck under a hairline, one line: how long on the left, how it happens on the right */
	.deck {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.25rem 1.5rem;
		margin-top: clamp(1.25rem, 3vh, 2rem);
		padding-top: 0.8rem;
		border-top: 1px solid rgb(255 250 240 / 0.55);
		font-size: clamp(1.5rem, 3.2vw, 2.6rem);
		font-weight: 300;
		line-height: 1.15;
		letter-spacing: -0.015em;
	}

	.number {
		font-size: 1.6em;
		font-weight: 600;
		line-height: 0.8;
		letter-spacing: -0.04em;
		color: var(--mustard);
	}

	.kicker {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin: 0 0 2rem;
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	.kicker::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--line);
	}

	.headline {
		display: flex;
		flex-direction: column;
		gap: 0.1em;
		font-size: clamp(2.6rem, 8.2vw, 6.6rem);
		line-height: 0.98;
		letter-spacing: -0.035em;
	}

	.survive {
		font-weight: 300;
		color: var(--ink-soft);
	}

	.thrive {
		font-weight: 600;
	}

	mark {
		padding: 0 0.06em;
		background: linear-gradient(transparent 62%, var(--mustard) 62%, var(--mustard) 90%, transparent 90%);
		color: inherit;
	}

	/* ── the prize: a feature spread ─────────────────────────── */
	.prize {
		padding-block: 4rem 3.5rem;
		border-bottom: 1px solid var(--ink);
	}

	.prize-head {
		display: flex;
		flex-direction: column;
		gap: 0.1em;
		max-width: 22ch;
		margin: 0 0 2.75rem;
		font-size: clamp(2.2rem, 5.6vw, 4.6rem);
		font-weight: 600;
		line-height: 1;
		letter-spacing: -0.035em;
		text-wrap: balance;
	}

	.prize-head .light {
		font-weight: 300;
		color: var(--ink-soft);
	}

	.prize-head em {
		font-weight: 400;
		color: var(--terracotta);
	}

	.prize-body {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
		gap: 3.5rem;
		align-items: start;
	}

	.prize-text p {
		margin: 0 0 1.25rem;
		font-size: clamp(1.15rem, 1.9vw, 1.4rem);
		line-height: 1.6;
		color: var(--ink-soft);
	}

	.prize-text .milestone {
		margin: 1.75rem 0 0;
		font-family: var(--font-display);
		font-size: clamp(1.5rem, 2.8vw, 2.1rem);
		line-height: 1.2;
		letter-spacing: -0.02em;
		color: var(--ink);
	}

	/* the path in three numbers, each a size of its own, read top to bottom */
	.prize-path {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--ink);
	}

	.prize-path li {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding-block: 1.25rem;
		border-bottom: 1px solid var(--line);
	}

	.prize-path strong {
		font-family: var(--font-display);
		font-size: clamp(2.4rem, 4.6vw, 3.6rem);
		font-weight: 600;
		line-height: 1;
		letter-spacing: -0.04em;
	}

	.prize-path li:last-child strong {
		color: var(--terracotta);
	}

	.prize-path span {
		font-size: 0.78rem;
		font-weight: 500;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--muted);
	}

	/* ── chapters hang off a gutter, magazine style ─────────── */
	.chapter {
		display: grid;
		grid-template-columns: var(--gutter) minmax(0, 1fr);
		gap: 2.5rem;
		padding-block: 3.5rem;
		border-bottom: 1px solid var(--line);
	}

	.marker {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin: 0;
		font-family: var(--font-display);
		font-size: 3rem;
		font-weight: 300;
		line-height: 1;
		color: var(--terracotta);
	}

	.marker span {
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 500;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.text {
		max-width: 40rem;
	}

	.text p {
		margin: 0 0 1.25rem;
		font-size: clamp(1.15rem, 1.9vw, 1.4rem);
		line-height: 1.6;
		color: var(--ink-soft);
	}

	.dropcap::first-letter {
		float: left;
		margin: 0.06em 0.12em 0 0;
		font-family: var(--font-display);
		font-size: 4.4em;
		font-weight: 600;
		line-height: 0.8;
		color: var(--ink);
	}

	.text .turn {
		margin: 2rem 0 0;
		font-family: var(--font-display);
		font-size: clamp(1.7rem, 3.4vw, 2.5rem);
		line-height: 1.15;
		letter-spacing: -0.02em;
		color: var(--ink);
	}

	/* ── the pull quote ─────────────────────────────────────── */
	.pull {
		margin: 0;
		padding-block: 4.5rem;
		border-bottom: 1px solid var(--ink);
		text-align: center;
	}

	.pull p {
		max-width: 20ch;
		margin: 0 auto;
		font-family: var(--font-display);
		font-size: clamp(2.1rem, 5.6vw, 4.4rem);
		font-weight: 400;
		line-height: 1.04;
		letter-spacing: -0.03em;
		text-wrap: balance;
	}

	.pull footer {
		display: inline-block;
		margin-top: 1.75rem;
		padding: 0.5rem 1.1rem;
		border-radius: 999px;
		background: var(--mustard);
		font-size: 0.95rem;
		font-weight: 500;
		letter-spacing: 0.02em;
	}

	/* ── the refrain ────────────────────────────────────────── */
	.visions {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.visions li {
		padding-block: 1.4rem;
		border-top: 1px solid var(--line);
		font-family: var(--font-display);
		font-size: clamp(1.3rem, 2.5vw, 1.85rem);
		line-height: 1.3;
		letter-spacing: -0.015em;
	}

	.visions li:first-child {
		padding-top: 0;
		border-top: 0;
	}

	.see {
		margin-right: 0.25em;
		font-weight: 600;
		color: var(--terracotta);
	}

	/* ── the crescendo: every line a size up ────────────────── */
	.crescendo {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.crescendo li {
		font-family: var(--font-display);
		font-size: calc(clamp(1.2rem, 2.2vw, 1.55rem) * (1 + var(--step) * 0.2));
		line-height: 1.12;
		letter-spacing: -0.025em;
		text-wrap: balance;
	}

	.verb {
		font-weight: 600;
	}

	/* ── not stuff, life ────────────────────────────────────── */
	.contrast {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		padding-block: 5rem;
		border-bottom: 1px solid var(--line);
		text-align: center;
	}

	.less {
		font-size: clamp(1rem, 2vw, 1.3rem);
		letter-spacing: 0.04em;
		color: var(--muted);
	}

	.more {
		font-family: var(--font-display);
		font-size: clamp(3.2rem, 11vw, 8.5rem);
		font-weight: 600;
		line-height: 0.95;
		letter-spacing: -0.045em;
	}

	/* ── the close ──────────────────────────────────────────── */
	.close {
		max-width: 52rem;
		margin: 0 auto;
		padding-block: 4.5rem 1rem;
		text-align: center;
	}

	.lead-in {
		max-width: 36rem;
		margin: 0 auto;
		font-size: clamp(1.1rem, 1.8vw, 1.3rem);
		line-height: 1.6;
		color: var(--ink-soft);
	}

	.creed {
		margin: 1.5rem 0 0;
		font-family: var(--font-display);
		font-size: clamp(2rem, 5vw, 3.8rem);
		font-weight: 400;
		line-height: 1.08;
		letter-spacing: -0.03em;
		text-wrap: balance;
	}

	.signature {
		display: inline-flex;
		align-items: center;
		gap: 0.7rem;
		margin: 2.5rem 0 0;
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--ink-soft);
	}

	.signature img {
		width: 2.4rem;
		height: 2.4rem;
		border-radius: 50%;
		object-fit: cover;
	}

	@media (max-width: 760px) {
		.banner img {
			object-position: 30% 40%;
		}

		.spread,
		.prize {
			padding-top: 3rem;
		}

		.prize-body {
			grid-template-columns: 1fr;
			gap: 1.5rem;
		}

		.chapter {
			grid-template-columns: 1fr;
			gap: 1.25rem;
			padding-block: 2.75rem;
		}

		.marker {
			flex-direction: row;
			align-items: baseline;
			gap: 0.9rem;
			font-size: 2.2rem;
		}

		.pull {
			padding-block: 3.25rem;
		}

		.contrast {
			padding-block: 3.5rem;
		}
	}
</style>

<!--
	The why, set as a magazine manifesto: a headline spread, a chapter with a
	drop cap, a pull quote between rules, the "I see" refrain hung off a gutter,
	a crescendo whose lines grow as they build, and the creed as the close.
-->
<script lang="ts">
	import { base } from '$app/paths';

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
	<header class="spread">
		<p class="kicker"><span>Manifesto</span></p>
		<h1>
			<span class="survive">We were never built to survive.</span>
			<span class="thrive">We were built to <mark>thrive.</mark></span>
		</h1>
	</header>

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
			<img src="{base}/samuel.jpg" alt="" />
			<span>avenSamuel</span>
		</p>
	</footer>
</article>

<style>
	.manifesto {
		--gutter: 11rem;
	}

	/* ── the spread ─────────────────────────────────────────── */
	.spread {
		padding-block: 1rem 3.5rem;
		border-bottom: 1px solid var(--ink);
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

	h1 {
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

<script lang="ts">
	import { base } from '$app/paths';

	const sandboxes = [
		{
			name: 'avenCITY Sandbox 1',
			status: 'Open',
			href: `${base}/games/sandbox-1`,
			blurb:
				'A hex island you can found settlements on. Pick a tile, build it up through five levels, watch what the land can carry.',
			cover: `${base}/Day03/Overview 1.png`,
			coverAlt: 'The avenCITY island — hex tiles, water, the first settlement standing on one of them.'
		},
		{
			name: 'avenCITY - No1',
			status: 'Coming soon',
			href: null,
			blurb: 'The second world. Not open yet.',
			cover: null,
			coverAlt: ''
		}
	];
</script>

<svelte:head>
	<title>Games · maiaCITY</title>
	<meta name="description" content="The maiaCITY sandboxes — build the city in a game before it is built in soil." />
</svelte:head>

<main class="wrap">
	<section class="hero">
		<p class="eyebrow">Built game first</p>
		<h1>Games</h1>
		<p class="lede">
			Every part of maiaCITY gets built in a sandbox before anyone puts it in soil. Being wrong
			here costs nothing, which is the whole point of doing it here first.
		</p>
	</section>

	<ul class="grid">
		{#each sandboxes as box (box.name)}
			<li>
				<svelte:element
					this={box.href ? 'a' : 'div'}
					href={box.href ?? undefined}
					class="card"
					class:locked={!box.href}
				>
					<div class="thumb">
						{#if box.cover}
							<img src={box.cover} alt={box.coverAlt} loading="lazy" />
						{:else}
							<div class="soon"><span>Coming soon</span></div>
						{/if}
					</div>
					<div class="body">
						<p class="name">{box.status}</p>
						<h2>{box.name}</h2>
						<p class="blurb">{box.blurb}</p>
						{#if box.href}
							<span class="pill-btn">Open sandbox →</span>
						{/if}
					</div>
				</svelte:element>
			</li>
		{/each}
	</ul>
</main>

<style>
	main {
		padding-block: 3rem 6rem;
	}

	.hero {
		max-width: 44rem;
		margin-bottom: 3rem;
	}

	h1 {
		margin: 0.5rem 0 0;
		font-size: clamp(2.8rem, 7vw, 4.5rem);
	}

	.lede {
		margin: 1.25rem 0 0;
		font-size: 1.15rem;
		line-height: 1.6;
		color: var(--ink-soft);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
		gap: 1.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.card {
		display: flex;
		height: 100%;
		flex-direction: column;
		border-radius: var(--radius);
		background: var(--paper);
		color: inherit;
		text-decoration: none;
		overflow: hidden;
		transition: transform 180ms ease, box-shadow 180ms ease;
	}

	a.card:hover {
		transform: translateY(-3px);
		box-shadow: 0 14px 34px rgb(38 56 44 / 0.1);
	}

	.card.locked {
		opacity: 0.72;
	}

	.thumb {
		aspect-ratio: 16 / 10;
		overflow: hidden;
		background: var(--cream);
	}

	.thumb img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.soon {
		display: grid;
		width: 100%;
		height: 100%;
		place-items: center;
		background: var(--ink);
	}

	.soon span {
		font-size: 0.7rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--paper);
		opacity: 0.6;
	}

	.body {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.6rem;
		padding: 1.4rem 1.5rem 1.6rem;
	}

	.name {
		margin: 0;
		font-size: 0.7rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--muted);
	}

	h2 {
		margin: 0;
		font-size: clamp(1.7rem, 3vw, 2.2rem);
	}

	.blurb {
		flex: 1;
		margin: 0;
		color: var(--ink-soft);
	}

	.pill-btn {
		align-self: flex-start;
		margin-top: 0.5rem;
	}
</style>

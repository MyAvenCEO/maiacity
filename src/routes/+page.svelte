<script lang="ts">
	import { base } from '$app/paths';
</script>

<svelte:head>
	<title>maiaCITY</title>
	<meta name="description" content="maiaCITY — coming soon." />
</svelte:head>

<main class="wrap">
	<div class="text">
		<p class="eyebrow"><span class="dot"></span> Under construction</p>
		<h1>maia<span>CITY</span></h1>
		<p class="lede">Something is being built here. Check back soon.</p>
		<a class="pill-btn" href="{base}/inspire-me">Inspire me →</a>
	</div>

	<div class="arch" aria-hidden="true">
		<span class="orb a"></span>
		<span class="orb b"></span>
		<span class="orb c"></span>
	</div>
</main>

<style>
	main {
		display: grid;
		grid-template-columns: 1.1fr 1fr;
		align-items: center;
		gap: 3rem;
		min-height: calc(100vh - 6rem);
		padding-block: 3rem;
	}

	.dot {
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		margin-right: 0.35rem;
		border-radius: 50%;
		background: var(--mustard);
	}

	h1 {
		margin: 1.25rem 0 0;
		font-size: clamp(3.5rem, 11vw, 8rem);
		font-weight: 300;
	}

	h1 span {
		font-weight: 600;
	}

	.lede {
		max-width: 30ch;
		margin: 1.5rem 0 2rem;
		font-size: 1.2rem;
		color: var(--ink-soft);
	}

	.arch {
		position: relative;
		aspect-ratio: 4 / 5;
		overflow: hidden;
		border-radius: 999px 999px var(--radius) var(--radius);
		background: var(--sage);
	}

	.orb {
		position: absolute;
		border-radius: 50%;
	}

	.a {
		width: 90%;
		aspect-ratio: 1;
		right: -30%;
		bottom: -20%;
		background: var(--mustard);
	}

	.b {
		width: 70%;
		aspect-ratio: 1;
		right: -10%;
		bottom: -5%;
		background: #f6cf85;
	}

	.c {
		width: 45%;
		aspect-ratio: 1;
		left: 12%;
		top: 18%;
		background: rgb(250 248 242 / 0.35);
	}

	@media (max-width: 760px) {
		main {
			grid-template-columns: 1fr;
			min-height: 0;
		}

		.arch {
			max-width: 360px;
		}
	}
</style>

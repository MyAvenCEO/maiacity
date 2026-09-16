<!-- Closes every page that isn't a full-screen sandbox. -->
<script lang="ts">
	import { base } from '$app/paths';
	import { LEGAL_LINKS } from './legal';
	import { socials } from './social';
	import SocialIcon from './SocialIcon.svelte';
</script>

<footer class="site-footer">
	<div class="wrap">
		<div class="card">
			<div class="pitch">
				<p class="kicker">Follow the build</p>
				<p class="line">Follow along and watch Maia City come to life.</p>
			</div>

			<ul class="channels">
				{#each socials as s (s.id)}
					<li>
						<a href={s.href} target="_blank" rel="noopener noreferrer">
							<span class="icon"><SocialIcon id={s.id} size={20} /></span>
							<span class="text">
								<span class="label">{s.label}</span>
								<span class="handle">{s.handle}</span>
							</span>
						</a>
					</li>
				{/each}
			</ul>
		</div>

		<div class="base">
			<a class="logo" href="{base || '/'}">maia<strong>CITY</strong></a>
			<span>We were never built to survive. We were built to thrive.</span>
		</div>

		<nav class="legal" aria-label="Legal">
			{#each LEGAL_LINKS as l (l.href)}
				<a href="{base}{l.href}">{l.label}</a>
			{/each}
		</nav>
	</div>
</footer>

<style>
	.site-footer {
		padding-block: 2rem 2.5rem;
	}

	.card {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 2rem;
		padding: 2rem 2.25rem;
		border-radius: var(--radius);
		background: var(--ink);
		color: var(--cream);
	}

	.kicker {
		margin: 0 0 0.6rem;
		font-size: 0.7rem;
		font-weight: 500;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--mustard);
	}

	.line {
		margin: 0;
		max-width: 22ch;
		font-family: var(--font-display);
		font-size: clamp(1.6rem, 3.2vw, 2.4rem);
		line-height: 1.1;
		letter-spacing: -0.02em;
	}

	.channels {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.6rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.channels a {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.7rem 1rem 0.7rem 0.75rem;
		border-radius: 14px;
		background: rgb(255 255 255 / 0.06);
		color: var(--cream);
		text-decoration: none;
		transition: background-color 160ms ease;
	}

	.channels a:hover {
		background: rgb(255 255 255 / 0.14);
	}

	.icon {
		display: grid;
		place-items: center;
		width: 2.2rem;
		height: 2.2rem;
		border-radius: 50%;
		background: var(--cream);
		color: var(--ink);
		flex: none;
	}

	.text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.label {
		font-size: 0.9rem;
		font-weight: 500;
	}

	.handle {
		overflow: hidden;
		font-size: 0.78rem;
		text-overflow: ellipsis;
		white-space: nowrap;
		opacity: 0.65;
	}

	.base {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem 1.5rem;
		margin-top: 1.25rem;
		padding-inline: 0.5rem;
		font-size: 0.85rem;
		color: var(--muted);
	}

	.logo {
		font-family: var(--font-display);
		font-size: 1.15rem;
		font-weight: 300;
		letter-spacing: -0.02em;
		text-decoration: none;
		color: var(--ink);
	}

	.logo strong {
		font-weight: 600;
	}

	/* the smallest print on the page: one quiet, centred row */
	.legal {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.25rem 1.1rem;
		margin-top: 2rem;
		padding-top: 1rem;
		border-top: 1px solid var(--line);
		font-size: 9px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.legal a {
		color: var(--muted);
		text-decoration: none;
	}

	.legal a:hover {
		color: var(--ink);
	}

	@media (max-width: 820px) {
		.card {
			grid-template-columns: 1fr;
			gap: 1.5rem;
			padding: 1.75rem 1.25rem;
		}
	}

	@media (max-width: 420px) {
		.channels {
			grid-template-columns: 1fr;
		}
	}
</style>

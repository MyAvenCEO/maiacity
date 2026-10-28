<!--
	The newest days of the journal as three quiet rows — number, title, date — under where it starts on the front page:
	posts of the one stream, avenDB's feed ($lib/universe/stream.svelte.js), each to its own page.
-->
<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	import { base } from '$app/paths';
	import { postHref } from '$lib/universe/posts.js';
	import { dayOf } from '$lib/universe/journal.js';

	/** @type {{ posts: any[], title?: string }} */
	let { posts, title = 'Latest days' } = $props();

	// the day it first went out, where it says one
	const dateOf = (p) => (p.published ? new Date(p.published).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
</script>

{#if posts.length}
	<section class="latest" aria-label={title}>
		<div class="latest-head">
			<p class="eyebrow">{title}</p>
			<a href="{base}/universe/?c=Journal">All days →</a>
		</div>
		<ul>
			{#each posts as p (p.id)}
				<li>
					<a href={postHref(base, p)}>
						<span class="num">{dayOf(p) == null ? '' : String(dayOf(p)).padStart(2, '0')}</span>
						<span class="title">{p.title}</span>
						<span class="date">{dateOf(p)}</span>
						<span class="arrow" aria-hidden="true">→</span>
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.latest-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		padding: 0 0.25rem 0.75rem;
	}

	.latest-head .eyebrow {
		margin: 0;
	}

	.latest-head a {
		font-size: 0.85rem;
		text-decoration: none;
		color: var(--ink-soft);
	}

	.latest-head a:hover {
		color: var(--ink);
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--line);
	}

	li a {
		display: grid;
		grid-template-columns: 2.5rem minmax(0, 1fr) auto 1rem;
		align-items: baseline;
		gap: 0.9rem;
		padding: 0.95rem 0.25rem;
		border-bottom: 1px solid var(--line);
		text-decoration: none;
		transition: background-color 150ms ease;
	}

	li a:hover {
		background: var(--paper);
	}

	.num {
		font-family: var(--font-display);
		font-size: 1.1rem;
		color: var(--terracotta);
	}

	.title {
		overflow: hidden;
		font-family: var(--font-display);
		font-size: 1.15rem;
		line-height: 1.25;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.date {
		font-size: 0.8rem;
		color: var(--muted);
		white-space: nowrap;
	}

	.arrow {
		color: var(--muted);
		transition: transform 150ms ease;
	}

	li a:hover .arrow {
		transform: translateX(3px);
		color: var(--ink);
	}

	@media (max-width: 560px) {
		li a {
			grid-template-columns: 2rem minmax(0, 1fr) 1rem;
		}

		.title {
			white-space: normal;
		}

		li a .date {
			display: none;
		}
	}
</style>

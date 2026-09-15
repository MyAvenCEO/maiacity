<script lang="ts">
	import { base } from '$app/paths';
	import { categoryById } from '$lib/inspire-me/categories';

	let { data } = $props();

	const formatted = (date: string) =>
		date
			? new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
			: '';
</script>

<svelte:head>
	<title>Journal · maiaCITY</title>
	<meta name="description" content="Building maiaCITY in public — game first, then real." />
</svelte:head>

<main class="wrap">
	<section class="intro">
		<p class="eyebrow">Building in public</p>
		<h1>Journal</h1>
		<p class="lede">
			One city, built game first and then for real. These are the days, in order, with the
			screenshots that made the argument.
		</p>
	</section>

	<ul class="posts">
		{#each data.posts as post (post.slug)}
			<li>
				<a href="{base}/blog/{post.slug}">
					{#if post.cover}
						<div class="thumb"><img src="{base}{post.cover}" alt="" loading="lazy" /></div>
					{/if}
					<div class="body">
						<p class="eyebrow">
							{#if post.day != null}Day {String(post.day).padStart(2, '0')}&ensp;·&ensp;{/if}{formatted(
								post.date
							)}&ensp;·&ensp;{post.readingMinutes} min
						</p>
						<h2>{post.title}</h2>
						<p class="excerpt">{post.excerpt}</p>
						<div class="foot">
							{#if post.authorImage}
								<img class="avatar" src="{base}{post.authorImage}" alt="" />
							{/if}
							<span>{post.author}</span>
							<ul class="tag-list">
								{#each post.categories as id (id)}
									<li style:--c={categoryById(id).color}>{categoryById(id).label}</li>
								{/each}
							</ul>
						</div>
					</div>
				</a>
			</li>
		{/each}
	</ul>
</main>

<style>
	main {
		padding-block: 4rem 6rem;
	}

	h1 {
		margin-top: 0.75rem;
		font-size: clamp(3.5rem, 9vw, 6.5rem);
	}

	.lede {
		max-width: 46ch;
		margin: 1.25rem 0 0;
		font-size: 1.15rem;
		color: var(--ink-soft);
	}

	.posts {
		display: grid;
		gap: 1.5rem;
		margin: 3rem 0 0;
		padding: 3rem 0 0;
		border-top: 1px solid var(--line);
		list-style: none;
	}

	.posts a {
		display: grid;
		grid-template-columns: minmax(0, 20rem) 1fr;
		gap: 2rem;
		padding: 1.25rem;
		border-radius: var(--radius);
		background: var(--paper);
		text-decoration: none;
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease;
	}

	.posts a:hover {
		transform: translateY(-3px);
		box-shadow: 0 14px 34px rgb(38 56 44 / 0.1);
	}

	.thumb {
		overflow: hidden;
		aspect-ratio: 16 / 10;
		border-radius: calc(var(--radius) - 8px);
		background: var(--cream);
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem 0.75rem 0;
	}

	h2 {
		font-size: clamp(1.7rem, 3vw, 2.3rem);
	}

	.excerpt {
		flex: 1;
		margin: 0;
		color: var(--ink-soft);
	}

	.foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.9rem;
		color: var(--ink-soft);
	}

	.avatar {
		width: 1.9rem;
		height: 1.9rem;
		border-radius: 50%;
		object-fit: cover;
	}

	.foot .tag-list {
		margin-left: 0.4rem;
	}

	@media (max-width: 760px) {
		.posts a {
			grid-template-columns: 1fr;
			gap: 1rem;
		}

		.body {
			padding: 0 0.25rem 0.5rem;
		}
	}
</style>

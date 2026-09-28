<!--
	A day not published yet, read exactly as it will be: its base article from the content board, rendered through the
	same PostView as a real post. Only an admin's browser asks the board; anyone else gets a line saying it isn't out
	yet. /blog/preview/?day=19, or ?project=Day%2019.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { statusLabel } from '$lib/admin/board';
	import { renderMarkdown } from '$lib/admin/markdown';
	import PostView from '$lib/blog/PostView.svelte';
	import { boardDays, boardItems, dayOf, draftOf, mergeDays, postHref } from '$lib/blog/drafts';
	import type { BoardState, Post, PostMeta } from '$lib/blog/types';

	let { data } = $props();

	type View =
		| { kind: 'loading' }
		| { kind: 'closed' }
		| { kind: 'missing'; what: string }
		| { kind: 'ready'; post: Post; board: BoardState; next: PostMeta | null; latest: PostMeta[] };

	let view = $state<View>({ kind: 'loading' });

	// the query is read in the browser only: the shell is prerendered without one
	$effect(() => {
		const q = page.url.searchParams;
		const project = q.get('project');
		const day = Number(q.get('day') ?? project?.match(/\d+/)?.[0]);
		const what = project ?? (Number.isFinite(day) ? `Day ${day}` : 'this day');
		let live = true;
		view = { kind: 'loading' };

		// out already: the real post, for anyone
		const published = data.posts.find((p) => p.day === day && !p.draft);
		if (published) {
			goto(postHref(published), { replaceState: true });
			return;
		}

		(async () => {
			const items = await boardItems();
			if (!live) return;
			if (!items) return void (view = { kind: 'closed' });
			const item =
				(project && items.find((i) => i.project === project && i.body?.trim())) ||
				items.find((i) => dayOf(i) === day && i.body?.trim());
			if (!item) return void (view = { kind: 'missing', what });

			const { meta, body } = await draftOf(item);
			const days = (await boardDays()) ?? [];
			if (!live) return;
			const all = mergeDays(data.posts, days).filter((p) => p.day !== meta.day);
			const next = meta.day != null ? (all.find((p) => p.day === meta.day! + 1) ?? null) : null;
			view = {
				kind: 'ready',
				post: { ...meta, html: renderMarkdown(body) },
				board: meta.board!,
				next,
				latest: all.filter((p) => p.day !== next?.day).slice(0, 3)
			};
		})();

		return () => {
			live = false;
		};
	});

	const goesOut = (iso: string) =>
		new Date(iso).toLocaleString('en-GB', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
</script>

<svelte:head>
	<meta name="robots" content="noindex" />
	{#if view.kind !== 'ready'}<title>Not published yet · maiaCITY</title>{/if}
</svelte:head>

{#if view.kind === 'ready'}
	{@const board = view.board}
	<PostView post={view.post} next={view.next} latest={view.latest}>
		{#snippet top()}
			<div class="draft-bar wrap" role="note">
				<strong>Draft</strong> — only admins see this&ensp;·&ensp;{statusLabel(board.status)}{#if board.goesOut}&ensp;·&ensp;goes
					out {goesOut(board.goesOut)}{/if}
			</div>
		{/snippet}
	</PostView>
{:else}
	<main class="wrap closed">
		<a class="back" href="{base}/blog">← Journal</a>
		{#if view.kind === 'loading'}
			<p class="note" aria-busy="true">&nbsp;</p>
		{:else if view.kind === 'missing'}
			<h1>Not on the board</h1>
			<p class="note">There is no base article for {view.what} on the content board.</p>
		{:else}
			<h1>Not published yet</h1>
			<p class="note">This post isn't published yet. It will be in the journal the day it goes out.</p>
		{/if}
	</main>
{/if}

<style>
	.draft-bar {
		margin-top: 1rem;
		padding-block: 0.55rem;
		border-radius: 999px;
		background: var(--ink);
		color: var(--paper);
		font-size: 0.85rem;
		line-height: 1.4;
		text-align: center;
	}

	.draft-bar strong {
		font-weight: 600;
		color: var(--mustard);
	}

	.closed {
		padding-block: 2.5rem 8rem;
	}

	.back {
		display: inline-block;
		margin-bottom: 2rem;
		font-size: 0.9rem;
		text-decoration: none;
		color: var(--ink-soft);
	}

	h1 {
		margin: 0;
		font-size: clamp(2.2rem, 5vw, 3.4rem);
	}

	.note {
		max-width: 44ch;
		margin: 1rem 0 0;
		font-size: 1.1rem;
		color: var(--ink-soft);
	}
</style>

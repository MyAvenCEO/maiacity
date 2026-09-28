<!--
	Where an unpublished day stands on the content board — "Draft", "Scheduled · Tue 29 Sep" — beside it wherever a
	list shows it. Only an admin's browser ever has a board state to show.
-->
<script lang="ts">
	import { statusLabel } from '$lib/admin/board';
	import type { PostMeta } from './types';

	let { post }: { post: PostMeta } = $props();

	const label = $derived.by(() => {
		if (!post.board) return null;
		const when = post.board.goesOut
			? new Date(post.board.goesOut).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
			: '';
		return `${statusLabel(post.board.status)}${when ? ` · ${when}` : ''}`;
	});
</script>

{#if label}<span class="badge" data-status={post.board?.status}>{label}</span>{/if}

<style>
	.badge {
		display: inline-block;
		padding: 0.2em 0.6em;
		border: 1px solid currentColor;
		border-radius: 999px;
		font-family: var(--font-body, inherit);
		font-size: 0.7rem;
		font-weight: 500;
		letter-spacing: 0.06em;
		line-height: 1.3;
		text-transform: none;
		white-space: nowrap;
		vertical-align: 0.15em;
		color: var(--terracotta);
	}

	.badge[data-status='scheduled'],
	.badge[data-status='published'] {
		color: var(--ink-soft);
	}
</style>

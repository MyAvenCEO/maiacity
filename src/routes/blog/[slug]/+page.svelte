<script lang="ts">
	import PostView from '$lib/blog/PostView.svelte';
	import { boardDays, mergeDays } from '$lib/blog/drafts';
	import type { PostMeta } from '$lib/blog/types';

	let { data } = $props();

	// an admin's browser also shows the days not published yet: the door to the next one, and among the latest
	let days = $state<PostMeta[] | null>(null);
	$effect(() => {
		boardDays().then((d) => (days = d));
	});

	const next = $derived(
		data.next ??
			(data.post.day != null ? (days?.find((d) => d.day === data.post.day! + 1) ?? null) : null)
	);
	// the static latest are the newest the site carries, so mixing the board in and taking three stays right; the
	// board's own card for this day and the next is left out
	const latest = $derived(
		days
			? mergeDays(data.latest, days)
					.filter((p) => p.day !== data.post.day && p.day !== next?.day)
					.slice(0, 3)
			: data.latest
	);
</script>

<PostView post={data.post} {next} {latest} />

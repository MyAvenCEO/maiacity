<!--
	avenCITY Sandbox 4 — a whole dome cell in one world: the master dome, six
	medium domes, six small domes, the paths and streams between them and the
	food forest round it all (interior/village.ts). Walk up to any dome and its
	full inside is built into the village as you come; walk in through its door
	with nothing to wait for. The page round it is the kit's ($lib/sandbox-kit/WorldPage.svelte).
-->
<script lang="ts">
	import { asset } from '$lib/media/url';
	import type { VillageHandle } from '$lib/sandbox-2/interior/village';
	import { WorldPage } from '$lib/sandbox-kit';

	let village: VillageHandle | null = null;
</script>

<svelte:head>
	<title>avenCITY Sandbox 3 · A dome cell · maiaCITY</title>
	<meta name="description" content="Walk a whole maiaCITY dome cell: the master dome, six medium domes and six small domes, with paths, streams and a food forest between them. Step into any of them." />
</svelte:head>

<WorldPage
	mount={async (stage, onProgress) => (village = await (await import('$lib/sandbox-2/interior/village')).mountVillage(stage, onProgress))}
	title="avenCITY Sandbox 3"
	subtitle="A dome cell · thirteen domes"
	keys="Drag to look · WASD to walk · Shift to hurry · walk through any door to step inside"
	cover={{
		image: asset('9e442ce81d3237243f561780fa6d3aeeeb7f1d83ea8e68f3a166650739c398b2.jpg') /* Day 03: a dome from inside */,
		eyebrow: 'avenCITY Sandbox 3',
		title: 'A dome cell',
		size: 'the master dome, six medium domes, six small domes',
		steps: 8
	}}
	notice={() => {
		const opening = village?.opening();
		return opening ? `The ${opening.toLowerCase()} ahead is opening its doors…` : null;
	}}
/>

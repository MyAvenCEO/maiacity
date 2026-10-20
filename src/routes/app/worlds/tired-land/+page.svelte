<!--
	The tired land (Day 19): the fields of one crop, the highway and its trucks (src/lib/worlds/tired-land.ts) —
	walked like every sandbox: drag to look, WASD to walk, Shift to hurry. The page round it is the kit's
	($lib/sandbox-kit/WorldPage.svelte).
-->
<script lang="ts">
	import { WorldPage } from '$lib/sandbox-kit';
</script>

<svelte:head>
	<title>The tired land · Worlds · maiaCITY</title>
</svelte:head>

<WorldPage
	mount={async (stage, onProgress) => (await import('$lib/worlds/tired-land')).mountTiredLand(stage, onProgress)}
	title="The tired land"
	subtitle="Day 19 · a highway through fields of one crop"
	waiting="Loading the tired land…"
	ground="#6f6b4a"
/>

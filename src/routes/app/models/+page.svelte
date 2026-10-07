<!--
	Assets: every reusable model the worlds are built from (src/lib/models), on the shared turntable
	($lib/app/ModelsView.svelte). The buildings (the domes, the containers) are /app/buildings/. An admin's.
-->
<script>
	import { MODELS } from '$lib/models';
	import ModelsView from '$lib/app/ModelsView.svelte';
</script>

<ModelsView name="models" title="Assets" lede="The things the worlds are built from, each to its real measure." items={MODELS} />

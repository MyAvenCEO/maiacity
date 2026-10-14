<!--
	Models: every reusable still model the worlds are built from (src/lib/models), on the shared turntable
	($lib/app/ModelsView.svelte). The buildings (the domes, the containers) are /app/buildings/. An admin's.
-->
<script>
	import { MODELS } from '$lib/models';
	import ModelsView from '$lib/app/ModelsView.svelte';
</script>

<ModelsView name="models" title="Models" lede="The still things the worlds are built from, each to its real measure. What moves is an actor." items={MODELS} />

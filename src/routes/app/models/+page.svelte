<!--
	Things: every reusable still model the worlds are built from (src/lib/models), on the shared turntable
	($lib/app/ModelsView.svelte); the address kept from when they were the Models. The buildings (the domes, the
	containers) are /app/buildings/, what moves by its parts /app/machines/, people and animals /app/actors/. An admin's.
-->
<script>
	import { MODELS } from '$lib/models';
	import ModelsView from '$lib/app/ModelsView.svelte';
</script>

<ModelsView name="models" title="Things" lede="The still things the worlds are built from, each to its real measure. What moves by its parts is a machine; people and animals are actors." items={MODELS} />

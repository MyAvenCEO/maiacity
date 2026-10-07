<!--
	Buildings: what a settlement lives and works in ($lib/buildings) — the tent and the domes of Sandbox 3, each stepped
	inside, and the shipping containers of Sandbox 1, on the turntable and walked in — on the shared turntable
	($lib/app/ModelsView.svelte). An admin's.
-->
<script>
	import { BUILDINGS, groupOf } from '$lib/buildings';
	import ModelsView from '$lib/app/ModelsView.svelte';
</script>

<ModelsView name="buildings" title="Buildings" lede="What a settlement lives and works in: the tents and domes, and the containers." items={BUILDINGS} group={groupOf} round enter />

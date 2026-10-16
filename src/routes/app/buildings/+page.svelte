<!--
	Buildings: what a tribe lives and works in ($lib/buildings), in the one asset viewer ($lib/assets/AssetViewer.svelte),
	each on the same round ground and stepped inside where it stands, the list kept beside it: the shipping containers of
	Sandbox 1 and the wayside of MaiaCity V1 built in the asset box, and the tent and the domes of Sandbox 3, worlds in
	disguise, built alone by Sandbox 3's own interiors ($lib/buildings/inside.js). An admin's.
-->
<script>
	import { BUILDINGS, groupOf } from '$lib/buildings';
	import { raiseInside } from '$lib/buildings/inside.js';
	import AssetViewer from '$lib/assets/AssetViewer.svelte';

	/** the tent and the domes: Sandbox 3's interiors, raised by its own code rather than built in the box */
	const inside = { is: (/** @type {any} */ b) => 'dome' in b, raise: raiseInside };
</script>

<AssetViewer name="buildings" group="buildings" title="Buildings" lede="What a tribe lives and works in: the tents and domes, and the containers." items={BUILDINGS} heading={groupOf} round inPlace {inside} />

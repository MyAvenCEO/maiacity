<!--
	Buildings: what a tribe lives and works in ($content/buildings), in the one asset viewer ($content/assets/AssetViewer.svelte),
	each on the same round ground and stepped inside where it stands, the list kept beside it: the shipping containers of
	Sandbox 1, the wayside of MaiaCity V1 and the bell tent (from its v2) built in the asset box, and the domes of Sandbox
	3 (and the tent's v1), worlds in disguise, built alone by Sandbox 3's own interiors ($content/buildings/inside.js). An
	admin's.
-->
<script>
	import { BUILDINGS, groupOf } from '$content/buildings';
	import { raiseInside } from '$content/buildings/inside.js';
	import AssetViewer from '$content/assets/AssetViewer.svelte';

	/** the domes (and the tent's v1): Sandbox 3's interiors, raised by its own code rather than built in the box; the
	 *  viewer raises one only at a version that is no recipe */
	const inside = { is: (/** @type {any} */ b) => 'dome' in b, raise: raiseInside };
</script>

<AssetViewer name="buildings" group="buildings" title="Buildings" lede="What a tribe lives and works in: the tents and domes, and the containers." items={BUILDINGS} heading={groupOf} round inPlace {inside} />

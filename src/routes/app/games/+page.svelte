<!-- Sandboxes: every sandbox as one list, opened from the dashboard's Sandboxes tile. -->
<script>
	import GroupList from '$lib/app/GroupList.svelte';
	import { SANDBOXES } from '$lib/app/places';
</script>

<GroupList group={SANDBOXES} lede="Every sandbox, each a world of its own to play." />

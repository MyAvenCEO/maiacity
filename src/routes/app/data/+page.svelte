<!-- My Data: the studio's films, the avenDB vaults, the crew's skills and the generated mini apps, as one list. An admin's. -->
<script>
	import GroupList from '$lib/app/GroupList.svelte';
	import { DATA_GROUP } from '$lib/app/places';
</script>

<GroupList group={DATA_GROUP} lede="Your films, your vaults, your skills and your mini apps." />

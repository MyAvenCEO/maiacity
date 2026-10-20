<!-- An old address of the site ($lib/app/redirects.js): on to where it lives now. -->
<script>
	import Moved from '$lib/app/Moved.svelte';

	let { data } = $props();
</script>

{#key data.to}<Moved to={data.to} />{/key}

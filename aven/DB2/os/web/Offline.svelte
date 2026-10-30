<script>
	// The network out of reach, in plain words (README rule 7, "offline"): avenOS goes on with what this browser keeps,
	// and its Peer-Light syncs once the link is back. Why the link was lost (iroh's "Unable to connect to remote" and the
	// like) stays in the timeline (`lost`), not on the page. Shows only on an Aven Peer's host, while the link isn't live.
	import { net } from './network.svelte.js';
	import { live } from './peers.svelte.js';
</script>

{#if net.unreachable && live.own?.phase !== 'live'}
	<p class="offline" data-testid="offline">
		Can't reach the network right now. avenOS works with what this browser keeps and syncs when it's back.
	</p>
{/if}

<style>
	/* in the colour of what it sits in, quieter: the page's muted grey, or the dashboard's light on its green card */
	.offline {
		margin: 0;
		color: inherit;
		font-size: 14px;
		opacity: 0.75;
	}
</style>

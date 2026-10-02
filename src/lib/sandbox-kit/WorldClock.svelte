<!--
	The in-game time, as a pill over the world: the clock the sun follows (game/time), a game
	hour every two real minutes.
-->
<script>
	import { gameClock } from '../../../game/time';

	/**
	 * @type {{
	 *   label?: () => string,
	 *   class?: string
	 * }}
	 */
	let { label = () => gameClock().label, class: cls = '' } = $props();

	let text = $state(gameClock().label);
	$effect(() => {
		text = label();
		const timer = setInterval(() => (text = label()), 1000);
		return () => clearInterval(timer);
	});
</script>

<div class="world-clock {cls}" title="In-game time: a game hour passes every two real minutes">{text}</div>

<style>
	/* a see-through pill: the world shows through, blurred */
	.world-clock {
		padding: 0.55rem 0.9rem;
		border-radius: 999px;
		background: rgb(250 248 242 / 0.55);
		border: 1px solid rgb(255 255 255 / 0.35);
		-webkit-backdrop-filter: blur(12px) saturate(1.2);
		backdrop-filter: blur(12px) saturate(1.2);
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
		color: #1f2a23;
	}
	@media (max-width: 640px) {
		.world-clock {
			padding: 0.5rem 0.75rem;
			font-size: 0.8rem;
			white-space: nowrap;
		}
	}
</style>

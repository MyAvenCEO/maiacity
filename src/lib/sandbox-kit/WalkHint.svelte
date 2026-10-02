<!--
	How to walk a sandbox, at the foot of the screen: the keys where there is a mouse, the
	joystick's words on a phone (where it moves up out of the joystick's way). Say what else
	your world can do with `keys` and `touch`. While a phone's browser has its bars out over the
	world, first how to tuck them away ($lib/touch/browserBars.js).
-->
<script>
	/**
	 * @type {{
	 *   keys?: string,
	 *   touch?: string
	 * }}
	 */
	let {
		keys = 'Drag to look · WASD to walk · Shift to hurry',
		touch = 'Swipe to look · joystick to walk · push to the rim to hurry'
	} = $props();
</script>

<p class="walk-hint">
	<span class="keys">{keys}</span>
	<span class="touch">{touch}</span>
	<span class="bars">Swipe up for full screen</span>
</p>

<style>
	.walk-hint {
		position: absolute;
		bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
		left: 50%;
		transform: translateX(-50%);
		margin: 0;
		padding: 0.5rem 0.9rem;
		border-radius: 999px;
		background: rgb(31 42 35 / 0.45);
		-webkit-backdrop-filter: blur(10px);
		backdrop-filter: blur(10px);
		color: #f2efe7;
		font-size: 0.8rem;
		white-space: nowrap;
	}
	.touch,
	.bars {
		display: none;
	}
	@media (hover: none) and (pointer: coarse) {
		.keys {
			display: none;
		}
		.touch {
			display: inline;
		}
		:global(html[data-bars]) .touch {
			display: none;
		}
		:global(html[data-bars]) .bars {
			display: inline;
		}
		.walk-hint {
			top: calc(4.2rem + env(safe-area-inset-top, 0px));
			bottom: auto;
		}
	}
	/* a phone: smaller, and just under the slimmer bar (./WorldBar.svelte) */
	@media (max-width: 640px), (max-height: 500px) {
		.walk-hint {
			padding: 0.35rem 0.75rem;
			font-size: 0.72rem;
		}
	}
	@media (hover: none) and (pointer: coarse) and (max-width: 640px), (hover: none) and (pointer: coarse) and (max-height: 500px) {
		.walk-hint {
			top: calc(3rem + env(safe-area-inset-top, 0px));
		}
	}
	@media (max-width: 640px) {
		.walk-hint {
			width: max-content;
			max-width: calc(100vw - 2rem);
			white-space: normal;
			text-align: center;
		}
	}
</style>

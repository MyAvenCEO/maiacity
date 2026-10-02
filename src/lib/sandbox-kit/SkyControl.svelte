<!--
	The time of a sandbox's sky, the same control in every world: Auto follows the in-game clock (shown as it runs);
	Manual gives a slider over the day, starting at noon. It sets the one state every world's sky reads
	(./skyTime.svelte.js), so the choice holds from one sandbox to the next; every visit starts on Auto.

	On a phone the two buttons answer as the finger comes down: no click to wait for, which a browser will not make
	while another finger is down (the joystick), nor if the press is taken from it. Their fingers are their own, so
	$lib/touch/TouchStick never takes them for looking round; the slider is the browser's own.
-->
<script>
	import { gameClock } from '../../../game/time';
	import { automatic, manual, skyTime } from './skyTime.svelte.js';

	/** @type {{ class?: string }} */
	let { class: cls = '' } = $props();

	let clock = $state(gameClock().label);
	$effect(() => {
		const timer = setInterval(() => (clock = gameClock().label), 1000);
		return () => clearInterval(timer);
	});
	/** the in-game day and its hour apart, so an upright phone can show the hour alone */
	const [day, hour] = $derived(clock.split(' '));
	const label = $derived(`${String(Math.floor(skyTime.hour) % 24).padStart(2, '0')}:${String(Math.round((skyTime.hour % 1) * 60) % 60).padStart(2, '0')}`);
	/** the sun by day, the moon by night: what the hand-set hour is */
	const daylight = $derived(skyTime.hour >= 6 && skyTime.hour < 19.5);

	/** @type {HTMLButtonElement | undefined} */
	let autoButton = $state();
	/** @type {HTMLButtonElement | undefined} */
	let handButton = $state();
	/** when a finger last chose, so a click the browser makes of the same press is not a second choice */
	let touched = 0;
	const choose = (/** @type {boolean} */ auto) => (auto ? automatic() : skyTime.auto && manual());
	const click = (/** @type {boolean} */ auto) => {
		if (performance.now() - touched > 800) choose(auto);
	};
	// not passive (Svelte's own touchstart is): the press must be kept from the page's other fingers
	$effect(() => {
		/** @type {[HTMLButtonElement | undefined, boolean][]} */
		const pairs = [
			[autoButton, true],
			[handButton, false]
		];
		const off = pairs.map(([el, auto]) => {
			if (!el) return () => {};
			/** @param {TouchEvent} e */
			const press = (e) => {
				e.preventDefault();
				e.stopPropagation();
				touched = performance.now();
				choose(auto);
			};
			el.addEventListener('touchstart', press, { passive: false });
			return () => el.removeEventListener('touchstart', press);
		});
		return () => off.forEach((f) => f());
	});
	/** keep a finger on the slider the slider's */
	const own = (/** @type {TouchEvent} */ e) => e.stopPropagation();
</script>

<div class="sky-control {cls}" class:manual={!skyTime.auto} role="group" aria-label="Time of day">
	<div class="modes">
		<button bind:this={autoButton} class:on={skyTime.auto} aria-pressed={skyTime.auto} title="The sky follows the in-game clock: a game hour every two real minutes" onclick={() => click(true)}>Auto</button>
		<button bind:this={handButton} class:on={!skyTime.auto} aria-pressed={!skyTime.auto} title="Set the time of day by hand" onclick={() => click(false)}>Manual</button>
	</div>
	{#if skyTime.auto}
		<span class="clock" title="In-game time: a game hour passes every two real minutes"><span class="day">{day}</span> {hour}</span>
	{:else}
		<svg viewBox="0 0 24 24" aria-hidden="true">
			{#if daylight}
				<circle cx="12" cy="12" r="4.5" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
			{:else}
				<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
			{/if}
		</svg>
		<input
			type="range"
			min="0"
			max="24"
			step="0.0833"
			value={skyTime.hour}
			aria-label="Time of day"
			oninput={(e) => manual(Number(e.currentTarget.value))}
			ontouchstart={own}
			ontouchmove={own}
		/>
		<span class="clock">{label}</span>
	{/if}
</div>

<style>
	/* a see-through pill: the world shows through, blurred */
	.sky-control {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.3rem 0.75rem 0.3rem 0.3rem;
		border-radius: 999px;
		background: rgb(250 248 242 / 0.55);
		border: 1px solid rgb(255 255 255 / 0.35);
		-webkit-backdrop-filter: blur(12px) saturate(1.2);
		backdrop-filter: blur(12px) saturate(1.2);
		font-size: 0.85rem;
		color: #1f2a23;
		white-space: nowrap;
	}
	.modes {
		display: inline-flex;
		padding: 2px;
		border-radius: 999px;
		background: rgb(31 42 35 / 0.08);
	}
	.modes button {
		padding: 0.3rem 0.7rem;
		border: 0;
		border-radius: 999px;
		background: transparent;
		font: inherit;
		font-size: 0.8rem;
		color: #4c574d;
		cursor: pointer;
		touch-action: none;
		transition: background 0.2s ease, color 0.2s ease;
	}
	.modes button.on {
		background: rgb(255 255 255 / 0.9);
		color: #1f2a23;
		box-shadow: 0 1px 3px rgb(31 42 35 / 0.12);
	}
	.clock {
		font-variant-numeric: tabular-nums;
	}
	svg {
		width: 1.05em;
		height: 1.05em;
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	input[type='range'] {
		width: 8.5rem;
		accent-color: #f0a47c;
		touch-action: none;
	}
	/* a phone, upright or on its side: a slimmer pill, as high as ./WorldBar.svelte's */
	@media (max-width: 640px), (max-height: 500px) {
		.sky-control {
			gap: 0.35rem;
			padding: 0.15rem 0.6rem 0.15rem 0.15rem;
			font-size: 0.75rem;
			line-height: 1.3;
		}
		.modes button {
			padding: 0.2rem 0.55rem;
			font-size: 0.72rem;
			line-height: 1.3;
		}
		input[type='range'] {
			width: 6.5rem;
		}
	}
	/* upright: the hour without its day, and while the slider is out, the slider alone */
	@media (max-width: 640px) {
		.day,
		.sky-control.manual .clock {
			display: none;
		}
		input[type='range'] {
			width: 5.5rem;
		}
	}
</style>

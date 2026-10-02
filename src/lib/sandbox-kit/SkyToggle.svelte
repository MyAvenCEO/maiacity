<!--
	The sky switch of a sandbox: the real sky, whose sun and moon follow the in-game clock, or
	kept at day while the clock runs on. Every visit starts on the real sky. Hand `onchange` to
	the world's sky (`sky.alwaysDay`, ./sky.js).

	On a phone it flips as the finger comes down: no click to wait for, which a browser will not
	make while another finger is down (the joystick), nor if the press is taken from it. The
	finger is its own, so $lib/touch/TouchStick never takes it for looking round.

	A narrow screen shows just the sun or the moon.
-->
<script>
	/**
	 * @type {{
	 *   on?: boolean,
	 *   onchange?: (on: boolean) => void,
	 *   class?: string
	 * }}
	 */
	let { on = $bindable(false), onchange, class: cls = '' } = $props();

	/** @type {HTMLButtonElement | undefined} */
	let button = $state();
	/** when a finger last flipped it, so a click the browser makes of the same press is not a second flip */
	let touched = 0;
	const flip = () => {
		on = !on;
		onchange?.(on);
	};
	const click = () => {
		if (performance.now() - touched > 800) flip();
	};

	// not passive (Svelte's own touchstart is): the press must be kept from the page's other fingers
	$effect(() => {
		const el = button;
		if (!el) return;
		/** @param {TouchEvent} e */
		const press = (e) => {
			e.preventDefault();
			e.stopPropagation();
			touched = performance.now();
			flip();
		};
		el.addEventListener('touchstart', press, { passive: false });
		return () => el.removeEventListener('touchstart', press);
	});
</script>

<button
	bind:this={button}
	class="sky-toggle {cls}"
	class:on
	aria-label="Always day"
	aria-pressed={on}
	title={on ? 'Kept at day — tap for the real sky again' : 'The real sky: sun and moon follow the clock — tap to keep it day'}
	onclick={click}
>
	{#if on}
		<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" /></svg>
		<span>Day</span>
	{:else}
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>
		<span>Real sky</span>
	{/if}
</button>

<style>
	/* a see-through pill: the world shows through, blurred */
	.sky-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.55rem 0.9rem;
		border-radius: 999px;
		background: rgb(250 248 242 / 0.55);
		border: 1px solid rgb(255 255 255 / 0.35);
		-webkit-backdrop-filter: blur(12px) saturate(1.2);
		backdrop-filter: blur(12px) saturate(1.2);
		font: inherit;
		font-size: 0.85rem;
		color: #1f2a23;
		cursor: pointer;
		touch-action: none;
		transition: background 0.2s ease;
	}
	/* a finger on the icon or the words is a finger on the switch */
	.sky-toggle > * {
		pointer-events: none;
	}
	.sky-toggle svg {
		width: 1.05em;
		height: 1.05em;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.sky-toggle.on {
		background: rgb(240 196 154 / 0.7);
	}
	@media (max-width: 640px) {
		.sky-toggle {
			padding: 0.5rem 0.6rem;
			font-size: 0.8rem;
			white-space: nowrap;
		}
		.sky-toggle span {
			display: none;
		}
	}
</style>

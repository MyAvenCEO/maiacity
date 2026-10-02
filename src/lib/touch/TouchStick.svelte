<!--
	The phone's way to walk, the same in every sandbox: a joystick in the lower
	left (push it to the rim to hurry) and, where the page asks for it, any other
	finger on the world looks round. Touch events, each finger by its own
	identifier, so both work at once. Only shown where there is no mouse.

	The ring stays where it is; the knob goes wherever the thumb goes, past the
	rim too, so it is always under the thumb. How far out, up to the rim, sets
	the pace.

	It listens on the element it is placed in. With `look`, every finger on
	`stage` is taken for looking round (a walk: Sandbox 4, inside the domes).
	Without it, fingers off the stick are left to the page's own controls (a map:
	Sandbox 1's island, Sandbox 2's planet and islands).

	A browser makes no click while another finger is down, so a finger on a
	button is followed by hand and clicked when it lifts where it came down: the
	`taps` buttons always (with `look`), any button while the stick is held
	(without). `onpress(el)` may take a button on the press instead, returning true.
-->
<script>
	import { onMount } from 'svelte';

	/**
	 * @type {{
	 *   move: (x: number, y: number, hurry: boolean) => void,
	 *   look?: ((dx: number, dy: number) => void) | null,
	 *   stage?: HTMLElement | null,
	 *   taps?: string,
	 *   onpress?: ((el: HTMLElement) => boolean) | null,
	 *   bottom?: string
	 * }}
	 */
	let { move, look = null, stage = null, taps = '', onpress = null, bottom = '1.5rem' } = $props();

	/** @type {HTMLDivElement} */
	let stickEl;
	/** @type {HTMLSpanElement} */
	let knobEl;
	let hurrying = $state(false);
	/** @type {number | null} */
	let stickFinger = null;
	/** the ring's centre and radius, measured as the thumb comes down */
	let ring = { x: 0, y: 0, r: 64 };
	/** @type {{ id: number, x: number, y: number } | null} */
	let lookFinger = null;
	/** @type {Map<number, { el: HTMLElement, x: number, y: number }>} */
	const pressed = new Map();

	/** @param {Touch} t */
	const stickTo = (t) => {
		const x = t.clientX - ring.x;
		const y = t.clientY - ring.y;
		knobEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
		// full walking pace three quarters of the way to the rim, a hurry at the rim and beyond
		const d = Math.hypot(x, y);
		const m = Math.min(1, d / ring.r);
		const pace = m < 0.08 ? 0 : Math.min(1, m / 0.75);
		hurrying = m > 0.95;
		move((x / (d || 1)) * pace, (-y / (d || 1)) * pace, hurrying);
	};
	const stickRelease = () => {
		stickFinger = null;
		knobEl.style.transform = '';
		hurrying = false;
		move(0, 0, false);
	};

	/** @param {TouchEvent} e */
	const onTouchStart = (e) => {
		const root = stickEl.parentElement;
		let ours = false;
		for (const t of Array.from(e.changedTouches)) {
			// Safari can name the text under the finger rather than its element
			const node = /** @type {Node} */ (t.target);
			const el = /** @type {Element | null} */ (node.nodeType === Node.TEXT_NODE ? node.parentElement : node);
			const button = look ? (taps ? el?.closest?.(taps) : null) : stickFinger !== null ? el?.closest?.('a, button, [role="button"]') : null;
			if (button instanceof HTMLElement && root?.contains(button)) {
				if (!onpress?.(button)) pressed.set(t.identifier, { el: button, x: t.clientX, y: t.clientY });
				ours = true;
			} else if (stickFinger === null && el && stickEl.contains(el)) {
				stickFinger = t.identifier;
				const box = stickEl.getBoundingClientRect();
				ring = { x: box.left + box.width / 2, y: box.top + box.height / 2, r: box.width / 2 };
				stickTo(t);
				ours = true;
			} else if (look && el && (stage ?? root)?.contains(el)) {
				if (lookFinger === null) lookFinger = { id: t.identifier, x: t.clientX, y: t.clientY };
				ours = true;
			}
		}
		// no scrolling, zooming, long-press menu or second, browser-made click
		if (ours) e.preventDefault();
	};
	/** @param {TouchEvent} e */
	const onTouchMove = (e) => {
		let ours = false;
		for (const t of Array.from(e.changedTouches)) {
			if (t.identifier === stickFinger) {
				stickTo(t);
				ours = true;
			} else if (lookFinger && t.identifier === lookFinger.id) {
				look?.(t.clientX - lookFinger.x, t.clientY - lookFinger.y);
				lookFinger.x = t.clientX;
				lookFinger.y = t.clientY;
				ours = true;
			}
		}
		if (ours) e.preventDefault();
	};
	/** @param {TouchEvent} e */
	const onTouchEnd = (e) => {
		for (const t of Array.from(e.changedTouches)) {
			const tap = pressed.get(t.identifier);
			if (tap) {
				pressed.delete(t.identifier);
				if (e.type === 'touchend' && Math.hypot(t.clientX - tap.x, t.clientY - tap.y) < 14) tap.el.click();
			} else if (t.identifier === stickFinger) stickRelease();
			else if (lookFinger && t.identifier === lookFinger.id) lookFinger = null;
		}
	};
	/** @param {Event} e */
	const noPinch = (e) => e.preventDefault();

	onMount(() => {
		const root = stickEl.parentElement;
		if (!root) return;
		root.addEventListener('touchstart', onTouchStart, { passive: false });
		root.addEventListener('touchmove', onTouchMove, { passive: false });
		root.addEventListener('touchend', onTouchEnd);
		root.addEventListener('touchcancel', onTouchEnd);
		// a walk has no zoom: Safari's own pinch, which touch-action alone does not always stop
		if (look) document.addEventListener('gesturestart', noPinch);
		return () => {
			root.removeEventListener('touchstart', onTouchStart);
			root.removeEventListener('touchmove', onTouchMove);
			root.removeEventListener('touchend', onTouchEnd);
			root.removeEventListener('touchcancel', onTouchEnd);
			document.removeEventListener('gesturestart', noPinch);
			if (stickFinger !== null) move(0, 0, false);
		};
	});
</script>

<div class="stick" class:hurrying style:--stick-bottom={bottom} bind:this={stickEl}>
	<span class="knob" bind:this={knobEl}></span>
</div>

<style>
	.stick {
		display: none;
		position: absolute;
		left: calc(1.5rem + env(safe-area-inset-left, 0px));
		bottom: calc(var(--stick-bottom) + env(safe-area-inset-bottom, 0px));
		z-index: 2;
		width: 8rem;
		height: 8rem;
		border-radius: 50%;
		background: rgb(250 248 242 / 0.18);
		border: 1.5px solid rgb(250 248 242 / 0.55);
		box-shadow: 0 2px 14px rgb(31 42 35 / 0.14);
		backdrop-filter: blur(6px);
		align-items: center;
		justify-content: center;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
	/* a thumb landing just outside the ring still takes the knob */
	.stick::before {
		content: '';
		position: absolute;
		inset: -1.5rem;
		border-radius: 50%;
	}
	.stick.hurrying {
		border-color: #f0a47c;
	}
	.knob {
		width: 3.4rem;
		height: 3.4rem;
		border-radius: 50%;
		background: rgb(250 248 242 / 0.9);
		box-shadow: 0 2px 10px rgb(0 0 0 / 0.25);
		pointer-events: none;
		will-change: transform;
	}
	.stick.hurrying .knob {
		background: #f0a47c;
	}
	@media (hover: none) and (pointer: coarse) {
		.stick {
			display: flex;
			will-change: transform;
		}
	}
	/* a phone's screen is the world's: a smaller ring, still a thumb's width to push round */
	@media (max-width: 640px), (max-height: 500px) {
		.stick {
			left: calc(1rem + env(safe-area-inset-left, 0px));
			width: 6.5rem;
			height: 6.5rem;
		}
		.knob {
			width: 2.8rem;
			height: 2.8rem;
		}
	}
</style>

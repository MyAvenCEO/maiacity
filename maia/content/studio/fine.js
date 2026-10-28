// A range slider moved finely: dragging changes its value by how far the pointer travels, not by where it is — the
// whole track is a quarter of the range (with Shift a fortieth), so a few millimetres are a small step and a click
// alone changes nothing. Arrow keys still step, double-click still resets (the slider's own handlers).

/** @param {number} [span] the part of the range the whole track stands for */
export const fine = (span = 0.25) => (/** @type {HTMLInputElement} */ input) => {
	/** @param {PointerEvent} e */
	const down = (e) => {
		if (e.button !== 0) return;
		e.preventDefault();
		input.focus();
		input.setPointerCapture(e.pointerId);
		const min = Number(input.min), max = Number(input.max), step = Number(input.step) || 0.001;
		const w = input.getBoundingClientRect().width || 100;
		let x0 = e.clientX, v = Number(input.value);
		/** @param {PointerEvent} ev */
		const move = (ev) => {
			v = Math.min(max, Math.max(min, v + ((ev.clientX - x0) * (ev.shiftKey ? span / 10 : span) * (max - min)) / w));
			x0 = ev.clientX;
			const q = Math.round(v / step) * step;
			if (Number(input.value) !== q) {
				input.value = String(q);
				input.dispatchEvent(new Event('input', { bubbles: true }));
			}
		};
		const up = () => {
			input.removeEventListener('pointermove', move);
			input.removeEventListener('pointerup', up);
			input.dispatchEvent(new Event('change', { bubbles: true }));
		};
		input.addEventListener('pointermove', move);
		input.addEventListener('pointerup', up);
	};
	input.addEventListener('pointerdown', down);
	return () => input.removeEventListener('pointerdown', down);
};

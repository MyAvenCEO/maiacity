<script>
	// A sequence diagram drawn at build time, in the site's own colours: who talks to whom, step by step, numbered.
	// `spec.actors` are the columns (`person` draws one as a person, not a machine); `spec.steps` are the rows, each a
	// message (`from`, `to`, `text`, `reply` for an answer, drawn dashed), a note over one actor or a span of them
	// (`note: ['M']` or `note: ['M', 'S']`), or a group of steps (`group: 'loop'` or `'alt'`, with `label`, and for an alt
	// an `else: { label, steps }`). A message from an actor to itself is drawn as a loop.

	/**
	 * @typedef {{ id: string, label: string, person?: boolean }} Actor
	 * @typedef {{ from?: string, to?: string, text?: string, reply?: boolean, note?: string[], group?: string,
	 *   label?: string, steps?: Step[], else?: { label: string, steps: Step[] } }} Step
	 * @typedef {{ actors: Actor[], steps: Step[] }} Spec
	 */

	/** @type {{ spec: Spec, label: string }} */
	let { spec, label } = $props();

	const SIDE = 110;
	const HEAD = 64;
	// roughly how wide a label of 12.5 px text is
	/** @param {string} [text] */
	const wide = (text) => (text ?? '').length * 6.2;

	/**
	 * Every step, groups opened up.
	 * @param {Step[]} steps
	 * @returns {Step[]}
	 */
	const flat = (steps) => steps.flatMap((s) => (s.group ? [...flat(s.steps ?? []), ...flat(s.else?.steps ?? [])] : [s]));

	/** @param {string} [id] */
	const at = (id) => spec.actors.findIndex((a) => a.id === id);

	// the columns stand wide enough apart for every message's words
	const COL = $derived(
		Math.max(
			200,
			...flat(spec.steps)
				.filter((s) => !s.note && s.from !== s.to)
				.map((s) => (wide(s.text) + 24) / Math.max(1, Math.abs(at(s.to) - at(s.from))))
		)
	);
	/** @param {string} id */
	const x = (id) => SIDE + COL * at(id);
	// a message the last actor sends itself loops to the left, every other one to the right
	/** @param {string} [id] */
	const leftward = (id) => spec.actors.length > 1 && at(id) === spec.actors.length - 1;
	// and the right edge leaves room for the words of a loop to the right
	const width = $derived(
		Math.max(
			SIDE * 2 + COL * (spec.actors.length - 1),
			...flat(spec.steps)
				.filter((s) => !s.note && s.from === s.to && !leftward(s.from))
				.map((s) => x(s.from ?? '') + 42 + wide(s.text) + 16)
		)
	);

	/**
	 * Each row at its height, and each group's frame around its rows.
	 * @param {Spec} spec
	 */
	function layout(spec) {
		/** @type {Array<Step & { y: number, n: number }>} */
		const rows = [];
		/** @type {Array<{ kind: string, label: string, otherwise: string | null, top: number, mid: number | null, bottom: number, depth: number }>} */
		const frames = [];
		let y = HEAD + 34;
		let n = 0;
		/**
		 * @param {Step[]} steps
		 * @param {number} depth
		 */
		const walk = (steps, depth) => {
			for (const s of steps) {
				if (s.group) {
					const top = y;
					y += 34;
					walk(s.steps ?? [], depth + 1);
					let mid = null;
					if (s.else) {
						mid = y;
						y += 30;
						walk(s.else.steps, depth + 1);
					}
					frames.push({ kind: s.group, label: s.label ?? '', otherwise: s.else?.label ?? null, top, mid, bottom: y, depth });
					y += 18;
				} else if (s.note) {
					rows.push({ ...s, y, n: 0 });
					y += 44;
				} else if (s.from === s.to) {
					rows.push({ ...s, y, n: ++n });
					y += 52;
				} else {
					rows.push({ ...s, y, n: ++n });
					y += 44;
				}
			}
		};
		walk(spec.steps, 0);
		return { rows, frames, height: y + 10 };
	}

	const laid = $derived(layout(spec));

	/**
	 * Where a note sits: over one actor, or over a span of them.
	 * @param {string[]} over
	 * @param {string} text
	 */
	function noteBox(over, text) {
		const xs = over.map(x);
		const lo = Math.min(...xs);
		const hi = Math.max(...xs);
		const w = Math.max(hi - lo + 120, wide(text) + 28);
		// centred over its actors, but never past either edge
		const left = Math.min(Math.max((lo + hi) / 2 - w / 2, 4), width - w - 4);
		return { left, wide: w, mid: left + w / 2 };
	}
</script>

<!-- never drawn larger than life, so a diagram of three actors keeps the type size of one of five -->
<svg
	viewBox="0 0 {width} {laid.height}"
	role="img"
	aria-label={label}
	style:min-width="{Math.max(width * 0.8, 520)}px"
	style:max-width="{width}px"
>
	<!-- the frames of loops and alternatives, behind everything -->
	{#each laid.frames as f, i (i)}
		{@const inset = 26 + f.depth * 10}
		<rect class="frame" x={inset} y={f.top + 4} width={width - inset * 2} height={f.bottom - f.top} rx="10" />
		<path class="tab" d="M{inset} {f.top + 14} q0 -10 10 -10 h{f.kind.length * 8 + 22} v14 l-8 8 h-{f.kind.length * 8 + 24} z" />
		<text class="kind" x={inset + 10} y={f.top + 20}>{f.kind}</text>
		<text class="when" x={inset + f.kind.length * 8 + 44} y={f.top + 21}>[{f.label}]</text>
		{#if f.mid !== null}
			<line class="split" x1={inset} y1={f.mid + 6} x2={width - inset} y2={f.mid + 6} />
			<text class="when" x={inset + 12} y={f.mid + 24}>[{f.otherwise}]</text>
		{/if}
	{/each}

	<!-- each actor, at the head of its lifeline -->
	{#each spec.actors as a (a.id)}
		<line class="life" x1={x(a.id)} y1={HEAD} x2={x(a.id)} y2={laid.height - 4} />
		<rect class="actor" class:person={a.person} x={x(a.id) - 82} y="8" width="164" height={HEAD - 16} rx={a.person ? 24 : 10} />
		<text class="who" x={x(a.id)} y={HEAD / 2 + 5} text-anchor="middle">{a.label}</text>
	{/each}

	{#each laid.rows as r, i (i)}
		{#if r.note}
			{@const b = noteBox(r.note, r.text ?? '')}
			<rect class="note" x={b.left} y={r.y - 18} width={b.wide} height="30" rx="6" />
			<text class="said" x={b.mid} y={r.y + 2} text-anchor="middle">{r.text}</text>
		{:else if r.from === r.to}
			{@const at = x(r.from ?? '')}
			{@const dir = leftward(r.from) ? -1 : 1}
			<path class="msg" d="M{at} {r.y} h{dir * 34} v20 h{-dir * 30}" />
			<path class="head" d="M{at + dir * 4} {r.y + 20} l{dir * 9} -5 v10 z" />
			<circle class="num" cx={at - dir * 16} cy={r.y} r="9" />
			<text class="n" x={at - dir * 16} y={r.y + 3.5} text-anchor="middle">{r.n}</text>
			<text class="said" x={at + dir * 42} y={r.y + 14} text-anchor={dir < 0 ? 'end' : 'start'}>{r.text}</text>
		{:else}
			{@const a = x(r.from ?? '')}
			{@const b = x(r.to ?? '')}
			{@const dir = Math.sign(b - a)}
			<line class="msg" class:reply={r.reply} x1={a} y1={r.y} x2={b - dir * 6} y2={r.y} />
			<path class="head" d="M{b} {r.y} l{-dir * 10} -5 v10 z" />
			<circle class="num" cx={a + dir * 14} cy={r.y} r="9" />
			<text class="n" x={a + dir * 14} y={r.y + 3.5} text-anchor="middle">{r.n}</text>
			<text class="said" x={(a + b) / 2} y={r.y - 12} text-anchor="middle">{r.text}</text>
		{/if}
	{/each}
</svg>

<style>
	svg {
		display: block;
		width: 100%;
		margin-inline: auto;
		height: auto;
	}
	text {
		font-family: var(--font-body);
		fill: var(--ink);
	}
	.life {
		stroke: var(--line);
		stroke-width: 1.5;
		stroke-dasharray: 4 5;
	}
	.actor {
		fill: color-mix(in srgb, var(--sage) 22%, var(--paper));
		stroke: var(--ink);
		stroke-width: 1.4;
	}
	.actor.person {
		fill: color-mix(in srgb, var(--mustard) 30%, var(--paper));
	}
	.who {
		font-size: 14px;
		font-weight: 600;
	}
	.msg {
		stroke: var(--ink);
		stroke-width: 1.6;
		fill: none;
	}
	.msg.reply {
		stroke-dasharray: 6 4;
	}
	.head {
		fill: var(--ink);
	}
	.num {
		fill: var(--ink);
	}
	.n {
		font-size: 10.5px;
		font-weight: 600;
		fill: var(--cream);
	}
	.said {
		font-size: 12.5px;
		fill: var(--ink-soft);
		/* over a lifeline, the words keep a halo of paper */
		paint-order: stroke;
		stroke: var(--paper);
		stroke-width: 5px;
		stroke-linejoin: round;
	}
	.note {
		fill: color-mix(in srgb, var(--mustard) 26%, var(--paper));
		stroke: color-mix(in srgb, var(--mustard) 70%, var(--ink));
		stroke-width: 1;
	}
	.frame {
		fill: color-mix(in srgb, var(--sage) 7%, transparent);
		stroke: var(--muted);
		stroke-width: 1;
	}
	.tab {
		fill: var(--ink);
	}
	.kind {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.08em;
		fill: var(--cream);
	}
	.when {
		font-size: 12px;
		font-style: italic;
		fill: var(--ink-soft);
	}
	.split {
		stroke: var(--muted);
		stroke-dasharray: 5 4;
	}
</style>

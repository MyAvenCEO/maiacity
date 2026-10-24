// @ts-nocheck — version adapters inject their own world and immutable story data.
import { connectFilm, createCameraHold } from './film.js';
import { createTimeline } from './timeline.js';

/** One film driver for the same createWorld used by gameplay. No asset versions are rewritten. */
export function createIntroFilm({ sandbox, createWorld, momentOf, intro }) {
 const { HOLD, PLAN_VERSION, RATE, TREES, WALK, freshStep, introPlan, linesKey, loadBaked, shotSpec } = intro;
	/** @param {HTMLElement} container @param {string} seat @param {(label: string) => void} onProgress */
	return async function mountIntroFilm(container, seat = 'A', onProgress = (/** @type {string} */ _label) => {}) {
		const plan = introPlan(seat);
		onProgress('Reading the intro');
		// &remeasure: every step timed again, whatever is baked (the bake script asks for it)
		const data = new URLSearchParams(location.search).has('remeasure') ? null : await loadBaked(seat);
		const canvas = document.createElement('canvas');
		canvas.style.cssText = 'display:block;width:100%;height:100%';
		container.appendChild(canvas);

		/** the world's clock: the second of the intro the world is at */
		let clock = 0;
		/** what is being measured now: the step's start, and the lines and shots it records */
		let rec = null;
		let measuring = false;
		const world = createWorld(canvas, {
			clock: () => clock,
			own: false,
			film: true,
			// the hour a shot sets (game/film/shot.js `time`), else the story's
			hourOf: () => (rec ? undefined : window.__interiorHour),
			onCaption: (c) => {
				if (!rec || !c?.title) return;
				const m = world.film.moment();
				// a title card's line is its title and the words under it (the welcome)
				const text = c.sub ? `${c.title}${/[.!?…]$/.test(c.title) ? '' : '.'} ${c.sub}` : c.title;
				rec.lines.push({ t: round((m?.t0 ?? clock) - rec.t), dur: round(c.dur ?? 0), text });
			}
		});
		const F = world.film;

		// each step of the story: its segments, the ones still the baked step's known by their ticks
		const fresh = plan.steps.map((p) => freshStep(data, p));
		const parts = plan.steps.map((p, i) => ({ segs: p.segs.map((kind, j) => ({ n: fresh[i]?.segs[j]?.n ?? null })) }));
		/** the walk to the spot: how long it takes (ticks), as the world says when it sets off */
		let walkTicks = 0;
		const timeline = createTimeline({
			rate: RATE,
			parts,
			enter(i, t) {
				const p = plan.steps[i];
				clock = t;
				if (measuring) rec = { t, lines: [], shots: [], key: '' };
				F.reset(t, 1 + i);
				world.choose({ on: false });
				world.update(p.view, null);
				world.trees(p.trees);
				world.reveal(p.reveal);
				world.set(p.stage.set);
				world.touring(true);
				if (p.stage.place) world.focus(p.stage.place, { now: true });
			},
			start(i, j, t) {
				const p = plan.steps[i], kind = p.segs[j], at = TREES[seat];
				clock = t;
				if (kind === 'moment') momentOf(world, p.step);
				else if (kind === 'hold' && p.step.kind === 'spot') world.choose({ on: true, at, ok: true });
				// the film cuts the walk short (WALK s): the plant stake is struck where the spot is, wherever they got to
				else if (kind === 'walk') walkTicks = Math.round(Math.min(WALK, world.walkTo(at.x, at.z) ?? 0) * RATE);
				else if (kind === 'sticks') (world.choose({ on: false }), world.sticks(at));
				else if (kind === 'joy') world.joy();
			},
			tick(t, drawn) {
				clock = t;
				F.tick(t, drawn);
				if (rec) record();
			},
			done(i, j, k) {
				const kind = plan.steps[i].segs[j];
				if (kind === 'hold') return k >= HOLD * RATE;
				if (kind === 'walk') return k >= walkTicks;
				return !F.moment();
			}
		});

		/** a shot cut where a moment's shot begins: its time, its hour, whether it is the low cut cold */
		function record() {
			const m = F.moment(), hour = F.hour();
			const key = m ? `${m.start}:${m.i}` : '';
			if (m && m.shot && key !== rec.key) {
				const t = round(m.t0 - rec.t);
				if (!rec.shots.length || t > rec.shots.at(-1).t + 1e-6) rec.shots.push({ t, hour, cold: m.cold });
				else Object.assign(rec.shots.at(-1), { hour, cold: m.cold });
			}
			if (m) rec.key = key;
			const last = rec.shots.at(-1);
			if (last && m) last.hourEnd = hour; // a time-lapse: the hour the moment has run to
		}

		// what is baked stays; the rest is measured here, step by step
		const measured = {};
		const sched = () => timeline.schedule();
		onProgress('Timing the intro');
		measuring = true;
		await timeline.measure(async (i) => {
			const s = sched()[i];
			measured[i] = finish(i, s, rec);
			rec = null;
			onProgress(`Timing the intro: ${plan.steps[i].step.title}`);
			await new Promise((r) => setTimeout(r, 0));
		});
		measuring = false;
		/** a step's times as they are kept (./intro/<seat>.json) */
		function finish(i, s, r) {
			const p = plan.steps[i];
			const cuts = r?.shots?.length ? r.shots : [{ t: 0, hour: F.hour(), cold: false }];
			if (cuts[0].t > 1e-6) cuts.unshift({ t: 0, hour: cuts[0].hour, cold: false });
			const shots = cuts.map((c, k) => {
				const end = k + 1 < cuts.length ? cuts[k + 1].t : s.dur;
				const line = (r?.lines ?? []).find((l) => Math.abs(l.t - c.t) < 1e-3)?.text;
				return { t: c.t, dur: round(end - c.t), hour: round(c.hour), ...(c.hourEnd !== undefined && Math.abs(c.hourEnd - c.hour) > 0.01 ? { hourTo: round(c.hourEnd) } : {}), ...(c.cold ? { cold: true } : {}), name: `${i + 1}.${k + 1} ${p.step.title}`, ...(line ? { line } : {}) };
			}).filter((x) => x.dur > 1e-6);
			return { id: p.step.id, key: p.key, lineKey: linesKey(p.step), chapter: p.step.chapter, title: p.step.title, kind: p.step.kind ?? 'next', t: round(s.t), dur: round(s.dur), segs: s.segs.map((g, j) => ({ kind: p.segs[j], n: g.n, t: round(g.t), dur: round(g.dur) })), lines: r?.lines ?? [], text: p.step.lines.filter(Boolean), shots };
		}
		const steps = sched().map((s, i) => {
			if (measured[i]) return measured[i];
			// a baked step: its times again, placed where it now starts
			const b = fresh[i];
			return { ...b, t: round(s.t), dur: round(s.dur), segs: s.segs.map((g, j) => ({ kind: plan.steps[i].segs[j], n: g.n, t: round(g.t), dur: round(g.dur) })) };
		});
		const schedule = { version: PLAN_VERSION, seat, rate: RATE, seconds: round(timeline.seconds), steps };

		// the film's hold on the world
		const camera = F.camera;
		const hold = createCameraHold(camera);
		let undo = () => {};
		const film = connectFilm({
			sandbox,
			area: seat,
			renderer: F.renderer,
			scene: F.scene,
			camera,
			hold,
			frames: F.frames,
			lights: F.lights,
			animate(t) {
				// the lens the shot set stays the shot's, whatever the world's own moves do to it on the way to t
				const fov = camera.fov, near = camera.near;
				undo();
				undo = () => {};
				timeline.seek(Math.max(0, Math.min(schedule.seconds, t)));
				if (hold.flying()) ((camera.fov = fov), (camera.near = near), camera.updateProjectionMatrix());
			},
			parts: (values) => void (undo = F.parts(values)),
			async stage(w) {
				timeline.seek(w.clock ?? 0);
				await world.ready;
			},
			extra: {
				intro: {
					seat,
					plan,
					/** every step's times, as ./intro/<seat>.json keeps them */
					schedule: () => schedule,
					/** the intro as world shots, one after another */
					shots: () => steps.flatMap((s) => s.shots.map((x) => shotSpec(seat, s, x))),
					seek: (t) => timeline.seek(t)
				}
			}
		});
		timeline.seek(0);
		await world.ready;
		onProgress('ready');
		return {
			dispose() {
				film.disconnect();
				world.dispose();
				canvas.remove();
			}
		};
	}

}

const round = (x) => Math.round(x * 1e4) / 1e4;

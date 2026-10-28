// @ts-nocheck — plain JS, the view host's own code
/*
 * THE WATCH — what holds a view's script to a budget of work (gap G7): a worker of ours beside the view's own, which
 * the frame's engine (./engine.js) starts and hands one end of a channel to the view's worker (./worker.js answers
 * there). Nothing of the view's ever runs in it, and nothing of the view's can reach it.
 *
 * A worker's time can't be read from outside it, and anything inside it the view's script can bend. So the watch asks:
 * at moments the script can't foresee (a random wait after each answer, on average `gap` ms), it sends the view's worker
 * a number no one can guess, and the worker's engine sends it straight back. A worker hears a message only between its
 * script's turns, so an answer that waits was a worker at work, and how long it waits is how long it worked. No answer
 * can leave before its ask came, and the script, which may answer too, can only answer when it is free: the wait is
 * the truth either way.
 *
 * The budget: `hand` ms of work in hand to start with, refilled by `share` of the time that passes (never past `hand`),
 * and spent by every ms an ask waits past `free` (a message's own way across). A script that works more than `share` of
 * the time spends its hand. On the way its animation frames are spaced out (`{ op: 'pace', ms }`, which the frame passes
 * to the view's worker): a scene that only draws too often for the machine slows down and lives. Once the hand is gone
 * the watch tells the frame (`{ op: 'spent' }`), which ends the view's worker. One that holds its worker without a
 * break is stopped sooner, by the frame's own four seconds.
 *
 * What it doesn't see: work in slices shorter than a message's way across (a few ms, each followed by a pause) is
 * missed in part. Memory it can't see at all: a browser gives a worker no memory cap.
 *
 * `WATCH` is its code, one script the frame starts from a blob: URL. Its first message is
 * { op: 'watch', port, budget: { hand, share, free, gap } }.
 */

function watch() {
	let port = null;
	let budget = null;
	/** the work in hand (ms), and when it was last counted */
	let hand = 0;
	let last = 0;
	/** the ask out, waiting for its answer: when it left, and its number */
	let out = null;
	let spent = false;
	/** how far apart its animation frames come (ms; 0: as the screen draws them) */
	let pace = 0;
	const now = () => performance.now();
	const number = () => crypto.getRandomValues(new Uint32Array(2)).join('.');
	/** the time since it was last counted: refilled by its share, less what an ask out waited past its way across */
	function count(t) {
		hand = Math.min(budget.hand, hand + (t - last) * budget.share);
		if (out) {
			const from = Math.max(last, out.at + budget.free);
			if (t > from) hand -= t - from;
		}
		last = t;
		if (hand < 0 && !spent) {
			spent = true;
			postMessage({ op: 'spent', hand: budget.hand, share: budget.share });
			close();
		}
		if (!spent) paced();
	}
	/**
	 * A worker that spent half its hand has its animation frames spaced out: 100 ms apart, then 500 ms once it spent
	 * three quarters, then 2 s once it spent nine tenths (a scene a slow graphics card can't keep up with makes its
	 * worker wait for it, and the wait counts as work: in a browser drawing without a graphics card, each frame of a
	 * three.js scene can hold its worker 300 ms). They come closer again a step at a time as its hand fills back past
	 * the next mark up. A frame that holds its worker less than the slowest pace never spends the hand. Work that is
	 * no animation frame slows for nothing, and is stopped once the hand is spent.
	 */
	const PACES = [0, 100, 500, 2000];
	/** the part of its hand left below which each pace comes, and from which it goes back to the one before */
	const SLOWER = [1, 0.5, 0.25, 0.1];
	const FASTER = [1, 0.75, 0.5, 0.25];
	function paced() {
		const f = hand / budget.hand;
		let at = PACES.indexOf(pace);
		while (at < PACES.length - 1 && f < SLOWER[at + 1]) at++;
		while (at > 0 && f >= FASTER[at]) at--;
		if (PACES[at] !== pace) postMessage({ op: 'pace', ms: (pace = PACES[at]) });
	}
	function ask() {
		if (spent) return;
		const t = now();
		count(t);
		out = { at: t, number: number() };
		port.postMessage(out.number);
	}
	onmessage = (e) => {
		const m = e.data;
		if (port || !m || m.op !== 'watch' || !m.port || !m.budget) return;
		const b = m.budget;
		budget = { hand: Number(b.hand), share: Number(b.share), free: Number(b.free), gap: Number(b.gap) };
		port = m.port;
		hand = budget.hand;
		last = now();
		port.onmessage = (a) => {
			// only the answer to the ask out counts: an old number, or a guess, is no answer
			if (!out || a.data !== out.number) return;
			count(now());
			out = null;
			setTimeout(ask, Math.random() * 2 * budget.gap);
		};
		// a worker that never answers is counted all the same, as the time goes by
		setInterval(() => count(now()), 100);
		ask();
	};
}

/** the watch's code, as the frame starts it */
export const WATCH = `(${watch})();`;

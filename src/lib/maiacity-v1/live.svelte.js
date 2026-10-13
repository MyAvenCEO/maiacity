// @ts-nocheck — plain JS, kept loose on purpose
// MaiaCity V1's one game, live, for a page outside the game screen (the dashboard's Ledger and Coops apps): it loads
// the game from the server, refreshes it every few seconds and, in between, runs the same rules forward to the second
// (advance), so the numbers count live. `move` sends a move for a seat and takes the answer.
import { onMount } from 'svelte';
import { SEATS, advance } from '../../../game/maiacity-v1/engine.js';
import { loadGame, sendMove } from './store.js';

export function liveGame() {
	let game = $state.raw(null);
	let me = $state('');
	let admin = $state(false);
	let skew = 0;
	let tick = $state(Date.now());
	let error = $state('');
	let busy = $state(false);
	let loaded = $state(false);

	const now = $derived(tick + skew);
	const view = $derived(game ? advance(game, now) : null);
	const mySeat = $derived(view ? (SEATS.find((s) => view.players[s].founder === me) ?? null) : null);

	function take(res) {
		game = res.game;
		if (res.me) me = res.me;
		if (res.admin != null) admin = res.admin;
		if (res.now) skew = res.now - Date.now();
		tick = Date.now();
	}

	async function refresh() {
		try {
			take(await loadGame());
			error = '';
		} catch (e) {
			error = e?.message ?? String(e);
		} finally {
			loaded = true;
		}
	}

	async function move(seat, action) {
		if (busy) return false;
		busy = true;
		error = '';
		try {
			take(await sendMove(seat, action));
			return true;
		} catch (e) {
			error = e?.message ?? String(e);
			return false;
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		refresh();
		const t = setInterval(() => (tick = Date.now()), 1000);
		const r = setInterval(refresh, 10000);
		return () => (clearInterval(t), clearInterval(r));
	});

	return {
		get view() { return view; },
		get now() { return now; },
		get me() { return me; },
		get admin() { return admin; },
		get mySeat() { return mySeat; },
		get error() { return error; },
		get busy() { return busy; },
		get loaded() { return loaded; },
		move
	};
}

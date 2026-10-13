// @ts-nocheck — plain JS, kept loose on purpose
/**
 * MaiaCity V1 in the database: the one shared game both players see (game/maiacity-v1/engine.js holds the rules).
 * Every read brings the game forward to now and every move runs on the row locked, so two players acting at once
 * never lose each other's moves. A seat is taken by a signed-in founder; only they (or an admin) move for it.
 */
import { db } from "./pg";
import { GameError, SEATS, VERSION, act, advance, newGame } from "../../game/maiacity-v1/engine.js";

export { GameError };

const GAME = "main";
const json = (v) => JSON.stringify(v ?? null);

async function load(tx, now) {
  const { rows } = await tx.query("SELECT state FROM v1_games WHERE id = $1 FOR UPDATE", [GAME]);
  const old = rows[0]?.state;
  if (old && (old.version ?? 1) === VERSION) return old;
  if (old) {
    // a game of an older shape (V1 had two COOPs) starts again from year 0; its seats stay with their founders
    const state = newGame(now);
    for (const s of SEATS) Object.assign(state.players[s], { founder: old.players?.[s]?.founder ?? null, name: old.players?.[s]?.name ?? `Player ${s}` });
    return state;
  }
  const state = newGame(now);
  await tx.query("INSERT INTO v1_games (id, state) VALUES ($1, ($2::text)::jsonb) ON CONFLICT (id) DO NOTHING", [GAME, json(state)]);
  return state;
}

const save = (tx, state) => tx.query("UPDATE v1_games SET state = ($2::text)::jsonb, updated = now() WHERE id = $1", [GAME, json(state)]);

/** the game as it stands now (advanced and kept, so month ends are booked once) */
export function getGame(now = Date.now()) {
  return db.transaction(async (tx) => {
    const state = advance(await load(tx, now), now);
    await save(tx, state);
    return state;
  });
}

/** a founder takes an empty seat (or the one they hold) */
export function takeSeat(founder, seat, now = Date.now()) {
  if (!SEATS.includes(seat)) throw new GameError("No such player.");
  return db.transaction(async (tx) => {
    const state = advance(await load(tx, now), now);
    const p = state.players[seat];
    if (p.founder && p.founder !== founder.id) throw new GameError(`${p.name} is taken.`, 409);
    const other = SEATS.find((s) => s !== seat && state.players[s].founder === founder.id);
    if (other) throw new GameError(`You play ${state.players[other].name} already.`, 409);
    p.founder = founder.id;
    if (p.name === `Player ${seat}` && founder.name) p.name = `${founder.name}`.slice(0, 40);
    await save(tx, state);
    return state;
  });
}

/** one move for a seat: by the founder in it, or by an admin (who may play both seats to test) */
export function move(founder, admin, seat, action, now = Date.now()) {
  if (!SEATS.includes(seat)) throw new GameError("No such player.");
  return db.transaction(async (tx) => {
    const before = await load(tx, now);
    const p = before.players[seat];
    if (p.founder !== founder.id && !admin) throw new GameError(p.founder ? `Only ${p.name} moves for this seat.` : "Take this seat first.", 403);
    const state = act(before, seat, action, now);
    await save(tx, state);
    return state;
  });
}

/** start again from virtual year 0 (an admin's): the seats stay with their founders and names */
export function resetGame(now = Date.now()) {
  return db.transaction(async (tx) => {
    const old = await load(tx, now);
    const state = newGame(now, old.settings);
    for (const s of SEATS) Object.assign(state.players[s], { founder: old.players[s].founder, name: old.players[s].name });
    await save(tx, state);
    return state;
  });
}

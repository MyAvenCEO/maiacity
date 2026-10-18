// @ts-nocheck — plain JS, kept loose on purpose
/**
 * MaiaCity V1 in the database: the one shared game both players see (game/maiacity-v1/engine.js holds the rules).
 * Every read brings the game forward to now and every move runs on the row locked, so two players acting at once
 * never lose each other's moves. Seats go to signed-in founders in the order they arrive: the first is Player A, the
 * second Player B, each named after the founder. Only the founder in a seat moves for it; nobody plays another's seat.
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
    // a game of an older shape starts again from year 0 with both seats free: the next founders to sign in take them
    return newGame(now);
  }
  const state = newGame(now);
  await tx.query("INSERT INTO v1_games (id, state) VALUES ($1, ($2::text)::jsonb) ON CONFLICT (id) DO NOTHING", [GAME, json(state)]);
  return state;
}

const save = (tx, state) => tx.query("UPDATE v1_games SET state = ($2::text)::jsonb, updated = now() WHERE id = $1", [GAME, json(state)]);

/** a founder without a seat takes the first free one (A, then B); a founder with one keeps it. Either way the seat
 * carries the founder's own profile name (so their HEARTS are theirs by name too), kept up to date on every visit */
function join(state, founder) {
  if (!founder?.id) return;
  const seat = SEATS.find((s) => state.players[s].founder === founder.id) ?? SEATS.find((s) => !state.players[s].founder);
  if (!seat) return;
  state.players[seat].founder = founder.id;
  if (founder.name) state.players[seat].name = `${founder.name}`.trim().slice(0, 40);
}

/** the game as it stands now (advanced and kept, so month ends are booked once); a founder signing in (not an app
 * key) joins it on the first free seat
 * @param {{ id: string, name?: string } | null} [founder] @param {number} [now] */
export function getGame(founder = null, now = Date.now()) {
  return db.transaction(async (tx) => {
    const state = advance(await load(tx, now), now);
    join(state, founder);
    await save(tx, state);
    return state;
  });
}

/** a founder takes the first free seat (the seat asked for does not matter: seats go in the order founders arrive) */
export function takeSeat(founder, _seat, now = Date.now()) {
  return db.transaction(async (tx) => {
    const state = advance(await load(tx, now), now);
    join(state, founder);
    if (!SEATS.some((s) => state.players[s].founder === founder.id)) throw new GameError("Both seats are taken.", 409);
    await save(tx, state);
    return state;
  });
}

/** one move, always for the seat the founder holds: nobody moves for the other player. The one exception is an
 * admin's MIP proposed over the MCP (unsigned, both players sign it on the page), which needs no seat. */
export function move(founder, admin, _seat, action, now = Date.now()) {
  return db.transaction(async (tx) => {
    const before = await load(tx, now);
    let seat = SEATS.find((s) => before.players[s].founder === founder.id);
    if (!seat && admin && action?.type === "propose" && action?.mip?.via === "mcp") seat = "A";
    if (!seat) throw new GameError("You have no seat in this game.", 403);
    const state = act(before, seat, action, now);
    await save(tx, state);
    return state;
  });
}

/** start again from virtual year 0 (an admin's): the seats stay with their founders and names (VERSION frees them) */
export function resetGame(now = Date.now()) {
  return db.transaction(async (tx) => {
    const old = await load(tx, now);
    const state = newGame(now, old.settings);
    for (const s of SEATS) Object.assign(state.players[s], { founder: old.players[s].founder, name: old.players[s].name });
    await save(tx, state);
    return state;
  });
}

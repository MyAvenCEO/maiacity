// @ts-nocheck — plain JS, kept loose on purpose
/**
 * MaiaCity V2 in the database: the one shared game its three players see (game/maiacity-v2/engine.js holds the
 * rules), kept as V1's is (api/src/maiacity-v1.js `gameStore`) on its own table. A game kept by V1's engine (17) or
 * V2's (18) plays on, its economy brought to V2's once (`consolidate`); any other is refused, its progress kept.
 */
import { db } from "./pg";
import * as V2 from "../../game/maiacity-v2/engine.js";
import { gameStore } from "./maiacity-v1.js";

export const { GameError } = V2;
const { VERSION, consolidate } = V2;

const supported = (old) => [17, VERSION].includes(old.version ?? 1);

const store = gameStore({
  table: "v2_games",
  engine: V2,
  kept: supported,
  refuse: () => new GameError("V2 needs a state migration; its saved progress has been preserved.", 409),
  full: "All three seats are taken."
});

export const { getGame, takeSeat, move } = store;

/** Apply the authorized V2 financial seed once at deployment; archive the previous state. */
export function seedPendingGame(now = Date.now()) {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query("SELECT state FROM v2_games WHERE id = $1 FOR UPDATE", ["main"]);
    const old = rows[0]?.state;
    if (!old || old.economy === "maia-village-v1") return false;
    if (!supported(old)) throw new GameError("V2 seed requires a supported snapshot", 409);
    await store.save(tx, consolidate(old, now));
    return true;
  });
}

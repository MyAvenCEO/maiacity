// Which games are published, as the Maia City COOP vault says (game/games.js, A2 of the AIP plan): a game is while
// the vault gives everyone a Public share on its `game:<id>` tag, and avenDB's server lists its entry on its public
// feed. Publishing opens a game's reads to everyone, signed out too (public is watch and read only, Samuel
// 2026-10-17); every write still needs its capability. Read at most every 30 s; a feed that can't be read publishes
// nothing, so a game stays closed rather than open by mistake.
import { GAMES_FEED, loadPublished } from "../../game/games.js";

const FRESH = 30_000;
const FEED = process.env.AVENDB_GAMES_FEED ?? GAMES_FEED;

type Kept = { at: number; ids: Set<string> };
let kept: Kept | null = null;
let reading: Promise<Set<string>> | null = null;
let get: typeof fetch = (...a) => fetch(...a);

/** The published games' ids, as the feed said within the last 30 s. */
async function publishedIds(): Promise<Set<string>> {
  if (kept && Date.now() - kept.at < FRESH) return kept.ids;
  reading ??= loadPublished({ url: FEED, fetch: get }).then((got: any) => {
    const ids = got instanceof Set ? got : new Set<string>();
    if (got?.error) console.error(`games feed: ${got.error}`);
    kept = { at: Date.now(), ids };
    reading = null;
    return ids;
  });
  return reading;
}

/** Whether game `id` is published. */
export const published = async (id: string) => (await publishedIds()).has(id);

/** For tests: read the feed with `f` from now on, nothing kept. */
export function useGamesFetch(f: typeof fetch) {
  get = f;
  kept = null;
  reading = null;
}

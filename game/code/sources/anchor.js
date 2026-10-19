// @ts-nocheck — plain JS, kept loose on purpose
/**
 * THE TRUST ANCHOR: Maia City's vault id, 64 hex digits. It is the vault whose own signed edits say which code our
 * pages and the API run (H2 of the hardening plan, ./feed.js `provenRows`). It is pinned here, in the repo, and the
 * page and the API both import it. Nobody who holds the server, its .env or a deploy variable can choose it, and
 * changing it is a commit, reviewed as code is.
 *
 * TODO(H2): set it to Maia City's vault id, from the Mac app, before H2 merges. Until then no vault code runs: views,
 * logic and configs run the repo's seed, and the asset pages refuse, saying the anchor is not set.
 */
export const MAIA_CITY = '';

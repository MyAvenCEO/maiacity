// @ts-nocheck — plain JS, kept loose on purpose
/**
 * THE TRUST ANCHOR: Maia City's vault id, 64 hex digits. It is the vault whose own signed edits say which code our
 * pages and the API run (H2 of the hardening plan, ./feed.js `provenRows`). It is pinned here, in the repo, and the
 * page and the API both import it. Nobody who holds the server, its .env or a deploy variable can choose it, and
 * changing it is a commit, reviewed as code is.
 *
 * The id is the one the Mac's agent device (avenMAIA's, synced and checked there) lists for the vault named Maia City
 * (2026-10-19). Left empty, no vault code would run: views, logic and configs would run the repo's seed, and the asset
 * pages would refuse, saying the anchor is not set.
 */
export const MAIA_CITY = 'aee573fef57a2ad10e13989356025a50355df7eb7bc40120e838dd949f876725';

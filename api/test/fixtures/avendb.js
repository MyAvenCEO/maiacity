// @ts-check
// avenDB's server, stood in for where the API asks it whom a device's pass names (POST /feed/pass, src/standing.ts):
// a pass that starts with "admin" is a device of an admin of Maia City's, any other a vault's that is not. Asked for
// passkeys, a vault's owners are those `owners` names for it (founders.js).
import { randomBytes } from "node:crypto";

/** A pass of a device of `who`'s vault, new each time: the API takes a pass once. */
export const pass = (who = "admin") => `${who}9${randomBytes(48).toString("hex")}`;

/** The vault the stand-in names for a pass of `who`'s, as `pass` makes it. @param {string} who */
export const vaultOf = (who) => (who === "admin" ? "ab".repeat(32) : who === "other" ? "cd".repeat(32) : Buffer.from(who.padEnd(32, "-")).toString("hex"));

/**
 * The stand-in, to start before a file's tests and stop after them; AVENDB_FEED points at it meanwhile. A pass names
 * the vault of the word it starts with (`pass`, `vaultOf`): "admin" an admin's, "other" or any other a vault's that
 * isn't.
 * @param {Record<string, string[]>} [owners] the owner passkeys' P-256 keys (hex) by vault
 */
export function avendbStandIn(owners = {}) {
  /** @type {ReturnType<typeof Bun.serve> | null} */
  let feed = null;
  /** @type {string | undefined} */
  let was;
  return {
    start() {
      feed = Bun.serve({
        port: 0,
        async fetch(req) {
          const asked = await req.json();
          const who = /** @type {string} */ (asked.pass).match(/^([a-z]+)9/)?.[1] ?? "";
          const vault = vaultOf(who);
          const said = { vault, admin: who === "admin" };
          return Response.json(asked.passkeys ? { ...said, passkeys: owners[vault] ?? [] } : said);
        },
      });
      was = process.env.AVENDB_FEED;
      process.env.AVENDB_FEED = `http://127.0.0.1:${feed.port}/feed/code`;
    },
    stop() {
      feed?.stop(true);
      if (was === undefined) delete process.env.AVENDB_FEED;
      else process.env.AVENDB_FEED = was;
    },
  };
}

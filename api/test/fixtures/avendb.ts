// avenDB's server, stood in for where the API asks it whom a device's pass names (POST /feed/pass, src/standing.ts):
// a pass that starts with "admin" is a device of an admin of Maia City's, any other a vault's that is not.
import { randomBytes } from "node:crypto";

/** A pass of a device of `who`'s vault, new each time: the API takes a pass once. */
export const pass = (who = "admin") => `${who}${randomBytes(48).toString("base64url")}`;

/** The stand-in, to start before a file's tests and stop after them; AVENDB_FEED points at it meanwhile. */
export function avendbStandIn() {
  let feed: ReturnType<typeof Bun.serve> | null = null;
  let was: string | undefined;
  return {
    start() {
      feed = Bun.serve({
        port: 0,
        async fetch(req) {
          const { pass } = await req.json();
          return Response.json(pass.startsWith("admin") ? { vault: "ab".repeat(32), admin: true } : { vault: "cd".repeat(32), admin: false });
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

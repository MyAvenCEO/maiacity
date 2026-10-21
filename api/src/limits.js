// How often one address may ask the API's costly routes: the passkey ceremonies (/api/passkey/*), and every call that
// brings an avenDB device's pass (an `X-Avendb-Pass` header, or the pass the admins' Postgres window posts), each of
// which the API checks with avenDB's server. A token bucket for each address, filled at `API_RATE` asks a minute (30 by
// default, 0 for no limit), as avenDB's own feed limits its signed routes (avendb-server feed.rs `Rate`). The address is
// the last the proxy in front names in `X-Forwarded-For` (Caddy sets it), else the socket's.

/** The addresses a rate remembers at most: past it, it forgets the one heard from longest ago. */
export const ADDRESSES = 16_384;

/** A token bucket for each address: `perMinute` asks a minute, as many at once; none limits nobody. */
export class Rate {
  /** @param {number} perMinute @param {number} [most] the addresses it remembers */
  constructor(perMinute, most = ADDRESSES) {
    this.perMinute = perMinute;
    this.most = most;
    /** @type {Map<string, { tokens: number, at: number }>} by address, the one heard from last, last */
    this.buckets = new Map();
  }

  /** Whether `address` may ask now, at `now` ms, taking one of its tokens if so. @param {string} address @param {number} [now] */
  allows(address, now = Date.now()) {
    if (!(this.perMinute > 0)) return true;
    const had = this.buckets.get(address);
    const tokens = had ? Math.min(this.perMinute, had.tokens + ((now - had.at) / 60_000) * this.perMinute) : this.perMinute;
    this.buckets.delete(address);
    if (this.buckets.size >= this.most) this.buckets.delete(this.buckets.keys().next().value);
    const may = tokens >= 1;
    this.buckets.set(address, { tokens: may ? tokens - 1 : tokens, at: now });
    return may;
  }
}

/** The asks a minute `API_RATE` says, 30 unless it says otherwise. @param {string | undefined} said */
export function perMinute(said) {
  if (said == null || said.trim() === "") return 30;
  const n = Number(said);
  if (!Number.isFinite(n) || n < 0) throw new Error(`API_RATE is the asks a minute, 0 for no limit: not ${said}`);
  return n;
}

/** Whether `req` asks a costly route: a passkey ceremony, or a call that brings a device's pass. @param {Request} req */
export function costly(req) {
  if (req.method === "OPTIONS") return false;
  const path = new URL(req.url).pathname;
  return path.startsWith("/api/passkey/") || path.startsWith("/api/tables") || req.headers.has("x-avendb-pass");
}

/** Who asks: the last address the proxy names, else the socket's, else nobody known.
 *  @param {Request} req @param {{ requestIP?: (r: Request) => { address: string } | null } | undefined} server */
export function clientOf(req, server) {
  const forwarded = req.headers.get("x-forwarded-for");
  const last = forwarded?.split(",").pop()?.trim();
  if (last) return last;
  return server?.requestIP?.(req)?.address ?? "unknown";
}

/** `handler`, refused 429 for an address over its rate where it asks a costly route. `answer` makes the refusal.
 *  @param {(req: Request, server: any) => any} handler @param {Rate} rate @param {(req: Request) => Response} answer */
export function limited(handler, rate, answer) {
  return (req, server) => (costly(req) && !rate.allows(clientOf(req, server)) ? answer(req) : handler(req, server));
}

/** Every handler of Bun's `routes`, by path and by method, `limited`; a static response as it is.
 *  @template {string} P
 *  @param {import("bun").Serve.Routes<undefined, P>} routes @param {Rate} rate @param {(req: Request) => Response} answer
 *  @returns {import("bun").Serve.Routes<undefined, P>} */
export function limitRoutes(routes, rate, answer) {
  const wrap = (/** @type {any} */ h) => (typeof h === "function" ? limited(h, rate, answer) : h);
  return Object.fromEntries(
    Object.entries(routes).map(([path, route]) => [
      path,
      typeof route === "function" || route instanceof Response
        ? wrap(route)
        : Object.fromEntries(Object.entries(route).map(([method, h]) => [method, wrap(h)])),
    ]),
  );
}

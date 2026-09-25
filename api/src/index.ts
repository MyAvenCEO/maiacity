// The signup service behind api.maia.city. One Bun process, one Postgres, and
// as little surface as the job allows: create a founder, sign one in, let them
// change the name they are known by, and count how many there are.
//
// The journal itself stays a static site on the CDN. Only these routes need a
// server, so only these routes get one.
import { migrate } from "./migrations";
import { sql } from "./db";
import { clearCookie, founderIdFrom, initSessions, sessionCookie, tokenFor } from "./session";
import { loginFinish, loginOptions, registerFinish, registerOptions } from "./passkey";
import { fromBunSql, useDb } from "./pg";
import { migrateLedger } from "./ledger/store";
import { account, claim, LedgerError } from "./ledger/hearts";
import { acceptInvite, buildableCards, cityOf, coopDetail, createInvite, foundCity, foundSettlement, invest, inviteInfo, listCities, plain, settlementOf } from "./ledger/coopstore";
import { ledgerView } from "./ledger/view";
import { capabilities, can, rolesPolicy } from "./acl";
import { format, gameClock, calendar, parse } from "../../game/time";

const PORT = Number(process.env.PORT ?? 3000);
const ORIGINS = (process.env.SITE_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// The browser sends the session cookie only if the API says the origin is
// allowed and credentials are permitted. Both are stated per request, echoing
// back only an origin we actually know.
function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  if (!ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    Vary: "Origin",
  };
}

const json = (req: Request, body: unknown, init: ResponseInit = {}) =>
  Response.json(body, { ...init, headers: { ...cors(req), ...(init.headers ?? {}) } });

async function readJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/**
 * Day 01 counts in Fibonacci steps rather than people: each step is only as
 * big as the two before it added together, and the thirty-first passes a
 * million. This turns a headcount into the step it has reached.
 */
function fibonacciStep(count: number): number {
  let a = 1;
  let b = 1;
  let step = count >= 1 ? 1 : 0;
  while (b <= count) {
    step += 1;
    [a, b] = [b, a + b];
  }
  return step;
}

/** JSON that survives bigints — the ledger counts in 18-decimal integers. */
const big = (req: Request, body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    ...init,
    headers: { "content-type": "application/json", ...cors(req), ...(init.headers ?? {}) },
  });

/** The signed-in founder with their role, or null. */
async function viewer(req: Request): Promise<{ id: string; role: string } | null> {
  const id = founderIdFrom(req);
  if (!id) return null;
  const [row] = await sql`SELECT id, role FROM founders WHERE id = ${id}`;
  return row ?? null;
}

/** Turn a thrown ledger error into a response a person can read. */
function fail(req: Request, e: unknown) {
  if (e instanceof LedgerError) return json(req, { error: e.message }, { status: e.status });
  console.error(e);
  return json(req, { error: "Something went wrong on our side." }, { status: 500 });
}

const preflight = (req: Request) => new Response(null, { status: 204, headers: cors(req) });

const publicFounder = (f: { id: string; number: number | bigint; name: string; created: Date }) => ({
  id: f.id,
  number: Number(f.number),
  name: f.name,
  since: f.created,
});

await migrate();
useDb(fromBunSql(sql));
await migrateLedger();
await initSessions();

const server = Bun.serve({
  port: PORT,
  routes: {
    // Health, for the container and for the deploy job.
    "/api/health": (req) => json(req, { ok: true }),

    // How far the ladder has climbed. Public on purpose — the landing page
    // shows it, and a number nobody can see persuades nobody.
    "/api/founders/count": async (req) => {
      const [row] = await sql`SELECT count(*)::int AS n FROM founders`;
      return json(req, { count: row.n, step: fibonacciStep(row.n) });
    },

    "/api/passkey/register/options": {
      OPTIONS: (req) => new Response(null, { status: 204, headers: cors(req) }),
      POST: async (req) => {
        const body = await readJson(req);
        const result = await registerOptions(String(body?.name ?? ""));
        if (!result.ok) return json(req, { error: result.error }, { status: 400 });
        return json(req, result.value);
      },
    },
    "/api/passkey/register/finish": {
      OPTIONS: (req) => new Response(null, { status: 204, headers: cors(req) }),
      POST: async (req) => {
        const result = await registerFinish((await readJson(req)) ?? {});
        if (!result.ok) return json(req, { error: result.error }, { status: 400 });
        return json(req, publicFounder(result.value), {
          headers: { "Set-Cookie": sessionCookie(tokenFor(result.value.id)) },
        });
      },
    },

    "/api/passkey/login/options": {
      OPTIONS: (req) => new Response(null, { status: 204, headers: cors(req) }),
      POST: async (req) => json(req, await loginOptions()),
    },
    "/api/passkey/login/finish": {
      OPTIONS: (req) => new Response(null, { status: 204, headers: cors(req) }),
      POST: async (req) => {
        const result = await loginFinish((await readJson(req)) ?? {});
        if (!result.ok) return json(req, { error: result.error }, { status: 401 });
        return json(req, publicFounder(result.value), {
          headers: { "Set-Cookie": sessionCookie(tokenFor(result.value.id)) },
        });
      },
    },

    "/api/me": {
      OPTIONS: (req) => new Response(null, { status: 204, headers: cors(req) }),
      GET: async (req) => {
        const id = founderIdFrom(req);
        if (!id) return json(req, { error: "not signed in" }, { status: 401 });
        const [founder] = await sql`SELECT id, number, name, created FROM founders WHERE id = ${id}`;
        if (!founder) return json(req, { error: "not signed in" }, { status: 401 });
        return json(req, publicFounder(founder));
      },
      // The only thing a founder can change: the name they are known by.
      PATCH: async (req) => {
        const id = founderIdFrom(req);
        if (!id) return json(req, { error: "not signed in" }, { status: 401 });
        const name = String((await readJson(req))?.name ?? "").trim().slice(0, 60);
        if (name.length < 2) return json(req, { error: "Please give a name with at least two characters." }, { status: 400 });
        const [founder] = await sql`
          UPDATE founders SET name = ${name} WHERE id = ${id}
          RETURNING id, number, name, created`;
        return json(req, publicFounder(founder));
      },
    },

    // ─────────────────────────────── avenCITY Sandbox 2 ───────────────────────────
    // Looking is free: the planet, every city, every coop and its cap table need no account.
    "/api/city": async (req) => {
      const now = new Date();
      const [cities, [row]] = await Promise.all([listCities(now), sql`SELECT count(*)::int AS n FROM founders`]);
      const c = calendar(now);
      return big(req, {
        cities: cities.map(plain),
        players: row.n,
        buildable: buildableCards(),
        clock: gameClock(now).label,
        calendarLabel: `Y${c.year} · M${c.month}`,
      });
    },
    "/api/coops/:slug": {
      OPTIONS: preflight,
      GET: async (req) => {
        try {
          return big(req, plain(await coopDetail(req.params.slug, founderIdFrom(req))));
        } catch (e) {
          return fail(req, e);
        }
      },
    },

    // Acting needs an account: minting and investing are signed.
    "/api/account": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await viewer(req);
        if (!me) return json(req, { error: "not signed in" }, { status: 401 });
        const [a, city, home] = await Promise.all([account(me.id), cityOf(me.id), settlementOf(me.id)]);
        const place = (p: { slug: string; name: string } | null) => (p ? { slug: p.slug, name: p.name } : null);
        return big(req, { ...a, city: place(city), settlement: place(home), caps: [...capabilities(me.role)] });
      },
    },
    "/api/hearts/claim": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await viewer(req);
        if (!can(me, "hearts:mint")) return json(req, { error: "Sign up to mint your hearts." }, { status: 401 });
        try {
          const { claimed } = await claim(me!.id);
          return big(req, { claimed, claimedLabel: format(claimed) });
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    // A card of land is unlocked by founding a city on it; the founder is its first citizen.
    "/api/cities": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await viewer(req);
        if (!can(me, "city:create")) return json(req, { error: "Sign up to found a city." }, { status: 401 });
        try {
          const body = await readJson(req);
          const hearts = parse(String(body?.hearts ?? ""));
          return big(req, plain(await foundCity(me!.id, { name: body?.name, pitch: body?.pitch, tile: body?.tile, hearts })));
        } catch (e) {
          if (e instanceof Error && !(e instanceof LedgerError)) return json(req, { error: e.message }, { status: 400 });
          return fail(req, e);
        }
      },
    },
    // The second step into a city: a home on a cell of its island.
    "/api/settlements": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await viewer(req);
        if (!can(me, "coop:create")) return json(req, { error: "Sign up to found a settlement." }, { status: 401 });
        try {
          const body = await readJson(req);
          const hearts = parse(String(body?.hearts ?? ""));
          return big(req, plain(await foundSettlement(me!.id, { name: body?.name, pitch: body?.pitch, cell: body?.cell, hearts })));
        } catch (e) {
          if (e instanceof Error && !(e instanceof LedgerError)) return json(req, { error: e.message }, { status: 400 });
          return fail(req, e);
        }
      },
    },
    // A settler makes an invite link — one person, one week.
    "/api/settlements/:slug/invites": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await viewer(req);
        if (!me) return json(req, { error: "Sign up to invite people." }, { status: 401 });
        try {
          return json(req, await createInvite(me.id, req.params.slug));
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    // Anyone holding the link may see where it leads.
    "/api/invites/:token": {
      OPTIONS: preflight,
      GET: async (req) => {
        try {
          return json(req, await inviteInfo(req.params.token));
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    "/api/invites/:token/accept": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await viewer(req);
        if (!can(me, "coop:invest")) return json(req, { error: "Sign up to accept the invite." }, { status: 401 });
        try {
          const hearts = parse(String((await readJson(req))?.hearts ?? ""));
          return big(req, plain(await acceptInvite(me!.id, req.params.token, hearts)));
        } catch (e) {
          if (e instanceof Error && !(e instanceof LedgerError)) return json(req, { error: e.message }, { status: 400 });
          return fail(req, e);
        }
      },
    },
    "/api/coops/:slug/invest": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await viewer(req);
        if (!can(me, "coop:invest")) return json(req, { error: "Sign up to invest." }, { status: 401 });
        try {
          const body = await readJson(req);
          const hearts = parse(String(body?.hearts ?? ""));
          return big(req, plain(await invest(me!.id, req.params.slug, hearts)));
        } catch (e) {
          if (e instanceof Error && !(e instanceof LedgerError)) return json(req, { error: e.message }, { status: 400 });
          return fail(req, e);
        }
      },
    },
    "/api/ledger": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await viewer(req);
        if (!can(me, "ledger:read")) return json(req, { error: "not signed in" }, { status: 401 });
        return big(req, await ledgerView(me!.id));
      },
    },
    "/api/citizens": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await viewer(req);
        if (!can(me, "citizen:promote")) return json(req, { error: "Only the admin sees roles." }, { status: 403 });
        const rows = await sql`SELECT id, number, name, role, created FROM founders ORDER BY number`;
        return json(req, rows.map((r: any) => ({ ...r, number: Number(r.number) })));
      },
    },
    "/api/citizens/:id/role": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await viewer(req);
        const role = String((await readJson(req))?.role ?? "");
        if (!rolesPolicy.assignable.includes(role)) return json(req, { error: "Not an assignable role." }, { status: 400 });
        const cap = role === "founder" ? "citizen:promote" : "citizen:demote";
        if (!can(me, cap)) return json(req, { error: "Only the admin assigns roles." }, { status: 403 });
        const [row] = await sql`UPDATE founders SET role = ${role} WHERE id = ${req.params.id} AND role <> 'admin' RETURNING id, role`;
        if (!row) return json(req, { error: "No such citizen, or they are the admin." }, { status: 404 });
        return json(req, row);
      },
    },

    "/api/session": {
      OPTIONS: (req) => new Response(null, { status: 204, headers: cors(req) }),
      DELETE: (req) => new Response(null, { status: 204, headers: { ...cors(req), "Set-Cookie": clearCookie() } }),
    },
  },
  fetch: (req) => new Response("Not found", { status: 404, headers: cors(req) }),
});

console.log(`maiaCITY api on :${server.port} — origins ${ORIGINS.join(", ")}`);

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
import { assignRole, can, capabilities, createRole, deleteRole, initRoles, listRoles, RoleError, setRoleCaps } from "./acl";
import { CAPABILITIES } from "./caps";
import { addIdea, deleteIdea, IdeaError, listIdeas, updateIdea } from "./ideas";
import { finishUpload, have, listMedia, MediaError, mediaInfo, namePath, publicManifest, putPart, readMedia, retag, startUpload } from "./media";
import { approveDevice, deviceInfo, KeyError, keyHolder, redeemDevice, revokeKey, startDevice } from "./keys";
import { canDistribute, distributePending } from "./bunny";
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
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
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

/**
 * The signed-in founder, if they hold the capability — or the response that says why not.
 * Every admin route starts here, so none of them ever asks for a role by name.
 */
async function allowed(req: Request, cap: string): Promise<{ id: string; role: string } | Response> {
  // a terminal signs in with a key the admin approved: it may do what the key was given, and the person still holds
  const key = await keyHolder(req);
  if (key) {
    if (key.scope.includes(cap) && can(key, cap)) return key;
    return json(req, { error: `This key cannot ${(CAPABILITIES[cap] ?? cap).toLowerCase()}.` }, { status: 403 });
  }
  const me = await viewer(req);
  if (!me) return json(req, { error: "Please sign in." }, { status: 401 });
  if (!can(me, cap)) return json(req, { error: `This needs the right to ${(CAPABILITIES[cap] ?? cap).toLowerCase()}.` }, { status: 403 });
  return me;
}

/** Turn a thrown ledger, role or notebook error into a response a person can read. */
function fail(req: Request, e: unknown) {
  if (e instanceof LedgerError || e instanceof RoleError || e instanceof IdeaError || e instanceof KeyError || e instanceof MediaError) return json(req, { error: e.message }, { status: e.status });
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
await initRoles();

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
        const [founder] = await sql`SELECT id, number, name, created, role FROM founders WHERE id = ${id}`;
        if (!founder) return json(req, { error: "not signed in" }, { status: 401 });
        // what they may do comes with who they are, so the site can show them only what they can use
        return json(req, { ...publicFounder(founder), role: founder.role, caps: [...capabilities(founder.role)] });
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
    // ─────────────────────────────── the admin ───────────────────────────
    // Who has which role, and what each role holds. Every route asks for a capability, never a role.
    "/api/citizens": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await allowed(req, "roles:admin");
        if (me instanceof Response) return me;
        const rows = await sql`SELECT id, number, name, role, created FROM founders ORDER BY number`;
        return json(req, rows.map((r: any) => ({ ...r, number: Number(r.number) })));
      },
    },
    "/api/citizens/:id/role": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await allowed(req, "roles:admin");
        if (me instanceof Response) return me;
        try {
          return json(req, await assignRole(req.params.id, (await readJson(req))?.role));
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    "/api/roles": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await allowed(req, "roles:admin");
        if (me instanceof Response) return me;
        return json(req, { roles: await listRoles(), catalogue: CAPABILITIES });
      },
      POST: async (req) => {
        const me = await allowed(req, "roles:admin");
        if (me instanceof Response) return me;
        try {
          const body = await readJson(req);
          await createRole(body?.name, body?.capabilities ?? []);
          return json(req, { roles: await listRoles() }, { status: 201 });
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    "/api/roles/:name": {
      OPTIONS: preflight,
      PATCH: async (req) => {
        const me = await allowed(req, "roles:admin");
        if (me instanceof Response) return me;
        try {
          await setRoleCaps(req.params.name, (await readJson(req))?.capabilities);
          return json(req, { roles: await listRoles() });
        } catch (e) {
          return fail(req, e);
        }
      },
      DELETE: async (req) => {
        const me = await allowed(req, "roles:admin");
        if (me instanceof Response) return me;
        try {
          await deleteRole(req.params.name);
          return json(req, { roles: await listRoles() });
        } catch (e) {
          return fail(req, e);
        }
      },
    },

    // The admin's notebook: ideas and notes, written down the moment they come.
    "/api/ideas": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await allowed(req, "ideas:admin");
        if (me instanceof Response) return me;
        return json(req, await listIdeas());
      },
      POST: async (req) => {
        const me = await allowed(req, "ideas:admin");
        if (me instanceof Response) return me;
        try {
          return json(req, await addIdea(me.id, (await readJson(req))?.body), { status: 201 });
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    "/api/ideas/:id": {
      OPTIONS: preflight,
      PATCH: async (req) => {
        const me = await allowed(req, "ideas:admin");
        if (me instanceof Response) return me;
        try {
          return json(req, await updateIdea(req.params.id, (await readJson(req)) ?? {}));
        } catch (e) {
          return fail(req, e);
        }
      },
      DELETE: async (req) => {
        const me = await allowed(req, "ideas:admin");
        if (me instanceof Response) return me;
        try {
          await deleteIdea(req.params.id);
          return new Response(null, { status: 204, headers: cors(req) });
        } catch (e) {
          return fail(req, e);
        }
      },
    },

    // The media library: every file in Postgres, known by its CID. The public copies are on Bunny;
    // these are the originals, for the admin's eyes.
    "/api/media": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        const url = new URL(req.url);
        const media = await listMedia({ kind: url.searchParams.get("kind") ?? undefined, q: url.searchParams.get("q") ?? undefined });
        return json(req, { media, total: media.reduce((n, m) => n + m.size, 0) });
      },
    },
    // ── the media library, from a terminal: sign in with the admin's passkey, then upload by CID ──
    "/api/device/start": {
      OPTIONS: preflight,
      POST: async (req) => {
        try {
          const body = await readJson(req);
          return json(req, await startDevice(body?.scope, body?.label));
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    "/api/device/token": {
      OPTIONS: preflight,
      POST: async (req) => {
        try {
          const r = await redeemDevice((await readJson(req))?.device_code);
          return "pending" in r ? json(req, r, { status: 428 }) : json(req, r);
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    "/api/device/key": {
      OPTIONS: preflight,
      DELETE: async (req) => (await revokeKey(req)) ? new Response(null, { status: 204, headers: cors(req) }) : json(req, { error: "No such key." }, { status: 404 }),
    },
    "/api/device/:code": {
      OPTIONS: preflight,
      GET: async (req) => {
        if (!(await viewer(req))) return json(req, { error: "Please sign in." }, { status: 401 });
        try {
          return json(req, await deviceInfo(req.params.code));
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    "/api/device/:code/approve": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await viewer(req);
        if (!me) return json(req, { error: "Please sign in." }, { status: 401 });
        try {
          await approveDevice(req.params.code, me);
          return json(req, { ok: true });
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    // Public: the site's build reads it to load each image from its CID on the CDN.
    "/api/media/manifest": async (req) => json(req, await publicManifest(), { headers: { "Cache-Control": "no-store" } }),
    "/api/media/have": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        const cids = (await readJson(req))?.cids;
        return json(req, { have: await have(Array.isArray(cids) ? cids.map(String) : []) });
      },
    },
    "/api/media/paths": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          const body = await readJson(req);
          await namePath(body?.path, body?.cid);
          return json(req, { ok: true });
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    "/api/media/tags": {
      OPTIONS: preflight,
      PUT: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        const body = (await readJson(req))?.tags;
        if (!body || typeof body !== "object") return json(req, { error: "Send { tags: { cid: [tag, …] } }." }, { status: 400 });
        const known = new Set(await have(Object.keys(body)));
        await retag(new Map(Object.entries(body).filter(([cid]) => known.has(cid)).map(([cid, t]) => [cid, new Set((t as unknown[]).map(String))])));
        return json(req, { tagged: known.size });
      },
    },
    "/api/media/uploads": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          return json(req, await startUpload(me.id, (await readJson(req)) ?? {}));
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    "/api/media/uploads/:id/finish": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          const r = await finishUpload(me.id, req.params.id);
          void distributePending(); // the public copy follows on its own
          return json(req, r);
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    "/api/media/uploads/:id/:idx": {
      OPTIONS: preflight,
      PUT: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          await putPart(me.id, req.params.id, Number(req.params.idx), new Uint8Array(await req.arrayBuffer()));
          return new Response(null, { status: 204, headers: cors(req) });
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    // Make every missing public copy now, and say how it went (the terminal waits for it).
    "/api/media/distribute": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        if (!canDistribute()) return json(req, { error: "This server has no BUNNY_API_KEY." }, { status: 503 });
        return json(req, await distributePending());
      },
    },

    "/api/media/:cid": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        const info = await mediaInfo(req.params.cid);
        if (!info) return json(req, { error: "No such file." }, { status: 404 });
        // a CID never changes its bytes: cache it for good, and answer byte ranges so a video can seek
        const head = { ...cors(req), "Content-Type": info.mime, "Accept-Ranges": "bytes", ETag: `"${req.params.cid}"`, "Cache-Control": "private, max-age=31536000, immutable" };
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
        if (range && info.size > 0) {
          const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
          const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
          if (start > end || start >= info.size) return new Response(null, { status: 416, headers: { ...head, "Content-Range": `bytes */${info.size}` } });
          return new Response(readMedia(req.params.cid, start, end), {
            status: 206,
            headers: { ...head, "Content-Range": `bytes ${start}-${end}/${info.size}`, "Content-Length": String(end - start + 1) },
          });
        }
        return new Response(readMedia(req.params.cid, 0, Math.max(0, info.size - 1)), { headers: { ...head, "Content-Length": String(info.size) } });
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

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
import { acceptInvite, buildableCards, cityOf, coopDetail, createInvite, foundCity, foundSettlement, invest, inviteInfo, listCities, place, plain, settlementOf } from "./ledger/coopstore";
import { ledgerView } from "./ledger/view";
import { assignRole, can, capabilities, createRole, deleteRole, initRoles, listRoles, RoleError, setRoleCaps } from "./acl";
import { CAPABILITIES } from "./caps";
import { addIdea, deleteIdea, IdeaError, listIdeas, updateIdea } from "./ideas";
import { approveDevice, deviceInfo, KeyError, keyHolder, redeemDevice, revokeKey, startDevice } from "./keys";
import { joinInfo, listDevices, listVaultFiles, pairDevice, revokeDevice, VaultError } from "./vault";
import { statusRoute as transcriptsStatus, transcribeRoute } from "./stt";
import { createTimeline, deleteTimeline, getTimeline, listTimelines, saveTimeline, TimelineError } from "./timelines";
import { createShot, getShot, listShots, saveShot, ShotError, shotVersions } from "./shots";
import { claimRender, listJobs, queueFrame, queueRender, RenderError, rendersOf, reportRender } from "./renders";
import { CHANNELS, ContentError, createContent, deleteContent, FORMATS, KINDS, listContent, saveContent, saveDay, savePosts, STATUSES, dropDeliveries } from "./content";
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
  if (e instanceof LedgerError || e instanceof RoleError || e instanceof IdeaError || e instanceof KeyError || e instanceof TimelineError || e instanceof ShotError || e instanceof ContentError || e instanceof RenderError || e instanceof VaultError) return json(req, { error: e.message }, { status: e.status });
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
  // slow requests are let finish: Bun's default idle timeout is 10 s
  idleTimeout: 255,
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
        // maiaCITY Studio (the Mac app) signs in with a key the admin approved: it speaks for them, but may only
        // what the key was given — so its capabilities are the key's scope, never more than the role holds now
        const key = await keyHolder(req);
        const id = key?.id ?? founderIdFrom(req);
        if (!id) return json(req, { error: "not signed in" }, { status: 401 });
        const [founder] = await sql`SELECT id, number, name, created, role FROM founders WHERE id = ${id}`;
        if (!founder) return json(req, { error: "not signed in" }, { status: 401 });
        // what they may do comes with who they are, so the site can show them only what they can use
        const caps = [...capabilities(founder.role)].filter((c) => !key || key.scope.includes(c));
        return json(req, { ...publicFounder(founder), role: founder.role, caps });
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
        const brief = (p: { slug: string; name: string; founded: boolean } | null) => (p ? { slug: p.slug, name: p.name, founded: p.founded } : null);
        return big(req, { ...a, city: brief(city), settlement: brief(home), caps: [...capabilities(me.role)] });
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
    // Founding a city needs no map; the founder is its first citizen. Where it stands is chosen per world, later.
    "/api/cities": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await viewer(req);
        if (!can(me, "city:create")) return json(req, { error: "Sign up to found a city." }, { status: 401 });
        try {
          const body = await readJson(req);
          const hearts = parse(String(body?.hearts ?? ""));
          return big(req, plain(await foundCity(me!.id, { name: body?.name, pitch: body?.pitch, hearts })));
        } catch (e) {
          if (e instanceof Error && !(e instanceof LedgerError)) return json(req, { error: e.message }, { status: 400 });
          return fail(req, e);
        }
      },
    },
    // The second step into a city: a home, founded in your city — no map needed either.
    "/api/settlements": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await viewer(req);
        if (!can(me, "coop:create")) return json(req, { error: "Sign up to found a settlement." }, { status: 401 });
        try {
          const body = await readJson(req);
          const hearts = parse(String(body?.hearts ?? ""));
          return big(req, plain(await foundSettlement(me!.id, { name: body?.name, pitch: body?.pitch, hearts })));
        } catch (e) {
          if (e instanceof Error && !(e instanceof LedgerError)) return json(req, { error: e.message }, { status: 400 });
          return fail(req, e);
        }
      },
    },
    // Its founder gives a city or a settlement a place in one world: { world: 'sandbox-2', spot: '812' | 'q,r' }.
    "/api/coops/:slug/place": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await viewer(req);
        if (!me) return json(req, { error: "Sign in to place what you founded." }, { status: 401 });
        try {
          const body = await readJson(req);
          return big(req, plain(await place(me.id, req.params.slug, { world: body?.world, spot: body?.spot })));
        } catch (e) {
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

    // ── the media vault (vault/): pairing a Mac's iroh node, joining the catalog, and the catalog's mirror ──
    "/api/vault/devices": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        return json(req, await listDevices());
      },
      POST: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          const body = await readJson(req);
          return json(req, await pairDevice(me.id, body?.endpoint_id, body?.label));
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    "/api/vault/devices/:id": {
      OPTIONS: preflight,
      DELETE: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        return (await revokeDevice(req.params.id))
          ? new Response(null, { status: 204, headers: cors(req) })
          : json(req, { error: "No such device." }, { status: 404 });
      },
    },
    "/api/vault/join": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        return json(req, await joinInfo());
      },
    },
    "/api/vault/files": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        const url = new URL(req.url);
        return json(req, await listVaultFiles({ kind: url.searchParams.get("kind") ?? undefined, tag: url.searchParams.get("tag") ?? undefined }));
      },
    },

    // speech to text (stt.ts): the vault server sends a recording's speech track, the words come back with their times
    "/api/transcripts": {
      GET: transcriptsStatus,
      POST: (req, server) => {
        // Prem may take minutes for an hour of speech; nothing moves on the socket meanwhile
        server.timeout(req, 0);
        return transcribeRoute(req);
      },
    },

    // ── a terminal signs in with the admin's passkey: it asks for a key, the admin approves it in the browser ──
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
    // The studio's timelines: edits over the vault's files, by hash.
    "/api/timelines": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        return json(req, await listTimelines());
      },
      POST: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          return json(req, await createTimeline(me.id, (await readJson(req)) ?? {}), { status: 201 });
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    "/api/timelines/:id": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          return json(req, await getTimeline(req.params.id));
        } catch (e) {
          return fail(req, e);
        }
      },
      PUT: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          return json(req, await saveTimeline(req.params.id, (await readJson(req)) ?? {}));
        } catch (e) {
          return fail(req, e);
        }
      },
      DELETE: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          await deleteTimeline(req.params.id);
          return new Response(null, { status: 204, headers: cors(req) });
        } catch (e) {
          return fail(req, e);
        }
      },
    },

    // World shots: shots of Sandbox 4 kept as data (game/film/shot.js), versioned — a world clip names one.
    "/api/shots": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        return json(req, await listShots({ project: new URL(req.url).searchParams.get("project") }));
      },
      POST: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          // a shot version a timeline plays gets its HD proxy from the Mac app (vault/app/src/world.rs), not a job here
          return json(req, await createShot(me.id, (await readJson(req)) ?? {}), { status: 201 });
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    "/api/shots/:id": {
      OPTIONS: preflight,
      // ?version=n: the shot as it was at that version
      GET: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          const v = new URL(req.url).searchParams.get("version");
          return json(req, await getShot(req.params.id, v === null ? undefined : Number(v)));
        } catch (e) {
          return fail(req, e);
        }
      },
      PUT: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          return json(req, await saveShot(req.params.id, me.id, (await readJson(req)) ?? {}));
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    "/api/shots/:id/versions": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          return json(req, await shotVersions(req.params.id));
        } catch (e) {
          return fail(req, e);
        }
      },
    },

    // Exporting a timeline: the studio queues a render; a worker claims it, reports, and hands back the film.
    "/api/timelines/:id/renders": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        return json(req, await rendersOf(req.params.id));
      },
      POST: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          return json(req, await queueRender(me.id, req.params.id), { status: 201 });
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    "/api/renders/claim": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        const job = await claimRender();
        return job ? json(req, job) : new Response(null, { status: 204, headers: cors(req) });
      },
    },
    "/api/renders/:id": {
      OPTIONS: preflight,
      PUT: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          return json(req, await reportRender(req.params.id, (await readJson(req)) ?? {}));
        } catch (e) {
          return fail(req, e);
        }
      },
    },

    // The worker's other jobs: hero frames. Proxies — a file's and a world shot's — and the viewer's LUTs are the Mac
    // app's work, not jobs here.
    // GET /api/film/jobs?kind=&timeline=&shot= → the latest jobs (the render queue).
    "/api/film/jobs": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        const url = new URL(req.url);
        const q = (k: string) => url.searchParams.get(k) ?? undefined;
        return json(req, await listJobs({ kind: q("kind"), timeline: q("timeline"), shot: q("shot"), limit: Number(q("limit")) || undefined }));
      },
    },
    // A hero frame: one frame of the timeline at { t, shape }, rendered by the worker at full precision (Grade tab)
    "/api/timelines/:id/frames": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          return json(req, await queueFrame(me.id, req.params.id, ((await readJson(req)) ?? {}) as { t?: unknown; shape?: unknown }), { status: 201 });
        } catch (e) {
          return fail(req, e);
        }
      },
    },

    // A film's posts, written where the film is made (the same key as the render worker)
    "/api/timelines/:id/posts": {
      OPTIONS: preflight,
      PUT: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          const body = ((await readJson(req)) ?? {}) as { title?: string; posts?: unknown };
          return json(req, await savePosts(me.id, req.params.id, body.posts as never, body.title));
        } catch (e) {
          return fail(req, e);
        }
      },
    },

    // The days on the board, for the pipeline (publish step): where each stands and when it goes out
    "/api/content/days": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        const items = (await listContent()).filter((i) => i.project);
        return json(req, { items: items.map(({ project, title, status, scheduled_at, source }) => ({ project, title, status, scheduled_at, source })) });
      },
    },

    // A day, derived from its base article: written where the article is (the same key as the film pipeline)
    "/api/content/days/:project": {
      OPTIONS: preflight,
      PUT: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          return json(req, await saveDay(me.id, decodeURIComponent(req.params.project), ((await readJson(req)) ?? {}) as never));
        } catch (e) {
          return fail(req, e);
        }
      },
    },

    // The publishing calendar.
    "/api/content": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await allowed(req, "content:admin");
        if (me instanceof Response) return me;
        const u = new URL(req.url);
        return json(req, { items: await listContent(u.searchParams.get("from") ?? undefined, u.searchParams.get("to") ?? undefined), kinds: KINDS, channels: CHANNELS, formats: FORMATS, statuses: STATUSES });
      },
      POST: async (req) => {
        const me = await allowed(req, "content:admin");
        if (me instanceof Response) return me;
        try {
          return json(req, await createContent(me.id, (await readJson(req)) ?? {}), { status: 201 });
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    // DELETE /api/content/:id/deliveries/:timeline → a render's films off the card (the rest stays)
    "/api/content/:id/deliveries/:timeline": {
      OPTIONS: preflight,
      DELETE: async (req) => {
        const me = await allowed(req, "content:admin");
        if (me instanceof Response) return me;
        try {
          return json(req, await dropDeliveries(req.params.id, req.params.timeline));
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    "/api/content/:id": {
      OPTIONS: preflight,
      PUT: async (req) => {
        const me = await allowed(req, "content:admin");
        if (me instanceof Response) return me;
        try {
          return json(req, await saveContent(req.params.id, (await readJson(req)) ?? {}));
        } catch (e) {
          return fail(req, e);
        }
      },
      DELETE: async (req) => {
        const me = await allowed(req, "content:admin");
        if (me instanceof Response) return me;
        try {
          await deleteContent(req.params.id);
          return new Response(null, { status: 204, headers: cors(req) });
        } catch (e) {
          return fail(req, e);
        }
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

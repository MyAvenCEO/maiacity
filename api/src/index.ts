// The signup service behind api.maia.city. One Bun process, one Postgres, and
// as little surface as the job allows: create a founder, sign one in, let them
// change the name they are known by, and count how many there are.
//
// The journal itself stays a static site on the CDN. Only these routes need a
// server, so only these routes get one.
import { migrate } from "./migrations";
import { sql } from "./db";
import { clearCookie, founderIdFrom, initSessions, sessionCookie, tokenFor } from "./session";
import { inviteOpen, loginFinish, loginOptions, makeInvite, registerFinish, registerOptions } from "./passkey";
import { fromBunSql, useDb } from "./pg";
import { assignRole, can, capabilities, createRole, deleteRole, initRoles, listRoles, RoleError, setRoleCaps } from "./acl";
import { CAPABILITIES } from "./caps";
import { addIdea, deleteIdea, IdeaError, listIdeas, updateIdea } from "./ideas";
import { approveDevice, deviceInfo, KeyError, keyHolder, redeemDevice, revokeKey, startDevice } from "./keys";
import { joinInfo, listDevices, listVaultFiles, pairDevice, revokeDevice, VaultError } from "./vault";
import { analyseRoute, MODEL as ANALYSIS_MODEL, statusRoute as analysisStatus } from "./analysis";
import { checkModels, pick } from "./prem";
import { listTimelines } from "./timelines";
import { BEATS, CHANNELS, ContentError, createContent, deleteContent, FORMATS, KINDS, listContent, saveContent, saveDay, savePosts, STATUSES, dropDeliveries, fileStory, unfiledStories } from "./content";
import { GameError, getGame, move, takeSeat } from "./maiacity-v1.js";
import { loadCode } from "../../game/code/index.js";
import { feedOf } from "../../game/code/sources/avendb.js";

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

/** The signed-in founder (or a terminal's key holder), whatever they hold — or the response that says why not. */
async function signedIn(req: Request): Promise<{ id: string; role: string } | Response> {
  const key = await keyHolder(req);
  if (key) return key;
  const me = await viewer(req);
  return me ?? json(req, { error: "Please sign in." }, { status: 401 });
}

/** Turn a thrown ledger, role or notebook error into a response a person can read. */
function fail(req: Request, e: unknown) {
  if (e instanceof RoleError || e instanceof IdeaError || e instanceof KeyError || e instanceof ContentError || e instanceof VaultError || e instanceof GameError) return json(req, { error: e.message }, { status: e.status });
  console.error(e);
  return json(req, { error: "Something went wrong on our side." }, { status: 500 });
}

const preflight = (req: Request) => new Response(null, { status: 204, headers: cors(req) });

// who signed up, as the API knows them: no profile, which lives in their avenDB human vault (Samuel 2026-10-18)
const publicFounder = (f: { id: string; number: number | bigint; created: Date }) => ({
  id: f.id,
  number: Number(f.number),
  since: f.created,
});

await migrate();
useDb(fromBunSql(sql));
// the views and logic modules from the Maia City vault (C10): read once before serving, then every minute, so a change
// accepted in the vault runs here without a deploy. Read from avenDB's own feed inside the compose network
// (AVENDB_FEED): avendb.maia.city takes only post-quantum key exchange. A failed read keeps what was loaded, else the seed.
const CODE_FEED = feedOf(process.env.AVENDB_FEED || undefined);
const loadVaultCode = () =>
  loadCode({ url: CODE_FEED }).then(
    (r: { error?: string }) => r.error && console.error("code from the Maia City vault:", r.error),
    (e: unknown) => console.error("code from the Maia City vault:", e),
  );
await loadVaultCode();
setInterval(loadVaultCode, 60_000);
await initSessions();
await initRoles();
// Prem: the models this key lists, said once in the log (ids only), and each model we use checked — one not listed or
// without an attested deployment pauses for 30 minutes (prem.ts). In the background, never in the way.
// (Speech to text is no longer Prem's: every recording's words are made on-device, on the Mac — vault/app transcripts.rs.)
// (the model checked is the one really used: ours, or the key's own of the Qwen family when it lists ours by another id)
if (process.env.PREMAI_API_KEY) void pick(ANALYSIS_MODEL, "CHAT", /^qwen/i).then((m) => checkModels([m]));

const server = Bun.serve({
  port: PORT,
  // slow requests are let finish: Bun's default idle timeout is 10 s
  idleTimeout: 255,
  routes: {
    // Health, for the container and for the deploy job.
    "/api/health": (req) => json(req, { ok: true }),

    // MaiaCity V1 (api/src/maiacity-v1.js): one shared game for two players. Any signed-in founder reads it; the first
    // two to sign in take seat A and seat B, and only the founder in a seat moves for it.
    "/api/maiacity-v1": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await signedIn(req);
        if (me instanceof Response) return me;
        try {
          // an app key (the Mac's MCP) only reads: a seat goes to a person signing in on the page, named as their
          // avenDB profile names them (the page says so: no name of theirs is kept here)
          const name = new URL(req.url).searchParams.get("name") ?? "";
          return json(req, { game: await getGame("scope" in me ? null : { id: me.id, name }), me: me.id, admin: can(me, "economy:admin"), now: Date.now() });
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    "/api/maiacity-v1/seat": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await signedIn(req);
        if (me instanceof Response) return me;
        const body = await readJson(req);
        try {
          const name = String(body?.name ?? "");
          return json(req, { game: await takeSeat({ id: me.id, name }, String(body?.seat ?? "")), now: Date.now() });
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    "/api/maiacity-v1/move": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await signedIn(req);
        if (me instanceof Response) return me;
        const body = await readJson(req);
        // an app key (the Mac's MCP, an agent) proposes, but never signs or rejects: that is the players' own, on the page
        if ("scope" in me && ["sign", "reject"].includes(body?.action?.type)) return json(req, { error: "A MIP is signed or rejected by a player, on the page." }, { status: 403 });
        try {
          return json(req, { game: await move(me, can(me, "economy:admin"), String(body?.seat ?? ""), body?.action), now: Date.now() });
        } catch (e) {
          return fail(req, e);
        }
      },
    },

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
        const result = await registerOptions(String(body?.name ?? ""), String(body?.invite ?? ""));
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
        const [founder] = await sql`SELECT id, number, created, role FROM founders WHERE id = ${id}`;
        if (!founder) return json(req, { error: "not signed in" }, { status: 401 });
        // what they may do comes with who they are, so the site can show them only what they can use
        const caps = [...capabilities(founder.role)].filter((c) => !key || key.scope.includes(c));
        return json(req, { ...publicFounder(founder), role: founder.role, caps });
      },
    },

    // Invite only: once the city has its admin, signing up takes an invite one of its super admins made, used once
    "/api/invites": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await allowed(req, "humans:invite");
        if (me instanceof Response) return me;
        return json(req, await makeInvite(me.id));
      },
    },
    "/api/invites/:code": {
      OPTIONS: preflight,
      GET: async (req) => json(req, { open: await inviteOpen(req.params.code) }),
    },

    // ─────────────────────────────── the admin ───────────────────────────
    // Who has which role, and what each role holds. Every route asks for a capability, never a role.
    "/api/citizens": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await allowed(req, "roles:admin");
        if (me instanceof Response) return me;
        const rows = await sql`SELECT id, number, role, created FROM founders ORDER BY number`;
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

    // the shot analysis (analysis.ts): the vault server sends a proxy's frames (display-referred) and the words said,
    // Prem's confidential Qwen answers tags, cues and a summary in the vocabulary (game/film/vocabulary.json)
    "/api/analysis": {
      GET: analysisStatus,
      POST: (req, server) => {
        // a dozen frames through a vision model may take a minute or two
        server.timeout(req, 0);
        return analyseRoute(req);
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
    // The OS approves its own key's code with a passkey sign-in its sheet brought back (src/routes/app/avendb/sheet/):
    // the sheet hands the passkey's answer only to the app that opened it, so no one compares a code
    "/api/device/:code/passkey": {
      OPTIONS: preflight,
      POST: async (req) => {
        const signed = await loginFinish((await readJson(req)) ?? {});
        if (!signed.ok) return json(req, { error: signed.error }, { status: 401 });
        const [me] = await sql`SELECT id, role FROM founders WHERE id = ${signed.value.id}`;
        if (!me) return json(req, { error: "That passkey has no account behind it." }, { status: 401 });
        try {
          await approveDevice(req.params.code, me);
          return json(req, { ok: true });
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    // The legacy studio's timelines, read only: Studio 2 cuts its films in avenDB. The list stays while the board's
    // scripts still find a film's legacy cut by its project and variant (api/scripts/day.ts, api/scripts/posts.ts).
    "/api/timelines": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        return json(req, await listTimelines());
      },
    },

    // A legacy cut's posts onto its film's item on the board (api/scripts/posts.ts)
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

    // The stories the Mac app is to file in the media vault (past the idea, no vault story yet), and filing one
    "/api/content/unfiled": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        return json(req, { items: await unfiledStories() });
      },
    },
    "/api/content/:id/story": {
      OPTIONS: preflight,
      PUT: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          const b = ((await readJson(req)) ?? {}) as { story?: string };
          return json(req, await fileStory(req.params.id, String(b.story ?? "")));
        } catch (e) {
          return fail(req, e);
        }
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

    // The stories: the board, and every story's steps.
    "/api/content": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await allowed(req, "content:admin");
        if (me instanceof Response) return me;
        const u = new URL(req.url);
        return json(req, { items: await listContent(u.searchParams.get("from") ?? undefined, u.searchParams.get("to") ?? undefined), kinds: KINDS, channels: CHANNELS, formats: FORMATS, statuses: STATUSES, beats: BEATS });
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

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
import { ledgerView } from "./ledger/view";
import { assignRole, can, capabilities, createRole, deleteRole, initRoles, listRoles, RoleError, setRoleCaps } from "./acl";
import { CAPABILITIES } from "./caps";
import { addIdea, deleteIdea, IdeaError, listIdeas, updateIdea } from "./ideas";
import { approveDevice, deviceInfo, KeyError, keyHolder, redeemDevice, revokeKey, startDevice } from "./keys";
import { joinInfo, listDevices, listVaultFiles, pairDevice, revokeDevice, VaultError } from "./vault";
import { analyseRoute, MODEL as ANALYSIS_MODEL, statusRoute as analysisStatus } from "./analysis";
import { checkModels, pick } from "./prem";
import { createTimeline, deleteTimeline, getTimeline, listTimelines, saveTimeline, TimelineError } from "./timelines";
import { createShot, getShot, listShots, saveShot, ShotError, shotVersions } from "./shots";
import { claimRender, listJobs, queueFrame, queueRender, queueStillOfFile, queueStillsOf, RenderError, rendersOf, reportRender } from "./renders";
import { BEATS, CHANNELS, ContentError, createContent, deleteContent, FORMATS, KINDS, listContent, saveContent, saveDay, savePosts, STATUSES, dropDeliveries, fileStory, unfiledStories } from "./content";
import { format } from "../../game/time";
import { GameError, getGame, move, resetGame, takeSeat } from "./maiacity-v1.js";
import { ViewError, deleteView, dropLandedDrafts, keepView, listViews, putView } from "./genui.js";
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

/** The signed-in founder (or a terminal's key holder), whatever they hold — or the response that says why not. */
async function signedIn(req: Request): Promise<{ id: string; role: string } | Response> {
  const key = await keyHolder(req);
  if (key) return key;
  const me = await viewer(req);
  return me ?? json(req, { error: "Please sign in." }, { status: 401 });
}

/** Turn a thrown ledger, role or notebook error into a response a person can read. */
function fail(req: Request, e: unknown) {
  if (e instanceof LedgerError || e instanceof RoleError || e instanceof IdeaError || e instanceof KeyError || e instanceof TimelineError || e instanceof ShotError || e instanceof ContentError || e instanceof RenderError || e instanceof VaultError || e instanceof GameError || e instanceof ViewError) return json(req, { error: e.message }, { status: e.status });
  console.error(e);
  return json(req, { error: "Something went wrong on our side." }, { status: 500 });
}

const preflight = (req: Request) => new Response(null, { status: 204, headers: cors(req) });

/** A timeline saved: the graded stills of the files whose look changed, queued (never failing the save itself). */
const stills = (founderId: string, before: Parameters<typeof queueStillsOf>[1], after: Parameters<typeof queueStillsOf>[2]) =>
  queueStillsOf(founderId, before, after).catch((e) => console.error("graded stills of a timeline:", e));

const publicFounder = (f: { id: string; number: number | bigint; name: string; created: Date }) => ({
  id: f.id,
  number: Number(f.number),
  name: f.name,
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
// what the last deploy brought from the repo: Generated UI drafts that were kept
await dropLandedDrafts().catch((e) => console.error("dropping landed drafts:", e));
await migrateLedger();
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
          // an app key (the Mac's MCP) only reads: a seat goes to a person signing in on the page
          const [f] = "scope" in me ? [] : await sql`SELECT name FROM founders WHERE id = ${me.id}`;
          return json(req, { game: await getGame("scope" in me ? null : { id: me.id, name: f?.name ?? "" }), me: me.id, admin: can(me, "economy:admin"), now: Date.now() });
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
          const [f] = await sql`SELECT name FROM founders WHERE id = ${me.id}`;
          return json(req, { game: await takeSeat({ id: me.id, name: f?.name ?? "" }, String(body?.seat ?? "")), now: Date.now() });
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
    "/api/maiacity-v1/reset": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await allowed(req, "economy:admin");
        if (me instanceof Response) return me;
        try {
          return json(req, { game: await resetGame(), now: Date.now() });
        } catch (e) {
          return fail(req, e);
        }
      },
    },

    // Generated UI (api/src/genui.js): the repo's views, and the drafts an agent writes over the MCP (the app's key)
    // until the admin keeps one and it lands in the repo; /app/genui/ draws them all, each in its own box. An admin's,
    // like the other tools: reading and writing both need media:admin; keeping a draft is the admin's own, on the page.
    "/api/genui": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          return json(req, { ...(await listViews()), now: Date.now() });
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    "/api/genui/:id": {
      OPTIONS: preflight,
      PUT: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          const body = await readJson(req);
          return json(req, { view: await putView({ ...body, id: req.params.id }, "scope" in me ? "mcp" : "page") });
        } catch (e) {
          return fail(req, e);
        }
      },
      DELETE: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          await deleteView(req.params.id);
          return new Response(null, { status: 204, headers: cors(req) });
        } catch (e) {
          return fail(req, e);
        }
      },
    },
    // keeping a draft ({ keep: true }, or false to take it back) is the admin's, on the page (the Mac app's page asks
    // with the app's key, so its MCP refuses this path to agents, as it refuses deciding a MIP)
    "/api/genui/:id/keep": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          const body = await readJson(req);
          return json(req, { view: await keepView(req.params.id, body?.keep !== false) });
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

    // ─────────────────────────────── the hearts ───────────────────────────
    // Minting needs an account: a founder's hearts, their income and their ledger.
    "/api/account": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await viewer(req);
        if (!me) return json(req, { error: "not signed in" }, { status: 401 });
        return big(req, { ...(await account(me.id)), caps: [...capabilities(me.role)] });
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
          const t = await createTimeline(me.id, (await readJson(req)) ?? {});
          await stills(me.id, null, t);
          return json(req, t, { status: 201 });
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
          const before = await getTimeline(req.params.id);
          const t = await saveTimeline(req.params.id, (await readJson(req)) ?? {});
          await stills(me.id, before, t);
          return json(req, t);
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
          return json(req, await queueRender(me.id, req.params.id, ((await readJson(req)) ?? {}) as { delivery?: unknown }), { status: 201 });
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
    // A file's grading still was made again (the Mac app, at a new moment): its graded still, made again through the
    // clip that last graded it
    "/api/media/:hash/still": {
      OPTIONS: preflight,
      POST: async (req) => {
        const me = await allowed(req, "media:admin");
        if (me instanceof Response) return me;
        try {
          const job = await queueStillOfFile(me.id, req.params.hash);
          return job ? json(req, job, { status: 201 }) : new Response(null, { status: 204, headers: cors(req) });
        } catch (e) {
          return fail(req, e);
        }
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

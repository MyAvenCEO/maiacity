// The signup service behind api.maia.city. One Bun process, one Postgres, and
// as little surface as the job allows: create a founder, sign one in, let them
// change the name they are known by, and count how many there are.
//
// The journal itself stays a static site on the CDN. Only these routes need a
// server, so only these routes get one.
import { migrate } from "./migrations";
import { sql } from "./db";
import { clearCookie, founderIdFrom, initSessions, sessionCookie, tokenFor } from "./session";
import { inviteOpen, loginFinish, loginOptions, registerFinish, registerOptions } from "./passkey";
import { fromBunSql, useDb } from "./pg";
import { can, capabilities, initRoles } from "./acl";
import { listTables, readTable, TableError } from "./tables";
import { adminByPass, type Refused } from "./standing";
import { founderByPass, type Founder } from "./founders.js";
import { analyseRoute, MODEL as ANALYSIS_MODEL, statusRoute as analysisStatus } from "./analysis";
import { checkModels, pick } from "./prem";
import { GameError, getGame, move, takeSeat } from "./maiacity-v1.js";
import { loadCode } from "../../game/code/index.js";

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
    "Access-Control-Allow-Headers": "content-type, authorization, x-avendb-pass",
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

/**
 * Who asks: the founder the pass their avenDB device signed for this call names, by its vault (`X-Avendb-Pass`,
 * founders.js); else, while it lasts, a session a passkey's sign-up or sign-in left in a browser's cookie. Or why not.
 */
async function viewer(req: Request): Promise<Founder | Refused> {
  const pass = req.headers.get("x-avendb-pass");
  if (pass) {
    const who = await founderByPass(pass);
    return "error" in who ? who : who.founder;
  }
  const id = founderIdFrom(req);
  const [row] = id ? await sql`SELECT id, number, created, role FROM founders WHERE id = ${id}` : [];
  return row ?? { status: 401, error: "Please open your avenDB first." };
}

/** The founder who asks (`viewer`), whatever they hold — or the response that says why not. */
async function signedIn(req: Request): Promise<Founder | Response> {
  const me = await viewer(req);
  return "error" in me ? json(req, { error: me.error }, { status: me.status }) : me;
}

/** Turn a thrown table or game error into a response a person can read. */
function fail(req: Request, e: unknown) {
  if (e instanceof TableError || e instanceof GameError) return json(req, { error: e.message }, { status: e.status });
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
// the views, logic modules and configs from the Maia City vault (C10): read once before serving, then every minute, so
// a change accepted in the vault runs here without a deploy. Read from avenDB's own feed inside the compose network
// (AVENDB_FEED): avendb.maia.city takes only post-quantum key exchange. What runs is what Maia City's own signed edits
// prove, checked here by avenDB's WebAssembly against its vault id, pinned in the repo (H2,
// game/code/sources/anchor.js), never the feed's JSON (game/code/sources/feed.js `provenRows`). A failed read or check
// keeps what was loaded, else the seed.
const CODE_FEED = process.env.AVENDB_FEED || undefined;
const loadVaultCode = () =>
  loadCode({ feed: CODE_FEED, timeout: 30_000 }).then(
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
    // two to sign in take seat A and seat B, and only the founder in a seat moves for it. The OS plays it signed in as
    // its person, as a browser does (Samuel 2026-10-19: "Play in The OS").
    "/api/maiacity-v1": {
      OPTIONS: preflight,
      GET: async (req) => {
        const me = await signedIn(req);
        if (me instanceof Response) return me;
        try {
          // a read seats nobody: a seat goes to a person on the page, who asks for it, named as their avenDB profile names
          // them (the page says so: no name of theirs is kept here)
          const name = new URL(req.url).searchParams.get("name") ?? "";
          const admin = can(me, "economy:admin");
          return json(req, { game: await getGame({ id: me.id, name }), me: me.id, admin, now: Date.now() });
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
        try {
          return json(req, { game: await move(me, String(body?.seat ?? ""), body?.action), now: Date.now() });
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
        const founder = await signedIn(req);
        if (founder instanceof Response) return founder;
        // what they may do comes with who they are, so the site can show them only what they can use
        const caps = [...capabilities(founder.role)];
        return json(req, { ...publicFounder(founder), role: founder.role, caps });
      },
    },

    // Invite only: once the city has its admin, signing up takes an invite of Maia City's, the avenDB share a device
    // acting for it signed (passkey.ts `inviteOpen`), used once; the API makes no code of its own any more
    "/api/invites/:code": {
      OPTIONS: preflight,
      GET: async (req) => json(req, { open: await inviteOpen(req.params.code) }),
    },

    // The admin's window into this Postgres, read only: every table and its rows, secrets hidden (tables.ts).
    // the admins' Postgres window (tables.ts), opened by Maia City's Admin standing in avenDB, as avenDB's server says
    // of the pass the page's device signs (standing.ts): no passkey session, role or key opens it
    "/api/tables": {
      OPTIONS: preflight,
      POST: async (req) => {
        const body = await req.json().catch(() => ({}));
        const admin = await adminByPass(body?.pass);
        if ("error" in admin) return json(req, { error: admin.error }, { status: admin.status });
        return json(req, await listTables());
      },
    },
    "/api/tables/:name": {
      OPTIONS: preflight,
      POST: async (req) => {
        const body = await req.json().catch(() => ({}));
        const admin = await adminByPass(body?.pass);
        if ("error" in admin) return json(req, { error: admin.error }, { status: admin.status });
        try {
          return json(req, await readTable(req.params.name, Number(body?.offset ?? 0), Number(body?.limit ?? 50)));
        } catch (e) {
          return fail(req, e);
        }
      },
    },

    // the shot analysis (analysis.ts): The OS sends a proxy's frames (display-referred) and the words said,
    // Prem's confidential Qwen answers tags, cues and a summary in the vocabulary (game/film/vocabulary.json)
    "/api/analysis": {
      GET: analysisStatus,
      POST: (req, server) => {
        // a dozen frames through a vision model may take a minute or two
        server.timeout(req, 0);
        return analyseRoute(req);
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

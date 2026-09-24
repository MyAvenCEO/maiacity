// A session is a signed string in a cookie: founderId.expiry.signature.
// The signing key is generated once and kept in the database, so sessions
// survive a restart without a secret living in the repository or the .env.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { sql } from "./db";

const COOKIE = "maia_session";
const LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // a month; a founder is not a shift worker

// The cookie is set by api.maia.city but has to be readable as first-party
// alongside maia.city, so it is scoped to the parent domain.
const COOKIE_DOMAIN = (process.env.COOKIE_DOMAIN ?? "").trim();
const SECURE = COOKIE_DOMAIN ? "; Secure" : ""; // plain http only in local dev

let SECRET = "";

/** Load (or create) the signing key — once per process, at boot. */
export async function initSessions(): Promise<void> {
  if (SECRET) return;
  const [row] = await sql`SELECT value FROM secrets WHERE key = 'session_secret'`;
  if (row) {
    SECRET = row.value;
    return;
  }
  SECRET = randomUUID() + randomUUID();
  await sql`INSERT INTO secrets (key, value) VALUES ('session_secret', ${SECRET})
            ON CONFLICT (key) DO NOTHING`;
  const [again] = await sql`SELECT value FROM secrets WHERE key = 'session_secret'`;
  SECRET = again.value; // whoever won the race owns the key
}

const sign = (data: string) => {
  if (!SECRET) throw new Error("initSessions() must run before the first token");
  return createHmac("sha256", SECRET).update(data).digest("base64url");
};

export function tokenFor(founderId: string): string {
  const expiry = Date.now() + LIFETIME_MS;
  const data = `${founderId}.${expiry}`;
  return `${data}.${sign(data)}`;
}

function verify(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [id, expiry, signature] = parts;
  if (Number(expiry) < Date.now()) return null;
  const expected = sign(`${id}.${expiry}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

const attrs = `Path=/; Max-Age=${LIFETIME_MS / 1000}; SameSite=Lax; HttpOnly${SECURE}${
  COOKIE_DOMAIN ? `; Domain=${COOKIE_DOMAIN}` : ""
}`;

export const sessionCookie = (token: string) => `${COOKIE}=${token}; ${attrs}`;
export const clearCookie = () =>
  `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly${SECURE}${
    COOKIE_DOMAIN ? `; Domain=${COOKIE_DOMAIN}` : ""
  }`;

/** Who is asking? Null when nobody is signed in. */
export function founderIdFrom(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === COOKIE) return verify(rest.join("="));
  }
  return null;
}

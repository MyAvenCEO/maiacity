// Signing up is creating a passkey. There is no password to choose, no email
// to confirm and nothing to reset — which is the point, and also the cost:
// lose every device and the account is gone with them.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { randomUUID } from "node:crypto";
import { sql, type Founder, type Passkey } from "./db";
import { DEFAULT_ROLE, FIRST_SIGNUP_ROLE } from "./caps";
import { CODE_FEED } from "../../game/code/sources/feed.js";

// The page doing the WebAuthn ceremony is maia.city; this API only verifies
// what the browser produced. So the relying party is the site, never the API
// host — a passkey made on maia.city stays valid on any of its subdomains.
const RP_ID = (process.env.RP_ID ?? "localhost").trim();
const RP_NAME = process.env.RP_NAME ?? "maiaCITY";
const ORIGINS = (process.env.SITE_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// Open challenges, short-lived, in memory. One container holds the registry;
// if that ever stops being true these move into Postgres.
type Challenge = { purpose: "register" | "login"; founderId?: string; name?: string; invite?: string; expires: number };
const CHALLENGES = new Map<string, Challenge>();
// the challenges held at once at most: past it, the oldest goes first, so asking for many holds no more memory
export const MOST_CHALLENGES = 10_000;

export function remember(challenge: string, data: Omit<Challenge, "expires">) {
  for (const [c, d] of CHALLENGES) if (d.expires < Date.now()) CHALLENGES.delete(c);
  while (CHALLENGES.size >= MOST_CHALLENGES) CHALLENGES.delete(CHALLENGES.keys().next().value as string);
  CHALLENGES.set(challenge, { ...data, expires: Date.now() + 5 * 60_000 });
}

/** How many challenges it holds now. */
export const heldChallenges = () => CHALLENGES.size;

export function take(challenge: string, purpose: Challenge["purpose"]): Challenge | null {
  const d = CHALLENGES.get(challenge);
  if (!d || d.purpose !== purpose || d.expires < Date.now()) return null;
  CHALLENGES.delete(challenge);
  return d;
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

// ---------------------------------------------------------------- signing up

/** An invite of avenDB's, named by the id of its share: 64 hex digits, where the API's own codes were base64url. */
const SHARE = /^[0-9a-f]{64}$/;

/** Where avenDB's server says whether an invite is open, inside the compose network as the API reads its code
 *  (AVENDB_FEED), at `<share>` after it. */
const INVITES = new URL("/feed/invite/", process.env.AVENDB_FEED || CODE_FEED);

/** Whether avenDB's server says share `share` is an invite of Maia City's that no vault claimed yet
 *  (avendb-server's feed.rs `invite`): false too where it doesn't answer, as the person then tries again. */
async function cityInvite(share: string): Promise<boolean> {
  try {
    const answer = await fetch(new URL(share, INVITES), { signal: AbortSignal.timeout(4000) });
    return answer.ok && (await answer.json())?.open === true;
  } catch {
    return false;
  }
}

/** Whether invite `code` may sign one person up: an invite of Maia City's in avenDB, by its share's id, that no vault
 *  claimed and nobody signed up on here yet, made by a device acting for Maia City with no passkey (Samuel 2026-10-19:
 *  the city's admin invites, their vault signs for it); or an older code an admin made here, unused, unexpired. */
export async function inviteOpen(code: string): Promise<boolean> {
  if (!code) return false;
  if (SHARE.test(code)) {
    const [used] = await sql`SELECT 1 FROM signup_invites WHERE code = ${code}`;
    return !used && (await cityInvite(code));
  }
  const [row] = await sql`
    SELECT 1 FROM signup_invites WHERE code = ${code} AND used_by IS NULL AND expires_at > now()`;
  return !!row;
}

const INVITE_ONLY = "maiaCITY is invite only: ask its admin for an invite link.";

export async function registerOptions(name: string, invite = ""): Promise<Result<unknown>> {
  const clean = name.trim().slice(0, 60);
  if (clean.length < 2) return { ok: false, error: "Please give a name with at least two characters." };
  // the very first person runs the city and needs none; everyone after them signs up with an admin's invite
  const [any] = await sql`SELECT 1 FROM founders LIMIT 1`;
  if (any && !(await inviteOpen(invite))) return { ok: false, error: INVITE_ONLY };

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    // Nothing identifying goes into the credential: a fresh id, and the name
    // the person chose to be known by, which labels the passkey in their
    // authenticator. The name itself is kept nowhere here: it is their human
    // vault's profile, in avenDB.
    userID: new TextEncoder().encode(randomUUID()),
    userName: clean,
    userDisplayName: clean,
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  remember(options.challenge, { purpose: "register", name: clean, invite: any ? invite : undefined });
  return { ok: true, value: options };
}

export async function registerFinish(body: any): Promise<Result<Founder>> {
  const challenge = String(body?.response?.clientDataJSON ? decodeChallenge(body) : "");
  const pending = challenge ? take(challenge, "register") : null;
  if (!pending?.name) return { ok: false, error: "This sign-up has expired. Please start again." };

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: ORIGINS,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (!verification.verified || !verification.registrationInfo)
    return { ok: false, error: "The passkey could not be verified." };

  if (pending.invite && SHARE.test(pending.invite) && !(await cityInvite(pending.invite))) return { ok: false, error: INVITE_ONLY };

  const { credential } = verification.registrationInfo;
  const id = randomUUID();
  // the very first signup runs the city; everyone after them starts as a citizen, with an invite they use up here, in
  // the same transaction: an invite signs one person up, and a sign-up without one, once the city has its admin, none
  const signedUp = await sql.begin(async (tx: any) => {
    const [first] = await tx`SELECT NOT EXISTS (SELECT 1 FROM founders) AS first`;
    if (!first.first && !pending.invite) return null;
    const [founder] = await tx`
      INSERT INTO founders (id, name, role)
      VALUES (${id}, '', ${first.first ? FIRST_SIGNUP_ROLE : DEFAULT_ROLE})
      RETURNING id, number, created`;
    // an invite of avenDB's is used up by its row here, which no one made before: one person signs up on it
    if (!first.first && SHARE.test(pending.invite ?? "")) {
      const [used] = await tx`
        INSERT INTO signup_invites (code, expires_at, used_by, used_at) VALUES (${pending.invite}, now(), ${id}, now())
        ON CONFLICT (code) DO NOTHING
        RETURNING code`;
      if (!used) throw new InviteUsed();
    } else if (!first.first) {
      const [used] = await tx`
        UPDATE signup_invites SET used_by = ${id}, used_at = now()
        WHERE code = ${pending.invite} AND used_by IS NULL AND expires_at > now()
        RETURNING code`;
      if (!used) throw new InviteUsed();
    }
    await tx`
      INSERT INTO passkeys (id, founder_id, public_key, counter, transports)
      VALUES (${credential.id}, ${id}, ${b64url(credential.publicKey)}, ${credential.counter},
              ${credential.transports?.join(",") ?? null})`;
    return founder;
  }).catch((e: unknown) => (e instanceof InviteUsed ? null : Promise.reject(e)));
  if (!signedUp) return { ok: false, error: INVITE_ONLY };
  return { ok: true, value: signedUp };
}

/** An invite used up or expired while its sign-up was under way: the sign-up rolls back. */
class InviteUsed extends Error {}

// --------------------------------------------------------------- signing in

export async function loginOptions() {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
    // No allowCredentials: the passkey knows who it belongs to, so there is no
    // username field anywhere in this flow.
  });
  remember(options.challenge, { purpose: "login" });
  return options;
}

export async function loginFinish(body: any): Promise<Result<Founder>> {
  const challenge = String(body?.response?.clientDataJSON ? decodeChallenge(body) : "");
  const pending = challenge ? take(challenge, "login") : null;
  if (!pending) return { ok: false, error: "This sign-in has expired. Please try again." };

  const [key] = await sql`
    SELECT id, founder_id, public_key, counter, transports FROM passkeys WHERE id = ${String(body?.id ?? "")}`;
  if (!key) return { ok: false, error: "This passkey is not registered here." };

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: ORIGINS,
      expectedRPID: RP_ID,
      requireUserVerification: false,
      credential: {
        id: key.id,
        publicKey: new Uint8Array(Buffer.from(key.public_key, "base64url")),
        counter: Number(key.counter),
        transports: key.transports ? key.transports.split(",") : undefined,
      },
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (!verification.verified) return { ok: false, error: "That passkey did not verify." };

  await sql`UPDATE passkeys SET counter = ${verification.authenticationInfo.newCounter} WHERE id = ${key.id}`;
  const [founder] = await sql`SELECT id, number, created FROM founders WHERE id = ${key.founder_id}`;
  if (!founder) return { ok: false, error: "That passkey has no account behind it." };
  return { ok: true, value: founder };
}

/** The challenge the browser actually signed, read back out of clientDataJSON. */
function decodeChallenge(body: any): string {
  try {
    const json = JSON.parse(Buffer.from(String(body.response.clientDataJSON), "base64url").toString("utf8"));
    return String(json.challenge ?? "");
  } catch {
    return "";
  }
}

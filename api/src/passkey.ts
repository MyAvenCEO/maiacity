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
type Challenge = { purpose: "register" | "login"; founderId?: string; name?: string; expires: number };
const CHALLENGES = new Map<string, Challenge>();

function remember(challenge: string, data: Omit<Challenge, "expires">) {
  for (const [c, d] of CHALLENGES) if (d.expires < Date.now()) CHALLENGES.delete(c);
  CHALLENGES.set(challenge, { ...data, expires: Date.now() + 5 * 60_000 });
}

function take(challenge: string, purpose: Challenge["purpose"]): Challenge | null {
  const d = CHALLENGES.get(challenge);
  if (!d || d.purpose !== purpose || d.expires < Date.now()) return null;
  CHALLENGES.delete(challenge);
  return d;
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

// ---------------------------------------------------------------- signing up

export async function registerOptions(name: string): Promise<Result<unknown>> {
  const clean = name.trim().slice(0, 60);
  if (clean.length < 2) return { ok: false, error: "Please give a name with at least two characters." };

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    // Nothing identifying goes into the credential: a fresh id, and the name
    // the person chose to be known by.
    userID: new TextEncoder().encode(randomUUID()),
    userName: clean,
    userDisplayName: clean,
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  remember(options.challenge, { purpose: "register", name: clean });
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

  const { credential } = verification.registrationInfo;
  const id = randomUUID();
  const [founder] = await sql`
    INSERT INTO founders (id, name) VALUES (${id}, ${pending.name})
    RETURNING id, number, name, created`;
  await sql`
    INSERT INTO passkeys (id, founder_id, public_key, counter, transports)
    VALUES (${credential.id}, ${id}, ${b64url(credential.publicKey)}, ${credential.counter},
            ${credential.transports?.join(",") ?? null})`;
  return { ok: true, value: founder };
}

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
  const [founder] = await sql`SELECT id, number, name, created FROM founders WHERE id = ${key.founder_id}`;
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

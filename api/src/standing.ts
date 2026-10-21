/**
 * Who opens an admin's page, by avenDB's own word (G3, avendb/spec/AvenDB/Gate.lean `passStanding`; Samuel 2026-10-20:
 * "attached to my maia city admin vault, not my passkey"). A page's avenDB device signs a short pass for this API
 * (the `api_pass` op, avendb's `sign::ApiPass`): the device's keys, the API's name and when it was made, under a
 * signature context of its own. The API hands it to avenDB's server (POST /feed/pass, inside the compose network as
 * it reads its code, AVENDB_FEED), which checks it and answers the vault the device is a device of and whether that
 * vault is an admin of Maia City: it owns Maia City, or holds its Admin cap group. So the page opens in theOS and in
 * a browser alike, with no passkey session, no Postgres role and no key of the API's.
 *
 * A pass counts for ten minutes by avenDB's server's clock, for this API alone, and the API takes each pass once: a
 * page asks its device for a new one for every call.
 */
import { createHash } from "node:crypto";

/** The name this API goes by in a device's pass: a pass for any other service counts for nothing here. */
export const AUDIENCE = "maiaCITY API";

/** How long a pass is kept as used: its life and the skew avenDB allows a device's clock (avendb's `sign::PASS_LIFE`,
 *  `sign::PASS_SKEW`), so a pass is never taken twice while it could count. */
const KEPT_MS = (10 + 5) * 60_000;

/** A pass, as the page hands it over: the pass's wire bytes in base64url, a few kilobytes. */
const PASS = /^[A-Za-z0-9_-]{64,65536}$/;

/** What avenDB's server says of a pass's device: its vault, whether that vault is an admin of Maia City, and, where
 *  asked, the P-256 keys of that vault's owner passkeys (SEC1 compressed, hex), by which the API knows its founder
 *  (founders.js). */
export type Standing = { vault: string | null; admin: boolean; passkeys?: string[] };

/** Asks avenDB's server whom `pass` names, for this API, with the vault's owner passkeys where `passkeys` is true:
 *  what it answered, or null where it didn't answer. */
export type Asker = (pass: string, passkeys?: boolean) => Promise<Standing | null>;

/** A passkey's P-256 key as avenDB names it: SEC1 compressed, in hex. */
const P256 = /^0[23][0-9a-f]{64}$/;

/** Where avenDB's server says whom a pass names: beside the code feed the API reads (AVENDB_FEED). */
const passes = () => new URL("/feed/pass", process.env.AVENDB_FEED || "http://avendb:3351/feed/code");

/** avenDB's server's answer for `pass` (avendb-server's feed.rs `pass`), or null where it doesn't answer. */
export const askServer: Asker = async (pass, passkeys = false) => {
  try {
    const answer = await fetch(passes(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pass, audience: AUDIENCE, ...(passkeys ? { passkeys: true } : {}) }),
      signal: AbortSignal.timeout(4000),
    });
    if (!answer.ok) return null;
    const said = await answer.json();
    const standing: Standing = { vault: typeof said?.vault === "string" ? said.vault : null, admin: said?.admin === true };
    if (passkeys) standing.passkeys = Array.isArray(said?.passkeys) ? said.passkeys.filter((k: unknown) => typeof k === "string" && P256.test(k)) : [];
    return standing;
  } catch {
    return null;
  }
};

/** Each pass taken, by its hash, with when it may be forgotten. */
const used = new Map<string, number>();

/** Why a pass opens nothing: a status, and words a person reads. */
export type Refused = { status: number; error: string };

/** The vault pass `pass` names, by avenDB's server (`ask`), and whether it is an admin of Maia City, or why not. A pass
 *  is taken once, whatever the answer; `passkeys` asks for the vault's owner passkeys too. */
export async function standingOf(
  pass: unknown,
  ask: Asker = askServer,
  now = Date.now(),
  passkeys = false,
): Promise<{ vault: string; admin: boolean; passkeys?: string[] } | Refused> {
  if (typeof pass !== "string" || !PASS.test(pass)) {
    return { status: 401, error: "This opens by your avenDB device: open avenDB on this device first." };
  }
  for (const [hash, until] of used) if (until <= now) used.delete(hash);
  const hash = createHash("sha256").update(pass).digest("hex");
  if (used.has(hash)) return { status: 401, error: "This pass was used already: ask your device for a new one." };
  used.set(hash, now + KEPT_MS);
  const said = await ask(pass, passkeys);
  if (!said) return { status: 503, error: "avenDB’s server didn’t answer. Please try again in a moment." };
  if (!said.vault) return { status: 401, error: "avenDB doesn’t know this device, or its pass is out of date." };
  return { ...said, vault: said.vault };
}

/** The vault of an admin of Maia City that pass `pass` names, by avenDB's server (`ask`), or why not. */
export async function adminByPass(pass: unknown, ask: Asker = askServer, now = Date.now()): Promise<{ vault: string } | Refused> {
  const said = await standingOf(pass, ask, now);
  if ("error" in said) return said;
  if (!said.admin) return { status: 403, error: "This needs Maia City’s Admin group in avenDB." };
  return { vault: said.vault };
}

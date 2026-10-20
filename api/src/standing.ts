/**
 * Who opens an admin's page, by avenDB's own word (G3, avendb/spec/AvenDB/Gate.lean `passStanding`; Samuel 2026-10-20:
 * "attached to my maia city admin vault, not my passkey"). A page's avenDB device signs a short pass for this API
 * (the `api_pass` op, avendb's `sign::ApiPass`): the device's keys, the API's name and when it was made, under a
 * signature context of its own. The API hands it to avenDB's server (POST /feed/pass, inside the compose network as
 * it reads its code, AVENDB_FEED), which checks it and answers the vault the device is a device of and whether that
 * vault is an admin of Maia City: it owns Maia City, or holds its Admin cap group. So the page opens in The OS and in
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

/** What avenDB's server says of a pass's device: its vault, and whether that vault is an admin of Maia City. */
export type Standing = { vault: string | null; admin: boolean };

/** Asks avenDB's server whom `pass` names, for this API: what it answered, or null where it didn't answer. */
export type Asker = (pass: string) => Promise<Standing | null>;

/** Where avenDB's server says whom a pass names: beside the code feed the API reads (AVENDB_FEED). */
const passes = () => new URL("/feed/pass", process.env.AVENDB_FEED || "http://avendb:3351/feed/code");

/** avenDB's server's answer for `pass` (avendb-server's feed.rs `pass`), or null where it doesn't answer. */
export const askServer: Asker = async (pass) => {
  try {
    const answer = await fetch(passes(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pass, audience: AUDIENCE }),
      signal: AbortSignal.timeout(4000),
    });
    if (!answer.ok) return null;
    const said = await answer.json();
    return { vault: typeof said?.vault === "string" ? said.vault : null, admin: said?.admin === true };
  } catch {
    return null;
  }
};

/** Each pass taken, by its hash, with when it may be forgotten. */
const used = new Map<string, number>();

/** The vault of an admin of Maia City that pass `pass` names, by avenDB's server (`ask`), or why not: a status and
 *  words a person reads. A pass is taken once, whatever the answer. */
export async function adminByPass(
  pass: unknown,
  ask: Asker = askServer,
  now = Date.now(),
): Promise<{ vault: string } | { status: number; error: string }> {
  if (typeof pass !== "string" || !PASS.test(pass)) {
    return { status: 401, error: "This page opens by your avenDB device: open avenDB on this device first." };
  }
  for (const [hash, until] of used) if (until <= now) used.delete(hash);
  const hash = createHash("sha256").update(pass).digest("hex");
  if (used.has(hash)) return { status: 401, error: "This pass was used already: ask your device for a new one." };
  used.set(hash, now + KEPT_MS);
  const said = await ask(pass);
  if (!said) return { status: 503, error: "avenDB’s server didn’t answer. Please try again in a moment." };
  if (!said.vault) return { status: 401, error: "avenDB doesn’t know this device, or its pass is out of date." };
  if (!said.admin) return { status: 403, error: "This needs Maia City’s Admin group in avenDB." };
  return { vault: said.vault };
}

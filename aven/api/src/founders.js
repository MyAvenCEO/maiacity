// @ts-check
/**
 * Who a person is to this API: the founder their avenDB vault is (Samuel 2026-10-20: the app's door opens on their vault
 * alone, with no sign-in of the API's). A page's device signs a pass for each call (`X-Avendb-Pass`, standing.ts), and
 * avenDB's server names the vault the device is a device of; the founder is the one linked to that vault, or else the
 * one whose passkey owns it, as avenDB's server names that vault's owner passkeys, linked from then on. The passkey a
 * person signed up here with is the one that roots their human vault (one passkey, the app's way in), so nobody links
 * anything by hand, a device an owner removes stops counting, and a vault no founder's passkey owns is nobody here.
 */
import { convertCOSEtoPKCS } from "@simplewebauthn/server/helpers";
import { db } from "./pg";
import { askServer, standingOf } from "./standing";

/** @typedef {{ id: string; number: number | bigint; created: Date; role: string }} Founder */

/** The answer for a vault no founder signed up with a passkey of. */
const NOBODY = { status: 401, error: "This vault isn’t a founder’s of maiaCITY: no passkey of one owns it." };

/**
 * A passkey's public key as the API keeps it (COSE, base64url) as avenDB names a passkey's P-256 key: SEC1 compressed,
 * in hex. Null for a key that is no P-256 point.
 * @param {string} cose
 */
export function p256Of(cose) {
  try {
    const point = convertCOSEtoPKCS(new Uint8Array(Buffer.from(cose, "base64url")));
    if (point.length !== 65 || point[0] !== 4) return null;
    return Buffer.concat([Buffer.from([point[64] & 1 ? 3 : 2]), point.subarray(1, 33)]).toString("hex");
  } catch {
    return null;
  }
}

/**
 * The founder pass `pass` names by its device's vault, avenDB's server (`ask`) saying which, or why not: a status and
 * words a person reads. A vault no founder is linked to yet goes to the first founder whose passkey owns it.
 * @param {unknown} pass
 * @param {import("./standing").Asker} [ask]
 * @returns {Promise<{ founder: Founder } | import("./standing").Refused>}
 */
export async function founderByPass(pass, ask = askServer, now = Date.now()) {
  const said = await standingOf(pass, ask, now);
  if ("error" in said) return said;
  const { rows: [linked] } = await db.query("SELECT id, number, created, role FROM founders WHERE vault = $1", [said.vault]);
  if (linked) return { founder: linked };
  // the pass is this API's already (standingOf took it): the vault's owner passkeys, asked of the server once more
  const owners = (await ask(/** @type {string} */ (pass), true))?.passkeys ?? [];
  if (!owners.length) return NOBODY;
  const { rows: keys } = await db.query(
    "SELECT p.founder_id, p.public_key FROM passkeys p JOIN founders f ON f.id = p.founder_id ORDER BY f.number, p.created",
  );
  const owner = keys.find((k) => owners.includes(p256Of(k.public_key) ?? ""));
  if (!owner) return NOBODY;
  // one vault per founder: the one their passkey owns now, as a vault founded anew would be
  const { rows: [founder] } = await db.query(
    "UPDATE founders SET vault = $1 WHERE id = $2 RETURNING id, number, created, role",
    [said.vault, owner.founder_id],
  );
  return founder ? { founder } : NOBODY;
}

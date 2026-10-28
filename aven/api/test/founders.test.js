// @ts-check
// Who a person is to the API (founders.js): the founder their avenDB vault is, by the pass their device signs for each
// call, linked the first time to the founder whose passkey owns the vault; against real Postgres semantics (PGlite)
// and avenDB's server stood in for.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { useDb } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { founderByPass, p256Of } from "../src/founders.js";
import { askServer } from "../src/standing";
import { avendbStandIn, pass, vaultOf } from "./fixtures/avendb.js";

/** A passkey's P-256 key as the API keeps it (COSE, base64url) and as avenDB names it (SEC1 compressed, hex). */
function passkey() {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const [x, y] = [Buffer.from(/** @type {string} */ (jwk.x), "base64url"), Buffer.from(/** @type {string} */ (jwk.y), "base64url")];
  const cose = isoCBOR.encode(new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(x)], [-3, new Uint8Array(y)]]));
  const p256 = Buffer.concat([Buffer.from([y[31] & 1 ? 3 : 2]), x]).toString("hex");
  return { cose: Buffer.from(cose).toString("base64url"), p256 };
}

const [samuel, bob] = [passkey(), passkey()];
const avendb = avendbStandIn({ [vaultOf("samuel")]: [samuel.p256], [vaultOf("stranger")]: [passkey().p256] });
const pg = new PGlite();

beforeAll(async () => {
  for (const m of MIGRATIONS) await pg.exec(m.sql);
  /** @param {any} q */
  const run = (q) => async (/** @type {string} */ text, /** @type {unknown[]} */ params = []) => {
    const r = await q.query(text, params);
    return { rows: r.rows, affectedRows: r.affectedRows ?? 0 };
  };
  useDb({ query: run(pg), exec: async (text) => void (await pg.exec(text)), transaction: (fn) => pg.transaction((tx) => fn({ query: run(tx) })) });
  for (const [id, key] of [["samuel", samuel], ["bob", bob]]) {
    const { cose } = /** @type {{ cose: string }} */ (key);
    await pg.query("INSERT INTO founders (id, name, role) VALUES ($1, '', $2)", [id, id === "samuel" ? "admin" : "citizen"]);
    await pg.query("INSERT INTO passkeys (id, founder_id, public_key) VALUES ($1, $2, $3)", [`cred-${id}`, id, cose]);
  }
  avendb.start();
});
afterAll(() => avendb.stop());

describe("a founder is known by their avenDB vault", () => {
  test("a passkey as the API keeps it is the P-256 key avenDB names", () => {
    expect(p256Of(samuel.cose)).toBe(samuel.p256);
    expect(p256Of("not a key")).toBeNull();
  });

  test("the first pass of a vault their passkey owns links it to them, and later passes find them by it", async () => {
    const first = await founderByPass(pass("samuel"));
    expect(first).toMatchObject({ founder: { id: "samuel", role: "admin" } });
    expect((await pg.query("SELECT vault FROM founders WHERE id = 'samuel'")).rows).toEqual([{ vault: vaultOf("samuel") }]);
    let asked = 0;
    /** @type {import("../src/standing").Asker} */
    const counting = async (p, passkeys) => {
      if (passkeys) asked += 1;
      return askServer(p, passkeys);
    };
    expect(await founderByPass(pass("samuel"), counting)).toMatchObject({ founder: { id: "samuel" } });
    expect(asked).toBe(0);
  });

  test("a vault no founder's passkey owns is nobody, and a pass counts once", async () => {
    expect(await founderByPass(pass("stranger"))).toMatchObject({ status: 401 });
    expect(await founderByPass(pass("other"))).toMatchObject({ status: 401 });
    expect((await pg.query("SELECT vault FROM founders WHERE id = 'bob'")).rows).toEqual([{ vault: null }]);
    const once = pass("samuel");
    expect(await founderByPass(once)).toMatchObject({ founder: { id: "samuel" } });
    expect(await founderByPass(once)).toMatchObject({ status: 401 });
    expect(await founderByPass(undefined)).toMatchObject({ status: 401 });
  });
});

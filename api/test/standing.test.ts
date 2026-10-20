// Who opens an admin's page (standing.ts): avenDB's server's word on the pass a page's device signs, an admin of Maia
// City alone, each pass taken once; and the server's answer as the API reads it, from a feed that stands in for it.
import { afterAll, describe, expect, test } from "bun:test";
import { adminByPass, askServer, AUDIENCE, type Asker } from "../src/standing";

const PASS = "A".repeat(200);
const pass = (n: number) => `${PASS}${n}`;
const says = (vault: string | null, admin: boolean): Asker => async () => ({ vault, admin });

describe("an admin's page opens by avenDB's word on the device's pass", () => {
  test("an admin of Maia City's pass opens it, once", async () => {
    expect(await adminByPass(pass(1), says("ab".repeat(32), true))).toEqual({ vault: "ab".repeat(32) });
    expect(await adminByPass(pass(1), says("ab".repeat(32), true))).toMatchObject({ status: 401 });
  });

  test("a device that is no admin's, nobody's device, or no pass, opens nothing", async () => {
    expect(await adminByPass(pass(2), says("cd".repeat(32), false))).toMatchObject({ status: 403 });
    expect(await adminByPass(pass(3), says(null, false))).toMatchObject({ status: 401 });
    expect(await adminByPass(pass(4), async () => null)).toMatchObject({ status: 503 });
    for (const bad of [undefined, "", "short", 42, `${PASS} with spaces`]) {
      expect(await adminByPass(bad, says("ab".repeat(32), true))).toMatchObject({ status: 401 });
    }
  });

  test("a used pass is forgotten once it could count no more", async () => {
    const at = Date.now();
    expect(await adminByPass(pass(5), says("ab".repeat(32), true), at)).toEqual({ vault: "ab".repeat(32) });
    expect(await adminByPass(pass(5), says("ab".repeat(32), true), at + 60_000)).toMatchObject({ status: 401 });
    const later = at + 16 * 60_000;
    expect(await adminByPass(pass(5), says("ab".repeat(32), true), later)).toEqual({ vault: "ab".repeat(32) });
  });
});

describe("avenDB's server, as the API asks it", () => {
  const asked: unknown[] = [];
  const feed = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method !== "POST" || url.pathname !== "/feed/pass") return new Response("{}", { status: 404 });
      const body = await req.json();
      asked.push(body);
      if (body.pass === "down") return new Response("{}", { status: 500 });
      if (body.passkeys) return Response.json({ vault: "ef".repeat(32), admin: false, passkeys: [`02${"ab".repeat(32)}`, "not a key", 7] });
      return Response.json(body.pass === "admin" ? { vault: "ef".repeat(32), admin: true } : { vault: null, admin: false });
    },
  });
  const was = process.env.AVENDB_FEED;
  process.env.AVENDB_FEED = `http://127.0.0.1:${feed.port}/feed/code`;
  afterAll(() => {
    feed.stop(true);
    process.env.AVENDB_FEED = was;
  });

  test("posts the pass with this API's name, and reads its answer", async () => {
    expect(await askServer("admin")).toEqual({ vault: "ef".repeat(32), admin: true });
    expect(await askServer("stranger")).toEqual({ vault: null, admin: false });
    expect(asked[0]).toEqual({ pass: "admin", audience: AUDIENCE });
  });

  test("asks for the vault's owner passkeys where the API needs them, and keeps only P-256 keys", async () => {
    expect(await askServer("someone", true)).toEqual({ vault: "ef".repeat(32), admin: false, passkeys: [`02${"ab".repeat(32)}`] });
    expect(asked.at(-1)).toEqual({ pass: "someone", audience: AUDIENCE, passkeys: true });
  });

  test("a server that fails answers nothing", async () => {
    expect(await askServer("down")).toBeNull();
  });
});

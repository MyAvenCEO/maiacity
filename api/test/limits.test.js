// How often one address may ask the API's costly routes (src/limits.js), and how many passkey challenges it holds at
// most (src/passkey.ts).
import { describe, expect, test } from "bun:test";
import { Rate, clientOf, costly, limitRoutes, perMinute } from "../src/limits.js";

const ask = (path, headers = {}, method = "POST") => new Request(`http://api.test${path}`, { method, headers });

describe("the API's rate for each address", () => {
  test("an address asks as often as its rate lets it, and again as its tokens come back", () => {
    const rate = new Rate(3);
    const at = 1_000_000;
    expect([1, 2, 3, 4].map(() => rate.allows("10.0.0.1", at))).toEqual([true, true, true, false]);
    expect(rate.allows("10.0.0.2", at)).toBe(true);
    expect(rate.allows("10.0.0.1", at + 10_000)).toBe(false);
    expect(rate.allows("10.0.0.1", at + 20_000)).toBe(true);
    expect(new Rate(0).allows("10.0.0.1", at)).toBe(true);
  });

  test("it remembers so many addresses at most, forgetting the one heard from longest ago", () => {
    const rate = new Rate(1, 2);
    rate.allows("a", 0);
    rate.allows("b", 0);
    rate.allows("c", 0);
    expect([...rate.buckets.keys()]).toEqual(["b", "c"]);
    expect(rate.allows("a", 0)).toBe(true);
  });

  test("the passkey ceremonies and calls with a device's pass are costly, others not", () => {
    expect(costly(ask("/api/passkey/login/options"))).toBe(true);
    expect(costly(ask("/api/passkey/login/options", {}, "OPTIONS"))).toBe(false);
    expect(costly(ask("/api/tables"))).toBe(true);
    expect(costly(ask("/api/me", { "x-avendb-pass": "p" }, "GET"))).toBe(true);
    expect(costly(ask("/api/founders/count", {}, "GET"))).toBe(false);
  });

  test("the address is the last the proxy names, else the socket's", () => {
    expect(clientOf(ask("/", { "x-forwarded-for": "6.6.6.6, 1.2.3.4" }))).toBe("1.2.3.4");
    expect(clientOf(ask("/"), { requestIP: () => ({ address: "9.9.9.9" }) })).toBe("9.9.9.9");
  });

  test("routes over the rate answer 429, the others as before", async () => {
    const tooMany = () => new Response(null, { status: 429 });
    const routes = limitRoutes(
      { "/api/passkey/login/options": { POST: () => new Response("ok") }, "/api/health": () => new Response("ok") },
      new Rate(1),
      tooMany,
    );
    const from = { "x-forwarded-for": "1.2.3.4" };
    const login = routes["/api/passkey/login/options"].POST;
    expect((await login(ask("/api/passkey/login/options", from))).status).toBe(200);
    expect((await login(ask("/api/passkey/login/options", from))).status).toBe(429);
    for (let i = 0; i < 3; i++) expect((await routes["/api/health"](ask("/api/health", from, "GET"))).status).toBe(200);
  });

  test("API_RATE is the asks a minute, 30 by default", () => {
    expect(perMinute(undefined)).toBe(30);
    expect(perMinute("0")).toBe(0);
    expect(perMinute("120")).toBe(120);
    expect(() => perMinute("lots")).toThrow();
  });
});

describe("the passkey challenges", () => {
  test("it holds so many at most, the oldest going first", async () => {
    // the challenges are in memory alone: Postgres, which the module names, is never reached
    process.env.DATABASE_URL ??= "postgres://nobody@127.0.0.1:1/none";
    if (!/^https?:\/\//.test(process.env.AVENDB_FEED ?? "")) process.env.AVENDB_FEED = "http://avendb.test:3351";
    const { MOST_CHALLENGES, heldChallenges, remember, take } = await import("../src/passkey.ts");
    for (let i = 0; i <= MOST_CHALLENGES; i++) remember(`c${i}`, { purpose: "login" });
    expect(heldChallenges()).toBe(MOST_CHALLENGES);
    expect(take("c0", "login")).toBeNull();
    expect(take(`c${MOST_CHALLENGES}`, "login")?.purpose).toBe("login");
  });
});

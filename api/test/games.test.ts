// Which games the API takes as published: the ones avenDB's public feed lists by their game entry (./src/games.ts).
import { expect, test } from "bun:test";
import { published, useGamesFetch } from "../src/games";
import { publishedOf } from "../../game/games.js";

const row = (id: string, extra = {}) => ({ entry: "e", vault: "v", seed: "Maia City", type: "game", tags: ["game", `game:${id}`], ...extra });
const feed = (rows: unknown[], status = 200) => (async () => new Response(JSON.stringify({ entries: rows }), { status })) as unknown as typeof fetch;

test("a game the feed lists is published, one it doesn't isn't", async () => {
  useGamesFetch(feed([row("sandbox-7")]));
  expect(await published("sandbox-7")).toBe(true);
  expect(await published("maiacity-v1")).toBe(false);
});

test("a feed that can't be read publishes nothing", async () => {
  useGamesFetch(feed([], 502));
  expect(await published("sandbox-7")).toBe(false);
  useGamesFetch((async () => { throw new Error("offline"); }) as unknown as typeof fetch);
  expect(await published("sandbox-7")).toBe(false);
});

test("only game entries count: a code entry tagged with the game publishes nothing", () => {
  expect(publishedOf([{ type: "view", tags: ["ref:views/x", "game:sandbox-7"] }])).toBeNull();
  expect([...(publishedOf([row("sandbox-7"), row("maiacity-v1")]) ?? [])].sort()).toEqual(["maiacity-v1", "sandbox-7"]);
});

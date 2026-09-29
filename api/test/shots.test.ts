// World shots as data (game/film/camera.js, game/film/shot.js, api/src/shots.ts) and the timeline's data model
// (world clips, clip grades and framing, stages) against real Postgres semantics (PGlite).
import { beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { createShot, getShot, listShots, saveShot, shotVersions } from "../src/shots";
import { createTimeline, getTimeline, saveTimeline } from "../src/timelines";
import { checkCamera, keysFromFlight, look, pathOf } from "../../game/film/camera.js";
import { evaluate, fingerprint, fovFor, fromLegacy, legacyLook, legacyStops, normalize, sha256, shutterTimes, stable } from "../../game/film/shot.js";
// the shot lists' own camera functions, now built on camera.js
import { fly, move, orbit, turn, whip, landing, ease } from "../../scripts/film/camera.mjs";

const pg = new PGlite();
beforeAll(async () => {
  for (const m of MIGRATIONS) await pg.exec(m.sql);
  const wrap = (q: { query: PGlite["query"] }) => ({
    query: async (text: string, params: unknown[] = []) => {
      const r = await q.query<any>(text, params as any[]);
      return { rows: r.rows, affectedRows: r.affectedRows ?? 0 };
    },
  });
  const db: Db = { ...wrap(pg), exec: async (t) => void (await pg.exec(t)), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx as any))) };
  useDb(db);
  await pg.query("INSERT INTO founders (id, name, role) VALUES ('admin', 'Admin', 'admin')");
});

const CID = "bafkreigetwdcbas777qekxb5kogpulriyurk4km6xxxwz2fiuxhkbinpea";
const SFX = "bafybeiery7dtnfprkwgtxxpagsm54oxsbsahktiyf3frcjjwd4sq7b6hoi";
const spec = (over: Record<string, unknown> = {}) => ({
  world: { stand: [150, 20], clock: 12 },
  seconds: 4,
  camera: { kind: "move", from: [78, 26, -30], to: [90, 27, -30], aimFrom: [400, 24, -34], aimTo: [400, 25, -34] },
  lens: { fov: 52 },
  time: { hour: 5.05, hourTo: 5.4 },
  ...over,
});

describe("the camera as data", () => {
  test("every camera.mjs move carries its record, and the record gives the same poses", () => {
    const paths = [
      move([1, 2, 3], [4, 5, 6], [0, 0, 0], [1, 1, 1]),
      move([1, 2, 3], [4, 5, 6], [0, 0, 0], [1, 1, 1], landing),
      orbit([0, 0], 0.1, 0.6, 330, 290, 26, 150, [0, 8, 0], ease),
      turn([0, 3, 20], -0.1, 0.1, 1.0, 1.1),
      fly([[[-205, 1.4, 36], [-196, 1.9, 44]], [[-209, 8, 38], [-160, 13, 26]], [[-232, 32, 32], [-70, 16, 6]]]),
      whip(move([36, 18, 152], [74, 11, 116], [90, 2, 100], [104, 1, 88]), { into: 0.9, d: 0.08 }),
    ] as any[];
    for (const p of paths) {
      expect(p.spec).toBeDefined();
      const again = pathOf(JSON.parse(JSON.stringify(p.spec)));
      for (let k = 0; k <= 20; k++) expect(again(k / 20)).toEqual(p(k / 20));
    }
    expect((paths[1] as any).spec.curve).toBe("landing");
    expect((paths[0] as any).spec.curve).toBeUndefined(); // glide is the default
  });

  test("a curve of the shot list's own still moves the camera, but is not data", () => {
    const p = move([0, 0, 0], [10, 0, 0], [0, 0, -1], [10, 0, -1], (t: number) => t * t) as any;
    expect(p.spec).toBeUndefined();
    expect(p(0.5)[0]).toBeCloseTo(2.5);
  });

  test("keyframes: through every key, yaw the short way round, fov keyed too", () => {
    const cam = checkCamera({ kind: "keys", keys: [
      { t: 0, position: [0, 1, 0], yaw: 3.0, pitch: 0, fov: 40 },
      { t: 1, position: [1, 1, 0], yaw: -3.0, pitch: 0.1, fov: 50 },
      { t: 2, position: [2, 1, 0], aim: [2, 1, -10] },
    ] });
    const path = pathOf(cam, 2);
    expect(path(0)).toEqual([0, 1, 0, 3, 0]);
    expect(path(0.5)[0]).toBeCloseTo(1);
    expect(path(0.5)[3]).toBeCloseTo(-3 + 2 * Math.PI); // 3.28: past π, not back through 0
    const s = normalize(spec({ camera: cam, seconds: 2 }));
    expect(evaluate(s, 1, "1:1").fov).toBeCloseTo(50);
    expect(evaluate(s, 0, "1:1").fov).toBeCloseTo(40);
  });

  test("a recorded flight is thinned to the keys that matter", () => {
    const samples = Array.from({ length: 61 }, (_, i) => ({ t: i / 30, pose: [i / 10, 1.6, 0, 0, 0] as [number, number, number, number, number] }));
    const keys = keysFromFlight(samples);
    expect(keys.length).toBe(2); // a straight line at an even speed needs only its ends
    expect(keys[1]!.position[0]).toBeCloseTo(6);
    const turning = samples.map((s, i) => ({ ...s, pose: [Math.sin(i / 10) * 5, 1.6, Math.cos(i / 10) * 5, 0, 0] as [number, number, number, number, number] }));
    expect(keysFromFlight(turning).length).toBeGreaterThan(4);
  });

  test("bad cameras are refused with a reason", () => {
    expect(() => checkCamera({ kind: "move", from: [0, 0], to: [1, 1, 1], aimFrom: [0, 0, 0], aimTo: [0, 0, 0] })).toThrow("from must be 3 numbers");
    expect(() => checkCamera({ kind: "spin" })).toThrow("unknown kind");
    expect(() => checkCamera({ kind: "turn", at: [0, 0, 0], yaw0: 0, yaw1: 1, pitch0: 0, pitch1: NaN })).toThrow("pitch1");
    expect(() => checkCamera({ kind: "move", from: [0, 0, 0], to: [1, 1, 1], aimFrom: [0, 0, 0], aimTo: [0, 0, 0], curve: "wobble" })).toThrow("curve");
  });
});

describe("the shot record", () => {
  test("normalize fills the defaults and keeps only what it knows", () => {
    const s = normalize({ ...spec(), junk: 1 });
    expect(s.world).toEqual({ sandbox: "sandbox-4", build: null, seed: 1, stand: [150, 20], clock: 12 });
    expect(s.fps).toBe(30);
    expect(s.aspect).toBe("1:1");
    expect(s.exposure).toEqual({ meter: "lock", stops: 0 });
    expect(s.shutter).toEqual({ angle: 180, samples: 1 });
    expect((s as any).junk).toBeUndefined();
    expect(normalize(s)).toEqual(s); // idempotent
  });

  test("normalize refuses what cannot be rendered", () => {
    expect(() => normalize(spec({ world: { clock: 0 } }))).toThrow("world.stand");
    expect(() => normalize(spec({ seconds: 0 }))).toThrow("seconds");
    expect(() => normalize(spec({ lens: { fov: 400 } }))).toThrow("lens.fov");
    expect(() => normalize(spec({ exposure: { meter: "fixed" } }))).toThrow("fixed exposure");
    expect(() => normalize(spec({ lights: [{ id: "moon" }] }))).toThrow("lights[0].id");
    expect(() => normalize(spec({ cues: [{ at: 0, kind: "sound", cid: "x" }] }))).toThrow("CID");
    expect(() => normalize(spec({ framing: { "3:2": {} } }))).toThrow("framing");
    expect(() => normalize(spec({ world: { stand: [0, 0], build: { commit: "nope", hash: "x" } } }))).toThrow("world.build");
    expect(() => normalize(spec({ world: { stand: [0, 0], props: "castle" } }))).toThrow("world.props");
    expect(() => normalize(spec({ look: "sepia" }))).toThrow("look");
  });

  test("evaluate: pose, lens, hour, exposure, lights and cues at a time, per shape", () => {
    const s = normalize(spec({
      exposure: { meter: "ramp", stops: [[0, -1], [4, 1]] },
      lights: [{ id: "glow", intensity: [[0, 0], [2, 4]], color: "#FFCC88" }],
      cues: [{ at: 1, kind: "sound", cid: SFX, level: 0.3 }, { at: 3, kind: "event", name: "door-opens" }],
      framing: { "9:16": { yaw: 0.1, fov: 70 } },
    }));
    const a = evaluate(s, 2, "1:1");
    expect(a.progress).toBe(0.5);
    expect(a.hour).toBeCloseTo(5.225);
    expect(a.stops).toBeCloseTo(0);
    expect(a.lights).toEqual([{ id: "glow", intensity: 4, color: "#ffcc88" }]);
    expect(a.cues.map((c) => c.at)).toEqual([1]);
    expect(a.clock).toBe(14);
    expect(a.pose).toEqual(pathOf(s.camera)(0.5));
    expect(a.fov).toBe(52);
    const v = evaluate(s, 2, "9:16");
    expect(v.pose[3]).toBeCloseTo(a.pose[3] + 0.1);
    expect(v.fov).toBe(70);
    // no framing of its own: 16:9 keeps the height, 4:5 keeps the width of the square it was composed in
    expect(evaluate(s, 2, "16:9").fov).toBe(52);
    expect(evaluate(s, 2, "4:5").fov).toBeCloseTo(fovFor(52, "1:1", "4:5"));
    expect(fovFor(52, "1:1", "4:5")).toBeGreaterThan(52);
    // past the end it holds the last frame
    expect(evaluate(s, 9).progress).toBe(1);
  });

  test("the shutter samples a frame's open time", () => {
    const s = normalize(spec({ shutter: { angle: 180, samples: 4 } }));
    const t = shutterTimes(s, 1);
    expect(t.length).toBe(4);
    expect(t[0]).toBe(1);
    expect(t[3]! - t[0]!).toBeCloseTo((0.5 / 30) * 0.75);
    expect(shutterTimes(normalize(spec()), 1)).toEqual([1]);
  });

  test("a fingerprint is stable, and only the picture changes it", () => {
    const a = normalize(spec());
    const b = normalize(JSON.parse(stable(a)));
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint(a, { shape: "1:1", width: 320 })).not.toBe(fingerprint(a, { shape: "1:1", width: 640 }));
    expect(fingerprint(normalize(spec({ look: "night", meta: { note: "x" }, cues: [{ at: 0, kind: "sound", cid: SFX }] })))).toBe(fingerprint(a));
    expect(fingerprint(normalize(spec({ lens: { fov: 53 } })))).not.toBe(fingerprint(a));
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("a legacy shot becomes a spec: camera, world, shutter, stops, look and sound", () => {
    const path = whip(move([36, 18, 152], [74, 11, 116], [90, 2, 100], [104, 1, 88]), { into: 0.9 });
    const legacy = { name: "the-food-forest", mood: "bright", extra: "eq=saturation=1.14", size: "WS", hour: 15, fov: 44, stand: [70, 120], dome: 2, blur: 6,
      sfx: [[`${SFX}.mp3`, 0.08]], exposure: 1.4, path, start: 60.5, seconds: 3.2 };
    const s = fromLegacy(legacy);
    expect(s.camera).toEqual((path as any).spec);
    expect(s.world).toMatchObject({ stand: [70, 120], dome: 2, clock: 60.5 });
    expect(s.seconds).toBe(3.2);
    expect(s.shutter).toEqual({ angle: 360, samples: 6 });
    expect(s.exposure).toEqual({ meter: "lock", stops: legacyStops(legacy) });
    expect(s.look).toBe("bright");
    expect(s.cues).toEqual([{ at: 0, kind: "sound", cid: SFX, level: 0.08 }]);
    expect(s.meta).toMatchObject({ name: "the-food-forest", size: "WS", legacyExposure: 1.4 });
    // a time-lapse is metered as it goes; without the list's own timing the caller gives it
    const lapse = fromLegacy({ name: "sun", hour: 5.05, hourTo: 5.4, stand: [0, 0], path: move([0, 1, 0], [1, 1, 0], [0, 1, -1], [1, 1, -1]) }, { seconds: 4, clock: 7 });
    expect(lapse.exposure.meter).toBe("ramp");
    expect(lapse.world.clock).toBe(7);
    expect(() => fromLegacy({ name: "x", hour: 1, stand: [0, 0], path: () => [0, 0, 0, 0, 0] }, { seconds: 1 })).toThrow("not data");
    expect(legacyLook({ grade: "eq=saturation=1.08,colorbalance=bs=0.06:bm=0.03" })).toBe("night");
    expect(legacyStops({ hour: 21 })).toBeLessThan(-1); // night deliberately under
    expect(legacyStops({ hour: 12 })).toBe(0);
  });

  test("look() aims the camera", () => {
    const p = look([0, 0, 0], [0, 0, -10]);
    expect(p[3]).toBeCloseTo(0);
    expect(p[4]).toBeCloseTo(0);
  });
});

describe("/api/shots", () => {
  test("a shot is created at version 1 and read back", async () => {
    const s = await createShot("admin", { name: "the sun rises", project: "Day 19", spec: spec() });
    expect(s.version).toBe(1);
    expect(s.spec.world.sandbox).toBe("sandbox-4");
    expect((await getShot(s.id)).name).toBe("the sun rises");
    expect((await listShots({ project: "Day 19" })).map((x) => x.id)).toContain(s.id);
    expect(await listShots({ project: "Day 20" })).toEqual([]);
  });

  test("saving a changed spec is a new version; the old one is kept; the same spec is not", async () => {
    const s = await createShot("admin", { name: "glass", project: "Day 19", spec: spec() });
    const same = await saveShot(s.id, "admin", { spec: spec(), name: "the glass glows" });
    expect(same.version).toBe(1);
    expect(same.name).toBe("the glass glows");
    const v2 = await saveShot(s.id, "admin", { spec: spec({ lens: { fov: 40 } }) });
    expect(v2.version).toBe(2);
    expect(v2.spec.lens.fov).toBe(40);
    const old = await getShot(s.id, 1);
    expect(old.version).toBe(1);
    expect(old.spec.lens.fov).toBe(52);
    expect((await shotVersions(s.id)).map((v) => v.version)).toEqual([1, 2]);
    await expect(getShot(s.id, 7)).rejects.toThrow("no version 7");
  });

  test("a bad shot is refused with the reason", async () => {
    await expect(createShot("admin", { name: "x", spec: spec({ seconds: -1 }) })).rejects.toThrow("seconds");
    await expect(createShot("admin", { name: " ", spec: spec() })).rejects.toThrow("name");
    await expect(getShot("not-a-uuid")).rejects.toThrow("No such shot");
  });
});

describe("timelines: world clips, grades, framing and stages", () => {
  const media = { id: "a", cid: CID, track: "V1", start: 0, in: 0, dur: 2, vol: 0 };

  test("an existing timeline stays exactly as it was", async () => {
    const legacy = [media, { id: "b", cid: CID, track: "A1", start: 0, in: 0.5, dur: 3, vol: 0.8, fin: 0.2 }];
    const t = await createTimeline("admin", { name: "Day 18", aspect: "1:1", clips: legacy });
    expect(t.clips).toEqual(legacy);
    expect(t.stage).toBe("edit");
    expect(t.version).toBe(1);
    expect(t.color).toEqual({ working: "acescct", output: "odt-rec709" });
    expect(t.grade).toBeNull();
  });

  test("a world clip names a shot version that exists, on V1, with no CID", async () => {
    const s = await createShot("admin", { name: "flight", spec: spec() });
    const world = { id: "w", kind: "world", shot: s.id, shotVersion: 1, track: "V1", start: 2, in: 0.5, dur: 3, vol: 0 };
    const t = await createTimeline("admin", { name: "World", clips: [media, world] });
    expect(t.clips[1]).toEqual(world);
    expect(t.clips[0]!.kind).toBeUndefined();
    await expect(createTimeline("admin", { name: "x", clips: [{ ...world, shotVersion: 2 }] })).rejects.toThrow("No such shot");
    await expect(createTimeline("admin", { name: "x", clips: [{ ...world, track: "A1" }] })).rejects.toThrow("V1");
    await expect(createTimeline("admin", { name: "x", clips: [{ ...world, cid: CID }] })).rejects.toThrow("no CID");
    await expect(createTimeline("admin", { name: "x", clips: [{ ...world, shotVersion: 0 }] })).rejects.toThrow("version");
    await expect(createTimeline("admin", { name: "x", clips: [{ ...media, cid: undefined }] })).rejects.toThrow("CID");
    await expect(createTimeline("admin", { name: "x", clips: [{ ...media, kind: "hologram" }] })).rejects.toThrow("media clip or a world clip");
  });

  test("a clip's grade is a clean CDL; a neutral one is dropped; framing is per shape", async () => {
    const t = await createTimeline("admin", { name: "Graded", clips: [
      { ...media, grade: { slope: [1.1, "x", 9], offset: [0, 0, 0], power: [1, 1, 1], sat: 0.8 }, frame: { "9:16": { x: -2, y: 0.3, zoom: 1.5 } } },
      { ...media, id: "n", grade: { slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1], sat: 1 } },
    ] });
    expect(t.clips[0]!.grade).toEqual({ slope: [1.1, 1, 4], offset: [0, 0, 0], power: [1, 1, 1], sat: 0.8 });
    expect(t.clips[0]!.frame).toEqual({ "9:16": { x: -1, y: 0.3, zoom: 1.5 } });
    expect(t.clips[1]!.grade).toBeUndefined();
    await expect(createTimeline("admin", { name: "x", clips: [{ ...media, frame: { "3:2": {} } }] })).rejects.toThrow("per shape");
  });

  test("stages: locked fixes the cut but not the grade; unlocking makes a new version", async () => {
    const t = await createTimeline("admin", { name: "Lock", clips: [media] });
    const locked = await saveTimeline(t.id, { stage: "locked" });
    expect(locked.stage).toBe("locked");
    expect(locked.version).toBe(1);
    // the grade may change on a locked edit
    const graded = await saveTimeline(t.id, { stage: "graded", clips: [{ ...media, grade: { slope: [1.2, 1, 1] } }], grade: { look: { sat: 0.9 }, preset: "warm" } });
    expect(graded.clips[0]!.grade!.slope).toEqual([1.2, 1, 1]);
    expect(graded.grade).toEqual({ look: { slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1], sat: 0.9 }, preset: "warm" });
    // the cut may not
    await expect(saveTimeline(t.id, { clips: [{ ...media, dur: 5 }] })).rejects.toThrow("locked");
    const open = await saveTimeline(t.id, { stage: "edit" });
    expect(open.version).toBe(2);
    expect((await saveTimeline(t.id, { clips: [{ ...media, dur: 5 }] })).clips[0]!.dur).toBe(5);
    expect((await getTimeline(t.id)).version).toBe(2);
    await expect(saveTimeline(t.id, { stage: "done" })).rejects.toThrow("stage");
    await expect(saveTimeline(t.id, { color: { working: "rec709" } })).rejects.toThrow("ACEScct");
    await expect(saveTimeline(t.id, { grade: { preset: "sepia" } })).rejects.toThrow("preset");
    expect((await saveTimeline(t.id, { grade: null })).grade).toBeNull();
  });
});

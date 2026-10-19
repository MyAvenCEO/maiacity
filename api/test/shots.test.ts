// World shots as data (game/film/camera.js, game/film/shot.js): the camera, the shot record, and a legacy shot made
// into a spec.
import { describe, expect, test } from "bun:test";
import { checkCamera, keysFromFlight, look, pathOf } from "../../game/film/camera.js";
import { evaluate, fingerprint, fovFor, fromLegacy, legacyLook, legacyStops, normalize, sha256, shutterTimes, stable } from "../../game/film/shot.js";
import { filmPath, worldOfPath } from "../../game/film/worlds.js";
// the shot lists' own camera functions, now built on camera.js
import { fly, move, orbit, turn, whip, landing, ease } from "../../scripts/film/camera.mjs";

const SFX = "42fb04168483c9f7a6cfdbc549acdd610492593d28d78d87ea0d30ace559aa2b";
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

  test("a shot names its world: any sandbox, and where in it", () => {
    const at = (world: Record<string, unknown>) => normalize(spec({ world: { stand: [0, 0], ...world } })).world;
    // a sandbox with areas always names one, its first by default; Sandbox 4 is one place, and stays as it was
    expect(at({ sandbox: "sandbox-3" })).toEqual({ sandbox: "sandbox-3", area: "home", build: null, seed: 1, stand: [0, 0], clock: 0 });
    expect(at({ sandbox: "sandbox-2", seed: 812 })).toEqual({ sandbox: "sandbox-2", area: "planet", build: null, seed: 812, stand: [0, 0], clock: 0 });
    expect(() => at({ sandbox: "sandbox-2", area: "island" })).toThrow("world.area");
    expect(at({ sandbox: "sandbox-1" }).area).toBe("island");
    expect(at({}).sandbox).toBe("sandbox-4");
    expect("area" in at({ sandbox: "sandbox-4", dome: 3 })).toBe(false);
    expect(() => at({ sandbox: "sandbox-9" })).toThrow("world.sandbox");
    expect(() => at({ sandbox: "sandbox-3", area: "moon" })).toThrow("world.area");
    expect(() => at({ sandbox: "sandbox-4", area: "home" })).toThrow("no areas");
    expect(() => at({ sandbox: "sandbox-3", dome: 2 })).toThrow("world.dome");
    expect(() => at({ sandbox: "sandbox-1", props: "tired-land" })).toThrow("no sets");
    expect(() => at({ dome: 13 })).toThrow("world.dome");
    expect(filmPath(at({ sandbox: "sandbox-3", area: "master" }))).toBe("/games/sandbox-3/?film&area=master");
    expect(filmPath(at({}))).toBe("/games/sandbox-4/?film");
    expect(worldOfPath("/base/games/sandbox-2/?film&area=planet")).toEqual({ sandbox: "sandbox-2", area: "planet" });
  });

  test("normalize refuses what cannot be rendered", () => {
    expect(() => normalize(spec({ world: { clock: 0 } }))).toThrow("world.stand");
    expect(() => normalize(spec({ seconds: 0 }))).toThrow("seconds");
    expect(() => normalize(spec({ lens: { fov: 400 } }))).toThrow("lens.fov");
    expect(() => normalize(spec({ exposure: { meter: "fixed" } }))).toThrow("fixed exposure");
    expect(() => normalize(spec({ lights: [{ id: "moon" }] }))).toThrow("lights[0].id");
    expect(() => normalize(spec({ cues: [{ at: 0, kind: "sound", hash: "x" }] }))).toThrow("by its hash");
    expect(() => normalize(spec({ framing: { "3:2": {} } }))).toThrow("framing");
    expect(() => normalize(spec({ world: { stand: [0, 0], build: { commit: "nope", hash: "x" } } }))).toThrow("world.build");
    expect(() => normalize(spec({ world: { stand: [0, 0], build: { commit: "abcdef1", hash: "abcdefgh", file: "bafkreibuild" } } }))).toThrow("world.build.file");
    expect(() => normalize(spec({ world: { stand: [0, 0], props: "castle" } }))).toThrow("world.props");
    expect(() => normalize(spec({ look: "sepia" }))).toThrow("look");
  });

  test("evaluate: pose, lens, hour, exposure, lights and cues at a time, per shape", () => {
    const s = normalize(spec({
      exposure: { meter: "ramp", stops: [[0, -1], [4, 1]] },
      lights: [{ id: "glow", intensity: [[0, 0], [2, 4]], color: "#FFCC88" }],
      cues: [{ at: 1, kind: "sound", hash: SFX, level: 0.3 }, { at: 3, kind: "event", name: "door-opens" }],
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
    expect(fingerprint(normalize(spec({ look: "night", meta: { note: "x" }, cues: [{ at: 0, kind: "sound", hash: SFX }] })))).toBe(fingerprint(a));
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
    expect(s.cues).toEqual([{ at: 0, kind: "sound", hash: SFX, level: 0.08 }]);
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

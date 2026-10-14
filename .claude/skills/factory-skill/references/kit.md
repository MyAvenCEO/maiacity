# Kit API

All in `FactorySkill.Kit` (`K`), available in the page, not in Node. Units are metres, y is up.

## Materials

`K.paint(color, roughness, metalness)`, `K.metal(color, roughness)`, `K.glass(color, opacity)`,
`K.emit(color, intensity)`, `K.unique(material)` (a private copy you can animate), `K.M()` returns a
set: `body dark black steel alu chrome rubber yellow glass copper red wood card white`.
`K.screenMat(kind, tint)` is an animated HMI screen (`graph`, `bars`, `list`). `K.beltMat()` scrolls.

## Parts

- `K.box(parent, w, h, d, mat, x, yBottom, z, { r, rx, ry, rz })` rounded box sitting on y
- `K.cyl(parent, r, h, mat, x, y, z, { axis: 'y'|'x'|'z', r2, seg })` (axis y sits on y; x/z centred)
- `K.sph(parent, r, mat, x, y, z, { half })`, `K.tor(parent, R, r, mat, x, y, z, { arc, rx, ry, rz })`
- `K.group(parent, x, y, z)`, `K.live(group)` marks a moving group (not merged)
- `K.stackLight(parent, x, y, z)` returns `{ set(state, t) }`
- `K.panel(parent, x, y, z, ry, kind)` control pendant with a screen
- `K.fence(parent, w, d, h, open)`, `K.feet`, `K.crates`, `K.pallet`, `K.bin`, `K.spool`, `K.bolts`
- `K.arm(parent, x, y, z, color, scale)` 6 axis robot, `pose(a0, a1, a2, a3, a4, grip)`
- `K.person(parent, { seed, suit, vest, hat, suitOnly, mask })`, `pose('walk'|'work'|'stand'|'carry', t)`
- `K.forklift`, `K.amr`, `K.truck`, `K.car`, `K.tree`, `K.rack`, `K.conveyor(parent, points, { y, w })`
- `K.freeze(group)` merges every static mesh per material (call it last; `K.finish` does)

## Machines

`K.def(name, (o) => machine)` registers a builder; `o` carries `color`, `accent`, `variant`,
`batch` (batch x perMachine, the number of units the machine holds), `length`, `seed` and the look
fields of the station. A machine is

```js
{
  g,                 // THREE.Group, machine origin on the floor
  kind: 'side',      // or 'inline'
  w, d, h,           // footprint and height, metres
  entry: K.V(...),   // where units hop in (side: on the loading face, local -z)
  exit: K.V(...),    // inline only: where units leave (+x end)
  work(i, p) {},     // local position of unit i at progress p (0..1)
  anim(s) {},        // s = { state: 'busy'|'idle'|'blocked'|'down'|'off', p, t, dt, busy, k, n }
}
```

Return it through `K.finish(machine, o, stackLightPosition | null)`, which adds the stack light and
merges the static parts. `K.sideBase(o, w, d)` gives `{ g, M, body, acc }` to start from.
`K.build(name, o)` builds any registered machine or alias; unknown names get `cell`.

## Products

`K.product({ shape, color, scale, ... })` returns a merged geometry with vertex colours. Shapes are
listed in SKILL.md. Tokens are drawn with one `InstancedMesh` per stage, so thousands are cheap.

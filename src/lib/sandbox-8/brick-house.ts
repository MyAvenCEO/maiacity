import { piecesOf, transform, type Box, type Scenario, type V3 } from './simulation';
import { shedScenario, ROOF_PITCH, type BuildPart, type BuildDefinition } from './shed';

const xyz = (x: number, y: number, z: number): V3 => ({ x, y, z });
export const BRICK_NOTE = 'Individual large-format clay bricks and visible mortar, laid in alternating courses. Door and window lintels bear on their jambs. Steel straps anchor the timber roof plates. Roof falls 5° to the back under continuous felt. Roof grips and felt bonds can fail under load; red dots mark failed points. Capacities are experimental. Mortar and masonry anchors remain ideal; no timber fracture geometry, rain or leakage simulation.';
export function brickHouseScenario(): Scenario {
  return { ...shedScenario(), id: 'brick-house', title: '11 / Build a brick house', question: 'Foundation → bonded brick courses → supported lintels → timber roof → roofing felt.' };
}

/** Positive surface area shared by axis-aligned, non-overlapping actual pieces. */
export function sharedFaceArea(a: Box, b: Box): number {
  let area = 0;
  for (const pa of piecesOf(a)) for (const pb of piecesOf(b)) {
    const overlap = (['x', 'y', 'z'] as const).map((axis, i) => {
      const ca = a.position[axis] + pa.offset[axis], cb = b.position[axis] + pb.offset[axis];
      return Math.min(ca + pa.size[i] / 2, cb + pb.size[i] / 2) - Math.max(ca - pa.size[i] / 2, cb - pb.size[i] / 2);
    });
    if (overlap.some(n => n < -1e-7) || overlap.every(n => n > 1e-7)) continue;
    const [x, y, z] = overlap.map(n => n < 1e-7 ? 0 : n);
    area += x * y + y * z + x * z;
  }
  return area;
}

export function brickHouseDefinition(): BuildDefinition {
  const plan: BuildPart[] = [], stages: string[] = [];
  let stage = -1;
  const nextStage = (name: string) => { stages.push(name); stage++; };
  const add = (id: string, size: Box['size'], position: V3, material: string, density: number, color: number,
    connectTo: string[] = [], fastening?: BuildPart['fastening']) => {
    const entry: BuildPart = { stage, connectTo, fastening, structural: true, box: { id, size, position, material, density, color, friction: .65 } };
    plan.push(entry); return entry;
  };
  // Contact discovery happens once while authoring this recipe, never in the
  // running simulation. Dry touching pieces are not automatically bonded.
  const mortarTargets = (box: Box) => plan.filter(p => p.box !== box && sharedFaceArea(box, p.box) > 1e-7).map(p => p.box.id);
  const concrete = (id: string, size: Box['size'], position: V3, targets: string[] = []) =>
    add(id, size, position, 'Concrete (rigid)', 2400, 0x96998d, targets, 'mortar-bond');
  nextStage('Foundation');
  concrete('foundation', [2.7, .2, 2.7], xyz(0, .1, 0));

  const lintel = (name: string, y: number, z: number) => {
    nextStage(`${name === 'door' ? 'Door' : 'Window'} lintel`);
    const beds = [-.5, .5].map((x, i) => {
      const bed = add(`${name}-lintel-bed-${i + 1}`, [.2, .01, .2], xyz(x, y + .005, z), 'Mortar (instantly cured)', 2000, 0xb9b4a1, [], 'mortar-bond');
      bed.connectTo = mortarTargets(bed.box); return bed.box.id;
    });
    concrete(`${name}-lintel`, [1.2, .19, .2], xyz(0, y + .105, z), beds);
  };
  for (let row = 0; row < 11; row++) {
    const bottom = .2 + row * .2;
    if (row === 8) lintel('window', bottom, -1.1);
    if (row === 10) lintel('door', bottom, 1.1);
    nextStage(`Course ${row + 1}`);
    for (const wall of ['left', 'back', 'right', 'front'] as const) {
      const alongX = wall === 'front' || wall === 'back';
      // Alternating which wall owns the corner shifts the bond by half a brick.
      const fullLength = alongX === (row % 2 === 1);
      const lo = fullLength ? -1.2 : -1, hi = -lo;
      const opening = wall === 'front' ? (row < 10 ? .4 : .6)
        : wall === 'back' ? (row >= 4 && row < 8 ? .4 : row === 8 ? .6 : 0) : 0;
      const besideLintel = (wall === 'front' && row === 10) || (wall === 'back' && row === 8);
      const cuts = [lo, hi];
      for (let v = lo + .4; v < hi - 1e-6; v += .4) cuts.push(v);
      if (opening) cuts.push(-opening, opening);
      const points = [...new Set(cuts.map(n => Math.round(n * 1e6) / 1e6))].sort((a, b) => a - b);
      let number = 0;
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1], center = (a + b) / 2, length = b - a;
        if (opening && Math.abs(center) < opening - 1e-6) continue;
        const id = `${wall}-course-${row + 1}-brick-${++number}`;
        // Exposed jambs and outside corner ends are bare clay, not mortar caps.
        const capLo = (a > lo + 1e-6 || !fullLength) && (!opening || besideLintel || Math.abs(a - opening) > 1e-6);
        const capHi = (b < hi - 1e-6 || !fullLength) && (!opening || besideLintel || Math.abs(b + opening) > 1e-6);
        const headEnds = [...(capLo ? [-1] : []), ...(capHi ? [1] : [])];
        const position = alongX ? xyz(center, bottom + .1, wall === 'front' ? 1.1 : -1.1)
          : xyz(wall === 'right' ? 1.1 : -1.1, bottom + .1, center);
        const dimensions = (l: number, h: number): Box['size'] => alongX ? [l, h, .2] : [.2, h, l];
        const bed = add(`${id}-mortar`, dimensions(length, .2), position, 'Mortar (instantly cured)', 2000, 0xb9b4a1, [], 'mortar-bond');
        // A supplied batch: 10 mm bed plus 5 mm head-joint halves where needed.
        // Pieces are disjoint; mass, rendering and collision use this same shape.
        bed.box.pieces = [
          { size: dimensions(length, .01), offset: xyz(0, -.095, 0) },
          ...headEnds.map(sign => ({ size: dimensions(.005, .19), offset: alongX
            ? xyz(sign * (length / 2 - .0025), .005, 0) : xyz(0, .005, sign * (length / 2 - .0025)) })),
        ];
        bed.connectTo = mortarTargets(bed.box);
        const brickPosition = { ...position, y: bottom + .105 };
        brickPosition[alongX ? 'x' : 'z'] += ((capLo ? 1 : 0) - (capHi ? 1 : 0)) * .0025;
        add(id, dimensions(length - headEnds.length * .005, .19), brickPosition, 'Clay brick (rigid, large format)', 1800,
          [0xa7563c, 0xb56243, 0xad593b, 0x9e5037][(row + number) % 4], [bed.box.id], 'mortar-bond');
      }
    }
  }
  nextStage('Roof plates & straps');
  const wood = (id: string, size: Box['size'], position: V3, targets: string[] = []) => add(id, size, position, 'Wood (rigid)', 600, 0xb58c58, targets);
  for (const [side, x] of [['left', -1.1], ['right', 1.1]] as const) {
    // Bearing on masonry first, then explicitly anchor with visible steel straps.
    wood(`plate-${side}`, [.2, .15, 2.4], xyz(x, 2.475, 0));
    for (const z of [-1, 1]) {
      const strap = add(`roof-strap-${side}-${z < 0 ? 'back' : 'front'}`, [.006, .3, .1], xyz(Math.sign(x) * 1.203, 2.4, z),
        'Steel anchor strap (rigid)', 7850, 0x78949f, [], 'masonry-anchor');
      strap.connectTo = plan.filter(p => p.box !== strap.box && (p.box.material.startsWith('Clay') || p.box.id === `plate-${side}`)
        && sharedFaceArea(strap.box, p.box) > 1e-7).map(p => p.box.id);
    }
  }
  for (const [end, z] of [['back', -1.1], ['front', 1.1]] as const)
    wood(`plate-${end}`, [2, .15, .2], xyz(0, 2.475, z), ['plate-left', 'plate-right']);
  for (const [i, z] of [-.55, 0, .55].entries()) wood(`house-roof-joist-${i + 1}`, [2, .15, .1], xyz(0, 2.475, z), ['plate-left', 'plate-right']);
  const roofBeams = plan.filter(p => p.stage === stage && p.box.material.startsWith('Wood')).map(p => p.box);
  nextStage('Roof supports');
  const underside = (z: number) => 2.57 + (z + 1.2) * Math.tan(ROOF_PITCH);
  for (const beam of roofBeams) {
    const [width, , depth] = beam.size, { x, z } = beam.position;
    const backHeight = underside(z - depth / 2) - 2.55, frontHeight = underside(z + depth / 2) - 2.55;
    wood(`house-firring-${beam.id}`, [width > 1 ? width - .02 : width, frontHeight, depth], xyz(x, 2.55 + frontHeight / 2, z), [beam.id]).box.taper = { backHeight, frontHeight };
  }
  nextStage('Roof boards');
  const rotation = { x: -Math.sin(ROOF_PITCH / 2), y: 0, z: 0, w: Math.cos(ROOF_PITCH / 2) };
  for (let i = 0; i < 10; i++) {
    const board = wood(`house-roof-board-${i + 1}`, [2.7, .04, .266], transform(xyz(0, .02, -1.215 + .27 * i), rotation, xyz(0, underside(0), 0)),
      ['house-firring-plate-left', 'house-firring-plate-right']);
    board.box.rotation = rotation; board.structural = false;
  }
  nextStage('Roofing felt');
  const felt = add('house-roofing-felt', [2.7, .004, 2.696], transform(xyz(0, .042, 0), rotation, xyz(0, underside(0), 0)),
    'Roofing felt (rigid sheet approximation)', 1000, 0x353b3b, Array.from({ length: 10 }, (_, i) => `house-roof-board-${i + 1}`), 'felt-bond');
  Object.assign(felt.box, { rotation, waterBarrier: true }); felt.structural = false;
  // Thin, light mortar beds need stiffer contacts than the default when a heavy
  // lintel is released onto them. These values are validated by the bearing test.
  return { plan, stages, rootId: 'foundation', interval: .08, filterRigidInternalContacts: true, contactNaturalFrequency: 120, allowedLinearError: .0001, name: 'Brick house', note: BRICK_NOTE };
}

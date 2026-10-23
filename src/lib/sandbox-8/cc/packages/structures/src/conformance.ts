/**
 * What every structural model must hold (decisions 0015, 0026), for every kind of structure: a calm
 * day is no danger to anything standing, more wind is never less load, a taller wall of the same
 * bricks is never safer, a building is answered for as it is built, a building founded as planned
 * does not settle, and every answer is explained and carries its provenance.
 */
import { check, Runtime, type ConformanceSuite, type EntityId } from '../../kernel/src/index.ts';

export interface StructuralSubject {
  /** a world with a tent, a free-standing wall (and a taller one of the same make) and a house founded as planned */
  world: () => { rt: Runtime; tent: EntityId; wall: EntityId; tallWall: EntityId; house: EntityId };
}

export const structuralConformance: ConformanceSuite<StructuralSubject> = {
  contract: 'structural',
  cases: [
    {
      name: 'a calm day: everything stands, explained, with its provenance',
      run(subject) {
        const { rt, tent, wall, house } = subject.world();
        for (const id of [tent, wall, house]) {
          const a = rt.read.port('structural').assess(id, { wind: 1 });
          check(Number.isFinite(a.utilisation) && a.utilisation >= 0 && a.utilisation < 0.5, `${id}: utilisation ${a.utilisation} in a breeze`);
          check(Boolean(a.provenance.source) && Boolean(a.explain), `${id}: no explanation or provenance`);
        }
      },
    },
    {
      name: 'more wind is never less load, and a storm brings a dry wall down',
      run(subject) {
        const { rt, tent, wall, house } = subject.world();
        const st = rt.read.port('structural');
        for (const id of [tent, wall, house]) {
          let last = 0;
          for (const wind of [0, 2, 5, 10, 20, 30]) {
            const u = st.assess(id, { wind }).utilisation;
            check(u >= last, `${id}: utilisation ${u} at ${wind} m/s below ${last}`);
            last = u;
          }
        }
        check(st.assess(wall, { wind: 25 }).utilisation >= 1, 'a dry-stacked wall stands a hurricane');
      },
    },
    {
      name: 'a taller wall of the same make is never safer',
      run(subject) {
        const { rt, wall, tallWall } = subject.world();
        const st = rt.read.port('structural');
        for (const wind of [3, 8, 15]) check(st.assess(tallWall, { wind }).utilisation >= st.assess(wall, { wind }).utilisation, `at ${wind} m/s the taller wall is safer`);
      },
    },
    {
      name: 'a building is answered for as it is built: nothing built bears nothing, walls going up stand less than the house finished',
      run(subject) {
        const { rt, house } = subject.world();
        const st = rt.read.port('structural');
        const plan = rt.read.require('Structure', house).plan;
        const none = Object.fromEntries(plan.elements.map((e) => [e.id, 0]));
        check(st.assess(house, { wind: 20 }, none).utilisation === 0, 'nothing built carries a load');
        const ub = plan.physics.bearing?.unbraced;
        if (!ub) return;
        const all = Object.fromEntries(plan.elements.map((e) => [e.id, 1]));
        // a quarter of the first storey laid, and nine tenths of it
        const floors = Math.max(1, plan.physics.bearing!.floors);
        const rising = { ...none, [plan.physics.bearing!.foundation]: 1, [ub.walls]: 0.25 / floors };
        const nearly = { ...rising, [ub.walls]: 0.9 / floors };
        const u = (b: Record<string, number>, wind: number) => st.assess(house, { wind }, b).utilisation;
        // the wind tells on walls standing alone far more than on the house finished
        check(u(nearly, 20) - u(nearly, 8) > u(all, 20) - u(all, 8), 'walls going up feel the wind no more than the house finished');
        for (const wind of [8, 15, 20]) check(u(nearly, wind) > u(rising, wind), `at ${wind} m/s a storey nearly laid stands better than a quarter of one`);
      },
    },
    {
      name: 'a building founded as planned does not settle, and says why',
      run(subject) {
        const { rt, house } = subject.world();
        const a = rt.read.port('structural').assess(house, { wind: 3 });
        check(a.settlement !== undefined, 'a building without a settlement reckoning');
        check(a.settlement!.utilisation >= 0 && a.settlement!.utilisation < 1, `settlement utilisation ${a.settlement!.utilisation} on its foundation`);
        check(Boolean(a.settlement!.explain.label), 'settlement not explained');
      },
    },
  ],
};

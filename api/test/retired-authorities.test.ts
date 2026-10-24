import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { calendar, calendarLabel, GAME_DAY_MS, gameAgo, gameClock, gameHour, SPEED } from '../../game/time';
import api from '../package.json';

const root = new URL('../../', import.meta.url);

test('retired custodial, content and code-landing entry points stay retired', () => {
  for (const path of [
    'api/src/ledger', 'api/src/content.ts', 'api/src/genui.js',
    'api/scripts/day.ts', 'api/scripts/posts.ts', 'api/scripts/publish.ts',
    '.github/workflows/code-land.yml', 'deploy/code-export.sh',
    'src/routes/app/stories/+page.svelte', 'game/policy.ts', 'game/policy.hearts.json',
  ]) expect(existsSync(new URL(path, root))).toBe(false);
  const routes = readFileSync(new URL('api/src/index.ts', root), 'utf8');
  for (const route of ['/api/hearts/claim', '/api/ledger', '/api/content', '/api/genui']) expect(routes).not.toContain(route);
  for (const dependency of ['@zk-kit/baby-jubjub', 'poseidon-lite', 'viem']) expect(api.dependencies).not.toHaveProperty(dependency);
});

test('retiring ledger arithmetic preserves the worlds calendar and sky clock', () => {
  const epoch = new Date('2026-09-03T00:00:00Z');
  expect(SPEED).toBe(30);
  expect(GAME_DAY_MS).toBe(2_880_000);
  expect(calendar(epoch)).toEqual({ year: 1, month: 1, day: 1, dayIndex: 0 });
  expect(calendar(new Date('2026-09-03T12:00:00Z'))).toEqual({ year: 1, month: 1, day: 16, dayIndex: 0 });
  expect(calendar(new Date('2026-09-15T00:00:00Z'))).toEqual({ year: 2, month: 1, day: 1, dayIndex: 12 });
  expect(calendarLabel(new Date('2026-09-04T00:00:00Z'))).toBe('Y1 · M2');
  expect(gameClock(new Date('2026-09-03T00:02:00Z')).label).toBe('03.09.26 01:00');
  expect(gameHour(new Date('2026-09-03T00:02:00Z'))).toBe(1);
  expect(gameAgo(epoch, new Date(epoch.getTime() + 120_000))).toBe('1 h ago');
  expect(gameClock(new Date('2026-09-02T00:00:00Z')).date).toEqual(epoch);
});

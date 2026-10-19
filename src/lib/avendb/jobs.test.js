// @ts-nocheck — plain JS
// The one shape of a job (./jobs.js): a studio task with the Mac job that runs it, the Mac's own jobs, a sync, and their order.
import { expect, test } from 'bun:test';
import { ordered, studioJobs, syncJob } from './jobs.js';

const task = (entry, status, more = {}) => ({ entry, vault: 'V', rule: 'proxy', version: 1, key: entry, lane: 'gpu', inputs: [{ id: 1, name: 'original', entry: 'f1', at: [] }], params: '{}', status, worker: '', lease_until: 0, attempts: 0, error: '', outputs: [], result: '', by: 'me', at: 100, ...more });
const macJob = (id, subject, state, more = {}) => ({ id, kind: 'proxy', lane: 'gpu', subject, name: 'clip', state, stage: 'encoding', progress: 0.5, priority: 5, queued: '2026-10-19T05:00:00Z', started: null, ended: null, error: null, ...more });
const named = (e) => (e === 'f1' ? 'Clip one' : '');
const on = (d) => (d === 'me' ? 'on this Mac' : `on ${d}`);

test('a task is the truth of where it stands, the Mac job running it only how far it has got', () => {
	const [j] = studioJobs([task('t1', 'claimed', { worker: 'me', lease_until: 1e12 })], [macJob('m1', 'aven:t1', 'running')], [], 1000, named, on);
	expect(j).toMatchObject({ id: 'task:t1', kind: 'proxy', state: 'running', stage: 'encoding', progress: 0.5, name: 'Clip one', vault: 'V' });
	expect(j.task?.entry).toBe('t1');
});

test('a claimed task names the device that runs it; one whose lease ran out waits again', () => {
	const [a, b] = studioJobs([task('t1', 'claimed', { worker: 'mbp', lease_until: 1e12 }), task('t2', 'claimed', { worker: 'mbp', lease_until: 1 })], [], [], 10_000, named, on);
	expect([a.state, a.stage]).toEqual(['running', 'on mbp']);
	expect(b.state).toBe('queued');
});

test('failed and held tasks may be asked again; the Mac’s own jobs become their own rows', () => {
	const jobs = studioJobs([task('t1', 'failed', { attempts: 3, error: 'no GPU' }), task('t2', 'held')], [], [macJob('m2', 'file:abc', 'failed', { kind: 'keep', ended: '2026-10-19T05:01:00Z', error: 'gone' })], 0, named, on);
	expect(jobs.map((j) => [j.id, j.state, j.again])).toEqual([
		['task:t1', 'failed', true],
		['task:t2', 'held', true],
		['mac:m22026-10-19T05:01:00Z', 'failed', true]
	]);
	expect(jobs[2].kind).toBe('mac:keep');
});

test('a sync is a job of the sync lane, its progress from what it moved', () => {
	const j = syncJob({ id: 's1', kind: 'bring', subject: 'r', name: 'a.mov', state: 'running', stage: '', done: 5, total: 10, unit: 'bytes', started: 1, ended: null, error: null }, 'V', (_, n) => `${n} B`);
	expect(j).toMatchObject({ lane: 'sync', progress: 0.5, amount: '5 B of 10 B', state: 'running' });
});

test('what runs comes first, then what waits, oldest first, then what ended, newest first', () => {
	const j = (id, state, queued, ended = null) => ({ id, state, queued, ended });
	expect(ordered([j('a', 'done', 1, 5), j('b', 'queued', 3), j('c', 'running', 9), j('d', 'queued', 2), j('e', 'failed', 1, 8)]).map((x) => x.id)).toEqual(['c', 'd', 'b', 'e', 'a']);
});

test('a task whose record leaves fields out (Maia City’s older tasks) still reads as a job', async () => {
	const { tasksOf } = await import('../studio/jobs/tasks.js');
	const world = { entries: [{ entry: 't9', vault: 'V', type: 'task', tags: [], deleted: false, record: { kind: 'task', rule: 'proxy', version: 1, key: 'k', lane: 'gpu', status: 'done', at: 5 } }] };
	const [t] = tasksOf(world);
	expect([t.outputs, t.inputs, t.error]).toEqual([[], [], '']);
	const [j] = studioJobs([t], [], [], 0, named, on);
	expect([j.state, j.amount, j.name]).toEqual(['done', 'done', 't9']);
});

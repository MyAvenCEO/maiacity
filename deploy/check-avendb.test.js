// @ts-nocheck
import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

function probe(env = {}) {
	const directory = mkdtempSync(join(tmpdir(), 'deploy-probe-'));
	try {
		for (const [name, script] of Object.entries({
			ssh: 'exit "${SSH_STATUS:-0}"',
			curl: 'exit "${CLASSICAL_STATUS:-1}"',
			docker: `
printf '%s\\n' "$*" >> "$CALLS"
case "$*" in
  *healthz*) exit "\${HEALTH_STATUS:-0}" ;;
  *feed/posts*) [ "\${FEED_STATUS:-0}" = 0 ] || exit 1; printf '%20000s' feed ;;
  *relay*) printf '%s' "\${RELAY_CODE:-101}"; exit 28 ;;
  *) exit 99 ;;
esac`
		})) writeFileSync(join(directory, name), `#!/bin/bash\n${script}\n`, { mode: 0o700 });
		const calls = join(directory, 'calls');
		const result = spawnSync('bash', ['deploy/check-avendb.sh'], {
			encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, AVENDB_HOST: 'example.invalid', CALLS: calls, ...env }
		});
		return { ...result, calls: readFileSync(calls, 'utf8') };
	} finally { rmSync(directory, { recursive: true, force: true }); }
}

test('shared probes use PQ TLS and retain the 24KB browser-pass upgrade check', () => {
	const result = probe();
	expect(result.status).toBe(0);
	expect(result.stdout).toContain('101 ←');
	expect(result.stdout.length).toBeLessThan(1000);
	expect(result.calls).toContain('--curves X25519MLKEM768');
	expect(result.calls).toContain('--max-time 15');
	expect(result.calls).toContain(`relay?token=${'A'.repeat(24000)}`);
});

test('a relay that refuses a browser pass fails the deploy check', () => {
	const result = probe({ RELAY_CODE: '431' });
	expect(result.status).toBe(1);
	expect(result.stdout).toContain('answers 431');
});

test('DNS/certificate readiness and feed failures remain warnings', () => {
	const notReady = probe({ HEALTH_STATUS: '1' });
	expect(notReady.status).toBe(0);
	expect(notReady.calls).not.toContain('relay?token');
	const feed = probe({ FEED_STATUS: '1', SSH_STATUS: '1', CLASSICAL_STATUS: '0' });
	expect(feed.status).toBe(0);
	expect(feed.stdout).toContain('still takes a classical');
	expect(feed.stdout).toContain('feed/posts does not answer');
});

test('independent deployments keep shared SSH, container locking and close ownership', () => {
	const load = (name) => parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
	const api = load('api'), avendb = load('avendb'), site = load('deploy');
	expect(new Set([api, avendb, site].map((workflow) => workflow.concurrency.group)).size).toBe(3);
	for (const workflow of [api, avendb]) {
		expect(workflow.jobs.deploy.concurrency).toEqual({ group: 'maia-production-containers', 'cancel-in-progress': false });
		const script = workflow.jobs.deploy.steps.map((step) => step.run ?? '').join('\n');
		expect(script).toContain('bash deploy/check-avendb.sh');
		expect(script).toContain('exec 9>.env.lock; flock -w 300 9');
		expect(script).not.toContain('flock -u');
	}
	for (const job of [api.jobs.deploy, avendb.jobs.deploy, site.jobs.site]) {
		expect(job.steps.some((step) => step.uses === './.github/actions/prod-ssh')).toBe(true);
	}
	const server = avendb.jobs.deploy.steps.map((step) => step.run ?? '').join('\n');
	expect(server).toContain('--lock-fd 9 --wait 300');
	expect(server).toContain('--lock-fd 9 --verify-only');
	expect(server).toContain('up -d --no-deps avendb');
	const apiScript = api.jobs.deploy.steps.map((step) => step.run ?? '').join('\n');
	expect(apiScript).toContain('exit "${BUCKETLESS:-0}"');
	expect(apiScript).toContain('up -d --no-deps db api caddy');
});

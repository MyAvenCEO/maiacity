// Keeps this Mac's checkout on the latest main, so the running studio app (`bunx tauri dev` in vault/app) rebuilds
// whenever main moves. Every minute: fetch origin/main and fast-forward, but only when the checkout is on main with
// no changes of its own; run `bun install` when bun.lock changed; start the app when it isn't running.
//   node scripts/watch-main.mjs             watch (what the login agent runs)
//   node scripts/watch-main.mjs --once      one check, then exit
//   node scripts/watch-main.mjs --install   install and start the login agent (~/Library/LaunchAgents)
//   node scripts/watch-main.mjs --uninstall stop and remove it
// The log is .cargo/watch-main.log, the app's own log .cargo/studio-dev.log (.cargo is this Mac's, not in git).
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOGS = join(ROOT, '.cargo');
const LABEL = 'city.maia.watch-main';
const PLIST = join(homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
const EVERY = 60_000;

const log = (msg) => {
	const line = `${new Date().toISOString()} ${msg}\n`;
	process.stdout.write(line);
	appendFileSync(join(LOGS, 'watch-main.log'), line);
};
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function appRunning() {
	try {
		return execFileSync('pgrep', ['-f', 'tauri dev'], { encoding: 'utf8' })
			.split('\n')
			.filter(Boolean)
			.some((pid) => {
				const cwd = execFileSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { encoding: 'utf8' });
				return cwd.includes(`n${join(ROOT, 'vault/app')}`);
			});
	} catch {
		return false;
	}
}

function startApp() {
	const out = openSync(join(LOGS, 'studio-dev.log'), 'a');
	spawn('bunx', ['tauri', 'dev'], { cwd: join(ROOT, 'vault/app'), detached: true, stdio: ['ignore', out, out] }).unref();
	log('started the app (bunx tauri dev)');
}

function check() {
	git('fetch', '--quiet', 'origin', 'main');
	const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
	const head = git('rev-parse', 'HEAD');
	const latest = git('rev-parse', 'origin/main');
	if (branch !== 'main') return; // someone is working on another branch here: leave it be
	if (head !== latest) {
		if (git('status', '--porcelain', '--untracked-files=no')) return log(`main moved to ${latest.slice(0, 7)}, but the checkout has changes: not updating`);
		try {
			git('merge-base', '--is-ancestor', head, latest);
		} catch {
			return log(`main moved to ${latest.slice(0, 7)}, but the checkout has commits of its own: not updating`);
		}
		const changed = git('diff', '--name-only', head, latest).split('\n');
		git('merge', '--ff-only', '--quiet', latest);
		log(`fast-forwarded to ${git('log', '-1', '--format=%h %s')}`);
		if (changed.includes('bun.lock') || changed.includes('package.json')) {
			execFileSync('bun', ['install'], { cwd: ROOT, stdio: 'ignore' });
			log('bun install (bun.lock changed)');
		}
	}
	if (!appRunning()) startApp();
}

function safeCheck() {
	try {
		check();
	} catch (e) {
		log(`check failed: ${(e.stderr || e.message || e).toString().trim()}`);
	}
}

function install() {
	// launchd starts with a bare PATH: give it the folders node, bun, cargo and git are found in now.
	const which = (cmd) => dirname(execFileSync('which', [cmd], { encoding: 'utf8' }).trim());
	const path = [...new Set(['node', 'bun', 'cargo', 'git'].map(which).concat(['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']))].join(':');
	mkdirSync(dirname(PLIST), { recursive: true });
	writeFileSync(
		PLIST,
		`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>${LABEL}</string>
	<key>ProgramArguments</key><array><string>${process.execPath}</string><string>${fileURLToPath(import.meta.url)}</string></array>
	<key>WorkingDirectory</key><string>${ROOT}</string>
	<key>EnvironmentVariables</key><dict><key>PATH</key><string>${path}</string></dict>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>AbandonProcessGroup</key><true/>
	<key>StandardOutPath</key><string>/dev/null</string>
	<key>StandardErrorPath</key><string>${join(LOGS, 'watch-main.err.log')}</string>
</dict>
</plist>
`
	);
	const domain = `gui/${process.getuid()}`;
	try {
		execFileSync('launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'ignore' });
	} catch {}
	execFileSync('launchctl', ['bootstrap', domain, PLIST]);
	console.log(`installed ${PLIST}; log at ${join(LOGS, 'watch-main.log')}`);
}

function uninstall() {
	try {
		execFileSync('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`], { stdio: 'ignore' });
	} catch {}
	if (existsSync(PLIST)) rmSync(PLIST);
	console.log(`removed ${LABEL}`);
}

mkdirSync(LOGS, { recursive: true });
const arg = process.argv[2];
if (arg === '--install') install();
else if (arg === '--uninstall') uninstall();
else if (arg === '--once') safeCheck();
else {
	log(`watching origin/main for ${ROOT}`);
	safeCheck();
	setInterval(safeCheck, EVERY);
}

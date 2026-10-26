// One conservative dependency map for releases and local/CI selection. Unknown paths select everything.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
export const components = ['site', 'api', 'avendb', 'server', 'agent', 'infra', 'browser', 'protocol', 'mac', 'native', 'image'];
// A workflow that only checks selects the parts it checks; the release workflows and any other select everything.
const checks = {
 'kernel.yml': ['site'],
 'avendb-checks.yml': ['avendb', 'native', 'browser', 'protocol', 'image'],
 'avendb-wasm.yml': ['avendb', 'native'],
 'mac.yml': ['mac'],
 // these run on their own triggers alone
 'avendb-backups.yml': [], 'lean-mac.yml': [], 'site-same.yml': [], 'full-checks.yml': [], 'infra-checks.yml': ['infra'],
 'uptime.yml': [], 'network-audit.yml': [], 'old-vault.yml': [], 'founders.yml': [], 'site-media.yml': [],
};
// What the server's image build reads beyond the code the tests compile (avendb/Dockerfile.server, cargo-chef's recipe).
const imageInputs = /^avendb\/(Dockerfile[^/]*|\.dockerignore|Cargo\.(toml|lock)|rust-toolchain[^/]*|\.cargo\/.*|vendor\/.*|crates\/[^/]+\/(Cargo\.toml|build\.rs))$/;
export function impact(files) {
 const out = Object.fromEntries(components.map(k => [k, false]));
 const set = (...keys) => keys.forEach(k => out[k] = true);
 if (files === null) { set(...components); return out; }
 for (const file of files) {
  const workflow = /^\.github\/workflows\/([^/]+)$/.exec(file)?.[1];
  if (workflow && checks[workflow]) { set(...checks[workflow]); continue; }
  if (/^(\.github\/|scripts\/ci\/|package\.json$|bun\.lock|\.bun-version$|\.dockerignore$)/.test(file)) { set(...components); continue; }
  if (/^avendb\//.test(file)) {
   set('avendb');
   if (imageInputs.test(file)) set('image');
   if (/^avendb\/(docs\/|.*\.md$)/.test(file)) continue;
   if (/^avendb\/spec\//.test(file)) { if (file.includes('/protocol/')) set('protocol'); continue; }
   set('native');
   // Tests and tooling validate their consumers but never publish an unchanged native binary.
   if (/^avendb\/crates\/[^/]+\/tests\//.test(file)) {
    if (file.startsWith('avendb/crates/avendb-browser/')) set('browser');
    continue;
   }
   if (file.startsWith('avendb/scripts/')) { set('browser'); continue; }
   if (/^avendb\/crates\/avendb-browser\//.test(file)) { set('browser'); continue; }
   if (/^avendb\/crates\/avendb-device\//.test(file)) { set('agent','browser','mac'); continue; }
   set('server','agent','browser','mac');
   if (/\/(sign|keys|kx|encode|wire|sealed|link|relay|passkey)[^/]*\.rs$|Cargo\.(toml|lock)$|^avendb\/vendor\//.test(file)) set('protocol');
   continue;
  }
  if (/^(infra\/|docker-compose.*\.yml$)/.test(file)) { set('api','infra'); continue; }
  if (/^deploy\//.test(file)) { set('site','api','server','native'); continue; }
  if (/^api\//.test(file)) { set('api'); continue; }
  if (/^(src|static|blog|films|code|game|scripts|patches)\//.test(file) || /^(vite|svelte|tsconfig)/.test(file)) {
   set('site');
   if (/^(game|code)\//.test(file) || /^src\/lib\/(sandbox\/engines.json|avendb\/device\/)/.test(file)) set('api');
   if (/^src\/lib\/avendb\//.test(file) || file === 'scripts/avendb-browser-transports.mjs') set('avendb','browser');
   if (/^src\/lib\/avendb\/device\//.test(file)) set('native');
   continue;
  }
  if (/^vault\//.test(file)) { set('mac'); continue; }
  if (/^(docs\/|inspire-me\/|\.agents\/|\.claude\/)|\.md$/.test(file)) continue;
  set(...components);
 }
 return out;
}
export function changed(base, head = 'HEAD') {
 if (!base || /^0+$/.test(base)) return null;
 const diff=()=>execFileSync('git',['diff','--name-only','-z',base,head],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\0').filter(Boolean);
 try { return diff(); }
 catch {
  // CI needs two trees, not the repository's entire binary history. Local selection never fetches.
  if (process.env.GITHUB_ACTIONS === 'true' && /^[a-f0-9]{40}$/.test(base)) {
   try { execFileSync('git',['fetch','--no-tags','--depth=1','origin',base],{stdio:'ignore',timeout:60000}); return diff(); }
   catch { /* Missing base or unavailable fetch => every check. */ }
  }
  return null;
 }
}
if (import.meta.main) {
 const files = changed(process.env.CI_BASE, process.env.CI_HEAD || 'HEAD');
 const result = impact(files);
 result.full_validation = files === null;
 console.log(JSON.stringify({files, ...result}, null, 2));
 if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(result).map(([k,v])=>`${k}=${v}`).join('\n')+'\n');
}

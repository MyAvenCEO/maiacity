// One conservative dependency map for releases and local/CI selection. Unknown paths select everything.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { read as deviceReads } from '../devx/wasm.mjs';
export const components = ['site', 'api', 'avendb', 'server', 'agent', 'infra', 'browser', 'protocol', 'mac', 'native', 'image'];
// ops.yml runs its tasks by hand and on its schedule alone, and checks nothing a change can break; ci.yml (the checks) and
// release.yml (the deploys), like any other file under .github/, select everything.
const checks = { 'ops.yml': [] };
// What the server's image build reads beyond the code the tests compile (aven/db/Dockerfile.server, cargo-chef's recipe).
// The workspace's own manifest and lockfile (the root's, D3) select every check, the image's among them.
const imageInputs = /^aven\/db\/(Dockerfile[^/]*|rust-toolchain[^/]*|\.cargo\/.*|vendor\/.*|crates\/[^/]+\/(Cargo\.toml|build\.rs))$/;
export function impact(files) {
 const out = Object.fromEntries(components.map(k => [k, false]));
 const set = (...keys) => keys.forEach(k => out[k] = true);
 if (files === null) { set(...components); return out; }
 for (const file of files) {
  const workflow = /^\.github\/workflows\/([^/]+)$/.exec(file)?.[1];
  if (workflow && checks[workflow]) { set(...checks[workflow]); continue; }
  // a file the page's avenDB device is built from (wasm.mjs `inputs`, the one list): a new device, which the site serves
  // and the API's image carries, whatever else the file starts below
  if (deviceReads(file)) set('site', 'api');
  // the CI scripts, and the map of where the repo keeps what, which the site's build and the bundlers read
  if (/^(\.github\/|aven\/ops\/(ci\/|paths\.)|package\.json$|bun\.lock|\.bun-version$|\.dockerignore$)/.test(file)) { set(...components); continue; }
  // avenDB's page, the site's and the browser's: its device module the API loads too, and its op names are the engine's
  // (avendb's Rust test op_names holds them to it)
  if (/^aven\/db\/page\//.test(file)) {
   set('site','avendb','browser');
   if (/^aven\/db\/page\/device\//.test(file)) set('api','native');
   if (file === 'aven/db/page/op-names.js') set('native');
   continue;
  }
  // avenDB's scripts: its own native tooling (the web build, the browser and per-test runners), and the site's scripts
  // that drive avenDB's page, which select what the site's scripts do (a carrier's real browser, never a native check)
  if (/^aven\/db\/scripts\/(build-web\.sh|test-browser\.sh|test-value\.mjs|rehearsal-touch\.swift|ci\/)/.test(file)) { set('avendb','native','browser'); continue; }
  if (/^aven\/db\/scripts\//.test(file)) {
   set('site');
   if (file === 'aven/db/scripts/avendb-browser-transports.mjs') set('avendb','browser');
   continue;
  }
  if (/^aven\/db\//.test(file)) {
   set('avendb');
   if (imageInputs.test(file)) set('image');
   if (/^aven\/db\/(docs\/|.*\.md$)/.test(file)) continue;
   if (/^aven\/db\/spec\//.test(file)) { if (file.includes('/protocol/')) set('protocol'); continue; }
   set('native');
   // Tests and tooling validate their consumers but never publish an unchanged native binary.
   if (/^aven\/db\/crates\/[^/]+\/tests\//.test(file)) {
    if (file.startsWith('aven/db/crates/avendb-browser/')) set('browser');
    continue;
   }
   if (/^aven\/db\/crates\/avendb-browser\//.test(file)) { set('browser'); continue; }
   if (/^aven\/db\/crates\/avendb-device\//.test(file)) { set('agent','browser','mac'); continue; }
   set('server','agent','browser','mac');
   if (/\/(sign|keys|kx|encode|wire|sealed|link|relay|passkey)[^/]*\.rs$|Cargo\.(toml|lock)$|^aven\/db\/vendor\//.test(file)) set('protocol');
   continue;
  }
  if (/^(aven\/ops\/infra\/|docker-compose.*\.yml$)/.test(file)) { set('api','infra'); continue; }
  if (/^aven\/ops\/deploy\//.test(file)) { set('site','api','server','native'); continue; }
  if (/^aven\/api\//.test(file)) { set('api'); continue; }
  if (/^(maia\/(site|content)|aven\/(kernel|ops)|blog)\//.test(file) || /^maia\/research\/(sandbox-7\/|lean-wasm\/|theos-e2e-sim\.mjs$)/.test(file) || /^(vite|svelte|tsconfig)/.test(file)) {
   set('site');
   if (/^maia\/content\/(game|code)\//.test(file) || /^aven\/kernel\/(engines\.js|sandbox\/engines\.json)$/.test(file)) set('api');
   continue;
  }
  if (/^theos\//.test(file)) { set('mac'); continue; }
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

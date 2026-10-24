// One conservative dependency map for releases and local/CI selection. Unknown paths select everything.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
export const components = ['site', 'api', 'avendb', 'server', 'agent', 'infra', 'browser', 'protocol', 'mac'];
export function impact(files) {
 const out = Object.fromEntries(components.map(k => [k, false]));
 const set = (...keys) => keys.forEach(k => out[k] = true);
 if (files === null) { set(...components); return out; }
 for (const file of files) {
  if (/^(\.github\/|scripts\/ci\/|package\.json$|bun\.lock|\.bun-version$|\.dockerignore$)/.test(file)) { set(...components); continue; }
  if (/^avendb\//.test(file)) {
   set('avendb');
   if (/^avendb\/(docs\/|.*\.md$)/.test(file)) continue;
   if (/^avendb\/spec\//.test(file)) { if (file.includes('/protocol/')) set('protocol'); continue; }
   if (/^avendb\/crates\/avendb-browser\//.test(file)) { set('browser'); continue; }
   if (/^avendb\/crates\/avendb-device\//.test(file)) { set('agent','browser','mac'); continue; }
   set('server','agent','browser','mac');
   if (/\/(sign|keys|kx|encode|wire|sealed|link|relay|passkey)[^/]*\.rs$|Cargo\.(toml|lock)$|^avendb\/vendor\//.test(file)) set('protocol');
   continue;
  }
  if (/^(infra\/|docker-compose.*\.yml$)/.test(file)) { set('api','infra'); continue; }
  if (/^deploy\//.test(file)) { set('site','api','server'); continue; }
  if (/^api\//.test(file)) { set('api'); continue; }
  if (/^(src|static|blog|films|code|game|scripts|patches)\//.test(file) || /^(vite|svelte|tsconfig)/.test(file)) {
   set('site');
   if (/^(game|code)\//.test(file) || /^src\/lib\/(sandbox\/engines.json|avendb\/device\/)/.test(file)) set('api');
   if (/^src\/lib\/avendb\/device\//.test(file)) set('avendb','browser');
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
 try { return execFileSync('git', ['diff','--name-only','-z',base,head], {encoding:'utf8'}).split('\0').filter(Boolean); }
 catch { return null; } // missing base => full validation, never silently skip
}
if (import.meta.main) {
 const files = changed(process.env.CI_BASE, process.env.CI_HEAD || 'HEAD');
 const result = impact(files);
 result.native = result.server || result.agent || result.browser;
 console.log(JSON.stringify({files, ...result}, null, 2));
 if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(result).map(([k,v])=>`${k}=${v}`).join('\n')+'\n');
}

// Shared local/CI test inventory. No unowned test is silently omitted.
import { readdirSync, readFileSync, appendFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { changed } from './impact.mjs';
import { hash } from './passes.mjs';
export const suites = JSON.parse(readFileSync(new URL('./suites.json', import.meta.url), 'utf8'));
export const matches = (file, pattern) => pattern.endsWith('/') ? file.startsWith(pattern) : file === pattern;
export function discover(root = process.cwd()) {
 const files=[];
 const visit = dir => { for (const e of readdirSync(resolve(root,dir), {withFileTypes:true})) {
  if (['node_modules','target','.git','.lake'].includes(e.name)) continue;
  const path=dir+'/'+e.name;
  if (e.isDirectory()) visit(path);
  else if (/\.test\.[cm]?[jt]s$/.test(e.name)) files.push(path);
 }};
 for (const dir of ['src','api','game','scripts','deploy']) visit(dir);
 return files.sort();
}
export function inventory(files=discover()) {
 const groups = Object.fromEntries(suites.map(s=>[s.name,[]]));
 for (const file of files) {
  const suite=suites.find(s=>s.paths.some(p=>matches(file,p)));
  if (!suite) throw new Error(`Unowned test: ${file}. Assign it in scripts/ci/suites.json.`);
  groups[suite.name].push(file);
 }
 return groups;
}
export function selected(files, mode='changed') {
 if (mode==='gate') return suites.filter(s=>s.tier==='gate'||s.name==='ci').map(s=>s.name);
 if (mode==='all' || files===null) return suites.map(s=>s.name);
 // Dependency/build/CI changes can affect any suite; missing base takes this path too.
 // Of .github/, only the kernel's own workflow and the shared actions run these suites; another workflow is the ci suite's.
 if (files.some(f=>/^(package\.json$|bun\.lock|\.bun-version$|\.github\/(workflows\/kernel\.yml$|actions\/)|scripts\/ci\/|patches\/|vite|svelte|tsconfig)/.test(f))) return suites.map(s=>s.name);
 return suites.filter(s=>s.tier==='gate'||s.name==='ci'||files.some(f=>s.impact.some(p=>matches(f,p)))).map(s=>s.name);
}
// File-level isolation keeps each simulation's staged state intact; every file belongs to exactly one shard. Files go to
// the shard with the least time so far, longest first, by their measured seconds (timings.json; a file not measured yet
// counts as the median), so the shards end together instead of one running twice as long as another.
export const timings = JSON.parse(readFileSync(new URL('./timings.json', import.meta.url), 'utf8'));
export function partition(files, shard, times=timings) {
 if (!shard) return files;
 const match=/^([1-9]\d*)\/([1-9]\d*)$/.exec(shard);
 if (!match) throw new Error(`Invalid shard: ${shard}`);
 const [,index,total]=match.map(Number);
 if (index>total || total>files.length) throw new Error(`Empty or invalid shard: ${shard}`);
 const known=Object.values(times).sort((a,b)=>a-b), fallback=known.length?known[known.length>>1]:1;
 const time=f=>times[f]??fallback;
 const loads=Array(total).fill(0), owner=new Map();
 for (const file of [...files].sort((a,b)=>time(b)-time(a)||a.localeCompare(b))) {
  const least=loads.indexOf(Math.min(...loads));
  loads[least]+=time(file); owner.set(file,least);
 }
 return files.filter(f=>owner.get(f)===index-1);
}
export const shards = { physics: 5 };
export function matrix(names) {
 return names.filter(name=>!suites.find(s=>s.name===name && (s.tier==='gate'||s.name==='ci')))
  .flatMap(suite=>shards[suite]
   ? Array.from({length:shards[suite]},(_,i)=>({suite,shard:`${i+1}/${shards[suite]}`,label:`${suite} ${i+1}/${shards[suite]}`}))
   : [{suite,shard:'',label:suite}]);
}
// Each entry's pass marker (passes.mjs): the suite's own tests and what selects it, and the kernel's workflow.
export function keyed(entries) {
 return entries.map(e=>{
  const s=suites.find(x=>x.name===e.suite);
  return {...e, key:`pass-app-${e.suite}-${e.shard.replace('/','of')||'all'}-${hash([...s.paths,...s.impact,'.github/workflows/kernel.yml'])}`};
 });
}
if (import.meta.main) {
 const args=process.argv.slice(2);
 const value = flag => args.includes(flag) ? args[args.indexOf(flag)+1] : undefined;
 const groups=inventory();
 if (args.includes('--check')) { console.log(Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.length]))); process.exit(0); }
 const mode=args.includes('--all')?'all':args.includes('--gate')?'gate':'changed';
 const base=value('--base')||process.env.CI_BASE;
 const names=value('--suite')?[value('--suite')]:selected(mode==='changed'?changed(base,process.env.CI_HEAD||'HEAD'):null,mode);
 if (args.includes('--matrix')) {
  // each with its pass marker: on a pull request, a suite that passed with the same files skips its steps
  const json=JSON.stringify(keyed(matrix(names)));
  console.log(json);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,`suites=${json}\n`);
  process.exit(0);
 }
 let failed=false;
 for (const name of names) {
  if (!groups[name]?.length) throw new Error(`Unknown or empty required suite: ${name}`);
  const start=performance.now();
  const files=partition(groups[name],value('--shard'));
  console.log(`Suite ${name}${value('--shard')?' '+value('--shard'):''}: ${files.length} files`);
  if (args.includes('--list')) continue;
  // Each suite gets its own process: no API/global/module mocks leak between suites.
  const result=spawnSync(process.execPath,['test',...files.map(p=>'./'+p)],{stdio:'inherit',env:process.env});
  const line=`${name}: ${((performance.now()-start)/1000).toFixed(2)}s, exit ${result.status}`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,line+'\n');
  if (result.status!==0) failed=true;
 }
 process.exitCode=failed?1:0;
}

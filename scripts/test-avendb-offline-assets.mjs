/** Actual Assets component + synthetic local engine boundary; no account or live data. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
const {chromium,webkit}=await import(process.env.AVENDB_TEST_PLAYWRIGHT || 'playwright');
const engine=process.argv.includes('--webkit')?'webkit':'chromium';
let server,browser;
try {
 server=await createServer({optimizeDeps:{noDiscovery:true,entries:[]},server:{host:'127.0.0.1',port:0,fs:{allow:[process.cwd()]}},plugins:[{
  name:'offline-assets-fixture',enforce:'pre',resolveId(source){if(source.endsWith('/session.svelte.js'))return resolve('scripts/fixtures/offline-assets/fake-session.svelte.js');},
  configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]!=='/__offline-assets')return next();res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><script type="module" src="/scripts/fixtures/offline-assets/main.js"></script></body></html>');});}
 }]});
 await server.listen();const address=server.httpServer.address();const origin=`http://127.0.0.1:${address.port}`;
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 browser=await (engine==='webkit'?webkit.launch({headless:true}):chromium.launch({headless:true,executablePath:process.env.AVENDB_CHROMIUM||(existsSync(chrome)?chrome:undefined)}));
 const context=await browser.newContext();await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 const page=await context.newPage();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/__offline-assets#assets');
 await page.getByText('No locally available recipe entry',{exact:false}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.fixtureCalls.map(o=>[o.op,o.types])),[['database',['recipe']],['entry_views',['recipe']]]);
 await page.evaluate(()=>window.fixtureChange('failed'));
 await page.getByText('Reading the vault’s entries failed: Fixture local read failed',{exact:true}).waitFor();
 await page.evaluate(()=>window.fixtureChange('row'));
 await page.getByText('1 entry refused: no page builds it',{exact:true}).waitFor();
 await page.evaluate(()=>window.fixtureChange('empty'));
 await page.getByText('No locally available recipe entry',{exact:false}).waitFor();
 assert.equal(await page.locator('details.refused').count(),0);
 assert.deepEqual(errors,[]);
 assert((await page.evaluate(()=>window.fixtureCalls)).every(o=>['database','entry_views'].includes(o.op)&&o.types[0]==='recipe'));
 console.log('PASS '+engine+': real Assets renders from metadata-only world, revision updates errors/rows/removal, no world/bring/network read');
} finally {await browser?.close();await server?.close();}

/** Real view lifecycle, synthetic worker/passkey boundary. See fixtures/session-lifecycle/CONTRACT.md.
 * bun scripts/test-avendb-session.mjs --browser chromium|webkit
 * No account, live store, network peer or secret is used. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
const { chromium, webkit } = await import(process.env.AVENDB_TEST_PLAYWRIGHT || 'playwright');
const at = process.argv.indexOf('--browser');
const engine = at < 0 ? 'chromium' : process.argv[at + 1];
assert(['chromium', 'webkit'].includes(engine));
const remote = `
const counts = window.fixtureCounts = { opens:0, holds:0, closes:0, releases:0, unlocks:0 };
const meta = { name:'Synthetic fixture', credential:'fixture', nonce:'01'.repeat(32) };
const store = { hold:async()=>{counts.holds++}, release:async()=>{counts.releases++} };
export const load = async()=>{};
export const openStore = async()=>store;
export const storeMeta = async()=>({...meta});
export const prfSalt = async()=>new Uint8Array(32);
export const deviceSalt = async()=>new Uint8Array(32);
export class Device {
 static async open() { counts.opens++; return new Device(); }
 async size() { return [0,0]; }
 async changed() { return new Promise(()=>{}); }
 async moving() { return null; }
 async run(op) { if(op.op==='world') return {ok:{mine:'fixture',vaults:[],entries:[]}}; return {ok:null}; }
 async close() { counts.closes++; }
}`;
const passkey = `export const ceremonies=()=>({unlock:async()=>{window.fixtureCounts.unlocks++;return {}},sign:async()=>{throw Error('unexpected signing')}});`;
let server, browser;
try {
 server = await createServer({ optimizeDeps: { noDiscovery:true, entries:[] },
   server: { host:'127.0.0.1', port:0, strictPort:false, fs:{allow:['scripts/fixtures/session-lifecycle']} },
   plugins:[{name:'session-lifecycle-fixture', configureServer(s){s.middlewares.use((req,res,next)=>{
     if(req.url?.split('?')[0]!=='/__session-lifecycle')return next();
     res.setHeader('Content-Type','text/html');
     res.end('<!doctype html><html><body><script type="module" src="/scripts/fixtures/session-lifecycle/main.js"></script></body></html>');
   });}}] });
 await server.listen();
 const address=server.httpServer.address();
 assert(address && typeof address==='object');
 const origin=`http://127.0.0.1:${address.port}`;
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 browser=await (engine==='webkit'?webkit.launch({headless:true}):chromium.launch({headless:true,
   executablePath:process.env.AVENDB_CHROMIUM || (existsSync(chrome)?chrome:undefined)}));
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin)return route.abort();
   if(url.pathname==='/src/lib/avendb/remote.js')return route.fulfill({contentType:'text/javascript',body:remote});
   if(url.pathname==='/src/lib/avendb/device/passkey.js')return route.fulfill({contentType:'text/javascript',body:passkey});
   return route.continue();
 });
 const page=await context.newPage();
 page.setDefaultTimeout(20000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const probes=[];page.on('request',request=>{if(request.url().includes('speed.cloudflare.com') || request.url().includes('/release.json'))probes.push(request.url());});
 await page.goto(origin+'/__session-lifecycle');
 await page.getByTestId('phase').filter({hasText:'closed'}).waitFor();
 const diagnostics=page.getByRole('button',{name:'Open diagnostics'});
 assert.equal(await diagnostics.evaluate(el=>getComputedStyle(el).position),'fixed');
 await diagnostics.click();
 if(process.env.AVENDB_LIFECYCLE_SCREENSHOT)await page.screenshot({path:process.env.AVENDB_LIFECYCLE_SCREENSHOT});
 await page.getByRole('button',{name:'Network diagnostics',exact:true}).click();
 await page.frameLocator('iframe[title="This device’s network check"]').getByRole('button',{name:'Run connection check'}).waitFor();
 assert.equal(await page.evaluate(()=>window.fixtureSession.phase),'closed');
 assert.deepEqual(probes,[]);
 await page.getByRole('button',{name:'Close diagnostics'}).click();
 assert.equal(await diagnostics.evaluate(el=>document.activeElement===el),true);
 await page.getByRole('button',{name:'Unlock fixture'}).click();
 await page.getByTestId('phase').filter({hasText:'open'}).waitFor();
 await diagnostics.click();
 await page.keyboard.press('Escape');
 assert.equal(await diagnostics.evaluate(el=>document.activeElement===el),true);
 await diagnostics.click();
 await page.mouse.click(2,2);
 await page.waitForFunction(()=>!document.querySelector('dialog').open);
 const document=await page.evaluate(()=>{window.originalDevice=window.fixtureSession.device;return window.fixtureDocument});
 for(let i=0;i<4;i++) {
   await page.getByRole('button',{name:'Change view'}).click();
   await page.waitForFunction(expected=>Boolean(document.querySelector('[data-testid="view"]'))===expected,i%2===1);
   assert.equal(await page.evaluate(()=>window.fixtureSession.device===window.originalDevice && window.fixtureSession.phase==='open'),true);
   assert.equal(await page.evaluate(()=>window.fixtureDocument),document);
 }
 // pushState can emit framenavigated in Playwright: document identity and Navigation Timing distinguish it.
 assert.equal(await page.evaluate(()=>performance.getEntriesByType('navigation').length),1);
 assert.equal(await page.evaluate(()=>window.fixtureLifecycle.snapshot().current.documents),1);
 assert.deepEqual(await page.evaluate(()=>window.fixtureCounts),{opens:1,holds:1,closes:0,releases:0,unlocks:1});
 await page.evaluate(()=>window.fixtureSession.lock());
 assert.deepEqual(await page.evaluate(()=>{const r=window.fixtureLifecycle.snapshot();return [r.current.documents,r.current.phase]}),[1,'locked']);
 await page.getByRole('button',{name:'Unlock fixture'}).click();
 await page.getByTestId('phase').filter({hasText:'open'}).waitFor();
 await page.reload();
 await page.getByTestId('phase').filter({hasText:'closed'}).waitFor();
 assert.notEqual(await page.evaluate(()=>window.fixtureDocument),document);
 assert.equal(await page.evaluate(()=>window.fixtureSession.device),null);
 assert.deepEqual(await page.evaluate(()=>window.fixtureCounts),{opens:0,holds:0,closes:0,releases:0,unlocks:0});
 const restart=await page.evaluate(()=>window.fixtureLifecycle.snapshot());
 assert.equal(restart.current.documents,2); assert.equal(restart.previous.phase,'open');
 assert.equal(restart.navigation,'reload');
 await diagnostics.click();
 await page.getByText('Page restart details',{exact:true}).click();
 await page.getByText('This window has loaded 2 documents. Navigation: reload.',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS '+engine+': global mobile diagnostics works locked/open without auto probes; close/Escape/outside preserve document; lifecycle distinguishes view/lock/reload and new document stays locked');
} finally { await browser?.close();await server?.close(); }

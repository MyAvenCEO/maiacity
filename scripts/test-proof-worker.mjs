/** Real browser worker lifetime; synthetic proof result, no cryptographic claim. */
import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
const { chromium, webkit } = await import(process.env.AVENDB_TEST_PLAYWRIGHT || 'playwright');
const source = readFileSync(new URL('../game/code/sources/proof-worker.js', import.meta.url), 'utf8').replace('export function', 'function');
const at = process.argv.indexOf('--browser');
const selected = at < 0 ? null : process.argv[at + 1];
assert(selected === null || ['chromium', 'webkit'].includes(selected), 'expected --browser chromium|webkit');
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
	if (selected && selected !== name) continue;
	const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
	const browser = await engine.launch({ headless: true, ...(name === 'chromium' ? {executablePath: process.env.AVENDB_CHROMIUM || (existsSync(chrome) ? chrome : undefined)} : {}) });
	try {
		const page = await browser.newPage();
		await page.addScriptTag({ content: `${source}\nwindow.proofWorker=proofWorker;` });
		const result = await page.evaluate(async () => {
			let made = 0, ended = 0, current;
			const url = URL.createObjectURL(new Blob([`let held; onmessage=({data})=>{if(data.release){postMessage({id:held.id,rows:'[100]'});return;} if(data.bytes[0]===100){held=data;return;} postMessage({id:data.id,rows:JSON.stringify([data.bytes[0]])});};`], {type:'text/javascript'}));
			const ask = window.proofWorker(() => {
				made++; const w = current = new Worker(url), stop = w.terminate.bind(w);
				w.terminate = () => { ended++; stop(); }; return w;
			}, {idle:30});
			try {
				const a = new Uint8Array([10]), b = new Uint8Array([100]);
				const one = ask(a, 'anchor', 'recipe'), two = ask(b, 'anchor', 'recipe');
				const transferred = a.byteLength === 0 && b.byteLength === 0;
				const first = await one; await new Promise(r=>setTimeout(r,50));
				const aliveDuringOther = ended === 0; current.postMessage({release:true}); const second = await two;
				await new Promise(r=>setTimeout(r,80)); const released = ended === 1;
				const third = await ask(new Uint8Array([1]),'anchor','recipe');
				await new Promise(r=>setTimeout(r,80));
				return {transferred,aliveDuringOther,released,first,second,third,made,ended};
			} finally { URL.revokeObjectURL(url); }
		});
		assert.deepEqual(result,{transferred:true,aliveDuringOther:true,released:true,first:'[10]',second:'[100]',third:'[1]',made:2,ended:2});
		console.log(`PASS ${name}: concurrent real workers preserve transfers, release idle verifier and recreate`);
	} finally { await browser.close(); }
}

// @ts-nocheck
import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { realmReader } from './realm-reader.js';
import { check } from '../../../src/lib/assets/schemas/check.js';
const schema = { type: 'object' };
test('borrowed local reader returns nested JSON in the receiving realm', async () => {
 const foreign = runInNewContext('({ok:{card:{name:"Birch",size:[1,2,3],nested:{v:2}}}})');
 expect(check(schema, foreign.ok.card).ok).toBe(false);
 const device = { run: async () => foreign };
 const reader = realmReader(device);
 const result = await reader.run({op:'query'});
 expect(check(schema, result.ok.card).ok).toBe(true);
 expect(Object.getPrototypeOf(result.ok.card.nested)).toBe(Object.prototype);
 expect(result).toEqual(foreign);
 expect(result).not.toBe(foreign);
 expect(realmReader(device)).toBe(reader);
 expect(realmReader({run:device.run})).not.toBe(reader);
});
test('file ranges retain bytes and requests retain their local transport', async () => {
 const bytes = runInNewContext('new Uint8Array([0,128,255])');
 let asked;
 const reader = realmReader({ read: async (...args) => { asked=args; return bytes; } });
 const got = await reader.read('root',3,0,3);
 expect(asked).toEqual(['root',3,0,3]);
 expect(got instanceof Uint8Array).toBe(true);
 expect([...got]).toEqual([0,128,255]);
 expect(got).not.toBe(bytes);
});
test('refusals and forbidden JSON keys still reach the validator', async () => {
 const foreign = runInNewContext(`JSON.parse('{"ok":{"__proto__":{"polluted":true}}}')`);
 const reader = realmReader({run:async()=>foreign});
 expect(check(schema,(await reader.run({})).ok).ok).toBe(false);
 const denied=realmReader({run:async()=>({refused:'locked'})});
 expect(await denied.run({})).toEqual({refused:'locked'});
 expect(realmReader(null)).toBeNull();
});

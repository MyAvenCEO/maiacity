import {expect,test} from 'bun:test';
import {routeDemandContext} from './view-context.js';
const a='a'.repeat(64),b='b'.repeat(64),v='c'.repeat(64);
test('only explicit entry URL fields become hints; context stays a local identity',()=>{
 const url=new URL(`https://maia.city/app/studio/?timeline=cut:${a}&filter=${b}#assets/${b}/version`);
 expect(routeDemandContext(url,v)).toEqual({vault:v,context:url.search+url.hash,entries:[a,b]});
 expect(routeDemandContext(new URL(`https://maia.city/app/?search=${a}#unknown/${b}`),'bad').entries).toEqual([]);
 expect(routeDemandContext(new URL(`https://maia.city/app/chat/?room=${a}`),null).entries).toEqual([a]);
});

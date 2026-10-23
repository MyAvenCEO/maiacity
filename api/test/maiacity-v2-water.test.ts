import {expect,test} from 'bun:test';
import {act,advance,newGame,DAY_MS,WATER_HOME,SEEDLINGS,nextWaterAt} from '../../game/maiacity-v2/engine.js';
const now=Date.UTC(2026,9,23);
function planted(){let s=newGame(now);s.players.A.tree={plant:'apple',v:1,name:'Samuel',x:40,z:0,at:now,watered:0,grown:3};s.players.B.tree={plant:'pear',v:1,name:'Daniel',x:50,z:0,at:now,watered:0,grown:2};return s;}
const take=(s,t)=>act(s,'A',{type:'takeWater',...WATER_HOME},t);
test('one litre, only the carrier’s own nearby tree, one growth month per real day',()=>{
 let s=take(planted(),now+DAY_MS);
 expect(()=>act(s,'A',{type:'water',x:40,z:0,tree:'B'},now+DAY_MS)).toThrow('own tree');
 expect(()=>act(s,'B',{type:'water',x:50,z:0},now+DAY_MS)).toThrow('canister');
 expect(()=>act(s,'A',{type:'water',...WATER_HOME},now+DAY_MS)).toThrow('Walk to your own');
 s=act(s,'A',{type:'water',x:40,z:0},now+DAY_MS);
 expect(s.water.litres).toBe(9);expect(s.players.A.tree.grown).toBe(4);expect(s.players.B.tree.grown).toBe(2);
 expect(()=>act(s,'A',{type:'water',x:40,z:0},now+DAY_MS+1)).toThrow('24 hours');
 expect(nextWaterAt(s,s.players.A.tree)).toBe(now+DAY_MS*2);
});
test('missed days preserve growth and grant no catch-up; depleted water grants none',()=>{
 let s=planted();s.settings.hoursPerMonth=1;s=take(s,now+DAY_MS*7);
 s=act(s,'A',{type:'water',x:40,z:0},now+DAY_MS*7);
 expect(s.players.A.tree.grown).toBe(4);
 const later=advance(JSON.parse(JSON.stringify(s)),now+DAY_MS*20);
 expect(later.players.A.tree.grown).toBe(4);expect(later.players.A.tree.wateredAt).toBe(now+DAY_MS*7);
 later.water.litres=0;later.water.carriedBy='A';later.water.touchedAt=now+DAY_MS*20;
 expect(()=>act(later,'A',{type:'water',x:40,z:0},now+DAY_MS*20)).toThrow('empty');
});
test('canister is exclusive, shared, droppable and recoverable after disconnect',()=>{
 let s=take(planted(),now);
 expect(()=>act(s,'B',{type:'takeWater',...WATER_HOME},now)).toThrow('Another citizen');
 s=act(s,'A',{type:'carryWater',x:30,z:0},now+1000);
 expect(s.water).toMatchObject({x:30,z:0,carriedBy:'A',litres:10});
 s=act(s,'A',{type:'putWater',x:30,z:0},now+2000);
 s=act(s,'B',{type:'takeWater',x:30,z:0},now+3000);
 expect(advance(s,now+64000).water.carriedBy).toBeNull();
});
test('birch replaces quince in ten choices without removing old planted quinces',()=>{
 expect(SEEDLINGS).toHaveLength(10);expect(SEEDLINGS.some(x=>x.id==='birch')).toBe(true);
 const s=planted();s.players.A.tree.plant='quince';expect(advance(s,now+DAY_MS).players.A.tree.plant).toBe('quince');
});

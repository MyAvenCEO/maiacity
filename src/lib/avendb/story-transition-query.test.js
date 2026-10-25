// @ts-nocheck
import {test,expect} from 'bun:test';
import {storyTransitionQuery,storyTransitionDefaults,privateTransitionReady} from './story-transition-query.js';
const actor='1'.repeat(64),vault='2'.repeat(64),city='3'.repeat(64);
test('private transition inputs preserve current actor and only existing trusted scopes',()=>{
 expect(storyTransitionQuery(vault,actor)).toEqual({op:'entry_views',vault,as:actor,types:['flow','function','post']});
 expect(storyTransitionDefaults(vault,actor,city)).toEqual({op:'entry_views',vault:city,as:actor,types:['flow','function']});
 expect(storyTransitionDefaults(vault,actor,vault)).toEqual({op:'entry_views',entries:[],as:actor});
});
test('local read readiness enables only private-to-private transitions',()=>{
 expect(privateTransitionReady({public:false},{public:false},'ready','ready')).toBe(true);
 for(const state of ['loading','error'])expect(privateTransitionReady({public:false},{public:false},state,'ready')).toBe(false);
 expect(privateTransitionReady({public:true},{public:false},'ready','ready')).toBe(false);
 expect(privateTransitionReady({public:false},{public:true},'ready','ready')).toBe(false);
 expect(privateTransitionReady(null,null,'ready','ready')).toBe(false);
});

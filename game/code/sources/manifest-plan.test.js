// @ts-nocheck
import {test,expect} from 'bun:test';
import {manifestPlan} from '../../../scripts/manifest-plan.mjs';
test('changed existing manifests become proposals, unchanged ones are idempotent',()=>{
 const value={kind:'manifest',id:'game',parts:[{query:{type:['config'],tags:['game:x']}}]};
 expect(manifestPlan([value],[{entry:'entry',record:{...value,parts:[{query:{tags:['game:x']}}]}}])).toEqual([{kind:'update',entry:'entry',value,fields:['parts']}]);
 expect(manifestPlan([value],[{entry:'entry',record:value}])).toEqual([]);
 expect(manifestPlan([value],[])).toEqual([{kind:'create',value}]);
 expect(()=>manifestPlan([value],[{record:value},{record:value}])).toThrow('Duplicate');
});

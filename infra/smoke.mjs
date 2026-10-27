// Run the real infrastructure program under Bun against an in-memory provider. No credentials or cloud calls.
import assert from 'node:assert/strict';
import * as pulumi from '@pulumi/pulumi';
const resources = [];
// the servers Hetzner reports running under our label; the second run has ours on a type sold out in our location
let running = [];
process.env.SSH_PUBLIC_KEY = 'ssh-ed25519 AAAA synthetic-test-key';
pulumi.runtime.setMocks({
 newResource(args) {
  resources.push(args);
  return { id: '1', state: { ...args.inputs, ipv4Address: '192.0.2.1' } };
 },
 call(args) {
  if (args.token === 'hcloud:index/getServerTypes:getServerTypes') return { serverTypes: [{ name:'fixture', architecture:'x86', cpuType:'shared', cores:2, memory:4, disk:40, isDeprecated:false, locations:[{ name:'nbg1', available:true, isDeprecated:false }] }, { name:'full', architecture:'x86', cpuType:'shared', cores:2, memory:4, disk:20, isDeprecated:false, locations:[{ name:'nbg1', available:false, isDeprecated:false }] }] };
  if (args.token === 'hcloud:index/getServers:getServers') return { servers: running };
  throw new Error(`Unexpected provider call: ${args.token}`);
 }
}, 'maiacity', 'test', false);
const read = value => new Promise((resolve, reject) => { value.apply(resolve); setTimeout(() => reject(new Error('Unresolved infrastructure output')), 10000).unref(); });
await pulumi.runtime.runInPulumiStack(async () => {
 const infra = await import('./index.ts');
 assert.equal(await read(infra.ipv4), '192.0.2.1');
 assert.equal(await read(infra.chosenServerType), 'fixture');
 assert.equal(await read(infra.dataMount), '/mnt/HC_Volume_1');
});
// a running server keeps its type while that type meets the floor, even with no room left for a new one of it
running = [{ name: 'maia-city', serverType: 'full' }];
await pulumi.runtime.runInPulumiStack(async () => {
 const infra = await import('./index.ts?running');
 assert.equal(await read(infra.chosenServerType), 'full');
});
assert(resources.some(r => r.type === 'hcloud:index/volume:Volume'));
console.log('PASS: infrastructure program and provider outputs execute under Bun with mock resources');

// aven-id's wasm on the cast's tree, held to values written out by hand from SANDBOX.md's "Vaults own vaults", as
// sandbox/check.mjs does. Runs in the box after build.sh, from aven/DB2: `bun run box bun id/core/wasm/check.mjs`.
import { readFileSync } from 'node:fs';
import { Cast, initSync } from '../../../target/wasm/aven-id/aven_id.js';

initSync({ module: readFileSync(new URL('../../../target/wasm/aven-id/aven_id_bg.wasm', import.meta.url)) });
const cast = new Cast(readFileSync(new URL('../../../sandbox/cast.json', import.meta.url), 'utf8'));

const expected = [
	['accounts', [undefined], ['alice', 'bob']],
	['accounts', ['alice-peer-light'], ['alice']],
	['accounts', ['bob-peer-light'], ['bob']],
	['accounts', ['aven-peer'], []],
	['sees', ['alice'], ['aven-peer', 'alice-peer', 'alice-peer-light']],
	['sees', ['bob'], ['bob-peer-light']],
	['governs', ['alice'], ['aven', 'aven-peer', 'alice-peer', 'alice-peer-light']],
	['governs', ['aven'], ['aven-peer']],
	['chain', ['aven-peer'], ['aven', 'alice']],
	['owned', ['alice'], ['aven', 'alice-peer', 'alice-peer-light']],
	['actsThrough', ['alice'], ['alice-peer', 'alice-peer-light']],
	['actsThrough', ['aven'], ['aven-peer']],
	['actsFor', ['aven-peer'], 'aven'],
	['actsFor', ['alice'], undefined],
	['mayActOn', ['bob-peer-light', 'aven'], false],
	['mayActOn', ['aven-peer', 'alice'], false],
	['mayActOn', ['alice-peer-light', 'aven-peer'], true],
	['name', ['bob-peer-light'], "Bob's Peer-Light"],
	['kind', ['aven'], 'network'],
	['owners', ['aven'], ['vault:alice']],
	['key', ['alice-peer-light'], '9f78814b6ea9f2bb99fbbf738de54eb7dbf257ec6121c43c5d5c24d6b004fd55'],
];
const problems = [];
for (const [query, args, want] of expected) {
	const got = cast[query](...args);
	if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${query}(${args}): ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
}
try {
	new Cast('{"keys":{},"vaults":{"a":{"kind":"person","owners":["vault:a"]}}}');
	problems.push('a cycle was accepted');
} catch (e) {
	if (!String(e.message).includes('above itself')) problems.push(`a cycle was refused with ${e.message}`);
}
console.log(problems.length ? problems.join('\n') : `aven-id wasm: ${expected.length + 1} checks pass`);
process.exit(problems.length ? 1 : 0);

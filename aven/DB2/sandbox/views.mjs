// avenOS's views, held to Lean's vectors (id/spec/vectors/avenos.json, README rule 10) in any engine: whom each host
// may act as, each person's Control Room, each Vault and the names it shows, and whom each Peer-Light serves. Every
// view is pushed by a Peer-Light (os/web/id.svelte.js): the box's own view runs its core for that alone. check.mjs walks
// them in Chromium beside the peers' panes; engines.mjs walks them in WebKit and Firefox with this. No expected value is written
// here.
import { readFileSync } from 'node:fs';

const avenos = JSON.parse(readFileSync(new URL('../id/spec/vectors/avenos.json', import.meta.url), 'utf8'));
const shown = (key) => avenos.filter((v) => key in v.input);
const names = shown('names')[0].expected;

// Walks every view in `page` (one tab of a browser whose Peer-Light origins nothing else runs) and returns what
// differs from the model, each problem prefixed with `engine`.
export async function walkViews(page, engine) {
	const problems = [];
	const differ = (what, got, want) => {
		if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${engine}: ${what}: ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
	};
	const ids = (selector, name) => page.locator(selector).evaluateAll((els, name) => els.map((el) => el.dataset[name]), name);
	const waited = (locator, what) =>
		locator
			.first()
			.waitFor({ timeout: 30_000 })
			.then(() => true)
			.catch(() => (problems.push(`${engine}: ${what} never showed`), false));

	for (const { input, expected } of shown('accounts')) {
		await page.goto(`http://${input.accounts}:5173/`);
		if (!(await waited(page.getByText('Control Room'), `${input.accounts}'s dashboard`))) continue;
		// a visitor's host has no views to wait for; any other waits for its snapshot
		if (expected.length) await waited(page.locator('[data-view="dashboard"][data-account]'), `${input.accounts}'s vault`);
		differ(`${input.accounts} may act as`, await ids('#accounts [data-account]', 'account'), expected);
	}
	for (const { input, expected } of shown('serves')) {
		const host = `${input.serves.replace('-peer-light', '')}.localhost`;
		await page.goto(`http://${host}:5173/`);
		if (await waited(page.getByTestId('serves'), `${host}'s device`))
			differ(`${input.serves} serves`, (await page.getByTestId('serves').textContent()).trim(), names[expected]);
	}
	for (const { input, expected } of shown('sees')) {
		await page.goto(`http://localhost:5173/#/${input.sees}/control-room`);
		if (await waited(page.locator(`[data-view="control-room"][data-account="${input.sees}"]`), `${input.sees}'s Control Room`))
			differ(`${input.sees}'s Control Room`, await ids('[data-peer]', 'peer'), expected);
	}
	for (const { input, expected } of shown('vault')) {
		const path = input.target ? `${input.vault}/${input.target}` : input.vault;
		await page.goto(`http://localhost:5173/#/${input.vault}/vault${input.target ? `/${input.target}` : ''}`);
		if (!(await waited(page.locator(`[data-view="vault"][data-account="${input.vault}"][data-shown="${expected.opens}"]`), `${path}'s Vault`))) continue;
		differ(`${path}'s Vault`, await ids('[data-vault]', 'vault'), expected.tree);
		differ(`${path}'s Vault names`, (await page.locator('[data-vault] > a strong').allTextContents()).map((n) => n.trim()), expected.tree.map((id) => names[id]));
		// a vault that acts through no device of its own says so in its own words, not the model's
		if (expected.actsThrough.length) differ(`${path} acts through`, (await page.getByTestId('acts-through').textContent()).trim(), expected.actsThrough.map((id) => names[id]).join(', '));
	}
	return problems;
}

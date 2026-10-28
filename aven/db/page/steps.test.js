// @ts-nocheck — plain JS
import { describe, expect, test } from 'bun:test';
import { plan, rows, stepWords } from './steps.js';

const words = stepWords('this Mac');
const at = { now: 0, ended: 0, failed: false };
const keys = (planned) => rows([], planned, words, at).find((r) => r.step === 'keys')?.does;

describe('what the unlock sheet says makes the device’s keys', () => {
	test('after Touch ID, the Secure Enclave’s secret; after the passkey, the passkey’s', () => {
		expect(keys(plan('open', { mac: true, touch: true }))).toMatch(/Secure Enclave/);
		expect(keys(plan('open', { mac: true }))).toMatch(/passkey/);
		expect(keys(plan('link', { mac: false }))).toMatch(/passkey/);
	});
});

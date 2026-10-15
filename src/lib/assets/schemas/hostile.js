/*
 * CARDS MADE TO DO HARM — every one the checker (./check.js) must refuse, made from a good card. The schemas' test
 * (./schemas.test.js) and the asset box's lab (/app/assets/box/) both run them, so the two prove the same thing.
 */

/**
 * @param {any} good a card that fits
 * @returns {Record<string, unknown>} what each tries, and the card (or its text)
 */
export const hostileCards = (good) => ({
	'a key that reaches the prototype': '{"__proto__": {"polluted": true}, "format": "asset-card"}',
	'a constructor key deep inside': { ...good, catalog: { ...good.catalog, parts: [{ id: 'a', label: 'A', constructor: { prototype: {} } }] } },
	'a key the schema does not know': { ...good, onload: 'x' },
	'an address to load from': { ...good, label: 'https://evil.example/x.js' },
	'a data address': { ...good, note: 'data:text/html,<script>alert(1)</script>' },
	'a source that is a script': { ...good, catalog: { ...good.catalog, sources: [{ label: 'x', url: 'javascript:alert(1)' }] } },
	'a source on another site without https': { ...good, catalog: { ...good.catalog, sources: [{ label: 'x', url: '//evil.example/' }] } },
	'too many parts': { ...good, catalog: { ...good.catalog, parts: Array.from({ length: 5001 }, (_, i) => ({ id: `p${i}`, label: 'x' })) } },
	'too many triangles': { ...good, triangles: 2_000_001 },
	'a size that is not finite': { ...good, size: [1, Infinity, 1] },
	'a size of four numbers': { ...good, size: [1, 1, 1, 1] },
	'a ref with a way out': { ...good, ref: 'machines/../../etc@1' },
	'a function': { ...good, label: () => 'x' },
	'too deep': { ...good, measures: { a: [[[[[[[[[[[[[1]]]]]]]]]]]]] } },
	'too long a text': JSON.stringify({ ...good, note: 'x'.repeat(5_000_000) }),
	'not JSON': '{"format": "asset-card",',
	'another format': { ...good, format: 'asset-pack' },
	'another version': { ...good, v: 2 },
	'an impostor with 7 views': { ...good, impostor: { file: 'impostor.webp', views: 7, pixels: 512, screen: 0.015 } },
	'a file name with a path': { ...good, lods: [{ level: 0, file: '../lod0.glb', triangles: 1, screen: 0.4 }] }
});

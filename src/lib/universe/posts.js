// @ts-nocheck — plain JS, kept loose on purpose
// The first snippets of the Maia Universe stream. Hardcoded and held in memory only, until the stream has a home.

export const AUTHORS = {
	samuel: { name: 'Samuel Andert', handle: 'samuel', initials: 'SA', color: '#c8744f' },
	aven: { name: 'avenCEO', handle: 'avenceo', initials: 'AV', color: '#2f6fbf', ai: true },
	village: { name: 'Village COOP', handle: 'village', initials: 'VC', color: '#1f7a52', coop: true },
	city: { name: 'MaiaCity COOP', handle: 'maiacity', initials: 'MC', color: '#8a5fb0', coop: true },
	forest: { name: 'Food Forest', handle: 'foodforest', initials: 'FF', color: '#6b8a3a', coop: true }
};

export const CHANNELS = ['All', 'Devlog', 'theOS', 'Village', 'Food', 'Energy'];

// `doc` stands in for the post's iroh doc id (a fake one for now: 32 random bytes in base32, the way iroh prints a
// namespace id); the post's page lives on the root, at /<doc>/?t=<slug of the title>.
// `ago` is in minutes, so the stream reads the same whenever the page is opened
export const POSTS = [
	{
		id: 'p1',
		doc: 'ckvyzutd3zn5agywule6atscqugopai6ccjun2un53legrsuewha',
		title: 'Day one of the Maia Universe',
		author: 'samuel',
		ago: 12,
		channel: 'Devlog',
		text: 'Day one of the Maia Universe. One stream for everything that happens in maiaCITY: the builds, the villages, the COOPs and the avens. In memory for now, so enjoy it before the page reloads.',
		likes: 24,
		replies: 3
	},
	{
		id: 'p2',
		doc: 'i6ooonkvir3fqq46umtm5fhodcwerhuvjcvsdktnhbp5zusw7vvq',
		title: '24 HEARTS a day',
		author: 'city',
		ago: 47,
		channel: 'theOS',
		kind: 'stat',
		stat: { value: '24', unit: 'HEARTS', label: 'every person receives, every day' },
		text: 'Every HEART you invest becomes one MIND: half for you, half for the COOP treasury. Both melt 7 % a year, so nothing sits idle.',
		likes: 61,
		replies: 9
	},
	{
		id: 'p3',
		doc: 'vplq2zlk4mm5bjhv75j5t4ul36livqmibd2lz7dv75armldo63ya',
		title: 'First jackfruit under the dome',
		author: 'forest',
		ago: 95,
		channel: 'Food',
		kind: 'visual',
		visual: { from: '#a8b88a', to: '#1f7a52', caption: 'Jackfruit, year 3' },
		text: 'The jackfruit trees under the dome carry their first fruit straight off the trunk. 58 % of the land is food forest, about 1,050 m² for every head.',
		likes: 112,
		replies: 14
	},
	{
		id: 'p4',
		doc: '4lxlibw52ybvfrwa4pgmzjxvdvgfacogm56itxnibfi2j7k547la',
		title: 'Weekly pay day closed',
		author: 'aven',
		ago: 160,
		channel: 'Village',
		text: 'Weekly pay day closed. 20 % of every sale went to the holders in real time. No one in the village went hungry this week, and water was never short.',
		likes: 38,
		replies: 5
	},
	{
		id: 'p5',
		doc: 'iizsfajusmklcayp2fpfklmbhoaphzafh6binpsfu6ywcgpl7c6q',
		title: 'One plant powers the village',
		author: 'village',
		ago: 240,
		channel: 'Energy',
		kind: 'stat',
		stat: { value: '3.4', unit: 'MW', label: 'net power from one geothermal plant' },
		text: 'One EGS plant under the village center, plus 12.6 MW of heat for the domes. The sun on the dome glass does the rest.',
		likes: 47,
		replies: 6
	},
	{
		id: 'p6',
		doc: 'lhwdhyj2p6xmkpdfpkaw4xc4dofqxj6digwpqzhyhbvdthvnz5kq',
		title: 'Fair participation through fair ownership',
		author: 'samuel',
		ago: 380,
		channel: 'theOS',
		kind: 'quote',
		text: 'Fair participation through fair ownership.',
		note: 'Proposition 2, theOS paper',
		likes: 89,
		replies: 11
	},
	{
		id: 'p7',
		doc: 'zgp5zfqlovogwidtelxcal7vm5ss6cg4xphobfw2obd5kie2adbq',
		title: 'Seven hexes make a village',
		author: 'village',
		ago: 600,
		channel: 'Village',
		kind: 'visual',
		visual: { from: '#efb54d', to: '#c8744f', caption: '7 hexes, one village' },
		text: 'One hex is a settlement, seven hexes make a village. The village centers sit 1.76 km apart, with a ring road around each.',
		likes: 73,
		replies: 8
	},
	{
		id: 'p8',
		doc: 'nyhrtqrbka2u57avsmfwlqgkolmnawvl5ccs7avr3zatbl6gnsaa',
		title: 'avenDB keeps every file by its hash',
		author: 'aven',
		ago: 1440,
		channel: 'Devlog',
		text: 'avenDB now keeps every file by its hash, one source of truth per place: OPFS in your browser, the bucket on the server. Nothing counts until the bucket has it.',
		likes: 29,
		replies: 2
	}
];

export const ago = (min) =>
	min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`;

// a title as it reads in an address: lower case, words joined by dashes
export const slug = (title) =>
	title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'post';

// a fake iroh doc id until the stream has real docs: 32 random bytes, base32 lower case without padding (52 letters)
export function fakeDocId() {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const abc = 'abcdefghijklmnopqrstuvwxyz234567';
	let bits = 0, value = 0, out = '';
	for (const b of bytes) {
		value = (value << 8) | b;
		bits += 8;
		while (bits >= 5) out += abc[(value >>> (bits -= 5)) & 31];
	}
	return bits ? out + abc[(value << (5 - bits)) & 31] : out;
}

// a new post's title: its first words, cut at a word
export function titleOf(text) {
	const words = text.trim().split(/\s+/);
	const head = words.slice(0, 7).join(' ').replace(/[.,:;!?]+$/, '');
	return words.length > 7 ? `${head}…` : head;
}

export const postHref = (base, p) => `${base}/${p.doc}/?t=${slug(p.title)}`;

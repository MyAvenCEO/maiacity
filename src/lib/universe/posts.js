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

// `ago` is in minutes, so the stream reads the same whenever the page is opened
export const POSTS = [
	{
		id: 'p1',
		author: 'samuel',
		ago: 12,
		channel: 'Devlog',
		text: 'Day one of the Maia Universe. One stream for everything that happens in maiaCITY: the builds, the villages, the COOPs and the avens. In memory for now, so enjoy it before the page reloads.',
		likes: 24,
		replies: 3
	},
	{
		id: 'p2',
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
		author: 'aven',
		ago: 160,
		channel: 'Village',
		text: 'Weekly pay day closed. 20 % of every sale went to the holders in real time. No one in the village went hungry this week, and water was never short.',
		likes: 38,
		replies: 5
	},
	{
		id: 'p5',
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

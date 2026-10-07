/*
 * The domes of Sandbox 3, in the order a village grows them: the Buildings app's (./index.js) and Sandbox 3's page
 * (src/routes/app/games/sandbox-3), on their own so the sandbox loads none of the models.
 */

/** @typedef {import('$lib/sandbox-2/interior/interior').DomeKind} DomeKind */

/** the domes in the order a village grows them, each with its picture from inside (by hash) and what it is */
/** @type {{ kind: DomeKind, image: string, text: string, flora?: boolean }[]} */
export const DOMES_IN_ORDER = [
	{ kind: 'tent', image: 'ebfe67f916716b730cfb73b9dc90713a42675f8a092ffb9e9d6eb70cfaab160b.jpg' /* tent */, text: 'Where it starts: a canvas bell tent for two, mats and sleeping bags, a lantern on the pole, and a campfire outside the door.' },
	{ kind: 'glamp', image: '4cbaffdaeef4744aa35dac03bb2f636baaa062af79647a15cf33cb0274e8e979.jpg' /* glamping-room */, text: 'The first homes after the tents: a home for four in zones round a garden, and a door onto a deck and the forest outside.' },
	{ kind: 'home', image: 'c935e441677083b12f6a009aa98946ee2e9526a57a23cf5df053cd99d027f7cd.jpg' /* home-from-the-gallery */, text: 'The first permanent ring: a seven-layer forest and a kitchen garden below, rooms on the gallery above, a terrace under vines.' },
	{ kind: 'large', image: '694121fdfc58ecafd5e7b4ae64e30bebd14ab7d9d199264906c1641f1891d6a4.jpg' /* large-terraces */, text: 'The second ring, nearly twice the size: two floors of rooms, a deeper forest, a stream running to a pond.' },
	// (no picture of its own yet: the medium dome's stands in)
	{ kind: 'grand', image: '694121fdfc58ecafd5e7b4ae64e30bebd14ab7d9d199264906c1641f1891d6a4.jpg' /* large-terraces */, text: 'The third ring: a green middle, two floors of rooms round the south, and on the north a sunken rainforest pond with a waterfall down a stone wall, its water the dome’s warmth store, a creek running from it, all grown from our real plants, as Sandbox 4’s domes are.', flora: true },
	{ kind: 'master', image: '0eb03432164eedc6f5ef7580f119d9197abd10fe2eb62888f348002e8e4382f7.jpg' /* master-stage */, text: 'The centre of the village: a round stage sunk into the floor, and the workshops and kitchens round its edge.' },
	{ kind: 'factory', image: '7291d181201e0a5c5f5794e6e1c147529d3e220e6196d151374fb5030fba7584.jpg' /* factory */, text: 'The factory coop that makes the domes’ glass from sand, quartz and copper: five floors round one great lift.' }
];

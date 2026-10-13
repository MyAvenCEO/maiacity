// @ts-nocheck — plain JS
/**
 * MaiaCity V1's first-run story: the journey every player makes at their own seat. It starts on the road, in a packed
 * old travel van down a sandy highway: inside it, rolling on, the newcomer hears the vision (a world where no one must
 * work to survive), learns of the HEARTS and mints their first year of them. Then the road ends at the bus stop by the
 * abandoned gas station, the future centre of MaiaCity. There the newcomer meets the COOPs and their MINDs and
 * invests into the MaiaCity COOP, the owner of all the land. Then into the Village COOP's pickup (the first player
 * drives it; the second is fetched by the first) and along the gravel track to the village's centre hex, where the
 * Village COOP keeps the ElectroCube and the tent in an old shed, the BatteryCube and a solar panel beside it: invest
 * there; the first loads the ElectroCube and the tent and pitches the tent at home, the second loads the BatteryCube
 * and the panel and sets them up beside it. Then the Tribe COOP, the weekly pay day and the melt.
 *
 * The story plays as a film: each step's words are its voice-over, a line a shot (lines). Steps that only tell
 * something are done once told; steps that ask for a move (mint, invest) are done when the game shows it, so the story
 * picks up wherever the player is. Each step also says where the world is at that moment
 * (at: where the pickup and the player are, cube: where the powercube is, place: what the camera looks at, reveal:
 * how much of the locked land shows) and, for the moments the world plays (intro, drive, load), what plays.
 */
import { heartsValue, inHearts } from '../../../game/maiacity-v1/engine.js';

const f = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/** how long a line of the voice-over holds (s): a breath, and a third of a second a word */
export const lineDur = (line) => 1.8 + line.split(/\s+/).length * 0.34;

/** the HEARTS a seat has invested into a COOP, from the ledger */
export const investedBy = (view, seat, coop) => view.ledger.filter((e) => e.kind === 'invest' && e.from === `player:${seat}` && e.to === `coop:${coop}`).reduce((a, e) => a + e.amount, 0);

/** where the world stands when there is no story: home, the powercube in the tribe's yard, the camera on the tribe */
export const AT_HOME = { at: 'home', cube: 'home', battery: 'store', place: 'tribe', reveal: 2 };

/** the story for one seat, as it stands in the game now: every step with its words, whether it is done, and where the world is */
export function story(view, seat, seen) {
	const me = view.players[seat];
	const other = view.players[seat === 'A' ? 'B' : 'A'];
	const first = seat === 'A'; // the first to arrive drives; the second is fetched
	const c = view.coops;
	const st = view.settings;
	const hv = heartsValue(view);
	const hearts = `${me.name.charAt(0).toLowerCase()}${me.name.slice(1).replace(/\s+/g, '')}HEARTS`;
	const year = st.heartsPerDay * 28 * 13;
	const invest = (id, goal) => ({ kind: 'invest', coop: id, goal, have: investedBy(view, seat, id), done: investedBy(view, seat, id) >= goal - 0.5 });
	const next = (id) => ({ kind: 'next', done: !!seen[id] });
	// the first player fetches the ElectroCube and the tent from the village shed; the second, the BatteryCube and the solar panel
	// still on the road: the van rolls on, the camera in its back seat, while the idea is told and the first HEARTS minted
	// the second fetches the Village COOP's BatteryCube and solar panel, and sets them up beside the tent
	const inVan = { at: 'van', cube: first ? 'shed' : 'home', tent: first ? 'shed' : 'up', battery: 'store', place: 'van' };
	const atStop = { at: 'stop', cube: first ? 'shed' : 'home', tent: first ? 'shed' : 'up', battery: 'store', place: 'centre' };
	const atStore = { at: 'village', cube: first ? 'shed' : 'home', tent: first ? 'shed' : 'up', battery: 'store', place: 'village' };
	const home = { at: 'home', cube: 'home', tent: 'up', battery: first ? 'store' : 'home', place: 'tribe' };
	const o = other.founder ? other.name : 'the first settler';
	const pct = (x) => `${f(x * 100)} %`;
	// each step's words are its voice-over, one line a shot (lines); the moments the world plays (drive, load, build)
	// cut one shot a line, and a line holds its shot as long as it takes to tell
	const say = (step, ...lines) => ({ ...step, lines, text: lines.join(' ') });
	return [
		say({ id: 'arrive', chapter: 'The road', title: 'On the road', kind: 'intro', part: 'road', done: !!seen.arrive, ...inVan },
			'The old van rattles down the sand highway, full to the roof.'),
		say({ id: 'vision', chapter: 'The road', title: 'Imagine a world', hint: '', ...next('vision'), ...inVan },
			'Imagine villages that grow their own food, make their own power and build their own homes.',
			'An economy upgraded from the ground up, owned by the people who use it.',
			'Every year, life gets better for everyone. No one is left behind.',
			'The largest civilisation movement of our time begins at the end of this road.'),
		say({ id: 'hearts', chapter: 'The road', title: 'Every hour, you receive a HEART', hint: '', ...next('hearts'), ...inVan },
			'The woman beside you smiles and shows you her phone.',
			`In MaiaCity, every person receives ${f(st.heartsPerDay)} HEARTS a day, one every hour, for life. Yours are called ${hearts}.`,
			'A HEART is not money. It is your right to become an owner.'),
		say({ id: 'mint', chapter: 'The road', title: 'Collect your first year of HEARTS', hint: 'mintbar', kind: 'mint', done: !!me.lastMint, ...inVan },
			'Your HEARTS ripen like fruit. You mint them to make them yours.',
			`Your first mint brings a whole year at once: ${f(st.starterPack ?? year)} HEARTS. Mint them now, while the road rolls by.`),
		say({ id: 'arrival', chapter: 'The road', title: 'The end of the road', kind: 'intro', part: 'arrive', done: !!seen.arrival, ...inVan },
			'The van slows down. Ahead, the road ends.'),
		say({ id: 'welcome', chapter: 'MaiaCity', title: `Welcome to MaiaCity, ${me.name}`, hint: '', ...next('welcome'), ...atStop, act: 'look up', close: true },
			'The dust settles over a bus stop and an abandoned gas station.',
			`The old world left this place behind. ${other.founder ? `You and ${other.name} are` : 'You are'} among its very first people.`),
		say({ id: 'station', chapter: 'MaiaCity', title: 'The heart of a city to come', hint: '', ...next('station'), ...atStop, act: 'point' },
			'One day a square full of life stands here: markets, workshops, gardens and homes.',
			'Here no single owner can leave and take it all. It belongs to the people who live here.'),
		say({ id: 'coops', chapter: 'Owning together', title: 'Meet the COOPs', hint: 'coops', ...next('coops'), ...atStop, act: 'think', close: true },
			'Everything here belongs to a COOP, a company its people own together.',
			'Invest 1 HEART into a COOP, and it becomes 1 MIND: a share of that COOP.',
			`Half the MIND is yours, four tenths stay in the COOP's treasury, and ${pct(st.poolShare ?? 0.1)} go to the city pool.`,
			'COOPs never hold HEARTS. Only people do.'),
		say({ id: 'maia', chapter: 'The city', title: `The ${c.maia.name}: the ground beneath your feet`, hint: 'invest', reveal: 2, ...invest('maia', 5000), ...atStop, place: 'city' },
			`All 49 hexes of land belong to the ${c.maia.name}, so no one can ever buy them away from you.`,
			'Every tribe pays it a small ground rent. Invest 5,000 HEARTS, and the land is, in part, yours.'),
		say({ id: 'pool', chapter: 'The city', title: 'The city pool keeps everything fair', hint: 'swap', ...next('pool'), ...atStop },
			`The city pool holds a little of every MIND, about ${f(inHearts(view, view.pool, hv))} ❤︎ now.`,
			'Anyone can swap one MIND for another there, at a fair price, at any time.'),
		first
			? say({ id: 'ride', chapter: 'The track', title: 'Your ride is waiting', kind: 'drive', leg: 'village', done: !!seen.ride, ...atStop },
				`At the gas station waits the ${c.village.name}'s pickup, the key in it.`,
				'Two jerrycans of petrol go in the back, for the ElectroCube you will fetch.',
				'The pickup belongs to the COOP. Today it serves you.',
				'A narrow track leaves the road and winds east, towards the green.',
				'The centre of your village.')
			: say({ id: 'ride', chapter: 'The track', title: `${other.founder ? other.name : 'Someone'} comes to fetch you`, kind: 'drive', leg: 'village', fetch: true, done: !!seen.ride, ...atStop },
				`A cloud of dust on the track: ${o} comes to fetch you in the ${c.village.name}'s pickup.`,
				'You wave, and climb in.',
				'The village lies on the way home.',
				'The centre of your village.'),
		say({ id: 'village', chapter: 'The village', title: `The ${c.village.name}: the tools that make life easy`, hint: 'invest', reveal: 1, ...invest('village', 2000), ...atStore },
			`The pickup, the ElectroCube, the BatteryCube and the solar panel all belong to the ${c.village.name}.`,
			`Whoever uses a machine pays its rent, and ${pct(st.dividendShare ?? 0.2)} of every sale goes to its owners.`,
			'Invest 2,000 HEARTS, and every machine here works a little for you.'),
		first
			? say({ id: 'cube', chapter: 'The village', title: 'Load the ElectroCube and the tent', kind: 'load', done: !!seen.cube, ...atStore },
				'You step out at the old shed, the village store to be.',
				'Inside waits the ElectroCube, open hardware anyone can build. Up the ramp it goes.',
				'Then the little dome tent, packed in its canvas.',
				'Power and a roof: all your tribe needs to begin.')
			: say({ id: 'cube', chapter: 'The village', title: 'Load the BatteryCube and the solar panel', kind: 'load', what: 'power', done: !!seen.cube, ...atStore },
				`You step out at the old shed. ${o} took the ElectroCube and the tent home on the first day.`,
				'Beside the shed waits the BatteryCube: four BatteryPacks in the same open frame. Up the ramp it goes.',
				'Then the solar panel on its rack.',
				'Sun by day, stored for the night: no more petrol for the lights.'),
		say({ id: 'drive', chapter: 'The village', title: 'The last stretch', kind: 'drive', leg: 'tribe', done: !!seen.drive, ...atStore, cube: first ? 'bed' : 'home', tent: first ? 'bed' : 'up', battery: first ? 'store' : 'bed' },
			'Back in, and on.',
			'The track bends through the grass to the edge of the village.',
			'Your hex. Nothing stands here yet.'),
		...(first
			? [say({ id: 'pitch', chapter: 'Your home', title: 'Pitch your tent', kind: 'build', done: !!seen.pitch, ...home, cube: 'bed', tent: 'bed' },
				'You carry the canvas to the middle of the clearing and unroll it.',
				'Strut by strut, the little dome rises.',
				'Then the ElectroCube to its yard. It starts, and the light comes on.')]
			: [say({ id: 'pitch', chapter: 'Your home', title: 'Set up the sun', kind: 'build', what: 'power', done: !!seen.pitch, ...home, battery: 'bed' },
				'Down the ramp comes the BatteryCube, beside the ElectroCube.',
				'The solar panel goes up, facing the sun.',
				'One cable, and the tent runs on sunlight. The ElectroCube can rest.')]),
		say({ id: 'tribe', chapter: 'Your home', title: `The ${c.tribe.name}: your home`, hint: 'invest', reveal: 0, ...invest('tribe', 1000), ...home },
			`${first ? 'Your tent' : `The tent ${o} raised`} belongs to the ${c.tribe.name}, the COOP of this one hex.`,
			'It rents the land from the city and the machines from the village. You rent your bed from it.',
			'Invest 1,000 HEARTS, and you own a part of your own home.'),
		say({ id: 'payday', chapter: 'Pay day', title: 'Every week, the city pays you back', hint: 'you', ...next('payday'), ...home },
			'Every game week is pay day. The rents flow: from you to your tribe, from your tribe to the land and the machines.',
			'And a fifth of every rent flows back to the people who own the COOPs. That is you.'),
		say({ id: 'melt', chapter: 'Pay day', title: 'Owning beats hoarding', hint: '', ...next('melt'), ...home },
			`HEARTS and MINDs melt ${pct(st.demurrage)} a year, like ice in the sun.`,
			'No one gets rich sitting on a pile. You gain by owning what people really use.',
			'A rule feels wrong? Propose a MIP, and both of you sign it.'),
		say({ id: 'done', chapter: 'Your city', title: 'You are an owner of MaiaCity now', hint: '', kind: 'done', done: !!seen.done, ...home },
			'The land, the machines and your home are partly yours.',
			'Mint every day, and the city pays you every week.',
			'Today it is one tent on one hex of grass. What it becomes is up to the two of you.')
	];
}

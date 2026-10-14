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
 * and the panel and sets them up beside it. At the shed each also picks a seedling, a food tree or bush a few
 * centimetres high, and plants it once home is set up: their first tree, named after them, growing on the game clock
 * (./trees.js). Then the Tribe COOP, the weekly pay day and the melt.
 *
 * The story plays as a film: each step's words are its voice-over, a line a shot (lines), and in the van each line's
 * shot shows what it says (shots: the two of you, her face over your shoulder, your face as you listen; talk: the woman
 * beside you turned to you, telling you; hold: the shot that stays while the story waits on your move). Steps that only tell
 * something are done once told; steps that ask for a move (mint, invest) are done when the game shows it, so the story
 * picks up wherever the player is. Each step also says where the world is at that moment
 * (at: where the pickup and the player are, cube: where the powercube is, place: what the camera looks at, reveal:
 * how much of the locked land shows) and, for the moments the world plays (intro, drive, load), what plays.
 */
import { SEEDLINGS, heartsValue, inHearts } from '../../../game/maiacity-v1/engine.js';
import { milestones } from './trees.js';

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
	const inVan = { at: 'van', cube: first ? 'shed' : 'home', tent: first ? 'shed' : 'up', battery: 'store', place: 'van', pot: 'bench' };
	const atStop = { at: 'stop', cube: first ? 'shed' : 'home', tent: first ? 'shed' : 'up', battery: 'store', place: 'centre', pot: 'bench' };
	// the first player, the jerrycans loaded, sitting at the wheel of the pickup at the gas station; the second still waits at the stop
	const inCab = first ? { ...atStop, at: 'cab' } : atStop;
	const atStore = { at: 'village', cube: first ? 'shed' : 'home', tent: first ? 'shed' : 'up', battery: 'store', place: 'village', pot: 'bench' };
	// the seedling: on the shed's bench, then in the pickup's bed, waiting beside the tent, and planted
	const pot = me.tree ? 'planted' : me.seedling ? 'home' : 'bench';
	const home = { at: 'home', cube: 'home', tent: 'up', battery: first ? 'store' : 'home', place: 'tribe', pot };
	// loaded at the shed: the first player's ElectroCube and tent in the bed, or the second's BatteryCube and panel
	const loaded = seen.pitch ? { cube: 'home', tent: 'up', battery: home.battery } : { cube: first ? 'bed' : 'home', tent: first ? 'bed' : 'up', battery: first ? 'store' : 'bed' };
	const inBed = me.seedling && !me.tree ? 'bed' : pot;
	const kind = SEEDLINGS.find((x) => x.id === (me.tree?.plant ?? me.seedling)) ?? SEEDLINGS[0];
	const grows = milestones(kind.id, me.tree?.name ?? me.name);
	// a span of game months in words, and how many real days it lasts (a game month lasts hoursPerMonth real hours)
	const span = (n) => {
		if (n < 2) return 'a game month';
		if (n < 13) return `${n} game months`;
		const y = Math.round((n / 13) * 2) / 2;
		return y === 1 ? 'a game year' : `about ${f(y, y % 1 ? 1 : 0)} game years`;
	};
	const real = (n) => `${f((n * (st.hoursPerMonth ?? 24)) / 24)} real days`;
	const o = other.founder ? other.name : 'the first settler';
	const pct = (x) => `${f(x * 100)} %`;
	// each step's words are its voice-over, one line a shot (lines); the moments the world plays (drive, load, build)
	// cut one shot a line, and a line holds its shot as long as it takes to tell. A null line is a shot without words:
	// the picture tells it (Samuel 2026-10-13: tell less of what the newcomer does, show it, and narrate what matters)
	const say = (step, ...lines) => ({ ...step, lines, text: lines.filter(Boolean).join(' ') });
	// the story as a film (the storyteller's, director's and editor's skills, .claude/skills): one transformation, from
	// renting everything to owning a part of all of it; one question, opened in the first line (can no one have to work
	// to survive?) and answered on pay day; the pain before the promise; every scene a step; the action shown, the voice
	// on what it means; breath beats where the picture speaks; setups paid off (the petrol runs the ElectroCube, the
	// seedling grows into a tree that feeds those who come after); the last image, one tent on one hex, mirrors the
	// first, one van on one road
	return [
		// Act I, the road: the promise and the pain, the vision, the HEARTS as she tells of them, the first mint
		say({ id: 'arrive', chapter: 'The road', title: 'On the road', kind: 'intro', part: 'road', done: !!seen.arrive, ...inVan },
			'At the end of this road, they say, no one has to work to survive.',
			'Where you come from, others own the land, the homes and the tools, and you pay them all your life.',
			'No one here is running away. Everyone is going towards something.'),
		say({ id: 'vision', chapter: 'The road', title: 'Imagine a world', hint: '', ...next('vision'), ...inVan, shots: ['seat', 'window', 'faces', 'aerial'] },
			'Villages that grow their own food, make their own power and build their own homes.',
			'An economy owned by the people who use it.',
			null,
			'Perhaps the most important civilisation-building project of our time: the blueprint for a new generation of cities.'),
		say({ id: 'hearts', chapter: 'The road', title: 'Every hour, you receive a HEART', hint: '', ...next('hearts'), ...inVan, shots: ['two', 'over', 'listen'], talk: true },
			null,
			`“There, everyone receives ${f(st.heartsPerDay)} HEARTS a day, one every hour, for life. Yours will be ${hearts}.”`,
			'“A HEART is not money. It is your right to become an owner.”'),
		say({ id: 'mint', chapter: 'The road', title: 'Collect your first year of HEARTS', hint: 'mintbar', kind: 'mint', done: !!me.lastMint, ...inVan, shots: ['her', 'close'], hold: 'close', talk: true },
			'“They ripen like fruit. Mint them, and they are yours.”',
			`“Your first mint is a whole year: ${f(st.starterPack ?? year)} HEARTS.”`),
		// Act II, owning together: the end of the road, the COOPs, the land, the pool, the village and its machines
		say({ id: 'arrival', chapter: 'The road', title: 'The end of the road', kind: 'intro', part: 'arrive', done: !!seen.arrival, ...inVan },
			'The old world passed this place by and left it behind.',
			null,
			null,
			'Welcome to MaiaCity.'),
		// the second waits at the stop to be fetched; the first does not wait (Samuel 2026-10-13): they walk over to the
		// gas station and load the jerrycans into the village's pickup while the city is told, and get in while the COOPs
		// are; the ElectroCube is not named until it waits in the shed
		...(first
			? []
			: [say({ id: 'welcome', chapter: 'MaiaCity', title: `Welcome to MaiaCity, ${me.name}`, hint: '', ...next('welcome'), ...atStop, act: 'look up', close: true },
				`${other.founder ? `${other.name} came before you. You are` : 'You are'} among its very first people.`)]),
		first
			? say({ id: 'station', chapter: 'MaiaCity', title: 'The heart of a city to come', hint: '', kind: 'fuel', done: !!seen.station, ...atStop },
				'You are among its very first people.',
				'In 16 years, a whole city stands here: a square full of life, markets, workshops, gardens and homes.',
				null,
				'Here no single owner can leave and take it all. It belongs to the people who live here.')
			: say({ id: 'station', chapter: 'MaiaCity', title: 'The heart of a city to come', hint: '', ...next('station'), ...atStop, act: 'point' },
				'In 16 years, a whole city stands here: a square full of life, markets, workshops, gardens and homes.',
				'Here no single owner can leave and take it all. It belongs to the people who live here.'),
		first
			? say({ id: 'coops', chapter: 'Owning together', title: 'Meet the COOPs', hint: 'coops', kind: 'board', done: !!seen.coops, ...atStop, at: 'pickup' },
				`The pickup belongs to the ${c.village.name}: a COOP, a company its people own together.`,
				'Invest 1 HEART into a COOP, and it becomes 1 MIND: a share of that COOP.',
				`Half the MIND is yours, four tenths stay in the COOP's treasury, and ${pct(st.poolShare ?? 0.1)} go to the city pool.`,
				'COOPs never hold HEARTS. Only people do.')
			: say({ id: 'coops', chapter: 'Owning together', title: 'Meet the COOPs', hint: 'coops', ...next('coops'), ...atStop, act: 'think', close: true },
				'Everything here belongs to a COOP, a company its people own together.',
				'Invest 1 HEART into a COOP, and it becomes 1 MIND: a share of that COOP.',
				`Half the MIND is yours, four tenths stay in the COOP's treasury, and ${pct(st.poolShare ?? 0.1)} go to the city pool.`,
				'COOPs never hold HEARTS. Only people do.'),
		// the land, without its rent: the ground rent is told where the tribe pays it (Samuel 2026-10-13); the city
		// grows far beyond the first plot, so no count of hexes
		say({ id: 'maia', chapter: 'The city', title: `The ${c.maia.name}: the ground beneath your feet`, hint: 'invest', reveal: 2, ...invest('maia', 5000), ...inCab, place: 'city' },
			`The land of MaiaCity belongs to the ${c.maia.name}, so no one can ever buy it away from you.`,
			'Invest 5,000 HEARTS, and the land is, in part, yours.'),
		say({ id: 'pool', chapter: 'The city', title: 'The city pool keeps everything fair', hint: 'swap', ...next('pool'), ...inCab },
			`The city pool holds a little of every MIND, about ${f(inHearts(view, view.pool, hv))} ❤︎ now.`,
			'Anyone can swap one MIND for another there, at a fair price, at any time.'),
		first
			? say({ id: 'ride', chapter: 'The track', title: 'Your ride is waiting', kind: 'drive', leg: 'village', done: !!seen.ride, ...inCab },
				null,
				'The centre of your village.')
			: say({ id: 'ride', chapter: 'The track', title: `${other.founder ? other.name : 'Someone'} comes to fetch you`, kind: 'drive', leg: 'village', fetch: true, done: !!seen.ride, ...atStop },
				`${o} comes to fetch you in the ${c.village.name}'s pickup.`,
				null,
				null,
				'The centre of your village.'),
		say({ id: 'village', chapter: 'The village', title: `The ${c.village.name}: the tools that make life easy`, hint: 'invest', reveal: 1, ...invest('village', 2000), ...atStore },
			`Every machine at the old shed belongs to the ${c.village.name} too.`,
			`Whoever uses a machine pays its rent, and ${pct(st.dividendShare ?? 0.2)} of every sale goes to its owners.`,
			'Invest 2,000 HEARTS, and every machine here works a little for you.'),
		// the loading at the shed ends at the bench of seedlings, where the choice is made (Samuel 2026-10-13: the pick
		// belongs inside the loading, not after it)
		first
			? say({ id: 'cube', chapter: 'The village', title: 'Load the ElectroCube and the tent', kind: 'load', done: !!seen.cube, ...atStore },
				null,
				'The ElectroCube: open hardware anyone can build. Your petrol runs it.',
				null,
				'And every newcomer takes one more thing home: a tree of their own.')
			: say({ id: 'cube', chapter: 'The village', title: 'Load the BatteryCube and the solar panel', kind: 'load', what: 'power', done: !!seen.cube, ...atStore },
				`${o} took the ElectroCube and the tent home on the first day.`,
				'Yours is the BatteryCube: four BatteryPacks in the same open frame.',
				null,
				'And every newcomer takes one more thing home: a tree of their own.'),
		// a seedling for each newcomer, from the bench beside the shed (Samuel 2026-10-13): five food trees and bushes
		// that grow outdoors here, a few centimetres high; the player picks one, standing at the bench
		say({ id: 'seedling', chapter: 'The village', title: 'Pick your first tree', kind: 'pick', done: !!(me.seedling || me.tree), ...atStore, ...loaded, at: 'bench', place: 'bench' }, null, null),
		say({ id: 'drive', chapter: 'The village', title: 'The last stretch', kind: 'drive', leg: 'tribe', done: !!seen.drive, ...atStore, at: 'bench', cube: first ? 'bed' : 'home', tent: first ? 'bed' : 'up', battery: first ? 'store' : 'bed', pot: inBed },
			null,
			null,
			'Home: one hex of land at the edge of the village.',
			'Nothing stands here yet.'),
		// Act III, your home: the tent and the power, the first tree, the Tribe COOP, pay day (the question answered)
		...(first
			? [say({ id: 'pitch', chapter: 'Your home', title: 'Pitch your tent', kind: 'build', done: !!seen.pitch, ...home, cube: 'bed', tent: 'bed', pot: inBed },
				null,
				'A home you raised with your own hands.',
				'Power and a roof: all your tribe needs to begin.')]
			: [say({ id: 'pitch', chapter: 'Your home', title: 'Set up the sun', kind: 'build', what: 'power', done: !!seen.pitch, ...home, battery: 'bed', pot: inBed },
				null,
				'Sun by day, stored for the night.',
				'One cable, and the tent runs on sunlight. The ElectroCube can rest.')]),
		// and now the first tree, in the ground beside the tent, named after the player, growing on the game clock
		say({ id: 'plant', chapter: 'Your home', title: `Plant your ${kind.label.toLowerCase()}`, kind: 'plant', done: !!me.tree, ...home, pot: me.tree ? 'planted' : 'home', place: `plot${seat}` },
			'Your home stands. Now plant your first tree.'),
		say({ id: 'tree', chapter: 'Your home', title: `${me.tree?.name ?? me.name}, your first tree`, hint: '', ...next('tree'), ...home, place: `tree${seat}` },
			`It carries your name now: ${me.tree?.name ?? me.name}.`,
			`Its first ${kind.fruit} come in ${span(grows.fruit)}: ${real(grows.fruit)} from today.`,
			'Look after it, and one day it feeds the people who come after you.'),
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

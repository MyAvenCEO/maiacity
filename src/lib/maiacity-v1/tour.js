// @ts-nocheck — plain JS
/**
 * MaiaCity V1's first-run story: the journey every player makes at their own seat (the script: Samuel 2026-10-14,
 * /mnt/project-files/maiacity-v1/story-script-v2.md). It opens on one question (what do you live on, when your time no
 * longer pays for your life?) and answers it with ownership. On the road, in a packed old travel van down a sandy
 * highway, the newcomer hears of the vision and of the HEARTS and mints all of them at once (the 7 % equilibrium). The road ends at the
 * bus stop by the abandoned gas station, the future centre of MaiaCity; the Village COOP's pickup takes them along the
 * gravel track to the village's old shed (the first player drives it; the second is fetched by the first), and on
 * home to one empty hex of grass. Every invest plays on a drive, shortly before arriving: into the MaiaCity COOP on the
 * way to the shed, into the Village COOP on the way home; only the Tribe COOP's is at home, at the tent. At the shed
 * the first loads the ElectroCube and the tent and pitches the tent at home; the second loads the BatteryCube and the
 * panel and sets them up beside it. Last, each plants the seed they brought from home: they walk to a spot outside the
 * core circle, mark it with a plant stake, pick the seed from their backpack, plant it and water it from the 1 l
 * bottle: their first tree, named after them, growing a game month for each day it is watered (./trees.js).
 *
 * The story plays as a film: each step's words are its voice-over, a line a shot (lines), and each line's shot shows
 * what it says (shots: in the van, the views of the ride; talk: the woman beside you turned to you, telling you; hold:
 * the shot that stays while the story waits on your move). Steps that only tell something are done once told; steps
 * that ask for a move (mint, invest, mark, pick, plant) are done when the game shows it, so the story picks up wherever
 * the player is. Each step also says where the world is at that moment (at: where the pickup and the player are, cube:
 * where the powercube is, place: what the camera looks at, hour: the light, reveal: how much of the locked land shows)
 * and, for the moments the world plays (intro, station, drive, load, build, sow), what plays.
 */

import { equilibriumOf } from '../../../game/maiacity-v1/engine.js';

/** what each player invests on the way (Samuel 2026-10-15): 50,000 HEARTS into the MaiaCity COOP, 25,000 into the
 * Village COOP and 25,000 into the Tribe COOP, of the 120,379 their first mint brings */
export const STORY_INVESTS = { maia: 50000, village: 25000, tribe: 25000 };

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
	const st = view.settings;
	const invest = (id, goal) => ({ kind: 'invest', coop: id, goal, have: investedBy(view, seat, id), done: investedBy(view, seat, id) >= goal - 0.5 });
	const next = (id) => ({ kind: 'next', done: !!seen[id] });
	const o = other.founder ? other.name : 'The first settler';
	// where the world is: still on the road, the van rolling on, the camera in its back seat; at the bus stop; the
	// first player at the wheel of the pickup on the gas station's forecourt; in the pickup rolling slowly on towards
	// the shed or home while an invest waits (cruise); at the shed; at home. The first fetches the ElectroCube and the
	// tent from the shed, the second the BatteryCube and the solar panel
	const kit = { cube: first ? 'shed' : 'home', tent: first ? 'shed' : 'up', battery: 'store' };
	const inVan = { at: 'van', ...kit, place: 'van', hour: 8.6 };
	const atStop = { at: 'stop', ...kit, place: 'centre', hour: 9 };
	const toShed = { at: 'cruise', cruise: 'shed', ...kit, place: 'cab', hour: 9.8 };
	const atStore = { at: 'village', ...kit, place: 'village', hour: 10.4 };
	const loaded = { cube: first ? 'bed' : 'home', tent: first ? 'bed' : 'up', battery: first ? 'store' : 'bed' };
	const toHome = { at: 'cruise', cruise: 'home', ...loaded, place: 'bed', hour: 12 };
	// at home, late in the afternoon, the light going gold; where the first tree grows: the spot marked (or the tree)
	const spot = me.tree ?? me.spot ?? null;
	const home = { at: 'home', cube: 'home', tent: 'up', battery: first ? 'store' : 'home', place: 'tribe', hour: 16.7, spot, marked: !!spot };
	const atSpot = { ...home, by: 'spot' };
	// each step's words are its voice-over, one line a shot (lines); the moments the world plays cut one shot a line,
	// and a line holds its shot as long as it takes to tell. A null line is a shot without words: the picture tells it
	const say = (step, ...lines) => ({ ...step, lines, text: lines.filter(Boolean).join(' ') });
	// the story as a film (the storyteller's, director's and editor's skills, .claude/skills): one transformation, from
	// living on your time to living on what you own; one question, opened in the first line and answered after the
	// last invest; the pain before the promise (the roof that was never yours); setups paid off (the seed and the bottle in
	// the backpack, the ElectroCube powering the tent); the last image, the next van on the road, mirrors the first
	return [
		// Act I, the road: the question, the vision, the HEARTS as she tells of them, the first mint
		say({ id: 'arrive', chapter: 'The road', title: 'On the road', kind: 'intro', part: 'road', done: !!seen.arrive, ...inVan },
			'What do you live on, when your time no longer pays for your life?'),
		say({ id: 'road', chapter: 'The road', title: 'On the road', hint: '', ...next('road'), ...inVan, shots: ['aisle', 'gaze', 'lookup', 'pack'] },
			'Where you come from, you sell your hours to pay for land, homes and tools that others own.',
			'And every year, machines need fewer of those hours.',
			'So you set out to find another way to live.',
			'With a backpack, a bottle of water and a seed from home.'),
		say({ id: 'vision', chapter: 'The road', title: 'Imagine', hint: '', ...next('vision'), ...inVan, shots: ['horizon', 'dot'] },
			'Imagine a whole city that grows its own food, makes its own power and builds its own homes.',
			"There is a vision of it: a blueprint for a new generation of cities. It's why you got on this van."),
		say({ id: 'hearts', chapter: 'The road', title: 'A HEART every hour', hint: '', ...next('hearts'), ...inVan, shots: ['two', 'over', 'listen'], talk: true },
			null,
			'“There, every hour of your life brings you a HEART. Not for your work. For your life.”',
			'“A HEART is not money. It is your right to become an owner, and only people get it.”'),
		say({ id: 'mint', chapter: 'The road', title: 'Mint all your HEARTS at once', hint: 'mintbar', kind: 'mint', done: !!me.lastMint, ...inVan, shots: ['mcu'], hold: 'mcu', talk: true },
			`“Your first mint brings all your HEARTS at once: ${f(st.starterPack ?? equilibriumOf(st))}, as many as you can ever hold.”`),
		// Act II, the end of the road: the stop, the station, co-owner of MaiaCity on the way to the shed, the shed and
		// its machines, co-owner of them on the way home, the empty hex
		say({ id: 'arrival', chapter: 'The end of the road', title: 'The end of the road', kind: 'intro', part: 'arrive', done: !!seen.arrival, ...inVan },
			'The old world passed this place by.',
			'Here, the old road ends.',
			'And something new begins.',
			'Welcome to MaiaCity. You are among our very first human founders.'),
		// the first walks over to the pickup at the pumps and gets in; the second waits at the stop to be fetched
		first
			? say({ id: 'station', chapter: 'The end of the road', title: 'The station', kind: 'station', done: !!seen.station, ...atStop },
				'Today, its city centre is just a gas station. In 16 years, a thriving solarpunk city stands here, feeding 1 million co-founders.',
				null,
				'And from the first day, you can own a part of it.')
			: say({ id: 'station', chapter: 'The end of the road', title: 'The station', hint: '', ...next('station'), ...atStop, act: 'point', close: true },
				'Today, its city centre is just a gas station. In 16 years, a thriving solarpunk city stands here, feeding 1 million co-founders.'),
		first
			? say({ id: 'ride', chapter: 'The end of the road', title: 'Co-owner of MaiaCity', kind: 'drive', leg: 'village', done: !!seen.ride, ...atStop, at: 'cab' },
				'MaiaCity belongs to the MaiaCity COOP: a company owned by its people.',
				'Its land is never sold, so no one can ever buy it away from you.',
				'Every HEART you invest becomes a MIND: your share of MaiaCity.')
			: say({ id: 'ride', chapter: 'The end of the road', title: 'Co-owner of MaiaCity', kind: 'drive', leg: 'village', fetch: true, done: !!seen.ride, ...atStop },
				`${o} comes to fetch you.`,
				null,
				'And from the first day, you can own a part of it.',
				'MaiaCity belongs to the MaiaCity COOP: a company owned by its people.',
				'Its land is never sold, so no one can ever buy it away from you.',
				'Every HEART you invest becomes a MIND: your share of MaiaCity.'),
		say({ id: 'maia', chapter: 'The end of the road', title: 'Invest into the MaiaCity COOP', hint: 'invest', reveal: 2, ...invest('maia', STORY_INVESTS.maia), ...toShed, shots: ['ots'], hold: 'ots' },
			`Invest ${f(STORY_INVESTS.maia)} HEARTS, and you are a co-owner of MaiaCity.`),
		say({ id: 'shed', chapter: 'The end of the road', title: 'Your village centre', kind: 'drive', leg: 'pullup', done: !!seen.shed, ...toShed },
			'This is your village centre. For now, one old shed.'),
		first
			? say({ id: 'cube', chapter: 'The end of the road', title: 'The shed', kind: 'load', done: !!seen.cube, ...atStore },
				'The village keeps everything it shares in here.',
				'Every machine here belongs to the Village COOP: the COOP of everyone in the village.',
				'The ElectroCube: open hardware anyone can build. It will power your home.',
				'And your first roof: one tent, shared by two.')
			: say({ id: 'cube', chapter: 'The end of the road', title: 'The shed', kind: 'load', what: 'power', done: !!seen.cube, ...atStore },
				'The village keeps everything it shares in here.',
				'Every machine here belongs to the Village COOP: the COOP of everyone in the village.',
				'The BatteryCube: four BatteryPacks in one open frame. It stores the sun for your home.',
				'And a solar panel to fill it every day.'),
		say({ id: 'drive', chapter: 'The end of the road', title: 'The last stretch', kind: 'drive', leg: 'tribe', done: !!seen.drive, ...atStore, ...loaded }, 'A few more minutes, and you are home.', null),
		say({ id: 'village', chapter: 'The end of the road', title: 'Invest into the Village COOP', hint: 'invest', reveal: 1, ...invest('village', STORY_INVESTS.village), ...toHome, shots: ['bed'], hold: 'bed' },
			`Invest ${f(STORY_INVESTS.village)} HEARTS, and every machine of the village works a little for you.`),
		say({ id: 'home', chapter: 'The end of the road', title: 'Your new home', kind: 'drive', leg: 'home', done: !!seen.home, ...toHome },
			'This is your new home.',
			first ? 'One hex of grass at the edge of the village. Nothing stands here yet.' : `One hex of grass at the edge of the village, and the tent you share with ${o} already on it.`),
		// Act III, home: the tent and the power, the roof never yours (the low), owning a part of it (the answer), the seed
		first
			? say({ id: 'pitch', chapter: 'Home', title: 'Pitch the tent', kind: 'build', done: !!seen.pitch, ...home, cube: 'bed', tent: 'bed', hour: 14.2 },
				'Everything you need for a first home fits in one bag.',
				'No builder, no loan, no waiting.',
				'A home you raised with your own hands.',
				'Room for two, and canvas that stands for years.',
				'And a fire to gather round when the sun goes down.',
				'The ElectroCube comes home with you.',
				'And by nightfall, the tent has light.')
			: say({ id: 'pitch', chapter: 'Home', title: 'Set up the sun', kind: 'build', what: 'power', done: !!seen.pitch, ...home, battery: 'bed', hour: 14.2 },
				'The BatteryCube comes home with you.',
				'It stands beside the ElectroCube, by the tent.',
				'Sun by day, stored for the night.',
				'One cable, and the tent runs on sunlight.'),
		say({ id: 'tribe', chapter: 'Home', title: 'Invest into the Tribe COOP', hint: 'invest', reveal: 0, ...invest('tribe', STORY_INVESTS.tribe), ...home, place: 'tent' },
			'Even the tent you share belongs to a COOP: the Tribe COOP, the COOP of the people on this hex.',
			'Where you come from, the roof over your head belonged to someone else.',
			null,
			`Here, you can own it. Invest ${f(STORY_INVESTS.tribe)} HEARTS, and part of your own home is yours.`),
		say({ id: 'answer', chapter: 'Home', title: 'What you live on', hint: '', ...next('answer'), ...home, place: 'rise', hour: 16.8 },
			'The land, the machines, your home: a part of each is yours. That is what you live on here, not your time.'),
		// the seed from home (Samuel 2026-10-14): the backpack opened, a spot chosen outside the core circle and walked to,
		// marked with a plant stake; the seed picked, pressed in and watered from the bottle; nothing showing yet
		say({ id: 'begin', chapter: 'Home', title: 'How it begins', hint: '', ...next('begin'), ...home, place: 'pack', hour: 16.9 },
			'And this is how everything begins: with a seed you brought from home.',
			'Everyone who comes here plants their own tree.'),
		say({ id: 'spot', chapter: 'Home', title: 'Choose where it grows', kind: 'spot', done: !!spot, ...home, place: 'plot', hour: 16.9 },
			other.tree ? `${o}'s tree already grows here. Choose where yours grows, out beyond the homes.` : 'Choose where it grows, out beyond the homes.'),
		say({ id: 'seed', chapter: 'Home', title: 'Pick your seed', kind: 'pick', done: !!(me.seedling || me.tree), ...atSpot, place: 'seeds', hour: 17 }, null),
		say({ id: 'plant', chapter: 'Home', title: 'Plant it', kind: 'sow', done: !!me.tree, ...atSpot, place: 'sow', hour: 17 },
			'Into the earth, a finger deep.',
			null,
			'A litre of water, and it has all it needs to start.',
			`It carries your name now: ${me.tree?.name ?? me.name}.`),
		say({ id: 'tend', chapter: 'Home', title: 'Tend it with care', hint: '', ...next('tend'), ...atSpot, place: 'tend', hour: 17.1 },
			'Tend it with care. Come back every day, water it, and watch it grow.'),
		say({ id: 'done', chapter: 'Home', title: 'Tomorrow, the next settlers', hint: '', kind: 'done', done: !!seen.done, ...atSpot, place: 'end', hour: 17.2 },
			'One day it feeds the people who come after you. Tomorrow, you pick up the next settlers.')
	];
}

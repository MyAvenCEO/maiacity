// @ts-nocheck — plain JS
/**
 * MaiaCity V1's first-run story: the journey every player makes at their own seat. It starts on the road, in a packed
 * old travel van down a sandy highway, and gets off at the bus stop by the abandoned gas station: the MaiaCity centre.
 * There the newcomer meets the idea one step at a time (the HEARTS, the first mint, the COOPs and their MINDs) and
 * invests into the MaiaCity COOP, the owner of all the land. Then into the Village COOP's pickup (the first player
 * drives it; the second is fetched by the first) and along the gravel track to the village's centre hex, where the
 * Village COOP keeps the powercube in an old shed beside its solar row and battery: invest there, load the cube, and
 * drive on home to the tribe's hex, the tent and the Tribe COOP. Then the weekly pay day and the melt.
 *
 * Steps that only tell something wait for "Next"; steps that ask for a move (mint, invest) are done when the game
 * shows it, so the story picks up wherever the player is. Each step also says where the world is at that moment
 * (at: where the pickup and the player are, cube: where the powercube is, place: what the camera looks at, reveal:
 * how much of the locked land shows) and, for the moments the world plays (intro, drive, load), what plays.
 */
import { heartsValue, inHearts } from '../../../game/maiacity-v1/engine.js';

const f = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/** the HEARTS a seat has invested into a COOP, from the ledger */
export const investedBy = (view, seat, coop) => view.ledger.filter((e) => e.kind === 'invest' && e.from === `player:${seat}` && e.to === `coop:${coop}`).reduce((a, e) => a + e.amount, 0);

/** where the world stands when there is no story: home, the powercube in the tribe's yard, the camera on the tribe */
export const AT_HOME = { at: 'home', cube: 'home', place: 'tribe', reveal: 2 };

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
	// the first player fetches the powercube and the tent from the village shed; the second finds them home already
	const atStop = { at: 'stop', cube: first ? 'shed' : 'home', tent: first ? 'shed' : 'up', place: 'centre' };
	const atStore = { at: 'village', cube: first ? 'shed' : 'home', tent: first ? 'shed' : 'up', place: 'village' };
	const home = { at: 'home', cube: 'home', tent: 'up', place: 'tribe' };
	return [
		{ id: 'arrive', chapter: 'The road', title: 'On the road', kind: 'intro', done: !!seen.arrive, at: 'arrive', cube: atStop.cube, tent: atStop.tent,
			text: `The old van rattles down the sand highway, full to the roof: people, bags, a sack of rice. Outside, steppe and dust as far as you can see. Somewhere ahead is a place called MaiaCity.` },
		{ id: 'welcome', chapter: 'The road', title: `Welcome to MaiaCity, ${me.name}`, hint: '', ...next('welcome'), ...atStop,
			text: `The van drives on, and the dust settles. A bus stop, an abandoned gas station, the wide steppe. The old world passed this place by and left it behind. This is where MaiaCity begins, and you are one of its very first people.` },
		{ id: 'vision', chapter: 'The road', title: 'A city that belongs to its people', hint: '', ...next('vision'), ...atStop,
			text: `Look at that gas station. Someone owned it, people paid them, and one day the owner left and took everything with them. Here it works the other way round: everything belongs to the people who live here. ${other.founder ? `You and ${other.name}` : 'You and the next person to arrive'} will own all of it, together.` },
		{ id: 'hearts', chapter: 'Your HEARTS', title: 'Every hour, you receive a HEART', hint: '', ...next('hearts'), ...atStop,
			text: `Simply because you are here, you receive ${f(st.heartsPerDay)} HEARTS a day, one every hour, for as long as you live. Yours are called ${hearts}. A HEART is not money: you cannot buy bread with it. It is something better: your right to become an owner of your city.` },
		{ id: 'mint', chapter: 'Your HEARTS', title: 'Collect your first year of HEARTS', hint: 'mintbar', kind: 'mint', done: !!me.lastMint, ...atStop,
			text: `Your HEARTS grow quietly all the time. To make them yours, you mint them, like picking fruit that has ripened. As a welcome gift, your first mint brings a whole year at once: ${f(st.starterPack ?? year)} HEARTS. Tap Mint.` },
		{ id: 'coops', chapter: 'Owning together', title: 'Meet the COOPs', hint: 'coops', ...next('coops'), ...atStop,
			text: `Everything in the city belongs to a COOP: a company its people own together. There are three, each with its own job, and each has its own share, called a MIND. Turn 1 HEART into 1 MIND, and you own a little part of that COOP. Half the MIND goes to you, four tenths stay in the COOP's treasury so it can grow, and one tenth goes into the city pool.` },
		{ id: 'maia', chapter: 'The city', title: `The ${c.maia.name}: the ground beneath your feet`, hint: 'invest', reveal: 2, ...invest('maia', 5000), ...atStop, place: 'city',
			text: `Now look out over the land: 49 hexes, seven villages of seven. The steppe round the bus stop is the city's centre; the green villages round it wait to be settled. All of this land belongs to the ${c.maia.name}, so no one can ever buy it away from you, and every tribe pays it a small ground rent. Invest 5,000 HEARTS, and the land of the whole city becomes, in part, yours.` },
		{ id: 'pool', chapter: 'The city', title: 'The city pool keeps everything fair', hint: 'swap', ...next('pool'), ...atStop,
			text: `A tenth of your investment went into the city pool. The pool holds a little of every MIND, about ${f(inHearts(view, view.pool, hv))} ❤︎ now, so anyone can swap one MIND for another at a fair price, at any time. The ${c.maia.name} looks after it for everyone.` },
		first
			? { id: 'ride', chapter: 'The track', title: 'Your ride is waiting', kind: 'drive', leg: 'village', action: 'Get in and drive', done: !!seen.ride, ...atStop,
				text: `At the old gas station stands a pickup, the key in it. It belongs to the ${c.village.name}, and today it is here for you. Throw your backpack in the back. A narrow track leaves the road's end and winds east, towards the green. Drive.` }
			: { id: 'ride', chapter: 'The track', title: `${other.founder ? other.name : 'Someone'} comes to fetch you`, kind: 'drive', leg: 'village', fetch: true, action: 'Wave and get in', done: !!seen.ride, ...atStop,
				text: `A cloud of dust on the gravel track: ${other.founder ? other.name : 'the first settler'} is coming in the ${c.village.name}'s pickup to fetch you. The village is on the way home.` },
		{ id: 'village', chapter: 'The village', title: `The ${c.village.name}: the tools that make life easy`, hint: 'invest', reveal: 1, ...invest('village', 2000), ...atStore,
			text: `You have reached your village: seven hexes of grass, with this centre hex in the middle. The pickup you came in, the powercube, the solar row and the battery all belong to the ${c.village.name}. It serves every tribe of the village and lends them its machines for a rent. Invest 2,000 HEARTS, and every machine here works a little for you too.` },
		first
			? { id: 'cube', chapter: 'The village', title: 'Load the powercube and the tent', kind: 'load', action: 'Load them', done: !!seen.cube, ...atStore,
				text: `In the old shed, under half a roof, wait two things: the powercube, a diesel generator in its silenced cube, and a little dome tent, packed in its canvas. One day this shed will be the village store, and the solar row beside it will feed the whole village. Today your tribe needs power and a roof. Load them both onto the pickup.` }
			: { id: 'cube', chapter: 'The village', title: 'The old shed', ...next('cube'), ...atStore,
				text: `This is where ${other.founder ? other.name : 'the first settler'} fetched the powercube and the tent on the first day. One day the shed becomes the village store; for now the solar row and the battery stand here alone, waiting for more tribes to come.` },
		{ id: 'drive', chapter: 'The village', title: 'The last stretch', kind: 'drive', leg: 'tribe', action: 'Drive home', done: !!seen.drive, ...atStore, cube: first ? 'bed' : 'home', tent: first ? 'bed' : 'up',
			text: `Out of the village centre the track bends on through the grass, to the hex at the village's edge where you will live. Drive home.` },
		...(first
			? [{ id: 'pitch', chapter: 'Your home', title: 'Pitch your tent', kind: 'build', action: 'Pitch the tent', done: !!seen.pitch, ...home, cube: 'bed', tent: 'bed',
				text: `This is it: a clearing of grass and a few bushes at the edge of the village, your hex. Nothing stands here yet. Unload the powercube, unroll the canvas, and raise the little dome, strut by strut. Your first home in MaiaCity.` }]
			: []),
		{ id: 'tribe', chapter: 'Your home', title: `The ${c.tribe.name}: your home`, hint: 'invest', reveal: 0, ...invest('tribe', 1000), ...home,
			text: `Welcome home. ${first ? 'The tent you just raised' : `The tent ${other.founder ? other.name : 'the first settler'} raised`} stands on the grass, the powercube humming beside it. The tent belongs to the ${c.tribe.name}, the COOP of this one hex: your tribe. It rents the land from the city and the machines from the village, and you pay it a small rent for your bed. Invest 1,000 HEARTS, and you own a part of your own home.` },
		{ id: 'payday', chapter: 'Pay day', title: 'Every week, the city pays you back', hint: 'you', ...next('payday'), ...home,
			text: `At the end of each game week it is pay day. The rents flow: from you to your tribe, from your tribe to the land and the machines. And a fifth of every rent flows straight back to the people who own the COOPs. That is you. Look at your cash flow to see it.` },
		{ id: 'melt', chapter: 'Pay day', title: 'Owning beats hoarding', hint: '', ...next('melt'), ...home,
			text: `Every HEART and every MIND melts a little, ${f(st.demurrage * 100)} % a year, like ice in the sun. So no one gets rich by sitting on a pile, the way the gas station's owner once tried to. What grows your share is owning the things people really use. And if a rule ever feels wrong, propose a change: a MIP that both of you sign.` },
		{ id: 'done', chapter: 'Your city', title: 'You are an owner of MaiaCity now', hint: '', kind: 'done', done: !!seen.done, ...home,
			text: `The land, the machines and your home are partly yours. Come back every day to mint your HEARTS, and watch the city pay you on pay day. Today it is one tent on one hex of grass, at the end of a gravel track. What it becomes is up to the two of you.` }
	];
}

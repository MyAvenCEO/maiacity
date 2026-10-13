// @ts-nocheck — plain JS
/**
 * MaiaCity V1's first-run story: the tour every player walks at their own seat. It builds the game up one idea at a
 * time, the way a newcomer meets it: the land, the HEARTS, the first mint, the COOPs and their MINDs, then one COOP
 * after the other (who owns what, and why you invest into it), the pool, the weekly pay day with its rents and
 * dividends, and the melt. Steps that only tell something wait for "Next"; steps that ask for a move (mint, invest)
 * are done when the game shows it, so the story picks up wherever the player is.
 */
import { TOKEN_LABEL, heartsValue, inHearts } from '../../../game/maiacity-v1/engine.js';

const f = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/** the HEARTS a seat has invested into a COOP, from the ledger */
export const investedBy = (view, seat, coop) => view.ledger.filter((e) => e.kind === 'invest' && e.from === `player:${seat}` && e.to === `coop:${coop}`).reduce((a, e) => a + e.amount, 0);

/** the story for one seat, as it stands in the game now: every step with its words and whether it is done */
export function story(view, seat, seen) {
	const me = view.players[seat];
	const other = view.players[seat === 'A' ? 'B' : 'A'];
	const c = view.coops;
	const st = view.settings;
	const hv = heartsValue(view);
	const hearts = `${me.name.charAt(0).toLowerCase()}${me.name.slice(1).replace(/\s+/g, '')}HEARTS`;
	const year = st.heartsPerDay * 28 * 13;
	const invest = (id, goal) => ({ kind: 'invest', coop: id, goal, have: investedBy(view, seat, id), done: investedBy(view, seat, id) >= goal - 0.5 });
	const next = (id) => ({ kind: 'next', done: !!seen[id] });
	return [
		{ id: 'welcome', chapter: 'Welcome', title: `Welcome home, ${me.name}`, hint: '', ...next('welcome'),
			text: `You have just arrived somewhere new. A clearing in a forest, a little dome tent, a pickup in the shade. It is small today. But this is where a city begins, and you are one of its very first people.` },
		{ id: 'vision', chapter: 'Welcome', title: 'A city that belongs to its people', hint: '', ...next('vision'),
			text: `In most places, a few people own the land, the homes and the machines, and everyone else pays them. Here it works the other way round: everything belongs to the people who live here. ${other.founder ? `You and ${other.name}` : 'You and the next person to arrive'} will own all of it, together. Let us see how.` },
		{ id: 'hearts', chapter: 'Your HEARTS', title: 'Every hour, you receive a HEART', hint: '', ...next('hearts'),
			text: `Simply because you are here, you receive ${f(st.heartsPerDay)} HEARTS a day, one every hour, for as long as you live. Yours are called ${hearts}. A HEART is not money: you cannot buy bread with it. It is something better. It is your right to become an owner of your city.` },
		{ id: 'mint', chapter: 'Your HEARTS', title: 'Collect your first year of HEARTS', hint: 'mintbar', kind: 'mint', done: !!me.lastMint,
			text: `Your HEARTS grow quietly all the time. To make them yours, you mint them, like picking fruit that has ripened. As a welcome gift, your first mint brings a whole year at once: ${f(st.starterPack ?? year)} HEARTS. Tap Mint.` },
		{ id: 'coops', chapter: 'Owning together', title: 'Meet the COOPs', hint: 'coops', ...next('coops'),
			text: `Everything in the city belongs to a COOP: a company that its people own together. There are three here, and each has its own job. Each COOP also has its own share, called a MIND. Turn 1 HEART into 1 MIND, and you own a little part of that COOP. Half the MIND goes to you, half stays in the COOP's treasury, so it can grow.` },
		{ id: 'maia', chapter: 'The land', title: `The ${c.maia.name}: the ground beneath your feet`, hint: 'invest', ...invest('maia', 5000),
			text: `The ${c.maia.name} holds the land, the whole hex you stand on, so no one can ever buy it away from you. Whoever builds here pays it a small ground rent. Invest 5,000 HEARTS, and the land becomes, in part, yours.` },
		{ id: 'pool', chapter: 'The land', title: 'The city pool keeps everything fair', hint: 'swap', ...next('pool'),
			text: `Did you see that a small part of your investment went into the city pool? The pool holds a little of every MIND, about ${f(inHearts(view, view.pool, hv))} ❤︎ now, so anyone can swap one MIND for another at a fair price, at any time. The ${c.maia.name} looks after it for everyone.` },
		{ id: 'village', chapter: 'The machines', title: `The ${c.village.name}: the tools that make life easy`, hint: 'invest', ...invest('village', 2000),
			text: `The pickup, the powercube that makes power, the big battery and the solar row: they belong to the ${c.village.name}. It lends them to whoever needs them and earns a rent for it. Invest 2,000 HEARTS, and every machine here works a little for you too.` },
		{ id: 'settlement', chapter: 'Your home', title: `The ${c.settlement.name}: your home`, hint: 'invest', ...invest('settlement', 1000),
			text: `The tent where you sleep belongs to the ${c.settlement.name}. It pays the ${c.maia.name} for the land and the ${c.village.name} for the machines, and you pay it a small rent for your bed. Invest 1,000 HEARTS, and you own a part of your own home.` },
		{ id: 'payday', chapter: 'Pay day', title: 'Every week, the city pays you back', hint: 'you', ...next('payday'),
			text: `At the end of each game week it is pay day. The rents flow: from you to your home, from your home to the land and the machines. And a fifth of every rent flows straight back to the people who own the COOPs. That is you. Look at your cash flow to see it.` },
		{ id: 'melt', chapter: 'Pay day', title: 'Owning beats hoarding', hint: '', ...next('melt'),
			text: `Every HEART and every MIND melts a little, ${f(st.demurrage * 100)} % a year, like ice in the sun. So no one gets rich by sitting on a pile. What grows your share is owning the things people really use. And if a rule ever feels wrong, propose a change: a MIP that both of you sign.` },
		{ id: 'done', chapter: 'Your city', title: 'You are an owner of MaiaCity now', hint: '', kind: 'done', done: !!seen.done,
			text: `The land, the machines and your home are partly yours. Come back every day to mint your HEARTS, and watch the city pay you on pay day. Today it is one hex in a forest. What it becomes is up to the two of you.` }
	];
}

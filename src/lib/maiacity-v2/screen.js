// @ts-nocheck — plain JS, kept loose on purpose
// What a MaiaCity V2 screen (a view card, game/maiacity-v2/views.js) is handed: the game as it stands, never a seat's
// secrets (there are none in the state). The game page and the Proposals app (a proposed screen, looked at before
// signing) hand the same.
import { COOPS, MINDS, SEATS, TOKEN_COLOUR, TOKEN_LABEL, calendar, dateText, heartsValue, inHearts, rents } from '../../../game/maiacity-v2/engine.js';

export function screenDataOf(view, seat, now) {
	if (!view) return null;
	const names = [...SEATS.map((s) => [`player:${s}`, view.players[s].name]), ...Object.keys(COOPS).map((id) => [`coop:${id}`, view.coops[id].name]), ['pool', 'AMM pool (MaiaCity COOP)']];
	return {
		date: dateText(calendar(view, now)),
		month: view.month,
		seat,
		minds: MINDS.map((t) => ({ id: t, label: TOKEN_LABEL[t], colour: TOKEN_COLOUR[t] })),
		hearts: heartsValue(view),
		players: SEATS.map((k) => ({ seat: k, name: view.players[k].name, wallet: { ...view.players[k].wallet }, worth: inHearts(view, view.players[k].wallet), arrears: view.players[k].arrears ?? 0 })),
		coops: Object.values(view.coops).map((c) => ({ id: c.id, name: c.name, mind: c.mind, treasury: { ...c.treasury }, worth: inHearts(view, c.treasury), assets: c.assets.map((a) => ({ ...a })) })),
		pool: { ...view.pool },
		poolWorth: inHearts(view, view.pool),
		settings: { ...view.settings },
		rents: rents(view),
		names: Object.fromEntries(names),
		ledger: view.ledger.slice(-80).reverse().map((e) => ({ ...e }))
	};
}

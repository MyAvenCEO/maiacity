// The browser half of the city economy — the communities every sandbox draws.
// Looking needs no account: the cities, their settlements and cap tables are
// public. Minting, founding a city, joining one, backing coops and placing them
// in a world are signed with the same passkey session as /join.
import { API } from '$lib/auth/client';

export type CoopSummary = {
	slug: string;
	kind: 'city' | 'settlement' | 'coop';
	name: string;
	founder: string;
	/** Where it stands, by world: { 'sandbox-2': '812' } for a city's card, "q,r" on its island for a settlement. */
	places: Record<string, string>;
	city: { slug: string; name: string };
	citizens: number;
	settlers: number;
	level: number;
	nextLevelAt: number | null;
	inMasterDome: number;
	milestone: number;
	phase: string;
	raised: string;
	raisedLabel: string;
	supplyLabel: string;
	backers: number;
};

export type ScheduleLine = {
	milestone: number;
	minds: string;
	price: string;
	cost: string;
	cumulativeMinds: string;
	cumulativeHearts: string;
	state: 'filled' | 'current' | 'locked';
	status: string;
	fill: number;
	progress: string;
	phase: string;
	phaseHeading: string;
};

/** A city, with the seed of its Sandbox 2 island — null until it stands on a card there. */
export type CitySummary = CoopSummary & { island: number | null; settlements: CoopSummary[] };

export type CoopDetail = CoopSummary & {
	pitch: string;
	mindToken: string;
	heartsToken: string;
	settlements: CoopSummary[];
	island: number | null;
	entryLabel: string;
	priceLabel: string;
	nextLabel: string;
	fill: number;
	myMindsLabel: string;
	treasuryLabel: string;
	milestoneOf: string;
	soldOut: boolean;
	schedule: ScheduleLine[];
};

export type City = {
	cities: CitySummary[];
	players: number;
	buildable: number;
	clock: string;
	calendarLabel: string;
};

export type Holding = { token: string; balanceLabel: string; kind: 'own' | 'hearts' | 'minds' | 'city' };

export type Account = {
	id: string;
	number: number;
	name: string;
	role: string;
	caps: string[];
	token: string;
	balance: string;
	balanceLabel: string;
	lastClaimAt: string;
	startingPending: boolean;
	holdings: Holding[];
	calendarLabel: string;
	/** The city the player is a citizen of, for good — null until they found or join one. `founded`: theirs to place. */
	city: { slug: string; name: string; founded: boolean } | null;
	/** Their home in that city, for good — null until they found one or accept an invite. */
	settlement: { slug: string; name: string; founded: boolean } | null;
};

export type LedgerView = {
	holdings: Holding[];
	transactions: { id: string; title: string; token: string; indexed: string; figure: string; sign: '+' | '-' }[];
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(`${API}${path}`, {
		...init,
		credentials: 'include',
		headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }
	});
	const body = await res.json().catch(() => null);
	if (!res.ok) throw Object.assign(new Error(body?.error ?? 'Something went wrong. Please try again.'), { status: res.status });
	return body as T;
}

export const city = () => call<City>('/api/city');
export const coop = (slug: string) => call<CoopDetail>(`/api/coops/${slug}`);

/** Null when nobody is signed in — the planet still works without an account. */
export const account = () =>
	call<Account>('/api/account').catch((e) => {
		if ((e as { status?: number }).status === 401) return null;
		throw e;
	});

export const mint = () => call<{ claimedLabel: string }>('/api/hearts/claim', { method: 'POST' });

export const invest = (slug: string, hearts: string) =>
	call<CoopDetail>(`/api/coops/${slug}/invest`, { method: 'POST', body: JSON.stringify({ hearts }) });

export const foundCity = (input: { name: string; pitch: string; hearts: string }) =>
	call<CoopDetail>('/api/cities', { method: 'POST', body: JSON.stringify(input) });

export const foundSettlement = (input: { name: string; pitch: string; hearts: string }) =>
	call<CoopDetail>('/api/settlements', { method: 'POST', body: JSON.stringify(input) });

/** Sandbox 2's world: a city stands on a card of the planet, a settlement on a cell of its city's island. */
export const SANDBOX_2 = 'sandbox-2';
/** The card a city stands on in Sandbox 2 — null while it stands nowhere there. */
export const tileOf = (c: Pick<CoopSummary, 'places'>) => (c.places[SANDBOX_2] === undefined ? null : Number(c.places[SANDBOX_2]));
/** The cell a settlement stands on, on its city's Sandbox 2 island — null while it stands nowhere there. */
export const cellOf = (c: Pick<CoopSummary, 'places'>) => c.places[SANDBOX_2] ?? null;

/** Its founder gives a city or a settlement its place in a world, once. */
export const place = (slug: string, world: string, spot: string | number) =>
	call<CoopDetail>(`/api/coops/${slug}/place`, { method: 'POST', body: JSON.stringify({ world, spot }) });

export type Invite = { token: string; expiresAt: string; settlement: { slug: string; name: string }; city: { slug: string; name: string }; invitedBy: string; usable: boolean; reason: string };

export const createInvite = (slug: string) => call<Invite>(`/api/settlements/${slug}/invites`, { method: 'POST' });
export const invite = (token: string) => call<Invite>(`/api/invites/${token}`);
export const acceptInvite = (token: string, hearts: string) =>
	call<CoopDetail>(`/api/invites/${token}/accept`, { method: 'POST', body: JSON.stringify({ hearts }) });

export const ledger = () => call<LedgerView>('/api/ledger');

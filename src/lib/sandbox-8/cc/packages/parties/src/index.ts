/**
 * Parties (decision 0025): everyone who can act in the world, hold things, keep books and make
 * agreements: a person, a household, a group of friends, a company, a bank, a firm, a public body.
 * Players act as parties, and so does everyone else. What a party holds, owes and is owed lives with
 * the modules that know it (books in economy, machines in equipment, agreements in agreements);
 * this package only says who exists.
 */
import { command, defineModule, s, type EntityId, type ReadCtx, type WriteCtx } from '../../kernel/src/index.ts';

export const PARTY_KINDS = ['person', 'household', 'group', 'company', 'bank', 'firm', 'public'] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

export interface Party {
  label: string;
  kind: PartyKind;
  /** the catalog entry it comes from (a bank of the economy pack), if any */
  catalog?: string;
}

export interface PartiesPort {
  get(id: EntityId): Party | undefined;
  /** the party, or an error naming who asked */
  require(id: EntityId, why: string): Party;
  /** every party, of a kind */
  all(kind?: PartyKind): [EntityId, Party][];
}

declare module '../../kernel/src/index.ts' {
  interface ComponentTypes {
    Party: Party;
  }
  interface PortTypes {
    parties: PartiesPort;
  }
  interface ContributionTypes {
    /**
     * how a party's word gets out to another beyond it now (realism S4: an office, a phone with charge, one of its people
     * beyond the map), or why it does not; undefined: whoever contributes it does not know the party
     */
    wordOut: (read: import('../../kernel/src/index.ts').ReadCtx, party: string) => { via: string } | { why: string; remedies?: import('../../kernel/src/index.ts').Remedy[] } | undefined;
  }
  interface ContributionTypes {
    /** why a party cannot act for itself now (its affairs under an administrator …), or null */
    cannotAct: (read: ReadCtx, party: EntityId) => string | null;
  }
  interface ContributionTypes {
    /**
     * the people still of a party, alive (decision 0028 rule 4, one named population): who is left of it to act, to be
     * told and to speak for it; the module that knows who belongs to whom answers
     */
    population: (read: ReadCtx, party: EntityId) => EntityId[];
  }
  interface CommandTypes {
    'parties.add': { payload: { label: string; kind: PartyKind; id?: string; catalog?: string }; result: EntityId };
    'parties.end': { payload: { party: EntityId; why: string }; result: void };
  }
}

/** the party acting the current command (a player command must be acted by a party) */
export function actorOf(ctx: WriteCtx): EntityId {
  const a = ctx.actor;
  if (!a || !ctx.get('Party', a)) ctx.reject('parties.noActor', { actor: a ?? 'nobody' });
  // a player acting for a party that has lost the power to act (not the law refusing: the power is another's)
  if (ctx.caller === 'client') {
    mustBeLive(ctx, a!);
    const why = ctx.contributions('cannotAct').map((c) => c.impl(ctx, a!)).find((x): x is string => Boolean(x));
    if (why) ctx.reject('parties.cannotAct', { party: partyLabel(ctx, a!), why });
  }
  return a!;
}

/**
 * Why a party begins nothing new (the one check, decision 0028 rule 4; review y): it has ended, nobody left of it, and is
 * an estate now: what is running for it is wound up by the law of estates (each module's own, on its end), but nothing new
 * is begun for it by anyone, a player or a system (an order, a hire, a project, an agreement made, a let); undefined: it can
 */
export function endedBlock(read: ReadCtx, party: EntityId): { code: 'parties.ended'; params: { party: string; why: string } } | undefined {
  const ended = read.ended(party);
  return ended ? { code: 'parties.ended', params: { party: partyLabel(read, party), why: ended.why } } : undefined;
}

/** a command that begins something for a party, refused when the party has ended (`endedBlock`), whoever asks */
export function mustBeLive(ctx: WriteCtx, party: EntityId): void {
  const no = endedBlock(ctx, party);
  if (no) ctx.reject(no.code, no.params);
}

/** who is left of a party: its people, alive and still of it (the one population, decision 0028 rule 4) */
export function populationOf(read: ReadCtx, party: EntityId): EntityId[] {
  return [...new Set(read.contributions('population').flatMap((c) => c.impl(read, party)))].sort();
}

/** the label of a party, for messages */
export const partyLabel = (read: ReadCtx, id: EntityId): string => read.get('Party', id)?.label ?? id;

export const partiesModule = defineModule({
  id: 'parties',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Employment', 'Helper'],
  label: 'Parties',
  description: 'Who exists to act, hold, keep books and agree.',
  provides: ['parties'],
  components: { Party: s.object({ label: s.string(), kind: s.enum(PARTY_KINDS), catalog: s.string().optional() }) },
  commands: {
    'parties.add': command(
      s.object({ label: s.string(), kind: s.enum(PARTY_KINDS), id: s.string().optional(), catalog: s.string().optional() }),
      (ctx, p) => {
        if (p.id && ctx.get('Party', p.id)) ctx.reject('parties.exists', { id: p.id });
        const id = ctx.spawn('party', { name: p.label, ...(p.id ? { id: p.id } : {}) });
        ctx.set('Party', id, { label: p.label, kind: p.kind, ...(p.catalog ? { catalog: p.catalog } : {}) });
        return id;
      },
      { label: 'A party comes into the world (a starter, a catalog, a market model)', internal: true },
    ),
    // a party with nobody left to act for it (its last person dead): it ends, and what was for it with it (an advert, an
    // offer: decision 0028); its books, holdings and claims stay, as an estate
    'parties.end': command(
      s.object({ party: s.ref('party'), why: s.string() }),
      (ctx, p) => {
        if (!ctx.get('Party', p.party)) ctx.reject('parties.unknown', { party: p.party });
        // (a party is its people, decision 0025: one with someone left has not ended, and ending it would end what is
        // still theirs, decision 0028)
        const left = populationOf(ctx, p.party);
        if (left.length) throw new Error(`parties.end ${partyLabel(ctx, p.party)}: ${left.join(', ')} ${left.length > 1 ? 'are' : 'is'} still of it`);
        ctx.end(p.party, p.why);
      },
      { label: 'A party ends (nobody left of it)', internal: true },
    ),
  },
  projections: {
    // who exists to act, hold and agree (to lend to, to deal with): Qwen S192
    'parties.list': { label: 'Parties: who exists to act, hold and agree with', compute: (read) => [...read.all('Party')].map(([id, x]) => ({ id, label: x.label, kind: x.kind })) },
  },
  blockers: { 'parties.unknown': 'There is no party {party}', 'parties.exists': 'There is already a party {id}', 'parties.noActor': 'This must be done by a party of the world (acted by: {actor})', 'parties.cannotAct': '{party} cannot act for itself: {why}', 'parties.ended': '{party} has ended ({why}): it acts no more, and nothing new is begun for it (what runs is wound up as its estate)' },
  ports: {
    parties: (read: ReadCtx): PartiesPort => ({
      get: (id) => read.get('Party', id),
      require: (id, why) => {
        const p = read.get('Party', id);
        if (!p) throw new Error(`${why}: no party ${id}`);
        return p;
      },
      all: (kind) => [...read.all('Party')].filter(([, p]) => kind === undefined || p.kind === kind),
    }),
  },
});

/**
 * Why a party's word does not get out to another party now (S4: no office, no phone with charge, nobody beyond the map),
 * with the ways it would, if it does not
 */
export function wordBlock(read: import('../../kernel/src/index.ts').ReadCtx, party: string): { why: string; remedies: import('../../kernel/src/index.ts').Remedy[] } | undefined {
  for (const c of read.contributions('wordOut')) {
    const w = c.impl(read, party);
    if (w) return 'why' in w ? { why: w.why, remedies: w.remedies ?? [] } : undefined;
  }
  return undefined;
}

import { expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { newGame as v1Game } from '../../game/maiacity-v1/engine.js';
import { act, advance, fromV1, newGame, invariant, quote, price, rents, consolidate, SEATS, SETTING_LIMITS } from '../../game/maiacity-v2/engine.js';
import { MIGRATIONS } from '../src/migrations-list';
import { useDb } from '../src/pg';
import { getGame, takeSeat, move, seedPendingGame } from '../src/maiacity-v2.js';
const now = Date.UTC(2026, 9, 23);

test('fork preserves the entire snapshot and adds an independent, empty C', () => {
 const old = v1Game(now);
 old.players.A.founder = 'a'; old.players.B.founder = 'b';
 old.players.B.wallet.MAIA = 123;
 const fork = fromV1(old, now);
 expect(fork.players.A.founder).toBe(old.players.A.founder);
 expect(fork.players.A.wallet).toEqual({HEARTS:49800,MAIA:25000,VILLAGE:12500});
 expect(fork.players.B.wallet).toEqual(fork.players.A.wallet);
 expect(fork.economyArchive.coops).toEqual(old.coops);
 expect(Object.keys(fork.coops)).toEqual(['maia','village']);
 expect(fork.players.C.founder).toBeNull();
 fork.players.B.wallet.MAIA = 999;
 expect(old.players.B.wallet.MAIA).toBe(123);
 expect(Object.keys(old.players)).toEqual(['A', 'B']);
 expect(SEATS).toEqual(['A', 'B', 'C']);
 expect(SETTING_LIMITS.signatures).toEqual([1, 3]);
});

test('C mints and invests; tree placement checks both existing players', () => {
 let s = newGame(now);
 s = act(s, 'C', {type:'mint'}, now);
 s = act(s, 'C', {type:'invest', coop:'maia', amount:100}, now);
 expect(s.players.C.wallet.MAIA).toBe(50);
 s = act(s, 'A', {type:'mark', x:40,z:0}, now);
 s = act(s, 'B', {type:'mark', x:-40,z:0}, now);
 expect(() => act(s, 'C', {type:'mark',x:41,z:0}, now)).toThrow('Too close');
 expect(() => act(s, 'C', {type:'mark',x:-41,z:0}, now)).toThrow('Too close');
 expect(act(s, 'C', {type:'mark',x:0,z:40}, now).players.C.spot).toEqual({x:0,z:40});
});

test('database migration copies V1 exactly; C joins, acts, and cannot take another seat', async () => {
 const pg = new PGlite();
 try {
 await pg.exec(MIGRATIONS.find(m => m.id === '0046-maiacity-v1')!.sql);
 const old = v1Game(now); old.players.A.founder='a'; old.players.B.founder='b';
 await pg.query('INSERT INTO v1_games (id,state) VALUES ($1,$2)', ['main',JSON.stringify(old)]);
 await pg.exec(MIGRATIONS.find(m => m.id === '0060-maiacity-v2')!.sql);
 const copied:any = (await pg.query('SELECT state FROM v2_games')).rows[0];
 expect((await pg.query<any>('SELECT state FROM game_fork_snapshots')).rows[0].state).toEqual(old);
 await expect(pg.query("UPDATE game_fork_snapshots SET state = '{}'::jsonb")).rejects.toThrow('immutable');
 expect(copied.state.players.A).toEqual(old.players.A);
 expect(copied.state.players.B).toEqual(old.players.B);
 expect(copied.state.ledger).toEqual(old.ledger);
 expect(copied.state.started).toBe(old.started);
 useDb(pg as any);
 expect(await seedPendingGame(now)).toBe(true);
 expect(await seedPendingGame(now)).toBe(false);
 const joined=await getGame({id:'c',name:'Third player'}, now);
 expect(joined.players.C.founder).toBe('c');
 expect((await getGame({id:'c'},now)).players.C.founder).toBe('c');
 await expect(takeSeat({id:'d'},'A',now)).rejects.toThrow('All three');
 const minted=await move({id:'c'},'A',{type:'mint'},now);
 expect(minted.players.C.wallet.HEARTS).toBeGreaterThan(0);
 expect(minted.players.A.wallet.HEARTS).toBe(49800);
 expect((await pg.query<any>('SELECT state FROM v1_games')).rows[0].state).toEqual(old);
 } finally {await pg.close();}
});

 test('the third settler adds one tent and ten litres once, independently of game money', () => {
 let state = newGame(now);
 const cash = JSON.stringify(state.coops);
 expect(() => act(state,'A',{type:'collectShelter'},now)).toThrow();
 expect(() => act(state,'C',{type:'settleShelter'},now)).toThrow();
 state = act(state,'C',{type:'collectShelter'},now);
 expect(JSON.stringify(state.coops)).toBe(cash);
 state = act(state,'C',{type:'settleShelter'},now);
 state = act(state,'C',{type:'settleShelter'},now);
 expect(state.coops.village.assets.filter(a=>a.id==='tent-2')).toHaveLength(1);
 expect(state.water.litres).toBe(10);
 expect(state.players.C.shelter).toBe('home');
 });

test('two-asset constant product quote, fee retention and no weights', () => {
 let s=fromV1(v1Game(now),now);
 expect(s.pool).toEqual({MAIA:10000,VILLAGE:5000});
 const before=invariant(s), amount=100, out=5000*(amount*.997)/(10000+amount*.997);
 expect(quote(s,'MAIA','VILLAGE',amount)).toBeCloseTo(out,10);
 expect(quote(s,'VILLAGE','MAIA',amount)).toBeCloseTo(10000*99.7/5099.7,10);
 s.settings.weightMAIA=9; s.settings.weightVILLAGE=.1;
 expect(quote(s,'MAIA','VILLAGE',amount)).toBeCloseTo(out,10);
 expect(quote(s,'TRIBE','MAIA',amount)).toBe(0);
 expect(price(s,'VILLAGE')).toBe(2);
 s=act(s,'A',{type:'swap',token:'MAIA',to:'VILLAGE',amount},now);
 expect(invariant(s)).toBeGreaterThan(before);
 expect(s.players.A.wallet.VILLAGE).toBeCloseTo(12500+out,8);
});
test('fresh economy seed is once only; progress and archived economy survive', () => {
 const old=v1Game(now-86400000); old.players.A.founder='a'; old.players.A.tree={name:'A tree',x:40,z:0};
 old.players.A.arrears=345; old.coops.tribe.assets.push({id:'tent-2',name:'Tent 2',kind:'Home'});
 const s=fromV1(old,now);
 expect(s.started).toBe(now); expect(s.week).toBe(0); expect(s.players.A.arrears).toBe(0);
 expect(s.players.A.tree).toEqual(old.players.A.tree);
 expect(s.economyArchive.players.A.arrears).toBe(345);
 expect(s.coops.village.assets.some(a=>a.id==='tent-2')).toBe(true);
 expect(consolidate(s,now+1000)).toEqual(s);
 expect(rents(s).map(r=>[r.from,r.to,r.token])).toEqual([['player:A','coop:village','VILLAGE'],['player:B','coop:village','VILLAGE'],['coop:village','coop:maia','MAIA']]);
 const paid=advance(s,now+21600000);
 expect(paid.ledger.filter(e=>e.kind==='rent').every(e=>['coop:village','coop:maia'].includes(e.to))).toBe(true);
 expect(paid.players.C.arrears).toBe(0);
});

import { observeEntryPages } from './entry-pages.js';
/** Reactive collection of bounded pages; context replacement disposes every lease.
 * @param {() => {observe: Parameters<typeof observeEntryPages>[0]}} api
 * @param {() => object[]} queries */
export function entryCollectionPages(api, queries) {
 let state = $state(/** @type {Parameters<Parameters<typeof observeEntryPages>[2]>[0]} */ ({rows: [], phase: 'loading', error: ''}));
 $effect(() => {
  const owner = api(), pages = queries();
  state = {rows: [], phase: 'loading', error: ''};
  return observeEntryPages(owner.observe.bind(owner), pages, value => { state = value; });
 });
 return {
  get rows() { return state.rows; },
  get phase() { return state.phase; },
  get error() { return state.error; }
 };
}

// @ts-nocheck — plain JS
/*
 * AN ASSET'S PARTS TREE, from its card's catalog alone (./schemas/card.v1.json `catalog`): what every viewer that lists
 * an asset's parts lists (./AssetViewer.svelte's panel, the avenDB app's Assets in its side, ./Parts.svelte). Its own
 * parts by assembly, then each whole asset it carries (a Power Cube on a pickup's bed, its `ref`) as one entry of its
 * own, that asset's parts by its assemblies under it.
 */

/**
 * The tree of `catalog`'s parts: `own`, the asset's own by assembly; `units`, each whole asset it carries, by its ref,
 * named as its host's catalog writes it before its assemblies' ("Power Cube: Frame"), else by its ref, with where its
 * own page is (`hrefOf(ref)`, null for none).
 * @param {any} catalog @param {string | undefined} own the asset's own ref (`machines/pickup@2`): a part of it is no unit
 * @param {(ref: string) => string | null} [hrefOf]
 * @returns {{ own: { a: any, parts: any[] }[], units: { ref: string, name: string, parts: any[], groups: { a: any, parts: any[] }[], href: string | null }[] }}
 */
export function treeOf(catalog, own, hrefOf = () => null) {
	if (!catalog?.parts?.length) return { own: [], units: [] };
	const mine = (p) => !p.ref || p.ref === own;
	const byAssembly = (list) => (catalog.assemblies ?? []).map((a) => ({ a, parts: list.filter((p) => p.assembly === a.id) })).filter((x) => x.parts.length);
	const carried = new Map();
	for (const p of catalog.parts) if (!mine(p)) carried.set(p.ref, [...(carried.get(p.ref) ?? []), p]);
	return {
		own: byAssembly(catalog.parts.filter(mine)),
		units: [...carried].map(([ref, parts]) => {
			const groups = byAssembly(parts);
			const heads = groups.map((g) => (g.a.label.includes(':') ? g.a.label.split(':')[0].trim() : null));
			const name = heads.length && heads.every((h) => h && h === heads[0]) ? heads[0] : ref;
			return { ref, name, parts, groups, href: hrefOf(ref) };
		})
	};
}

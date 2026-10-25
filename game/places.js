/**
 * @typedef {'sandbox-1' | 'sandbox-2' | 'sandbox-3' | 'sandbox-4' | 'sandbox-5' | 'sandbox-6' | 'tired-land' | 'maiacity-v1' | 'maiacity-v2'} Sandbox
 *   every world's id, as a shot names it (`world.sandbox`): the keys of WORLDS
 */
/**
 * @typedef {{ label: string, range: [number, number], unit?: string }} Channel
 *   one way a part of a world moves (a van along its road, a door open): what the studio calls it, the values it takes
 *   (a shot's are kept to them), and what they are in
 * @typedef {{ id: string, label: string, channels: Record<string, Channel> }} Part
 *   a moving part of a world a shot can move (`spec.parts`): a vehicle, an actor, a machine, a door, water. Left out
 *   of a shot, a part moves as the world moves it itself
 */
/**
 * @typedef {{ label: string, route: string, areas: string[] | null, areaNames?: Record<string, string>, domes?: number, sets?: string[], parts: Part[] }} World
 *   label: its name in the studio; route: the app's page of it, where its old address /games/<id>/ passes on to (from
 *   the site's root); areas: the places a shot can be in (the first is the default), or null for a world that is one
 *   place, and what each is called (areaNames); domes: how many domes a shot can name (world.dome); sets: the sets a
 *   shot can build into it (world.props); parts: its moving parts a shot can animate, each a lane of its own in the
 *   studio's 3D timeline (one per channel), beside the camera, the lens, the hour and the lights every world has
 */

/**
 * @typedef {{ id: string, route: string, label: string, note: string, version: number, gameOrder?: number,
 * history?: {v: number, date: string, note: string}[],
 * navigation?: {group: string, order: number, icon: 'play' | 'coops', note?: string, cover?: string, anchors?: string},
 * film?: Omit<World, 'route'> & {id: Sandbox, order: number} }} PlaceDescriptor
 */
/** @type {PlaceDescriptor[]} */
export const PLACES = [
	{
		id: "sandbox-1",
		route: "/app/games/sandbox-1/",
		label: "Sandbox 1",
		note: "A hex island to settle",
		gameOrder: 0,
		navigation: {
			group: "PLAY",
			order: 0,
			icon: "play",
			cover: "6a08f524a54384aa2c902b0e19f3d01b0264f1c218f62a7c47c2950ed0a0b620.jpg"
		},
		version: 1,
		film: {
			id: "sandbox-1",
			order: 0,
			label: "Sandbox 1 · the island",
			areas: [
				"island"
			],
			parts: []
		}
	},
	{
		id: "sandbox-2",
		route: "/app/games/sandbox-2/",
		label: "Sandbox 2",
		note: "The planet and its first cities",
		gameOrder: 1,
		navigation: {
			group: "PLAY",
			order: 1,
			icon: "play",
			cover: "88528c9521de8682f676c3e2539c3a19ffd2a4731a2343410761025e27fde55e.jpg"
		},
		version: 1,
		film: {
			id: "sandbox-2",
			order: 1,
			label: "Sandbox 2 · the planet",
			areas: [
				"planet"
			],
			parts: []
		}
	},
	{
		id: "sandbox-3",
		route: "/app/games/sandbox-3/",
		label: "Sandbox 3",
		note: "A whole dome cell",
		gameOrder: 2,
		navigation: {
			group: "PLAY",
			order: 2,
			icon: "play",
			cover: "1427db9edf3652e5354bb645e1c8155930dd53bf7cb17e39a4019efe33c6c2d6.jpg"
		},
		history: [
			{
				v: 1,
				date: "2026-10-05",
				note: "First version"
			},
			{
				v: 2,
				date: "2026-10-06",
				note: "Paths routed round the coops and squares: in from every dome to the master’s nearest door"
			},
			{
				v: 3,
				date: "2026-10-06",
				note: "Ant roads you can see: bare trodden earth from every hill, crowded with ants going out and coming home"
			},
			{
				v: 4,
				date: "2026-10-06",
				note: "The goats, sheep and rabbits graze at their v2: the neck reaching forward and down to the grass"
			},
			{
				v: 5,
				date: "2026-10-06",
				note: "The geese graze at their v2, their necks reaching to the grass; every animal eases between its moves along the shortest turn; geese graze longer between walks"
			}
		],
		version: 5,
		film: {
			id: "sandbox-4",
			order: 3,
			label: "Sandbox 3 · a dome cell",
			areas: null,
			domes: 13,
			sets: [
				"tired-land"
			],
			parts: []
		}
	},
	{
		id: "sandbox-4",
		route: "/app/games/sandbox-4/",
		label: "Sandbox 4",
		note: "The dome cell, its food forest grown from our plants",
		gameOrder: 3,
		navigation: {
			group: "PLAY",
			order: 3,
			icon: "play",
			cover: "5ddd7dc657e28a84e7ef48b8064dafe5698791950dea387e7059b1c41e5d2fc1.jpg",
			anchors: "the Plants, each at the version its forest was planted with"
		},
		history: [
			{
				v: 1,
				date: "2026-10-05",
				note: "First version"
			},
			{
				v: 2,
				date: "2026-10-06",
				note: "Replanted the cacao, jackfruit, durian and soursop at their v2"
			},
			{
				v: 3,
				date: "2026-10-06",
				note: "Replanted the apple trees at v2"
			},
			{
				v: 4,
				date: "2026-10-06",
				note: "Mini fields of oats, lentils, chickpeas, edamame and hemp, and bamboo groves"
			},
			{
				v: 5,
				date: "2026-10-06",
				note: "The chicken coops, rabbit hutches and playgrounds as mini domes (their v2), eggs in the nests"
			},
			{
				v: 6,
				date: "2026-10-06",
				note: "Paths routed round the coops and squares: in from every dome to the master’s nearest door"
			},
			{
				v: 7,
				date: "2026-10-06",
				note: "Ant roads you can see: bare trodden earth from every hill, crowded with ants going out and coming home"
			},
			{
				v: 8,
				date: "2026-10-06",
				note: "The goats, sheep and rabbits graze at their v2: the neck reaching forward and down to the grass"
			},
			{
				v: 9,
				date: "2026-10-06",
				note: "The geese graze at their v2, their necks reaching to the grass; every animal eases between its moves along the shortest turn; geese graze longer between walks"
			}
		],
		version: 9,
		film: {
			id: "sandbox-5",
			order: 4,
			label: "Sandbox 4 · a dome cell grown from our plants",
			areas: null,
			domes: 13,
			sets: [
				"tired-land"
			],
			parts: []
		}
	},
	{
		id: "sandbox-5",
		route: "/app/games/sandbox-5/",
		label: "Sandbox 5",
		note: "A valley of settlers: production chains, an open market, abundance for all",
		gameOrder: 4,
		navigation: {
			group: "PLAY",
			order: 4,
			icon: "play",
			cover: "a36f799daadadb75a3d845776dc8ee9730f8fd92fb1458edff5d9819c155a7c8.jpg"
		},
		version: 1,
		film: {
			id: "sandbox-6",
			order: 5,
			label: "Sandbox 5 · a valley of settlers",
			areas: null,
			parts: []
		}
	},
	{
		id: "sandbox-6",
		route: "/app/games/sandbox-6/",
		label: "Sandbox 6",
		note: "One village at its real size round the Tower180 hex",
		gameOrder: 5,
		navigation: {
			group: "PLAY",
			order: 5,
			icon: "play",
			note: "One village at its real size: six living hexes of terraced Dome40 and Dome80 homes and Dome120s round the Tower180 hex, in tonnes, euros and hectares",
			cover: "46e52e9e393b192c0a6db481e95fbf623e8d12d2753a3e1d15d1663292d2c716.jpg"
		},
		version: 1
	},
	{
		id: "maiacity-v2",
		route: "/app/maiacity-v2/",
		label: "MaiaCity V2",
		note: "Three players, two COOPs, two tents, one shared world",
		gameOrder: 6,
		navigation: {
			group: "CITY",
			order: 1,
			icon: "coops",
			cover: "/maiacity-v2/cover.jpg"
		},
		version: 1,
		film: {
			id: "maiacity-v2",
			order: 8,
			label: "MaiaCity V2 · the intro",
			areas: [
				"A",
				"B",
				"C"
			],
			areaNames: {
				A: "Player 1",
				B: "Player 2",
				C: "Player 3"
			},
			parts: [
				{
					id: "van",
					label: "The van",
					channels: {
						along: {
							label: "Along the highway",
							range: [
								0,
								1
							],
							unit: "0 far out on the steppe · 1 at the bus stop"
						}
					}
				},
				{
					id: "pickup",
					label: "The pickup",
					channels: {
						along: {
							label: "Along the track",
							range: [
								0,
								1
							],
							unit: "0 the gas station · 1 home"
						}
					}
				},
				{
					id: "tent",
					label: "The bell tent",
					channels: {
						pitch: {
							label: "Pitched",
							range: [
								0,
								1
							],
							unit: "0 in its bag · 1 standing"
						}
					}
				}
			]
		}
	},
	{
		id: "maiacity-v1",
		route: "/app/maiacity-v1/",
		label: "MaiaCity V1",
		note: "Two players, three COOPs, one hex, one tent, one Balancer pool",
		gameOrder: 7,
		navigation: {
			group: "CITY",
			order: 0,
			icon: "coops",
			cover: "/maiacity-v1/cover.jpg"
		},
		version: 1,
		film: {
			id: "maiacity-v1",
			order: 7,
			label: "MaiaCity V1 · the intro",
			areas: [
				"A",
				"B"
			],
			areaNames: {
				A: "Player 1",
				B: "Player 2"
			},
			parts: [
				{
					id: "van",
					label: "The van",
					channels: {
						along: {
							label: "Along the highway",
							range: [
								0,
								1
							],
							unit: "0 far out on the steppe · 1 at the bus stop"
						}
					}
				},
				{
					id: "pickup",
					label: "The pickup",
					channels: {
						along: {
							label: "Along the track",
							range: [
								0,
								1
							],
							unit: "0 the gas station · 1 home"
						}
					}
				},
				{
					id: "tent",
					label: "The bell tent",
					channels: {
						pitch: {
							label: "Pitched",
							range: [
								0,
								1
							],
							unit: "0 in its bag · 1 standing"
						}
					}
				}
			]
		}
	},
	{
		id: "tired-land",
		route: "/app/worlds/tired-land/",
		label: "The tired land",
		note: "Day 19: fields of one crop, a highway, trucks",
		gameOrder: 8,
		navigation: {
			group: "WORLDS",
			order: 0,
			icon: "play",
			note: "Day 19 · fields of one crop, a highway, trucks"
		},
		version: 1,
		film: {
			id: "tired-land",
			order: 6,
			label: "The tired land · fields, a highway, trucks",
			areas: null,
			parts: []
		}
	},
	{
		id: "sandbox-7",
		route: "/app/games/sandbox-7/",
		label: "Sandbox 7",
		note: "The physical world lab: buildings assembled from their parts, with rigid-body physics, fixings, wind and damage",
		navigation: {
			cover: "283183b9a62cb7806819cf26e285ba73704b3fcad19cebaddb3d0a5b40023f1d.png",
			group: "PLAY",
			order: 6,
			icon: "play",
			note: "The physical world lab: buildings assembled from their parts, with rigid-body physics, fixings, wind and damage"
		},
		version: 1
	},
	{
		id: "sandbox-8",
		route: "/app/games/sandbox-8/",
		label: "Sandbox 8",
		note: "Constructible City: a settlement built by people with their hands, tools and machines, in real weather",
		navigation: {
			cover: "2c5ab245e0c841aaee0c3a308b0e2d2f395ba26ad5bc0ff0b533666480fdb537.png",
			group: "PLAY",
			order: 7,
			icon: "play",
			note: "Constructible City: a settlement built by people with their hands, tools and machines, in real weather"
		},
		version: 1
	},
	{
		id: "dome-interior",
		route: "/app/buildings/",
		label: "Inside a dome (the Buildings app)",
		note: "",
		version: 1,
		film: {
			id: "sandbox-3",
			order: 2,
			label: "Inside a dome (the Buildings app)",
			areas: [
				"home",
				"tent",
				"glamp",
				"large",
				"master",
				"factory"
			],
			parts: []
		}
	}
];

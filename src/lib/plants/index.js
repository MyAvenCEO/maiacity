/*
 * THE PLANTS — every plant grown from code, as the plants viewer (/app/plants/) lists it: its name, what it is, its
 * ten stages from seed to ripe fruit (the last four the fruit's own: set, green, turning, ripe), and the function that
 * grows it at a stage from a seed id (./strawberry.js, ./cucumber.js, ./raspberry.js, ./tomato.js with its oxheart,
 * ./eggplant.js, ./coconut.js, ./grape.js, ./tropics.js (banana, red banana, pineapple, papaya, passion fruit),
 * ./herbs.js (the kitchen herbs, lavender and Bärlauch), ./ground.js (haircap moss, wine cap, shiitake, oyster),
 * ./fruittrees.js (cherry, pear, peach, apricot, plum, persimmon, mulberry, fig, safou, soursop, sapodilla, avocado),
 * ./garden.js (pepper, pumpkin, blueberry), ./vegetables.js (radish, carrot, lettuce, garlic), ./trees.js (mango,
 * apple, orange, lemon, durian, jackfruit, through ./orchard.js and ./crown.js), ./groves.js (pomegranate, olive,
 * coffee, cacao, through ./orchard.js too), ./ginger.js, ./allies.js (comfrey, white clover), ./greens.js (Swiss chard,
 * kale) and ./beans.js (the runner bean up its cane) — all of it made of ./grow.js, ./sprout.js, ./leaves.js,
 * ./bloom.js and ./tree.js). The same seed id grows the same plant every time; another id, a sister plant — leaner or
 * bushier, its leaves turned otherwise, its roots another way through the soil. A new plant is a file here and a line
 * below.
 */
import { STAGES as STRAWBERRY, strawberry } from './strawberry.js';
import { STAGES as CUCUMBER, cucumber } from './cucumber.js';
import { STAGES as RASPBERRY, raspberry } from './raspberry.js';
import { OXHEART_STAGES, STAGES as TOMATO, oxheart, tomato } from './tomato.js';
import { STAGES as EGGPLANT, eggplant } from './eggplant.js';
import { STAGES as COCONUT, coconut } from './coconut.js';
import { APPLE_STAGES, DURIAN_STAGES, JACKFRUIT_STAGES, LEMON_STAGES, MANGO_STAGES, ORANGE_STAGES, apple, durian, jackfruit, lemon, mango, orange } from './trees.js';
import { CARROT_STAGES, GARLIC_STAGES, LETTUCE_STAGES, RADISH_STAGES, carrot, garlic, lettuce, radish } from './vegetables.js';
import { STAGES as GRAPE, grape } from './grape.js';
import { BANANA_STAGES, RED_BANANA_STAGES, PAPAYA_STAGES, PASSION_STAGES, PINEAPPLE_STAGES, banana, papaya, passionFruit, pineapple, redBanana } from './tropics.js';
import { BASIL_STAGES, CHIVES_STAGES, CORIANDER_STAGES, DILL_STAGES, LAVENDER_STAGES, LEMON_BALM_STAGES, MINT_STAGES, OREGANO_STAGES, PARSLEY_STAGES, ROSEMARY_STAGES, SAGE_STAGES, THYME_STAGES, WILD_GARLIC_STAGES, basil, chives, coriander, dill, lavender, lemonBalm, mint, oregano, parsley, rosemary, sage, thyme, wildGarlic } from './herbs.js';
import { MOSS_STAGES, OYSTER_STAGES, SHIITAKE_STAGES, WINECAP_STAGES, moss, oyster, shiitake, wineCap } from './ground.js';
import { FIG_STAGES, MULBERRY_STAGES, PERSIMMON_STAGES, fig, mulberry, persimmon } from './fruittrees.js';
import { APRICOT_STAGES, AVOCADO_STAGES, CHERRY_STAGES, PEACH_STAGES, PEAR_STAGES, PLUM_STAGES, SAFOU_STAGES, SAPODILLA_STAGES, SOURSOP_STAGES, apricot, avocado, cherry, peach, pear, plum, safou, sapodilla, soursop } from './fruittrees.js';
import { BLUEBERRY_STAGES, PEPPER_STAGES, PUMPKIN_STAGES, blueberry, pepper, pumpkin } from './garden.js';
import { CACAO_STAGES, COFFEE_STAGES, OLIVE_STAGES, POMEGRANATE_STAGES, cacao, coffee, olive, pomegranate } from './groves.js';
import { GINGER_STAGES, ginger } from './ginger.js';
import { CLOVER_STAGES, COMFREY_STAGES, clover, comfrey } from './allies.js';
import { CHARD_STAGES, KALE_STAGES, chard, kale } from './greens.js';
import { BEAN_STAGES, beans } from './beans.js';

import { at, versioned } from '../app/versions.js';

/** @typedef {{ name: string, day: number, note: string }} Stage */
/**
 * @typedef {{
 *   id: string, label: string, latin: string, note: string, from: string, stages: Stage[],
 *   grow: (stage: number, seed: string) => import('three').Group, layer?: Layer
 * }} Plant — `grow` builds it at a stage (0 … 9, the stages' indices; between them, on the way)
 */

/** @type {Plant[]} */
const ALL = [
	{
		id: 'strawberry',
		label: 'Strawberry',
		latin: 'Fragaria × ananassa',
		note: 'From an achene on the soil to a rosette in fruit with a runner: trifoliate toothed leaves, white flowers, berries ripening from the tip.',
		from: 'Rosette · 150 days',
		stages: STRAWBERRY,
		grow: strawberry
	},
	{
		id: 'cucumber',
		label: 'Cucumber',
		latin: 'Cucumis sativus',
		note: 'From a flat seed to a vine on its stake: lobed rough leaves, coiling tendrils, yellow flowers, warted cucumbers hanging.',
		from: 'Vine · 70 days',
		stages: CUCUMBER,
		grow: cucumber
	},
	{
		id: 'raspberry',
		label: 'Raspberry',
		latin: 'Rubus idaeus · Himbeere',
		note: 'From a pitted seed to a prickly cane, leafy its first summer; its second, side shoots of small white flowers and clusters of red raspberries, new canes and a sucker beside it.',
		from: 'Cane · 2 summers',
		stages: RASPBERRY,
		grow: raspberry
	},
	{
		id: 'tomato',
		label: 'Tomato',
		latin: 'Solanum lycopersicum',
		note: 'From a flat hairy seed to a staked cordon: ragged compound leaves, trusses of nodding yellow stars, tomatoes ripening truss by truss from green through orange to red.',
		from: 'Cordon · 105 days',
		stages: TOMATO,
		grow: tomato
	},
	{
		id: 'oxheart',
		label: 'Oxheart tomato',
		latin: 'Solanum lycopersicum · Ochsenherz',
		note: 'A tall slender cordon, its wispy leaves hanging as if wilted; few, huge heart-shaped tomatoes to a truss, ribbed at the shoulders, ripening late to a pinkish red.',
		from: 'Cordon · 125 days',
		stages: OXHEART_STAGES,
		grow: oxheart
	},
	{
		id: 'eggplant',
		label: 'Eggplant',
		latin: 'Solanum melongena · Aubergine',
		note: 'A forked bush of big soft grey-green leaves with purple midribs, nodding violet stars, long glossy black-purple fruit under spiny green calyxes.',
		from: 'Bush · 115 days',
		stages: EGGPLANT,
		grow: eggplant
	},
	{
		id: 'king-coconut',
		label: 'King coconut',
		latin: "Cocos nucifera 'King' · Thambili",
		note: 'A palm from a whole golden nut: whole first leaves, then a ringed trunk and a crown of arching fronds, cream flower spikes and bunches of golden-orange nuts.',
		from: 'Palm · 7 years',
		stages: COCONUT,
		grow: coconut
	},
	{
		id: 'mango',
		label: 'Mango',
		latin: 'Mangifera indica',
		note: 'From a flat stone to a dome as wide as it is tall: a short trunk, scaffold limbs at 45°, flush after flush breaking in whorls from each tip; bronze-red new leaves, panicles at the tips, mangoes on long stalks turning gold and red.',
		from: 'Tree · 6 years',
		stages: MANGO_STAGES,
		grow: mango
	},
	{
		id: 'radish',
		label: 'Radish',
		latin: 'Raphanus sativus · Radieschen',
		note: 'Four weeks from seed: heart-shaped seed leaves, rough lobed leaves, the stem below them swelling into a red ball half out of the soil.',
		from: 'Root · 28 days',
		stages: RADISH_STAGES,
		grow: radish
	},
	{
		id: 'carrot',
		label: 'Carrot',
		latin: 'Daucus carota · Karotte',
		note: 'Grass-like seed leaves, then a fountain of ferny leaves over a taproot thickening down its length into a long orange cone.',
		from: 'Root · 95 days',
		stages: CARROT_STAGES,
		grow: carrot
	},
	{
		id: 'lettuce',
		label: 'Lettuce',
		latin: 'Lactuca sativa · Kopfsalat',
		note: 'A butterhead: a rosette of broad wavy leaves, the inner ones standing up and cupping over each other into a pale, buttery head.',
		from: 'Head · 55 days',
		stages: LETTUCE_STAGES,
		grow: lettuce
	},
	{
		id: 'garlic',
		label: 'Garlic',
		latin: 'Allium sativum · Knoblauch',
		note: 'A clove planted in autumn: roots from its base, flat blue-green leaves in two ranks, a winter’s rest, then a bulb of new cloves under purple-streaked skins and a curling scape.',
		from: 'Bulb · 9 months',
		stages: GARLIC_STAGES,
		grow: garlic
	},
	{
		id: 'grape',
		label: 'Red grape',
		latin: 'Vitis vinifera · Traube',
		note: 'From a pip to a vine trained on its post and wire: a woody trunk, two arms, green shoots with five-lobed leaves and tendrils, bunches turning red berry by berry.',
		from: 'Vine · 3 summers',
		stages: GRAPE,
		grow: grape
	},
	{
		id: 'apple',
		label: 'Apple',
		latin: 'Malus domestica · Apfel',
		note: 'From a pip to an open crown on scaffold limbs: toothed leaves, clusters of pink-budded white blossom, apples flushing red on the sunny side.',
		from: 'Tree · 6 years',
		stages: APPLE_STAGES,
		grow: apple
	},
	{
		id: 'orange',
		label: 'Orange',
		latin: 'Citrus × sinensis · Orange',
		note: 'A dense evergreen dome of glossy leaves, waxy white blossom heavy with scent, round fruit full-sized green before they turn orange.',
		from: 'Tree · 7 years',
		stages: ORANGE_STAGES,
		grow: orange
	},
	{
		id: 'lemon',
		label: 'Lemon',
		latin: 'Citrus × limon · Zitrone',
		note: 'An open, thorny little tree, its new leaves flushed purple, purple-budded white flowers, oval fruit with a nipple turning yellow from the tip.',
		from: 'Tree · 6 years',
		stages: LEMON_STAGES,
		grow: lemon
	},
	{
		id: 'durian',
		label: 'Durian',
		latin: 'Durio zibethinus',
		note: 'A tall conical tree, its near-level limbs in tiers; clusters of cream flowers along the limbs, then heavy spiny fruit hanging from them.',
		from: 'Tree · 8 years',
		stages: DURIAN_STAGES,
		grow: durian
	},
	{
		id: 'jackfruit',
		label: 'Jackfruit',
		latin: 'Artocarpus heterophyllus · Jackfrucht',
		note: 'A dense dome over a stout trunk; its flower heads and huge knobbly fruit burst straight out of the trunk and thickest limbs.',
		from: 'Tree · 6 years',
		stages: JACKFRUIT_STAGES,
		grow: jackfruit
	},
	{
		id: 'banana',
		label: 'Banana',
		latin: 'Musa acuminata · Banane',
		note: 'From a sucker: a pseudostem of rolled leaf sheaths, huge paddle leaves torn by the wind; the flower stalk bends over, purple bracts lift off hands of fingers curving up, the male bud hanging below.',
		from: 'Herb · 13 months',
		stages: BANANA_STAGES,
		grow: banana
	},
	{
		id: 'pepper',
		label: 'Bell pepper',
		latin: 'Capsicum annuum · Paprika',
		note: 'A little forking bush of glossy pointed leaves, a white flower nodding in every fork, blocky bells hanging green, then turning red.',
		from: 'Bush · 135 days',
		stages: PEPPER_STAGES,
		grow: pepper
	},
	{
		id: 'pumpkin',
		label: 'Pumpkin',
		latin: 'Cucurbita maxima · Kürbis (Hokkaido)',
		note: 'A vine running along the ground, rooting at its nodes, huge lobed leaves standing up, big yellow trumpets, ribbed pumpkins lying on the soil turning deep orange.',
		from: 'Vine · 110 days',
		stages: PUMPKIN_STAGES,
		grow: pumpkin
	},
	{
		id: 'pineapple',
		label: 'Pineapple',
		latin: 'Ananas comosus · Ananas',
		note: 'From a crown: a rosette of stiff spiny grey-green leaves; a red cone of violet flowers rises from its heart and fuses into one fruit, its eyes in spirals, yellowing from the base.',
		from: 'Rosette · 2 years',
		stages: PINEAPPLE_STAGES,
		grow: pineapple
	},
	{
		id: 'blueberry',
		label: 'Blueberry',
		latin: 'Vaccinium corymbosum · Blaubeere',
		note: 'A twiggy shrub of many canes, small elliptic leaves, hanging clusters of white urn-shaped bells, berries turning pink, then blue under a silvery bloom.',
		from: 'Shrub · 4 years',
		stages: BLUEBERRY_STAGES,
		grow: blueberry
	},
	{
		id: 'red-banana',
		label: 'Red banana',
		latin: "Musa acuminata 'Red Dacca' · Rote Banane",
		note: 'The banana’s red sister: its pseudostem, leaf stalks and midribs flushed red-purple, short thick fingers ripening maroon to a dusky purple-red.',
		from: 'Herb · 14 months',
		stages: RED_BANANA_STAGES,
		grow: redBanana
	},
	{
		id: 'papaya',
		label: 'Papaya',
		latin: "Carica papaya",
		note: 'One unbranched scarred stem, a crown of huge palmate leaves on long hollow stalks; cream flowers and then a ring of papayas hugging the stem in the leaf axils, ripening from below.',
		from: 'Herb-tree · 11 months',
		stages: PAPAYA_STAGES,
		grow: papaya
	},
	{
		id: 'passion-fruit',
		label: 'Passion fruit',
		latin: "Passiflora edulis · Maracuja",
		note: 'A vine up its stake and along a wire, shoots hanging like a curtain; three-lobed leaves, astonishing flowers with a crown of purple-and-white filaments, round fruit turning purple and wrinkling.',
		from: 'Vine · 9 months',
		stages: PASSION_STAGES,
		grow: passionFruit
	},
	{
		id: 'safou',
		label: 'Safou',
		latin: "Dacryodes edulis · Safou",
		note: 'A dense evergreen dome; panicles of small flowers at the tips, then clusters of oblong fruit turning from pink to deep blue-violet.',
		from: 'Tree · 6 years',
		stages: SAFOU_STAGES,
		grow: safou
	},
	{
		id: 'soursop',
		label: 'Soursop',
		latin: "Annona muricata · Corossol",
		note: 'A small glossy-leaved tree; thick yellow-green flowers straight out of its limbs, then big heart-shaped fruit covered in soft curved spines.',
		from: 'Tree · 4 years',
		stages: SOURSOP_STAGES,
		grow: soursop
	},
	{
		id: 'sapodilla',
		label: 'Sapodilla',
		latin: "Manilkara zapota · Sapotille",
		note: 'A dense evergreen pyramid, glossy leaves crowded in whorls at the shoot tips; small whitish bells, then round-oval fruit with a sandy brown scurfy skin.',
		from: 'Tree · 7 years',
		stages: SAPODILLA_STAGES,
		grow: sapodilla
	},
	{
		id: 'cherry',
		label: 'Cherry',
		latin: "Prunus avium · Kirsche",
		note: 'A tall steep crown; white blossom in clusters on the spurs, glossy cherries in pairs on long stalks, yellow to red to dark red.',
		from: 'Tree · 5 years',
		stages: CHERRY_STAGES,
		grow: cherry
	},
	{
		id: 'pear',
		label: 'Pear',
		latin: "Pyrus communis · Birne",
		note: 'An upright narrow crown; white blossom with dark red anthers, pears narrow at the stalk and round below, yellowing with a russet cheek.',
		from: 'Tree · 6 years',
		stages: PEAR_STAGES,
		grow: pear
	},
	{
		id: 'peach',
		label: 'Peach',
		latin: "Prunus persica · Pfirsich",
		note: 'An open vase on three or four limbs, long narrow leaves, pink blossom; fuzzy peaches with a suture, yellow blushing red.',
		from: 'Tree · 4 years',
		stages: PEACH_STAGES,
		grow: peach
	},
	{
		id: 'apricot',
		label: 'Apricot',
		latin: "Prunus armeniaca · Aprikose",
		note: 'An open spreading crown, round pointed leaves; white blossom blushed pink, velvety orange apricots freckled red.',
		from: 'Tree · 4 years',
		stages: APRICOT_STAGES,
		grow: apricot
	},
	{
		id: 'plum',
		label: 'Plum',
		latin: "Prunus domestica · Zwetschge",
		note: 'A rounded crown, knobbly with spurs; white blossom in pairs, oval plums with a suture turning blue-black under a pale bloom.',
		from: 'Tree · 5 years',
		stages: PLUM_STAGES,
		grow: plum
	},
	{
		id: 'avocado',
		label: 'Avocado',
		latin: "Persea americana 'Hass' · Avocado",
		note: 'From a big stone that splits open: bronze-red flushes greening to big leathery leaves, a broad dome, panicles of tiny flowers, pear-shaped pebbly fruit on long stalks darkening to purple-black.',
		from: 'Tree · 7 years',
		stages: AVOCADO_STAGES,
		grow: avocado
	},
	{
		id: 'moss',
		label: 'Haircap moss',
		latin: "Polytrichum commune · Widertonmoos",
		note: 'From a spore: a green thread over the soil, buds, star-like leafy shoots crowding into a cushion and a carpet; red-brown stalks with hairy-capped capsules that ripen and shed their spores.',
		from: 'Ground · 2 years',
		stages: MOSS_STAGES,
		grow: moss
	},
	{
		id: 'wine-cap',
		label: 'Wine cap',
		latin: "Stropharia rugosoannulata · Riesenträuschling",
		note: 'The food forest’s mushroom: spawn in a bed of wood chips, white rhizomorphs binding the chips and running into the soil, then a troop of wine-red caps on white stems.',
		from: 'Fungus · 4 months',
		stages: WINECAP_STAGES,
		grow: wineCap
	},
	{
		id: 'shiitake',
		label: 'Shiitake',
		latin: "Lentinula edodes · Shiitake",
		note: 'An oak log plugged with spawn and sealed with wax; months of colonising, a cold soak, then brown flecked caps breaking from the bark, again for years.',
		from: 'Fungus · 1 year',
		stages: SHIITAKE_STAGES,
		grow: shiitake
	},
	{
		id: 'oyster',
		label: 'Oyster mushroom',
		latin: "Pleurotus ostreatus · Austernpilz",
		note: 'A standing beech log; after the first cold rains, clusters of grey-blue fans that spread into overlapping shelves, their white gills running down the stem.',
		from: 'Fungus · 5 months',
		stages: OYSTER_STAGES,
		grow: oyster
	},
	{
		id: 'basil',
		label: 'Basil',
		latin: "Ocimum basilicum · Basilikum",
		note: "Glossy cupped leaves in pairs on a soft square stem, pinched into a bush; white whorled flower spikes; an annual.",
		from: 'Herb · 100 days',
		stages: BASIL_STAGES,
		grow: basil
	},
	{
		id: 'parsley',
		label: 'Parsley',
		latin: "Petroselinum crispum · Petersilie",
		note: "A rosette of flat, divided, toothed leaves through its first year; in its second, a stem of yellow-green umbels and ribbed seeds.",
		from: 'Herb · 2 years',
		stages: PARSLEY_STAGES,
		grow: parsley
	},
	{
		id: 'chives',
		label: 'Chives',
		latin: "Allium schoenoprasum · Schnittlauch",
		note: "A clump of little bulbs and hollow tubular leaves, cut and cut again; purple pompoms in its second spring.",
		from: 'Herb · perennial',
		stages: CHIVES_STAGES,
		grow: chives
	},
	{
		id: 'wild-garlic',
		label: 'Wild garlic',
		latin: "Allium ursinum · Bärlauch",
		note: "A woodland bulb from a seed that needs a winter’s cold: years later, two or three broad garlicky leaves, a ball of white stars, then gone till next spring.",
		from: 'Bulb · 3 years',
		stages: WILD_GARLIC_STAGES,
		grow: wildGarlic
	},
	{
		id: 'thyme',
		label: 'Thyme',
		latin: "Thymus vulgaris · Thymian",
		note: "A little woody evergreen shrub of wiry stems and tiny leaves, clouds of pink flowers at the tips.",
		from: 'Herb · perennial',
		stages: THYME_STAGES,
		grow: thyme
	},
	{
		id: 'rosemary',
		label: 'Rosemary',
		latin: "Salvia rosmarinus · Rosmarin",
		note: "Upright woody stems crowded with dark needle leaves, pale blue flowers along them in late winter.",
		from: 'Shrub · perennial',
		stages: ROSEMARY_STAGES,
		grow: rosemary
	},
	{
		id: 'sage',
		label: 'Sage',
		latin: "Salvia officinalis · Salbei",
		note: "A shrub of soft, pebbled, silver-grey leaves on woody stems; violet-blue flowers in whorls up tall spikes.",
		from: 'Shrub · perennial',
		stages: SAGE_STAGES,
		grow: sage
	},
	{
		id: 'mint',
		label: 'Mint',
		latin: "Mentha × piperita · Minze",
		note: "Toothed wrinkled leaves on purplish square stems, runners rooting all round it, lilac flower spikes.",
		from: 'Herb · perennial',
		stages: MINT_STAGES,
		grow: mint
	},
	{
		id: 'oregano',
		label: 'Oregano',
		latin: "Origanum vulgare · Oregano",
		note: "A low mat of small round leaves sending up branching stems topped with clusters of pink-purple flowers.",
		from: 'Herb · perennial',
		stages: OREGANO_STAGES,
		grow: oregano
	},
	{
		id: 'lemon-balm',
		label: 'Lemon balm',
		latin: "Melissa officinalis · Zitronenmelisse",
		note: "A clump of bright, crinkled, heart-shaped lemony leaves; small white flowers in the axils.",
		from: 'Herb · perennial',
		stages: LEMON_BALM_STAGES,
		grow: lemonBalm
	},
	{
		id: 'dill',
		label: 'Dill',
		latin: "Anethum graveolens · Dill",
		note: "Thread-fine blue-green leaves, a single hollow stem, big umbels of yellow flowers, then flat seeds.",
		from: 'Herb · 95 days',
		stages: DILL_STAGES,
		grow: dill
	},
	{
		id: 'coriander',
		label: 'Coriander',
		latin: "Coriandrum sativum · Koriander",
		note: "Broad lobed leaves first, feathery upper ones as it bolts; lacy white umbels, then round seeds.",
		from: 'Herb · 90 days',
		stages: CORIANDER_STAGES,
		grow: coriander
	},
	{
		id: 'persimmon',
		label: 'Persimmon',
		latin: "Diospyros kaki · Kaki",
		note: "A rounded crown of big glossy leaves; pale bell flowers in the leaf axils, glossy orange fruit in four-lobed calyxes that hang on like lanterns after the leaves fall.",
		from: 'Tree · 6 years',
		stages: PERSIMMON_STAGES,
		grow: persimmon
	},
	{
		id: 'mulberry',
		label: 'Mulberry',
		latin: "Morus nigra · Maulbeere",
		note: "A broad spreading crown of toothed, often lobed leaves; green catkins, then berries like long blackberries going white, red, black, for weeks.",
		from: 'Tree · 4 years',
		stages: MULBERRY_STAGES,
		grow: mulberry
	},
	{
		id: 'fig',
		label: 'Fig',
		latin: "Ficus carica · Feige",
		note: "A low, many-stemmed tree of big rough hand-shaped leaves; its flowers hidden inside the figs, one in each leaf axil, pear-shaped, ripening purple.",
		from: 'Tree · 4 years',
		stages: FIG_STAGES,
		grow: fig
	},
	{
		id: 'pomegranate',
		label: 'Pomegranate',
		latin: "Punica granatum · Granatapfel",
		note: "A small tree of many stems, twiggy, its narrow glossy leaves bronze when new; scarlet trumpets at the shoot tips, then round leathery fruit under a crown, yellow flushing red.",
		from: 'Tree · 4 years',
		stages: POMEGRANATE_STAGES,
		grow: pomegranate
	},
	{
		id: 'olive',
		label: 'Olive',
		latin: "Olea europaea · Olive",
		note: "A gnarled grey trunk under a dome of narrow silvery leaves; sprays of tiny cream flowers in the leaf axils of last year’s shoots, olives ripening green, violet, black.",
		from: 'Tree · 6 years',
		stages: OLIVE_STAGES,
		grow: olive
	},
	{
		id: 'coffee',
		label: 'Coffee',
		latin: "Coffea arabica · Kaffee",
		note: "One upright stem, level branches in pairs tier on tier, glossy dark leaves; white star flowers crowding the leaf axils along the branches, then cherries turning yellow and red.",
		from: 'Shrub · 4 years',
		stages: COFFEE_STAGES,
		grow: coffee
	},
	{
		id: 'cacao',
		label: 'Cacao',
		latin: "Theobroma cacao · Kakao",
		note: "A stem to its jorquette, then a fan of level branches hung with big limp leaves, red when new; tiny pink-white flowers and big ridged pods straight out of the trunk and thick limbs.",
		from: 'Tree · 4 years',
		stages: CACAO_STAGES,
		grow: cacao
	},
	{
		id: 'ginger',
		label: 'Ginger',
		latin: "Zingiber officinale · Ingwer",
		note: "From a piece of rhizome: reed-like stems a metre high, two ranks of narrow leaves; below the soil, the hand branching into knobbly fingers, pink where each stem rises.",
		from: 'Rhizome · 9 months',
		stages: GINGER_STAGES,
		grow: ginger
	},
	{
		id: 'comfrey',
		label: 'Comfrey',
		latin: "Symphytum officinale · Beinwell",
		note: "A clump of big bristly leaves over a deep black taproot; stems of curled cymes uncurling as their nodding purple bells open; cut and laid down as mulch, again and again.",
		from: 'Herb · perennial',
		stages: COMFREY_STAGES,
		grow: comfrey
	},
	{
		id: 'clover',
		label: 'White clover',
		latin: "Trifolium repens · Weißklee",
		note: "Stolons creeping over the soil and rooting at every node; leaves of three with a pale chevron, round white flower heads, pink nodules on the roots fixing nitrogen.",
		from: 'Ground · perennial',
		stages: CLOVER_STAGES,
		grow: clover
	},
	{
		id: 'chard',
		label: 'Swiss chard',
		latin: "Beta vulgaris var. cicla · Mangold",
		note: "A rosette of big glossy, blistered leaves on thick stalks — red, yellow, orange, pink or white by the seed — picked from the outside all summer.",
		from: 'Leaves · 110 days',
		stages: CHARD_STAGES,
		grow: chard
	},
	{
		id: 'kale',
		label: 'Kale',
		latin: "Brassica oleracea var. sabellica · Grünkohl",
		note: "An upright stem crowned with blue-green leaves, curled and frilled or long and blistered (Lacinato); picked from the bottom up, the stem bare and scarred like a little palm.",
		from: 'Leaves · 180 days',
		stages: KALE_STAGES,
		grow: kale
	},
	{
		id: 'beans',
		label: 'Runner bean',
		latin: "Phaseolus coccineus · Feuerbohne",
		note: "The bean stays below; the shoot winds anticlockwise up its cane, leaves of three, sprays of scarlet (or white) flowers, long green pods hanging in bunches.",
		from: 'Vine · 95 days',
		stages: BEAN_STAGES,
		grow: beans
	},
	{
		id: 'lavender',
		label: 'Lavender',
		latin: "Lavandula angustifolia · Lavendel",
		note: "A grey-green mound of narrow leaves on a woody base; long bare stalks above it, each tipped with a spike of purple whorls.",
		from: 'Shrub · perennial',
		stages: LAVENDER_STAGES,
		grow: lavender
	}
];

/** seed ids to start from: any text grows a plant */
/**
 * THE SEVEN LAYERS of a food forest, as permaculture plants one — from the canopy down through the soil, and up the
 * others: every plant here is put in the one it grows in when grown, and the list is shown layer by layer. The fungi,
 * the mycelium threading the soil and feeding the roots, are the eighth layer some count.
 * @typedef {'canopy' | 'sub-canopy' | 'shrub' | 'herbaceous' | 'ground' | 'root' | 'climber' | 'fungi'} Layer
 */
/** @type {{ id: Layer, label: string, note: string }[]} */
export const LAYERS = [
	{ id: 'canopy', label: '1 · Canopy', note: 'the tall trees over everything' },
	{ id: 'sub-canopy', label: '2 · Low trees', note: 'the smaller trees under the canopy: fruit and nut trees, the big herbs that stand like them' },
	{ id: 'shrub', label: '3 · Shrubs', note: 'the bushes: berries, woody herbs' },
	{ id: 'herbaceous', label: '4 · Herbaceous', note: 'soft plants that die back or are grown each year: vegetables and herbs' },
	{ id: 'ground', label: '5 · Ground cover', note: 'low and spreading over the soil, keeping it covered' },
	{ id: 'root', label: '6 · Roots', note: 'grown for what they swell below the soil: roots, tubers, bulbs' },
	{ id: 'climber', label: '7 · Climbers', note: 'vines that climb the trees, the stakes and the wires' },
	{ id: 'fungi', label: '8 · Fungi', note: 'the mycelium in the soil and the wood, and the mushrooms it fruits' }
];

/** which layer each plant grows in */
const LAYER_OF = /** @type {Record<string, Layer>} */ ({
	'king-coconut': 'canopy', mango: 'canopy', durian: 'canopy', jackfruit: 'canopy', avocado: 'canopy', safou: 'canopy', sapodilla: 'canopy',
	persimmon: 'sub-canopy', mulberry: 'sub-canopy', fig: 'sub-canopy',
	pomegranate: 'sub-canopy', olive: 'sub-canopy', cacao: 'sub-canopy',
	coffee: 'shrub', lavender: 'shrub',
	comfrey: 'herbaceous', chard: 'herbaceous', kale: 'herbaceous',
	clover: 'ground',
	ginger: 'root',
	beans: 'climber',
	apple: 'sub-canopy', pear: 'sub-canopy', cherry: 'sub-canopy', peach: 'sub-canopy', apricot: 'sub-canopy', plum: 'sub-canopy', orange: 'sub-canopy', lemon: 'sub-canopy', soursop: 'sub-canopy', papaya: 'sub-canopy', banana: 'sub-canopy', 'red-banana': 'sub-canopy',
	raspberry: 'shrub', blueberry: 'shrub', rosemary: 'shrub', sage: 'shrub',
	tomato: 'herbaceous', oxheart: 'herbaceous', eggplant: 'herbaceous', pepper: 'herbaceous', lettuce: 'herbaceous', pineapple: 'herbaceous', basil: 'herbaceous', parsley: 'herbaceous', chives: 'herbaceous', mint: 'herbaceous', 'lemon-balm': 'herbaceous', dill: 'herbaceous', coriander: 'herbaceous',
	strawberry: 'ground', thyme: 'ground', oregano: 'ground', pumpkin: 'ground', moss: 'ground', 'wild-garlic': 'ground',
	carrot: 'root', radish: 'root', garlic: 'root',
	cucumber: 'climber', grape: 'climber', 'passion-fruit': 'climber',
	'wine-cap': 'fungi', shiitake: 'fungi', oyster: 'fungi'
});

/**
 * The plants' older versions, by id, each with its frozen `grow` ($lib/app/versions.js): a plant changed goes up a
 * version, its old grow function kept here, so the worlds anchored to it (Sandbox 5) grow it as they were planted.
 * None yet: every plant is at v1.
 * @type {Record<string, (import('../app/versions.js').Change & { build?: Plant['grow'] })[]>}
 */
const HISTORY = {};

/**
 * every plant, layer by layer from the canopy down (in each layer as they were added), with its versions
 * @type {(Plant & { versions: import('../app/versions.js').Version<Plant['grow']>[], version: number })[]}
 */
export const PLANTS = versioned(
	LAYERS.flatMap((l) => ALL.filter((p) => (LAYER_OF[p.id] ?? 'herbaceous') === l.id).map((p) => ({ ...p, layer: l.id }))),
	'grow',
	HISTORY
);

/**
 * A plant as it was at version `v` (its latest when not given): its `grow` that version's. Undefined if it has no such
 * version. A world asks for the version it was planted with.
 * @param {string} id @param {number} [v]
 */
export function plantAt(id, v) {
	const p = PLANTS.find((x) => x.id === id);
	const ver = p && at(p.versions, v);
	return p && ver ? { ...p, grow: ver.build, version: ver.v } : undefined;
}

export const SEEDS = ['maia', 'isar', 'samuel', 'backyard', 'seed-0042', 'sun', 'rain', 'domes'];

/** a fresh seed id, five letters and digits */
export const freshSeed = () => Math.random().toString(36).slice(2, 7);

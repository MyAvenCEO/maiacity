/**
 * Somewhere to live beyond the map near Göttingen (VISION "Leaving goes somewhere", design/physical-state.md 8c): what
 * a night costs, the food bought while there, when it is open, how long finding one takes. Estimates for 2026, to be
 * sourced further; the shelter is the municipality's duty to house the homeless (Nds. police law, § 11 NPOG).
 */
import { ASSUMPTION, p } from './sources.ts';

const NPOG = { title: 'Nds. Polizei- und Ordnungsbehördengesetz § 11 (danger to life and health: the municipality houses the involuntarily homeless) with the municipality’s fee statute', publisher: 'Land Niedersachsen' };
const FOOD = p(8, 'EUR', ASSUMPTION, { range: [6, 12], confidence: 'low', note: 'groceries for a day, eaten cold or where one stays (the Bürgergeld standard rate reckons some 6 € a day for food)' });

export const lodgings = {
  campsite: {
    label: 'A tent pitch at a campsite near Göttingen',
    kind: 'campsite',
    perNight: p(12, 'EUR', ASSUMPTION, { range: [8, 20], confidence: 'low', note: 'a person and a small tent a night, with showers and toilets' }),
    food: FOOD,
    // (campsites open from April to October; a pitch only: one brings one's tent and bedding)
    months: [4, 5, 6, 7, 8, 9, 10],
    bring: [['kit.tent2'], ['bedding.bag3season', 'bedding.bagWinter']],
  },
  hostel: {
    label: 'A bed in a hostel in Göttingen',
    kind: 'hostel',
    perNight: p(35, 'EUR', ASSUMPTION, { range: [28, 50], confidence: 'low', note: 'a bed in a shared room with breakfast (youth hostel, members)' }),
    food: p(5, 'EUR', ASSUMPTION, { range: [3, 8], confidence: 'low', note: 'breakfast is in the price' }),
  },
  room: {
    label: 'A room in a shared flat in Göttingen',
    kind: 'room',
    perNight: p(15, 'EUR', ASSUMPTION, { range: [12, 20], confidence: 'low', note: 'some 450 € a month warm for a room in a shared flat in a university town (2025/26 surveys put Göttingen near 430–470 €)' }),
    food: FOOD,
    wait: p(28, 'd', ASSUMPTION, { range: [7, 90], confidence: 'low', note: 'finding a room: some weeks of looking and viewings; less in spring, more in October' }),
  },
  // (no lodging one chooses: the rescue service brings one there, living's rescue)
  hospital: {
    label: 'The hospital in Göttingen (Universitätsmedizin)',
    kind: 'hospital',
    perNight: p(10, 'EUR', { title: '§ 39 Abs. 4 SGB V: an insured adult pays 10 € a day in hospital, for at most 28 days a calendar year', publisher: 'BMJ (gesetze-im-internet.de)' }, { confidence: 'high' }),
    food: p(0, 'EUR', { title: '§ 39 SGB V: hospital treatment includes board', publisher: 'BMJ (gesetze-im-internet.de)' }, { confidence: 'high' }),
    daysAYear: p(28, 'd', { title: '§ 39 Abs. 4 SGB V: the 10 € a day for at most 28 days a calendar year (§ 61 Satz 2)', publisher: 'BMJ (gesetze-im-internet.de)' }, { confidence: 'high' }),
  },
  shelter: {
    label: 'The town’s emergency shelter',
    kind: 'shelter',
    perNight: p(9, 'EUR', NPOG, { range: [5, 15], confidence: 'low', note: 'a usage fee a night by the municipality’s statute; for those without income the job centre pays it' }),
    food: FOOD,
    always: true,
  },
};

/**
 * Goods a lorry set down at the roadside, unwatched overnight (S5b, audit G1): theft from sites and roadsides is common
 * in Germany (insurers put building-site theft at some hundreds of millions € a year), but no rate a night is published:
 * the numbers are estimates, kept low (a careful household carries its goods in, or someone stays by them).
 */
export const roadside = {
  perNight: p(0.02, '1', ASSUMPTION, { range: [0.005, 0.1], confidence: 'low', note: 'a lot worth a van-load and more left unwatched by a public way: taken some nights in a hundred (estimate)' }),
  worth: p(1000, 'EUR', ASSUMPTION, { range: [300, 3000], confidence: 'low', note: 'what makes a lot worth a thief’s trip; less is taken less often (estimate)' }),
  load: p(1000, 'kg', ASSUMPTION, { range: [500, 1500], confidence: 'low', note: 'what is carried off in a van in a night' }),
  watch: p(50, 'm', ASSUMPTION, { range: [20, 100], confidence: 'low', note: 'one of ours this near sees to it' }),
  dear: p(0.5, 'EUR/kg', ASSUMPTION, { range: [0.2, 2], confidence: 'low', note: 'goods worth carrying off by their weight (reinforcing steel, timber, fuel, tools: yes; gravel, bricks: hardly)' }),
};

/**
 * Vehicle profiles and network settings.
 *
 * Speeds: effective lorry speed on public roads 50–60 km/h (derived from the BVFW/Naumann freight
 * tariffs), site haul roads 15 km/h loaded / 25 empty (Cat rolling-resistance estimate), gravel
 * roads ~35 km/h (estimate). Axle loads: legal limits (10 t, 11.5 t driven; GVW 26 t / 32 t for
 * 3 / 4 axles); the 4-axle split 5/6/10.5/10.5 t is the RLW reference (ΣÄF 2.62).
 */
import type { Param } from '../../kernel/src/index.ts';
import { ASSUMPTION, AXLE_LIMITS, CAT_PHB, FOURTH_POWER, HAMM, MARTA, NAUMANN, PERMITS, WKO_ARGE, RLW, ROADS_DERIVED, SPEED_DERIVED, cite, p, series } from './sources.ts';

const SITE_SPEED = cite(CAT_PHB, 'site haul roads ~15 km/h loaded / 25 km/h empty (rolling resistance 3–5 %), research estimate');
const GRAVEL_SPEED = cite(ASSUMPTION, 'gravel road ~35 km/h (research estimate, range 25–50), lower for heavy vehicles');

const RES = { title: 'research/de/resources.json — derived production rates', publisher: 'Constructible City research', year: 2026 };
/** how carriers unload themselves (decision 0026 A2): a set-up time and a time per tonne */
const TIP = { kind: 'tip' as const, fixed: p(66, 's', RES, { range: [60, 72], note: 'manoeuvre and dump 1.0–1.2 min' }) };
const LOADED = p(0.85, '1', cite(CAT_PHB, 'a loaded haul is slower than the empty return (rolling and grade resistance with the payload)'), { range: [0.75, 0.95], confidence: 'low', note: 'the haul calibration of the excavation rates' });

const kmh = (v: number, source = ASSUMPTION, range?: [number, number]) => p(v, 'km/h', source, range ? { range, confidence: 'low' } : { confidence: 'low' });

/** surface speed caps: asphalt / gravel / earth / external (public roads off the map). */
const speeds = (asphalt: Param, gravel: Param, earth: Param, external: Param) => ({ asphalt, gravel, earth, external });

const TOBLER = { title: 'Tobler, W.: Three presentations on geographical analysis and modeling (hiking function: 5 km/h on the flat, 6 km/h at a slight descent)', publisher: 'NCGIA Technical Report 93-1', year: 1993 };

/** walking loaded, as a share of the pace empty: one number for the handling data and the on-foot carrier */
export const WALK_LOADED = p(0.8, '1', ASSUMPTION, { range: [0.65, 0.95], confidence: 'low', note: 'walking with 20–25 kg in the arms is slower (load-carriage studies report 10–25 % slower)' });

/**
 * Breakdowns on the way (stock on the way): estimates, to be sourced. Roadside assistance in Germany
 * answers some millions of call-outs a year for some tens of millions of cars, about one breakdown in
 * a few thousand hours on the road; lorries run far more hours a year, are serviced on schedule and
 * break down about as often per hour. How long one stands: a roadside repair in an hour or two, a tow
 * and a replacement lorry half a day.
 */
const BREAKDOWN_NOTE = 'order of magnitude from roadside-assistance call-outs per vehicle-hour; no fleet statistic at hand (to be sourced)';
const LORRY_BREAKDOWN = { mtbf: p(2000, 'h', ASSUMPTION, { range: [800, 5000], confidence: 'low', note: BREAKDOWN_NOTE }), standstill: p(3, 'h', ASSUMPTION, { range: [1, 10], confidence: 'low', note: 'roadside repair, or a tow and another lorry taking the load over' }) };
const CAR_BREAKDOWN = { mtbf: p(3500, 'h', ASSUMPTION, { range: [1500, 8000], confidence: 'low', note: BREAKDOWN_NOTE }), standstill: p(1.5, 'h', ASSUMPTION, { range: [0.5, 4], confidence: 'low', note: 'the patrol fixes most on the spot within an hour or two' }) };

/**
 * The pace off the ways on ground of each trafficability (dry and firm, softened, soaked) as a share of a vehicle's
 * off-road speed (design/realism-plan.md S3): estimates after the soil-protection guidance on driving on soft soils
 * (contact pressure against bearing: some 50 kPa for tracks, 200–400 kPa under a loaded lorry's tyres) and practice on
 * building sites (a site road of gravel on fleece where lorries must drive); to be sourced in detail
 */
const OFFROAD = { title: 'Trafficability of soft ground for vehicles: estimates after soil-protection guidance (DIN 19639, BVB-Merkblatt) and site practice', publisher: 'Constructible City practice-de (estimate)' };
/** a share of the off-road pace on some ground (an estimate: ± 0.15, low confidence; none where it does not go at all) */
const share = (v: number, note?: string) => p(v, '1', OFFROAD, { range: v === 0 ? [0, 0.05] : [Math.max(0.05, +(v - 0.15).toFixed(2)), Math.min(1, +(v + 0.15).toFixed(2))], confidence: 'low', ...(note ? { note } : {}) });
/** what of a vehicle's pace is lost at the steepest grade it climbs (slowing in proportion to the grade below it) */
const slope = (v: number) => p(v, '1', OFFROAD, { range: [Math.max(0, +(v - 0.2).toFixed(2)), Math.min(0.9, +(v + 0.2).toFixed(2))], confidence: 'low', note: 'a vehicle crawls up its steepest grade in a low gear (estimate)' });

/** off the ways in the dark (S7, audit D1): below the light of the end of civil twilight one who walks feels the way, half
 * as fast (with a lamp, nearly as by day); a vehicle by its headlights, slower (estimates) */
const DARK_BELOW = p(3, 'lx', ASSUMPTION, { range: [1, 10], confidence: 'low', note: 'about the end of civil twilight (3.4 lx): ground and obstacles no longer seen' });
const DARK_WALK = { below: DARK_BELOW, pace: p(0.5, '1', ASSUMPTION, { range: [0.3, 0.7], confidence: 'low', note: 'off the ways at night without a light: feeling the ground' }), lit: p(0.85, '1', ASSUMPTION, { range: [0.7, 0.95], confidence: 'low', note: 'with a headlamp or a torch' }) };
const DARK_DRIVE = { below: DARK_BELOW, pace: p(0.7, '1', ASSUMPTION, { range: [0.5, 0.9], confidence: 'low', note: 'off the ways by its headlights' }) };

export const vehicleProfiles = {
  // a person walking with a load (decision 0025): the only way along a footpath
  foot: {
    wading: p(0.5, 'm', ASSUMPTION, { range: [0.25, 0.75], confidence: 'low', note: 'knee-deep: one wades through carrying' }),
    ground: { width: p(0.6, 'm', ASSUMPTION, { range: [0.54, 0.66], confidence: 'medium', note: 'its width among trees' }), maxGrade: p(1.0, '1', ASSUMPTION, { range: [0.7, 1.3], confidence: 'low', note: 'the steepest it climbs off the ways' }), good: share(1), reduced: share(0.85), none: share(0.65), woods: share(0.7, 'among trees') }, // (a person: between the trees, on any slope at Tobler’s pace; mud slows)
    walks: true,
    label: 'On foot, carrying',
    loadedSpeed: WALK_LOADED,
    maxSpeed: p(5, 'km/h', TOBLER, { range: [4, 6], confidence: 'medium' }),
    offroadSpeed: p(3.5, 'km/h', TOBLER, { range: [2.5, 4.5], confidence: 'low', note: 'across fields and rough ground' }),
    dark: DARK_WALK,
    offroadReach: p(2000, 'm', ASSUMPTION, { range: [500, 5000], confidence: 'low', note: 'across meadows and fallow land, as far as one walks to a way (the right to walk on open land, § 23 NWaldLG; growing crops are kept off)' }),
    surfaceSpeed: { asphalt: kmh(5, TOBLER), gravel: kmh(5, TOBLER), earth: kmh(4.5, TOBLER), path: kmh(4.5, TOBLER, [3.5, 5]), external: kmh(5, TOBLER) },
    axleLoadsLoaded: series([], 't', ASSUMPTION, { note: 'no wear on a road worth counting', confidence: 'high' }),
    axleLoadsEmpty: series([], 't', ASSUMPTION, { confidence: 'high' }),
    payload: p(0.025, 't', ASSUMPTION, { confidence: 'medium', note: 'what one person carries in one go (the handling data: 25 kg)' }),
    roadLegal: true,
  },
  // a bicycle (camp L4): ridden on roads and tracks, pushed along a footpath and across the fields (as one walks)
  bicycle: {
    wading: p(0.5, 'm', ASSUMPTION, { range: [0.25, 0.75], confidence: 'low', note: 'off the ways it is pushed, and carried across a creek by its rider as they wade: knee-deep (ridden through, to the hubs, some 0.2 m)' }),
    ground: { width: p(0.7, 'm', ASSUMPTION, { range: [0.63, 0.77], confidence: 'medium', note: 'its width among trees' }), maxGrade: p(0.5, '1', ASSUMPTION, { range: [0.35, 0.65], confidence: 'low', note: 'the steepest it climbs off the ways' }), good: share(0.9), reduced: share(0.7), none: share(0.5), woods: share(0.5, 'among trees') }, // (pushed off the ways, as one walks)
    walks: true,
    label: 'Bicycle (ridden, with panniers)',
    maxSpeed: kmh(25, ASSUMPTION, [18, 30]),
    offroadSpeed: p(4, 'km/h', TOBLER, { range: [3, 5], confidence: 'low', note: 'pushed across rough ground' }),
    dark: DARK_WALK,
    offroadReach: p(1000, 'm', ASSUMPTION, { range: [300, 3000], confidence: 'low', note: 'pushed across a field to a way' }),
    surfaceSpeed: { asphalt: kmh(15, ASSUMPTION, [12, 20]), gravel: kmh(12, ASSUMPTION, [9, 16]), earth: kmh(8, ASSUMPTION, [5, 12]), path: kmh(9, ASSUMPTION, [5, 12]), external: kmh(15, ASSUMPTION, [12, 20]) },
    axleLoadsLoaded: series([], 't', ASSUMPTION, { note: 'no wear on a road worth counting', confidence: 'high' }),
    axleLoadsEmpty: series([], 't', ASSUMPTION, { confidence: 'high' }),
    payload: p(0.025, 't', ASSUMPTION, { range: [0.015, 0.04], confidence: 'medium', note: 'a rear rack and panniers: racks are rated about 25 kg' }),
    roadLegal: true,
    // the rider lifts the panniers off
    unloading: { kind: 'hand', fixed: p(30, 's', ASSUMPTION, { confidence: 'low' }), perTonne: p(2400, 's/t', ASSUMPTION, { range: [1200, 3600], confidence: 'low', note: 'about 25 kg a minute' }) },
  },
  // a cargo bike: the same ways, slower, a box that takes a week's shopping or a crate of water
  cargoBike: {
    wading: p(0.2, 'm', ASSUMPTION, { range: [0.1, 0.3], confidence: 'low', note: 'to the hubs' }),
    ground: { width: p(0.9, 'm', ASSUMPTION, { range: [0.81, 0.99], confidence: 'medium', note: 'its width among trees' }), maxGrade: p(0.3, '1', ASSUMPTION, { range: [0.21, 0.39], confidence: 'low', note: 'the steepest it climbs off the ways' }), good: share(0.8), reduced: share(0.5), none: share(0.3), woods: share(0.4, 'among trees') }, // (a heavy bike pushed off the ways)
    walks: true,
    label: 'Cargo bike (box, ridden)',
    maxSpeed: kmh(20, ASSUMPTION, [15, 25]),
    offroadSpeed: p(3, 'km/h', ASSUMPTION, { range: [2, 4], confidence: 'low', note: 'pushed across rough ground, heavy' }),
    dark: DARK_WALK,
    surfaceSpeed: { asphalt: kmh(12, ASSUMPTION, [9, 16]), gravel: kmh(9, ASSUMPTION, [7, 13]), earth: kmh(6, ASSUMPTION, [4, 9]), path: kmh(6, ASSUMPTION, [4, 9]), external: kmh(12, ASSUMPTION, [9, 16]) },
    axleLoadsLoaded: series([], 't', ASSUMPTION, { note: 'no wear on a road worth counting', confidence: 'high' }),
    axleLoadsEmpty: series([], 't', ASSUMPTION, { confidence: 'high' }),
    payload: p(0.1, 't', ASSUMPTION, { range: [0.06, 0.15], confidence: 'low', note: 'box cargo bikes take some 80–150 kg of load besides the rider' }),
    roadLegal: true,
    unloading: { kind: 'hand', fixed: p(60, 's', ASSUMPTION, { confidence: 'low' }), perTonne: p(2400, 's/t', ASSUMPTION, { range: [1200, 3600], confidence: 'low', note: 'about 25 kg a minute' }) },
  },
  car: {
    wading: p(0.3, 'm', ASSUMPTION, { range: [0.15, 0.45], confidence: 'low', note: 'the door sills; makers give 0.2–0.5 m' }),
    ground: { width: p(1.9, 'm', ASSUMPTION, { range: [1.71, 2.09], confidence: 'medium', note: 'its width among trees' }), maxGrade: p(0.25, '1', ASSUMPTION, { range: [0.17, 0.33], confidence: 'low', note: 'the steepest it climbs off the ways' }), slope: slope(0.6), good: share(0.6), reduced: share(0.4), none: share(0.2), woods: share(0.3, 'a car creeps among trees where the gaps let it, on forest floor (estimate)') }, // (a car across dry grass slowly; softened ground it slips on; it sinks in a soaked field)
    label: 'Car (Pkw, 1.5 t)',
    maxSpeed: kmh(100),
    offroadSpeed: kmh(15),
    dark: DARK_DRIVE,
    surfaceSpeed: speeds(kmh(70), kmh(40, GRAVEL_SPEED), kmh(20), kmh(70, ASSUMPTION, [50, 90])),
    axleLoadsLoaded: series([0.8, 0.8], 't', ROADS_DERIVED, { note: '1.6 t loaded; ~16,000 cars ≈ one 10-t axle', confidence: 'medium' }),
    axleLoadsEmpty: series([0.75, 0.75], 't', ROADS_DERIVED, { note: 'research load.esal.car_1_5t: 2 × 0.75 t', confidence: 'high' }),
    payload: p(0.5, 't', ASSUMPTION, { range: [0.4, 0.6], confidence: 'low', note: 'an estate car (Kombi) with its driver: about 450–550 kg' }),
    payloadVolume: p(1.6, 'm3', ASSUMPTION, { range: [1.2, 1.9], confidence: 'low', note: 'the boot with the rear seats folded' }),
    roadLegal: true,
    breakdown: CAR_BREAKDOWN,
    // the driver carries it out of the boot by hand
    unloading: { kind: 'hand', fixed: p(60, 's', ASSUMPTION, { confidence: 'low' }), perTonne: p(2400, 's/t', ASSUMPTION, { range: [1200, 3600], confidence: 'low', note: 'about 25 kg a minute' }) },
  },
  tipper3: {
    wading: p(0.6, 'm', ASSUMPTION, { range: [0.3, 0.9], confidence: 'low', note: 'a construction lorry with high air intakes' }),
    ground: { width: p(2.55, 'm', ASSUMPTION, { range: [2.29, 2.81], confidence: 'medium', note: 'its width among trees' }), maxGrade: p(0.15, '1', ASSUMPTION, { range: [0.1, 0.2], confidence: 'low', note: 'the steepest it climbs off the ways' }), slope: slope(0.6), good: share(0.6), reduced: share(0.3), none: share(0), woods: share(0, 'a road vehicle does not go into a stand of trees (estimate)') }, // (a road lorry (9–10 t axles) on firm dry ground slowly; softened soil only empty-ish and with care; it bogs down on soaked ground)
    label: '3-axle tipper 26 t (6x4 Kipper)',
    maxSpeed: kmh(80, AXLE_LIMITS),
    offroadSpeed: kmh(15, SITE_SPEED, [8, 25]),
    dark: DARK_DRIVE,
    surfaceSpeed: speeds(kmh(50, SPEED_DERIVED, [30, 60]), kmh(30, GRAVEL_SPEED, [25, 50]), kmh(15, SITE_SPEED, [8, 25]), p(50, 'km/h', SPEED_DERIVED, { range: [30, 60], confidence: 'medium' })),
    axleLoadsLoaded: series([8, 9, 9], 't', cite(ROADS_DERIVED, 'load.esal.tipper3axle_26t: assumed 8/9/9 t → ΣÄF ≈ 1.72'), { confidence: 'medium' }),
    axleLoadsEmpty: series([6.5, 2.75, 2.75], 't', ASSUMPTION, { note: 'tare ≈ 12 t (26 t GVW − 14 t payload), engine over the front axle', confidence: 'low' }),
    payload: p(14, 't', cite(NAUMANN, '3-axle payload 12–14 t'), { range: [12, 14], confidence: 'high' }),
    payloadVolume: p(10, 'm3', cite(MARTA, '3-axle billed as 9 m3; heaped body ~10 m3'), { range: [9, 11], confidence: 'medium' }),
    roadLegal: true,
    breakdown: LORRY_BREAKDOWN,
    loadedSpeed: LOADED,
    unloading: TIP,
  },
  tipper4: {
    wading: p(0.6, 'm', ASSUMPTION, { range: [0.3, 0.9], confidence: 'low', note: 'a construction lorry with high air intakes' }),
    ground: { width: p(2.55, 'm', ASSUMPTION, { range: [2.29, 2.81], confidence: 'medium', note: 'its width among trees' }), maxGrade: p(0.15, '1', ASSUMPTION, { range: [0.1, 0.2], confidence: 'low', note: 'the steepest it climbs off the ways' }), slope: slope(0.6), good: share(0.5), reduced: share(0.2), none: share(0), woods: share(0, 'a road vehicle does not go into a stand of trees (estimate)') }, // (a 32 t road lorry (10.5 t axles): firm dry ground slowly, softened hardly, soaked not)
    label: '4-axle tipper 32 t (8x4 Kipper)',
    maxSpeed: kmh(80, AXLE_LIMITS),
    offroadSpeed: kmh(15, SITE_SPEED, [8, 25]),
    dark: DARK_DRIVE,
    surfaceSpeed: speeds(kmh(50, SPEED_DERIVED, [30, 60]), kmh(30, GRAVEL_SPEED, [25, 50]), kmh(15, SITE_SPEED, [8, 25]), p(50, 'km/h', SPEED_DERIVED, { range: [30, 60], confidence: 'medium' })),
    axleLoadsLoaded: series([5, 6, 10.5, 10.5], 't', RLW, { note: 'RLW reference truck 32 t → ΣÄF = 0.5⁴ + 0.6⁴ + 2 × 1.05⁴ = 2.62', confidence: 'high' }),
    axleLoadsEmpty: series([4.5, 4.5, 2.5, 2.5], 't', ASSUMPTION, { note: 'tare ≈ 14 t, twin steer axles carry the engine', confidence: 'low' }),
    payload: p(18, 't', cite(AXLE_LIMITS, '32 t GVW − ~14 t tare; Naumann bills 15–17 t'), { range: [15, 18], confidence: 'medium' }),
    payloadVolume: p(13, 'm3', cite(MARTA, '4-axle billed as 15 m3; typical body 12–14 m3'), { range: [12, 15], confidence: 'medium' }),
    roadLegal: true,
    breakdown: LORRY_BREAKDOWN,
    loadedSpeed: LOADED,
    unloading: TIP,
  },
  lowLoader: {
    wading: p(0.4, 'm', ASSUMPTION, { range: [0.2, 0.6], confidence: 'low', note: 'a low deck' }),
    ground: { width: p(2.55, 'm', ASSUMPTION, { range: [2.29, 2.81], confidence: 'medium', note: 'its width among trees' }), maxGrade: p(0.08, '1', ASSUMPTION, { range: [0.06, 0.1], confidence: 'low', note: 'the steepest it climbs off the ways' }), slope: slope(0.6), good: share(0.4), reduced: share(0), none: share(0), woods: share(0, 'a road vehicle does not go into a stand of trees (estimate)') }, // (a semi-low-loader keeps to firm surfaces: a low deck grounds, its axles sink)
    label: 'Low-loader (tractor + 3-axle semi-low-loader)',
    maxSpeed: kmh(80, AXLE_LIMITS),
    offroadSpeed: kmh(10),
    dark: DARK_DRIVE,
    surfaceSpeed: speeds(kmh(40), kmh(25, GRAVEL_SPEED), kmh(10), p(45, 'km/h', SPEED_DERIVED, { range: [30, 60], confidence: 'low', note: 'heavy transport, slower than tippers' })),
    axleLoadsLoaded: series([7, 11.5, 7.5, 7.5, 7.5], 't', AXLE_LIMITS, { note: '≈ 41 t carrying a 22 t excavator; 11.5 t driven axle limit (permit transport above 40 t)', confidence: 'low' }),
    axleLoadsEmpty: series([6.5, 5.5, 2.5, 2.5, 2.5], 't', ASSUMPTION, { note: 'tare ≈ 19.5 t', confidence: 'low' }),
    payload: p(25, 't', cite(WKO_ARGE, '5-axle ≤ 23 t, 6-axle ≤ 29 t, 6–7-axle ≤ 35 t payload'), { range: [23, 35], confidence: 'medium' }),
    roadLegal: true,
    breakdown: LORRY_BREAKDOWN,
    // the machine is driven off the ramp and unchained
    unloading: { kind: 'driveOff', fixed: p(1800, 's', ASSUMPTION, { range: [900, 3600], confidence: 'low', note: 'half of the hour of loading and unloading a haulier bills' }) },
  },
  flatbed: {
    wading: p(0.5, 'm', ASSUMPTION, { range: [0.25, 0.75], confidence: 'low', note: 'a lorry' }),
    ground: { width: p(2.55, 'm', ASSUMPTION, { range: [2.29, 2.81], confidence: 'medium', note: 'its width among trees' }), maxGrade: p(0.15, '1', ASSUMPTION, { range: [0.1, 0.2], confidence: 'low', note: 'the steepest it climbs off the ways' }), slope: slope(0.6), good: share(0.5), reduced: share(0.2), none: share(0), woods: share(0, 'a road vehicle does not go into a stand of trees (estimate)') }, // (a road lorry with a crane)
    label: 'Flatbed lorry with loader crane (3-axle, 26 t)',
    maxSpeed: kmh(80, AXLE_LIMITS),
    offroadSpeed: kmh(15, SITE_SPEED, [8, 25]),
    dark: DARK_DRIVE,
    surfaceSpeed: speeds(kmh(50, SPEED_DERIVED, [30, 60]), kmh(30, GRAVEL_SPEED, [25, 50]), kmh(15, SITE_SPEED, [8, 25]), p(50, 'km/h', SPEED_DERIVED, { range: [30, 60], confidence: 'medium' })),
    axleLoadsLoaded: series([8, 9, 9], 't', ROADS_DERIVED, { note: 'same axle split as the 3-axle tipper', confidence: 'low' }),
    axleLoadsEmpty: series([7, 3.5, 3.5], 't', ASSUMPTION, { note: 'tare ≈ 14 t incl. loader crane', confidence: 'low' }),
    payload: p(12, 't', ASSUMPTION, { range: [10, 14], confidence: 'low' }),
    roadLegal: true,
    breakdown: LORRY_BREAKDOWN,
    // its own loader crane: outriggers out, then lift by lift (a pallet of about a tonne)
    unloading: { kind: 'crane', fixed: p(600, 's', ASSUMPTION, { range: [300, 900], confidence: 'low', note: 'setting up the outriggers' }), perTonne: p(180, 's/t', ASSUMPTION, { range: [120, 300], confidence: 'low', note: 'a lift of about a tonne in 2–5 minutes' }) },
  },
  crawler: {
    wading: p(1.0, 'm', ASSUMPTION, { range: [0.5, 1.5], confidence: 'low', note: 'tracked plant: about the track height' }),
    ground: { width: p(3.0, 'm', ASSUMPTION, { range: [2.7, 3.3], confidence: 'medium', note: 'its width among trees' }), maxGrade: p(0.5, '1', ASSUMPTION, { range: [0.35, 0.65], confidence: 'low', note: 'the steepest it climbs off the ways' }), slope: slope(0.6), good: share(1), reduced: share(0.85), none: share(0.6), woods: share(0.5, 'tracked plant crawls among trees, pushing through undergrowth (estimate)') }, // (tracked plant (some 50 kPa on its tracks) goes over soft ground, slower)
    label: 'Tracked machine (own tracks)',
    maxSpeed: kmh(3.5, cite(CAT_PHB, 'Cat 320 travel 5.6 km/h max; effective site travel ~3.5 km/h'), [2, 5.6]),
    offroadSpeed: kmh(3.5, CAT_PHB, [2, 5.6]),
    dark: DARK_DRIVE,
    surfaceSpeed: speeds(kmh(3.5), kmh(3.5), kmh(3.5), kmh(3.5)),
    axleLoadsLoaded: series([], 't', ASSUMPTION, { note: 'tracks spread the load (≈ 0.5 bar): no equivalent axle passes; surface scuffing is not modelled', confidence: 'low' }),
    axleLoadsEmpty: series([], 't', ASSUMPTION, { confidence: 'low' }),
    roadLegal: false,
  },
  wheeledPlant: {
    wading: p(0.7, 'm', ASSUMPTION, { range: [0.35, 1.05], confidence: 'low', note: 'large wheels' }),
    ground: { width: p(2.6, 'm', ASSUMPTION, { range: [2.34, 2.86], confidence: 'medium', note: 'its width among trees' }), maxGrade: p(0.35, '1', ASSUMPTION, { range: [0.24, 0.45], confidence: 'low', note: 'the steepest it climbs off the ways' }), slope: slope(0.6), good: share(1), reduced: share(0.7), none: share(0.4), woods: share(0.3, 'wheeled plant among trees, slowly (estimate)') }, // (wheeled plant (a loader, a grader) on big tyres: softened ground slows it, soaked ground nearly stops it)
    label: 'Wheeled plant (grader, wheel loader, wheeled excavator)',
    maxSpeed: kmh(25, cite(PERMITS, 'registered wheeled plant may self-drive; datasheets 34–46.6 km/h, typically plated 20/25 km/h'), [20, 40]),
    offroadSpeed: kmh(10, ASSUMPTION, [5, 15]),
    dark: DARK_DRIVE,
    surfaceSpeed: speeds(kmh(25, PERMITS, [20, 40]), kmh(20), kmh(12), kmh(25, PERMITS, [20, 40])),
    axleLoadsLoaded: series([8, 10], 't', ASSUMPTION, { note: 'wheel loader 18 t (Cat 950 GC 18.8 t), rear-heavy', confidence: 'low' }),
    axleLoadsEmpty: series([8, 10], 't', ASSUMPTION, { note: 'machines carry no payload on the road', confidence: 'low' }),
    roadLegal: true,
  },
  roller: {
    wading: p(0.5, 'm', ASSUMPTION, { range: [0.25, 0.75], confidence: 'low', note: 'a drum roller' }),
    ground: { width: p(2.3, 'm', ASSUMPTION, { range: [2.07, 2.53], confidence: 'medium', note: 'its width among trees' }), maxGrade: p(0.25, '1', ASSUMPTION, { range: [0.17, 0.33], confidence: 'low', note: 'the steepest it climbs off the ways' }), slope: slope(0.6), good: share(1), reduced: share(0.6), none: share(0.3), woods: share(0, 'a road vehicle does not go into a stand of trees (estimate)') }, // (a drum roller: it digs in on soaked ground)
    label: 'Roller (single drum / tandem)',
    maxSpeed: kmh(10, HAMM, [8, 12]),
    offroadSpeed: kmh(6, ASSUMPTION, [4, 10]),
    dark: DARK_DRIVE,
    surfaceSpeed: speeds(kmh(10), kmh(10), kmh(6), kmh(10)),
    axleLoadsLoaded: series([6.4, 6.5], 't', ASSUMPTION, { note: '12.9 t single-drum roller: drum ≈ tyre axle', confidence: 'low' }),
    axleLoadsEmpty: series([6.4, 6.5], 't', ASSUMPTION, { confidence: 'low' }),
    roadLegal: false,
  },
  paver: {
    wading: p(0.3, 'm', ASSUMPTION, { range: [0.15, 0.45], confidence: 'low', note: 'its screed and hopper low' }),
    ground: { width: p(2.6, 'm', ASSUMPTION, { range: [2.34, 2.86], confidence: 'medium', note: 'its width among trees' }), maxGrade: p(0.15, '1', ASSUMPTION, { range: [0.1, 0.2], confidence: 'low', note: 'the steepest it climbs off the ways' }), slope: slope(0.6), good: share(1), reduced: share(0.6), none: share(0.3), woods: share(0, 'a road vehicle does not go into a stand of trees (estimate)') }, // (a tracked paver)
    label: 'Tracked asphalt paver',
    maxSpeed: kmh(4, cite(ASSUMPTION, 'tracked paver travel ≈ 4–4.5 km/h (research table lists 20 km/h, which fits wheeled pavers only)'), [3, 4.5]),
    offroadSpeed: kmh(3, ASSUMPTION, [2, 4]),
    dark: DARK_DRIVE,
    surfaceSpeed: speeds(kmh(4), kmh(4), kmh(3), kmh(4)),
    axleLoadsLoaded: series([], 't', ASSUMPTION, { note: 'tracked: no equivalent axle passes', confidence: 'low' }),
    axleLoadsEmpty: series([], 't', ASSUMPTION, { confidence: 'low' }),
    roadLegal: false,
  },
  tanker: {
    wading: p(0.5, 'm', ASSUMPTION, { range: [0.25, 0.75], confidence: 'low', note: 'a lorry' }),
    ground: { width: p(2.55, 'm', ASSUMPTION, { range: [2.29, 2.81], confidence: 'medium', note: 'its width among trees' }), maxGrade: p(0.12, '1', ASSUMPTION, { range: [0.08, 0.16], confidence: 'low', note: 'the steepest it climbs off the ways' }), slope: slope(0.6), good: share(0.5), reduced: share(0.2), none: share(0), woods: share(0, 'a road vehicle does not go into a stand of trees (estimate)') }, // (a road tanker)
    label: 'Fuel tanker (3-axle, 26 t)',
    maxSpeed: kmh(80, AXLE_LIMITS),
    offroadSpeed: kmh(15, SITE_SPEED, [8, 25]),
    dark: DARK_DRIVE,
    surfaceSpeed: speeds(kmh(50, SPEED_DERIVED, [30, 60]), kmh(30, GRAVEL_SPEED, [25, 50]), kmh(15, SITE_SPEED, [8, 25]), p(55, 'km/h', SPEED_DERIVED, { range: [40, 65], confidence: 'medium' })),
    axleLoadsLoaded: series([8, 9, 9], 't', ROADS_DERIVED, {
      note: 'same axle split as the 3-axle tipper',
      confidence: 'low',
    }),
    axleLoadsEmpty: series([6, 2.5, 2.5], 't', ASSUMPTION, {
      confidence: 'low',
    }),
    payload: p(15, 't', ASSUMPTION, {
      range: [13, 16],
      note: '≈ 18,000 l diesel',
      confidence: 'low',
    }),
    roadLegal: true,
    breakdown: LORRY_BREAKDOWN,
    // its own pump: hose, earthing and meter, then about 400 l a minute
    unloading: { kind: 'pump', fixed: p(600, 's', ASSUMPTION, { range: [300, 900], confidence: 'low' }), perTonne: p(150, 's/t', ASSUMPTION, { range: [100, 250], confidence: 'low', note: 'a tonne of diesel is about 1,190 l' }) },
  },
  mixer: {
    wading: p(0.6, 'm', ASSUMPTION, { range: [0.3, 0.9], confidence: 'low', note: 'a construction lorry' }),
    ground: { width: p(2.55, 'm', ASSUMPTION, { range: [2.29, 2.81], confidence: 'medium', note: 'its width among trees' }), maxGrade: p(0.12, '1', ASSUMPTION, { range: [0.08, 0.16], confidence: 'low', note: 'the steepest it climbs off the ways' }), slope: slope(0.6), good: share(0.5), reduced: share(0.1), none: share(0), woods: share(0, 'a road vehicle does not go into a stand of trees (estimate)') }, // (a truck mixer (some 32 t, a high centre of mass): firm ground only)
    label: 'Truck mixer 9 m3 (4-axle, 32 t)',
    maxSpeed: kmh(80, AXLE_LIMITS),
    offroadSpeed: kmh(12, SITE_SPEED, [8, 20]),
    dark: DARK_DRIVE,
    surfaceSpeed: speeds(kmh(50, SPEED_DERIVED, [30, 60]), kmh(30, GRAVEL_SPEED, [25, 50]), kmh(12, SITE_SPEED, [8, 20]), p(50, 'km/h', SPEED_DERIVED, { range: [30, 60], confidence: 'medium' })),
    axleLoadsLoaded: series([7.5, 7.5, 8.5, 8.5], 't', ASSUMPTION, {
      note: '32 t GVW, drum load forward-biased',
      confidence: 'low',
    }),
    axleLoadsEmpty: series([5, 5, 2.5, 2.5], 't', ASSUMPTION, {
      confidence: 'low',
    }),
    payload: p(18, 't', ASSUMPTION, {
      range: [16, 21],
      note: '≈ 7.5–8 m3 fresh concrete under the 32 t limit',
      confidence: 'medium',
    }),
    roadLegal: true,
    breakdown: LORRY_BREAKDOWN,
    // the drum discharges down its chute: positioning, then about a cubic metre a minute
    unloading: { kind: 'discharge', fixed: p(300, 's', ASSUMPTION, { range: [180, 600], confidence: 'low' }), perTonne: p(25, 's/t', ASSUMPTION, { range: [15, 50], confidence: 'low', note: 'about 1 m3 (2.4 t) a minute' }) },
  },
  van: {
    wading: p(0.3, 'm', ASSUMPTION, { range: [0.15, 0.45], confidence: 'low', note: 'a van; makers give 0.2–0.5 m' }),
    ground: { width: p(2.1, 'm', ASSUMPTION, { range: [1.89, 2.31], confidence: 'medium', note: 'its width among trees' }), maxGrade: p(0.2, '1', ASSUMPTION, { range: [0.14, 0.26], confidence: 'low', note: 'the steepest it climbs off the ways' }), slope: slope(0.6), good: share(0.6), reduced: share(0.35), none: share(0.15), woods: share(0.2, 'a van creeps among trees where the gaps let it (estimate)') }, // (a van across dry grass slowly; it slips on softened ground and sinks in a soaked one)
    label: 'Crew / survey van (3.5 t)',
    maxSpeed: kmh(100),
    offroadSpeed: kmh(15),
    dark: DARK_DRIVE,
    surfaceSpeed: speeds(kmh(60), kmh(40, GRAVEL_SPEED), kmh(20), kmh(65, ASSUMPTION, [50, 80])),
    axleLoadsLoaded: series([1.6, 1.9], 't', ASSUMPTION, { confidence: 'low' }),
    axleLoadsEmpty: series([1.3, 1.2], 't', ASSUMPTION, { confidence: 'low' }),
    payload: p(1.0, 't', ASSUMPTION, { range: [0.8, 1.4], confidence: 'low' }),
    roadLegal: true,
    breakdown: CAR_BREAKDOWN,
    // the driver carries it out by hand, to the kerb or the edge of the ground
    unloading: { kind: 'hand', fixed: p(120, 's', ASSUMPTION, { confidence: 'low' }), perTonne: p(2400, 's/t', ASSUMPTION, { range: [1200, 3600], confidence: 'low', note: 'about 25 kg a minute' }) },
  },
};

export const networkSettings = {
  referenceAxleLoad: p(10, 't', FOURTH_POWER, { confidence: 'high', note: 'German standard axle (RStO / RLW)' }),
  loadEquivalenceExponent: p(4, '1', FOURTH_POWER, { confidence: 'high', note: 'AASHO fourth-power law' }),
  recovery: {
    towed: p(3, 'h', ASSUMPTION, { range: [1, 6], confidence: 'low', note: 'a breakdown service there and the tow on' }),
    refuel: p(0.5, 'h', ASSUMPTION, { range: [0.25, 1.5], confidence: 'low', note: 'to the next station and back with a can, or a tow to it' }),
  },
  atPlace: p(30, 'm', ASSUMPTION, { range: [5, 50], confidence: 'low', note: 'a few steps: where a leg starts and a unit stands are one place within this' }),
  snapDistance: p(6, 'm', ASSUMPTION, { range: [2, 10], note: 'UI/editing tolerance (≈ 1.5 grid cells)' }),
  // a German timetable has its departures Monday to Friday, on Saturdays, and on Sundays and public holidays
  // (Sonn- und Feiertagsfahrplan): a public holiday runs as a Sunday
  timetableDays: { week: ['weekday', 'weekday', 'weekday', 'weekday', 'weekday', 'saturday', 'sunday'], holiday: 'sunday' },
};

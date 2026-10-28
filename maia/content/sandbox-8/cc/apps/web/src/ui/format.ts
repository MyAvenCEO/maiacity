/**
 * Number, unit and date formatting. One place so every panel speaks the same units.
 *
 * Style: SI-like grouping with a thin space (12 345.6), decimal point, unit after a
 * no-break space. Dates come from the simulation calendar, written as the world's locale writes them (de-DE: "Mo 01.03.2027 07:00").
 */
import { Calendar, DAY, HOUR, type Locale } from '../../../../packages/kernel/src/index.ts';

const NB = ' ';
const THIN = ' ';

let calendar: Calendar | null = null;

/** Set the calendar from the world's first day and its locale. */
export function setCalendar(epochDay: number, locale: Locale): void {
  calendar = new Calendar(epochDay, locale);
}

export function cal(): Calendar | null {
  return calendar;
}

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
}

/** Plain number with fixed decimals and thin-space grouping. */
export function num(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  const neg = v < 0 || Object.is(v, -0);
  const s = Math.abs(v).toFixed(digits);
  const [i, d] = s.split('.');
  const out = group(i!) + (d ? `.${d}` : '');
  return neg && Number(s) !== 0 ? `−${out}` : out;
}

/** Number with "smart" precision: ~3 significant digits, grouping for big values. */
export function smart(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 100) return num(v, 0);
  if (a >= 10) return num(v, 1);
  if (a >= 1) return num(v, 2);
  if (a >= 0.01) return num(v, 3);
  return v.toExponential(2);
}

const UNIT_LABELS: Record<string, string> = {
  EUR: '€',
  'EUR/h': '€/h',
  'EUR/d': '€/d',
  'EUR/t': '€/t',
  'EUR/m3': '€/m³',
  'EUR/m2': '€/m²',
  'EUR/m': '€/m',
  'EUR/l': '€/l',
  'EUR/mo': '€/month',
  m3: 'm³',
  m2: 'm²',
  'm3/h': 'm³/h',
  'm2/h': 'm²/h',
  't/m3': 't/m³',
  'm/h': 'm/h',
  'l/h': 'l/h',
  '1': '',
  '': '',
  'degC': '°C',
  pcs: 'pcs',
  tree: 'trees',
};

export function unitLabel(u: string | undefined): string {
  if (!u) return '';
  return UNIT_LABELS[u] ?? u.replace(/m3/g, 'm³').replace(/m2/g, 'm²').replace(/EUR/g, '€');
}

/** Value with unit, smart precision. */
export function qty(v: number | null | undefined, unit?: string, digits?: number): string {
  const u = unitLabel(unit);
  const n = digits === undefined ? smart(v) : num(v, digits);
  return u ? `${n}${NB}${u}` : n;
}

export const eur = (v: number | null | undefined, digits = 0) => `${num(v, digits)}${NB}€`;
/** compact euros for tables/badges: 48.2 k€, 1.25 M€ */
export function eurK(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  const a = Math.abs(v);
  if (a >= 1e6) return `${num(v / 1e6, 2)}${NB}M€`;
  if (a >= 1e4) return `${num(v / 1e3, 1)}${NB}k€`;
  return eur(v);
}
export const tonnes = (v: number | null | undefined, d = v !== null && v !== undefined && Math.abs(v) < 10 ? 1 : 0) => `${num(v, d)}${NB}t`;
export const m3 = (v: number | null | undefined, d = 0) => `${num(v, d)}${NB}m³`;
export const m2 = (v: number | null | undefined, d = 0) => `${num(v, d)}${NB}m²`;
export const metres = (v: number | null | undefined, d = 0) => `${num(v, d)}${NB}m`;
export function length(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–';
  return Math.abs(v) >= 1000 ? `${num(v / 1000, 2)}${NB}km` : metres(v, 0);
}
export const hours = (v: number | null | undefined, d = 1) => `${num(v, d)}${NB}h`;
export const days = (v: number | null | undefined, d = 1) => `${num(v, d)}${NB}d`;
export const celsius = (v: number | null | undefined) => `${num(v, 1)}${NB}°C`;
export const mmh = (v: number | null | undefined) => `${num(v, 1)}${NB}mm/h`;
export const ms = (v: number | null | undefined) => `${num(v, 1)}${NB}m/s`;
export const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined ? '–' : `${num(v * 100, d)}${NB}%`);
/** percent value already in % (e.g. grade 4.5 → "4.5 %") */
export const pctv = (v: number | null | undefined, d = 1) => `${num(v, d)}${NB}%`;

/** Road chainage: 1234.5 → "1+234" */
export function chainage(s: number): string {
  const km = Math.floor(s / 1000);
  const m = Math.round(s - km * 1000);
  return `${km}+${String(m).padStart(3, '0')}`;
}

// ------------------------------------------------------------------ dates

/** "Mo 01.03.2027 07:00" */
export function dateTime(t: number | null | undefined): string {
  if (t === null || t === undefined || !Number.isFinite(t)) return '–';
  return calendar ? calendar.format(t) : `t+${(t / HOUR).toFixed(1)} h`;
}

/** "01.03.2027" */
export function date(t: number | null | undefined): string {
  if (t === null || t === undefined || !Number.isFinite(t)) return '–';
  return calendar ? calendar.format(t, 'date') : `day ${Math.floor(t / DAY)}`;
}

/** "01.03." */
export function dateShort(t: number): string {
  if (!calendar || !Number.isFinite(t)) return '–';
  const c = calendar.at(t);
  return `${String(c.day).padStart(2, '0')}.${String(c.month).padStart(2, '0')}.`;
}

/** "07:00" */
export function clock(t: number): string {
  return calendar ? calendar.format(t, 'time') : '';
}

export const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const WEEKDAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export function weekday(t: number): string {
  return calendar ? WEEKDAYS_LONG[calendar.at(t).weekday]! : '';
}

/** "2027-03" → "Mär 2027" */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

/** Relative duration in sim seconds → "3.5 h", "2.1 d", "45 min". */
export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '–';
  const s = Math.max(0, seconds);
  if (s < HOUR) return `${Math.round(s / 60)}${NB}min`;
  if (s < 2 * DAY) return `${num(s / HOUR, 1)}${NB}h`;
  return `${num(s / DAY, 1)}${NB}d`;
}

/** "in 3.5 h" / "3.5 h ago" relative to now */
export function relative(t: number | null | undefined, now: number): string {
  if (t === null || t === undefined || !Number.isFinite(t)) return '–';
  return t >= now ? `in ${duration(t - now)}` : `${duration(now - t)} ago`;
}

export function titleCase(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

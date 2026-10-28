/**
 * Public holidays (region data): a region lists them as fixed dates and as days counted from Easter Sunday,
 * and says what they are: days of rest (businesses do not work) or not, paid as a working day or not. The
 * date of Easter is the Gregorian computus, calendar arithmetic and no region's law.
 */
import type { ReadCtx } from '../../kernel/src/index.ts';

export interface Holidays {
  rule: string;
  /** days of rest: businesses do not work, shops are shut, nothing is loaded */
  rest: boolean;
  /** paid by employers as a working day */
  paid: boolean;
  fixed: { month: number; day: number; label: string }[];
  /** days after Easter Sunday (negative: before) */
  easter: { offset: number; label: string }[];
}

/** Easter Sunday of a year (Gregorian: the anonymous algorithm, Meeus/Jones/Butcher): month 1..12, day */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** the days of the year from 1 January (0-based) of a date, by the proleptic Gregorian calendar */
const dayOfYear = (year: number, month: number, day: number): number => (Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86_400_000;

/** the public holiday kept as a day of rest a day is, if it is one (a holiday that is no day of rest is a working day) */
export function holidayOn(read: ReadCtx, t: number, holidays: Holidays | undefined): string | undefined {
  if (!holidays?.rest) return undefined;
  const { year, month, day } = read.calendar.at(t);
  const fixed = holidays.fixed.find((h) => h.month === month && h.day === day);
  if (fixed) return fixed.label;
  const e = easterSunday(year);
  const offset = dayOfYear(year, month, day) - dayOfYear(year, e.month, e.day);
  return holidays.easter.find((h) => h.offset === offset)?.label;
}

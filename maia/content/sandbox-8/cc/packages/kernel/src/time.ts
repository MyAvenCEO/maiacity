/**
 * Simulation time: integer-friendly seconds since the scenario epoch (a calendar date
 * at 00:00 local standard time, no DST). Calendar maths is pure arithmetic — the sim
 * never touches the host clock.
 */
export type SimTime = number;

export const SECOND = 1;
export const MINUTE = 60;
export const HOUR = 3600;
export const DAY = 86_400;
export const WEEK = 7 * DAY;

export interface CalendarDate {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
}

/** Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm). */
export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor((yy >= 0 ? yy : yy - 399) / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

export function civilFromDays(z0: number): CalendarDate {
  const z = z0 + 719_468;
  const era = Math.floor((z >= 0 ? z : z - 146_096) / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { year: m <= 2 ? y + 1 : y, month: m, day: d };
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export interface CalendarInstant extends CalendarDate {
  hour: number;
  minute: number;
  second: number;
  /** 0 = Monday … 6 = Sunday (ISO). */
  weekday: number;
  /** 1-based day of year. */
  dayOfYear: number;
  /** Fractional hour of day 0..24. */
  hourOfDay: number;
  /** Days since 1970-01-01. */
  epochDay: number;
}

/**
 * How dates are written for whoever reads (design/modular-split.md §5.3, locale): the reader's, not the place's. The
 * world definition names it and a locale pack (`@cc/locales`) holds it; the kernel knows none but the neutral one.
 */
export interface Locale {
  /** the weekdays as written before a date, Monday first (ISO); none: a date is written without its weekday */
  weekdays: string[];
  /** a date: `{yyyy}` the year, `{mm}` and `{dd}` the month and the day in two digits */
  date: string;
}

/** no language and no place: an ISO 8601 date without a weekday (a world or a test that names no locale) */
export const NEUTRAL_LOCALE: Locale = { weekdays: [], date: '{yyyy}-{mm}-{dd}' };

/** what of a time `format` writes: all of it, the day (its weekday and date), the date, or the time of day */
export type CalendarPart = 'instant' | 'day' | 'date' | 'time';

export class Calendar {
  constructor(public readonly epochDay: number, public readonly locale: Locale = NEUTRAL_LOCALE) {}

  static fromDate(date: CalendarDate, locale?: Locale): Calendar {
    return new Calendar(daysFromCivil(date.year, date.month, date.day), locale);
  }

  at(t: SimTime): CalendarInstant {
    const dayIndex = Math.floor(t / DAY);
    const secOfDay = t - dayIndex * DAY;
    const epochDay = this.epochDay + dayIndex;
    const date = civilFromDays(epochDay);
    const jan1 = daysFromCivil(date.year, 1, 1);
    const weekday = (((epochDay + 3) % 7) + 7) % 7; // 1970-01-01 was a Thursday (3)
    return {
      ...date,
      hour: Math.floor(secOfDay / HOUR),
      minute: Math.floor((secOfDay % HOUR) / MINUTE),
      second: Math.floor(secOfDay % MINUTE),
      weekday,
      dayOfYear: epochDay - jan1 + 1,
      hourOfDay: secOfDay / HOUR,
      epochDay,
    };
  }

  /** Sim time of 00:00 on the given calendar date. */
  timeOf(date: CalendarDate, hour = 0): SimTime {
    return (daysFromCivil(date.year, date.month, date.day) - this.epochDay) * DAY + hour * HOUR;
  }

  startOfDay(t: SimTime): SimTime {
    return Math.floor(t / DAY) * DAY;
  }

  /** the same day and time of day `k` months later (the last day of a shorter month): a rent period, a loan's instalment, a month of employment */
  addMonths(t: SimTime, k: number): SimTime {
    const c = this.at(t);
    const m0 = c.year * 12 + (c.month - 1) + Math.round(k);
    const year = Math.floor(m0 / 12);
    const month = (m0 % 12) + 1;
    const first = this.timeOf({ year, month, day: 1 });
    const next = this.timeOf({ year: month === 12 ? year + 1 : year, month: month === 12 ? 1 : month + 1, day: 1 });
    return this.timeOf({ year, month, day: Math.min(c.day, Math.round((next - first) / DAY)) }) + (t - this.startOfDay(t));
  }

  /** t as the locale writes it: the weekday, the date and the time of day (hh:mm), or only a part of it */
  format(t: SimTime, part: CalendarPart = 'instant'): string {
    const c = this.at(t);
    const p = (n: number) => String(n).padStart(2, '0');
    const time = `${p(c.hour)}:${p(c.minute)}`;
    if (part === 'time') return time;
    const date = this.locale.date.replace('{yyyy}', String(c.year)).replace('{mm}', p(c.month)).replace('{dd}', p(c.day));
    if (part === 'date') return date;
    const weekday = this.locale.weekdays[c.weekday];
    const day = weekday ? `${weekday} ${date}` : date;
    return part === 'day' ? day : `${day} ${time}`;
  }
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < HOUR) return `${Math.round(s / MINUTE)} min`;
  if (s < 2 * DAY) return `${(s / HOUR).toFixed(1)} h`;
  return `${(s / DAY).toFixed(1)} d`;
}

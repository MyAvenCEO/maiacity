/**
 * @cc/locales: how dates are written for whoever reads (design/modular-split.md §5.3, "Locale is neither"). Language,
 * date and number format belong to the reader, not to the place: neither law nor practice, no area's pack. A world
 * definition names its locale by a BCP 47 tag, and composing the world hands the kernel's calendar the data here.
 * A world or a test that names none is written in the kernel's neutral ISO 8601 (`NEUTRAL_LOCALE`).
 *
 * The writing is the usual short form of each (Unicode CLDR, abbreviated weekdays and the numeric date); the kernel
 * writes the time of day as hh:mm on the 24-hour clock, as both do.
 */
import type { Locale } from '../../kernel/src/index.ts';

/** German (Germany): "Mo 01.03.2027 07:40" */
export const deDE: Locale = { weekdays: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'], date: '{dd}.{mm}.{yyyy}' };

/** English (United Kingdom): "Mon 01/03/2027 07:40" */
export const enGB: Locale = { weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], date: '{dd}/{mm}/{yyyy}' };

/** the locales a world definition can name, by tag */
export const LOCALES: Record<string, Locale> = { 'de-DE': deDE, 'en-GB': enGB };

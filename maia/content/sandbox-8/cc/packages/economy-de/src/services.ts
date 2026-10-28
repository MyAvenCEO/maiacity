/**
 * Services on call (decision 0026 A4, camp C8): a vehicle with its driver, booked for a trip. Prices
 * are estimates to be sourced (no tariff at hand): a van with its driver (Transporter mit Fahrer)
 * is let by the hour with a call-out and a charge per kilometre; a taxi charges a base fare and per
 * kilometre (the municipal tariff), waiting by the hour.
 */
import { ASSUMPTION, p } from './sources.ts';

const est = (v: number, unit: string, range: [number, number], note: string) => p(v, unit, ASSUMPTION, { range, confidence: 'low', note });

export const services = {
  vanWithDriver: {
    label: 'Transporter mit Fahrer (Kurier- und Umzugsdienst Göttingen)',
    vehicleProfile: 'van',
    distance: est(8, 'km', [4, 15], 'a courier and removals firm in Göttingen'),
    callOut: est(4, 'h', [1, 24], 'booked in the morning, there in the afternoon; often the next day'),
    openFrom: p(7, 'h', ASSUMPTION, { confidence: 'low' }),
    openTo: p(19, 'h', ASSUMPTION, { confidence: 'low' }),
    price: {
      fixed: est(25, 'EUR', [0, 60], 'call-out'),
      perHour: est(45, 'EUR/h', [30, 70], 'van with its driver, who helps load (estimate, to be sourced)'),
      perKm: est(0.6, 'EUR/km', [0.3, 1.2], 'estimate, to be sourced'),
    },
  },
  taxi: {
    label: 'Taxi Göttingen',
    vehicleProfile: 'car',
    distance: est(8, 'km', [3, 15], 'a rank in town'),
    callOut: est(0.25, 'h', [0.1, 1], 'a few minutes to a quarter of an hour'),
    openFrom: p(0, 'h', ASSUMPTION, { confidence: 'medium', note: 'day and night' }),
    openTo: p(24, 'h', ASSUMPTION, { confidence: 'medium' }),
    price: {
      fixed: est(4.5, 'EUR', [3.5, 6], 'base fare (municipal tariff; estimate, to be sourced)'),
      perHour: est(0, 'EUR/h', [0, 0], 'driving is charged by the km; waiting by the hour is not reckoned yet'),
      perKm: est(2.3, 'EUR/km', [1.9, 2.8], 'per km (municipal tariff; estimate, to be sourced)'),
    },
  },
};

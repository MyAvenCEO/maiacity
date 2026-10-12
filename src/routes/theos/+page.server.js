// @ts-nocheck — plain JS, kept loose on purpose
// Figure 12's simulation is the one heavy sum on the page (about 0.1 s on a laptop, several times that on a phone).
// The page is prerendered, so it runs once here at build time and the page only gets the finished points.
import { giniSeries } from '$lib/theos/model.js';

export const load = () => ({ gini: giniSeries() });

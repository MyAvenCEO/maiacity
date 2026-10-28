/**
 * Surface and ground physics of the valley for exposure (decision 0014): how much light the ground
 * reflects, how fast heat moves through its loess loam.
 */
import { p } from './sources.ts';

const OKE = { title: 'Oke (1987): Boundary Layer Climates, 2nd ed., Tables 1.1 and 2.1', publisher: 'Routledge', year: 1987 };

export const environmentSettings = {
  albedo: p(0.2, '1', OKE, { range: [0.16, 0.26], confidence: 'medium', note: 'grass and farmland in summer; fresh snow (0.8) not modelled' }),
  soilThermalDiffusivity: p(0.5e-6, 'm2/s', OKE, { range: [0.3e-6, 0.8e-6], confidence: 'medium', note: 'moist silt loam (loess); dry soil ≈ 0.2–0.3·10⁻⁶' }),
  termiteHazard: p(0, '1', { title: 'BAM: subterranean termites in Germany — only an introduced Reticulitermes flavipes population in Hamburg; none established in Lower Saxony', publisher: 'Bundesanstalt für Materialforschung und -prüfung' }, { confidence: 'medium' }),
};

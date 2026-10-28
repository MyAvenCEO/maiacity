// runs in QuickJS: no page, no network, no clock. Hands back the whole data model.
const DOMES = { Small: 12, Medium: 24, Large: 48 };
export function init(d) { return figure(d); }
export function on(event, d) {
  if (event.name === 'people') d.people = Math.max(12, Math.min(1500, Math.round(event.value)));
  if (event.name === 'dome' && DOMES[event.value]) d.dome = event.value;
  return figure(d);
}
function figure(d) {
  const per = DOMES[d.dome];
  const domes = Math.ceil(d.people / per);
  const forest = d.people * 1050 / 10000; // ha of food forest, ~1,050 m² a head
  const water = d.people * 0.15;           // m³ a day
  const fill = Math.round((d.people / (domes * per)) * 100);
  return { ...d, domes, perDome: per, forest: Math.round(forest * 10) / 10, water: Math.round(water * 10) / 10, fill,
    tone: fill > 85 ? 'good' : fill > 60 ? 'warn' : 'bad',
    beds: [{ label: 'Small', value: Math.ceil(d.people / 12) }, { label: 'Medium', value: Math.ceil(d.people / 24) }, { label: 'Large', value: Math.ceil(d.people / 48) }] };
}
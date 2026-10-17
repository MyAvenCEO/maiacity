// HEARTS: what each living aven is given each night, and what each balance loses
export function mint({ aven, valley }) {
  return valley.values.mint;
}

export function decay({ aven, valley }) {
  const perNight = Math.round((valley.values.decay / 100 / 365) * 1e7) / 1e7;
  return aven.hearts * perNight;
}

// Needs and bodies: what each aven eats and drinks a night, and what that does to its two reserves (0-100; it dies
// when either reaches 0)
export function need({ aven, good, valley }) {
  return good === 'water' ? valley.values.needWater : valley.values.needFood;
}

// short: the units of each good it went without tonight; need: what it needed of each
export function body({ aven, short, need, valley }) {
  const v = valley.values;
  // health lost per missing unit, so that with none at all it lives through `days` days and dies the night after
  const hurt = (n, days) => (n ? Math.round((100 / (n * (days + 0.5))) * 1000) / 1000 : 0);
  const foods = ['fruits', 'vegetables', 'legumes', 'chicken'];
  const water = short.water ?? 0;
  const food = foods.reduce((n, g) => n + (short[g] ?? 0), 0);
  const foodNeed = foods.reduce((n, g) => n + need[g], 0);
  const clamp = (x) => Math.min(100, Math.max(0, x));
  return {
    water: clamp(aven.body.water + (water ? -hurt(need.water, v.waterDays) * water : v.mendWater)),
    food: clamp(aven.body.food + (food ? -hurt(foodNeed, v.foodDays) * food : v.mendFood))
  };
}

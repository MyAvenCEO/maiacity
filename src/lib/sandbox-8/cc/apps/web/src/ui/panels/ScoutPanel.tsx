/**
 * Scout: where is a good place — for what? Pick a goal (a preset, or edit your own: how much each
 * criterion matters, its worst and best values, hard limits), see its suitability on the map, and
 * the best places with their reasons. Only what a scout could know is used.
 */
import { useEffect, useState } from 'preact/hooks';
import type { Candidate, Goal, GoalTerm } from '../../../../../packages/siting/src/index.ts';
import { app, overlay, scoutGoal, scoutOpen, scoutPlaces, world } from '../state.ts';
import { Button, Empty, Section } from '../components/common.tsx';
import { num } from '../format.ts';

const copy = (g: Goal): Goal => ({ ...g, id: 'custom', terms: g.terms.map((t) => ({ ...t })) });

function NumIn({ value, onChange, title }: { value: number | undefined; onChange: (v: number | undefined) => void; title: string }) {
  return <input class="inp num w60" value={value ?? ''} title={title} placeholder="–" onChange={(e) => onChange((e.currentTarget as HTMLInputElement).value.trim() === '' ? undefined : Number((e.currentTarget as HTMLInputElement).value))} />;
}

export function ScoutPanel() {
  const w = world.value;
  const [places, setPlacesState] = useState<Candidate[] | null>(null);
  const setPlaces = (p: Candidate[] | null) => {
    setPlacesState(p);
    scoutPlaces.value = p ?? [];
  };
  const [error, setError] = useState<string | null>(null);
  const goals = w?.siting.goals ?? [];
  const criteria = w?.siting.criteria ?? [];
  const goal = scoutGoal.value;
  useEffect(() => {
    if (!goal && goals[0]) scoutGoal.value = copy(goals[0]);
  }, [goals.length]);
  if (!scoutOpen.value || !w) return null;
  const edit = (i: number, patch: Partial<GoalTerm>) => {
    if (!goal) return;
    const terms = goal.terms.map((t, k) => (k === i ? Object.fromEntries(Object.entries({ ...t, ...patch }).filter(([, v]) => v !== undefined)) as GoalTerm : t));
    scoutGoal.value = { ...goal, terms };
    setPlaces(null);
  };
  const find = async () => {
    if (!goal) return;
    setError(null);
    try {
      setPlaces(await app.client.query<Candidate[]>({ kind: 'projection', name: 'siting.candidates', args: { goal, count: 5 } }));
      overlay.value = 'goal:custom';
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const unused = criteria.filter((c) => !goal?.terms.some((t) => t.criterion === c.id));
  return (
    <div class="side glass scout">
      <div class="side-h">
        <div class="side-h-l">
          <div class="side-kind sc">Scout</div>
          <div class="side-title">Where is a good place — for what?</div>
        </div>
        <div class="side-h-r">
          <button class="icon-btn" onClick={() => (scoutOpen.value = false)} title="Close">
            ✕
          </button>
        </div>
      </div>
      <div class="side-b">
        <div class="row">
          <span class="muted small">Start from</span>
          <select
            class="inp"
            onChange={(e) => {
              const g = goals.find((x) => x.id === (e.currentTarget as HTMLSelectElement).value);
              if (g) scoutGoal.value = { ...copy(g), label: g.label };
              setPlaces(null);
            }}
          >
            {goals.map((g) => (
              <option key={g.id} value={g.id} title={g.description}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        {goal && (
          <Section title={goal.label} right={<span class="small muted">0 at worst · 1 at best · limits rule out</span>}>
            <table class="tbl tbl-mini scout-terms">
              <thead>
                <tr>
                  <th>Criterion</th>
                  <th title="How much it matters">Weight</th>
                  <th>Worst</th>
                  <th>Best</th>
                  <th title="Places below are ruled out">Min</th>
                  <th title="Places above are ruled out">Max</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {goal.terms.map((t, i) => {
                  const c = criteria.find((x) => x.id === t.criterion);
                  return (
                    <tr key={t.criterion}>
                      <td title={c ? `${c.description} Known from: ${c.knowledge}.` : t.criterion}>
                        {c?.label ?? t.criterion} <span class="muted small">{c?.unit}</span>
                      </td>
                      <td>
                        <input type="range" class="scout-w" min="0.5" max="5" step="0.5" value={t.weight} onInput={(e) => edit(i, { weight: Number((e.currentTarget as HTMLInputElement).value) })} title={`weight ${t.weight}`} />
                      </td>
                      <td>
                        <NumIn value={t.worst} onChange={(v) => v !== undefined && edit(i, { worst: v })} title="the value scoring 0" />
                      </td>
                      <td>
                        <NumIn value={t.best} onChange={(v) => v !== undefined && edit(i, { best: v })} title="the value scoring 1" />
                      </td>
                      <td>
                        <NumIn value={t.min} onChange={(v) => edit(i, { min: v })} title="rule out places below" />
                      </td>
                      <td>
                        <NumIn value={t.max} onChange={(v) => edit(i, { max: v })} title="rule out places above" />
                      </td>
                      <td>
                        <button class="icon-btn" title="Remove" onClick={() => ((scoutGoal.value = { ...goal, terms: goal.terms.filter((_, k) => k !== i) }), setPlaces(null))}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {unused.length > 0 && (
              <select
                class="inp"
                value=""
                onChange={(e) => {
                  const c = criteria.find((x) => x.id === (e.currentTarget as HTMLSelectElement).value);
                  if (c) scoutGoal.value = { ...goal, terms: [...goal.terms, { criterion: c.id, weight: 1, worst: 0, best: 1 }] };
                }}
              >
                <option value="">+ add a criterion…</option>
                {unused.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} ({c.unit})
                  </option>
                ))}
              </select>
            )}
            <div class="row actions">
              <Button small onClick={() => (overlay.value = 'goal:custom')} tip="Colour the map by this goal: green good, red poor, grey ruled out">
                Show on map
              </Button>
              <Button small kind="primary" onClick={() => void find()} tip="The five best places, at least 150 m apart">
                Find places
              </Button>
            </div>
          </Section>
        )}
        {error && <div class="msg msg-bad">{error}</div>}
        {places && (
          <Section title="Best places" right={<span class="small muted">click to go there</span>}>
            {places.length === 0 ? (
              <Empty>Nowhere fits: every place breaks a hard limit.</Empty>
            ) : (
              <ol class="scout-places">
                {places.map((p, n) => (
                  <li key={n} onClick={() => app.scene.focus(p.at[0], p.at[1], { distance: 260 })} title="Fly there">
                    <div class="row between">
                      <b>
                        #{n + 1} <span class="num muted small">[{Math.round(p.at[0])}, {Math.round(p.at[1])}]</span>
                      </b>
                      <span class="num">{num(p.score * 100, 0)} %</span>
                    </div>
                    <div class="small muted">
                      {p.terms.map((t) => `${t.label} ${num(t.value, Math.abs(t.value) < 10 ? 1 : 0)} ${t.unit}`).join(' · ')}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        )}
        <div class="small muted">Knowledge: the topographic map, the climate normals, a soil map at 100 m, the woods you can see. A test pit or a season on the spot tells more.</div>
      </div>
    </div>
  );
}

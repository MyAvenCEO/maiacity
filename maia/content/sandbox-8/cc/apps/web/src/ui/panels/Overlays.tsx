/** Toasts, onboarding card, help (keyboard map), game menu (save/load/new/options). */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button, cx, Icon, Kbd } from '../components/common.tsx';
import { dateTime } from '../format.ts';
import { app, dismissToast, frame, helpOpen, load, menuOpen, onboardingDismissed, options, save, select, setOption, setSpeed, toast, toasts, tool, world, type UiOptions } from '../state.ts';
import { signal } from '@preact/signals';
import type { DeathView } from '../../protocol.ts';
import { setTool } from '../tools/controller.ts';
import { autosaveInfo, downloadSnapshot, loadAutosave, newGame, restoreFromFile } from '../persistence.ts';

export function Toasts() {
  return (
    <div class="toasts">
      {toasts.value.map((t) => (
        <div key={t.id} class={cx('toast glass', `lv-${t.level}`)} onClick={() => (t.refs?.[0] ? select(t.refs[0], undefined, { focus: true }) : dismissToast(t.id))}>
          <div class="toast-t">
            <span class="sev-ico" />
            {t.title}
            <button
              class="icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                dismissToast(t.id);
              }}
            >
              ✕
            </button>
          </div>
          {t.body && <div class="toast-b">{t.body}</div>}
        </div>
      ))}
    </div>
  );
}

export function Onboarding() {
  if (onboardingDismissed.value) return null;
  const dismiss = () => {
    onboardingDismissed.value = true;
    save('onboardingDismissed', true);
  };
  return (
    <div class="onboard glass">
      <div class="row between">
        <b>Welcome, contractor</b>
        <button class="icon-btn" onClick={dismiss} title="Dismiss">
          ✕
        </button>
      </div>
      <ol>
        <li>
          Start by building a <b>farm track</b> from the yard: press <Kbd k="R" />, pick <i>Feldweg</i>, click near the end of the public road, then click a few points into the map.
        </li>
        <li>
          Read the <b>Design</b> panel — grades, earthworks, cost and duration. Press <Kbd k="Enter" /> to build.
        </li>
        <li>
          Run time with <Kbd k="Space" /> and speeds <Kbd k="1" />–<Kbd k="5" />. Blocked work shows red; the <b>Alerts</b> tab offers remedies (rent a machine, recruit, order material).
        </li>
        <li>
          <Kbd k="Tab" /> opens projects, staff, fleet, materials and finance. <Kbd k="?" /> shows all shortcuts.
        </li>
      </ol>
      <div class="row">
        <Button
          kind="primary"
          small
          onClick={() => {
            setTool('road');
            dismiss();
          }}
        >
          Start a road (R)
        </Button>
        <Button kind="ghost" small onClick={dismiss}>
          Got it
        </Button>
      </div>
    </div>
  );
}

const KEYMAP: [string, string][] = [
  ['Space', 'Pause / resume'],
  ['1 – 5', 'Speed: 1 min/s, 10 min/s, 1 h/s, 6 h/s, 1 day/s'],
  ['N', 'Skip to next shift start'],
  ['Shift+N', 'Skip to next day'],
  ['V', 'Select tool'],
  ['R', 'Road tool'],
  ['B', 'Building tool'],
  ['Q / E', 'Building tool: rotate −15° / +15° (also Alt + wheel)'],
  ['Shift', 'Building tool: align to the nearest road'],
  ['I', 'Condition tool (road inspection)'],
  ['L / Shift+L', 'Cycle map overlays'],
  ['K', 'Scout: where is a good place, for what?'],
  ['Esc', 'Cancel draft / back to Select / deselect'],
  ['Click', 'Road tool: add point (snaps to roads; hold Alt to disable)'],
  ['Drag point', 'Road tool: move a control point'],
  ['Backspace / Right-click', 'Road tool: remove last point'],
  ['Enter / Double-click', 'Road tool: build'],
  ['F / Double-click', 'Focus camera on selection'],
  ['Tab', 'Show / hide the bottom drawer'],
  ['[  ]', 'Previous / next drawer tab'],
  ['G', 'Agent panel: action log, the AI agent\'s notes, pause the agent'],
  ['? / H', 'This help'],
];

export function Help() {
  if (!helpOpen.value) return null;
  return (
    <div class="modal-back" onClick={() => (helpOpen.value = false)}>
      <div class="modal glass help" onClick={(e) => e.stopPropagation()}>
        <div class="modal-h">
          <b>Keyboard</b>
          <button class="icon-btn" onClick={() => (helpOpen.value = false)}>
            ✕
          </button>
        </div>
        <table class="keymap">
          <tbody>
            {KEYMAP.map(([k, v]) => (
              <tr key={k}>
                <td>
                  {k.split(' / ').map((x, i) => (
                    <span key={x}>
                      {i > 0 && ' / '}
                      <Kbd k={x} />
                    </span>
                  ))}
                </td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div class="small muted">Numbers with a dotted underline explain themselves — click them to see the derivation and its sources.</div>
      </div>
    </div>
  );
}

const OPTION_LABELS: [keyof UiOptions, string][] = [
  ['worldLabels', 'Work-front & machine labels'],
  ['showLabels', 'Scene labels (3D)'],
  ['shadows', 'Shadows'],
  ['realLighting', 'Real sun & day/night'],
  ['showTrees', 'Trees'],
  ['autosave', 'Autosave every 6 in-game hours'],
];

export function Menu() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [seed, setSeed] = useState(String(load('seed', 2027)));
  const worlds = world.value?.worlds ?? [];
  const [worldId, setWorldId] = useState(world.value?.world.id ?? 'goettingen-contractor');
  if (!menuOpen.value) return null;
  const info = autosaveInfo();
  const close = () => (menuOpen.value = false);
  return (
    <div class="menu glass" onClick={(e) => e.stopPropagation()}>
      <div class="modal-h">
        <b>Game</b>
        <button class="icon-btn" onClick={close}>
          ✕
        </button>
      </div>
      <div class="menu-sec">
        <Button
          small
          onClick={() => {
            void downloadSnapshot();
            close();
          }}
        >
          <Icon name="save" size={13} /> Save to file
        </Button>
        <Button small onClick={() => fileRef.current?.click()}>
          <Icon name="load" size={13} /> Load file…
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = (e.currentTarget as HTMLInputElement).files?.[0];
            if (f) void restoreFromFile(f).then(close);
          }}
        />
        {info && (
          <Button
            small
            onClick={() => {
              loadAutosave();
              close();
            }}
            tip="Restore the last autosave"
          >
            Load autosave <span class="muted small">{dateTime(info.t)}</span>
          </Button>
        )}
      </div>
      <div class="menu-sec">
        <div class="sc muted">New game</div>
        <select class="inp" value={worldId} onChange={(e) => setWorldId((e.currentTarget as HTMLSelectElement).value)} title={worlds.find((w) => w.id === worldId)?.description ?? 'The world to start in'}>
          {worlds.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label}
            </option>
          ))}
        </select>
        <div class="row">
          <input class="inp num w80" value={seed} onInput={(e) => setSeed((e.currentTarget as HTMLInputElement).value)} title="Map / weather seed" />
          <Button
            small
            kind="danger"
            onClick={() => {
              const s = Number(seed) || 2027;
              newGame(s, worldId);
              close();
            }}
          >
            New game
          </Button>
        </div>
      </div>
      <div class="menu-sec">
        <div class="sc muted">Options</div>
        {OPTION_LABELS.map(([k, label]) => (
          <label key={k} class="opt">
            <input type="checkbox" checked={!!options.value[k]} onChange={(e) => setOption(k, (e.currentTarget as HTMLInputElement).checked as never)} /> {label}
          </label>
        ))}
        <Button
          small
          kind="ghost"
          onClick={() => {
            onboardingDismissed.value = false;
            save('onboardingDismissed', false);
            close();
          }}
        >
          Show intro again
        </Button>
      </div>
      <div class="small muted">
        seed {app.seed} · sim time {dateTime(frame.value?.t ?? 0)} · tool {tool.value}
      </div>
    </div>
  );
}

export function Fatal({ message }: { message: string }) {
  return (
    <div class="fatal glass">
      <b>Simulation error</b>
      <pre>{message}</pre>
      <Button
        onClick={() => {
          toast('info', 'Restarting…');
          newGame(app.seed);
        }}
      >
        Restart new game
      </Button>
    </div>
  );
}

/** the deaths this viewer has been shown (per game: a person's id and the moment) */
const seenDeaths = signal<string[]>(load('seenDeaths', []));
const deathKey = (d: DeathView) => `${app.seed}:${d.id}:${d.at}`;

/** what would have saved them, in plain words */
function lesson(cause: string): string {
  if (/thirst/.test(cause)) return 'A person lives only a few days without water, fewer in the heat. Keep water for two weeks in every camp, look at the store every day, and fetch or order it before it runs low: a walk to the shop, a delivery, the canisters at the kerb carried in.';
  if (/carbon monoxide/.test(cause)) return 'A fire without a flue in a closed tent fills it with carbon monoxide: no smell, no warning, and one does not wake. Never take a grill or a fire inside to sleep; a heater only with air coming in, and a stove only with its flue through the roof. The household is told what the night would bring before it heats.';
  if (/hunger/.test(cause)) return 'Weeks without enough to eat end like this. Keep food for weeks, and look at what each person is short of: the camp’s store, a delivery, a trip to the shop.';
  return 'Look after the people who live with you: what they lack shows on each of them, and in the alerts.';
}

/**
 * Someone died. The game stops, the screen goes dark, and the player is told plainly who, of what and
 * when, and what would have saved them (the user: it must be a shocking moment, so that players learn to
 * take care). It stays until it is acknowledged; a grave marks the place on the map.
 */
export function DeathNotice() {
  const f = frame.value;
  const d = f?.deaths?.find((x) => !seenDeaths.value.includes(deathKey(x)));
  useEffect(() => {
    // the world stops at once
    if (d && (frame.peek()?.speed ?? 0) > 0) setSpeed(0);
  }, [d?.id, d?.at]);
  if (!d) return null;
  const left = f!.people.length;
  const ack = () => {
    const next = [...seenDeaths.value, deathKey(d)].slice(-200);
    seenDeaths.value = next;
    save('seenDeaths', next);
  };
  return (
    <div class="death-veil" role="alertdialog" aria-labelledby="death-title" aria-describedby="death-cause">
      <div class="death-card">
        <div class="death-mark" aria-hidden="true">†</div>
        <h1 id="death-title">{d.name} is dead.</h1>
        <p id="death-cause" class="death-cause">Died {d.cause}.</p>
        <p class="death-when">{dateTime(d.at)}</p>
        <p class="death-lesson">{lesson(d.cause)}</p>
        <p class="death-left">{left === 0 ? 'Nobody is left.' : left === 1 ? 'One person is left.' : `${left} people are left.`} The game is paused.</p>
        <div class="death-actions">
          {d.x !== undefined && d.z !== undefined && (
            <Button onClick={() => app.scene.focus(d.x!, d.z!, { distance: 120 })}>Show the place</Button>
          )}
          <Button onClick={ack}>I understand</Button>
        </div>
      </div>
    </div>
  );
}


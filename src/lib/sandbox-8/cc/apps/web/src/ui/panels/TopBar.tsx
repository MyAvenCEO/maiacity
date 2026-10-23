/** Top bar: calendar, shift, weather, money, alerts and time controls. */
import { SPEEDS, SPEED_LABELS, type Hud } from '../../protocol.ts';
import { cx, Icon, Kbd } from '../components/common.tsx';
import { celsius, clock, date, eur, eurK, mmh, ms, weekday } from '../format.ts';
import { app, frame, menuOpen, openDrawer, setSpeed, togglePause, world } from '../state.ts';
import { agentPanelOpen, toggleAgentPanel } from './AgentPanel.tsx';

const SHORT = ['1m', '10m', '1h', '6h', '1d'];
const WEATHER_LABEL: Record<string, string> = { clear: 'Clear', fair: 'Fair', overcast: 'Overcast', rain: 'Rain', heavyRain: 'Heavy rain', snow: 'Snow' };

/** forecast panel under the weather group (hover / focus) — the forecast, not the simulated truth */
function Forecast({ days, cloud }: { days: Hud['forecast']; cloud: number }) {
  if (!days?.length) return null;
  return (
    <div class="wx-forecast glass" role="tooltip">
      <div class="sc muted">Forecast · cloud now {Math.round(cloud * 100)} %</div>
      {days.map((d, i) => (
        <div class="wx-row" key={d.day}>
          <span class="wx-day">{i === 0 ? 'Today' : weekday(d.day * 86_400).slice(0, 2)}</span>
          <span class={cx('wx-ico', `wx-${d.kind}`)}>
            <Icon name={d.kind} size={14} />
          </span>
          <span class="num">
            {celsius(d.tMax)} <span class="muted">/ {celsius(d.tMin)}</span>
          </span>
          <span class={cx('num', d.rainChance >= 0.5 ? 'c-info' : 'muted')} title="Chance of ≥ 1 mm">
            {Math.round(d.rainChance * 100)} %
          </span>
          <span class="num muted">{d.precip.toFixed(1)} mm</span>
          {d.frost ? <span class="pill tone-info small">frost</span> : <span />}
        </div>
      ))}
      <div class="small muted">Forecasts get less reliable further ahead.</div>
    </div>
  );
}

export function TopBar() {
  const f = frame.value;
  const w = world.value;
  if (!f) return <div class="topbar glass" />;
  const h = f.hud;
  const wx = h.weather;
  const paused = f.speed === 0;
  const speedIdx = SPEEDS.findIndex((s) => s === f.speed);
  const precipNow = wx.precip > 0.05;
  const icon = !wx.daylight && (wx.kind === 'clear' || wx.kind === 'fair') ? 'moon' : precipNow && wx.kind !== 'snow' && wx.kind !== 'rain' && wx.kind !== 'heavyRain' ? 'rain' : wx.kind;
  const lowLiquidity = h.liquidity < 20_000;
  return (
    <div class="topbar glass">
      <div class="tb-group tb-brand" title={w ? `${w.world.label} — ${w.location.name} · ${w.location.lat.toFixed(2)}° N ${w.location.lon.toFixed(2)}° E\n${Object.entries(w.world.bound).map(([c, b]) => `${c}: ${b}`).join('\n')}` : ''}>
        <button class="icon-btn" onClick={() => (menuOpen.value = !menuOpen.value)} title="Game menu: save, load, new game, options">
          <Icon name="menu" />
        </button>
        <span class="tb-loc">{w?.location.name.split(' (')[0] ?? '…'}</span>
      </div>

      <div class="tb-group tb-time" title="Simulation date and time">
        <span class="tb-clock num">{clock(f.t)}</span>
        <span class="tb-date num">
          <span class="tb-wd">{weekday(f.t)}</span> {date(f.t)}
        </span>
        <span class={cx('pill', h.onShift ? 'tone-good' : 'tone-muted')} title={h.onShift ? 'Crews are on shift and working' : 'Off shift — crews resume at the next shift start (N to skip there)'}>
          <i class="dot" />
          {h.onShift ? 'On shift' : 'Off shift'}
        </span>
      </div>

      <div class="tb-group tb-weather" tabIndex={0} aria-label="Weather now and forecast">
        <span class={cx('wx-ico', `wx-${wx.kind}`)}>
          <Icon name={icon} size={18} />
        </span>
        <span class="num tb-temp">{celsius(wx.temp)}</span>
        <span class={cx('num', precipNow ? 'c-info' : 'muted')}>{mmh(wx.precip)}</span>
        <span class="num muted tb-wind">
          <Icon name="wind" size={12} /> {ms(wx.wind)}
        </span>
        <Forecast days={h.forecast} cloud={wx.cloud} />
        {f.validity?.length ? (
          <span class="pill tone-warn small" title={`Estimates: a model is used outside the conditions it was validated for.\n\n${f.validity.join('\n\n')}`}>
            estimate
          </span>
        ) : null}
      </div>

      <div class="tb-group tb-money">
        <span class="tb-cash" title="Cash balance (bank account)">
          <span class="sc">cash</span> <b class={cx('num', h.cash < 0 && 'c-bad')}>{eur(h.cash)}</b>
        </span>
        <span class={cx('tb-liq', lowLiquidity && 'c-warn')} title="Liquidity = cash + unused credit line. Purchases are refused when it would go negative.">
          <span class="sc">liquidity</span> <span class="num">{eurK(h.liquidity)}</span>
        </span>
      </div>

      <div class="tb-group tb-status">
        <button class="tb-chip" onClick={() => openDrawer('workforce')} title="Staff employed">
          <span class="sc">staff</span> <span class="num">{h.staff}</span>
        </button>
        <button class="tb-chip" onClick={() => openDrawer('fleet')} title="Machines in the fleet">
          <span class="sc">fleet</span> <span class="num">{h.machines}</span>
        </button>
        <button class="tb-chip" onClick={() => openDrawer('projects')} title="Active projects">
          <span class="sc">projects</span> <span class="num">{h.activeProjects}</span>
        </button>
        <button
          class={cx('tb-chip', 'tb-agent', agentPanelOpen.value && 'has', f.agent?.connected && !f.agent.paused && 'live')}
          onClick={toggleAgentPanel}
          title={f.agent?.remote ? `AI agent: ${f.agent.paused ? 'paused by you' : f.agent.connected ? 'connected' : 'not connected'} — action log and the agent's notes (G)` : 'Action log (G)'}
        >
          <i class="dot" /> <span class="sc">agent</span>
        </button>
        <button class={cx('tb-chip', 'tb-alerts', f.alertCount > 0 && 'has')} onClick={() => openDrawer('alerts')} title={`${f.alertCount} open alerts, ${h.blockedPackages} blocked work packages`}>
          <Icon name="bell" size={14} />
          <span class="num">{f.alertCount}</span>
        </button>
      </div>

      <div class="tb-group tb-speed">
        <button class={cx('btn', 'btn-play', paused && 'is-paused')} onClick={togglePause} title="Pause / resume (Space)">
          <Icon name={paused ? 'play' : 'pause'} size={14} />
        </button>
        <div class="speeds" role="group" aria-label="Simulation speed">
          {SPEEDS.slice(1).map((s, i) => (
            <button key={s} class={cx('spd', speedIdx === i + 1 && 'on')} onClick={() => setSpeed(s)} title={`${SPEED_LABELS[i + 1]} — sim time per real second (${i + 1})`}>
              {SHORT[i]}
            </button>
          ))}
        </div>
        <button class="btn btn-sm" onClick={() => app.client.skip('shiftStart')} title="Skip to the next shift start (N)">
          <Icon name="skip" size={13} /> <span class="tb-shift-l">Shift</span>
        </button>
        <button class="btn btn-sm" onClick={() => app.client.skip('nextDay')} title="Advance to the next day 00:00 (Shift+N)">
          +1 d
        </button>
      </div>
      {f.dataWait && (
        <div class="data-wait" title={f.dataWait}>
          <Icon name="pause" size={11} /> Waiting for data — {f.dataWait}
        </div>
      )}
      {paused && !f.dataWait && (
        <div class="paused-flag" onClick={togglePause} title="Simulation paused — press Space to resume">
          <Icon name="pause" size={11} /> PAUSED <Kbd k="Space" />
        </div>
      )}
    </div>
  );
}

/**
 * Agent panel (G): what the AI agent is doing — its posted plan/notes, the live action log
 * (human vs agent, with the agent's stated intent), a switch to pause the agent, and the remedy
 * proposals it filed (never applied to the game) for the human to judge: useful / not realistic /
 * duplicate, with a comment that is stored in the proposal record on the server.
 * In the browser-only game (Web Worker) there is no agent: the panel shows the human log.
 */
import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import type { ActionEntry, ProposalSummary, ProposalVerdict } from '../../protocol.ts';
import { cx, Icon } from '../components/common.tsx';
import { dateTime } from '../format.ts';
import { app, frame, load, save } from '../state.ts';

export const agentPanelOpen = signal<boolean>(load('agentPanelOpen', false));

export function toggleAgentPanel(): void {
  agentPanelOpen.value = !agentPanelOpen.value;
  save('agentPanelOpen', agentPanelOpen.value);
}

type Filter = 'all' | 'agent' | 'human';

function ActionRow({ a }: { a: ActionEntry }) {
  return (
    <div class={cx('ag-row', `ag-${a.actor}`, !a.ok && 'ag-rejected')}>
      <div class="ag-row-head">
        <span class={cx('ag-actor', `ag-actor-${a.actor}`)}>{a.actor === 'agent' ? 'Agent' : 'Human'}</span>
        <span class="ag-cmd">{a.command}</span>
        <span class={cx('ag-ok', a.ok ? 'c-good' : 'c-bad')}>{a.ok ? '✓' : '✗'}</span>
        <span class="ag-time num muted">{dateTime(a.t)}</span>
      </div>
      {a.note && <div class="ag-note">“{a.note}”</div>}
      {a.summary && <div class="ag-summary muted">{a.summary}</div>}
      {a.reasons?.map((r, i) => (
        <div key={i} class="ag-reason c-bad">
          {r}
        </div>
      ))}
    </div>
  );
}

const VERDICT_LABELS: [ProposalVerdict, string, string][] = [
  ['useful', 'Useful', 'Realistic and worth implementing as a real mechanic'],
  ['not_realistic', 'Not realistic', 'Not how it works in reality, or a shortcut'],
  ['duplicate', 'Duplicate', 'Already proposed, or achievable with existing commands'],
];
const KIND_LABELS: Record<string, string> = { missing_mechanic: 'missing mechanic', better_remedy: 'better remedy', data_correction: 'data correction', other: 'other' };

function ProposalRow({ p }: { p: ProposalSummary }) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState(p.verdict?.comment ?? '');
  const judge = (v: ProposalVerdict) => app.client.setProposalVerdict(p.id, v, comment.trim() || undefined);
  const tone = p.verdict?.verdict === 'useful' ? 'tone-good' : p.verdict ? 'tone-muted' : 'tone-warn';
  return (
    <div class={cx('ag-prop', open && 'open')} data-testid="proposal">
      <div class="ag-prop-head" onClick={() => setOpen(!open)} title={open ? 'Collapse' : 'Show the details and judge it'}>
        <span class="ag-prop-title">{p.title}</span>
        <span class={cx('pill', tone)}>
          <i class="dot" />
          {p.verdict ? VERDICT_LABELS.find(([v]) => v === p.verdict!.verdict)?.[1] : 'to review'}
        </span>
      </div>
      <div class="ag-prop-meta muted small">{[KIND_LABELS[p.kind] ?? p.kind, p.blockerCode, p.subject, dateTime(p.t)].filter(Boolean).join(' · ')}</div>
      {open && (
        <div class="ag-prop-body">
          <div class="ag-prop-field">
            <b>Proposal</b>
            {p.proposal}
          </div>
          <div class="ag-prop-field">
            <b>Real-world basis</b>
            {p.realWorldBasis}
          </div>
          <div class="ag-prop-field">
            <b>Why not the existing remedies</b>
            {p.whyNotExisting}
          </div>
          <div class="ag-prop-field">
            <b>Expected effect</b>
            {p.expectedEffect}
          </div>
          {p.rules && (
            <div class="ag-prop-field">
              <b>Rules</b>
              {p.rules}
            </div>
          )}
          <input class="inp ag-prop-comment" placeholder="Comment (optional)" value={comment} onInput={(e) => setComment((e.currentTarget as HTMLInputElement).value)} />
          <div class="ag-prop-actions">
            {VERDICT_LABELS.map(([v, label, title]) => (
              <button key={v} class={cx('btn btn-sm', p.verdict?.verdict === v && 'btn-primary')} title={title} onClick={() => judge(v)}>
                {label}
              </button>
            ))}
          </div>
          <div class="muted small">{p.id} · proposals never change the game; judged ones feed the review digest (npm run proposals:review).</div>
        </div>
      )}
    </div>
  );
}

export function AgentPanel() {
  const [filter, setFilter] = useState<Filter>('all');
  if (!agentPanelOpen.value) return null;
  const f = frame.value;
  const agent = f?.agent;
  const remote = Boolean(app.client?.remote || agent?.remote);
  const actions = (f?.actions ?? []).filter((a) => filter === 'all' || a.actor === filter).slice().reverse();
  const notes = (agent?.notes ?? []).slice().reverse();
  const proposals = (agent?.proposals ?? []).slice().reverse();
  const toReview = proposals.filter((p) => !p.verdict).length;
  const status = !remote ? { tone: 'tone-muted', label: 'Browser only' } : agent?.paused ? { tone: 'tone-warn', label: 'Paused by you' } : agent?.connected ? { tone: 'tone-good', label: 'Agent connected' } : { tone: 'tone-muted', label: 'No agent connected' };
  return (
    <div class="agent-panel glass" data-testid="agent-panel">
      <div class="ag-head">
        <b>Agent</b>
        <span class={cx('pill', status.tone)}>
          <i class="dot" />
          {status.label}
        </span>
        <span class="grow" />
        {remote && (
          <label class="ag-switch" title="While paused, the server refuses the agent's commands and time advances (it can still look and plan).">
            <input type="checkbox" checked={Boolean(agent?.paused)} onChange={(e) => app.client.setAgentPaused((e.currentTarget as HTMLInputElement).checked)} />
            Pause agent
          </label>
        )}
        <button class="icon-btn" onClick={toggleAgentPanel} title="Close (G)">
          <Icon name="close" size={14} />
        </button>
      </div>
      {!remote && <div class="ag-hint muted small">Playing in the browser: only your own actions are logged. Run <code>npm run server</code> and connect an AI agent (docs/AGENTS.md) to play together.</div>}
      {agent?.busy && (
        <div class="ag-busy">
          <span class="spinner" /> {agent.busy}
        </div>
      )}
      {remote && (
        <div class="ag-section">
          <div class="sc muted">Agent's plan &amp; notes</div>
          {notes.length === 0 ? (
            <div class="muted small">No notes yet.</div>
          ) : (
            <div class="ag-notes">
              {notes.map((n) => (
                <div key={n.seq} class="ag-note-card">
                  <div class="muted small num">{dateTime(n.t)}</div>
                  <div class="ag-note-text">{n.text}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {remote && proposals.length > 0 && (
        <div class="ag-section">
          <div class="sc muted" title="The agent's ideas for other realistic remedies. They never change the game; judge them so the useful ones can be implemented.">
            Proposals ({proposals.length}
            {toReview ? `, ${toReview} to review` : ''})
          </div>
          <div class="ag-props">
            {proposals.map((p) => (
              <ProposalRow key={p.id} p={p} />
            ))}
          </div>
        </div>
      )}
      <div class="ag-section ag-log-section">
        <div class="ag-log-head">
          <span class="sc muted">Action log</span>
          <span class="grow" />
          {remote &&
            (['all', 'agent', 'human'] as Filter[]).map((k) => (
              <button key={k} class={cx('ag-filter', filter === k && 'on')} onClick={() => setFilter(k)}>
                {k}
              </button>
            ))}
        </div>
        <div class="ag-log">
          {actions.length === 0 ? <div class="muted small">No actions yet.</div> : actions.map((a) => <ActionRow key={a.seq} a={a} />)}
        </div>
      </div>
    </div>
  );
}

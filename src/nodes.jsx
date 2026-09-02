// ---------------------------------------------------------------------------
// The two things that appear on the board.
//
// Shape carries meaning, so a reader can see the structure without reading
// every label: a diamond branches, a parallelogram touches the outside world,
// a stadium is where control enters or leaves. Rejected steps stay on the
// board, struck through, with the reason still attached. The record of what
// was considered and dropped is the most useful part of a reviewed plan.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { Handle, Position } from '@xyflow/react';

import { useActions } from './actions.js';

const CAPTION = {
  entry: 'ENTRY', process: 'STEP', decision: 'BRANCH', store: 'STATE',
  io: 'OUTSIDE', external: 'THEIRS', terminal: 'END', option: 'OPTION',
};

function flagFor(element, stale) {
  if (element.status === 'rejected') return { cls: 'rejected', text: 'DROPPED' };
  if (stale) return { cls: 'stale', text: 'STALE' };
  if (element.confidence != null && element.confidence < 0.5) {
    return { cls: 'low', text: `${Math.round(element.confidence * 100)}% SURE` };
  }
  if (element.status === 'agreed') return { cls: 'agreed', text: 'AGREED' };
  return null;
}

/**
 * The controls that appear on a card when the pointer is over it. Agreeing is
 * one click, because agreeing carries no information the agent needs. Both
 * other verdicts open the same box, because "this is wrong" is only useful to
 * the agent when it says why, and the objection is worth keeping either way.
 */
function CardTools({ element }) {
  const act = useActions();
  const [writing, setWriting] = useState(null);      // null | 'comment' | 'disagree'
  const box = useRef(null);

  useEffect(() => { if (writing) box.current?.focus(); }, [writing]);
  if (!act) return null;

  const send = () => {
    const body = box.current?.value.trim();
    if (!body) return;
    if (writing === 'disagree') act.disagree(element.id, body);
    else act.comment(element.id, body);
    setWriting(null);
  };

  const keys = ev => {
    if (ev.key === 'Escape') { ev.stopPropagation(); setWriting(null); }
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) send();
  };

  if (writing) {
    return (
      <div className="card-compose nodrag nopan nowheel" onClick={ev => ev.stopPropagation()}>
        <textarea
          ref={box}
          rows={3}
          onKeyDown={keys}
          placeholder={writing === 'disagree'
            ? 'Why is this wrong? Everything downstream goes stale.'
            : 'What is wrong with this step?'}
        />
        <div className="card-compose-row">
          <button className={writing === 'disagree' ? 'danger' : 'primary'} onClick={send}>
            {writing === 'disagree' ? 'Say why and drop it' : 'Comment'}
          </button>
          <button onClick={() => setWriting(null)}>Cancel</button>
          <span className="hint">⌘+enter</span>
        </div>
      </div>
    );
  }

  return (
    <div className="card-tools nodrag nopan" onClick={ev => ev.stopPropagation()}>
      {element.status !== 'agreed' && (
        <button className="tick" title="This is right" onClick={() => act.setStatus(element.id, 'agreed')}>✓</button>
      )}
      <button title="Comment on this step" onClick={() => setWriting('comment')}>💬</button>
      {element.status !== 'rejected' && (
        <button className="cross" title="This is wrong" onClick={() => setWriting('disagree')}>✕</button>
      )}
    </div>
  );
}

export function StepNode({ data, selected }) {
  const { element, notes, comments, stale, findings } = data;
  const flag = flagFor(element, stale);
  const open = comments.filter(c => !c.resolved).length;
  const worst = findings.some(f => f.severity === 'error') ? 'error'
    : findings.some(f => f.severity === 'warn') ? 'warn' : null;
  const low = element.confidence != null && element.confidence < 0.5;

  // A pill is only a pill while the card is short. Once notes are stacked
  // inside one, the radius becomes an ellipse that cuts the corners off its
  // own contents, so data-tall lets the shape square itself off.
  return (
    <div
      className="step"
      data-kind={element.kind}
      data-status={element.status}
      data-stale={stale ? 1 : 0}
      data-low={low ? 1 : 0}
      data-selected={selected ? 1 : 0}
      data-flag={worst || ''}
      data-tall={notes.length > 0 ? '' : undefined}
    >
      <Handle type="target" position={Position.Left} />
      <div className="step-shape" aria-hidden="true" />

      <div className="step-body">
        <div className="step-top">
          <span className="step-kind">{CAPTION[element.kind] || 'STEP'}</span>
          {flag && <span className={`step-flag ${flag.cls}`}>{flag.text}</span>}
        </div>
        <div className="step-label">{element.label}</div>
        {element.detail && <div className="step-detail">{element.detail}</div>}
        {element.rejected_because && (
          <div className="step-because">{element.rejected_because}</div>
        )}

        {notes.length > 0 && (
          <div className="step-notes">
            {notes.map(n => (
              <div key={n.id} className="note" data-kind={n.kind} data-state={n.state || ''}>
                <span className="note-kind">
                  {n.kind}{n.state === 'unverified' ? ' · unsettled'
                    : n.state ? ` · ${n.state}` : ''}
                </span>
                <span className="note-text">{n.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {comments.length > 0 && (
        <span className={`step-badge${open ? ' open' : ''}`} title={`${comments.length} comment(s)`}>
          {comments.length}
        </span>
      )}
      <CardTools element={element} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function StickyNode({ data, selected }) {
  const { element, comments } = data;
  return (
    <div
      className="loose-note"
      data-kind={element.kind}
      data-state={element.state || ''}
      data-selected={selected ? 1 : 0}
    >
      <Handle type="target" position={Position.Left} />
      <span className="note-kind">{element.kind} · attached to nothing</span>
      <span className="note-text">{element.label}</span>
      {comments.length > 0 && <span className="step-badge open">{comments.length}</span>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export const nodeTypes = { step: StepNode, sticky: StickyNode };

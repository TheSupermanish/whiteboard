// ---------------------------------------------------------------------------
// The two things that appear on the board.
//
// Shape carries meaning, so a reader can see the structure without reading
// every label: a diamond branches, a parallelogram touches the outside world,
// a stadium is where control enters or leaves. Rejected steps stay on the
// board, struck through, with the reason still attached. The record of what
// was considered and dropped is the most useful part of a reviewed plan.
// ---------------------------------------------------------------------------

import { Handle, Position } from '@xyflow/react';

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

export function StepNode({ data, selected }) {
  const { element, notes, comments, stale, findings } = data;
  const flag = flagFor(element, stale);
  const open = comments.filter(c => !c.resolved).length;
  const worst = findings.some(f => f.severity === 'error') ? 'error'
    : findings.some(f => f.severity === 'warn') ? 'warn' : null;
  const low = element.confidence != null && element.confidence < 0.5;

  return (
    <div
      className="step"
      data-kind={element.kind}
      data-status={element.status}
      data-stale={stale ? 1 : 0}
      data-low={low ? 1 : 0}
      data-selected={selected ? 1 : 0}
      data-flag={worst || ''}
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

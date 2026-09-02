// ---------------------------------------------------------------------------
// The contents of the plan, as a list.
//
// The board shows the shape. This shows the running order and, on every line,
// where that step stands: agreed, dropped, still resting on something nobody
// has ruled on, argued with. A plan of eighteen steps does not fit on one
// screen, so the question "what is still open" needs answering without
// panning around looking for orange.
//
// Verdicts live on the cards now. What is left here is the work only a person
// can do: ruling on an assumption, and settling an objection.
// ---------------------------------------------------------------------------

import { useState } from 'react';

import { Comment } from './bits.jsx';

const UNSETTLED = new Set(['unverified', null, undefined, '']);

/** anchor id -> what is attached to it, built once per render rather than per row. */
function index(items) {
  const by = new Map();
  for (const item of items) {
    if (!item.anchor) continue;
    if (!by.has(item.anchor)) by.set(item.anchor, []);
    by.get(item.anchor).push(item);
  }
  return by;
}

/** One glyph per thing that is true of a step, worst first. */
function marksFor(notes, element, stale, comments) {
  const marks = [];
  if (element.status === 'rejected') marks.push({ cls: 'no', glyph: '✕', why: 'dropped' });
  else if (element.status === 'agreed') marks.push({ cls: 'yes', glyph: '✓', why: 'agreed' });
  if (stale) marks.push({ cls: 'warn', glyph: '!', why: 'stale: something it rested on changed' });

  const open = comments.filter(c => !c.resolved);
  if (open.length) marks.push({ cls: 'no', glyph: '💬', why: `${open.length} unsettled objection(s)` });
  else if (comments.length) marks.push({ cls: 'muted', glyph: '💬', why: 'settled' });

  const unruled = notes.filter(s => s.state !== undefined && UNSETTLED.has(s.state));
  if (unruled.length) {
    marks.push({ cls: 'warn', glyph: '?', why: `${unruled.length} thing(s) nobody has ruled on` });
  }
  if (element.confidence != null && element.confidence < 0.5) {
    marks.push({ cls: 'muted', glyph: `${Math.round(element.confidence * 100)}%`, why: 'low confidence' });
  }
  return marks;
}

export default function Contents({ scene, report, selected, onSelect, act, open, onToggle }) {
  const [expanded, setExpanded] = useState(null);

  if (!open) {
    return (
      <aside className="toc collapsed">
        <button className="toc-handle" onClick={onToggle} title="Show the contents">
          <span className="chev">‹</span>
          <span className="toc-handle-text">Contents</span>
        </button>
      </aside>
    );
  }

  const stale = new Set(report.stale);
  const nodes = scene.nodes();
  const stickies = scene.stickies();
  const notesBy = index(stickies);
  const commentsBy = index(scene.comments());
  const loose = stickies.filter(s => !s.anchor);
  const counts = report.findings.reduce((a, f) => (a[f.severity] = (a[f.severity] || 0) + 1, a), {});

  return (
    <aside className="toc">
      <div className="toc-head">
        <strong>Contents</strong>
        <span className="toc-tally">
          {counts.error ? <em className="no">{counts.error} error{counts.error > 1 ? 's' : ''}</em> : null}
          {counts.warn ? <em className="warn">{counts.warn} to settle</em> : null}
          {!counts.error && !counts.warn ? <em className="yes">nothing outstanding</em> : null}
        </span>
        <button className="toc-close" onClick={onToggle} title="Hide the contents">›</button>
      </div>

      <div className="toc-list">
        {nodes.length === 0 && <p className="toc-empty">Nothing drawn yet.</p>}

        {nodes.map(n => {
          const comments = commentsBy.get(n.id) || [];
          const notes = notesBy.get(n.id) || [];
          const marks = marksFor(notes, n, stale.has(n.id), comments);
          const isOpen = expanded === n.id;
          return (
            <div key={n.id} className={`toc-row${selected === n.id ? ' on' : ''}`}>
              <button
                className="toc-line"
                onClick={() => { onSelect(n.id); setExpanded(isOpen ? null : n.id); }}
              >
                <span className={`toc-dot k-${n.kind}`} />
                <span className={`toc-label${n.status === 'rejected' ? ' struck' : ''}`}>{n.label}</span>
                <span className="toc-marks">
                  {marks.map((m, i) => (
                    <em key={i} className={m.cls} title={m.why}>{m.glyph}</em>
                  ))}
                </span>
              </button>

              {isOpen && <Detail {...{ scene, element: n, notes, comments, act, onSelect }} />}
            </div>
          );
        })}

        {loose.length > 0 && (
          <>
            <div className="toc-group">Attached to nothing</div>
            {loose.map(s => (
              <div key={s.id} className="toc-row">
                <button className="toc-line" onClick={() => onSelect(s.id)}>
                  <span className="toc-dot k-loose" />
                  <span className="toc-label">{s.label}</span>
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

/** What a person can still do about one step, once its line is opened. */
function Detail({ scene, element, notes, comments, act, onSelect }) {
  const rulable = notes.filter(s => s.state !== undefined);

  return (
    <div className="toc-detail">
      {element.detail && <p className="toc-detail-text">{element.detail}</p>}
      {element.status === 'rejected' && element.rejected_because && (
        <p className="toc-because">Dropped: {element.rejected_because}</p>
      )}

      {rulable.map(s => (
        <div key={s.id} className={`toc-note${UNSETTLED.has(s.state) ? ' unruled' : ''}`}>
          <span className="toc-note-kind">{s.kind} · {s.state || 'unverified'}</span>
          <span className="toc-note-text">{s.label}</span>
          {UNSETTLED.has(s.state) && (
            <div className="actions">
              <button className="mini good" onClick={() => act.rule(s.id, 'confirmed')}>That&rsquo;s right</button>
              <button className="mini danger" onClick={() => act.rule(s.id, 'denied')}>That&rsquo;s wrong</button>
            </div>
          )}
        </div>
      ))}

      {notes.filter(s => s.state === undefined).map(s => (
        <div key={s.id} className="toc-note">
          <span className="toc-note-kind">{s.kind}</span>
          <span className="toc-note-text">{s.label}</span>
        </div>
      ))}

      {comments.map(c => (
        <Comment key={c.id} comment={c} scene={scene} onSelect={onSelect} act={act} />
      ))}

      {comments.length === 0 && (
        <p className="toc-hint">Hover the card on the board to agree, comment or drop this.</p>
      )}
    </div>
  );
}

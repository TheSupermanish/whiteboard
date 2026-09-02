// ---------------------------------------------------------------------------
// The review panel.
//
// Three tabs, in the order a reviewer needs them: what is outstanding, what
// the checks found, and whatever is selected. Every comment box is bound to a
// specific element; there is no general chat, because an objection with no
// target is how a plan drifts.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';

const YOU = 'you';

export default function Panel({ scene, report, selected, tab, onTab, onSelect, onHighlight, act }) {
  const counts = {
    queue: unanswered(scene).length
      + scene.stickies().filter(s => s.state === 'unverified').length
      + report.summary.error,
    checks: report.findings.length,
  };

  return (
    <aside className="panel">
      <nav className="tabs" role="tablist">
        <Tab id="queue" tab={tab} onTab={onTab} count={counts.queue} hot={counts.queue > 0}>
          Open items
        </Tab>
        <Tab id="checks" tab={tab} onTab={onTab} count={counts.checks} hot={report.summary.error > 0}>
          Checks
        </Tab>
        <Tab id="selection" tab={tab} onTab={onTab}>Selected</Tab>
      </nav>

      <div className="pane">
        {tab === 'queue' && <Queue {...{ scene, report, onSelect, onHighlight, act }} />}
        {tab === 'checks' && <Checks {...{ scene, report, onHighlight }} />}
        {tab === 'selection' && <Selection {...{ scene, report, selected, onSelect, act }} />}
      </div>
    </aside>
  );
}

function Tab({ id, tab, onTab, count, hot, children }) {
  return (
    <button
      className={`tab${tab === id ? ' is-on' : ''}`}
      role="tab"
      aria-selected={tab === id}
      onClick={() => onTab(id)}
    >
      {children}
      {count !== undefined && <span className={`count${hot ? ' hot' : ''}`}>{count}</span>}
    </button>
  );
}

// --- open items -----------------------------------------------------------

function Queue({ scene, report, onSelect, onHighlight, act }) {
  const open = scene.comments().filter(c => !c.resolved);
  const unsettled = scene.stickies().filter(s => s.state === 'unverified');
  const dropped = scene.nodes().filter(n => n.status === 'rejected');
  const errors = report.findings.filter(f => f.severity === 'error');

  if (!open.length && !unsettled.length && !errors.length && !dropped.length) {
    return (
      <Nothing title={scene.nodes().length ? 'Nothing outstanding.' : 'The board is empty.'}>
        {scene.nodes().length
          ? 'No open objections, no unsettled assumptions, no structural errors. This plan is ready to be built.'
          : 'Play the recorded session, or ask a connected agent to draw its plan.'}
      </Nothing>
    );
  }

  return (
    <>
      {open.length > 0 && <Group title={`Objections (${open.length})`} />}
      {open.map(c => (
        <Comment key={c.id} comment={c} scene={scene} onSelect={onSelect} act={act} />
      ))}

      {unsettled.length > 0 && <Group title={`Assumptions nobody has ruled on (${unsettled.length})`} />}
      {unsettled.map(s => (
        <div className="card warn" key={s.id}>
          <div className="card-top">
            <span className="chip warn">{s.kind}</span>
            <button className="about link" onClick={() => onSelect(s.anchor || s.id)}>
              {labelOf(scene, s.anchor)}
            </button>
          </div>
          <div className="body">{s.label}</div>
          <div className="actions">
            <button className="mini good" onClick={() => act.rule(s.id, 'confirmed')}>That&rsquo;s right</button>
            <button className="mini danger" onClick={() => act.rule(s.id, 'denied')}>That&rsquo;s wrong</button>
          </div>
        </div>
      ))}

      {errors.length > 0 && <Group title={`Structural errors (${errors.length})`} />}
      {errors.map((f, i) => <Finding key={i} finding={f} onHighlight={onHighlight} />)}

      {dropped.length > 0 && <Group title={`Dropped (${dropped.length})`} />}
      {dropped.map(n => (
        <button className="card clickable plain" key={n.id} onClick={() => onSelect(n.id)}>
          <div className="card-top"><span className="chip err">dropped</span></div>
          <div className="body struck">{n.label}</div>
          {n.rejected_because && <div className="why">{n.rejected_because}</div>}
        </button>
      ))}
    </>
  );
}

// --- checks ---------------------------------------------------------------

function Checks({ scene, report, onHighlight }) {
  if (!scene.nodes().length) {
    return <Nothing title="No plan to check.">These checks read the graph, so they need a graph.</Nothing>;
  }
  return (
    <>
      <div className="card">
        <div className="body">
          <strong>{report.paths.count}</strong> route{report.paths.count === 1 ? '' : 's'} run
          through this plan, the longest <strong>{report.paths.longest}</strong> steps.
          {report.stale.length > 0 && <> <strong>{report.stale.length}</strong> step
            {report.stale.length === 1 ? ' is' : 's are'} stale.</>}
        </div>
        <div className="why">
          Every route is a case somebody has to handle. Walk them before agreeing the plan.
        </div>
      </div>
      {report.findings.length === 0
        ? <Nothing title="The graph is clean.">Nothing unreachable, no dead ends, every branch handled.</Nothing>
        : report.findings.map((f, i) => <Finding key={i} finding={f} onHighlight={onHighlight} />)}
    </>
  );
}

function Finding({ finding, onHighlight }) {
  return (
    <button
      className={`card clickable plain ${finding.severity}`}
      onClick={() => onHighlight(finding.ids)}
    >
      <div className="card-top">
        <span className={`chip ${finding.severity}`}>{finding.check.replace(/_/g, ' ')}</span>
      </div>
      <div className="body">{finding.message}</div>
      <div className="why">{finding.why}</div>
    </button>
  );
}

// --- selection ------------------------------------------------------------

function Selection({ scene, report, selected, onSelect, act }) {
  if (!selected || !scene.has(selected)) {
    return (
      <Nothing title="Nothing selected.">
        Click a step on the board to read it, argue with it, or drop it.
      </Nothing>
    );
  }
  const element = scene.get(selected);
  if (element.type === 'sticky') return <StickyDetail {...{ scene, element, act, onSelect }} />;
  if (element.type === 'comment') return <Nothing title="Comments live on the step they were made on." />;

  const notes = scene.stickies().filter(s => s.anchor === element.id);
  const comments = scene.comments().filter(c => c.anchor === element.id);
  const findings = report.findings.filter(f => f.ids.includes(element.id));
  const stale = report.stale.includes(element.id);

  return (
    <>
      <div className="card">
        <div className="card-top">
          <span className="chip">{element.kind}</span>
          <span className={`chip ${element.status === 'rejected' ? 'err' : element.status === 'agreed' ? 'ok' : ''}`}>
            {element.status}
          </span>
          {stale && <span className="chip warn">stale</span>}
          {element.confidence != null && (
            <span className="chip">{Math.round(element.confidence * 100)}% sure</span>
          )}
          <span className="about mono">{element.id}</span>
        </div>
        <div className="body"><strong>{element.label}</strong></div>
        {element.detail && <div className="why">{element.detail}</div>}
        {element.rejected_because && (
          <div className="why"><strong>Dropped because:</strong> {element.rejected_because}</div>
        )}
        <div className="actions">
          <button
            className="mini good"
            disabled={element.status === 'agreed'}
            onClick={() => act.setStatus(element.id, 'agreed')}
          >Looks right</button>
          <button
            className="mini danger"
            disabled={element.status === 'rejected'}
            onClick={() => act.setStatus(element.id, 'rejected')}
          >Not this</button>
        </div>
      </div>

      {findings.length > 0 && <Group title="What the checks say" />}
      {findings.map((f, i) => (
        <div className={`card ${f.severity}`} key={i}>
          <div className="card-top">
            <span className={`chip ${f.severity}`}>{f.check.replace(/_/g, ' ')}</span>
          </div>
          <div className="body">{f.message}</div>
          <div className="why">{f.why}</div>
        </div>
      ))}

      {notes.length > 0 && <Group title="Notes on this step" />}
      {notes.map(s => (
        <div className={`card ${s.state === 'unverified' ? 'warn' : 'info'}`} key={s.id}>
          <div className="card-top">
            <span className={`chip ${s.state === 'unverified' ? 'warn' : ''}`}>
              {s.kind}{s.state ? ` · ${s.state}` : ''}
            </span>
          </div>
          <div className="body">{s.label}</div>
          {s.state && (
            <div className="actions">
              <button className="mini good" disabled={s.state === 'confirmed'}
                onClick={() => act.rule(s.id, 'confirmed')}>That&rsquo;s right</button>
              <button className="mini danger" disabled={s.state === 'denied'}
                onClick={() => act.rule(s.id, 'denied')}>That&rsquo;s wrong</button>
            </div>
          )}
        </div>
      ))}

      <Group title={`Discussion (${comments.length})`} />
      {comments.length > 0
        ? comments.map(c => <Comment key={c.id} comment={c} scene={scene} onSelect={onSelect} act={act} />)
        : <p className="hint">Nothing said about this step yet.</p>}

      <Say
        placeholder="What is wrong with this step? e.g. &ldquo;you are not building billing here&rdquo;"
        label={`Comment on ${shorten(element.label, 26)}`}
        onSay={body => act.comment(element.id, body)}
      />
      <p className="hint">
        Attached to <code>{element.id}</code>, so it stays on this step through every redraw.
      </p>
    </>
  );
}

function StickyDetail({ scene, element, act }) {
  return (
    <div className="card">
      <div className="card-top">
        <span className={`chip ${element.state === 'unverified' ? 'warn' : ''}`}>
          {element.kind}{element.state ? ` · ${element.state}` : ''}
        </span>
        <span className="about mono">{element.id}</span>
      </div>
      <div className="body">{element.label}</div>
      {element.anchor && <div className="why">About <strong>{labelOf(scene, element.anchor)}</strong></div>}
      {element.state && (
        <>
          <div className="actions">
            <button className="mini good" disabled={element.state === 'confirmed'}
              onClick={() => act.rule(element.id, 'confirmed')}>That&rsquo;s right</button>
            <button className="mini danger" disabled={element.state === 'denied'}
              onClick={() => act.rule(element.id, 'denied')}>That&rsquo;s wrong</button>
          </div>
          <p className="hint">
            Denying an assumption marks everything the plan built on it as stale.
          </p>
        </>
      )}
    </div>
  );
}

// --- pieces ---------------------------------------------------------------

function Comment({ comment, scene, onSelect, act }) {
  const answered = comment.replies.some(r => r.author !== comment.author);
  return (
    <div className={`card ${comment.resolved ? 'info' : answered ? 'warn' : 'err'}`}>
      <div className="card-top">
        <span className={`who ${comment.author === 'agent' ? 'agent' : 'human'}`}>{comment.author}</span>
        <button className="about link" onClick={() => onSelect(comment.anchor)}>
          on {labelOf(scene, comment.anchor)}
        </button>
      </div>
      <div className="body">{comment.body}</div>
      {comment.replies.length > 0 ? (
        <div className="thread">
          {comment.replies.map((r, i) => (
            <div className="reply" key={i}>
              <span className={`who ${r.author === 'agent' ? 'agent' : 'human'}`}>{r.author}</span>
              {r.body}
            </div>
          ))}
        </div>
      ) : (
        <div className="why">Waiting for the agent to answer this.</div>
      )}
      {!comment.resolved && (
        <>
          <Say small placeholder="Reply&hellip;" label="Reply"
            onSay={body => act.reply(comment.id, body)} />
          <div className="actions">
            <button className="mini good" onClick={() => act.resolve(comment.id)}>Settled</button>
          </div>
        </>
      )}
      {comment.resolved && <div className="why">Settled by {comment.resolved_by}.</div>}
    </div>
  );
}

function Say({ placeholder, label, onSay, small }) {
  const [text, setText] = useState('');
  const box = useRef(null);
  useEffect(() => { if (!small) box.current?.focus({ preventScroll: true }); }, [small]);

  const send = () => {
    const body = text.trim();
    if (!body) { box.current?.focus(); return; }
    onSay(body);
    setText('');
  };

  return (
    <>
      <textarea
        ref={box}
        className={`say${small ? ' small' : ''}`}
        placeholder={placeholder}
        value={text}
        onChange={ev => setText(ev.target.value)}
        onKeyDown={ev => {
          if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); send(); }
        }}
      />
      <div className="actions">
        <button className="mini" onClick={send}>{label}</button>
        <span className="kbd-hint">or {navigator.platform.includes('Mac') ? '⌘' : 'ctrl'}+enter</span>
      </div>
    </>
  );
}

const Group = ({ title }) => <div className="group-title">{title}</div>;

const Nothing = ({ title, children }) => (
  <div className="nothing"><strong>{title}</strong>{children}</div>
);

const unanswered = scene => scene.comments().filter(c =>
  !c.resolved && !c.replies.some(r => r.author !== c.author));

function labelOf(scene, id) {
  if (!id || !scene.has(id)) return id || 'the board';
  const e = scene.get(id);
  return shorten(e.label || e.body || id, 34);
}

const shorten = (s, n) => String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s);

export { YOU };

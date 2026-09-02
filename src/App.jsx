// ---------------------------------------------------------------------------
// The application shell: the scene, the tool surface, the toolbar.
//
// The scene is a mutable imperative object rather than React state on purpose.
// An agent writes to it over WebMCP at arbitrary moments and its invariants and
// its checks have to be testable with no DOM in sight, so the graph stays
// outside React and React is told to redraw when it changes.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Contents from './Contents.jsx';
import { Actions } from './actions.js';
import { ensureHost } from './lib/host.js';
import { ReactFlowProvider } from '@xyflow/react';

import { createScene } from './lib/scene.js';
import { analyze } from './lib/analyze.js';
import * as mcp from './lib/mcp.js';
import { share, whoAmI } from './lib/net.js';
import { runRecorded, stepCount } from './lib/replay.js';
import { toFlow } from './toFlow.js';
import Board from './Board.jsx';
import { YOU } from './bits.jsx';

const LS_KEY = 'redline:board:v3';

export default function App() {
  const sceneRef = useRef(null);
  if (!sceneRef.current) sceneRef.current = restore();
  const scene = sceneRef.current;

  const [revision, bump] = useReducer(n => n + 1, 0);
  const [tocOpen, setTocOpen] = useState(true);
  // A token rather than an id: clicking the same line twice should still take
  // you back to it, and selecting on the canvas must not pan the canvas.
  const [focus, setFocus] = useState({ id: null, n: 0 });
  const [selected, setSelected] = useState(null);
  const [mode, setMode] = useState('draft');
  const [highlighted, setHighlighted] = useState([]);
  const [toast, setToast] = useState(null);
  const [replaying, setReplaying] = useState(false);
  const [peers, setPeers] = useState([]);
  const netRef = useRef(null);
  const me = useMemo(whoAmI, []);

  const changed = useCallback(() => {
    save(scene);
    netRef.current?.publish();
    bump();
  }, [scene]);

  const say = useCallback(message => setToast({ message, at: Date.now() }), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4400);
    return () => clearTimeout(timer);
  }, [toast]);

  // --- tool surface ------------------------------------------------------
  // Registration waits for a host, otherwise the first setMode runs against
  // nothing and the tools exist only inside this page.
  const [host, setHost] = useState(null);
  useEffect(() => { ensureHost().then(setHost); }, []);

  useEffect(() => {
    if (!host) return;
    mcp.attach({ scene, notify: changed });
    mcp.setMode('draft');
    bump();
  }, [host, scene, changed]);

  useEffect(() => {
    window.redline = {
      call: mcp.callTool,
      board: () => scene.toJSON(),
      check: () => analyze(scene),
      tools: mcp.registeredToolNames,
      mode: next => { mcp.setMode(next); setMode(next); },
      replay: () => setReplaying(true),
      reset: () => { wipe(scene, sceneRef); changed(); },
    };
  }, [scene, changed]);

  // --- sharing -----------------------------------------------------------
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const room = params.get('room');
    if (!room && !params.has('share')) return;
    netRef.current = share({
      room: room || 'local',
      relay: params.get('relay'),
      scene,
      identity: me,
      onRemote: (ids, message) => {
        bump();
        save(scene);
        say(`${message.name || 'someone'} changed ${ids.length} thing(s) on the board.`);
      },
      onPeers: setPeers,
    });
    return () => { netRef.current?.close(); netRef.current = null; };
  }, [scene, me, say]);

  // --- the recorded session ----------------------------------------------
  useEffect(() => {
    if (!replaying) return;
    let cancelled = false;
    wipe(scene, sceneRef);
    mcp.attach({ scene: sceneRef.current, notify: changed });
    mcp.setMode('draft');
    setMode('draft');
    setSelected(null);
    bump();

    runRecorded({
      scene: sceneRef.current,
      call: mcp.callTool,
      you: YOU,
      setMode: next => { mcp.setMode(next); setMode(next); },
      onStep: ({ step, focus }) => {
        if (cancelled) return;
        if (step.say) say(step.say);
        if (focus) setSelected(focus);
        changed();
      },
      pause: ms => new Promise(done => setTimeout(done, cancelled ? 0 : ms)),
    })
      .then(() => {
        if (cancelled) return;
        say(`One comment on one node. In a chat it took ${stepCount} turns and most of a day.`);
      })
      .catch(err => { if (!cancelled) say(`the recorded session stopped: ${err.message}`); })
      .finally(() => { if (!cancelled) setReplaying(false); });

    return () => { cancelled = true; };
  }, [replaying]);   // eslint-disable-line react-hooks/exhaustive-deps

  // --- derived -----------------------------------------------------------
  const report = useMemo(() => analyze(scene), [scene, revision]);
  const graph = useMemo(() => toFlow(scene, report), [scene, report, revision]);
  const hasPlan = graph.nodes.length > 0;

  const dimmed = useMemo(() => {
    if (!highlighted.length) return graph;
    const hot = new Set(highlighted);
    return {
      edges: graph.edges,
      nodes: graph.nodes.map(n => ({
        ...n,
        style: hot.has(n.id) ? undefined : { opacity: 0.28 },
      })),
    };
  }, [graph, highlighted]);

  // --- what a human can do ------------------------------------------------
  const act = useMemo(() => ({
    /** Says why it is wrong and drops it, in one gesture. */
    disagree(id, because) {
      if (!because.trim()) return;
      scene.addComment({ anchor: id, body: because, author: YOU });
      this.setStatus(id, 'rejected', because);
    },
    comment(anchor, body) {
      scene.addComment({ anchor, body, author: YOU });
      say(mode === 'review'
        ? 'Attached. The agent sees it in list_open_items.'
        : 'Attached to this step. It survives every redraw.');
      changed();
    },
    reply(id, body) {
      scene.reply(id, { body, author: YOU });
      changed();
    },
    resolve(id) {
      scene.resolveComment(id, { author: YOU });
      changed();
    },
    setStatus(id, status, reason) {
      let because = reason || '';
      // A rejection with no reason is just a red box, so the reason is
      // required. The cards ask for it inline; the panel falls back to prompt.
      if (status === 'rejected' && !because.trim()) {
        because = prompt(
          'Why is this wrong? The agent reads this, and everything downstream is marked stale.') || '';
        if (!because.trim()) return;
      }
      scene.setStatus(id, status, { author: YOU, because });
      if (status === 'rejected') {
        const after = analyze(scene);
        say(after.stale.length
          ? `Dropped. ${after.stale.length} step(s) downstream are now stale.`
          : 'Dropped. Nothing downstream depended on it.');
      }
      changed();
    },
    rule(id, state) {
      scene.setStickyState(id, state, { author: YOU });
      if (state === 'denied') {
        const after = analyze(scene);
        say(after.stale.length
          ? `Noted. ${after.stale.length} step(s) rested on that and are now stale.`
          : 'Noted.');
      }
      changed();
    },
  }), [scene, changed, say, mode]);

  const pickMode = next => {
    mcp.setMode(next);
    setMode(next);
    say(mcp.MODES[next].hint);
    bump();
  };

  const select = useCallback(id => {
    setSelected(id);
    setHighlighted([]);
  }, []);

  const agentPresent = host === 'native' || host === 'polyfill';
  const others = peers.filter(p => p.id !== me.id);

  return (
    <div className="app">
      <header className="bar">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <strong>Redline</strong>
          <span className="tag">
            {hasPlan
              ? `${report.counts.nodes} steps · ${report.paths.count} route${report.paths.count === 1 ? '' : 's'} · ${report.counts.open_comments} open`
              : 'no plan on the board yet'}
          </span>
        </div>

        <div className="modes" role="radiogroup" aria-label="Board mode">
          {Object.entries(mcp.MODES).map(([key, info]) => (
            <button
              key={key}
              className="mode"
              role="radio"
              aria-checked={mode === key}
              onClick={() => pickMode(key)}
            >{info.label}</button>
          ))}
        </div>

        <div className="bar-right">
          <span
            className={`agent-state${agentPresent ? ' live' : ''}`}
            title={agentPresent
              ? `${mcp.hostKind() || 'document.modelContext'} is answering`
                + (host === 'polyfill'
                  ? ', provided by the @mcp-b/global polyfill because this browser has no WebMCP host of its own.'
                  : ', provided by the browser itself.')
              : "No WebMCP host. Open in ChatGPT's browser, or Chrome with WebMCP enabled."}
          >
            <span className="dot" />
            {agentPresent
              ? `${mcp.registeredToolNames().length} tools on WebMCP${host === 'polyfill' ? ' (polyfill)' : ''}`
              : 'no WebMCP host'}
          </span>
          <button className="ghost" disabled={replaying} onClick={() => setReplaying(true)}>
            {replaying ? 'Playing…' : 'Play example'}
          </button>
          <button
            className="ghost"
            onClick={() => {
              if (hasPlan && !confirm('Clear the board? Every comment goes with it.')) return;
              wipe(scene, sceneRef);
              mcp.attach({ scene: sceneRef.current, notify: changed });
              setSelected(null);
              changed();
            }}
          >Clear</button>
        </div>
      </header>

      <main>
        <section className="stage">
          <ReactFlowProvider>
            <Actions.Provider value={act}>
            <Board
              graph={dimmed}
              revision={revision}
              selected={selected}
              focus={focus}
              onSelect={select}
              onBackground={() => { setSelected(null); setHighlighted([]); }}
            />
            </Actions.Provider>
          </ReactFlowProvider>

          {!hasPlan && (
            <div className="empty">
              <h1>Nobody has drawn the plan yet.</h1>
              <p>
                An agent draws what it is about to build, as a flowchart. You read it in ten
                seconds instead of two thousand words, and you argue with the parts that are
                wrong <em>before</em> any code exists.
              </p>
              <p className="empty-cta">
                <button className="primary" onClick={() => setReplaying(true)}>
                  Play a recorded session
                </button>
                <span className="or">or connect an agent and say &ldquo;draw the plan on the board&rdquo;</span>
              </p>
            </div>
          )}

        </section>

        <Contents
          scene={scene}
          report={report}
          selected={selected}
          onSelect={id => { select(id); setFocus({ id, n: focus.n + 1 }); }}
          act={act}
          open={tocOpen}
          onToggle={() => setTocOpen(o => !o)}
        />
      </main>

      <footer className="foot">
        <span>board revision {scene.rev}</span>
        <span>
          {netRef.current
            ? (others.length
              ? `${me.name} + ${others.map(p => p.name).join(', ')}`
              : `${me.name} · alone on this board`)
            : ''}
        </span>
      </footer>

      {toast && <div className="toast">{toast.message}</div>}
    </div>
  );
}

// --- persistence ----------------------------------------------------------

function restore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const doc = raw ? JSON.parse(raw) : null;
    if (doc?.elements?.length) return createScene(doc);
  } catch { /* corrupt state must never wedge the page */ }
  return createScene();
}

function save(scene) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(scene.toJSON())); }
  catch { /* private mode: the board works, it just will not survive a reload */ }
}

function wipe(scene, ref) {
  ref.current = createScene();
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}

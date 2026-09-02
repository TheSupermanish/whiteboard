// ---------------------------------------------------------------------------
// Scene: the plan graph that a human and an agent both write into.
//
// Pure data plus invariants. No DOM, no storage, no layout, so every graph
// check can be tested headless. Coordinates are deliberately absent: the agent
// emits structure and the page decides geometry (see layout.js).
// ---------------------------------------------------------------------------

export const NODE_KINDS = new Set([
  'entry',      // where control enters
  'process',    // does something
  'decision',   // branches
  'store',      // holds state
  'io',         // talks to the outside
  'external',   // someone else's system
  'terminal',   // where control leaves
  'option',     // a candidate the agent considered
]);

export const NODE_STATUS = new Set(['proposed', 'agreed', 'rejected']);
export const STICKY_KINDS = new Set(['note', 'assumption', 'risk', 'question']);
export const STICKY_STATE = new Set(['unverified', 'confirmed', 'denied']);
export const EDGE_KINDS = new Set([
  'flow',     // control or data moves along this
  'derives',  // the target exists *because* of the source
  'option',   // the target is a candidate for the source decision
]);

const ANCHORABLE = new Set(['node', 'edge', 'sticky']);

function must(cond, msg) { if (!cond) throw new Error(msg); }
function oneOf(set, value, field) {
  must(set.has(value), `${field} must be one of: ${[...set].sort().join(', ')} (got "${value}")`);
}
function text(v, field, { required = true, max = 2000 } = {}) {
  const s = String(v ?? '').trim();
  must(!required || s.length > 0, `${field} is required`);
  must(s.length <= max, `${field} must be at most ${max} characters`);
  return s;
}

export function createScene(initial) {
  const el = new Map();          // id -> element
  const seq = { n: 0, e: 0, s: 0, c: 0 };
  let rev = 0;
  const removed = new Set();     // ids deleted here or elsewhere, so they stay deleted
  const log = [];                // append-only, so "what changed since rev N" is cheap

  const now = () => new Date().toISOString();

  function id(prefix) { return `${prefix}${++seq[prefix]}`; }

  function record(action, element, extra) {
    rev++;
    log.push({ rev, action, id: element.id, type: element.type, at: now(), ...extra });
    return rev;
  }

  function touch(e, author) {
    e.ver = (e.ver || 0) + 1;
    e.updated_at = now();
    if (author) e.updated_by = author;
  }

  function get(elementId) {
    const e = el.get(elementId);
    must(e, `no element "${elementId}" on this board`);
    return e;
  }

  function requireAnchor(anchor) {
    const target = get(anchor);
    must(ANCHORABLE.has(target.type),
      `cannot anchor to a ${target.type}; anchor to a node, edge, or sticky`);
    return target;
  }

  // --- writes ------------------------------------------------------------

  function addNode({ label, kind = 'process', detail = '', confidence = null,
                     status = 'proposed', author = 'agent' }) {
    oneOf(NODE_KINDS, kind, 'kind');
    oneOf(NODE_STATUS, status, 'status');
    const e = {
      id: id('n'), type: 'node',
      label: text(label, 'label', { max: 120 }),
      detail: text(detail, 'detail', { required: false }),
      kind, status, author,
      confidence: confidence == null ? null : clamp01(confidence),
      ver: 1, created_at: now(), updated_at: now(),
    };
    el.set(e.id, e);
    record('add_node', e, { label: e.label });
    return e;
  }

  function addEdge({ from, to, label = '', kind = 'flow', author = 'agent' }) {
    oneOf(EDGE_KINDS, kind, 'kind');
    const a = get(from), b = get(to);
    must(a.type === 'node' && b.type === 'node', 'edges connect nodes to nodes');
    must(from !== to, 'an edge cannot connect a node to itself');
    for (const other of el.values()) {
      if (other.type === 'edge' && other.from === from && other.to === to && other.kind === kind) {
        throw new Error(`a ${kind} edge from ${from} to ${to} already exists (${other.id})`);
      }
    }
    const e = {
      id: id('e'), type: 'edge', from, to, kind, author,
      label: text(label, 'label', { required: false, max: 80 }),
      ver: 1, created_at: now(), updated_at: now(),
    };
    el.set(e.id, e);
    record('add_edge', e, { from, to, kind });
    return e;
  }

  function addSticky({ label, kind = 'note', anchor = null, state = 'unverified',
                       author = 'agent' }) {
    oneOf(STICKY_KINDS, kind, 'kind');
    oneOf(STICKY_STATE, state, 'state');
    if (anchor) requireAnchor(anchor);
    const e = {
      id: id('s'), type: 'sticky', kind, anchor, author,
      label: text(label, 'label', { max: 400 }),
      // Only assumptions and questions carry a verification state; a plain note
      // is never "unverified", it is just a note.
      state: (kind === 'assumption' || kind === 'question') ? state : null,
      ver: 1, created_at: now(), updated_at: now(),
    };
    el.set(e.id, e);
    record('add_sticky', e, { kind: e.kind, anchor });
    return e;
  }

  function addComment({ anchor, body, author = 'human' }) {
    must(anchor, 'a comment must be anchored to something; unanchored chat is not allowed');
    requireAnchor(anchor);
    const e = {
      id: id('c'), type: 'comment', anchor, author,
      body: text(body, 'body'),
      resolved: false, replies: [],
      ver: 1, created_at: now(), updated_at: now(),
    };
    el.set(e.id, e);
    record('add_comment', e, { anchor, author });
    return e;
  }

  function reply(commentId, { body, author = 'agent' }) {
    const c = get(commentId);
    must(c.type === 'comment', `${commentId} is a ${c.type}, not a comment`);
    c.replies.push({ author, body: text(body, 'body'), at: now() });
    touch(c, author);
    record('reply', c, { author });
    return c;
  }

  function resolveComment(commentId, { author = 'agent', because = '' } = {}) {
    const c = get(commentId);
    must(c.type === 'comment', `${commentId} is a ${c.type}, not a comment`);
    must(!c.resolved, `comment ${commentId} is already resolved`);
    c.resolved = true;
    c.resolved_by = author;
    c.resolved_because = text(because, 'because', { required: false });
    touch(c, author);
    record('resolve_comment', c, {});
    return c;
  }

  function reopenComment(commentId, { author = 'human', because = '' } = {}) {
    const c = get(commentId);
    must(c.type === 'comment', `${commentId} is a ${c.type}, not a comment`);
    c.resolved = false;
    c.resolved_by = null;
    c.reopened_because = text(because, 'because', { required: false });
    touch(c, author);
    record('reopen_comment', c, {});
    return c;
  }

  function setStatus(nodeId, status, { author = 'human', because = '' } = {}) {
    oneOf(NODE_STATUS, status, 'status');
    const n = get(nodeId);
    must(n.type === 'node', `${nodeId} is a ${n.type}, not a node`);
    n.status = status;
    if (status === 'rejected') n.rejected_because = text(because, 'because', { required: false });
    touch(n, author);
    record('set_status', n, { status });
    return n;
  }

  function setStickyState(stickyId, state, { author = 'human' } = {}) {
    oneOf(STICKY_STATE, state, 'state');
    const s = get(stickyId);
    must(s.type === 'sticky', `${stickyId} is a ${s.type}, not a sticky`);
    must(s.state !== null,
      `sticky ${stickyId} is a ${s.kind}; only assumptions and questions can be confirmed or denied`);
    s.state = state;
    touch(s, author);
    record('set_sticky_state', s, { state });
    return s;
  }

  function relabel(elementId, { label, detail, author = 'agent' }) {
    const e = get(elementId);
    if (label !== undefined) {
      const max = e.type === 'node' ? 120 : e.type === 'edge' ? 80 : 400;
      e.label = text(label, 'label', { max });
    }
    if (detail !== undefined && e.type === 'node') {
      e.detail = text(detail, 'detail', { required: false });
    }
    touch(e, author);
    record('relabel', e, { label: e.label });
    return e;
  }

  function setConfidence(nodeId, confidence, { author = 'agent' } = {}) {
    const n = get(nodeId);
    must(n.type === 'node', `${nodeId} is a ${n.type}, not a node`);
    n.confidence = confidence == null ? null : clamp01(confidence);
    touch(n, author);
    record('set_confidence', n, { confidence: n.confidence });
    return n;
  }

  /**
   * Removes an element and everything that only made sense because of it:
   * edges touching a removed node, comments and stickies anchored to a removed
   * element. Returns the full list so the caller can report the blast radius,
   * because deleting a node someone commented on is the unforgivable action.
   */
  function remove(elementId, { author = 'agent' } = {}) {
    const target = get(elementId);
    const doomed = new Set([elementId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of el.values()) {
        if (doomed.has(e.id)) continue;
        const hits = (e.type === 'edge' && (doomed.has(e.from) || doomed.has(e.to)))
          || (e.anchor && doomed.has(e.anchor));
        if (hits) { doomed.add(e.id); grew = true; }
      }
    }
    const gone = [...doomed].map(x => el.get(x)).filter(Boolean)
      .map(e => ({ id: e.id, type: e.type, label: e.label || e.body || '' }));
    for (const x of doomed) { el.delete(x); removed.add(x); }
    record('remove', target, { removed: gone.map(r => r.id), by: author });
    return gone;
  }

  // --- reads -------------------------------------------------------------

  const byType = t => [...el.values()].filter(e => e.type === t);

  function toJSON() {
    return { rev, seq: { ...seq }, elements: [...el.values()], removed: [...removed] };
  }

  /**
   * Merges another participant's state in, element by element.
   *
   * Every element carries a `ver` that only ever goes up, so last write wins
   * per element rather than per board: two people editing different nodes never
   * clobber each other, and only a genuine conflict on the same node resolves
   * arbitrarily. No CRDT needed for a graph this small.
   *
   * Deletions travel as a list of ids rather than tombstoned elements, and a
   * deletion always beats an edit, because the alternative is an element that
   * keeps coming back.
   */
  function merge(doc) {
    const changed = [];
    for (const id of doc.removed || []) {
      removed.add(id);
      if (el.delete(id)) changed.push(id);
    }
    for (const incoming of doc.elements || []) {
      if (removed.has(incoming.id)) continue;
      const mine = el.get(incoming.id);
      if (mine && (mine.ver || 0) >= (incoming.ver || 0)) continue;
      el.set(incoming.id, incoming);
      changed.push(incoming.id);
    }
    // Keep the id counters ahead of anything we have just been told about, so
    // the next local write cannot reuse a remote id.
    const remoteSeq = deriveSeq(doc.elements || []);
    for (const k of Object.keys(seq)) seq[k] = Math.max(seq[k], remoteSeq[k] || 0);
    if (changed.length) rev = Math.max(rev, doc.rev || 0) + 1;
    return changed;
  }

  function since(atRev) {
    return log.filter(entry => entry.rev > atRev);
  }

  const api = {
    addNode, addEdge, addSticky, addComment, reply, resolveComment, reopenComment,
    setStatus, setStickyState, relabel, setConfidence, remove,
    get: elementId => ({ ...get(elementId) }),
    has: elementId => el.has(elementId),
    all: () => [...el.values()],
    nodes: () => byType('node'),
    edges: () => byType('edge'),
    stickies: () => byType('sticky'),
    comments: () => byType('comment'),
    get rev() { return rev; },
    toJSON, since, merge,
  };

  if (initial) load(initial);

  function load(doc) {
    el.clear();
    for (const id of doc.removed || []) removed.add(id);
    for (const e of doc.elements || []) el.set(e.id, e);
    Object.assign(seq, doc.seq || deriveSeq(doc.elements || []));
    rev = doc.rev || 0;
  }

  return api;
}

function deriveSeq(elements) {
  const s = { n: 0, e: 0, s: 0, c: 0 };
  for (const e of elements) {
    const p = e.id[0], num = Number(e.id.slice(1));
    if (p in s && Number.isFinite(num)) s[p] = Math.max(s[p], num);
  }
  return s;
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error('confidence must be a number between 0 and 1');
  return Math.min(1, Math.max(0, n));
}

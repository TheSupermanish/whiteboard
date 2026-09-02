// ---------------------------------------------------------------------------
// Graph analysis: the work the page does that a model cannot do from pixels.
//
// The division of labour is deliberate. This file finds *structural* facts
// ("this decision node has one outbound edge"). It never guesses meaning. The
// model reads these facts and supplies the semantics ("that missing edge is the
// payment-declined path"). Keeping the two apart is what stops the analysis
// from being another confident narrative.
// ---------------------------------------------------------------------------

const CONTROL = new Set(['flow', 'option']);   // edges along which control moves
const MAX_PATHS = 200;

export function analyze(scene) {
  const nodes = scene.nodes();
  const edges = scene.edges();
  const stickies = scene.stickies();
  const comments = scene.comments();

  const byId = new Map(nodes.map(n => [n.id, n]));
  const live = edges.filter(e => byId.has(e.from) && byId.has(e.to));

  const g = adjacency(live, CONTROL);
  const derives = adjacency(live, new Set(['derives']));

  const findings = [];
  const add = (check, severity, ids, message, why) =>
    findings.push({ check, severity, ids, message, why });

  // --- 1. edges pointing at elements that are not there -----------------
  for (const e of edges) {
    const missing = [!byId.has(e.from) && e.from, !byId.has(e.to) && e.to].filter(Boolean);
    if (missing.length) {
      add('unbound_edge', 'error', [e.id],
        `edge ${e.id} references ${missing.join(' and ')}, which is not on the board`,
        'Someone meant to connect something. Either the target was deleted or the edge was drawn before it existed.');
    }
  }

  // --- 2. entry points and reachability ---------------------------------
  const declaredEntries = nodes.filter(n => n.kind === 'entry').map(n => n.id);
  const noInbound = nodes.filter(n => !g.in.get(n.id)?.length).map(n => n.id);
  const entries = declaredEntries.length ? declaredEntries : noInbound;

  if (!entries.length && nodes.length) {
    add('no_entry', 'error', [],
      'nothing on this board is an entry point',
      'Every node has something pointing at it, so control has nowhere to start. Usually a cycle with no way in.');
  }

  const reachable = bfs(entries, g.out);
  for (const n of nodes) {
    if (reachable.has(n.id) || entries.includes(n.id) || n.status === 'rejected') continue;
    add('unreachable', 'error', [n.id],
      `"${n.label}" cannot be reached from any entry point`,
      'Either it is dead work, or the edge that should reach it was never drawn. Both are worth knowing before writing code.');
  }

  if (declaredEntries.length && noInbound.length) {
    const undeclared = noInbound.filter(x => !declaredEntries.includes(x));
    if (undeclared.length) {
      add('undeclared_entry', 'info', undeclared,
        `${undeclared.length} node(s) have no inbound edge but are not marked as entry points`,
        'If control really does start there, mark it as an entry so reachability means something.');
    }
  }

  // --- 3. dead ends: where the flow stops without saying so -------------
  for (const n of nodes) {
    if (n.kind === 'terminal' || n.kind === 'option' || n.status === 'rejected') continue;
    if (g.out.get(n.id)?.length) continue;
    add('dead_end', 'warn', [n.id],
      `"${n.label}" has no outbound edge and is not marked terminal`,
      'This is where missing error paths hide. What happens after this step succeeds? What happens if it fails?');
  }

  // --- 4. decisions with only a happy path ------------------------------
  for (const n of nodes) {
    if (n.kind !== 'decision' || n.status === 'rejected') continue;
    const outs = (g.out.get(n.id) || []);
    if (outs.length >= 2) continue;
    add('unhandled_branch', 'error', [n.id],
      `decision "${n.label}" has ${outs.length} outbound branch(es)`,
      'A decision with one branch is not a decision. The branch nobody drew is the edge case nobody handled.');
  }

  // --- 5. cycles --------------------------------------------------------
  for (const cyc of findCycles(nodes.map(n => n.id), g.out)) {
    add('cycle', 'warn', cyc,
      `control loops: ${cyc.map(x => byId.get(x)?.label ?? x).join(' → ')} → ${byId.get(cyc[0])?.label ?? cyc[0]}`,
      'Fine if it is a retry or a poll loop. Not fine if it is accidental. Say which, and say what breaks the loop.');
  }
  for (const cyc of findCycles(nodes.map(n => n.id), derives.out)) {
    add('circular_reasoning', 'error', cyc,
      `each of these is justified by the next: ${cyc.map(x => byId.get(x)?.label ?? x).join(' → ')}`,
      'The reasoning has no ground. Nothing in this loop rests on a premise that was independently agreed.');
  }

  // --- 6. every route through the plan ----------------------------------
  const terminals = new Set(nodes.filter(n =>
    n.kind === 'terminal' || !(g.out.get(n.id)?.length)).map(n => n.id));
  // Routes describe what the plan does, so they do not run through steps that
  // were dropped. Reachability still counts them, because dropping a node
  // should not spray "unreachable" over everything behind it.
  const dropped = new Set(nodes.filter(n => n.status === 'rejected').map(n => n.id));
  const paths = enumeratePaths(
    entries.filter(x => !dropped.has(x)), g.out, terminals, MAX_PATHS, dropped);
  const onSomePath = new Set(paths.flat());
  const pathInfo = {
    count: paths.length,
    truncated: paths.length >= MAX_PATHS,
    longest: paths.reduce((m, p) => Math.max(m, p.length), 0),
    paths: paths.map(p => p.map(x => ({ id: x, label: byId.get(x)?.label ?? x }))),
  };
  if (paths.length > 3) {
    add('paths', 'info', [],
      `${pathInfo.truncated ? MAX_PATHS + '+' : paths.length} distinct routes run through this plan`,
      'Each route is a case someone has to handle. Walk them before agreeing the diagram.');
  }
  for (const n of nodes) {
    if (n.status === 'rejected' || n.kind === 'option') continue;
    if (onSomePath.has(n.id) || !reachable.has(n.id)) continue;
    add('off_path', 'info', [n.id],
      `"${n.label}" is reachable but sits on no complete route`,
      'Control can get in but never gets out through it. Often an unfinished branch.');
  }

  // --- 7. the agent's own reasoning, held to account --------------------
  for (const s of stickies) {
    if (!s.anchor) {
      add('orphan_sticky', 'warn', [s.id],
        `${s.kind} "${truncate(s.label)}" is attached to nothing`,
        'A note about everything is a note about nothing. Anchor it to the node it constrains.');
    }
    if (s.state === 'unverified') {
      add('unverified_assumption', 'warn', [s.id],
        `${s.kind} nobody has ruled on: "${truncate(s.label)}"`,
        'The plan below this rests on it. Confirm or deny it before the code gets written.');
    }
  }

  // --- 8. comments the agent walked past --------------------------------
  for (const c of comments) {
    if (c.resolved) continue;
    const answered = c.replies.some(r => r.author !== c.author);
    if (!answered) {
      add('unanswered_comment', 'error', [c.id, c.anchor],
        `${c.author} said "${truncate(c.body)}" and got no reply`,
        'This is the check that matters most. An unanswered objection means the plan moved on without the objection being addressed.');
    }
  }

  // --- 9. what a rejection invalidated downstream -----------------------
  const invalidated = [];
  for (const n of nodes) if (n.status === 'rejected') invalidated.push(n.id);
  for (const s of stickies) {
    if (s.state === 'denied' && s.anchor && byId.has(s.anchor)) invalidated.push(s.anchor);
  }
  // Staleness stops at a node somebody has explicitly agreed. Agreeing a step
  // after a rejection is the act of re-grounding it on a premise that survived,
  // so it is neither stale itself nor a route for staleness to travel along.
  // Without this, one rejection leaves the rest of the board permanently amber
  // no matter how carefully it was redrawn.
  const settled = new Set(nodes.filter(n => n.status === 'agreed').map(n => n.id));
  const cascade = adjacency(live, new Set(['flow', 'option', 'derives']));
  const blocked = new Map();
  for (const [from, tos] of cascade.out) {
    if (settled.has(from)) continue;                     // do not travel through settled work
    blocked.set(from, tos);
  }
  const stale = bfs(invalidated, blocked);
  for (const x of invalidated) stale.delete(x);           // the rejection itself is not stale
  const staleList = [...stale].filter(x => {
    const n = byId.get(x);
    return n && n.status !== 'rejected' && n.status !== 'agreed';
  });
  for (const x of staleList) {
    add('stale', 'warn', [x],
      `"${byId.get(x).label}" is downstream of something that was rejected or denied`,
      'It was drawn on a premise that no longer holds. Redraw it or justify it again.');
  }

  const bySeverity = { error: 0, warn: 0, info: 0 };
  for (const f of findings) bySeverity[f.severity]++;

  return {
    rev: scene.rev,
    counts: {
      nodes: nodes.length, edges: live.length,
      stickies: stickies.length, comments: comments.length,
      open_comments: comments.filter(c => !c.resolved).length,
    },
    entries, terminals: [...terminals],
    paths: pathInfo,
    stale: staleList,
    findings: findings.sort((a, b) => rank(a.severity) - rank(b.severity)),
    summary: bySeverity,
    agreed: bySeverity.error === 0 && bySeverity.warn === 0,
  };
}

const rank = s => ({ error: 0, warn: 1, info: 2 })[s] ?? 3;
const truncate = (s, n = 60) => String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s);

function adjacency(edges, kinds) {
  const out = new Map(), inn = new Map();
  for (const e of edges) {
    if (!kinds.has(e.kind)) continue;
    if (!out.has(e.from)) out.set(e.from, []);
    if (!inn.has(e.to)) inn.set(e.to, []);
    out.get(e.from).push(e.to);
    inn.get(e.to).push(e.from);
  }
  return { out, in: inn };
}

function bfs(starts, out) {
  const seen = new Set();
  const queue = [...starts];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of out.get(cur) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/** Distinct simple cycles, deduplicated by their canonical rotation. */
function findCycles(ids, out) {
  const found = new Map();
  const onStack = new Set();
  const stack = [];
  const visited = new Set();

  function walk(node) {
    visited.add(node);
    onStack.add(node);
    stack.push(node);
    for (const next of out.get(node) || []) {
      if (onStack.has(next)) {
        const cyc = stack.slice(stack.indexOf(next));
        found.set(canonical(cyc), cyc);
      } else if (!visited.has(next)) {
        walk(next);
      }
    }
    stack.pop();
    onStack.delete(node);
  }

  for (const nodeId of ids) if (!visited.has(nodeId)) walk(nodeId);
  return [...found.values()];
}

function canonical(cyc) {
  let best = null;
  for (let i = 0; i < cyc.length; i++) {
    const rot = cyc.slice(i).concat(cyc.slice(0, i)).join('>');
    if (best === null || rot < best) best = rot;
  }
  return best;
}

/** Every simple route from an entry to a terminal, capped so a cyclic graph cannot hang the page. */
function enumeratePaths(entries, out, terminals, cap, skip = new Set()) {
  const paths = [];
  const walk = (node, trail) => {
    if (paths.length >= cap) return;
    const next = (out.get(node) || []).filter(n => !skip.has(n));
    if (terminals.has(node) || !next.length) { paths.push(trail); return; }
    // A route also ends when every way onward would revisit a node already on
    // it. Without this the whole trail would be silently dropped and a cyclic
    // plan would report no routes at all.
    let advanced = false;
    for (const n of next) {
      if (trail.includes(n)) continue;
      advanced = true;
      walk(n, [...trail, n]);
      if (paths.length >= cap) return;
    }
    if (!advanced) paths.push(trail);
  };
  for (const e of entries) walk(e, [e]);
  return paths;
}

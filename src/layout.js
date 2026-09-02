// ---------------------------------------------------------------------------
// Layout, by dagre.
//
// This used to be a hand-rolled layered layout: longest-path ranking,
// barycentre crossing reduction, per-layer edge waypoints, the lot. It worked
// on simple graphs and produced a bowl of wires on anything real. Dagre is the
// same algorithm written by people who finished it.
//
// Sizes are measured from the rendered DOM rather than estimated, so a node
// with three assumptions stuck to it reserves the space it actually occupies.
// ---------------------------------------------------------------------------

import dagre from '@dagrejs/dagre';

export const ESTIMATED = { width: 216, height: 92 };

export function layoutGraph(nodes, edges, { direction = 'LR' } = {}) {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: direction,
    ranksep: direction === 'LR' ? 92 : 64,
    nodesep: 34,
    edgesep: 18,
    marginx: 28,
    marginy: 28,
    ranker: 'network-simplex',
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    g.setNode(n.id, {
      width: n.measured?.width || n.width || ESTIMATED.width,
      height: n.measured?.height || n.height || ESTIMATED.height,
    });
  }
  for (const e of edges) {
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    // Derivation edges say "this exists because of that". They are commentary
    // on the plan, not part of its flow, so they must not influence ranking.
    if (e.data?.kind === 'derives') continue;
    g.setEdge(e.source, e.target, { weight: e.data?.kind === 'option' ? 2 : 1 }, e.id);
  }

  // Without this, a step marked as an entry is ranked purely by its distance
  // from whatever it feeds, so "family enters a name" ends up four columns in,
  // next to the middle of the pipeline. A reader expects every way in to be at
  // the left edge and every way out at the right, so two zero-sized anchors are
  // added to force it. dagre core ignores the `rank: 'min'` node attribute, so
  // this is the way to say it.
  const anchors = tether(g, nodes);

  dagre.layout(g);
  for (const id of anchors) g.removeNode(id);

  return nodes.map(n => {
    const laid = g.node(n.id);
    if (!laid) return n;
    // dagre centres nodes; React Flow positions by top-left corner.
    return {
      ...n,
      position: {
        x: laid.x - laid.width / 2,
        y: laid.y - laid.height / 2,
      },
    };
  });
}

const SOURCE = '__entry_anchor';
const SINK = '__exit_anchor';

function tether(g, nodes) {
  const entries = nodes.filter(n => n.data?.element?.kind === 'entry').map(n => n.id);
  const exits = nodes.filter(n => n.data?.element?.kind === 'terminal').map(n => n.id);
  const added = [];

  if (entries.length > 1) {
    g.setNode(SOURCE, { width: 1, height: 1 });
    added.push(SOURCE);
    entries.forEach((id, i) => g.setEdge(SOURCE, id, { weight: 8 }, `anchor-in-${i}`));
  }
  if (exits.length > 1) {
    g.setNode(SINK, { width: 1, height: 1 });
    added.push(SINK);
    exits.forEach((id, i) => g.setEdge(id, SINK, { weight: 8 }, `anchor-out-${i}`));
  }
  return added;
}

/** How much of the viewport the plan covers, given a pan and zoom. 0 to 1. */
export function visibleFraction(bounds, viewport, size) {
  const { x, y, zoom } = viewport;
  if (!bounds.width || !bounds.height || !size.width || !size.height) return 1;
  const left = bounds.x * zoom + x;
  const top = bounds.y * zoom + y;
  const across = Math.max(0, Math.min(left + bounds.width * zoom, size.width) - Math.max(left, 0));
  const down = Math.max(0, Math.min(top + bounds.height * zoom, size.height) - Math.max(top, 0));
  return (across * down) / (size.width * size.height);
}

/**
 * Whether the board should take the view back. Resizing the canvas, by
 * collapsing the contents or by resizing the window, leaves a viewport chosen
 * for a different size, and the plan can end up entirely outside it. An empty
 * dotted background reads as a broken page rather than as a board somebody
 * panned away from. The threshold is deliberately low: a deliberate pan that
 * still shows part of the plan is left alone.
 */
export const LOST = 0.06;
export const isLost = (bounds, viewport, size) => visibleFraction(bounds, viewport, size) < LOST;

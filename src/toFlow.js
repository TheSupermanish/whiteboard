// ---------------------------------------------------------------------------
// Scene to React Flow.
//
// Stickies are rendered inside the card of the node they are attached to
// rather than as separate items floating beside it. Beside it, they collided
// with edges and with each other and needed their own layout pass; inside it,
// an assumption is visibly part of the step it constrains, which is what it
// actually is. Only unanchored notes become nodes of their own, and the board
// flags those as orphans anyway.
// ---------------------------------------------------------------------------

import { MarkerType } from '@xyflow/react';

const EDGE_COLOUR = {
  flow: '#98a4b3',
  option: '#c3ccd7',
  derives: '#6438bf',
};

export function toFlow(scene, report) {
  const stale = new Set(report.stale);
  const findingsFor = new Map();
  for (const f of report.findings) {
    for (const id of f.ids) {
      if (!findingsFor.has(id)) findingsFor.set(id, []);
      findingsFor.get(id).push(f);
    }
  }

  const notesFor = new Map();
  const floating = [];
  for (const s of scene.stickies()) {
    if (!s.anchor || !scene.has(s.anchor)) { floating.push(s); continue; }
    if (!notesFor.has(s.anchor)) notesFor.set(s.anchor, []);
    notesFor.get(s.anchor).push(s);
  }

  const commentsFor = new Map();
  for (const c of scene.comments()) {
    if (!commentsFor.has(c.anchor)) commentsFor.set(c.anchor, []);
    commentsFor.get(c.anchor).push(c);
  }

  const nodes = scene.nodes().map(n => ({
    id: n.id,
    type: 'step',
    position: { x: 0, y: 0 },
    data: {
      element: n,
      notes: notesFor.get(n.id) || [],
      comments: commentsFor.get(n.id) || [],
      stale: stale.has(n.id),
      findings: findingsFor.get(n.id) || [],
    },
  }));

  for (const s of floating) {
    nodes.push({
      id: s.id,
      type: 'sticky',
      position: { x: 0, y: 0 },
      data: { element: s, comments: commentsFor.get(s.id) || [] },
    });
  }

  const edges = scene.edges()
    .filter(e => scene.has(e.from) && scene.has(e.to))
    .map(e => {
      const dropped = scene.get(e.from).status === 'rejected'
        || scene.get(e.to).status === 'rejected';
      const colour = EDGE_COLOUR[e.kind] || EDGE_COLOUR.flow;
      return {
        id: e.id,
        source: e.from,
        target: e.to,
        label: e.label || undefined,
        type: e.kind === 'derives' ? 'default' : 'smoothstep',
        pathOptions: e.kind === 'derives' ? undefined : { borderRadius: 14 },
        data: { kind: e.kind },
        markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15, color: colour },
        style: {
          stroke: colour,
          strokeWidth: 1.6,
          strokeDasharray: e.kind === 'derives' ? '2 4' : e.kind === 'option' ? '5 4' : undefined,
          opacity: dropped ? 0.4 : 1,
        },
        labelBgPadding: [5, 2],
        labelBgBorderRadius: 4,
        labelBgStyle: { fill: '#fbfcfd', fillOpacity: 0.95 },
        labelStyle: { fill: '#66727f', fontSize: 10.5, fontWeight: 500 },
      };
    });

  return { nodes, edges };
}

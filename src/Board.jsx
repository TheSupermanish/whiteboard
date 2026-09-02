// ---------------------------------------------------------------------------
// The canvas.
//
// Pan, zoom, minimap, node dragging and edge routing all come from React Flow.
// The only thing left to arrange is ranking, which dagre does, and it is run
// after the nodes have been measured so a card with three assumptions on it
// reserves the space it really needs.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap,
  useNodesState, useEdgesState, useReactFlow, useNodesInitialized,
} from '@xyflow/react';

import { nodeTypes } from './nodes.jsx';
import { layoutGraph } from './layout.js';

const MINIMAP_COLOUR = {
  rejected: '#e6bcbc',
  agreed: '#a9d8c6',
  stale: '#eccb9a',
  plain: '#d3dae2',
};

const FLOOR = 0.75;      // below this, labels stop being readable
const CEILING = 1;
const FRAME_PAD = 28;

export default function Board({ graph, revision, selected, onSelect, onBackground }) {
  const shell = useRef(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges] = useEdgesState([]);
  const initialized = useNodesInitialized();
  const { setViewport, getNodesBounds } = useReactFlow();

  // Positions the person dragged themselves. Re-running the layout must not
  // shove a node back after somebody deliberately moved it.
  const moved = useRef(new Map());
  const pending = useRef(false);
  const lastRevision = useRef(-1);

  // Rebuild from the scene, keeping any position already worked out so the
  // board does not flash back to the origin on every edit.
  useEffect(() => {
    setNodes(prev => {
      const known = new Map(prev.map(n => [n.id, n]));
      return graph.nodes.map(n => {
        const before = known.get(n.id);
        return {
          ...n,
          position: moved.current.get(n.id) || before?.position || n.position,
          selected: n.id === selected,
          measured: before?.measured,
        };
      });
    });
    setEdges(graph.edges);
    if (lastRevision.current !== revision) {
      pending.current = true;
      lastRevision.current = revision;
    }
  }, [graph, revision, selected, setNodes, setEdges]);

  /**
   * Frames the plan.
   *
   * fitView on its own is not enough. It will happily zoom to 40% to get a wide
   * plan on screen, which is not framing, it is just small. So the zoom has a
   * floor, and when the plan is too wide to fit at that floor the view is
   * aligned to its top left instead of centred: centring something that
   * overflows means it is cut off at BOTH edges, and the first thing a reader
   * sees is half a box.
   */
  const frame = useCallback(laidOut => {
    const el = shell.current;
    if (!el || !laidOut.length) return;
    const bounds = getNodesBounds(laidOut);
    const vw = el.clientWidth, vh = el.clientHeight - 30;   // the legend sits over the bottom
    if (vw <= 0 || vh <= 0 || !bounds.width || !bounds.height) return;

    const zoom = Math.min(
      CEILING,
      Math.max(FLOOR, Math.min((vw - FRAME_PAD * 2) / bounds.width, (vh - FRAME_PAD * 2) / bounds.height)),
    );
    const w = bounds.width * zoom, h = bounds.height * zoom;
    const x = w <= vw - FRAME_PAD * 2 ? (vw - w) / 2 : FRAME_PAD;
    const y = h <= vh - FRAME_PAD * 2 ? (vh - h) / 2 : FRAME_PAD;

    setViewport(
      { x: x - bounds.x * zoom, y: y - bounds.y * zoom, zoom },
      { duration: 280 },
    );
  }, [setViewport, getNodesBounds]);

  useEffect(() => {
    if (!initialized || !pending.current || !nodes.length) return;
    pending.current = false;
    const laid = layoutGraph(nodes, edges).map(n =>
      moved.current.has(n.id) ? { ...n, position: moved.current.get(n.id) } : n);
    setNodes(laid);
    requestAnimationFrame(() => frame(laid));      // let the positions land first
  }, [initialized, nodes, edges, setNodes, frame]);

  const handleNodesChange = useCallback(changes => {
    for (const change of changes) {
      if (change.type === 'position' && change.dragging === false && change.position) {
        moved.current.set(change.id, change.position);
      }
    }
    onNodesChange(changes);
  }, [onNodesChange]);

  const relayout = useCallback(() => {
    moved.current.clear();
    pending.current = true;
    setNodes(prev => [...prev]);
  }, [setNodes]);

  useEffect(() => {
    const onKey = ev => {
      if (ev.target.matches?.('input, textarea')) return;
      if (ev.key === 'l' || ev.key === 'L') relayout();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [relayout]);

  return (
    <div className="flow-shell" ref={shell}>
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={handleNodesChange}
      onNodeClick={(_, node) => onSelect(node.id)}
      onPaneClick={onBackground}
      nodesConnectable={false}
      edgesFocusable={false}
      elementsSelectable
      minZoom={0.2}
      maxZoom={2.2}
      proOptions={{ hideAttribution: false }}
      defaultEdgeOptions={{ interactionWidth: 12 }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} color="#dde3ea" />
      <Controls showInteractive={false} position="bottom-right" />
      <MiniMap
        pannable
        zoomable
        position="top-right"
        className="mini"
        maskColor="rgba(240,243,247,.62)"
        nodeStrokeWidth={2}
        nodeBorderRadius={3}
        nodeColor={n => {
          const el = n.data?.element;
          if (el?.status === 'rejected') return MINIMAP_COLOUR.rejected;
          if (n.data?.stale) return MINIMAP_COLOUR.stale;
          if (el?.status === 'agreed') return MINIMAP_COLOUR.agreed;
          return MINIMAP_COLOUR.plain;
        }}
      />
    </ReactFlow>
    </div>
  );
}

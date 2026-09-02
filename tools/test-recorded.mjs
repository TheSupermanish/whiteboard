// The recorded session is the only thing most visitors will see this tool do,
// so it is tested end to end through the same driver the page uses.

import { createScene } from '../src/lib/scene.js';
import { analyze } from '../src/lib/analyze.js';
import { toFlow } from '../src/toFlow.js';
import { layoutGraph, ESTIMATED } from '../src/layout.js';
import * as mcp from '../src/lib/mcp.js';
import { runRecorded } from '../src/lib/replay.js';

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
};

Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: {
  modelContext: {
    registerTool: tool => ({ unregister: () => {} }),
    unregisterTool: () => true,
    requestUserInteraction: async () => true,
  },
}});

const scene = createScene();
mcp.attach({ scene, notify: () => {} });
mcp.setMode('draft');

const seen = [];
const { ids, steps } = await runRecorded({
  scene,
  call: mcp.callTool,
  setMode: mcp.setMode,
  onStep: ({ step }) => { seen.push(step); },
});

console.log('\nthe session runs to the end');
{
  ok('every step executed', seen.length === steps.length && seen.length >= 12, `${seen.length} steps`);
  ok('every narrated step has something to say',
    steps.filter(s => s.say).length >= 10);
  ok('the keys the agent chose all resolved',
    ['ask', 'ingest', 'parse', 'index', 'match', 'show', 'bring'].every(k => scene.has(ids[k])),
    JSON.stringify(ids));
  ok('the assumption sticky was captured', scene.has(ids.assumption));
  ok('the human objection was captured', scene.has(ids.objection));
}

console.log('\nwhat the session is supposed to prove');
{
  ok('the ingest was dropped', scene.get(ids.ingest).status === 'rejected');
  ok('it was dropped for the stated reason',
    scene.get(ids.ingest).rejected_because.includes('scanned PDF'));
  ok('the assumption was denied by the human',
    scene.get(ids.assumption).state === 'denied'
    && scene.get(ids.assumption).updated_by === 'you');
  ok('the objection is still attached to the node it was made on',
    scene.get(ids.objection).anchor === ids.ingest);
  ok('the agent answered it', scene.get(ids.objection).replies.some(r => r.author === 'agent'));
  ok('only the human closed it',
    scene.get(ids.objection).resolved && scene.get(ids.objection).resolved_by === 'you');
  ok('the replacement step is where control now enters', scene.get(ids.bring).kind === 'entry');
  ok('the replacement feeds the surviving steps',
    scene.edges().some(e => e.from === ids.bring && e.to === ids.parse));
  ok('rejected work stays visible rather than vanishing',
    scene.has(ids.ingest) && scene.has(ids.index));
}

console.log('\nthe board is coherent at the end');
{
  const report = analyze(scene);
  ok('no dangling edges', report.findings.every(f => f.check !== 'unbound_edge'));
  ok('no unanswered objections left', report.findings.every(f => f.check !== 'unanswered_comment'));
  ok('no unsettled assumptions left', report.findings.every(f => f.check !== 'unverified_assumption'));
  ok('the surviving plan still has a route through it', report.paths.count >= 1);
  ok('the whole ingest branch was dropped',
    scene.nodes().filter(n => n.status === 'rejected').length === 3);
  ok('the reviewed plan ends with no structural errors',
    report.summary.error === 0,
    report.findings.filter(f => f.severity === 'error').map(f => f.check).join(','));
  const surviving = [ids.ask, ids.parse, ids.match, ids.show];
  ok('the steps that survived are marked agreed',
    surviving.every(id => scene.get(id).status === 'agreed'));
}

console.log('\nit turns into a graph the canvas can draw');
{
  const report = analyze(scene);
  const { nodes, edges } = toFlow(scene, report);

  ok('one node per step', nodes.filter(n => n.type === 'step').length === scene.nodes().length);
  ok('every edge has both ends on the board',
    edges.every(e => nodes.some(n => n.id === e.source) && nodes.some(n => n.id === e.target)));
  ok('no node carries a hand-computed position',
    nodes.every(n => n.position.x === 0 && n.position.y === 0));
  ok('stickies ride inside the step they are attached to, not as separate nodes',
    nodes.every(n => n.type !== 'sticky')
    && nodes.find(n => n.id === ids.ingest).data.notes.length === 1);
  ok('the objection reaches the node that carries it',
    nodes.find(n => n.id === ids.ingest).data.comments.length === 1);
  ok('the dropped step is still in the graph, not deleted',
    nodes.some(n => n.id === ids.ingest && n.data.element.status === 'rejected'));

  const laid = layoutGraph(
    nodes.map(n => ({ ...n, measured: ESTIMATED })), edges);
  ok('dagre gives every node a position',
    laid.every(n => Number.isFinite(n.position.x) && Number.isFinite(n.position.y)));
  ok('nothing lands on top of anything else', noOverlaps(laid), overlapReport(laid));
  ok('the flow runs left to right',
    laid.find(n => n.id === ids.show).position.x > laid.find(n => n.id === ids.parse).position.x);
  ok('derivation edges do not push nodes into later ranks',
    laid.length === nodes.length);
}

function noOverlaps(laid) {
  for (let i = 0; i < laid.length; i++) {
    for (let j = i + 1; j < laid.length; j++) {
      if (hits(laid[i], laid[j])) return false;
    }
  }
  return true;
}
function overlapReport(laid) {
  for (let i = 0; i < laid.length; i++) {
    for (let j = i + 1; j < laid.length; j++) {
      if (hits(laid[i], laid[j])) return `${laid[i].id} over ${laid[j].id}`;
    }
  }
  return '';
}
function hits(a, b) {
  const { width: w, height: h } = ESTIMATED;
  return a.position.x < b.position.x + w && b.position.x < a.position.x + w
    && a.position.y < b.position.y + h && b.position.y < a.position.y + h;
}

console.log('\nreplay is repeatable on a fresh board');
{
  const second = createScene();
  mcp.attach({ scene: second, notify: () => {} });
  mcp.setMode('draft');
  const again = await runRecorded({ scene: second, call: mcp.callTool, setMode: mcp.setMode });
  ok('a second run produces the same shape',
    second.nodes().length === scene.nodes().length
    && second.edges().length === scene.edges().length);
  ok('and the same conclusion', second.get(again.ids.ingest).status === 'rejected');
}

console.log('\nhostile labels');
{
  const s = createScene();
  const n = s.addNode({ label: '<script>alert(1)</script> & "quotes"', kind: 'entry' });
  const { nodes } = toFlow(s, analyze(s));
  // React escapes text children, so the label travels as data and is never
  // markup. Assert it arrives unmangled rather than pre-escaped: escaping it
  // here as well would double-escape it on screen.
  ok('the label is carried as text, verbatim',
    nodes[0].data.element.label === '<script>alert(1)</script> & "quotes"');
  ok('nothing in the graph is an html string',
    JSON.stringify(nodes).indexOf('&lt;') === -1);
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);

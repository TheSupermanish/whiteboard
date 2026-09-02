// Exercises the tool surface against a stub navigator.modelContext, so the
// mode boundary and the confirmation gate are tested rather than assumed.

import { createScene } from '../src/lib/scene.js';
import * as mcp from '../src/lib/mcp.js';

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
};
async function throwsAsync(label, fn, match) {
  try { await fn(); ok(label, false, 'no error thrown'); }
  catch (e) { ok(label, !match || e.message.includes(match), e.message); }
}

// --- stub agent host -----------------------------------------------------
const host = { tools: new Map(), prompts: [], answer: true };
// Node 22 exposes navigator as a getter-only property, so it has to be
// redefined rather than assigned.
Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: {
  modelContext: {
    registerTool(tool) {
      host.tools.set(tool.name, tool);
      return { unregister: () => host.tools.delete(tool.name) };
    },
    unregisterTool(name) { return host.tools.delete(name); },
    async requestUserInteraction({ message }) {
      host.prompts.push(message);
      return host.answer;
    },
  },
}});

const scene = createScene();
let notified = 0;
mcp.attach({ scene, notify: () => notified++ });

console.log('\ntool definitions');
{
  const names = Object.keys(mcp.TOOLS);
  ok('every tool has a name matching its key', names.every(n => mcp.TOOLS[n].name === n));
  ok('every tool has a description', names.every(n => (mcp.TOOLS[n].description || '').length > 40));
  ok('every tool has an object input schema',
    names.every(n => mcp.TOOLS[n].inputSchema?.type === 'object'));
  ok('every required field is declared in properties', names.every(n => {
    const s = mcp.TOOLS[n].inputSchema;
    return (s.required || []).every(r => r in (s.properties || {}));
  }));
  ok('no tool takes coordinates',
    names.every(n => !JSON.stringify(mcp.TOOLS[n].inputSchema).match(/"(x|y|width|height)"/)));
  ok('both modes only list real tools',
    Object.values(mcp.MODES).every(m => m.tools.every(t => t in mcp.TOOLS)));
}

console.log('\nregistration follows the mode');
{
  const drafting = mcp.setMode('draft');
  ok('draft mode registers with the host', host.tools.has('draw_plan'));
  ok('registered set matches the mode', drafting.tools.length === mcp.MODES.draft.tools.length);
  ok('the host sees the same count', host.tools.size === drafting.tools.length);
}

console.log('\ndrawing a plan in one call');
let map;
{
  const r = await mcp.callTool('draw_plan', {
    title: 'Missing person lookup',
    nodes: [
      { key: 'ask', label: 'Family enters a name', kind: 'entry' },
      { key: 'fetch', label: 'Fetch the official PDF', kind: 'io', confidence: 0.4 },
      { key: 'match', label: 'Match the name phonetically' },
      { key: 'found', label: 'Show the matching record', kind: 'terminal' },
    ],
    edges: [
      { from: 'ask', to: 'fetch' },
      { from: 'fetch', to: 'match' },
      { from: 'match', to: 'found' },
    ],
    notes: [
      { anchor: 'fetch', kind: 'assumption', text: 'the PDF has a real text layer' },
    ],
  });
  map = r.drawn.nodes;
  ok('keys map to real ids', scene.has(map.fetch) && map.fetch.startsWith('n'));
  ok('edges were drawn', r.drawn.edges.length === 3);
  ok('the note was anchored to the right node', scene.get(r.drawn.notes[0]).anchor === map.fetch);
  ok('the analysis comes back with the draw', typeof r.check.errors === 'number');
  ok('it flags its own unsettled assumption', r.check.warnings >= 1);
  ok('the page was told to redraw', notified > 0);
}

console.log('\nkeys and ids are both accepted, nonsense is not');
{
  await throwsAsync('an undefined key is refused', () => mcp.callTool('draw_plan', {
    nodes: [{ key: 'a', label: 'A' }],
    edges: [{ from: 'a', to: 'typo_key' }],
  }), 'neither a key defined in this call nor an element already on the board');
  const r = await mcp.callTool('draw_plan', {
    nodes: [{ key: 'later', label: 'A later step', kind: 'terminal' }],
    edges: [{ from: map.found, to: 'later' }],      // real id on the left, new key on the right
  });
  ok('an existing element id works as an edge endpoint', r.drawn.edges.length === 1);
  await mcp.callTool('revise', { disconnect: r.drawn.edges });
  await mcp.callTool('remove_element', { id: r.drawn.nodes.later });
}

console.log('\nthe board never hands out coordinates');
{
  const board = await mcp.callTool('get_board');
  const raw = JSON.stringify(board);
  ok('no x or y in the snapshot', !/"x":|"y":|"width":/.test(raw));
  ok('every node carries an id and a status',
    board.nodes.every(n => n.id && n.status));
  ok('the revision is reported', typeof board.revision === 'number');
}

console.log('\nreview mode is a boundary, not a suggestion');
{
  mcp.setMode('review');
  ok('draw_plan is withdrawn from the host', !host.tools.has('draw_plan'));
  ok('remove_element is withdrawn from the host', !host.tools.has('remove_element'));
  ok('reading is still allowed', host.tools.has('get_board'));
  await throwsAsync('draw_plan is refused, not merely hidden',
    () => mcp.callTool('draw_plan', { nodes: [{ key: 'x', label: 'X' }] }),
    'not available in review mode');
  await throwsAsync('remove_element is refused',
    () => mcp.callTool('remove_element', { id: map.fetch }),
    'not available in review mode');
  const before = scene.nodes().length;
  try { await mcp.callTool('draw_plan', { nodes: [{ key: 'x', label: 'X' }] }); } catch { /* expected */ }
  ok('nothing reached the board through the refused call', scene.nodes().length === before);
  ok('revising is still allowed during review', host.tools.has('revise'));
}

console.log('\nthe review loop');
{
  const objection = scene.addComment({
    anchor: map.fetch, author: 'manish',
    body: 'this does not seem fine, the official list is a scan, there is no text layer',
  });
  let queue = await mcp.callTool('list_open_items');
  ok('the objection appears unanswered', queue.unanswered_objections.some(c => c.id === objection.id));
  ok('the queue says what the objection is about',
    queue.unanswered_objections.find(c => c.id === objection.id).about === 'Fetch the official PDF');
  ok('the unsettled assumption is in the same queue', queue.unsettled_assumptions.length === 1);
  ok('nothing_outstanding is false while an objection is open', queue.nothing_outstanding === false);

  await mcp.callTool('reply_to_comment', { id: objection.id, body: 'You are right. Dropping the ingest.' });
  queue = await mcp.callTool('list_open_items');
  ok('a reply moves it out of the unanswered list',
    !queue.unanswered_objections.some(c => c.id === objection.id));
  ok('but it stays open until the human closes it',
    queue.answered_but_open.some(c => c.id === objection.id));

  const r = await mcp.callTool('revise', {
    because: objection.id,
    reject: [{ id: map.fetch, because: 'the source is a scanned image, not parseable' }],
  });
  ok('the rejection is recorded', r.rejected.includes(map.fetch));
  queue = await mcp.callTool('list_open_items');
  ok('everything downstream is reported stale',
    queue.stale_because_of_a_rejection.some(x => x.id === map.match)
    && queue.stale_because_of_a_rejection.some(x => x.id === map.found));
  ok('the comment survived the revision', scene.has(objection.id));
  ok('its anchor still points at the same node', scene.get(objection.id).anchor === map.fetch);
}

console.log('\nchecks are reported as facts plus consequence');
{
  const r = await mcp.callTool('check_plan', { include_routes: true });
  ok('findings carry a machine-readable check name', r.findings.every(f => f.check));
  ok('findings say what they mean for the reader', r.findings.every(f => f.why_it_matters));
  ok('routes are listed as labels when asked', Array.isArray(r.routes) && r.routes[0].length > 0);
  const plain = await mcp.callTool('check_plan', {});
  ok('routes are omitted unless asked', plain.routes === undefined);
  ok('route count is always given', typeof plain.route_count === 'number');
}

console.log('\ndeletion is gated on the person at the board');
{
  mcp.setMode('draft');
  host.prompts = [];
  host.answer = false;
  const before = scene.nodes().length;
  await throwsAsync('a refused confirmation aborts the delete',
    () => mcp.callTool('remove_element', { id: map.match }), 'declined');
  ok('the human was actually asked', host.prompts.length === 1);
  ok('the prompt names what would be destroyed', host.prompts[0].includes('Match the name phonetically'));
  ok('nothing was deleted', scene.nodes().length === before);

  host.answer = true;
  const commented = scene.addComment({ anchor: map.match, author: 'manish', body: 'keep this bit' });
  host.prompts = [];
  const r = await mcp.callTool('remove_element', { id: map.match });
  ok('the prompt warns that a comment goes too', host.prompts[0].includes('comment'));
  ok('the blast radius is reported back', r.removed.some(x => x.id === commented.id));
  ok('the node is gone', !scene.has(map.match));
  ok('no dangling edges are left', (await mcp.callTool('check_plan')).findings.every(f => f.check !== 'unbound_edge'));
}

console.log('\nreplacing the board needs consent too');
{
  host.prompts = [];
  host.answer = false;
  const before = scene.nodes().length;
  await throwsAsync('a refused replace leaves the board alone',
    () => mcp.callTool('draw_plan', { replace: true, nodes: [{ key: 'a', label: 'Fresh start' }] }),
    'declined');
  ok('the prompt counts what would be lost', /\d+ nodes/.test(host.prompts[0] || ''));
  ok('the old board is intact', scene.nodes().length === before);
  host.answer = true;
}

console.log('\noptions the agent considered and ruled out');
{
  const r = await mcp.callTool('propose_options', {
    question: 'where does the graph live?',
    options: [
      { label: 'In the page only', because: 'no server, no custody' },
      { label: 'In a Durable Object', because: 'needed for two people at once' },
      { label: 'In Postgres', because: 'overkill for a board' },
    ],
  });
  ok('a decision node was drawn', scene.get(r.decision).kind === 'decision');
  ok('one option node per candidate', r.options.length === 3);
  await throwsAsync('a single option is not a choice',
    () => mcp.callTool('propose_options', { question: 'q', options: [{ label: 'only one' }] }),
    'at least two options');

  const chosen = r.options[1].id;
  const d = await mcp.callTool('decide_option', {
    chosen, because: 'two people have to see the same board',
    rejected: [
      { id: r.options[0].id, because: 'cannot share a board that never leaves the tab' },
      { id: r.options[2].id, because: 'a whole database for one JSON document' },
    ],
  });
  ok('the chosen option is agreed', scene.get(chosen).status === 'agreed');
  ok('rejected options stay on the board', scene.has(r.options[0].id) && scene.has(r.options[2].id));
  ok('each rejection keeps its reason',
    scene.get(r.options[2].id).rejected_because.includes('whole database'));
  ok('decide_option reports the resulting stale set', Array.isArray(d.stale));
}

console.log('\nunknown tools');
{
  await throwsAsync('an unregistered name is refused',
    () => mcp.callTool('drop_database', {}), 'is not available');
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);

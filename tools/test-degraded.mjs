// A host that implements the bare minimum: registerTool, on navigator rather
// than document, ignoring the AbortSignal it is handed and offering no way to
// ask a person anything. Both the confirmation gate and the mode boundary have
// to hold there. It runs in its own file, where mcp.js has not already
// registered anything against a more capable stub.

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

const bare = { tools: new Map() };
Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: {
  modelContext: {
    // Resolves like the spec says, then does nothing when the signal aborts.
    registerTool(tool) { bare.tools.set(tool.name, tool); return Promise.resolve(); },
  },
}});

const scene = createScene();
mcp.attach({ scene });
mcp.setMode('draft');
ok('the tools still reach a host with only registerTool', bare.tools.has('remove_element'));

const drawn = await mcp.callTool('draw_plan', {
  nodes: [{ key: 'a', kind: 'entry', label: 'Somebody asks' }],
  edges: [],
});
const id = drawn.drawn.nodes.a;

console.log('\nthe confirmation gate with nothing to ask with');
{
  await throwsAsync('a delete refuses rather than proceeding unasked',
    () => mcp.callTool('remove_element', { id }), 'no way to ask');
  ok('the element survived the refusal', scene.has(id));
}

console.log('\nwithdrawing a tool from a host that cannot drop it');
{
  mcp.setMode('review');
  await throwsAsync('the dispatcher refuses it',
    () => mcp.callTool('remove_element', { id }), 'is not available');

  // This host ignores the abort signal, so it still lists the tool. What it
  // holds is the wrapper, which routes back through the dispatcher.
  const stale = bare.tools.get('remove_element');
  ok('the host is still holding the withdrawn tool', !!stale);
  await throwsAsync('and it refuses when the host calls it anyway',
    () => stale.execute({ id }), 'is not available');
  await throwsAsync('the refusal names the mode the board is in',
    () => stale.execute({ id }), 'review');
  ok('nothing was destroyed by the stale call', scene.has(id));
}

console.log('\na host that is slow to let go of a name');
{
  // Registering the same name twice is what happens on the way back from
  // review mode, because abort cleanup is not synchronous.
  const clashes = { tools: new Map(), seen: new Set() };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: {
    modelContext: {
      registerTool(tool) {
        if (clashes.seen.has(tool.name)) {
          return Promise.reject(new Error(`Tool already registered: ${tool.name}`));
        }
        clashes.seen.add(tool.name);
        clashes.tools.set(tool.name, tool);
        return Promise.resolve();
      },
    },
  }});

  mcp.setMode('review');
  mcp.setMode('draft');
  await new Promise(r => setTimeout(r, 0));       // let the rejections land
  ok('a tool the host already holds stays available',
    mcp.registeredToolNames().includes('remove_element'),
    mcp.registeredToolNames().sort().join(','));
  ok('the whole surface came back', mcp.registeredToolNames().length === 13);
}

console.log('\nthe page answering the gate instead');
{
  let asked = null;
  mcp.attach({ scene, confirm: async message => { asked = message; return false; } });
  mcp.setMode('draft');
  await throwsAsync('a refusal from the page aborts the delete',
    () => mcp.callTool('remove_element', { id }), 'declined');
  ok('the page was asked about the right element', (asked || '').includes('Somebody asks'));
  ok('nothing was destroyed', scene.has(id));
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);

// Chrome 152 ships navigator.modelContext.registerTool and nothing else: no
// requestUserInteraction, no unregisterTool. Both the confirmation gate and
// the mode boundary have to hold on a host like that, so this runs in its own
// file, where mcp.js has not already registered anything against a richer stub.

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
    // Real Chrome hands back a promise, which has no unregister method on it.
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

  const shadowed = bare.tools.get('remove_element');
  ok('a same-named tool is left behind to explain itself',
    !!shadowed && /UNAVAILABLE IN THIS MODE/.test(shadowed.description || ''));
  ok('the explanation lists what can be called instead',
    (shadowed?.description || '').includes('check_plan'));
  await throwsAsync('and it refuses when the host calls it anyway',
    () => shadowed.execute({ id }), 'not available');
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

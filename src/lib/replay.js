// ---------------------------------------------------------------------------
// Driver for the recorded session.
//
// This lives apart from the page so the test drives exactly the code the demo
// runs. A test that reimplements the driver can pass while the demo is broken,
// which is the failure the recorded session can least afford: for most people
// it is the only thing they will ever see this tool do.
// ---------------------------------------------------------------------------

import { recorded } from './recorded.js';

export async function runRecorded({ scene, call, setMode, you = 'you', onStep, pause }) {
  const ids = {};
  const done = [];

  for (const step of recorded) {
    if (step.mode) setMode(step.mode);

    if (step.tool) {
      const args = typeof step.args === 'function' ? step.args(ids) : (step.args || {});
      const result = await call(step.tool, args);
      if (step.keep && result?.drawn) {
        Object.assign(ids, result.drawn.nodes);
        const [assumption, risk] = result.drawn.notes || [];
        if (assumption) ids.assumption = assumption;
        if (risk) ids.risk = risk;
      }
      if (step.keepAs && result?.id) ids[step.keepAs] = result.id;
    }

    if (step.human) {
      const made = step.human(scene, you, ids);
      if (made?.type === 'comment') ids.objection = made.id;
      if (step.keepAs && made?.id) ids[step.keepAs] = made.id;
    }

    const focus = typeof step.select === 'function' ? step.select(ids) : step.select;
    done.push({ say: step.say, tool: step.tool, mode: step.mode, focus });

    await onStep?.({ step, ids, focus });
    if (pause) await pause(step.wait ?? 900);
  }

  return { ids, steps: done };
}

export const stepCount = recorded.length;
